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
    /* the shop's df9fc814: a pass names the PIN it was earned with, so the change just made ends it (the rules below are then judged on a
       pass from the new PIN, so each refusal is the rule's own) */
    H.ok(!(await put(C, 'clk', { lang: 'en' }, 'clk')), 'the pass earned with the old PIN no longer works, even for their own language');
    H.ok((await C.pin('clk', '4444')).grant, 'the new PIN earns a new pass');
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

H.testAsync('the shop\'s df9fc814, over HTTP: a changed PIN or an inactive person ends the pass (fact and renewal); a burst of guesses gets five', async function () {
  const f = dbFile('s5'), alerts = [];
  const srv = await startHubServer({ db: f, adminKey: ADMIN, modules: [S.STAFF], grantSecret: SIGNER, notify: function (a) { alerts.push(a); } });
  try {
    const A = await tablet(srv, 'tabA'), M = await tablet(srv, 'tabM');
    H.ok(await put(A, 'own', { name: 'Ola', role: 'owner', pin: rec('1111') }, null), 'the first owner');
    await A.pin('own', '1111');
    H.ok(await put(A, 'mgr', { name: 'Mo', role: 'manager', perms: { employees: true }, pin: rec('2222') }, 'own'), 'a manager');
    await M.pin('mgr', '2222'); const old = M.passes.mgr;
    const renew = async function (T, g) { return (await post(srv.url, '/v2/pin-grant', { token: T.token, grant: g })).json; };
    H.ok((await renew(M, old)).ok, 'the negative control: before any change, the manager\'s pass renews');
    /* the owner changes the manager's PIN (someone watched it typed): every pass made with the old one ends */
    H.ok(await put(A, 'mgr', { pin: rec('2468') }, 'own'), 'the owner changes the manager\'s PIN');
    const r1 = await renew(M, old);
    H.ok(!r1.ok && /PIN this pass was earned with has changed/.test(String(r1.refused)) && /the PIN again/.test(String(r1.refused)), 'the old pass is not renewed: ' + r1.refused);
    M.passes = { mgr: old };
    H.ok(!(await put(M, 'clk', { name: 'Cam', pin: rec('3333') }, 'mgr')), 'nor does it carry a change');
    H.ok((await M.pin('mgr', '2468')).grant && (await renew(M, M.passes.mgr)).ok, 'the new PIN\'s pass works and renews');
    /* made inactive: the pass ends at its renewal */
    const live = M.passes.mgr;
    H.ok(await put(A, 'mgr', { active: false }, 'own'), 'the owner switches the manager off');
    H.ok(/no longer active/.test(String((await renew(M, live)).refused)), 'an inactive person\'s pass is not renewed');
    /* a burst of guesses sent at once: five are checked, no more (each one hashed costs the hub; the lock counted only finished ones) */
    H.ok(await put(A, 'mgr', { active: true }, 'own'), 'back on');
    const B = await tablet(srv, 'tabB');
    const burst = await Promise.all(Array.from({ length: 12 }, function () { return post(srv.url, '/v2/pin-grant', { token: B.token, empId: 'mgr', pin: '0000' }); }));
    const wrong = burst.filter(function (r) { return r.json.refused === 'wrong PIN'; }).length;
    H.ok(wrong <= 5 && burst.every(function (r) { return !r.json.grant; }), '12 guesses at once: ' + wrong + ' checked (at most 5), none admitted');
    H.ok(/too many wrong PINs/.test(String((await B.pin('mgr', '2468')).refused)), 'and then that person is locked on that tablet, even with the right PIN');
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

H.testAsync('skeptic 11/1 (step 6): a pass for a fact done after it ended, or sent past its grace, is refused; payroll alone sets no rate; a flood of staff facts no tablet can stall the hub with; a right nobody can hold is a start-up error', async function () {
  const { assemble, defineModule } = require('../modules/define');
  let T = 1800000000000; const g = G.grantsFor({ secret: 's6', now: function () { return T; } }), A = assemble([S.STAFF], { grantCheck: g.verify });
  let c = 0; const fact = function (type, key, payload, actor, at) { c++; return { id: 'tab/f' + c, type: type, aggregate: 'staff', station: 'tab', actor: actor, at: at == null ? T : at, payload: payload, hlc: { t: at == null ? T : at, c: c, id: 'tab' } }; };
  const emp = function (empId, set, actor, at) { return fact('employee.set', empId, { empId: empId, set: set }, actor, at); };
  const master = [emp('own', { name: 'Ola', role: 'owner', pin: rec('1111') }, null), emp('pay', { name: 'Pia', role: 'manager', perms: { payroll: true }, pin: rec('2222') }, 'own'), emp('clk', { name: 'Cam', pin: rec('3333') }, 'own')];
  /* the judge hands the pass check the FACT's own time (parity-4: a constant there admitted a change made after the pass ended) */
  const pass = (await g.check('tab', 'own', '1111', S.fold(master), S.rules.pinHash, S.rules.pinIter)).grant, b = { grants: { own: pass } };
  H.eq(A.judge(emp('clk', { name: 'Cami' }, 'own', T + 60000), master, [], b), null, 'a change made inside the pass is admitted');
  H.ok(/had ended before this was done/.test(String(A.judge(emp('clk', { name: 'Cami' }, 'own', pass.exp + 1000), master, [], b))), 'one made after the pass ended is refused, by the fact\'s own time');
  T = pass.exp + G.GRACE_MS + 1000;
  H.ok(/more than 2 hours ago/.test(String(A.judge(emp('clk', { name: 'Cami' }, 'own', pass.exp - 1000), master, [], b))), 'and one made inside it but sent after the grace is refused');
  T = 1800000000000;
  /* the stricter rule, against someone who holds payroll and not employees (parity-3: the default manager could not tell the two apart) */
  const ppass = (await g.check('tab', 'pay', '2222', S.fold(master), S.rules.pinHash, S.rules.pinIter)).grant, pb = { grants: { pay: ppass } };
  H.ok(/may write only their own|does not have/.test(String(A.judge(emp('clk', { rate: 18 }, 'pay'), master, [], pb))), 'payroll alone does not set another person\'s pay rate here (the shop\'s hub admits it)');
  H.ok(/may change only their own PIN/.test(String(A.judge(emp('pay', { rate: 40 }, 'pay'), master, [], pb))), 'nor their own');
  H.ok(/may change only their own PIN/.test(String(A.judge(emp('pay', { rate: 40, perms: { employees: true, reset: true } }, 'pay'), master, [], pb))), 'nor, with a rate riding along, their own permissions (the shop\'s hub admits that, by design of its Admin save: one fact under the payroll person who re-approved the rate)');
  /* authority-1: staff.refused and staff.signedIn change nothing the judge reads, so a flood of them is never folded again per fact judged */
  const flood = master.slice(); for (let i = 0; i < 3000; i++) flood.push(fact('staff.refused', 'x' + i, { gate: 'Time clock', why: 'pin' }, null));
  const AGGs = require('../aggregates/staff'), realFold = AGGs.fold; let folds = 0;
  AGGs.fold = function () { folds++; return realFold.apply(this, arguments); };
  try {
    const signed = fact('staff.signedIn', 'own', { gate: 'Office' }, 'own'), t0 = Date.now();
    for (let i = 0; i < 300; i++) A.judge(emp('own', { lang: 'en' }, 'own'), flood, [signed], b);
    H.ok(folds <= 1, '300 facts judged after a staff.signedIn in the same send, beside 3,000 staff.refused: ' + folds + ' fold(s) in ' + (Date.now() - t0) + ' ms (it was one per fact)');
    folds = 0; const mixed = [];
    for (let i = 0; i < 300; i++) { mixed.push(fact('staff.refused', 'y' + i, { gate: 'Time clock', why: 'pin' }, null)); A.judge(emp('own', { lang: 'en' }, 'own'), flood, mixed, b); }
    H.ok(folds <= 1, 'nor when the send slips a new staff.refused before every fact judged: ' + folds + ' fold(s) (no tablet needs a PIN to write one, and none changes what the judge reads)');
    folds = 0; const lift = emp('clk', { perms: { employees: true } }, 'own');
    for (let i = 0; i < 300; i++) A.judge(emp('new' + i, { name: 'N' + i }, 'clk'), flood, [lift], { grants: {} });
    H.eq(folds, 1, 'a send\'s own staff change is folded once, not once per fact judged after it');
  } finally { AGGs.fold = realFold; }
  /* authority-4: a right no person can be given stops the start */
  const bad = function (right) { let m = ''; try { assemble([S.STAFF, defineModule({ name: 'risky-' + right.replace(/[^a-z]/g, ''), version: 1, aggregate: { name: 'risky' + right.replace(/[^a-z]/g, ''), fold: function () { return {}; } }, facts: { ['risky' + right.replace(/[^a-z]/g, '') + '.do']: { authority: 'needs:' + right, validate: function () { return null; } } } })], { noPins: true }); } catch (e) { m = String(e.message); } return m; };
  H.ok(/every object already has/.test(bad('constructor')), '"constructor" is refused as a right (everyone would hold it)');
  H.ok(/not among this business's abilities/.test(bad('fly')), 'a right that is not among the business\'s abilities is refused at start');
  H.eq(bad('payroll'), '', 'the negative control: a right the business has is fine');
});

H.done();
