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
/* 📒 photos.json — the photo store's own little database (owner 2026-08-24: "photos.json as a separate
   database", after the scale question: thousands of photos, several per garment). One entry per FILE:
   bytes, when, which station sent it. ⚠️ The FILES are the ground truth — a missing or corrupt ledger is
   rebuilt from the directory, never the other way round — so this can never lose a photo; it only answers
   questions about them (how many, how big, whose, what is orphaned) without touching the synced DB. */
const PHOTOMETA = path.join(DATADIR, 'photos.json');
let PHOTOS = null;
function photoMetaLoad(){ if (PHOTOS) return PHOTOS;
  try { PHOTOS = JSON.parse(fs.readFileSync(PHOTOMETA, 'utf8')); } catch(e) { PHOTOS = null; }
  if (!PHOTOS || typeof PHOTOS !== 'object' || Array.isArray(PHOTOS)) { PHOTOS = {}; photoMetaReconcile(); }
  return PHOTOS; }
function photoMetaSave(){ try { writeAtomic(PHOTOMETA, JSON.stringify(PHOTOS || {})); } catch(e){} }
function photoMetaAdd(id, bytes, dev){ photoMetaLoad()[id] = { bytes: bytes|0, at: Date.now(), dev: String(dev||'') }; photoMetaSave(); }
function photoMetaDel(id){ const m = photoMetaLoad(); if (m[id]) { delete m[id]; photoMetaSave(); } }
/* files-first reconcile: an entry with no file is dropped, a file with no entry is adopted (size + mtime,
   station unknown). Also re-writes a MISSING ledger file so a deleted photos.json heals on the next ask. */
function photoMetaReconcile(){ const m = PHOTOS || (PHOTOS = {}); let changed = !fs.existsSync(PHOTOMETA); const seen = {};
  try { for (const f of fs.readdirSync(PHOTODIR)) { seen[f] = 1;
    if (!m[f]) { try { const st = fs.statSync(path.join(PHOTODIR, f)); if (st.isFile()) { m[f] = { bytes: st.size, at: Math.round(st.mtimeMs), dev: '' }; changed = true; } } catch(e){} } } } catch(e){}
  for (const k of Object.keys(m)) if (!seen[k]) { delete m[k]; changed = true; }
  if (changed) photoMetaSave(); return m; }
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
const DROPFILE = path.join(DATADIR, 'dropbox.json');          // 📦 24/7 drop-box check-ins (owner, 2026-09-08) — same separate-queue rule as pickups
const FBFILE   = path.join(DATADIR, 'feedback.json');         // customer feedback + $10 review-credit queue (also separate from the synced DB)
const PAYLINKFILE = path.join(DATADIR, 'pay-links.json');     // 💵 pay-your-balance links — amount, status and the processor ref of the one charge (never a token, never a card number)
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
function cpHostOf(cp){ if (process.env.OZARK_CARDPOINTE_HOST) return process.env.OZARK_CARDPOINTE_HOST; return cp.env === 'prod' ? (cp.site + '.cardconnect.com') : (cp.site + '-uat.cardconnect.com'); }   /* env override: lets test-hub point the gateway at a fake on 127.0.0.1 (and covers a CardPointe domain change) */
function cpAuthHeaderOf(cp){ return 'Basic ' + Buffer.from(cp.user + ':' + cp.pass).toString('base64'); }
function cptForStore(store){ store = String(store||''); return {
  host:    process.env['OZARK_CPTERM_HOST_'+store]    || CPT.host,
  hsn:     process.env['OZARK_CPTERM_HSN_'+store]     || CPT.hsn,
  mid:     process.env['OZARK_CPTERM_MID_'+store]     || CPT.mid,
  authkey: process.env['OZARK_CPTERM_AUTHKEY_'+store] || CPT.authkey }; }
function cptConfiguredFor(store){ const t = cptForStore(store); return !!(t.host && t.hsn && t.mid && t.authkey); }
let _cptSess = {};   // per-store session cache: { <store>: { key, exp } } — two stores = two terminals = two sessions
function cptReq(term, method, reqPath, headers, bodyObj, timeoutMs){
  return new Promise(function(resolve){
    const data = bodyObj ? JSON.stringify(bodyObj) : null;
    /* 🧪 a terminal at 127.0.0.1 is a TEST FIXTURE, never a real reader — Bolt is always a remote TLS host.
       This one carve-out lets test-hub stand up a fake terminal on real sockets and prove the lease below
       (the client dies → the hub cancels the reader) without a certificate dance. Narrow on purpose. */
    const _local = /^127\.0\.0\.1:(\d+)$/.exec(String(term.host||''));
    const _mod = _local ? http : https;
    const opts = { method, host: _local ? '127.0.0.1' : term.host, port: _local ? Number(_local[1]) : undefined, path: reqPath, headers: Object.assign({ 'content-type':'application/json', 'authorization': term.authkey }, headers||{}) };
    if (data) opts.headers['Content-Length'] = Buffer.byteLength(data);
    const rq = _mod.request(opts, (resp) => { let buf=''; resp.on('data', d => buf += d); resp.on('end', () => { let j=null; try { j = JSON.parse(buf); } catch(e){} resolve({ status: resp.statusCode, json: j, raw: buf, headers: resp.headers }); }); });
    rq.on('error', (e) => resolve({ status:0, error: e.message }));
    rq.setTimeout(timeoutMs || 120000, () => { rq.destroy(); resolve({ status:0, error:'terminal timed out (no card / not tapped)' }); });   // long: authCard waits for a human to tap (the charge read passes CardPointe's whole window, CPT_AUTH_TIMEOUT_MS)
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
    if (ctx.cpOrderId) body.orderId = ctx.cpOrderId;   // 💳🔎 CardPointe: a UNIQUE order id on every authCard, so an unclear answer can be looked up and voided by it
    ctx.authSent = true;                                // from here on CardPointe may hold this charge: an unclear answer is resolved, never guessed
    // ⚠️ includeExpirationDate is REQUIRED here. Without it the terminal returns a token but NO `expiry`, so the
    //    gateway fallback below sent no expiry at all and CardConnect replied "Non-numeric expiry" — a decline that
    //    named the wrong cause and sent us chasing the saved-card expiry twice (Vince 7/22, Simone 7/29,
    //    Arlo Barlowe 7/31 + 8/5, whose stored expiry was a perfectly valid "1028" the whole time).
    const ask = function(){ return cptReq(term, 'POST', '/api/v4/authCard', { 'x-cardconnect-sessionkey': sk }, body, CPT_AUTH_TIMEOUT_MS); };
    return ask().then(function onAnswer(r){
      /* 💳🗒 THE READER'S OWN ANSWER, RECORDED. Every one of these outcomes used to die on the station that saw
         it — a timeout with no card tapped, a decryption failure, "terminal already in use", a cancel. Which is
         why "Mastercards will not save" could not be checked: the hub had never heard of the attempt. */
      if (r.status === 0) { const e0 = { status:'error', message: r.error || 'terminal timed out (no card tapped)' };
        cardLog('terminal', ctx.dev || '', ctx, e0, { amount: amountCents, via:'no answer' }); return e0; }
      const j = r.json || {};
      if (j.respstat) { const norm = cpNormalize(j); if (!norm.last4 && j.token) norm.last4 = String(j.token).slice(-4);
        cardLog('terminal', ctx.dev || '', ctx, norm, { amount: amountCents, via:'read' }); return norm; }   // authCard authorized via the gateway → standard result
      if (j.errorMessage && body.orderId && /orderid/i.test(String(j.errorMessage))) {   // 💳🔎 a terminal that refuses the order id must never stop the shop taking cards (the 'bin' lesson, 8/10)
        console.log('  ⚠ the terminal REFUSED orderId (' + String(j.errorMessage).slice(0, 80) + ') — charging without it; an unclear answer on this read cannot be looked up');
        cardLog('terminal', ctx.dev || '', ctx, { status: 'error', message: 'orderId refused: ' + j.errorMessage }, { amount: amountCents, via: 'orderId refused' });
        delete body.orderId; ctx.orderIdRefused = true; return ask().then(onAnswer); }
      if (j.errorMessage) { const e1 = { status:'error', message: j.errorMessage };
        cardLog('terminal', ctx.dev || '', ctx, e1, { amount: amountCents, via:'reader refused' }); return e1; }
      if (j.token) return cpAuthCapture(j.token, amountCents, { ecomind:'R', expiry:j.expiry, store: store, orderid: ctx.cpOrderId });   // fallback: token only → auth via gateway (R = retail/card-present), same store
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
    return cptReq(term, 'POST', '/api/v4/authCard', { 'x-cardconnect-sessionkey': sk }, body, CPT_AUTH_TIMEOUT_MS).then(function(r){
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

/* ═══ 💳🔗 THE TERMINAL LEASE — the reader is only armed while the charge popup PROVABLY lives ═══
   Owner, 2026-08-29, after the Mercer double charge: "if the terminal is running, it is because our system
   is ready for an auth, otherwise it cancels itself." The 8/28 pagehide guard asks a dying page to say
   goodbye — but a crash, a freeze or a power cut says nothing. What DOES die in every death mode is the
   page's own HTTP connection to this hub, which it holds open for the whole life of the read. So:
     1. THE CONNECTION IS THE LEASE. If the client socket closes before the read settles, the hub itself
        cancels the terminal — within seconds, no cooperation from the page required.
     2. AN APPROVED CAPTURE IS NEVER DROPPED. If the dip beats the cancel and the bank approves while the
        page is gone (Mercer: refs 002130063008 vs 003418015663 — two captures, one recorded), the hub
        RECORDS the payment itself through its own front door (a delta to /api/db) plus a loud activity row,
        so the losing race can never again produce invisible money.
     3. THE READER REFUSES A SECOND ARM while a live popup holds it, naming who — and a stale armed session
        whose popup is dead has already been cancelled by rule 1, so "Terminal already in use" stops being
        a wall anyone has to climb.
   The lease covers all three terminal doors: the charge read, the keyed read, and the save-card read. */
let _cptInflight = {};   // per-store: the one armed session — { dev, at, gone, done }
function cptLease(req, res, store, dev){
  const me = { dev: dev || '', at: Date.now(), gone: false, done: false };
  _cptInflight[String(store||'')] = me;
  try { req.socket.setKeepAlive(true, 5000); } catch (e) {}   // a hard power cut sends no FIN; keepalive shortens the discovery from minutes to ~seconds
  res.on('close', function(){
    if (res.writableFinished) return;                          // a delivered response closing is the normal end, not a death
    me.gone = true;
    if (!me.done) {
      console.log('  💳🛑 the charge window died mid-read (' + me.dev + ', store ' + (store || 'default') + ') — freeing the terminal');
      cptCancel(store).then(function(r){ console.log('  💳🛑 terminal cancel → ' + (r && r.ok ? 'freed' : ('could not confirm (' + JSON.stringify(r || {}).slice(0, 80) + ')'))); });
    }
  });
  return me;
}
function cptLeaseSettle(store, me){ me.done = true; if (_cptInflight[String(store||'')] === me) delete _cptInflight[String(store||'')]; }
function cptLeaseBusy(store){ const inf = _cptInflight[String(store||'')]; return (inf && !inf.done && !inf.gone) ? inf : null; }
/* 💳🚨 record a capture whose register window died — through the hub's OWN front door, so the revision, the
   delta-log and the hash-chain all carry it exactly like any station's push. Payments are append-only and
   survive every merge; the activity row is the loud half so a human finishes the order-side bookkeeping
   (MON-10 also flags the order as paid-but-unmarked until they do — layered, not hopeful). */
function cptTermRecover(result, amountCents, ctx, store){
  const payRow = { id: 'hubrec_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
    orderId: ctx.orderId || null, customerId: ctx.cid || '', amount: Math.round(Number(amountCents) || 0) / 100,
    method: 'Card', txn: result.ref || '', auth: result.auth || '', brand: result.brand || 'Card',
    last4: result.last4 || '', date: Date.now(), storeId: Number(store) || 1, provider: 'cardpointe',
    hubRecovered: true, _t: Date.now() };
  const actRow = { ts: Date.now(), emp: '—', ws: 'hub', store: Number(store) || 1, type: '⚠ Terminal capture recovered',
    detail: '$' + payRow.amount.toFixed(2) + ' · ' + (ctx.who || ctx.cid || 'unknown customer') + ' · ref ' + (result.ref || '?') +
      ' · the register window died mid-read; the dip beat the cancel and the bank APPROVED. The hub recorded this payment — verify the order shows paid, and do NOT charge it again.' };
  /* 🧾 DURABLE FIRST (2026-09-16). The approval goes to its own append-only file BEFORE the push is even attempted —
     a hub restart, a busy-morning 409, or a bug below can no longer lose it; a human can always recover from this line. */
  const orphanFile = path.join(DATADIR, 'orphan-captures.jsonl');
  try { fs.appendFileSync(orphanFile, JSON.stringify({ ts: Date.now(), ref: result.ref || '', payRow: payRow, ctx: { who: ctx.who || '', cid: ctx.cid || '', orderId: ctx.orderId || null } }) + '\n'); }
  catch(e){ console.log('  💳🚨 could not write orphan-captures.jsonl (' + e.message + ') — ref ' + (result.ref || '?') + ' is still in card-events'); }
  /* ⚠️ RETRY ON 409. The hub's own front door refuses a stale baseRev exactly like a station's — and a station pushing at
     the same moment is the NORMAL busy-morning case. The first version logged '→ 409' as if that were success and gave
     up. Now: re-read the revision and try again, up to five times; only then say FAILED, loudly, naming the file. */
  const attempt = function(n){
    const d = JSON.stringify({ delta: true, baseRev: rev, db: { payments: [payRow], activity: [actRow] } });
    const rq = http.request({ host: '127.0.0.1', port: PORT, path: '/api/db', method: 'POST',
      headers: { 'content-type': 'application/json', 'Content-Length': Buffer.byteLength(d), 'x-ozark-key': HUBKEY, 'x-ozark-device': 'hub-terminal-recovery' } },
      function(x){ let b = ''; x.on('data', c => b += c); x.on('end', function(){
        if (x.statusCode === 200) { console.log('  💳🚨 orphan capture RECORDED ($' + payRow.amount.toFixed(2) + ' ref ' + (result.ref || '?') + ')' + (n > 1 ? ' on attempt ' + n : '')); return; }
        if (n < 5) { console.log('  💳🚨 orphan capture record got HTTP ' + x.statusCode + ' — retrying (' + n + '/5)'); setTimeout(function(){ attempt(n + 1); }, 400 * n); return; }
        console.log('  💳🚨 orphan capture record FAILED after 5 tries (last HTTP ' + x.statusCode + ') — ref ' + (result.ref || '?') + ' $' + payRow.amount.toFixed(2) + ' is in hub-data/orphan-captures.jsonl and card-events; recover by hand');
      }); });
    rq.on('error', function(e){
      if (n < 5) { setTimeout(function(){ attempt(n + 1); }, 400 * n); return; }
      console.log('  💳🚨 orphan capture record FAILED (' + e.message + ') — ref ' + (result.ref || '?') + ' $' + payRow.amount.toFixed(2) + ' is in hub-data/orphan-captures.jsonl and card-events; recover by hand'); });
    rq.write(d); rq.end();
  };
  attempt(1);
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
const PUBLIC_URL = (process.env.OZARK_PUBLIC_URL || 'https://hub.example.com').replace(/\/+$/, '');   // absolute https base Twilio can reach for delivery callbacks
var __smsStatus = {};   // MessageSid -> { status, errorCode, to, ts } — delivery confirmations Twilio posts back (in-memory, transient)
/* 📵🔏 TWILIO WEBHOOK SIGNATURES (8/28 readiness review). The two webhook POSTs were open to anyone: a forged
   START re-enables texts to someone who opted out (a compliance failure an attacker causes), and a forged
   "customer message" plants instructions in the POS inbox ("deliver to my new address"). Twilio signs every
   webhook: base64(HMAC-SHA1(authToken, url + sortedKey+value pairs)).
   ⚠️ THE FAILURE DIRECTION THAT MATTERS: refusing a REAL Twilio post silently drops a customer's STOP — worse
   than the forgery risk. So (a) with no auth token configured nothing real flows and everything is accepted;
   (b) the URL is checked against EVERY host the hub answers on, not just OZARK_PUBLIC_URL, because the console
   may be configured with either; (c) a refusal logs the exact fix; (d) OZARK_TWILIO_SKIP_SIGCHECK=1 is the
   escape hatch while investigating a refusal, never the resting state. */
function twSigOk(req, u, body){
  if (!TW.token) return true;                                        /* Twilio is not wired — nothing real arrives */
  if (process.env.OZARK_TWILIO_SKIP_SIGCHECK === '1') return true;   /* escape hatch — the refusal log names it */
  const sig = String(req.headers['x-twilio-signature'] || '');
  if (!sig) return false;
  let joined = '';
  try { const q = new URLSearchParams(body); joined = Array.from(new Set(Array.from(q.keys()))).sort().map(k => k + q.get(k)).join(''); } catch (e) {}
  const bases = Array.from(new Set([PUBLIC_URL, 'https://hub.example.com', 'https://track.cleaners.example.com'].filter(Boolean)));
  return bases.some(function(b){
    const expect = crypto.createHmac('sha1', TW.token).update(b + u + joined).digest('base64');
    try { return sig.length === expect.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect)); } catch (e) { return false; }
  });
}
/* 📵📬 THE MIGRATION FORWARDER (2026-08-31, launch eve). The pickup line +1-501-555-0031 lives in OUR Twilio
   account but its webhook pointed at SMRT, so customer replies never reached this app. Twilio calls exactly
   ONE webhook — "both" is built here: the number now points at the hub, and every VERIFIED inbound is copied
   to `OZARK_SMS_FORWARD_URL` (SMRT's incoming-sms endpoint; unset = no forwarding, which is the eventual
   end-state when SMRT is retired).
   ⚠️ The copy is RE-SIGNED for the TARGET url with our own auth token — SMRT validates X-Twilio-Signature
   against this same account's token, and the signature Twilio computed for OUR url would fail theirs.
   ⚠️ Fire-and-forget by design: our 200 TwiML to Twilio never waits on SMRT, and a dead SMRT costs SMRT the
   copy, never us the message. Only VERIFIED posts are forwarded — forwarding a forgery would launder it with
   a valid signature. SMRT's TwiML response (if it auto-replies) is discarded; only ONE system may answer. */
/* 📬 is this body a clear standalone YES? Mirrors the app's routeYesPositive (see the caller's drift note). */
function twYesish(bodyText){
  const t = String(bodyText || '').toLowerCase().replace(/[^a-zá-ú ]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!t) return false;
  if (/^yes\b/.test(t) || /^yessir\b/.test(t)) return true;
  return ['y','yep','yeah','yea','yup','si','sí','sure','absolutely','definitely','of course','will do','we will','i will','sure will'].indexOf(t) >= 0;
}
function smsForwardCopy(body){
  const target = String(process.env.OZARK_SMS_FORWARD_URL || '').trim();
  if (!target || !TW.token) return;
  try {
    const m = target.match(/^https?:\/\/([^\/]+)(\/.*)?$/); if (!m) return;
    let joined = '';
    try { const q = new URLSearchParams(body); joined = Array.from(new Set(Array.from(q.keys()))).sort().map(k => k + q.get(k)).join(''); } catch (e) {}
    const sig = crypto.createHmac('sha1', TW.token).update(target + joined).digest('base64');
    const _local = /^127\.0\.0\.1:(\d+)$/.exec(m[1]);   /* test fixture only, same carve-out as httpsJson */
    const rq = (_local ? http : https).request({ host: _local ? '127.0.0.1' : m[1], port: _local ? Number(_local[1]) : undefined, path: m[2] || '/', method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body), 'X-Twilio-Signature': sig } }, resp => { resp.resume();
      if (resp.statusCode >= 300) console.log('  📬 SMS copy: forward target answered HTTP ' + resp.statusCode + ' (our copy is already in; only the old system missed it)'); });
    rq.on('error', e => console.log('  📬 SMS copy: forward failed — ' + e.message + ' (our copy is already in; only the old system missed it)'));
    rq.setTimeout(10000, function(){ rq.destroy(); });
    rq.write(body); rq.end();
  } catch (e) {}
}
function twSigRefuse(res, u){
  console.log('📵🔏 REFUSED a Twilio webhook POST to ' + u + ' — bad or missing X-Twilio-Signature. If this is REAL Twilio traffic, the webhook URL in the Twilio console does not match a host this hub answers on (fix the console URL, or set OZARK_TWILIO_SKIP_SIGCHECK=1 in hub.env while investigating — never as the resting state).');
  send(res, 403, { ok:false, error:'signature' });
}
/* 🗺️ ADDRESS AUTOCOMPLETE via OpenStreetMap/Nominatim (free, no key, no account). Proxied through the hub so
   (a) any future keyed provider's secret stays server-side per the sovereign rule, (b) we can CACHE and
   RATE-LIMIT politely — Nominatim's usage policy asks for ≤1 req/sec and a real User-Agent identifying us.
   Returns compact labels that END with the ZIP, so the app's custZip() (card AVS) reads the zip off the saved
   address. Fails soft: any error resolves to [] so the app just falls back to a plain text box. */
const GEO_CACHE = new Map();   // q(lowercased) -> { at, results }
let GEO_LAST = 0;
function geocodeSearch(q){
  const key = q.toLowerCase();
  const hit = GEO_CACHE.get(key);
  if (hit && (Date.now() - hit.at) < 10 * 60 * 1000) return Promise.resolve(hit.results);   // 10-min cache
  const wait = Math.max(0, 1100 - (Date.now() - GEO_LAST));                                  // ≤ ~1 req/sec to Nominatim
  return new Promise(r => setTimeout(r, wait)).then(() => new Promise(resolve => {
    GEO_LAST = Date.now();
    const host = process.env.OZARK_GEO_HOST || 'nominatim.openstreetmap.org';   // a sovereign shop can self-host Nominatim; tests point it at a fake
    const lib = /^(127\.|localhost|::1)/.test(host) ? http : https;             // local override = http, the public service = https
    const hp = host.split(':');
    const opts = { method:'GET', host:hp[0], port:(hp[1]?Number(hp[1]):undefined),
      path:'/search?format=jsonv2&addressdetails=1&countrycodes=us&limit=5&q=' + encodeURIComponent(q),
      headers: { 'User-Agent':'OzarkCleaners-POS/1.0 (https://cleaners.example.com)', 'Accept-Language':'en', 'Accept':'application/json' } };
    const rq = lib.request(opts, resp => { let buf=''; resp.on('data', d => buf += d); resp.on('end', () => {
      let arr = []; try { arr = JSON.parse(buf); } catch (e) {}
      const results = (Array.isArray(arr) ? arr : []).map(function(p){ const a = p.address || {};
        const street = [a.house_number, a.road].filter(Boolean).join(' ');
        const city = a.city || a.town || a.village || a.hamlet || a.county || '';
        const zip = a.postcode || '';
        const label = [street, city, [a.state, zip].filter(Boolean).join(' ')].filter(Boolean).join(', ');
        return { label: label, zip: zip };
      }).filter(function(r){ return r.label && /\d/.test(r.label); });                        // a usable address has a number in it
      GEO_CACHE.set(key, { at: Date.now(), results: results });
      if (GEO_CACHE.size > 500) { const k = GEO_CACHE.keys().next().value; GEO_CACHE.delete(k); }
      resolve(results);
    }); });
    rq.on('error', () => resolve([])); rq.setTimeout(6000, () => { rq.destroy(); resolve([]); }); rq.end();
  }));
}
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
  H.push('Message-ID: <' + Date.now() + '.' + Math.random().toString(36).slice(2) + '@cleaners.example.com>');
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
   allowed to talk to mail.cleaners.example.com. Delete both env keys to go back to direct SMTP. */
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
/* @money @email — the pay-your-balance email: the amount, one button, and that it charges exactly that once. */
function payLinkEmailHtml(name, link, amountCents, part){
  const L = escH(link), amt = '$' + (Math.round(Number(amountCents) || 0) / 100).toFixed(2);
  return '<div style="font-family:Arial,Helvetica,sans-serif;color:#222;font-size:15px;max-width:560px;margin:0 auto">'
    + '<p>Hello' + (name ? ' ' + escH(name) : '') + ',</p>'
    + '<p>' + (part ? 'Here is your payment link for <b>' + amt + '</b> toward your account with <b>Ozark Cleaners and Laundry</b>.' : 'Your balance with <b>Ozark Cleaners and Laundry</b> is <b>' + amt + '</b>.') + ' You can pay it securely with the button below. Your card goes straight into our card processor\'s secure page — <b>we never see or store your card number</b>, and it is charged <b>' + amt + ' once</b>.</p>'
    + '<p style="text-align:center;margin:24px 0"><a href="' + L + '" style="background:#2e7d32;color:#fff;text-decoration:none;padding:12px 22px;border-radius:6px;font-weight:bold;display:inline-block">Pay ' + amt + '</a></p>'
    + '<p style="color:#555;font-size:13px">Or paste this into your browser:<br><a href="' + L + '">' + L + '</a></p>'
    + '<p style="color:#555;font-size:13px"><b>This link expires in 7 days</b> and can only be paid once. If you already paid, just ignore this email.</p>'
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
/* 🔑👁 THE READ-ONLY KEY (2026-09-26, v2 audit E85; owner: "build the read-only key"). The v2 copy reads this hub
   every hour, and until today it did so with OZARK_HUB_KEY — the same key that can overwrite this whole database
   (POST /api/db), charge cards, send texts and hand out setup codes. OZARK_HUB_READ_KEY in hub.env opens ONLY the
   five GETs that copy reads (the database, the open text inbox, pickup requests, reviews, the STOP list) and
   nothing else: never a push, a charge, a text, an e-mail, a setup code, a recovery cookie. The full key still
   opens those GETs as before. Unset, shorter than 24 characters, or equal to the full key, it opens nothing. */
const HUBREADKEY = process.env.OZARK_HUB_READ_KEY || '';
if (HUBREADKEY && (HUBREADKEY.length < 24 || HUBREADKEY === HUBKEY)) console.log('⚠ OZARK_HUB_READ_KEY is ' + (HUBREADKEY === HUBKEY ? 'the same as the full hub key' : 'shorter than 24 characters') + ' — it opens NOTHING until it is a separate, long key.');
/* @hub @permission @sync — the full key, or (GET only) the read-only key: the gate on the five reads the v2 copy makes */
function reqReadKeyOk(req){
  if (reqKeyOk(req)) return true;
  if (req.method !== 'GET' || !HUBREADKEY || HUBREADKEY.length < 24 || HUBREADKEY === HUBKEY) return false;
  const got = Buffer.from(String(req.headers['x-ozark-key'] || ''), 'utf8');
  const want = Buffer.from(HUBREADKEY, 'utf8');
  if (got.length !== want.length) return false;
  try { return crypto.timingSafeEqual(got, want); } catch (e) { return false; }
}
function keyErr(){ return HUBKEY ? 'unauthorized — set the matching hub key on this device'
  : 'the HUB has no access key set — put OZARK_HUB_KEY in hub.env on the SERVER and restart (nothing is wrong with this device)'; }   // 🧭 blast-radius diagnostics: when hub.env loses the key, every station 401s at once — the message must point at the hub, not send staff fiddling with each device
/* public order-tracker helpers (no hub key — returns ONLY a matched customer's sanitized order data; rate-limited) */
var __trackHits={};
/* 🤖 A CRAWLER FILLED IN OUR OWN FORM (owner, 2026-09-22: "this is the second weird route request").
   Three of the eight pickup requests ever received were not people. The one on 9/21 came from 66.249.83.32 —
   Google's crawler — POSTing the live form from cleaners.example.com with "Test Name", the Hot Springs STORE
   address lifted off the page, and a phone nobody gave us; an earlier one used the form's own placeholder
   "(501) 555-0123" verbatim. A crawler that submits forms is normal behaviour on the web; what is not normal
   is a van being sent to an address a robot typed. Three screens, cheapest first:
     · the user agent says crawler,
     · a BAIT field ('company') that is invisible to a person and irresistible to a form-filler,
     · a phone in the 555-01xx range, which the phone system reserves for fiction (our own placeholder).
   ⚠️ It answers {ok:true} and queues NOTHING. A bot told "blocked" learns to look human; and if this ever
   misjudges a real customer, they see the same thank-you they always did — the fault lands in our log, not
   on their screen. Every drop is logged with what tripped it, so a wrong call is findable. */
function botPost(req, res, what){
  var ua = String((req.headers && req.headers['user-agent']) || '');
  var body = req.__botBody || null;   /* set by the caller when the body is already parsed */
  var why = '';
  if (/bot\b|crawl|spider|slurp|headless|preview|facebookexternalhit|compatible; *Google/i.test(ua)) why = 'crawler user-agent';
  if (why) {
    console.log('  🤖 ' + what + ' submission dropped (' + why + ') · ' + ua.slice(0, 80));
    try { fs.appendFileSync(path.join(DATADIR, 'bot-drops.jsonl'), JSON.stringify({ ts: Date.now(), what: what, why: why, ua: ua.slice(0, 200),
      ip: String((req.headers['x-forwarded-for'] || (req.socket && req.socket.remoteAddress) || '?')).split(',')[0].trim() }) + '\n'); } catch (e) {}
    send(res, 200, { ok: true });
    return true;
  }
  return false;
}
/* 🤖 the two screens that need the PARSED body: the bait field, and a reserved-for-fiction phone number. */
function botBody(req, res, what, p){
  var why = '';
  if (String((p && p.company) || '').trim()) why = 'bait field filled';
  else { var d = String((p && p.phone) || '').replace(/\D/g, ''); if (/^\d{3}555 ?01\d\d$/.test(d) || /555 ?01\d\d$/.test(d)) why = 'reserved 555-01xx phone'; }
  if (!why) return false;
  console.log('  🤖 ' + what + ' submission dropped (' + why + ')');
  try { fs.appendFileSync(path.join(DATADIR, 'bot-drops.jsonl'), JSON.stringify({ ts: Date.now(), what: what, why: why,
    ua: String((req.headers && req.headers['user-agent']) || '').slice(0, 200), name: String((p && p.name) || '').slice(0, 60) }) + '\n'); } catch (e) {}
  send(res, 200, { ok: true });
  return true;
}
function trackRateOk(req){ var ip=String(req.headers['x-forwarded-for']||(req.socket&&req.socket.remoteAddress)||'?').split(',')[0].trim(); var now=Date.now(); var w=__trackHits[ip]; if(!w||now-w.t>60000){ __trackHits[ip]={t:now,n:1}; return true; } w.n++; return w.n<=20; }
/* ── 📱 ONE-TIME SETUP CODES — how a new phone gets the hub key without anyone typing it ─────────────────
   Owner, 2026-08-17: a new driver starts Wednesday and "will she have to copy and paste the hub key?"
   She should never SEE it. A connected station mints a short code; the phone trades that code for the key
   once; the code dies on use.
   ⚠️ WHY NOT A SETUP LINK WITH THE KEY IN IT — the obvious shortcut, and the wrong one. A URL carrying the
   key lands in browser history, in any messaging app it passes through, and in a screenshot; the secret would
   outlive the setup by years on a personal phone. A code is worthless ten minutes later.
   ⚠️ THE CLAIM ENDPOINT IS PUBLIC BY NECESSITY — the phone has no key yet, so it cannot authenticate. That
   makes it the only unauthenticated route in this server that can hand out a secret, and it is guarded on
   five axes: the code is one of ~1e9 (31^6, no lookalike glyphs), it expires in 15 minutes, it works ONCE,
   wrong guesses are throttled hard per IP, and a burst of wrong guesses anywhere trips a global brake and
   shouts in the log. Fail-closed like reqKeyOk: no hub key configured, no claiming.
   ⚠️ Codes are stored HASHED. The plaintext exists only in the reply to the station that asked for it. */
const SETUPFILE = path.join(DATADIR, 'setup-codes.json');
const SETUP_TTL_MS = 15 * 60 * 1000;
const SETUP_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';   // 31 glyphs — no 0/O/1/I/L to mis-read down a phone line
let SETUPS = [];
(function loadSetups(){ try { SETUPS = JSON.parse(fs.readFileSync(SETUPFILE, 'utf8')) || []; } catch (e) { SETUPS = []; } })();
function saveSetups(){ try { writeAtomic(SETUPFILE, JSON.stringify(SETUPS, null, 2)); } catch (e) {} }
function setupHash(code){ return crypto.createHash('sha256').update(String(code || '').trim().toUpperCase()).digest('hex'); }
function setupMint(by, ttlSec){
  /* ⚠️ a SHORTER life may be asked for (the gated mint passes it through, clamped) — a code for somebody
     standing next to you does not need fifteen minutes. It can never be made LONGER than the default, and
     the clamp is what makes the expiry guard testable in seconds instead of unprovable. */
  const ttl = Math.min(SETUP_TTL_MS, Math.max(1000, Math.floor(Number(ttlSec) * 1000) || SETUP_TTL_MS));
  return setupMintTtl(by, ttl);
}
function setupMintTtl(by, ttl){
  /* ⚠️ rejection sampling, not `% 31` — a plain modulo over 256 makes the first 8 glyphs likelier than the
     rest. It costs nothing to draw again and it keeps the search space honestly 31^6. */
  const A = SETUP_ALPHABET, lim = Math.floor(256 / A.length) * A.length;
  let code = '';
  while (code.length < 6) { const b = crypto.randomBytes(1)[0]; if (b < lim) code += A[b % A.length]; }
  const now = Date.now();
  SETUPS = SETUPS.filter(s => s.exp > now && !s.used).slice(-40);   // never let the file grow without bound
  SETUPS.push({ h: setupHash(code), exp: now + ttl, by: String(by || '').slice(0, 40), madeAt: now, used: false });
  saveSetups();
  return code;
}
let __setupFails = {}, __setupGlobal = { n: 0, t: 0 };
function setupClaimOk(req){
  const ip = String(req.headers['x-forwarded-for'] || (req.socket && req.socket.remoteAddress) || '?').split(',')[0].trim();
  const now = Date.now();
  if (now - __setupGlobal.t > 600000) __setupGlobal = { n: 0, t: now };
  if (__setupGlobal.n > 60) return false;                       // somebody is guessing — everyone waits
  const w = __setupFails[ip];
  if (!w || now - w.t > 600000) { __setupFails[ip] = { t: now, n: 0 }; return true; }
  return w.n < 5;                                                // 5 wrong guesses per IP per 10 minutes
}
function setupFailed(req){
  const ip = String(req.headers['x-forwarded-for'] || (req.socket && req.socket.remoteAddress) || '?').split(',')[0].trim();
  const now = Date.now();
  const w = __setupFails[ip] || (__setupFails[ip] = { t: now, n: 0 });
  w.n++; __setupGlobal.n++;
  if (__setupGlobal.n === 20) console.log('  🚨 SETUP CODES: 20 wrong guesses in 10 minutes — somebody is guessing at /api/setup-claim');
}
/* 🔑🍪 STATION RECOVERY TOKENS — "we can't keep losing our connections" (owner, 2026-08-27, after his phone
   woke up a stranger). A browser's QUOTA eviction wipes localStorage and IndexedDB — the key and the station
   identity — but COOKIES are exempt from quota eviction. So every connected station banks a long-lived token
   in a cookie scoped to ONE path; a station that wakes with no key trades the cookie for its key and its
   identity, silently, before anyone sees a set-up banner. Only a deliberate clear-site-data kills the cookie,
   and then the setup-code flow is the (existing, human) recovery.
   Guards: the file stores HASHES (a stolen file mints nothing) · exchange shares the setup-claim rate
   limiter · every exchange is logged loudly with IP and station · the key handed out is the CURRENT key, so
   rotating the hub key just works · delete rekey-tokens.json to revoke the whole fleet at once. */
const REKEYFILE = path.join(DATADIR, 'rekey-tokens.json');
let REKEYS = [];
(function loadRekeys(){ try { REKEYS = JSON.parse(fs.readFileSync(REKEYFILE, 'utf8')) || []; } catch (e) { REKEYS = []; } })();
function saveRekeys(){ try { writeAtomic(REKEYFILE, JSON.stringify(REKEYS, null, 2)); } catch (e) {} }
function rekeyHash(t){ return crypto.createHash('sha256').update(String(t || '')).digest('hex'); }
function rekeyCookieOf(req){ const m = /(?:^|;\s*)ozark_rt=([0-9a-f]{48})/.exec(String(req.headers.cookie || '')); return m ? m[1] : ''; }
function rekeyFind(tok){ if (!tok) return null; const want = rekeyHash(tok);
  return REKEYS.find(r => { try { return crypto.timingSafeEqual(Buffer.from(r.h,'hex'), Buffer.from(want,'hex')); } catch(e){ return false; } }) || null; }
function trackStatusLabel(s, atPlant){ if(s==='Received'||s==='Detailed') return 'Received - in line'; if(s==='In Process') return 'In process'; if(s==='Assembled') return atPlant?'Cleaned - heading to Hot Springs':'Cleaned - being bagged'; if(s==='Ready'||s==='Racked') return 'Ready for pickup'; if(s==='PickedUp') return 'Picked up'; if(s==='Split') return 'Being bagged'; return s; }   // Split shells are filtered out of the tracker; label kept as a belt-and-suspenders

/* tiny zero-dependency HTTPS JSON client (never rejects — always resolves a result) */
function httpsJson(method, host, reqPath, headers, bodyObj, timeoutMs){
  return new Promise((resolve) => {
    const data = bodyObj ? JSON.stringify(bodyObj) : null;
    /* test fixture only — the same carve-out cptReq has: a host of the exact shape 127.0.0.1:port goes over
       plain http so test-hub can stand up a fake gateway on a real socket. No production host matches. */
    const _local = /^127\.0\.0\.1:(\d+)$/.exec(String(host||''));
    const opts = { method, host: _local ? '127.0.0.1' : host, port: _local ? Number(_local[1]) : undefined, path: reqPath, headers: Object.assign({ 'Content-Type':'application/json', 'Accept':'application/json' }, headers || {}) };
    if (data) opts.headers['Content-Length'] = Buffer.byteLength(data);
    const rq = (_local ? http : https).request(opts, (resp) => { let buf=''; resp.on('data', d => buf += d); resp.on('end', () => { let j=null; try { j = JSON.parse(buf); } catch(e){} resolve({ status: resp.statusCode, json: j, raw: buf }); }); });
    rq.on('error', (e) => resolve({ status:0, json:null, error: e.message }));
    rq.setTimeout(timeoutMs || 20000, () => { rq.destroy(); resolve({ status:0, json:null, error:'timeout' }); });
    if (data) rq.write(data);
    rq.end();
  });
}
/* like httpsJson but sends application/x-www-form-urlencoded — the shape QuickBooks' OAuth token endpoint wants.
   Same 127.0.0.1:port test carve-out so test-hub can stand up a fake Intuit on a real socket. Never rejects. */
function httpsForm(method, host, reqPath, headers, formObj){
  return new Promise((resolve) => {
    const data = Object.keys(formObj||{}).map(k => encodeURIComponent(k)+'='+encodeURIComponent(formObj[k])).join('&');
    const _local = /^127\.0\.0\.1:(\d+)$/.exec(String(host||''));
    const opts = { method, host: _local ? '127.0.0.1' : host, port: _local ? Number(_local[1]) : undefined, path: reqPath,
      headers: Object.assign({ 'Content-Type':'application/x-www-form-urlencoded', 'Accept':'application/json', 'Content-Length': Buffer.byteLength(data) }, headers||{}) };
    const rq = (_local ? http : https).request(opts, (resp) => { let buf=''; resp.on('data', d => buf += d); resp.on('end', () => { let j=null; try { j = JSON.parse(buf); } catch(e){} resolve({ status: resp.statusCode, json: j, raw: buf }); }); });
    rq.on('error', (e) => resolve({ status:0, json:null, error: e.message }));
    rq.setTimeout(20000, () => { rq.destroy(); resolve({ status:0, json:null, error:'timeout' }); });
    rq.write(data); rq.end();
  });
}

/* ═══ 📗 QUICKBOOKS ONLINE — the ledger of record (BOOKS-OPEN.md), connected READ-ONLY ═══
   Owner, 2026-09-04: "finish making QB app so that this is the hardiest most theft proof, transparent system
   possible" — and chose read-only, straight to the real company. So this PULLS the Profit & Loss to (1) feed
   the public open-books page with real accounting figures a human still confirms, and (2) reconcile QuickBooks'
   income against what the register says it collected — two independent books that must agree is what makes
   theft visible. ⚠️ NOTHING is ever written into the accountant's ledger. ⚠️ Secrets live ONLY here on the
   droplet (hub.env), never in the repo/app/transcript. ⚠️ FAIL-SAFE: unconfigured → /api/qb/* says "not
   connected" and nothing else in the system notices. Tokens: hub-data/qbo-tokens.json (droplet-only, gitignored,
   same trust as hub.env). Setup runbook: QUICKBOOKS-SETUP.md. */
const QB = {
  clientId: process.env.OZARK_QBO_CLIENT_ID || '',
  secret:   process.env.OZARK_QBO_CLIENT_SECRET || '',
  env:      (process.env.OZARK_QBO_ENV || 'production').toLowerCase(),   // 'production' = the real company · 'sandbox' = Intuit's free fake company
  redirect: process.env.OZARK_QBO_REDIRECT || ''                        // the EXACT https callback registered in the Intuit app
};
function qbConfigured(){ return !!(QB.clientId && QB.secret && QB.redirect); }
function qbAuthHost(){  return process.env.OZARK_QBO_AUTH_HOST  || 'appcenter.intuit.com'; }          // where the owner signs in + authorizes
function qbTokenHost(){ return process.env.OZARK_QBO_TOKEN_HOST || 'oauth.platform.intuit.com'; }     // token exchange + refresh
function qbApiHost(){   return process.env.OZARK_QBO_API_HOST   || (QB.env === 'sandbox' ? 'sandbox-quickbooks.api.intuit.com' : 'quickbooks.api.intuit.com'); }
const QBTOKFILE = path.join(DATADIR, 'qbo-tokens.json');
let QBTOK = {}; try { QBTOK = JSON.parse(fs.readFileSync(QBTOKFILE, 'utf8')) || {}; } catch (e) {}
function qbSaveTok(){ try { writeAtomic(QBTOKFILE, JSON.stringify(QBTOK)); } catch (e) {} }
const QBSTATE = Object.create(null);   // OAuth CSRF state → expiry, in memory only (a login handshake is ephemeral)
function qbBasicAuth(){ return 'Basic ' + Buffer.from(QB.clientId + ':' + QB.secret).toString('base64'); }
function qbAuthUrl(state){ return 'https://' + qbAuthHost() + '/connect/oauth2?client_id=' + encodeURIComponent(QB.clientId) +
  '&response_type=code&scope=' + encodeURIComponent('com.intuit.quickbooks.accounting') +
  '&redirect_uri=' + encodeURIComponent(QB.redirect) + '&state=' + encodeURIComponent(state); }
function qbStoreTokens(t, realmId){
  if (!t || !t.access_token) return false;
  QBTOK.access_token = t.access_token;
  if (t.refresh_token) QBTOK.refresh_token = t.refresh_token;
  QBTOK.expires_at = Date.now() + ((+t.expires_in || 3600) - 60) * 1000;                 // refresh a minute early
  if (t.x_refresh_token_expires_in) QBTOK.refresh_expires_at = Date.now() + (+t.x_refresh_token_expires_in) * 1000;
  if (realmId) QBTOK.realmId = String(realmId);
  QBTOK.connected_at = QBTOK.connected_at || Date.now();
  qbSaveTok(); return true;
}
async function qbRefresh(){
  if (!QBTOK.refresh_token) return { ok:false, error:'not connected' };
  const r = await httpsForm('POST', qbTokenHost(), '/oauth2/v1/tokens/bearer', { 'Authorization': qbBasicAuth() },
    { grant_type:'refresh_token', refresh_token: QBTOK.refresh_token });
  if (r.json && r.json.access_token) { qbStoreTokens(r.json, QBTOK.realmId); return { ok:true }; }
  return { ok:false, error:(r.json && (r.json.error_description || r.json.error)) || ('http ' + r.status) };
}
async function qbAccessToken(){
  if (!QBTOK.access_token || !QBTOK.realmId) return null;
  if (Date.now() >= (QBTOK.expires_at || 0)) { const r = await qbRefresh(); if (!r.ok) return null; }
  return QBTOK.access_token;
}
async function qbApiGet(reqPath){
  const tok = await qbAccessToken(); if (!tok) return { status:0, json:null, error:'not connected' };
  return httpsJson('GET', qbApiHost(), reqPath, { 'Authorization':'Bearer ' + tok }, null);
}
/* walk a QuickBooks Profit&Loss report for a summary group's total (the last column of its summary row). Defensive:
   the report is deeply nested and shapes vary by company; anything not found comes back null, never a wrong number. */
function qbReportGroup(rep, group){
  let found = null;
  (function walk(rows){ if (!rows) return; const arr = Array.isArray(rows) ? rows : (rows.Row || []);
    for (const r of arr) { if (!r) continue;
      if (r.group === group) { const sd = (r.Summary && r.Summary.ColData) || r.ColData; if (sd && sd.length) { const v = parseFloat(sd[sd.length-1].value); if (isFinite(v)) found = v; } }
      if (r.Rows) walk(r.Rows); } })(rep && rep.Rows);
  return found;
}
async function qbPull(startISO, endISO){
  if (!qbConfigured()) return { ok:false, error:'not configured' };
  if (!QBTOK.realmId) return { ok:false, error:'not connected' };
  const r = await qbApiGet('/v3/company/' + encodeURIComponent(QBTOK.realmId) + '/reports/ProfitAndLoss?start_date=' + startISO + '&end_date=' + endISO + '&minorversion=73');
  if (!r.json || r.status !== 200) { const m = (r.json && r.json.Fault && r.json.Fault.Error && r.json.Fault.Error[0] && r.json.Fault.Error[0].Message); return { ok:false, error: m || r.error || ('http ' + r.status), status:r.status }; }
  const out = { ok:true, start:startISO, end:endISO,
    income: qbReportGroup(r.json, 'Income'), expenses: qbReportGroup(r.json, 'Expenses'),
    grossProfit: qbReportGroup(r.json, 'GrossProfit'), net: qbReportGroup(r.json, 'NetIncome'),
    pulledAt: Date.now() };
  try { const dir = path.join(DATADIR, 'books'); fs.mkdirSync(dir, { recursive:true }); writeAtomic(path.join(dir, 'qbo-' + startISO + '_' + endISO + '.json'), JSON.stringify(out, null, 2)); } catch (e) {}
  QBTOK.last_pull = Date.now(); qbSaveTok();
  return out;
}
/* what the REGISTER says it collected in a window — the same rule /api/books uses (money that moved; an Account
   row books a debt and is excluded, the MON-10 lesson). This is summing recorded payments, NOT recomputing an
   order's worth, so it does not touch the app's money math (the ⛔ live-money rule is about order totals). */
function posCollectedRange(startISO, endISO){
  const raw = readDB(); const db = raw && raw.db; if (!db) return 0;
  const s = Date.parse(startISO + 'T00:00:00'), e = Date.parse(endISO + 'T23:59:59'); let sum = 0;
  for (const pm of (db.payments || [])) { if (!(pm.amount > 0) || /^account$/i.test(pm.method || '')) continue;
    const t = +pm.date || Date.parse(pm.date) || 0; if (t >= s && t <= e) sum += pm.amount; }
  return Math.round(sum * 100) / 100;
}
/* the reporting window: an explicit start/end (YYYY-MM-DD) if both are valid, else the last full calendar month. */
function qbPeriod(start, end){
  const iso = d => d.toISOString().slice(0,10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(start||'')) && /^\d{4}-\d{2}-\d{2}$/.test(String(end||''))) return { start, end };
  const now = new Date();
  return { start: iso(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth()-1, 1))),
           end:   iso(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0))) };
}

/* ==================== 💳🏦 CARDPOINTE FUNDING — read-only settlement reconcile ====================
   The second independent ledger behind Open Books: the processor's own record of what it DEPOSITED to the
   bank, vs what the register says it collected. This is the LIVE, automated version of cardpointe-reconcile.js
   (the CSV tool) — it pulls the CardConnect Funding API per store/MID over a date range.

   CardConnect confirmed (support, 2026-09-09): credentials are CUSTOMER-LEVEL — one set per customer id, and
   both of our MIDs sit under the same CID, so the SAME creds we already use for card processing
   (OZARK_CARDPOINTE_USER/PASS) also read funding. The funding host is the "fts" site. They enabled the
   "Deposit Data from Processor" bill flag on both MIDs, so the data flows.

   ⚠️ READ ONLY. ⚠️ FAIL-SAFE: unconfigured → /api/cp/funding/* says "not configured" and nothing else notices.
   ⚠️ Secrets live ONLY in hub.env. Reuses cpForStore() creds/MID per store; funding-only overrides via
   OZARK_CPFUND_USER/PASS/MID[_<store>] and OZARK_CPFUND_HOST (the last lets test-hub point at a fake on
   127.0.0.1, same carve-out as httpsJson). Setup: CARDPOINTE-FUNDING-SETUP.md.
   ⚠️ The funding RESPONSE field mapping in cpFundNormalize is PROVISIONAL — confirm it against the FIRST real
   pull and adjust ONLY that function (same discipline as the QuickBooks P&L parse). */
function cpFund(store){ store = String(store == null ? '' : store); const cp = cpForStore(store); return {
  user: process.env['OZARK_CPFUND_USER_' + store] || process.env.OZARK_CPFUND_USER || cp.user,
  pass: process.env['OZARK_CPFUND_PASS_' + store] || process.env.OZARK_CPFUND_PASS || cp.pass,
  mid:  process.env['OZARK_CPFUND_MID_' + store]  || cp.mid,
  env:  (process.env.OZARK_CPFUND_ENV || cp.env || 'uat').toLowerCase() }; }
/* which stores have a funding MID configured — derived from env so it needs no hard-coded store list */
function cpFundStores(){ const s = new Set();
  Object.keys(process.env).forEach(function(k){ const m = /^OZARK_(?:CPFUND|CARDPOINTE)_MID_(\d+)$/.exec(k); if (m && process.env[k]) s.add(m[1]); });
  if (process.env.OZARK_CPFUND_MID || CP.mid) s.add('1');   // the GLOBAL gateway MID belongs to store 1 — Arkadelphia = the globals, per-store keys override (CLAUDE.md). Always include it, or a store whose MID is the global (no _1 suffix) is silently left out of the reconcile.
  return Array.from(s).sort(); }
function cpFundConfigured(){ return cpFundStores().some(function(st){ const f = cpFund(st); return !!(f.user && f.pass && f.mid); }); }
function cpFundHost(env){ if (process.env.OZARK_CPFUND_HOST) return process.env.OZARK_CPFUND_HOST;   // test/override
  return (String(env).toLowerCase() === 'prod') ? 'fts.cardconnect.com' : 'fts-uat.cardconnect.com'; }
function cpFundAuth(f){ return 'Basic ' + Buffer.from(f.user + ':' + f.pass).toString('base64'); }
function cpFundMMDD(d){ return ('0' + (d.getUTCMonth() + 1)).slice(-2) + ('0' + d.getUTCDate()).slice(-2); }
const cpNum = v => { if (v == null) return 0; const n = parseFloat(String(v).replace(/[$,]/g, '')); return isFinite(n) ? n : 0; };
const cpSumField = v => Array.isArray(v) ? v.reduce((n, x) => n + cpNum(x && typeof x === 'object' ? (x.amount != null ? x.amount : x.amt) : x), 0) : cpNum(v);
/* Field mapping CONFIRMED against the first real pull (2026-09-16, MID ••0881, funding date 2026-09-15), the day
   CardPointe support enabled "Deposit Data from Processor". The real shape:
     { fundingdate:"YYYY-MM-DD", merchid,
       fundings:[{ netsales, interchangefee, servicecharge, fee, thirdparty, adjustment, otheradjustment, reversal,
                   totalfunding, currency, dateadded, datechanged }],
       adjustments:[], chargebacks:[],
       txns:[{ retref, cardnumber:"44XXXXXXXXXX4530", cardbrand, cardtype, amount, status:"Processed", authcode,
               invoicenumber, authdate, fundingid, ... }] }
   ⚠️ The funding DATE is at the TOP level, not on each funding row — the provisional mapping read it from the
   row and produced "" for every day, and read sales/funded from names that do not exist and produced 0. The
   provisional names are kept as fallbacks so the test fake and any older shape still parse. */
function cpFundNormalize(j){
  if (!j) return [];
  const topDate = String(j.fundingdate || j.datefunded || j.date || '');
  const arr = Array.isArray(j.fundings) ? j.fundings : (Array.isArray(j.funding) ? j.funding : (Array.isArray(j) ? j : []));
  return arr.map(function(f){ if (!f || typeof f !== 'object') return null;
    const date  = String(f.fundingdate || f.datefunded || f.date || f.datef || topDate || '');
    const sales = cpNum(f.netsales != null ? f.netsales : (f.sales != null ? f.sales : (f.salesamount != null ? f.salesamount : (f.grosssales != null ? f.grosssales : f.amountsubmitted))));
    const realFees = (f.interchangefee != null || f.servicecharge != null || f.thirdparty != null);
    const fees  = realFees ? Math.round((cpNum(f.interchangefee) + cpNum(f.servicecharge) + cpNum(f.fee) + cpNum(f.thirdparty)) * 100) / 100
                           : cpSumField(f.fees != null ? f.fees : f.fee);
    const realAdj = (f.adjustment != null || f.otheradjustment != null || f.reversal != null);
    const adj   = realAdj ? Math.round((cpNum(f.adjustment) + cpNum(f.otheradjustment) + cpNum(f.reversal)) * 100) / 100
                          : cpSumField(f.adjustments != null ? f.adjustments : f.adjustment);
    const funded = (f.totalfunding != null) ? cpNum(f.totalfunding)
      : (f.netdeposit != null || f.amountfunded != null || f.funded != null || f.amount != null)
        ? cpNum(f.netdeposit != null ? f.netdeposit : (f.amountfunded != null ? f.amountfunded : (f.funded != null ? f.funded : f.amount)))
        : Math.round((sales - Math.abs(fees) + adj) * 100) / 100;
    return { date: date, sales: sales, fees: fees, adjustments: adj, funded: funded };
  }).filter(Boolean); }
/* The per-TRANSACTION settlement detail CardConnect ships with each funding day: every settled charge with its
   retref — the key a transaction-level reconcile (duplicates, orphans) matches against POS payments. This is the
   automated form of what cardpointe-reconcile.js does from a hand-exported CSV. Card numbers arrive masked;
   only the last 4 are kept. */
function cpFundTxns(j){
  const arr = (j && Array.isArray(j.txns)) ? j.txns : [];
  return arr.map(function(t){ if (!t || typeof t !== 'object') return null;
    return { retref: String(t.retref || ''), last4: String(t.cardnumber || '').replace(/\D/g, '').slice(-4),
      brand: String(t.cardbrand || ''), type: String(t.cardtype || ''), amount: cpNum(t.amount), status: String(t.status || ''),
      authcode: String(t.authcode || ''), invoice: String(t.invoicenumber || ''), authdate: (t.authdate != null ? String(t.authdate) : ''),
      fundingid: (t.fundingid != null ? String(t.fundingid) : '') };
  }).filter(Boolean); }
async function cpFundingDay(store, mmdd){
  const f = cpFund(store); if (!(f.user && f.pass && f.mid)) return { ok:false, store:store, error:'not configured' };
  const r = await httpsJson('GET', cpFundHost(f.env), '/cardconnect/rest/funding?date=' + encodeURIComponent(mmdd) + '&merchid=' + encodeURIComponent(f.mid),
    { 'Authorization': cpFundAuth(f) }, null);
  const rawText = (r.raw != null) ? String(r.raw).slice(0, 2000) : null;   // bounded, for first-pull debug
  if (!r.json || r.status !== 200) return { ok:false, store:store, mmdd:mmdd, status:r.status, error:(r.error || ('http ' + r.status)), raw:rawText };
  /* CardConnect answers a day with no settlement as 200 {"errormsg":"No deposits match your request"} — that
     is NOT a reconciled $0 and NOT an error; it means the processor reported nothing for that date. Flag it so
     an empty range never masquerades as "everything reconciles." */
  if (r.json.errormsg && !r.json.fundings && !r.json.funding) return { ok:true, store:store, mmdd:mmdd, noData:true, msg:String(r.json.errormsg), raw:rawText, rows:[] };
  return { ok:true, store:store, mid:f.mid, mmdd:mmdd, raw:rawText, json:r.json, rows: cpFundNormalize(r.json), txns: cpFundTxns(r.json) };
}
async function cpFundingPull(startISO, endISO, debug){
  const stores = cpFundStores(); if (!stores.length || !cpFundConfigured()) return { ok:false, error:'not configured' };
  const s = new Date(startISO + 'T12:00:00Z'), e = new Date(endISO + 'T12:00:00Z');
  if (!(s <= e)) return { ok:false, error:'bad date range' };
  const days = Math.round((e - s) / 86400000) + 1; if (days > 62) return { ok:false, error:'range too wide (max 62 days) — pull a month at a time' };
  const out = { ok:true, start:startISO, end:endISO, sales:0, fees:0, adjustments:0, funded:0, daysQueried:days, daysWithData:0, daysNoData:0, stores:{}, errors:[], pulledAt:Date.now() };
  if (debug) out.debug = {};   // ⚠️ first-real-pull confirmation: capture the raw API response so the provisional field mapping can be checked/fixed (hub-key gated; the owner's own data)
  for (const store of stores){ const f = cpFund(store); if (!(f.user && f.pass && f.mid)) continue;
    const rec = out.stores[store] = { mid:f.mid, sales:0, fees:0, adjustments:0, funded:0, daysWithData:0, daysNoData:0, rows:[], txns:[] };
    for (let i = 0; i < days; i++){ const day = new Date(s.getTime() + i * 86400000);
      const got = await cpFundingDay(store, cpFundMMDD(day));
      if (debug && out.debug[store] == null && (got.raw != null || got.error)) out.debug[store] = { mmdd: cpFundMMDD(day), status: got.status, error: got.error || null, raw: got.raw != null ? got.raw : null };
      if (!got.ok){ if (got.error && got.error !== 'not configured' && got.status !== 404) out.errors.push('store ' + store + ' ' + cpFundMMDD(day) + ': ' + got.error); continue; }
      if (got.noData){ rec.daysNoData++; out.daysNoData++; continue; }   // processor reported nothing for this date — not a reconciled zero
      if (got.rows.length){ rec.daysWithData++; out.daysWithData++; }
      got.rows.forEach(function(row){ rec.rows.push(row); rec.sales += row.sales; rec.fees += row.fees; rec.adjustments += row.adjustments; rec.funded += row.funded; });
      (got.txns || []).forEach(function(t){ rec.txns.push(t); });   // the settled transactions behind that day's deposit
    }
    ['sales','fees','adjustments','funded'].forEach(function(k){ rec[k] = Math.round(rec[k] * 100) / 100; out[k] = Math.round((out[k] + rec[k]) * 100) / 100; });
  }
  out.processorReturnedNoData = (out.daysWithData === 0);   // ⚠️ the range came back empty — do NOT read this as "everything reconciles"
  try { const dir = path.join(DATADIR, 'books'); fs.mkdirSync(dir, { recursive:true }); writeAtomic(path.join(dir, 'cpfunding-' + startISO + '_' + endISO + '.json'), JSON.stringify(out, null, 2)); } catch (e) {}
  return out;
}
/* what the REGISTER says it collected on CARDS in a window — nets voids/reversals/refunds (negative card
   rows), excludes the Card-fee surcharge. Summing recorded payments, not recomputing an order (the live-money
   rule is about order totals), so it is safe here. */
function posCardCollectedRange(startISO, endISO, store){
  const raw = readDB(); const db = raw && raw.db; if (!db) return 0;
  const s = Date.parse(startISO + 'T00:00:00'), e = Date.parse(endISO + 'T23:59:59'); let sum = 0;
  for (const pm of (db.payments || [])){ const m = pm.method || ''; if (!/card/i.test(m) || /fee/i.test(m)) continue;
    if (store != null && String(pm.storeId != null ? pm.storeId : pm.takenStore) !== String(store)) continue;
    const t = +pm.date || Date.parse(pm.date) || 0; if (t >= s && t <= e) sum += (Number(pm.amount) || 0); }
  return Math.round(sum * 100) / 100;
}
async function cpFundReconcile(startISO, endISO){
  const pull = await cpFundingPull(startISO, endISO); if (!pull.ok) return pull;
  const posCard = posCardCollectedRange(startISO, endISO);
  /* the comparable to POS gross card collected is the processor's GROSS sales submitted; when the API doesn't
     expose gross, fall back to funded+fees so the two lenses still line up roughly. */
  const procGross = (pull.sales > 0) ? pull.sales : Math.round((pull.funded + Math.abs(pull.fees)) * 100) / 100;
  return { ok:true, start:startISO, end:endISO, processorSales:pull.sales, processorFunded:pull.funded,
    fees:pull.fees, adjustments:pull.adjustments, procGrossUsed:procGross, posCardCollected:posCard,
    variance: Math.round((procGross - posCard) * 100) / 100,
    daysWithData:pull.daysWithData, daysNoData:pull.daysNoData, processorReturnedNoData:pull.processorReturnedNoData,
    note: pull.processorReturnedNoData ? 'CardConnect returned no deposit data for this range — do NOT read the variance as reconciled; the Funding API had nothing for these dates.' : null,
    stores:pull.stores, errors:pull.errors };
}
/* 💳🔍 TRANSACTION-LEVEL RECONCILE over the funding feed (2026-09-16). CardConnect ships every settled
   transaction with each day's deposit (txns[] — see cpFundTxns), so the hub can now do, automatically and with
   the credentials it already has, what cardpointe-reconcile.js did from a hand-exported CSV:
     · ORPHANS    — settled at the processor, no POS payment carries that retref (money taken, no ticket)
     · DOUBLES    — same card tail + same amount settled under 2+ distinct retrefs (a double charge). Because the
                    feed lists TERMINAL settlements too, this catches the Bolt double-tap class (Cretu, 09/09)
                    that the POS-internal dupChargeScan cannot see. A voided duplicate never settles, so it is
                    correctly absent here.
     · UNSETTLED  — a POS card payment old enough that it should have settled, with no settled retref
     · MISMATCH   — matched by retref, but the settled amount differs from what the register recorded
   READ ONLY — money moves stay with the owner. ⚠️ Funding is dated by BATCH: a payment from the last day or
   two of a window may simply not have settled yet; those are counted as pendingSettlement, never as unsettled.
   ⚠️ If the feed carried no txns at all for days that had deposits, the unsettled lens is withheld (an
   older response shape must not read as "nothing settled"). */
const CP_SETTLE_GRACE_MS = 4 * 24 * 3600 * 1000;   // a batch can take two business days to fund; four calendar days absorbs a weekend or a bank holiday (Labor Day week, 9/2026)
async function cpFundTxReconcile(startISO, endISO){
  const pull = await cpFundingPull(startISO, endISO); if (!pull.ok) return pull;
  const raw = readDB(); const db = raw && raw.db; const pays = (db && db.payments) || [];
  const norm = function(v){ return String(v == null ? '' : v).replace(/\D/g, ''); };
  const s = Date.parse(startISO + 'T00:00:00'), e = Date.parse(endISO + 'T23:59:59');
  const posByRef = {}; const posInWindow = [];
  pays.forEach(function(pm){
    const m = pm.method || ''; if (!/card/i.test(m) || /fee/i.test(m)) return;
    const r = norm(pm.ref) || norm(pm.txn); if (r) (posByRef[r] = posByRef[r] || []).push(pm);
    const t = +pm.date || Date.parse(pm.date) || 0;
    if (t >= s && t <= e && Number(pm.amount) > 0 && !/void|refund/i.test(m)) posInWindow.push(pm);
  });
  const settled = [];
  Object.keys(pull.stores || {}).forEach(function(st){ (pull.stores[st].txns || []).forEach(function(t){ settled.push(Object.assign({ store: st }, t)); }); });
  const txnsUnavailable = (settled.length === 0 && pull.daysWithData > 0);
  const processed = settled.filter(function(t){ return /process|settle|captur|approv/i.test(t.status) && t.amount > 0; });
  const groups = {};
  processed.forEach(function(t){ const k = t.last4 + '|' + t.amount.toFixed(2); (groups[k] = groups[k] || []).push(t); });
  const doubles = Object.keys(groups).map(function(k){ return groups[k]; })
    .filter(function(g){ return new Set(g.map(function(t){ return t.retref; })).size > 1; })
    .map(function(g){ const n = new Set(g.map(function(t){ return t.retref; })).size;
      return { last4: g[0].last4, brand: g[0].brand, amount: g[0].amount, distinctCharges: n, retrefs: g.map(function(t){ return t.retref; }), stores: g.map(function(t){ return t.store; }), overcharge: Math.round((n - 1) * g[0].amount * 100) / 100 }; });
  /* EQUAL-PRICED SPLIT BAGS: every retref in the group matches a POS payment, and those payments sit on
     DISTINCT orders → two bags priced the same, both correct (Quintrell / Carthew, 09/09). A real double
     has an unmatched half (Cretu) or lands on one order. Bags go to equalBags: visible, never an overcharge. */
  const equalBags = [];
  const realDoubles = doubles.filter(function(d){
    const oids = []; let allMatched = true;
    d.retrefs.forEach(function(r){ const hits = posByRef[norm(r)]; if (!hits || !hits.length){ allMatched = false; return; } hits.forEach(function(pm){ oids.push(pm.orderId || null); }); });
    const distinct = allMatched && oids.length >= 2 && oids.every(function(o){ return o != null; }) && new Set(oids).size === oids.length;
    if (distinct){ equalBags.push(Object.assign({}, d, { kind: 'equal-priced-bags', overcharge: 0, orderIds: oids })); return false; }
    return true;
  });
  doubles.length = 0; realDoubles.forEach(function(d){ doubles.push(d); });
  const inDouble = new Set(); doubles.forEach(function(d){ d.retrefs.forEach(function(r){ inDouble.add(r); }); });
  const matchedTx = [], unmatched = [], mismatches = [];
  processed.forEach(function(t){
    const hits = posByRef[norm(t.retref)];
    if (!hits || !hits.length){ unmatched.push(t); return; }
    matchedTx.push(t);
    const posAmt = Math.round(hits.reduce(function(n, pm){ return n + (Number(pm.amount) || 0); }, 0) * 100) / 100;
    if (Math.abs(posAmt - t.amount) >= 0.01) mismatches.push({ retref: t.retref, last4: t.last4, settled: t.amount, register: posAmt, store: t.store });
  });
  /* an unticketed charge that is one half of a DOUBLE is reported under the double, never twice */
  const orphans = unmatched.filter(function(t){ return !inDouble.has(t.retref); });
  /* FEED COVERAGE. Deposit data begins on the first day the processor has any — live, that is 2026-09-09, the
     week the flag was enabled: 09/01–09/08 answered "no deposits" at BOTH stores for eight straight days that
     certainly took cards, and the whole 09/08 card day ($270.69) looked "unsettled" until that was understood.
     A POS payment dated before the feed's first deposit day cannot be called unsettled — the feed does not
     reach it. Report those separately as beforeFeedCoverage, never as a finding. A rule that cries wolf trains
     people to overrule it; the bank statement covers the days the feed cannot. */
  let feedFrom = null;
  Object.keys(pull.stores || {}).forEach(function(st){ (pull.stores[st].rows || []).forEach(function(row){ if (row.date && (!feedFrom || row.date < feedFrom)) feedFrom = row.date; }); });
  const feedFromMs = feedFrom ? Date.parse(feedFrom + 'T00:00:00') : null;
  const settledRefs = new Set(processed.map(function(t){ return norm(t.retref); }));
  const unsettled = [], pendingSettlement = [], beforeFeedCoverage = [];
  if (!txnsUnavailable) posInWindow.forEach(function(pm){
    const r = norm(pm.ref) || norm(pm.txn); if (!r || settledRefs.has(r)) return;
    const t = +pm.date || Date.parse(pm.date) || 0;
    const row = { id: pm.id, amount: Number(pm.amount) || 0, last4: pm.last4 || '', ref: pm.ref || pm.txn || '', date: pm.date, orderId: pm.orderId || null, store: pm.storeId };
    if (feedFromMs != null && t < feedFromMs) beforeFeedCoverage.push(row);
    else if (t > e - CP_SETTLE_GRACE_MS) pendingSettlement.push(row);
    else unsettled.push(row);
  });
  const sum = function(a, k){ return Math.round(a.reduce(function(n, x){ return n + (Number(x[k]) || 0); }, 0) * 100) / 100; };
  return { ok:true, start:startISO, end:endISO, settledTxns:processed.length, matched:matchedTx.length, unmatched:unmatched.length,
    orphans:orphans, orphansTotal:sum(orphans, 'amount'), doubles:doubles, doublesOvercharge:sum(doubles, 'overcharge'), equalBags:equalBags,
    mismatches:mismatches, posUnsettled:unsettled, posUnsettledTotal:sum(unsettled, 'amount'), pendingSettlement:pendingSettlement.length,
    feedCoverageFrom:feedFrom, beforeFeedCoverage:beforeFeedCoverage.length, beforeFeedCoverageTotal:sum(beforeFeedCoverage, 'amount'),
    txnsUnavailable:txnsUnavailable, daysWithData:pull.daysWithData, daysNoData:pull.daysNoData, processorReturnedNoData:pull.processorReturnedNoData,
    note: pull.processorReturnedNoData ? 'CardConnect returned no deposit data for this range — nothing here is reconciled.'
        : (txnsUnavailable ? 'Deposits came back but with no transaction detail — the unsettled lens is withheld.'
        : (beforeFeedCoverage.length ? ('The settlement feed has no data before ' + feedFrom + '; ' + beforeFeedCoverage.length + ' POS card payment(s) dated earlier are outside its coverage, not unsettled — check those against the bank statement.') : null)),
    errors:pull.errors };
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
      via: (extra && extra.via) ? String(extra.via).slice(0, 32) : '' };
    { const oid = (extra && extra.orderid) || r.orderid || (ctx && ctx.cpOrderId); if (oid) e.orderid = String(oid).slice(0, 24); }   // 💳🔎 the CardPointe order id: what inquireByOrderid / voidByOrderId look up
    if (r.respcode) e.respcode = String(r.respcode).slice(0, 8);   /* the processor's numeric reason — "Decline" alone is unanalysable (learned 8/31) */
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
/* 💳 WHICH CARD IS IT? Owner, 2026-08-10: "bianca says that mastercards still will not save." All 21 saved
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
  /* ⚠️ A MALFORMED REQUEST OF OURS COMES BACK AS respstat 'C' — THE SAME CODE AS A BANK DECLINE, and until
     2026-08-18 we recorded it as one. The activity log held 534 "Card declined" rows; the recent ones read
     `Invalid value for param: 'bin'`, which is CardConnect rejecting OUR request, not a customer's card being
     refused. Three costs, all real: it blamed a customer for our bug, it polluted Theft Watch (a risk report
     that must stay trustworthy), and it buried the genuine declines among false ones — 476 of them landed on
     one customer in a single day.
     ⚠️ The test is deliberately NARROW. Only wording that plainly describes OUR request being wrong counts;
     anything ambiguous stays a decline, because calling a real decline "our fault" would send staff hunting a
     bug while a customer walks out unpaid. */
  const _txt = String(j.resptext || j.respmsg || '');
  const _ourFault = /invalid (value for )?param|invalid param|missing param|invalid field|malformed|not a valid (field|param)/i.test(_txt);
  return {
    status: stat === 'A' ? 'approved' : ((stat === 'C' && !_ourFault) ? 'declined' : 'error'),
    requestRejected: _ourFault || undefined,
    ref:   j.retref || '',
    auth:  j.authcode || '',
    last4: cpLast4(j.account),
    brand: cpBrandOf(j),
    bin:   (j.binInfo && (j.binInfo.bin || j.binInfo.binlo)) || '',
    token: j.token || j.account || '',
    respcode: j.respcode || '',
    /* 💳 THE BANK'S CATEGORY REACHES THE COUNTER (2026-09-01, Wade Smythe). The gateway often says MORE than
       "Decline" — declineCategoryText "Wait to retry" means a SOFT decline (funds / daily limit / online
       purchases switched off in the customer's banking app), which is a different conversation with the
       customer than a dead card. Folded into message so every screen, card stamp and log line carries it. */
    message: (j.resptext || (j.respcode ? ('code ' + j.respcode) : '')) +
      ((stat === 'C' && !_ourFault && j.declineCategoryText) ? (' — bank says: ' + j.declineCategoryText) : '')
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
  if (cur && cur.state === 'finished') {
    /* 🔁 A DECLINE IS NEVER REPLAYED (2026-08-31, Wade Smythe ····1111). The key exists so one intent cannot
       CHARGE twice — but a declined attempt charged nothing, so there is no double-charge to prevent. Replaying
       it turned one bad bank answer into a PERMANENT block on that intent: the customer clears the hold with
       their bank, the counter retries, and the hub hands back the cached "Decline" without ever asking — proven
       live 8/31, where attempt 2 carried attempt 1's exact retref. An approval still replays forever, which is
       the whole point. A fresh decline attempt claims the key again, so the in-flight guard still holds. */
    if (cur.result && cur.result.status === 'declined') {
      console.log('  🔑 ' + key.slice(0, 60) + ' finished as a DECLINE — retry goes to the bank fresh, nothing was ever charged');
      idemWrite({ key: key, state: 'started', ts: Date.now(), amount: (meta && meta.amount) || 0, cid: (meta && meta.cid) || '' });
      return { go: true };
    }
    return { replay: cur.result };
  }
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
  body.orderid = opts.orderid || cpOrderId(opts.store);   // 💳🔎 CardPointe: a unique order id on every auth
  if (opts.name)    body.name    = opts.name;
  if (opts.address) body.address = opts.address;
  if (opts.city)    body.city    = opts.city;
  if (opts.region)  body.region  = opts.region;
  if (opts.postal)  body.postal  = opts.postal;            // AVS (street# + zip) = best practice + better rates
  if (opts.cof)   { body.cof = opts.cof; body.cofscheduled = opts.cofscheduled || 'N'; }   // stored-credential framework when reusing a saved card
  return httpsJson('PUT', cpHostOf(cp), '/cardconnect/rest/auth', { 'Authorization': cpAuthHeaderOf(cp) }, body, CP_AUTH_TIMEOUT_MS
  ).then(function(r){
     if (r.json && r.json.respstat) { const n = cpNormalize(r.json); n.orderid = body.orderid; return n; }
     const why = 'CardPointe HTTP ' + r.status + (r.error ? ' · ' + r.error : '');
     if (r.status >= 400 && r.status < 500) return { status:'error', message: why, orderid: body.orderid };   // CardPointe answered and refused the request: nothing was charged
     if (opts.capture === 'N') return { status:'error', message: why };                                      // a $0 verify moves no money: nothing to resolve
     /* 💳🔎 no answer (timeout, dropped, 5xx): CardPointe may have charged it. Resolve by order id BEFORE anyone is told. */
     return cpResolveUnknown(body.orderid, opts.store, 'charge', { cid: opts.cid || '', store: opts.store }, amountCents, 'gateway', { message: why });
   })
   .then(function(result){
     /* 🔑 record the ANSWER against the key, so a retry replays it instead of charging again. Recorded for
        a decline too — a decline is a real answer to that intent, and re-sending it would just annoy the
        processor and the customer. Only an ERROR (we never got an answer) is left un-finished, because in that
        case we genuinely do not know and a human must look. */
     try {
       if (_idem && opts.capture !== 'N' && result && (result.status === 'approved' || result.status === 'declined' || result.safeRetry)) {
         idemFinish(_idem, result.safeRetry ? Object.assign({}, result, { status: 'declined' }) : result);   // "not charged, safe to retry" frees the key exactly like a decline; an UNKNOWN stays open for a person
       }
     } catch (e) {}
     return result;
   });
}
/* ═══ 💳🔎 CARDPOINTE'S OWN RULES FOR AN ANSWER THAT DID NOT COME (2026-09-23) ═══
   Owner: "are we using cardpointe recommendations for processing and integrations? i am sick to my stomach about
   all these double charges." We were not, on the one point that mattered. CardPointe's developer docs say:
     · put a UNIQUE order id on every authorization (authCard and the gateway auth alike);
     · when no answer comes back, look it up with inquireByOrderid; if that answers nothing either, send
       voidByOrderId, up to THREE times, so the charge cannot stand without us knowing;
     · the terminal needs its whole window: 2 minutes at the reader plus 32 seconds at the gateway.
   What we did instead: a 2-minute cut-off (the gateway: 20 seconds), no order id, and every unclear answer (a
   timeout, "Authorization Cancelled", "Command Cancelled", a lost connection) went back to the counter as an error
   the screen called "Card declined". So the cashier ran the card again. Every double so far came through that
   door: Cretu 9/09 and Garavito 9/22 (our log said cancelled; CardPointe had captured), Hythe 9/18 (approved after
   the screen gave up), Mercer 8/28 (a stuck earlier read).
   Now an unclear answer is RESOLVED before the counter hears anything:
     intent 'charge' (no answer, timeout, lost): CardPointe approved it → it IS the payment (kept, recorded);
     intent 'cancel' (the cashier cancelled, or the reader said cancelled): CardPointe approved it → VOIDED;
     not found / no answer → voided by order id (harmless when there is nothing), then "not charged, safe to retry";
     CardPointe cannot be reached at all → status 'unknown': the counter says DO NOT RUN IT AGAIN.
   The counter shows "declined" only when the BANK declined. */
const CPT_AUTH_TIMEOUT_MS = Number(process.env.OZARK_CPTERM_AUTH_TIMEOUT_MS) || 165000;   // CardPointe: 2:00 at the reader + 0:32 at the gateway, plus margin
const CP_AUTH_TIMEOUT_MS  = Number(process.env.OZARK_CP_AUTH_TIMEOUT_MS) || 35000;       // CardPointe: the gateway answers an auth within ~32 s
const CP_RESOLVE_MS = (function(){ const raw = process.env.OZARK_CP_RESOLVE_MS; const p = raw ? String(raw).split(',') : [];
  const v = function(i, d){ const n = Number(p[i]); return (p.length > i && isFinite(n) && n >= 0 && n < 60000) ? n : d; };
  return { first: v(0, 3000), second: v(1, 12000), voidGap: v(2, 2000) }; })();                // test seam only; production uses the defaults
/* @money @card — a CardPointe order id: unique, alphanumeric, 16 characters. */
function cpOrderId(store){ return ('OZ' + String(store == null ? '' : store).replace(/\D/g, '').slice(0, 1) + Date.now().toString(36) + Math.random().toString(36).slice(2, 7)).toUpperCase().slice(0, 19); }
/* @money @card — read an inquireByOrderid answer: approved (and not voided), voided, declined, not found, or no answer. */
function cpReadInquiry(r){
  if (!r || r.status === 0 || r.status >= 500 || r.json == null) return { state: 'noanswer', why: (r && (r.error || ('HTTP ' + r.status))) || 'no answer' };
  const list = (Array.isArray(r.json) ? r.json : [r.json]).filter(Boolean);
  const live = list.filter(function(t){ return t.respstat === 'A' && !/void/i.test(String(t.setlstat || '')); });
  if (live.length) return { state: 'approved', txn: live[live.length - 1], count: live.length };
  if (list.some(function(t){ return /void/i.test(String(t.setlstat || '')); })) return { state: 'voided' };
  const t0 = list[0] || {};
  if (!list.length || /not found/i.test(String(t0.resptext || ''))) return { state: 'notfound' };
  if (t0.respstat === 'C') return { state: 'declined', txn: t0 };
  return { state: 'noanswer', why: String(t0.resptext || 'unrecognized answer').slice(0, 80) };
}
/* @money @card — CardPointe inquireByOrderid: lowercase d, verified LIVE 9/23 ("Txn not found", respcode 29; inquireByOrderId is a 404). */
function cpInquireByOrder(orderid, store){
  const cp = cpForStore(store), host = cpHostOf(cp), hdr = { 'Authorization': cpAuthHeaderOf(cp) };
  const paths = ['inquireByOrderid', 'inquireByOrderId'].map(function(n){ return '/cardconnect/rest/' + n + '/' + encodeURIComponent(orderid) + '/' + encodeURIComponent(cp.mid) + '/1'; });
  const at = function(i){ return httpsJson('GET', host, paths[i], hdr, null, CP_AUTH_TIMEOUT_MS).then(function(r){
    if ((r.status === 404 || r.status === 405) && i + 1 < paths.length) return at(i + 1);
    return cpReadInquiry(r); }); };
  return at(0);
}
/* @money @card — CardPointe voidByOrderId, up to THREE times when no answer comes (their rule). */
function cpVoidByOrder(orderid, store){
  const cp = cpForStore(store);
  const once = function(n){ return httpsJson('PUT', cpHostOf(cp), '/cardconnect/rest/voidByOrderId', { 'Authorization': cpAuthHeaderOf(cp) }, { merchid: cp.mid, orderid: orderid }, CP_AUTH_TIMEOUT_MS).then(function(r){
    const j = r && r.json;
    if (j && j.respstat === 'A') return { state: 'voided', txn: j };
    if (j && /not found/i.test(String(j.resptext || ''))) return { state: 'notfound' };
    if (j && j.respstat === 'C') return { state: 'refused', why: String(j.resptext || '').slice(0, 80) };   // e.g. already settled: that is a refund, and a person decides
    if (n < 3) return new Promise(function(ok){ setTimeout(ok, CP_RESOLVE_MS.voidGap); }).then(function(){ return once(n + 1); });
    return { state: 'noanswer', why: (r && (r.error || ('HTTP ' + r.status))) || 'no answer' };
  }); };
  return once(1);
}
/* @money @card — resolve an unclear answer by order id, BEFORE the counter is told anything (the rules above). */
function cpResolveUnknown(orderid, store, intent, ctx, amountCents, dev, orig){
  const wait = function(ms){ return new Promise(function(ok){ setTimeout(ok, ms); }); };
  const log = function(out, via){ cardLog('resolve', dev, ctx, out, { amount: amountCents, via: via, orderid: orderid, cid: ctx && ctx.cid }); return out; };
  const why = String((orig && orig.message) || 'no answer').slice(0, 80);
  return wait(CP_RESOLVE_MS.first).then(function(){ return cpInquireByOrder(orderid, store); }).then(function(q){
    return q.state === 'notfound' ? wait(CP_RESOLVE_MS.second).then(function(){ return cpInquireByOrder(orderid, store); }) : q;   // an auth still on its way lands in the gap
  }).then(function(q){
    if (q.state === 'approved' && intent === 'charge') { const n = cpNormalize(q.txn); n.status = 'approved'; n.orderid = orderid; n.recovered = 'inquireByOrderid'; return log(n, 'inquire:approved'); }
    if (q.state === 'declined') { const n = cpNormalize(q.txn); n.orderid = orderid; return log(n, 'inquire:declined'); }
    if (q.state === 'voided') return log({ status: 'error', message: 'Not charged: CardPointe shows this order voided. Safe to run the card again.', safeRetry: true, orderid: orderid }, 'inquire:voided');
    return cpVoidByOrder(orderid, store).then(function(v){
      let out;
      if (v.state === 'voided') out = { status: 'error', message: (q.state === 'approved' ? 'Cancelled. CardPointe had approved it, so it was VOIDED.' : 'The reader did not finish (' + why + '). CardPointe had the charge, and it was VOIDED.') + ' Nothing charged. Safe to run the card again.', safeRetry: true, voided: true, orderid: orderid };
      else if (v.state === 'notfound' && q.state !== 'approved') out = { status: 'error', message: 'The reader did not finish (' + why + '), and CardPointe has no charge for it. Nothing charged. Safe to run the card again.', safeRetry: true, orderid: orderid };
      else out = { status: 'unknown', message: 'Could not confirm with CardPointe whether this charged (' + why + '). Do NOT run the card again. Check CardPointe for order ' + orderid + ' first.', orderid: orderid };
      return log(out, 'inq:' + q.state + '/void:' + v.state);
    });
  });
}
/* @money @card — a terminal read's answer, settled by CardPointe's rules. A cancel the cashier pressed means a late approval is VOIDED. */
function cpSettleTerminal(result, orderid, store, lease, ctx, amountCents, dev){
  const r = result || { status: 'error', message: 'no answer from the terminal' };
  const cancelled = !!(lease && lease.cancelled);
  if (r.status === 'approved') {
    if (!cancelled) { r.orderid = orderid; return Promise.resolve(r); }
    /* approved AFTER the cashier cancelled (Hythe, 9/18): the screen is gone and nobody will record it, so it must not stand */
    return cpVoidByOrder(orderid, store).then(function(v){
      const out = v.state === 'voided'
        ? { status: 'error', message: 'Cancelled. The card had already been approved, so it was VOIDED. Nothing charged.', safeRetry: true, voided: true, orderid: orderid }
        : { status: 'unknown', message: 'Cancelled, but the card had already been approved and the void was not confirmed. Do NOT run the card again. Check CardPointe for order ' + orderid + '.', orderid: orderid };
      cardLog('resolve', dev, ctx, out, { amount: amountCents, via: 'cancel/void:' + v.state, orderid: orderid, cid: ctx && ctx.cid }); return out; });
  }
  if (ctx && ctx.orderIdRefused) return Promise.resolve(r);                                              // the terminal refused the order id: nothing to look up by
  if (r.status === 'declined' || r.requestRejected) { r.orderid = orderid; return Promise.resolve(r); }   // the BANK said no, or CardPointe refused our request: nothing charged
  if (!ctx || !ctx.authSent) return Promise.resolve(r);                                                   // the reader never started this charge (no session): nothing to look up
  if (/already in use|CancellableTask/i.test(String(r.message || ''))) return Promise.resolve(r);         // the reader refused to start: this order id never reached CardPointe
  const intent = (cancelled || /cancel/i.test(String(r.message || ''))) ? 'cancel' : 'charge';
  return cpResolveUnknown(orderid, store, intent, ctx, amountCents, dev, r).then(function(out){
    /* the cashier pressed Cancel WHILE CardPointe was being asked (the lookup takes seconds): an approval found now has no screen to
       book it, so it is voided, exactly like an approval that lands after a cancel */
    if (!(out && out.status === 'approved' && lease && lease.cancelled)) return out;
    return cpVoidByOrder(orderid, store).then(function(v){
      const o2 = v.state === 'voided' ? { status: 'error', message: 'Cancelled. CardPointe had approved it, so it was VOIDED. Nothing charged.', safeRetry: true, voided: true, orderid: orderid }
                                   : { status: 'unknown', message: 'Cancelled while CardPointe was being checked; it had approved the charge and the void was not confirmed. Do NOT run the card again. Check CardPointe for order ' + orderid + '.', orderid: orderid };
      cardLog('resolve', dev, ctx, o2, { amount: amountCents, via: 'late cancel/void:' + v.state, orderid: orderid, cid: ctx && ctx.cid }); return o2; });
  });
}
/* 💳🔎 run records: a counter whose connection dropped mid-charge asks what happened to ITS run instead of guessing */
const _cpRuns = new Map();   // runId -> { orderid, store, amount, at, result, doneAt }
/* @money @card — remember a terminal charge by the counter's run id. */
function cpRunStart(runId, orderid, store, amount){ if (!runId) return; const now = Date.now();
  _cpRuns.forEach(function(v, k){ if (now - v.at > 3600000) _cpRuns.delete(k); });
  _cpRuns.set(String(runId).slice(0, 64), { orderid: orderid, store: store, amount: amount, at: now, result: null }); }
/* @money @card — record how that run ended. */
function cpRunDone(runId, result, extra){ const r = runId ? _cpRuns.get(String(runId).slice(0, 64)) : null; if (r) { r.result = Object.assign({}, result || {}, extra || {}); r.doneAt = Date.now(); } }
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

/* 🪟 TWO WINDOWS ON ONE MACHINE, ACROSS DIFFERENT ORIGINS — the case the older tripwire cannot see.
   Live failure 2026-08-18: the Assembly PC had the POS open in Chrome (running since 8/14) AND in the desktop
   shell. They load the app from DIFFERENT ADDRESSES, so they share no localStorage and no BroadcastChannel —
   the app's own one-window election is blind between them — and each carries its OWN station id. The hub saw
   two stations, not two windows, so nothing anywhere noticed. Both autosaved and pushed, so a scan landing in
   one was overwritten by the other's older copy: Dana had to scan pieces repeatedly, and a 9-piece order
   came out as bags of 3+2+3+1 instead of 5+4 because the board kept shrinking under her.
   ⚠️ STATION ID IS THE WRONG KEY — it is exactly what differed. The station NAME is what survived across the
   two origins, so that is what this keys on.
   ⚠️ IT ONLY REPORTS. Nothing is refused and no window is closed: choosing the loser wrongly takes the screen
   away from whoever is actually working, and on a route phone that is a driver at a doorstep. What was missing
   on 8/18 was not enforcement — it was anybody being TOLD. */
const STATION_WRITERS = global.__ozarkStationWriters = (global.__ozarkStationWriters || new Map());   /* name -> Map(deviceId -> lastPushMs) */
const TWIN_ACTIVE_MS = 10 * 60000;   /* BOTH must have pushed inside this window; a dormant migration row must never raise it (Hot Springs keeps two rows for one counter on purpose) */
function twinNote(name, id){
  if (!name || !id) return;
  let m = STATION_WRITERS.get(name); if (!m) { m = new Map(); STATION_WRITERS.set(name, m); }
  m.set(id, Date.now());
  for (const [k, ts] of m) if (Date.now() - ts > TWIN_ACTIVE_MS * 6) m.delete(k);   /* bounded: forget long-silent writers */
}
function twinOf(id){
  if (!id) return null;
  const now = Date.now();
  for (const [name, m] of STATION_WRITERS) {
    const mine = m.get(id); if (!mine || now - mine > TWIN_ACTIVE_MS) continue;
    let otherId = '', otherAt = 0;
    for (const [k, ts] of m) { if (k === id || now - ts > TWIN_ACTIVE_MS) continue; if (ts > otherAt) { otherAt = ts; otherId = k; } }
    if (otherId) return { name: name, otherId: otherId, otherAt: otherAt };
  }
  return null;
}

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
                           snapshotEveryHours:1, healthEverySec:1, numBand:1 };
/* 🔢 numBand — the workstation's ORDER-NUMBER BLOCK (owner, 2026-09-10: "each workstation reserves 1000
   spots... the stations never even try to use the same numbers"). Band N owns the 1000 numbers [N*1000,
   N*1000+999] per store per day, so Assembly=1 mints …-1000.., Arkadelphia counter=2 mints …-2000.., Hot
   Springs=3 mints …-3000.. — collision-proof BY CONSTRUCTION, even fully offline. The owner picks which
   station gets which band (he named them); the hub's job is to REFUSE a band already held by a different
   station id, so the one thing that would re-open collisions — two stations on the same band — cannot be
   fat-fingered. bandOwnerConflict() below is that refusal. */
function bandOwnerConflict(all, id, band){
  band = Number(band) || 0; if (!(band > 0)) return null;
  const hit = Object.keys(all).find(other => other !== id && Number(((all[other] || {}).want || {}).numBand) === band);
  return hit || null;
}
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
let CHAIN_OK = true, CHAIN_WHY = '', CHAIN_START = 0;
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
            if (!fs.existsSync(dest)) { fs.writeFileSync(dest, buf); photoMetaAdd(id, buf.length, 'push'); }   /* content-addressed: the same photo twice costs one file */
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
        /* changed, or brand new → it belongs in every delta from here on.
           ⚠️ "CHANGED" MEANS THE CONTENT, NOT THE BYTES (2026-08-26 — the sibling of the 8/11 tombstone
           re-stamp bug, found as a fleet-wide echo storm on route day). A station's mirror heal pushes the
           FULL database; every record comes back as an echo, and any record re-stamped since that station's
           last pull carries a LAGGING `_seq` — the hub's own bookkeeping field. The old whole-JSON compare
           read that (and a mere key-order difference from the app's reference-preserving merge fold) as a
           change, re-stamped it, which made a new delta, which made the next station's mirror drift, which
           made IT heal with a full push... four customers rode every delta for 250 straight revisions.
           So: strip `_seq` and compare key-order-blind (mirrorStable — the one serializer both sides already
           share). Content-equal keeps the STORED `_seq`, never the echo's — a lagging stamp must not regress
           the watermark either, or stations that already pulled the newer one would read as drifted. */
        if (!was) { r._seq = atRev; continue; }
        if (JSON.stringify(was) === JSON.stringify(r)) { if (r._seq == null) r._seq = was._seq != null ? was._seq : 0; continue; }   // byte-identical fast path
        const _a = Object.assign({}, was); delete _a._seq;
        const _b = Object.assign({}, r); delete _b._seq;
        if (mirrorStable(_a) !== mirrorStable(_b)) r._seq = atRev;
        else r._seq = (was._seq != null) ? was._seq : (r._seq != null ? r._seq : 0);
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
/* ============================================================================================
   🔗 THE DELTA-LOG IS A HASH-CHAIN (2026-08-21). Owner: "close that gap, hash-chain and off-droplet anchor...
   never any missed timestamps gaps, or missing hash." Each line carries `p` (the previous line's hash) and
   `h` (this line's hash over everything else). A missing revision, a re-ordered line, a changed byte, or a
   torn tail all BREAK the chain at a nameable revision — so a copy pulled off the droplet can be PROVEN
   complete and untampered, which is what makes an off-droplet anchor trustworthy.
   ⚠️ It rides the append that is already "the commit", adds no network call, and the hash is computed BEFORE
   the write — so if it ever threw, the push is refused exactly as a failed append is, never half-committed.
   ⚠️ The head lives in memory (DELTA_HEAD) and is resumed from the last real line at boot, so the chain
   continues across a process restart AND across a log roll (the roll only renames the file). */
const GENESIS = '0'.repeat(64);
let DELTA_HEAD = GENESIS;
function sha256hex(str){ return require('crypto').createHash('sha256').update(str).digest('hex'); }
/* 🔁 THE TRANSFER HASH — a station verifies every delta SET it receives against this before applying it, so a
   truncated or garbled pull is caught at the door, not discovered later as drift. Owner: "the stations always
   makes sure they get a transfer hash for each set." It is FNV-1a over a stable serialization, chosen because
   the browser must compute the IDENTICAL number synchronously with no crypto dependency — the <SET-HASH v1>
   block below is BYTE-IDENTICAL in hub-server.js and Ozark-POS.html (test-hub fails if it drifts, like the
   mirror block). This guards accidental corruption/truncation, which is the real risk over TLS; it is not an
   anti-tamper boundary (that is the sha256 chain). */
/* <SET-HASH v1> */
function setHashOf(dbPart, tombPart){
  var str = JSON.stringify(dbPart || {}) + '|' + JSON.stringify(tombPart || []);
  var h = 2166136261, i;
  for (i = 0; i < str.length; i++){ h = (h ^ str.charCodeAt(i)) >>> 0; h = (h * 16777619) >>> 0; }
  return (h >>> 0);
}
/* @sync @hub — count records in a delta set, so a station can confirm a pull was not truncated. */
function setCountOf(dbPart){ var n = 0, k; for (k in (dbPart || {})){ if (Array.isArray(dbPart[k])) n += dbPart[k].length; } return n; }
/* </SET-HASH v1> */
/* the canonical bytes a line's hash covers — a FIXED key order, rebuilt the same way on verify, so it never
   depends on JSON key-order surviving a parse. */
function chainBody(o){ return JSON.stringify({ rev:o.rev, ts:o.ts, device:o.device, db:o.db, _tomb:o._tomb, p:o.p }); }
function chainHashOf(o){ return sha256hex(chainBody(o)); }
/* resume the head from the newest real line: the current log, else the newest rolled file, else genesis */
function chainHeadAtBoot(){
  const files = [DELTALOG];
  try { fs.readdirSync(DATADIR).filter(f => /^delta-log-.*\.jsonl$/.test(f))
    .sort().reverse().forEach(f => files.push(path.join(DATADIR, f))); } catch (e) {}
  for (const f of files){
    let txt = ''; try { txt = fs.readFileSync(f, 'utf8'); } catch (e) { continue; }
    const lines = txt.split('\n');
    for (let i = lines.length - 1; i >= 0; i--){
      const ln = lines[i].trim(); if (!ln) continue;
      try { const o = JSON.parse(ln); if (o && o.h) return String(o.h); } catch (e) { continue; }   // torn tail → keep going up
    }
  }
  return GENESIS;
}

function deltaLogAppend(dbo, atRev, at, device){
  try {
    const d = deltaSince(dbo, atRev - 1);
    /* 🔗 chain it: p = the current head, h = the hash of everything (see chainBody). Advance the head only
       after the line is built, so a throw before the append leaves the head untouched and the push is refused. */
    const _obj = { rev: atRev, ts: at, device: device || '', db: d.db, _tomb: d._tomb, p: DELTA_HEAD };
    _obj.h = chainHashOf(_obj);
    const line = JSON.stringify(_obj) + '\n';
    /* roll rather than delete — the owner's rule is never delete, just mark */
    try {
      if (fs.existsSync(DELTALOG) && fs.statSync(DELTALOG).size > DELTALOG_ROLL) {
        fs.renameSync(DELTALOG, path.join(DATADIR, 'delta-log-' + stamp(at) + '.jsonl'));
      }
    } catch (e) {}
    fs.appendFileSync(DELTALOG, line);
    DELTA_HEAD = _obj.h;                 /* the chain now ends here */
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
/* 🔗 PROVE A RUN OF LOG LINES IS UNBROKEN — the one check the owner asked for: "never any missed timestamps
   gaps, or missing hash". Used by hub-replay --verify and by the off-droplet puller. Given lines in rev order
   and the hash the run should CONTINUE FROM (genesis for a full log, or the puller's last head), it returns
   { ok, brokenAt, why }. The first break wins, and it is named by revision so a human can go look. */
function chainVerify(lines, fromHead){
  /* ⚠️ THE CHAIN BEGINS AT THE FIRST HASHED LINE. Everything logged before the hash-chain shipped
     (2026-08-21) has no `h`, and that is history, not a break — those lines are covered by the checkpoints
     and backups as they always were. So skip leading un-hashed lines and verify from where the chain really
     starts; a MISSING hash AFTER that point IS a real break. */
  let i0 = 0; while (i0 < lines.length && !lines[i0].h) i0++;
  const preChain = i0;
  const chain = lines.slice(i0);
  let prev = fromHead || (chain.length ? chain[0].p : GENESIS), lastRev = null, lastTs = null;
  for (const o of chain){
    const rev = +o.rev;
    if (!o.h) return { ok:false, brokenAt:rev, why:'rev ' + rev + ' has no hash (a break inside the chain)' };
    if (chainHashOf(o) !== o.h) return { ok:false, brokenAt:rev, why:'rev ' + rev + ' hash does not match its contents (tampered or corrupt)' };
    if (o.p !== prev) return { ok:false, brokenAt:rev, why:'rev ' + rev + ' does not link to the line before it (a line is missing or re-ordered)' };
    if (lastRev != null && rev !== lastRev + 1) return { ok:false, brokenAt:rev, why:'revision gap: ' + lastRev + ' → ' + rev + ' (a revision is missing)' };
    if (lastTs != null && (+o.ts) < lastTs) return { ok:false, brokenAt:rev, why:'timestamp went backwards at rev ' + rev + ' (' + lastTs + ' → ' + o.ts + ')' };
    if (o.ts == null) return { ok:false, brokenAt:rev, why:'rev ' + rev + ' has no timestamp' };
    prev = o.h; lastRev = rev; lastTs = +o.ts;
  }
  return { ok:true, head:prev, count:chain.length, lastRev:lastRev, preChain:preChain,
           chainStart: chain.length ? +chain[0].rev : null };
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
/* @mirror @sync — FNV-1a over one record’s stable text; 32-bit and NOT cryptographic — it detects drift, it does not authenticate anything. */
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
/* 🧠 ONE PARSED COPY PER SAVED REVISION — the thrash fix (owner, 2026-09-17: "hub should rotate through its
   receipts and control the thrashing", after the droplet OOM-killed the hub three times in ten minutes).
   Every reading endpoint used to re-read and re-parse the whole 7 MB database, so six stations polling at once
   meant six ~60 MB object graphs alive together on a 1 GB box. The file only changes when a push lands, so the
   parse is cached against the file's own mtime+size and every reader shares it until the next save.
   ⚠️ READ-ONLY CALLERS ONLY. The merge path mutates what it reads, so it keeps calling readDB() for a private
   copy — handing it the shared object would let one push edit what another reader is serving. */
let _dbShared = { key:'', raw:null };
/* ⚠️ KEYED ON THE HUB'S OWN REVISION, never the file's mtime+size: two saves inside the same millisecond that
   happen to land on the same byte length share a stat key, and the second one would be served the first one's
   data. test-hub caught exactly that — pushes then read back stale. rev changes on every accepted push. */
function readDBShared(){
  const key = rev + ':' + savedAt;
  if (_dbShared.key === key && _dbShared.raw) return _dbShared.raw;
  const raw = readDB(); _dbShared = { key: key, raw: raw }; return raw;
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
/* 🚦 the full-pull turnstile + the serialised body that goes with the shared parse (see the GET /api/db branch) */
const FULLPULL = { busy:false, at:0, doneAt:0, served:0, waited:0 };
const FULLPULL_MAX_MS = Number(process.env.OZARK_FULLPULL_MAX_MS || 30000);   /* a full pull that somehow never finished must not hold the door shut */

let _fullBody = { key:'', body:'' };
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
    if (['card.html','pay.html'].indexOf(path.basename(file).toLowerCase()) >= 0) Object.assign(hdrs, {
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
  pageWatchOne('pay.html', 'payHtml');
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
/* the same watch for pay.html, the pay-your-balance page (a customer types a card there too) */
function pageWatchOne(name, key){
  try {
    const fp = path.join(ROOT, name); if (!fs.existsSync(fp)) return;
    const h = crypto.createHash('sha256').update(fs.readFileSync(fp)).digest('hex');
    let st = {}; try { st = JSON.parse(fs.readFileSync(INTEGRITYFILE, 'utf8')); } catch(e){}
    if (!st[key]) { st[key] = h; writeAtomic(INTEGRITYFILE, JSON.stringify(st)); console.log('[integrity] ' + name + ' baseline ' + h.slice(0,12)); return; }
    if (st[key] !== h) {
      const prev = st[key]; st[key] = h; st[key + 'ChangedAt'] = Date.now(); writeAtomic(INTEGRITYFILE, JSON.stringify(st));
      console.log('[integrity] ' + name + ' CHANGED ' + prev.slice(0,12) + ' -> ' + h.slice(0,12));
      if (emailConfigured() && GM.bcc) sendEmail({ to:[GM.bcc], subject:'⚠ Ozark POS: the customer pay page changed on the server',
        html:'<div style="font-family:Arial,sans-serif;font-size:15px;color:#222"><p><b>' + name + ' (the page where customers pay their balance) just changed on the hub.</b></p><p>If you or a Claude deployed an update in the last few minutes, all is well. If not, stop sending pay links and call for help.</p></div>' }).catch(function(){});
    }
  } catch(e){}
}
setTimeout(pageWatchCheck, 20000); setInterval(pageWatchCheck, 6*3600*1000);

/* ---- online "schedule a pickup" queue (separate file; survives restarts; never touches the synced DB) ---- */
let PICKS = [];
try { if (fs.existsSync(PICKFILE)) { const pr = JSON.parse(fs.readFileSync(PICKFILE, 'utf8')); if (Array.isArray(pr)) PICKS = pr; } } catch (e) {}
function savePicks(){ try { writeAtomic(PICKFILE, JSON.stringify(PICKS)); } catch (e) {} }
/* ---- 📦 THE 24/7 DROP BOX (owner, 2026-09-08: a locked box that opens when the customer identifies
   themselves by PHONE NUMBER on a keypad, or by scanning their Happy Bag tag).
   ⚠️ THE BOX GETS ITS OWN KEY, NEVER THE HUB KEY. The box lives OUTSIDE the building; a stolen box must
   yield nothing better than rate-limited "phone → first name" lookups and fake check-ins — never the
   database. OZARK_DROPBOX_KEY in hub.env; unset = every /api/dropbox box endpoint refuses (fail closed,
   the reqKeyOk rule). The lookup answers with the FIRST NAME ONLY — enough for the ticket greeting,
   nothing a stranger could use. A shared phone number resolves to the PERSON, never the business
   (owner, 8/31: "customer wins"), and every candidate id rides the check-in for the morning crew. */
let DROPS = [];
try { if (fs.existsSync(DROPFILE)) { const dr = JSON.parse(fs.readFileSync(DROPFILE, 'utf8')); if (Array.isArray(dr)) DROPS = dr; } } catch (e) {}
function saveDrops(){ try { writeAtomic(DROPFILE, JSON.stringify(DROPS)); } catch (e) {} }
const DROPKEY = String(process.env.OZARK_DROPBOX_KEY || '');
function dropKeyOk(req){ if (!DROPKEY) return false;
  const got = String(req.headers['x-ozark-dropbox-key'] || '');
  try { const a = Buffer.from(got), b = Buffer.from(DROPKEY); return a.length === b.length && crypto.timingSafeEqual(a, b); } catch (e) { return false; } }
/* its own limiter — deliberately NOT trackRateOk: the box and the public tracker must not share a bucket,
   and 60/min absorbs a queue of Saturday-night droppers while still strangling a stolen key. */
const __dropHits = {};
function dropRateOk(req){ var ip=String(req.headers['x-forwarded-for']||(req.socket&&req.socket.remoteAddress)||'?').split(',')[0].trim(); var now=Date.now(); var w=__dropHits[ip]; if(!w||now-w.t>60000){ __dropHits[ip]={t:now,n:1}; return true; } w.n++; return w.n<=60; }
const DROPBOXES = {};   // box heartbeats, memory only: {store: {at, v, paper, door}}
function dropLookup(phone){
  const p10 = String(phone||'').replace(/\D/g,'').slice(-10); if (p10.length !== 10) return { known:false };
  const raw = readDB(); const db = raw ? raw.db : null; if (!db) return { known:false };
  const cands = (db.customers||[]).filter(function(c){
    if (c.retired || c.mergedInto) return false;
    const nums = [String(c.phone||'')].concat((c.phones||[]).map(function(x){ return String(x.number||''); }));
    return nums.some(function(n){ n = n.replace(/\D/g,''); return n && n.slice(-10) === p10; });
  });
  if (!cands.length) return { known:false };
  cands.sort(function(a,b){ return ((a.business?1:0)-(b.business?1:0)); });   /* person first — "customer wins" */
  const c = cands[0];
  return { known:true, first: String(c.first || c.business || '').split(' ')[0].slice(0,30), ids: cands.map(function(x){ return x.id; }) };
}
let FB = [];
try { if (fs.existsSync(FBFILE)) { const fr = JSON.parse(fs.readFileSync(FBFILE, 'utf8')); if (Array.isArray(fr)) FB = fr; } } catch (e) {}
let CARDLINKS = [];
try { if (fs.existsSync(CARDLINKFILE)) { const cr = JSON.parse(fs.readFileSync(CARDLINKFILE, 'utf8')); if (Array.isArray(cr)) CARDLINKS = cr; } } catch (e) {}
function saveCardlinks(){ try { writeAtomic(CARDLINKFILE, JSON.stringify(CARDLINKS)); } catch (e) {} }
let PAYLINKS = [];
try { if (fs.existsSync(PAYLINKFILE)) { const pr = JSON.parse(fs.readFileSync(PAYLINKFILE, 'utf8')); if (Array.isArray(pr)) PAYLINKS = pr; } } catch (e) {}
function savePaylinks(){ try { writeAtomic(PAYLINKFILE, JSON.stringify(PAYLINKS)); } catch (e) {} }
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
   ok:null means it has never run — deliberately not 'true'.
   ⚠️ TWO DIFFERENT AGES LIVE HERE AND CONFLATING THEM IS THE 8/27 BUG. `at`/`ageDays` say when the
   backup was last PROVEN to restore (the weekly verify). They say NOTHING about when a backup was last
   WRITTEN — and reporting only the verify age made a nightly artifact encrypted that same morning read
   as "4.6 days" on the Admin box, a readout failing in the WORRYING direction (the cry-wolf lesson:
   people learn to overrule it, and then the real stale day passes unread). `artifactAt`/`artifactAgeDays`
   are the nightly artifact's OWN mtime, statted fresh on every call — never cached, so a new file is a
   new answer. An absent artifact says nothing (a fresh or test hub has never written one); an artifact
   that stops being rewritten goes `artifactStale` after two missed nights. */
function backupState(){
  let out;
  try {
    const r = JSON.parse(fs.readFileSync(path.join(DATADIR, 'backup-verify.json'), 'utf8'));
    const days = (Date.now() - (r.at || 0)) / 86400000;
    out = { ok: !!r.ok, at: r.at || 0, ageDays: Math.round(days * 10) / 10,
            stale: days > 9,                      /* weekly + a couple of days of slack */
            customers: (r.counts && r.counts.customers) || 0, invariants: r.invariants || '' };
  } catch (e) { out = { ok: null, never: true }; }
  try {
    const st = fs.statSync(path.join(DATADIR, 'offsite', 'ozark-db.enc'));
    const aDays = (Date.now() - st.mtimeMs) / 86400000;
    out.artifactAt = Math.round(st.mtimeMs);
    out.artifactAgeDays = Math.round(aDays * 10) / 10;
    out.artifactStale = aDays > 2;               /* nightly; one missed night could be a reboot, two is a pattern */
    out.artifactBytes = st.size;
  } catch (e) { /* no nightly artifact on this hub — say nothing rather than invent a fault */ }
  return out;
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
const CARDLINK_BASE = (process.env.OZARK_CARD_URL || 'https://track.cleaners.example.com').replace(/\/+$/, '');   // real-domain host for the customer card page (best cert/referrer for Fiserv's iframe); overridable
function saveFB(){ try { writeAtomic(FBFILE, JSON.stringify(FB)); } catch (e) {} }
/* ---- 🆘 employee support tickets: hub-side queue (SEPARATE file, never in the synced DB) so a station on a stale app version can't wipe them via the whole-DB replace ---- */
const SUPFILE = path.join(DATADIR, 'support-tickets.json');
/* 🔢 mint reservations (see /api/mint) — per store+day high-water marks, tiny, restart-safe */
const MINTFILE = path.join(DATADIR, 'mint-reserve.json');
let MINTMAP = {}; try { MINTMAP = JSON.parse(fs.readFileSync(MINTFILE, 'utf8')) || {}; } catch (e) {}
/* 🔒 CUSTOMER RESERVATIONS (see /api/reserve) — the mint reservation's sibling for CUSTOMERS, not order numbers.
   Owner, 2026-09-03: "reserve space around each customer that we interact with... the second computer has to wait,
   customer in use." When a station opens a customer to transact (pickup, detail, route checkout, A/R collect) it
   TAKES a hold here; a second station opening the same customer is told to WAIT and who holds it. The hub is ONE
   process, so it is the only place two stations can be arbitrated — exactly like the mint counter.
   ⚠️ DELIBERATELY MEMORY-ONLY AND FAIL-OPEN. A hold is ephemeral (TTL, renewed while the screen is open). A hub
   restart clears every hold, which is the CORRECT behaviour: a hold that outlived the station holding it would
   freeze a customer nobody is working. Nothing here touches the synced database or the merge — it can only ever
   ADD a "please wait", never change who wins a merge or lose a record. If the hub is unreachable the station
   proceeds unblocked; a reserve that could freeze a counter would be worse than the fighting it prevents. */
const RESV = Object.create(null);                 /* cid -> { dev, name, exp } */
const RESV_TTL_MS = Number(process.env.OZARK_RESV_TTL_MS) || 45000;   /* a hold lives 45s past its last touch; the holder renews every ~20s. Env-overridable ONLY so test-hub can prove the auto-expiry that guarantees a crashed holder never freezes a customer. */
function resvLive(r){ return r && r.exp > Date.now(); }
function resvPrune(){ const now = Date.now(); for (const k in RESV) { if (!RESV[k] || RESV[k].exp <= now) delete RESV[k]; } }
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
  /* 📲 RECORD WHAT THE MORNING SEND DID (2026-09-30). The held text's only record said 'queued' forever — the
     result was thrown away, so a text that failed at 8am looked exactly like one that went (a caught error must
     still be reported). Checked by hand against Twilio: the 9/29 9:33 PM route-confirm was delivered 8:01 AM,
     with nothing here to say so. Same status rule as the live path: unknown is a failure, never 'sent'. */
  batch.forEach(function(m){ smsGatedSend(m.to, m.body).then(function(r){
    var st = (r && r.ok) ? 'sent' : (r && r.blocked) ? ('blocked-' + r.blocked) : 'error';
    logSmsOut(m.to, m.body, m.kind, st, r && r.sid, { cid: (m.cid || ''), err: (r && r.error) || (st === 'error' ? 'no clear answer from the carrier' : '') });
  }); });
} catch(e){} }
setInterval(flushQueue, 5*60*1000);   // every 5 min: once quiet hours end (after 8am), send the held order updates

/* ============================================================================
 * 💳⚠️ DUPLICATE-CHARGE ALARM — read-only. Owner, 2026-09-16: "i need an email
 * alarm in the 7 pm range, so i can void duplicates if it happens... they don't
 * close the day until 830 so i still have time." A same-card, same-cents pair with
 * TWO DIFFERENT processor refs is a real double charge. Before the 8:30 batch
 * settles a duplicate can be VOIDED (free, clean); after it, only refunded. So this
 * fires once a day in the 7pm CENTRAL hour and emails the owner any NEW duplicate it
 * has not flagged before — in time to void. It NEVER moves money; detection only.
 * It excludes (a) a charge already voided (its ref nets to <= 0 once the void row is
 * counted) and (b) one charge written to several order rows sharing ONE ref. A
 * terminal (Bolt) double-tap that never wrote a second POS row is invisible here —
 * the funding reconcile catches that next day; this catches the keyed / card-on-file
 * class the moment it lands, which is the class that can still be voided same-day.
 * ========================================================================== */
const DUPALARMFILE = path.join(DATADIR, 'dup-charge-alarm.json');
function dupAlarmState(){ try { return JSON.parse(fs.readFileSync(DUPALARMFILE, 'utf8')); } catch(e){ return { seen:[], lastRunDay:'' }; } }
function dupAlarmSave(s){ try { writeAtomic(DUPALARMFILE, JSON.stringify(s)); } catch(e){} }
/* ⚠️ EQUAL-PRICED SPLIT BAGS ARE NOT A DOUBLE (2026-09-16). A ticket split into bags is charged PER BAG at
   delivery (markDelivered → computeTotals on each bag's own lines), so two bags that price the same produce
   two charges — same card, same cents, seconds apart, two retrefs — that are both correct. Quintrell and
   Carthew were exactly that, and this scan called them doubles. The tell is the ORDER: a real double-fire
   lands two charges on the SAME order (or on none); bags land on DISTINCT sibling orders. Those go to
   equalBags — visible for review, never emailed as an overcharge. */
function dupChargeScan(db, opts){ return dupChargeScanFull(db, opts).dupes; }
function dupChargeScanFull(db, opts){
  opts = opts || {};
  const WIN = opts.windowMs || 12*60*1000;
  const pays = (db && db.payments) || [];
  const orders = (db && db.orders) || [], oMap = {}; orders.forEach(function(o){ oMap[o.id] = o; });
  const custs = (db && db.customers) || [], cMap = {}; custs.forEach(function(c){ cMap[c.id] = c; });
  const norm = function(s){ return String(s == null ? '' : s).replace(/\D/g, ''); };
  const netByRef = {};
  pays.forEach(function(p){ if (!/card/i.test(p.method || '')) return; const r = norm(p.ref) || norm(p.txn); if (!r) return; netByRef[r] = (netByRef[r] || 0) + Number(p.amount || 0); });
  const charges = pays.filter(function(p){ return /card/i.test(p.method || '') && Number(p.amount) > 0 && !/void|refund/i.test(p.method || ''); })
    .map(function(p){ const o = oMap[p.orderId], c = o ? cMap[o.customerId] : null;
      return { ref: norm(p.ref) || norm(p.txn), rawRef: p.ref || p.txn || '', last4: String(p.last4 || ''), cents: Math.round(Number(p.amount) * 100), date: p.date || 0,
        orderId: p.orderId || null, num: o ? o.number : null, cust: c ? (((c.first || '') + ' ' + (c.last || '')).trim() || c.name) : (o ? ('cust ' + o.customerId) : '(no order)') }; })
    .filter(function(x){ return x.ref && (netByRef[x.ref] || 0) > 0; })
    .sort(function(a, b){ return a.date - b.date; });
  const used = {}, dupes = [], equalBags = [];
  for (let i = 0; i < charges.length; i++){ if (used[i]) continue; const g = [charges[i]];
    for (let j = i + 1; j < charges.length; j++){ if (used[j]) continue; if (charges[j].date - charges[i].date > WIN) break;
      if (charges[j].last4 && charges[j].last4 === charges[i].last4 && charges[j].cents === charges[i].cents){ g.push(charges[j]); used[j] = 1; } }
    const refset = {}; g.forEach(function(x){ refset[x.ref] = 1; }); const nref = Object.keys(refset).length;
    if (g.length > 1 && nref > 1){ used[i] = 1;
      const rec = { id: Object.keys(refset).sort().join('+'), cust: g[0].cust, last4: g[0].last4, amount: g[0].cents / 100,
        when: g[g.length - 1].date, distinctCharges: nref, overcharge: (nref - 1) * g[0].cents / 100,
        refs: g.map(function(x){ return x.rawRef; }), orders: g.map(function(x){ return x.num; }), orderIds: g.map(function(x){ return x.orderId; }) };
      const oids = rec.orderIds;
      const distinctOrders = oids.length > 1 && oids.every(function(o){ return o != null; }) && new Set(oids).size === oids.length;
      if (distinctOrders){ rec.kind = 'equal-priced-bags'; rec.overcharge = 0; equalBags.push(rec); } else dupes.push(rec); }
  }
  return { dupes: dupes, equalBags: equalBags };
}
/* NEW duplicates whose latest charge is within recentDays and were never emailed */
function dupChargeNew(db, state, recentDays){
  const cut = Date.now() - (recentDays || 2) * 24*3600*1000;
  const seen = {}; (state.seen || []).forEach(function(id){ seen[id] = 1; });
  return dupChargeScan(db).filter(function(d){ return d.when >= cut && !seen[d.id]; });
}
function dupAlarmEmailHtml(dupes){
  const rows = dupes.map(function(d){
    return '<tr>'
      + '<td style="padding:6px 10px;border-bottom:1px solid #eee"><b>' + escH(d.cust) + '</b></td>'
      + '<td style="padding:6px 10px;border-bottom:1px solid #eee">••' + escH(d.last4) + '</td>'
      + '<td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right">$' + d.amount.toFixed(2) + ' ×' + d.distinctCharges + '</td>'
      + '<td style="padding:6px 10px;border-bottom:1px solid #eee">' + escH(d.refs.join(' / ')) + '</td>'
      + '</tr>';
  }).join('');
  const total = dupes.reduce(function(s, d){ return s + d.overcharge; }, 0);
  return '<div style="font-family:Arial,Helvetica,sans-serif;color:#222;font-size:15px;max-width:640px;margin:0 auto">'
    + '<p style="font-size:17px"><b>⚠️ ' + dupes.length + ' possible duplicate charge' + (dupes.length > 1 ? 's' : '') + ' — $' + total.toFixed(2) + ' to review</b></p>'
    + '<p>Each row is one card charged the same amount twice, under two different transaction numbers. '
    + '<b>Void the extra one in CardPointe before the 8:30 batch closes</b> (Reporting → search the name → void). '
    + 'After the batch settles it can only be refunded.</p>'
    + '<table style="border-collapse:collapse;width:100%;font-size:14px"><thead><tr>'
    + '<th style="text-align:left;padding:6px 10px;border-bottom:2px solid #ccc">Customer</th>'
    + '<th style="text-align:left;padding:6px 10px;border-bottom:2px solid #ccc">Card</th>'
    + '<th style="text-align:right;padding:6px 10px;border-bottom:2px solid #ccc">Amount</th>'
    + '<th style="text-align:left;padding:6px 10px;border-bottom:2px solid #ccc">Transaction #s</th>'
    + '</tr></thead><tbody>' + rows + '</tbody></table>'
    + '<p style="color:#777;font-size:12px;margin-top:18px">Automatic check from the Ozark hub · read-only, nothing was changed · you decide each void or credit.</p></div>';
}
function dupChargeAlarmRun(opts){
  opts = opts || {};
  const state = dupAlarmState();
  let raw; try { raw = readDB(); } catch(e){ raw = null; }
  const db = raw ? raw.db : null;
  if (!db) return { ok:false, error:'no database to scan' };
  const fresh = dupChargeNew(db, state, opts.recentDays || 2);
  const res = { ok:true, found: fresh.length, dupes: fresh };
  if (!fresh.length || opts.dryRun) return Promise.resolve(res);
  /* ⚠️ "SEEN" MEANS "THE OWNER WAS TOLD". sendEmail returns a Promise; the first version of this marked every double
     seen the instant the send was STARTED, so one failed or unconfigured e-mail would have silenced a real double
     charge forever (found 2026-09-16 by the repo review). Now: mark only after the send resolved; on any failure
     leave them unseen, say so, and the next run reports them again. */
  const mark = function(){ fresh.forEach(function(d){ state.seen.push(d.id); }); if (state.seen.length > 500) state.seen = state.seen.slice(-500); dupAlarmSave(state); res.marked = fresh.length; };
  if (!(emailConfigured() && GM.bcc)) { res.emailError = 'email not configured (need OZARK_SMTP_* and OZARK_SMTP_BCC) — NOT marked seen; reported again next run'; return Promise.resolve(res); }
  return Promise.resolve()
    .then(function(){ return sendEmail({ to:[GM.bcc], subject:'⚠ Ozark: ' + fresh.length + ' possible duplicate card charge' + (fresh.length > 1 ? 's' : '') + ' to void', html: dupAlarmEmailHtml(fresh) }); })
    .then(function(r){ if (r && r.ok === false) throw new Error(r.error || 'send failed'); res.emailed = GM.bcc; mark(); return res; })
    .catch(function(e){ res.emailError = String((e && e.message) || e) + ' — NOT marked seen; reported again next run'; console.log('  ⚠ dup-charge alarm e-mail FAILED: ' + res.emailError); return res; });
}
/* fire once a day in the 7pm CENTRAL hour — the owner's window to void before the 8:30 close. Central hour is
   read the same way inQuietHours() does (the droplet runs UTC, the shop runs Central). The per-day guard means
   a restart inside the window still runs it, and it never runs twice in a day. */
function dupAlarmTick(){
  try {
    const now = new Date();
    const h = parseInt(now.toLocaleString('en-US', { timeZone:'America/Chicago', hour12:false, hour:'2-digit' }), 10);
    if (h !== 19) return;                                                        // the 7pm hour only
    const day = now.toLocaleDateString('en-CA', { timeZone:'America/Chicago' }); // YYYY-MM-DD in Central
    if (dupAlarmState().lastRunDay === day) return;                              // already ran today
    dupChargeAlarmRun({}).then(function(r){
      /* the day is claimed only when the owner was told (or there was nothing to tell); a failed e-mail leaves it
         unclaimed so the next 10-minute tick inside the 7pm hour tries again */
      if (r && r.ok && (!r.found || r.emailed)) { const st = dupAlarmState(); st.lastRunDay = day; dupAlarmSave(st); }
      console.log('  💳 dup-charge alarm ran (' + day + ' 7pm CT) — ' + ((r && r.found) || 0) + ' new duplicate(s)' + (r && r.emailed ? ' · emailed ' + r.emailed : '') + (r && r.emailError ? ' · ⚠ ' + r.emailError : ''));
    }).catch(function(e){ console.log('  ⚠ dup-charge alarm error: ' + ((e && e.message) || e)); });
  } catch(e){ console.log('  ⚠ dup-charge alarm error: ' + ((e && e.message) || e)); }
}
setInterval(dupAlarmTick, 10*60*1000);   // check every 10 min; the 7pm-hour + per-day guards make it fire once

/* 💳🌅 MORNING SETTLEMENT ALARM — the processor-side half of the double-charge net. Funding settles overnight,
   so each morning in the 7am CENTRAL hour the hub reconciles the last two settled days transaction-by-transaction
   (cpFundTxReconcile) and emails the owner any DOUBLE or ORPHAN it has not flagged before. This is what catches
   a Bolt terminal double-tap that never wrote a second POS row — invisible to the 7pm POS-internal alarm. By
   morning these have batched, so the email says "refund", not "void". Read-only. Deduped by retref in
   hub-data/funding-alarm.json. Silent when there is nothing to say. */
const FUNDALARMFILE = path.join(DATADIR, 'funding-alarm.json');
function fundAlarmState(){ try { return JSON.parse(fs.readFileSync(FUNDALARMFILE, 'utf8')); } catch(e){ return { seen:[], lastRunDay:'' }; } }
function fundAlarmSave(s){ try { writeAtomic(FUNDALARMFILE, JSON.stringify(s)); } catch(e){} }
function fundAlarmEmailHtml(r){
  const td = function(c){ return '<td style="padding:6px 10px;border-bottom:1px solid #eee">' + c + '</td>'; };
  const row = function(cells){ return '<tr>' + cells.map(td).join('') + '</tr>'; };
  let h = '<div style="font-family:Arial,Helvetica,sans-serif;color:#222;font-size:15px;max-width:680px;margin:0 auto">';
  if (r.doubles.length){
    h += '<p style="font-size:17px"><b>⚠️ ' + r.doubles.length + ' double charge' + (r.doubles.length > 1 ? 's' : '') + ' SETTLED — $' + r.doublesOvercharge.toFixed(2) + ' to refund</b></p>'
      + '<p>Same card, same amount, settled under two different transaction numbers. These have already batched, so they are <b>refunds</b> (or store credit), not voids.</p>'
      + '<table style="border-collapse:collapse;width:100%;font-size:14px">' + r.doubles.map(function(d){ return row(['••' + escH(d.last4) + ' ' + escH(d.brand), '$' + d.amount.toFixed(2) + ' ×' + d.distinctCharges, escH(d.retrefs.join(' / '))]); }).join('') + '</table>';
  }
  if (r.orphans.length){
    h += '<p style="font-size:17px;margin-top:18px"><b>⚠️ ' + r.orphans.length + ' settled charge' + (r.orphans.length > 1 ? 's' : '') + ' with NO ticket in Ozark — $' + r.orphansTotal.toFixed(2) + '</b></p>'
      + '<p>Money the processor settled that no POS payment carries. Find out what these were.</p>'
      + '<table style="border-collapse:collapse;width:100%;font-size:14px">' + r.orphans.map(function(o){ return row([escH(o.retref), '••' + escH(o.last4) + ' ' + escH(o.brand), '$' + o.amount.toFixed(2), 'store ' + escH(o.store)]); }).join('') + '</table>';
  }
  h += '<p style="color:#777;font-size:12px;margin-top:18px">Automatic morning check from the Ozark hub against CardConnect’s settlement feed · read-only, nothing was changed.</p></div>';
  return h;
}
/* ✅ SETTLED BY THE OWNER BEFORE THE WIDER WINDOW COULD REPORT IT (2026-09-23). Without this list, the first morning after the
   window widened would e-mail an item already dealt with:
   · 006031743991 + 008305645285: Jory Garavito, Visa 7310, $36.85 charged twice. A REAL double; the owner credited it back 9/23.
   Also seen that day, NOT in the list because it no longer shows:
   · 000002710413: Hythe, Discover 6012, $35.59. NOT an extra charge. The card was approved twice about two minutes apart; the
     owner voided the second approval the same day, and the POS payment row carries the voided reference, so the one charge
     that settled has no matching POS row. ⚠️ Lesson: "settled with no POS match" means the references disagree, not that
     the customer paid twice. Read the card log (card-events.jsonl) before calling it an overcharge. On 9/23 I told the owner
     to refund Hythe, and Mercer (a same-day void from before the feed's 9/09 start) as well. Both were wrong. The owner then had
     Hythe's payment row pointed at the settled charge (research/2026-09-23/hythe-payment-ref.js, logged), so it matches now. */
const FUND_RESOLVED_BY_OWNER = ['006031743991', '008305645285'];
function fundAlarmRun(opts){
  opts = opts || {};
  const iso = function(d){ return d.toISOString().slice(0, 10); };
  /* ⚠️ A WEEK, NOT A ONE-DAY SLICE (2026-09-23). This read funding dates from exactly two days back to one day back, so a
     charge that funded on any other day was never looked at: Jory Garavito's $36.85 double charge (9/22) sat in the settlement
     feed while this reported nothing, and the owner found it in CardPointe himself. Seven days back; "seen" keeps each item
     to one e-mail. */
  const end = new Date(Date.now() - 24*3600*1000), start = new Date(Date.now() - 8*24*3600*1000);
  return cpFundTxReconcile(iso(start), iso(end)).then(function(r){
    if (!r.ok) return r;
    const state = fundAlarmState(); const seen = {}; (state.seen || []).concat(FUND_RESOLVED_BY_OWNER).forEach(function(k){ seen[k] = 1; });
    const fresh = { ok:true, start:r.start, end:r.end,
      doubles: r.doubles.filter(function(d){ return !d.retrefs.every(function(x){ return seen[x]; }); }),
      orphans: r.orphans.filter(function(o){ return !seen[o.retref]; }) };
    fresh.doublesOvercharge = Math.round(fresh.doubles.reduce(function(n, d){ return n + d.overcharge; }, 0) * 100) / 100;
    fresh.orphansTotal = Math.round(fresh.orphans.reduce(function(n, o){ return n + o.amount; }, 0) * 100) / 100;
    fresh.found = fresh.doubles.length + fresh.orphans.length;
    if (!fresh.found || opts.dryRun) return fresh;
    /* ⚠️ "SEEN" MEANS "THE OWNER WAS TOLD" — same rule as the 7pm alarm: mark only after the e-mail resolved. */
    const mark = function(){
      fresh.doubles.forEach(function(d){ d.retrefs.forEach(function(x){ state.seen.push(x); }); });
      fresh.orphans.forEach(function(o){ state.seen.push(o.retref); });
      if (state.seen.length > 2000) state.seen = state.seen.slice(-2000);
      fundAlarmSave(state); fresh.marked = true; };
    if (!(emailConfigured() && GM.bcc)) { fresh.emailError = 'email not configured (need OZARK_SMTP_* and OZARK_SMTP_BCC) — NOT marked seen; reported again next run'; return fresh; }
    return Promise.resolve()
      .then(function(){ return sendEmail({ to:[GM.bcc], subject:'⚠ Ozark settlement check: ' + fresh.doubles.length + ' double, ' + fresh.orphans.length + ' unticketed', html: fundAlarmEmailHtml(fresh) }); })
      .then(function(r){ if (r && r.ok === false) throw new Error(r.error || 'send failed'); fresh.emailed = GM.bcc; mark(); return fresh; })
      .catch(function(e){ fresh.emailError = String((e && e.message) || e) + ' — NOT marked seen; reported again next run'; console.log('  ⚠ settlement alarm e-mail FAILED: ' + fresh.emailError); return fresh; });
  });
}
function fundAlarmTick(){
  try {
    if (!cpFundConfigured()) return;
    const now = new Date();
    const h = parseInt(now.toLocaleString('en-US', { timeZone:'America/Chicago', hour12:false, hour:'2-digit' }), 10);
    if (h !== 7) return;                                                         // the 7am hour only
    const day = now.toLocaleDateString('en-CA', { timeZone:'America/Chicago' });
    const state = fundAlarmState(); if (state.lastRunDay === day) return;
    state.lastRunDay = day; fundAlarmSave(state);                                // claim the day BEFORE the network call, so a slow pull cannot run twice
    fundAlarmRun({}).then(function(r){
        /* found something but could not tell the owner → give the day back so the next 10-minute tick in the 7am hour tries again */
        if (r && r.found && !r.emailed) { const st = fundAlarmState(); if (st.lastRunDay === day) { delete st.lastRunDay; fundAlarmSave(st); } }
        console.log('  🌅 settlement alarm ran (' + day + ' 7am CT) — ' + ((r && r.found) || 0) + ' new item(s)' + (r && r.emailed ? ' · emailed ' + r.emailed : '') + (r && r.emailError ? ' · ⚠ ' + r.emailError : '')); })
      .catch(function(e){ console.log('  ⚠ settlement alarm error: ' + ((e && e.message) || e)); });
  } catch(e){ console.log('  ⚠ settlement alarm error: ' + ((e && e.message) || e)); }
}
setInterval(fundAlarmTick, 10*60*1000);

/* ---- the server ---- */
const server = http.createServer((req, res) => {
  const u = req.url || '/';
  /* 🔤 ONE LINE, THIRTY BUGS (2026-08-27). Every body reader in this file does `body += chunk`, which
     coerces each TCP chunk to a string INDEPENDENTLY — so a multi-byte character (an em-dash, an emoji)
     straddling a chunk boundary decodes as two �s. Found live: an order comment's em-dash grew one � per
     sync hop, the corruption was a real content change, and the fleet dutifully churned it around forever
     (it is also where the historical mojibake in old activity rows came from). setEncoding installs Node's
     StringDecoder, which HOLDS a split sequence until its remaining bytes arrive — making every existing
     `body += c` correct as written. Safe globally because every body this hub reads is JSON/text (photo
     bytes travel as base64, which is single-byte ASCII and cannot straddle). */
  req.setEncoding('utf8');
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
  if (u === '/api/health') { send(res, 200, { ok:true, rev, savedAt, started, chainHead: DELTA_HEAD, chainOk: CHAIN_OK, chainWhy: CHAIN_WHY, chainStart: CHAIN_START, clients: clientsRecent(), fullPulls: FULLPULL.served, fullPullWaits: FULLPULL.waited, appRev: appRev(), keyConfigured: !!HUBKEY, reloadAt: RELOAD.at || 0, cfgAt: STATION_CFG_AT || 0, autoLeader: autoLeaderFor(deviceOf(req)), twin: twinOf(deviceOf(req)), hangups: HANGUPS, backup: backupState(), dropOpen: DROPS.filter(r => r.status !== 'done').length,
      smsFailed: SMSOUT.reduce((n, m) => n + ((smsFailed(m) && !m.ackAt) ? 1 : 0), 0) }); return; }   /* 📪 rides the keyless poll every station already makes, so the badge needs no extra request */   /* 📞 replies nobody was left to hear — see send() */

  // 🗺️ address autocomplete (proxy to OpenStreetMap/Nominatim). Returns only PUBLIC map data (no customer data),
  //    so it's open like /api/track — but a keyless caller (the website pickup form) is rate-limited by IP; a POS
  //    request with the hub key skips the limit. q parsed by hand (no url dep, per the backslash/layer rule).
  //    <3 chars or any upstream error → empty list; callers then just keep a plain text box.
  if (u.split('?')[0] === '/api/geocode' && req.method === 'GET') {
    if (!reqKeyOk(req) && !trackRateOk(req)) { send(res, 429, { ok:false, error:'too many address lookups — slow down' }); return; }
    let q = ''; const qs = u.split('?')[1] || ''; const m = /(?:^|&)q=([^&]*)/.exec(qs);
    if (m) { try { q = decodeURIComponent(m[1].replace(/\+/g, ' ')).trim(); } catch (e) { q = ''; } }
    if (q.length < 3) { send(res, 200, { ok:true, results: [] }); return; }
    geocodeSearch(q).then(function(results){ send(res, 200, { ok:true, results: results }); })
                    .catch(function(){ send(res, 200, { ok:true, results: [] }); });
    return;
  }

  // PUBLIC, read-only customer order tracker — NO hub key; sanitized (never the full DB, addresses, payment, or other customers); rate-limited
  //    📖 OPEN BOOKS — the public transparency feed behind cleaners.example.com/books.html (owner 2026-08-24:
  //    "i want a full and clear system... accounting is a part of the whole picture with the POS and posted
  //    publicly"). PUBLIC and keyless like /api/track, same rate limiter — and it serves AGGREGATES ONLY:
  //    monthly totals computed from the live shop, plus whatever hub-data/books/monthly.json carries from
  //    the accounting side (posted by a human from the closed books, never invented here). No customer, no
  //    order, no employee ever rides in this response — a test seeds a name and proves it cannot leak.
  //    Cached 10 minutes: the public page must never make the hub walk the shop once per visitor.
  // 📗 QUICKBOOKS ONLINE — read-only connection (see the QB banner above + QUICKBOOKS-SETUP.md)
  if (u.indexOf('/api/qb/callback') === 0 && req.method === 'GET') {
    let q; try { q = new URL(u, 'http://h').searchParams; } catch(e){ q = null; }
    const code = q ? (q.get('code')||'') : '', realmId = q ? (q.get('realmId')||'') : '', st = q ? (q.get('state')||'') : '';
    const okState = !!(st && QBSTATE[st] && QBSTATE[st] > Date.now()); if (st) delete QBSTATE[st];
    const page = (title, msg) => { res.writeHead(200, { 'Content-Type':'text/html' }); res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><body style="font-family:system-ui,-apple-system,sans-serif;max-width:560px;margin:56px auto;padding:0 22px;text-align:center;color:#1c2b27"><div style="font-size:44px">📗</div><h2 style="margin:.2em 0">'+title+'</h2><p style="color:#4a5a55;line-height:1.5">'+msg+'</p></body>'); };
    if (!qbConfigured()) { page('QuickBooks is not set up yet', 'The hub has no QuickBooks credentials. Add them in hub.env and try again.'); return; }
    if (!code || !okState) { page('That link did not check out', 'The connection link expired or was already used. Start it again from the POS and finish within a few minutes.'); return; }
    httpsForm('POST', qbTokenHost(), '/oauth2/v1/tokens/bearer', { 'Authorization': qbBasicAuth() }, { grant_type:'authorization_code', code:code, redirect_uri:QB.redirect }).then(r => {
      if (r.json && r.json.access_token && qbStoreTokens(r.json, realmId)) { console.log('  📗 QuickBooks connected — realm ' + realmId); page('✅ QuickBooks connected', 'Ozark Cleaners is linked to QuickBooks, read-only. You can close this tab.'); }
      else { page('Could not connect', 'QuickBooks did not return a token. Please start the connection again.'); }
    }).catch(() => page('Could not connect', 'Something went wrong reaching QuickBooks. Please try again.'));
    return;
  }
  if (u.indexOf('/api/qb/connect') === 0 && req.method === 'GET') {
    let q; try { q = new URL(u, 'http://h').searchParams; } catch(e){ q = null; }
    const qk = q ? String(q.get('key')||'') : '';
    let keyOk = reqKeyOk(req);
    if (!keyOk && qk && HUBKEY) { const a = Buffer.from(qk,'utf8'), b = Buffer.from(HUBKEY,'utf8'); keyOk = a.length===b.length && (function(){ try { return crypto.timingSafeEqual(a,b); } catch(e){ return false; } })(); }
    if (!keyOk) { send(res, 401, { ok:false, error:keyErr() }); return; }
    if (!qbConfigured()) { send(res, 200, { ok:false, error:'QuickBooks is not set up on the hub yet — add OZARK_QBO_CLIENT_ID, _SECRET and _REDIRECT to hub.env.' }); return; }
    for (const k in QBSTATE) if (QBSTATE[k] < Date.now()) delete QBSTATE[k];
    const state = crypto.randomBytes(16).toString('hex'); QBSTATE[state] = Date.now() + 600000;   // 10-minute CSRF window
    const url = qbAuthUrl(state);
    if (/text\/html/.test(req.headers['accept'] || '')) { res.writeHead(302, { Location: url }); res.end(); return; }   // owner opened the link directly
    send(res, 200, { ok:true, url: url });   // an app button: window.open(url)
    return;
  }
  if (u === '/api/qb/status' && req.method === 'GET') {
    if (!reqKeyOk(req)) { send(res, 401, { ok:false, error:keyErr() }); return; }
    send(res, 200, { ok:true, configured: qbConfigured(), connected: !!(QBTOK.access_token && QBTOK.realmId), env: QB.env,
      realmId: QBTOK.realmId || null, connectedAt: QBTOK.connected_at || null, tokenExpiresAt: QBTOK.expires_at || null,
      refreshExpiresAt: QBTOK.refresh_expires_at || null, lastPull: QBTOK.last_pull || null });
    return;
  }
  if (u.indexOf('/api/qb/pull') === 0 && req.method === 'GET') {
    if (!reqKeyOk(req)) { send(res, 401, { ok:false, error:keyErr() }); return; }
    let q; try { q = new URL(u, 'http://h').searchParams; } catch(e){ q = null; }
    const per = qbPeriod(q && q.get('start'), q && q.get('end'));
    qbPull(per.start, per.end).then(r => send(res, 200, r)).catch(e => send(res, 200, { ok:false, error:String((e&&e.message)||e) }));
    return;
  }
  if (u.indexOf('/api/qb/reconcile') === 0 && req.method === 'GET') {
    if (!reqKeyOk(req)) { send(res, 401, { ok:false, error:keyErr() }); return; }
    let q; try { q = new URL(u, 'http://h').searchParams; } catch(e){ q = null; }
    const per = qbPeriod(q && q.get('start'), q && q.get('end'));
    qbPull(per.start, per.end).then(r => {
      if (!r.ok) { send(res, 200, { ok:false, error:r.error, period:per }); return; }
      const pos = posCollectedRange(per.start, per.end);
      const qbIncome = (r.income != null ? r.income : null);
      const variance = (qbIncome != null) ? Math.round((qbIncome - pos)*100)/100 : null;
      const pct = (qbIncome) ? Math.round((pos / qbIncome) * 1000)/10 : null;
      send(res, 200, { ok:true, period:per, qbIncome:qbIncome, qbExpenses:r.expenses, qbNet:r.net, posCollected:pos, variance:variance, posPctOfQb:pct });
    }).catch(e => send(res, 200, { ok:false, error:String((e&&e.message)||e) }));
    return;
  }
  if (u === '/api/cp/funding/status' && req.method === 'GET') {
    if (!reqKeyOk(req)) { send(res, 401, { ok:false, error:keyErr() }); return; }
    const stores = cpFundStores(); const st = {};
    stores.forEach(function(s){ const f = cpFund(s); st[s] = { configured: !!(f.user && f.pass && f.mid), mid: f.mid }; });
    send(res, 200, { ok:true, configured: cpFundConfigured(), host: cpFundHost((cpFund(stores[0] || '')).env),
      env: (process.env.OZARK_CPFUND_ENV || CP.env), stores: st });
    return;
  }
  if (u.indexOf('/api/cp/funding/pull') === 0 && req.method === 'GET') {
    if (!reqKeyOk(req)) { send(res, 401, { ok:false, error:keyErr() }); return; }
    let q; try { q = new URL(u, 'http://h').searchParams; } catch(e){ q = null; }
    const per = qbPeriod(q && q.get('start'), q && q.get('end'));
    cpFundingPull(per.start, per.end, !!(q && q.get('debug'))).then(r => send(res, 200, r)).catch(e => send(res, 200, { ok:false, error:String((e&&e.message)||e) }));
    return;
  }
  if (u.indexOf('/api/cp/funding/reconcile') === 0 && req.method === 'GET') {
    if (!reqKeyOk(req)) { send(res, 401, { ok:false, error:keyErr() }); return; }
    let q; try { q = new URL(u, 'http://h').searchParams; } catch(e){ q = null; }
    const per = qbPeriod(q && q.get('start'), q && q.get('end'));
    cpFundReconcile(per.start, per.end).then(r => send(res, 200, r)).catch(e => send(res, 200, { ok:false, error:String((e&&e.message)||e) }));
    return;
  }
  /* 💳🔍 transaction-level reconcile over the settlement feed: orphans, doubles (incl. terminal), unsettled,
     mismatches. ?start&end. ?run=1 dry-runs the morning alarm (no email, no state); ?run=email sends it.
     Read-only, key-gated. */
  if (u.indexOf('/api/cp/funding/txreconcile') === 0 && req.method === 'GET') {
    if (!reqKeyOk(req)) { send(res, 401, { ok:false, error:keyErr() }); return; }
    let q; try { q = new URL(u, 'http://h').searchParams; } catch(e){ q = null; }
    const runMode = q && q.get('run');
    if (runMode) { fundAlarmRun({ dryRun: runMode !== 'email' }).then(r => send(res, 200, r)).catch(e => send(res, 200, { ok:false, error:String((e&&e.message)||e) })); return; }
    const per = qbPeriod(q && q.get('start'), q && q.get('end'));
    cpFundTxReconcile(per.start, per.end).then(r => send(res, 200, r)).catch(e => send(res, 200, { ok:false, error:String((e&&e.message)||e) }));
    return;
  }
  /* 💳⚠️ the duplicate-charge alarm — inspect + test. GET returns every duplicate + the recent-new set
     (read-only). ?run=1 dry-runs the alarm (finds new, sends NOTHING, changes nothing). ?run=email actually
     sends the owner email and marks them seen (a live test of the 7pm path). Key-gated; never moves money. */
  if (u.indexOf('/api/cp/dupscan') === 0 && req.method === 'GET') {
    if (!reqKeyOk(req)) { send(res, 401, { ok:false, error:keyErr() }); return; }
    let q; try { q = new URL(u, 'http://h').searchParams; } catch(e){ q = null; }
    const runMode = q && q.get('run');
    if (runMode) { dupChargeAlarmRun({ dryRun: runMode !== 'email', recentDays: Math.min(60, Number(q.get('days')) || 0) || undefined }).then(r => send(res, 200, r)).catch(e => send(res, 200, { ok:false, error:String((e&&e.message)||e) })); return; }   // ?days=N widens the window (default 2; the gate uses it to reach a seeded double)
    let raw; try { raw = readDB(); } catch(e){ raw = null; }
    const db = raw ? raw.db : null;
    const full = db ? dupChargeScanFull(db) : { dupes: [], equalBags: [] };
    send(res, 200, { ok:true, allDuplicates: full.dupes, equalBags: full.equalBags, newLast2Days: db ? dupChargeNew(db, dupAlarmState(), 2) : [] });
    return;
  }
  if (u.indexOf('/api/books') === 0 && req.method === 'GET') {
    if (!trackRateOk(req)) { send(res, 429, { ok:false, error:'Too many requests - please wait a minute.' }); return; }
    try {
      if (!global.__BOOKS || Date.now() - global.__BOOKS.at > 600000) {
        const raw = readDB(); const db = raw ? raw.db : null;
        const months = {};
        if (db) {
          for (const pm of (db.payments||[])) {
            if (!(pm.amount > 0) || /^account$/i.test(pm.method||'')) continue;   /* an Account row BOOKS a debt; only money that moved counts (the MON-10 lesson) */
            const t = +pm.date || Date.parse(pm.date) || 0; if (!t) continue;
            const ym = new Date(t).getFullYear() + '-' + String(new Date(t).getMonth()+1).padStart(2,'0');
            (months[ym] = months[ym] || { collected:0, payments:0, pieces:0 }).collected += pm.amount; months[ym].payments++;
          }
          for (const o of (db.orders||[])) {
            if (o.status !== 'PickedUp' || !o.pickedAt) continue;
            const ym = new Date(o.pickedAt).getFullYear() + '-' + String(new Date(o.pickedAt).getMonth()+1).padStart(2,'0');
            (months[ym] = months[ym] || { collected:0, payments:0, pieces:0 }).pieces += ((o.lines||[]).length || +o.pieceCount || 0);
          }
          for (const ym in months) months[ym].collected = Math.round(months[ym].collected*100)/100;
        }
        let acct = null; try { acct = JSON.parse(fs.readFileSync(path.join(DATADIR, 'books', 'monthly.json'), 'utf8')); } catch(e){}
        global.__BOOKS = { at: Date.now(), body: { ok:true, pos: months, accounting: acct, updated: Date.now() } };
      }
      res.writeHead(200, { 'Content-Type':'application/json', 'Access-Control-Allow-Origin':'*', 'Cache-Control':'public, max-age=300' });
      res.end(JSON.stringify(global.__BOOKS.body)); return;
    } catch(e){ send(res, 200, { ok:false }); return; }
  }

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
    if (!reqReadKeyOk(req)) { send(res, 401, { ok:false, error: keyErr() }); return; }
    const raw = readDBShared();
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
        db: d.db, _tomb: d._tomb, counts: d.counts, changed: d.changed,
        setHash: setHashOf(d.db, d._tomb), setCount: setCountOf(d.db) });   /* 🔁 the station checks these before applying */
      return;
    }
    /* 🚦 ONE STATION AT A TIME FOR A FULL PULL (owner, 2026-09-17: "this is a special situation where we should
       make the hub update each station one at a time"). A full pull serialises the whole database — several at
       once is what pushed a 1 GB droplet into the OOM killer, and each kill dropped every station, which made
       them all come back and full-pull together: a stampede feeding itself. So one goes through; the others are
       told they are in line and come back on their next 4s tick. Nobody is refused work, only asked to wait, and
       the answer carries the revision so a station knows it is not behind for any other reason.
       ⚠️ It never queues a DELTA (small, and the answer above already returned), never an adopt/baseline pull
       mid-flight, and it opens again when the download finishes OR the socket dies, with a 30s ceiling on top —
       a turnstile stuck shut would be worse than the stampede it prevents. */
    if (FULLPULL.busy && (Date.now() - FULLPULL.at) < FULLPULL_MAX_MS) {
      FULLPULL.waited++;
      send(res, 200, { ok:true, busy:true, rev, savedAt, appRev: appRev(), retryMs: 1500,
        note: 'another station is downloading the database right now — this one is next' });
      return;
    }
    FULLPULL.busy = true; FULLPULL.at = Date.now(); FULLPULL.served++;
    /* held until the bytes have actually REACHED the station, not merely been queued: the download is the
       expensive part, and node hands us the next request long before a 7 MB body has drained. */
    const _pullDone = function(){ FULLPULL.busy = false; FULLPULL.doneAt = Date.now(); };
    res.on('finish', _pullDone); res.on('close', _pullDone);
    try {
      /* the serialised body is cached with the parse, so the stations behind this one in the queue are
         answered from the same string instead of re-stringifying 7 MB each */
      const k = rev + ':' + savedAt;
      if (_fullBody.key !== k) _fullBody = { key: k, body: JSON.stringify({ ok:true, rev, savedAt, db: raw ? raw.db : null, appRev: appRev() }) };
      send(res, 200, _fullBody.body);
    } catch (e) { _pullDone(); throw e; }
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
        /* 🪟 remember which window ids are WRITING under this station name (twinOf reads this). A farewell push
           is a hand-off, not a rival — counting it would cry wolf on the election working, the same trap the
           pageAt tripwire immediately below already had to learn. */
        try { if (!(inc && inc.farewell)) twinNote((d && d.name) || dev, dev); } catch (e) {}
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
        /* 🚨 DUPLICATE ORDER NUMBER — SCREAM AT MERGE TIME, NOT AT 2:50 AM (2026-09-01, launch day:
           two stations minted 1-09-01-26-0010 sixty-eight seconds apart — the documented residual race in
           genOrderNumber — and the nightly invariant would have sat on it until tomorrow while both tickets
           were live on the floor). Checked only for the numbers THIS push carries, so it costs one map walk. */
        try {
          const _byNum = {}; (merged.orders || []).forEach(o => { if (o && o.number) (_byNum[o.number] = _byNum[o.number] || []).push(o.id); });
          const _incNums = new Set(((db.orders) || []).map(o => o && o.number).filter(Boolean));
          _incNums.forEach(n => { if ((_byNum[n] || []).length > 1) {
            console.log('  🚨 DUPLICATE ORDER NUMBER ' + n + ' on ' + _byNum[n].length + ' orders (' + _byNum[n].join(', ') + ') — two stations minted in the same sync window; renumber the younger one');
            try { fs.appendFileSync(path.join(DATADIR, 'client-errors.jsonl'), JSON.stringify({ ts: Date.now(), dev: 'hub-merge', msg: 'DUPLICATE ORDER NUMBER ' + n + ' on orders ' + _byNum[n].join(', '), kind: 'invariant', screen: '', emp: '', appRev: '', n: 1 }) + '\n'); } catch (e2) {}
          } });
        } catch (e3) {}
      } catch (e) { merged = db; console.log('  ⚠ hub merge failed, storing the push as-is: ' + e.message); }
      if (!looksLikeDB(merged)) { send(res, 500, { ok:false, error:'merge produced an invalid DB — nothing saved' }); return; }
      /* 🔬 A TARGETED WATCH — set OZARK_WATCH_CUST=<id,id> in hub.env to log what every push carries for those
         customer ids (present at all? balance, stamp, card count). Built 8/10 for the Carthew "it's not
         saving" case (root cause found the same day: the jammed SYNC.pushing flag) and it earned its keep —
         one push from the station answered what inference could not. ⚠️ OFF BY DEFAULT since 2026-08-28: the
         8/10 record id was left as the DEFAULT, so the hub journaled every merge of one dead record on every
         push for eighteen days. An instrument someone forgot is indistinguishable from noise — a watch is set
         deliberately, for a named question, and cleared when the question is answered. */
      try {
        const WATCH_CUST = (process.env.OZARK_WATCH_CUST || '').split(',').map(x => x.trim()).filter(Boolean);
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
      /* ↩ RETURN THE WINNERS FOR WHAT THIS PUSH LOST (2026-09-03). When a pushed record loses the merge —
         the other counter edited the same order later — the hub keeps a winner whose _seq is OLDER than the
         pusher's pull watermark, so no delta ever delivers the correction back: the losing station stays
         stale until a heal full-pull, then re-manufactures the conflict with its next edit. Launch-week cost:
         the two counters living at ~20 mirror-drifts a day, and a stale timeclock copy arming the Bianca
         auto-heal void. The winners ride home on the push receipt instead — reference identity is the test
         (hubMergeArr keeps the incoming OBJECT when the incoming copy wins), so a content-equal adoption is
         never miscalled a conflict. Capped, and old app builds simply ignore the extra field. */
      let conflicts = null;
      if (isDelta) { try {
        let _cn = 0; const _cf = {};
        Object.keys(HUB_KEYS).forEach(coll => {
          const idf = HUB_KEYS[coll];
          const fin = {}; (merged[coll] || []).forEach(r => { if (r && r[idf] != null) fin[r[idf]] = r; });
          (db[coll] || []).forEach(r => {
            if (!r || r[idf] == null || _cn >= 200) return;
            const s = fin[r[idf]];
            if (s && s !== r) { (_cf[coll] = _cf[coll] || []).push(s); _cn++; }
          });
        });
        if (_cn) { conflicts = _cf; console.log('  ↩ ' + _cn + ' pushed record(s) lost the merge — returning the winner(s) to ' + deviceOf(req)); }
      } catch (e) { conflicts = null; } }
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
        send(res, 200, conflicts ? { ok:true, rev, savedAt, conflicts } : { ok:true, rev, savedAt });
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
  //    🗄 THE ORDER ARCHIVE — retired, settled orders live in hub-data/archive/orders-<year>.jsonl (append-only,
  //    written and verified by archive-pass.js before any tombstone). These doors only READ it. The app
  //    restores an order by fetching it and saving it with a fresh _t — the ordinary merge does the rest.
  if (u.indexOf('/api/archive/') === 0) {
    if (!reqKeyOk(req)) { send(res, 401, { ok:false, error:keyErr() }); return; }
    const ARCHDIR = path.join(DATADIR, 'archive');
    let aidx = {}; try { aidx = JSON.parse(fs.readFileSync(path.join(ARCHDIR, 'index.json'), 'utf8')) || {}; } catch(e){}
    let qq; try { qq = new URL(u, 'http://x').searchParams; } catch(e){ qq = { get: () => '' }; }
    if (u.indexOf('/api/archive/stats') === 0) {
      let afiles = 0, abytes = 0, newest = 0;
      try { for (const f of fs.readdirSync(ARCHDIR)) if (/^orders-\d{4}\.jsonl$/.test(f)) { afiles++; abytes += fs.statSync(path.join(ARCHDIR, f)).size; } } catch(e){}
      for (const k in aidx) if ((+aidx[k].at || 0) > newest) newest = +aidx[k].at;
      send(res, 200, { ok:true, orders: Object.keys(aidx).length, files: afiles, bytes: abytes, lastRun: newest || null }); return;
    }
    const readArch = id => { const e = aidx[id]; if (!e) return null;
      try { const txt = fs.readFileSync(path.join(ARCHDIR, e.f), 'utf8'); let best = null;
        for (const ln of txt.split(String.fromCharCode(10))) { if (!ln || ln.indexOf(id) < 0) continue; try { const j = JSON.parse(ln); if (j.order && j.order.id === id) best = j; } catch(x){} }
        return best && best.order; } catch(e){ return null; } };
    if (u.indexOf('/api/archive/get') === 0) {
      const o = readArch(String(qq.get('id') || '')); send(res, o ? 200 : 404, o ? { ok:true, order:o } : { ok:false, error:'not in the archive' }); return;
    }
    if (u.indexOf('/api/archive/find') === 0) {
      const num = String(qq.get('number') || '').trim(), cid = String(qq.get('cid') || '').trim();
      const hits = [];
      if (num || cid) for (const id in aidx) { const e = aidx[id];
        if ((num && String(e.num || '').indexOf(num) === 0) || (cid && e.cid === cid)) { hits.push(id); if (hits.length >= 25) break; } }
      send(res, 200, { ok:true, orders: hits.map(readArch).filter(Boolean) }); return;
    }
    send(res, 404, { ok:false, error:'unknown archive door' }); return;
  }
  //    📒 the store's ledger: how many, how big, oldest/newest — reconciled against the files on every ask.
  if (u === '/api/photos/stats') {
    if (!reqKeyOk(req)) { send(res, 401, { ok:false, error:keyErr() }); return; }
    photoMetaLoad(); const m = photoMetaReconcile(); let n = 0, b = 0, oldest = 0, newest = 0;
    for (const k in m) { n++; b += (+m[k].bytes || 0); const a = +m[k].at || 0; if (a && (!oldest || a < oldest)) oldest = a; if (a > newest) newest = a; }
    send(res, 200, { ok:true, count:n, bytes:b, oldest:oldest||null, newest:newest||null });
    return;
  }
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
      try { const buf = Buffer.from(m[2], 'base64'); fs.mkdirSync(PHOTODIR, { recursive:true }); fs.writeFileSync(path.join(PHOTODIR, id), buf); photoMetaAdd(id, buf.length, deviceOf(req)); send(res, 200, { ok:true, id }); }
      catch(e){ send(res, 500, { ok:false, error: e.message }); }
    });
    return;
  }
  if (u.indexOf('/api/photo/') === 0 && req.method === 'GET') {
    if (!reqKeyOk(req)) { send(res, 401, { ok:false, error:keyErr() }); return; }
    const id = path.basename(decodeURIComponent(u.split('?')[0].slice('/api/photo/'.length)));   // basename = no path traversal
    if (!/^(ph_[a-z0-9]+|[0-9a-f]{32})\.(jpg|png)$/i.test(id)) { send(res, 404, 'not found'); return; }   /* two id shapes live in the store: ph_* uploads and blobGuard's 32-hex rescues — the old pattern could not SERVE a rescued photo at all */
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
    if (/^(ph_[a-z0-9]+|[0-9a-f]{32})\.(jpg|png)$/i.test(id)) { try { fs.unlinkSync(path.join(PHOTODIR, id)); photoMetaDel(id); } catch(e){} }
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
                     recacheAt: (all[id] && all[id].recacheAt) || 0,
                     diagAt: (all[id] && all[id].diagAt) || 0, diag: (all[id] && all[id].diag) || null,
                     cfgAt: STATION_CFG_AT });
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

      if (p.agent && typeof p.agent === 'object') {
        /* 🖨 the shell's own verdict on the printer helper — see the supervisor banner in desktop/main.js.
           ⚠️ Stored beside the station rather than in the synced DB: it is a fact about ONE machine right
           now, and every other station learning it would be noise. */
        const a = p.agent;
        /* ⚠️ `ok:null` MEANS "NO VERDICT" AND MUST SURVIVE THE WIRE. This read `ok: (a.ok === true)`, which
           collapsed null to false — so a station with printing deliberately turned OFF reported a printer
           FAILURE, and the line below then logged a ⚠ for it on every heartbeat. That is the exact inverse of
           the rule the backup check already follows (`ok:null` is never reported as good news) and it fails the
           other way: an alarm on every non-printing station is an alarm nobody reads on the one that matters.
           Three states, kept distinct: true = working · false = broken, act · null = nothing to say. */
        const verdict = (a.ok === true) ? true : (a.ok === false ? false : null);
        row.agent = { ok: verdict, why: String(a.why || '').slice(0, 160),
                      restarts: +a.restarts || 0, foreign: !!a.foreign, at: Date.now() };
        if (verdict === false) console.log('  🖨 ⚠ ' + id + ' printer helper: ' + row.agent.why +
          (row.agent.foreign ? '  (something ELSE holds the port — restarting ours cannot fix it)' : '') +
          '  restarts=' + row.agent.restarts);
        writeStationConfig(all, { id, kind: 'agent', detail: row.agent });
        if (!p.codeSha) { send(res, 200, { ok: true }); return; }
      }
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
      let bandTaken = '';
      if (want) Object.keys(want).forEach(k => {
        if (!STATION_SETTABLE[k]) { refused.push(k); return; }
        if (k === 'numBand') {
          /* 🔢 the one setting the hub actively POLICES: a band already held by another station is refused,
             not applied — that refusal is the whole collision guarantee. Same band re-set on the SAME
             station is fine (idempotent); 0/blank clears it. */
          const owner = bandOwnerConflict(all, id, want.numBand);
          if (owner) { bandTaken = 'band ' + want.numBand + ' is already assigned to ' + owner; refused.push('numBand'); return; }
        }
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
      /* 🩺 ask the station to SEND DIAGNOSTICS on its next poll (build 4, 2026-08-21) — a request flag like
         restart/recache, never a setting; the page answers with evidence, and evidence is not a command */
      if (p.diag) row.diagAt = Date.now();
      row.by = String(p.by || deviceOf(req) || '').slice(0, 60);
      row.at = Date.now();
      writeStationConfig(all, { id, kind: 'want', detail: clean, restart: !!p.restart, recache: !!p.recache, diag: !!p.diag, by: row.by });
      send(res, 200, { ok:true, id, want: row.want || null, refused,
        note: bandTaken ? bandTaken : (refused.length ? ('refused (never settable remotely): ' + refused.join(', ')) : '') });
    });
    return;
  }
  /* 🩺 /api/diag — a station's own account of itself, on request (build 4 of "run everything from this desk").
     Owner, 2026-08-21: "i want them to submit a support ticket, and we work through it, send out the fixes."
     Until now the answer to a Hot Springs ticket was a phone call asking Bianca to run something. The page
     now sends: its build, its sync state, the settings it holds, the NAMES of its storage keys (never the
     values — the hub key's presence is a boolean), its recent faults, and the print agent's own /health.
     ⚠️ EVIDENCE ONLY. Stored beside the station's settings row, key-gated both ways, and never a command. */
  if (u === '/api/diag' && req.method === 'POST') {
    if (!reqKeyOk(req)) { send(res, 401, { ok:false, error:keyErr() }); return; }
    let body=''; req.on('data', c => { body += c; if (body.length > 2e5) req.destroy(); });
    req.on('end', () => {
      let p={}; try { p = JSON.parse(body || '{}'); } catch(e){ send(res, 400, { ok:false, error:'bad json' }); return; }
      const id = String(p.id || '').trim();
      if (!/^WS-[A-Za-z0-9-]+$/.test(id)) { send(res, 400, { ok:false, error:'a station id like WS-… is required' }); return; }
      if (!p.diag || typeof p.diag !== 'object') { send(res, 400, { ok:false, error:'diag object required' }); return; }
      /* ⚠️ a station must not be able to store a secret here by accident — strip anything that looks like one */
      const d = JSON.parse(JSON.stringify(p.diag, (k, v) => (/key|secret|token|password/i.test(String(k)) && typeof v === 'string') ? '(withheld)' : v));
      const all = readStationConfig();
      const row = all[id] = all[id] || {};
      row.diag = Object.assign({}, d, { at: Date.now(), by: deviceOf(req) || '' });
      writeStationConfig(all, { id, kind: 'diag', detail: { build: d.build || '', screen: d.screen || '', sync: d.sync && d.sync.status, agent: d.agent && d.agent.ok } });
      console.log('  🩺 diagnostics from ' + id + ' (build ' + (d.build || '?') + ', sync ' + (d.sync && d.sync.status) + ')');
      send(res, 200, { ok:true });
    });
    return;
  }
  /* 🔗 /api/anchor — the off-droplet puller's source. No key → just the tiny HEAD (rev, hash, ts): a witness
     anyone can record to prove later what the true chain looked like. With the key and ?since=N → the actual
     new log lines since N, so a local job can pull only what it lacks and append it off the droplet. Owner's
     shape: read BETWEEN pushes on a timer, locally — this endpoint never pushes, it is only ever pulled. */
  if (u.split('?')[0] === '/api/anchor' && req.method === 'GET') {
    let q; try { q = new URL('http://x' + u).searchParams; } catch (e) { q = null; }
    const _sinceRaw = q ? q.get('since') : null;              /* ⚠️ Number(null) is 0, not NaN — a no-since call must be the keyless head, not a 0-key check */
    const since = (_sinceRaw == null || _sinceRaw === '') ? NaN : Number(_sinceRaw);
    const head = { ok:true, rev, head: DELTA_HEAD, ts: savedAt, genesis: GENESIS, chainStart: CHAIN_START };
    if (!Number.isFinite(since)) { send(res, 200, head); return; }            /* keyless: the witness head only */
    if (!reqKeyOk(req)) { send(res, 401, { ok:false, error: keyErr() }); return; }   /* the lines carry business data */
    const lines = deltaLogRead(since);
    send(res, 200, Object.assign({}, head, { since: since, lines: lines }));
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
      if (inQuietHours()) { SMSQUEUE.push({ to:to, body:text, kind:kind, cid:(p.cid||''), queuedAt:Date.now() }); saveQueue(); logSmsOut(to,text,kind,'queued',null,{cid:(p.cid||'')}); send(res, 200, { ok:true, queued:true, error:'Quiet hours — held; sends automatically after 8am.' }); return; }
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
      if (!twSigOk(req, u, body)) { twSigRefuse(res, u); return; }   /* 📵🔏 a forged status could mark real sends failed/delivered */
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
      if (!twSigOk(req, u, body)) { twSigRefuse(res, u); return; }   /* 📵🔏 a forged START re-enables texting an opted-out customer; a forged message plants instructions in the POS inbox */
      /* 📵📬 owner, 2026-08-31 ("make messages go into our app instead of spot... or both is fine"): the
         number's webhook now points HERE, and a signed copy of every VERIFIED inbound goes on to the old
         system (SMRT) so both inboxes see everything during the migration. Fire-and-forget.
         ⚠️ EXCEPT A CLEAR YES — live within the hour: the owner's own test "Yes" was forwarded and SMRT's
         day-picker bot answered ("we will be in your area 1-wed. please select the day…") on top of our
         confirmation. A clear yes is OUR conversation now: the app adds the pickup and texts the owner's
         confirmation; forwarding it only wakes the other bot. Everything else still forwards.
         ⚠️ twYesish mirrors the app's routeYesPositive — if the app's matcher grows a phrase this one lacks,
         the cost is only SMRT's bot answering that phrasing, never a lost message. */
      const _fwdBody = (function(){ try { return String(new URLSearchParams(body).get('Body') || ''); } catch (e) { return ''; } })();
      if (twYesish(_fwdBody)) console.log('  📬 clear YES kept in-house — our app confirms the pickup; forwarding would wake the old system’s day-picker bot');
      else smsForwardCopy(body);
      try {
        let q=null; try { q = new URLSearchParams(body); } catch(e){}
        const from = last10(q && q.get('From')); const msg = String((q && q.get('Body'))||'').trim().toUpperCase();
        const STOP = ['STOP','STOPALL','UNSUBSCRIBE','CANCEL','END','QUIT','REVOKE','OPTOUT'], START = ['START','UNSTOP','YES'];
        const rawBody = String((q && q.get('Body'))||'').trim();
        if (from) {
          if (STOP.indexOf(msg) >= 0) { OPTOUT[from] = { ts:Date.now(), reason:'replied '+msg }; saveOptout(); }
          else {
          /* ⚠️ 2026-09-01, THE NIGHT BEFORE THE FIRST REMINDER RUN: an opt-in keyword used to be `else if` —
             CONSUMED, never queued. But 'YES' is in the START list, and the Twilio history shows customers
             answer the Tuesday reminder with exactly the bare word YES every single week (one number, five
             Tuesdays running). Swallowing it meant: no Messages-screen entry, no pickup auto-add, no
             confirmation — the entire new flow dead on its first live night for the most common reply there
             is. A YES now still clears an opt-out (that half was right) AND lands in the queue as content. */
          if (START.indexOf(msg) >= 0) { delete OPTOUT[from]; saveOptout(); }
          if (rawBody) {   // a real message from a customer → queue it for the POS (home-screen flag + reply)
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
        }
      } catch(e) {}
      send(res, 200, '<?xml version="1.0" encoding="UTF-8"?><Response></Response>', { 'Content-Type':'text/xml' });
    });
    return;
  }
  // ---- opt-out list (hub key) so the POS can mark those customers "do not text" ----
  if (u === '/api/sms/optout' && req.method === 'GET') {
    if (!reqReadKeyOk(req)) { send(res, 401, { ok:false, error:keyErr() }); return; }
    send(res, 200, { ok:true, optout: Object.keys(OPTOUT).map(function(k){ return { phone:k, ts:OPTOUT[k].ts, reason:OPTOUT[k].reason }; }) });
    return;
  }
  // ---- 💬 inbound customer texts: POS reads the queue (hub key), then marks a message read/handled ----
  if (u === '/api/sms/messages' && req.method === 'GET') {
    if (!reqReadKeyOk(req)) { send(res, 401, { ok:false, error:keyErr() }); return; }
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
        .concat(SMSIN.filter(function(m){ return !arSeen[m.id] && !m.internal; }).map(function(m){ return { dir:'in', ts:m.ts, num:m.from, body:m.body, status:m.status }; }));
      const arAll = arOut.concat(arIn).sort(function(a,b){ return (b.ts||0)-(a.ts||0); });
      send(res, 200, { ok:true, messages: arAll, sent: arOut.length, received: arIn.length,
        archive:true, exists:!!ar.exists, truncated:!!ar.truncated, error:ar.error });
      return;
    }
    const out = SMSOUT.map(function(m){ return { dir:'out', ts:m.ts, num:m.to, body:m.body, kind:m.kind, status:m.status }; });
    const inb = SMSIN.filter(function(m){ return !m.internal; }).map(function(m){ return { dir:'in', ts:m.ts, num:m.from, body:m.body, status:m.status }; });
    const all = out.concat(inb).sort(function(a,b){ return (b.ts||0)-(a.ts||0); }).slice(0, 800);
    send(res, 200, { ok:true, messages: all, sent: SMSOUT.length, received: SMSIN.length });
    return;
  }
  /* 📞 A CALL REQUEST INTO THE MESSAGES INBOX (owner, 2026-09-21: "when a customer doesn't have a textable phone
     line, you should auto-send the employee an internal message through the messaging system with a message that
     looks like the customer asked them to call when the order is ready"). The app posts one when a ready text
     cannot go (landline / opted out / no mobile). It sits in the same queue as a real inbound text so the counter
     sees it where they already look — but it is marked `internal`, never written to sms-archive.jsonl (that is the
     record of what Twilio carried, and this was never a text), and the app shows a Call button, not a Reply box.
     ⚠️ One open request per customer: two stations racking the same drop-off must not stack two.
     ⚠️ It is also kept OUT of /api/sms/log (the text-history screen) — shown there it would read as a text the
     customer sent, which the test caught on its first run. */
  if (u === '/api/sms/messages/note' && req.method === 'POST') {
    if (!reqKeyOk(req)) { send(res, 401, { ok:false, error:keyErr() }); return; }
    let body=''; req.on('data', c => { body += c; if (body.length > 1e5) req.destroy(); });
    req.on('end', () => {
      let p={}; try { p = JSON.parse(body||'{}'); } catch(e){}
      const cid = String(p.custId||'').slice(0,60), txt = String(p.body||'').slice(0,400);
      if (!cid || !txt) { send(res, 400, { ok:false, error:'custId and body are required' }); return; }
      const open = SMSIN.filter(function(x){ return x.internal && x.custId === cid && x.status !== 'done'; })[0];
      if (open) { send(res, 200, { ok:true, id:open.id, dup:true }); return; }
      const m = { id:'call'+Date.now().toString(36)+Math.random().toString(36).slice(2,6), ts:Date.now(),
        from:String(p.from||'').replace(/\D/g,'').slice(-10), body:txt, status:'new', internal:true, custId:cid,
        order:String(p.order||'').slice(0,40) };
      SMSIN.push(m); if (SMSIN.length > 1000) SMSIN = SMSIN.slice(-1000); saveSmsin();
      send(res, 200, { ok:true, id:m.id });
    });
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
  /* 📱 mint a setup code — GATED: only a station that already holds the key may create one */
  if (u === '/api/setup-code' && req.method === 'POST') {
    if (!reqKeyOk(req)) { send(res, 401, { ok:false, error: keyErr() }); return; }
    let body=''; req.on('data', c => { body += c; if (body.length > 1e4) req.destroy(); });
    req.on('end', () => {
      let p={}; try { p = JSON.parse(body||'{}'); } catch(e){}
      const code = setupMint(p.by, p.ttlSec);
      console.log('  📱 setup code minted' + (p.by ? ' by ' + String(p.by).slice(0,40) : '') + ' — 15 min, single use');
      send(res, 200, { ok:true, code: code, ttlSec: Math.floor(SETUP_TTL_MS/1000) });
    });
    return;
  }
  /* 🔑🍪 bank a recovery token on a station that IS connected (keyed). The cookie is scoped to Path=/api/rekey
     so it rides only these two endpoints, HttpOnly so page script can never read it, a year long. A station
     that already carries a known cookie keeps it — its identity mapping is just refreshed. */
  if (u === '/api/rekey/mint' && req.method === 'POST') {
    if (!reqKeyOk(req)) { send(res, 401, { ok:false, error: keyErr() }); return; }
    let body=''; req.on('data', c => { body += c; if (body.length > 1e4) req.destroy(); });
    req.on('end', () => {
      let p={}; try { p = JSON.parse(body||'{}'); } catch(e){}
      const ws = String(p.ws||'').slice(0,40), name = String(p.name||'').slice(0,60);
      const have = rekeyFind(rekeyCookieOf(req));
      if (have) { have.ws = ws||have.ws; have.name = name||have.name; have.refreshedAt = Date.now(); saveRekeys(); send(res, 200, { ok:true, kept:true }); return; }
      const tok = crypto.randomBytes(24).toString('hex');
      REKEYS = REKEYS.filter(r => r).slice(-63);   // small fleet — never let the file grow without bound
      REKEYS.push({ h: rekeyHash(tok), ws, name, madeAt: Date.now(), uses: 0 });
      saveRekeys();
      console.log('  🔑🍪 recovery token banked for ' + (name||ws||'a station'));
      send(res, 200, { ok:true, minted:true }, { 'Set-Cookie': 'ozark_rt=' + tok + '; Path=/api/rekey; Max-Age=31536000; Secure; HttpOnly; SameSite=Lax' });
    });
    return;
  }
  /* 🔑🍪 trade the recovery cookie for the CURRENT key + this station's identity — PUBLIC (the whole point is
     the station has nothing left), rate-limited on the same counters as setup-claim, and every use is logged
     with IP and station. ⚠️ The key is never written to the log, only the fact of a recovery. */
  if (u === '/api/rekey' && req.method === 'POST') {
    if (!HUBKEY) { send(res, 200, { ok:false, error:'no key configured on this hub' }); return; }
    if (!setupClaimOk(req)) { send(res, 429, { ok:false, error:'too many tries — wait ten minutes' }); return; }
    const hit = rekeyFind(rekeyCookieOf(req));
    if (!hit) { setupFailed(req); send(res, 200, { ok:false }); return; }
    hit.uses = (hit.uses||0) + 1; hit.lastUsed = Date.now();
    hit.lastIp = String(req.headers['x-forwarded-for'] || (req.socket && req.socket.remoteAddress) || '?').split(',')[0].trim();
    saveRekeys();
    console.log('  🔑🍪 RECOVERY: ' + (hit.name||hit.ws||'a station') + ' at ' + hit.lastIp + ' lost its storage and traded its cookie for the key (use #' + hit.uses + ')');
    send(res, 200, { ok:true, key: HUBKEY, ws: hit.ws||'', name: hit.name||'' });
    return;
  }
  /* 📱 trade a setup code for the hub key — PUBLIC, because the phone has no key yet. See the banner above
     setupMint for the five guards. ⚠️ The key is never written to the log, only the fact of a claim. */
  if (u === '/api/setup-claim' && req.method === 'POST') {
    if (!HUBKEY) { send(res, 200, { ok:false, error:'This hub has no access key set, so there is nothing to hand out. Put OZARK_HUB_KEY in hub.env on the server.' }); return; }
    if (!setupClaimOk(req)) { send(res, 429, { ok:false, error:'Too many tries. Wait ten minutes, then ask for a fresh code.' }); return; }
    let body=''; req.on('data', c => { body += c; if (body.length > 1e4) req.destroy(); });
    req.on('end', () => {
      let p={}; try { p = JSON.parse(body||'{}'); } catch(e){}
      const want = setupHash(p.code);
      const now = Date.now();
      const hit = SETUPS.filter(s => !s.used && s.exp > now).find(s => {
        try { return crypto.timingSafeEqual(Buffer.from(s.h,'hex'), Buffer.from(want,'hex')); } catch(e){ return false; }
      });
      if (!hit) {
        setupFailed(req);
        send(res, 200, { ok:false, error:'That code is not right, or it has expired or already been used. Ask for a fresh one.' });
        return;
      }
      hit.used = true; hit.usedAt = now;
      hit.usedIp = String(req.headers['x-forwarded-for'] || (req.socket && req.socket.remoteAddress) || '?').split(',')[0].trim();
      hit.usedDevice = String(p.device || '').slice(0, 60);
      saveSetups();
      console.log('  📱 setup code CLAIMED from ' + hit.usedIp + (hit.usedDevice ? ' (' + hit.usedDevice + ')' : '') + ' — that code is now spent');
      send(res, 200, { ok:true, key: HUBKEY });
    });
    return;
  }
  if (u === '/api/pickup' && req.method === 'POST') {
    if (!trackRateOk(req)) { send(res, 429, { ok:false, error:'Too many requests — please wait a minute.' }); return; }
    if (botPost(req, res, 'pickup')) return;
    let body=''; req.on('data', c => { body += c; if (body.length > 1e5) req.destroy(); });
    req.on('end', () => {
      let p={}; try { p = JSON.parse(body||'{}'); } catch(e){}
      if (botBody(req, res, 'pickup', p)) return;
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
    if (!reqReadKeyOk(req)) { send(res, 401, { ok:false, error:keyErr() }); return; }
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

  /* ---- 📦 the drop box (design: DROP-BOX-DESIGN.md) — box endpoints take the BOX key, staff endpoints the hub key ---- */
  if (u === '/api/dropbox/lookup' && req.method === 'POST') {
    if (!dropRateOk(req)) { send(res, 429, { ok:false, error:'slow down' }); return; }
    if (!dropKeyOk(req)) { send(res, 401, { ok:false, error: DROPKEY ? 'bad drop-box key' : 'no OZARK_DROPBOX_KEY on the hub — the drop box is not set up' }); return; }
    let body=''; req.on('data', c => { body += c; if (body.length > 1e4) req.destroy(); });
    req.on('end', () => {
      let p={}; try { p = JSON.parse(body||'{}'); } catch(e){}
      const r = dropLookup(p.phone);
      console.log('  📦 drop-box lookup: ' + String(p.phone||'').replace(/\D/g,'').slice(-10) + ' → ' + (r.known ? r.first : 'unknown'));
      send(res, 200, { ok:true, known: !!r.known, first: r.first || '' });   /* first name ONLY — ids never leave the hub here */
    });
    return;
  }
  if (u === '/api/dropbox/checkin' && req.method === 'POST') {
    if (!dropRateOk(req)) { send(res, 429, { ok:false, error:'slow down' }); return; }
    if (!dropKeyOk(req)) { send(res, 401, { ok:false, error:'bad drop-box key' }); return; }
    let body=''; req.on('data', c => { body += c; if (body.length > 1e4) req.destroy(); });
    req.on('end', () => {
      let p={}; try { p = JSON.parse(body||'{}'); } catch(e){}
      const phone = String(p.phone||'').replace(/\D/g,'').slice(0,15);
      const look = phone ? dropLookup(phone) : { known:false };
      const today = new Date().toISOString().slice(0,10);
      const seq = DROPS.filter(function(d){ return String(d.claim||'').indexOf('DB'+today.slice(5,7)+today.slice(8,10)) === 0; }).length + 1;
      const claim = 'DB' + today.slice(5,7) + today.slice(8,10) + '-' + seq;
      const row = { id:'dp'+Date.now().toString(36)+Math.random().toString(36).slice(2,6), ts:Date.now(), status:'new',
        store: Number(p.store)||0, phone: phone, bags: Math.max(1, Math.min(20, Number(p.bags)||1)),
        known: !!look.known, first: look.first||'', customerIds: look.ids||[], hb: String(p.hb||'').slice(0,20), claim: claim, guest: !look.known && !p.hb };
      DROPS.push(row); if (DROPS.length > 800) DROPS = DROPS.slice(-800); saveDrops();
      console.log('  📦 DROP-BOX check-in ' + claim + ': ' + (row.first||row.phone||row.hb||'guest') + ' · ' + row.bags + ' bag(s) · store ' + row.store);
      send(res, 200, { ok:true, claim: claim, first: row.first });
    });
    return;
  }
  if (u === '/api/dropbox/heartbeat' && req.method === 'POST') {
    if (!dropKeyOk(req)) { send(res, 401, { ok:false }); return; }
    let body=''; req.on('data', c => { body += c; if (body.length > 1e4) req.destroy(); });
    req.on('end', () => {
      let p={}; try { p = JSON.parse(body||'{}'); } catch(e){}
      DROPBOXES[String(Number(p.store)||0)] = { at: Date.now(), v: String(p.v||'').slice(0,20), paper: p.paper!==false, door: String(p.door||'').slice(0,10) };
      send(res, 200, { ok:true });
    });
    return;
  }
  if (u === '/api/dropbox' && req.method === 'GET') {
    if (!reqKeyOk(req)) { send(res, 401, { ok:false, error:keyErr() }); return; }
    send(res, 200, { ok:true, requests: DROPS.filter(r => r.status !== 'done').slice(-200).reverse(), boxes: DROPBOXES });
    return;
  }
  if (u === '/api/dropbox/resolve' && req.method === 'POST') {
    if (!reqKeyOk(req)) { send(res, 401, { ok:false, error:keyErr() }); return; }
    let body=''; req.on('data', c => { body += c; if (body.length > 1e5) req.destroy(); });
    req.on('end', () => {
      let p={}; try { p = JSON.parse(body||'{}'); } catch(e){}
      const r = DROPS.filter(x => x.id === p.id)[0]; if (r) { r.status='done'; r.resolvedAt=Date.now(); r.resolvedBy=String(p.by||'').slice(0,40); saveDrops(); }
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

  // ---- 💵 PAY YOUR BALANCE BY LINK (owner 2026-09-17: "instead of sending a link for a customer to put their card
  //      on file, we could have a link that lets them just pay their balance"). Same shape as the card link — staff
  //      create it with the hub key, the customer opens pay.html and types the card into FISERV'S iframe, the page
  //      posts only the token — but the hub CHARGES a fixed amount, once, and the POS records it against what the
  //      customer owes. The amount is what the POS said was owed when the link was made, credit already off.
  //      ⚠️ It must never be paid on top of a payment taken another way: a newer link retires older ones for that
  //      customer, and the submit REFUSES if any payment for that customer reached the books after the link was
  //      made (their balance changed; nothing is charged, they are asked to call). The one charge is keyed
  //      'paylink|<k>', so a double tap or a retry replays the first answer instead of charging twice. ----
  if (u === '/api/paylink/create' && req.method === 'POST') {
    if (!reqKeyOk(req)) { send(res, 401, { ok:false, error:keyErr() }); return; }
    let body=''; req.on('data', c => { body += c; if (body.length > 1e5) req.destroy(); });
    req.on('end', () => {
      let p={}; try { p = JSON.parse(body||'{}'); } catch(e){}
      const cid=String(p.cid||'').slice(0,60), name=String(p.name||'').trim().slice(0,80), phone=String(p.phone||'').replace(/\D/g,'').slice(0,15), store=p.store||'';
      const email=String(p.email||'').trim().slice(0,120), desc=String(p.desc||'').slice(0,160);
      const amount=Math.round(Number(p.amountCents)||0);
      const fee=Math.max(0, Math.min(amount, Math.round(Number(p.feeCents)||0)));   // the card fee INSIDE amount, disclosed on the page (surcharge rules require it be shown)
      const via=String(p.via||'sms').toLowerCase(), wantSms=(via==='sms'||via==='both'), wantEmail=(via==='email'||via==='both');
      /* 🧾 the invoices this link pays (owner 2026-09-28: "the pay link should only send the link to attach to the
         currently selected invoices"). Absent = the whole balance, as every link before this did. The POS uses it to
         record the payment against exactly those orders; the hub only stores and returns it. */
      const orderIds = Array.isArray(p.orderIds) ? p.orderIds.slice(0, 300).map(function(x){ return String(x||'').slice(0, 60); }).filter(Boolean) : null;
      const other = !!p.other;
      if (!cid) { send(res, 200, { ok:false, error:'Need the customer.' }); return; }
      if (!(amount >= 50 && amount <= 500000)) { send(res, 200, { ok:false, error:'The amount must be between $0.50 and $5,000.' }); return; }
      if (wantSms && phone.length < 10) { send(res, 200, { ok:false, error:'Need a valid mobile number.' }); return; }
      if (wantEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { send(res, 200, { ok:false, error:'Need a valid email address.' }); return; }
      if (!wantSms && !wantEmail) { send(res, 200, { ok:false, error:'Pick text or email.' }); return; }
      if (!cpConfigured()) { send(res, 200, { ok:false, error:'Card payments are not set up on the hub, so a pay link cannot be sent.' }); return; }
      const now = Date.now();
      PAYLINKS.forEach(function(x){ if (x.cid===cid && x.status==='sent') { x.status='superseded'; x.supersededAt=now; } });
      const k = 'pl'+now.toString(36)+crypto.randomBytes(9).toString('hex');
      const rec = { k:k, cid:cid, name:name, phone:phone, email:email, store:store, amount:amount, fee:fee, desc:desc, status:'sent', createdAt:now, exp:now+7*24*3600*1000, attempts:0 };
      if (orderIds) { rec.orderIds = orderIds; rec.other = other; }
      PAYLINKS.push(rec); if (PAYLINKS.length > 3000) PAYLINKS = PAYLINKS.slice(-3000); savePaylinks();
      const link = CARDLINK_BASE + '/pay.html?k=' + k;
      const amt = '$' + (amount/100).toFixed(2);
      const msg = 'Ozark Cleaners: ' + (name ? name + ', ' : '') + (orderIds ? 'you can pay ' + amt + ' toward your account' : 'your balance is ' + amt) + '. Pay it securely here (expires in 7 days): ' + link + ' - reply STOP to opt out.';
      const out = { ok:true, link:link, k:k }, jobs = [];
      if (wantSms) {
        if (!smsConfigured())      out.sms = 'simulated';
        else if (isOptedOut(phone)) out.sms = 'optout';
        else jobs.push(smsGatedSend(phone, msg).then(function(r){ out.sms = (r&&r.ok) ? 'sent' : ((r&&r.error)||'not sent'); }));
      }
      if (wantEmail) {
        if (!emailConfigured()) out.email = 'not-set-up';
        else jobs.push(sendEmail({ to:[email], subject:'Pay your balance — Ozark Cleaners', html:payLinkEmailHtml(name, link, amount, !!orderIds) })
          .then(function(r){ out.email = (r&&r.ok) ? 'sent' : ((r&&r.error)||'not sent'); }));
      }
      Promise.all(jobs).then(function(){ send(res, 200, out); });
    });
    return;
  }
  /* a payment for this customer that reached the books AFTER the link was made — by customer id OR through one of
     their orders (route payment rows can carry only the order). Reads the hub's saved copy; it judges nothing about
     amounts, only whether money arrived, so no money math lives here. */
  /* 💵🛑 A MONEY GUARD MUST NOT READ AN OLD REVISION. readDB falls back to the .bak — the PREVIOUS revision —
     whenever the snapshot cannot be read, which is exactly what happens for a moment while writeAtomic renames
     the new one into place. The fallback is right for corruption and wrong here: the payment that just landed is
     missing from that copy, so "has this balance already been paid another way?" answers NO and the customer is
     charged twice. It flaked ~1 run in 4 in test-hub, always in the reassuring direction. So: insist on a copy at
     least as new as the revision the hub has accepted, retry briefly, and if it still cannot be read REFUSE the
     link (nothing charged, the customer calls us) rather than take a stale copy's word for it. */
  function readDBCurrent(){
    const raw = readDB();
    return (raw && raw.db && raw.__meta && (raw.__meta.rev || 0) >= rev) ? raw : null;
  }
  function paylinkStale(rec){
    try { const raw = readDBCurrent(); const db = raw && raw.db;
      if (!db) { console.log('  ⚠ paylink: could not read the CURRENT database — refusing the link rather than risk a double charge'); return true; }
      const oids = {}; (db.orders||[]).forEach(function(o){ if (o && o.customerId===rec.cid) oids[o.id]=1; });
      return (db.payments||[]).some(function(pm){ return pm && (Number(pm.amount)||0) > 0 && (+pm.date||0) > rec.createdAt
        && String(pm.ref||pm.txn||'') !== String(rec.ref||'~') && (pm.customerId===rec.cid || (pm.orderId && oids[pm.orderId])); });
    } catch (e) { return false; }
  }
  function paylinkProblem(rec){
    if (!rec) return 'This link is not valid.';
    if (rec.status==='paid') return 'This balance is already paid — thank you!';
    if (rec.status==='superseded' || rec.status==='cancelled') return 'This link was replaced by a newer one. Please use the most recent link we sent, or call us.';
    if (Date.now() > (rec.exp||0)) return 'This link has expired. Please call us and we\'ll send a new one.';
    if (rec.status==='stale' || paylinkStale(rec)) { if (rec.status!=='stale') { rec.status='stale'; savePaylinks(); } return 'Your balance changed since this link was sent, so it can\'t be paid here. Nothing was charged — please call us and we\'ll send an updated link.'; }
    return '';
  }
  if (u.indexOf('/api/paylink/info') === 0 && req.method === 'GET') {
    if (!trackRateOk(req)) { send(res, 429, { ok:false, error:'Too many requests - please wait a minute.' }); return; }
    var pq; try { pq = new URL(u, 'http://h').searchParams; } catch(e){ pq = null; }
    var prec = PAYLINKS.filter(function(x){ return x.k === (pq ? String(pq.get('k')||'') : ''); })[0];
    var pbad = paylinkProblem(prec);
    if (pbad) { send(res, 200, { ok:false, error:pbad, paid:!!(prec && prec.status==='paid') }); return; }
    var phost = cpHostOf(cpForStore(prec.store));
    var pcss = 'body{margin:0;font-family:-apple-system,Segoe UI,Arial,sans-serif}input{width:100%;box-sizing:border-box;font-size:17px;padding:13px;border:1px solid #cfd8e3;border-radius:10px;margin:4px 0;-webkit-appearance:none}';
    send(res, 200, { ok:true, name: prec.name||'', amount: prec.amount, fee: prec.fee||0, desc: prec.desc||'', tokenizer: 'https://'+phost+'/itoke/ajax-tokenizer.html?usecvv=true&cardnumbernumericonly=true&formatinput=true&enhancedresponse=true&tokenizewheninactive=true&inactivityto=800&css='+encodeURIComponent(pcss) });
    return;
  }
  if (u === '/api/paylink/submit' && req.method === 'POST') {
    if (!trackRateOk(req)) { send(res, 429, { ok:false, error:'Too many requests - please wait a minute.' }); return; }
    let body=''; req.on('data', c => { body += c; if (body.length > 1e5) req.destroy(); });
    req.on('end', () => {
      let p={}; try { p = JSON.parse(body||'{}'); } catch(e){}
      const rec = PAYLINKS.filter(function(x){ return x.k === String(p.k||''); })[0];
      const token=String(p.token||'').slice(0,120), expiry=String(p.expiry||'').replace(/\D/g,'').slice(0,4), postal=String(p.postal||'').replace(/\D/g,'').slice(0,5);
      const bad = paylinkProblem(rec);
      if (bad) { send(res, 200, { ok:false, error:bad, paid:!!(rec && rec.status==='paid') }); return; }
      if (!token) { send(res, 200, { ok:false, error:'No card was entered.' }); return; }
      if (expiry.length !== 4) { send(res, 200, { ok:false, error:'Please enter the expiration as MM/YY.' }); return; }
      if (!p.consent) { send(res, 200, { ok:false, error:'Please check the box to authorize this payment.' }); return; }
      if (rec.inflight && Date.now() - rec.inflight < 120000) { send(res, 200, { ok:false, error:'Your payment is already going through — please wait a moment.' }); return; }
      rec.inflight = Date.now(); rec.attempts = (rec.attempts||0) + 1; savePaylinks();
      const opts = { store: rec.store, expiry: expiry, ecomind: 'E', idem: 'paylink|' + rec.k, cid: rec.cid };
      if (postal.length === 5) opts.postal = postal;
      cpAuthCapture(token, rec.amount, opts).then(function(r){
        rec.inflight = 0;
        cardLog('paylink', 'pay link', { store: rec.store }, r, { amount: rec.amount, cid: rec.cid, via: 'link' });
        if (r && r.status === 'approved') {
          rec.status='paid'; rec.paidAt=Date.now(); rec.ref=String(r.ref||r.retref||''); rec.auth=String(r.auth||''); rec.last4=String(r.last4||cpLast4(token)); rec.brand=String(r.brand||'Card'); rec.consentAt=Date.now();
          savePaylinks(); send(res, 200, { ok:true, amount: rec.amount, last4: rec.last4 }); return;
        }
        savePaylinks();
        send(res, 200, { ok:false, error: (r && r.status === 'declined') ? ((r.message ? 'Your card was declined (' + r.message + '). ' : 'Your card was declined. ') + 'Nothing was charged — you can try another card.') : ((r && r.message) || 'We could not reach the card processor. Nothing was charged — please try again in a minute.') });
      }).catch(function(){ rec.inflight = 0; savePaylinks(); send(res, 200, { ok:false, error:'We could not reach the card processor. Nothing was charged — please try again in a minute.' }); });
    });
    return;
  }
  if (u === '/api/paylink/pending' && req.method === 'GET') {   // the POS records paid links against what the customer owes
    if (!reqKeyOk(req)) { send(res, 401, { ok:false, error:keyErr() }); return; }
    send(res, 200, { ok:true, paid: PAYLINKS.filter(function(r){ return r.status==='paid' && !r.resolved; }).slice(-100).map(function(r){ return { k:r.k, cid:r.cid, amount:r.amount, fee:r.fee||0, ref:r.ref, auth:r.auth, last4:r.last4, brand:r.brand, store:r.store, paidAt:r.paidAt, desc:r.desc||'', orderIds:r.orderIds||null, other:!!r.other }; }) });
    return;
  }
  if (u === '/api/paylink/resolve' && req.method === 'POST') {
    if (!reqKeyOk(req)) { send(res, 401, { ok:false, error:keyErr() }); return; }
    let body=''; req.on('data', c => { body += c; if (body.length > 1e5) req.destroy(); });
    req.on('end', () => { let p={}; try { p = JSON.parse(body||'{}'); } catch(e){} const r=PAYLINKS.filter(function(x){ return x.k===p.k; })[0]; if (r) { r.resolved=true; r.resolvedAt=Date.now(); savePaylinks(); } send(res, 200, { ok:true }); });
    return;
  }

  // ---- customer feedback + $10 review-credit: PUBLIC submit (rate-limited, no hub key) + POS reads/resolves (hub key) ----
  if (u === '/api/feedback' && req.method === 'POST') {
    if (!trackRateOk(req)) { send(res, 429, { ok:false, error:'Too many requests — please wait a minute.' }); return; }
    if (botPost(req, res, 'feedback')) return;   /* 🤖 same screen as the pickup form — a crawler must not be able to award itself a $10 credit */
    let body=''; req.on('data', c => { body += c; if (body.length > 1e5) req.destroy(); });
    req.on('end', () => {
      let p={}; try { p = JSON.parse(body||'{}'); } catch(e){}
      if (botBody(req, res, 'feedback', p)) return;
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
    if (!reqReadKeyOk(req)) { send(res, 401, { ok:false, error:keyErr() }); return; }
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
  /* 🔬 POST /api/mirror-deep — a station stuck in a drift run sends per-record fingerprints for ONE
     collection; the hub diffs against its own copy and JOURNALS exactly which records differ, with both
     sides' _t and _seq. Built 2026-09-04 after two hours at 45-checks-in-a-row with nothing but collection
     names to reason from. Read-only — comparing copies must never change one. A "NO record differs" answer
     is itself a diagnosis: the station's bucket fingerprint disagreed while every record hash agrees, which
     means the station's mirror CACHE is lying (the 8/14 class), not the data. */
  if (u === '/api/mirror-deep' && req.method === 'POST') {
    if (!reqKeyOk(req)) { send(res, 401, { ok:false, error:keyErr() }); return; }
    let body=''; req.on('data', c => { body += c; if (body.length > 8e6) req.destroy(); });
    req.on('end', () => {
      let p={}; try { p = JSON.parse(body||'{}'); } catch(e){}
      const dev=deviceOf(req), coll=String(p.coll||''), fps=(p.fps&&typeof p.fps==='object')?p.fps:{};
      const idf=(HUB_KEYS_FOR_SEQ||{})[coll];
      if (!idf) { send(res, 200, { ok:false, error:'unknown collection' }); return; }
      const cur=readDB(); const rows=(cur&&cur.db&&cur.db[coll])||[];
      const mineIds={}; const diffs=[];
      rows.forEach(r => { if(!r||typeof r!=='object') return; const k=String(r[idf]==null?'':r[idf]); mineIds[k]=1;
        const s=fps[k];
        if (!s) { diffs.push(k+'  ONLY ON HUB  hub _t='+(r._t||0)+' _seq='+(r._seq||0)); return; }
        const h=mirrorHash(k+'|'+mirrorStable(r));
        if (h!==s.h) diffs.push(k+'  BYTES DIFFER  hub _t='+(r._t||0)+' _seq='+(r._seq||0)+'  station _t='+(s.t||0)+' _seq='+(s.q||0)+(String(r._t||0)===String(s.t||0)?'  ⚠ same _t, different bytes':''));
      });
      Object.keys(fps).forEach(k => { if(!mineIds[k]) diffs.push(k+'  ONLY ON STATION  station _t='+((fps[k]||{}).t||0)+' _seq='+((fps[k]||{}).q||0)); });
      console.log('  🔬 MIRROR DEEP  '+dev+'  '+coll+'  (station at rev '+p.rev+', hub at '+rev+', miss '+(p.miss||'?')+')  →  '+(diffs.length? diffs.length+' record(s) differ:':'NO record differs — the station mirror cache is lying, not the data'));
      diffs.slice(0,8).forEach(d => console.log('       · '+d));
      if (diffs.length>8) console.log('       · … '+(diffs.length-8)+' more');
      send(res, 200, { ok:true, differs:diffs.length });
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
  /* 🔢 MINT AUTHORITY — reserve the next order number (2026-09-01: two Arkadelphia counters minted
     1-09-01-26-0010 sixty-eight seconds apart, the residual race genOrderNumber documents). The hub is ONE
     process, so two stations cannot get the same answer HERE. The station prefetches a reservation when a
     Quick/Detail screen opens and spends it at save; the local mint stays as the offline fallback, watched
     by the merge-time collision alarm. The station sends ITS calendar day (the hub runs UTC — after 7 PM
     Central the hub's own date is already tomorrow). An abandoned reservation costs only a gap in the day's
     numbers; a number is identity, not accounting. Restart-safe via mint-reserve.json, and every request
     re-scans the stored orders so the counter can never fall behind numbers already pushed. */
  if (u === '/api/mint' && req.method === 'POST') {
    if (!reqKeyOk(req)) { send(res, 401, { ok:false, error:keyErr() }); return; }
    let body=''; req.on('data', c => { body += c; if (body.length > 1e4) req.destroy(); });
    req.on('end', () => {
      let p={}; try { p = JSON.parse(body||'{}'); } catch(e){}
      const store=String(p.store||''), yy=String(p.yy||''), mm=String(p.mm||''), dd=String(p.dd||'');
      if (!/^[0-9]{1,2}$/.test(store) || !/^[0-9]{2}$/.test(yy) || !/^[0-9]{2}$/.test(mm) || !/^[0-9]{2}$/.test(dd)) { send(res, 400, { ok:false, error:'store, yy, mm, dd required' }); return; }
      const pre = store + '-' + mm + '-' + dd + '-' + yy + '-';
      const key = store + '-' + yy + mm + dd;
      const raw = readDB(); const dbx = (raw && raw.db) || raw || {};
      let n = 0;
      (dbx.orders || []).forEach(o => { const s = String((o && o.number) || ''); if (s.indexOf(pre) === 0) { const q2 = parseInt(s.slice(pre.length), 10); if (isFinite(q2) && q2 > n) n = q2; } });
      if ((MINTMAP[key] || 0) > n) n = MINTMAP[key];
      n += 1; MINTMAP[key] = n;
      if (Object.keys(MINTMAP).length > 40) { const keep = MINTMAP[key]; MINTMAP = {}; MINTMAP[key] = keep; }   /* old days are covered by the order scan */
      try { fs.writeFileSync(MINTFILE, JSON.stringify(MINTMAP)); } catch (e) {}
      send(res, 200, { ok:true, n:n, number: pre + String(n).padStart(4, '0') });
    });
    return;
  }
  /* 🔒 CUSTOMER RESERVATION AUTHORITY — the second computer waits (see the RESV banner above).
     body { cid, name, action:'take'|'renew'|'release' }.
       take   → grant if the customer is free, expired, or already held by THIS device; else answer held-by-someone.
       renew  → refresh my hold's clock while I keep the screen open (no-op if I am not the holder any more).
       release→ drop my hold the instant I leave to Home, so the next station gets it without waiting out the TTL.
     Answers { ok, mine } — mine:true means "you hold it, go ahead"; mine:false carries { by } = who to wait on.
     ⚠️ deviceOf() is the identity, exactly as the mirror and the auto-leader use it — a hold belongs to a MACHINE. */
  if (u === '/api/reserve' && req.method === 'POST') {
    if (!reqKeyOk(req)) { send(res, 401, { ok:false, error:keyErr() }); return; }
    let body=''; req.on('data', c => { body += c; if (body.length > 1e4) req.destroy(); });
    req.on('end', () => {
      let p={}; try { p = JSON.parse(body||'{}'); } catch(e){}
      const cid = String(p.cid||'').slice(0,64);
      const action = String(p.action||'take');
      const dev = deviceOf(req);
      const name = String(p.name||'').slice(0,60) || dev;
      if (!cid) { send(res, 400, { ok:false, error:'cid required' }); return; }
      resvPrune();
      const cur = RESV[cid];
      if (action === 'release') { if (cur && cur.dev === dev) delete RESV[cid]; send(res, 200, { ok:true, mine:false }); return; }
      if (action === 'renew') {
        if (cur && cur.dev === dev) { cur.exp = Date.now() + RESV_TTL_MS; cur.name = name; send(res, 200, { ok:true, mine:true }); return; }
        /* my hold lapsed and nobody else took it → re-grant; else it is someone else's now */
        if (!resvLive(cur)) { RESV[cid] = { dev, name, exp: Date.now() + RESV_TTL_MS }; send(res, 200, { ok:true, mine:true }); return; }
        send(res, 200, { ok:true, mine:false, by: cur.name || 'another station' }); return;
      }
      /* action 'take' (default) */
      if (!resvLive(cur) || cur.dev === dev) { RESV[cid] = { dev, name, exp: Date.now() + RESV_TTL_MS }; send(res, 200, { ok:true, mine:true }); return; }
      send(res, 200, { ok:true, mine:false, by: cur.name || 'another station' });
    });
    return;
  }
  if (u === '/api/support' && req.method === 'POST') {
    if (!reqKeyOk(req)) { send(res, 401, { ok:false, error:keyErr() }); return; }
    let body=''; req.on('data', c => { body += c; if (body.length > 1e5) req.destroy(); });
    req.on('end', () => {
      let p={}; try { p = JSON.parse(body||'{}'); } catch(e){}
      const text = String(p.text||'').trim().slice(0,2000);
      if (!text) { send(res, 200, { ok:false, error:'Type the problem first.' }); return; }
      /* ⚠️ SCREENSHOT REFERENCES ONLY, NEVER BYTES. Requested by Bianca Jonas on 2026-08-12: "i need to be
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

      if (action === 'run-result') {   // 💳🔎 a counter that lost the answer to a charge asks what happened to ITS run, never guesses "declined"
        const rid = String(parsed.runId || ctx.runId || '').slice(0, 64); const run = rid ? _cpRuns.get(rid) : null;
        send(res, 200, run ? { ok: true, pending: !run.result, result: run.result || null, orderid: run.orderid } : { ok: true, unknownRun: true });
        return;
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
            /* 💳🔗 THE LEASE (see the banner above cptLease): one armed session per terminal, held only while
               the popup's own connection lives. A second arm is refused BY NAME; a dead popup's session has
               already been cancelled by the lease, so the refusal can only ever name a live one. */
            { const _busy = cptLeaseBusy(store);
              if (_busy) { send(res, 200, { ok:false, result:{ status:'error', message:'Terminal already in use — ' + (_busy.dev || 'another station') + ' started a read ' + Math.round((Date.now() - _busy.at) / 1000) + 's ago. Finish or cancel it there first.' }, error:'Terminal already in use' }); return; } }
            if (ctx.entry === 'keyed') {   // ⌨️ card-NOT-present: clerk keys the number on the terminal (phone/mail order) → token → gateway auth
              const lease = cptLease(req, res, store, deviceOf(req));
              cptReadManual(store).then(function(rm){
                if (lease.gone) { cptLeaseSettle(store, lease);   // ⚠️ the window died during the KEYED read → the token is discarded and NO charge is sent. Unlike the dip path there is no capture yet, so the safe outcome — no money moved — is simply to stop.
                  console.log('  💳🛑 keyed read settled after the window died — token discarded, nothing charged'); return; }
                if (rm.status !== 'approved' || !rm.token) { cptLeaseSettle(store, lease); send(res, 200, { ok:false, result: rm, error: rm.message || 'Could not read the keyed card' }); return; }
                cpAuthCapture(rm.token, parsed.amount, { store: store, ecomind: 'E', expiry: rm.exp, idem: ctx.idem, cid: ctx.cid }).then(function(result){
                  cptLeaseSettle(store, lease);
                  if (result && result.status === 'approved' && !result.last4 && rm.last4) result.last4 = rm.last4;
                  if (lease.gone) { if (result && result.status === 'approved') cptTermRecover(result, parsed.amount, ctx, store); return; }   // charged in the same instant the window died → record, never drop
                  send(res, 200, { ok: result.status === 'approved', result, error: result.status !== 'approved' ? (result.message || result.status) : undefined });
                });
              });
              return;
            }
            { const lease = cptLease(req, res, store, deviceOf(req));
              ctx.cpOrderId = cpOrderId(store); cpRunStart(ctx.runId, ctx.cpOrderId, store, parsed.amount);   // 💳🔎 one CardPointe order id per charge; the run id lets a counter that lost the answer ask for it
              cptAuthCard(parsed.amount, ctx).then(function(result){
                return cpSettleTerminal(result, ctx.cpOrderId, store, lease, ctx, parsed.amount, deviceOf(req));   // CardPointe's rules for an unclear answer, BEFORE anyone is told
              }).then(function(result){
                cptLeaseSettle(store, lease);
                cpRunDone(ctx.runId, result, (lease.gone && result && result.status === 'approved') ? { recordedByHub: true } : null);
                if (lease.gone) {   // the popup is dead; the lease already fired the cancel. Whichever way the race went, say so — and if the bank approved, the money gets RECORDED (the Mercer rule).
                  if (result && result.status === 'approved') { console.log('  💳🚨 APPROVED after the window died (ref ' + (result.ref || '?') + ') — recording the capture'); cptTermRecover(result, parsed.amount, ctx, store); }
                  else { console.log('  💳🛑 read settled "' + ((result && result.status) || '?') + '" after the window died — nothing captured'); }
                  return;
                }
                send(res, 200, { ok: result.status === 'approved', result, error: result.status !== 'approved' ? (result.message || result.status) : undefined });
              });
              return; }
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
            /* 💳🔗 the save-card reads take the SAME lease: no capture is at stake, but a dead window here left
               the reader armed just the same — and an armed reader is the Mercer precondition. Cancel-on-death
               + refuse-while-busy; there is no money to recover on this path so the lease is the whole story. */
            const _busyS = cptLeaseBusy(store);
            if (_busyS) { send(res, 200, { ok:false, error:'Terminal already in use — ' + (_busyS.dev || 'another station') + ' started a read ' + Math.round((Date.now() - _busyS.at) / 1000) + 's ago.' }); return; }
            const _leaseS = cptLease(req, res, store, deviceOf(req));
            const _doneS = function(code, obj){ cptLeaseSettle(store, _leaseS);
              /* 📇 EVERY save attempt is recorded, refusals included (2026-09-01: Lanyard's Mastercard
                 keyed-save refusals left NO trace in card-events, so "still can't get mastercards on file"
                 was unfalsifiable — the exact 8/10 class this log exists to end). */
              try { const rr = (obj && obj.result) || {};
                cardLog('save-card', ctx.dev || '', ctx,
                  (obj && obj.ok) ? rr : { status: rr.status || 'error', message: (obj && obj.error) || rr.message || '', brand: rr.brand, last4: rr.last4, ref: rr.ref, respcode: rr.respcode },
                  { via: (ctx.entry === 'keyed' ? 'keyed save' : 'tap save'), cid: ctx.cid }); } catch (e) {}
              if (!_leaseS.gone) send(res, code, obj); };   // settle the lease, answer only a living window — a token for a dead popup is simply discarded (no capture exists on this path)
            if (ctx.entry === 'keyed') {   // keyed readManual only tokenizes → follow with a $0 account verification so a bad number is caught NOW (no charge, nothing to void)
              cptReadManual(store).then(function(rm){
                if (rm.status !== 'approved' || !rm.token) { _doneS(200, { ok:false, result: rm, error: rm.message || 'Could not read the card' }); return; }
                cpAuthCapture(rm.token, 0, { store: store, capture: 'N', ecomind: 'E', expiry: rm.exp }).then(function(v){
                  if (v.status !== 'approved') { _doneS(200, { ok:false, result: v, error: (v.message || 'Card was declined on a $0 check') }); return; }
                  _doneS(200, { ok:true, result: { status:'approved', token: rm.token, last4: rm.last4, brand: (v.brand || rm.brand || 'Card'), exp: rm.exp } });
                });
              });
              return;
            }
            cptTokenizeCard(store).then(result => _doneS(200, { ok: result.status === 'approved' && !!result.token, result, error: result.status !== 'approved' ? (result.message || 'Could not read the card') : undefined }));   // tap/dip = a $0 authCard verify, already validates
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
          /* 🔑 a refund is money moving, exactly like a charge — the 8/28 readiness review found it had NO
             key at all. Same contract as cpAuthCapture: a finished intent replays its first answer, an
             in-flight one is refused by name, and only a real answer (approved/declined) closes the key. */
          const _ridem = String(parsed.idem || '').trim();
          if (_ridem) {
            const g = idemCheck(_ridem, { amount: parsed.amount, cid: '' });
            if (g.replay) { console.log('  🔑 idempotent replay (refund) for ' + _ridem + ' — returning the first answer, refunding nothing'); send(res, 200, { ok: g.replay.status === 'approved', result: Object.assign({}, g.replay, { idempotentReplay: true }), error: g.replay.status !== 'approved' ? (g.replay.message || g.replay.status) : undefined }); return; }
            if (g.refuse)  { console.log('  🔑 REFUSED refund ' + _ridem + ' — ' + g.refuse.slice(0, 90)); send(res, 200, { ok:false, result: { status:'error', message: g.refuse, idempotentRefusal: true }, error: g.refuse }); return; }
          }
          cpRefund(rf, parsed.amount, store).then(j => { const r = cpNormalize(j);
            try { if (_ridem && r && (r.status === 'approved' || r.status === 'declined')) idemFinish(_ridem, r); } catch (e) {}
            send(res, 200, { ok: r.status === 'approved', result: r, error: r.status !== 'approved' ? (r.message || r.status) : undefined }); });
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
          { const inf = _cptInflight[String(store||'')]; if (inf && !inf.done) inf.cancelled = true; }   // 💳🔎 a charge that lands after this is VOIDED, never left standing (Hythe 9/18)
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

/* 🔗 BOOT-TIME CHAIN CHECK — placed here so every chain function and constant above is defined. The hub
   proves its OWN log is unbroken before it serves, and flags a break on /api/health rather than refusing to
   start (a historical torn line must not brick the shop). */
(function initDeltaHead(){ try { DELTA_HEAD = chainHeadAtBoot(); console.log('  🔗 delta-log chain head resumed: ' + DELTA_HEAD.slice(0,12) + '…'); } catch (e) { DELTA_HEAD = GENESIS; } })();
(function selfVerifyChain(){
  try {
    const lines = deltaLogRead(0);
    if (!lines.length) return;
    const v = chainVerify(lines, lines[0].p);
    CHAIN_OK = v.ok; CHAIN_WHY = v.ok ? '' : v.why; CHAIN_START = v.chainStart || 0;
    console.log(v.ok
      ? ('  🔗 self-check: chain unbroken from rev ' + v.chainStart + ' to ' + v.lastRev + ' (' + v.count + ' hashed)' + (v.preChain ? ', ' + v.preChain + ' pre-chain lines before it' : ''))
      : '  🔗 ⚠ DELTA-LOG CHAIN BROKEN: ' + v.why);
  } catch (e) { console.log('  🔗 self-check could not run: ' + e.message); }
})();
/* 🔌 Idle upstream connections must outlive Caddy's reuse window (2 min). Node's 5s default closed sockets Caddy
   was about to reuse, so a request landing on one got "connection reset by peer" → 502 with the hub healthy and
   no restart: 21 of them on 2026-09-16, including three route delivery charges that never reached the processor
   and were logged as declines. headersTimeout must stay above keepAliveTimeout or Node closes first anyway. */
server.keepAliveTimeout = 130000;
server.headersTimeout = 135000;
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
