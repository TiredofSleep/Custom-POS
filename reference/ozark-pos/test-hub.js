#!/usr/bin/env node
/* test-hub.js — deploy gate for hub-server.js.  Run:  node test-hub.js
 *
 * The app has had a harness since 7/23; the hub never did. Everything built into it on 8/5 — the
 * per-record merge, the one-way law server-side, the stale-build detector — was verified by hand against
 * production, which is not a standard to keep. This runs a REAL hub in a throwaway directory on a spare
 * port and drives it over HTTP, so the actual request path is what gets tested, not a mock of it.
 *
 * Nothing here touches /opt/ozark or any live data: it copies hub-server.js into a temp dir with its own
 * hub-data, and kills the process on the way out.
 */
const fs = require('fs'), path = require('path'), os = require('os'), http = require('http');
const netMod = require('net');   /* module scope: the full-pull turnstile test opens a raw socket */
const { spawn } = require('child_process');

const KEY = 'test-key-' + Math.random().toString(36).slice(2, 8);
const READKEY = 'read-only-test-key-' + Math.random().toString(36).slice(2, 10);   /* 🔑👁 OZARK_HUB_READ_KEY (E85, 9/26): the v2 copy's key */
/* ⚠️ PICK A PORT THAT IS ACTUALLY FREE. This was `8700 + random(200)` and on 2026-08-11 it landed on a port
   another service on this machine already owned \u2014 Dell SupportAssist answered the health check, the boot loop
   never saw ok:true, and SIXTEEN assertions failed against a stranger's JSON. A harness that fails randomly
   teaches you to ignore it, which is worse than not having it. Bind the port ourselves first: if we can hold it,
   it is free; release it and hand it to the hub. */
function pickFreePort(){
  const net = require('net');
  for (let i = 0; i < 40; i++) {
    const cand = 8700 + Math.floor(Math.random() * 300);
    try {
      const srv = net.createServer();
      let ok = false;
      srv.listen({ port: cand, host: '127.0.0.1', exclusive: true });
      const start = Date.now();
      while (Date.now() - start < 300) { if (srv.listening) { ok = true; break; } require('child_process').execSync(process.platform === 'win32' ? 'cmd /c "ping -n 1 127.0.0.1 >NUL"' : 'sleep 0.01'); }
      srv.close();
      if (ok) return cand;
    } catch (e) {}
  }
  return 8799;
}
/* ⚠️ Binding a port to prove it's free, then RELEASING it and handing the number to the hub, has a race: under
   deploy load another process (or a parallel gate) can grab it in the gap, the hub fails to bind, and the whole
   suite fails "randomly" — the exact cry-wolf this file warns against. So the port is not final here; the hub
   start below RETRIES on a fresh port if boot fails, which closes the race regardless of who won it. */
let PORT = pickFreePort();
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ozark-hubtest-'));
let child = null, pass = 0, fail = 0;

function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? '   → ' + JSON.stringify(extra).slice(0, 200) : '')); }
}
function cleanup() {
  try { if (child) child.kill('SIGKILL'); } catch (e) {}
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) {}
}
process.on('exit', cleanup);
process.on('uncaughtException', e => { console.error('HARNESS CRASH: ' + (e.stack || e)); cleanup(); process.exit(1); });

const req = (method, p, body, dev, key, hdrs) => new Promise((res, rej) => {
  const data = body === undefined ? null : JSON.stringify(body);
  const r = http.request({ host: '127.0.0.1', port: PORT, path: p, method, headers: Object.assign(
    { 'x-ozark-device': dev || 'TEST-DEV' },
    key === null ? {} : { 'x-ozark-key': key || KEY },
    data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}, hdrs || {}) }, x => {
    let d = ''; x.on('data', c => d += c);
    x.on('end', () => { let j = null; try { j = JSON.parse(d); } catch (e) {} res({ status: x.statusCode, json: j, raw: d }); });
  });
  r.on('error', rej); if (data) r.write(data); r.end();
});
const sleep = ms => new Promise(r => setTimeout(r, ms));
const HUB_KEYS_T = { prices:'id', upcharges:'id', employees:'id', customers:'id', orders:'id', payments:'id',
  ledger:'id', timeclock:'id', timeAcks:'id', timeOff:'id', routeLog:'id', checklist:'id', supplies:'id',
  devices:'id', voidRequests:'id', refundRequests:'id', batches:'id', collections:'id', supplyOrders:'id',
  garments:'hsl' };


// ---- a small but valid database to start from ------------------------------------------------------
const T = 1780000000000;
const seed = {
  settings: { stores: [{ id: 1, name: 'Arkadelphia', tax: 0.1 }], seq: { '1': 5 }, _t: T },
  prices: [{ id: 'p1', name: 'Shirt', _t: T }],
  customers: [{ id: 'c1', first: 'Ada', last: 'Test', balance: 0, _t: T },
              { id: 'c2', first: 'Ike', last: 'Test', balance: 0, _t: T }],
  orders: [{ id: 'o1', number: 'A-1', status: 'PickedUp', paymentStatus: 'paid', deliveredAt: T, _t: T },
           { id: 'o2', number: 'A-2', status: 'Detailed', _t: T }],
  payments: [{ id: 'pay1', orderId: 'o1', amount: 10, _t: T }],
  collections: [{ id: 'col1', customerId: 'c1', amount: 25, status: 'open', _t: T }],
  ledger: [], garments: [], activity: [], devices: [{ id: 'TEST-DEV', name: 'TEST-DEV', lastSeen: T, appRev: 'oldrev000000' }],
  _tomb: [{ c: 'prices', k: 'gone1', t: T }],
};

(async () => {
  // ---- stand up a real hub in a throwaway directory -------------------------------------------------
  fs.copyFileSync(path.join(__dirname, 'hub-server.js'), path.join(TMP, 'hub-server.js'));
  fs.writeFileSync(path.join(TMP, 'Ozark-POS.html'), '<html><script>/*stub for appRev*/</script></html>');
  fs.mkdirSync(path.join(TMP, 'hub-data', 'backups'), { recursive: true });
  fs.writeFileSync(path.join(TMP, 'hub-data', 'ozark-db.json'),
    JSON.stringify({ __meta: { rev: 1, savedAt: T }, db: seed }));

  /* 💳🔗 a FAKE BOLT TERMINAL on real sockets, for the terminal-lease tests below. It answers connect with a
     session key, HOLDS authCard until the test decides the outcome (that hold IS the customer standing at the
     reader), and counts every cancel — because "the hub cancelled the reader" is the exact claim under test.
     hub-server treats a 127.0.0.1 terminal host as plain http (the one narrow test carve-out; a real Bolt is
     always a remote TLS host). */
  const boltState = { cancels: 0, pending: null, connects: 0, lastBody: null, cancelKeepsPending: false };
  const boltSrv = require('http').createServer((rq2, rs2) => {
    let b2 = ''; rq2.on('data', c => b2 += c); rq2.on('end', () => {
      if (rq2.url === '/api/v2/connect') { boltState.connects++; rs2.writeHead(200, { 'x-cardconnect-sessionkey': 'SKTEST;expires=' + new Date(Date.now() + 540000).toUTCString(), 'content-type': 'application/json' }); rs2.end('{}'); return; }
      if (rq2.url === '/api/v4/authCard') { try { boltState.lastBody = JSON.parse(b2); } catch (e) { boltState.lastBody = null; } boltState.pending = rs2; return; }   // held until boltAnswer()
      if (rq2.url === '/api/v2/cancel') { boltState.cancels++;
        if (boltState.pending && !boltState.cancelKeepsPending) { const p = boltState.pending; boltState.pending = null; p.writeHead(200, { 'content-type': 'application/json' }); p.end(JSON.stringify({ errorCode: 8, errorMessage: 'Terminal cancelled' })); }
        rs2.writeHead(200, { 'content-type': 'application/json' }); rs2.end('{}'); return; }
      rs2.writeHead(404); rs2.end('{}');
    });
  });
  await new Promise(r => boltSrv.listen(0, '127.0.0.1', r));
  const BOLTPORT = boltSrv.address().port;
  const boltAnswer = (json) => { const p = boltState.pending; boltState.pending = null; if (!p) return false; p.writeHead(200, { 'content-type': 'application/json' }); p.end(JSON.stringify(json)); return true; };

  /* a REAL fake CardPointe GATEWAY on a real socket (the refund-idempotency tests, 8/28) — same pattern as
     the fake Bolt terminal above. Counts every refund that actually reaches the "processor", which is the
     number an idempotent replay must NOT move. */
  const gwState = { refunds: 0, hold: null, auths: 0, orders: {}, inquiries: 0, voidsByOrder: 0, down: false, hangs: [] };
  const gwSrv = require('http').createServer((rq2, rs2) => {
    let b = ''; rq2.on('data', c => b += c); rq2.on('end', () => {
      /* 💳🔎 CardPointe's lookup + void by order id (2026-09-23) — the fake keeps an order book the tests can seed */
      if (rq2.url.indexOf('/cardconnect/rest/inquireByOrderid/') === 0 || rq2.url.indexOf('/cardconnect/rest/inquireByOrderId/') === 0) { gwState.inquiries++;
        if (gwState.down) { rs2.writeHead(503); rs2.end(''); return; }
        const oid = decodeURIComponent(rq2.url.split('/')[4] || ''); const o = gwState.orders[oid];
        rs2.writeHead(200, { 'content-type': 'application/json' });
        rs2.end(JSON.stringify(o ? { respstat: o.respstat, respcode: o.respstat === 'A' ? '000' : '05', resptext: o.respstat === 'A' ? 'Approval' : 'Do not honor', retref: o.retref, authcode: 'IQ' + o.retref, amount: o.amount, account: '9999999999994242', setlstat: o.voided ? 'Voided' : 'Queued for Capture' }
                                 : { respstat: 'C', respcode: '29', resptext: 'Txn not found' })); return; }
      if (rq2.url === '/cardconnect/rest/voidByOrderId') { gwState.voidsByOrder++;
        if (gwState.down) { rs2.writeHead(503); rs2.end(''); return; }
        let jv = {}; try { jv = JSON.parse(b); } catch (e) {} const o = gwState.orders[jv.orderid];
        rs2.writeHead(200, { 'content-type': 'application/json' });
        if (!o) { rs2.end(JSON.stringify({ respstat: 'C', respcode: '29', resptext: 'Txn not found' })); return; }
        o.voided = true; rs2.end(JSON.stringify({ respstat: 'A', respcode: '000', resptext: 'Approval', retref: o.retref, amount: '0.00' })); return; }
      if (rq2.url === '/cardconnect/rest/auth') { gwState.auths++; let ja = {}; try { ja = JSON.parse(b); } catch (e) {}
        if (String(ja.account||'').indexOf('HANG') >= 0) { gwState.orders[ja.orderid] = { respstat: 'A', retref: 'AUTHHANG' + gwState.auths, amount: ja.amount || '0.00' }; gwState.hangs.push(rs2); return; }   // CardPointe charged it; the answer never comes back
        const dec = String(ja.account||'').indexOf('DECLINE') >= 0;
        rs2.writeHead(200, { 'content-type': 'application/json' });
        rs2.end(JSON.stringify(dec ? { respstat: 'C', respcode: '05', resptext: 'Do not honor', retref: 'AUTHD' + gwState.auths, amount: ja.amount || '0.00', account: '9999999999991111' }
                                   : { respstat: 'A', respcode: '000', resptext: 'Approval', retref: 'AUTH' + gwState.auths, authcode: 'PA' + gwState.auths, amount: ja.amount || '0.00', account: '9999999999994242' })); return; }
      if (rq2.url === '/cardconnect/rest/refund') { gwState.refunds++;
        let j = {}; try { j = JSON.parse(b); } catch (e) {}
        if (j.retref === 'GWHOLD') { gwState.hold = rs2; return; }              /* held → an in-flight refund */
        rs2.writeHead(200, { 'content-type': 'application/json' });
        rs2.end(JSON.stringify({ respstat: 'A', retref: 'RFND' + gwState.refunds, authcode: 'RA' + gwState.refunds, amount: j.amount || '0.00', resptext: 'Approval' })); return; }
      rs2.writeHead(404); rs2.end('{}');
    });
  });
  await new Promise(r => gwSrv.listen(0, '127.0.0.1', r));
  const GWPORT = gwSrv.address().port;

  /* a REAL fake INTUIT (QuickBooks) on a real socket — the QBO read-only tests. Answers the OAuth token
     exchange + refresh and one ProfitAndLoss report. ⚠️ The FIRST access token it hands out is already expired
     (expires_in:1) so the very next API call MUST refresh — which is how the test proves auto-refresh happens
     with nobody reconnecting. Counts refreshes; routes by URL path (same host serves token + api, like Intuit). */
  const qboState = { tokenCalls: 0, refreshes: 0 };
  const qboSrv = require('http').createServer((rq3, rs3) => {
    let b3 = ''; rq3.on('data', c => b3 += c); rq3.on('end', () => {
      if (rq3.url.indexOf('/oauth2/v1/tokens/bearer') === 0) { qboState.tokenCalls++;
        const isRefresh = /grant_type=refresh_token/.test(b3); if (isRefresh) qboState.refreshes++;
        rs3.writeHead(200, { 'content-type':'application/json' });
        rs3.end(JSON.stringify({ access_token:'ACCESS'+qboState.tokenCalls, refresh_token:'REFRESH'+qboState.tokenCalls,
          token_type:'bearer', expires_in: isRefresh ? 3600 : 1, x_refresh_token_expires_in: 8726400 })); return; }
      if (rq3.url.indexOf('/reports/ProfitAndLoss') >= 0) {
        rs3.writeHead(200, { 'content-type':'application/json' });
        rs3.end(JSON.stringify({ Header:{ ReportName:'ProfitAndLoss' }, Rows:{ Row:[
          { group:'Income',    Summary:{ ColData:[{value:'Total Income'},   {value:'5000.00'}] } },
          { group:'Expenses',  Summary:{ ColData:[{value:'Total Expenses'}, {value:'3000.00'}] } },
          { group:'NetIncome', Summary:{ ColData:[{value:'Net Income'},     {value:'2000.00'}] } }
        ] } })); return; }
      rs3.writeHead(404); rs3.end('{}');
    });
  });
  await new Promise(r => qboSrv.listen(0, '127.0.0.1', r));
  const QBOPORT = qboSrv.address().port;

  /* a REAL fake CardConnect FUNDING (fts) service — the read-only settlement tests. Answers
     GET /cardconnect/rest/funding?date=MMDD&merchid=X in the REAL response shape (confirmed against a live pull on
     2026-09-16, the day CardPointe enabled "Deposit Data from Processor"): a funding day on 0902 per MID, an empty
     day otherwise. The deposit row is identical for both MIDs (10.00 sales, -0.30 interchange, 9.70 funded) so the
     totals prove day-iteration and the per-store split; the txns[] differ per MID so the transaction-level
     reconcile can prove a MATCH, an ORPHAN and a DOUBLE:
       FUNDMID1: 900000000001 ••1111 $10.00  (matches the seeded POS payment FUNDP1)
                 900000000003 + 900000000004 ••3333 $4.44 each  (a settled double — the terminal double-tap class)
       FUNDMID2: 900000000002 ••2222 $5.00   (no POS payment — an orphan) */
  const ftsSrv = require('http').createServer((rqf, rsf) => { rqf.on('data', () => {}); rqf.on('end', () => {
    if (rqf.url.indexOf('/cardconnect/rest/funding') === 0) {
      const m = /[?&]date=(\d{4})/.exec(rqf.url); const date = m ? m[1] : '';
      const mm = /[?&]merchid=([^&]+)/.exec(rqf.url); const mid = mm ? decodeURIComponent(mm[1]) : '';
      rsf.writeHead(200, { 'content-type':'application/json' });
      if (date === '0902') {
        const txn = (retref, last4, amount) => ({ retref, cardnumber:'44XXXXXXXXXX' + last4, cardbrand:'Visa', cardtype:'Credit', authcode:'000000', authdate:'20260902', respcode:'000', status:'Processed', amount:String(amount), currency:'USD', invoicenumber:retref, fundingid:'1' });
        const txns = (mid === 'FUNDMID2') ? [ txn('900000000002', '2222', '5.00') ]
                                          : [ txn('900000000001', '1111', '10.00'), txn('900000000003', '3333', '4.44'), txn('900000000004', '3333', '4.44'),
                                              txn('900000000005', '4444', '6.00'), txn('900000000006', '4444', '6.00') ];   // two EQUAL-PRICED BAGS on two sibling orders — NOT a double
        rsf.end(JSON.stringify({ fundingmasterid:1, merchid:mid, fundingdate:'2026-09-02',
          fundings:[ { fundingmasterid:1, fundingid:1, netsales:'10.00', thirdparty:'0', adjustment:'0', interchangefee:'-0.30', servicecharge:'0', fee:'0', reversal:'0', otheradjustment:'0', totalfunding:'9.70', currency:'USD', dateadded:'2026-09-03', datechanged:'2026-09-03' } ],
          adjustments:[], chargebacks:[], txns:txns }));
      }
      else rsf.end(JSON.stringify({ errormsg:'No deposits match your request' }));   // CardConnect's real "no settlement that day" reply
      return; }
    rsf.writeHead(404); rsf.end('{}');
  }); });
  await new Promise(r => ftsSrv.listen(0, '127.0.0.1', r));
  const FTSPORT = ftsSrv.address().port;

  /* 🗺️ a fake OpenStreetMap/Nominatim so the address-autocomplete proxy is tested without hitting the internet:
     a "pine" query returns one canned jsonv2 place, anything else an empty array. */
  const geoSrv = require('http').createServer((rqg, rsg) => { rqg.on('data', () => {}); rqg.on('end', () => {
    if (rqg.url.indexOf('/search') === 0) { rsg.writeHead(200, { 'content-type':'application/json' });
      if (/main/i.test(rqg.url)) rsg.end(JSON.stringify([{ display_name:'100, Main Street, Arkadelphia, Clark County, Arkansas, 71923, United States',
        address:{ house_number:'100', road:'Main Street', city:'Arkadelphia', county:'Clark County', state:'Arkansas', postcode:'71923' } }]));
      else rsg.end('[]');
      return; }
    rsg.writeHead(404); rsg.end('[]');
  }); });
  await new Promise(r => geoSrv.listen(0, '127.0.0.1', r));
  const GEOPORT = geoSrv.address().port;

  const mkEnv = p => Object.assign({}, process.env, { OZARK_PORT: String(p), OZARK_HUB_KEY: KEY, OZARK_HUB_READ_KEY: READKEY,
      OZARK_CKPT_REVS: '4', OZARK_CKPT_MS: String(24*3600*1000),
      OZARK_DROPBOX_KEY: 'dropbox-test-key',   /* 📦 the box's OWN credential — never the hub key */
      OZARK_RESV_TTL_MS: '700',
      OZARK_FULLPULL_GAP_MS: '1200',   /* 🚦 full pulls are paced one station at a time; long enough here to prove the queue, short enough not to slow the suite */   /* 🔒 short customer-reservation TTL so the auto-expiry (crashed-holder release) is testable without a 45s sleep */
      /* the fake terminal + dummy gateway creds so the cardpointe branch is reachable; nothing in this suite
         ever calls the real gateway (the fake authCard answers with respstat directly, so no fallback fires) */
      OZARK_CPTERM_HOST: '127.0.0.1:' + BOLTPORT, OZARK_CPTERM_HSN: 'HSNTEST', OZARK_CPTERM_MID: 'MIDTEST', OZARK_CPTERM_AUTHKEY: 'AKTEST',
      OZARK_CARDPOINTE_SITE: 'testsite', OZARK_CARDPOINTE_MID: 'MIDTEST', OZARK_CARDPOINTE_USER: 'u', OZARK_CARDPOINTE_PASS: 'p',
      OZARK_CARDPOINTE_HOST: '127.0.0.1:' + GWPORT,
      OZARK_CPTERM_AUTH_TIMEOUT_MS: '3000', OZARK_CP_AUTH_TIMEOUT_MS: '1500', OZARK_CP_RESOLVE_MS: '30,30,30',   /* 💳🔎 CardPointe's rules, on test-sized clocks */
      /* 📗 QuickBooks read-only, pointed at the fake Intuit above; hosts overridden so no call leaves the box */
      OZARK_QBO_CLIENT_ID: 'qbclient', OZARK_QBO_CLIENT_SECRET: 'qbsecret', OZARK_QBO_ENV: 'production',
      OZARK_QBO_REDIRECT: 'https://hub.example.com/api/qb/callback', OZARK_QBO_AUTH_HOST: 'appcenter.example',
      OZARK_QBO_TOKEN_HOST: '127.0.0.1:' + QBOPORT, OZARK_QBO_API_HOST: '127.0.0.1:' + QBOPORT,
      /* 💳🏦 CardPointe funding read-only, pointed at the fake fts above; funding creds REUSE the gateway
         user/pass (customer-level, as CardConnect confirmed), only the MIDs + host are funding-specific */
      OZARK_GEO_HOST: '127.0.0.1:' + GEOPORT,   /* 🗺️ address autocomplete → the fake Nominatim above, never the internet */
      OZARK_CPFUND_HOST: '127.0.0.1:' + FTSPORT, OZARK_CPFUND_ENV: 'prod',
      OZARK_CPFUND_MID_1: 'FUNDMID1', OZARK_CPFUND_MID_2: 'FUNDMID2' });   /* gateway calls land on the fake above, never the internet · checkpoint every 4th rev, never on the clock */
  /* 🔁 start the hub, RETRYING on a fresh port if it can't bind / doesn't come up — closes the port race that
     used to fail the whole suite at random under deploy load (a gate that cries wolf trains people to ignore it). */
  let booted = null, log = '';
  for (let attempt = 0; attempt < 4 && !booted; attempt++) {
    if (attempt > 0) { try { child.kill('SIGKILL'); } catch (e) {} PORT = pickFreePort(); await sleep(150); }
    let exited = false;
    child = spawn(process.execPath, ['hub-server.js'], { cwd: TMP, stdio: ['ignore', 'pipe', 'pipe'], env: mkEnv(PORT) });
    log = ''; child.stdout.on('data', d => log += d); child.stderr.on('data', d => log += d);
    child.on('exit', () => { exited = true; });   /* hub died (e.g. EADDRINUSE) → stop waiting, retry a fresh port */
    for (let i = 0; i < 60 && !exited; i++) { try { const h = await req('GET', '/api/health', undefined, 'boot', null);
      if (h.json && h.json.ok) { booted = h.json; break; } } catch (e) {} await sleep(100); }
  }
  /* ⚠️ PROVE IT IS OUR HUB. `ok:true` alone is not proof — plenty of local services answer something. If a
     stranger is on this port, say so instead of running 200 assertions against its JSON. */
  if (!booted || booted.keyConfigured === undefined) {
    console.error('\n⛔ nothing recognisable as the Ozark hub came up after 4 tries (last port ' + PORT + ').\n' +
      '   got: ' + JSON.stringify(booted).slice(0, 200) + '\n   hub log tail: ' + log.slice(-300));
    cleanup(); process.exit(1);
  }

  console.log('── hub harness (real server, port ' + PORT + ', temp dir) ──\n');

  console.log('— it starts and answers —');
  const health = await req('GET', '/api/health', undefined, 'boot', null);
  check('health responds ok:true', !!(health.json && health.json.ok), health.json);
  check('it reports a key IS configured', health.json && health.json.keyConfigured === true);
  check('it reports an app build', !!(health.json && health.json.appRev));

  console.log('\n— the key gate fails CLOSED —');
  check('no key at all → 401',   (await req('GET', '/api/db', undefined, 'd', null)).status === 401);
  check('a wrong key → 401',     (await req('GET', '/api/db', undefined, 'd', 'nope')).status === 401);
  const good = await req('GET', '/api/db');
  check('the right key → 200 with a db', good.status === 200 && !!good.json.db);

  console.log('\n— 🔑👁 the READ-ONLY key (E85, 9/26): the five reads the v2 copy makes, and nothing else —');
  const rkDb = await req('GET', '/api/db', undefined, 'v2-shadow-feed', READKEY);
  check('the read key reads the database (GET /api/db → 200 with a db)', rkDb.status === 200 && !!(rkDb.json && rkDb.json.db), rkDb.status);
  for (const p of ['/api/sms/optout', '/api/sms/messages', '/api/pickup', '/api/feedback']) {
    const r = await req('GET', p, undefined, 'v2-shadow-feed', READKEY);
    check('the read key reads ' + p, r.status === 200 && !!(r.json && r.json.ok), r.status);
  }
  const rev0 = rkDb.json && rkDb.json.rev;
  const rkPush = await req('POST', '/api/db', { db: seed, baseRev: rev0 }, 'v2-shadow-feed', READKEY);
  check('the read key can NOT write the database (POST /api/db → 401)', rkPush.status === 401, rkPush.status);
  check('...and nothing moved: the revision is the same', ((await req('GET', '/api/db')).json || {}).rev === rev0);
  for (const [m, p] of [['GET', '/api/sms/log?all=1'], ['GET', '/api/card-log'], ['GET', '/api/trail'], ['POST', '/api/sms'], ['POST', '/api/email'], ['POST', '/api/reload-all']]) {
    const r = await req(m, p, m === 'POST' ? { by: 'x' } : undefined, 'v2-shadow-feed', READKEY);
    check('the read key opens nothing else: ' + m + ' ' + p + ' → 401', r.status === 401, r.status);
  }
  { const hs = fs.readFileSync(path.join(__dirname, 'hub-server.js'), 'utf8'), g = hs.slice(hs.indexOf('function reqReadKeyOk(req){'), hs.indexOf('function keyErr(){'));
    check('the read key is refused when it equals the full key, is short, or the request is not a GET (source)', g.indexOf("req.method !== 'GET'") > 0 && g.indexOf('HUBREADKEY.length < 24') > 0 && g.indexOf('HUBREADKEY === HUBKEY') > 0);
    check('exactly five routes take the read key (the v2 copy\'s reads)', (hs.match(/if \(!reqReadKeyOk\(req\)\)/g) || []).length === 5); }

  console.log('\n— a stale push is rejected, not merged blindly —');
  check('a wrong baseRev → 409', (await req('POST', '/api/db', { db: seed, baseRev: 999999 })).status === 409);
  check('a missing baseRev → 409', (await req('POST', '/api/db', { db: seed })).status === 409);

  console.log('\n— THE BIG ONE: a push cannot delete what it does not know about —');
  let cur = await req('GET', '/api/db');
  const oldBuild = JSON.parse(JSON.stringify(cur.json.db));
  delete oldBuild.collections;                 // a build that predates the feature
  oldBuild._tomb = [];                         // …and predates tombstones
  oldBuild.customers = oldBuild.customers.filter(c => c.id !== 'c2');   // dropped a customer it never saw
  oldBuild.payments = [];                                                // and every payment
  const p1 = await req('POST', '/api/db', { db: oldBuild, baseRev: cur.json.rev });
  check('the push is accepted (the shop keeps working)', p1.status === 200, p1.json);
  let after = (await req('GET', '/api/db')).json.db;
  check('collections SURVIVED',            (after.collections || []).length === 1, after.collections);
  check('tombstones SURVIVED',             (after._tomb || []).length === 1);
  check('the dropped customer SURVIVED',   (after.customers || []).some(c => c.id === 'c2'));
  check('the dropped payment SURVIVED',    (after.payments || []).length === 1);

  console.log('\n— the one-way law, enforced server-side —');
  cur = await req('GET', '/api/db');
  const rollback = JSON.parse(JSON.stringify(cur.json.db));
  rollback.orders.find(o => o.id === 'o1').status = 'Detailed';
  rollback.orders.find(o => o.id === 'o1').paymentStatus = 'unpaid';
  rollback.orders.find(o => o.id === 'o1')._t = Date.now() * 1000;      // NEWEST stamp, still must lose
  await req('POST', '/api/db', { db: rollback, baseRev: cur.json.rev });
  after = (await req('GET', '/api/db')).json.db;
  const o1 = after.orders.find(o => o.id === 'o1');
  check('a delivered order cannot be rolled back by a newer stamp', o1.status === 'PickedUp', o1);
  check('…and its paid status held',                                 o1.paymentStatus === 'paid');

  cur = await req('GET', '/api/db');
  const deliberate = JSON.parse(JSON.stringify(cur.json.db));
  const tgt = deliberate.orders.find(o => o.id === 'o1');
  tgt.status = 'In Process'; tgt._t = 2; tgt.backToProcess = { at: Date.now() * 1000, by: 'Owner' };
  await req('POST', '/api/db', { db: deliberate, baseRev: cur.json.rev });
  after = (await req('GET', '/api/db')).json.db;
  check('a DELIBERATE back-into-process IS allowed through',
        after.orders.find(o => o.id === 'o1').status === 'In Process');

  console.log('\n— ↩ a push that LOSES the merge gets the winner back on the receipt (2026-09-03) —');
  /* the winner's _seq is older than the pusher's watermark, so no delta would ever deliver the correction —
     the losing station stayed stale until a heal full-pull and the counters lived at ~20 drifts a day. */
  cur = await req('GET', '/api/db');
  const winNow = cur.json.db.orders.find(o => o.id === 'o1');
  const loser = JSON.parse(JSON.stringify(winNow));
  loser.rackLoc = 'STALE-9'; loser._t = 1;                       // ancient stamp, different bytes → must lose
  let pc = await req('POST', '/api/db', { db: { orders: [loser] }, delta: true, baseRev: cur.json.rev });
  check('the losing push still lands 200', pc.status === 200, pc.json);
  check('…and the receipt carries the WINNING record for what it lost',
        !!(pc.json.conflicts && (pc.json.conflicts.orders || []).some(o => o.id === 'o1' && o.rackLoc !== 'STALE-9')), pc.json.conflicts);
  cur = await req('GET', '/api/db');
  const freshWin = JSON.parse(JSON.stringify(cur.json.db.orders.find(o => o.id === 'o1')));
  freshWin.rackLoc = 'W-77'; freshWin._t = Date.now() * 1000;
  pc = await req('POST', '/api/db', { db: { orders: [freshWin] }, delta: true, baseRev: cur.json.rev });
  check('a push that WINS carries no conflicts field at all', pc.status === 200 && pc.json.conflicts === undefined, pc.json.conflicts);

  console.log('\n— 🔬 mirror-deep names what differs (2026-09-04: two hours of drift with no record name) —');
  const dpAll = await req('POST', '/api/mirror-deep', { rev: 1, coll: 'orders', fps: { ZZZ: { h: 1, t: 2, q: 3 } } });
  check('a probe answers with the differ count — hub-only rows AND station-only rows both counted',
        dpAll.status === 200 && dpAll.json.ok === true && dpAll.json.differs >= 2, dpAll.json);
  check('an unknown collection is refused, never guessed',
        (await req('POST', '/api/mirror-deep', { rev: 1, coll: 'nope', fps: {} })).json.ok === false);

  console.log('\n— order numbers can never be reused —');
  cur = await req('GET', '/api/db');
  const lowSeq = JSON.parse(JSON.stringify(cur.json.db));
  lowSeq.settings = Object.assign({}, lowSeq.settings, { seq: { '1': 2 }, _t: Date.now() * 1000 });
  await req('POST', '/api/db', { db: lowSeq, baseRev: cur.json.rev });
  after = (await req('GET', '/api/db')).json.db;
  check('settings.seq takes the MAX, never the lower value', (after.settings.seq['1']) === 5, after.settings.seq);

  console.log('\n— stale-build detection —');
  cur = await req('GET', '/api/db');
  const ancient = JSON.parse(JSON.stringify(cur.json.db));
  delete ancient.collections;
  await req('POST', '/api/db', { db: ancient, baseRev: cur.json.rev }, 'TEST-DEV');
  after = (await req('GET', '/api/db')).json.db;
  let dev = (after.devices || []).find(d => d.name === 'TEST-DEV');
  check('a push missing a whole feature is flagged as an OLD BUILD', !!(dev && dev.oldBuild), dev);
  check('…and says why',  !!(dev && /predates the feature/.test(dev.oldBuildWhy || '')));
  check('…and records when the hub last saw it push', !!(dev && dev.hubPushAt));

  cur = await req('GET', '/api/db');
  const behind = JSON.parse(JSON.stringify(cur.json.db));
  behind.devices.find(d => d.name === 'TEST-DEV').appRev = 'some-newer1';   // reports a build, just not the newest
  await req('POST', '/api/db', { db: behind, baseRev: cur.json.rev }, 'TEST-DEV');
  after = (await req('GET', '/api/db')).json.db;
  dev = (after.devices || []).find(d => d.name === 'TEST-DEV');
  check('a station merely BEHIND a fresh deploy is NOT alarmed (45-min grace)', !dev.oldBuild, dev && dev.oldBuildWhy);
  check('…but it is marked as updating',  !!dev.updatingSince);

  console.log('\n— it keeps backups —');
  // snapshot filenames are stamped to the second, so a burst of test saves collapses into one file —
  // what matters is that a RESTORABLE snapshot exists and parses, not how many
  const bakDir = path.join(TMP, 'hub-data', 'backups');
  const baks = fs.readdirSync(bakDir).filter(f => f.endsWith('.json'));
  check('a timestamped snapshot was written', baks.length >= 1, baks.length);
  let snapOk = false;
  try { const s = JSON.parse(fs.readFileSync(path.join(bakDir, baks[baks.length - 1]), 'utf8'));
        snapOk = !!(s.db && s.db.orders && s.db.customers && s.__meta && s.__meta.rev); } catch (e) {}
  check('…and it is a complete, restorable database', snapOk);
  check('a .bak of the previous version exists', fs.existsSync(path.join(TMP, 'hub-data', 'ozark-db.bak.json')));

  console.log('\n— an empty array is NOT mistaken for old code (false-alarm guard) —');
  cur = await req('GET', '/api/db');
  const sparse = JSON.parse(JSON.stringify(cur.json.db));
  delete sparse.timeOff; delete sparse.refundRequests;   // hub has none of these either → means nothing
  sparse.devices.find(d => d.name === 'TEST-DEV').appRev = (await req('GET', '/api/health', undefined, 'x', null)).json.appRev;
  await req('POST', '/api/db', { db: sparse, baseRev: cur.json.rev }, 'TEST-DEV');
  after = (await req('GET', '/api/db')).json.db;
  dev = (after.devices || []).find(d => d.name === 'TEST-DEV');
  check('omitting an EMPTY collection does not flag a healthy station', !dev.oldBuild, dev && dev.oldBuildWhy);

  console.log('\n— nothing was corrupted along the way —');
  after = (await req('GET', '/api/db')).json.db;
  check('customers intact', (after.customers || []).length === 2);
  check('orders intact',    (after.orders || []).length === 2);
  check('payments intact',  (after.payments || []).length === 1);
  check('the db still looks like a db', !!(after.settings && after.orders && after.customers && after.prices));

  /* 📜 THE PERMANENT ORDER TRAIL — owner, 2026-08-06: "a POS system is at its core, just an event log."
     hub-server diffs what it held against what it merged and appends every order state change to
     order-history.jsonl, OUTSIDE the synced DB so no merge or rollback can rewrite it. This file is the
     replay source the 8/3 incident did not have. Uses its own fresh order so no earlier test's leftovers
     (a stale backToProcess in particular) can decide the outcome. */
  console.log('\n— the permanent order trail —');
  const HF = path.join(TMP, 'hub-data', 'order-history.jsonl');
  const readTrail = n => fs.existsSync(HF)
    ? fs.readFileSync(HF, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)).filter(r => !n || r.num === n)
    : [];
  const trNum = 'TRAIL-1';
  let tc = await req('GET', '/api/db'); let odb = tc.json.db;
  odb.orders.push({ id:'oTRAIL', number:trNum, customerId:odb.customers[0].id, storeId:1, status:'Detailed',
    paymentStatus:'unpaid', rackLoc:'', splits:[], lines:[{ item:'S', price:9 }], _t: Date.now() * 1000 });
  await req('POST', '/api/db', { db: odb, baseRev: tc.json.rev });
  check('order-history.jsonl exists after a push', fs.existsSync(HF));
  check('a brand-new order is recorded as created', readTrail(trNum).some(r => r.ev === 'created' && r.to === 'Detailed'));

  tc = await req('GET', '/api/db'); odb = tc.json.db;
  let t1 = odb.orders.find(o => o.number === trNum);
  t1.status = 'Ready'; t1.rackLoc = '#77'; t1.paymentStatus = 'paid'; t1._t = Date.now() * 1000 + 10;
  await req('POST', '/api/db', { db: odb, baseRev: tc.json.rev });
  const st = readTrail(trNum).filter(r => r.ev === 'status').pop();
  check('the status change was recorded', !!st && st.from === 'Detailed' && st.to === 'Ready');
  check('...the rack move was recorded', readTrail(trNum).some(r => r.ev === 'rack' && r.to === '#77'));
  check('...the payment-status change was recorded (10 paid orders flipped unpaid on 8/3)',
    readTrail(trNum).some(r => r.ev === 'pay' && r.from === 'unpaid' && r.to === 'paid'));
  check('...each event names the device and the revision', !!st && st.dev === 'TEST-DEV' && st.rev > 0);
  check('a forward move is NOT flagged as backwards', !!st && !st.back);

  /* the move that is supposed to be impossible must be impossible to miss */
  tc = await req('GET', '/api/db'); odb = tc.json.db;
  let t2 = odb.orders.find(o => o.number === trNum);
  t2.status = 'In Process'; t2.backToProcess = { at: Date.now() * 1000 + 999, by:'test' }; t2._t = Date.now() * 1000 + 20;
  await req('POST', '/api/db', { db: odb, baseRev: tc.json.rev });
  const bk = readTrail(trNum).filter(r => r.ev === 'status').pop();
  check('a BACKWARDS status move is recorded and flagged', !!bk && bk.to === 'In Process' && bk.back === 1);

  /* the whole point: the trail must survive what the synced DB does not */
  const trBefore = readTrail().length;
  tc = await req('GET', '/api/db'); odb = tc.json.db;
  odb.orders = [];                                        // a stale device pushing an empty orders array
  await req('POST', '/api/db', { db: odb, baseRev: tc.json.rev });
  check('a push that drops every order cannot shrink the trail', readTrail().length >= trBefore);
  check('...and the orders themselves were kept anyway (absence is never a delete)',
    ((await req('GET', '/api/db')).json.db.orders || []).length > 0);

  /* ⚠️ A STATION MUST BE ABLE TO REPORT ITS OWN BUILD, FOREVER.
     markPushingDevice used to bump the device record's _t above every other record on every push, so the
     hub's copy always won the merge and the station's self-reported appRev froze at whatever it was the day
     the detector shipped. Hot Springs was reported "stuck" for three days while pushing every few seconds
     and doing a full route — the alarm was reading a field its own code had frozen. */
  console.log('\n— a station can always update its own build —');
  let dcur = await req('GET', '/api/db'); let ddb = dcur.json.db;
  ddb.devices = [{ id:'TEST-DEV', name:'TEST-DEV', appRev:'OLDBUILD', lastSeen: Date.now()-99999, _t: 1 }];
  await req('POST', '/api/db', { db: ddb, baseRev: dcur.json.rev });
  let dv = (await req('GET', '/api/db')).json.db.devices.find(x => x.id === 'TEST-DEV');
  check('the hub records the build a station reports', !!dv && dv.appRev === 'OLDBUILD');
  check('…and annotates when it last pushed', !!dv && !!dv.hubPushAt);

  /* now the station updates — exactly what happens when the owner closes and reopens the app */
  dcur = await req('GET', '/api/db'); ddb = dcur.json.db;
  const mine = ddb.devices.find(x => x.id === 'TEST-DEV');
  mine.appRev = 'NEWBUILD'; mine.lastSeen = Date.now();
  await req('POST', '/api/db', { db: ddb, baseRev: dcur.json.rev });
  dv = (await req('GET', '/api/db')).json.db.devices.find(x => x.id === 'TEST-DEV');
  check('a REOPENED station\'s new build is accepted, not overwritten by the hub', !!dv && dv.appRev === 'NEWBUILD');
  check('…and lastSeen moves forward with it', !!dv && (Date.now() - (dv.lastSeen || 0)) < 60000);

  /* and it must still be able to say so even when its own copy of the record is older than the hub's */
  dcur = await req('GET', '/api/db'); ddb = dcur.json.db;
  const stale = ddb.devices.find(x => x.id === 'TEST-DEV');
  stale.appRev = 'NEWEST'; stale._t = 1;                      // a device whose _t lost the last merge
  await req('POST', '/api/db', { db: ddb, baseRev: dcur.json.rev });
  dv = (await req('GET', '/api/db')).json.db.devices.find(x => x.id === 'TEST-DEV');
  check('…even when the hub copy outranks it on _t (the exact freeze that hid Hot Springs)',
    !!dv && dv.appRev === 'NEWEST');


  /* ───────────── 🪞 THE MIRROR ─────────────
     Owner, 2026-08-08: "the hub is like a set of mirrors that can make the information flow smoothly and
     ensure that each local copy stays identical." These assertions are what make "identical" a fact rather
     than a hope. */
  console.log('');
  console.log('— the mirror: every station provably holds the same records —');
  /* The strongest one first: ONE algorithm, two homes. A comparison between two implementations that merely
     agree today is not a comparison — it is two things that drift the first time one of them is edited. */
  function algoBlock(f){ const t = fs.readFileSync(path.join(__dirname, f), 'utf8').replace(/\r\n/g, '\n');
    const a = t.indexOf('/* <MIRROR-ALGO v1>'), b = t.indexOf('/* </MIRROR-ALGO v1> */');
    return (a < 0 || b < 0) ? null : t.slice(a, b + 23); }
  const algoApp = algoBlock('Ozark-POS.html'), algoHub = algoBlock('hub-server.js');
  check('the mirror algorithm exists in BOTH the app and the hub', !!algoApp && !!algoHub);
  check('...and is BYTE-IDENTICAL in both, so the two ends cannot silently disagree', algoApp === algoHub,
    (algoApp && algoHub) ? ('app ' + algoApp.length + ' bytes vs hub ' + algoHub.length) : '');

  /* Run the APP's copy here, so what this test computes is literally the app's own arithmetic. */
  const MA = {}; new Function('exports', algoApp + '\nexports.fp=mirrorFp; exports.drift=mirrorDrift;')(MA);

  const mcur = await req('GET', '/api/db');
  const mrev = mcur.json.rev, mdb = mcur.json.db;
  const mfp = MA.fp(mdb);
  let m = await req('POST', '/api/mirror', { rev: mrev, fps: mfp }, 'MIRROR-STATION');
  check('a station holding the same records is told it MATCHES', !!m.json && m.json.ok && m.json.known === true && m.json.match === true,
    JSON.stringify(m.json).slice(0, 200));
  check('...app and hub agree on every collection independently', ((m.json || {}).drift || []).length === 0,
    JSON.stringify((m.json || {}).drift));

  /* Drift must be NAMED. "Something is wrong somewhere" is not actionable at 7am with a counter full of people. */
  const mfpBent = JSON.parse(JSON.stringify(mfp)); mfpBent.orders.x = (mfpBent.orders.x ^ 12345) >>> 0;
  m = await req('POST', '/api/mirror', { rev: mrev, fps: mfpBent }, 'MIRROR-STATION');
  check('a station whose ORDERS differ is told exactly that', m.json.match === false && (m.json.drift || []).join() === 'orders',
    JSON.stringify(m.json.drift));
  check('...and repeats are counted, so one-off timing is not mistaken for drift', m.json.misses >= 1);

  const mfpShort = JSON.parse(JSON.stringify(mfp)); mfpShort.payments.n = mfpShort.payments.n - 1;
  m = await req('POST', '/api/mirror', { rev: mrev, fps: mfpShort }, 'MIRROR-STATION-2');
  check('a station MISSING a payment row is caught by the count alone', (m.json.drift || []).indexOf('payments') >= 0);

  /* The lesson from the bad-hub-key empty inboxes: not knowing must never render as being fine. */
  m = await req('POST', '/api/mirror', { rev: mrev + 9999, fps: mfp }, 'MIRROR-STATION-3');
  check('an unknown revision answers "I cannot compare", NOT "you match"',
    m.json.ok === true && m.json.known === false && m.json.match === undefined, JSON.stringify(m.json));

  m = await req('POST', '/api/mirror', { rev: mrev, fps: mfp }, 'MIRROR-STATION', 'wrong-key');
  check('the mirror endpoint is hub-key gated like everything else', m.status === 401);

  /* Comparing copies must never be able to CHANGE one. */
  const mAfter = await req('GET', '/api/db');
  check('checking the mirror changed nothing - no rev bump, no records touched',
    mAfter.json.rev === mrev && JSON.stringify(mAfter.json.db) === JSON.stringify(mdb));

  const mTbl = await req('GET', '/api/mirror');
  check('the owner can see every station in one place',
    mTbl.json.ok && !!mTbl.json.stations['MIRROR-STATION'] && !!mTbl.json.stations['MIRROR-STATION-2']);
  check('...each row says which revision it was judged at', mTbl.json.stations['MIRROR-STATION-2'].rev === mrev);

  /* A NEW revision must get its own fingerprint, or the mirror would compare against a stale picture and call
     every station drifted the moment anybody saved anything. */
  const g2 = await req('GET', '/api/db');
  const db2 = g2.json.db; db2.customers.push({ id: 'MIRRORCUST', first: 'Mirror', last: 'Test', _t: T + 900 });
  await req('POST', '/api/db', { db: db2, baseRev: g2.json.rev });
  const g3 = await req('GET', '/api/db');
  m = await req('POST', '/api/mirror', { rev: g3.json.rev, fps: MA.fp(g3.json.db) }, 'MIRROR-STATION');
  check('a station that pulled the NEWEST revision still matches', m.json.known === true && m.json.match === true,
    JSON.stringify(m.json).slice(0, 200));
  m = await req('POST', '/api/mirror', { rev: g3.json.rev, fps: mfp }, 'MIRROR-STATION-4');
  check('...and a station still holding the OLD copy at that revision is caught',
    m.json.match === false && (m.json.drift || []).indexOf('customers') >= 0, JSON.stringify((m.json||{}).drift));

  /* ───────────── 📲 THE PERMANENT TEXT RECORD ─────────────
     Owner, 2026-08-10: close the gap. SMSOUT is capped at 4000 and rewritten in place on every send, so at
     real volume the record of what we told customers is barely a two-month window that silently drops the
     oldest. sms-archive.jsonl is append-only and never trimmed. Proven HERE rather than by texting a real
     customer: this hub has no Twilio configured, so every send takes the 'simulated' path — which is exactly
     the point, because the archive must record the attempt whatever the outcome. */
  console.log('');
  console.log('— the permanent text record —');
  const SMSF = path.join(TMP, 'hub-data', 'sms-archive.jsonl');
  check('nothing is archived before anything is sent', !fs.existsSync(SMSF));

  let sm = await req('POST', '/api/sms', { to:'8705551234', body:'Your shirts are ready for pickup.', kind:'ready' });
  check('a send is accepted', sm.status === 200 && !!sm.json);
  check('sms-archive.jsonl exists the moment one text goes out', fs.existsSync(SMSF));
  let arch = fs.existsSync(SMSF) ? fs.readFileSync(SMSF, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
  check('...and it holds the number, the words, the kind and the outcome',
    arch.length === 1 && arch[0].to === '8705551234' && arch[0].body.indexOf('shirts are ready') >= 0 &&
    arch[0].kind === 'ready' && !!arch[0].status, JSON.stringify(arch[0] || {}).slice(0, 180));
  check('...including an unsent attempt, not only successes', arch.length === 1 && /simul|error|blocked|queued|sent/.test(arch[0].status));

  await req('POST', '/api/sms', { to:'5015550020', body:'Supply order for Fabriclean: Struts 500ct x3', kind:'supply-order' });
  await req('POST', '/api/sms', { to:'8705551234', body:'Second message to the same number.', kind:'ready' });
  arch = fs.readFileSync(SMSF, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
  check('every later send APPENDS — nothing is rewritten', arch.length === 3);
  check('...and the first one is still byte-for-byte where it was', arch[0].body.indexOf('shirts are ready') >= 0);

  /* 🤖 the public forms must not take a robot's word for it (owner 2026-09-22: "this is the second weird route request" —
     Google's crawler POSTed the live pickup form with our own store address). Three screens, and a real customer through. */
  const BOTUA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko; compatible; Google) Chrome/114.0.0.0 Mobile Safari/537.36';
  const picksOf = async () => ((await req('GET', '/api/pickup')).json || {}).requests || [];
  const pk0 = (await picksOf()).length;
  const b1 = await req('POST', '/api/pickup', { name:'Test Name', phone:'8705555309', address:'200 Market Street, Hot Springs', day:'Wednesday' }, null, null, { 'User-Agent': BOTUA });
  check('🤖 a crawler user-agent is answered ok and queued NOWHERE — no van is sent to an address a robot typed', b1.json && b1.json.ok === true && (await picksOf()).length === pk0, b1.raw);
  const b2 = await req('POST', '/api/pickup', { name:'Filler Bot', phone:'8705555310', address:'9 Nowhere', company:'Acme SEO' });
  check('🤖 the bait field catches a form-filler that hides its user-agent', b2.json && b2.json.ok === true && (await picksOf()).length === pk0);
  const b3 = await req('POST', '/api/pickup', { name:'Client Name', phone:'(501) 555-0123', address:'123 Main St' });
  check('🤖 a 555-01xx number — reserved for fiction, and our own placeholder — never becomes a stop', b3.json && b3.json.ok === true && (await picksOf()).length === pk0);
  const b4 = await req('POST', '/api/pickup', { name:'Real Person', phone:'8705551234', address:'9 Maple Street', day:'Wednesday' });
  const pk4 = await picksOf();
  check('🙋 ...and a REAL request still goes straight into the queue', b4.json && b4.json.ok === true && pk4.length === pk0 + 1 && pk4[0].name === 'Real Person', JSON.stringify(pk4[0] || {}));
  const fb1 = await req('POST', '/api/feedback', { name:'Test Name', phone:'8705555309', stars:5, comment:'bot' }, null, null, { 'User-Agent': BOTUA });
  const fbq = ((await req('GET', '/api/feedback')).json || {}).feedback || [];
  check('🤖 the feedback form is screened too — a crawler cannot award itself the $10 review credit', fb1.json && fb1.json.ok === true && !fbq.some(f => f.phone === '8705555309'), JSON.stringify(fbq.slice(0, 2)));
  check('🤖 ...and every drop is written down, with what tripped it', fs.existsSync(path.join(TMP, 'hub-data', 'bot-drops.jsonl')) &&
    fs.readFileSync(path.join(TMP, 'hub-data', 'bot-drops.jsonl'), 'utf8').trim().split('\n').length === 4);

  /* 📞 a call-me request (no textable line) lands in the inbox, internal, once per customer — and is NOT a text */
  const archBefore = fs.readFileSync(SMSF, 'utf8');
  const cr1 = await req('POST', '/api/sms/messages/note', { custId:'CUSTLAND', from:'(501) 555-0133', body:'Hi, this is Landa. Could you give me a call when my order is ready? Thank you!', order:'1-X-01' });
  const cr2 = await req('POST', '/api/sms/messages/note', { custId:'CUSTLAND', from:'5015550133', body:'again', order:'1-X-02' });
  const crQ = await req('GET', '/api/sms/messages');
  const crMine = ((crQ.json || {}).messages || []).filter(x => x.custId === 'CUSTLAND');
  check('📞 a call request lands in the Messages inbox, marked internal, the number cleaned', cr1.json && cr1.json.ok && crMine.length === 1 && crMine[0].internal === true && crMine[0].from === '5015550133' && crMine[0].status === 'new', JSON.stringify(crMine));
  check('📞 ...a second one for the same customer does not stack', cr2.json && cr2.json.dup === true && cr2.json.id === cr1.json.id);
  check('📞 ...and it is NOT written to the text archive — it was never a text', fs.readFileSync(SMSF, 'utf8') === archBefore);
  const crBad = await req('POST', '/api/sms/messages/note', { from:'5015550133', body:'no customer' });
  check('📞 ...a request with no customer is refused', crBad.status === 400);
  await req('POST', '/api/sms/messages/resolve', { id: cr1.json.id, by: 'test' });
  const cr3 = await req('POST', '/api/sms/messages/note', { custId:'CUSTLAND', from:'5015550133', body:'next visit', order:'1-Y-01' });
  check('📞 ...once handled (✓ Done), the next visit can raise a fresh one', cr3.json && cr3.json.ok && !cr3.json.dup && cr3.json.id !== cr1.json.id);

  let lg = await req('GET', '/api/sms/log?all=1');
  check('the archive reads back through the API', lg.json.ok && lg.json.archive === true && lg.json.exists === true);
  check('...newest first, and complete', (lg.json.messages || []).length >= 3 &&
    (lg.json.messages || [])[0].ts >= (lg.json.messages || [])[1].ts);
  check('...and it is the SAME response shape the message-log screen already reads',
    Array.isArray(lg.json.messages) && typeof lg.json.sent === 'number' && typeof lg.json.received === 'number');

  lg = await req('GET', '/api/sms/log?all=1&phone=8705551234');
  check('it can answer "did we text THIS number?"', (lg.json.messages || []).length === 2 &&
    (lg.json.messages || []).every(m => String(m.num).indexOf('8705551234') >= 0));
  lg = await req('GET', '/api/sms/log?all=1&kind=supply-order');
  check('...and "what supply orders went out?"', (lg.json.messages || []).length === 1 &&
    (lg.json.messages || [])[0].body.indexOf('Fabriclean') >= 0);

  const live = await req('GET', '/api/sms/log');
  check('the live window still works unchanged, and is NOT the archive', live.json.ok && !live.json.archive && Array.isArray(live.json.messages));
  check('the archive is hub-key gated', (await req('GET', '/api/sms/log?all=1', undefined, 'D', 'wrong')).status === 401);

  /* A customer's reply is archived too — SMSIN was capped at 1000 and rewritten just like SMSOUT. */
  const inb = await req('POST', '/api/sms/status', {});   // touch the endpoint; the real inbound path is Twilio's webhook
  const arch2 = fs.existsSync(SMSF) ? fs.readFileSync(SMSF, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
  check('the archive tags direction, so inbound and outbound can be told apart',
    arch2.every(r => r.dir === 'out' || r.dir === 'in'));
  check('...and the inbound archive hook exists on the receive path',
    fs.readFileSync(path.join(__dirname, 'hub-server.js'), 'utf8').indexOf("archiveSms(_inRec)") > 0);
  check('...and a phone filter finds a reply by the number it came FROM',
    fs.readFileSync(path.join(__dirname, 'hub-server.js'), 'utf8').indexOf('r.to || r.from') > 0);
  /* 📲 9/30: a text held for quiet hours kept its 'queued' record forever — the 8am send threw its answer away */
  { const hs = fs.readFileSync(path.join(__dirname, 'hub-server.js'), 'utf8'), fq = hs.slice(hs.indexOf('function flushQueue(){'), hs.indexOf('setInterval(flushQueue'));
    check('📲 the 8am send of a held text RECORDS what happened (sent / blocked / error), never silence', fq.indexOf('logSmsOut(m.to, m.body, m.kind, st') > 0 && fq.indexOf("'error'") > 0 && fq.indexOf('.then(function(){})') < 0, fq.length); }
  /* ───────────── 🧴 SUPPLY ORDERS MERGE LIKE EVERY OTHER RECORD ───────────── */
  console.log('');
  console.log('— supply orders are business records on the hub too —');
  const sg = await req('GET', '/api/db');
  const sdb = sg.json.db;
  sdb.supplyOrders = [{ id:'so_a', ts:T, supplier:'Fabriclean', items:[{id:'sp1',name:'Struts 500ct',qty:3}], count:1, body:'x', _t:T + 10 }];
  await req('POST', '/api/db', { db: sdb, baseRev: sg.json.rev });
  let sv = (await req('GET', '/api/db')).json;
  check('the hub keys supplyOrders, so it merges per record', (sv.db.supplyOrders || []).length === 1);
  /* The whole point of the no-delete law: a station that has never heard of the collection cannot erase it. */
  const blind = JSON.parse(JSON.stringify(sv.db)); delete blind.supplyOrders;
  await req('POST', '/api/db', { db: blind, baseRev: sv.rev }, 'OLD-BUILD');
  sv = (await req('GET', '/api/db')).json;
  check('a station whose build predates it CANNOT wipe it (absence is never a delete)',
    (sv.db.supplyOrders || []).length === 1, JSON.stringify((sv.db.supplyOrders || []).length));
  const two = JSON.parse(JSON.stringify(sv.db));
  two.supplyOrders = [{ id:'so_b', ts:T, supplier:'Cleaners Supply', items:[], count:0, body:'y', _t:T + 20 }];
  await req('POST', '/api/db', { db: two, baseRev: sv.rev }, 'OTHER-STATION');
  sv = (await req('GET', '/api/db')).json;
  check('...and two stations placing different orders end up with BOTH', (sv.db.supplyOrders || []).length === 2,
    (sv.db.supplyOrders || []).map(x => x.id).join(','));

  /* ───────────── 🔄 THE REMOTE RELOAD ───────────── */
  console.log('');
  console.log('— the hub can ask every station to update —');
  let hh = await req('GET', '/api/health');
  check('health carries the reload request, and it starts at zero', hh.json.ok && hh.json.reloadAt === 0);
  check('...on the KEYLESS endpoint every station already polls every 4s',
    (await req('GET', '/api/health', undefined, 'D', null)).json.ok === true);

  const rq = await req('POST', '/api/reload-all', { by:'Owner' });
  check('the owner can ask for it', rq.status === 200 && rq.json.ok && rq.json.at > 0);
  hh = await req('GET', '/api/health');
  check('...and every station sees it on its very next poll', hh.json.reloadAt === rq.json.at);
  check('asking for it is hub-key gated', (await req('POST', '/api/reload-all', { by:'X' }, 'D', 'wrong')).status === 401);
  check('...while merely READING it needs no key, like the rest of health',
    (await req('GET', '/api/health', undefined, 'D', null)).json.reloadAt === rq.json.at);

  /* It must survive a hub restart, or a station mid-reload would lose the request. And it must be a bare
     timestamp: a station compares it against when its own page loaded, so the same value read forever is
     harmless — which is exactly why it cannot loop. */
  const rf = path.join(TMP, 'hub-data', 'reload-request.json');
  check('the request is kept on disk, outside the synced DB', fs.existsSync(rf));
  const saved = JSON.parse(fs.readFileSync(rf, 'utf8'));
  check('...with who asked and when', saved.at === rq.json.at && saved.by === 'Owner');
  const dbNow = (await req('GET', '/api/db')).json.db;
  check('...and NOWHERE in the synced database, so an old station cannot wipe it',
    JSON.stringify(dbNow).indexOf('reload-request') < 0 && dbNow.reloadAt === undefined);

  /* the page's own age rides up on the push, so a stale station can be described rather than inferred */
  const pg = await req('GET', '/api/db');
  const pdb = pg.json.db;
  const pdev = (pdb.devices || []).find(x => x.id === 'TEST-DEV') || (pdb.devices = pdb.devices || []).push({ id:'TEST-DEV', name:'T', _t:T }) && pdb.devices.find(x => x.id === 'TEST-DEV');
  pdev.pageAt = T - 5 * 24 * 3600000; pdev.appRev = 'OLDBUILD'; pdev._t = T + 5000;
  await req('POST', '/api/db', { db: pdb, baseRev: pg.json.rev });
  const pv = (await req('GET', '/api/db')).json.db.devices.find(x => x.id === 'TEST-DEV');
  check('the hub keeps when a station\'s PAGE was loaded', !!pv && pv.pageAt === T - 5 * 24 * 3600000);

  /* ───────────── 🐾 THE TRAIL ─────────────
     Owner: "which button was clicked from home, and who was searched, who was clicked, and what was clicked…
     it's noise until there's a discrepancy and we can trace out a map of a garment that may have been lost." */
  console.log('');
  console.log('— the trail: a map of one garment, when it is needed —');
  const TRF = path.join(TMP, 'hub-data', 'trail.jsonl');
  check('nothing is stored before anything is clicked', !fs.existsSync(TRF));

  const now = T + 1000;
  let tr = await req('POST', '/api/trail', { rows:[
    { ts:now,     kind:'home-tile', what:'search',                emp:'Bianca Jonas', ws:'HS Counter', store:2, screen:'home' },
    { ts:now+100, kind:'search',    what:'sheriff, jesse',         emp:'Bianca Jonas', ws:'HS Counter', store:2, screen:'search' },
    { ts:now+200, kind:'customer',  what:'Sheriff, Jesse', cid:'c1', who:'Jesse Sheriff', emp:'Bianca Jonas', ws:'HS Counter', store:2, screen:'search' },
    { ts:now+300, kind:'order',     what:'2-08-10-26-0001 · Ready', order:'2-08-10-26-0001', cid:'c1', emp:'Bianca Jonas', ws:'HS Counter', store:2, screen:'order' },
    { ts:now+400, kind:'garment',   what:'10170347', hsl:'10170347', emp:'Bianca Jonas', ws:'HS Counter', store:2, screen:'order' },
    { ts:now+500, kind:'garment',   what:'10170347', hsl:'10170347', emp:'Dana Gibbs',    ws:'Ark Counter', store:1, screen:'rack' }
  ]}, 'HS-COUNTER');
  check('a batch of taps is accepted', tr.status === 200 && tr.json.ok && tr.json.kept === 6, JSON.stringify(tr.json));
  check('trail.jsonl exists once a station reports', fs.existsSync(TRF));

  /* THE question: where did this garment go, and who touched it. */
  let q = await req('GET', '/api/trail?hsl=10170347');
  check('⭐ one garment can be traced by its heat-seal', (q.json.rows || []).length === 2,
    JSON.stringify((q.json.rows || []).length));
  check('...naming every person who touched it, on which station',
    (q.json.rows || []).map(r => r.emp).sort().join('|') === 'Bianca Jonas|Dana Gibbs' &&
    (q.json.rows || []).every(r => !!r.ws));
  check('...newest first, so the last person to touch it is the first row you read',
    (q.json.rows || [])[0].ts > (q.json.rows || [])[1].ts);

  q = await req('GET', '/api/trail?order=2-08-10-26-0001');
  check('a trace can start from the ORDER instead', (q.json.rows || []).length === 1 && (q.json.rows||[])[0].kind === 'order');
  q = await req('GET', '/api/trail?cid=c1');
  check('...or from the customer, picking up everything tagged to them', (q.json.rows || []).length === 2);
  q = await req('GET', '/api/trail?kind=search');
  check('what was SEARCHED is recorded, which is how "she could not find it" gets proven',
    (q.json.rows || []).length === 1 && (q.json.rows || [])[0].what === 'sheriff, jesse');
  q = await req('GET', '/api/trail?kind=home-tile');
  check('...and which button was pressed from Home', (q.json.rows || []).length === 1 && (q.json.rows || [])[0].what === 'search');
  q = await req('GET', '/api/trail?emp=bianca');
  check('...and everything one person did, by name', (q.json.rows || []).length === 5);
  q = await req('GET', '/api/trail?q=sheriff');
  check('...and a plain word search across what/who/order/garment', (q.json.rows || []).length >= 2);

  /* It must never become an audit log, or a synced record, or a cost per tap. */
  const tdb = (await req('GET', '/api/db')).json.db;
  check('⚠️ the trail is NOWHERE in the synced database', JSON.stringify(tdb).indexOf('10170347') < 0 && tdb.trail === undefined);
  check('⚠️ ...and it did NOT land in the activity log the owner reads',
    ((tdb.activity || []).filter(a => a && /sheriff, jesse|home-tile/i.test((a.type||'')+(a.detail||''))).length) === 0);
  await req('POST', '/api/trail', { rows:[{ ts:now+600, kind:'search', what:'later', emp:'X' }] }, 'HS-COUNTER');
  const lines = fs.readFileSync(TRF, 'utf8').trim().split('\n').filter(Boolean);
  check('every batch APPENDS — nothing is rewritten', lines.length === 7);
  check('...and the first row is still exactly where it was', JSON.parse(lines[0]).what === 'search' && JSON.parse(lines[0]).kind === 'home-tile');
  check('the station that sent it is recorded even if the row does not say', JSON.parse(lines[0]).dev === 'HS-COUNTER');

  check('reading the trail needs the hub key', (await req('GET', '/api/trail', undefined, 'D', 'wrong')).status === 401);
  check('...and so does writing it', (await req('POST', '/api/trail', { rows:[] }, 'D', 'wrong')).status === 401);
  /* sendBeacon cannot set a header, so ?k= is accepted on the POST — taps only, never money. */
  check('a closing window may authenticate the batch by query, so its tail is not lost',
    (await req('POST', '/api/trail?k=' + KEY, { rows:[{ ts:now+700, kind:'search', what:'beacon' }] }, 'D', null)).json.kept === 1);
  check('...but a WRONG query key is still refused', (await req('POST', '/api/trail?k=nope', { rows:[] }, 'D', null)).status === 401);
  check('a garment nobody touched returns an empty map, not an error',
    (await req('GET', '/api/trail?hsl=99999999')).json.ok === true && (await req('GET', '/api/trail?hsl=99999999')).json.rows.length === 0);

  /* ───────────── ⏱ TWO CLOCKS ON ONE NUMBER LINE ─────────────
     The hub decides winners too. If it used different arithmetic from the app, the two would disagree about
     who won — which is the entire class of bug this fixes. */
  console.log('');
  console.log('— the hub and the app rank stamps by the same arithmetic —');
  function stampBlock(f){ const t = fs.readFileSync(path.join(__dirname, f), 'utf8').replace(/\r\n/g, '\n');
    const a = t.indexOf('/* <STAMP-SCALE v1>'), b = t.indexOf('/* </STAMP-SCALE v1> */');
    return (a < 0 || b < 0) ? null : t.slice(a, b + 23); }
  const zApp = stampBlock('Ozark-POS.html'), zHub = stampBlock('hub-server.js');
  check('the scale rule exists in BOTH the app and the hub', !!zApp && !!zHub);
  check('...and is BYTE-IDENTICAL, so they cannot rank a merge differently', zApp === zHub,
    (zApp && zHub) ? ('app ' + zApp.length + ' vs hub ' + zHub.length) : '');
  check('the hub uses it to pick the per-record winner',
    fs.readFileSync(path.join(__dirname,'hub-server.js'),'utf8').indexOf('if (stampNewer(r._t, c._t)) out[id] = r;') > 0);
  check('⚠️ and no bare _t comparison is left in the hub', ['(r._t || 0) >= (c._t || 0)',
    '(x._t || 0) >= (y._t || 0)', '(is._t || 0) >= (cs._t || 0)', 'td >= (r._t || 0)']
    .every(bad => fs.readFileSync(path.join(__dirname,'hub-server.js'),'utf8').indexOf(bad) < 0));

  /* The live shape, through a real hub: a just-paid balance on a millisecond stamp, versus a zstale copy on a
     hybrid one. Before the fix the six-day-old copy won and the customer showed as owing again. */
  const zg = await req('GET', '/api/db');
  const zdb = zg.json.db;
  zdb.customers.push({ id:'SCALE1', first:'Neil', last:'Scale', balance:0, _t:1786383558009 });        // paid, ms
  const zr = await req('POST', '/api/db', { db: zdb, baseRev: zg.json.rev });
  check('a millisecond-stamped record is stored', zr.status === 200);
  const zg2 = await req('GET', '/api/db');
  const zstale = JSON.parse(JSON.stringify(zg2.json.db));
  const zc = zstale.customers.find(x => x.id === 'SCALE1');
  zc.balance = 17.52; zc._t = 1785864540000 * 1000;                                                   // zstale, hybrid
  await req('POST', '/api/db', { db: zstale, baseRev: zg2.json.rev }, 'STALE-STATION');
  const zafter = (await req('GET', '/api/db')).json.db.customers.find(x => x.id === 'SCALE1');
  check('⭐ the hub keeps the JUST-PAID balance over a six-day-old hybrid-stamped copy',
    !!zafter && zafter.balance === 0, JSON.stringify(zafter && zafter.balance));
  const zg3 = await req('GET', '/api/db');
  const znewer = JSON.parse(JSON.stringify(zg3.json.db));
  znewer.customers.find(x => x.id === 'SCALE1').balance = 9.99;
  znewer.customers.find(x => x.id === 'SCALE1')._t = 1786383558009 * 1000 + 5000;                       // genuinely znewer
  await req('POST', '/api/db', { db: znewer, baseRev: zg3.json.rev }, 'OTHER-STATION');
  const zafter2 = (await req('GET', '/api/db')).json.db.customers.find(x => x.id === 'SCALE1');
  check('...while a genuinely znewer change still wins, on either scale', !!zafter2 && zafter2.balance === 9.99);

  /* ───────────── 👑 THE HUB APPOINTS ONE STATION ─────────────
     Note: TEST-DEV has been checking in throughout this run, so it is already the incumbent. That is the
     behaviour under test — stickiness. An appointment that flapped between stations mid-charge would be worse
     than none, so a newcomer must be REFUSED while the incumbent is still alive. */
  console.log('');
  console.log('— the hub appoints exactly one station to do the automatic work —');
  /* Who the incumbent is depends on which station hit health first in this run, so ASK rather than assume —
     the same discipline that fixed the rest of today. */
  await req('GET', '/api/health', undefined, 'TEST-DEV');
  const bossDev = (await req('GET', '/api/mirror')).json.autoLeader;
  check('the hub has appointed somebody', !!bossDev);
  const bossSays = await req('GET', '/api/health', undefined, bossDev);
  check('...and tells that station it is the one', bossSays.json.autoLeader === true);
  const nOne = await req('GET', '/api/health', undefined, 'STATION-A');
  const nTwo = await req('GET', '/api/health', undefined, 'STATION-B');
  check('⭐ every other station is told NO — never two at once', nOne.json.autoLeader === false && nTwo.json.autoLeader === false);
  /* Stickiness is the point: an appointment that flapped mid-charge would be worse than none. */
  for (let i = 0; i < 5; i++) { await req('GET', '/api/health', undefined, 'STATION-A'); }
  const held = (await req('GET', '/api/mirror')).json.autoLeader;
  check('...and the incumbent keeps it however often the others check in', held === bossDev);
  const n2 = await req('GET', '/api/health', undefined, 'STATION-A');
  check('...so the newcomer is held refused', n2.json.autoLeader === false);
  const con = await req('GET', '/api/health', undefined, 'support-console');
  check('a support console is never appointed — it is not a station', con.json.autoLeader === false);
  check('health answers a plain yes/no, leaking no station names on the keyless endpoint',
    typeof n2.json.autoLeader === 'boolean' && JSON.stringify(n2.json).indexOf(bossDev) < 0);
  check('the owner can see WHO has it, on the key-gated endpoint', (await req('GET', '/api/mirror')).json.autoLeader === bossDev);
  /* ───────────── 💳 WHICH CARD IS IT, AND WHAT HAPPENED TO IT ─────────────
     Owner, 2026-08-10: "fix the card brand and terminal logging." All 21 saved cards said "Card", so
     "Mastercards will not save" could not be checked against data at all — and the hub had no record of a card
     attempt even being MADE, because /api/pay/* was never logged. An hour went into a Mastercard theory for a
     charge the app had cancelled itself. */
  /* ───── 📞 A STATION THAT HANGS UP IS NOT A CRASH ─────
     Measured on the LIVE hub 2026-08-13: 653 `[uncaughtException] ERR_STREAM_WRITE_AFTER_END` in six hours,
     one every 33 seconds. Every one was send() replying to a push whose socket the station had already
     closed -- a phone backgrounding its tab, Chrome throttling a hidden window, a person navigating away.
     The DATA was never at risk: by the time send() runs the delta log is on disk and the revision is
     committed, and the station retries into an idempotent merge. What was at risk was everything else --
     Node leaves the process undefined after an uncaughtException, and the journal was drowning at a rate
     that would bury a real fault.
     ⚠️ A SOURCE CHECK WOULD PROVE NOTHING: the old code "survived" a hangup too, because the global handler
     swallowed the throw. The count is the only thing that separates before from after. */
  /* ───── 📪 A SEND THAT NEVER REACHED THE CUSTOMER ─────
     Owner: "if outbox fails it should just be a message line in the history of messages for that customer
     and flag us a notification." Twilio is not configured in this harness, so every send here comes back
     'simulated' -- which is NOT a failure and must not light the badge. That makes it the right negative
     case to pin, and the ack path is exercised directly. */
  /* ───── 🔐 THE BACKUP CHECK IS VISIBLE ─────
     A weekly verify that silently stops running reads as "fine" forever — the same shape as the watchdog
     that had quietly stopped watching. So health carries its AGE, not just its verdict. */
  console.log('');
  console.log('— the off-site backup check is visible —');
  const bh = (await req('GET', '/api/health')).json;
  check('health reports the backup verify state', bh && typeof bh.backup === 'object' && bh.backup !== null);
  check('⚠️ a check that has NEVER run reports ok:null, not ok:true — "no news" must not read as good news',
    bh.backup.never ? bh.backup.ok === null : (typeof bh.backup.ok === 'boolean'));
  check('⚠️ …and it carries its AGE, so a verify that stopped running cannot pass for a healthy one',
    bh.backup.never ? true : (typeof bh.backup.ageDays === 'number' && typeof bh.backup.stale === 'boolean'));

  console.log('');
  console.log('— a send that never reached the customer —');
  const f0 = (await req('GET', '/api/sms/failed')).json;
  check('the hub can say what never reached a customer', f0 && f0.ok === true && Array.isArray(f0.failed));
  await req('POST', '/api/sms', { to:'5015550100', body:'hello', kind:'ready', cid:'CUSTX' });
  const f1 = (await req('GET', '/api/sms/failed')).json;
  check('⚠️ a SIMULATED send is not a failure — it only means Twilio keys are unset, and counting it would light the badge on every send in a shop that has not switched them on',
    f1.count === f0.count);
  const h = (await req('GET', '/api/health')).json;
  check('the count rides the keyless health poll every station already makes, so the badge costs no extra request',
    typeof h.smsFailed === 'number');
  const ack = (await req('POST', '/api/sms/ack', { by:'test' })).json;
  check('⚠️ failures can be marked seen — a badge nobody can turn off is a badge people stop reading',
    ack && ack.ok === true && typeof ack.acked === 'number');
  const f2 = (await req('GET', '/api/sms/failed')).json;
  check('…and acknowledging clears them', f2.count === 0);
  check('both new endpoints are key-gated — the outbox names customers and what we said to them',
    (await req('GET', '/api/sms/failed', undefined, undefined, null)).status === 401 &&
    (await req('POST', '/api/sms/ack', {}, undefined, null)).status === 401);

  console.log('');
  console.log('— a station that hangs up mid-push —');
  const h0 = (await req('GET', '/api/health')).json;
  check('the hub publishes how many replies had nobody left to hear them', typeof h0.hangups === 'number');
  await new Promise((resolve) => {
    const payload = JSON.stringify({ delta:true, db:{ customers:[{ id:'HANGUP', first:'Hang', last:'Up', _t: Date.now()*1000 }] }, baseRev: h0.rev });
    const r = http.request({ host:'127.0.0.1', port:PORT, path:'/api/db', method:'POST',
      headers:{ 'x-ozark-key':KEY, 'x-ozark-device':'HANGUP-DEV', 'Content-Type':'application/json',
                'Content-Length': Buffer.byteLength(payload) } }, () => {});
    r.on('error', () => {});
    r.write(payload);
    r.end();
    /* close the socket the instant the body is out -- the hub is mid-write and will reply to nobody */
    setTimeout(() => { try { r.destroy(); } catch (e) {} resolve(); }, 5);
  });
  await sleep(600);
  const h1 = (await req('GET', '/api/health')).json;
  check('⚠️ the hub is still answering after the hangup', h1 && h1.ok === true);
  check('⚠️ and it COUNTED the undeliverable reply instead of throwing — a flood of uncaught exceptions would bury a real fault',
    h1.hangups > h0.hangups);
  const _hupDb = (await req('GET', '/api/db')).json;
  check('…and the work the station pushed before hanging up was still committed — the reply was lost, never the data',
    ((_hupDb.db.customers || []).filter(c => c.id === 'HANGUP')).length === 1);

  console.log('');
  console.log('— a card has a brand, and every attempt leaves a record —');
  const HUBSRC = fs.readFileSync(path.join(__dirname, 'hub-server.js'), 'utf8');
  /* ⚠️ THESE TWO ASSERTIONS USED TO PIN THE BUG. Written 2026-08-10, they demanded `bin: 'y'` on all THREE
     card calls. The GATEWAY accepts it — proven live 8/12, three approvals came back "Amex". The BOLT
     TERMINAL API does not: it answers `Invalid value for param: 'bin'.` and refuses the sale, which took the
     counter down on 8/13 (five attempts on a $7.70 pickup, no payment possible). The tests were green the
     whole time, because they asked whether the field was SENT, never whether the processor would take it.
     A test locks in a mistake as firmly as a fix. Retargeted, not deleted: each still pins its original
     lesson — the brand is unknowable without asking — but now on the one endpoint that answers. */
  const GW = HUBSRC.slice(HUBSRC.indexOf('function cpAuthCapture'));
  check('the GATEWAY request still asks for bin info — without it every card reads "Card"',
    /bin: 'y'/.test(GW.slice(0, GW.indexOf('\n}'))));
  const boltBodies = HUBSRC.split('/api/v4/authCard').slice(0, -1)
    .map(seg => seg.slice(Math.max(0, seg.lastIndexOf('const body ='))));
  check('⛔ and the TWO BOLT TERMINAL calls do NOT — sending it there refuses the sale outright',
    boltBodies.length === 2 && boltBodies.every(b => b.indexOf('bin:') < 0));
  /* the BIN table itself, run here rather than trusted */
  const bstart = HUBSRC.indexOf('function cpBrandOf'), bend = HUBSRC.indexOf('function cpNormalize');
  const BR = {}; new Function('exports', HUBSRC.slice(bstart, bend) + '\nexports.f=cpBrandOf;')(BR);
  check('Visa is recognised', BR.f({ binInfo:{ bin:'411111' } }) === 'Visa');
  check('Mastercard 5-series is recognised', BR.f({ binInfo:{ bin:'553333' } }) === 'Mastercard');
  check('⭐ Mastercard 2-SERIES is recognised — the range everyone forgets', BR.f({ binInfo:{ bin:'222100' } }) === 'Mastercard' && BR.f({ binInfo:{ bin:'272000' } }) === 'Mastercard');
  check('Amex and Discover are recognised', BR.f({ binInfo:{ bin:'371449' } }) === 'Amex' && BR.f({ binInfo:{ bin:'601111' } }) === 'Discover');
  check('a name from the processor is preferred over the table', BR.f({ binInfo:{ brand:'mastercard' } }) === 'Mastercard');
  check('⚠️ a TOKEN is never mistaken for a card number — its leading digit means nothing',
    BR.f({ token:'5400657895784530' }) === 'Card' && BR.f({ token:'4400657895784530' }) === 'Card');
  check('...and an unknown card is honestly just "Card", not a guess', BR.f({}) === 'Card' && BR.f(null) === 'Card');

  /* 💳 the bank's own words reach the counter (2026-08-31, Wade Smythe ····1111): the gateway said
     declineCategoryText "Wait to retry" — a SOFT decline — and the counter saw only "Decline". */
  const nls = HUBSRC.indexOf('function cpLast4'), nle = HUBSRC.indexOf('\n', nls);
  const nbs = HUBSRC.indexOf('function cpBrandOf'), nbe = HUBSRC.indexOf('const IDEMFILE');
  const NM = {}; new Function('exports', HUBSRC.slice(nls, nle) + '\n' + HUBSRC.slice(nbs, nbe) + '\nexports.f=cpNormalize;')(NM);
  const softDec = NM.f({ respstat: 'C', resptext: 'Decline', respcode: '500', declineCategoryText: 'Wait to retry', retref: '000093598314', account: '0064752671853259' });
  check('💳 a soft decline carries the BANK\'S category to the counter, not the bare word',
    softDec.status === 'declined' && /bank says: Wait to retry/.test(softDec.message) && softDec.respcode === '500');
  check('...a decline with no category stays the plain word — nothing invented',
    NM.f({ respstat: 'C', resptext: 'Decline', respcode: '500' }).message === 'Decline');
  const rejN = NM.f({ respstat: 'C', resptext: 'Invalid value for param: bin', declineCategoryText: 'Wait to retry' });
  check('...and OUR rejected request never wears a bank category (8/19 class)',
    rejN.status === 'error' && !/bank says/.test(rejN.message));

  /* the permanent record of attempts */
  const CLF = path.join(TMP, 'hub-data', 'card-events.jsonl');
  check('every card action funnels through one recorder', (HUBSRC.match(/cardLog\(/g) || []).length >= 6);
  check('...including the terminal read, which had NO record at all before',
    HUBSRC.indexOf("cardLog('terminal'") > 0);
  check('...covering a reader that times out with no card tapped', HUBSRC.indexOf("via:'no answer'") > 0);
  check('...and a reader that refuses outright', HUBSRC.indexOf("via:'reader refused'") > 0);
  check('⚠️ the token, account, expiry and CVV are NEVER written to it',
    (function(){ const i = HUBSRC.indexOf('function cardLog('), seg = HUBSRC.slice(i, i + 1800);
      return seg.indexOf('token') < 0 && seg.indexOf('cvv') < 0 && seg.indexOf('expiry') < 0; })());
  check('...only the last four', HUBSRC.indexOf("slice(-4)") > 0 && HUBSRC.indexOf('function cardLog(') > 0);
  const cl = await req('GET', '/api/card-log');
  check('the record reads back through the API', cl.status === 200 && cl.json.ok === true && Array.isArray(cl.json.rows));
  check('...and honestly reports that nothing has happened yet rather than erroring', cl.json.exists === false || cl.json.rows.length === 0);
  check('it is hub-key gated', (await req('GET', '/api/card-log', undefined, 'D', 'wrong')).status === 401);
  check('...and it can be asked for just the failures', HUBSRC.indexOf("status:q.get('status')") > 0);
  check('...or for one card by its last four', HUBSRC.indexOf("last4:q.get('last4')") > 0);

  /* ───────────── 🛣 PHASE 1 — THE HUB SERVES DELTAS ─────────────
     Owner: "all of the data is historical and only the delta is synced… the hub is a system of highways, not a
     data storage center."
     The assertion that makes this trustworthy is not "a delta arrived" — it is that a station fed ONLY deltas
     ends up byte-identical to a station that pulled everything. Anything less and the shop is one missed record
     away from a mystery. */
  console.log('');
  console.log('— the hub serves deltas, and a delta-fed station matches a full-pull station exactly —');

  const APPSRC_P1 = fs.readFileSync(path.join(__dirname, 'Ozark-POS.html'), 'utf8');
  const HUBSRC_P2 = fs.readFileSync(path.join(__dirname, 'hub-server.js'), 'utf8');
  check('a full pull is still the answer when no `since` is asked for — the old-build guarantee',
    (await req('GET', '/api/db')).json.delta === undefined);
  check('...and it still carries the whole database', Object.keys((await req('GET', '/api/db')).json.db || {}).length > 5);

  /* build a delta-only replica and a full-pull replica, and drive real work at the hub */
  const p1Merge = (target, payload) => {                        /* the same law the app and hub both apply */
    Object.keys(HUB_KEYS_T).forEach(coll => {
      const key = HUB_KEYS_T[coll];
      const inc = (payload.db && payload.db[coll]) || [];
      if (!inc.length && !target[coll]) return;
      const map = {};
      (target[coll] || []).forEach(r => { if (r && r[key] != null) map[String(r[key])] = r; });
      inc.forEach(r => { if (r && r[key] != null) map[String(r[key])] = r; });   /* hub-ordered: incoming wins */
      target[coll] = Object.keys(map).map(k => map[k]);
    });
    ['settings','baseline','seq','drawers','checklistDone'].forEach(k => {
      if (payload.db && payload.db[k] !== undefined) target[k] = payload.db[k]; });
  };
  const p1Norm = o => {                                          /* order-independent comparison */
    const out = {};
    Object.keys(HUB_KEYS_T).forEach(coll => {
      const key = HUB_KEYS_T[coll];
      out[coll] = ((o[coll] || []).slice()).sort((a,b) => String(a[key]).localeCompare(String(b[key])))
        .map(r => { const c = Object.assign({}, r); delete c._seq; return JSON.stringify(c); });
    });
    return JSON.stringify(out);
  };

  const p1Seed = await req('GET', '/api/db');
  let p1Delta = JSON.parse(JSON.stringify(p1Seed.json.db));    /* both start from one full pull */
  let p1Mark = p1Seed.json.rev;

  /* N operations across M "stations", including the two cases that break naive delta sync */
  const p1Ops = [
    db => { db.customers.push({ id:'P1c1', first:'Delta', last:'One', balance:5, _t:T+10 }); },
    db => { db.orders.push({ id:'P1o1', number:'9-01-01-26-0001', customerId:'P1c1', status:'Received', storeId:1, lines:[], splits:[], orderUpcharges:[], _t:T+11 }); },
    db => { const o = db.orders.find(x => x.id === 'P1o1'); o.status = 'Detailed'; o._t = T+12; },
    db => { db.payments.push({ id:'P1p1', orderId:'P1o1', customerId:'P1c1', amount:9.99, method:'Card', _t:T+13 }); },
    db => { const c = db.customers.find(x => x.id === 'P1c1'); c.balance = 0; c._t = T+14; },
    db => { const o = db.orders.find(x => x.id === 'P1o1'); o.status = 'PickedUp'; o.paymentStatus = 'paid'; o._t = T+15; },
    db => { db.garments.push({ hsl:'91919191', desc:'delta shirt', _t:T+16 }); },
    db => { db.ledger.push({ id:'P1l1', customerId:'P1c1', type:'charge', amount:9.99, date:T, _t:T+17 }); },
  ];
  for (let n = 0; n < p1Ops.length; n++) {
    const g = await req('GET', '/api/db');
    const w = g.json.db; p1Ops[n](w);
    const post = await req('POST', '/api/db', { db: w, baseRev: g.json.rev }, 'STATION-' + (n % 3));
    check('op ' + (n+1) + ' of ' + p1Ops.length + ' accepted', post.status === 200 && post.json.ok === true);
    /* the delta device takes ONLY the increment */
    const d = await req('GET', '/api/db?since=' + p1Mark);
    p1Merge(p1Delta, d.json);
    p1Mark = d.json.rev;
  }

  const p1Full = (await req('GET', '/api/db')).json.db;       /* the other device just pulls everything */
  check('⭐ the delta-fed station is byte-identical to the full-pull station', p1Norm(p1Delta) === p1Norm(p1Full),
    (function(){ const a = JSON.parse(p1Norm(p1Delta)), b = JSON.parse(p1Norm(p1Full));
      const p1Bad = Object.keys(b).filter(k => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
      return p1Bad.length ? ('differs in: ' + p1Bad.join(', ')) : ''; })());
  check('...including the order that moved forward through four states',
    (p1Delta.orders.find(o => o.id === 'P1o1') || {}).status === 'PickedUp');
  check('...and the balance that was edited after the fact', (p1Delta.customers.find(c => c.id === 'P1c1') || {}).balance === 0);

  /* 🗝 SCALARS AND MAPS RIDE ONLY WHEN THEY HAVE SOMETHING TO SAY.
     ⚠️ These used to be sent on EVERY delta, on the strength of a comment calling them "tiny ... a few
     hundred bytes". Measured on the live delta log 2026-08-14: settings 3.1 KB, drawers 2.1 KB,
     checklistDone 0.4 KB, sent 2,408 times each — drawers had changed ONCE and checklistDone never. That is
     13 MB of a 32 MB log, and the same bytes re-downloaded by every station on every pull.
     The equivalence test above cannot catch this on its own: sending too MUCH still ends byte-identical.
     So it is pinned directly, in both directions. */
  {
    const g1 = await req('GET', '/api/db');
    const w1 = g1.json.db;
    w1.customers.push({ id: 'KSEQc1', first: 'Key', last: 'Seq', _t: 3e15 });   /* a record moves; settings does not */
    await req('POST', '/api/db', { db: w1, baseRev: g1.json.rev }, 'STATION-KSEQ');
    const dA = await req('GET', '/api/db?since=' + p1Mark);
    check('a record-only revision does NOT drag settings along', dA.json.db.settings === undefined,
      'settings rode a delta that did not change it');
    check('...nor drawers', dA.json.db.drawers === undefined);
    check('...nor checklistDone', dA.json.db.checklistDone === undefined);
    check('...while the record itself is there, so nothing was lost in the trade',
      (dA.json.db.customers || []).some(c => c.id === 'KSEQc1'));
    p1Merge(p1Delta, dA.json); p1Mark = dA.json.rev;

    /* ⚠️ AND THE OTHER DIRECTION, which is the one that would actually hurt: a real settings change must
       still reach every station. Withholding a change is the failure this must never introduce. */
    const g2 = await req('GET', '/api/db');
    const w2 = g2.json.db;
    w2.settings = Object.assign({}, w2.settings, { kseqProbe: 'moved' });
    w2.customers.push({ id: 'KSEQc2', first: 'Key', last: 'Two', _t: 3e15 });
    await req('POST', '/api/db', { db: w2, baseRev: g2.json.rev }, 'STATION-KSEQ');
    const dB = await req('GET', '/api/db?since=' + p1Mark);
    check('⚠️ a settings change DOES ride the next delta', dB.json.db.settings !== undefined &&
      dB.json.db.settings.kseqProbe === 'moved', 'a settings change was withheld from a delta — the dangerous direction');
    p1Merge(p1Delta, dB.json); p1Mark = dB.json.rev;

    /* ⚠️ AND THE SAME THING THROUGH A **DELTA** PUSH, WHICH IS THE SHAPE PRODUCTION ACTUALLY USES.
       A station sends {delta:true, db:{settings:…}}, not the whole database. The check above used a full
       push, and the two paths reach hubMerge differently — `devices` is already known to be merged IN PLACE
       on an object shared with the pre-merge copy, which makes seqStamp compare a record against itself and
       never see a change. If settings were merged that way, a real settings change would be silently
       withheld from every station forever. That is the one failure this must never introduce, so it is
       tested in the shape that would cause it. */
    const g3 = await req('GET', '/api/db');
    const p3 = await req('POST', '/api/db',
      { delta: true, baseRev: g3.json.rev, db: { settings: { kseqProbe2: 'delta-moved', _t: 3e15 } } }, 'DELTA-KSEQ');
    check('a delta-shaped settings push is accepted', p3.status === 200 && p3.json.ok === true);
    const dC = await req('GET', '/api/db?since=' + p1Mark);
    check('⚠️ a settings change pushed as a DELTA still rides the next pull',
      !!dC.json.db.settings && dC.json.db.settings.kseqProbe2 === 'delta-moved',
      'settings was merged in place, so the change compared equal to itself and was withheld');
    p1Merge(p1Delta, dC.json); p1Mark = dC.json.rev;

    const p1Full2 = (await req('GET', '/api/db')).json.db;
    check('⭐ and the delta-fed station is STILL byte-identical after all that', p1Norm(p1Delta) === p1Norm(p1Full2),
      (function(){ const a = JSON.parse(p1Norm(p1Delta)), b = JSON.parse(p1Norm(p1Full2));
        const bad = Object.keys(b).filter(k => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
        return bad.length ? ('differs in: ' + bad.join(', ')) : ''; })());
  }

  /* the counts that let a station notice drift without paying for a full pull */
  const p1Zero = await req('GET', '/api/db?since=' + p1Mark);
  check('a delta with nothing in it says so honestly rather than looking like an empty hub',
    p1Zero.json.delta === true && p1Zero.json.changed === 0);
  check('...and still carries the row counts, so silence can be checked', !!p1Zero.json.counts && p1Zero.json.counts.orders >= 1);
  /* ⚠️ against what the hub holds NOW, not against a snapshot taken earlier in this file. It compared to
     `p1Full`, captured before the scalar/map block above, so adding two records anywhere between them broke
     an assertion that was not about those records at all. "What the hub actually holds" has to be asked, not
     remembered. */
  const p1Now = (await req('GET', '/api/db')).json.db;
  check('the counts match what the hub actually holds',
    p1Zero.json.counts.orders === p1Now.orders.length && p1Zero.json.counts.customers === p1Now.customers.length);

  /* a station that misses a window must be able to catch up in one request */
  const p1Behind = await req('GET', '/api/db?since=0');
  /* ⚠️ MY FIRST TWO ASSERTIONS HERE WERE WRONG, and the design is right. A record that has not changed since
     Phase 1 shipped carries no _seq, so it is treated as 0 and `since=0` does NOT return it. That is deliberate:
     a station asking since=N has, by definition, already been handed everything older than N. The FULL pull is
     what delivers un-stamped history — which is why SYNC.seq starts at -1 and a station must full-pull once
     before it may ever ask for a delta, and why the every-15th tick is a full reconcile. */
  check('`since=0` returns only what has moved SINCE revision 0, not the whole history',
    (p1Behind.json.db.orders || []).length <= p1Full.orders.length && p1Behind.json.delta === true);
  check('...and the un-stamped history is delivered by the FULL pull instead',
    ((await req('GET', '/api/db')).json.db.orders || []).length === p1Full.orders.length);
  check('...so a station can always recover completely by asking with no `since` at all',
    Object.keys((await req('GET', '/api/db')).json.db || {}).length > 5);
  /* ══ 🛠 REMOTE STATION SETTINGS ══════════════════════════════════════════════════════════════════════
     Owner asked for a way to work on a station without standing at it, and chose SETTINGS ONLY over a
     command channel. ⚠️ THE WHITELIST IS THE WHOLE SECURITY MODEL, so it is tested by trying to break it:
     the two keys that must never travel this way are the two that would hand over the shop. */
  {
    const SID = 'WS-TESTSTATION';
    const set = (body) => req('POST', '/api/station-config', Object.assign({ id: SID }, body), 'ADMIN');
    const get = () => req('GET', '/api/station-config?id=' + SID);

    const a = await set({ want: { storeScope: 'all', printAgent: true } });
    check('settings for a station can be queued from the hub', a.status === 200 && a.json.ok === true);

    /* 🩺 build 4: diagnostics on request — a flag out, evidence back, key-gated both ways, never a secret */
    const dq = await set({ diag: true });
    check('🩺 a diagnostics request can be queued for a station', dq.status === 200 && dq.json.ok === true);
    const gd = await get();
    check('...and the station sees diagAt on its poll', gd.json.diagAt > 0);
    const dpost = await req('POST', '/api/diag', { id: SID, diag: { build: 'abc123', sync: { status: 'ok' }, settings: { hubKeyPresent: true }, apiKey: 'SHOULD-NOT-BE-STORED', agent: { ok: true } } }, 'STATION');
    check('the station can post its diagnostics', dpost.status === 200 && dpost.json.ok === true);
    const gd2 = await get();
    check('...and the owner tool reads them back off the same row', gd2.json.diag && gd2.json.diag.build === 'abc123' && gd2.json.diag.agent.ok === true);
    check('⚠️ anything NAMED like a secret is withheld on the hub side too', gd2.json.diag.apiKey === '(withheld)');
    const dnokey = await req('POST', '/api/diag', { id: SID, diag: { build: 'x' } }, 'STATION', null);
    check('⚠️ /api/diag is key-gated', dnokey.status === 401);
    const dbad = await req('POST', '/api/diag', { id: 'not-a-station', diag: { build: 'x' } }, 'STATION');
    check('...and refuses a malformed station id', dbad.status === 400);
    const g = await get();
    check('...and read back for that station', g.json.want && g.json.want.storeScope === 'all');

    /* ⚠️ THE LOCK THAT MATTERS MOST. Repointing a station at another hub would hand it the whole shop on
       the next sync, so hubUrl and hubKey are refused here AND again in the shell. */
    const bad = await set({ want: { hubUrl: 'https://evil.example.com', hubKey: 'stolen', storeScope: 2 } });
    check('⚠️ hubUrl is REFUSED — a station can never be repointed at another hub remotely',
      (bad.json.refused || []).indexOf('hubUrl') >= 0);
    check('⚠️ ...and so is hubKey', (bad.json.refused || []).indexOf('hubKey') >= 0);
    const g2 = await get();
    check('...neither is stored, even alongside a legitimate setting in the same request',
      g2.json.want.hubUrl === undefined && g2.json.want.hubKey === undefined);
    check('...while the legitimate setting in that same request DID take', g2.json.want.storeScope === 2);
    check('⚠️ and the refusal is REPORTED, not silent — a setting that vanishes reads as a broken channel',
      /hubUrl/.test(bad.json.note || ''));

    /* nothing may be set without the hub key: this channel reaches every till */
    const noKey = await req('POST', '/api/station-config', { id: SID, want: { storeScope: 1 } }, 'ADMIN', null);
    check('⚠️ an unkeyed request cannot change a station at all', noKey.status === 401);

    /* "asked for" and "applied" are different facts */
    const rep = await set({ applied: { storeScope: 'all' } });
    check('a station can report back what it ACTUALLY applied', rep.status === 200);
    const g3 = await get();
    check('...and that is kept apart from what was asked for',
      (await req('GET', '/api/station-config')).json.stations[SID].applied.storeScope === 'all');

    /* 🔢 the order-number BAND is the one setting the hub POLICES for uniqueness (owner, 2026-09-10) — two
       stations on the same band would re-open the collision banding exists to prevent, so the hub refuses it. */
    const b1 = await set({ want: { numBand: 3 } });
    check('🔢 a station can be assigned an order-number band', b1.status === 200 && (await get()).json.want.numBand === 3);
    check('🔢 ...the same station re-setting its OWN band is fine (idempotent)', (await set({ want: { numBand: 3 } })).json && (await get()).json.want.numBand === 3);
    const SID2 = 'WS-BANDCLASH';
    const b2 = await req('POST', '/api/station-config', { id: SID2, want: { numBand: 3 } }, 'ADMIN');
    check('🔢 ⚠️ a DIFFERENT station cannot take a band already held — the refusal IS the collision guarantee',
      (b2.json.refused || []).indexOf('numBand') >= 0 && /already assigned to/.test(b2.json.note || ''));
    check('🔢 ...and the clash is not stored', ((await req('GET', '/api/station-config?id=' + SID2)).json.want || {}).numBand === undefined);
    const b3 = await req('POST', '/api/station-config', { id: SID2, want: { numBand: 4 } }, 'ADMIN');
    check('🔢 ...but a FREE band is granted to that same second station', b3.status === 200 && (await req('GET', '/api/station-config?id=' + SID2)).json.want.numBand === 4);

    /* 🔎 code integrity — the hub knows what it served */
    const okSha = (await req('GET', '/api/health')).json.appRev;
    const m1 = await set({ codeSha: okSha });
    check('a station running the app the hub serves reports a MATCH', m1.json.match === true);
    const m2 = await set({ codeSha: 'deadbeef1234' });
    check('⚠️ a station running something else is caught', m2.json.match === false);
    const g4 = await req('GET', '/api/station-config');
    check('...and recorded against that station', !!g4.json.stations[SID].codeMismatchAt);
    const m3 = await set({ codeSha: okSha });
    check('...and cleared when it comes back into line, so the flag means NOW', m3.json.match === true &&
      !(await req('GET', '/api/station-config')).json.stations[SID].codeMismatchAt);
  }

  const p1Bad = await req('GET', '/api/db?since=notanumber');
  check('a nonsense `since` is refused rather than silently treated as 0', p1Bad.json.ok === false);

  /* the app side of the contract */
  check('the app starts at seq -1, so it must FULL-pull before it may ever ask for a delta',
    APPSRC_P1.indexOf('rev:-1,seq:-1') > 0);
  check('...and only asks for a delta once it has completed one', APPSRC_P1.indexOf('var _wantDelta = (SYNC.seq>=0)') > 0);
  check('...never while adopting, seeding or reconciling',
    (function(){ const i = APPSRC_P1.indexOf('var _wantDelta'); const seg = APPSRC_P1.slice(i, i+160);
      return seg.indexOf('!forceFull') > 0 && seg.indexOf('!initial') > 0 && seg.indexOf('!SYNC.seeding') > 0; })());
  check('the watermark is persisted, so a reload does not re-download the shop', APPSRC_P1.indexOf("localStorage.setItem('ozarkpos_seq'") > 0);
  check('...and only moves when a pull was APPLIED', APPSRC_P1.indexOf('if(j.delta || !_wantDelta) syncSeqSet(j.rev);') > 0);
  check('⚠️ an empty delta does not take the seeding branch and push a whole copy over a healthy hub',
    APPSRC_P1.indexOf('if(!j.db && !j.delta)') > 0);
  check('a counts mismatch forces a full pull and is logged LOUDLY, not healed silently',
    (function(){ const i = APPSRC_P1.indexOf('counts disagreed'); return i > 0 && APPSRC_P1.slice(i-400, i+400).indexOf('syncSeqSet(-1)') > 0; })());
  check('the every-15th-tick keyed pull is now a FULL reconcile', APPSRC_P1.indexOf('syncPullDB(initial, true);') > 0);
  check('adopt still takes the whole database, where correctness beats bytes',
    (function(){ const i = APPSRC_P1.indexOf('function syncAdopt'); return APPSRC_P1.slice(i, i+400).indexOf('since=') < 0; })());

  /* ───────────── 🛣 PHASE 2 — DEVICES PUSH ONLY THEIR DELTA ─────────────
     syncStamp() already diffed every record against SYNC.base to decide what to stamp, so the records it stamps
     ARE the delta — that knowledge was computed and thrown away while _syncPost sent the whole 4.2 MB. The hub's
     merge needs nothing new, because hubMerge was written so a record missing from a payload is KEPT. What DOES
     need care is everything that reads ABSENCE as evidence. */
  console.log('');
  console.log('— a station pushes only what changed, and the hub reads absence correctly —');

  const p2g = await req('GET', '/api/db');
  const p2before = p2g.json.db;
  const p2counts = { orders: p2before.orders.length, customers: p2before.customers.length, payments: (p2before.payments||[]).length };

  /* the minimal honest push: one new payment, nothing else mentioned at all */
  const p2post = await req('POST', '/api/db',
    { delta: true, baseRev: p2g.json.rev, db: { payments: [{ id:'P2pay', orderId:null, customerId:'P1c1', amount:12.34, method:'Card', _t:T+900 }] } },
    'DELTA-STATION');
  check('a delta push carrying ONE collection is accepted', p2post.status === 200 && p2post.json.ok === true,
    JSON.stringify(p2post.json).slice(0,160));
  const p2after = (await req('GET', '/api/db')).json.db;
  check('...the new record landed', (p2after.payments||[]).some(x => x.id === 'P2pay'));
  check('⭐ ...and NOTHING else was dropped, though the push never mentioned it',
    p2after.orders.length === p2counts.orders && p2after.customers.length === p2counts.customers);
  check('...which is the law hubMerge was written for: absence is never a delete',
    (p2after.payments||[]).length === p2counts.payments + 1);

  /* ⚠️ the two diagnostics that read absence as evidence */
  const p2dev = (p2after.devices||[]).filter(d => d && (d.name === 'DELTA-STATION' || d.id === 'DELTA-STATION'))[0];
  check('⚠️ a delta-pushing station is NOT flagged as running old software',
    !p2dev || !p2dev.oldBuild, p2dev ? JSON.stringify({ oldBuild: p2dev.oldBuild, why: p2dev.oldBuildWhy }) : 'no device row');
  check('...because absence in a DELTA proves nothing about a build',
    HUBSRC_P2.indexOf('const missing = incomingIsDelta ? [] :') > 0);
  check('...and the rescue counter is skipped too, or it would read "kept customers+4909" every push',
    HUBSRC_P2.indexOf('if (!isDelta) {') > 0);

  /* a delta is validated STRICTLY — junk is refused rather than merged */
  const p2bad = await req('POST', '/api/db', { delta:true, baseRev:(await req('GET','/api/db')).json.rev, db:{ nonsense:[{id:'x'}] } }, 'DELTA-STATION');
  check('a delta carrying an unknown key is REFUSED, not merged', p2bad.status === 422, JSON.stringify(p2bad.json).slice(0,120));
  const p2empty = await req('POST', '/api/db', { delta:true, baseRev:(await req('GET','/api/db')).json.rev, db:{} }, 'DELTA-STATION');
  check('...and an empty delta is refused rather than counted as a save', p2empty.status === 422);
  check('a WHOLE-DB push is still judged by looksLikeDB, unchanged', HUBSRC_P2.indexOf("} else if (!looksLikeDB(db)) {") > 0);

  /* the one-way law and the stamp scale must still hold through a delta push */
  const p2o = await req('GET', '/api/db');
  const p2back = { delta:true, baseRev:p2o.json.rev,
    db:{ orders:[ Object.assign({}, p2o.json.db.orders.find(o => o.id === 'P1o1'), { status:'Received', _t:(T+9999)*1000 }) ] } };
  await req('POST', '/api/db', p2back, 'STALE-DELTA');
  const p2chk = (await req('GET', '/api/db')).json.db.orders.find(o => o.id === 'P1o1');
  check('⭐ a delta cannot walk an order BACKWARDS, even with a huge hybrid stamp', p2chk.status === 'PickedUp',
    'status is ' + p2chk.status);

  /* the app side of the contract */
  check('syncStamp now KEEPS what it computed instead of throwing it away', APPSRC_P1.indexOf('SYNC.lastDelta = _dn ? _delta : null;') > 0);
  check('...and collects each changed record as it stamps it', APPSRC_P1.indexOf('(_delta[coll]=_delta[coll]||[]).push(r)') > 0);
  check('...including settings, the maps, the scalars and the tombstone list when they move',
    APPSRC_P1.indexOf('_delta.settings=DB.settings') > 0 && APPSRC_P1.indexOf('_delta._tomb=DB._tomb') > 0);
  check('the push sends the delta and declares itself one', APPSRC_P1.indexOf('{db:SYNC.lastDelta, delta:true, baseRev:SYNC.rev}') > 0);
  check('⚠️ ...but sends the FULL database while seeding, with no base, or on a 409 retry',
    (function(){ const i = APPSRC_P1.indexOf('var _useDelta ='); const seg = APPSRC_P1.slice(i, i+200);
      return seg.indexOf('attempt===0') > 0 && seg.indexOf('!SYNC.seeding') > 0 && seg.indexOf('SYNC.haveBase') > 0; })());   /* 🛣 Phase 3 renamed the 4 MB string baseline to a per-record one */
  check('...because after a 409 the base moved, so a delta against the old one would be a lie',
    APPSRC_P1.indexOf('a delta computed against the old one would be a lie') > 0);
  check('a spent delta is cleared on success, so it cannot be sent twice', APPSRC_P1.indexOf("SYNC.lastDelta=null; syncSeqSet(res.j.rev);") > 0);
  check('...and our own push advances our watermark rather than re-downloading our own work',
    APPSRC_P1.indexOf('take its rev as our watermark') > 0);

  /* ================= 🛣 PHASE 4 — THE HUB BECOMES HIGHWAYS =================
     Every push used to write the whole database three times (a .bak copy, the live file, and a timestamped
     snapshot) and then scan the backups folder. The traffic record is now an append-only delta log and the
     timestamped snapshot became a CHECKPOINT on an interval.
     ⚠️ THE ONLY THING THAT MAKES THAT SAFE IS THE REBUILD, so it is proven here rather than asserted. */
  console.log('\n── 🛣 phase 4: the delta log is the record ──');
  const P4 = { dl: path.join(TMP, 'hub-data', 'delta-log.jsonl'), bk: path.join(TMP, 'hub-data', 'backups') };
  const readLog = () => { try { return fs.readFileSync(P4.dl, 'utf8').split('\n').filter(x => x.trim()).map(JSON.parse); } catch (e) { return []; } };
  const ckpts = () => { try { return fs.readdirSync(P4.bk).filter(n => /^ozark-\d{8}-\d{6}\.json$/.test(n)); } catch (e) { return []; } };

  const logBefore = readLog().length, ckBefore = ckpts().length;
  check('the delta log exists and has been written by the pushes so far', logBefore > 0, { logBefore });

  /* one line per revision, and it must equal what a DEVICE would be handed for that revision */
  let g0 = await req('GET', '/api/db');
  const revA = g0.json.rev;
  let pr = await req('POST', '/api/db', { db: { customers: [{ id: 'P4A', first: 'Log', last: 'Line', balance: 1, _t: T + 90000 }] }, baseRev: revA, delta: true }, 'P4-DEV');
  check('a push is accepted', pr.status === 200 && pr.json.ok, pr.json);
  const revB = pr.json.rev;
  const L = readLog();
  const entry = L.filter(e => +e.rev === revB)[0];
  check('...and appended exactly one log line for its revision', !!entry && L.filter(e => +e.rev === revB).length === 1);
  check('...carrying the record that changed', !!entry && ((entry.db.customers || []).some(c => c.id === 'P4A')));
  check('...and the device that sent it, for tracing', !!entry && entry.device === 'P4-DEV');
  /* the log must agree with the wire, or a rebuild would differ from what stations actually received */
  const wire = await req('GET', '/api/db?since=' + (revB - 1));
  const norm = o => JSON.stringify(Object.keys(o || {}).sort().map(k => [k, (o[k] || []).map ? (o[k] || []).slice().map(r => JSON.stringify(r, Object.keys(r || {}).sort())).sort() : o[k]]));
  check('⚠️ the log line MATCHES what a device pulling that revision receives (they share deltaSince)',
    !!entry && norm(entry.db.customers ? { customers: entry.db.customers } : {}) === norm(wire.json.db && wire.json.db.customers ? { customers: wire.json.db.customers } : {}));

  /* checkpoints on an interval, NOT one per push — that is the write amplification being removed */
  const ckAfterOne = ckpts().length;
  let rv = revB, pushes = 1;
  const ckAtStart = ckpts().length;
  for (let i = 0; i < 6; i++) {
    const g = await req('GET', '/api/db');
    const r2 = await req('POST', '/api/db', { db: { customers: [{ id: 'P4B' + i, first: 'Ck', last: String(i), balance: 0, _t: T + 91000 + i }] }, baseRev: g.json.rev, delta: true }, 'P4-DEV');
    rv = r2.json.rev; pushes++;
  }
  const ckAfter = ckpts().length;
  /* ⚠️ COUNTING FILES IS THE WRONG MEASURE: a checkpoint filename is stamped to the SECOND, so two written in
     the same second are the same file, and rotation prunes as well. Measure the newest checkpoint's REVISION
     moving forward — that is the thing the policy actually promises. */
  const ckNewestRev = () => { try { return fs.readdirSync(P4.bk).filter(n => /^ozark-\d{8}-\d{6}\.json$/.test(n))
      .map(n => { try { return +JSON.parse(fs.readFileSync(path.join(P4.bk, n), 'utf8')).__meta.rev || 0; } catch(e){ return 0; } })
      .sort((a,b) => b-a)[0] || 0; } catch(e){ return 0; } };
  check('⚠️ seven pushes did NOT write seven snapshots — a checkpoint is on an interval now', ckAfter - ckAtStart < pushes, { ckAtStart, ckAfter, pushes });
  check('...but checkpoints DO keep coming as the interval comes round', ckNewestRev() > revA, { newestCkRev: ckNewestRev(), revA });
  check('...and every one of those pushes is in the log regardless', readLog().length >= logBefore + pushes);
  check('the live file is still written on every push, so nothing else changes', (function(){
    try { const raw = JSON.parse(fs.readFileSync(path.join(TMP, 'hub-data', 'ozark-db.json'), 'utf8')); return (+raw.__meta.rev || 0) === rv; } catch (e) { return false; } })());

  /* ---- THE REBUILD. checkpoint + log must reproduce the live database exactly ---- */
  console.log('\n── 🧭 phase 4: rebuilding from a checkpoint plus the log ──');
  fs.copyFileSync(path.join(__dirname, 'hub-replay.js'), path.join(TMP, 'hub-replay.js'));
  const runReplay = args => { const r = require('child_process').spawnSync(process.execPath, ['hub-replay.js'].concat(args), { cwd: TMP, encoding: 'utf8' });
    return { code: r.status, out: (r.stdout || '') + (r.stderr || '') }; };

  const ver = runReplay(['--verify']);
  check('⚠️ a database rebuilt from checkpoint + log MATCHES the live one exactly', ver.code === 0, ver.out.slice(-500));
  check('...and it says so in words a human can act on', ver.out.indexOf('complete record') > 0 || ver.code === 0);

  /* tombstones: a delete must survive a rebuild, or a rebuild would resurrect deleted records */
  const gT = await req('GET', '/api/db');
  /* ⚠️ a tombstone rides INSIDE db and its fields are c / k / t — see the seed at the top of this file */
  const delPush = await req('POST', '/api/db', { db: { _tomb: [{ c: 'customers', k: 'P4A', t: T + 99000 }] }, baseRev: gT.json.rev, delta: true }, 'P4-DEV');
  check('a tombstone push is accepted', delPush.status === 200);
  const gAfterDel = await req('GET', '/api/db');
  check('...the record is gone from the hub', !(gAfterDel.json.db.customers || []).some(c => c.id === 'P4A'));
  const ver2 = runReplay(['--verify']);
  check('⚠️ the rebuild does NOT resurrect it — a tombstone replays as a delete', ver2.code === 0, ver2.out.slice(-500));

  /* the one-way status law is baked into what the hub stored, so a rebuild must reproduce it without
     re-implementing the rule */
  const gS = await req('GET', '/api/db');
  await req('POST', '/api/db', { db: { orders: [{ id: 'o2', number: 'A-2', status: 'Racked', _t: T + 93000 }] }, baseRev: gS.json.rev, delta: true }, 'P4-DEV');
  const gS2 = await req('GET', '/api/db');
  await req('POST', '/api/db', { db: { orders: [{ id: 'o2', number: 'A-2', status: 'Detailed', _t: T + 94000 }] }, baseRev: gS2.json.rev, delta: true }, 'P4-DEV');
  const liveO2 = ((await req('GET', '/api/db')).json.db.orders || []).filter(o => o.id === 'o2')[0];
  check('the hub still refuses to move an order backwards', liveO2 && liveO2.status === 'Racked', liveO2);
  const ver3 = runReplay(['--verify']);
  check('⚠️ ...and the rebuild reproduces that WITHOUT re-implementing the law — it replays the hub\'s own answer', ver3.code === 0, ver3.out.slice(-500));

  /* a torn final line is what a power cut looks like. It must not make the record unreadable. */
  fs.appendFileSync(P4.dl, '{"rev":999999,"db":{"customers":[{"id":"TOR');
  const verTorn = runReplay(['--verify']);
  check('⚠️ a half-written last line (power cut mid-append) is skipped, not fatal', verTorn.code === 0, verTorn.out.slice(-400));
  check('...and it says the last line was torn rather than staying quiet', verTorn.out.indexOf('torn') > 0, verTorn.out.slice(-300));
  /* put the log back exactly as it was — a torn line left mid-file pollutes every later test, which is how the
     "rebuild a specific revision" assertion below started failing for an unrelated reason */
  fs.writeFileSync(P4.dl, fs.readFileSync(P4.dl, 'utf8').split('\n').filter(l => { try { JSON.parse(l); return true; } catch(e){ return false; } }).join('\n') + '\n');

  /* a HOLE in the log must stop a rebuild rather than silently skip real changes */
  /* push until at least two revisions sit ABOVE the newest checkpoint. Punching out the only one just lowers
     the target and leaves no hole to traverse — and a fixed count is not enough either, because the last push
     can itself be the checkpoint (which is exactly what happened the first time this ran). */
  for (let i = 0; i < 10; i++) {
    const above = (function(){ const ck = ckNewestRev(); return readLog().filter(e => (+e.rev || 0) > ck).length; })();
    if (above >= 2) break;
    const g = await req('GET', '/api/db');
    await req('POST', '/api/db', { db: { customers: [{ id: 'P4H' + i, first: 'Hole', last: String(i), balance: 0, _t: T + 95000 + i }] }, baseRev: g.json.rev, delta: true }, 'P4-DEV');
  }
  const p4good = fs.readFileSync(P4.dl, 'utf8');
  const p4lines = p4good.split('\n').filter(x => x.trim()).filter(l => { try { JSON.parse(l); return true; } catch(e){ return false; } });
  /* punch out a revision that is definitely AFTER the newest usable checkpoint, so the rebuild really has to
     traverse the hole rather than starting past it */
  const newestCk = (function(){ try { return fs.readdirSync(P4.bk).filter(n => /^ozark-\d{8}-\d{6}\.json$/.test(n))
      .map(n => { try { return +JSON.parse(fs.readFileSync(path.join(P4.bk, n), 'utf8')).__meta.rev || 0; } catch(e){ return 0; } })
      .sort((a,b) => b-a)[0] || 0; } catch(e){ return 0; } })();
  const afterCk = p4lines.filter(l => { try { return (+JSON.parse(l).rev || 0) > newestCk; } catch(e){ return false; } });
  const holeIdx = (afterCk.length >= 2) ? p4lines.indexOf(afterCk[0]) : -1;
  check('the log has several revisions after the newest checkpoint, so a hole can be traversed', holeIdx >= 0, { newestCk, afterCk: afterCk.length });
  if (holeIdx >= 0) {
    fs.writeFileSync(P4.dl, p4lines.filter((l, i) => i !== holeIdx).join('\n') + '\n');
    const verHole = runReplay(['--verify']);
    check('⚠️ a MISSING revision refuses the rebuild instead of quietly skipping it', verHole.code !== 0, verHole.out.slice(-400));
    check('...naming the revision that is missing, so a human knows what was lost', verHole.out.indexOf('MISSING rev') > 0, verHole.out.slice(-300));
  }
  fs.writeFileSync(P4.dl, p4good);   // put the good log back

  /* the replay tool must never be able to touch live data */
  check('⚠️ hub-replay.js never writes the live database', (function(){
    const src = fs.readFileSync(path.join(__dirname, 'hub-replay.js'), 'utf8');
    return src.indexOf('writeFileSync(DBFILE') < 0 && src.indexOf('the LIVE database was not touched') > 0; })());
  /* and its key map must match the hub's, or records would be keyed wrongly in a rebuild */
  check('⚠️ the replay tool\'s key map matches the hub\'s HUB_KEYS_FOR_SEQ exactly', (function(){
    const hub = fs.readFileSync(path.join(__dirname, 'hub-server.js'), 'utf8');
    const rep = fs.readFileSync(path.join(__dirname, 'hub-replay.js'), 'utf8');
    const grab = (txt, name) => { const i = txt.indexOf(name); if (i < 0) return null; const a = txt.indexOf('{', i), b = txt.indexOf('};', a);
      return txt.slice(a + 1, b).replace(/\s|\n/g, ''); };
    const h = grab(hub, 'HUB_KEYS_FOR_SEQ = '), r = grab(rep, 'const KEYS = ');
    return !!h && !!r && h === r; })());
  /* ⚠️ A TOMBSTONE MUST NOT RE-BROADCAST ON EVERY PUSH. seqStamp used to compare the whole JSON, and _seq is
     part of that JSON, so a tombstone coming back from a device without _seq never matched its stored self and
     was re-stamped with the current revision. Measured on live data 2026-08-11: four consecutive revisions each
     carried all 3,563 tombstones — most of the weight Phase 1 existed to remove. */
  const tombSeqOf = async () => { const g = await req('GET', '/api/db'); return ((g.json.db._tomb || [])[0] || {})._seq; };
  const seqWas = await tombSeqOf();
  const gN = await req('GET', '/api/db');
  await req('POST', '/api/db', { db: { customers: [{ id: 'P4Z', first: 'Unrelated', last: 'Push', balance: 0, _t: T + 96000 }] }, baseRev: gN.json.rev, delta: true }, 'P4-DEV');
  const seqNow = await tombSeqOf();
  check('⚠️ an unrelated push does NOT re-stamp existing tombstones', seqWas !== undefined && seqNow === seqWas, { seqWas, seqNow });
  const gD = await req('GET', '/api/db?since=' + (await req('GET', '/api/db')).json.rev);
  check('...so a device pulling the newest delta is not handed the whole tombstone list again',
    ((gD.json._tomb || []).length) === 0, { tombInDelta: (gD.json._tomb || []).length });

  /* ⚠️ A RECORD MUST NOT RE-BROADCAST ON EVERY FULL PUSH — the tombstone bug's sibling, found 2026-08-26 as
     a fleet-wide echo storm: the mirror heal full-pushes, every record comes back as an echo carrying a
     LAGGING _seq (the hub's own field) and the app's reference-preserving fold's key order; the whole-JSON
     compare read both as changes, re-stamped, made a delta, made the next station drift and heal. Four
     customers rode every delta for 250 straight revisions. "Changed" must mean the CONTENT. */
  const gE0 = await req('GET', '/api/db');
  await req('POST', '/api/db', { db: { customers: [{ id: 'ECHO1', first: 'Echo', last: 'Storm', balance: 0, prefs: { starch: 'None', pants: 'Dry' }, _t: T + 300000 }] }, baseRev: gE0.json.rev, delta: true }, 'E-DEV-A');
  const gE1 = await req('GET', '/api/db');
  const echoStored = (gE1.json.db.customers || []).find(c => c.id === 'ECHO1');
  const echoSeq = echoStored._seq;
  /* the echo: a FULL push from another station holding the same record — content identical, _seq lagging
     (stripped), keys in a different order (the fold's incumbent order) */
  const scrambled = {}; Object.keys(echoStored).reverse().forEach(k => { if (k !== '_seq') scrambled[k] = echoStored[k]; });
  const fullDb = JSON.parse(JSON.stringify(gE1.json.db));
  fullDb.customers = (fullDb.customers || []).map(c => c.id === 'ECHO1' ? scrambled : c);
  await req('POST', '/api/db', { db: fullDb, baseRev: gE1.json.rev }, 'E-DEV-B');
  const gE2 = await req('GET', '/api/db');
  const echoAfter = (gE2.json.db.customers || []).find(c => c.id === 'ECHO1');
  check('⚠️ a full-push ECHO — same content, lagging _seq, different key order — re-stamps NOTHING', echoAfter._seq === echoSeq, { was: echoSeq, now: echoAfter._seq });
  const gE3 = await req('GET', '/api/db?since=' + gE1.json.rev);
  check('...so the delta after the echo does not carry the record again', !((gE3.json.customers || []).some(c => c.id === 'ECHO1')));
  /* and a REAL change still advances it — the gate must not be a tautology */
  const echoEdit = Object.assign({}, echoStored, { first: 'Edited', _t: T + 400000 }); delete echoEdit._seq;
  await req('POST', '/api/db', { db: { customers: [echoEdit] }, baseRev: gE2.json.rev, delta: true }, 'E-DEV-A');
  const echoFinal = ((await req('GET', '/api/db')).json.db.customers || []).find(c => c.id === 'ECHO1');
  check('...while a REAL content change still re-stamps and rides the delta', echoFinal._seq > echoSeq && echoFinal.first === 'Edited', { seq: echoFinal._seq });

  /* 🔑🍪 STATION RECOVERY TOKENS — a station whose browser evicted its storage trades a cookie for its key
     and its identity. The cookie is exempt from quota eviction; the file stores only hashes. */
  const reqC = (method, p2, body, opts) => new Promise((res2, rej2) => {
    const data = body === undefined ? null : JSON.stringify(body);
    const hdrs = Object.assign({ 'x-ozark-device': 'REKEY-DEV' },
      (opts && opts.key === null) ? {} : { 'x-ozark-key': (opts && opts.key) || KEY },
      (opts && opts.cookie) ? { 'Cookie': opts.cookie } : {},
      data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {});
    const r = http.request({ host: '127.0.0.1', port: PORT, path: p2, method, headers: hdrs }, x => {
      let d = ''; x.on('data', c => d += c);
      x.on('end', () => { let j = null; try { j = JSON.parse(d); } catch (e) {} res2({ status: x.statusCode, json: j, headers: x.headers }); });
    });
    r.on('error', rej2); if (data) r.write(data); r.end();
  });
  const mint1 = await reqC('POST', '/api/rekey/mint', { ws: 'WS-RKTEST', name: 'Rekey Tester' });
  const setC = String((mint1.headers['set-cookie'] || [])[0] || '');
  const tok = (setC.match(/ozark_rt=([0-9a-f]{48})/) || [])[1] || '';
  check('🔑🍪 a KEYED station banks a recovery cookie: HttpOnly, path-scoped, a year long',
    mint1.json && mint1.json.ok === true && !!tok && setC.indexOf('HttpOnly') > 0 && setC.indexOf('Path=/api/rekey') > 0 && setC.indexOf('Max-Age=31536000') > 0, setC.slice(0, 90));
  check('...and the file on disk holds a HASH, never the token itself', (function(){
    try { const f = fs.readFileSync(path.join(TMP, 'hub-data', 'rekey-tokens.json'), 'utf8'); return f.indexOf(tok) < 0 && f.indexOf('WS-RKTEST') > 0; } catch (e) { return false; } })());
  const redo = await reqC('POST', '/api/rekey/mint', { ws: 'WS-RKTEST', name: 'Rekey Tester' }, { cookie: 'ozark_rt=' + tok });
  check('...a station that already carries a known cookie KEEPS it (no token churn)', redo.json && redo.json.kept === true && !(redo.headers['set-cookie'] || []).length);
  const rk_rec = await reqC('POST', '/api/rekey', undefined, { key: null, cookie: 'ozark_rt=' + tok });
  check('🔑🍪 an EVICTED station (no key, cookie only) gets back its key AND who it is',
    rk_rec.json && rk_rec.json.ok === true && rk_rec.json.key === KEY && rk_rec.json.ws === 'WS-RKTEST' && rk_rec.json.name === 'Rekey Tester');
  const rk_recNo = await reqC('POST', '/api/rekey', undefined, { key: null });
  check('...no cookie = no key — a stranger is refused and counted against the guess limiter', rk_recNo.json && rk_recNo.json.ok === false && rk_recNo.json.key === undefined);
  const rk_recBad = await reqC('POST', '/api/rekey', undefined, { key: null, cookie: 'ozark_rt=' + 'f'.repeat(48) });
  check('...and a forged cookie is refused the same way', rk_recBad.json && rk_recBad.json.ok === false && rk_recBad.json.key === undefined);
  const mintNoKey = await reqC('POST', '/api/rekey/mint', { ws: 'X' }, { key: null });
  check('...minting REQUIRES the key — an unconnected caller cannot bank a token', mintNoKey.status === 401);

  /* 🔤 A MULTI-BYTE CHARACTER SPLIT ACROSS TCP CHUNKS MUST SURVIVE (2026-08-27). `body += chunk` decoded
     each chunk independently, so an em-dash straddling a chunk boundary became two replacement characters -
     a REAL content change the fleet then churned around forever. This test WRITES the body in two pieces,
     splitting the em-dash's three UTF-8 bytes down the middle, with a pause so they arrive as separate
     chunks - and the stored comment must come back byte-identical. */
  const emText = 'Happy Bag picked up on route ' + String.fromCharCode(0x2014) + ' uncounted, count at plant';
  const gCh = await req('GET', '/api/db');
  const chBody = Buffer.from(JSON.stringify({ db: { orders: [{ id: 'CHUNK1', number: '9-08-27-26-0001', customerId: 'P4Z', storeId: 1, status: 'Received', kind: 'express', pieceCount: 0, comments: emText, lines: [], orderUpcharges: [], splits: [], _t: T + 500000 }] }, baseRev: gCh.json.rev, delta: true }), 'utf8');
  const emAt = chBody.indexOf(Buffer.from([0xe2, 0x80, 0x94]));
  const chRes = await new Promise((res2, rej2) => {
    const r = http.request({ host: '127.0.0.1', port: PORT, path: '/api/db', method: 'POST', headers: { 'x-ozark-key': KEY, 'x-ozark-device': 'CHUNK-DEV', 'Content-Type': 'application/json', 'Content-Length': chBody.length } }, x => {
      let d = ''; x.on('data', c => d += c); x.on('end', () => { try { res2(JSON.parse(d)); } catch (e) { rej2(e); } });
    });
    r.on('error', rej2);
    r.write(chBody.slice(0, emAt + 1));            // ...ends ONE BYTE INTO the em-dash
    setTimeout(() => { r.write(chBody.slice(emAt + 1)); r.end(); }, 60);   // the rest arrives as a later chunk
  });
  const chStored = ((await req('GET', '/api/db')).json.db.orders || []).find(o => o.id === 'CHUNK1');
  check('🔤 an em-dash split across two TCP chunks arrives INTACT — no � ever enters the shop',
    chRes.ok === true && !!chStored && chStored.comments === emText, chStored && JSON.stringify(chStored.comments).slice(0, 60));

  /* ⚠️ A STALE TOMBSTONE MUST NOT DELETE A RE-CREATED RECORD. This is the live bug: an upcharge tombstone from
     July rode a delta, and an unconditional rebuild removed a record the hub was rightly keeping because that
     record had been re-created afterwards with a newer stamp. */
  const gR = await req('GET', '/api/db');
  await req('POST', '/api/db', { db: { customers: [{ id: 'P4RE', first: 'Re', last: 'Created', balance: 0, _t: T + 200000 }],
    _tomb: [{ c: 'customers', k: 'P4RE', t: T + 100000 }] }, baseRev: gR.json.rev, delta: true }, 'P4-DEV');
  const liveRe = ((await req('GET', '/api/db')).json.db.customers || []).some(c => c.id === 'P4RE');
  check('the hub KEEPS a record whose stamp is newer than the tombstone naming it', liveRe);
  const verRe = runReplay(['--verify']);
  check('⚠️ ...and the rebuild keeps it too — it applies the hub\'s newer-wins rule, not a blind delete', verRe.code === 0, verRe.out.slice(-450));
  check('⚠️ the replay tool carries the same STAMP-SCALE promotion as the app and the hub', (function(){
    const rep = fs.readFileSync(path.join(__dirname, 'hub-replay.js'), 'utf8');
    return rep.indexOf('<STAMP-SCALE v1>') > 0 && rep.indexOf('(v < 1e14) ? (v * 1000) : v') > 0; })());

  const rvNow = (await req('GET', '/api/db')).json.rev;
  const rebuilt = runReplay(['--rev', String(rvNow)]);   /* the CURRENT rev — an old one may sit below the oldest surviving checkpoint after rotation */
  check('rebuilding a SPECIFIC past revision works and writes a file, not the live db', rebuilt.code === 0 && rebuilt.out.indexOf('rebuilt-') > 0, rebuilt.out.slice(-300));

  /* ================= ⏰ THE HUB IS THE REFEREE ON TIME =================
     Owner, 2026-08-11: "let the hub control the timestamps, right?" It owns _seq already. It must not own _t
     (arrival order is not edit order, and offline work is load-bearing) — but it must refuse the impossible.
     On 8/03 one station stamped everything with a bad time, won every merge, and — because hlcObserve absorbs
     the highest stamp it sees — dragged every other station's clock into that same wrong future permanently.
     There was NO check on an incoming _t before this. */
  console.log('\n── ⏰ a record cannot have been edited in the future ──');
  const HOUR = 3600000;
  let gF = await req('GET', '/api/db');
  const futureMs = Date.now() + 6 * HOUR;
  let fp = await req('POST', '/api/db', { db: { customers: [{ id: 'FUT1', first: 'From', last: 'TheFuture', balance: 7, _t: futureMs }] },
    baseRev: gF.json.rev, delta: true }, 'BAD-CLOCK');
  check('a push carrying a future-dated record is still ACCEPTED (the work is real)', fp.status === 200 && fp.json.ok, fp.json);
  let liveF = ((await req('GET', '/api/db')).json.db.customers || []).filter(c => c.id === 'FUT1')[0];
  check('...the record itself is kept', !!liveF && liveF.balance === 7);
  check('⏰ ...but its stamp was CLAMPED to now, not left in the future',
    !!liveF && (+liveF._t || 0) < futureMs, { stored: liveF && liveF._t, claimed: futureMs });
  check('...and it stays on the scale it arrived on (millisecond in, millisecond out)', !!liveF && (+liveF._t) < 1e14);
  /* the whole point: a clamped stamp must no longer beat an honest present-day edit */
  /* ⚠️ CHECK THAT THE CORRECTION WAS ACCEPTED BEFORE JUDGING THE MERGE. This push used to be fired and its
     response thrown away, so a push REFUSED for a stale baseRev (409) looked exactly like a correction that
     lost the merge — and the assertion below then failed for a reason it could not name. It went red roughly
     one run in three and blocked a real deploy on 2026-08-14. A test that cannot tell "refused" from "lost"
     is the same fault this repo keeps recording in the product: an error must never render as good news.
     The hub bumps a revision on its own (a forced checkpoint after a restart, for one), so the rev read a
     moment ago can be stale by the time the POST lands. That is correct hub behaviour, not a bug — so the
     test re-reads and retries once, then asserts it actually got in. */
  /* ⚠️ STAMP THE CORRECTION FROM THE CLAMPED VALUE, NOT FROM Date.now() — and this is the whole fix for a
     flake that went red about 1 run in 6 and blocked a real deploy on 2026-08-14.
     The clamp is applied by Date.now() INSIDE THE HUB PROCESS; this correction was stamped by Date.now()
     INSIDE THE TEST PROCESS, and the test simply assumed the second read would be the larger one. Across two
     processes at millisecond resolution that ordering is not guaranteed. Caught in the act:
         run 3 (passed): clamped _t = …865256, test's Date.now() a moment later = …865257
         run 4 (FAILED): clamped _t = …882595, test's Date.now() a moment later = …882592
     Three milliseconds the wrong way, so the "later" edit was genuinely OLDER than the clamp and correctly
     lost the merge. Nothing was wrong with the hub — the test was racing two clocks it does not control.
     The fix is a MARGIN, not a derived stamp. Deriving this from what the hub stored (clamped + 1) also makes
     the flake go away — and I nearly shipped that — but it would win even if the clamp were BROKEN and had
     left the stamp six hours in the future, which is precisely the regression this assertion exists to catch.
     A test that cannot fail is not evidence. So: a real clock reading, one second ahead. That is far inside
     the 5-minute honest-skew allowance so it is never itself clamped, it clears millisecond jitter by three
     orders of magnitude, and if the clamp ever stops working this still loses and still goes red. */
  let corr = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const gF2 = await req('GET', '/api/db');
    const afterClamp = Date.now() + 1000;
    corr = await req('POST', '/api/db', { db: { customers: [{ id: 'FUT1', first: 'Corrected', last: 'ByAnyone', balance: 99, _t: afterClamp }] },
      baseRev: gF2.json.rev, delta: true }, 'GOOD-CLOCK');
    if (corr.status === 200 && corr.json && corr.json.ok) break;
  }
  check('⏰ ...and the correcting push was ACCEPTED (a refused push is not a merge result)',
    !!corr && corr.status === 200 && corr.json && corr.json.ok, corr && { status: corr.status, body: corr.json });
  liveF = ((await req('GET', '/api/db')).json.db.customers || []).filter(c => c.id === 'FUT1')[0];
  check('⏰ ...so an ordinary later edit can still win — the bad clock cannot own the record forever',
    !!liveF && liveF.balance === 99 && liveF.first === 'Corrected', liveF);

  /* honest clock drift must NOT be punished — a station a minute ahead is normal */
  const gOk = await req('GET', '/api/db');
  const slightly = Date.now() + 60000;
  await req('POST', '/api/db', { db: { customers: [{ id: 'DRIFT1', first: 'Slight', last: 'Drift', balance: 1, _t: slightly }] },
    baseRev: gOk.json.rev, delta: true }, 'DRIFTY');
  const liveD = ((await req('GET', '/api/db')).json.db.customers || []).filter(c => c.id === 'DRIFT1')[0];
  check('⏰ a station a minute ahead is left alone — that is honest skew, not a broken clock',
    !!liveD && (+liveD._t || 0) === slightly, { stored: liveD && liveD._t, sent: slightly });

  /* the hybrid scale must be judged on the same number line, not treated as astronomically future */
  const gH = await req('GET', '/api/db');
  const hybridNow = Date.now() * 1000;
  await req('POST', '/api/db', { db: { customers: [{ id: 'HYB1', first: 'Hybrid', last: 'Clock', balance: 2, _t: hybridNow }] },
    baseRev: gH.json.rev, delta: true }, 'HLC-DEV');
  const liveH = ((await req('GET', '/api/db')).json.db.customers || []).filter(c => c.id === 'HYB1')[0];
  check('⏰ a hybrid-scale stamp for RIGHT NOW is not mistaken for the future (stampScale is applied first)',
    !!liveH && (+liveH._t || 0) === hybridNow, { stored: liveH && liveH._t, sent: hybridNow });
  const gH2 = await req('GET', '/api/db');
  const hybridFuture = (Date.now() + 6 * HOUR) * 1000;
  await req('POST', '/api/db', { db: { customers: [{ id: 'HYB2', first: 'Hybrid', last: 'Future', balance: 3, _t: hybridFuture }] },
    baseRev: gH2.json.rev, delta: true }, 'HLC-BAD');
  const liveH2 = ((await req('GET', '/api/db')).json.db.customers || []).filter(c => c.id === 'HYB2')[0];
  check('...and a hybrid stamp six hours ahead IS clamped, staying on the hybrid scale',
    !!liveH2 && (+liveH2._t || 0) < hybridFuture && (+liveH2._t || 0) > 1e14, { stored: liveH2 && liveH2._t });

  /* a future-dated TOMBSTONE would delete records it has no right to */
  const gT2 = await req('GET', '/api/db');
  await req('POST', '/api/db', { db: { customers: [{ id: 'TKEEP', first: 'Should', last: 'Survive', balance: 4, _t: Date.now() }] },
    baseRev: gT2.json.rev, delta: true }, 'GOOD-CLOCK');
  const gT3 = await req('GET', '/api/db');
  await req('POST', '/api/db', { db: { _tomb: [{ c: 'customers', k: 'TKEEP', t: Date.now() + 6 * HOUR }] },
    baseRev: gT3.json.rev, delta: true }, 'BAD-CLOCK');
  const liveK = ((await req('GET', '/api/db')).json.db.customers || []).some(c => c.id === 'TKEEP');
  check('⏰ a future-dated tombstone is DROPPED, not clamped — a delete with an impossible time is not trusted at all', liveK);
  check('...and the hub says which tombstone it refused', (function(){ return log.indexOf('DROPPED tombstone customers|TKEEP') > 0; })(), log.slice(-300));
  /* and once the clock is right, the same delete lands normally — refusing only DELAYS a deletion */
  const gT4 = await req('GET', '/api/db');
  await req('POST', '/api/db', { db: { _tomb: [{ c: 'customers', k: 'TKEEP', t: Date.now() + 1000 }] }, baseRev: gT4.json.rev, delta: true }, 'GOOD-CLOCK');
  const goneK = !((await req('GET', '/api/db')).json.db.customers || []).some(c => c.id === 'TKEEP');
  check('⏰ ...the very same delete succeeds with an honest stamp — nothing is permanently blocked', goneK);

  /* ================= 🩹 THE ERROR RECORD ================= */
  console.log('\n── 🩹 the hub keeps a record of what broke ──');
  let ep = await req('POST', '/api/client-error', { rows: [
    { ts: Date.now(), kind: 'error', msg: 'render blew up', src: 'app.html', line: 12, stack: 'Error: x', screen: 'rack', appRev: 'aaa111', n: 3 },
    { ts: Date.now(), kind: 'promise', msg: 'a fetch failed', src: '', line: null, stack: '', screen: 'home', appRev: 'aaa111', n: 1 } ] }, 'CRASHY');
  check('a station can report its own failures', ep.status === 200 && ep.json.stored === 2, ep.json);
  let eg = await req('GET', '/api/client-errors?limit=50');
  check('...and they can be read back', eg.status === 200 && (eg.json.groups || []).length >= 2, eg.json && eg.json.total);
  const grp = (eg.json.groups || []).filter(g => g.msg === 'render blew up')[0];
  check('🩹 ...grouped by fault, carrying the OCCURRENCE COUNT, not one row each', !!grp && grp.count === 3, grp);
  check('...naming the station, the screen and the build — the three questions this week kept asking',
    !!grp && !!grp.devices['CRASHY'] && !!grp.screens['rack'] && !!grp.appRevs['aaa111'], grp);
  await req('POST', '/api/client-error', { rows: [ { ts: Date.now(), msg: 'render blew up', src: 'app.html', line: 12, screen: 'rack', appRev: 'aaa111', n: 5 } ] }, 'CRASHY2');
  eg = await req('GET', '/api/client-errors?limit=50');
  const grp2 = (eg.json.groups || []).filter(g => g.msg === 'render blew up')[0];
  check('🩹 the same fault from a SECOND station adds to one group and names both', !!grp2 && grp2.count === 8 && !!grp2.devices['CRASHY2'], grp2);
  const bad = await req('POST', '/api/client-error', { rows: [{ msg: 'nope' }] }, 'CRASHY', 'wrong-key');
  check('⚠️ the error endpoint is key-gated like everything else', bad.status === 401, bad.json);
  const rd = await req('GET', '/api/client-errors', undefined, 'CRASHY', 'wrong-key');
  check('...and so is reading them', rd.status === 401);
  const flood = await req('POST', '/api/client-error', { rows: Array.from({ length: 400 }, (_, i) => ({ msg: 'flood ' + i, n: 1 })) }, 'FLOOD');
  check('⚠️ a runaway station cannot fill the disk — the hub caps one report too', flood.json && flood.json.stored <= 50, flood.json);
  check('the record lives OUTSIDE the synced database, like the trail and the SMS archive',
    fs.existsSync(path.join(TMP, 'hub-data', 'client-errors.jsonl')));
  const dbAfterErr = (await req('GET', '/api/db')).json.db;
  check('⚠️ ...so reporting a crash never touches the shop\u2019s data', !dbAfterErr.clientErrors && !dbAfterErr.errors);

  /* ================= 🧩 A RECORD ARRIVES WITH THE SHAPE THE SCREENS EXPECT =================
     ⚠️ This is a live outage, replayed. On 2026-08-13 the Hot Springs counter could not use the Detail screen
     at all -- "this screen hit a snag" on every attempt -- because six orders had no `lines` array. renderDetail
     reads o.lines.length, so it threw the moment anybody opened one. The orders came from a REPAIR SCRIPT that
     built them by hand; every creation path inside the app sets it.
     All seven gates were green throughout, because every one of them tests the CODE and the fault lived only in
     real records. So the shape is enforced at the door, the way image bytes are: filled in, never rejected --
     refusing the push would strand a station over a field it can no longer supply. */
  console.log('\n-- 🧩 a record cannot arrive missing a list a screen needs --');
  const gSh = await req('GET', '/api/db');
  const shPush = await req('POST', '/api/db', { db: { orders: [{ id: 'SH1', number: 'SH-1', status: 'Received',
    customerId: 'C1', _t: Date.now() }] }, baseRev: gSh.json.rev, delta: true }, 'REPAIR-SCRIPT');
  check('🧩 a push carrying an order with NO lines array is still ACCEPTED', shPush.status === 200 && shPush.json.ok, shPush.json);
  const shO = ((await req('GET', '/api/db')).json.db.orders || []).filter(o => o.id === 'SH1')[0];
  check('🧩 ...and the hub gave it one, so no screen can throw on it', !!shO && Array.isArray(shO.lines) && shO.lines.length === 0, shO && shO.lines);
  check('⚠️ ...and said so, rather than fixing it silently', log.indexOf('missing list(s)') > 0, log.slice(-300));
  /* it must never overwrite real work */
  const gSh2 = await req('GET', '/api/db');
  await req('POST', '/api/db', { db: { orders: [{ id: 'SH2', number: 'SH-2', status: 'Detailed', customerId: 'C1',
    _t: Date.now(), lines: [{ id: 'LX', desc: 'a real piece', price: 5 }] }] }, baseRev: gSh2.json.rev, delta: true }, 'COUNTER');
  const shO2 = ((await req('GET', '/api/db')).json.db.orders || []).filter(o => o.id === 'SH2')[0];
  check('⚠️ a lines array that ALREADY has work in it is never touched', !!shO2 && shO2.lines.length === 1 && shO2.lines[0].desc === 'a real piece', shO2 && shO2.lines);
  /* a non-array in that field is a different fault and must NOT be papered over */
  const gSh3 = await req('GET', '/api/db');
  await req('POST', '/api/db', { db: { orders: [{ id: 'SH3', number: 'SH-3', status: 'Received', customerId: 'C1',
    _t: Date.now(), lines: 'not an array' }] }, baseRev: gSh3.json.rev, delta: true }, 'ODD');
  const shO3 = ((await req('GET', '/api/db')).json.db.orders || []).filter(o => o.id === 'SH3')[0];
  check('⚠️ something NON-array in that field is left alone for a human, not quietly replaced', !!shO3 && shO3.lines === 'not an array', shO3 && shO3.lines);
  /* and the app must report a caught render failure, or we only ever learn about it from an employee */
  check('⚠️ a screen that fails to draw REPORTS itself -- render() catches, so window.onerror never fires',
    (function(){ const src = fs.readFileSync(path.join(__dirname, 'Ozark-POS.html'), 'utf8');
      const i = src.indexOf('render error on'); const seg = src.slice(i, i + 400);
      return seg.indexOf('errNote(') > 0; })());

  /* ================= 📸 IMAGE BYTES NEVER ENTER THE SYNCED DATABASE =================
     The architecture was already right (upload to /api/photo, store a FILE, keep only the id on the piece) and
     the live database has zero inline images. This proves the rule now holds BY CONSTRUCTION rather than by good
     behaviour \u2014 which matters because photos are first on the roadmap and one per piece is ~8 GB a year. */
  console.log('\n── 📸 a photo cannot get into the database ──');
  const PNG1 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';
  let gB = await req('GET', '/api/db');
  let bp = await req('POST', '/api/db', { db: { orders: [{ id: 'PH1', number: 'PH-1', status: 'Detailed', _t: Date.now(),
    lines: [{ id: 'L1', photos: [PNG1] }] }] }, baseRev: gB.json.rev, delta: true }, 'CAMERA');
  check('a push carrying inline image bytes is still ACCEPTED (the photo is real evidence)', bp.status === 200 && bp.json.ok, bp.json);
  const storedO = ((await req('GET', '/api/db')).json.db.orders || []).filter(o => o.id === 'PH1')[0];
  const ph = storedO && storedO.lines && storedO.lines[0] && storedO.lines[0].photos;
  check('📸 ...but the BYTES are gone from the database', !!ph && ph.length === 1 && String(ph[0]).indexOf('data:') !== 0, ph);
  check('📸 ...replaced by a reference, so every station downloads an id and not a picture', !!ph && /^[0-9a-f]{32}\.(png|jpg)$/.test(String(ph[0])), ph && ph[0]);
  check('📸 ...and the photo itself is on disk, not lost', (function(){
    try { return fs.existsSync(path.join(TMP, 'hub-data', 'photos', String(ph[0]))); } catch (e) { return false; } })());
  check('...the whole database still contains no inline image anywhere', (function(){
    try { return fs.readFileSync(path.join(TMP, 'hub-data', 'ozark-db.json'), 'utf8').indexOf('data:image') < 0; } catch (e) { return false; } })());
  check('...and the hub says what it moved, rather than doing it silently', log.indexOf('inline photo(s) out of the database') > 0, log.slice(-300));
  /* the same photo twice must cost ONE file \u2014 content-addressed, or a busy day duplicates every image */
  const gB2 = await req('GET', '/api/db');
  await req('POST', '/api/db', { db: { orders: [{ id: 'PH2', number: 'PH-2', status: 'Detailed', _t: Date.now(),
    lines: [{ id: 'L2', photos: [PNG1] }] }] }, baseRev: gB2.json.rev, delta: true }, 'CAMERA');
  const o2 = ((await req('GET', '/api/db')).json.db.orders || []).filter(o => o.id === 'PH2')[0];
  check('📸 the same photo sent twice is ONE file on disk (content-addressed)',
    o2 && o2.lines[0].photos[0] === ph[0], { first: ph && ph[0], second: o2 && o2.lines[0].photos[0] });
  check('...so the photos folder holds one file, not two', (function(){
    try { return fs.readdirSync(path.join(TMP, 'hub-data', 'photos')).filter(n => n === String(ph[0])).length === 1; } catch (e) { return false; } })());
  /* unreadable junk must not be kept, and must not break the push */
  const gB3 = await req('GET', '/api/db');
  const badPh = await req('POST', '/api/db', { db: { orders: [{ id: 'PH3', number: 'PH-3', status: 'Detailed', _t: Date.now(),
    lines: [{ id: 'L3', photos: ['data:image/png;base64,%%%not-base64%%%'] }] }] }, baseRev: gB3.json.rev, delta: true }, 'CAMERA');
  check('a corrupt inline photo does not break the push', badPh.status === 200);
  const o3 = ((await req('GET', '/api/db')).json.db.orders || []).filter(o => o.id === 'PH3')[0];
  check('📸 ...and corrupt bytes are not kept in the database either', !!o3 && (o3.lines[0].photos || []).every(x => String(x).indexOf('data:') !== 0), o3 && o3.lines[0].photos);

  /* ================= 📒 photos.json — the photo store's own ledger =================
     Owner 2026-08-24, on scale: thousands of photos, several per garment. The ledger answers how many /
     how big / whose without touching the synced DB; the FILES stay the ground truth. */
  console.log(String.fromCharCode(10)+'── 📒 photos.json, the photo store ledger ──');
  const up1 = await req('POST', '/api/photo', { data: PNG1 }, 'CAMERA');
  check('an upload lands and answers an id', up1.status === 200 && up1.json && up1.json.ok && /^ph_/.test(up1.json.id), up1.json);
  const st1 = await req('GET', '/api/photos/stats');
  check('📒 stats counts every file with real byte totals', st1.json && st1.json.ok && st1.json.count >= 2 && st1.json.bytes > 0, st1.json);
  check('...and stats is key-gated like every photo door', (await req('GET', '/api/photos/stats', undefined, 'X', 'wrong-key')).status === 401);
  const lg1 = JSON.parse(fs.readFileSync(path.join(TMP, 'hub-data', 'photos.json'), 'utf8'));
  check('📒 photos.json exists as its own database — one entry per file, naming bytes and the station', !!lg1[up1.json.id] && lg1[up1.json.id].bytes > 0 && lg1[up1.json.id].dev === 'CAMERA', lg1[up1.json.id]);
  check('...and the blobGuard rescue is in the ledger too, marked as arriving by push', !!lg1[String(ph[0])] && lg1[String(ph[0])].dev === 'push', lg1[String(ph[0])]);
  const gph = await req('GET', '/api/photo/' + String(ph[0]));
  check('📸 a blobGuard-rescued 32-hex photo is SERVABLE — the old id pattern refused these outright', gph.status === 200, gph.status);
  fs.unlinkSync(path.join(TMP, 'hub-data', 'photos.json'));
  const st2 = await req('GET', '/api/photos/stats');
  check('📒 a DELETED ledger heals on the next ask — the files are the ground truth, the ledger only describes them', st2.json && st2.json.count === st1.json.count && fs.existsSync(path.join(TMP, 'hub-data', 'photos.json')), st2.json);
  await req('POST', '/api/photo/' + up1.json.id + '/delete');
  const st3 = await req('GET', '/api/photos/stats');
  check('📒 deleting a photo leaves the ledger WITH the file — one fewer of each', st3.json && st3.json.count === st2.json.count - 1 && !fs.existsSync(path.join(TMP, 'hub-data', 'photos', up1.json.id)), st3.json);

  /* ================= 🗄 THE ARCHIVE PASS — retire a settled year, keep it forever, pull it back =================
     Owner 2026-08-24: "make it all infinitely scalable by retiring old data but keeping it available to pull
     back into the loop." This drives the REAL archive-pass.js as a child process against this REAL hub. */
  console.log(String.fromCharCode(10)+'── 🗄 the archive pass: retire · keep · restore ──');
  const OLD = Date.now() - 500 * 86400000;
  const gA = await req('GET', '/api/db');
  await req('POST', '/api/db', { delta:true, baseRev: gA.json.rev, db: {
    orders: [
      { id:'AR1', number:'1-01-01-25-0001', customerId:'ARC1', storeId:1, status:'PickedUp', paymentStatus:'paid', createdAt:OLD, pickedAt:OLD+3600000, _t:OLD, lines:[{ id:'al1', desc:'Old shirt', photos:[] }] },
      { id:'AR2', number:'1-01-01-25-0002', customerId:'ARC1', storeId:1, status:'PickedUp', paymentStatus:'paid', createdAt:OLD, pickedAt:OLD+3600000, _t:OLD, lines:[{ id:'al2' }] },
      { id:'AR3', number:'1-01-02-25-0001', customerId:'ARC1', storeId:1, status:'Split', childOrders:['AR4'], createdAt:OLD, _t:OLD, lines:[] },
      { id:'AR4', number:'1-01-02-25-0002', customerId:'ARC1', storeId:1, status:'PickedUp', paymentStatus:'paid', parentId:'AR3', createdAt:OLD, pickedAt:OLD+7200000, _t:OLD, lines:[{ id:'al4' }] },
      { id:'AR5', number:'1-08-20-26-0031', customerId:'ARC1', storeId:1, status:'PickedUp', paymentStatus:'paid', createdAt:Date.now()-86400000, pickedAt:Date.now()-3600000, _t:Date.now()-3600000, lines:[{ id:'al5' }] }
    ],
    collections: [ { id:'ARC-COLL', orderId:'AR2', customerId:'ARC1', amount:5, status:'open', _t:OLD, ts:OLD } ],
    payments: [ { id:'ARP1', orderId:'AR1', amount:12.5, method:'Cash', _t:OLD } ] } }, 'SEEDER');
  const cpA = require('child_process');
  const passEnv = Object.assign({}, process.env, { OZARK_DATADIR: path.join(TMP, 'hub-data'), OZARK_HUB_PORT: String(PORT), OZARK_HUB_KEY: KEY, OZARK_ARCHIVE_MIN_CUST: '0' });
  let dry = ''; try { dry = cpA.execFileSync(process.execPath, [path.join(__dirname, 'archive-pass.js')], { env: passEnv, encoding: 'utf8' }); } catch (e) { dry = String(e.stdout || '') + String(e.stderr || e.message); }
  check('🗄 the DRY RUN counts the settled family and touches nothing', dry.indexOf('eligible (whole families, every bar cleared): 3') > 0 && dry.indexOf('DRY RUN') > 0, dry.slice(0, 400));
  check('...and the live DB is untouched after it', ((await req('GET', '/api/db')).json.db.orders || []).some(o => o.id === 'AR1'));
  let ap = ''; try { ap = cpA.execFileSync(process.execPath, [path.join(__dirname, 'archive-pass.js'), '--apply'], { env: passEnv, encoding: 'utf8' }); } catch (e) { ap = String(e.stdout || '') + String(e.stderr || e.message); }
  const dbA = (await req('GET', '/api/db')).json.db;
  const liveIds = (dbA.orders || []).map(o => o.id);
  check('🗄 the settled order and the whole Split family are RETIRED from the live DB', liveIds.indexOf('AR1') < 0 && liveIds.indexOf('AR3') < 0 && liveIds.indexOf('AR4') < 0, ap.slice(-400));
  check('⚠️ the order with an OPEN collection stays — money being chased is never retired', liveIds.indexOf('AR2') >= 0);
  check('...and the recent order stays too', liveIds.indexOf('AR5') >= 0);
  check('🪦 tombstones ride the sync so every station deletes its copy', (dbA._tomb || []).some(t => t.c === 'orders' && t.k === 'AR1'));
  check('💰 the payment record STAYS in the live DB — money history is never archived', (dbA.payments || []).some(p => p.id === 'ARP1'));
  check('🗄 the archive file holds the retired order, verified readable', (function(){ try { return fs.readFileSync(path.join(TMP, 'hub-data', 'archive', 'orders-2025.jsonl'), 'utf8').indexOf('AR1') > 0; } catch (e) { return false; } })());
  const aidx = JSON.parse(fs.readFileSync(path.join(TMP, 'hub-data', 'archive', 'index.json'), 'utf8'));
  check('...and the index names the retired three, not the kept two', !!aidx.AR1 && !!aidx.AR3 && !!aidx.AR4 && !aidx.AR2 && !aidx.AR5, Object.keys(aidx));
  const ast = await req('GET', '/api/archive/stats');
  check('🗄 /api/archive/stats answers, key-gated', ast.json && ast.json.ok && ast.json.orders === 3 && (await req('GET', '/api/archive/stats', undefined, 'X', 'wrong')).status === 401, ast.json);
  const afind = await req('GET', '/api/archive/find?number=1-01-01-25');
  check('🗄 find-by-number-prefix returns the retired order in full', afind.json && afind.json.orders.length === 1 && afind.json.orders[0].id === 'AR1' && afind.json.orders[0].lines[0].desc === 'Old shirt', afind.json && afind.json.orders.map(o=>o.id));
  const acid = await req('GET', '/api/archive/find?cid=ARC1');
  check('🗄 find-by-customer returns every retired order they own', acid.json && acid.json.orders.length === 3);
  const aget = await req('GET', '/api/archive/get?id=AR1');
  check('🗄 get-by-id hands back the whole order', aget.json && aget.json.ok && aget.json.order.number === '1-01-01-25-0001');
  /* ↩ pull it back into the loop, exactly as the app does: fresh _t beats the tombstone */
  const back = Object.assign({}, aget.json.order, { _t: Date.now(), archiveHold: Date.now() }); delete back._seq;
  const gRst = await req('GET', '/api/db');
  await req('POST', '/api/db', { delta:true, baseRev: gRst.json.rev, db: { orders: [back] } }, 'RESTORER');
  const dbR = (await req('GET', '/api/db')).json.db;
  check('↩ a restored order is LIVE again — its fresh stamp beats the tombstone through the ordinary merge', (dbR.orders || []).some(o => o.id === 'AR1'));
  let re = ''; try { re = cpA.execFileSync(process.execPath, [path.join(__dirname, 'archive-pass.js'), '--apply'], { env: passEnv, encoding: 'utf8' }); } catch (e) { re = String(e.stdout || '') + String(e.stderr || e.message); }
  check('↩ ...and archiveHold keeps the next pass from re-retiring it for 90 days', ((await req('GET', '/api/db')).json.db.orders || []).some(o => o.id === 'AR1'), re.slice(0, 300));

  /* ================= 📖 /api/books — the public transparency feed ================= */
  console.log(String.fromCharCode(10)+'── 📖 open books: public aggregates, never a name ──');
  const gBk = await req('GET', '/api/db');
  await req('POST', '/api/db', { delta:true, baseRev: gBk.json.rev, db: {
    customers: [ { id:'BKC1', first:'Zebulon', last:'Bookleak', phone:'5015550000', _t: Date.now() } ],
    orders: [ { id:'BKO1', number:'1-08-01-26-0077', customerId:'BKC1', storeId:1, status:'PickedUp', paymentStatus:'paid', createdAt:Date.now()-3*86400000, pickedAt:Date.now()-86400000, _t:Date.now(), lines:[{id:'bkl1'},{id:'bkl2'}] } ],
    payments: [ { id:'BKP1', orderId:'BKO1', amount:23.45, method:'Cash', date:Date.now()-86400000, _t:Date.now() } ] } }, 'SEEDER');
  const bkF = await req('GET', '/api/books', undefined, 'PUBLIC', null);   /* key:null = NO key on the request */
  check('📖 the books feed answers WITHOUT a key — it is the public page\'s door', bkF.status === 200 && bkF.json && bkF.json.ok, bkF.status);
  const ymNow = (function(){ const d=new Date(Date.now()-86400000); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0'); })();
  check('...and carries monthly aggregates the seeded payment is counted in', bkF.json.pos && bkF.json.pos[ymNow] && bkF.json.pos[ymNow].collected >= 23.45, bkF.json.pos && bkF.json.pos[ymNow]);
  check('🔒 NO NAME, PHONE OR ORDER NUMBER LEAKS — aggregates only', bkF.raw.indexOf('Zebulon') < 0 && bkF.raw.indexOf('Bookleak') < 0 && bkF.raw.indexOf('5015550000') < 0 && bkF.raw.indexOf('1-08-01-26-0077') < 0, bkF.raw.slice(0, 200));
  check('...and an Account booking is NOT counted as money collected (the MON-10 lesson)', (function(){
    /* the endpoint filters ^account$ methods — pin it at source so a refactor cannot quietly count receivables as cash */
    return fs.readFileSync(path.join(__dirname, 'hub-server.js'), 'utf8').indexOf("/^account$/i.test(pm.method||'')") >= 0; })());
  /* and the APP side must keep pushing references only \u2014 a source rule so a future change cannot regress quietly */
  check('📸 the app pushes a photo REFERENCE, never the bytes', (function(){
    const src = fs.readFileSync(path.join(__dirname, 'Ozark-POS.html'), 'utf8');
    const i = src.indexOf('function _addPhoto');
    const b2 = src.slice(i, i + 700);
    return i > 0 && b2.indexOf('photoUpload(data)') > 0 && b2.indexOf('l.photos.push(id)') > 0 && b2.indexOf('l.photos.push(data)') < 0; })());
  check('...and it only records the photo AFTER the upload succeeded', (function(){
    const src = fs.readFileSync(path.join(__dirname, 'Ozark-POS.html'), 'utf8');
    const i = src.indexOf('function _addPhoto');
    return src.slice(i, i + 700).indexOf('if(!id)') > 0; })());

  /* ================= 🔢 A REVISION 🔢BER IS ONLY SPENT ONCE THE WORK IS DURABLE =================
     Live on 2026-08-11 the log had five gaps (19377, 19443, 19509, 19535, 19543-44), each immediately before a
     forced checkpoint — i.e. each a push that died between `rev += 1` and the log append, during one of that
     day's 18 restarts. No data was lost (those revisions never committed) but hub-replay.js cannot tell a
     🔢BER NEVER USED from a LOG LINE GONE MISSING, so it refused to rebuild and Phase 4's recovery guarantee
     read as broken. A gap has to mean something. */
  console.log('\n── 🔢 a failed push must not burn a revision ──');
  const revBefore = (await req('GET', '/api/db')).json.rev;
  /* make the delta log impossible to append to: replace the file with a DIRECTORY */
  const dlPath = path.join(TMP, 'hub-data', 'delta-log.jsonl');
  const dlSaved = fs.readFileSync(dlPath, 'utf8');
  fs.unlinkSync(dlPath); fs.mkdirSync(dlPath);
  const gJam = await req('GET', '/api/db');
  const jammed = await req('POST', '/api/db', { db: { customers: [{ id: 'GAPLESS1', first: 'Should', last: 'NotCommit', balance: 1, _t: Date.now() }] },
    baseRev: gJam.json.rev, delta: true }, 'GAPLESS');
  check('🔢 a push whose log line cannot be written is REFUSED, not silently accepted', jammed.status === 500, jammed.json);
  const revAfterFail = (await req('GET', '/api/db')).json.rev;
  check('🔢 ...and the revision number was NOT burnt', revAfterFail === revBefore, { revBefore, revAfterFail });
  check('...the record never reached the database either', !((await req('GET', '/api/db')).json.db.customers || []).some(c => c.id === 'GAPLESS1'));
  /* put the log back and prove the very next push takes the number that was almost lost */
  fs.rmSync(dlPath, { recursive: true, force: true });
  fs.writeFileSync(dlPath, dlSaved);
  const gOk2 = await req('GET', '/api/db');
  const goodRetry = await req('POST', '/api/db', { db: { customers: [{ id: 'GAPLESS1', first: 'Now', last: 'Commits', balance: 1, _t: Date.now() }] },
    baseRev: gOk2.json.rev, delta: true }, 'GAPLESS');
  check('the retry succeeds', goodRetry.status === 200 && goodRetry.json.ok, goodRetry.json);
  check('🔢 ...taking exactly the revision the failed push did not spend', goodRetry.json.rev === revBefore + 1, { revBefore, got: goodRetry.json.rev });
  /* and the log itself must now be gapless across everything this run wrote */
  const gapCheck = (function(){
    const L = fs.readFileSync(dlPath, 'utf8').split('\n').filter(x => x.trim()).map(l => { try { return JSON.parse(l); } catch (e) { return null; } }).filter(Boolean);
    let want = null, holes = [];
    for (const e of L) { if (want !== null && e.rev !== want) holes.push(want + '..' + (e.rev - 1)); want = e.rev + 1; }
    return { lines: L.length, holes: holes };
  })();
  check('🔢 the delta log has NO gaps at all after this run', gapCheck.holes.length === 0, gapCheck);
  const verGapless = runReplay(['--verify']);
  check('🔢 ...so a rebuild still verifies against the live file', verGapless.code === 0, verGapless.out.slice(-400));

  // -- the delta-log is a tamper-evident hash-chain -------------------------------------------------
  {
    console.log('\n-- the delta-log is a hash-chain (no gap, no backward time, no missing/broken hash) --');
    const dl = fs.readFileSync(dlPath, 'utf8').split('\n').filter(x => x.trim()).map(l => JSON.parse(l));
    const body = o => JSON.stringify({ rev:o.rev, ts:o.ts, device:o.device, db:o.db, _tomb:o._tomb, p:o.p });
    const hashOf = o => require('crypto').createHash('sha256').update(body(o)).digest('hex');
    check('every line carries a 64-hex hash and a prev-hash', dl.every(o => typeof o.h === 'string' && o.h.length === 64 && typeof o.p === 'string'));
    check('every hash matches its own line contents', dl.every(o => hashOf(o) === o.h));
    let linked = true; for (let i = 1; i < dl.length; i++) if (dl[i].p !== dl[i-1].h) linked = false;
    check('every line links to the one before it (an unbroken chain)', linked);

    function setBlock(f){ const t = fs.readFileSync(path.join(__dirname, f), 'utf8').replace(/\r\n/g,'\n');
      const a2 = t.indexOf('/* <SET-HASH v1>'), b2 = t.indexOf('/* </SET-HASH v1> */'); return (a2<0||b2<0)?null:t.slice(a2,b2+20); }
    const sbApp = setBlock('Ozark-POS.html'), sbHub = setBlock('hub-server.js');
    check('the transfer-hash block exists in BOTH ends', !!sbApp && !!sbHub);
    check('...and is BYTE-IDENTICAL, so a station computes the same set-hash the hub sent', sbApp === sbHub,
      (sbApp && sbHub) ? ('app ' + sbApp.length + ' vs hub ' + sbHub.length) : '');
  }

  {
    const gA = await req('GET', '/api/db?since=0');
    check('a delta pull carries setHash + setCount', typeof gA.json.setHash === 'number' && typeof gA.json.setCount === 'number', { h: gA.json.setHash, c: gA.json.setCount });
    const sbApp2 = (function(){ const t = fs.readFileSync(path.join(__dirname,'Ozark-POS.html'),'utf8').replace(/\r\n/g,'\n'); const a2=t.indexOf('/* <SET-HASH v1>'),b2=t.indexOf('/* </SET-HASH v1> */'); return t.slice(a2,b2+20); })();
    const SB = {}; new Function('exports', sbApp2 + '\nexports.h=setHashOf; exports.c=setCountOf;')(SB);
    check('the app-side set-hash of the pulled delta EQUALS what the hub sent (the transfer check would pass)',
      SB.h(gA.json.db, gA.json._tomb) === gA.json.setHash && SB.c(gA.json.db) === gA.json.setCount);

    const anc = await req('GET', '/api/anchor');
    check('/api/anchor serves the chain head with NO key (a witness anyone can record)', anc.status === 200 && typeof anc.json.head === 'string' && anc.json.head.length === 64);
    const ancNoKey = await req('GET', '/api/anchor?since=0', null, 'X', null);
    check('...but the LINES since N need the key (they carry business data)', ancNoKey.status === 401);
    const ancLines = await req('GET', '/api/anchor?since=0');
    check('...and with the key it returns the log lines to pull off-droplet', ancLines.status === 200 && Array.isArray(ancLines.json.lines) && ancLines.json.lines.length > 0);
    check('health surfaces chainOk, so a break can never pass unseen', typeof (await req('GET','/api/health')).json.chainOk === 'boolean');
  }

  // -- the verifier NAMES each kind of break (a check that cannot fail is not evidence) -------------
  {
    console.log('\n-- the verifier names a gap, a backward timestamp, and a tampered line --');
    const body = o => JSON.stringify({ rev:o.rev, ts:o.ts, device:o.device, db:o.db, _tomb:o._tomb, p:o.p });
    const hashOf = o => require('crypto').createHash('sha256').update(body(o)).digest('hex');
    const mk = (rev, ts, prev) => { const o = { rev, ts, device:'t', db:{}, _tomb:[], p:prev }; o.h = hashOf(o); return o; };
    const good = []; let prev = '0'.repeat(64);
    for (let r = 1; r <= 3; r++){ const o = mk(r, 1000 + r, prev); good.push(o); prev = o.h; }
    function verify(arr0){ let i0=0; while(i0<arr0.length && !arr0[i0].h) i0++; const arr=arr0.slice(i0);
      let prev = arr.length?arr[0].p:'', lr=null, lt=null;
      for (const o of arr){ const rev=+o.rev;
        if(!o.h) return 'no hash';
        if(hashOf(o)!==o.h) return 'tampered';
        if(o.p!==prev) return 'unlinked';
        if(lr!=null && rev!==lr+1) return 'gap';
        if(lt!=null && (+o.ts)<lt) return 'backward-time';
        prev=o.h; lr=rev; lt=+o.ts; } return 'ok'; }
    check('a clean chain verifies ok', verify(good) === 'ok');
    check('a MISSING revision is caught', ['unlinked','gap'].indexOf(verify([good[0], good[2]])) >= 0);
    check('a BACKWARD timestamp is caught', verify([good[0], mk(2, 500, good[0].h)]) === 'backward-time');
    const tampered = JSON.parse(JSON.stringify(good)); tampered[1].db = { customers:[{id:'x'}] };
    check('a TAMPERED line (contents changed, hash left) is caught', verify(tampered) === 'tampered');
  }

  /* ================= 🚨 DUPLICATE ORDER NUMBERS SCREAM AT MERGE TIME =================
     2026-09-01, launch day: two stations minted 1-09-01-26-0010 sixty-eight seconds apart (the documented
     residual race in genOrderNumber) and nothing said so until the nightly invariant. The hub now checks the
     numbers each push carries and writes the alarm to journal + client-errors the moment a collision lands. */
  console.log('\n── 🚨 a duplicate order number is announced at merge time ──');
  {
    const g0 = await req('GET', '/api/db');
    await req('POST', '/api/db', { delta: true, baseRev: g0.json.rev, db: { orders: [{ id: 'dupA1', number: 'T-DUP-0001', customerId: 'x', storeId: 1, status: 'Received', createdAt: 1, _t: Date.now() * 1000, lines: [] }] } }, 'dup-test');
    const g1 = await req('GET', '/api/db');
    await req('POST', '/api/db', { delta: true, baseRev: g1.json.rev, db: { orders: [{ id: 'dupB2', number: 'T-DUP-0001', customerId: 'y', storeId: 1, status: 'Received', createdAt: 2, _t: Date.now() * 1000 + 1, lines: [] }] } }, 'dup-test');
    let cel = ''; try { cel = fs.readFileSync(path.join(TMP, 'hub-data', 'client-errors.jsonl'), 'utf8'); } catch (e) {}
    check('🚨 the second order wearing an existing number lands in client-errors THAT SECOND',
      cel.indexOf('DUPLICATE ORDER NUMBER T-DUP-0001') > 0);
    check('🚨 ...naming both order ids so the repair knows where to look',
      cel.indexOf('dupA1') > 0 && cel.indexOf('dupB2') > 0);
    check('...and a push carrying a UNIQUE number stays silent', cel.split('DUPLICATE ORDER NUMBER').length === 2);
  }

  /* ── 🔢 the MINT AUTHORITY: the hub is one process, so two stations cannot get the same number from it ── */
  {
    const m1 = await req('POST', '/api/mint', { store: '1', yy: '26', mm: '09', dd: '15' });
    const m2 = await req('POST', '/api/mint', { store: '1', yy: '26', mm: '09', dd: '15' });
    check('🔢 two stations asking the hub get DIFFERENT numbers', m1.json && m2.json && m1.json.n === 1 && m2.json.n === 2 && m1.json.number !== m2.json.number);
    const gm = await req('GET', '/api/db');
    await req('POST', '/api/db', { delta: true, baseRev: gm.json.rev, db: { orders: [{ id: 'mintX', number: '1-09-15-26-0044', customerId: 'x', storeId: 1, status: 'Received', createdAt: 3, _t: Date.now() * 1000 + 9, lines: [] }] } }, 'mint-test');
    const m3 = await req('POST', '/api/mint', { store: '1', yy: '26', mm: '09', dd: '15' });
    check('🔢 the mint can never fall behind a number already pushed by a local fallback', m3.json && m3.json.n === 45);
    const mbad = await req('POST', '/api/mint', { store: 'x' });
    check('🔢 junk parameters are refused, not guessed at', mbad.status === 400);
  }

    /* ================= 🔑 IDEMPOTENCY 🔑S =================
     dupChargeOK asks "did we charge this customer this amount recently" — a heuristic that fails both ways: it
     let an 11-minute-16-second gap through, and a 180-minute window will one day block a customer who
     legitimately returns the same afternoon. A key derived from INTENT has no clock in it at all. */
  console.log('\n── 🔑 the same intent can only be charged once ──');
  const idemFile = path.join(TMP, 'hub-data', 'idempotency.jsonl');
  /* drive the hub's own functions in-process — the real CardConnect is not reachable from a test, and what is
     under test is the GUARD, not the processor */
  const idemProbe = require('child_process').spawnSync(process.execPath, ['-e', `
    process.env.OZARK_HUB_KEY='x';
    const path=require('path'), fs=require('fs');
    const src=fs.readFileSync('hub-server.js','utf8');
    /* pull the three idempotency functions out and run them against a temp DATADIR */
    const i=src.indexOf('const IDEMFILE'), j=src.indexOf('function cpAuthCapture');
    const body=src.slice(i,j);
    const DATADIR=path.join(process.cwd(),'hub-data');
    const f=new Function('path','fs','DATADIR','console', body + '; return {idemCheck,idemFinish,idemLoad};');
    const M=f(path,fs,DATADIR,console);
    const out=[];
    out.push(['first',JSON.stringify(M.idemCheck('monthly|C1|2026-08',{amount:3793}))]);
    out.push(['second-inflight',JSON.stringify(M.idemCheck('monthly|C1|2026-08',{amount:3793}))]);
    M.idemFinish('monthly|C1|2026-08',{status:'approved',auth:'02106A',ref:'003816400410'});
    out.push(['after-finish',JSON.stringify(M.idemCheck('monthly|C1|2026-08',{amount:3793}))]);
    out.push(['different-key',JSON.stringify(M.idemCheck('monthly|C1|2026-09',{amount:3793}))]);
    /* 2026-08-31, Wade Smythe: a cached DECLINE was replayed forever, so a customer who cleared the hold with
       their bank could never be retried — the bank was simply never asked again. */
    M.idemFinish('collect|R1|10457',{status:'declined',message:'Decline',ref:'000093598314'});
    out.push(['declined-retry',JSON.stringify(M.idemCheck('collect|R1|10457',{amount:10457}))]);
    out.push(['declined-retry-inflight',JSON.stringify(M.idemCheck('collect|R1|10457',{amount:10457}))]);
    console.log(JSON.stringify(out));
  `], { cwd: TMP, encoding: 'utf8' });
  let idemOut = [];
  try { idemOut = JSON.parse((idemProbe.stdout || '').trim().split('\n').pop()); } catch (e) {}
  const idemAt = k => { const r = idemOut.filter(x => x[0] === k)[0]; return r ? JSON.parse(r[1]) : {}; };
  check('the first charge of an intent is allowed through', !!idemAt('first').go, idemProbe.stderr && idemProbe.stderr.slice(0, 200));
  check('🔑 a SECOND attempt while the first is still going is REFUSED, not charged', !!idemAt('second-inflight').refuse, idemAt('second-inflight'));
  check('...and says to wait rather than implying something is broken', /already going through/i.test(idemAt('second-inflight').refuse || ''));
  check('🔑 once an answer exists, a retry REPLAYS it and charges nothing', !!idemAt('after-finish').replay, idemAt('after-finish'));
  check('🔑 ...replaying the ORIGINAL authorisation, not a new one', (idemAt('after-finish').replay || {}).auth === '02106A', idemAt('after-finish').replay);
  check('🔑 a genuinely different intent (next month) is NOT blocked', !!idemAt('different-key').go, idemAt('different-key'));
  check('🔁 a DECLINE is never replayed — the retry reaches the bank fresh, because nothing was ever charged',
    !!idemAt('declined-retry').go, idemAt('declined-retry'));
  check('🔁 ...and the retry claims the key again, so the in-flight guard still holds',
    !!idemAt('declined-retry-inflight').refuse, idemAt('declined-retry-inflight'));
  check('the record is on disk, append-only, outside the synced database', fs.existsSync(idemFile));

  /* the wiring: the key has to actually REACH the function that moves money */
  check('🔑 the guard sits on cpAuthCapture — the one place money moves', (function(){
    const src = fs.readFileSync(path.join(__dirname, 'hub-server.js'), 'utf8');
    const i = src.indexOf('function cpAuthCapture');
    return src.slice(i, i + 900).indexOf('idemCheck(_idem') > 0; })());
  check('🔑 ...and the card-on-file charge path passes the key down to it', (function(){
    const src = fs.readFileSync(path.join(__dirname, 'hub-server.js'), 'utf8');
    return /cof: ctx\.cof, cofscheduled: ctx\.cofscheduled, idem: ctx\.idem/.test(src); })());
  check('⚠️ a $0 verification is exempt — keying it would block a legitimate re-test of the same card', (function(){
    const src = fs.readFileSync(path.join(__dirname, 'hub-server.js'), 'utf8');
    const i = src.indexOf('function cpAuthCapture');
    return src.slice(i, i + 900).indexOf("opts.capture !== 'N'") > 0; })());
  check('⚠️ an ERROR is left un-finished — we never got an answer, so a human must look', (function(){
    const src = fs.readFileSync(path.join(__dirname, 'hub-server.js'), 'utf8');
    /* retargeted 2026-09-23: CardPointe's rules now RESOLVE a no-answer by order id first. "Not charged, safe to retry"
       (proven by CardPointe) frees the key like a decline; an UNKNOWN (CardPointe could not say) still stays open for a person. */
    const i = src.indexOf('idemFinish(_idem, result.safeRetry');
    const g = i > 0 ? src.slice(i - 400, i) : '';
    return i > 0 && g.indexOf("result.status === 'approved' || result.status === 'declined' || result.safeRetry") > 0 && g.indexOf("'unknown'") < 0; })());

  /* ================= 🔒 TAMPER-EVIDENT ARCHIVES =================
     The append-only records were append-only BY CONVENTION only — anyone with droplet access could edit one
     line and nothing would notice. A detector that does not detect is worse than none, so this proves it
     catches both shapes of tampering, on a throwaway copy. */
  console.log('\n── 🔒 the archives can prove nobody edited them ──');
  const chainDir = path.join(TMP, 'chaintest');
  fs.mkdirSync(path.join(chainDir, 'hub-data'), { recursive: true });
  fs.copyFileSync(path.join(__dirname, 'hub-chain.js'), path.join(chainDir, 'hub-chain.js'));
  const rec = path.join(chainDir, 'hub-data', 'card-events.jsonl');
  fs.writeFileSync(rec, [1,2,3,4,5].map(i => JSON.stringify({ ts: 1786000000000 + i, action: 'charge', amount: i * 100 })).join('\n') + '\n');
  const runChain = args => { const r = require('child_process').spawnSync(process.execPath, ['hub-chain.js'].concat(args), { cwd: chainDir, encoding: 'utf8' });
    return { code: r.status, out: (r.stdout || '') + (r.stderr || '') }; };
  const sealed = runChain(['--seal']);
  check('sealing chains every line', sealed.code === 0 && /5 new line/.test(sealed.out), sealed.out.slice(-200));
  check('...and writes a head hash to anchor off the machine', fs.existsSync(path.join(chainDir, 'hub-data', 'chain-heads.json')));
  check('🔒 ...and says out loud that the head must be committed to git, or it proves nothing', /COMMIT chain-heads.json TO GIT/.test(sealed.out));
  const v1 = runChain(['--verify']);
  check('an untouched record verifies', v1.code === 0 && /every sealed record is intact/.test(v1.out), v1.out.slice(-200));
  check('🔒 the chain lives ALONGSIDE, never inside — the record stays byte-for-byte what the hub wrote',
    fs.existsSync(rec + '.chain') && fs.readFileSync(rec, 'utf8').indexOf('sha') < 0);
  const cL = fs.readFileSync(rec, 'utf8').split('\n').filter(Boolean);
  const co = JSON.parse(cL[2]); co.amount = 99999; cL[2] = JSON.stringify(co);
  fs.writeFileSync(rec, cL.join('\n') + '\n');
  const v2 = runChain(['--verify']);
  check('🔒 an EDITED line is caught', v2.code !== 0, v2.out.slice(-250));
  check('🔒 ...and the exact line is NAMED, not just "something is wrong"', /line 3 does not match/.test(v2.out), v2.out.slice(-250));
  co.amount = 300; cL[2] = JSON.stringify(co); fs.writeFileSync(rec, cL.join('\n') + '\n');
  check('...restoring the original content verifies again — the hash is of CONTENT, not of when it was read', runChain(['--verify']).code === 0);
  cL.pop(); fs.writeFileSync(rec, cL.join('\n') + '\n');
  const v3 = runChain(['--verify']);
  check('🔒 a REMOVED line is caught as truncation, with the count', v3.code !== 0 && /TRUNCATED/.test(v3.out), v3.out.slice(-250));
  cL.push(JSON.stringify({ amount: 500, action: 'charge', ts: 1786000000005 }));
  fs.writeFileSync(rec, cL.join('\n') + '\n');
  check('⚠️ a record re-serialised with its keys in a different order is NOT tampering — canonical hashing',
    runChain(['--verify']).code === 0);
  check('⚠️ an unsealed record says so rather than claiming to be verified', (function(){
    fs.writeFileSync(path.join(chainDir, 'hub-data', 'trail.jsonl'), JSON.stringify({ ts: 1, kind: 'x' }) + '\n');
    return /not sealed yet, so nothing can be proven/.test(runChain(['--verify']).out); })());
  try { fs.rmSync(chainDir, { recursive: true, force: true }); } catch (e) {}


  /* ── 📱 SETUP CODES — the only unauthenticated route that can hand out a secret ──────────────────────────
     ⚠️ Tested harder than its size warrants, on purpose. A phone with no key cannot authenticate, so
     /api/setup-claim MUST be public — which makes its guards the whole product. Each assertion below is one
     of the five: single use, expiry, throttle, gated minting, and fail-closed. */
  console.log('\n📱 one-time setup codes');
  {
    const mint = await req('POST', '/api/setup-code', { by: 'harness' });
    check('a connected station can mint a code', mint.status === 200 && mint.json && mint.json.ok && /^[0-9A-Z]{6}$/.test(mint.json.code || ''),
      JSON.stringify(mint.json));
    check('⚠️ ...and the code avoids look-alike glyphs, so it survives being read down a phone',
      !/[01OIL]/.test((mint.json && mint.json.code) || 'X'));
    const code = mint.json.code;

    const noKey = await req('POST', '/api/setup-code', { by: 'nobody' }, 'TEST-DEV', 'wrong-key');
    check('⚠️ minting is GATED — a stranger cannot ask the hub to make one', noKey.status === 401);

    const bad = await req('POST', '/api/setup-claim', { code: 'AAAAAA' }, 'TEST-DEV', null);
    check('a wrong code hands out nothing', bad.status === 200 && bad.json && bad.json.ok === false && !bad.json.key);

    const good = await req('POST', '/api/setup-claim', { code: code.toLowerCase() }, 'TEST-DEV', null);
    check('⚠️ the right code hands over the key WITHOUT any key on the request — the phone has none yet',
      good.status === 200 && good.json && good.json.ok === true && good.json.key === KEY);
    check('...and it is case-insensitive, because she is typing it off a screen', good.json.key === KEY);

    const again = await req('POST', '/api/setup-claim', { code: code }, 'TEST-DEV', null);
    check('⚠️ SINGLE USE — the same code cannot connect a second phone',
      again.json && again.json.ok === false && !again.json.key, JSON.stringify(again.json));

    /* ⚠️ EXPIRY, TESTED FOR REAL. My first version of this wrote expired rows into the hub's file — but the
       hub holds them in MEMORY, so that proved nothing and would have passed against a hub with no expiry at
       all. The mint now accepts a shorter (clamped) life, so a second really can be waited out. */
    const short = await req('POST', '/api/setup-code', { by: 'harness', ttlSec: 1 });
    const sf = path.join(TMP, 'hub-data', 'setup-codes.json');
    const rows = JSON.parse(fs.readFileSync(sf, 'utf8'));
    check('⚠️ the codes are stored HASHED — the plaintext exists only in the reply to the station that asked',
      rows.every(r => /^[0-9a-f]{64}$/.test(r.h || '')) && !JSON.stringify(rows).includes(short.json.code));
    check('a fresh code works right now', (await req('POST', '/api/setup-claim', { code: short.json.code }, 'TEST-DEV', null)).json.ok === true);
    const short2 = await req('POST', '/api/setup-code', { by: 'harness', ttlSec: 1 });
    await sleep(1400);
    const stale = await req('POST', '/api/setup-claim', { code: short2.json.code }, 'TEST-DEV', null);
    check('⚠️ ...and the same code a second later is EXPIRED and hands out nothing',
      stale.json && stale.json.ok === false && !stale.json.key, JSON.stringify(stale.json));
    const longer = await req('POST', '/api/setup-code', { by: 'harness', ttlSec: 99999 });
    check('⚠️ a caller cannot ask for a code that lives LONGER than the cap',
      JSON.parse(fs.readFileSync(sf, 'utf8')).every(r => r.exp - r.madeAt <= 15 * 60 * 1000));

    const throttle = [];
    for (let i = 0; i < 8; i++) throttle.push((await req('POST', '/api/setup-claim', { code: 'ZZZZZZ' }, 'TEST-DEV', null)).status);
    check('⚠️ THROTTLED — guessing is shut off long before a billion tries; later attempts get 429',
      throttle.filter(s => s === 429).length >= 2, JSON.stringify(throttle));
    check('...and a legitimate claim is refused while the throttle is up, rather than leaking around it',
      (await req('POST', '/api/setup-claim', { code: longer.json.code }, 'TEST-DEV', null)).status === 429);
  }

  console.log('\n— 📦 the drop box: identified by phone, first name only, never the database —');
  {
    /* the box speaks its OWN header (x-ozark-dropbox-key) — a tiny local requester keeps that explicit */
    const dreq = (p, body, key) => new Promise((res, rej) => {
      const data = JSON.stringify(body || {});
      const r = http.request({ host: '127.0.0.1', port: PORT, path: p, method: 'POST', headers: Object.assign(
        { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
        key === null ? {} : { 'x-ozark-dropbox-key': key || 'dropbox-test-key' }) }, x => {
        let d = ''; x.on('data', c => d += c); x.on('end', () => { let j = null; try { j = JSON.parse(d); } catch (e) {} res({ status: x.statusCode, json: j, raw: d }); });
      });
      r.on('error', rej); r.write(data); r.end();
    });

    /* seed a customer + a business twin on the SAME number — the DANFORTH shape */
    let cur = await req('GET', '/api/db');
    const seedPush = await req('POST', '/api/db', { delta: true, baseRev: cur.json.rev, db: { customers: [
      { id: 'dbc1', first: 'Vince', last: 'Dropper', phone: '9992230011', _t: Date.now() * 1000 },
      { id: 'dbb1', business: 'Dropper Heating', phone: '9992230011', _t: Date.now() * 1000 } ] } });
    check('📦 (fixture) the two drop-box customers landed', seedPush.status === 200, seedPush.json);

    check('📦 no box key on the request → 401', (await dreq('/api/dropbox/lookup', { phone: '9992230011' }, null)).status === 401);
    check('📦 a wrong box key → 401', (await dreq('/api/dropbox/lookup', { phone: '9992230011' }, 'nope')).status === 401);
    check('⚠️ the HUB key does NOT open the box endpoints — the credentials never cross (a stolen box must be worth less than a station)',
      (await dreq('/api/dropbox/lookup', { phone: '9992230011' }, KEY)).status === 401);

    const look = await dreq('/api/dropbox/lookup', { phone: '(999) 223-0011' });
    check('📦 a known phone answers with the FIRST NAME', look.status === 200 && look.json.known === true && look.json.first === 'Vince');
    check('⚠️ ...and NOTHING else — no last name, no ids, ever, on the outdoor wire', look.raw.indexOf('Dropper') < 0 && look.raw.indexOf('dbc1') < 0);
    check('📞 a shared number resolves to the PERSON, never the business (owner: "customer wins")', look.json.first === 'Vince');
    check('📦 an unknown phone answers known:false — and that must read as "new customer", never a refusal',
      (await dreq('/api/dropbox/lookup', { phone: '5015550077' })).json.known === false);

    const ci = await dreq('/api/dropbox/checkin', { phone: '9992230011', store: 1, bags: 2 });
    check('📦 a check-in mints a claim number', ci.status === 200 && /^DB\d{4}-\d+$/.test(ci.json.claim || ''));
    const gi = await dreq('/api/dropbox/checkin', { store: 1 });
    check('📦 a GUEST check-in (no id at all) still succeeds — the box never refuses a drop', gi.status === 200 && !!gi.json.claim);
    await dreq('/api/dropbox/heartbeat', { store: 1, v: 'dbx-test', paper: false });

    const staff = await req('GET', '/api/dropbox');
    check('📦 the staff view is HUB-key gated and carries the customer ids the lookup withheld',
      staff.status === 200 && staff.json.requests.some(r => (r.customerIds || []).indexOf('dbc1') >= 0 && r.first === 'Vince' && r.bags === 2));
    check('📦 ...the guest row is marked guest', staff.json.requests.some(r => r.guest === true));
    check('📦 ...and the box heartbeat is visible, paper warning included', staff.json.boxes && staff.json.boxes['1'] && staff.json.boxes['1'].paper === false);
    check('📦 the keyless health poll counts open drops for the Home flag', (await req('GET', '/api/health', undefined, 'd', null)).json.dropOpen >= 2);
    check('📦 ...but a stranger without the hub key cannot READ them', (await req('GET', '/api/dropbox', undefined, 'd', null)).status === 401);

    const row = staff.json.requests.find(r => r.first === 'Vince');
    await req('POST', '/api/dropbox/resolve', { id: row.id, by: 'harness' });
    check('📦 resolving clears the row and the health count follows',
      !(await req('GET', '/api/dropbox')).json.requests.some(r => r.id === row.id));
    check('⚠️ fail-CLOSED in the source: no OZARK_DROPBOX_KEY configured = every box endpoint refuses (unprovable against this hub, which has one — pinned by the same rule as reqKeyOk)',
      fs.readFileSync(path.join(TMP, 'hub-server.js'), 'utf8').indexOf('function dropKeyOk(req){ if (!DROPKEY) return false;') >= 0);
  }

  console.log('\n— 💾 the backup readout tells WRITTEN apart from PROVEN —');
  {
    /* ⚠️ THE 8/27 BUG: backupState() reported only the weekly verify record's age, so a nightly artifact
       encrypted that same morning read as days stale on the Admin box — a readout failing in the WORRYING
       direction, which trains people to overrule it (the PHY-3 cry-wolf lesson). The artifact's freshness
       must come from the FILE's own mtime, statted fresh on every call, never from any record about it. */
    const b0 = (await req('GET', '/api/health', undefined, 'bk', null)).json.backup;
    check('a hub that has never written an artifact says NOTHING about one — not a fault, not "fresh"',
      !!b0 && b0.artifactAt === undefined && b0.artifactStale === undefined, b0);

    const offDir = path.join(TMP, 'hub-data', 'offsite');
    fs.mkdirSync(offDir, { recursive: true });
    const encFile = path.join(offDir, 'ozark-db.enc');
    fs.writeFileSync(encFile, 'OZARKENC1 not a real backup, just bytes with an mtime');
    fs.writeFileSync(path.join(TMP, 'hub-data', 'backup-verify.json'),
      JSON.stringify({ ok: true, at: Date.now() - 5 * 86400000, counts: { customers: 42 }, invariants: '28/28' }));

    const b1 = (await req('GET', '/api/health', undefined, 'bk', null)).json.backup;
    check('⚠️ a FRESH artifact file yields a FRESH age — read off the mtime, never a stored stamp',
      !!b1 && b1.artifactAgeDays != null && b1.artifactAgeDays < 0.1 && b1.artifactStale === false, b1);
    check('...and artifactAt IS the file time (within a minute of when it was written)',
      !!b1 && Math.abs(b1.artifactAt - Date.now()) < 60000, b1 && b1.artifactAt);
    check('...while the verify keeps its OWN age (5 days) — written and proven are never conflated',
      !!b1 && b1.ok === true && b1.ageDays > 4.5 && b1.ageDays < 5.5 && b1.customers === 42, b1);

    /* negative control — the stale flag has to be able to FIRE, or the fresh reading above proves nothing */
    const old = new Date(Date.now() - 3 * 86400000);
    fs.utimesSync(encFile, old, old);
    const b2 = (await req('GET', '/api/health', undefined, 'bk', null)).json.backup;
    check('⚠️ an artifact not rewritten for 3 nights reads artifactStale — the flag has teeth',
      !!b2 && b2.artifactStale === true && b2.artifactAgeDays > 2.5, b2);
  }

  /* ⚠️ 8/28: the summary used to print HERE, mid-file — every section appended after it (the terminal lease,
     the refund idempotency, the Twilio signatures) ran UNCOUNTED. Failures still failed the exit code, but the
     printed total under-reported by ~37. The summary now prints at the true end. */

  /* ================= TWO WINDOWS UNDER ONE STATION NAME =================
     Live failure 2026-08-18: the Assembly PC ran the POS in Chrome and in the desktop shell at once.
     Different origins, so no shared localStorage and no BroadcastChannel -- and a DIFFERENT station id each,
     so the hub saw two STATIONS rather than two windows and nothing noticed. Scans were overwritten
     repeatedly and a 9-piece order bagged 3+2+3+1 instead of 5+4. The key is the station NAME, because that
     is the only thing that survived across the two origins. */
  console.log("");
  console.log("-- two windows writing under one station name --");
  {
    /* A REFUSED PUSH MUST NEVER LOOK LIKE A MERGE RESULT. The first version of this block passed
       baseRev:null and never read the response -- so the hub refused every push and the assertions below
       failed for a reason they could not name. Same fault the future-stamp clamp test had on 8/14. */
    const mkPush = async (id, name, bye) => {
      const g = await req("GET", "/api/db");
      const r = await req("POST", "/api/db", {
        db: { devices: [{ id: id, name: name, pageAt: Date.now(), farewell: !!bye, _t: Date.now() * 1000 }] },
        baseRev: g.json.rev, delta: true }, id);
      check("push from " + id + " was accepted", r.status === 200 && r.json && r.json.ok, { status: r.status, body: r.json });
      return r;
    };

    let hA = await req("GET", "/api/health", null, "TWIN-A");
    check("a station that has never pushed has no twin", !hA.json.twin, hA.json.twin);

    await mkPush("TWIN-A", "TwinStation");
    hA = await req("GET", "/api/health", null, "TWIN-A");
    check("...and ONE window under a name is still no twin -- the cry-wolf case", !hA.json.twin, hA.json.twin);

    await mkPush("TWIN-B", "TwinStation");
    hA = await req("GET", "/api/health", null, "TWIN-A");
    check("a SECOND id writing under the same NAME is reported to the first", !!(hA.json.twin && hA.json.twin.otherId === "TWIN-B"), hA.json.twin);
    check("...and it names the station, so the banner can say which one", !!(hA.json.twin && hA.json.twin.name === "TwinStation"), hA.json.twin);

    const hB = await req("GET", "/api/health", null, "TWIN-B");
    check("...and the other window is told too -- either one can be the one closed", !!(hB.json.twin && hB.json.twin.otherId === "TWIN-A"), hB.json.twin);

    const hC = await req("GET", "/api/health", null, "TWIN-UNRELATED");
    check("a station with a DIFFERENT name is never dragged in", !hC.json.twin, hC.json.twin);

    /* A FAREWELL IS A HAND-OFF, NOT A RIVAL. tabYield pushes once on its way out; counting that would cry
       wolf on the election working -- the trap the pageAt tripwire beside it already had to learn. */
    await mkPush("TWIN-C", "ByeStation", true);
    await mkPush("TWIN-D", "ByeStation");
    const hD = await req("GET", "/api/health", null, "TWIN-D");
    check("a window that said goodbye is NOT counted as a second window", !hD.json.twin, hD.json.twin);
  }

  /* ================= 💳🔗 THE TERMINAL LEASE (the Mercer double charge, 2026-08-28) =================
     A counter window died two seconds into a $90.75 terminal read. The cancel that closeModal fires never
     ran, the reader stayed ARMED and headless, the customer dipped, and the orphaned session captured with
     nobody listening — two captures at the bank, one in the books. Owner: "if the terminal is running, it is
     because our system is ready for an auth, otherwise it cancels itself."
     The lease: the popup's own HTTP request to the hub IS the liveness signal — it dies in every death mode.
     These tests use a REAL fake terminal on real sockets (boltSrv above); the held authCard response is the
     customer standing at the reader. */
  console.log("");
  console.log("-- the terminal lease: an armed reader belongs to a LIVING popup --");
  {
    const http2 = require('http');
    /* a raw client whose socket the test can kill mid-read — req() can't do that */
    const armCharge = (dev, ctxExtra) => {
      const body = JSON.stringify({ provider: 'cardpointe', amount: 1234, present: true,
        context: Object.assign({ cid: 'LEASECUST', entry: 'present', who: 'Lease Test', store: '' }, ctxExtra || {}) });
      const rq = http2.request({ host: '127.0.0.1', port: PORT, path: '/api/pay/charge', method: 'POST',
        headers: { 'content-type': 'application/json', 'Content-Length': Buffer.byteLength(body), 'x-ozark-key': KEY, 'x-ozark-device': dev } });
      const done = new Promise(resolve => {
        rq.on('response', x => { let b = ''; x.on('data', c => b += c); x.on('end', () => { let j = null; try { j = JSON.parse(b); } catch (e) {} resolve({ status: x.statusCode, json: j }); }); });
        rq.on('error', () => resolve({ status: 0, json: null }));
      });
      rq.write(body); rq.end();
      return { rq, done };
    };
    const waitFor = async (fn, ms) => { const until = Date.now() + (ms || 3000); while (Date.now() < until) { if (fn()) return true; await sleep(50); } return fn(); };
    const payCount = async () => { const g = await req('GET', '/api/db'); return ((g.json.db || {}).payments || []).length; };

    /* 1 — the popup dies mid-read → the HUB cancels the reader, within seconds, no cooperation needed */
    const pays0 = await payCount();
    const a = armCharge('LEASE-STATION');
    check('the reader arms (the fake terminal is holding a read)', await waitFor(() => !!boltState.pending), { pending: !!boltState.pending });
    const cancels0 = boltState.cancels;
    a.rq.destroy();                                              // the window dies: crash, close, power — same socket death
    check('💳🛑 the hub itself frees the reader when the popup dies', await waitFor(() => boltState.cancels > cancels0, 4000), { cancels: boltState.cancels });
    await sleep(300);
    check('...and a cancelled read records NO payment', (await payCount()) === pays0, { pays: await payCount(), pays0 });

    /* 2 — the dip WINS the race: approved while the popup is dead → the hub RECORDS the capture (rule: the
       losing race can never again produce invisible money) */
    const b = armCharge('LEASE-STATION', { orderId: 'LEASEORD' });
    await waitFor(() => !!boltState.pending);
    b.rq.destroy();                                              // die first...
    boltAnswer({ respstat: 'A', retref: 'RRLEASE2', authcode: 'AUTH22', token: '9418594185941877', amount: 1234 });   // ...dip lands anyway, bank approves
    /* ⚠️ waitFor takes a SYNC predicate — an async fn would return a promise, which is truthy instantly and
       waits for nothing (a test that cannot fail). The recovery poll is its own honest loop. */
    let recRow = null; { const until = Date.now() + 5000;
      while (Date.now() < until && !recRow) { const g = await req('GET', '/api/db');
        recRow = ((g.json.db || {}).payments || []).find(p => p && p.hubRecovered && p.txn === 'RRLEASE2') || null;
        if (!recRow) await sleep(150); } }
    check('💳🚨 an approval after the popup died is RECORDED by the hub (the Mercer rule)', !!recRow, recRow);
    check('...with the money joined both ways: amount, customer AND the order it was for', !!recRow && recRow.amount === 12.34 && recRow.customerId === 'LEASECUST' && recRow.orderId === 'LEASEORD', recRow);
    { const g = await req('GET', '/api/db');
      const act = ((g.json.db || {}).activity || []).find(x => x && String(x.type || '').indexOf('Terminal capture recovered') >= 0);
      check('...and the activity log says so LOUDLY, naming the ref', !!act && String(act.detail || '').indexOf('RRLEASE2') >= 0, act); }
    /* 🧾 DURABLE FIRST (2026-09-16): the approval is on its own append-only file BEFORE the hub's front door is even
       tried — a 409 from a busy morning or a restart can no longer lose it (the first version logged '→ 409' as success). */
    { const of = path.join(TMP, 'hub-data', 'orphan-captures.jsonl'); let txt = ''; try { txt = fs.readFileSync(of, 'utf8'); } catch (e) {}
      const rows = txt.split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch (e) { return null; } }).filter(Boolean);
      check('💳🧾 ...and the capture was written to hub-data/orphan-captures.jsonl FIRST — durable even if the push had been refused', rows.some(r => r && r.ref === 'RRLEASE2' && r.payRow && r.payRow.amount === 12.34 && r.payRow.orderId === 'LEASEORD'), rows.map(r => r.ref)); }

    /* 3 — a live popup is never disturbed: the normal path is byte-for-byte what it was */
    const pays2 = await payCount();
    const c2 = armCharge('LEASE-STATION');
    await waitFor(() => !!boltState.pending);
    boltAnswer({ respstat: 'A', retref: 'RRLEASE3', authcode: 'AUTH33', token: '9418594185941878', amount: 1234 });
    const cRes = await c2.done;
    check('a LIVING popup gets its approval delivered exactly as before', cRes.status === 200 && cRes.json && cRes.json.ok === true && cRes.json.result && cRes.json.result.ref === 'RRLEASE3', cRes.json);
    check('...and the hub records NOTHING itself — the app owns the books when it is alive', (await payCount()) === pays2, null);

    /* 4 — one reader, one popup: a second arm while a LIVE popup holds it is refused BY NAME */
    const d1 = armCharge('LEASE-FIRST');
    await waitFor(() => !!boltState.pending);
    const d2 = armCharge('LEASE-SECOND');
    const dRes = await d2.done;
    check('🛑 a second arm on a held reader is refused, naming who holds it', dRes.status === 200 && dRes.json && dRes.json.ok === false && /already in use/i.test((dRes.json.error || '')) && /LEASE-FIRST/.test(((dRes.json.result || {}).message || '')), dRes.json);
    boltAnswer({ respstat: 'A', retref: 'RRLEASE4', authcode: 'AUTH44', token: '9418594185941879', amount: 1234 });
    await d1.done;

    /* the save-card reads share the same lease — pinned at source (their outcome shape is identical) */
    const hubSrc = fs.readFileSync(path.join(__dirname, 'hub-server.js'), 'utf8');
    const scIdx = hubSrc.indexOf("read the card on THIS STORE's terminal → token, no charge");
    check('the save-card terminal reads take the SAME lease', scIdx > 0 && hubSrc.slice(scIdx, scIdx + 1200).indexOf('cptLease(') > 0, null);
    {
    /* ═══ 💳🔎 CARDPOINTE'S RULES FOR AN UNCLEAR ANSWER (owner, 2026-09-23: "are we using cardpointe recommendations for
       processing and integrations? i am sick to my stomach about all these double charges"). Each double so far,
       replayed against the fake terminal + fake CardPointe, must now end with ONE charge or none, and the counter
       must never be told "declined" unless the bank declined. */
    const armRun = async (runId) => { const h = armCharge('CP-RULES', { runId: runId }); await waitFor(() => !!boltState.pending); return { h: h, oid: (boltState.lastBody || {}).orderId }; };
    const inq0 = gwState.inquiries;
    /* A — every read carries its own order id; a clean answer looks nothing up */
    const A1 = await armRun('RUN-A1'); boltAnswer({ respstat: 'A', retref: 'RRCPA1', authcode: 'AUTHA1', token: '9418594185941880', amount: 1234 }); const a1 = await A1.h.done;
    const A2 = await armRun('RUN-A2'); boltAnswer({ respstat: 'A', retref: 'RRCPA2', authcode: 'AUTHA2', token: '9418594185941881', amount: 1234 }); await A2.h.done;
    check('💳🔎 every terminal charge carries a CardPointe order id (CardPointe: a unique orderId on each authCard)', /^OZ[0-9A-Z]{8,17}$/.test(String(A1.oid || '')) && a1.json && a1.json.result && a1.json.result.orderid === A1.oid, { oid: A1.oid, res: a1.json });
    check('...a different one on every charge, and a clean answer makes no lookup', !!A2.oid && A2.oid !== A1.oid && gwState.inquiries === inq0, { a: A1.oid, b: A2.oid, lookups: gwState.inquiries - inq0 });
    /* B — Garavito 9/22 / Cretu 9/09: the reader said "Authorization Cancelled" but CardPointe had charged it */
    const B = await armRun('RUN-B'); gwState.orders[B.oid] = { respstat: 'A', retref: 'RRGAONA', amount: '12.34' }; const vB = gwState.voidsByOrder;
    boltAnswer({ errorCode: 1, errorMessage: 'Authorization Cancelled' }); const b1 = await B.h.done; const rB = (b1.json || {}).result || {};
    check('💳🔎 "Authorization Cancelled" but CardPointe charged it: VOIDED by order id, and the counter hears "not charged, safe to retry" (Garavito 9/22)', rB.safeRetry === true && rB.voided === true && gwState.orders[B.oid].voided === true && gwState.voidsByOrder === vB + 1, b1.json);
    check('...and the counter is NOT told "declined"', rB.status !== 'declined' && !/declin/i.test(rB.message || ''), rB);
    /* C — the reader never answered (the test's 3-second window runs out) but CardPointe approved it: that IS the payment */
    const C = await armRun('RUN-C'); gwState.orders[C.oid] = { respstat: 'A', retref: 'RRLATE', amount: '12.34' };
    const c1 = await C.h.done; boltState.pending = null; const rC = (c1.json || {}).result || {};
    check('💳🔎 the reader never answered but CardPointe approved it: the counter gets the APPROVAL, found by order id (never a re-run)', c1.json && c1.json.ok === true && rC.status === 'approved' && rC.ref === 'RRLATE' && rC.orderid === C.oid, c1.json);
    /* D — the reader never answered and CardPointe has nothing: a harmless void, then "not charged, safe to retry" */
    const D = await armRun('RUN-D'); const d1 = await D.h.done; boltState.pending = null; const rD = (d1.json || {}).result || {};
    check('💳🔎 no answer and CardPointe has no charge: "not charged, safe to retry" (looked up twice, then a harmless void)', rD.safeRetry === true && rD.status !== 'declined' && !rD.voided, d1.json);
    /* E — CardPointe cannot be reached: voidByOrderId THREE times (their rule), then UNKNOWN: do not run it again */
    const Ex = await armRun('RUN-E'); gwState.down = true; const vE = gwState.voidsByOrder;
    const e1 = await Ex.h.done; boltState.pending = null; gwState.down = false; const rE = (e1.json || {}).result || {};
    check('💳🔎 CardPointe unreachable: voidByOrderId sent THREE times, then status UNKNOWN: the counter must not re-run it', rE.status === 'unknown' && /do not run/i.test(rE.message || '') && gwState.voidsByOrder === vE + 3, { res: rE, voids: gwState.voidsByOrder - vE });
    /* F — Hythe 9/18: the cashier pressed Cancel, and the approval landed anyway */
    const F = await armRun('RUN-F'); gwState.orders[F.oid] = { respstat: 'A', retref: 'RRHICE', amount: '12.34' };
    boltState.cancelKeepsPending = true;
    const fc = await req('POST', '/api/pay/cancel', { provider: 'cardpointe', store: '' });
    boltState.cancelKeepsPending = false;
    boltAnswer({ respstat: 'A', retref: 'RRHICE', authcode: 'AUTHF', token: '9418594185941882', amount: 1234 });
    const f1 = await F.h.done; const rF = (f1.json || {}).result || {};
    check('💳🔎 approved AFTER the cashier pressed Cancel: VOIDED by order id, never left standing (Hythe 9/18)', fc.status === 200 && rF.voided === true && rF.safeRetry === true && gwState.orders[F.oid].voided === true, { cancel: fc.json, res: f1.json });
    /* G — a bank decline is still a decline: no lookup, no void */
    const G = await armRun('RUN-G'); const iG = gwState.inquiries, vG = gwState.voidsByOrder;
    boltAnswer({ respstat: 'C', respcode: '05', resptext: 'Do not honor', retref: 'RRDEC', token: '9418594185941883', amount: 1234 });
    const g1 = await G.h.done; const rG = (g1.json || {}).result || {};
    check('...a BANK decline is still a decline: no lookup, no void', rG.status === 'declined' && gwState.inquiries === iG && gwState.voidsByOrder === vG, g1.json);
    /* H — the counter that lost the answer asks for it by run id */
    const hr = await req('POST', '/api/pay/run-result', { provider: 'cardpointe', runId: 'RUN-C' });
    const hu = await req('POST', '/api/pay/run-result', { provider: 'cardpointe', runId: 'NEVER-RAN' });
    check('💳🔎 a counter whose connection dropped asks for its run by id, and gets the real answer', hr.json && hr.json.ok && hr.json.result && hr.json.result.ref === 'RRLATE' && hu.json && hu.json.unknownRun === true, { hr: hr.json, hu: hu.json });
    /* I — a saved/keyed card through the gateway: no answer in time, but CardPointe approved it */
    const iRes = await req('POST', '/api/pay/charge', { provider: 'cardpointe', amount: 777, token: '94185941HANG4242', context: { cid: 'GWHANG', store: '', exp: '1230' } });
    const rI = (iRes.json || {}).result || {};
    check('💳🔎 a gateway charge that timed out but went through comes back APPROVED by order id (never re-run)', rI.status === 'approved' && !!rI.orderid && gwState.orders[rI.orderid] && gwState.orders[rI.orderid].respstat === 'A', iRes.json);
    /* K — a terminal that refuses the order id: the SAME charge goes again without it; the shop keeps taking cards */
    const K = await armRun('RUN-K'); boltAnswer({ errorCode: 1, errorMessage: "Invalid value for param: 'orderId'" });
    await waitFor(() => !!boltState.pending && !((boltState.lastBody || {}).orderId)); const kBody = boltState.lastBody || {};
    boltAnswer({ respstat: 'A', retref: 'RRNOOID', authcode: 'AUTHK', token: '9418594185941884', amount: 1234 }); const k1 = await K.h.done; const rK = (k1.json || {}).result || {};
    check('💳🔎 a terminal that REFUSES the order id: the same charge goes again without it and is approved (cards never stop)', !!K.oid && !kBody.orderId && rK.status === 'approved' && rK.ref === 'RRNOOID', { first: K.oid, second: kBody, res: k1.json });
    /* J — the card log keeps the order id, and a resolution row says how each unclear answer ended */
    { let txt = ''; try { txt = fs.readFileSync(path.join(TMP, 'hub-data', 'card-events.jsonl'), 'utf8'); } catch (e) {}
      const rows = txt.split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch (e) { return null; } }).filter(Boolean);
      check('💳🔎 the card log records the order id and how each unclear answer was resolved', rows.some(r => r.action === 'resolve' && r.orderid === B.oid && /void/.test(r.via || '')) && rows.some(r => r.action === 'resolve' && r.orderid === C.oid && r.status === 'approved'), rows.filter(r => r.action === 'resolve').slice(-4)); }
    }
  }
  try { gwState.hangs.forEach(h => { try { h.destroy(); } catch (e) {} }); } catch (e) {}
  try { boltSrv.close(); } catch (e) {}

  /* ================= ↩🔑 REFUND IDEMPOTENCY (8/28 readiness review) =================
     Refunds had ZERO retry protection and ~zero live reps. These are their first end-to-end reps: a REAL
     fake gateway (gwSrv above) counts every refund that reaches the processor — the number a replay must
     never move. */
  console.log("");
  console.log("-- refunds: the same intent can only reach the processor once --");
  {
    const rf = (body) => req('POST', '/api/pay/refund', body);
    /* 1 — first refund goes through and is approved by the fake gateway */
    const r1 = await rf({ provider: 'cardpointe', ref: 'ORIG1', amount: 1234, idem: 'refund|REQ1|1234' });
    check('a keyed refund reaches the gateway and approves', r1.status === 200 && r1.json && r1.json.ok === true && gwState.refunds === 1, { r1: r1.json, hits: gwState.refunds });
    /* 2 — the SAME intent again: the first answer replays, the processor is NOT asked twice */
    const r2 = await rf({ provider: 'cardpointe', ref: 'ORIG1', amount: 1234, idem: 'refund|REQ1|1234' });
    check('↩🔑 the same refund intent REPLAYS its first answer', r2.json && r2.json.ok === true && r2.json.result && r2.json.result.idempotentReplay === true, r2.json);
    check('...and the processor was NOT asked a second time', gwState.refunds === 1, { hits: gwState.refunds });
    /* 3 — control: a DIFFERENT intent is not blocked by the wall (the wall is the key, not the endpoint) */
    const r3 = await rf({ provider: 'cardpointe', ref: 'ORIG2', amount: 900, idem: 'refund|REQ2|900' });
    check('a different refund intent still goes through', r3.json && r3.json.ok === true && gwState.refunds === 2, { hits: gwState.refunds });
    /* 4 — an IN-FLIGHT intent is refused by name, not silently doubled: the gateway HOLDS the first */
    const p4 = rf({ provider: 'cardpointe', ref: 'GWHOLD', amount: 555, idem: 'refund|REQ4|555' });
    await new Promise((res) => { const until = Date.now() + 3000; (function poll(){ if (gwState.hold || Date.now() > until) return res(); setTimeout(poll, 50); })(); });
    const r5 = await rf({ provider: 'cardpointe', ref: 'GWHOLD', amount: 555, idem: 'refund|REQ4|555' });
    check('↩🛑 a refund already IN FLIGHT refuses the retry outright', r5.json && r5.json.ok === false && r5.json.result && r5.json.result.idempotentRefusal === true, r5.json);
    check('...and the held first attempt is still the only one at the processor', gwState.refunds === 3, { hits: gwState.refunds });
    if (gwState.hold) { const h = gwState.hold; gwState.hold = null; h.writeHead(200, { 'content-type': 'application/json' }); h.end(JSON.stringify({ respstat: 'A', retref: 'RFNDH', authcode: 'RAH', amount: '5.55' })); }
    await p4;
    /* 5 — an UNkeyed refund still works: old builds and hand-run tools pass no idem and must not break */
    const r6 = await rf({ provider: 'cardpointe', ref: 'ORIG3', amount: 100 });
    check('an unkeyed refund (old build) still goes through unchanged', r6.json && r6.json.ok === true && gwState.refunds === 4, { hits: gwState.refunds });
  }
  /* ================= 🚦 ONE FULL PULL AT A TIME + ONE PARSE PER REVISION =================
     Owner 2026-09-17, after the droplet OOM-killed the hub three times in ten minutes: "hub should rotate
     through its receipts and control the thrashing... make the hub update each station one at a time." */
  console.log("");
  console.log("-- full pulls: one station downloads at a time, and the parse is shared --");
  {
    /* a station that asks for the whole database and then does NOT read the answer — the body stays in flight */
    /* ⚠️ WHAT THIS CAN AND CANNOT PROVE HERE. The turnstile shuts for as long as the answer is in flight, and
       over loopback a whole database flushes in a single write — so a second request never actually lands
       mid-download on this machine, however big the fixture. It is real for a counter pulling 7 MB over the
       internet, which is where the stampede happened (2026-09-17: three OOM kills in ten minutes). Rather than
       bend the hub to make a green light here, these pin the parts that ARE testable — the door exists and is
       released on finish/close, a delta is never queued behind it, and the shared parse cannot go stale — and
       the queue itself is watched live through /api/health's fullPulls / fullPullWaits counters. */
    const full1 = await req('GET', '/api/db');
    check('🚦 a full pull is served whole when nobody else is downloading', full1.status === 200 && full1.json && full1.json.ok === true && !full1.json.busy && !!full1.json.db, full1.json && { busy: full1.json.busy });
    const delta1 = await req('GET', '/api/db?since=0');
    check('🚦 ...and a small delta pull never queues behind a full one', delta1.status === 200 && delta1.json && delta1.json.ok === true && delta1.json.delta === true && !delta1.json.busy, delta1.json && { delta: delta1.json.delta, busy: delta1.json.busy });
    { const src = fs.readFileSync(path.join(__dirname, 'hub-server.js'), 'utf8');
      const seg = src.slice(src.indexOf('ONE STATION AT A TIME FOR A FULL PULL'), src.indexOf('ONE STATION AT A TIME FOR A FULL PULL') + 2200);
      check('🚦 the turnstile is there: a waiting station is told busy with the revision, and the door opens on finish OR close (never stuck)',
        seg.indexOf('busy:true') > 0 && seg.indexOf("res.on('finish', _pullDone)") > 0 && seg.indexOf("res.on('close', _pullDone)") > 0 && seg.indexOf('FULLPULL_MAX_MS') > 0, seg.slice(0, 80));
      check('🧠 and every reader shares ONE parse per revision (readDBShared), while the merge keeps its own copy',
        src.indexOf('function readDBShared()') > 0 && src.indexOf('const raw = readDBShared();') > 0 && src.indexOf("const key = rev + ':' + savedAt;") > 0); }
    const h = await req('GET', '/api/health');
    check('🚦 the hub reports how many full pulls it served and how many it asked to wait — the live view of the queue', h.json && typeof h.json.fullPulls === 'number' && h.json.fullPulls > 0 && typeof h.json.fullPullWaits === 'number', h.json && { served: h.json.fullPulls, waits: h.json.fullPullWaits });
    /* the shared parse must not go stale: a push changes the file, the next full pull shows it */
    const hh = await req('GET', '/api/health');
    await req('POST', '/api/db', { db: { customers: [{ id: 'SHAREDC1', first: 'Shared', last: 'Parse', _t: Date.now()*1000 }] }, delta: true, baseRev: hh.json.rev });
    const fresh = await req('GET', '/api/db');
    check('🧠 the shared copy is dropped the moment a push changes the file — a full pull is never stale',
      !!(fresh.json && fresh.json.db && (fresh.json.db.customers||[]).some(c => c && c.id === 'SHAREDC1')), fresh.json && fresh.json.rev);
  }

  /* ================= 💵 PAY YOUR BALANCE BY LINK (owner 2026-09-17) =================
     The hub charges a fixed amount ONCE for a link, refuses a link whose customer paid another way after it was
     sent, retires an older link when a newer one is sent, and hands paid links to the POS to record. Real sockets,
     the fake gateway above counting every auth that reaches the "processor". */
  console.log("");
  console.log("-- pay links: one fixed charge, never on top of another payment --");
  {
    const preq = (method, pth, body) => new Promise((res, rej) => {   /* public calls from a customer phone: own IP so the 20/min public limit is not shared with other sections */
      const data = body === undefined ? null : JSON.stringify(body);
      const r = http.request({ host: '127.0.0.1', port: PORT, path: pth, method, headers: Object.assign({ 'x-forwarded-for': '10.77.0.' + (1 + Math.floor(Math.random()*200)) }, data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}) }, x => {
        let d = ''; x.on('data', c => d += c); x.on('end', () => { let j = null; try { j = JSON.parse(d); } catch (e) {} res({ status: x.statusCode, json: j }); }); });
      r.on('error', rej); if (data) r.write(data); r.end(); });
    const mk = (cid, cents) => req('POST', '/api/paylink/create', { cid: cid, name: 'Gil', phone: '5015550081', via: 'sms', store: 2, amountCents: cents, desc: 'test balance' });
    const noKey = await req('POST', '/api/paylink/create', { cid: 'PLC1', phone: '5015550081', via: 'sms', amountCents: 1533 }, undefined, null);
    check('💵 creating a pay link needs the hub key', noKey.status === 401, noKey.status);
    const bad = await mk('PLC1', 0);
    check('💵 a $0 (or silly) amount is refused', bad.json && bad.json.ok === false, bad.json);
    const a = await mk('PLC1', 1533);
    const kA = a.json && a.json.k;
    check('💵 a pay link is created with a link to pay.html', a.json && a.json.ok === true && /\/pay\.html\?k=pl/.test(a.json.link || ''), a.json);
    const info = await preq('GET', '/api/paylink/info?k=' + kA);
    check('💵 the customer page learns the amount and gets the processor tokenizer (pay.html itself refuses any host but *.cardconnect.com) and never the customer id or phone', info.json && info.json.ok === true && info.json.amount === 1533 && /\/itoke\/ajax-tokenizer\.html/.test(info.json.tokenizer || '') && !('cid' in info.json) && !('phone' in info.json), info.json);
    const auth0 = gwState.auths;   /* counted from here: earlier sections (the CardPointe-rules proofs, 9/23) also charge the fake gateway */
    const noConsent = await preq('POST', '/api/paylink/submit', { k: kA, token: '9418594164541111', expiry: '1230' });
    check('💵 no authorization box → nothing charged', noConsent.json && noConsent.json.ok === false && gwState.auths === auth0, { j: noConsent.json, auths: gwState.auths });
    const dec = await preq('POST', '/api/paylink/submit', { k: kA, token: 'DECLINE0000001111', expiry: '1230', consent: true });
    check('💵 a declined card says so, charges nothing, and the link stays payable', dec.json && dec.json.ok === false && /declined/i.test(dec.json.error || '') && gwState.auths === auth0 + 1, dec.json);
    const paid = await preq('POST', '/api/paylink/submit', { k: kA, token: '9418594164544242', expiry: '1230', postal: '71913', consent: true });
    check('💵 a good card pays the FIXED amount once', paid.json && paid.json.ok === true && paid.json.amount === 1533 && gwState.auths === auth0 + 2, { j: paid.json, auths: gwState.auths });
    const again = await preq('POST', '/api/paylink/submit', { k: kA, token: '9418594164544242', expiry: '1230', consent: true });
    check('💵🔑 paying the same link again charges NOTHING more — it is already paid', again.json && again.json.ok === false && again.json.paid === true && gwState.auths === auth0 + 2, { j: again.json, auths: gwState.auths });
    const pend = await req('GET', '/api/paylink/pending');
    const row = pend.json && (pend.json.paid || []).find(x => x.k === kA);
    check('💵 the POS sees the paid link with the amount and the processor ref — never a token', !!row && row.amount === 1533 && /^AUTH/.test(row.ref || '') && !('token' in row), row);
    await req('POST', '/api/paylink/resolve', { k: kA });
    const pend2 = await req('GET', '/api/paylink/pending');
    check('💵 once recorded (resolved) it leaves the queue', !((pend2.json && pend2.json.paid) || []).some(x => x.k === kA), pend2.json);
    /* 🧾 owner 9/28: a link from A/R Collect pays only the TICKED invoices — the hub keeps their ids and hands them back */
    const sl = await req('POST', '/api/paylink/create', { cid: 'PLC9', name: 'Sel', phone: '5015550081', via: 'sms', store: 2, amountCents: 2000, orderIds: ['o1', 'o2'], other: false });
    await preq('POST', '/api/paylink/submit', { k: sl.json && sl.json.k, token: '9418594164544242', expiry: '1230', consent: true });
    const slp = await req('GET', '/api/paylink/pending'); const slRow = ((slp.json && slp.json.paid) || []).find(x => x.k === (sl.json && sl.json.k));
    check('🧾 a pay link for ticked invoices comes back from the queue with exactly those invoice ids', !!slRow && JSON.stringify(slRow.orderIds) === '["o1","o2"]' && slRow.other === false, slRow);
    check('🧾 ...and a whole-balance link still carries none (every link before 9/28)', row && row.orderIds === null, row);
    await req('POST', '/api/paylink/resolve', { k: sl.json && sl.json.k });
    /* a newer link retires the older one */
    const b1 = await mk('PLC2', 2000), b2 = await mk('PLC2', 2500);
    const oldInfo = await preq('GET', '/api/paylink/info?k=' + (b1.json && b1.json.k));
    check('💵 sending a newer link RETIRES the older one for that customer', oldInfo.json && oldInfo.json.ok === false && /replaced/i.test(oldInfo.json.error || ''), oldInfo.json);
    /* paid another way after the link was sent → refused, nothing charged */
    let pushed = null;
    for (let i = 0; i < 5 && !(pushed && pushed.json && pushed.json.ok); i++) {   /* the hub refuses a push against a stale baseRev — re-read and retry, or the guard is never actually exercised */
      const h = await req('GET', '/api/health');
      pushed = await req('POST', '/api/db', { db: { payments: [{ id: 'PLPAY1', customerId: 'PLC2', orderId: null, amount: 25, method: 'Cash', date: Date.now() + 1000, _t: Date.now()*1000 }] }, delta: true, baseRev: h.json.rev });
    }
    let seen = false;
    for (let i = 0; i < 20 && !seen; i++) { const g = await req('GET', '/api/db'); seen = !!(g.json && g.json.db && (g.json.db.payments || []).some(x => x && x.id === 'PLPAY1')); if (!seen) await sleep(150); }
    check('💵 (setup) the other-way payment really reached the hub — and reads back from it', !!(pushed && pushed.json && pushed.json.ok) && seen, { push: pushed && (pushed.json || pushed.status), seen: seen });
    const staleInfo = await preq('GET', '/api/paylink/info?k=' + (b2.json && b2.json.k));
    check('💵🛑 the hub itself sees the other-way payment — the link is no longer payable', staleInfo.json && staleInfo.json.ok === false && /balance changed/i.test(staleInfo.json.error || ''), staleInfo.json);
    const before = gwState.auths;
    const stale = await preq('POST', '/api/paylink/submit', { k: b2.json && b2.json.k, token: '9418594164544242', expiry: '1230', consent: true });
    const fz = await req('POST', '/api/paylink/create', { cid: 'PLC3', name: 'Fee', phone: '5015550081', via: 'sms', store: 2, amountCents: 1545, feeCents: 45 });
    const fzi = await preq('GET', '/api/paylink/info?k=' + (fz.json && fz.json.k));
    check('💵🧾 a card fee inside the amount reaches the page so it can be DISCLOSED (surcharge rule)', fzi.json && fzi.json.ok === true && fzi.json.amount === 1545 && fzi.json.fee === 45, fzi.json);
    const payPage = fs.readFileSync(path.join(__dirname, 'pay.html'), 'utf8');
    check('💵⚖️ pay.html carries the full legal terms the card page has: Bross Inc. d/b/a, all three phone numbers, Arkansas law, authorization, electronic consent, errors, a dated revision', ['Bross Inc.', '(870)&nbsp;555-0032', '(501)&nbsp;555-0030', '(501)&nbsp;555-0031', 'laws of the State of Arkansas', '1. Authorization', 'Electronic consent', 'Questions, errors', 'Last updated', 'PCI DSS', 'does not keep your card on file', 'feeLegal'].every(x => payPage.indexOf(x) >= 0));
    check('💵⚖️ ...and it never claims the route is free (free only inside Hot Springs city limits)', !/free pickup/i.test(payPage));
    check('💵🛑 a customer who paid ANOTHER WAY after the link was sent cannot pay it on top — nothing charged', stale.json && stale.json.ok === false && /balance changed/i.test(stale.json.error || '') && gwState.auths === before, { j: stale.json, auths: gwState.auths });
  }
  try { gwSrv.close(); } catch (e) {}

  /* ================= 📵🔏 TWILIO WEBHOOK SIGNATURES (8/28 readiness review) =================
     The two webhook POSTs were open to anyone: forged START re-enables texting an opted-out customer, a
     forged "customer message" plants instructions in the POS inbox. A SECOND hub is booted with a Twilio
     token configured (the main child has none — with no token everything is accepted, which these tests also
     pin), and driven with real signed and forged posts. */
  console.log("");
  console.log("-- Twilio webhooks: only Twilio's own signature gets in --");
  {
    const TOK = 'testtoken-sig';
    const TMP2 = fs.mkdtempSync(path.join(os.tmpdir(), 'ozark-twsig-'));
    fs.copyFileSync(path.join(__dirname, 'hub-server.js'), path.join(TMP2, 'hub-server.js'));
    const PORT2 = PORT + 1;   /* PORT was proven free; +1 is close enough for a 3-second child — a bind failure fails the boot check loudly */
    const PUB = 'https://hub.example.com';
    /* 📬 a fake SMRT on a real socket — the migration forwarder must hand it a copy of every VERIFIED inbound,
       re-signed for ITS url, and never a forgery */
    const smrtState = { got: [] };
    const smrtSrv = require('http').createServer((rq2, rs2) => { let b = ''; rq2.on('data', c => b += c); rq2.on('end', () => {
      smrtState.got.push({ body: b, sig: String(rq2.headers['x-twilio-signature'] || ''), url: rq2.url });
      rs2.writeHead(200, { 'content-type': 'text/xml' }); rs2.end('<Response></Response>'); }); });
    await new Promise(r => smrtSrv.listen(0, '127.0.0.1', r));
    const SMRTURL = 'http://127.0.0.1:' + smrtSrv.address().port + '/api/twilio/incoming-sms';
    const c2 = spawn(process.execPath, ['hub-server.js'], { cwd: TMP2, stdio: ['ignore', 'pipe', 'pipe'],
      env: Object.assign({}, process.env, { OZARK_PORT: String(PORT2), OZARK_HUB_KEY: KEY, OZARK_TWILIO_SID: 'ACtest', OZARK_TWILIO_TOKEN: TOK, OZARK_TWILIO_FROM: '+15015550000', OZARK_PUBLIC_URL: PUB, OZARK_SMS_FORWARD_URL: SMRTURL }) });
    let log2 = ''; c2.stdout.on('data', d => log2 += d); c2.stderr.on('data', d => log2 += d);
    const req2 = (method, p, body, headers) => new Promise((res2, rej2) => {
      const data = body === undefined ? null : String(body);
      const r = http.request({ host: '127.0.0.1', port: PORT2, path: p, method, headers: Object.assign({ 'x-ozark-key': KEY, 'x-ozark-device': 'TWSIG' },
        data ? { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(data) } : {}, headers || {}) }, x => {
        let d = ''; x.on('data', c => d += c); x.on('end', () => { let j = null; try { j = JSON.parse(d); } catch (e) {} res2({ status: x.statusCode, json: j, raw: d }); });
      });
      r.on('error', rej2); if (data) r.write(data); r.end();
    });
    let up = false; for (let i = 0; i < 60; i++) { try { const h = await req2('GET', '/api/health'); if (h.json && h.json.ok) { up = true; break; } } catch (e) {} await sleep(100); }
    check('the signature-test hub boots', up, log2.slice(-300));
    if (up) {
      /* the same algorithm Twilio uses: base64(HMAC-SHA1(token, url + sorted key+value pairs)) */
      const twSign = (url, params) => { const ks = Object.keys(params).sort(); return require('crypto').createHmac('sha1', TOK).update(url + ks.map(k => k + params[k]).join('')).digest('base64'); };
      const form = (params) => Object.keys(params).map(k => encodeURIComponent(k) + '=' + encodeURIComponent(params[k])).join('&');
      const stopParams = { From: '+15015551234', Body: 'STOP' };
      /* 1 — an UNSIGNED forgery is refused and records nothing */
      const f1 = await req2('POST', '/api/sms/inbound', form(stopParams));
      const o1 = await req2('GET', '/api/sms/optout');
      check('📵🔏 an unsigned webhook post is refused (403)', f1.status === 403, f1.status);
      check('...and records NO opt-out', o1.json && (o1.json.optout || []).length === 0, o1.json);
      /* 2 — a WRONG signature is refused too (not just a missing header) */
      const f2 = await req2('POST', '/api/sms/inbound', form(stopParams), { 'X-Twilio-Signature': 'AAAAAAAAAAAAAAAAAAAAAAAAAAA=' });
      check('📵🔏 a forged signature is refused', f2.status === 403, f2.status);
      /* 3 — the REAL signature gets in and the STOP lands */
      const sig = twSign(PUB + '/api/sms/inbound', stopParams);
      const f3 = await req2('POST', '/api/sms/inbound', form(stopParams), { 'X-Twilio-Signature': sig });
      const o3 = await req2('GET', '/api/sms/optout');
      check("📵 Twilio's own signature is accepted", f3.status === 200, { status: f3.status, raw: f3.raw.slice(0, 80) });
      check('...and the STOP is recorded', o3.json && (o3.json.optout || []).some(x => x.phone === '5015551234'), o3.json);
      /* 4 — the status callback wears the same lock */
      const spar = { MessageSid: 'SMtest1', MessageStatus: 'delivered' };
      const f4 = await req2('POST', '/api/sms/status', form(spar));
      const f5 = await req2('POST', '/api/sms/status', form(spar), { 'X-Twilio-Signature': twSign(PUB + '/api/sms/status', spar) });
      check('📵🔏 an unsigned status callback is refused; a signed one lands', f4.status === 403 && f5.status === 204, { f4: f4.status, f5: f5.status });
      /* 5 — the refusal log names the fix, not just the refusal */
      check('...and the refusal log tells a human exactly what to check', log2.indexOf('does not match a host this hub answers on') >= 0, null);
      /* 6 — 📬 THE MIGRATION FORWARDER (owner 8/31: "or both is fine"): every VERIFIED inbound is copied to
         the old system, re-signed for ITS url; a forgery is never laundered onward; a dead target never
         costs us the message */
      await sleep(400);   /* the forward is fire-and-forget — give the copies a beat to land */
      const fwd = smrtState.got.filter(g => g.body.indexOf('Body=STOP') >= 0);
      check('📬 the VERIFIED inbound was copied to the old system, body intact', fwd.length >= 1, smrtState.got.length);
      if (fwd.length) {
        const expSig = require('crypto').createHmac('sha1', TOK).update(SMRTURL + 'BodySTOPFrom+15015551234').digest('base64');
        check('📬 ...re-signed for the TARGET url (SMRT validates against the same account token)', fwd[0].sig === expSig, { got: fwd[0].sig, want: expSig });
      }
      check('📬 the two FORGED posts were never forwarded — a relay must not launder a forgery', smrtState.got.length === fwd.length, smrtState.got.map(g => g.body.slice(0, 40)));
      /* 6b — 📬 a CLEAR YES is OUR conversation: it is processed here and NEVER forwarded — live within the
         hour of the flip, the owner's test "Yes" woke SMRT's day-picker bot on top of our confirmation */
      const yesParams = { From: '+15015551236', Body: 'Yes' };
      const fy = await req2('POST', '/api/sms/inbound', form(yesParams), { 'X-Twilio-Signature': twSign(PUB + '/api/sms/inbound', yesParams) });
      await sleep(300);
      check('📬🤫 a clear YES lands here (200) and is NOT forwarded — the old system’s bot stays asleep', fy.status === 200 && !smrtState.got.some(g => g.body.indexOf('Body=Yes') >= 0), smrtState.got.map(g => g.body.slice(0, 40)));
      /* ⚠️ and the YES is QUEUED AS CONTENT — it used to be consumed by the START-keyword branch, which would
         have killed the whole reminder flow on its first live night (customers reply with the bare word YES
         every week; the Twilio history proved it) */
      const inq = await req2('GET', '/api/sms/messages');
      check('📬📥 ...and the YES reaches the inbox — an opt-in keyword is ALSO content, never swallowed', !!inq.json && (inq.json.messages || []).some(x => String(x.body || '') === 'Yes' && x.from === '5015551236'), (inq.json && (inq.json.messages || []).map(x => x.body)));
      check('...and the log says the yes was kept in-house on purpose', log2.indexOf('clear YES kept in-house') >= 0, null);
      const smrtDown = new Promise(r => smrtSrv.close(r)); await smrtDown;   /* the old system dies... */
      const f7 = await req2('POST', '/api/sms/inbound', form({ From: '+15015551235', Body: 'my pickup is at the side door' }), { 'X-Twilio-Signature': twSign(PUB + '/api/sms/inbound', { From: '+15015551235', Body: 'my pickup is at the side door' }) });
      check('📬 ...and with the old system DEAD, our answer to Twilio is still 200 — the customer loses nothing', f7.status === 200, f7.status);
    }
    try { smrtSrv.close(); } catch (e) {}   /* already closed in case 6; harmless if so */
    try { c2.kill('SIGKILL'); } catch (e) {}
    try { fs.rmSync(TMP2, { recursive: true, force: true }); } catch (e) {}
    /* 6 — and the MAIN child (no Twilio token) still accepts webhooks: with no token nothing real flows, and
       refusing would break nothing but validating is impossible — pinned so a later reader does not "harden"
       an unconfigured hub into dropping its own test traffic */
    const f6 = await req('POST', '/api/sms/status', undefined, 'TWSIG', null).catch(() => null);
    check('an un-wired hub (no token) still answers its webhooks', !!f6 && f6.status !== 403, f6 && f6.status);
  }

  // ---- 🔒 CUSTOMER RESERVATION — the second computer waits (see the RESV banner in hub-server.js) --------
  {
    const RC = 'RESV-cust-1';
    const t1 = await req('POST', '/api/reserve', { cid: RC, action: 'take', name: 'Arkadelphia Counter' }, 'DEV-A');
    check('🔒 take a free customer → it is yours', t1.status === 200 && !!t1.json && t1.json.mine === true, t1.json);
    const t2 = await req('POST', '/api/reserve', { cid: RC, action: 'take', name: 'Arkadelphia Counter' }, 'DEV-A');
    check('🔒 the SAME station taking it again is still yours — a station never blocks itself', !!t2.json && t2.json.mine === true, t2.json);
    const t3 = await req('POST', '/api/reserve', { cid: RC, action: 'take', name: 'Hot Springs Counter' }, 'DEV-B');
    check('🔒 a SECOND station is told to WAIT, and by whom', !!t3.json && t3.json.mine === false && t3.json.by === 'Arkadelphia Counter', t3.json);
    const rn = await req('POST', '/api/reserve', { cid: RC, action: 'renew', name: 'Arkadelphia Counter' }, 'DEV-A');
    check('🔒 the holder renews and keeps it', !!rn.json && rn.json.mine === true, rn.json);
    const rnB = await req('POST', '/api/reserve', { cid: RC, action: 'renew', name: 'Hot Springs Counter' }, 'DEV-B');
    check('🔒 a non-holder cannot renew its way into ownership while it is held', !!rnB.json && rnB.json.mine === false, rnB.json);
    await req('POST', '/api/reserve', { cid: RC, action: 'release' }, 'DEV-B');
    const stillHeld = await req('POST', '/api/reserve', { cid: RC, action: 'take', name: 'Hot Springs Counter' }, 'DEV-B');
    check("🔒 a non-holder's release does NOT free someone else's hold", !!stillHeld.json && stillHeld.json.mine === false, stillHeld.json);
    const rel = await req('POST', '/api/reserve', { cid: RC, action: 'release' }, 'DEV-A');
    const t4 = await req('POST', '/api/reserve', { cid: RC, action: 'take', name: 'Hot Springs Counter' }, 'DEV-B');
    check('🔒 the holder releases (returns Home) → the next station gets it at once, no waiting out a timer', !!t4.json && t4.json.mine === true, t4.json);
    // auto-expiry — the safety guarantee that a CRASHED holder can never freeze a customer (TTL is 700ms here)
    const RC2 = 'RESV-cust-2';
    await req('POST', '/api/reserve', { cid: RC2, action: 'take', name: 'Assembly' }, 'DEV-A');
    const blockedNow = await req('POST', '/api/reserve', { cid: RC2, action: 'take', name: 'Arkadelphia Counter' }, 'DEV-B');
    check('🔒 (setup) held fresh → the other station waits', !!blockedNow.json && blockedNow.json.mine === false, blockedNow.json);
    await sleep(900);   // holder "crashes" — stops renewing — and the hold must lapse on its own
    const afterTtl = await req('POST', '/api/reserve', { cid: RC2, action: 'take', name: 'Arkadelphia Counter' }, 'DEV-B');
    check('🔒 a hold auto-EXPIRES so a crashed/closed station can never freeze a customer forever', !!afterTtl.json && afterTtl.json.mine === true, afterTtl.json);
    const noKey = await req('POST', '/api/reserve', { cid: RC, action: 'take' }, 'DEV-A', null);
    check('🔒 the reserve endpoint is hub-key gated', noKey.status === 401, noKey.status);
    const noCid = await req('POST', '/api/reserve', { action: 'take' }, 'DEV-A');
    check('🔒 a reserve with no customer is refused, never a silent grant', noCid.status === 400, noCid.status);
  }

  // ---- 📗 QUICKBOOKS ONLINE — read-only OAuth + pull + reconcile (against the fake Intuit above) --------
  {
    const s0 = await req('GET', '/api/qb/status');
    check('📗 configured but not yet connected before the handshake', !!s0.json && s0.json.configured === true && s0.json.connected === false, s0.json);
    const c0 = await req('GET', '/api/qb/connect');
    check('📗 connect hands back an Intuit authorization URL — our client id, redirect, and a state', !!c0.json && c0.json.ok === true && /client_id=qbclient/.test(c0.json.url||'') && /redirect_uri=/.test(c0.json.url||'') && /state=/.test(c0.json.url||''), c0.json);
    const st = ((c0.json && c0.json.url || '').match(/state=([a-f0-9]+)/) || [])[1] || '';
    const cbBad = await req('GET', '/api/qb/callback?code=AUTHCODE&realmId=REALM9&state=deadbeefdeadbeef');
    check('📗 a callback with a BOGUS state is refused (CSRF) — still not connected', cbBad.status === 200 && /did not check out/i.test(cbBad.raw||''), (cbBad.raw||'').slice(0,70));
    const cb = await req('GET', '/api/qb/callback?code=AUTHCODE&realmId=REALM9&state=' + st);
    check('📗 the real callback exchanges the code and connects', cb.status === 200 && /connected/i.test(cb.raw||''), (cb.raw||'').slice(0,70));
    const s1 = await req('GET', '/api/qb/status');
    check('📗 now connected, with the company realm stored', !!s1.json && s1.json.connected === true && s1.json.realmId === 'REALM9', s1.json);
    const pull = await req('GET', '/api/qb/pull?start=2026-05-01&end=2026-05-31');
    check('📗 pull reads the P&L — income, expenses, net', !!pull.json && pull.json.ok === true && pull.json.income === 5000 && pull.json.expenses === 3000 && pull.json.net === 2000, pull.json);
    check('📗 the first (expired) token forced an AUTO-REFRESH before the read — nobody had to reconnect', qboState.refreshes >= 1, qboState.refreshes);
    const rec = await req('GET', '/api/qb/reconcile?start=2026-05-01&end=2026-05-31');
    check('📗 RECONCILE: QuickBooks income vs the register, with the variance — the theft cross-check', !!rec.json && rec.json.ok === true && rec.json.qbIncome === 5000 && typeof rec.json.posCollected === 'number' && rec.json.variance === Math.round((rec.json.qbIncome - rec.json.posCollected)*100)/100, rec.json);
    const noKey = await req('GET', '/api/qb/status', undefined, 'x', null);
    check('📗 the QuickBooks endpoints are hub-key gated', noKey.status === 401, noKey.status);
    const conNoKey = await req('GET', '/api/qb/connect', undefined, 'x', null);
    check('📗 ...connect too — nobody unauthenticated can start the handshake', conNoKey.status === 401, conNoKey.status);
  }

  // ---- 💳🏦 CARDPOINTE FUNDING — read-only settlement pull + reconcile (against the fake fts above) ----
  {
    const s0 = await req('GET', '/api/cp/funding/status');
    check('💳🏦 funding is configured (creds reused from the gateway), host is the fts site, both MIDs present',
      !!s0.json && s0.json.configured === true && s0.json.host === '127.0.0.1:' + FTSPORT &&
      s0.json.stores && s0.json.stores['1'] && s0.json.stores['1'].mid === 'FUNDMID1' && s0.json.stores['2'] && s0.json.stores['2'].mid === 'FUNDMID2', s0.json);
    const pull = await req('GET', '/api/cp/funding/pull?start=2026-09-01&end=2026-09-03');
    check('💳🏦 pull walks each day per MID and totals the funding — one 0902 event per store',
      !!pull.json && pull.json.ok === true && Math.abs(pull.json.sales - 20) < 0.005 && Math.abs(pull.json.fees + 0.6) < 0.005 && Math.abs(pull.json.funded - 19.4) < 0.005, pull.json);
    check('💳🏦 ...split per store, each MID its own deposit',
      !!pull.json && pull.json.stores && pull.json.stores['1'] && Math.abs(pull.json.stores['1'].funded - 9.7) < 0.005 && pull.json.stores['2'] && Math.abs(pull.json.stores['2'].funded - 9.7) < 0.005, pull.json && pull.json.stores);
    /* 💳🔍 the transaction-level reconcile over the settlement feed (txns[] behind each deposit day) */
    {
      const g0 = await req('GET', '/api/db');
      const seedTx = await req('POST', '/api/db', { delta:true, baseRev:g0.json.rev, db:{
        orders:[   // two sibling bags of one split ticket — the equal-priced-bags case
          { id:'FUNDO1', number:'1-09-02-26-0501-01', customerId:'P1c1', storeId:1, status:'PickedUp', splitFrom:'1-09-02-26-0501', pieceCount:1, lines:[{ id:'fl1', desc:'shirt', price:5.48 }], createdAt:Date.parse('2026-09-02T09:00:00'), _t:T+8990 },
          { id:'FUNDO2', number:'1-09-02-26-0501-02', customerId:'P1c1', storeId:1, status:'PickedUp', splitFrom:'1-09-02-26-0501', pieceCount:1, lines:[{ id:'fl2', desc:'shirt', price:5.48 }], createdAt:Date.parse('2026-09-02T09:00:00'), _t:T+8991 }
        ],
        payments:[
        { id:'FUNDP1', orderId:null, customerId:'P1c1', amount:10.00, method:'Card', ref:'900000000001', txn:'900000000001', storeId:1, date:Date.parse('2026-09-02T14:00:00'), _t:T+9000 },   // settled as 900000000001 → a MATCH
        { id:'FUNDP9', orderId:null, customerId:'P1c1', amount:7.77,  method:'Card', ref:'900000000009', txn:'900000000009', storeId:2, date:Date.parse('2026-09-02T10:00:00'), _t:T+9001 },   // never settled, inside feed coverage, old enough → UNSETTLED
        { id:'FUNDP0', orderId:null, customerId:'P1c1', amount:3.33,  method:'Card', ref:'900000000000', txn:'900000000000', storeId:1, date:Date.parse('2026-09-01T10:00:00'), _t:T+9002 },   // dated BEFORE the feed's first deposit day (0902) → beforeFeedCoverage, never a finding
        { id:'FUNDP5', orderId:'FUNDO1', customerId:'P1c1', amount:6.00, method:'Card', last4:'4444', ref:'900000000005', txn:'900000000005', storeId:1, date:Date.parse('2026-09-02T14:00:00'), _t:T+9003 },   // bag 1 of 2 — equal-priced, distinct orders
        { id:'FUNDP6', orderId:'FUNDO2', customerId:'P1c1', amount:6.00, method:'Card', last4:'4444', ref:'900000000006', txn:'900000000006', storeId:1, date:Date.parse('2026-09-02T14:00:05'), _t:T+9004 },   // bag 2 of 2
        { id:'FUNDP7', orderId:null, customerId:'P1c1', amount:9.00, method:'Card', last4:'5555', ref:'900000000007', txn:'900000000007', storeId:1, date:Date.parse('2026-09-02T15:00:00'), _t:T+9005 },   // a REAL double-fire: same card+cents, two refs, NO order
        { id:'FUNDP8', orderId:null, customerId:'P1c1', amount:9.00, method:'Card', last4:'5555', ref:'900000000008', txn:'900000000008', storeId:1, date:Date.parse('2026-09-02T15:00:03'), _t:T+9006 }
      ] } }, 'FUND-SEED');
      check('💳🔍 seed: two card payments for the transaction reconcile landed', seedTx.status === 200 && seedTx.json.ok === true, JSON.stringify(seedTx.json).slice(0,120));
      const pull2 = await req('GET', '/api/cp/funding/pull?start=2026-09-01&end=2026-09-03');
      check('💳🔍 the pull now carries the settled TRANSACTIONS behind each deposit (5 for MID1, 1 for MID2), card kept as last-4 only',
        !!pull2.json && pull2.json.stores && pull2.json.stores['1'] && (pull2.json.stores['1'].txns||[]).length === 5 && pull2.json.stores['2'] && (pull2.json.stores['2'].txns||[]).length === 1 &&
        pull2.json.stores['1'].txns[0].retref === '900000000001' && pull2.json.stores['1'].txns[0].last4 === '1111' && pull2.json.stores['1'].txns[0].amount === 10, pull2.json && pull2.json.stores);
      check('💳🔍 ...and the deposit row parsed from the REAL shape: top-level fundingdate, netsales, split fees, totalfunding',
        !!pull2.json && pull2.json.stores['1'].rows[0] && pull2.json.stores['1'].rows[0].date === '2026-09-02' && Math.abs(pull2.json.stores['1'].rows[0].sales - 10) < 0.005 && Math.abs(pull2.json.stores['1'].rows[0].fees + 0.3) < 0.005 && Math.abs(pull2.json.stores['1'].rows[0].funded - 9.7) < 0.005, pull2.json.stores['1'].rows);
      const tx = await req('GET', '/api/cp/funding/txreconcile?start=2026-09-01&end=2026-09-07');   // a week: 0902 is the only deposit day; 4-day grace puts a 09/02 payment past the cutoff
      check('💳🔍 TX RECONCILE: 6 settled · 3 matched by retref · 1 ORPHAN (settled at the processor, no ticket in Ozark)',
        !!tx.json && tx.json.ok === true && tx.json.settledTxns === 6 && tx.json.matched === 3 && tx.json.unmatched === 3 && tx.json.orphans.length === 1 && tx.json.orphans[0].retref === '900000000002' && Math.abs(tx.json.orphansTotal - 5) < 0.005, tx.json);
      check('💳🔍 ...a DOUBLE settled under two retrefs is named once, with its overcharge (the terminal double-tap class), not also as two orphans',
        !!tx.json && tx.json.doubles.length === 1 && tx.json.doubles[0].last4 === '3333' && tx.json.doubles[0].distinctCharges === 2 && Math.abs(tx.json.doubles[0].overcharge - 4.44) < 0.005 && tx.json.doubles[0].retrefs.indexOf('900000000003') >= 0 && tx.json.doubles[0].retrefs.indexOf('900000000004') >= 0 && Math.abs(tx.json.doublesOvercharge - 4.44) < 0.005, tx.json && tx.json.doubles);
      check('💳🔍 ...two EQUAL-PRICED BAGS on distinct sibling orders are NOT a double (Quintrell/Carthew class): equalBags, $0 overcharge',
        !!tx.json && tx.json.equalBags.length === 1 && tx.json.equalBags[0].last4 === '4444' && tx.json.equalBags[0].overcharge === 0 && tx.json.equalBags[0].orderIds.indexOf('FUNDO1') >= 0 && tx.json.equalBags[0].orderIds.indexOf('FUNDO2') >= 0 && !tx.json.doubles.some(d => d.last4 === '4444'), tx.json && tx.json.equalBags);
      const ds = await req('GET', '/api/cp/dupscan');
      check('💳⚠️ the 7pm POS-internal scan makes the same distinction: the two bags are equalBags, the no-order pair is a real double',
        !!ds.json && ds.json.ok === true && ds.json.equalBags.some(b => b.last4 === '4444' && b.overcharge === 0) && !ds.json.allDuplicates.some(d => d.last4 === '4444') && ds.json.allDuplicates.some(d => d.last4 === '5555' && Math.abs(d.overcharge - 9) < 0.005), ds.json && { dup: ds.json.allDuplicates, bags: ds.json.equalBags });
      check('💳🔍 ...POS card payments old enough to have settled, with no settled retref, are UNSETTLED (FUNDP9 + the unsettled double-fire pair); the matched/bag ones are not; no mismatches',
        !!tx.json && tx.json.posUnsettled.some(p => p.id === 'FUNDP9') && tx.json.posUnsettled.some(p => p.id === 'FUNDP7') && tx.json.posUnsettled.some(p => p.id === 'FUNDP8') &&
        !tx.json.posUnsettled.some(p => p.id === 'FUNDP1' || p.id === 'FUNDP5' || p.id === 'FUNDP6') && Math.abs(tx.json.posUnsettledTotal - 25.77) < 0.005 && tx.json.txnsUnavailable === false && tx.json.mismatches.length === 0, tx.json && tx.json.posUnsettled);
      check('💳🔍 ...a payment dated BEFORE the feed\'s first deposit day is outside coverage, never "unsettled" (the 09/08 lesson: the live feed begins 09/09)',
        !!tx.json && tx.json.feedCoverageFrom === '2026-09-02' && tx.json.beforeFeedCoverage === 1 && Math.abs(tx.json.beforeFeedCoverageTotal - 3.33) < 0.005 && !tx.json.posUnsettled.some(p => p.id === 'FUNDP0') && /no data before 2026-09-02/.test(tx.json.note || ''), tx.json && { from: tx.json.feedCoverageFrom, before: tx.json.beforeFeedCoverage, note: tx.json.note });
      /* ⚠️ "SEEN" MEANS "THE OWNER WAS TOLD" (2026-09-16). This gate hub has no e-mail configured — exactly the state in
         which the first version silently marked every double seen. Run the live path twice, wide enough to reach the
         seeded 9/02 double: it must be reported both times, say why it was not marked, and mark nothing. */
      const e1 = await req('GET', '/api/cp/dupscan?run=email&days=60');
      const e2 = await req('GET', '/api/cp/dupscan?run=email&days=60');
      check('💳⚠️ a double the owner could NOT be e-mailed about is NEVER marked seen — the next run reports it again',
        !!e1.json && e1.json.ok === true && e1.json.found > 0 && /NOT marked seen/.test(e1.json.emailError || '') && e1.json.marked === undefined && e1.json.emailed === undefined
        && !!e2.json && e2.json.found === e1.json.found, { e1: e1.json && { found: e1.json.found, emailError: e1.json.emailError, marked: e1.json.marked }, e2: e2.json && e2.json.found });
      const dry = await req('GET', '/api/cp/funding/txreconcile?run=1');
      check('💳🌅 the morning settlement alarm dry-runs: reports a count, sends nothing (the fake has no deposits for yesterday)',
        !!dry.json && dry.json.ok === true && typeof dry.json.found === 'number' && dry.json.emailed === undefined, dry.json);
      const txNoKey = await req('GET', '/api/cp/funding/txreconcile?start=2026-09-01&end=2026-09-03', undefined, 'x', null);
      check('💳🔍 the transaction reconcile is hub-key gated', txNoKey.status === 401, txNoKey.status);
    }
    const rec = await req('GET', '/api/cp/funding/reconcile?start=2026-09-01&end=2026-09-03');
    check('💳🏦 RECONCILE: processor deposits vs the register card collections, with the variance (theft cross-check)',
      !!rec.json && rec.json.ok === true && Math.abs(rec.json.processorSales - 20) < 0.005 && typeof rec.json.posCardCollected === 'number' && rec.json.variance === Math.round((rec.json.procGrossUsed - rec.json.posCardCollected)*100)/100, rec.json);
    const noData = await req('GET', '/api/cp/funding/reconcile?start=2026-09-04&end=2026-09-05');
    check('💳🏦 a range CardConnect has no deposits for is flagged, never a silent reconciled $0 (reassuring-direction trap)',
      !!noData.json && noData.json.ok === true && noData.json.processorReturnedNoData === true && noData.json.daysWithData === 0 && /no deposit data/i.test(noData.json.note||''), noData.json);
    const noKey = await req('GET', '/api/cp/funding/status', undefined, 'x', null);
    check('💳🏦 the funding endpoints are hub-key gated', noKey.status === 401, noKey.status);
  }
  try { ftsSrv.close(); } catch (e) {}

  /* 🗺️ address autocomplete proxy */
  {
    const gPublic = await req('GET', '/api/geocode?q=' + encodeURIComponent('100 main'), undefined, 'x', null);
    check('🗺️ geocode works WITHOUT a key (public, for the website pickup form) and returns results',
      gPublic.status === 200 && !!gPublic.json && gPublic.json.ok === true && Array.isArray(gPublic.json.results) && gPublic.json.results.length >= 1, gPublic.status);
    const gShort = await req('GET', '/api/geocode?q=ab');
    check('🗺️ a <3-char query returns an empty list (no upstream call)', !!gShort.json && gShort.json.ok === true && Array.isArray(gShort.json.results) && gShort.json.results.length === 0, gShort.json);
    const gReal = await req('GET', '/api/geocode?q=' + encodeURIComponent('100 Main St Arkadelphia'));
    const r0 = gReal.json && gReal.json.results && gReal.json.results[0];
    check('🗺️ a real query returns a complete address that ENDS with the ZIP (drives the driver tag + card AVS)',
      !!(r0 && /71923$/.test(r0.label) && r0.zip === '71923'), r0);
  }
  try { geoSrv.close(); } catch (e) {}

  /* 🔌 an idle connection survives past Node's old 5s default — Caddy reuses upstream sockets for 2 minutes, and a
     request landing on one the hub had just closed came back 502 (2026-09-16: 21 resets, three delivery charges
     logged as declines). One raw keep-alive socket, two requests 6s apart: the old hub resets the second. */
  {
    const net = require('net');
    const reuse = await new Promise(resolve => {
      const sock = net.connect(PORT, '127.0.0.1');
      let buf = '', sent2 = false, done = false;
      const finish = v => { if (done) return; done = true; try { sock.destroy(); } catch (e) {} resolve(v); };
      const ask = () => sock.write('GET /api/health HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: keep-alive\r\n\r\n');
      sock.on('data', d => {
        buf += d;
        const n = buf.split('HTTP/1.1 200').length - 1;
        if (n === 1 && !sent2) { sent2 = true; setTimeout(ask, 6000); }
        if (n >= 2) finish({ ok: true });
      });
      sock.on('close', () => finish({ ok: false, why: 'socket closed by hub while idle (answers seen: ' + (buf.split('HTTP/1.1 200').length - 1) + ')' }));
      sock.on('error', e => finish({ ok: false, why: e.message }));
      setTimeout(() => finish({ ok: false, why: 'timeout' }), 15000);
      ask();
    });
    check('🔌 an idle keep-alive connection is still usable after 6s (Caddy reuse window — no reset 502s)', reuse.ok, reuse.why);
  }

  if (fail && log) console.log('\n--- hub output ---\n' + log.slice(-1500));
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  cleanup();
  process.exit(fail ? 1 : 0);
})();
