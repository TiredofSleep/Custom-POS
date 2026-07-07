#!/usr/bin/env node
'use strict';
/*
 * validate-cardconnect.js — CardConnect / CardPointe integration-validation runner
 * ------------------------------------------------------------------------------
 * Runs the full Fiserv "Integration Validation" transaction gauntlet against your
 * UAT credentials and prints every retref, mapped to the boxes on the validation
 * form — so onboarding a new merchant is one command instead of ~20 hand-run
 * transactions across four rounds of back-and-forth.
 *
 * It bakes in the things that are easy to get wrong (learned the hard way):
 *   - gateway amount is a DOLLAR STRING ("9.32"); terminal amount is INTEGER CENTS
 *   - gateway capture is "Y"/"N"; a $0 verification MUST use capture:"N"
 *     (a $0 with capture:"Y" is rejected as "Invalid amount")
 *   - CVV must be sent on the INITIAL card-capture + token-storage transactions
 *     (cvvresp=P means it was missing); it can't be sent on a stored-token reuse
 *   - recurring / merchant-initiated transactions need cof:"M" + ecomind:"R"
 *   - the $1,100.xx amounts are EXPECTED to decline ("Do Not Honor") in UAT
 *   - refunds need a settled txn (or "Refunds Unsettled" enabled by your PDE)
 *
 * PCI note: this runner tokenizes the UAT test cards via CardSecure for automation.
 * Your PRODUCTION integration should tokenize card-not-present cards in the browser
 * with Fiserv's hosted iFrame Tokenizer, so real card data never touches your server
 * (keeps you in SAQ-A scope). See docs/PAYMENTS-MODULE.md.
 *
 * Part of customPOS. Free. No secrets in this file — credentials come from the
 * environment.
 *
 * USAGE
 *   CP_SITE=yoursite CP_MID=xxxx CP_USER=xxx CP_PASS=xxx CP_ENV=uat \
 *     node tools/validate-cardconnect.js
 *
 *   # include the physical Card-Present taps (needs a registered terminal):
 *   CP_TERM_HSN=xxx CP_TERM_KEY=xxx ... node tools/validate-cardconnect.js --present
 *
 *   # machine-readable output:
 *   ... node tools/validate-cardconnect.js --json
 */

const https = require('https');

const CFG = {
  site: process.env.CP_SITE || '',
  mid:  process.env.CP_MID  || '',
  user: process.env.CP_USER || '',
  pass: process.env.CP_PASS || '',
  env:  (process.env.CP_ENV || 'uat').toLowerCase(),   // 'uat' | 'prod'
  term: {
    host: process.env.CP_TERM_HOST || 'bolt-uat.cardpointe.com',
    hsn:  process.env.CP_TERM_HSN  || '',
    key:  process.env.CP_TERM_KEY  || ''
  }
};
const ARGS = process.argv.slice(2);
const WANT_PRESENT = ARGS.includes('--present');
const AS_JSON = ARGS.includes('--json');

// CardConnect PUBLIC UAT test cards (documented by Fiserv; not real cardholder data)
const CARDS = {
  visa: { pan: '4788250000121443', exp: '1226', cvv: '123'  },
  amex: { pan: '371449635392376',  exp: '1226', cvv: '1234' }   // Amex CVV is 4 digits
};

function gwHost(){ return CFG.env === 'prod' ? CFG.site + '.cardconnect.com' : CFG.site + '-uat.cardconnect.com'; }
function authHeader(){ return 'Basic ' + Buffer.from(CFG.user + ':' + CFG.pass).toString('base64'); }

function httpJson(method, host, path, headers, body){
  return new Promise((resolve) => {
    const data = body ? JSON.stringify(body) : null;
    const opts = { method, host, path, headers: Object.assign({ 'Content-Type': 'application/json' }, headers) };
    if (data) opts.headers['Content-Length'] = Buffer.byteLength(data);
    const r = https.request(opts, (res) => { let b = ''; res.on('data', d => b += d); res.on('end', () => { let j = null; try { j = JSON.parse(b); } catch (_) {} resolve({ status: res.statusCode, json: j, headers: res.headers }); }); });
    r.on('error', e => resolve({ status: 0, error: e.message }));
    r.setTimeout(130000, () => { r.destroy(); resolve({ status: 0, error: 'timeout (no card tapped?)' }); });
    if (data) r.write(data); r.end();
  });
}

const tokenize = (pan, exp) => httpJson('POST', gwHost(), '/cardsecure/api/v1/ccn/tokenize', {}, { account: pan, expiry: exp }).then(r => r.json && r.json.token);
const auth   = (body) => httpJson('PUT', gwHost(), '/cardconnect/rest/auth',   { Authorization: authHeader() }, Object.assign({ merchid: CFG.mid, currency: 'USD' }, body)).then(r => r.json || {});
const voidTx = (ref)  => httpJson('PUT', gwHost(), '/cardconnect/rest/void',   { Authorization: authHeader() }, { merchid: CFG.mid, retref: ref }).then(r => r.json || {});
const refund = (ref, amt) => httpJson('PUT', gwHost(), '/cardconnect/rest/refund', { Authorization: authHeader() }, { merchid: CFG.mid, retref: ref, amount: amt }).then(r => r.json || {});

// Card-present terminal (Bolt)
let _sk = null;
const termConnect = () => httpJson('POST', CFG.term.host, '/api/v2/connect', { Authorization: CFG.term.key }, { hsn: CFG.term.hsn, merchantId: CFG.mid, force: true })
  .then(r => { const raw = r.headers && r.headers['x-cardconnect-sessionkey']; _sk = raw ? String(raw).split(';')[0].trim() : null; return _sk; });
const termAuth = (cents) => httpJson('POST', CFG.term.host, '/api/v4/authCard', { Authorization: CFG.term.key, 'X-CardConnect-SessionKey': _sk }, { merchantId: CFG.mid, hsn: CFG.term.hsn, amount: Math.round(cents), capture: true }).then(r => r.json || {});

const results = [];
function record(section, label, j, note){ results.push({ section, label, retref: (j && j.retref) || '', status: (j && j.respstat) || '', text: (j && j.resptext) || '', cvv: (j && j.cvvresp) || '', note: note || '' }); }
function log(s){ if (!AS_JSON) console.log(s); }

async function run(){
  if (!CFG.site || !CFG.mid || !CFG.user || !CFG.pass){
    console.error('Missing required env: CP_SITE, CP_MID, CP_USER, CP_PASS (and CP_ENV=uat|prod).');
    process.exit(1);
  }
  log('CardConnect validation runner — ' + CFG.env.toUpperCase() + ' — MID ' + CFG.mid);

  const vtok = await tokenize(CARDS.visa.pan, CARDS.visa.exp);
  const atok = await tokenize(CARDS.amex.pan, CARDS.amex.exp);
  if (!vtok || !atok){ console.error('Tokenization failed — check credentials / environment.'); process.exit(1); }
  const V = { account: vtok, expiry: CARDS.visa.exp };

  // ---- Card Present (optional; needs a registered terminal + physical taps) ----
  if (WANT_PRESENT){
    if (!CFG.term.hsn || !CFG.term.key){ log('\n(Skipping Card Present — set CP_TERM_HSN and CP_TERM_KEY to include it.)'); }
    else {
      await termConnect();
      log('\n== CARD PRESENT — tap the test card when the terminal prompts ==');
      log('   >>> TAP NOW for $1,000.12 (expected APPROVE)…');
      record('Card Present', '$1,000.12', await termAuth(100012));
      log('   >>> TAP NOW for $1,100.25 (expected DECLINE)…');
      record('Card Present', '$1,100.25', await termAuth(110025), 'expected Do Not Honor');
    }
  }

  // ---- Card Not Present (token-based, WITH CVV) ----
  record('Card Not Present', 'Visa $9.32',        await auth(Object.assign({}, V, { cvv2: CARDS.visa.cvv, amount: '9.32',    capture: 'Y', ecomind: 'E' })));
  record('Card Not Present', 'Visa $1,100.35',    await auth(Object.assign({}, V, { cvv2: CARDS.visa.cvv, amount: '1100.35', capture: 'Y', ecomind: 'E' })), 'expected Do Not Honor');
  record('Card Not Present', 'Amex $9.32',        await auth({ account: atok, expiry: CARDS.amex.exp, cvv2: CARDS.amex.cvv, amount: '9.32', capture: 'Y', ecomind: 'E' }));

  // ---- Customer Initiated (token storage carries CVV; reuse does not) ----
  record('Customer Initiated', 'Token storage w/ txn $55.25', await auth(Object.assign({}, V, { cvv2: CARDS.visa.cvv, amount: '55.25', capture: 'Y', ecomind: 'E', cof: 'C', cofscheduled: 'N' })));
  record('Customer Initiated', 'Token storage, no txn $0',    await auth(Object.assign({}, V, { cvv2: CARDS.visa.cvv, amount: '0',     capture: 'N', ecomind: 'E', cof: 'C', cofscheduled: 'N' })));
  record('Customer Initiated', 'Stored token usage $100.25',  await auth(Object.assign({}, V, {                        amount: '100.25', capture: 'Y', ecomind: 'E', cof: 'C', cofscheduled: 'N' })), 'reuse — no CVV');

  // ---- Merchant Initiated (cof:"M"; recurring uses ecomind:"R") ----
  record('Merchant Initiated', 'Token storage w/ txn, recurring $40.25', await auth(Object.assign({}, V, { amount: '40.25',  capture: 'Y', ecomind: 'R', cof: 'M', cofscheduled: 'Y' })));
  record('Merchant Initiated', 'Stored token, recurring $26.50',         await auth(Object.assign({}, V, { amount: '26.50',  capture: 'Y', ecomind: 'R', cof: 'M', cofscheduled: 'Y' })));
  record('Merchant Initiated', 'Stored token, merchant-initiated $150.00', await auth(Object.assign({}, V, { amount: '150.00', capture: 'Y', ecomind: 'E', cof: 'M', cofscheduled: 'N' })));

  // ---- Void (run a sale, void it; the box wants the ORIGINAL retref) ----
  const vSale = await auth(Object.assign({}, V, { cvv2: CARDS.visa.cvv, amount: '15.00', capture: 'Y', ecomind: 'E' }));
  const vRes  = await voidTx(vSale.retref);
  record('Void', 'Void entire $15.00', { retref: vSale.retref, respstat: vRes.respstat, resptext: vRes.resptext }, 'authcode ' + (vRes.authcode || ''));

  // ---- Refund (full + partial; the box wants the REFUND transaction retref) ----
  const fSale = await auth(Object.assign({}, V, { cvv2: CARDS.visa.cvv, amount: '12.50', capture: 'Y', ecomind: 'E' }));
  record('Refund', 'Full refund $12.50',   await refund(fSale.retref, '12.50'), 'refund of sale ' + fSale.retref);
  const pSale = await auth(Object.assign({}, V, { cvv2: CARDS.visa.cvv, amount: '20.00', capture: 'Y', ecomind: 'E' }));
  record('Refund', 'Partial refund $9.00', await refund(pSale.retref, '9.00'),  'refund of sale ' + pSale.retref);

  report();
}

function pad(s, n){ s = String(s); return s.length >= n ? s : s + ' '.repeat(n - s.length); }
function report(){
  if (AS_JSON){ console.log(JSON.stringify(results, null, 2)); return; }
  console.log('\n================= VALIDATION RESULTS =================');
  let sec = '';
  results.forEach(r => {
    if (r.section !== sec){ sec = r.section; console.log('\n' + sec); }
    const ok = r.status === 'A' ? 'APPROVED' : (r.status === 'C' ? 'declined' : (r.status || '?'));
    console.log('  ' + pad(r.label, 40) + ' retref ' + pad(r.retref || '—', 14) + ' ' + pad(ok, 9) + (r.cvv ? (' cvv=' + r.cvv) : '') + (r.note ? ('   [' + r.note + ']') : ''));
  });
  const unexpected = results.filter(r => r.status !== 'A' && !/expected/i.test(r.note));
  console.log('\n' + (unexpected.length
    ? '⚠ ' + unexpected.length + ' unexpected result(s) — review above before submitting.'
    : '✓ All results as expected (approvals + the intentional $1,100.xx "Do Not Honor" declines).'));
  console.log('\nPaste each retref into the matching box on the Fiserv Integration Validation form.');
}

run().catch(e => { console.error('Runner error:', e.message); process.exit(1); });
