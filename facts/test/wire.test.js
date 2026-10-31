'use strict';
/* @facts @proof — THE WIRE: the facts engine over HTTP, against this repo's own small hub (facts/server.js). This repo's own file.
   The origin shop proves the same things against its whole server (its suite section 22); these are those proofs re-targeted at the
   small server Stage 1 writes, plus the Stage 1 gates (docs/V2-MODULAR-IMPORT.md): the hub refuses an unenrolled device, and it is
   durable before it witnesses — a store that refuses a write makes the hub refuse to acknowledge. Each proof that could pass by
   accident carries a negative control. Needs Node 22+ (node:sqlite).   node facts/test/wire.test.js */
const H = require('./harness');
const fs = require('fs'), os = require('os'), path = require('path');
const { makeStation } = require('../core/station');
const sync = require('../sync/sync');
const { httpHub, attach } = require('../sync/http');
const { openSqliteStore } = require('../hub/sqlite-store');
const { startHubServer, MAX_BODY, PREAUTH_MAX } = require('../server');

const ADMIN = 'test-operator-key-wire-0001';
let T = 1789000000000;
const now = function () { return T; };
/* @proof — a database file in temp, and its removal */
function dbFile(tag) { return path.join(os.tmpdir(), 'custompos-wire-' + tag + '-' + process.pid + '-' + Date.now() + '.db'); }
/* @proof — the database file and its side files gone */
function rmDb(f) { ['', '-journal', '-wal', '-shm'].forEach(function (s) { try { fs.unlinkSync(f + s); } catch (e) {} }); }
/* @proof — a tablet's journal in memory, as the station persists it (one row per fact, echo or mark) */
function jstore() { const lines = []; let access = null; return { load: function () { return JSON.parse(JSON.stringify(lines)); }, append: function (row) { lines.push(JSON.parse(JSON.stringify(row))); }, loadAccess: function () { return access; }, saveAccess: function (a) { access = a; }, _lines: lines }; }
/* @proof — wait for a station's commit in flight to come back */
async function settle(S) { for (let i = 0; i < 300 && S.inFlight; i++) await new Promise(function (r) { setTimeout(r, 10); }); }
/* @proof — an operator call */
async function op(base, p, body, key) { const r = await fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json', 'x-custompos-admin': key }, body: JSON.stringify(body) }); return { status: r.status, json: await r.json() }; }
/* @proof — a tablet the operator enrolled, committing over the wire */
async function tablet(srv, remote, id, persist) { const t = (await op(srv.url, '/v2/admin/enroll', { station: id }, ADMIN)).json.token; const S = makeStation({ id: id, now: now, persist: persist || jstore() }); S.setAccess(t); S.token = t; attach(S, remote); return S; }

H.section('wire · the facts hub over HTTP (facts/server.js)');

H.testAsync('an operator enrolls two tablets; one records and commits over HTTP; the other learns it by pulling', async function () {
  const f = dbFile('w1'); const srv = await startHubServer({ db: f, adminKey: ADMIN });
  try {
    const remote = httpHub(srv.url);
    const ea = await op(srv.url, '/v2/admin/enroll', { station: 'wa' }, ADMIN); H.eq(ea.status, 200); H.ok(typeof ea.json.token === 'string' && ea.json.token.length > 20, 'a token, shown once');
    const A = makeStation({ id: 'wa', now: now, persist: jstore() }); A.setAccess(ea.json.token); attach(A, remote);
    const B = await tablet(srv, remote, 'wb');
    const e = A.record('clock.in', 'p', { empId: 'p', at: T }); await settle(A);
    H.eq(srv.hub.head, 1, 'the fact is at the hub'); H.eq(A.log.get(e.id).pos, 1, 'and its echo came back over the wire');
    const p = await sync.pullAsync(B, remote); H.eq(p.ok, true); H.ok(B.log.has(e.id), 'the other tablet learned it'); H.eq(B.cursor, 1);
  } finally { await srv.close(); rmDb(f); }
});

H.testAsync('an unenrolled device, a revoked tablet and a wrong operator key are each refused whole, and told why', async function () {
  const f = dbFile('w2'); const srv = await startHubServer({ db: f, adminKey: ADMIN });
  try {
    const remote = httpHub(srv.url);
    const r0 = await remote.receive({ station: 'wx', events: [] }); H.ok(/not enrolled/.test(String(r0.refused)), 'no token: ' + r0.refused);
    /* an unenrolled device that tries to land a real fact: nothing lands */
    const X = makeStation({ id: 'wx', now: now, persist: jstore() }); X.setAccess('a-token-the-hub-never-issued-0000000000'); attach(X, remote);
    const ex = X.record('clock.in', 'p', { empId: 'p', at: T }); await settle(X);
    H.eq(srv.hub.head, 0, 'an unenrolled device lands nothing'); H.eq(X.log.get(ex.id).pos, null, 'its fact stays owed on the device');
    const bad = await op(srv.url, '/v2/admin/enroll', { station: 'wx' }, 'wrong-key-wrong-key'); H.eq(bad.status, 403, 'a wrong operator key enrolls nobody');
    const S = await tablet(srv, remote, 'wr');
    await op(srv.url, '/v2/admin/revoke', { station: 'wr' }, ADMIN);
    const e = S.record('clock.in', 'p', { empId: 'p', at: T }); await settle(S);
    H.eq(srv.hub.head, 0, 'a revoked tablet lands nothing'); H.eq(S.log.get(e.id).pos, null, 'its fact stays owed'); H.ok(/revoked/.test(String(S.accessRefused || '')), 'and it knows why');
    H.eq((await fetch(srv.url + '/v2/admin/watch')).status, 403, 'the watch needs the operator key');
    const w = await (await fetch(srv.url + '/v2/admin/watch', { headers: { 'x-custompos-admin': ADMIN } })).json(); H.ok(w.revoked.indexOf('wr') >= 0, 'and with it, the watch names the revoked tablet');
    /* the negative control: an enrolled tablet on the same hub DOES land (the refusals above are the hub's judgement, not a dead wire) */
    const G = await tablet(srv, remote, 'wg');
    /* nobody but the operator revokes (pre-push review: opening revoke to anyone passed the suite) */
    H.eq((await op(srv.url, '/v2/admin/revoke', { station: 'wg' }, 'wrong-key-wrong-key')).status, 403, 'a wrong operator key revokes nobody');
    H.eq((await fetch(srv.url + '/v2/admin/revoke', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ station: 'wg' }) })).status, 403, 'nor does no key');
    const eg = G.record('clock.in', 'q', { empId: 'q', at: T }); await settle(G);
    H.eq(srv.hub.head, 1, 'an enrolled tablet lands'); H.eq(G.log.get(eg.id).pos, 1);
  } finally { await srv.close(); rmDb(f); }
});

H.testAsync('malformed JSON, a list, an oversized body and an unknown route each get a named refusal; the hub keeps serving', async function () {
  const f = dbFile('w3'); const srv = await startHubServer({ db: f, adminKey: ADMIN });
  try {
    const post = async function (p, raw, headers) { const r = await fetch(srv.url + p, { method: 'POST', headers: Object.assign({ 'content-type': 'application/json' }, headers || {}), body: raw }); return { status: r.status, json: await r.json() }; };
    const a = await post('/v2/receive', '{not json'); H.eq(a.status, 400); H.ok(/malformed/.test(a.json.refused));
    H.eq((await post('/v2/pull', '[1,2]')).status, 400, 'a list is not a request');
    H.eq((await post('/v2/receive', JSON.stringify({ pad: 'x'.repeat(PREAUTH_MAX + 10) }))).status, 401, 'over 64 KB from a sender with no key');
    const k = srv.hub.enroll('w3k', { by: 'proof' });
    H.eq((await post('/v2/receive', JSON.stringify({ pad: 'x'.repeat(PREAUTH_MAX + 10) }), { 'x-custompos-token': k })).status, 200, 'the same body from an enrolled device is read (and answered by the hub)');
    H.eq((await post('/v2/receive', JSON.stringify({ pad: 'x'.repeat(MAX_BODY + 10) }), { 'x-custompos-token': k })).status, 413, 'past the hard limit even with a key');
    H.eq((await post('/v2/nothing-here', '{}')).status, 404);
    const h = await (await fetch(srv.url + '/v2/health')).json(); H.eq(h.ok, true, 'still serving'); H.eq(h.epoch, srv.hub.epoch);
    H.ok(JSON.stringify(h).indexOf(ADMIN) < 0, 'health says nothing secret');
  } finally { await srv.close(); rmDb(f); }
});

H.testAsync('the hub took it but the answer was lost; the retry lands ONCE, at the same position', async function () {
  const f = dbFile('w4'); const srv = await startHubServer({ db: f, adminKey: ADMIN });
  try {
    let drop = true;
    const lossy = httpHub(srv.url, { fetch: function (u, init) { return fetch(u, init).then(function (r) { if (drop && /\/v2\/receive$/.test(u)) { drop = false; throw new Error('connection reset (the answer was lost)'); } return r; }); } });
    const S = await tablet(srv, lossy, 'wl');
    const e = S.record('clock.in', 'p', { empId: 'p', at: T }); await settle(S);
    H.eq(srv.hub.head, 1, 'the hub took it'); H.eq(S.log.get(e.id).pos, null, 'the tablet never heard, so it is still owed');
    await S.commit('retry'); await settle(S);
    H.eq(srv.hub.head, 1, 'the retry did NOT add a second copy'); H.eq(S.log.get(e.id).pos, 1, 'and the tablet now holds its position');
  } finally { await srv.close(); rmDb(f); }
});

H.testAsync('a hub that is down is "not yet": facts stay owed, and land when it is back on the same database', async function () {
  const f = dbFile('w5'); let srv = await startHubServer({ db: f, adminKey: ADMIN }); const port = srv.port;
  try {
    const remote = httpHub(srv.url, { timeoutMs: 3000 });
    const S = await tablet(srv, remote, 'wd'); const fails0 = S.failures.length;
    await srv.close();
    const e = S.record('clock.in', 'p', { empId: 'p', at: T }); await settle(S);
    H.eq(S.log.get(e.id).pos, null, 'owed, not lost'); H.ok(S.failures.length > fails0, 'and the failure is on the tablet\'s own log');
    srv = await startHubServer({ db: f, adminKey: ADMIN, port: port });
    await S.commit('back'); await settle(S);
    H.eq(srv.hub.head, 1, 'it landed'); H.eq(S.log.get(e.id).pos, 1);
  } finally { await srv.close(); rmDb(f); }
});

H.testAsync('durable before it witnesses: a store that refuses the write makes the hub refuse to acknowledge; the fact lands once the disk takes it', async function () {
  const f = dbFile('w6'), real = openSqliteStore(f); let refuse = true, refusedSaves = 0;
  const flaky = { load: function () { return real.load(); }, save: function (snap) { if (refuse) { refusedSaves++; throw new Error('disk full'); } return real.save(snap); }, close: function () { real.close(); } };
  const srv = await startHubServer({ store: flaky, adminKey: ADMIN, notify: function () {} });   /* its alerts are this proof's point, not news */
  try {
    refuse = false; const remote = httpHub(srv.url); const S = await tablet(srv, remote, 'wf'); refuse = true;   /* the enrolment itself is saved */
    const e = S.record('clock.in', 'p', { empId: 'p', at: T }); await settle(S);
    H.ok(refusedSaves > 0, 'the hub tried to save'); H.eq(srv.hub.head, 0, 'the hub holds nothing it could not save');
    H.eq(S.log.get(e.id).pos, null, 'and the tablet was never told it landed — it still owes it');
    refuse = false; await S.commit('disk back'); await settle(S);
    H.eq(srv.hub.head, 1, 'once the disk takes it, it lands'); H.eq(S.log.get(e.id).pos, 1, 'once');
    /* the negative control: the same flow with a store that never refuses acknowledges at once (the test can tell the two apart) */
    const e2 = S.record('clock.out', 'p', { empId: 'p', at: T + 3600000, shiftId: e.id }); await settle(S);
    H.eq(S.log.get(e2.id).pos, 2, 'a store that takes the write: acknowledged at once');
  } finally { await srv.close(); real.close(); rmDb(f); }
});

H.testAsync('one hub per database: a second hub on the same file will not start, and the first keeps serving', async function () {
  const f = dbFile('w7'); const s1 = await startHubServer({ db: f, adminKey: ADMIN }); let msg = '';
  try {
    try { const s2 = await startHubServer({ db: f, adminKey: ADMIN }); await s2.close(); } catch (e) { msg = String(e.message); }
    H.ok(/another hub process holds this store/.test(msg), 'refused: ' + msg); H.eq((await (await fetch(s1.url + '/v2/health')).json()).ok, true, 'the first one keeps serving');
  } finally { await s1.close(); rmDb(f); }
});

H.testAsync('a hub with no operator key (or a short one) will not start — nobody could enrol a device, or anybody could', async function () {
  const f = dbFile('w8'); let msg = '';
  const keep = process.env.CUSTOMPOS_ADMIN_KEY; delete process.env.CUSTOMPOS_ADMIN_KEY;
  try {
    try { const s = await startHubServer({ db: f }); await s.close(); } catch (e) { msg = String(e.message); }
    H.ok(/operator key/.test(msg), 'no key: ' + msg); msg = '';
    try { const s = await startHubServer({ db: f, adminKey: 'short' }); await s.close(); } catch (e) { msg = String(e.message); }
    H.ok(/16\+ characters/.test(msg), 'a short key: ' + msg);
    H.ok(!fs.existsSync(f), 'and it refused before it made a database file');
  } finally { if (keep != null) process.env.CUSTOMPOS_ADMIN_KEY = keep; rmDb(f); }
});

H.testAsync('a tablet that reboots does NOT re-read the whole hub: its cursor comes back with its log, and it pulls only what is new', async function () {
  const f = dbFile('w9'); const srv = await startHubServer({ db: f, adminKey: ADMIN });
  try {
    const remote = httpHub(srv.url);
    const W = await tablet(srv, remote, 'ww');
    for (let i = 0; i < 3; i++) { W.record('clock.in', 'p' + i, { empId: 'p' + i, at: T + i }); await settle(W); }
    const J = jstore(); const R = await tablet(srv, remote, 'wr9', J);
    const p1 = await sync.pullAsync(R, remote); H.eq(p1.added, 3); H.eq(R.cursor, 3);
    let lastPull = null; const watched = httpHub(srv.url, { onAnswer: function (j, p) { if (p === '/v2/pull' && Array.isArray(j.events)) lastPull = j; } });
    const R2 = makeStation({ id: 'wr9', now: now, persist: J }); attach(R2, watched);
    H.eq(R2.cursor, 3, 'the cursor came back with the log'); H.eq(R2.epoch, srv.hub.epoch, 'and so did the hub\'s identity');
    W.record('clock.out', 'p0', { empId: 'p0', at: T + 3600000 }); await settle(W);
    const p2 = await sync.pullAsync(R2, watched); H.eq(p2.added, 1, 'one new fact'); H.eq(R2.cursor, 4);
    /* what actually crossed the wire (pre-push review: `added` counts what is new to the log, and passed with a hub that re-sent all) */
    H.eq(lastPull.from, 3, 'the hub answered from the cursor'); H.eq(lastPull.events.length, 1, 'and sent exactly the one new fact');
  } finally { await srv.close(); rmDb(f); }
});

/* @proof — a store that refuses its writes while `refuse` says so (the disk-full case), wrapping a real SQLite store */
function flakyStore(f) { const real = openSqliteStore(f); const s = { refuse: false, load: function () { return real.load(); }, save: function (snap) { if (s.refuse) throw new Error('disk full'); return real.save(snap); }, close: function () { real.close(); } }; return s; }

H.testAsync('a store that refuses writes is not healthy (503), and a revoke it cannot keep says the device still has access (503) — each back to normal once the disk takes writes', async function () {
  const f = dbFile('w10'), st = flakyStore(f); const srv = await startHubServer({ store: st, adminKey: ADMIN, notify: function () {} });
  try {
    const remote = httpHub(srv.url); const S = await tablet(srv, remote, 'wv');
    const h0 = await fetch(srv.url + '/v2/health'); H.eq(h0.status, 200, 'healthy while the disk takes writes'); H.eq((await h0.json()).store, 'ok');
    st.refuse = true; const e = S.record('clock.in', 'p', { empId: 'p', at: T }); await settle(S);   /* a refused save: the hub now knows its store refuses */
    const h1 = await fetch(srv.url + '/v2/health'); H.eq(h1.status, 503, 'a refusing store: health says so'); const j1 = await h1.json(); H.eq(j1.ok, false); H.eq(j1.store, 'refusing writes');
    H.ok(JSON.stringify(j1).indexOf('disk full') < 0, 'and keeps the error\'s own words for the operator\'s watch');
    const rv = await op(srv.url, '/v2/admin/revoke', { station: 'wv' }, ADMIN); H.eq(rv.status, 503, 'a revoke the store cannot keep: 503'); H.ok(/still has access/.test(rv.json.refused), rv.json.refused);
    H.ok(srv.hub.enrolled('wv'), 'and indeed the device is still enrolled');
    st.refuse = false;
    H.eq((await fetch(srv.url + '/v2/health')).status, 200, 'the disk is back: healthy again (the health check retried the save)');
    const rv2 = await op(srv.url, '/v2/admin/revoke', { station: 'wv' }, ADMIN); H.eq(rv2.status, 200); H.eq(rv2.json.revoked, 1, 'now the revoke is kept');
    H.ok(!srv.hub.enrolled('wv'), 'and the device is out');
    /* the negative control: revoking a station that was never enrolled is a plain 200 with nothing revoked (not a 503) */
    const rv3 = await op(srv.url, '/v2/admin/revoke', { station: 'never-was' }, ADMIN); H.eq(rv3.status, 200); H.eq(rv3.json.revoked, 0);
    H.ok(e.id);
  } finally { await srv.close(); st.close(); rmDb(f); }
});

H.testAsync('a refused sender is cut off: after the 401 the connection is closed, not left streaming a body', async function () {
  const f = dbFile('w11'); const srv = await startHubServer({ db: f, adminKey: ADMIN });
  try {
    const http = require('http'), chunk = Buffer.alloc(16 * 1024, 120);
    const result = await new Promise(function (done) {
      let status = null, sent = 0, closedAt = null; const t0 = Date.now();
      const req = http.request(srv.url + '/v2/receive', { method: 'POST', headers: { 'content-type': 'application/json' } }, function (res) { status = res.statusCode; res.resume(); });
      req.on('error', function () {});
      req.on('close', function () { closedAt = Date.now() - t0; });
      const tick = setInterval(function () { if (closedAt != null || Date.now() - t0 > 5000) { clearInterval(tick); req.destroy(); done({ status: status, sent: sent, closedAt: closedAt }); return; } try { req.write(chunk); sent += chunk.length; } catch (e) {} }, 20);
    });
    H.eq(result.status, 401, 'refused: too large from a sender with no key');
    H.ok(result.closedAt != null && result.closedAt < 4000, 'and the connection was closed (after ' + result.closedAt + ' ms)');
    /* the negative control: an enrolled device's normal request on a fresh connection is answered as usual */
    H.eq((await fetch(srv.url + '/v2/health')).status, 200);
  } finally { await srv.close(); rmDb(f); }
});

H.testAsync('a hub restored from an OLDER copy is caught: a tablet past it is answered under a new identity and gets the facts written since (the pull carries `at`)', async function () {
  const f = dbFile('w12'), bak = f + '.older';
  let srv = await startHubServer({ db: f, adminKey: ADMIN });
  try {
    const remote = httpHub(srv.url);
    const W = await tablet(srv, remote, 'w12w'), R = await tablet(srv, remote, 'w12r'), V = await tablet(srv, remote, 'w12v');
    W.record('clock.in', 'a', { empId: 'a', at: T }); await settle(W);
    await srv.close(); fs.copyFileSync(f, bak);                                     /* the older copy: one fact */
    srv = await startHubServer({ db: f, adminKey: ADMIN, port: srv.port });
    W.record('clock.in', 'b', { empId: 'b', at: T + 1 }); await settle(W); W.record('clock.in', 'c', { empId: 'c', at: T + 2 }); await settle(W);
    await sync.pullAsync(R, remote); H.eq(R.cursor, 3, 'the reader is at 3'); const epoch0 = R.epoch;
    await srv.close(); fs.copyFileSync(bak, f);                                     /* the hub is restored from the older copy */
    srv = await startHubServer({ db: f, adminKey: ADMIN, port: srv.port });
    H.eq(srv.hub.head, 1, 'the restored hub holds one fact');
    V.record('clock.in', 'd', { empId: 'd', at: T + 3 }); await settle(V); V.record('clock.in', 'e', { empId: 'e', at: T + 4 }); await settle(V);
    H.ok(srv.hub.head >= 3, 'new facts landed at the positions the reader thinks it has read');
    /* the negative control: the same pull WITHOUT `at` (the reader's own token, its cursor 3) sees nothing new — the gap is invisible */
    const raw = await (await fetch(srv.url + '/v2/pull', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: R.token, cursor: 3, epoch: epoch0 }) })).json();
    const p = await sync.pullAsync(R, remote);
    H.ok(R.epoch !== epoch0, 'the reader was answered under a new identity');
    H.ok(R.log.all().some(function (x) { return x.payload && x.payload.empId === 'd'; }) && R.log.all().some(function (x) { return x.payload && x.payload.empId === 'e'; }), 'and it holds both facts written since the restore');
    H.ok(p.ok, 'the pull succeeded');
    H.ok(raw && !raw.refused && raw.epoch === epoch0 && Array.isArray(raw.events) && raw.events.length === 0, 'without `at`, the same cursor saw nothing new under the old identity (' + JSON.stringify(raw).slice(0, 120) + ')');
  } finally { await srv.close(); rmDb(f); try { fs.unlinkSync(bak); } catch (e) {} }
});

H.testAsync('a page opened from a file or another host may talk to the hub (CORS): the pre-check is answered, and every answer allows any origin — no door trusts cookies', async function () {
  const f = dbFile('w13'); const srv = await startHubServer({ db: f, adminKey: ADMIN });
  try {
    const pre = await fetch(srv.url + '/v2/receive', { method: 'OPTIONS', headers: { origin: 'null', 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type, x-custompos-token' } });
    H.eq(pre.status, 204, 'the pre-check is answered');
    H.eq(pre.headers.get('access-control-allow-origin'), '*');
    H.ok(/x-custompos-token/.test(pre.headers.get('access-control-allow-headers') || ''), 'the device-token header may come');
    const h = await fetch(srv.url + '/v2/health'); H.eq(h.headers.get('access-control-allow-origin'), '*', 'an answer allows any origin');
    /* the negative control: allowing the origin opens no door — a request with no token is still refused */
    const r = await fetch(srv.url + '/v2/admin/watch', { headers: { origin: 'https://elsewhere.example' } }); H.eq(r.status, 403, 'the watch still needs the operator key');
  } finally { await srv.close(); rmDb(f); }
});

H.done();
