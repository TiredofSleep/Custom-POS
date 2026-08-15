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
const { spawn } = require('child_process');

const KEY = 'test-key-' + Math.random().toString(36).slice(2, 8);
/* ⚠️ PICK A PORT THAT IS ACTUALLY FREE. This was `8700 + random(200)` and on 2026-08-11 it landed on a port
   another service on this machine already owned \u2014 Dell SupportAssist answered the health check, the boot loop
   never saw ok:true, and SIXTEEN assertions failed against a stranger's JSON. A harness that fails randomly
   teaches you to ignore it, which is worse than not having it. Bind the port ourselves first: if we can hold it,
   it is free; release it and hand it to the hub. */
const PORT = (function(){
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
})();
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

const req = (method, p, body, dev, key) => new Promise((res, rej) => {
  const data = body === undefined ? null : JSON.stringify(body);
  const r = http.request({ host: '127.0.0.1', port: PORT, path: p, method, headers: Object.assign(
    { 'x-ozark-device': dev || 'TEST-DEV' },
    key === null ? {} : { 'x-ozark-key': key || KEY },
    data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}) }, x => {
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
              { id: 'c2', first: 'Bo', last: 'Test', balance: 0, _t: T }],
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

  child = spawn(process.execPath, ['hub-server.js'], { cwd: TMP, stdio: ['ignore', 'pipe', 'pipe'],
    env: Object.assign({}, process.env, { OZARK_PORT: String(PORT), OZARK_HUB_KEY: KEY,
      OZARK_CKPT_REVS: '4', OZARK_CKPT_MS: String(24*3600*1000) }) });   /* 🛣 Phase 4: a checkpoint every 4th
      revision and never on the clock, so the policy is deterministic in a short test rather than time-dependent */
  let log = ''; child.stdout.on('data', d => log += d); child.stderr.on('data', d => log += d);

  let booted = null;
  for (let i = 0; i < 60; i++) { try { const h = await req('GET', '/api/health', undefined, 'boot', null);
    if (h.json && h.json.ok) { booted = h.json; break; } } catch (e) {} await sleep(100); }
  /* ⚠️ PROVE IT IS OUR HUB. `ok:true` alone is not proof — plenty of local services answer something. If a
     stranger is on this port, say so instead of running 200 assertions against its JSON. */
  if (!booted || booted.keyConfigured === undefined) {
    console.error('\n⛔ nothing recognisable as the Ozark hub answered on port ' + PORT + '.\n' +
      '   got: ' + JSON.stringify(booted).slice(0, 200) + '\n' +
      '   Another program is probably on that port. Re-run; the port is chosen fresh each time.');
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
    { ts:now,     kind:'home-tile', what:'search',                emp:'Brittany Jones', ws:'HS Counter', store:2, screen:'home' },
    { ts:now+100, kind:'search',    what:'sheriff, jesse',         emp:'Brittany Jones', ws:'HS Counter', store:2, screen:'search' },
    { ts:now+200, kind:'customer',  what:'Sheriff, Jesse', cid:'c1', who:'Jesse Sheriff', emp:'Brittany Jones', ws:'HS Counter', store:2, screen:'search' },
    { ts:now+300, kind:'order',     what:'2-08-10-26-0001 · Ready', order:'2-08-10-26-0001', cid:'c1', emp:'Brittany Jones', ws:'HS Counter', store:2, screen:'order' },
    { ts:now+400, kind:'garment',   what:'10170347', hsl:'10170347', emp:'Brittany Jones', ws:'HS Counter', store:2, screen:'order' },
    { ts:now+500, kind:'garment',   what:'10170347', hsl:'10170347', emp:'Dana Gish',    ws:'Ark Counter', store:1, screen:'rack' }
  ]}, 'HS-COUNTER');
  check('a batch of taps is accepted', tr.status === 200 && tr.json.ok && tr.json.kept === 6, JSON.stringify(tr.json));
  check('trail.jsonl exists once a station reports', fs.existsSync(TRF));

  /* THE question: where did this garment go, and who touched it. */
  let q = await req('GET', '/api/trail?hsl=10170347');
  check('⭐ one garment can be traced by its heat-seal', (q.json.rows || []).length === 2,
    JSON.stringify((q.json.rows || []).length));
  check('...naming every person who touched it, on which station',
    (q.json.rows || []).map(r => r.emp).sort().join('|') === 'Brittany Jones|Dana Gish' &&
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
  q = await req('GET', '/api/trail?emp=brittany');
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
  zdb.customers.push({ id:'SCALE1', first:'Dan', last:'Scale', balance:0, _t:1786383558009 });        // paid, ms
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
    M.idemFinish('monthly|C1|2026-08',{status:'approved',auth:'02106A',ref:'215836432687'});
    out.push(['after-finish',JSON.stringify(M.idemCheck('monthly|C1|2026-08',{amount:3793}))]);
    out.push(['different-key',JSON.stringify(M.idemCheck('monthly|C1|2026-09',{amount:3793}))]);
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
    const i = src.indexOf('idemFinish(_idem, result)');
    return i > 0 && src.slice(i - 400, i).indexOf("result.status === 'approved' || result.status === 'declined'") > 0; })());

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


  if (fail && log) console.log('\n--- hub output ---\n' + log.slice(-1500));
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  cleanup();
  process.exit(fail ? 1 : 0);
})();
