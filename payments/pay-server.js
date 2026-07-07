#!/usr/bin/env node
'use strict';
/*
 * customPOS Payments Service — a standalone, drop-in card-processing microservice
 * ==============================================================================
 * Runs on the MERCHANT'S OWN server. Gives ANY point-of-sale — customPOS or a
 * third-party system — certified CardConnect / CardPointe (Fiserv) card payments
 * behind one small, neutral HTTP API.
 *
 * How a POS uses it (PCI SAQ-A — card data never touches this server or the POS):
 *   1. The browser captures the card with the processor's HOSTED iFrame tokenizer
 *      (or a registered physical terminal). That yields a TOKEN, not a card number.
 *   2. The POS backend calls this service with the token: POST /charge, /refund, /void.
 *   3. This service speaks the certified CardConnect protocol and returns a normalized
 *      result. Every processor-specific quirk lives in here; the POS just speaks cents.
 *
 * Zero dependencies (Node http/https only). Credentials come from the ENVIRONMENT —
 * no secrets in this file or the repo. See payments/README.md for the full guide,
 * the REST reference, and the per-merchant go-live checklist.
 *
 *   PAY_KEY=... PAY_PROVIDER=cardconnect CP_SITE=... CP_MID=... CP_USER=... CP_PASS=... \
 *     node payments/pay-server.js
 *
 * With no processor configured it runs the SIMULATOR provider, so a POS can integrate
 * and demo end-to-end before any merchant account exists.
 */
const http = require('http');
const https = require('https');

const PORT = Number(process.env.PAY_PORT || 8091);
const KEY = process.env.PAY_KEY || '';                                   // shared secret; callers send Authorization: Bearer <KEY>
const PROVIDER = (process.env.PAY_PROVIDER || (process.env.CP_MID ? 'cardconnect' : 'sim')).toLowerCase();

const CP = {
  site: process.env.CP_SITE || '',
  mid:  process.env.CP_MID  || '',
  user: process.env.CP_USER || '',
  pass: process.env.CP_PASS || '',
  env:  (process.env.CP_ENV || 'uat').toLowerCase()                       // 'uat' | 'prod'
};
const TERM = {
  host: process.env.CP_TERM_HOST || 'bolt-uat.cardpointe.com',
  hsn:  process.env.CP_TERM_HSN  || '',
  key:  process.env.CP_TERM_KEY  || ''
};

/* ---------- helpers ---------- */
function gwHost(){ return CP.env === 'prod' ? CP.site + '.cardconnect.com' : CP.site + '-uat.cardconnect.com'; }
function authHeader(){ return 'Basic ' + Buffer.from(CP.user + ':' + CP.pass).toString('base64'); }
function dollars(cents){ return (Math.round(cents) / 100).toFixed(2); }   // gateway wants a dollar STRING
function normalize(kind, j, amountCents){
  // one shape for every processor: the POS never parses processor-specific fields
  if (!j) return { status:'error', message:'no response from processor' };
  const approved = j.respstat === 'A';
  return {
    status: approved ? (kind==='refund'?'refunded':kind==='void'?'voided':'approved') : (j.respstat === 'C' ? 'declined' : 'error'),
    ref: j.retref || '',
    brand: j.binname || j.card || '',
    last4: (j.token && String(j.token).slice(-4)) || (j.account && String(j.account).slice(-4)) || '',
    amountCents: amountCents != null ? amountCents : (j.amount != null ? Math.round(Number(j.amount)*100) : undefined),
    authcode: j.authcode || '',
    cvv: j.cvvresp || '',
    message: j.resptext || ''
  };
}
function httpsJson(method, host, path, headers, body){
  return new Promise((resolve) => {
    const data = body ? JSON.stringify(body) : null;
    const opts = { method, host, path, headers: Object.assign({ 'Content-Type':'application/json' }, headers) };
    if (data) opts.headers['Content-Length'] = Buffer.byteLength(data);
    const r = https.request(opts, (res) => { let b=''; res.on('data', d=>b+=d); res.on('end', () => { let j=null; try{ j=JSON.parse(b); }catch(_){} resolve({ status:res.statusCode, json:j, headers:res.headers }); }); });
    r.on('error', e => resolve({ status:0, error:e.message }));
    r.setTimeout(130000, () => { r.destroy(); resolve({ status:0, error:'processor timeout' }); });
    if (data) r.write(data); r.end();
  });
}

/* ---------- provider: CARDCONNECT (certified) ---------- */
const cardconnect = {
  async charge(amountCents, o){
    const body = Object.assign({ merchid:CP.mid, currency:'USD', account:o.token, amount:dollars(amountCents), capture:o.capture===false?'N':'Y' }, {});
    if (o.expiry) body.expiry = o.expiry;                                 // MMYY when charging a tokenized PAN
    if (o.cvv) body.cvv2 = o.cvv;                                         // only on initial capture / token storage
    if (o.ecomind) body.ecomind = o.ecomind;                             // 'E' e-commerce · 'R' recurring
    if (o.cof) { body.cof = o.cof; body.cofscheduled = o.cofscheduled || 'N'; }   // 'C' customer- / 'M' merchant-initiated
    const r = await httpsJson('PUT', gwHost(), '/cardconnect/rest/auth', { Authorization:authHeader() }, body);
    return normalize('charge', r.json, amountCents);
  },
  async refund(ref, amountCents){
    const body = { merchid:CP.mid, retref:ref };
    if (amountCents != null) body.amount = dollars(amountCents);          // omit for a full refund
    const r = await httpsJson('PUT', gwHost(), '/cardconnect/rest/refund', { Authorization:authHeader() }, body);
    return normalize('refund', r.json, amountCents);
  },
  async void(ref){
    const r = await httpsJson('PUT', gwHost(), '/cardconnect/rest/void', { Authorization:authHeader() }, { merchid:CP.mid, retref:ref });
    return normalize('void', r.json);
  },
  async inquire(ref){
    const r = await httpsJson('GET', gwHost(), `/cardconnect/rest/inquire/${encodeURIComponent(ref)}/${encodeURIComponent(CP.mid)}`, { Authorization:authHeader() });
    return normalize('inquire', r.json);
  },
  // card-present: open a terminal session, then authorize on the tap/dip/swipe (amount is integer CENTS here)
  _sk: null,
  async termConnect(){
    const r = await httpsJson('POST', TERM.host, '/api/v2/connect', { Authorization:TERM.key }, { hsn:TERM.hsn, merchantId:CP.mid, force:true });
    const raw = r.headers && r.headers['x-cardconnect-sessionkey']; this._sk = raw ? String(raw).split(';')[0].trim() : null; return { status:this._sk?'connected':'error' };
  },
  async termCharge(amountCents){
    if (!this._sk) await this.termConnect();
    const r = await httpsJson('POST', TERM.host, '/api/v4/authCard', { Authorization:TERM.key, 'X-CardConnect-SessionKey':this._sk }, { merchantId:CP.mid, hsn:TERM.hsn, amount:Math.round(amountCents), capture:true });
    return normalize('charge', r.json, amountCents);
  },
  tokenizer(){
    // the hosted iFrame the POS embeds so card data goes straight to the processor (SAQ-A)
    const host = CP.env === 'prod' ? 'fts.cardconnect.com' : 'fts-uat.cardconnect.com';
    return { url: `https://${host}/itoke/ajax-tokenizer.html`, mode: CP.env };
  }
};

/* ---------- provider: SIM (no processor; demos, tests, CI) ---------- */
const BRANDS = ['Visa','Mastercard','Amex'];
const sim = {
  async charge(amountCents, o){
    const cents = Math.round(amountCents);
    if (cents % 100 === 13) return { status:'declined', ref:'', message:'declined (demo: any $_.13 declines)', amountCents:cents };
    return { status:'approved', ref:'SIM'+cents+'-'+((o&&o.token)||'tok').slice(-4), brand:BRANDS[cents%3], last4:String(cents).slice(-4).padStart(4,'0'), amountCents:cents, authcode:'OK', cvv:o&&o.cvv?'M':'' };
  },
  async refund(ref, amountCents){ return { status:'refunded', ref:(ref||'SIM')+'-R', amountCents: amountCents!=null?Math.round(amountCents):undefined }; },
  async void(ref){ return { status:'voided', ref:(ref||'SIM')+'-V' }; },
  async inquire(ref){ return { status: ref ? 'approved' : 'error', ref: ref||'' }; },
  async termConnect(){ return { status:'connected' }; },
  async termCharge(amountCents){ return this.charge(amountCents, {}); },
  tokenizer(){ return { url:'sim://tokenizer', mode:'sim' }; }
};

const ADAPTER = PROVIDER === 'cardconnect' ? cardconnect : sim;

/* ---------- HTTP server ---------- */
function cors(res){ res.setHeader('Access-Control-Allow-Origin','*'); res.setHeader('Access-Control-Allow-Headers','Content-Type, Authorization'); res.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS'); }
function send(res, code, obj){ res.statusCode=code; res.setHeader('Content-Type','application/json'); res.end(JSON.stringify(obj)); }
function authed(req){ if (!KEY) return true; const h=req.headers['authorization']||''; return h === 'Bearer '+KEY; }
function readBody(req){ return new Promise((resolve)=>{ let b=''; req.on('data',d=>{ b+=d; if(b.length>1e6) req.destroy(); }); req.on('end',()=>{ let j={}; try{ j=JSON.parse(b||'{}'); }catch(_){} resolve(j); }); }); }

const server = http.createServer(async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') { res.statusCode=204; return res.end(); }
  const url = req.url.split('?')[0];

  if (url === '/health') return send(res, 200, { ok:true, service:'custompos-payments', provider:PROVIDER, mode:CP.env, terminal: !!(TERM.hsn && TERM.key) });
  if (url === '/tokenizer' && req.method === 'GET') return send(res, 200, ADAPTER.tokenizer());

  // everything below moves money — require the shared key
  if (!authed(req)) return send(res, 401, { status:'error', message:'unauthorized — send Authorization: Bearer <PAY_KEY>' });

  try {
    if (url === '/charge' && req.method === 'POST'){ const b=await readBody(req); if(b.amountCents==null||!b.token) return send(res,400,{status:'error',message:'charge needs { amountCents, token }'}); return send(res,200, await ADAPTER.charge(b.amountCents, b)); }
    if (url === '/refund' && req.method === 'POST'){ const b=await readBody(req); if(!b.ref) return send(res,400,{status:'error',message:'refund needs { ref, amountCents? }'}); return send(res,200, await ADAPTER.refund(b.ref, b.amountCents)); }
    if (url === '/void'   && req.method === 'POST'){ const b=await readBody(req); if(!b.ref) return send(res,400,{status:'error',message:'void needs { ref }'}); return send(res,200, await ADAPTER.void(b.ref)); }
    if (url.startsWith('/inquire/') && req.method === 'GET'){ return send(res,200, await ADAPTER.inquire(decodeURIComponent(url.slice('/inquire/'.length)))); }
    if (url === '/terminal/connect' && req.method === 'POST'){ return send(res,200, await ADAPTER.termConnect()); }
    if (url === '/terminal/charge'  && req.method === 'POST'){ const b=await readBody(req); if(b.amountCents==null) return send(res,400,{status:'error',message:'terminal charge needs { amountCents }'}); return send(res,200, await ADAPTER.termCharge(b.amountCents)); }
  } catch (e) { return send(res, 500, { status:'error', message:e.message }); }

  send(res, 404, { status:'error', message:'not found' });
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`customPOS payments service on http://localhost:${PORT}  (provider: ${PROVIDER}${PROVIDER==='cardconnect'?', '+CP.env:''})`);
    if (!KEY) console.warn('  ⚠ PAY_KEY is not set — the API is UNPROTECTED. Set PAY_KEY before exposing this beyond localhost.');
    if (PROVIDER === 'sim') console.log('  (simulator — no real processor; set CP_* env vars for live CardConnect)');
  });
}
module.exports = { server, sim, cardconnect, normalize };
