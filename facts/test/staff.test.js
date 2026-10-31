'use strict';
/* @facts @proof — THE STAFF MODULE AND THE PIN THE HUB CHECKS (facts/modules/staff.js, pingrant.js), over real HTTP against facts/server.js.
   A brand-new shop writes its first owner; from then on a change to the staff needs the right AND a PIN the hub checked itself, on
   that tablet; wrong PINs lock; a pass from another tablet, a forged one or an old one does nothing; only an owner makes an owner; a
   person changes only their own PIN. The negative control: the same facts land on a hub that runs no modules. This repo's own file.
   node facts/test/staff.test.js */
const H = require('./harness');
const fs = require('fs'), os = require('os'), path = require('path');
const { makeStation } = require('../core/station');
const { httpHub, attach } = require('../sync/http');
const { startHubServer } = require('../server');
const S = require('../modules/staff');
const G = require('../modules/pingrant');

const ADMIN = 'test-operator-key-staff-0001', SIGNER = 'test-pass-signer-0001';   /* a made-up signing value for the proofs' hub */
/* @proof — a database file in temp, and its removal */
function dbFile(tag) { return path.join(os.tmpdir(), 'custompos-staff-' + tag + '-' + process.pid + '-' + Date.now() + '.db'); }
function rmDb(f) { ['', '-journal', '-wal', '-shm'].forEach(function (s) { try { fs.unlinkSync(f + s); } catch (e) {} }); }
/* @proof — a tablet's journal in memory */
function jstore() { const lines = []; let access = null; return { load: function () { return JSON.parse(JSON.stringify(lines)); }, append: function (row) { lines.push(JSON.parse(JSON.stringify(row))); }, loadAccess: function () { return access; }, saveAccess: function (a) { access = a; } }; }
async function settle(T) { for (let i = 0; i < 300 && T.inFlight; i++) await new Promise(function (r) { setTimeout(r, 10); }); }
async function post(base, p, body, headers) { const r = await fetch(base + p, { method: 'POST', headers: Object.assign({ 'content-type': 'application/json' }, headers || {}), body: JSON.stringify(body) }); return { status: r.status, json: await r.json() }; }
/* @proof — a tablet the operator enrolled; its sends carry whatever passes it holds (tab.passes) */
async function tablet(srv, id) {
  const token = (await post(srv.url, '/v2/admin/enroll', { station: id }, { 'x-custompos-admin': ADMIN })).json.token, remote = httpHub(srv.url);
  const T = makeStation({ id: id, persist: jstore() }); T.setAccess(token); attach(T, remote);
  T.passes = []; T.setTransport(function (b) { b.grants = T.passes; return remote.receive(b); });
  T.pin = async function (staffId, pin) { const r = await post(srv.url, '/v2/pin', { token: token, staffId: staffId, pin: pin }); if (r.json.grant) T.passes = [r.json.grant]; return r.json; };
  return T;
}
/* @proof — record a staff.set by actor and say whether the hub took it */
async function put(T, staffId, set, actor) { const e = T.record('staff.set', staffId, { staffId: staffId, set: set }, { actor: actor }); await settle(T); return !!T.log.get(e.id).pos; }

H.section('staff · the people as facts, and the PIN the hub checks');

H.test('a staff.set is refused when malformed — above all a PIN that is digits, not a hash', function () {
  const rec = S.pinRecord('4321');
  H.eq(S.validate({ staffId: 'a', set: { name: 'Ann', pin: rec } }), null, 'a hashed PIN is fine');
  H.ok(/a hash, never the digits/.test(S.validate({ staffId: 'a', set: { pin: '4321' } })), 'the digits themselves are refused');
  H.ok(/role is/.test(S.validate({ staffId: 'a', set: { role: 'boss' } })));
  H.ok(/unknown field/.test(S.validate({ staffId: 'a', set: { wage: 20 } })));
  H.ok(/at least one field/.test(S.validate({ staffId: 'a', set: {} })));
  H.ok(S.pinMatches(rec, '4321') && !S.pinMatches(rec, '1234'), 'the right PIN matches its hash; a wrong one does not');
});

H.testAsync('over HTTP: the first owner, then every change needs the right AND a PIN the hub checked; wrong PINs lock; passes cannot be moved, forged or kept', async function () {
  const f = dbFile('s1'); const srv = await startHubServer({ db: f, adminKey: ADMIN, modules: [S.STAFF], grantSecret: SIGNER });
  try {
    const A = await tablet(srv, 'tabA'), B = await tablet(srv, 'tabB');
    H.ok(await put(A, 'own', { name: 'Ola', role: 'owner', pin: S.pinRecord('1111') }, null), 'a brand-new shop writes its first owner');
    H.ok(!(await put(A, 'mgr', { name: 'Mo', role: 'manager', rights: ['employees', 'payroll'], pin: S.pinRecord('2222') }, 'own')), 'the owner, with no PIN checked by the hub yet: refused');
    H.ok(/not right/.test((await A.pin('own', '9999')).refused || ''), 'a wrong PIN earns no pass');
    H.ok((await A.pin('own', '1111')).grant, 'the right PIN earns a pass for this tablet');
    H.ok(await put(A, 'mgr', { name: 'Mo', role: 'manager', rights: ['employees', 'payroll'], pin: S.pinRecord('2222') }, 'own'), 'with the pass, the owner adds a manager');
    /* the pass is for tabA: carried by tabB it does nothing */
    B.passes = A.passes.slice(); H.ok(!(await put(B, 'clk', { name: 'Cam', pin: S.pinRecord('3333') }, 'own')), 'tabA\'s pass, sent from tabB: refused');
    /* a forged pass */
    const forged = Object.assign({}, A.passes[0], { until: A.passes[0].until + 3600000 }); B.passes = [forged];
    H.ok(!(await put(B, 'clk', { name: 'Cam', pin: S.pinRecord('3333') }, 'own')), 'a pass with its time stretched (signature no longer matches): refused');
    /* the manager, with their own pass on tabB */
    H.ok((await B.pin('mgr', '2222')).grant, 'the manager\'s PIN on tabB');
    H.ok(await put(B, 'clk', { name: 'Cam', role: 'staff', pin: S.pinRecord('3333') }, 'mgr'), 'a manager with "employees" adds a clerk');
    H.ok(!(await put(B, 'own2', { name: 'Oz', role: 'owner' }, 'mgr')), 'but only an owner makes an owner');
    H.ok(!(await put(B, 'own', { name: 'Ola Two' }, 'mgr')), 'or changes one');
    /* the clerk: their own PIN, nothing else */
    const C = await tablet(srv, 'tabC'); await C.pin('clk', '3333');
    H.ok(await put(C, 'clk', { pin: S.pinRecord('4444') }, 'clk'), 'a clerk changes their own PIN');
    H.ok(!(await put(C, 'clk', { rights: ['employees'] }, 'clk')), 'but not their own rights');
    H.ok(!(await put(C, 'mgr', { pin: S.pinRecord('0000') }, 'clk')), 'nor anyone else\'s PIN');
    H.ok((await C.pin('clk', '4444')).grant && !(await C.pin('clk', '3333')).grant, 'the new PIN works and the old one no longer does');
    /* five wrong PINs lock that person on that tablet, even against the right one */
    const D = await tablet(srv, 'tabD'); for (let i = 0; i < G.FREE_TRIES; i++) await D.pin('mgr', '0000');
    H.ok(/too many wrong PINs/.test((await D.pin('mgr', '2222')).refused || ''), 'locked after ' + G.FREE_TRIES + ' wrong PINs, even with the right one');
    H.ok((await A.pin('mgr', '2222')).grant, 'the lock is for that tablet and person only');
    /* an unenrolled device cannot ask */
    H.eq((await post(srv.url, '/v2/pin', { token: 'never-issued-token-00000000', staffId: 'own', pin: '1111' })).status, 401, 'an unenrolled device cannot try PINs');
  } finally { await srv.close(); rmDb(f); }
});

H.testAsync('the negative control: a hub that runs no modules admits the same changes, and checks no PINs', async function () {
  const f = dbFile('s2'); const srv = await startHubServer({ db: f, adminKey: ADMIN });
  try {
    const A = await tablet(srv, 'tabA');
    await put(A, 'own', { name: 'Ola', role: 'owner', pin: S.pinRecord('1111') }, null);
    H.ok(await put(A, 'mgr', { name: 'Mo', role: 'manager' }, 'own'), 'no judge: an un-PINned change lands');
    H.ok(await put(A, 'own2', { name: 'Oz', role: 'owner' }, 'mgr'), 'no judge: a manager makes an owner');
    H.eq((await post(srv.url, '/v2/pin', { token: 'x', staffId: 'own', pin: '1111' })).status, 401);
  } finally { await srv.close(); rmDb(f); }
});

H.test('a pass is honoured only for a fact made inside it, and only until GRACE after it ends', function () {
  let t = 1800000000000; const g = G.grantsFor({ secret: 'x', now: function () { return t; } });
  const staff = S.fold([{ type: 'staff.set', payload: { staffId: 'p', set: { name: 'P', pin: S.pinRecord('5555') } } }]);
  const pass = g.issue(staff, 'p', 'tab', '5555').grant; H.ok(pass, 'issued');
  const fact = function (at) { return { hlc: { t: at } }; };
  H.ok(g.check([pass], 'p', 'tab', fact(t + 1000)), 'a fact made inside it');
  H.ok(!g.check([pass], 'p', 'tab', fact(t - 1000)), 'not a fact made before it');
  H.ok(!g.check([pass], 'p', 'tab', fact(pass.until + 1000)), 'not a fact made after it ended');
  t = pass.until + G.GRACE_MS - 1000; H.ok(g.check([pass], 'p', 'tab', fact(pass.until - 1000)), 'delivered late, inside the grace: honoured');
  t = pass.until + G.GRACE_MS + 1000; H.ok(!g.check([pass], 'p', 'tab', fact(pass.until - 1000)), 'delivered after the grace: refused');
  const other = G.grantsFor({ secret: 'y', now: function () { return pass.since + 1; } });
  H.ok(!other.check([pass], 'p', 'tab', fact(pass.since + 1)), 'a hub with another secret does not honour it');
});

H.testAsync('a PIN hashed in a browser (WebCrypto) is the same as the hub\'s (Node), both ways; a wrong PIN matches neither', async function () {
  const r = S.pinRecord('4321');
  H.eq(await S.pinHashAsync('4321', r.salt, r.iter), r.hash, 'the browser makes the hub\'s hash from the same salt');
  const b = await S.pinRecordAsync('9876');
  H.ok(S.pinMatches(b, '9876') && await S.pinMatchesAsync(b, '9876'), 'a browser-made record matches in both');
  H.ok(!S.pinMatches(b, '9877') && !(await S.pinMatchesAsync(r, '4322')), 'a wrong PIN matches neither (the negative control)');
  H.ok(S.validate({ staffId: 'z', set: { pin: b } }) === null, 'and the hub takes the browser\'s record as a valid staff.set');
});

H.done();
