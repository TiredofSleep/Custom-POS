'use strict';
/* @facts @proof — THE STAFF MODULE AND THE PIN THE HUB CHECKS (facts/modules/staff.js over the origin shop's aggregates/staff.js,
   core/staff.js and hub/pingrant.js), over real HTTP against facts/server.js. A brand-new shop writes its first owner; from then on a
   change to the staff needs the right AND a PIN the hub checked itself, on that tablet; wrong PINs lock; a pass from another tablet or a
   forged one does nothing; only an owner makes an owner; a person changes only their own few fields; the shop's role lists decide who
   holds a right. The shop's own proofs of the pass itself (time, renewal, the lock) are facts/test/proofs/996, imported. The negative
   control: the same facts land on a hub that runs no modules. This repo's own file.   node facts/test/staff.test.js */
const H = require('./harness');
const fs = require('fs'), os = require('os'), path = require('path');
const { makeStation } = require('../core/station');
const { httpHub, attach } = require('../sync/http');
const { startHubServer } = require('../server');
const registry = require('../core/registry');
const S = require('../modules/staff');
const G = require('../hub/pingrant');

const ADMIN = 'test-operator-key-staff-0001', SIGNER = 'test-pass-signer-0001';   /* a made-up signing value for the proofs' hub */
const rec = S.pinRecordSync;
/* @proof — a database file in temp, and its removal */
function dbFile(tag) { return path.join(os.tmpdir(), 'custompos-staff-' + tag + '-' + process.pid + '-' + Date.now() + '.db'); }
function rmDb(f) { ['', '-journal', '-wal', '-shm'].forEach(function (s) { try { fs.unlinkSync(f + s); } catch (e) {} }); }
/* @proof — a tablet's journal in memory */
function jstore() { const lines = []; let access = null; return { load: function () { return JSON.parse(JSON.stringify(lines)); }, append: function (row) { lines.push(JSON.parse(JSON.stringify(row))); }, loadAccess: function () { return access; }, saveAccess: function (a) { access = a; } }; }
async function settle(T) { for (let i = 0; i < 300 && T.inFlight; i++) await new Promise(function (r) { setTimeout(r, 10); }); }
async function post(base, p, body, headers) { const r = await fetch(base + p, { method: 'POST', headers: Object.assign({ 'content-type': 'application/json' }, headers || {}), body: JSON.stringify(body) }); return { status: r.status, json: await r.json() }; }
/* @proof — a tablet the operator enrolled; its sends carry the passes it holds, by person (the shop's shape: tab.passes = {empId: grant}) */
async function tablet(srv, id) {
  const token = (await post(srv.url, '/v2/admin/enroll', { station: id }, { 'x-custompos-admin': ADMIN })).json.token, remote = httpHub(srv.url);
  const T = makeStation({ id: id, persist: jstore() }); T.setAccess(token); attach(T, remote); T.token = token;
  T.passes = {}; T.setTransport(function (b) { b.grants = T.passes; return remote.receive(b); });
  T.pin = async function (empId, pin) { const r = await post(srv.url, '/v2/pin-grant', { token: token, empId: empId, pin: pin }); if (r.json.grant) T.passes[empId] = r.json.grant; return r.json; };
  return T;
}
/* @proof — record a fact by actor and say whether the hub took it */
async function putFact(T, type, key, payload, actor) { const e = T.record(type, key, payload, { actor: actor }); await settle(T); return !!T.log.get(e.id).pos; }
/* @proof — an employee.set by actor, and whether the hub took it */
function put(T, empId, set, actor) { return putFact(T, 'employee.set', empId, { empId: empId, set: set }, actor); }

H.section('staff · the shop\'s people as facts, and the PIN the hub checks');

H.test('an employee.set is checked by the shop\'s own validator — above all a PIN that is digits, not a hash', function () {
  const v = function (p) { return registry.typeDef('employee.set').validate(p); };
  H.eq(v({ empId: 'a', set: { name: 'Ann', pin: rec('4321') } }), null, 'a hashed PIN is fine');
  H.ok(/never the PIN itself/.test(String(v({ empId: 'a', set: { pin: '4321' } }))), 'the digits themselves are refused');
  H.ok(/never the PIN itself/.test(String(v({ empId: 'a', set: { pin: { salt: rec('1').salt, hash: rec('1').hash, plain: '4321' } } }))), 'and so is a PIN riding in under another name');
  H.ok(/role is/.test(String(v({ empId: 'a', set: { role: 'boss' } }))));
  H.ok(/is not an employee field/.test(String(v({ empId: 'a', set: { wage: 20 } }))));
  H.ok(/is not an ability/.test(String(v({ empId: 'a', set: { perms: { fly: true } } }))), 'a permission names an ability in the business\'s own list (core/abilities.js)');
  H.ok(/set lists what changed/.test(String(v({ empId: 'a', set: {} }))));
  H.ok(S.rules.pinHashSync('4321', rec('4321', 'ab'.repeat(16)).salt, S.rules.PIN_ITER_NOW) === rec('4321', 'ab'.repeat(16)).hash, 'the right PIN makes its hash');
});

H.testAsync('over HTTP: the first owner, then every change needs the right AND a PIN the hub checked; wrong PINs lock; a pass cannot be moved or forged', async function () {
  const f = dbFile('s1'), alerts = [];
  const srv = await startHubServer({ db: f, adminKey: ADMIN, modules: [S.STAFF], grantSecret: SIGNER, notify: function (a) { alerts.push(a); } });
  try {
    const A = await tablet(srv, 'tabA'), B = await tablet(srv, 'tabB');
    H.ok(await put(A, 'own', { name: 'Ola', role: 'owner', pin: rec('1111') }, null), 'a brand-new shop writes its first owner');
    H.ok(!(await put(A, 'mgr', { name: 'Mo', role: 'manager', perms: { employees: true, payroll: true }, pin: rec('2222') }, 'own')), 'the owner, with no PIN checked by the hub yet: refused');
    H.eq((await A.pin('own', '9999')).refused, 'wrong PIN', 'a wrong PIN earns no pass');
    H.ok((await A.pin('own', '1111')).grant, 'the right PIN earns a pass for this tablet');
    H.ok(await put(A, 'mgr', { name: 'Mo', role: 'manager', perms: { employees: true, payroll: true }, pin: rec('2222') }, 'own'), 'with the pass, the owner adds a manager who may manage employees');
    /* the pass is for tabA: carried by tabB it does nothing */
    B.passes = { own: A.passes.own }; H.ok(!(await put(B, 'clk', { name: 'Cam', pin: rec('3333') }, 'own')), 'tabA\'s pass, sent from tabB: refused');
    /* a forged pass */
    B.passes = { own: Object.assign({}, A.passes.own, { exp: A.passes.own.exp + 3600000 }) };
    H.ok(!(await put(B, 'clk', { name: 'Cam', pin: rec('3333') }, 'own')), 'a pass with its time stretched (signature no longer matches): refused');
    /* a pass for someone else does not stand in for the person named */
    B.passes = {}; await B.pin('mgr', '2222'); B.passes.own = B.passes.mgr;
    H.ok(!(await put(B, 'clk', { name: 'Cam', pin: rec('3333') }, 'own')), 'the manager\'s pass, sent as the owner\'s: refused');
    /* the manager, with their own pass on tabB */
    H.ok(await put(B, 'clk', { name: 'Cam', role: 'staff', pin: rec('3333') }, 'mgr'), 'a manager holding "employees" adds a clerk');
    H.ok(!(await put(B, 'own2', { name: 'Oz', role: 'owner' }, 'mgr')), 'but only an owner makes an owner');
    H.ok(!(await put(B, 'own', { name: 'Ola Two' }, 'mgr')), 'or changes one');
    /* the clerk: their own PIN, slip and language, nothing else */
    const C = await tablet(srv, 'tabC'); await C.pin('clk', '3333');
    H.ok(await put(C, 'clk', { pin: rec('4444'), lang: 'es' }, 'clk'), 'a clerk changes their own PIN and language');
    H.ok(!(await put(C, 'clk', { perms: { employees: true } }, 'clk')), 'but not their own permissions');
    H.ok(!(await put(C, 'clk', { name: 'Camille', pin: rec('5555') }, 'clk')), 'nor their own name, even beside their PIN');
    H.ok(!(await put(C, 'mgr', { pin: rec('0000') }, 'clk')), 'nor anyone else\'s PIN');
    H.ok((await C.pin('clk', '4444')).grant && (await C.pin('clk', '3333')).refused === 'wrong PIN', 'the new PIN works and the old one no longer does');
    /* five wrong PINs lock that person on that tablet, even against the right one, and the operator is told once */
    const D = await tablet(srv, 'tabD'); for (let i = 0; i < 6; i++) await D.pin('mgr', '0000');
    H.ok(/too many wrong PINs/.test((await D.pin('mgr', '2222')).refused || ''), 'locked after 5 wrong PINs, even with the right one');
    H.eq(alerts.filter(function (a) { return a && a.kind === 'pin-locked'; }).length, 1, 'the operator is told once');
    H.ok((await A.pin('mgr', '2222')).grant, 'the lock is for that tablet and person only');
    /* a pass is renewed without the PIN on its own tablet, never on another */
    const renewed = (await post(srv.url, '/v2/pin-grant', { token: A.token, grant: A.passes.own })).json;
    H.ok(renewed.ok && renewed.grant.since === A.passes.own.since && renewed.grant.exp >= A.passes.own.exp, 'renewed on its own tablet, from the same PIN');
    H.ok(/another tablet/.test(String((await post(srv.url, '/v2/pin-grant', { token: B.token, grant: A.passes.own })).json.refused)), 'not from another tablet');
    /* an unenrolled device cannot ask */
    H.eq((await post(srv.url, '/v2/pin-grant', { token: 'never-issued-token-00000000', empId: 'own', pin: '1111' })).status, 401, 'an unenrolled device cannot try PINs');
  } finally { await srv.close(); rmDb(f); }
});

H.testAsync('the negative control: a hub that runs no modules admits the same changes, and checks no PINs', async function () {
  const f = dbFile('s2'); const srv = await startHubServer({ db: f, adminKey: ADMIN });
  try {
    const A = await tablet(srv, 'tabA');
    await put(A, 'own', { name: 'Ola', role: 'owner', pin: rec('1111') }, null);
    H.ok(await put(A, 'mgr', { name: 'Mo', role: 'manager' }, 'own'), 'no judge: an un-PINned change lands');
    H.ok(await put(A, 'own2', { name: 'Oz', role: 'owner' }, 'mgr'), 'no judge: a manager makes an owner');
    H.ok(/checks no PINs/.test(String((await post(srv.url, '/v2/pin-grant', { token: A.token, empId: 'own', pin: '1111' })).json.refused)), 'and no pass is issued');
  } finally { await srv.close(); rmDb(f); }
});

H.testAsync('the shop\'s role lists decide who holds a right on the hub: staff.roles needs "employees" and a PIN; a person\'s own override beats their role', async function () {
  const f = dbFile('s3'); const srv = await startHubServer({ db: f, adminKey: ADMIN, modules: [S.STAFF], grantSecret: SIGNER, notify: function () {} });
  try {
    const A = await tablet(srv, 'tabA'), C = await tablet(srv, 'tabC');
    await put(A, 'own', { name: 'Ola', role: 'owner', pin: rec('1111') }, null); await A.pin('own', '1111');
    H.ok(await put(A, 'clk', { name: 'Cam', role: 'staff', pin: rec('3333') }, 'own') && await put(A, 'mgr', { name: 'Mo', role: 'manager', pin: rec('2222') }, 'own'), 'the owner adds a clerk and a manager');
    await C.pin('clk', '3333');
    H.ok(!(await put(C, 'new1', { name: 'Nia' }, 'clk')), 'a clerk, by the business\'s default lists, adds nobody');
    H.ok(!(await putFact(C, 'staff.roles', 'roles', { rolePerms: { staff: ['unrack', 'employees'] } }, 'clk')), 'nor changes what a role may do');
    const roles = { staff: S.rules.ROLE_PERMS.staff.concat(['employees']) };
    H.ok(await putFact(A, 'staff.roles', 'roles', { rolePerms: roles }, 'own'), 'the owner, with a PIN the hub checked, lets every clerk manage employees');
    H.ok(await put(C, 'new1', { name: 'Nia' }, 'clk'), 'and now the clerk adds a person: the hub read the new list');
    H.ok(await put(A, 'clk', { perms: { employees: false } }, 'own'), 'the owner takes it off this one clerk alone');
    H.ok(!(await put(C, 'new2', { name: 'Noa' }, 'clk')), 'their own override beats the role\'s list');
    const M = await tablet(srv, 'tabM'); await M.pin('mgr', '2222');
    H.ok(!(await put(M, 'new3', { name: 'Ned' }, 'mgr')), 'a manager by the default lists does not manage employees (core/abilities.js)');
    H.ok(!(await put(M, 'clk', { rate: 18 }, 'mgr')), 'nor sets a pay rate here — a rate needs "employees" in this repo (the shop also lets "payroll" set one)');
  } finally { await srv.close(); rmDb(f); }
});

H.testAsync('a PIN hashed in a browser (WebCrypto) is the hub\'s (Node), both ways; the shop\'s empByPin finds its person; a wrong PIN matches nobody', async function () {
  H.ok(!!(globalThis.crypto && globalThis.crypto.subtle), 'this Node has the browser\'s WebCrypto (so the proof runs the browser\'s path)');
  const r = rec('4321');
  H.eq(await S.rules.pinHash('4321', r.salt, r.iter), r.hash, 'the browser makes the hub\'s hash from the same salt');
  const b = await S.pinRecord('9876');
  H.eq(S.rules.pinHashSync('9876', b.salt, b.iter), b.hash, 'a browser-made record matches in Node');
  H.eq(registry.typeDef('employee.set').validate({ empId: 'z', set: { pin: b } }), null, 'and the hub takes it as a valid employee.set');
  const people = [{ id: 'a', active: true, pin: r }, { id: 'b', active: true, pin: b }, { id: 'c', active: false, pin: rec('5555') }];
  H.eq(((await S.empByPin(' 9876 ', people)) || {}).id, 'b', 'the shop\'s empByPin finds whose PIN it is (what was typed is trimmed)');
  H.eq(await S.empByPin('9877', people), null, 'a wrong PIN matches nobody (the negative control)');
  H.eq(await S.empByPin('5555', people), null, 'nor does an inactive person\'s');
});

H.testAsync('stage-2 review, in the shop\'s shape: a new shop starts with its owner; the last active owner stays; a null role leaves the owner an owner; a flood of passes costs one signature a fact', async function () {
  const { assemble } = require('../modules/define');
  const g = G.grantsFor({ secret: 'r' }), A = assemble([S.STAFF], { grantCheck: g.verify });
  const now = Date.now(), fact = function (empId, set, actor) { return { type: 'employee.set', aggregate: 'staff', station: 'tab', actor: actor, at: now, payload: { empId: empId, set: set }, hlc: { t: now, c: 0 } }; };
  H.ok(/starts with its owner/.test(String(A.judge(fact('clk', { name: 'Cam', role: 'staff' }, null), [], []))), 'a brand-new shop refuses a first person who is not an owner');
  H.eq(A.judge(fact('own', { name: 'Ola', role: 'owner' }, null), [], []), null, 'and admits its owner first');
  const master = [fact('own', { name: 'Ola', role: 'owner', pin: rec('1111') }, null)];
  const pass = (await g.check('tab', 'own', '1111', S.fold(master), S.rules.pinHash, S.rules.pinIter)).grant, b = { grants: { own: pass } };
  H.ok(!!pass, 'the owner\'s pass');
  H.ok(/must keep an active owner/.test(String(A.judge(fact('own', { role: 'manager' }, 'own'), master, [], b))), 'the last owner cannot demote themselves');
  H.ok(/must keep an active owner/.test(String(A.judge(fact('own', { active: false }, 'own'), master, [], b))), 'nor switch themselves off');
  H.eq(A.judge(fact('own', { role: null }, 'own'), master, [], b), null, 'a null role is admitted (skeptic pass: it slipped past the rebuilt module) —');
  H.eq(S.fold(master.concat([fact('own', { role: null }, 'own')])).byId.get('own').role, 'owner', '— because the shop\'s fold leaves the role as it was: the owner is still an owner');
  const two = master.concat([fact('own2', { name: 'Oz', role: 'owner' }, 'own')]);
  H.eq(A.judge(fact('own', { role: 'manager' }, 'own'), two, [], b), null, 'the negative control: with a second owner, the first may step down');
  /* a send's own earlier staff facts count for its later ones, as the shop's hub lays them on top (its judgeFor) */
  const team = two.concat([fact('clk', { name: 'Cam', role: 'staff', pin: rec('3333') }, 'own')]);
  const cpass = (await g.check('tab', 'clk', '3333', S.fold(team), S.rules.pinHash, S.rules.pinIter)).grant, both = { grants: { own: pass, clk: cpass } };
  const lift = fact('clk', { perms: { employees: true } }, 'own'), hire = fact('new1', { name: 'Nia' }, 'clk');
  H.ok(/may write only their own/.test(String(A.judge(hire, team, [], both))), 'a clerk alone adds nobody');
  H.eq(A.judge(hire, team, [lift], both), null, 'but after the owner\'s change earlier in the same send, the clerk may: the send\'s own staff facts are laid on top');
  /* a send's passes are keyed by person, so a flood of junk passes is never read: one signature per PIN-checked fact, for its own person */
  const junk = { own: pass }; for (let i = 0; i < 5000; i++) junk['p' + i] = { emp: 'p' + i, station: 'tab', since: 1, exp: now + 1e6, sig: 'f'.repeat(64) };
  const crypto = require('crypto'), real = crypto.createHmac; let sigs = 0;
  crypto.createHmac = function () { sigs++; return real.apply(crypto, arguments); };
  let ok = 0; try { for (let i = 0; i < 200; i++) if (A.judge(fact('own', { lang: 'en' }, 'own'), master, [], { grants: junk }) === null) ok++; } finally { crypto.createHmac = real; }
  H.ok(ok === 200 && sigs <= 200, '200 facts sent beside 5,000 junk passes: admitted, ' + sigs + ' signatures computed (at most 1 each)');
  H.ok(/PIN checked by the hub/.test(String(A.judge(fact('own', { lang: 'en' }, 'own'), master, [], { grants: [pass] }))), 'passes sent as a list (the rebuilt module\'s shape) are not read: refused');
});

H.done();
