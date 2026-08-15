/* ============================================================
   OZARK PLANT HUB  —  tiny, dependency-free sync server
   ------------------------------------------------------------
   What it does:
     • Serves the POS app to every device on the LAN
         http://<this-pc-ip>:8090/Ozark-POS.html
     • Holds ONE shared data file (the master copy)
     • Lets each counter PC + the phone PULL and PUSH that data
     • Keeps automatic backups (and, because this folder lives in
       OneDrive, those backups also copy off-site for free)

   Run it:   double-click START-HUB.bat   (or: node hub-server.js)
   Stop it:  close the window / Ctrl+C
   No installs needed — uses only what ships with Node.
   ============================================================ */
'use strict';
const http  = require('http');
const https = require('https');
const tls   = require('tls');
const crypto = require('crypto');
const fs    = require('fs');
const path  = require('path');
const os    = require('os');

/* 🛡 Never let one bad request take down the 24/7 hub. A thrown error or rejected promise (e.g. send() on a
   socket the client already closed mid-charge) is logged, not fatal — the process keeps serving every other
   device. systemd would restart it anyway, but a churn-restart mid-transaction is exactly what we avoid. */
process.on('uncaughtException',  e => { try { console.error('[uncaughtException]', e && e.stack || e); } catch(_){} });
process.on('unhandledRejection', e => { try { console.error('[unhandledRejection]', e && e.stack || e); } catch(_){} });

/* Load secrets/settings from a local "hub.env" file (KEY=VALUE per line) so they don't have to be
   OS environment variables — handy on a cloud Linux box. File values fill in only where an OS env
   var isn't already set. Keep hub.env on the hub/server ONLY (it holds your secrets). */
(function loadEnvFile(){
  try {
    const ep = path.join(__dirname, 'hub.env');
    if (!fs.existsSync(ep)) return;
    fs.readFileSync(ep, 'utf8').split(/\r?\n/).forEach(function(line){
      if (/^\s*#/.test(line)) return;
      const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (!m) return;
      let v = m[2];
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      if (process.env[m[1]] === undefined || process.env[m[1]] === '') process.env[m[1]] = v;
    });
    console.log('  (loaded settings from hub.env)');
  } catch (e) {}
})();
const PORT     = Number(process.env.OZARK_PORT || 8090);
const ROOT     = __dirname;                          // serve this folder
const DATADIR  = path.join(ROOT, 'hub-data');        // lives inside OneDrive => off-site backup
const BACKUPS  = path.join(DATADIR, 'backups');
const PHOTODIR = path.join(DATADIR, 'photos');       // garment photos as FILES (kept OUT of the synced DB so the app stays light); covered by the droplet's daily backups
const DBFILE   = path.join(DATADIR, 'ozark-db.json');
const BAKFILE  = path.join(DATADIR, 'ozark-db.bak.json');
const KEEP_BK  = 60;                                 // how many timestamped snapshots to keep
/* 🛣 PHASE 4 — THE HUB BECOMES HIGHWAYS. Owner: "the hub is a system of highways, not a data storage center."
   Until now EVERY push wrote the whole database three times: a .bak copy, the live file, and a timestamped
   snapshot — then scanned and pruned the backups folder. Three full-size writes per push is the ceiling this
   removes, and it is the one that gets worse with every order the shop ever takes.
   The traffic record is now the append-only DELTA LOG: one small line per revision holding exactly what that
   revision changed. The snapshot stops being the only history and becomes what it should have been all along —
   a fast starting point. Timestamped snapshots become CHECKPOINTS on an interval instead of one per push.
   ⚠️ THIS MUST NOT COST RECOVERABILITY, and it does not: today you can restore to any of the last 30 pushes.
   After this you can restore to any CHECKPOINT and then replay the log forward to ANY revision — strictly finer
   grained. That promise is only worth as much as the replay, which is why `hub-replay.js` ships with it and
   test-hub.js proves a rebuilt database is byte-identical to the live one. */
const DELTALOG = path.join(DATADIR, 'delta-log.jsonl');       // append-only: one line per revision, forever
const CKPT_REVS = Number(process.env.OZARK_CKPT_REVS || 200); // a checkpoint at least every N revisions
const CKPT_MS   = Number(process.env.OZARK_CKPT_MS   || 30 * 60 * 1000);   // ...and at least every 30 minutes
const DELTALOG_ROLL = Number(process.env.OZARK_DELTALOG_ROLL || 64 * 1024 * 1024);  // roll (never delete) at 64MB
let   lastCkptAt = 0, lastCkptRev = 0;
const PICKFILE = path.join(DATADIR, 'pickup-requests.json');  // online "schedule a pickup" queue — kept SEPARATE from the synced DB so a public submit never collides with device sync
const FBFILE   = path.join(DATADIR, 'feedback.json');         // customer feedback + $10 review-credit queue (also separate from the synced DB)
const CARDLINKFILE = path.join(DATADIR, 'card-links.json');   // 💳 "add a card by text" queue — one-time secure links + the CardSecure token the customer submits (separate from the synced DB; the raw card # NEVER lands here, only a token)
const SMSINFILE = path.join(DATADIR, 'sms-inbound.json');     // 💬 inbound customer texts (non-STOP/START) — the POS shows these as a home-screen flag + reply; separate from the synced DB
const SMSOUTFILE = path.join(DATADIR, 'sms-outbound.json');   // 💬 outbound texts we sent — the consolidated message trail (with bodies), on the hub so it's the same across every device + in the off-site backups
const ARCHFILE = path.join(DATADIR, 'activity-archive.jsonl'); // PERMANENT, append-only audit trail — every activity event ever synced, NEVER trimmed (the browser only keeps a recent window)
const ORDFILE  = path.join(DATADIR, 'order-history.jsonl');   // PERMANENT, append-only: every order state change the hub has ever observed. Lives OUTSIDE the synced DB, so no merge, rollback or stale push can rewrite it.
const ORD_RANK = { 'Received':1,'Quick':1,'Detailed':2,'In Process':2,'Assembled':3,'Racked':4,'Ready':5,'PickedUp':6,'Split':6,'Void':7 };
/* ---- card processing ------------------------------------------------------------------
   The processor SECRET credentials live HERE on the hub (environment variables), NEVER in the
   browser. Nothing below activates until you set them, so PRODUCTION IS UNAFFECTED until you
   deliberately go live. Set these, then restart the hub:
     CardPointe/Fiserv:  OZARK_CARDPOINTE_SITE   OZARK_CARDPOINTE_MID
                         OZARK_CARDPOINTE_USER   OZARK_CARDPOINTE_PASS   OZARK_CARDPOINTE_ENV (uat|prod)
   (Stripe/Helcim placeholders: OZARK_STRIPE_SECRET / OZARK_HELCIM_TOKEN)                        */
const CP = {
  site: process.env.OZARK_CARDPOINTE_SITE || '',
  mid:  process.env.OZARK_CARDPOINTE_MID  || '',
  user: process.env.OZARK_CARDPOINTE_USER || '',
  pass: process.env.OZARK_CARDPOINTE_PASS || '',
  env:  (process.env.OZARK_CARDPOINTE_ENV || 'uat').toLowerCase()      // 'uat' (test) or 'prod' (live)
};
function cpConfigured(){ return !!(CP.site && CP.mid && CP.user && CP.pass); }
function cpHost(){ return CP.env === 'prod' ? (CP.site + '.cardconnect.com') : (CP.site + '-uat.cardconnect.com'); }
/* CardPointe Bolt Integrated Terminal (P2PE, card-present). host = bolt[-uat].cardpointe.com.
   connect (POST {hsn,merchantId,force}) → session key → authCard reads a card ON the terminal + authorizes. */
const CPT = {
  host:    process.env.OZARK_CPTERM_HOST    || 'bolt-uat.cardpointe.com',
  hsn:     process.env.OZARK_CPTERM_HSN     || '',
  mid:     process.env.OZARK_CPTERM_MID     || '',
  authkey: process.env.OZARK_CPTERM_AUTHKEY || ''
};
function cptConfigured(){ return !!(CPT.host && CPT.hsn && CPT.mid && CPT.authkey); }
/* ── Per-store card routing ──────────────────────────────────────────────────────────────
   A store id can override the gateway MID and the terminal (HSN/MID/authkey/host) via env:
     OZARK_CARDPOINTE_MID_<store>   (and _SITE_/_USER_/_PASS_/_ENV_ if a store needs its own gateway creds)
     OZARK_CPTERM_HSN_<store> / _MID_<store> / _AUTHKEY_<store> / _HOST_<store>
   Anything unset falls back to the global value, so a single-store setup behaves exactly as before.
   e.g. store 1 = Arkadelphia (the globals), store 2 = Hot Springs (its own MID + terminal). */
function cpForStore(store){ store = String(store||''); return {
  site: process.env['OZARK_CARDPOINTE_SITE_'+store] || CP.site,
  mid:  process.env['OZARK_CARDPOINTE_MID_'+store]  || CP.mid,
  user: process.env['OZARK_CARDPOINTE_USER_'+store] || CP.user,
  pass: process.env['OZARK_CARDPOINTE_PASS_'+store] || CP.pass,
  env:  (process.env['OZARK_CARDPOINTE_ENV_'+store] || CP.env) }; }
function cpHostOf(cp){ return cp.env === 'prod' ? (cp.site + '.cardconnect.com') : (cp.site + '-uat.cardconnect.com'); }
function cpAuthHeaderOf(cp){ return 'Basic ' + Buffer.from(cp.user + ':' + cp.pass).toString('base64'); }
function cptForStore(store){ store = String(store||''); return {
  host:    process.env['OZARK_CPTERM_HOST_'+store]    || CPT.host,
  hsn:     process.env['OZARK_CPTERM_HSN_'+store]     || CPT.hsn,
  mid:     process.env['OZARK_CPTERM_MID_'+store]     || CPT.mid,
  authkey: process.env['OZARK_CPTERM_AUTHKEY_'+store] || CPT.authkey }; }
function cptConfiguredFor(store){ const t = cptForStore(store); return !!(t.host && t.hsn && t.mid && t.authkey); }
let _cptSess = {};   // per-store session cache: { <store>: { key, exp } } — two stores = two terminals = two sessions
function cptReq(term, method, reqPath, headers, bodyObj){
  return new Promise(function(resolve){
    const data = bodyObj ? JSON.stringify(bodyObj) : null;
    const opts = { method, host: term.host, path: reqPath, headers: Object.assign({ 'content-type':'application/json', 'authorization': term.authkey }, headers||{}) };
    if (data) opts.headers['Content-Length'] = Buffer.byteLength(data);
    const rq = https.request(opts, (resp) => { let buf=''; resp.on('data', d => buf += d); resp.on('end', () => { let j=null; try { j = JSON.parse(buf); } catch(e){} resolve({ status: resp.statusCode, json: j, raw: buf, headers: resp.headers }); }); });
    rq.on('error', (e) => resolve({ status:0, error: e.message }));
    rq.setTimeout(120000, () => { rq.destroy(); resolve({ status:0, error:'terminal timed out (no card / not tapped)' }); });   // long: authCard waits for a human to tap
    if (data) rq.write(data); rq.end();
  });
}
function cptConnect(store, force){
  const term = cptForStore(store); const now = Date.now(); const key0 = String(store||''); const cache = _cptSess[key0] || { key:'', exp:0 };
  if (!force && cache.key && cache.exp > now + 5000) return Promise.resolve(cache.key);
  return cptReq(term, 'POST', '/api/v2/connect', {}, { hsn: term.hsn, merchantId: term.mid, force: true }).then(function(r){
    const raw = r.headers && (r.headers['x-cardconnect-sessionkey'] || '');
    if (raw) { const key = String(raw).split(';')[0].trim(); const em = /expires=([^;]+)/.exec(raw); _cptSess[key0] = { key, exp: em ? Date.parse(em[1]) : (now + 540000) }; return key; }
    return '';
  });
}
/* read a card on the terminal and authorize it (card-present) — routes to the store's own terminal */
function cptAuthCard(amountCents, ctx){
  ctx = ctx || {}; const store = ctx.store; const term = cptForStore(store);
  return cptConnect(store, false).then(function(sk){
    if (!sk) return { status:'error', message:'Could not open a session with the terminal — is it connected?' };
    /* ⛔ NO `bin` HERE. It was added on 2026-08-10 to all three card calls so a saved card would carry its real
       brand instead of the literal word "Card". The GATEWAY accepts it (8/12: three approvals came back
       "Amex"), but the BOLT TERMINAL API does not — it answers `Invalid value for param: 'bin'.` and refuses
       the sale outright. That took the counter down on 2026-08-13: five attempts on Robin Rendell's $7.70, no
       payment possible, error every time. ⚠️ It is REMOVED rather than retyped as a boolean: nothing proves
       Bolt accepts `bin` in any form, and guessing at a parameter with a customer's card at the reader is how
       an outage becomes two. The brand for a terminal-read card falls back to "Card" — cosmetic, and the
       gateway fallback below still reports it. */
    const body = { merchantId: term.mid, hsn: term.hsn, amount: Math.round(Number(amountCents)||0), capture: true, includeExpirationDate: true };   // v4: amount in CENTS (2 implied decimals), capture as a JSON boolean
    // ⚠️ includeExpirationDate is REQUIRED here. Without it the terminal returns a token but NO `expiry`, so the
    //    gateway fallback below sent no expiry at all and CardConnect replied "Non-numeric expiry" — a decline that
    //    named the wrong cause and sent us chasing the saved-card expiry twice (Vince 7/22, Simone 7/29,
    //    Arlo Barlowe 7/31 + 8/5, whose stored expiry was a perfectly valid "1028" the whole time).
    return cptReq(term, 'POST', '/api/v4/authCard', { 'x-cardconnect-sessionkey': sk }, body).then(function(r){
      /* 💳🗒 THE READER'S OWN ANSWER, RECORDED. Every one of these outcomes used to die on the station that saw
         it — a timeout with no card tapped, a decryption failure, "terminal already in use", a cancel. Which is
         why "Mastercards will not save" could not be checked: the hub had never heard of the attempt. */
      if (r.status === 0) { const e0 = { status:'error', message: r.error || 'terminal timed out (no card tapped)' };
        cardLog('terminal', ctx.dev || '', ctx, e0, { amount: amountCents, via:'no answer' }); return e0; }
      const j = r.json || {};
      if (j.respstat) { const norm = cpNormalize(j); if (!norm.last4 && j.token) norm.last4 = String(j.token).slice(-4);
        cardLog('terminal', ctx.dev || '', ctx, norm, { amount: amountCents, via:'read' }); return norm; }   // authCard authorized via the gateway → standard result
      if (j.errorMessage) { const e1 = { status:'error', message: j.errorMessage };
        cardLog('terminal', ctx.dev || '', ctx, e1, { amount: amountCents, via:'reader refused' }); return e1; }
      if (j.token) return cpAuthCapture(j.token, amountCents, { ecomind:'R', expiry:j.expiry, store: store });   // fallback: token only → auth via gateway (R = retail/card-present), same store
      return { status:'error', message: ('terminal HTTP ' + r.status) };
    });
  });
}
/* 💾 Tokenize a card on the terminal for card-on-file — a $0 account verification with capture:false. Reads
   the card (tap/dip/key on the reader), returns a CardSecure token, and moves NO money (nothing to capture,
   no hold). Card-on-file is captured on the reader, never a browser box. */
function cptTokenizeCard(store){
  const term = cptForStore(store);
  return cptConnect(store, false).then(function(sk){
    if (!sk) return { status:'error', message:'Could not open a session with the terminal — is it connected?' };
    /* ⛔ NO `bin` HERE EITHER — same Bolt endpoint, same refusal. See the note in cptAuthCard above. This is
       the SAVE path, so it is the one where the brand mattered most, and losing it is the price of the card
       being readable at all. */
    const body = { merchantId: term.mid, hsn: term.hsn, amount: 0, capture: false, includeExpirationDate: true };   // $0 verify, no capture → token only, no money. includeExpirationDate or the saved card gets exp:'' and every later charge dies as "Non-numeric expiry"
    return cptReq(term, 'POST', '/api/v4/authCard', { 'x-cardconnect-sessionkey': sk }, body).then(function(r){
      if (r.status === 0) return { status:'error', message: r.error || 'terminal timed out (no card read)' };
      const j = r.json || {};
      const tok = j.token || j.account || '';
      if (tok) {                                   // got a token back → saved
        const norm = j.respstat ? cpNormalize(j) : {};
        return { status:'approved', token: tok, last4: (norm.last4 || cpLast4(tok)), brand: (norm.brand || 'Card'), exp: (j.expiry || norm.exp || '') };
      }
      if (j.errorMessage) return { status:'error', message: j.errorMessage };   // e.g. terminal doesn't allow a $0 verify → owner reports and we switch to a $1-auth+void
      return { status:'error', message: ('terminal HTTP ' + r.status) };
    });
  });
}
/* 💾 Read a MANUALLY-KEYED card on the terminal (card-NOT-present: the clerk keys the number the customer
   reads over the phone, on the Bolt P2PE keypad) → CardSecure token, NO charge, NO money. Used for saving a
   card on file over the phone and for phone/mail-order payments. The PAN is entered on the terminal hardware,
   never in our app/browser. readManual = tokenize only; the token is then charged via the gateway. */
function cptReadManual(store){
  const term = cptForStore(store);
  return cptConnect(store, false).then(function(sk){
    if (!sk) return { status:'error', message:'Could not open a session with the terminal — is it connected?' };
    const body = { merchantId: term.mid, hsn: term.hsn, includeExpirationDate: true, beep: true };
    return cptReq(term, 'POST', '/api/v2/readManual', { 'x-cardconnect-sessionkey': sk }, body).then(function(r){
      if (r.status === 0) return { status:'error', message: r.error || 'terminal timed out (no card keyed)' };
      const j = r.json || {};
      const tok = j.token || j.account || '';
      if (tok) return { status:'approved', token: tok, last4: cpLast4(tok), brand: 'Card', exp: (j.expiry || '') };
      if (j.errorMessage) return { status:'error', message: j.errorMessage };   // e.g. cancelled / invalid on the terminal
      if (j.resptext)     return { status:'error', message: j.resptext };
      return { status:'error', message: 'No card was keyed (cancelled on the terminal)' };
    });
  });
}
/* cancel an in-progress terminal command (the cashier left the pickup screen while it was still waiting for a tap) */
function cptCancel(store){
  const term = cptForStore(store);
  return cptConnect(store, false).then(function(sk){
    if (!sk) return { ok:false, message:'no terminal session' };
    return cptReq(term, 'POST', '/api/v2/cancel', { 'x-cardconnect-sessionkey': sk }, { merchantId: term.mid, hsn: term.hsn })
      .then(function(r){ return { ok: (r.status >= 200 && r.status < 300), status: r.status, json: r.json || null }; });
  });
}
/* Square — self-serve processor. Access Token is the SECRET (hub only). */
const SQ = {
  token:    process.env.OZARK_SQUARE_TOKEN    || '',
  location: process.env.OZARK_SQUARE_LOCATION || '',
  env:      (process.env.OZARK_SQUARE_ENV || 'sandbox').toLowerCase()    // 'sandbox' or 'production'
};
function sqConfigured(){ return !!(SQ.token && SQ.location); }
function sqHost(){ return SQ.env === 'production' ? 'connect.squareup.com' : 'connect.squareupsandbox.com'; }
/* Twilio SMS — Account SID / Auth Token / From number are SECRETS (hub only). Runs alongside SPOT. */
const TW = { sid: process.env.OZARK_TWILIO_SID || '', token: process.env.OZARK_TWILIO_TOKEN || '', from: process.env.OZARK_TWILIO_FROM || '' };
const PUBLIC_URL = (process.env.OZARK_PUBLIC_URL || 'https://142-93-2-141.sslip.io').replace(/\/+$/, '');   // absolute https base Twilio can reach for delivery callbacks
var __smsStatus = {};   // MessageSid -> { status, errorCode, to, ts } — delivery confirmations Twilio posts back (in-memory, transient)
function smsConfigured(){ return !!(TW.sid && TW.token && TW.from); }
function twSend(to, body){
  let data = 'To=' + encodeURIComponent(to) + '&From=' + encodeURIComponent(TW.from) + '&Body=' + encodeURIComponent(body);
  data += '&StatusCallback=' + encodeURIComponent(PUBLIC_URL + '/api/sms/status');   // Twilio reports delivered/undelivered/failed back to us
  return new Promise((resolve) => {
    const opts = { method:'POST', host:'api.twilio.com', path:'/2010-04-01/Accounts/' + encodeURIComponent(TW.sid) + '/Messages.json',
      headers: { 'Authorization': 'Basic ' + Buffer.from(TW.sid + ':' + TW.token).toString('base64'), 'Content-Type':'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(data) } };
    const rq = https.request(opts, (resp) => { let buf=''; resp.on('data', d => buf += d); resp.on('end', () => { let j=null; try { j = JSON.parse(buf); } catch(e){} resolve({ status: resp.statusCode, json: j }); }); });
    rq.on('error', e => resolve({ status:0, error:e.message })); rq.setTimeout(20000, () => { rq.destroy(); resolve({ status:0, error:'timeout' }); });
    rq.write(data); rq.end();
  });
}
/* Email over SMTP (SiteGround mail, Gmail, anything) — the mailbox password is a SECRET (hub only, like the
   Twilio token). Used for A/R statements. Sending mail does NOT touch the domain's own MX/DNS records.
   Host is auto-picked from the address (gmail -> smtp.gmail.com, else mail.<domain>, the SiteGround/cPanel
   convention) unless OZARK_SMTP_HOST overrides it. OZARK_GMAIL_* names still work (older docs). */
function normPass(p, user){
  p = String(p == null ? '' : p).replace(/^\s+|\s+$/g, '');                       // trim ends only
  if (/@(gmail|googlemail)\.com$/i.test(String(user || ''))) p = p.replace(/\s+/g, '');   // Google shows App Passwords as "abcd efgh ijkl mnop"
  return p;                                                                       // NOTE: a real mailbox password may contain spaces — never strip inside for non-Gmail
}
const GM = {
  user:     process.env.OZARK_SMTP_USER || process.env.OZARK_GMAIL_USER || '',
  pass:     '',                                                                   // set just below (needs user for the gmail-only space strip)
  fromName: process.env.OZARK_SMTP_FROM || process.env.OZARK_GMAIL_FROM || 'Ozark Cleaners and Laundry',
  replyTo:  process.env.OZARK_SMTP_REPLYTO || process.env.OZARK_GMAIL_REPLYTO || '',
  bcc:      process.env.OZARK_SMTP_BCC || '',                                     // owner copy: BCC'd on every send (blind — customers never see it)
  host:     process.env.OZARK_SMTP_HOST || '',
  port:     Number(process.env.OZARK_SMTP_PORT || 465)                            // 465 = implicit TLS (SiteGround + Gmail both support it)
};
GM.pass = normPass(process.env.OZARK_SMTP_PASS || process.env.OZARK_GMAIL_APP_PW || '', GM.user);
function smtpHost(){
  if (GM.host) return GM.host;
  const dom = (String(GM.user).split('@')[1] || '').trim();
  if (/^(gmail|googlemail)\.com$/i.test(dom)) return 'smtp.gmail.com';
  return dom ? ('mail.' + dom) : 'smtp.gmail.com';
}
function emailConfigured(){ return !!(GM.user && GM.pass); }
function mimeWord(s){ s = String(s == null ? '' : s); return /[^\x20-\x7E]/.test(s) ? ('=?UTF-8?B?' + Buffer.from(s, 'utf8').toString('base64') + '?=') : s; }
function b64wrap(s){ return Buffer.from(String(s || ''), 'utf8').toString('base64').replace(/(.{76})/g, '$1\r\n'); }
function htmlToText(h){ return String(h || '').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<br\s*\/?>(?=)/gi, '\n').replace(/<\/(p|div|tr|h[1-6]|li)>/gi, '\n').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/[ \t]+/g, ' ').replace(/\n[ \t]+/g, '\n').replace(/\n{3,}/g, '\n\n').trim(); }
/* Turn our monospace invoice/receipt TEXT into a real PDF (Courier, WinAnsi, paginated) — zero-dependency,
   so the attached invoice reads exactly like the ticket we print at assembly. */
function pdfText(s){
  s = String(s == null ? '' : s).replace(/\r\n?/g, '\n')
    .replace(/[‘’‚]/g, "'").replace(/[“”„]/g, '"')
    .replace(/[–—]/g, '-').replace(/…/g, '...').replace(/[•∙]/g, '*').replace(/\t/g, '    ');
  return s.replace(/[^\n\x20-\x7E\xA0-\xFF]/g, '');   // keep newline + printable Latin-1 (WinAnsi); drop emoji/box glyphs
}
const PDF_ESC = function(s){ return pdfText(s).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)'); };
/* assemble a PDF from finished page content streams. Fonts on every page: F1 Courier, F2 Helvetica, F3 Helvetica-Bold, F4 Courier-Bold. */
function buildPdf(pageStreams){
  if (!pageStreams.length) pageStreams = ['BT ET'];
  let pdf = Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n', 'latin1');
  const offsets = {};
  const addObj = function(num, body){ offsets[num] = pdf.length; pdf = Buffer.concat([pdf, Buffer.from(num + ' 0 obj\n' + body + '\nendobj\n', 'latin1')]); };
  let nextNum = 7;
  const contentObjs = [], pageObjs = [], pageNums = [];
  pageStreams.forEach(function(cs){
    const cNum = nextNum++, pNum = nextNum++;
    contentObjs.push({ num: cNum, cs: cs }); pageObjs.push({ num: pNum, cNum: cNum }); pageNums.push(pNum);
  });
  addObj(1, '<</Type/Catalog/Pages 2 0 R>>');
  addObj(2, '<</Type/Pages/Kids[' + pageNums.map(n => n + ' 0 R').join(' ') + ']/Count ' + pageNums.length + '>>');
  addObj(3, '<</Type/Font/Subtype/Type1/BaseFont/Courier/Encoding/WinAnsiEncoding>>');
  addObj(4, '<</Type/Font/Subtype/Type1/BaseFont/Helvetica/Encoding/WinAnsiEncoding>>');
  addObj(5, '<</Type/Font/Subtype/Type1/BaseFont/Helvetica-Bold/Encoding/WinAnsiEncoding>>');
  addObj(6, '<</Type/Font/Subtype/Type1/BaseFont/Courier-Bold/Encoding/WinAnsiEncoding>>');
  contentObjs.forEach(function(co){ addObj(co.num, '<</Length ' + Buffer.byteLength(co.cs, 'latin1') + '>>\nstream\n' + co.cs + '\nendstream'); });
  pageObjs.forEach(function(po){ addObj(po.num, '<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Resources<</Font<</F1 3 0 R/F2 4 0 R/F3 5 0 R/F4 6 0 R>>>>/Contents ' + po.cNum + ' 0 R>>'); });
  const total = nextNum, xrefStart = pdf.length;
  let xref = 'xref\n0 ' + total + '\n0000000000 65535 f \n';
  for (let n = 1; n < total; n++) xref += String(offsets[n] || 0).padStart(10, '0') + ' 00000 n \n';
  xref += 'trailer\n<</Size ' + total + '/Root 1 0 R>>\nstartxref\n' + xrefStart + '\n%%EOF';
  return Buffer.concat([pdf, Buffer.from(xref, 'latin1')]);
}
/* monospace text -> page streams (invoices — reads exactly like the printed assembly ticket) */
function textPages(text, opts){
  opts = opts || {};
  const size = opts.fontSize || 10, margin = opts.margin || 42, PH = 792;
  const leading = Math.round(size * 1.32 * 100) / 100;
  const perPage = Math.max(1, Math.floor((PH - margin * 2) / leading));
  const all = pdfText(text).split('\n');
  const chunks = [];
  for (let i = 0; i < all.length; i += perPage) chunks.push(all.slice(i, i + perPage));
  if (!chunks.length) chunks.push(['']);
  const startY = PH - margin - size;
  return chunks.map(function(plines){
    let cs = 'BT\n/F1 ' + size + ' Tf\n' + leading + ' TL\n' + margin + ' ' + startY + ' Td\n';
    plines.forEach(function(ln){ cs += '(' + PDF_ESC(ln) + ') Tj T*\n'; });
    return cs + 'ET';
  });
}
function textPdf(text, opts){ return buildPdf(textPages(text, opts)); }
/* typeset A/R statement -> page streams. S = { title, periodLabel, billTo[], accountNo, closing, remit,
   rows:[{sec}|{date,ref,desc,amt}], prevBal, totPay, newChg, balDue, aging|null, foot } (built by the POS). */
function stmtPages(S){
  const W = 612, H = 792, M = 54, RIGHT = W - M;
  const out = []; let ops = [], y = H - M;
  const str = function(v){ return String(v == null ? '' : v); };
  const money = function(n){ n = Number(n) || 0; return (n < 0 ? '-$' : '$') + Math.abs(n).toFixed(2); };
  const txt   = function(f, s, x, yy, t, g){ ops.push('BT /' + f + ' ' + s + ' Tf ' + (g != null ? g : 0) + ' g ' + x.toFixed(1) + ' ' + yy.toFixed(1) + ' Td (' + PDF_ESC(str(t)) + ') Tj ET'); };
  const rightT = function(f, s, rx, yy, t, g){ const tt = str(t); txt(f, s, rx - tt.length * s * 0.6, yy, tt, g); };          // Courier metrics (0.6em) — use with F1/F4 only
  const center = function(f, s, yy, t, g){ const tt = str(t); txt(f, s, (W - tt.length * s * 0.55) / 2, yy, tt, g); };        // approx Helvetica centering
  const hline  = function(x1, x2, yy, th){ ops.push('0 g ' + x1.toFixed(1) + ' ' + yy.toFixed(1) + ' ' + (x2 - x1).toFixed(1) + ' ' + (th || 0.8) + ' re f'); };
  const wrap   = function(t, n){ t = str(t); const words = t.split(/\s+/), lines = []; let cur = '';
    words.forEach(function(w){ if ((cur + ' ' + w).trim().length > n){ if (cur) lines.push(cur); cur = w; } else cur = (cur + ' ' + w).trim(); });
    if (cur) lines.push(cur); return lines.length ? lines : ['']; };
  const tableHead = function(){ txt('F3', 9, M, y, 'DATE'); txt('F3', 9, M + 56, y, 'REFERENCE'); txt('F3', 9, M + 168, y, 'DESCRIPTION'); rightT('F4', 9, RIGHT, y, 'AMOUNT'); y -= 5; hline(M, RIGHT, y); y -= 13; };
  const page = function(){ out.push(ops.join('\n')); ops = []; y = H - M; };
  const need = function(h){ if (y - h < M + 30){ page(); tableHead(); } };
  // header
  center('F3', 20, y - 8, str(S.title || 'STATEMENT')); y -= 26;
  if (S.periodLabel){ center('F2', 9.5, y, S.periodLabel, 0.4); y -= 16; } else y -= 6;
  // bill-to (left) + meta (right)
  const metaPairs = [['Closing Date:', str(S.closing || '')], ['Due Date:', str(S.closing || '')], ['Account #:', str(S.accountNo || '')]];
  let yL = y, yR = y;
  txt('F3', 10, M, yL, 'Bill To:'); yL -= 13;
  (S.billTo || []).slice(0, 5).forEach(function(ln){ txt('F2', 10.5, M, yL, ln); yL -= 13; });
  metaPairs.forEach(function(pr){ rightT('F1', 9.5, RIGHT - 92, yR, pr[0], 0.4); rightT('F1', 9.5, RIGHT, yR, pr[1]); yR -= 13; });
  y = Math.min(yL, yR) - 4;
  // remit band
  hline(M, RIGHT, y); y -= 13; txt('F3', 9, M, y, 'Remit To:'); txt('F2', 9, M + 52, y, str(S.remit || 'Ozark Cleaners')); y -= 7; hline(M, RIGHT, y); y -= 16;
  // table
  tableHead();
  (S.rows || []).slice(0, 400).forEach(function(r){
    if (r.sec){ need(18); txt('F3', 9.5, M, y, r.sec); y -= 14; return; }
    const lines = wrap(r.desc, 50);
    need(12 * lines.length + 2);
    txt('F1', 9.5, M, y, str(r.date)); txt('F1', 9.5, M + 56, y, str(r.ref)); txt('F1', 9.5, M + 168, y, lines[0]); rightT('F1', 9.5, RIGHT, y, money(r.amt)); y -= 12;
    lines.slice(1).forEach(function(ln){ need(12); txt('F1', 9.5, M + 168, y, ln); y -= 12; });
  });
  y -= 2; hline(M + 168, RIGHT, y); y -= 14;
  // summary (right column)
  need(70);
  const sumRows = [['Previous Balance:', S.prevBal], ['Total Payments:', -Math.abs(Number(S.totPay) || 0)], ['New Charges:', S.newChg]];
  sumRows.forEach(function(pr){ rightT('F1', 10, RIGHT - 100, y, pr[0], 0.25); rightT('F1', 10, RIGHT, y, money(pr[1])); y -= 14; });
  hline(RIGHT - 210, RIGHT, y + 4, 1.2); y -= 4;
  rightT('F4', 11.5, RIGHT - 100, y, 'BALANCE DUE:'); rightT('F4', 11.5, RIGHT, y, money(S.balDue)); y -= 22;
  // aging (current statements only)
  if (S.aging){
    need(44);
    hline(M, RIGHT, y + 10, 0.8);
    const stops = [M + 90, M + 190, M + 290, M + 390, RIGHT];
    const heads = ['CURRENT', '30 DAYS', '60 DAYS', '90 DAYS', 'BALANCE DUE'];
    heads.forEach(function(h, i){ rightT('F4', 8.5, stops[i], y, h); }); y -= 5; hline(M, RIGHT, y); y -= 13;
    const vals = [S.aging.current, S.aging.d30, S.aging.d60, S.aging.d90, S.balDue];
    vals.forEach(function(v, i){ rightT('F1', 9.5, stops[i], y, money(v)); }); y -= 20;
  }
  center('F2', 8, Math.max(y, M + 6), str(S.foot || 'Please remit payment to Ozark Cleaners. Thank you for your business!'), 0.35);
  page();
  return out;
}
function statementPdf(S){ return buildPdf(stmtPages(S)); }
function buildEmail(o){
  const nl = '\r\n';
  const html = o.html || '', text = o.text || htmlToText(html) || ' ';
  const atts = (o.attachments || []).filter(function(a){ return a && a.bytes && a.bytes.length; });
  const wrapB64 = function(b64){ return String(b64).replace(/(.{76})/g, '$1' + nl); };
  // ---- the message body as a self-contained MIME entity: {ctype, content} ----
  let bodyCtype, bodyContent;
  if (html) {
    const bnd = 'ozk_alt_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    bodyCtype = 'multipart/alternative; boundary="' + bnd + '"';
    bodyContent = '--' + bnd + nl + 'Content-Type: text/plain; charset=UTF-8' + nl + 'Content-Transfer-Encoding: base64' + nl + nl + b64wrap(text) + nl + nl
                + '--' + bnd + nl + 'Content-Type: text/html; charset=UTF-8'  + nl + 'Content-Transfer-Encoding: base64' + nl + nl + b64wrap(html) + nl + nl
                + '--' + bnd + '--' + nl;
  } else {
    bodyCtype = 'text/plain; charset=UTF-8';
    bodyContent = null;   // inlined below with its own CTE
  }
  // ---- top-level headers ----
  const fromHdr = o.fromName ? (mimeWord(o.fromName) + ' <' + o.user + '>') : o.user;
  const H = [];
  H.push('From: ' + fromHdr);
  H.push('To: ' + (o.to || []).join(', '));
  if ((o.cc || []).length) H.push('Cc: ' + o.cc.join(', '));
  if (o.replyTo) H.push('Reply-To: ' + o.replyTo);
  H.push('Subject: ' + mimeWord(o.subject || '(no subject)'));
  H.push('MIME-Version: 1.0');
  H.push('Date: ' + new Date().toUTCString());
  H.push('Message-ID: <' + Date.now() + '.' + Math.random().toString(36).slice(2) + '@ozarkcleaners.com>');
  let msg;
  if (atts.length) {
    const mix = 'ozk_mix_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    H.push('Content-Type: multipart/mixed; boundary="' + mix + '"');
    let parts = '';
    if (html) parts += '--' + mix + nl + 'Content-Type: ' + bodyCtype + nl + nl + bodyContent + nl;
    else      parts += '--' + mix + nl + 'Content-Type: ' + bodyCtype + nl + 'Content-Transfer-Encoding: base64' + nl + nl + b64wrap(text) + nl + nl;
    atts.forEach(function(a){
      const fn = String(a.filename || 'attachment').replace(/[\r\n"\\]/g, '').slice(0, 120);
      const ct = String(a.type || 'application/octet-stream').replace(/[\r\n"]/g, '');
      parts += '--' + mix + nl + 'Content-Type: ' + ct + '; name="' + fn + '"' + nl
             + 'Content-Transfer-Encoding: base64' + nl + 'Content-Disposition: attachment; filename="' + fn + '"' + nl + nl
             + wrapB64(a.bytes.toString('base64')) + nl + nl;
    });
    parts += '--' + mix + '--' + nl;
    msg = H.join(nl) + nl + nl + parts;
  } else if (html) {
    H.push('Content-Type: ' + bodyCtype);
    msg = H.join(nl) + nl + nl + bodyContent;
  } else {
    H.push('Content-Type: ' + bodyCtype);
    H.push('Content-Transfer-Encoding: base64');
    msg = H.join(nl) + nl + nl + b64wrap(text);
  }
  msg = msg.replace(/\r?\n/g, nl).replace(/\n\./g, '\n..');   // normalize CRLF + dot-stuff any line starting with '.'
  return msg + nl + '.' + nl;
}
/* minimal SMTP-over-TLS (implicit TLS, port 465) client — never rejects, always resolves {ok,error} */
function smtpGmail(o){
  return new Promise(function(resolve){
    const to = (o.to || []).filter(Boolean), cc = (o.cc || []).filter(Boolean), bcc = (o.bcc || []).filter(Boolean);
    const rcpts = to.concat(cc).concat(bcc);                                    // BCC = envelope recipient only (never a header — stays blind)
    if (!o.user || !o.pass)     return resolve({ ok:false, error:'email not configured' });
    if (!o.verify && !rcpts.length) return resolve({ ok:false, error:'no recipient' });
    const b64 = function(s){ return Buffer.from(String(s), 'utf8').toString('base64'); };
    const cmds = [
      { expect:220, send:'EHLO ozark-hub' },
      { expect:250, send:'AUTH LOGIN' },
      { expect:334, send:b64(o.user) },
      { expect:334, send:b64(o.pass) }
    ];
    if (o.verify) {
      cmds.push({ expect:235, send:'QUIT', done:true });                        // login succeeded (235) → done, NO email sent
    } else {
      cmds.push({ expect:235, send:'MAIL FROM:<' + o.user + '>' });
      rcpts.forEach(function(r){ cmds.push({ expect:250, send:'RCPT TO:<' + r + '>' }); });
      cmds.push({ expect:250, send:'DATA' });
      cmds.push({ expect:354, send: buildEmail(o), raw:true });
      cmds.push({ expect:250, send:'QUIT', done:true });
    }
    let sock = null, buf = '', stage = 0, settled = false;
    function finish(r){ if (settled) return; settled = true; try { if (sock){ try { sock.write('QUIT\r\n'); } catch(e){} sock.end(); } } catch(e){} resolve(r); }
    const HOST = o.host || smtpHost(), PORT = Number(o.port || GM.port || 465);
    try { sock = tls.connect({ host:HOST, port:PORT, servername:HOST }); }
    catch(e){ return resolve({ ok:false, error:'could not reach the mail server ' + HOST + ':' + PORT + ' — ' + e.message }); }
    sock.setEncoding('utf8');
    sock.setTimeout(30000, function(){ finish({ ok:false, error:'timed out talking to the mail server (' + HOST + ':' + PORT + ')' }); });
    sock.on('error', function(e){ finish({ ok:false, error:'connection: ' + (e && e.message || e) }); });
    sock.on('close', function(){ if (!settled) finish({ ok:false, error:'connection closed early' }); });
    sock.on('data', function(chunk){
      buf += chunk;
      let idx;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).replace(/\r$/, ''); buf = buf.slice(idx + 1);
        const m = /^(\d{3})(.?)/.exec(line);
        if (!m) continue;
        if (m[2] === '-') continue;                                  // continuation line of a multiline reply — wait for the final one
        const code = parseInt(m[1], 10), cmd = cmds[stage];
        if (settled) return;
        if (!cmd) { finish({ ok:true }); return; }
        if (code !== cmd.expect) { finish({ ok:false, error:'Mail server said: ' + line, code:code }); return; }
        try { sock.write(cmd.raw ? cmd.send : (cmd.send + '\r\n')); } catch(e){ finish({ ok:false, error:'write: ' + e.message }); return; }
        if (cmd.done) { finish({ ok:true }); return; }
        stage++;
      }
    });
  });
}
/* HTTPS mail relay — DigitalOcean blocks outbound SMTP from the droplet, so when these are set the hub
   POSTs each finished message to our tiny relay page on SiteGround (siteground-mail-relay.php), which is
   allowed to talk to mail.ozarkcleaners.com. Delete both env keys to go back to direct SMTP. */
const RELAY = { url: process.env.OZARK_MAIL_RELAY_URL || '', key: process.env.OZARK_MAIL_RELAY_KEY || '' };
function relayConfigured(){ return !!(RELAY.url && RELAY.key); }
function relayCall(payload){
  let u; try { u = new URL(RELAY.url); } catch(e){ return Promise.resolve({ ok:false, error:'bad relay URL on the hub' }); }
  return httpsJson('POST', u.hostname, (u.pathname || '/') + (u.search || ''), {}, payload).then(function(r){
    if (r.json) return r.json;
    return { ok:false, error:'relay not reachable (HTTP ' + r.status + (r.error ? ' · ' + r.error : '') + ') — is the SiteGround relay page up?' };
  });
}
function verifyEmail(){
  if (relayConfigured()) return relayCall({ key:RELAY.key, op:'verify', user:GM.user, pass:GM.pass });
  return smtpGmail({ user:GM.user, pass:GM.pass, host:GM.host, port:GM.port, verify:true });   // logs in + quits — sends NO message
}
function sendEmail(o){
  // owner copy: BCC the configured owner address on every send, unless this recipient IS that address (avoid a dupe)
  const toList = [].concat(o.to || []).map(x => String(x || '').toLowerCase());
  const ownerBcc = (GM.bcc && toList.indexOf(String(GM.bcc).toLowerCase()) < 0) ? [GM.bcc] : [];
  const bcc = (o.bcc ? [].concat(o.bcc) : []).concat(ownerBcc);
  if (relayConfigured()) {
    const msgFull = buildEmail({ user:GM.user, fromName:o.fromName || GM.fromName, to:[].concat(o.to || []), cc:[].concat(o.cc || []), subject:o.subject, html:o.html, text:o.text, replyTo:o.replyTo || GM.replyTo, attachments:o.attachments || [] });
    const msg = msgFull.endsWith('\r\n.\r\n') ? msgFull.slice(0, -5) : msgFull;   // relay adds its own SMTP end-of-message
    const rcpts = [].concat(o.to || []).concat([].concat(o.cc || [])).concat(bcc).filter(Boolean);
    return relayCall({ key:RELAY.key, op:'send', user:GM.user, pass:GM.pass, rcpts:rcpts, data:Buffer.from(msg, 'utf8').toString('base64') });
  }
  return smtpGmail({ user:GM.user, pass:GM.pass, fromName:o.fromName || GM.fromName, to:o.to, cc:o.cc, bcc:bcc, subject:o.subject, html:o.html, text:o.text, replyTo:o.replyTo || GM.replyTo, attachments:o.attachments || [] });
}
function escH(s){ return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
/* the "add your card on file" email — same one-time link the text sends */
function cardLinkEmailHtml(name, link){
  const L = escH(link);
  return '<div style="font-family:Arial,Helvetica,sans-serif;color:#222;font-size:15px;max-width:560px;margin:0 auto">'
    + '<p>Hello' + (name ? ' ' + escH(name) : '') + ',</p>'
    + '<p>You can securely put a card on file with <b>Ozark Cleaners and Laundry</b> using the button below. Your card goes straight into our card processor\'s secure page — <b>we never see or store your card number</b>, and <b>nothing is charged</b>.</p>'
    + '<p style="text-align:center;margin:24px 0"><a href="' + L + '" style="background:#2e7d32;color:#fff;text-decoration:none;padding:12px 22px;border-radius:6px;font-weight:bold;display:inline-block">Add my card on file</a></p>'
    + '<p style="color:#555;font-size:13px">Or paste this into your browser:<br><a href="' + L + '">' + L + '</a></p>'
    + '<p style="color:#555;font-size:13px"><b>This link expires in 2 hours</b> and can only be used once. If you didn\'t ask for this, just ignore this email.</p>'
    + '<p style="color:#555;font-size:12px;text-align:center;margin-top:22px">Ozark Cleaners and Laundry &middot; (870) 555-0032</p></div>';
}
function payConfigured(){ return { square: sqConfigured(), cardpointe: cpConfigured(), stripe: !!process.env.OZARK_STRIPE_SECRET, helcim: hcConfigured(), sms: smsConfigured(), email: emailConfigured() }; }
const PAYKEY = !!(sqConfigured() || cpConfigured() || process.env.OZARK_SQUARE_TOKEN || process.env.OZARK_STRIPE_SECRET || process.env.OZARK_HELCIM_TOKEN);
/* optional LAN access key: if OZARK_HUB_KEY is set, every /api/db and /api/pay request must send
   a matching x-ozark-key header — so a random device on the WiFi can't read or rewrite your data. */
const HUBKEY = process.env.OZARK_HUB_KEY || '';
if (!HUBKEY) console.log('⚠ OZARK_HUB_KEY is NOT set in hub.env — all key-gated endpoints (sync, SMS, email, payments) will REFUSE until a key is set. (Fail-closed on purpose: a missing key must never silently publish the customer DB.)');
/* 📏 ENDPOINT COPY RULES (2026-07-28 consolidation audit) — every NEW endpoint must follow all three, and
   they are exactly what a paste-from-the-wrong-neighbor forgets:
   1. Keyed? Gate FIRST: if(!reqKeyOk(req)){ send(res,401,{ok:false,error:keyErr()}); return; } — always
      keyErr(), never a bare 'unauthorized' (staff need to know if it's the SERVER's hub.env or the device).
   2. Reads a body? ALWAYS cap it: req.on('data', c => { body += c; if (body.length > CAP) req.destroy(); })
      — an uncapped reader is a memory DoS on the single process running the whole business's sync.
   3. Parses JSON? ALWAYS try/catch — one malformed request must never crash the hub. Public submit
      endpoints use trackRateOk (rate limit), not the key gate; Twilio webhooks are form-encoded + keyless. */
function reqKeyOk(req){
  if (!HUBKEY) return false;   // 🔒 fail CLOSED: no key configured => gated endpoints refuse. (Was fail-OPEN — a typo'd hub.env would have made the whole DB publicly readable with zero warning.)
  const got = Buffer.from(String(req.headers['x-ozark-key'] || ''), 'utf8');
  const want = Buffer.from(HUBKEY, 'utf8');
  if (got.length !== want.length) return false;
  try { return crypto.timingSafeEqual(got, want); } catch (e) { return false; }
}
function keyErr(){ return HUBKEY ? 'unauthorized — set the matching hub key on this device'
  : 'the HUB has no access key set — put OZARK_HUB_KEY in hub.env on the SERVER and restart (nothing is wrong with this device)'; }   // 🧭 blast-radius diagnostics: when hub.env loses the key, every station 401s at once — the message must point at the hub, not send staff fiddling with each device
/* public order-tracker helpers (no hub key — returns ONLY a matched customer's sanitized order data; rate-limited) */
var __trackHits={};
function trackRateOk(req){ var ip=String(req.headers['x-forwarded-for']||(req.socket&&req.socket.remoteAddress)||'?').split(',')[0].trim(); var now=Date.now(); var w=__trackHits[ip]; if(!w||now-w.t>60000){ __trackHits[ip]={t:now,n:1}; return true; } w.n++; return w.n<=20; }
function trackStatusLabel(s, atPlant){ if(s==='Received'||s==='Detailed') return 'Received - in line'; if(s==='In Process') return 'In process'; if(s==='Assembled') return atPlant?'Cleaned - heading to Hot Springs':'Cleaned - being bagged'; if(s==='Ready'||s==='Racked') return 'Ready for pickup'; if(s==='PickedUp') return 'Picked up'; if(s==='Split') return 'Being bagged'; return s; }   // Split shells are filtered out of the tracker; label kept as a belt-and-suspenders

/* tiny zero-dependency HTTPS JSON client (never rejects — always resolves a result) */
function httpsJson(method, host, reqPath, headers, bodyObj){
  return new Promise((resolve) => {
    const data = bodyObj ? JSON.stringify(bodyObj) : null;
    const opts = { method, host, path: reqPath, headers: Object.assign({ 'Content-Type':'application/json', 'Accept':'application/json' }, headers || {}) };
    if (data) opts.headers['Content-Length'] = Buffer.byteLength(data);
    const rq = https.request(opts, (resp) => { let buf=''; resp.on('data', d => buf += d); resp.on('end', () => { let j=null; try { j = JSON.parse(buf); } catch(e){} resolve({ status: resp.statusCode, json: j, raw: buf }); }); });
    rq.on('error', (e) => resolve({ status:0, json:null, error: e.message }));
    rq.setTimeout(20000, () => { rq.destroy(); resolve({ status:0, json:null, error:'timeout' }); });
    if (data) rq.write(data);
    rq.end();
  });
}
/* CardPointe Gateway helpers — https://developer.cardpointe.com/cardconnect-api */
function cpAuthHeader(){ return 'Basic ' + Buffer.from(CP.user + ':' + CP.pass).toString('base64'); }
function cpAmount(cents){ return (Math.round(Number(cents)||0) / 100).toFixed(2); }    // USD dollars string; confirm format in UAT
function cpLast4(masked){ return String(masked || '').replace(/\D/g,'').slice(-4); }
/* 💳🗒 EVERY CARD ATTEMPT, KEPT — hub-data/card-events.jsonl, append-only, outside the synced database.
   Owner, 2026-08-10: "fix the card brand and terminal logging."
   Asked whether Mastercards were failing to save, the honest answer was that the hub had NO RECORD of a card
   save even being attempted: /api/pay/* was never logged, so anything that failed at the reader — a cancel, a
   decryption failure, "terminal already in use", a timeout with no card tapped — died on the station that saw
   it. Twenty-one saved cards, no history of the attempts behind them. That is how a silent cancel became an
   hour of Mastercard theory.
   Now every attempt is recorded, success and failure, with the reason in the processor's own words.
   ⚠️ WHAT IS NEVER WRITTEN HERE: the token, the account number, the expiry, the CVV. Only the last four, the
   brand, the amount, the store, the station and the outcome. A permanent file is exactly the wrong place for
   anything that could stand in for a card. */
const CARDLOGFILE = path.join(DATADIR, 'card-events.jsonl');
function cardLog(action, dev, ctx, result, extra){
  try {
    const r = result || {};
    const last4 = String(r.last4 || (ctx && ctx.last4) || '').replace(/\D/g, '').slice(-4);
    const e = { ts: Date.now(), action: String(action || '').slice(0, 24), dev: String(dev || '').slice(0, 60),
      store: (ctx && ctx.store != null ? ctx.store : ''),
      amount: (extra && extra.amount != null) ? (Math.round(Number(extra.amount) || 0) / 100) : null,
      status: String(r.status || (r.ok === false ? 'error' : '') || '').slice(0, 16),
      message: String(r.message || r.error || '').slice(0, 200),
      brand: String(r.brand || '').slice(0, 20), last4: last4,
      ref: String(r.ref || r.retref || '').slice(0, 24),
      via: (extra && extra.via) ? String(extra.via).slice(0, 20) : '' };
    if (extra && extra.cid) e.cid = String(extra.cid).slice(0, 40);
    fs.appendFileSync(CARDLOGFILE, JSON.stringify(e) + '\n');
    /* the journal too, so `journalctl -u ozark-hub` shows the shop's card traffic without opening a file */
    if (e.status !== 'approved') {
      console.log('  💳 ' + e.action + ' ' + (e.status || '?') + '  ' + (e.brand || '') + (e.last4 ? ' ····' + e.last4 : '') +
        (e.amount != null ? '  $' + e.amount.toFixed(2) : '') + '  ' + (e.dev || '?') + '  ' + (e.message || ''));
    }
  } catch (err) {}
}
function cardLogRead(opts){
  opts = opts || {};
  const rows = [];
  const limit = Math.min(1000, Math.max(1, +opts.limit || 200));
  const since = +opts.since || 0;
  const wStat = String(opts.status || '').toLowerCase(), wLast4 = String(opts.last4 || '').replace(/\D/g, '');
  const wBrand = String(opts.brand || '').toLowerCase(), wDev = String(opts.dev || '').toLowerCase();
  try {
    if (!fs.existsSync(CARDLOGFILE)) return { rows: [], exists: false };
    const lines = fs.readFileSync(CARDLOGFILE, 'utf8').split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      const l = lines[i]; if (!l) continue;
      let r = null; try { r = JSON.parse(l); } catch (e) { continue; }
      if (since && (r.ts || 0) < since) break;
      if (wStat && String(r.status || '').toLowerCase() !== wStat) continue;
      if (wLast4 && String(r.last4 || '') !== wLast4) continue;
      if (wBrand && String(r.brand || '').toLowerCase().indexOf(wBrand) < 0) continue;
      if (wDev && String(r.dev || '').toLowerCase().indexOf(wDev) < 0) continue;
      rows.push(r);
      if (rows.length >= limit) return { rows: rows, exists: true, truncated: true };
    }
  } catch (e) { return { rows: rows, exists: true, error: e.message }; }
  return { rows: rows, exists: true, truncated: false };
}
/* 💳 WHICH CARD IS IT? Owner, 2026-08-10: "brittany says that mastercards still will not save." All 21 saved
   cards said the same thing — "Card" — so the claim could not be checked against the data at all, and an hour
   went into a Mastercard theory for a charge the app had cancelled itself.
   The cause was one missing request field. cpNormalize already reads j.binInfo, but CardConnect only RETURNS
   binInfo when the request asks with bin:'y', which nothing ever did — so the brand fell back to the literal
   word "Card", forever.
   Two sources, most trustworthy first:
     · binInfo, when the processor sends it back;
     · the BIN itself — the first digits of the card, which the networks assign and never share. This is the
       classic table and it needs no extra call, so it also works for the terminal reads where binInfo is absent.
   ⚠️ NEVER derived from the token: a CardConnect token is a random number that only preserves the last four
   digits, so its leading digit means nothing. Assuming otherwise would label cards confidently and wrongly,
   which is worse than "Card". */
function cpBrandOf(j){
  try {
    const bi = j && j.binInfo;
    if (bi) {
      const named = String(bi.brand || bi.cardtype || bi.network || '').trim();
      if (named) return named.replace(/\b\w/g, c => c.toUpperCase());
    }
    /* the BIN ranges. bin comes back as binInfo.bin / binlo, or the first digits of a real account number. */
    let bin = String((bi && (bi.bin || bi.binlo)) || '').replace(/\D/g, '');
    if (!bin && j && j.account && /^\d{6}/.test(String(j.account))) bin = String(j.account).replace(/\D/g, '');
    if (bin) {
      const d1 = bin[0], d2 = bin.slice(0, 2), d4 = bin.slice(0, 4);
      if (d1 === '4') return 'Visa';
      if (['51','52','53','54','55'].indexOf(d2) >= 0) return 'Mastercard';
      if (+d4 >= 2221 && +d4 <= 2720) return 'Mastercard';            /* the 2-series Mastercard range */
      if (['34','37'].indexOf(d2) >= 0) return 'Amex';
      if (d4 === '6011' || d2 === '65' || (+bin.slice(0,3) >= 644 && +bin.slice(0,3) <= 649)) return 'Discover';
      if (['36','38','39'].indexOf(d2) >= 0) return 'Diners';
      if (d2 === '35') return 'JCB';
    }
  } catch (e) {}
  return 'Card';
}
function cpNormalize(j){
  if (!j) return { status:'error', message:'No/blank response from CardPointe' };
  const stat = j.respstat;                                   // A=approved, B=retry, C=declined
  return {
    status: stat === 'A' ? 'approved' : (stat === 'C' ? 'declined' : 'error'),
    ref:   j.retref || '',
    auth:  j.authcode || '',
    last4: cpLast4(j.account),
    brand: cpBrandOf(j),
    bin:   (j.binInfo && (j.binInfo.bin || j.binInfo.binlo)) || '',
    token: j.token || j.account || '',
    message: j.resptext || (j.respcode ? ('code ' + j.respcode) : '')
  };
}
/* auth + capture in one step, charging a CardSecure token */
/* 🔑 IDEMPOTENCY 🔑S \u2014 a charge is defined by its INTENT, not by the moment it was attempted.
   `dupChargeOK` asks "did we charge this customer this amount recently?" That is a HEURISTIC and it fails in
   both directions: it blocked nothing at 11 minutes 16 seconds (why the window was widened 10 \u2192 180 minutes),
   and a 180-minute window will one day block a customer who legitimately comes back the same afternoon for the
   same amount. Stripe's answer is a deterministic key, and Brandur's write-up is the pattern this follows.
   THE 🔑 COMES FROM THE INTENT: order+amount+purpose for a pickup, customer+YYYY-MM+"monthly" for the cycle.
   Same intent \u2192 same key \u2192 provably one charge, with no clock involved at all. **That is what would have
   stopped the Enderby double charge** \u2014 two authorisations 44 seconds apart, both for the same monthly cycle,
   which under a monthly key are the same intent and the second is simply the first one's answer replayed.
   ⚠️ THE NON-NEGOTIABLE RULE: record the key and do the work together. If they are separate there is a window
   where the charge commits and the key does not, and the whole guarantee evaporates. Node is single-threaded,
   so the key is written synchronously BEFORE the foreign call and completed after it \u2014 the gap that remains is
   the process dying mid-authorisation, and that case is handled by REFUSING rather than guessing (see below).
   ⚠️ A 🔑 THAT STARTED AND NEVER FINISHED IS NOT AN INVITATION TO RETRY. We genuinely do not know whether the
   processor took the money. Charging again to find out is the exact mistake this exists to prevent, so it stops
   and names the card log. A human resolves it; nobody gets charged twice by a machine that guessed.
   dupChargeOK stays as the SECOND line of defence \u2014 it has already earned its place, and it catches the case
   where two different intents genuinely collide. */
const IDEMFILE = path.join(DATADIR, 'idempotency.jsonl');
const IDEM_INFLIGHT_MS = 120000;          /* longer than any authorisation takes */
let IDEM = null;
function idemLoad(){
  if (IDEM) return IDEM;
  IDEM = Object.create(null);
  try {
    const txt = fs.readFileSync(IDEMFILE, 'utf8');
    for (const ln of txt.split('\n')) {
      const t = ln.trim(); if (!t) continue;
      try { const o = JSON.parse(t); if (o && o.key) IDEM[o.key] = o; } catch (e) {}   /* last line for a key wins */
    }
  } catch (e) {}
  return IDEM;
}
function idemWrite(rec){
  idemLoad()[rec.key] = rec;
  try { fs.appendFileSync(IDEMFILE, JSON.stringify(rec) + '\n'); } catch (e) {
    console.log('  \u26a0 idempotency record could not be written: ' + e.message);
    throw e;                            /* ⚠️ if we cannot record the key we must not do the work */
  }
}
function idemCheck(key, meta){
  const cur = idemLoad()[key];
  if (cur && cur.state === 'finished') return { replay: cur.result };
  if (cur && cur.state === 'started') {
    const age = Date.now() - (+cur.ts || 0);
    if (age < IDEM_INFLIGHT_MS) return { refuse: 'That exact charge is already going through right now. Wait a moment rather than sending it again \u2014 nothing is lost.' };
    return { refuse: 'A charge with this same intent was started ' + Math.round(age/60000) + ' minutes ago and never finished, so we do not know whether the card was charged. ' +
      'Check the card log (Admin \u2192 card events) or the processor before trying again \u2014 retrying blind is how a customer gets charged twice.' };
  }
  idemWrite({ key: key, state: 'started', ts: Date.now(), amount: (meta && meta.amount) || 0, cid: (meta && meta.cid) || '' });
  return { go: true };
}
function idemFinish(key, result){
  try { idemWrite({ key: key, state: 'finished', ts: Date.now(), result: result }); } catch (e) {}
}
function cpAuthCapture(token, amountCents, opts){
  opts = opts || {};
  /* 🔑 the ONE place money actually moves, so the one place the key is honoured. A $0 verification
     (capture:'N') is deliberately exempt — it takes nothing, and keying it would block a legitimate re-test
     of the same card. */
  const _idem = String(opts.idem || '').trim();
  if (_idem && opts.capture !== 'N') {
    const g = idemCheck(_idem, { amount: amountCents, cid: opts.cid || '' });
    if (g.replay) {
      console.log('  🔑 idempotent replay for ' + _idem + ' — returning the first answer, charging nothing');
      return Promise.resolve(Object.assign({}, g.replay, { idempotentReplay: true }));
    }
    if (g.refuse) {
      console.log('  🔑 REFUSED ' + _idem + ' — ' + g.refuse.slice(0, 90));
      return Promise.resolve({ status: 'error', message: g.refuse, idempotentRefusal: true });
    }
  }
  const cp = cpForStore(opts.store);
  const body = { merchid: cp.mid, account: token, amount: cpAmount(amountCents), currency: 'USD', capture: (opts.capture === 'N' ? 'N' : 'Y'),
    ecomind: opts.ecomind || 'E',
    bin: 'y' };   /* 💳 ask for binInfo — without this the brand is unknowable and every card reads "Card" */                       // E = card-not-present (iFrame/online) — required by the Visa/MC Stored-Credential mandate; capture:'N' = auth-only (e.g. a $0 CVV verification when saving a card)
  const _exp = String(opts.expiry == null ? '' : opts.expiry).replace(/\D/g,'').slice(0,4);   // MMYY — strip any slash/space ("03/28" -> "0328")
  if (_exp) body.expiry = _exp;
  // 🛑 FAIL LOUDLY, NOT CONFUSINGLY. Charging a tokenized PAN REQUIRES an expiry. The old code just omitted the
  //    field when we had none, so CardConnect answered "Non-numeric expiry" — which reads like the customer's card
  //    is bad when the truth is WE never sent it. That mislabel cost three separate debugging sessions. A $0
  //    auth-only verify (capture:'N') legitimately needs no expiry, so it stays exempt.
  else if (opts.capture !== 'N') {
    console.log('  ⚠ refusing to charge token ...' + String(token).slice(-4) + ' with NO expiry (would return "Non-numeric expiry")');
    return Promise.resolve({ status:'error', message:'No card expiry available for this saved card — re-save the card on the terminal (Customer → 💳 card → re-add). Nothing was charged.' });
  }
  if (opts.cvv2)    body.cvv2    = opts.cvv2;
  if (_idem) opts.__idemKey = _idem;   /* 🔑 carried to the response handler below */
  if (opts.name)    body.name    = opts.name;
  if (opts.address) body.address = opts.address;
  if (opts.city)    body.city    = opts.city;
  if (opts.region)  body.region  = opts.region;
  if (opts.postal)  body.postal  = opts.postal;            // AVS (street# + zip) = best practice + better rates
  if (opts.cof)   { body.cof = opts.cof; body.cofscheduled = opts.cofscheduled || 'N'; }   // stored-credential framework when reusing a saved card
  return httpsJson('PUT', cpHostOf(cp), '/cardconnect/rest/auth', { 'Authorization': cpAuthHeaderOf(cp) }, body
  ).then(r => r.json ? cpNormalize(r.json) : { status:'error', message:'CardPointe HTTP ' + r.status + (r.error ? ' · ' + r.error : '') })
   .then(function(result){
     /* 🔑 record the ANSWER against the key, so a retry replays it instead of charging again. Recorded for
        a decline too — a decline is a real answer to that intent, and re-sending it would just annoy the
        processor and the customer. Only an ERROR (we never got an answer) is left un-finished, because in that
        case we genuinely do not know and a human must look. */
     try {
       if (_idem && opts.capture !== 'N' && result && (result.status === 'approved' || result.status === 'declined')) {
         idemFinish(_idem, result);
       }
     } catch (e) {}
     return result;
   });
}
/* void / refund / inquire — route to the same store's MID the original ran under */
function cpVoid(retref, store){ const cp=cpForStore(store); return httpsJson('PUT', cpHostOf(cp), '/cardconnect/rest/void', { 'Authorization': cpAuthHeaderOf(cp) }, { merchid: cp.mid, retref }).then(r => r.json || { status:'error' }); }
/* 🔍 Card-on-file verification with an issuer fallback. Try the $0 account-verification first; some issuing
   banks refuse card-not-present $0 checks outright (resptext mentions "3DS"/"secure" — seen live on a
   Mastercard at Hot Springs, 2026-07-23). The classic network-sanctioned fallback: a $1 AUTH-ONLY
   (capture:'N' — never captured, never settles) + an immediate VOID. Proves the card is real; at most the
   customer sees a pending $1 that drops off. Returns the approval (with .via='$1-auth-void' when the
   fallback ran) or the more informative of the two declines. Used by BOTH the counter save flow (action
   'verify') and the card-by-text link, so one fix covers every save path. */
function cpVerifyCard(token, store, expiry, extraOpts){
  const opts = Object.assign({}, extraOpts || {}, { store: store, capture: 'N', expiry: expiry });   // extra = cvv2/cof/cofscheduled/name/postal etc. — pass through so the CVV check + stored-credential initiation still happen
  opts.ecomind = opts.ecomind || 'E';
  const vlog = function(step, r){ try { console.log('[verify] store=' + (store||'-') + ' ' + step + ' → ' + (r.status||'?') + (r.message ? ' · ' + r.message : '')); } catch (e) {} };   // journalctl visibility — resptext only, never the token
  return cpAuthCapture(token, 0, opts).then(function (r0) {
    vlog('$0 check', r0);
    if (r0.status === 'approved') return r0;
    return cpAuthCapture(token, 100, opts).then(function (r1) {
      vlog('$1 fallback', r1);
      if (r1.status !== 'approved') { if (!r1.message && r0.message) r1.message = r0.message; return r1; }
      const done = function(){ const out = Object.assign({}, r1); out.via = '$1-auth-void'; return out; };
      if (!r1.ref) return done();
      return cpVoid(r1.ref, store).then(done, done);   // best-effort — an uncaptured $1 auth expires on its own regardless
    });
  });
}
function cpRefund(retref, amountCents, store){ const cp=cpForStore(store); return httpsJson('PUT', cpHostOf(cp), '/cardconnect/rest/refund', { 'Authorization': cpAuthHeaderOf(cp) }, { merchid: cp.mid, retref, amount: cpAmount(amountCents) }).then(r => r.json || { status:'error' }); }
function cpInquire(retref, store){ const cp=cpForStore(store); return httpsJson('GET', cpHostOf(cp), '/cardconnect/rest/inquire/' + encodeURIComponent(retref) + '/' + encodeURIComponent(cp.mid), { 'Authorization': cpAuthHeaderOf(cp) }, null).then(r => r.json || { status:'error' }); }

/* Square API helpers — https://developer.squareup.com (Payments / Refunds / Payment Links). Amounts are in CENTS. */
function sqIdem(){ return 'ozk-' + Date.now() + '-' + Math.random().toString(36).slice(2,10); }
function sqHeaders(){ return { 'Authorization': 'Bearer ' + SQ.token, 'Square-Version': '2026-05-20' }; }   // current Square API version (verified 2026); raise as Square releases newer ones
function sqMoney(cents){ return { amount: Math.round(Number(cents)||0), currency: 'USD' }; }
function sqErr(r){ return 'Square HTTP ' + r.status + ((r.json && r.json.errors && r.json.errors[0] && r.json.errors[0].detail) ? ' · ' + r.json.errors[0].detail : (r.error ? ' · ' + r.error : '')); }
function sqNormPayment(p){ if(!p) return { status:'error', message:'No Square payment in response' };
  var st = (p.status==='COMPLETED'||p.status==='APPROVED') ? 'approved' : (p.status==='FAILED'||p.status==='CANCELED' ? 'declined' : 'error');
  var cd = (p.card_details && p.card_details.card) || {};
  return { status: st, ref: p.id||'', auth: p.id||'', last4: cd.last_4||'', brand: cd.card_brand||'Card', token: p.id||'', message: p.status||'' };
}
function sqPost(path, body){ return httpsJson('POST', sqHost(), path, sqHeaders(), body); }
/* charge a Square source_id (Web Payments nonce, saved-card id, or Terminal-captured token) */
function sqCharge(sourceId, amountCents){
  return sqPost('/v2/payments', { idempotency_key: sqIdem(), source_id: sourceId, amount_money: sqMoney(amountCents), location_id: SQ.location, autocomplete: true })
    .then(r => (r.json && r.json.payment) ? sqNormPayment(r.json.payment) : { status:'error', message: sqErr(r) });
}
/* refund ONLY against the original payment id */
function sqRefund(paymentId, amountCents){
  return sqPost('/v2/refunds', { idempotency_key: sqIdem(), payment_id: paymentId, amount_money: sqMoney(amountCents) })
    .then(r => { const rf = r.json && r.json.refund; if (rf) return { status: (rf.status==='COMPLETED'||rf.status==='PENDING') ? 'approved' : 'error', ref: rf.id||'', message: rf.status||'' }; return { status:'error', message: sqErr(r) }; });
}
/* hosted payment link (text-a-link) */
function sqPaymentLink(amountCents){
  return sqPost('/v2/online-checkout/payment-links', { idempotency_key: sqIdem(), quick_pay: { name: 'Ozark Cleaners order', price_money: sqMoney(amountCents), location_id: SQ.location } })
    .then(r => { const pl = r.json && r.json.payment_link; if (pl && pl.url) return { status:'ok', url: pl.url, ref: pl.id||'' }; return { status:'error', message: sqErr(r) }; });
}

/* Helcim API v2 — https://devdocs.helcim.com (purchase / refund; amounts in DOLLARS). API token is the SECRET (hub only). */
const HC = { token: process.env.OZARK_HELCIM_TOKEN || '' };
function hcConfigured(){ return !!HC.token; }
function hcDollars(cents){ return Math.round(Number(cents)||0) / 100; }
function hcLast4(masked){ return String(masked||'').replace(/\D/g,'').slice(-4); }
function hcNorm(j){ if(!j) return { status:'error', message:'No Helcim response' };
  const st = String(j.status||'').toUpperCase();
  return { status: st==='APPROVED' ? 'approved' : (st==='DECLINED' ? 'declined' : 'error'),
    ref: String(j.transactionId||''), auth: String(j.approvalCode||j.transactionId||''),
    last4: hcLast4(j.cardNumber), brand: j.cardType||'Card', token: j.cardToken||'', message: j.status || (j.errors ? JSON.stringify(j.errors) : '') };
}
function hcPost(path, body){ return httpsJson('POST', 'api.helcim.com', path, { 'api-token': HC.token }, body); }
function hcPurchase(cardToken, amountCents){ return hcPost('/v2/payment/purchase', { paymentType:'purchase', amount: hcDollars(amountCents), currency:'USD', cardData:{ cardToken: cardToken } }).then(r => r.json ? hcNorm(r.json) : { status:'error', message:'Helcim HTTP ' + r.status + (r.error?' · '+r.error:'') }); }
function hcRefund(originalTxn, amountCents){ return hcPost('/v2/payment/refund', { amount: hcDollars(amountCents), currency:'USD', originalTransactionId: originalTxn }).then(r => r.json ? hcNorm(r.json) : { status:'error', message:'Helcim HTTP ' + r.status + (r.error?' · '+r.error:'') }); }

/* merge KEY=VALUE updates into hub.env (preserves other lines/comments). Used by the owners-only Integrations panel. */
function writeHubEnv(updates){
  try {
    const ep = path.join(__dirname, 'hub.env');
    let lines = fs.existsSync(ep) ? fs.readFileSync(ep, 'utf8').split(/\r?\n/) : [];
    Object.keys(updates).forEach(function(k){
      const v = updates[k]; if (v === undefined || v === null || v === '') return;
      const re = new RegExp('^\\s*' + k + '\\s*=');
      let found = false;
      for (let i=0;i<lines.length;i++){ if (re.test(lines[i]) && !/^\s*#/.test(lines[i])) { lines[i] = k + '=' + v; found = true; break; } }
      if (!found) lines.push(k + '=' + v);
    });
    let text = lines.join('\n'); if (!text.endsWith('\n')) text += '\n';   // always end with a newline — a later append must never glue onto the last key
    const tmp = ep + '.tmp'; fs.writeFileSync(tmp, text); fs.renameSync(tmp, ep);
    return true;
  } catch (e) { return false; }
}

for (const d of [DATADIR, BACKUPS]) { try { fs.mkdirSync(d, { recursive: true }); } catch (e) {} }

let rev = 0, savedAt = 0;
const started = Date.now();
const seen = new Map();                              // device -> last-seen time (rough "who's connected")

/* ---- load any existing data so a restart doesn't lose anything ---- */
function looksLikeDB(o){ return o && o.settings && Array.isArray(o.orders) && Array.isArray(o.customers) && Array.isArray(o.prices); }
/* Server-side safety net: a stale device (older app build) can merge + push its throwaway demo seed back,
   re-doubling the price book and resurrecting demo customers. Strip that on EVERY save, regardless of device code. */
function sanitizeDB(o){
  try {
    if (Array.isArray(o.prices)) { const seen={}, out=[]; for (const p of o.prices){ const k=((p&&p.name)||(p&&p.item)||'')+'|'+((p&&(p.cat||p.category||p.type))||''); if(seen[k]) continue; seen[k]=1; out.push(p); } o.prices=out; }
    if (Array.isArray(o.upcharges)) { const m={}; for (const u of o.upcharges){ const k=((u&&u.name)||'')+'|'+((u&&u.level)||''); if(!m[k] || (Number(u&&u.amount)||0)>(Number(m[k].amount)||0)) m[k]=u; } o.upcharges=Object.keys(m).map(function(k){return m[k];}); }   // de-dupe upcharges by name|level, keeping the HIGHER amount (never silently lowers a charge)
    if (Array.isArray(o.customers)) { o.customers = o.customers.filter(c=>{ const ph=String((c&&c.phone)||'').replace(/\D/g,''); return !/^\d{3}555\d{4}$/.test(ph); }); }   // drop fake NXX-555-xxxx demo customers (Jane Doe, Bob Allen, etc.)
  } catch(e) {}
  return o;
}
let META = { rev: 0, savedAt: 0 };
try {
  if (fs.existsSync(DBFILE)) {
    const raw = JSON.parse(fs.readFileSync(DBFILE, 'utf8'));
    if (raw && raw.__meta && looksLikeDB(raw.db)) { META = raw.__meta; rev = META.rev||0; savedAt = META.savedAt||0; }
  }
} catch (e) { console.log('  (could not read existing data — starting fresh):', e.message); }

/* ---- helpers ---- */
/* 🔄 FORCE EVERY STATION TO UPDATE — the answer to "why can't we force the refresh?"
   The honest constraint first: a remote reload can only be obeyed by code already running on that station, so
   it cannot rescue a build that predates it. What it does is make sure this is the LAST time that is true.
   Why a timestamp and not a flag: a station reloads when reloadAt is NEWER THAN THE MOMENT ITS PAGE LOADED.
   That comparison is self-limiting — once the page reloads, its load time is newer than reloadAt, so it can
   never loop, no matter how many times the value is read or how long it persists.
   Served on /api/health, which every station already polls every 4 seconds and which needs no key (it is a
   bare timestamp). SETTING it is hub-key gated. Kept in its own tiny file, never in the synced DB, so a
   station on an old build cannot overwrite it. */
const RELOADFILE = path.join(DATADIR, 'reload-request.json');
let RELOAD = { at: 0, by: '', note: '' };
try { if (fs.existsSync(RELOADFILE)) { const rr = JSON.parse(fs.readFileSync(RELOADFILE, 'utf8')); if (rr && rr.at) RELOAD = rr; } } catch (e) {}
function saveReload(){ try { writeAtomic(RELOADFILE, JSON.stringify(RELOAD)); } catch (e) {} }

/* ══ 🛠 REMOTE STATION SETTINGS — storage ═══════════════════════════════════════════════════════════════
   ⚠️ THE WHITELIST IS THE WHOLE SECURITY MODEL. A key that is not in here cannot be set from the hub, full
   stop. Note what is deliberately ABSENT and must stay absent:
     · hubUrl  — repointing a station at another hub hands over the entire shop on the next sync
     · hubKey  — never written back out, never settable
     · anything that names a file or a command to run
   The owner picked "settings only" over a general command channel knowing the trade: this cannot fix a
   problem nobody anticipated, and in exchange a leaked hub key cannot run code on a machine that takes cards.
   ⚠️ `locked` IS DELIBERATELY NOT HERE YET. The owner asked whether a station could be locked, and the
   answer is yes — but a lock is the one setting that can take a till out of service, so it needs a rule this
   channel does not have yet: a station must NEVER be bricked by a flag it cannot clear when the hub is
   unreachable. Shipping the word without that rule would advertise a lock that either does nothing or
   strands a counter. It gets built deliberately, with a local owner-PIN override, or not at all. */
const STATION_SETTABLE = { stationId:1, stationName:1, storeScope:1, printAgent:1, printers:1,
                           snapshotEveryHours:1, healthEverySec:1 };
const STATIONCFGFILE = path.join(DATADIR, 'station-config.json');
const STATIONCFGLOG  = path.join(DATADIR, 'station-config-log.jsonl');
let STATION_CFG_AT = 0;     /* published on /api/health so a station knows to look, without polling a second endpoint */
function readStationConfig(){
  try { return JSON.parse(fs.readFileSync(STATIONCFGFILE, 'utf8')) || {}; } catch (e) { return {}; }
}
function writeStationConfig(all, entry){
  try { writeAtomic(STATIONCFGFILE, JSON.stringify(all, null, 2)); } catch (e) {}
  STATION_CFG_AT = Date.now();
  /* ⚠️ APPEND-ONLY, NEVER REWRITTEN. "Who changed this station and when" is exactly the question asked after
     something goes wrong, and it is worthless if the answer can be edited. Same shape as the delta log. */
  try { fs.appendFileSync(STATIONCFGLOG, JSON.stringify(Object.assign({ at: Date.now() }, entry)) + '\n'); } catch (e) {}
}
(function initStationCfgAt(){ try { STATION_CFG_AT = fs.statSync(STATIONCFGFILE).mtimeMs || 0; } catch (e) { STATION_CFG_AT = 0; } })();

/* 🔎 CODE INTEGRITY — the hub knows what it served, so it can tell when a station is running something else.
   Owner: "if code were to be altered at any station, it would be recognized by the hub and logged, at least".
   Yes — the shell reports the SHA of the app file it is actually serving, and the hub compares it with the
   SHA of what it handed out. That catches a corrupted cache, a half-finished download, and casual tampering.
   ⚠️ AND IT IS NOT A SECURITY BOUNDARY, WHICH MATTERS MORE THAN THE FEATURE. Anyone who can edit the cached
   HTML on that machine can also edit the shell that reports the hash. Integrity checked by the thing being
   checked is an audit trail, not a lock. The real boundary is the Windows account, the Chrome policy lock and
   physical access to the machine. Say that plainly rather than let a green tick imply more than it proves.
   ⚠️ The response to a mismatch is to REPAIR (re-fetch the hub's copy), not to deny service. Locking a till
   because a hash looked wrong would take a counter down mid-customer on the strength of a guess, and this
   codebase has paid for crying wolf three times already. */
let CODE_SEEN = {};   /* stationId -> { sha, at, ok } — memory only; the log is the durable record */
/* 🛣 The collections the hub keys, at MODULE scope. seqStamp, deltaSince and hubMerge must all agree on this
   list or a delta could omit a collection the merge knows about — so there is one copy and everything reads it. */
const HUB_KEYS_FOR_SEQ = { prices:'id', upcharges:'id', employees:'id', customers:'id', orders:'id', payments:'id',
  ledger:'id', timeclock:'id', timeAcks:'id', timeOff:'id', routeLog:'id', checklist:'id', supplies:'id',
  devices:'id', voidRequests:'id', refundRequests:'id', batches:'id', collections:'id', supplyOrders:'id',
  garments:'hsl' };
const HUB_MAPS_FOR_SEQ = ['drawers','checklistDone'];
/* ============================ 🛣 PHASE 1 — THE HUB SERVES DELTAS ============================
   Owner: "all of the data is historical and only the delta is synced… the hub is a system of highways, not a
   data storage center."

   Every station already holds the whole business locally, and the merge is already per-record and idempotent:
   highest _t wins, ORDERS obey the one-way STATUS_RANK law, and a record missing from a payload is KEPT because
   absence is never a delete. That merge never needed a whole snapshot — it just happened to be handed one. So a
   delta is safe to apply under exactly the rules already in force, which is why this is a change and not a
   rewrite.

   ⚠️ WHY _seq AND NOT _t. _t is a DEVICE clock, and this system has the scar: on 8/03 one station stamped every
   record with a bad time and rolled 24 orders back. Worse, we now know 96% of records carry millisecond-scale
   stamps and 4% carry hybrid ones (see STAMP-SCALE) — so _t is not even a single number line. If a station's
   "since" marker were a _t, a fast clock or the wrong scale would make it skip records SILENTLY. _seq is
   assigned by the hub, which is the one thing every station agrees on, and it is the hub's own rev — already
   monotonic, already persisted, already the optimistic-lock token.
   _t keeps its job (deciding who wins a merge). _seq only ever answers "what changed since?".

   ⚠️ A record with no _seq is treated as 0, so it only ever ships in a FULL pull. That is correct: a station
   asking since>0 has already been given everything that old. */
/* ⚠️ THE HUB IS THE REFEREE ON TIME, NOT THE CLOCK. Owner, 2026-08-11: "let the hub control the timestamps,
   right?" Half right, and the half that is wrong matters.
   The hub ALREADY owns the number that answers "what changed since" (_seq, assigned here). It must NOT own _t,
   which answers "who wins when two stations edited the same record" — because that needs the order the edits
   were MADE and the hub can only see the order they ARRIVED. Those differ exactly when it counts: the driver
   edits an order at 10:00 on a weak signal, the counter edits it at 10:05 online, the counter's arrives first,
   and hers lands at 10:30. Stamp on arrival and her OLDER edit overwrites the NEWER one — the 8/03 rollback
   again, from the other direction. Offline work is load-bearing here (route phone, hub blips), so arrival-order
   stamping breaks the very case the design exists to serve.
   What the hub CAN do is refuse the impossible. On 8/03 one station stamped every record with a bad time and
   won every merge; worse, the app's hlcObserve is built to absorb the highest stamp it sees, so a single wrong
   clock did not just win its own merges — it dragged every other station's clock forward with it, permanently.
   There was no check of any kind on an incoming _t until now.
   A record cannot have been edited in the future. Anything beyond a few minutes of honest clock skew is clamped
   to now and reported. Clamped, not rejected: the employee's work is real and must survive — it is only the
   claim about WHEN that is false, and the claim is the part that poisons every future merge. */
/* 📸 IMAGE BYTES MUST NEVER ENTER THE SYNCED DATABASE \u2014 enforced, not merely intended.
   The architecture is already right: a photo is uploaded to POST /api/photo, stored as a FILE under
   hub-data/photos, and only its ID goes on the piece. Today exactly one code path in the app touches
   `line.photos` and it pushes an id only after the upload succeeds, and the live database contains zero inline
   images. So this guard is not fixing a bug \u2014 it is making a rule that currently holds by good behaviour hold
   by construction instead.
   WHY IT MATTERS MORE THAN IT LOOKS: photos are first on the roadmap. One photo per piece at ~150 KB is roughly
   8 GB a year. If bytes ever ride inside the synced DB, EVERY station downloads all of them forever, and it
   becomes a gigabyte-scale migration rather than a policy.
   ⚠️ IT CONVERTS RATHER THAN REJECTING OR DISCARDING. Rejecting the push would strand a station mid-shift;
   dropping the photo would silently lose a customer's damage evidence. Writing the bytes to a file and leaving
   the reference behind is the outcome the station was trying to achieve anyway \u2014 so an old or broken build gets
   fixed up at the door instead of poisoning the shared database. */
/* 🧩 SHAPE GUARD — a record missing a list it is REQUIRED to have gets that list, at the door.
   ⚠️ Written after a live outage on 2026-08-13: the counter could not use the Detail screen at all, because six
   orders had no `lines` array. renderDetail reads `o.lines.length`, so it threw the moment anybody opened one.
   The cause was a REPAIR SCRIPT that built its order objects by hand and never set it; every creation path inside
   the app does. Nothing in the app was wrong, and no gate could see it — the fault existed only in real records.
   ⚠️ 176 places in the app read one of these lists without a guard. Guarding all 176 would be treating the
   symptom, and each guard is a place to forget one later. The shape is made IMPOSSIBLE here instead — the same
   choice blobGuard makes for image bytes: convert at the door, never reject, because rejecting a push would
   strand a station mid-shift over a field it can no longer supply.
   It ADDS an empty list and never touches one that exists, so it can never erase work. */
const SHAPE = { orders: ['lines'], customers: ['cards', 'phones'] };
function shapeGuard(inc){
  const fixed = [];
  try {
    for (const coll of Object.keys(SHAPE)) {
      const arr = inc && inc[coll];
      if (!Array.isArray(arr)) continue;
      for (const rec of arr) {
        if (!rec || typeof rec !== 'object') continue;
        for (const f of SHAPE[coll]) {
          if (Array.isArray(rec[f])) continue;
          if (rec[f] != null) continue;          /* something non-array is there: leave it, a human should look */
          rec[f] = [];
          fixed.push(coll + ':' + (rec.number || rec.id || '?') + '.' + f);
        }
      }
    }
  } catch (e) {}
  return fixed;
}
function blobGuard(inc){
  const moved = [];
  try {
    const arr = inc && inc.orders; if (!Array.isArray(arr)) return moved;
    for (const o of arr) {
      if (!o || !Array.isArray(o.lines)) continue;
      for (const l of o.lines) {
        if (!l || !Array.isArray(l.photos)) continue;
        for (let i = 0; i < l.photos.length; i++) {
          const v = l.photos[i];
          if (typeof v !== 'string' || v.indexOf('data:') !== 0) continue;
          const m = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(v);
          if (!m) { l.photos.splice(i, 1); i--; moved.push((o.number || o.id) + ' (unreadable inline photo dropped)'); continue; }
          try {
            const buf = Buffer.from(m[2], 'base64');
            const sha = require('crypto').createHash('sha256').update(buf).digest('hex').slice(0, 32);
            const id = sha + (m[1] === 'image/png' ? '.png' : '.jpg');
            fs.mkdirSync(PHOTODIR, { recursive: true });
            const dest = path.join(PHOTODIR, id);
            if (!fs.existsSync(dest)) fs.writeFileSync(dest, buf);   /* content-addressed: the same photo twice costs one file */
            l.photos[i] = id;
            moved.push((o.number || o.id) + ' \u2192 ' + id + ' (' + Math.round(buf.length / 1024) + ' KB)');
          } catch (e) { l.photos.splice(i, 1); i--; moved.push((o.number || o.id) + ' (inline photo failed to store, dropped)'); }
        }
      }
    }
  } catch (e) {}
  return moved;
}
const CLOCK_SKEW_MS = Number(process.env.OZARK_CLOCK_SKEW_MS || 5 * 60 * 1000);
function stampSanitize(inc){
  const hits = [];
  try {
    const now = Date.now();
    const limit = stampScale(now + CLOCK_SKEW_MS);
    const fix = v => (Number(v) < 1e14) ? now : now * 1000;   /* keep the record on the scale it arrived on */
    Object.keys(HUB_KEYS_FOR_SEQ).forEach(coll => {
      const arr = inc && inc[coll]; if (!Array.isArray(arr)) return;
      const key = HUB_KEYS_FOR_SEQ[coll];
      arr.forEach(r => {
        if (!r || r._t == null) return;
        if (stampScale(r._t) > limit) {
          hits.push(coll + '/' + String(r[key]) + ' claimed ' + new Date(Number(r._t) < 1e14 ? +r._t : Math.floor(+r._t / 1000)).toISOString());
          r._t = fix(r._t);
        }
      });
    });
    /* ⚠️ A FUTURE-DATED TOMBSTONE IS DROPPED, NOT CLAMPED — and clamping was my first answer, which the
       harness rejected. Clamping a tombstone to "now" does not make it safe: a delete stamped NOW still
       outranks any record stamped a moment ago, so a broken clock would still take real records with it. And a
       tombstone is the one thing in this system that removes data, against a design whose whole spine is
       "absence is never a delete" and "never delete, just mark".
       So the conservative direction is the only defensible one: a delete request carrying an impossible time is
       not trusted at all. The station keeps its tombstone locally and will offer it again; once its clock is
       right the delete lands normally. Refusing costs a delayed deletion. Accepting costs real records. */
    if (Array.isArray(inc && inc._tomb)) {
      const keep = [];
      inc._tomb.forEach(t => {
        if (t && t.t != null && stampScale(t.t) > limit) { hits.push('DROPPED tombstone ' + t.c + '|' + t.k); return; }
        keep.push(t);
      });
      if (keep.length !== inc._tomb.length) inc._tomb = keep;
    }
  } catch (e) {}
  return hits;
}
/* 🗝 the scalar/map values as they stood BEFORE a merge, captured as text.
   ⚠️ HONEST ACCOUNT OF WHY THIS IS HERE, because my first version of this comment was wrong. I blamed the
   delta-push failure on hubMerge merging settings IN PLACE — `_pre` and the merged copy sharing one object,
   so seqStamp would compare it against itself. That was a plausible story and the real cause was elsewhere
   (the `changed ||` guard in deltaSince). A negative control settles it: reading `before[k]` directly still
   passes every test, so this snapshot is NOT load-bearing today.
   It is kept as defence rather than as a fix, for one specific reason: `devices` in this same database IS
   merged in place, documented and measured, and that is exactly how a record ends up compared against
   itself and a change is silently withheld. Comparing TEXT captured before the merge makes the answer
   correct by construction instead of by trusting hubMerge's object handling to stay as it is.
   ⚠️ So do not treat this as proof that a hazard was observed here. If it is ever removed, the thing to
   check is whether settings/drawers/checklistDone still arrive as fresh objects from the merge. */
function kseqSnapshot(dbo){
  const out = {};
  try { ['settings', 'baseline', 'seq'].concat(HUB_MAPS_FOR_SEQ).forEach(k => {
    if (dbo && dbo[k] !== undefined) out[k] = JSON.stringify(dbo[k]); }); } catch (e) {}
  return out;
}
function seqStamp(before, after, atRev, preKeys){
  try {
    const keys = Object.keys(HUB_KEYS_FOR_SEQ);
    for (const coll of keys) {
      const arr = after[coll]; if (!Array.isArray(arr)) continue;
      const key = HUB_KEYS_FOR_SEQ[coll];
      const prev = {};
      ((before && before[coll]) || []).forEach(r => { if (r && r[key] != null) prev[String(r[key])] = r; });
      for (const r of arr) {
        if (!r || typeof r !== 'object') continue;
        const was = prev[String(r[key])];
        /* changed, or brand new → it belongs in every delta from here on */
        if (!was || JSON.stringify(was) !== JSON.stringify(r)) r._seq = atRev;
        else if (r._seq == null) r._seq = was._seq != null ? was._seq : 0;
      }
    }
    /* tombstones are historical now (nothing creates them any more) but they still have to ride a delta.
       ⚠️ COMPARE ON c|k|t, NOT ON THE WHOLE JSON. The old test was JSON.stringify(was) !== JSON.stringify(t),
       and `_seq` is itself part of that JSON — so a tombstone arriving back from a device without `_seq` never
       matched its stored self and got re-stamped with the current revision. EVERY push therefore re-stamped
       ALL of them, which meant **every delta a station pulled carried all 3,563 tombstones**. Measured live on
       2026-08-11: four consecutive revisions each shipped 3,563, which is most of the weight Phase 1 set out to
       remove, and it would have made every delta-log line enormous too.
       A tombstone's identity is which record it kills (c|k) and when (t). If those are unchanged it has not
       changed, whatever else rides along, so it keeps the revision it already had and stops re-broadcasting. */
    if (Array.isArray(after._tomb)) {
      const pt = {};
      ((before && before._tomb) || []).forEach(t => { if (t) pt[t.c + '|' + t.k] = t; });
      after._tomb.forEach(t => { if (!t) return; const was = pt[t.c + '|' + t.k];
        const unchanged = was && (+was.t || 0) === (+t.t || 0);
        if (!unchanged) t._seq = atRev;
        else t._seq = (was._seq != null) ? was._seq : (t._seq != null ? t._seq : 0); });
    }
    /* 🗝 WHEN DID EACH SCALAR AND MAP LAST ACTUALLY CHANGE? Records carry `_seq`; settings, baseline, seq,
       drawers and checklistDone had nothing, so deltaSince could only guess and guessed "always". Measured
       cost of that guess: 13 MB of a 32 MB delta log, and the same bytes re-downloaded by every station on
       every pull. This is the missing per-key sequence — see the banner in deltaSince.
       ⚠️ FIRST SIGHT COUNTS AS A CHANGE. A key with no entry yet is stamped at this revision, so a device
       that pulled before it existed still receives it, and only a device already past that revision skips
       it. Absent bookkeeping must never mean "you already have this". */
    const kseq = Object.assign({}, (before && before.__kseq) || {});
    ['settings', 'baseline', 'seq'].concat(HUB_MAPS_FOR_SEQ).forEach(k => {
      if (after[k] === undefined) return;
      /* ⚠️ the BEFORE text must come from kseqSnapshot, taken before the merge — reading before[k] here
         reads an object the merge has already written through. No snapshot? Treat it as changed and send. */
      const wasJson = (preKeys && preKeys[k] !== undefined) ? preKeys[k] : null;
      if (kseq[k] == null || wasJson === null || wasJson !== JSON.stringify(after[k])) kseq[k] = atRev;
    });
    after.__kseq = kseq;
  } catch (e) { console.log('  ⚠ could not stamp _seq: ' + e.message); }
}
/* Build the answer for ?since=<n>. Only what moved, plus the row COUNTS so a station can notice drift without
   paying for a full pull — and so "I received nothing" can never be mistaken for "nothing changed". */
function deltaSince(dbo, since){
  const out = {}, counts = {};
  let changed = 0;
  Object.keys(HUB_KEYS_FOR_SEQ).forEach(coll => {
    const arr = dbo[coll]; if (!Array.isArray(arr)) return;
    counts[coll] = arr.length;
    const moved = arr.filter(r => r && (+r._seq || 0) > since);
    if (moved.length) { out[coll] = moved; changed += moved.length; }
  });
  const tomb = Array.isArray(dbo._tomb) ? dbo._tomb.filter(t => t && (+t._seq || 0) > since) : [];
  /* ⚠️ THE COMMENT THAT USED TO BE HERE SAID THESE WERE "tiny ... a few hundred bytes", SO IT SENT THEM ON
     EVERY DELTA RATHER THAN TRACKING WHEN THEY CHANGED. Measured on the live delta log 2026-08-14, that
     assumption is false and expensive:
         settings       sent 2,408 times · UNCHANGED 1,074 of them · 3.1 KB a time
         drawers        sent 2,408 times · UNCHANGED 2,406 of them · 2.1 KB a time
         checklistDone  sent 2,408 times · changed ZERO times      · 0.4 KB a time
     That is ~5.6 KB riding on every revision — 13 MB of a 32 MB delta log, and the same bytes downloaded
     again by every station on every pull, including the route phone on a weak signal.
     `__kseq` records the revision each of these last actually changed at (see seqStamp), so they ride only
     when they have something to say.
     ⚠️ IT FAILS SAFE. No `__kseq` at all, or no entry for a key, means SEND IT — the old behaviour. The
     dangerous direction here is withholding a change, never repeating one, so every uncertainty resolves
     toward sending. */
  /* ⚠️ AND THEY NO LONGER DEPEND ON A RECORD HAVING MOVED. This used to sit behind `if (changed ||
     tomb.length)`, where `changed` counts RECORDS — so a revision that changed ONLY settings sent nothing at
     all, and the change reached other stations only on the next full reconcile. I noticed that, judged it
     pre-existing and left it; the delta-shaped test written an hour later failed on exactly it. A settings
     change IS a change, and counting it here is what makes such a revision a non-empty delta. */
  const ks = dbo.__kseq;
  const moved = k => dbo[k] !== undefined && (!ks || ks[k] == null || (+ks[k] || 0) > since);
  let extras = 0;
  ['settings', 'baseline', 'seq'].concat(HUB_MAPS_FOR_SEQ)
    .forEach(k => { if (moved(k)) { out[k] = dbo[k]; extras++; } });
  return { db: out, _tomb: tomb, counts: counts, changed: changed + tomb.length + extras };
}
/* 🛣 append one revision's delta to the permanent traffic record.
   ⚠️ IT REUSES deltaSince — the very function devices pull through — so the log and the wire can never drift.
   deltaSince(merged, rev-1) is, by definition, "everything stamped with THIS revision".
   ⚠️ WRITTEN BEFORE THE SNAPSHOT, deliberately. If the process dies between the two, the change is already
   durable in the log and can be replayed; the other order would lose it. appendFileSync on a single line under
   the pipe-buffer size is atomic enough for this purpose, and a torn final line is detected and skipped on read
   rather than being allowed to poison a rebuild. */
function deltaLogAppend(dbo, atRev, at, device){
  try {
    const d = deltaSince(dbo, atRev - 1);
    const line = JSON.stringify({ rev: atRev, ts: at, device: device || '', db: d.db, _tomb: d._tomb }) + '\n';
    /* roll rather than delete — the owner's rule is never delete, just mark */
    try {
      if (fs.existsSync(DELTALOG) && fs.statSync(DELTALOG).size > DELTALOG_ROLL) {
        fs.renameSync(DELTALOG, path.join(DATADIR, 'delta-log-' + stamp(at) + '.jsonl'));
      }
    } catch (e) {}
    fs.appendFileSync(DELTALOG, line);
    return d.changed;
  } catch (e) { console.log('  ⚠ delta log append failed: ' + e.message); return -1; }
}
/* read the log back. Skips a torn trailing line instead of throwing — a half-written last line must never make
   the whole record unreadable. */
function deltaLogRead(afterRev){
  const out = [];
  let txt = '';
  try { txt = fs.readFileSync(DELTALOG, 'utf8'); } catch (e) { return out; }
  const lines = txt.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i].trim(); if (!ln) continue;
    let o = null;
    try { o = JSON.parse(ln); } catch (e) {
      if (i === lines.length - 1 || lines.slice(i + 1).join('').trim() === '') break;   // torn tail — stop cleanly
      console.log('  ⚠ delta log line ' + (i + 1) + ' is unreadable — skipped');
      continue;
    }
    if (o && (+o.rev || 0) > (afterRev || 0)) out.push(o);
  }
  out.sort((a, b) => (+a.rev || 0) - (+b.rev || 0));
  return out;
}
function deltaLogTailRev(){
  const all = deltaLogRead(0);
  return all.length ? (+all[all.length - 1].rev || 0) : 0;
}
/* is it time for a full checkpoint? Revisions OR minutes, whichever comes first, so a quiet shop still gets one
   and a very busy one does not get thousands. */
function ckptDue(atRev, at){
  if (!lastCkptRev && !lastCkptAt) return true;                       // none yet this run
  if (atRev - lastCkptRev >= CKPT_REVS) return true;
  if (at - lastCkptAt >= CKPT_MS) return true;
  return false;
}
/* 👑 ONE STATION DOES THE AUTOMATIC WORK. Owner, 2026-08-10: "it sounds like we need a boss hierarchy so that
   only one of these systems pushes the automatic portions?" — and he is right; this is the hole under the
   Enderby double charge.
   Every station runs the same timers: the monthly auto-charge, the late-order apology texts, the auto-close of
   bags. Four stations meant four processes racing to do one job, and the only thing between a customer and a
   second charge was a flag inside the synced data — which a sync rollback erased on 8/03, and $37.93 went
   through twice, 44 seconds apart.
   A flag in shared data cannot arbitrate a race, because the race is IN the shared data. The hub can: it is
   the one process that sees every station, so it appoints one and answers every other station "not you".
   Stickiness matters more than choosing well. The incumbent keeps the job while it is still checking in, so
   the appointment does not flap between stations mid-charge; only when it goes quiet does someone else take
   over. And each station is told ONLY whether IT is the one — no device names on the keyless endpoint. */
let AUTO = { dev:'', at:0 };
const AUTO_HOLD_MS = 120000;   /* an incumbent that has checked in this recently keeps the job */
function autoLeaderFor(dev){
  const now = Date.now();
  /* incumbent still present → nothing changes */
  if (AUTO.dev && (now - (seen.get(AUTO.dev) || 0)) < AUTO_HOLD_MS) return AUTO.dev === dev;
  /* otherwise appoint whoever has checked in most recently; name breaks a tie so every request agrees */
  let best = '', bestAt = 0;
  for (const [d, ts] of seen.entries()) {
    if (d === '127.0.0.1' || /^support-console$/i.test(d)) continue;   /* my own console is not a station */
    if (now - ts > AUTO_HOLD_MS) continue;
    if (ts > bestAt || (ts === bestAt && d < best)) { best = d; bestAt = ts; }
  }
  if (best && best !== AUTO.dev) {
    AUTO = { dev: best, at: now };
    console.log('  👑 automatic work is now ' + best + "'s job (monthly charges, late texts, auto-close)");
  }
  return !!AUTO.dev && AUTO.dev === dev;
}
/* <STAMP-SCALE v1> ==========================================================================
   ⏱ TWO CLOCKS ON ONE NUMBER LINE. Owner, 2026-08-10: "chase that balance issue down."

   hlcNow() returns ms*1000+counter, so a hybrid stamp is about 1.79e15. Every build before the hybrid clock
   stamped a plain Date.now(), about 1.79e12. Both live in _t, and every merge compared them with a bare
   numeric >=. So a hybrid stamp beats a millisecond stamp BY A FACTOR OF A THOUSAND, whichever one is
   actually newer.

   MEASURED on the live database, 2026-08-10: 6,089 of 6,341 records carry millisecond stamps and only 238
   carry hybrid ones — and the two populations OVERLAP IN REAL TIME (milliseconds 8/04 4:01pm → 8/10 12:39pm,
   hybrid 8/05 6:09pm → 8/10 1:06pm). So a change written at 12:39 today loses to a copy from six days ago,
   silently, in customers (4,909 records), orders (84), payments (63) and ledger (41).

   That is the shape of a balance that will not stay paid: the ledger row is an array ADD and survives, while
   the balance is a FIELD EDIT on the customer and gets reverted by whichever copy happens to be on the
   thousand-times-larger scale. Which is how a customer who had already paid still showed as owing, and was
   charged a second time.

   The fix is not to restamp 6,000 records — that would rewrite history and pick a new winner for every one of
   them. It is to COMPARE them correctly: put both scales on the same number line at read time. A millisecond
   stamp is promoted by 1000, which is exactly what it would have been had the hybrid clock existed when it was
   written, and hybrid stamps are untouched.

   ⚠️ BYTE-IDENTICAL IN Ozark-POS.html AND hub-server.js — test-hub.js fails if they ever drift. The app and
   the hub deciding a winner by different arithmetic is the whole class of bug this is fixing. */
/* @sync @clock — put a millisecond stamp and a hybrid stamp on one scale. Comparing them raw let a six-day-old copy beat today's work. */
function stampScale(v){
  v = Number(v) || 0;
  if (v <= 0) return 0;
  /* 1e14 is the same threshold hlcObserve() already uses to recognise a legacy stamp: a real hybrid stamp is
     ~1.79e15 and a millisecond stamp ~1.79e12, so there are eleven orders of magnitude of daylight and no
     plausible clock lands between. */
  return (v < 1e14) ? (v * 1000) : v;
}
/* @sync @clock @merge — which of two stamps is newer -- the one comparison every winner-picking site has to use. */
function stampNewer(a, b){ return stampScale(a) >= stampScale(b); }
/* </STAMP-SCALE v1> */
/* <MIRROR-ALGO v1> ============================================================================
   🪞 THE MIRROR. Owner, 2026-08-08: "if my pc says it has a delta, it finds it's home on all the other
   pc's so as to constantly keep a running mirror between all stations... the hub is like a set of mirrors."

   Every station holds the whole business locally. The hub routes the delta. Nothing in that arrangement
   PROVES the copies stayed the same — and this week showed what an unproven copy costs: one station on an
   old build quietly wiped 21 collection records on every push, for days, while every screen looked fine.

   So each station periodically hands the hub a fingerprint of what it holds, tagged with the revision it
   holds it AT. Two stations at the same revision must produce the same numbers. If they don't, the hub says
   WHICH collection disagrees, and the station heals in both directions — pulls the hub's truth, then pushes
   its own, because a merge unions per record and absence is never a delete.

   ⚠️ THIS BLOCK IS BYTE-IDENTICAL IN Ozark-POS.html AND hub-server.js, and test-hub.js FAILS if it ever
   drifts. A comparison between two implementations that merely agree today is not a comparison.

   WHAT IT COVERS: the 18 keyed BUSINESS collections — orders, payments, ledger, customers, garments,
   collections, prices, and the rest. WHAT IT DOES NOT, and why each one is deliberate:
     • activity  — the device keeps a rolling 6,000-event window (syncMergeAct); the hub keeps all of it
                   forever in activity-archive.jsonl. These are SUPPOSED to differ.
     • devices   — ⚠️ MEASURED, not assumed. Within four minutes of this shipping, Arkadelphia Counter
                   reported drift:["devices"] twice in a row. The hub WRITES to that collection as a side
                   effect of every push (markPushingDevice stamps hubPushAt / hubRev / oldBuild onto the
                   pushing station's own record), but a push response returns only {ok, rev} — so the station
                   that just pushed cannot possibly be holding the annotation the hub made about it, at the
                   very revision it is reporting. That is a permanent, structural false positive: it would
                   have cried drift every minute on every working station and triggered a pull-and-push heal
                   each time, costing a revision and a backup file for nothing. `devices` is telemetry ABOUT
                   the stations, not a record of the business, so it is not what "each local copy stays
                   identical" is about.
     • drawers / checklistDone / settings / seq — maps and scalars, merged field-wise, not record-wise.
     • anything device-LOCAL: rack mode, print agent, home store, device name, the hub key. Owner: "there
       are a few parts that don't stay identical for printing and hardware." Those live in localStorage,
       outside the synced DB entirely, so they can't reach this by construction. */
/* @mirror @sync */
function mirrorKeys(){ return ['prices','upcharges','employees','customers','orders','payments','ledger','timeclock','timeAcks','timeOff','routeLog','checklist','supplies','voidRequests','refundRequests','batches','collections','supplyOrders','garments']; }
/* @mirror @sync */
function mirrorIdOf(coll){ return coll==='garments' ? 'hsl' : 'id'; }
/* Deterministic text for one record, KEYS SORTED. Two stations that grew the same record by adding the same
   fields in a different order (rackLocWas before paymentStatus on one, after on the other) hold the same
   record — JSON.stringify would call them different and cry wolf forever. */
/* @mirror @sync — one record as deterministic text. ⚠️ Keys are SORTED -- fields written in a different order are not drift, and treating them as drift would cry wolf on every push. */
function mirrorStable(v){
  if(v===null||v===undefined) return 'n';
  var t=typeof v;
  if(t==='number') return (v===v && v!==Infinity && v!==-Infinity) ? ('d'+v) : 'd0';
  if(t==='boolean') return v?'t':'f';
  if(t==='string') return 's'+v;
  if(t!=='object') return 'u';
  if(Object.prototype.toString.call(v)==='[object Array]'){ var a='[',i; for(i=0;i<v.length;i++){ a+=mirrorStable(v[i])+','; } return a+']'; }
  var ks=Object.keys(v).sort(), o='{', j;
  for(j=0;j<ks.length;j++){ o+=ks[j]+':'+mirrorStable(v[ks[j]])+','; }
  return o+'}';
}
/* @mirror @sync */
function mirrorHash(s){ var h=2166136261,i;                                     /* FNV-1a, 32-bit */
  for(i=0;i<s.length;i++){ h=(h^s.charCodeAt(i))>>>0; h=(h*16777619)>>>0; }
  return h>>>0; }
/* {coll:{n,x,s}} — ORDER-INDEPENDENT on purpose: hubMergeArr rebuilds each array in whatever order the
   pushes arrived, so two identical stations legitimately hold their rows in different positions. Combined by
   xor AND sum AND count, because xor alone is blind to a record appearing twice. */
/* @mirror @sync — fingerprint what this device holds, tagged with the revision it holds it AT. */
function mirrorFp(db,cache){
  var out={}, ks=mirrorKeys(), ci;
  for(ci=0;ci<ks.length;ci++){
    var coll=ks[ci], idf=mirrorIdOf(coll), rows=(db&&db[coll])||[], x=0, s=0, n=0, i;
    var cc=cache?(cache[coll]||(cache[coll]={})):null;
    for(i=0;i<rows.length;i++){
      var r=rows[i]; if(!r||typeof r!=='object') continue;
      var k=String(r[idf]==null?'':r[idf]), tv=+r._t||0, sq=+r._seq||0, h;
      /* 🔁 O(delta), not O(everything): a record whose _t hasn't moved hashes to what it hashed before.
         ⚠️ THE CACHE KEY MUST COVER EVERYTHING THE HASH COVERS, and for a year it did not. It was _t alone,
         and the note that stood here said that was safe "because syncStamp assigns a _t to anything that
         changed". That is true of a STATION's own edits. It is NOT true of _seq, which the HUB assigns and
         which arrives on an ordinary pull with _t untouched — so the station went on serving a hash computed
         against the OLD _seq while the hub computed the new one, and reported drift on a collection whose
         records were byte-identical. Note the asymmetry that hid it: the hub calls mirrorFp(db) with NO
         cache, so the hub is always right and only the station can be stale.
         Measured 2026-08-14: Assembly and Arkadelphia Counter both reported drift:["timeclock"] for 19
         checks in a row while a decrypted station snapshot matched the hub on all 120 rows, _seq included.
         ⚠️ A FALSE ALARM ON A SAFETY CHECK IS NOT HARMLESS. The mirror is what caught a station silently
         wiping 21 collection records on every push; an alarm that cries wolf on healthy stations is one
         people learn to ignore, which is the PHY-3 lesson over again.
         The fix widens the KEY, never what is hashed — so a station on an older build still computes the
         same fingerprint and a rollout cannot manufacture the very drift this is fixing. */
      if(cc && cc[k] && cc[k].t===tv && cc[k].q===sq && tv>0){ h=cc[k].h; }
      else { h=mirrorHash(k+'|'+mirrorStable(r)); if(cc) cc[k]={t:tv,q:sq,h:h}; }
      x=(x^h)>>>0; s=(s+h)%4294967296; n++;
    }
    out[coll]={n:n,x:x,s:s>>>0};
  }
  return out;
}
/* Which collections disagree — named, never just "something is wrong". */
/* @mirror @sync */
/* @mirror @sync — name the collections where two fingerprints disagree.
   ⚠️ THIS IS NOT DEAD CODE, even though nothing in the app calls it. It lives inside <MIRROR-ALGO v1>, which is
   byte-identical in Ozark-POS.html and hub-server.js by design, and it is the HUB's copy that runs — hub-server
   calls it on every mirror report to tell a station which collections it disagrees on. The app carries the block
   so that both ends provably compute drift the same way; a station that judged drift differently from the hub is
   the exact failure the shared block exists to prevent.
   So do NOT "clean this up" as an orphan, and do not edit it here alone: edit the block once, then re-insert it
   into both files (research/2026-08-12/resync-shared-blocks.py does that copy). */
function mirrorDrift(a,b){ var d=[], ks=mirrorKeys(), i;
  for(i=0;i<ks.length;i++){ var c=ks[i], p=a&&a[c], q=b&&b[c];
    if(!p&&!q) continue;
    if(!p||!q||p.n!==q.n||p.x!==q.x||p.s!==q.s) d.push(c); }
  return d; }
/* </MIRROR-ALGO v1> */
/* 🪞 THE MIRROR REGISTRY — in MEMORY ONLY, on purpose.
   `revs` is what the hub itself held at each revision; a station's report is compared against the entry for
   the revision IT holds, so two stations never have to be online at the same moment to be compared. Deliberately
   not persisted: a restart makes it empty, every station's next report comes back `known:false` (which is
   NOT drift), and the next push repopulates it within seconds. A new file on disk would be a new thing that
   can fail, for information that rebuilds itself in a minute. The permanent record is the journal line. */
let MIRROR = { revs:{}, stations:{} };
const MIRROR_KEEP = 500;
function mirrorRemember(r, db){
  try {
    MIRROR.revs[r] = { at: Date.now(), fps: mirrorFp(db) };
    const ks = Object.keys(MIRROR.revs);
    if (ks.length > MIRROR_KEEP) ks.map(Number).sort((a,b)=>a-b).slice(0, ks.length-MIRROR_KEEP)
      .forEach(k => { delete MIRROR.revs[k]; });
  } catch (e) { console.log('  ⚠ mirror fingerprint failed: ' + e.message); }
}
function readDB(){
  try { const raw = JSON.parse(fs.readFileSync(DBFILE, 'utf8')); return raw && raw.db ? raw : null; }
  catch (e) { try { return JSON.parse(fs.readFileSync(BAKFILE, 'utf8')); } catch (e2) { return null; } }
}
function writeAtomic(file, text){
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);               // atomic on Windows/NTFS
}
function rotateBackups(){
  // 🕰 TIERED retention, v2 after adversarial review (was: flat newest-60, which on a busy hour could span
  // under 10 minutes — a mistake found an hour later was only recoverable from the ~24h-stale daily images):
  //   • newest 30 snapshots: ALWAYS kept, age ignored (floor — survives idle gaps; nothing can wipe recent history)
  //   • last hour  : every snapshot (capped at KEEP_BK; overflow FALLS THROUGH to the hourly tier below, so a
  //     busy hour still keeps its newest snapshot instead of being starved)
  //   • last 2 days: the newest snapshot of each hour
  //   • last 30 days: the newest snapshot of each day
  // Timestamps come from the STAMPED FILENAME, never mtime — any restore/copy (plain cp/scp/unzip) refreshes
  // mtimes, which under the old logic would have piled a month of history into one tier and wiped it on the
  // next push. Only exact ozark-YYYYMMDD-HHMMSS.json names participate: anything else parked in backups/ is
  // invisible to rotation and therefore never deleted (owner's rule).
  try {
    const now = Date.now();
    const files = fs.readdirSync(BACKUPS).filter(f => /^ozark-\d{8}-\d{6}\.json$/.test(f)).sort().reverse();   // stamped names sort chronologically => newest first
    const keptHour = {}, keptDay = {}; let recentKept = 0;
    files.forEach(function (f, i) {
      if (i < 30) { recentKept++; return; }                     // floor: the newest 30 are untouchable (they also count toward the last-hour cap so floor+cap don't stack)
      const s = /^ozark-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})\.json$/.exec(f);
      const ts = new Date(+s[1], +s[2] - 1, +s[3], +s[4], +s[5], +s[6]).getTime();
      const age = now - ts; let keep = false;
      if (age <= 3600e3 && recentKept < KEEP_BK) { recentKept++; keep = true; }
      else if (age <= 48 * 3600e3) { const b = Math.floor(ts / 3600e3); if (!keptHour[b]) { keptHour[b] = 1; keep = true; } }
      else if (age <= 30 * 86400e3) { const b = Math.floor(ts / 86400e3); if (!keptDay[b]) { keptDay[b] = 1; keep = true; } }
      if (!keep) { try { fs.unlinkSync(path.join(BACKUPS, f)); } catch (e) {} }
    });
  } catch (e) {}
}
function stamp(ts){ const d = new Date(ts); const p = n => String(n).padStart(2,'0');
  return d.getFullYear()+p(d.getMonth()+1)+p(d.getDate())+'-'+p(d.getHours())+p(d.getMinutes())+p(d.getSeconds()); }
let HANGUPS = 0;   /* 📞 how many replies had nobody left to hear them — see send() */
/* ⚠️ A CLIENT THAT HUNG UP MUST NOT LOOK LIKE A CRASH. Measured on the live hub 2026-08-13: 653
   `[uncaughtException] ERR_STREAM_WRITE_AFTER_END` in six hours — about one every 33 seconds — every one of
   them `send()` writing to a response whose socket the station had already closed. A push that takes a moment
   plus a phone that backgrounds its tab, or Chrome throttling a hidden window, is enough.
   THE WORK WAS NEVER AT RISK: by the time send() runs the delta log is on disk and the revision is committed,
   and the station simply retries — the merge is idempotent, which is why nothing was ever lost by this.
   What WAS at risk is everything else. Node leaves the process in an undefined state after an
   uncaughtException, our handler only logs it, and the journal was drowning at a rate that would bury a real
   fault. So an undeliverable reply is now a no-op that gets COUNTED rather than thrown — counted, because
   silence would trade a flood for a blind spot, and this number rising is a real signal about the fleet.
   `/api/health` publishes it. */
function send(res, code, obj, headers){
  if (!res || res.writableEnded || res.destroyed || (res.socket && res.socket.destroyed)) { HANGUPS++; return; }
  const body = typeof obj === 'string' ? obj : JSON.stringify(obj);
  try {
  res.writeHead(code, Object.assign({
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, x-ozark-key, x-ozark-device',
    'Cache-Control': 'no-store'
  }, headers || {}));
  res.end(body);
  } catch (e) { HANGUPS++; }   /* the socket died between the check above and the write — same story, same answer */
}
function deviceOf(req){ return (req.headers['x-ozark-device'] || (req.socket.remoteAddress||'').replace(/^::ffff:/,'') || 'device'); }
function clientsRecent(){ const now = Date.now(); let n = 0; for (const t of seen.values()) if (now - t < 60000) n++; return n; }
/* app-version stamp: a short hash of Ozark-POS.html, recomputed only when the file changes (a deploy).
   Devices compare it each sync; a change means a new build shipped → they refresh on their own. */
let _appRev = '', _appMtime = -1;
function appRev(){ try { const st = fs.statSync(path.join(ROOT,'Ozark-POS.html'));
    if (st.mtimeMs !== _appMtime){ _appMtime = st.mtimeMs; _appRev = require('crypto').createHash('sha1').update(fs.readFileSync(path.join(ROOT,'Ozark-POS.html'))).digest('hex').slice(0,12); }
  } catch(e){} return _appRev; }

/* ---- 🗄 PERMANENT activity archive (append-only JSONL, NEVER trimmed) ----
   The browser keeps only a recent window of the activity log; this file on the hub keeps
   EVERY event forever (and rides along to the OneDrive off-site backup). On each sync we
   append any events we haven't archived yet (deduped by a content key). */
const ARCH_SEEN = new Set();        // event keys already on disk — dedupes re-synced events
let ARCH_COUNT = 0;
function actKey(e){ return (e.ts||'')+'|'+(e.type||'')+'|'+(e.detail||'')+'|'+(e.emp||'')+'|'+(e.ws||''); }
(function preloadArchiveKeys(){
  try {
    if (!fs.existsSync(ARCHFILE)) return;
    const lines = fs.readFileSync(ARCHFILE,'utf8').split(/\r?\n/);
    for (const ln of lines){ if(!ln) continue; try{ ARCH_SEEN.add(actKey(JSON.parse(ln))); ARCH_COUNT++; }catch(_e){} }
    console.log('  🗄 activity archive: ' + ARCH_COUNT + ' events on file');
  } catch(e){ console.log('  (activity archive preload failed):', e.message); }
})();
/* 🐾 THE TRAIL — hub-data/trail.jsonl, append-only, OUTSIDE the synced database.
   Owner, 2026-08-10: "which button was clicked from home, and who was searched, who was clicked, and what was
   clicked… it's noise until there's a discrepancy and we can trace out a map of a garment that may have been
   lost."
   So it is stored to be QUERIED, not read: every row carries the garment, order and customer it touched when
   known, and the endpoint filters on those rather than making anyone scroll. Deliberately not in the synced DB
   and deliberately not in the activity log — the activity log is the record the owner actually reads, and
   burying it under thousands of taps would destroy the one trail that already works. */
const TRAILFILE = path.join(DATADIR, 'trail.jsonl');
/* 🩹 THE ERROR RECORD \u2014 `hub-data/client-errors.jsonl`, append-only.
   Owner asked for this first when we listed the gaps, and it is the honest answer to why this week went the way
   it did: NOTHING IN THIS SYSTEM REPORTED ITS OWN FAILURES. Every bug found between 8/05 and 8/11 was found
   because a human noticed something felt wrong \u2014 a window that had gone deaf, a push flag stuck on, a reader
   cancel that read as a decline, a screen that rendered blank. A station could throw on every single render and
   the only signal would be an employee saying "it's acting funny".
   Kept OUT of the synced database on purpose, exactly like the trail and the SMS archive: errors arrive in
   bursts, and a burst must never become a sync storm on the shop floor at 8am.
   ⚠️ NEVER PUT DATABASE CONTENTS IN HERE. A stack trace is code, which is safe; a message could be anything, so
   it is length-capped and nothing else about the record is copied in. */
function OZARK_KEY_OK(k){ try { const want = process.env.OZARK_HUB_KEY || ''; if (!want) return false;   /* fail CLOSED, same rule as reqKeyOk */
  const a = Buffer.from(String(k || '')), b = Buffer.from(want);
  return a.length === b.length && require('crypto').timingSafeEqual(a, b); } catch (e) { return false; } }
const ERRFILE = path.join(DATADIR, 'client-errors.jsonl');
let ERR_COUNT = 0;
function errAppend(rows, dev){
  if (!Array.isArray(rows) || !rows.length) return 0;
  let n = 0, out = '';
  for (const r of rows.slice(0, 50)) {          /* a runaway loop on one station must not fill the disk */
    if (!r || typeof r !== 'object') continue;
    const e = { ts: +r.ts || Date.now(), dev: String(dev || '').slice(0, 60),
      msg: String(r.msg || '').slice(0, 400), src: String(r.src || '').slice(0, 200),
      line: (r.line != null ? +r.line : null), col: (r.col != null ? +r.col : null),
      stack: String(r.stack || '').slice(0, 1200), kind: String(r.kind || 'error').slice(0, 24),
      screen: String(r.screen || '').slice(0, 24), emp: String(r.emp || '').slice(0, 60),
      appRev: String(r.appRev || '').slice(0, 40), pageAt: (+r.pageAt || 0), n: (+r.n || 1) };
    out += JSON.stringify(e) + '\n'; n++;
  }
  if (!out) return 0;
  try {
    if (fs.existsSync(ERRFILE) && fs.statSync(ERRFILE).size > 32 * 1024 * 1024) {
      fs.renameSync(ERRFILE, path.join(DATADIR, 'client-errors-' + stamp(Date.now()) + '.jsonl'));
    }
    fs.appendFileSync(ERRFILE, out);
    ERR_COUNT += n;
  } catch (e) { return 0; }
  return n;
}
/* newest first, and GROUPED \u2014 one station throwing the same error 400 times must read as one problem seen 400
   times, or the list is unusable exactly when it matters most */
function errRead(opts){
  opts = opts || {};
  const limit = Number(opts.limit) || 200;
  let txt = ''; try { txt = fs.readFileSync(ERRFILE, 'utf8'); } catch (e) { return { rows: [], groups: [], total: 0 }; }
  const rows = [];
  const lines = txt.split('\n');
  for (let i = lines.length - 1; i >= 0 && rows.length < 4000; i--) {
    const ln = lines[i].trim(); if (!ln) continue;
    try { rows.push(JSON.parse(ln)); } catch (e) {}
  }
  const since = Number(opts.since) || 0;
  const kept = rows.filter(r => r && (+r.ts || 0) >= since);
  const g = {};
  for (const r of kept) {
    const sig = (r.msg || '') + '|' + (r.src || '') + ':' + (r.line == null ? '?' : r.line);
    if (!g[sig]) g[sig] = { sig: sig, msg: r.msg, src: r.src, line: r.line, kind: r.kind, count: 0,
      first: r.ts, last: r.ts, devices: {}, screens: {}, appRevs: {}, stack: r.stack };
    const x = g[sig];
    x.count += (+r.n || 1);
    if (r.ts < x.first) x.first = r.ts;
    if (r.ts > x.last) x.last = r.ts;
    if (r.dev) x.devices[r.dev] = (x.devices[r.dev] || 0) + 1;
    if (r.screen) x.screens[r.screen] = (x.screens[r.screen] || 0) + 1;
    if (r.appRev) x.appRevs[r.appRev] = (x.appRevs[r.appRev] || 0) + 1;
  }
  const groups = Object.keys(g).map(k => g[k]).sort((a, b) => b.last - a.last).slice(0, limit);
  return { rows: kept.slice(0, limit), groups: groups, total: kept.length };
}
function trailAppend(rows, dev){
  if (!Array.isArray(rows) || !rows.length) return 0;
  let n = 0, out = '';
  for (const r of rows.slice(0, 500)) {
    if (!r || typeof r !== 'object') continue;
    const e = { ts: +r.ts || Date.now(), dev: String(dev || '').slice(0, 60), kind: String(r.kind || '').slice(0, 24),
      what: String(r.what || '').slice(0, 120), emp: String(r.emp || '').slice(0, 60),
      ws: String(r.ws || '').slice(0, 60), store: (r.store != null ? r.store : ''), screen: String(r.screen || '').slice(0, 24) };
    if (r.cid)   e.cid   = String(r.cid).slice(0, 40);
    if (r.who)   e.who   = String(r.who).slice(0, 60);
    if (r.order) e.order = String(r.order).slice(0, 24);
    if (r.hsl)   e.hsl   = String(r.hsl).slice(0, 24);
    if (r.n != null) e.n = +r.n;
    out += JSON.stringify(e) + '\n'; n++;
  }
  if (!out) return 0;
  try { fs.appendFileSync(TRAILFILE, out); } catch (e) { console.log('  ⚠ could not append the trail: ' + e.message); return 0; }
  return n;
}
/* Newest first, filtered. Reads the file each time: it is one machine-day of taps, and a trace happens when
   something is missing, not every four seconds. `truncated` says when it stopped, so a partial map can never
   be mistaken for the whole one. */
function trailRead(opts){
  opts = opts || {};
  const want = k => String(opts[k] || '').trim().toLowerCase();
  const wHsl = want('hsl'), wOrder = want('order'), wCid = want('cid'), wEmp = want('emp'), wKind = want('kind'), wQ = want('q');
  const since = +opts.since || 0, limit = Math.min(2000, Math.max(1, +opts.limit || 300));
  const rows = [];
  try {
    if (!fs.existsSync(TRAILFILE)) return { rows: [], exists: false };
    const lines = fs.readFileSync(TRAILFILE, 'utf8').split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      const l = lines[i]; if (!l) continue;
      let r = null; try { r = JSON.parse(l); } catch (e) { continue; }
      if (since && (r.ts || 0) < since) break;                        /* file is chronological — stop, don't scan on */
      if (wHsl   && String(r.hsl   || '').toLowerCase() !== wHsl) continue;
      if (wOrder && String(r.order || '').toLowerCase() !== wOrder) continue;
      if (wCid   && String(r.cid   || '').toLowerCase() !== wCid) continue;
      if (wEmp   && String(r.emp   || '').toLowerCase().indexOf(wEmp) < 0) continue;
      if (wKind  && String(r.kind  || '').toLowerCase() !== wKind) continue;
      if (wQ && (String(r.what || '') + ' ' + String(r.who || '') + ' ' + String(r.order || '') + ' ' + String(r.hsl || ''))
                 .toLowerCase().indexOf(wQ) < 0) continue;
      rows.push(r);
      if (rows.length >= limit) return { rows: rows, exists: true, truncated: true };
    }
  } catch (e) { return { rows: rows, exists: true, error: e.message }; }
  return { rows: rows, exists: true, truncated: false };
}
/* 📲 THE PERMANENT TEXT RECORD — hub-data/sms-archive.jsonl, OUTSIDE the synced database.
   Owner, 2026-08-10: close the gap. DB.smsLog is not in SYNC_ID, so every station keeps its own list and the
   hub's copy is whichever station happened to push last. That is how a supply order texted on 8/4 left no
   trace at all, and it means "did we text this customer that their clothes were ready?" cannot be answered
   from any station but the one that sent it. For a business that texts people about their clothes and their
   money, that has to be permanent and complete.
   Deliberately a hub-side append-only file rather than a synced collection: at real volume this is ~20,000
   texts a year, and the whole point of the delta architecture is that the synced DB carries the business, not
   the traffic record. Same shape as activity-archive.jsonl and order-history.jsonl, both proven. Nothing here
   is ever rewritten or trimmed — appended, forever. */
const SMSARCH = path.join(DATADIR, 'sms-archive.jsonl');
function archiveSms(rec){
  try {
    if (!rec) return;
    fs.appendFileSync(SMSARCH, JSON.stringify(rec) + '\n');
  } catch (e) { console.log('  ⚠ could not archive the text: ' + e.message); }
}
/* Read the tail back. Reads the whole file and filters — fine at ~20k lines a year, and honest about it:
   `truncated` tells the caller when it stopped, so a partial answer can never read as a complete one. */
function readSmsArchive(opts){
  opts = opts || {};
  let out = [];
  try {
    if (!fs.existsSync(SMSARCH)) return { rows:[], total:0, exists:false };
    const lines = fs.readFileSync(SMSARCH, 'utf8').split('\n');
    const wantPhone = String(opts.phone || '').replace(/\D/g,'');
    const wantKind  = String(opts.kind || '');
    for (let i = lines.length - 1; i >= 0; i--) {
      const l = lines[i]; if (!l) continue;
      let r = null; try { r = JSON.parse(l); } catch (e) { continue; }
      if (wantPhone && String(r.to || r.from || '').replace(/\D/g,'').indexOf(wantPhone) < 0) continue;   /* inbound rows carry `from`, not `to` */
      if (wantKind && String(r.kind || '') !== wantKind) continue;
      if (opts.cust && String(r.cust || '') !== String(opts.cust)) continue;
      out.push(r);
      if (out.length >= (opts.limit || 200)) return { rows:out, exists:true, truncated:true };
    }
  } catch (e) { return { rows:out, exists:true, error:e.message }; }
  return { rows:out, exists:true, truncated:false };
}
function archiveActivity(acts){
  try {
    if (!Array.isArray(acts) || !acts.length) return;
    let buf = '';
    for (const e of acts){ if(!e) continue; const k=actKey(e); if(ARCH_SEEN.has(k)) continue; ARCH_SEEN.add(k); ARCH_COUNT++;
      buf += JSON.stringify({ ts:e.ts||0, emp:e.emp||'', ws:e.ws||'', store:(e.store==null?'':e.store), type:e.type||'', detail:e.detail||'' }) + '\n'; }
    if (buf) fs.appendFileSync(ARCHFILE, buf);
  } catch(e){ /* archiving must NEVER break a save */ }
}
/* 📜 EVERY ORDER STATE CHANGE THE HUB HAS EVER SEEN — written outside the synced database.
   Owner, 2026-08-06: "never erase... a POS system is at its core, just an event log."

   The app has ~23 places that write an order's status. Instrumenting all of them would still miss the
   transitions that matter most — the ones pushed by a station running an OLD BUILD, which is exactly where
   this shop's damage has come from. So the hub watches instead: it compares the orders it held against the
   orders it just merged and writes down every difference it observes. Nothing in the app can forget to
   call it, and no old build can opt out.

   It lives in its own append-only file, NOT in the synced DB, which means a merge cannot rewrite it, a
   stale push cannot roll it back, and a tombstone cannot remove it. On 2026-08-03 a stale station rolled
   24 orders backwards and flipped 10 already-paid orders to unpaid; there was no trail, and the repair had
   to be reconstructed by hand from bank refs and guesswork. With this, that becomes one pass over a file.

   `back:1` marks a BACKWARDS status move — the thing that is supposed to be impossible. Grep for it. */
function archiveOrderChanges(before, after, device, rev){
  try {
    if (!before || !after || !Array.isArray(after.orders)) return;
    const was = {};
    (before.orders || []).forEach(o => { if (o && o.id) was[o.id] = o; });
    const ts = Date.now();
    let buf = '', backs = 0;
    for (const o of after.orders){
      if (!o || !o.id) continue;
      const base = { ts, rev, dev: device || '', oid: o.id, num: o.number || '' };
      const p = was[o.id];
      if (!p){                                                   // the hub is seeing this order for the first time
        buf += JSON.stringify(Object.assign({}, base, { ev:'created', to:o.status || '',
          pay:o.paymentStatus || '', loc:o.rackLoc || '' })) + '\n';
        continue;
      }
      if ((p.status || '') !== (o.status || '')){
        const back = ((ORD_RANK[o.status] || 0) < (ORD_RANK[p.status] || 0)) ? 1 : 0;
        if (back) backs++;
        buf += JSON.stringify(Object.assign({}, base, { ev:'status', from:p.status || '', to:o.status || '' },
          back ? { back:1 } : {})) + '\n';
      }
      if ((p.paymentStatus || '') !== (o.paymentStatus || ''))   // 10 paid orders silently became unpaid on 8/3
        buf += JSON.stringify(Object.assign({}, base, { ev:'pay', from:p.paymentStatus || '', to:o.paymentStatus || '' })) + '\n';
      if ((p.rackLoc || '') !== (o.rackLoc || ''))               // where the clothes physically are, over time
        buf += JSON.stringify(Object.assign({}, base, { ev:'rack', from:p.rackLoc || '', to:o.rackLoc || '' })) + '\n';
    }
    if (buf) fs.appendFileSync(ORDFILE, buf);
    return backs;
  } catch(e){ return 0; /* the history must NEVER break a save */ }
}

/* read archived events, newest first, optionally filtered; returns at most `limit`. */
function readArchive(opt){
  opt = opt||{};
  const since = (opt.since!=null && opt.since!=='') ? Number(opt.since) : -Infinity;
  const until = (opt.until!=null && opt.until!=='') ? Number(opt.until) : Infinity;
  const type  = opt.type||'';
  const q     = (opt.q||'').toLowerCase();
  const limit = (opt.limit!=null && isFinite(opt.limit)) ? Number(opt.limit) : Infinity;
  const out = [];
  try {
    if (!fs.existsSync(ARCHFILE)) return out;
    const lines = fs.readFileSync(ARCHFILE,'utf8').split(/\r?\n/);
    for (let i=lines.length-1; i>=0; i--){          // newest first
      const ln=lines[i]; if(!ln) continue;
      let e; try{ e=JSON.parse(ln); }catch(_e){ continue; }
      const t=e.ts||0; if(t<since||t>until) continue;
      if(type && e.type!==type) continue;
      if(q){ const hay=((e.type||'')+' '+(e.detail||'')+' '+(e.emp||'')+' '+(e.ws||'')).toLowerCase(); if(hay.indexOf(q)<0) continue; }
      out.push(e); if(out.length>=limit) break;
    }
  } catch(e){}
  return out;
}

/* ---- static file serving (the POS app + logo images) ---- */
const TYPES = { '.html':'text/html; charset=utf-8', '.js':'text/javascript', '.css':'text/css',
  '.json':'application/json', '.webmanifest':'application/manifest+json', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.png':'image/png',
  '.svg':'image/svg+xml', '.ico':'image/x-icon', '.txt':'text/plain', '.bat':'text/plain', '.md':'text/plain' };
function serveStatic(req, res, urlPath){
  let rel = decodeURIComponent(urlPath.split('?')[0]);
  if (rel === '/' ) rel = '/Ozark-POS.html';
  const file = path.join(ROOT, path.normalize(rel).replace(/^([/\\])+/, ''));
  if (!file.startsWith(ROOT)) { send(res, 403, 'Forbidden'); return; }      // no escaping the folder
  // 🔒 SECURITY: only serve public app assets. NEVER the secrets file, the data dir (DB + backups +
  //    opt-out + pickup/feedback queues), the server source, backups, dotfiles, or node_modules — even
  //    though they sit inside this folder. Without this, /hub.env and /hub-data/ozark-db.json are downloadable.
  { const rl = file.toLowerCase(), base = path.basename(rl);
    if (rl.indexOf((DATADIR + path.sep).toLowerCase()) === 0
        || base.indexOf('hub.env') === 0 || base.endsWith('.env')
        || base === 'hub-server.js' || base === 'package.json' || base === 'package-lock.json'
        || base.charAt(0) === '.' || base.endsWith('.bak') || base.endsWith('.md') || base.endsWith('.bat')
        || rl.indexOf('node_modules') >= 0) { send(res, 404, 'Not found'); return; } }
  fs.readFile(file, (err, data) => {
    if (err) { send(res, 404, 'Not found: ' + rel); return; }
    const hdrs = { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control':'no-store' };
    if (path.basename(file).toLowerCase() === 'card.html') Object.assign(hdrs, {
      // the customer card page: lock it down hard (PCI DSS 4.0 6.4.3 posture). Only Fiserv's tokenizer may be
      // framed IN it; nobody may frame IT; no external scripts/styles; fetches only back to us.
      'Content-Security-Policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; frame-src https://*.cardconnect.com; connect-src 'self'; img-src data:; form-action 'none'; base-uri 'none'; frame-ancestors 'none'",
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()'
    });
    res.writeHead(200, hdrs);
    res.end(data);
  });
}

/* PCI DSS 4.0 req 11.6.1 — tamper watch on the customer card page: hash card.html every 6 hours and on
   boot; if it EVER changes, email the owner. A legit deploy triggers one email too (good — it's an audit
   trail); anything unexpected = call before sending more card links. */
const INTEGRITYFILE = path.join(DATADIR, 'page-integrity.json');
function pageWatchCheck(){
  try {
    const fp = path.join(ROOT, 'card.html');
    if (!fs.existsSync(fp)) return;
    const h = crypto.createHash('sha256').update(fs.readFileSync(fp)).digest('hex');
    let st = {}; try { st = JSON.parse(fs.readFileSync(INTEGRITYFILE, 'utf8')); } catch(e){}
    if (!st.cardHtml) { st.cardHtml = h; st.since = Date.now(); writeAtomic(INTEGRITYFILE, JSON.stringify(st)); console.log('[integrity] card.html baseline ' + h.slice(0,12)); return; }
    if (st.cardHtml !== h) {
      const prev = st.cardHtml; st.cardHtml = h; st.changedAt = Date.now(); writeAtomic(INTEGRITYFILE, JSON.stringify(st));
      console.log('[integrity] card.html CHANGED ' + prev.slice(0,12) + ' -> ' + h.slice(0,12));
      if (emailConfigured() && GM.bcc) sendEmail({ to:[GM.bcc], subject:'⚠ Ozark POS: the customer card page changed on the server',
        html:'<div style="font-family:Arial,sans-serif;font-size:15px;color:#222"><p><b>card.html (the page where customers enter cards) just changed on the hub.</b></p><p>If you or a Claude deployed an update in the last few minutes — all good, ignore this.</p><p><b>If nobody deployed anything, treat this seriously:</b> someone may have tampered with the card page. Don\'t send card links until it\'s checked.</p><p style="color:#777;font-size:12px">sha256 ' + prev.slice(0,16) + '… → ' + h.slice(0,16) + '…</p></div>' });
    }
  } catch(e){}
}
setTimeout(pageWatchCheck, 20000); setInterval(pageWatchCheck, 6*3600*1000);

/* ---- online "schedule a pickup" queue (separate file; survives restarts; never touches the synced DB) ---- */
let PICKS = [];
try { if (fs.existsSync(PICKFILE)) { const pr = JSON.parse(fs.readFileSync(PICKFILE, 'utf8')); if (Array.isArray(pr)) PICKS = pr; } } catch (e) {}
function savePicks(){ try { writeAtomic(PICKFILE, JSON.stringify(PICKS)); } catch (e) {} }
let FB = [];
try { if (fs.existsSync(FBFILE)) { const fr = JSON.parse(fs.readFileSync(FBFILE, 'utf8')); if (Array.isArray(fr)) FB = fr; } } catch (e) {}
let CARDLINKS = [];
try { if (fs.existsSync(CARDLINKFILE)) { const cr = JSON.parse(fs.readFileSync(CARDLINKFILE, 'utf8')); if (Array.isArray(cr)) CARDLINKS = cr; } } catch (e) {}
function saveCardlinks(){ try { writeAtomic(CARDLINKFILE, JSON.stringify(CARDLINKS)); } catch (e) {} }
let SMSIN = [];
try { if (fs.existsSync(SMSINFILE)) { const mr = JSON.parse(fs.readFileSync(SMSINFILE, 'utf8')); if (Array.isArray(mr)) SMSIN = mr; } } catch (e) {}
function saveSmsin(){ try { writeAtomic(SMSINFILE, JSON.stringify(SMSIN)); } catch (e) {} }
let SMSOUT = [];
try { if (fs.existsSync(SMSOUTFILE)) { const mo = JSON.parse(fs.readFileSync(SMSOUTFILE, 'utf8')); if (Array.isArray(mo)) SMSOUT = mo; } } catch (e) {}
function saveSmsout(){ try { writeAtomic(SMSOUTFILE, JSON.stringify(SMSOUT)); } catch (e) {} }
/* ⚠️ A FAILED SEND HAS TO NAME THE CUSTOMER, or it can only ever be a global list of phone numbers --
   and the owner asked for "a message line in the history of messages for THAT CUSTOMER". `extra` carries the
   customer id the app already knows and the carrier's own words. */
/* 🔐 IS THE OFF-SITE BACKUP STILL PROVABLY RESTORABLE?
   ⚠️ A CHECK NOBODY CAN SEE IS THE SAME AS NO CHECK. backup-verify.js restores the newest encrypted
   backup weekly and runs the invariants against it; this publishes the answer so a FAILING or a STALE
   check is visible without anyone remembering to look at a log. Staleness matters as much as failure:
   a verify that silently stopped running reads as 'fine' forever, which is the exact shape of the
   watchdog that had quietly stopped watching (8/10).
   ok:null means it has never run — deliberately not 'true'. */
function backupState(){
  try {
    const r = JSON.parse(fs.readFileSync(path.join(DATADIR, 'backup-verify.json'), 'utf8'));
    const days = (Date.now() - (r.at || 0)) / 86400000;
    return { ok: !!r.ok, at: r.at || 0, ageDays: Math.round(days * 10) / 10,
             stale: days > 9,                      /* weekly + a couple of days of slack */
             customers: (r.counts && r.counts.customers) || 0, invariants: r.invariants || '' };
  } catch (e) { return { ok: null, never: true }; }
}
/* 📪 THE ONE DEFINITION OF "the customer never got this". Used by the failed list, the count on
   /api/health and the app's badge, so those three can never disagree about what a failure is. */
function smsFailed(m){
  const st = String((m && m.status) || '');
  return st === 'error' || st === 'no-number' || st.indexOf('blocked-') === 0;
}
function logSmsOut(to, body, kind, status, sid, extra){ try { /* 📲 EVERY send lands in the permanent archive too. This is the ONE funnel all four exit paths
     already share (sent / simulated / queued / blocked), so hooking it here means a fifth path cannot
     be added that forgets — the same reasoning as releaseRack() being greppable from test-money. */
  const _rec = { id:'out'+Date.now().toString(36)+Math.random().toString(36).slice(2,6), ts:Date.now(), dir:'out', to:String(to||''), body:String(body||'').slice(0,600), kind:String(kind||''), status:status||'', sid:sid||'' };
  if (extra && extra.cid) _rec.cid = String(extra.cid);
  if (extra && extra.err) _rec.err = String(extra.err).slice(0, 200);
  archiveSms(_rec); SMSOUT.push(_rec); if (SMSOUT.length > 4000) SMSOUT = SMSOUT.slice(-4000); saveSmsout(); } catch (e) {} }
const CARDLINK_BASE = (process.env.OZARK_CARD_URL || 'https://track.ozarkcleaners.com').replace(/\/+$/, '');   // real-domain host for the customer card page (best cert/referrer for Fiserv's iframe); overridable
function saveFB(){ try { writeAtomic(FBFILE, JSON.stringify(FB)); } catch (e) {} }
/* ---- 🆘 employee support tickets: hub-side queue (SEPARATE file, never in the synced DB) so a station on a stale app version can't wipe them via the whole-DB replace ---- */
const SUPFILE = path.join(DATADIR, 'support-tickets.json');
let SUP = [];
try { if (fs.existsSync(SUPFILE)) { const sr = JSON.parse(fs.readFileSync(SUPFILE, 'utf8')); if (Array.isArray(sr)) SUP = sr; } } catch (e) {}
function saveSUP(){ try { writeAtomic(SUPFILE, JSON.stringify(SUP)); } catch (e) {} }
/* ---- 📵 SMS compliance: opt-out (STOP) store, line-type (landline) screen, quiet hours — protects the sender reputation ---- */
const OPTFILE = path.join(DATADIR, 'sms-optout.json');
let OPTOUT = {};   // last-10-digits -> { ts, reason }
try { if (fs.existsSync(OPTFILE)) { const o = JSON.parse(fs.readFileSync(OPTFILE,'utf8')); if (o && typeof o==='object') OPTOUT = o; } } catch (e) {}
function saveOptout(){ try { writeAtomic(OPTFILE, JSON.stringify(OPTOUT)); } catch (e) {} }
function last10(s){ return String(s||'').replace(/\D/g,'').slice(-10); }   // renamed from p10 — /api/track has a local var p10 that would shadow it
function isOptedOut(to){ return !!OPTOUT[last10(to)]; }
const LINETYPE = {};   // last-10 -> 'mobile'|'landline'|'voip'|... (cached so each number is Looked up only once)
function twLookup(to){ return new Promise(function(resolve){
  const ph = last10(to); if (!ph) { resolve(null); return; }
  if (LINETYPE[ph]) { resolve(LINETYPE[ph]); return; }
  if (!TW.sid || !TW.token) { resolve(null); return; }
  const opts = { method:'GET', host:'lookups.twilio.com', path:'/v2/PhoneNumbers/'+encodeURIComponent('+1'+ph)+'?Fields=line_type_intelligence',
    headers:{ 'Authorization':'Basic '+Buffer.from(TW.sid+':'+TW.token).toString('base64') } };
  const rq = https.request(opts, function(rs){ let b=''; rs.on('data',d=>b+=d); rs.on('end',function(){ try { const j=JSON.parse(b); const lt=(j.line_type_intelligence && j.line_type_intelligence.type) || null; if (lt) LINETYPE[ph]=lt; resolve(lt); } catch(e){ resolve(null); } }); });
  rq.on('error', function(){ resolve(null); }); rq.setTimeout(8000, function(){ rq.destroy(); resolve(null); }); rq.end();
}); }
function inQuietHours(){ try { const h = parseInt(new Date().toLocaleString('en-US',{ timeZone:'America/Chicago', hour12:false, hour:'2-digit' }),10); return (h<8 || h>=21); } catch(e){ return false; } }
const QUEUEFILE = path.join(DATADIR, 'sms-queue.json');   // texts attempted during quiet hours wait here, then auto-send after 8am
let SMSQUEUE = [];
try { if (fs.existsSync(QUEUEFILE)) { const o = JSON.parse(fs.readFileSync(QUEUEFILE,'utf8')); if (Array.isArray(o)) SMSQUEUE = o; } } catch (e) {}
function saveQueue(){ try { writeAtomic(QUEUEFILE, JSON.stringify(SMSQUEUE)); } catch (e) {} }
function smsGatedSend(to, body){ return new Promise(function(resolve){   // optout + landline screen, then send
  if (isOptedOut(to)) { resolve({ ok:false, blocked:'optout', error:'opted out (STOP)' }); return; }
  twLookup(to).then(function(lt){
    if (lt === 'landline') { resolve({ ok:false, blocked:'landline', lineType:lt, error:'landline - can not receive texts' }); return; }
    twSend(to, body).then(function(r){ const j=r.json||{}; if (r.status>=200 && r.status<300 && j.sid) resolve({ ok:true, sid:j.sid, status:j.status, lineType: lt||undefined }); else resolve({ ok:false, error:(j&&(j.message||j.error_message))||('Twilio HTTP '+r.status+(r.error?' · '+r.error:'')) }); });
  });
}); }
function flushQueue(){ try {
  if (!smsConfigured() || inQuietHours() || !SMSQUEUE.length) return;
  const cut = Date.now() - 24*3600*1000; SMSQUEUE = SMSQUEUE.filter(function(m){ return (m.queuedAt||0) > cut; });   // drop anything stale (>1 day)
  const batch = SMSQUEUE.splice(0, 40); saveQueue();
  batch.forEach(function(m){ smsGatedSend(m.to, m.body).then(function(){}); });
} catch(e){} }
setInterval(flushQueue, 5*60*1000);   // every 5 min: once quiet hours end (after 8am), send the held order updates

/* ---- the server ---- */
const server = http.createServer((req, res) => {
  const u = req.url || '/';
  seen.set(deviceOf(req), Date.now());

  if (req.method === 'OPTIONS') { send(res, 204, ''); return; }

  // health / status
  /* 📪 SENDS THAT NEVER REACHED THE CUSTOMER, and are not yet acknowledged.
     ⚠️ 'queued' IS NOT A FAILURE -- it is a text held for quiet hours that goes out at 8am, and counting it
     would light the badge every evening for something working exactly as designed. Nor is 'simulated', which
     only means Twilio keys are not set. A failure is: the carrier refused it, we could not tell whether it
     went, the number is a landline, or they opted out. */
  if (u === '/api/sms/failed' && req.method === 'GET') {
    if (!reqKeyOk(req)) { send(res, 401, { ok:false, error: keyErr() }); return; }
    const bad = SMSOUT.filter(m => smsFailed(m) && !m.ackAt);
    send(res, 200, { ok:true, failed: bad.slice(-200), count: bad.length });
    return;
  }
  /* mark one, or all, as seen. It has to be clearable or it becomes a red badge nobody can turn off, which
     this shop has already learned trains people to ignore the number entirely. */
  if (u === '/api/sms/ack' && req.method === 'POST') {
    if (!reqKeyOk(req)) { send(res, 401, { ok:false, error: keyErr() }); return; }
    let b = ''; req.on('data', c => b += c); req.on('end', () => {
      let p = {}; try { p = JSON.parse(b || '{}'); } catch (e) {}
      const now = Date.now(); let n = 0;
      SMSOUT.forEach(m => { if (!smsFailed(m) || m.ackAt) return; if (p.id && m.id !== p.id) return; m.ackAt = now; m.ackBy = String(p.by || ''); n++; });
      if (n) saveSmsout();
      send(res, 200, { ok:true, acked:n });
    });
    return;
  }
  if (u === '/api/health') { send(res, 200, { ok:true, rev, savedAt, started, clients: clientsRecent(), appRev: appRev(), keyConfigured: !!HUBKEY, reloadAt: RELOAD.at || 0, cfgAt: STATION_CFG_AT || 0, autoLeader: autoLeaderFor(deviceOf(req)), hangups: HANGUPS, backup: backupState(),
      smsFailed: SMSOUT.reduce((n, m) => n + ((smsFailed(m) && !m.ackAt) ? 1 : 0), 0) }); return; }   /* 📪 rides the keyless poll every station already makes, so the badge needs no extra request */   /* 📞 replies nobody was left to hear — see send() */

  // PUBLIC, read-only customer order tracker — NO hub key; sanitized (never the full DB, addresses, payment, or other customers); rate-limited
  if (u.indexOf('/api/track') === 0 && req.method === 'GET') {
    if (!trackRateOk(req)) { send(res, 429, { ok:false, error:'Too many lookups - please wait a minute.' }); return; }
    var q; try { q = new URL(u, 'http://h').searchParams; } catch(e){ q = new (require('url').URLSearchParams || function(){return {get:function(){return '';}};})(); }
    var phone = String((q.get?q.get('phone'):'')||'').replace(/\D/g,'');
    var name = String((q.get?q.get('name'):'')||'').trim().toLowerCase();
    var raw = readDB(); var db = raw ? raw.db : null;
    if (phone.length < 7 || !name || !db) { send(res, 200, { ok:true, found:false, orders:[] }); return; }
    var p10 = phone.slice(-10);
    var c = (db.customers||[]).filter(function(x){ var cp=String(x.phone||'').replace(/\D/g,''); return cp && cp.slice(-10)===p10; })[0];
    if (c) { var full=((c.first||'')+' '+(c.last||'')).toLowerCase(), ln=(c.last||'').toLowerCase(), fn=(c.first||'').toLowerCase(); if(!(full.indexOf(name)>=0 || (ln&&name.indexOf(ln)>=0) || (fn&&name.indexOf(fn)>=0))) c=null; }
    if (!c) { send(res, 200, { ok:true, found:false, orders:[] }); return; }
    var pN={}; (db.prices||[]).forEach(function(p){ pN[p.id]=p.name; });
    var sN={}, sT={}; ((((db.settings||{}).stores))||[]).forEach(function(s){ sN[s.id]=s.name; sT[s.id]=s.tax||0; });
    var cutoff = Date.now() - 60*86400000;
    var orders = (db.orders||[]).filter(function(o){ if(o.customerId!==c.id) return false; if(o.status==='Void'||o.status==='Split') return false; if(o.status==='PickedUp') return (o.pickedAt||0)>=cutoff; return true; })   // 'Split' = a drop-off dissolved into its bag invoices (which ARE listed) — the empty shell must never show as a phantom $0 order
      .sort(function(a,b){ return (b.createdAt||0)-(a.createdAt||0); })
      .map(function(o){
        var sub=0; (o.lines||[]).forEach(function(l){ sub+=(l.price||0); (l.upcharges||[]).forEach(function(z){ sub+=(z.amt||z.amount||0); }); });
        var up=0,tu=0; (o.orderUpcharges||[]).forEach(function(z){ var a=(z.basis==='percent')?sub*((z.amt||0)/100):(z.amt||0); up+=a; if(z.taxable!==false) tu+=a; });
        var rate=sT[o.storeId]||0; var total=Math.round((sub+up+(sub+tu)*rate)*100)/100;
        return { number:o.number, statusLabel:trackStatusLabel(o.status,o.asmAtPlant), store:sN[o.storeId]||'', droppedOff:o.createdAt||null, promise:o.promise||'', total:total,
          items:(o.lines||[]).map(function(l){ return { item:pN[l.priceId]||'Item', desc:[l.color,l.pattern,l.brand].filter(Boolean).join(' '), note:l.desc||'', price:(l.price||0), condition:(l.stains||[]).map(function(s){return {note:s.note||'',notRemoved:!!s.notRemoved};}) }; }) };   // NOTE: garment photos are internal (hub-key gated) — never exposed on the public tracker
      });
    send(res, 200, { ok:true, found:true, name:((c.first||'')+' '+(c.last||'')).trim(), orders:orders });
    return;
  }

  // pull the shared data
  if (u.indexOf('/api/db') === 0 && req.method === 'GET') {
    if (!reqKeyOk(req)) { send(res, 401, { ok:false, error: keyErr() }); return; }
    const raw = readDB();
    /* 🛣 ?since=<n> → only what moved. NO since → the full database, byte-for-byte as before: that is the
       guarantee for any build that predates this, and for syncAdopt, baseline and the 409 retry, where
       correctness matters more than bytes. */
    const q = new URL('http://x' + u).searchParams;
    const sinceRaw = q.get('since');
    if (sinceRaw != null && raw && raw.db) {
      const since = Number(sinceRaw);
      if (!(since >= 0)) { send(res, 200, { ok:false, error:'since must be a number' }); return; }
      const d = deltaSince(raw.db, since);
      send(res, 200, { ok:true, rev, savedAt, appRev: appRev(), since: since, delta: true,
        db: d.db, _tomb: d._tomb, counts: d.counts, changed: d.changed });
      return;
    }
    send(res, 200, { ok:true, rev, savedAt, db: raw ? raw.db : null, appRev: appRev() });
    return;
  }

  // push the shared data
  /* 🔀 HUB-SIDE PER-RECORD MERGE — "update the delta and we are always safe" (owner, 2026-08-04).
     Until now a POST replaced the ENTIRE database file with whatever arrived. So one station running an
     older app build — one whose sync list predates `collections` (added 7/22) — carried an empty copy and
     WIPED 21 needs-collection records plus 3559 deletion tombstones on every push. That is the live
     0↔21 flapping observed 8/5, and the same shape as the 8/3 order rollback.
     The hub now merges instead of replacing. Rules mirror the app's syncMerge so both sides agree:
       • arrays union by key; higher `_t` wins a tie
       • ORDERS obey the one-way law — the further-along status wins whatever `_t` says, unless the
         behind copy carries a NEWER deliberate ↩ back-into-process mark
       • a record MISSING from the incoming copy is KEPT. Absence is not a delete; only a tombstone deletes.
       • activity is append-only: union + dedupe
       • settings.seq takes the MAX so an order number can never be reused
     ⚠️ Deliberate clean-slate resets still work the documented way (bump db.baseline in the hub file +
        restart, so every device ADOPTS rather than pushes its old copy). After a reset, reload any station
        that was mid-session — a straggler holding pre-reset records could otherwise re-add them here. */
  const HUB_KEYS = HUB_KEYS_FOR_SEQ;   /* 🛣 one list, at module scope, so seqStamp and deltaSince use exactly the same collections the merge does */
  /* (the old inline HUB_KEYS list lived here; it is now HUB_KEYS_FOR_SEQ at module scope so seqStamp,
     deltaSince and hubMerge cannot drift apart) */
  const HUB_MAPS = HUB_MAPS_FOR_SEQ;
  const HUB_RANK = { 'Received':1,'Quick':1,'Detailed':2,'In Process':2,'Assembled':3,'Racked':4,'Ready':5,'PickedUp':6,'Split':6,'Void':7 };
  const hubRank = o => (o && HUB_RANK[o.status]) || 0;
  const hubRollbackAt = o => (o && o.backToProcess && o.backToProcess.at) || 0;
  function hubMergeArr(coll, key, mine, theirs, tomb){
    const out = {};
    const take = r => {
      if (!r) return;
      const id = r[key]; if (id == null) return;
      const c = out[id];
      if (!c) { out[id] = r; return; }
      if (coll === 'orders') {
        const rr = hubRank(r), rc = hubRank(c);
        if (rr !== rc) {                                       // ranks disagree → monotonicity decides, not _t
          const behind = (rr < rc) ? r : c, ahead = (rr < rc) ? c : r;
          out[id] = (hubRollbackAt(behind) > hubRollbackAt(ahead)) ? behind : ahead;
          return;
        }
      }
      if (stampNewer(r._t, c._t)) out[id] = r;
    };
    (mine || []).forEach(take); (theirs || []).forEach(take);
    return Object.keys(out).map(k => out[k]).filter(r => { const td = tomb[r[key]]; return !(td && stampScale(td) >= stampScale(r._t)); });
  }
  function hubMerge(cur, inc){
    if (!cur) return inc;
    const out = Object.assign({}, cur, inc);                   // scalars + any key we don't model explicitly
    const tm = {};
    (cur._tomb || []).concat(inc._tomb || []).forEach(t => {
      if (t && t.c != null && t.k != null) { const kk = t.c + '|' + t.k; if (!tm[kk] || (t.t || 0) >= (tm[kk].t || 0)) tm[kk] = { c:t.c, k:t.k, t:t.t || 0 }; }
    });
    out._tomb = Object.keys(tm).map(k => tm[k]);
    Object.keys(HUB_KEYS).forEach(coll => {
      const tomb = {};
      out._tomb.forEach(t => { if (t.c === coll) tomb[t.k] = Math.max(tomb[t.k] || 0, t.t || 0); });
      out[coll] = hubMergeArr(coll, HUB_KEYS[coll], cur[coll] || [], inc[coll] || [], tomb);
    });
    const seen = {}, act = [];
    (inc.activity || []).concat(cur.activity || []).forEach(e => {
      const k = ((e && e.ts) || '') + '|' + ((e && e.type) || '') + '|' + ((e && e.detail) || '') + '|' + ((e && e.emp) || '');
      if (!seen[k]) { seen[k] = 1; act.push(e); }
    });
    act.sort((a, b) => (((b && b.ts) || 0) - ((a && a.ts) || 0)));
    out.activity = act.slice(0, 6000);
    HUB_MAPS.forEach(coll => {
      const a = cur[coll] || {}, b = inc[coll] || {}, m = Object.assign({}, a);
      Object.keys(b).forEach(k => {
        const x = b[k], y = a[k];
        if (y === undefined) m[k] = x;
        else if (x && y && typeof x === 'object' && typeof y === 'object') m[k] = stampNewer(x._t, y._t) ? x : y;
        else m[k] = x;
      });
      out[coll] = m;
    });
    const cs = cur.settings || {}, is = inc.settings || {}, seq = {};
    [cs.seq || {}, is.seq || {}].forEach(sq => Object.keys(sq).forEach(k => { seq[k] = Math.max(seq[k] || 0, sq[k] || 0); }));
    out.settings = Object.assign({}, stampNewer(is._t, cs._t) ? is : cs);
    out.settings.seq = seq;
    return out;
  }
  /* 🚨 OLD-BUILD DETECTION — done HERE, on the server, because an out-of-date station cannot be trusted to
     report on itself. The Hot Springs counter ran a 7/12 build for 3½ weeks and nothing told anybody: its
     sync list predated `collections`, so it wiped 21 records + 3559 tombstones on every push, and its code
     predated the 7/22 expiry fix, so every card charge it sent had no expiry ("Non-numeric expiry", Vince
     7/22 → Arlo 8/5). One stale station caused most of a week's incidents, silently.
     Two signals, and the first is the strong one because it reads the PUSH itself rather than trusting a
     self-reported version:
       • a synced collection is entirely ABSENT from the payload → that code predates the feature
       • the device reports no build at all, or a build that isn't what the hub is serving
     The verdict is written onto the device record (so it syncs to every station and the app can show it) and
     logged to the journal. Re-evaluated on EVERY push, so it clears itself the moment the station updates. */
  /* 🪟 newest page-load time seen per device name, in MEMORY only — it is a live-fleet
     observation, not business data, and it must never enter the synced database. */
  const WINDOW_SEEN = global.__ozarkWindowSeen = (global.__ozarkWindowSeen || {});
  function markPushingDevice(merged, dev, incoming, incomingIsDelta){
    try {
      const rev = appRev();
      /* Only absence of a collection the hub ACTUALLY HAS RECORDS IN is evidence of old code. A current
         build can legitimately omit an array it has nothing in (timeOff, refundRequests…), and flagging
         that would cry wolf at a perfectly healthy station — caught by test-hub.js before it shipped. */
      /* 🛣 PHASE 2: a DELTA push legitimately omits every collection that did not change, so absence proves
         nothing about the station's build. Reading it as evidence would flag every healthy station as running
         old code — the alarm that already cost a day of chasing Hot Springs. Only judge a whole-DB push. */
      const missing = incomingIsDelta ? [] : Object.keys(HUB_KEYS).filter(k => incoming[k] === undefined && ((merged[k] || []).length > 0));
      const d = (merged.devices || [])
        .filter(x => x && (x.name === dev || x.id === dev))
        .sort((a, b) => ((b.lastSeen || 0) - (a.lastSeen || 0)))[0];
      if (!d) return '';
      /* ⚠️ THE STATION IS THE ONLY AUTHORITY ON WHAT BUILD IT IS RUNNING — take its self-report from THIS
         push before judging it.
         Until 2026-08-08 this function bumped d._t above every other record on every push (see the bottom of
         this function), so the hub's copy always won hubMergeArr's _t comparison and a station could never
         update its own appRev or lastSeen again. The detector had frozen the very field it reads. Hot Springs
         was reported "stuck on f52c1a5b67c9 since 8/5 1:51pm" — which is the minute this detector shipped —
         while it was pushing every few seconds and had detailed the whole route that morning. The owner
         closed and reopened the app twice and nothing changed, because nothing could. */
      const inc = (incoming.devices || []).filter(x => x && (x.name === dev || x.id === dev))
        .sort((a, b) => ((b.lastSeen || 0) - (a.lastSeen || 0)))[0];
      /* 🪟 TWO WINDOWS ON ONE MACHINE, CAUGHT AT THE DOOR. Two windows share localStorage, so they report the
         SAME device name but a different PAGE_AT. A push arriving with a pageAt OLDER than the newest this hub
         has already seen from that device is not a guess about build ages -- it is a second window still talking.
         ⚠️ IT ONLY LOGS. Refusing the push would risk a station that silently stops syncing, which is the
         mute-fleet-with-a-green-pill failure; the older window is already stood down by the app's own election
         (shipped 8/10) and what was missing was anybody being TOLD. A window on a build older than that election
         cannot stand itself down, and this is the only thing that would ever notice it. */
      try {
        const incPage = inc && +inc.pageAt || 0;
        if (incPage) {
          WINDOW_SEEN[dev] = WINDOW_SEEN[dev] || { newest: 0, warned: 0 };
          const seen = WINDOW_SEEN[dev];
          /* ⚠️ a FAREWELL is not a rival. tabYield pushes once, deliberately, before it goes dormant, so the
             newest window and the hub both keep what it took. Counting that hand-off would make this tripwire
             cry wolf on the election working -- and a tripwire nobody believes is worth nothing on the day it
             is right. It also must not move `newest`: that timestamp belongs to an OLD page. */
          if (inc.farewell) { /* hand-off, ignore */ }
          else if (incPage > seen.newest) seen.newest = incPage;
          else if (incPage < seen.newest - 1000) {
            /* one line per device per 10 minutes -- a stale window pushes every few seconds and 400 copies of
               one problem must read as one problem */
            if (Date.now() - (seen.warned || 0) > 600000) {
              seen.warned = Date.now();
              console.log('🪟 TWO WINDOWS on "' + dev + '" -- a push arrived from a page loaded ' +
                new Date(incPage).toISOString() + ' while a newer page (' + new Date(seen.newest).toISOString() +
                ') is also active on that machine. The older one should be closed.');
            }
          }
        }
      } catch (e) {}
      if (inc) {
        if (inc.appRev) d.appRev = inc.appRev;                                  // what it says it is running
        /* 📆 when that PAGE was loaded. The single most useful fact about a stale station and the one we kept
           having to infer: a window open since Aug 5 is a window somebody left open, not a broken updater. */
        if (inc.pageAt) d.pageAt = inc.pageAt;
        if ((inc.lastSeen || 0) > (d.lastSeen || 0)) d.lastSeen = inc.lastSeen;
        if (inc.name && !d.name) d.name = inc.name;
        if (inc.lastUser) d.lastUser = inc.lastUser;
      }
      d.hubPushAt = Date.now(); d.hubRev = rev;
      /* Being one build behind is NORMAL for a few minutes: stations auto-update only when idle, so every
         deploy briefly puts everyone behind. Alarming on that would make this alert worthless within a day
         — the same cry-wolf failure as the old hub watchdog. So: track WHEN a station first fell behind and
         only raise the alarm if it stays behind, or if the push itself proves the code is genuinely ancient. */
      const GRACE = 45 * 60 * 1000;                       // 45 min of auto-update grace before we call it stale
      if (d.appRev && d.appRev === rev) { delete d.behindSince; }
      else if (!d.behindSince) { d.behindSince = Date.now(); }
      const behindFor = d.behindSince ? (Date.now() - d.behindSince) : 0;
      const why = [];
      if (missing.length) why.push('its push carried no ' + missing.join('/') + ' — that code predates the feature');
      if (!d.appRev)      why.push('it never reports a build (too old to)');
      else if (d.appRev !== rev && behindFor > GRACE)
        why.push('stuck on ' + d.appRev + ' for ' + Math.round(behindFor / 60000) + ' min — hub is serving ' + rev + ', so auto-update is not taking');
      if (why.length) { d.oldBuild = true; d.oldBuildWhy = why.join('; '); d.oldBuildAt = Date.now(); }
      else { delete d.oldBuild; delete d.oldBuildWhy; delete d.oldBuildAt; }
      // informational only — the Devices tab shows "updating…", nothing alarms
      if (d.appRev && d.appRev !== rev) d.updatingSince = d.behindSince; else delete d.updatingSince;
      // 🕐 stamp ABOVE whatever the DB already holds. Devices now issue hybrid-logical-clock stamps
      //    (ms×1000+counter, ~1e15); a raw Date.now() here (~1e12) would always lose the tie-break and the
      //    verdict would never stick. Deriving from the max keeps this correct on either scale.
      let mx = 0;
      Object.keys(HUB_KEYS).forEach(k => (merged[k] || []).forEach(r => { if (r && +r._t > mx) mx = +r._t; }));
      d._t = mx + 1;
      return d.oldBuild ? ('  🚨 OLD BUILD — ' + (d.name || dev) + ': ' + d.oldBuildWhy) : '';
    } catch (e) { return ''; }
  }
  if (u === '/api/db' && req.method === 'POST') {
    if (!reqKeyOk(req)) { send(res, 401, { ok:false, error: keyErr() }); return; }
    let body = '';
    req.on('data', c => { body += c; if (body.length > 60e6) req.destroy(); }); // 60MB guard
    req.on('end', () => {
      let parsed; try { parsed = JSON.parse(body); } catch (e) { send(res, 400, { ok:false, error:'bad JSON' }); return; }
      /* 🛣 PHASE 2 — A DELTA IS NOT A DATABASE, and must not be judged as one. looksLikeDB() demands settings,
         orders, customers and prices, so a push carrying only the one payment that changed would be rejected
         422 — the whole point of the delta. A delta gets its own check instead, and a STRICTER one: every key
         must be a collection the hub actually keys, a map it merges, or a known scalar. Junk is refused rather
         than merged, which whole-DB pushes never bothered to verify. */
      const isDelta = parsed.delta === true;
      const db = sanitizeDB(parsed.db || parsed);
      if (isDelta) {
        const ALLOWED = Object.keys(HUB_KEYS_FOR_SEQ).concat(HUB_MAPS_FOR_SEQ).concat(['settings','baseline','seq','_tomb','activity']);
        const keys = Object.keys(db || {});
        if (!db || typeof db !== 'object' || !keys.length) { send(res, 422, { ok:false, error:'empty delta' }); return; }
        const unknown = keys.filter(k => ALLOWED.indexOf(k) < 0);
        if (unknown.length) { send(res, 422, { ok:false, error:'delta carries unknown keys: ' + unknown.join(', ') }); return; }
      } else if (!looksLikeDB(db)) { send(res, 422, { ok:false, error:'not a valid Ozark DB' }); return; }
      try { const _cur = readDB(); const _bl = _cur && _cur.db ? _cur.db.baseline : undefined; if (_bl !== undefined) db.baseline = _bl; } catch(e){}   // 🧱 baseline is hub-authoritative: a device can never erase or roll back the clean-slate marker
      if (parsed.baseRev == null || parsed.baseRev !== rev) {       // 🔒 baseRev is MANDATORY: reject a missing or stale base (incl. unload beacons) so a behind device can never overwrite/roll back newer hub data
        const cur = readDB();
        send(res, 409, { ok:false, conflict:true, rev, db: cur ? cur.db : null });
        return;
      }
      // 🔀 merge into what the hub already holds — never let this push DELETE what it simply doesn't know about
      let merged = db, rescued = '', _pre = null, _preKeys = null;
      try {
        const _c = readDB();
        _pre = _c && _c.db;                                       // 📜 kept for archiveOrderChanges — what the hub held BEFORE this push
        _preKeys = kseqSnapshot(_pre);   /* 🗝 as TEXT, before hubMerge writes through the same objects */
        const _future = stampSanitize(db);   /* ⚠️ a record cannot have been edited in the future */
        const _blobs = blobGuard(db);        /* 📸 image bytes never enter the synced database — filed and referenced instead */
        const _shape = shapeGuard(db);       /* 🧩 a record missing a list it must have gets it, rather than taking a screen down */
        if (_shape.length) console.log('  🧩 filled ' + _shape.length + ' missing list(s) from ' + deviceOf(req) +
          ': ' + _shape.slice(0, 4).join(' · ') + (_shape.length > 4 ? ' · …' : ''));
        if (_blobs.length) console.log('  📸 moved ' + _blobs.length + ' inline photo(s) out of the database from ' + deviceOf(req) +
          ': ' + _blobs.slice(0, 3).join(' · '));
        if (_future.length) console.log('  ⏰ CLAMPED ' + _future.length + ' future-dated stamp(s) from ' + deviceOf(req) +
          ' — that station\'s clock is wrong. ' + _future.slice(0, 3).join(' · ') + (_future.length > 3 ? ' · …' : ''));
        merged = hubMerge(_pre, db);
        const gained = [];
        /* 🛣 PHASE 2: "merged minus incoming" is the whole point of a delta, so this rescue counter would read
           🛟 kept customers+4909 on every healthy push and drown the log it exists to make readable. */
        if (!isDelta) {
          Object.keys(HUB_KEYS).forEach(k => { const d = ((merged[k] || []).length) - ((db[k] || []).length); if (d > 0) gained.push(k + '+' + d); });
          const dt = ((merged._tomb || []).length) - ((db._tomb || []).length); if (dt > 0) gained.push('_tomb+' + dt);
        }
        if (gained.length) rescued = '  🛟 kept ' + gained.join(' ') + ' this device would have dropped';
      } catch (e) { merged = db; console.log('  ⚠ hub merge failed, storing the push as-is: ' + e.message); }
      if (!looksLikeDB(merged)) { send(res, 500, { ok:false, error:'merge produced an invalid DB — nothing saved' }); return; }
      /* 🔬 A TARGETED WATCH, because inference has run out. Brittany charged Nina Carthew $39.42 at 3:43 PM and
         says "it's not saving": the ledger row, the payment and the activity line all reached the hub (all three
         are array ADDS) while her customer record stayed on an 8/05 stamp with cards:0 — even though a card was
         plainly charged. So updated EXISTING records are not arriving from that station while new rows are.
         Guessing from the hub has not closed it, so log exactly what each push carries for the watched ids: is
         the record present at all, what balance, what stamp, how many cards. One push from her station answers
         it. Costs one console line per push and reads nothing it does not already have. */
      try {
        const WATCH_CUST = (process.env.OZARK_WATCH_CUST || 'rt_OB4566_14').split(',').map(x => x.trim()).filter(Boolean);
        if (WATCH_CUST.length) {
          WATCH_CUST.forEach(wid => {
            const inc = ((db.customers || []).filter(c => c && c.id === wid))[0];
            const cur = ((merged.customers || []).filter(c => c && c.id === wid))[0];
            const show = c => c ? ('bal=' + (c.balance == null ? '?' : c.balance) + ' _t=' + c._t + ' cards=' + ((c.cards || []).length)) : 'ABSENT';
            console.log('  🔬 watch ' + wid + '  from ' + deviceOf(req) + (isDelta ? ' (delta)' : ' (full)') +
              '  incoming[' + show(inc) + ']  →  stored[' + show(cur) + ']' +
              (inc && cur && inc.balance !== cur.balance ? '   ⚠ REJECTED: the incoming balance did not win' : ''));
          });
        }
      } catch (e) {}
      const staleWarn = markPushingDevice(merged, deviceOf(req), db, isDelta);   // 🚨 judge the build from the PUSH, every time
      /* ⚠️ A REVISION NUMBER IS ONLY SPENT ONCE THE WORK IS DURABLE.
         This used to be `rev += 1` right here, with a full JSON.stringify of the database between it and the
         delta-log append. Anything that threw in that window — or a restart landing in it — burnt the number:
         no log line, no snapshot, nothing ever committed at that revision, and the counter simply moved on.
         Measured on live data 2026-08-11: five such gaps (19377, 19443, 19509, 19535, 19543-44), every one
         immediately before a forced checkpoint, which is what the first push after a restart writes. There were
         18 restarts that day.
         The damage was not lost data — those revisions never existed — it was that hub-replay.js cannot tell a
         NUMBER THAT WAS NEVER USED from a LOG LINE THAT WENT MISSING, so it refused to rebuild and Phase 4's
         whole recovery guarantee read as broken. A gap has to mean something.
         So the number is now provisional until the log line is on disk. Nothing else in the request can consume
         it, and a push that dies in the window leaves the counter exactly where it was for the next one. */
      const nextRev = rev + 1, nextSavedAt = Date.now();
      seqStamp(_pre, merged, nextRev, _preKeys);   /* 🛣 mark what THIS revision changed, so a station can ask for only that */
      mirrorRemember(nextRev, merged);   // 🪞 what the hub itself holds at this revision — the thing every station is compared against
      const wrapped = JSON.stringify({ __meta:{ rev: nextRev, savedAt: nextSavedAt, device: deviceOf(req) }, db: merged });
      try {
        /* 🛣 PHASE 4: the traffic record FIRST, so the change is durable before the snapshot is touched. */
        const _dChanged = deltaLogAppend(merged, nextRev, nextSavedAt, deviceOf(req));
        /* ⚠️ THE LOG IS THE COMMIT. If it did not land, this revision did not happen: refuse the push rather
           than advance the counter past a revision nobody can ever reconstruct. The station keeps its work and
           retries — the merge is idempotent, so a retry costs nothing. */
        if (_dChanged < 0) throw new Error('delta log append failed — refusing to advance the revision');
        rev = nextRev; savedAt = nextSavedAt;   /* spent, and only now */
        try { if (fs.existsSync(DBFILE)) fs.copyFileSync(DBFILE, BAKFILE); } catch (e) {}   // keep previous as .bak
        writeAtomic(DBFILE, wrapped);
        /* a timestamped full snapshot is now a CHECKPOINT on an interval, not one per push. Every revision
           between checkpoints is recoverable by replaying the log — see hub-replay.js. */
        let _ckpt = '';
        if (ckptDue(rev, savedAt)) {
          writeAtomic(path.join(BACKUPS, 'ozark-' + stamp(savedAt) + '.json'), wrapped);
          rotateBackups();
          lastCkptRev = rev; lastCkptAt = savedAt;
          _ckpt = '  🧭 checkpoint';
        }
        archiveActivity(merged.activity);              // 🗄 append new audit events to the permanent archive (never throws)
        const _backs = archiveOrderChanges(_pre, merged, deviceOf(req), rev);   // 📜 every order state change, forever, outside the synced DB
        send(res, 200, { ok:true, rev, savedAt });
        console.log('  ✓ saved rev ' + rev + '  by ' + deviceOf(req) + (isDelta ? '  \u0394' + Object.keys(db).length + ' coll/' + Buffer.byteLength(body) + 'B' : '  FULL/' + Buffer.byteLength(body) + 'B') + '  (' + merged.orders.length + ' orders, ' + merged.customers.length + ' customers)' + rescued + staleWarn + _ckpt + (_future.length ? '  ⏰ ' + _future.length + ' future stamp(s) clamped' : '') + (_blobs.length ? '  📸 ' + _blobs.length + ' photo(s) filed out of the db' : '') + (_dChanged >= 0 ? '' : '  ⚠ DELTA LOG WRITE FAILED') +
          (_backs ? '  ⏪ ' + _backs + ' order(s) moved BACKWARDS — see order-history.jsonl' : ''));
      } catch (e) { send(res, 500, { ok:false, error:e.message }); }
    });
    return;
  }

  // 🗄 permanent activity archive (audit trail) — newest first, filterable. ?format=csv downloads the full matching set.
  if (u.indexOf('/api/activity') === 0 && req.method === 'GET') {
    if (!reqKeyOk(req)) { send(res, 401, { ok:false, error: keyErr() }); return; }
    let q; try { q = new URL(u, 'http://h').searchParams; } catch(e){ q = null; }
    const get = k => (q && q.get(k)) || '';
    const fmt = get('format');
    const events = readArchive({ since:get('since'), until:get('until'), type:get('type'), q:get('q'), limit: (fmt==='csv') ? Infinity : (Number(get('limit'))||50000) });
    if (fmt === 'csv') {
      const esc = s => '"' + String(s==null?'':s).replace(/"/g,'""') + '"';
      let csv = 'Time,Employee,Workstation,Store,Action,Details\n';
      for (const e of events){ csv += [ new Date(e.ts).toLocaleString(), e.emp, e.ws, e.store, e.type, e.detail ].map(esc).join(',') + '\n'; }
      res.writeHead(200, { 'Access-Control-Allow-Origin':'*', 'Content-Type':'text/csv; charset=utf-8', 'Content-Disposition':'attachment; filename="ozark-activity-full.csv"', 'Cache-Control':'no-store' });
      res.end(csv); return;
    }
    send(res, 200, { ok:true, total: ARCH_COUNT, returned: events.length, events: events });
    return;
  }

  // 📷 garment photos stored as FILES on the hub (never in the synced DB, so the app stays light).
  //    upload: POST /api/photo  {data:"data:image/jpeg;base64,..."} -> {id}.  serve: GET /api/photo/<id> (hub-key).
  if (u === '/api/photo' && req.method === 'POST') {
    if (!reqKeyOk(req)) { send(res, 401, { ok:false, error:keyErr() }); return; }
    let body = ''; req.on('data', c => { body += c; if (body.length > 8e6) req.destroy(); });   // 8MB guard
    req.on('end', () => {
      let p; try { p = JSON.parse(body || '{}'); } catch(e){ send(res, 400, { ok:false, error:'bad JSON' }); return; }
      const m = /^data:image\/(jpeg|jpg|png);base64,(.+)$/i.exec(String(p.data||''));
      if (!m) { send(res, 200, { ok:false, error:'not a base64 image' }); return; }
      const ext = /png/i.test(m[1]) ? 'png' : 'jpg';
      const id = 'ph_' + Date.now().toString(36) + Math.random().toString(36).slice(2,9) + '.' + ext;
      try { fs.mkdirSync(PHOTODIR, { recursive:true }); fs.writeFileSync(path.join(PHOTODIR, id), Buffer.from(m[2], 'base64')); send(res, 200, { ok:true, id }); }
      catch(e){ send(res, 500, { ok:false, error: e.message }); }
    });
    return;
  }
  if (u.indexOf('/api/photo/') === 0 && req.method === 'GET') {
    if (!reqKeyOk(req)) { send(res, 401, { ok:false, error:keyErr() }); return; }
    const id = path.basename(decodeURIComponent(u.split('?')[0].slice('/api/photo/'.length)));   // basename = no path traversal
    if (!/^ph_[a-z0-9]+\.(jpg|png)$/i.test(id)) { send(res, 404, 'not found'); return; }
    fs.readFile(path.join(PHOTODIR, id), (err, data) => {
      if (err) { send(res, 404, 'not found'); return; }
      res.writeHead(200, { 'Content-Type': /png$/i.test(id) ? 'image/png' : 'image/jpeg', 'Access-Control-Allow-Origin':'*', 'Cache-Control':'private, max-age=86400' });
      res.end(data);
    });
    return;
  }
  if (u.indexOf('/api/photo/') === 0 && (req.method === 'DELETE' || req.method === 'POST')) {
    if (!reqKeyOk(req)) { send(res, 401, { ok:false, error:keyErr() }); return; }
    const id = path.basename(decodeURIComponent(u.split('?')[0].slice('/api/photo/'.length)).replace(/\/delete$/,''));
    if (/^ph_[a-z0-9]+\.(jpg|png)$/i.test(id)) { try { fs.unlinkSync(path.join(PHOTODIR, id)); } catch(e){} }
    send(res, 200, { ok:true });
    return;
  }

  // friendly hub status page
  if (u === '/hub' || u === '/hub/') {
    const ips = lanIPs().map(i => 'http://' + i + ':' + PORT + '/Ozark-POS.html').join('<br>');
    send(res, 200,
      '<!doctype html><meta charset=utf-8><title>Ozark Plant Hub</title>' +
      '<body style="font-family:Segoe UI,Arial;background:#0f1b2d;color:#eaf1fb;padding:30px;line-height:1.5">' +
      '<h1 style="margin:0 0 6px">🏭 Ozark Plant Hub — running</h1>' +
      '<p style="color:#8fb3df">Open the POS on any counter PC or your phone (same WiFi):</p>' +
      '<p style="font-size:18px"><b>' + ips + '</b></p>' +
      '<p style="color:#8fb3df;font-size:13px">↑ Same-WiFi devices use an address above. For the <b>other store</b> or the <b>route phone</b>, use this PC\'s <b>Tailscale</b> address (starts with 100.x.x.x) on port ' + PORT + '. See HUB-NETWORK-SETUP.md.</p>' +
      '<hr style="border-color:#24364f">' +
      '<p>Saved revisions: <b>' + rev + '</b> &nbsp;·&nbsp; Last save: <b>' + (savedAt ? new Date(savedAt).toLocaleString() : 'none yet') + '</b>' +
      ' &nbsp;·&nbsp; Devices seen (last min): <b>' + clientsRecent() + '</b></p>' +
      '<p>Card processor: <b>' + (hcConfigured() ? '🟢 Helcim' : sqConfigured() ? ('🟢 Square ' + SQ.env.toUpperCase() + ' — location ' + SQ.location) : cpConfigured() ? ('🟢 CardPointe ' + CP.env.toUpperCase() + ' — site ' + CP.site + ', MID ' + CP.mid) : (PAYKEY ? '🟢 key detected' : '⚪ none set — Simulator / Manual only')) + '</b></p>' +
      '<p>Hub access key: <b>' + (HUBKEY ? '🔒 required — only devices with the key can sync' : '⛔ NONE SET — sync/SMS/email/payments are REFUSING all requests (fail-closed). Set OZARK_HUB_KEY in hub.env and restart.') + '</b></p>' +
      '<p>Texting (Twilio): <b>' + (smsConfigured() ? '🟢 connected — From ' + TW.from : '⚪ not set — texts simulate (set OZARK_TWILIO_SID / TOKEN / FROM)') + '</b></p>' +
      '<p>Email (SMTP): <b>' + (emailConfigured() ? '🟢 connected — sends as ' + GM.user + (relayConfigured() ? ' via the SiteGround relay' : ' via ' + smtpHost() + ':' + GM.port) + (GM.bcc ? ' · copies to ' + GM.bcc : '') + (GM.replyTo ? ' · replies to ' + GM.replyTo : '') : '⚪ not set — statements can\'t email (set OZARK_SMTP_USER / OZARK_SMTP_PASS)') + '</b></p>' +
      '<p style="color:#8fb3df">Data file: ' + DBFILE + '<br>Backups: ' + BACKUPS + ' (also copied off-site by OneDrive)</p>' +
      '</body>', { 'Content-Type':'text/html; charset=utf-8' });
    return;
  }

  // ---- write integration keys to the hub (owners-only panel relays here). Stores in hub.env + applies LIVE. Never echoes a secret back. ----
  if (u === '/api/config' && req.method === 'POST') {
    if (!reqKeyOk(req)) { send(res, 401, { ok:false, error:keyErr() }); return; }
    let body = '';
    req.on('data', c => { body += c; if (body.length > 1e5) req.destroy(); });
    req.on('end', () => {
      let p = {}; try { p = JSON.parse(body || '{}'); } catch (e) {}
      const upd = {};
      if (p.helcimToken)    { HC.token = p.helcimToken;       upd.OZARK_HELCIM_TOKEN = p.helcimToken; }
      if (p.twilioSid)      { TW.sid = p.twilioSid;           upd.OZARK_TWILIO_SID = p.twilioSid; }
      if (p.twilioToken)    { TW.token = p.twilioToken;       upd.OZARK_TWILIO_TOKEN = p.twilioToken; }
      if (p.twilioFrom)     { TW.from = p.twilioFrom;         upd.OZARK_TWILIO_FROM = p.twilioFrom; }
      if (p.squareToken)    { SQ.token = p.squareToken;       upd.OZARK_SQUARE_TOKEN = p.squareToken; }
      if (p.squareLocation) { SQ.location = p.squareLocation; upd.OZARK_SQUARE_LOCATION = p.squareLocation; }
      if (p.cpSite)         { CP.site = p.cpSite;             upd.OZARK_CARDPOINTE_SITE = p.cpSite; }
      if (p.cpMid)          { CP.mid  = p.cpMid;              upd.OZARK_CARDPOINTE_MID  = p.cpMid; }
      if (p.cpUser)         { CP.user = p.cpUser;             upd.OZARK_CARDPOINTE_USER = p.cpUser; }
      if (p.cpPass)         { CP.pass = p.cpPass;             upd.OZARK_CARDPOINTE_PASS = p.cpPass; }
      if (p.cpEnv)          { CP.env  = (p.cpEnv||'uat').toLowerCase(); upd.OZARK_CARDPOINTE_ENV = CP.env; }
      const _eUser = p.smtpUser || p.gmailUser, _ePass = p.smtpPass || p.gmailAppPw, _eFrom = p.smtpFrom || p.gmailFrom;
      if (_eUser)           { GM.user = _eUser;                        upd.OZARK_SMTP_USER = _eUser; }
      if (_ePass)           { GM.pass = normPass(_ePass, GM.user);     upd.OZARK_SMTP_PASS = GM.pass; }
      if (_eFrom)           { GM.fromName = _eFrom;                    upd.OZARK_SMTP_FROM = _eFrom; }
      if (p.smtpHost)       { GM.host = String(p.smtpHost).trim();     upd.OZARK_SMTP_HOST = GM.host; }
      if (p.smtpPort)       { GM.port = Number(p.smtpPort) || 465;     upd.OZARK_SMTP_PORT = String(GM.port); }
      if (p.smtpReplyTo != null) { GM.replyTo = String(p.smtpReplyTo).trim(); upd.OZARK_SMTP_REPLYTO = GM.replyTo; }   // replies go here (e.g. your Gmail)
      if (p.smtpBcc != null)     { GM.bcc = String(p.smtpBcc).trim();         upd.OZARK_SMTP_BCC = GM.bcc; }             // owner copy of every send (e.g. your Gmail)
      const saved = Object.keys(upd).length ? writeHubEnv(upd) : true;
      send(res, 200, { ok: saved, persisted: saved, configured: payConfigured() });   // booleans only — never the values
    });
    return;
  }

  // ---- Line-type lookup (cell vs landline) so the POS can flag landlines BEFORE ever texting them.
  //      Twilio Lookup line-type-intelligence. Graceful: if Twilio isn't configured yet, returns
  //      lineType:null (unknown) instead of erroring, so the POS just leaves the number "unchecked". ----
  if (u.indexOf('/api/sms/lookup') === 0 && req.method === 'GET') {
    if (!reqKeyOk(req)) { send(res, 401, { ok:false, error:keyErr() }); return; }
    var lq; try { lq = new URL(u, 'http://h').searchParams; } catch(e){ lq = null; }
    var lphone = lq ? String(lq.get('phone') || '') : '';
    if (last10(lphone).length !== 10) { send(res, 200, { ok:false, error:'need a 10-digit number' }); return; }
    if (!TW.sid || !TW.token) { send(res, 200, { ok:true, lineType:null, configured:false }); return; }
    twLookup(lphone).then(function(lt){ send(res, 200, { ok:true, lineType: lt || null, configured:true, optedOut: isOptedOut(lphone) }); });
    return;
  }

  // ---- SMS send (the Twilio secret lives HERE on the hub, never in the browser) ----
  /* 🔄 POST /api/reload-all — ask every station to reload as soon as it can see this. */
  /* ══ 🛠 REMOTE STATION SETTINGS ════════════════════════════════════════════════════════════════════════
     Owner, 2026-08-15: "do we have a backdoor to actually work on these systems now at each station without
     having to be at each computer?" Every friction point of the week — Assembly's station id, a printer map
     that had to be read off a physical slip, a Chrome window left open — needed somebody standing at the PC.

     ⚠️ THIS IS A CONTROL CHANNEL INTO EVERY TILL, SO IT IS DELIBERATELY NOT A GENERAL ONE. It carries a FIXED
     VOCABULARY of settings and nothing else: no command to run, no file to fetch, no code. The owner chose
     that level knowingly over "run this on that PC", which would have made one leaked hub key equal to full
     control of every machine in the business, including the ones that take cards.
     ⚠️ hubUrl AND hubKey CAN NEVER BE SET THIS WAY. Repointing a station at another hub is how you would
     walk out with the whole shop, so those two are refused here AND again in the shell, and an assertion in
     test-hub pins the refusal. Two locks, because this one matters more than the rest.
     ⚠️ It lives on the HUB, not in the synced database. Anything in the DB is mirrored to every station, so a
     single compromised till could rewrite another till's configuration. Here the hub is the only writer and
     a station can read only its own row.
     Every change is appended to station-config-log.jsonl — who, what, when — and the station reports back
     what it actually applied, because "I asked for it" and "it happened" are different facts. */
  if (u.split('?')[0] === '/api/station-config' && req.method === 'GET') {
    if (!reqKeyOk(req)) { send(res, 401, { ok:false, error:keyErr() }); return; }
    /* ⚠️ `u` is req.url, query string and all — an exact === match silently never fires once a caller adds
       ?id=, which is exactly how this endpoint appeared to return nothing on its first test run. */
    const q = new URL('http://x' + u).searchParams;
    const id = String(q.get('id') || '').trim();
    const all = readStationConfig();
    if (!id) { send(res, 200, { ok:true, stations: all, cfgAt: STATION_CFG_AT }); return; }
    send(res, 200, { ok:true, id: id, want: (all[id] && all[id].want) || null,
                     restartAt: (all[id] && all[id].restartAt) || 0,
                     recacheAt: (all[id] && all[id].recacheAt) || 0, cfgAt: STATION_CFG_AT });
    return;
  }
  if (u.split('?')[0] === '/api/station-config' && req.method === 'POST') {
    if (!reqKeyOk(req)) { send(res, 401, { ok:false, error:keyErr() }); return; }
    let body=''; req.on('data', c => { body += c; if (body.length > 2e5) req.destroy(); });
    req.on('end', () => {
      let p={}; try { p = JSON.parse(body || '{}'); } catch(e){ send(res, 400, { ok:false, error:'bad json' }); return; }
      const id = String(p.id || '').trim();
      if (!/^WS-[A-Za-z0-9-]+$/.test(id)) { send(res, 400, { ok:false, error:'a station id like WS-… is required' }); return; }
      const all = readStationConfig();
      const row = all[id] = all[id] || {};

      if (p.codeSha) {
        /* 🔎 the station says which app it is actually serving; the hub knows what it handed out */
        const mine = appRev();
        const theirs = String(p.codeSha).slice(0, 12);
        const ok = (theirs === mine);
        CODE_SEEN[id] = { sha: theirs, at: Date.now(), ok: ok };
        if (!ok) {
          row.codeMismatchAt = Date.now(); row.codeSha = theirs;
          writeStationConfig(all, { id, kind: 'code-mismatch', running: theirs, serving: mine });
          console.log('  🔎 ⚠ ' + id + ' is running app ' + theirs + ' but the hub serves ' + mine +
            ' — logged. It will re-fetch and reload; that repairs a bad cache and is NOT proof of tampering.');
        } else if (row.codeMismatchAt) {
          delete row.codeMismatchAt; delete row.codeSha;
          writeStationConfig(all, { id, kind: 'code-ok', running: theirs });
        }
        send(res, 200, { ok:true, match: ok, serving: mine });
        return;
      }
      if (p.applied) {
        /* the station reporting back — what it actually did, which is a different fact from what was asked */
        row.appliedAt = Date.now();
        row.applied = p.applied;
        row.appliedBy = String(p.by || deviceOf(req) || '').slice(0, 60);
        if (p.error) row.lastError = String(p.error).slice(0, 300);
        else delete row.lastError;
        writeStationConfig(all, { id, kind: 'applied', detail: p.applied, error: p.error || '' });
        console.log('  🛠 ' + id + ' applied: ' + JSON.stringify(p.applied).slice(0, 160));
        send(res, 200, { ok:true });
        return;
      }

      const want = (p.want && typeof p.want === 'object') ? p.want : null;
      const refused = [];
      const clean = {};
      if (want) Object.keys(want).forEach(k => {
        if (!STATION_SETTABLE[k]) { refused.push(k); return; }
        clean[k] = want[k];
      });
      if (refused.length) {
        /* ⚠️ NAME WHAT WAS REFUSED rather than quietly dropping it — a setting that vanishes silently is how
           somebody concludes the channel is broken, or worse, assumes it took. */
        console.log('  ⛔ station-config REFUSED ' + refused.join(', ') + ' for ' + id +
          ' — only ' + Object.keys(STATION_SETTABLE).join('/') + ' may be set remotely');
      }
      if (want) row.want = Object.assign({}, row.want || {}, clean);
      if (p.restart) row.restartAt = Date.now();
      if (p.recache) row.recacheAt = Date.now();
      row.by = String(p.by || deviceOf(req) || '').slice(0, 60);
      row.at = Date.now();
      writeStationConfig(all, { id, kind: 'want', detail: clean, restart: !!p.restart, recache: !!p.recache, by: row.by });
      send(res, 200, { ok:true, id, want: row.want || null, refused,
        note: refused.length ? ('refused (never settable remotely): ' + refused.join(', ')) : '' });
    });
    return;
  }
  if (u === '/api/reload-all' && req.method === 'POST') {
    if (!reqKeyOk(req)) { send(res, 401, { ok:false, error:keyErr() }); return; }
    let body=''; req.on('data', c => { body += c; if (body.length > 1e4) req.destroy(); });
    req.on('end', () => {
      let p={}; try { p = JSON.parse(body || '{}'); } catch(e){}
      RELOAD = { at: Date.now(), by: String(p.by || deviceOf(req) || '').slice(0,60), note: String(p.note || '').slice(0,200) };
      saveReload();
      console.log('  🔄 RELOAD REQUESTED by ' + (RELOAD.by || '?') + ' — every station whose page is older than now will update on its next 4s poll');
      send(res, 200, { ok:true, at: RELOAD.at });
    });
    return;
  }
  if (u === '/api/reload-all' && req.method === 'GET') {
    if (!reqKeyOk(req)) { send(res, 401, { ok:false, error:keyErr() }); return; }
    send(res, 200, { ok:true, at: RELOAD.at || 0, by: RELOAD.by || '', note: RELOAD.note || '' });
    return;
  }
  /* 🐾 POST /api/trail — a batch of taps from one station. Batched on purpose: one small request a minute
     instead of a push per tap, because logEvent()->saveDB()->push is exactly the load we spent today removing.
     sendBeacon cannot set headers, so ?k= is accepted for that one path — it carries taps, never money. */
  /* 🩹 a station reporting its own failure. Hub-key gated like the trail; sendBeacon carries the key in the
     query because it cannot set a header, and this is a stack trace, not money. */
  if (u.indexOf('/api/client-error') === 0 && req.method === 'POST') {
    let q; try { q = new URL(u, 'http://h').searchParams; } catch (e) { q = null; }
    const qk = q && q.get('k');
    if (!reqKeyOk(req) && !(qk && OZARK_KEY_OK(qk))) { send(res, 401, { ok: false, error: keyErr() }); return; }
    let body = '';
    req.on('data', c => { body += c; if (body.length > 400000) req.destroy(); });
    req.on('end', () => {
      let j = null; try { j = JSON.parse(body || '{}'); } catch (e) {}
      const n = errAppend((j && j.rows) || [], deviceOf(req));
      if (n) {
        const g = ((j && j.rows) || [])[0] || {};
        console.log('  🩹 ' + n + ' client error(s) from ' + deviceOf(req) + '  \u2014 ' + String(g.msg || '').slice(0, 120) +
          (g.screen ? '  [' + g.screen + ']' : ''));
      }
      send(res, 200, { ok: true, stored: n });
    });
    return;
  }
  /* 🩹 read them back \u2014 GROUPED, so one station failing 400 times reads as one problem */
  if (u.indexOf('/api/client-errors') === 0 && req.method === 'GET') {
    if (!reqKeyOk(req)) { send(res, 401, { ok: false, error: keyErr() }); return; }
    let q; try { q = new URL(u, 'http://h').searchParams; } catch (e) { q = null; }
    const out = errRead({ limit: Number(q && q.get('limit')) || 100, since: Number(q && q.get('since')) || 0 });
    send(res, 200, { ok: true, total: out.total, groups: out.groups });
    return;
  }

  if (u.indexOf('/api/trail') === 0 && req.method === 'POST') {
    const _q = new URL('http://x' + u).searchParams;
    const _keyed = reqKeyOk(req) || (HUBKEY && _q.get('k') === HUBKEY);
    if (!_keyed) { send(res, 401, { ok:false, error:keyErr() }); return; }
    let body=''; req.on('data', c => { body += c; if (body.length > 4e5) req.destroy(); });
    req.on('end', () => {
      let p={}; try { p = JSON.parse(body || '{}'); } catch(e){}
      const n = trailAppend(p.rows, deviceOf(req));
      send(res, 200, { ok:true, kept:n });
    });
    return;
  }
  /* 🐾 GET /api/trail?hsl= | order= | cid= | emp= | kind= | q= | since= | limit=  — the map, when it is needed. */
  if (u.indexOf('/api/trail') === 0 && req.method === 'GET') {
    if (!reqKeyOk(req)) { send(res, 401, { ok:false, error:keyErr() }); return; }
    const q = new URL('http://x' + u).searchParams;
    const r = trailRead({ hsl:q.get('hsl'), order:q.get('order'), cid:q.get('cid'), emp:q.get('emp'),
      kind:q.get('kind'), q:q.get('q'), since:q.get('since'), limit:q.get('limit') });
    send(res, 200, { ok:true, rows:r.rows, exists:!!r.exists, truncated:!!r.truncated, error:r.error });
    return;
  }
  /* 💳🗒 GET /api/card-log?status=|last4=|brand=|dev=|since=|limit= — every card attempt, success and failure. */
  if (u.indexOf('/api/card-log') === 0 && req.method === 'GET') {
    if (!reqKeyOk(req)) { send(res, 401, { ok:false, error:keyErr() }); return; }
    const q = new URL('http://x' + u).searchParams;
    const r = cardLogRead({ status:q.get('status'), last4:q.get('last4'), brand:q.get('brand'),
      dev:q.get('dev'), since:q.get('since'), limit:q.get('limit') });
    send(res, 200, { ok:true, rows:r.rows, exists:!!r.exists, truncated:!!r.truncated, error:r.error });
    return;
  }
  if (u === '/api/sms' && req.method === 'POST') {
    if (!reqKeyOk(req)) { send(res, 401, { ok:false, error:keyErr() }); return; }
    let body = '';
    req.on('data', c => { body += c; if (body.length > 1e5) req.destroy(); });
    req.on('end', () => {
      let p = {}; try { p = JSON.parse(body || '{}'); } catch (e) {}
      const to = (p.to || '').toString(), text = (p.body || '').toString(), kind = (p.kind||'').toString();
      if (!smsConfigured()) { logSmsOut(to,text,kind,'simulated',null,{cid:(p.cid||'')}); send(res, 200, { ok:false, simulated:true, error:'Twilio not configured on the hub (set OZARK_TWILIO_SID / OZARK_TWILIO_TOKEN / OZARK_TWILIO_FROM).' }); return; }
      if (!to || !text) { send(res, 200, { ok:false, error:'missing to/body' }); return; }
      if (isOptedOut(to)) { logSmsOut(to,text,kind,'blocked-optout',null,{cid:(p.cid||''),err:'they replied STOP'}); send(res, 200, { ok:false, blocked:'optout', error:'This number replied STOP — texting is off for them.' }); return; }
      if (inQuietHours()) { SMSQUEUE.push({ to:to, body:text, kind:kind, queuedAt:Date.now() }); saveQueue(); logSmsOut(to,text,kind,'queued',null,{cid:(p.cid||'')}); send(res, 200, { ok:true, queued:true, error:'Quiet hours — held; sends automatically after 8am.' }); return; }
      /* ⚠️ AN UNCLEAR ANSWER USED TO BE RECORDED AS 'sent'. Read the old expression: ok -> sent, blocked ->
         blocked, error -> error, and ANYTHING ELSE -> 'sent'. A reply that carried neither ok nor error --
         a shape change at Twilio, a truncated body, a timeout resolving oddly -- was filed as a text the
         customer received. That is the same class as the pickup inbox that hid itself on an error and looked
         like "no requests": an error must never render as good news. Unknown is now a FAILURE, because the
         only safe assumption about a message you cannot prove was sent is that it was not. */
      smsGatedSend(to, text).then(function(r){
        var st = (r && r.ok) ? 'sent'
               : (r && r.blocked) ? ('blocked-' + r.blocked)
               : 'error';
        logSmsOut(to, text, kind, st, r && r.sid, { cid: (p.cid || ''), err: (r && r.error) || (st === 'error' && !(r && r.error) ? 'no clear answer from the carrier' : '') });
        send(res, 200, r);
      });
    });
    return;
  }

  // ---- Email connection check: log in to the mail server + quit, NO message sent. Confirms the password is right. ----
  if (u === '/api/email/verify' && (req.method === 'GET' || req.method === 'POST')) {
    if (!reqKeyOk(req)) { send(res, 401, { ok:false, error:keyErr() }); return; }
    if (!emailConfigured()) { send(res, 200, { ok:false, error:'Email isn\'t set up yet — enter the address + password and Save first.' }); return; }
    const viaHost = relayConfigured() ? (function(){ try { return new URL(RELAY.url).hostname + ' (relay)'; } catch(e){ return 'relay'; } })() : smtpHost();
    verifyEmail().then(function(r){ send(res, 200, Object.assign({ from: GM.user, host: viaHost, port: GM.port }, r)); })
      .catch(function(e){ send(res, 200, { ok:false, error:String(e && e.message || e) }); });
    return;
  }

  // ---- Email send (the mailbox password lives HERE on the hub, never in the browser) — used for A/R statements ----
  if (u === '/api/email' && req.method === 'POST') {
    if (!reqKeyOk(req)) { send(res, 401, { ok:false, error:keyErr() }); return; }
    let body = '';
    req.on('data', c => { body += c; if (body.length > 12e6) req.destroy(); });   // 12MB cap — headroom for a statement + many invoice texts
    req.on('end', () => {
      let p = {}; try { p = JSON.parse(body || '{}'); } catch (e) {}
      if (!emailConfigured()) { send(res, 200, { ok:false, error:'Email not set up on the hub (set OZARK_SMTP_USER and OZARK_SMTP_PASS in hub.env, or enter them in Admin → Integrations → Email).' }); return; }
      const to = [].concat(p.to || []).map(x => String(x || '').trim()).filter(Boolean);
      const cc = [].concat(p.cc || []).map(x => String(x || '').trim()).filter(Boolean);
      const subject = String(p.subject || '').slice(0, 300);
      const html = p.html ? String(p.html) : '';
      const text = p.text ? String(p.text) : '';
      if (!to.length) { send(res, 200, { ok:false, error:'missing recipient (to)' }); return; }
      const okAddr = a => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(a);
      if (!to.concat(cc).every(okAddr)) { send(res, 200, { ok:false, error:'invalid email address' }); return; }
      if (!html && !text) { send(res, 200, { ok:false, error:'empty message' }); return; }
      // ---- attachments: (a) statement {…} rendered to a typeset PDF, (b) invoices [{filename,text}] rendered to
      //      PDF here — combined into ONE file with the statement when p.combine, (c) pre-made [{filename,type,contentBase64}] ----
      const atts = [];
      let attBytes = 0;
      const safeName = function(n, fallback){ n = String(n || fallback).replace(/[\r\n"\\/]/g, '').replace(/\.pdf$/i, '').trim().slice(0, 120); return n || fallback; };
      try {
        const S = (p.statement && typeof p.statement === 'object') ? p.statement : null;
        const invs = [].concat(p.invoices || []).slice(0, 200).filter(function(inv){ return inv && inv.text; });
        if (S && p.combine) {                                       // one PDF: statement first, then every invoice
          let pages = stmtPages(S);
          invs.forEach(function(inv){ pages = pages.concat(textPages(String(inv.text), { fontSize: (inv.fontSize || 10) })); });
          const buf = buildPdf(pages);
          attBytes += buf.length;
          atts.push({ filename: safeName(S.fileBase, 'Statement-and-Invoices') + '.pdf', type: 'application/pdf', bytes: buf });
        } else {
          if (S) { const buf = statementPdf(S); attBytes += buf.length; atts.push({ filename: safeName(S.fileBase, 'Statement') + '.pdf', type: 'application/pdf', bytes: buf }); }
          invs.forEach(function(inv, i){
            const buf = textPdf(String(inv.text), { fontSize: (inv.fontSize || 10) });
            attBytes += buf.length;
            atts.push({ filename: safeName(inv.filename, 'Invoice-' + (i + 1)) + '.pdf', type: 'application/pdf', bytes: buf });
          });
        }
        [].concat(p.attachments || []).slice(0, 200).forEach(function(a, i){
          if (!a || !a.contentBase64) return;
          const buf = Buffer.from(String(a.contentBase64), 'base64');
          if (!buf.length) return;
          attBytes += buf.length;
          atts.push({ filename: safeName(a.filename, 'attachment-' + (i + 1)), type: String(a.type || 'application/octet-stream'), bytes: buf });
        });
      } catch (e) { send(res, 200, { ok:false, error:'attachment build failed: ' + (e && e.message || e) }); return; }
      if (attBytes > 22e6) { send(res, 200, { ok:false, error:'attachments too large (' + Math.round(attBytes/1e6) + 'MB) — Gmail caps at 25MB' }); return; }
      sendEmail({ to:to, cc:cc, subject:subject, html:html, text:text, replyTo: p.replyTo ? String(p.replyTo) : '', attachments: atts })
        .then(function(r){ send(res, 200, atts.length ? Object.assign({ attached: atts.length }, r) : r); })
        .catch(function(e){ send(res, 200, { ok:false, error:String(e && e.message || e) }); });
    });
    return;
  }

  // ---- Twilio delivery-status callback: Twilio POSTs here (form-encoded, no hub key); the POS polls it (GET, hub key) ----
  if (u.indexOf('/api/sms/status') === 0 && req.method === 'GET') {
    if (!reqKeyOk(req)) { send(res, 401, { ok:false, error:keyErr() }); return; }
    let sid=''; try { sid = new URL(u, 'http://h').searchParams.get('sid') || ''; } catch(e){}
    send(res, 200, { ok:true, status: (sid && __smsStatus[sid]) || null });
    return;
  }
  if (u === '/api/sms/status' && req.method === 'POST') {           // Twilio posts MessageSid / MessageStatus / ErrorCode here
    let body=''; req.on('data', c => { body += c; if (body.length > 1e5) req.destroy(); });
    req.on('end', () => {
      let q=null; try { q = new URLSearchParams(body); } catch(e){}
      if (q) { const sid = q.get('MessageSid') || q.get('SmsSid') || '';
        if (sid) { __smsStatus[sid] = { status:(q.get('MessageStatus')||q.get('SmsStatus')||'').toLowerCase(), errorCode:(q.get('ErrorCode')||''), to:(q.get('To')||''), ts:Date.now() };
          const ks = Object.keys(__smsStatus); if (ks.length > 5000) ks.slice(0, 1000).forEach(k => delete __smsStatus[k]); } }
      send(res, 204, '');
    });
    return;
  }
  // ---- 📵 STOP / START opt-out: set this as the Messaging "A message comes in" webhook in Twilio ----
  if (u === '/api/sms/inbound' && req.method === 'POST') {
    let body=''; req.on('data', c => { body += c; if (body.length > 1e5) req.destroy(); });
    req.on('end', () => {
      try {
        let q=null; try { q = new URLSearchParams(body); } catch(e){}
        const from = last10(q && q.get('From')); const msg = String((q && q.get('Body'))||'').trim().toUpperCase();
        const STOP = ['STOP','STOPALL','UNSUBSCRIBE','CANCEL','END','QUIT','REVOKE','OPTOUT'], START = ['START','UNSTOP','YES'];
        const rawBody = String((q && q.get('Body'))||'').trim();
        if (from) {
          if (STOP.indexOf(msg) >= 0) { OPTOUT[from] = { ts:Date.now(), reason:'replied '+msg }; saveOptout(); }
          else if (START.indexOf(msg) >= 0) { delete OPTOUT[from]; saveOptout(); }
          else if (rawBody) {   // a real message from a customer → queue it for the POS (home-screen flag + reply)
            /* 📲 A customer's REPLY is archived permanently too. SMSIN is capped at 1000 and rewritten in
               place, exactly like SMSOUT was, and what a customer told us is at least as important as what we
               told them ("don't wash the silk", "cancel my pickup"). Same append-only file, dir:'in'. */
            const _inRec = { id:'in'+Date.now().toString(36)+Math.random().toString(36).slice(2,6), ts:Date.now(), dir:'in', from:from, to:'', body:rawBody.slice(0,600), status:'new' };
            archiveSms(_inRec);
            SMSIN.push(_inRec);
            if (SMSIN.length > 1000) SMSIN = SMSIN.slice(-1000);
            saveSmsin();
          }
        }
      } catch(e) {}
      send(res, 200, '<?xml version="1.0" encoding="UTF-8"?><Response></Response>', { 'Content-Type':'text/xml' });
    });
    return;
  }
  // ---- opt-out list (hub key) so the POS can mark those customers "do not text" ----
  if (u === '/api/sms/optout' && req.method === 'GET') {
    if (!reqKeyOk(req)) { send(res, 401, { ok:false, error:keyErr() }); return; }
    send(res, 200, { ok:true, optout: Object.keys(OPTOUT).map(function(k){ return { phone:k, ts:OPTOUT[k].ts, reason:OPTOUT[k].reason }; }) });
    return;
  }
  // ---- 💬 inbound customer texts: POS reads the queue (hub key), then marks a message read/handled ----
  if (u === '/api/sms/messages' && req.method === 'GET') {
    if (!reqKeyOk(req)) { send(res, 401, { ok:false, error:keyErr() }); return; }
    send(res, 200, { ok:true, messages: SMSIN.filter(function(m){ return m.status !== 'done'; }).slice(-200).reverse() });
    return;
  }
  if (u.indexOf('/api/sms/log') === 0 && req.method === 'GET') {   // 💬 consolidated message trail — everything sent + everything received, newest first (bodies included; hub-side so it's the same on every device + backed up)
    if (!reqKeyOk(req)) { send(res, 401, { ok:false, error:keyErr() }); return; }
    /* 📜 ?all=1 reads the PERMANENT archive instead of the live window.
       SMSOUT is capped at 4000 and rewritten in place on every send, which at real volume (~20k texts/year)
       is barely a two-month window that silently discards the oldest — and "we texted them that it was ready"
       is exactly the kind of thing someone asks about six months later. sms-archive.jsonl is append-only and
       never trimmed, so this is the answer of record. It starts the day it shipped; anything already aged out
       of the window before that is genuinely gone, and saying so is better than implying completeness. */
    const _q = new URL('http://x' + u).searchParams;
    if (_q.get('all')) {
      const ar = readSmsArchive({ phone:_q.get('phone') || '', cust:_q.get('cust') || '', kind:_q.get('kind') || '',
        limit: Math.min(2000, Math.max(1, Number(_q.get('limit')) || 1000)) });
      /* the archive holds BOTH directions now; SMSIN is only still consulted for replies that arrived before
         the archive existed, deduped by id so nothing shows twice. */
      const arOut = (ar.rows || []).filter(function(m){ return m.dir !== 'in'; }).map(function(m){ return { dir:'out', ts:m.ts, num:m.to, body:m.body, kind:m.kind, status:m.status }; });
      const arSeen = {}; (ar.rows || []).forEach(function(m){ if (m.id) arSeen[m.id] = 1; });
      const arIn = (ar.rows || []).filter(function(m){ return m.dir === 'in'; }).map(function(m){ return { dir:'in', ts:m.ts, num:m.from, body:m.body, status:m.status }; })
        .concat(SMSIN.filter(function(m){ return !arSeen[m.id]; }).map(function(m){ return { dir:'in', ts:m.ts, num:m.from, body:m.body, status:m.status }; }));
      const arAll = arOut.concat(arIn).sort(function(a,b){ return (b.ts||0)-(a.ts||0); });
      send(res, 200, { ok:true, messages: arAll, sent: arOut.length, received: arIn.length,
        archive:true, exists:!!ar.exists, truncated:!!ar.truncated, error:ar.error });
      return;
    }
    const out = SMSOUT.map(function(m){ return { dir:'out', ts:m.ts, num:m.to, body:m.body, kind:m.kind, status:m.status }; });
    const inb = SMSIN.map(function(m){ return { dir:'in', ts:m.ts, num:m.from, body:m.body, status:m.status }; });
    const all = out.concat(inb).sort(function(a,b){ return (b.ts||0)-(a.ts||0); }).slice(0, 800);
    send(res, 200, { ok:true, messages: all, sent: SMSOUT.length, received: SMSIN.length });
    return;
  }
  if (u === '/api/sms/messages/resolve' && req.method === 'POST') {
    if (!reqKeyOk(req)) { send(res, 401, { ok:false, error:keyErr() }); return; }
    let body=''; req.on('data', c => { body += c; if (body.length > 1e5) req.destroy(); });
    req.on('end', () => {
      let p={}; try { p = JSON.parse(body||'{}'); } catch(e){}
      const m = SMSIN.filter(function(x){ return x.id === p.id; })[0];
      if (m) { m.status='done'; m.resolvedAt=Date.now(); m.resolvedBy=String(p.by||'').slice(0,40); saveSmsin(); }
      send(res, 200, { ok:true });
    });
    return;
  }
  // ---- 📣 group/broadcast text: POS sends one message to many numbers (hub key). Each number is opt-out + landline screened by the hub. ----
  if (u === '/api/sms/broadcast' && req.method === 'POST') {
    if (!reqKeyOk(req)) { send(res, 401, { ok:false, error:keyErr() }); return; }
    let body=''; req.on('data', c => { body += c; if (body.length > 5e6) req.destroy(); });
    req.on('end', () => {
      let p={}; try { p = JSON.parse(body||'{}'); } catch(e){}
      const text = String(p.body||'').toString();
      let nums = [].concat(p.numbers||[]).map(function(n){ return String(n||''); }).filter(Boolean);
      // dedupe by last-10 digits
      const seen = {}; nums = nums.filter(function(n){ const k=last10(n); if(!k||seen[k]) return false; seen[k]=1; return true; });
      if (!smsConfigured()) { send(res, 200, { ok:false, simulated:true, error:'Twilio not configured on the hub (set OZARK_TWILIO_TOKEN in hub.env).' }); return; }
      if (!text) { send(res, 200, { ok:false, error:'empty message' }); return; }
      if (!nums.length) { send(res, 200, { ok:false, error:'no recipients' }); return; }
      if (nums.length > 2000) nums = nums.slice(0, 2000);
      let sent=0, skipped=0, queued=0;
      const quiet = inQuietHours();
      Promise.all(nums.map(function(to){
        if (isOptedOut(to)) { skipped++; return Promise.resolve(); }
        if (quiet) { SMSQUEUE.push({ to:to, body:text, kind:'broadcast', queuedAt:Date.now() }); queued++; return Promise.resolve(); }
        return smsGatedSend(to, text).then(function(r){ if (r && r.ok) sent++; else skipped++; });
      })).then(function(){
        if (quiet) saveQueue();
        send(res, 200, { ok:true, sent:sent, skipped:skipped, queued:queued, total:nums.length });
      });
    });
    return;
  }

  // ---- online "Schedule a Pickup": PUBLIC submit (rate-limited, no hub key) + POS reads/resolves (hub key) ----
  if (u === '/api/pickup' && req.method === 'POST') {
    if (!trackRateOk(req)) { send(res, 429, { ok:false, error:'Too many requests — please wait a minute.' }); return; }
    let body=''; req.on('data', c => { body += c; if (body.length > 1e5) req.destroy(); });
    req.on('end', () => {
      let p={}; try { p = JSON.parse(body||'{}'); } catch(e){}
      const name=String(p.name||'').trim().slice(0,80), phone=String(p.phone||'').replace(/\D/g,'').slice(0,15);
      if (!name || phone.length < 7) { send(res, 200, { ok:false, error:'Please enter your name and a valid phone number.' }); return; }
      const reqo = { id:'pk'+Date.now().toString(36)+Math.random().toString(36).slice(2,6), ts:Date.now(), status:'new',
        name:name, phone:phone, address:String(p.address||'').trim().slice(0,160), day:String(p.day||'').trim().slice(0,40), notes:String(p.notes||'').trim().slice(0,400) };
      PICKS.push(reqo); if (PICKS.length > 800) PICKS = PICKS.slice(-800); savePicks();
      console.log('  📥 pickup request from ' + name + ' (' + phone + ')');
      send(res, 200, { ok:true });
    });
    return;
  }
  if (u === '/api/pickup' && req.method === 'GET') {
    if (!reqKeyOk(req)) { send(res, 401, { ok:false, error:keyErr() }); return; }
    send(res, 200, { ok:true, requests: PICKS.filter(r => r.status !== 'done').slice(-200).reverse() });
    return;
  }
  if (u === '/api/pickup/resolve' && req.method === 'POST') {
    if (!reqKeyOk(req)) { send(res, 401, { ok:false, error:keyErr() }); return; }
    let body=''; req.on('data', c => { body += c; if (body.length > 1e5) req.destroy(); });
    req.on('end', () => {
      let p={}; try { p = JSON.parse(body||'{}'); } catch(e){}
      const r = PICKS.filter(x => x.id === p.id)[0]; if (r) { r.status='done'; r.resolvedAt=Date.now(); r.resolvedBy=String(p.by||'').slice(0,40); savePicks(); }
      send(res, 200, { ok:true });
    });
    return;
  }

  // ---- 💳 Card-on-file BY TEXT: staff request a one-time secure link (hub key). Customer opens card.html,
  //      types their card into FISERV'S hosted iframe (never our page), which returns a CardSecure token; the
  //      page posts the TOKEN here (public); the hub $0-verifies it and queues it; the POS adds it as a saved
  //      card. The raw card number never touches our page, server, or staff — only a token. ----
  if (u.indexOf('/api/cardlink/create') === 0 && req.method === 'POST') {
    if (!reqKeyOk(req)) { send(res, 401, { ok:false, error:keyErr() }); return; }
    let body=''; req.on('data', c => { body += c; if (body.length > 1e5) req.destroy(); });
    req.on('end', () => {
      let p={}; try { p = JSON.parse(body||'{}'); } catch(e){}
      const cid=String(p.cid||'').slice(0,60), name=String(p.name||'').trim().slice(0,80), phone=String(p.phone||'').replace(/\D/g,'').slice(0,15), store=p.store||'';
      const email=String(p.email||'').trim().slice(0,120);
      const via=String(p.via||'sms').toLowerCase();                                    // 'sms' | 'email' | 'both'
      const wantSms=(via==='sms'||via==='both'), wantEmail=(via==='email'||via==='both');
      const emailOk=/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email);
      if (!cid) { send(res, 200, { ok:false, error:'Need the customer.' }); return; }
      if (wantSms && phone.length < 10) { send(res, 200, { ok:false, error:'Need a valid mobile number.' }); return; }
      if (wantEmail && !emailOk) { send(res, 200, { ok:false, error:'Need a valid email address.' }); return; }
      if (!wantSms && !wantEmail) { send(res, 200, { ok:false, error:'Pick text or email.' }); return; }
      const k = 'cl'+Date.now().toString(36)+Math.random().toString(36).slice(2,10);
      const rec = { k:k, cid:cid, name:name, phone:phone, email:email, store:store, status:'sent', createdAt:Date.now(), exp:Date.now()+2*3600*1000 };   // link valid 2 hours
      CARDLINKS.push(rec); if (CARDLINKS.length > 2000) CARDLINKS = CARDLINKS.slice(-2000); saveCardlinks();
      const link = CARDLINK_BASE + '/card.html?k=' + k;
      const msg = 'Ozark Cleaners: ' + (name ? name + ', ' : '') + 'securely add your card on file here (expires in 2 hours): ' + link + ' - reply STOP to opt out.';
      const out = { ok:true, link:link }, jobs = [];
      if (wantSms) {
        if (!smsConfigured())      out.sms = 'simulated';
        else if (isOptedOut(phone)) out.sms = 'optout';
        else jobs.push(smsGatedSend(phone, msg).then(function(r){ out.sms = (r&&r.ok) ? 'sent' : ((r&&r.error)||'not sent'); }));
      }
      if (wantEmail) {
        if (!emailConfigured()) out.email = 'not-set-up';
        else jobs.push(sendEmail({ to:[email], subject:'Add your card on file — Ozark Cleaners', html:cardLinkEmailHtml(name, link) })
          .then(function(r){ out.email = (r&&r.ok) ? 'sent' : ((r&&r.error)||'not sent'); }));
      }
      Promise.all(jobs).then(function(){ send(res, 200, out); });
    });
    return;
  }
  if (u.indexOf('/api/cardlink/info') === 0 && req.method === 'GET') {   // the customer's page validates the link + gets the tokenizer URL
    if (!trackRateOk(req)) { send(res, 429, { ok:false, error:'Too many requests - please wait a minute.' }); return; }
    var iq; try { iq = new URL(u, 'http://h').searchParams; } catch(e){ iq = null; }
    var ik = iq ? String(iq.get('k')||'') : '';
    var irec = CARDLINKS.filter(function(x){ return x.k===ik; })[0];
    if (!irec) { send(res, 200, { ok:false, error:'This link is not valid.' }); return; }
    if (irec.status==='completed' || irec.used) { send(res, 200, { ok:false, error:'This link was already used - your card is on file.' }); return; }
    if (Date.now() > (irec.exp||0)) { send(res, 200, { ok:false, error:'This link has expired. Please ask us to text a new one.' }); return; }
    var host = cpConfigured() ? cpHostOf(cpForStore(irec.store)) : 'fts-uat.cardconnect.com';
    var css = 'body{margin:0;font-family:-apple-system,Segoe UI,Arial,sans-serif}input{width:100%;box-sizing:border-box;font-size:17px;padding:13px;border:1px solid #cfd8e3;border-radius:10px;margin:4px 0;-webkit-appearance:none}';
    send(res, 200, { ok:true, name: irec.name||'', configured: cpConfigured(), tokenizer: 'https://'+host+'/itoke/ajax-tokenizer.html?usecvv=true&cardnumbernumericonly=true&formatinput=true&enhancedresponse=true&tokenizewheninactive=true&inactivityto=800&css='+encodeURIComponent(css) });
    return;
  }
  if (u === '/api/cardlink/submit' && req.method === 'POST') {   // the customer's page posts the CardSecure token here (public)
    if (!trackRateOk(req)) { send(res, 429, { ok:false, error:'Too many requests - please wait a minute.' }); return; }
    let body=''; req.on('data', c => { body += c; if (body.length > 1e5) req.destroy(); });
    req.on('end', () => {
      let p={}; try { p = JSON.parse(body||'{}'); } catch(e){}
      const sk=String(p.k||''), token=String(p.token||'').slice(0,120), expiry=String(p.expiry||'').replace(/\D/g,'').slice(0,4);
      const rec = CARDLINKS.filter(function(x){ return x.k===sk; })[0];
      if (!rec) { send(res, 200, { ok:false, error:'This link is not valid.' }); return; }
      if (rec.status==='completed' || rec.used) { send(res, 200, { ok:false, error:'This link was already used.' }); return; }
      if (Date.now() > (rec.exp||0)) { send(res, 200, { ok:false, error:'This link has expired.' }); return; }
      if (!token) { send(res, 200, { ok:false, error:'No card was entered.' }); return; }
      if (!p.consent) { send(res, 200, { ok:false, error:'Please check the authorization box.' }); return; }   // stored-credential consent is required + recorded
      const finish = function(last4, brand){ rec.status='completed'; rec.used=true; rec.token=token; rec.last4=last4; rec.brand=brand; rec.exp2=expiry; rec.consentAt=Date.now(); rec.completedAt=Date.now(); saveCardlinks(); send(res, 200, { ok:true }); };
      if (!cpConfigured()) { finish(cpLast4(token), 'Card'); return; }   // simulator / not wired yet: accept the token so the flow can be tested end-to-end
      cpVerifyCard(token, rec.store, expiry).then(function(r){   // $0 check with automatic $1-auth+void fallback for issuers that refuse $0 verifies
        if (r.status !== 'approved') { send(res, 200, { ok:false, error: (r.message || 'Your card could not be verified - please check the details and try again.') }); return; }
        finish((r.last4 || cpLast4(token)), (r.brand || 'Card'));
      });
    });
    return;
  }
  if (u === '/api/cardlink/pending' && req.method === 'GET') {   // POS pulls completed cards to add to the customer
    if (!reqKeyOk(req)) { send(res, 401, { ok:false, error:keyErr() }); return; }
    send(res, 200, { ok:true, cards: CARDLINKS.filter(function(r){ return r.status==='completed' && !r.resolved; }).slice(-100).map(function(r){ return { k:r.k, cid:r.cid, token:r.token, last4:r.last4, brand:r.brand, exp:r.exp2||'', store:r.store, consentAt:r.consentAt||0 }; }) });
    return;
  }
  if (u === '/api/cardlink/resolve' && req.method === 'POST') {
    if (!reqKeyOk(req)) { send(res, 401, { ok:false, error:keyErr() }); return; }
    let body=''; req.on('data', c => { body += c; if (body.length > 1e5) req.destroy(); });
    req.on('end', () => { let p={}; try { p = JSON.parse(body||'{}'); } catch(e){} const r=CARDLINKS.filter(function(x){ return x.k===p.k; })[0]; if (r) { r.resolved=true; r.resolvedAt=Date.now(); saveCardlinks(); } send(res, 200, { ok:true }); });
    return;
  }

  // ---- customer feedback + $10 review-credit: PUBLIC submit (rate-limited, no hub key) + POS reads/resolves (hub key) ----
  if (u === '/api/feedback' && req.method === 'POST') {
    if (!trackRateOk(req)) { send(res, 429, { ok:false, error:'Too many requests — please wait a minute.' }); return; }
    let body=''; req.on('data', c => { body += c; if (body.length > 1e5) req.destroy(); });
    req.on('end', () => {
      let p={}; try { p = JSON.parse(body||'{}'); } catch(e){}
      const name=String(p.name||'').trim().slice(0,80), phone=String(p.phone||'').replace(/\D/g,'').slice(0,15), stars=Math.max(0,Math.min(5,parseInt(p.stars,10)||0));
      if (!name || phone.length < 7 || !stars) { send(res, 200, { ok:false, error:'Please add your name, phone, and a star rating.' }); return; }
      const fb = { id:'fb'+Date.now().toString(36)+Math.random().toString(36).slice(2,6), ts:Date.now(), status:'new', credited:false, name:name, phone:phone, stars:stars, comment:String(p.comment||'').trim().slice(0,600) };
      FB.push(fb); if (FB.length > 2000) FB = FB.slice(-2000); saveFB();
      console.log('  💬 feedback ' + stars + '★ from ' + name + ' (' + phone + ')');
      send(res, 200, { ok:true });
    });
    return;
  }
  if (u === '/api/feedback' && req.method === 'GET') {
    if (!reqKeyOk(req)) { send(res, 401, { ok:false, error:keyErr() }); return; }
    send(res, 200, { ok:true, feedback: FB.filter(f => f.status !== 'done').slice(-200).reverse() });
    return;
  }
  if (u === '/api/feedback/resolve' && req.method === 'POST') {
    if (!reqKeyOk(req)) { send(res, 401, { ok:false, error:keyErr() }); return; }
    let body=''; req.on('data', c => { body += c; if (body.length > 1e5) req.destroy(); });
    req.on('end', () => {
      let p={}; try { p = JSON.parse(body||'{}'); } catch(e){}
      const f = FB.filter(x => x.id === p.id)[0]; if (f) { f.status='done'; f.credited=!!p.credited; f.resolvedAt=Date.now(); f.resolvedBy=String(p.by||'').slice(0,40); saveFB(); }
      send(res, 200, { ok:true });
    });
    return;
  }

  // ---- 🆘 employee support tickets (hub-side queue; key-gated — staff only) ----
  /* 🪞 POST /api/mirror — a station says "at revision R, this is what I hold." The hub answers whether that
     matches what IT held at R, and NAMES the collections that disagree. Read-only: comparing copies must never
     be able to change one. `known:false` (the hub has no memory of R — restarted, or R is ancient) is NOT
     drift, and the station is told so explicitly, because "I don't know" rendering as "you're fine" is the
     same class of bug as an error rendering as an empty inbox. */
  if (u === '/api/mirror' && req.method === 'POST') {
    if (!reqKeyOk(req)) { send(res, 401, { ok:false, error:keyErr() }); return; }
    let body=''; req.on('data', c => { body += c; if (body.length > 2e5) req.destroy(); });
    req.on('end', () => {
      let p={}; try { p = JSON.parse(body||'{}'); } catch(e){}
      const dev = deviceOf(req), atRev = Number(p.rev);
      const mine = MIRROR.revs[atRev];
      if (!(atRev >= 0) || !p.fps) { send(res, 200, { ok:false, error:'send {rev, fps}' }); return; }
      if (!mine) { MIRROR.stations[dev] = { at:Date.now(), rev:atRev, known:false, match:null, drift:[], appRev:String(p.appRev||'') };
        send(res, 200, { ok:true, known:false, rev:atRev, hubRev:rev }); return; }
      const drift = mirrorDrift(mine.fps, p.fps);
      const st = MIRROR.stations[dev] || (MIRROR.stations[dev] = { misses:0 });
      st.at = Date.now(); st.rev = atRev; st.known = true; st.match = drift.length === 0; st.drift = drift;
      st.appRev = String(p.appRev||''); st.store = (p.store != null ? p.store : '');
      st.misses = drift.length ? (st.misses||0) + 1 : 0;
      if (drift.length) {
        /* Named, with the counts on both sides, so the answer to "what actually differs" is in the journal
           rather than requiring a live debug session. */
        console.log('  🪞 MIRROR DRIFT  ' + dev + '  at rev ' + atRev + '  → ' + drift.map(c => {
          const a = mine.fps[c] || {n:'-'}, b = p.fps[c] || {n:'-'};
          return c + ' (hub ' + a.n + ' rows / station ' + b.n + ')';
        }).join(', ') + (st.misses > 1 ? '   ⚠ ' + st.misses + ' checks in a row' : ''));
      }
      send(res, 200, { ok:true, known:true, match:st.match, drift:drift, rev:atRev, hubRev:rev, misses:st.misses });
    });
    return;
  }
  /* 🪞 GET /api/mirror — the whole wall of mirrors, for Admin → Devices. */
  if (u === '/api/mirror' && req.method === 'GET') {
    if (!reqKeyOk(req)) { send(res, 401, { ok:false, error:keyErr() }); return; }
    const revs = Object.keys(MIRROR.revs).map(Number);
    /* 👀 WHO IS ACTUALLY THERE RIGHT NOW. `seen` is stamped by every request a station makes — including the
       keyless 4-second health poll — so it answers "is that computer awake and talking?" even when nobody has
       changed a single record. clientsRecent() has been counting these all along and throwing the names away,
       which is why "is she actively using it?" could only be guessed at from data events. Data events require
       somebody to SAVE something; presence does not. */
    const now = Date.now();
    const clients = [];
    for (const [dev, t] of seen.entries()) clients.push({ dev: dev, agoSec: Math.round((now - t)/1000) });
    clients.sort((a,b) => a.agoSec - b.agoSec);
    /* 👑 and WHO is doing the automatic work. Named here, on the key-gated endpoint, never on the keyless
       health poll — a station only ever learns whether it is the one, not who else is. */
    send(res, 200, { ok:true, rev, stations: MIRROR.stations, clients: clients.slice(0,40), autoLeader: AUTO.dev || '',
      oldestRev: revs.length ? Math.min.apply(null, revs) : null, knownRevs: revs.length });
    return;
  }
  if (u === '/api/support' && req.method === 'POST') {
    if (!reqKeyOk(req)) { send(res, 401, { ok:false, error:keyErr() }); return; }
    let body=''; req.on('data', c => { body += c; if (body.length > 1e5) req.destroy(); });
    req.on('end', () => {
      let p={}; try { p = JSON.parse(body||'{}'); } catch(e){}
      const text = String(p.text||'').trim().slice(0,2000);
      if (!text) { send(res, 200, { ok:false, error:'Type the problem first.' }); return; }
      /* ⚠️ SCREENSHOT REFERENCES ONLY, NEVER BYTES. Requested by Brittany Jones on 2026-08-12: "i need to be
         able to paste a screenshot into this box for support". The picture is uploaded to /api/photo first and
         content-addressed there; a ticket carries at most four ids. Anything that still looks like inline data
         is DROPPED rather than stored -- a ticket file is a small JSON row and a pasted 4MB screenshot would
         quietly turn it into something nothing can load. Same rule blobGuard enforces for the database. */
      const shots = (Array.isArray(p.shots) ? p.shots : []).map(x => String(x||''))
        .filter(x => /^[0-9a-f]{6,64}\.(png|jpg|jpeg|webp)$/i.test(x)).slice(0, 4);
      const t = { id:'sup'+Date.now().toString(36)+Math.random().toString(36).slice(2,6), ts:Date.now(), status:'open',
        ws:String(p.ws||'').slice(0,60), by:String(p.by||'').slice(0,60), store:(p.store!=null?p.store:''), screen:String(p.screen||'').slice(0,40), text:text, shots:shots };
      SUP.push(t); if (SUP.length > 2000) SUP = SUP.slice(-2000); saveSUP();
      console.log('  🆘 support from ' + (t.by||'?') + ' @ ' + (t.ws||'?') + ': ' + text.slice(0,60) +
        (shots.length ? '  [' + shots.length + ' screenshot' + (shots.length>1?'s':'') + ']' : ''));
      send(res, 200, { ok:true, id:t.id });
    });
    return;
  }
  if (u === '/api/support' && req.method === 'GET') {
    if (!reqKeyOk(req)) { send(res, 401, { ok:false, error:keyErr() }); return; }
    send(res, 200, { ok:true, support: SUP.filter(t => t.status !== 'fixed').slice(-300).reverse() });
    return;
  }
  if (u === '/api/support/resolve' && req.method === 'POST') {
    if (!reqKeyOk(req)) { send(res, 401, { ok:false, error:keyErr() }); return; }
    let body=''; req.on('data', c => { body += c; if (body.length > 1e5) req.destroy(); });
    req.on('end', () => {
      let p={}; try { p = JSON.parse(body||'{}'); } catch(e){}
      const t = SUP.filter(x => x.id === p.id)[0]; if (t) { t.status='fixed'; t.fixedAt=Date.now(); t.fixedBy=String(p.by||'').slice(0,40); saveSUP(); }
      send(res, 200, { ok:true });
    });
    return;
  }

  // ---- card-processing status (no secrets ever returned) ----
  if (u === '/api/pay/status' && req.method === 'GET') {
    if (!reqKeyOk(req)) { send(res, 401, { ok:false, error:keyErr() }); return; }
    send(res, 200, { ok:true, configured: payConfigured(), env: cpConfigured() ? CP.env : null, site: cpConfigured() ? CP.site : null,
      emailFrom: emailConfigured() ? GM.user : '', emailBcc: GM.bcc || '', emailReplyTo: GM.replyTo || '' });   // addresses (not secrets) so the panel can show what's set
    return;
  }

  // ---- payment seam: processor SECRETS live HERE on the hub, never in the browser ----
  if (u.indexOf('/api/pay/') === 0 && req.method === 'POST') {
    if (!reqKeyOk(req)) { send(res, 401, { ok:false, error:keyErr() }); return; }
    let body = '';
    req.on('data', c => { body += c; if (body.length > 1e6) req.destroy(); });
    req.on('end', () => {
      let parsed = {}; try { parsed = JSON.parse(body || '{}'); } catch (e) {}
      const action   = u.split('/').pop();               // charge | save-card | link | refund
      const provider = parsed.provider || '';
      const ctx      = parsed.context || {};
      // 🔒 charges/refunds must carry a real positive amount — never let a missing/negative amount reach a processor
      if ((action === 'charge' || action === 'refund')) {
        const amt = Number(parsed.amount);
        if (!isFinite(amt) || amt <= 0) { send(res, 200, { ok:false, error:'Invalid amount' }); return; }
      }

      // ===== Square (self-serve) =====
      if (provider === 'square') {
        if (!sqConfigured()) {
          send(res, 200, { ok:false, error:'Square is selected but the hub has no Access Token yet. Set OZARK_SQUARE_TOKEN + OZARK_SQUARE_LOCATION (and OZARK_SQUARE_ENV) on the hub, then restart. Until then, use the Simulator.' });
          return;
        }
        if (action === 'charge') {
          const src = parsed.token || ctx.token || '';
          if (!src) { send(res, 200, { ok:false, error:'No payment token yet. Card-present needs the Square Terminal (or Web Payments) to capture the card and return a token first — that device step is the last piece to wire.' }); return; }
          sqCharge(src, parsed.amount).then(result => send(res, 200, { ok: result.status === 'approved', result, error: result.status !== 'approved' ? (result.message || result.status) : undefined }));
          return;
        }
        if (action === 'save-card') {
          const tok = parsed.token || ctx.token || '';
          if (tok) { send(res, 200, { ok:true, result:{ status:'approved', token: tok, last4: ctx.last4 || '', brand: ctx.brand || 'Card' } }); return; }
          send(res, 200, { ok:false, error:'Capture the card with Square Web Payments (browser) to get a token — the hub never handles card numbers.' });
          return;
        }
        if (action === 'link') {
          sqPaymentLink(parsed.amount).then(result => { if (result.status === 'ok') send(res, 200, { ok:true, result }); else send(res, 200, { ok:false, error: result.message || 'Could not create link' }); });
          return;
        }
        if (action === 'refund') {
          const pid = parsed.ref || '';
          if (!pid) { send(res, 200, { ok:false, error:'No original Square payment id to refund against.' }); return; }
          sqRefund(pid, parsed.amount).then(result => send(res, 200, { ok: result.status === 'approved', result, error: result.status !== 'approved' ? (result.message || result.status) : undefined }));
          return;
        }
        send(res, 400, { ok:false, error:'Unknown payment action: ' + action });
        return;
      }

      // ===== CardPointe / Fiserv (the wired path) =====
      if (provider === 'cardpointe') {
        const store = parsed.store || ctx.store || '';   // which store's MID/terminal to use (empty = the global default)
        if (!cpConfigured()) {
          send(res, 200, { ok:false, error:'CardPointe is selected but the hub has no credentials yet. Set OZARK_CARDPOINTE_SITE / MID / USER / PASS (and _ENV) on the hub, then restart it. Until then, use the Simulator.' });
          return;
        }
        if (action === 'charge') {
          const token = parsed.token || ctx.token || '';
          if (!token && parsed.present) {   // 💳 read the card on THIS STORE's Bolt terminal + authorize
            if (!cptConfiguredFor(store)) { send(res, 200, { ok:false, error:'The card terminal for this store is not set up on the hub yet.' }); return; }
            ctx.store = store;
            if (ctx.entry === 'keyed') {   // ⌨️ card-NOT-present: clerk keys the number on the terminal (phone/mail order) → token → gateway auth
              cptReadManual(store).then(function(rm){
                if (rm.status !== 'approved' || !rm.token) { send(res, 200, { ok:false, result: rm, error: rm.message || 'Could not read the keyed card' }); return; }
                cpAuthCapture(rm.token, parsed.amount, { store: store, ecomind: 'E', expiry: rm.exp, idem: ctx.idem, cid: ctx.cid }).then(function(result){
                  if (result && result.status === 'approved' && !result.last4 && rm.last4) result.last4 = rm.last4;
                  send(res, 200, { ok: result.status === 'approved', result, error: result.status !== 'approved' ? (result.message || result.status) : undefined });
                });
              });
              return;
            }
            cptAuthCard(parsed.amount, ctx).then(result => send(res, 200, { ok: result.status === 'approved', result, error: result.status !== 'approved' ? (result.message || result.status) : undefined }));
            return;
          }
          if (!token) {
            send(res, 200, { ok:false, error:'No card token yet. A card-present charge needs the Bolt terminal (or hosted iFrame) to read the card and return a CardSecure token first — that on-site device step is the last piece to wire.' });
            return;
          }
          if (parsed.amount === 0 && ctx.capture === 'N') {   // 🔍 a $0 "verify" shaped charge (the counter save-card flow + the 🔍 Test button) → use the verification path with the $1-auth+void fallback for issuers that refuse $0 CNP checks
            cpVerifyCard(token, store, ctx.exp || ctx.expiry, { ecomind: ctx.ecomind, cvv2: ctx.cvv2, name: ctx.name, address: ctx.address, city: ctx.city, region: ctx.region, postal: ctx.postal, cof: ctx.cof, cofscheduled: ctx.cofscheduled }).then(result => send(res, 200, { ok: result.status === 'approved', result, error: result.status !== 'approved' ? (result.message || result.status) : undefined }));
            return;
          }
          cpAuthCapture(token, parsed.amount, { store: store, ecomind: ctx.ecomind || 'E', capture: ctx.capture, expiry: ctx.exp || ctx.expiry, cvv2: ctx.cvv2, name: ctx.name, address: ctx.address, city: ctx.city, region: ctx.region, postal: ctx.postal, cof: ctx.cof, cofscheduled: ctx.cofscheduled, idem: ctx.idem, cid: ctx.cid }).then(result => { cardLog('charge', deviceOf(req), ctx, result, { amount: parsed.amount, cid: ctx.cid, via: ctx.cof === 'M' ? 'unattended' : 'attended' }); send(res, 200, { ok: result.status === 'approved', result, error: result.status !== 'approved' ? (result.message || result.status) : undefined }); });
          return;
        }
        if (action === 'save-card') {
          const token = parsed.token || ctx.token || '';
          if (!token && parsed.present) {   // 💾 read the card on THIS STORE's terminal → token, no charge. keyed = phone/mail (clerk keys it); else tap/dip
            if (!cptConfiguredFor(store)) { send(res, 200, { ok:false, error:'The card terminal for this store is not set up on the hub yet.' }); return; }
            if (ctx.entry === 'keyed') {   // keyed readManual only tokenizes → follow with a $0 account verification so a bad number is caught NOW (no charge, nothing to void)
              cptReadManual(store).then(function(rm){
                if (rm.status !== 'approved' || !rm.token) { send(res, 200, { ok:false, result: rm, error: rm.message || 'Could not read the card' }); return; }
                cpAuthCapture(rm.token, 0, { store: store, capture: 'N', ecomind: 'E', expiry: rm.exp }).then(function(v){
                  if (v.status !== 'approved') { send(res, 200, { ok:false, result: v, error: (v.message || 'Card was declined on a $0 check') }); return; }
                  send(res, 200, { ok:true, result: { status:'approved', token: rm.token, last4: rm.last4, brand: (v.brand || rm.brand || 'Card'), exp: rm.exp } });
                });
              });
              return;
            }
            cptTokenizeCard(store).then(result => send(res, 200, { ok: result.status === 'approved' && !!result.token, result, error: result.status !== 'approved' ? (result.message || 'Could not read the card') : undefined }));   // tap/dip = a $0 authCard verify, already validates
            return;
          }
          if (token) { send(res, 200, { ok:true, result:{ status:'approved', token, last4: ctx.last4 || '', brand: ctx.brand || 'Card', exp: ctx.exp || '' } }); return; }
          send(res, 200, { ok:false, error:'Tap/insert the card on the reader to save it (card-on-file is captured on the terminal, never typed in a browser).' });
          return;
        }
        /* 💳🔒 stored-credential CHECK — a $0 auth-only carrying the exact cof flags a real charge would carry.
           A SEPARATE action from both 'charge' and 'verify', deliberately:
             • 'charge' refuses amount <= 0, and rightly so — a missing amount must never reach a processor.
             • 'verify' calls cpVerifyCard, which FALLS BACK TO A REAL $1 CHARGE when the $0 is declined. That
               is correct for "is this card any good" and wrong here: a test of which FIELDS the processor
               accepts must never be able to take a dollar from a customer.
           So this one path does exactly one thing — amount 0, capture:'N', flags passed through, no fallback,
           nothing captured, nothing to void. */
        if (action === 'stored-check') {
          const stoken = parsed.token || ctx.token || '';
          if (!stoken) { send(res, 200, { ok:false, error:'no card token' }); return; }
          cpAuthCapture(stoken, 0, { store: store, capture: 'N', ecomind: ctx.ecomind || 'E',
            expiry: ctx.exp || ctx.expiry, name: ctx.name, postal: ctx.postal,
            cof: ctx.cof, cofscheduled: ctx.cofscheduled })
            .then(result => { cardLog('stored-check', deviceOf(req), ctx, result, { amount:0, cid: ctx.cid, via:'cof ' + (ctx.cof||'') }); send(res, 200, { ok: result.status === 'approved', result,
              sent: { amount:0, capture:'N', cof: ctx.cof || '', cofscheduled: ctx.cofscheduled || '', avs: ctx.postal ? 'zip+name' : (ctx.name ? 'name' : 'none') },
              error: result.status !== 'approved' ? (result.message || result.status) : undefined }); });
          return;
        }
        if (action === 'verify') {   // 🔍 card verification — $0 account check, auto-falling back to $1 auth+void for issuers that refuse $0 CNP checks ("3DS" declines)
          const vtoken = parsed.token || ctx.token || '';
          const doVerify = function(tok, extra){
            cpVerifyCard(tok, store, (extra && extra.exp) || ctx.exp || ctx.expiry, { ecomind: ctx.ecomind }).then(function(result){
              const out = Object.assign({}, result);
              if (extra && extra.token && !out.token) out.token = extra.token;
              if (extra && extra.last4 && !out.last4) out.last4 = extra.last4;
              send(res, 200, { ok: result.status === 'approved', result: out, error: result.status !== 'approved' ? (result.message || result.status) : undefined });
            });
          };
          if (vtoken) { doVerify(vtoken, {}); return; }               // verify a card already on file
          if (parsed.present) {                                        // verify a fresh card at the terminal
            if (!cptConfiguredFor(store)) { send(res, 200, { ok:false, error:'The card terminal for this store is not set up on the hub yet.' }); return; }
            if (ctx.entry === 'keyed') { cptReadManual(store).then(function(rm){ if (rm.status !== 'approved' || !rm.token) { send(res, 200, { ok:false, result: rm, error: rm.message || 'Could not read the card' }); return; } doVerify(rm.token, { token: rm.token, last4: rm.last4, exp: rm.exp }); }); return; }
            cptTokenizeCard(store).then(function(rm){ send(res, 200, { ok: rm.status === 'approved' && !!rm.token, result: rm, error: rm.status !== 'approved' ? (rm.message || 'Could not read the card') : undefined }); });   // tap tokenize is already a $0 verify
            return;
          }
          send(res, 200, { ok:false, error:'No card to verify' });
          return;
        }
        if (action === 'link') {
          send(res, 501, { ok:false, error:'CardPointe Hosted Payment Page (pay link) needs your HPP site + webhook URL configured — the last piece to wire once that page is set up.' });
          return;
        }
        if (action === 'refund') {
          const rf = parsed.ref || '';                       // refund goes ONLY against the original transaction ref
          if (!rf) { send(res, 200, { ok:false, error:'No original transaction reference to refund against.' }); return; }
          cpRefund(rf, parsed.amount, store).then(j => { const r = cpNormalize(j); send(res, 200, { ok: r.status === 'approved', result: r, error: r.status !== 'approved' ? (r.message || r.status) : undefined }); });
          return;
        }
        /* ↩️ VOID — the right instrument for a mistake found the SAME DAY, and materially better than a refund:
           an unsettled transaction is cancelled outright, so it costs no interchange and never appears on the
           customer's statement at all. A refund is a second transaction that does. Reaching for the wrong one
           is a real cost to the customer's patience and the owner's fees, which is why 'inquire' exists next to
           it — the app asks the processor whether the batch has settled instead of guessing from the clock. */
        if (action === 'void') {
          const vr = parsed.ref || '';
          if (!vr) { send(res, 200, { ok:false, error:'No original transaction reference to void against.' }); return; }
          cpVoid(vr, store).then(j => { const r = cpNormalize(j); cardLog('void', deviceOf(req), ctx, r, { via:'ref ' + vr }); send(res, 200, { ok: r.status === 'approved', result: r, error: r.status !== 'approved' ? (r.message || r.status) : undefined }); });
          return;
        }
        if (action === 'inquire') {                            // has it settled yet? decides void vs refund
          const qr = parsed.ref || '';
          if (!qr) { send(res, 200, { ok:false, error:'No transaction reference to look up.' }); return; }
          cpInquire(qr, store).then(j => {
            const st = String((j && (j.setlstat || j.settlestat)) || '').toLowerCase();
            /* CardConnect reports settlement in setlstat. Anything other than an explicit "unsettled"/blank is
               treated as SETTLED — fail toward the refund, because attempting a void on a settled transaction
               fails outright whereas a refund always works. Never guess in the direction that leaves the
               customer's money with us. */
            const unsettled = (st === '' || st === 'unsettled' || st.indexOf('queued') >= 0);
            send(res, 200, { ok:true, raw:j, setlstat:st, canVoid:unsettled, mustRefund:!unsettled });
          });
          return;
        }
        if (action === 'cancel') {                            // stop the terminal prompting when the cashier leaves the pickup screen
          cptCancel(store).then(result => send(res, 200, { ok: !!(result && result.ok), result }));
          return;
        }
        send(res, 400, { ok:false, error:'Unknown payment action: ' + action });
        return;
      }

      // ===== Helcim (the chosen processor) =====
      if (provider === 'helcim') {
        if (!hcConfigured()) {
          send(res, 200, { ok:false, error:'Helcim is selected but the hub has no API token yet. Set OZARK_HELCIM_TOKEN on the hub, then restart. Until then, use the Simulator.' });
          return;
        }
        if (action === 'charge') {
          const tok = parsed.token || ctx.token || '';
          if (!tok) { send(res, 200, { ok:false, error:'No card token yet. Capture the card with HelcimPay.js (browser) or a Helcim Smart Terminal to get a token first.' }); return; }
          hcPurchase(tok, parsed.amount).then(result => send(res, 200, { ok: result.status === 'approved', result, error: result.status !== 'approved' ? (result.message || result.status) : undefined }));
          return;
        }
        if (action === 'save-card') {
          const tok = parsed.token || ctx.token || '';
          if (tok) { send(res, 200, { ok:true, result:{ status:'approved', token: tok, last4: ctx.last4 || '', brand: ctx.brand || 'Card' } }); return; }
          send(res, 200, { ok:false, error:'Capture the card with HelcimPay.js (browser) to get a token — the hub never handles card numbers.' });
          return;
        }
        if (action === 'link') {
          send(res, 501, { ok:false, error:'Helcim uses HelcimPay.js (a secure embedded form), not a simple link — wire the HelcimPay.js iframe in the browser for phone/keyed payments.' });
          return;
        }
        if (action === 'refund') {
          const tx = parsed.ref || '';
          if (!tx) { send(res, 200, { ok:false, error:'No original Helcim transaction id to refund against.' }); return; }
          hcRefund(tx, parsed.amount).then(result => send(res, 200, { ok: result.status === 'approved', result, error: result.status !== 'approved' ? (result.message || result.status) : undefined }));
          return;
        }
        send(res, 400, { ok:false, error:'Unknown payment action: ' + action });
        return;
      }

      // ===== Stripe placeholder (wire only if you choose Stripe instead) =====
      if (!PAYKEY) {
        send(res, 200, { ok:false, error:'No live card-processor credentials on the hub yet. Configure CardPointe (or set OZARK_STRIPE_SECRET / OZARK_HELCIM_TOKEN). Until then, use the Simulator in Settings → Card processing.' });
        return;
      }
      send(res, 501, { ok:false, error:'Credentials present, but live ' + provider + '/' + action + ' is not wired for this provider yet. (CardPointe is the wired path — see hub-server.js.)' });
    });
    return;
  }

  // everything else = static file (the app, the logo, etc.)
  serveStatic(req, res, u);
});

function lanIPs(){
  const out = [];
  const ifs = os.networkInterfaces();
  for (const name of Object.keys(ifs)) for (const ni of ifs[name]) {
    if (ni.family === 'IPv4' && !ni.internal && !ni.address.startsWith('169.')) out.push(ni.address);
  }
  return out.length ? out : ['127.0.0.1'];
}

server.listen(PORT, '0.0.0.0', () => {
  const ips = lanIPs();
  console.log('');
  console.log('  ============================================================');
  console.log('   🏭  OZARK PLANT HUB is running');
  console.log('  ============================================================');
  console.log('   Counter PCs + phone open this (same WiFi):');
  ips.forEach(ip => console.log('       http://' + ip + ':' + PORT + '/Ozark-POS.html'));
  console.log('   Hub status page:  http://' + ips[0] + ':' + PORT + '/hub');
  console.log('   Data folder:      ' + DATADIR);
  console.log('  ------------------------------------------------------------');
  console.log('   Leave this window OPEN. Close it to stop the hub.');
  console.log('   (First run: if Windows asks, click "Allow access" on');
  console.log('    Private networks so the tower & phone can connect.)');
  console.log('  ============================================================');
  console.log('');
});
server.on('error', e => {
  if (e.code === 'EADDRINUSE') console.log('  ✗ Port ' + PORT + ' is already in use. Is the hub already running?');
  else console.log('  ✗ Server error:', e.message);
});
