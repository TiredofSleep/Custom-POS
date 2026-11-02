'use strict';
/* @facts @proof — THE TIME CLOCK MODULE (facts/modules/timeclock.js), over real HTTP against facts/server.js with the staff module:
   a clock-in on one tablet is on every tablet (the gap Custom POS's DB.punches has today: it never leaves its device); who may punch
   and who may correct a shift, with the hub checking the PIN for corrections only; breaks; and the compat projection that rebuilds
   DB.punches' exact shape. Negative controls: a tablet that never syncs does not see the punch; every refused fact lands on a hub that
   runs no modules. This repo's own file.   node facts/test/timeclock-module.test.js */
const H = require('./harness');
const fs = require('fs'), os = require('os'), path = require('path');
const { makeStation } = require('../core/station');
const { httpHub, attach } = require('../sync/http');
const sync = require('../sync/sync');
const { startHubServer } = require('../server');
const S = require('../modules/staff');
const TCM = require('../modules/timeclock');

const ADMIN = 'test-operator-key-clock-0001';
const HOUR = 3600000;
function dbFile(tag) { return path.join(os.tmpdir(), 'custompos-clock-' + tag + '-' + process.pid + '-' + Date.now() + '.db'); }
function rmDb(f) { ['', '-journal', '-wal', '-shm'].forEach(function (s) { try { fs.unlinkSync(f + s); } catch (e) {} }); }
function jstore() { const lines = []; let access = null; return { load: function () { return JSON.parse(JSON.stringify(lines)); }, append: function (row) { lines.push(JSON.parse(JSON.stringify(row))); }, loadAccess: function () { return access; }, saveAccess: function (a) { access = a; } }; }
async function settle(T) { for (let i = 0; i < 300 && T.inFlight; i++) await new Promise(function (r) { setTimeout(r, 10); }); }
async function post(base, p, body, headers) { const r = await fetch(base + p, { method: 'POST', headers: Object.assign({ 'content-type': 'application/json' }, headers || {}), body: JSON.stringify(body) }); return { status: r.status, json: await r.json() }; }
async function tablet(srv, id) {
  const token = (await post(srv.url, '/v2/admin/enroll', { station: id }, { 'x-custompos-admin': ADMIN })).json.token, remote = httpHub(srv.url);
  const T = makeStation({ id: id, persist: jstore() }); T.setAccess(token); attach(T, remote); T.remote = remote;
  T.passes = {}; T.setTransport(function (b) { b.grants = T.passes; return remote.receive(b); });
  T.pin = async function (empId, pin) { const r = await post(srv.url, '/v2/pin-grant', { token: token, empId: empId, pin: pin }); if (r.json.grant) T.passes[empId] = r.json.grant; return r.json; };
  return T;
}
async function put(T, type, key, p, actor) { const e = T.record(type, key, p, { actor: actor }); await settle(T); return { ok: !!T.log.get(e.id).pos, id: e.id }; }
/* @proof — a shop on a hub: an owner, a manager with payroll, a clerk */
async function shop(srv) {
  const A = await tablet(srv, 'counter');
  await put(A, 'employee.set', 'own', { empId: 'own', set: { name: 'Ola', role: 'owner', pin: S.pinRecordSync('1111') } }, null);
  await A.pin('own', '1111');
  await put(A, 'employee.set', 'mgr', { empId: 'mgr', set: { name: 'Mo', role: 'manager', perms: { payroll: true }, pin: S.pinRecordSync('2222') } }, 'own');
  await put(A, 'employee.set', 'clk', { empId: 'clk', set: { name: 'Cam', role: 'staff', pin: S.pinRecordSync('3333') } }, 'own');
  A.passes = {};
  return A;
}

H.section('timeclock module · shared punches, breaks, corrections');

H.testAsync('a clock-in on one tablet is on every tablet; a tablet that never syncs does not see it (the negative control)', async function () {
  const f = dbFile('c1'); const srv = await startHubServer({ db: f, adminKey: ADMIN, modules: [S.STAFF, TCM.TIMECLOCK], grantSecret: 'g1', notify: function () {} });
  try {
    const A = await shop(srv), B = await tablet(srv, 'backroom'), lone = makeStation({ id: 'lone', persist: jstore() });
    const t0 = Date.now() - 2 * HOUR;
    const r = await put(A, 'clock.in', 'clk', { empId: 'clk', at: t0 }, 'clk');   /* no wage on a clerk's own punch (stage-2 review): the person's wage from setup applies */
    H.ok(r.ok, 'the clerk clocks in on the counter, with no PIN check (nobody is kept off the clock by the internet)');
    await sync.pullAsync(B, B.remote);
    const pb = TCM.punches(B.log.all(), S.fold(B.log.all()));
    H.eq(pb.length, 1, 'the back room sees one punch'); H.eq(pb[0].staffId, 'clk'); H.eq(pb[0].name, 'Cam'); H.eq(pb[0].inTs, t0); H.eq(pb[0].out, null, 'still on the clock'); H.eq(pb[0].wage, null, 'no wage written: the person\'s wage from setup applies');
    H.eq(TCM.punches(lone.log.all(), S.fold(lone.log.all())).length, 0, 'a tablet that never synced sees none');
    /* clock out on the OTHER tablet: it closes the same shift */
    const shiftId = TCM.openShift(B.log.all(), 'clk'); H.eq(shiftId, r.id, 'the open shift is the clock-in itself');
    H.ok((await put(B, 'clock.out', 'clk', { empId: 'clk', at: t0 + HOUR, shiftId: shiftId }, 'clk')).ok, 'the clerk clocks out in the back room');
    await sync.pullAsync(A, A.remote);
    const pa = TCM.punches(A.log.all(), S.fold(A.log.all()));
    H.eq(pa.length, 1); H.eq(pa[0].outTs, t0 + HOUR, 'the counter sees the shift closed by the back room');
  } finally { await srv.close(); rmDb(f); }
});

H.testAsync('who may punch and who may correct: a clerk only for themselves; a correction needs "payroll" AND a PIN the hub checked; the hub alone closes a forgotten shift', async function () {
  const f = dbFile('c2'); const srv = await startHubServer({ db: f, adminKey: ADMIN, modules: [S.STAFF, TCM.TIMECLOCK], grantSecret: 'g2', notify: function () {} });
  const f2 = dbFile('c2open'); const open = await startHubServer({ db: f2, adminKey: ADMIN, notify: function () {} });
  try {
    const run = async function (server, judged) {
      const A = judged ? await shop(server) : await tablet(server, 'counter'), out = {}, t0 = Date.now() - 3 * HOUR;
      if (!judged) { await put(A, 'employee.set', 'own', { empId: 'own', set: { name: 'Ola', role: 'owner' } }, null); await put(A, 'employee.set', 'mgr', { empId: 'mgr', set: { name: 'Mo', perms: { payroll: true } } }, 'own'); await put(A, 'employee.set', 'clk', { empId: 'clk', set: { name: 'Cam' } }, 'own'); }
      const inn = await put(A, 'clock.in', 'clk', { empId: 'clk', at: t0 }, 'clk'); out.selfIn = inn.ok;
      out.clerkInsAnother = (await put(A, 'clock.in', 'mgr', { empId: 'mgr', at: t0 }, 'clk')).ok;
      out.managerInsAnother = (await put(A, 'clock.in', 'own', { empId: 'own', at: t0 }, 'mgr')).ok;
      if (judged) await A.pin('clk', '3333');
      out.clerkEdits = (await put(A, 'clock.edit', 'clk', { empId: 'clk', shiftId: inn.id, in: t0 - 600000 }, 'clk')).ok;
      A.passes = {};
      out.managerEditsNoPin = (await put(A, 'clock.edit', 'clk', { empId: 'clk', shiftId: inn.id, in: t0 - 600000 }, 'mgr')).ok;
      if (judged) await A.pin('mgr', '2222');
      out.managerEditsWithPin = (await put(A, 'clock.edit', 'clk', { empId: 'clk', shiftId: inn.id, in: t0 - 600000 }, 'mgr')).ok;
      A.passes = {};
      out.tabletAutocloses = (await put(A, 'clock.autoclose', 'clk', { empId: 'clk', at: t0 + 2 * HOUR, shiftId: inn.id }, 'own')).ok;
      out.breakSelf = (await put(A, 'break.start', 'clk', { empId: 'clk', shiftId: inn.id, at: t0 + HOUR }, 'clk')).ok;
      /* a wage on a clock-in is a pay figure, and a clock-in is never PIN-checked: no tablet writes one, a clerk or a manager with payroll
         (stage-2 review: never a clerk; skeptic 11/1: nor anyone — a lost tablet's key could name the owner and skip the PIN a rate needs) */
      out.clerkWage = (await put(A, 'clock.in', 'clk', { empId: 'clk', at: t0 + 5 * HOUR, wage: 9999 }, 'clk')).ok;
      out.managerWage = (await put(A, 'clock.in', 'mgr', { empId: 'mgr', at: t0 + 5 * HOUR, wage: 22 }, 'mgr')).ok;
      return out;
    };
    const j = await run(srv, true), o = await run(open, false);
    ['selfIn', 'managerInsAnother', 'managerEditsWithPin', 'breakSelf'].forEach(function (k) { H.ok(j[k] === true, 'admitted: ' + k); });
    ['clerkInsAnother', 'clerkEdits', 'managerEditsNoPin', 'tabletAutocloses', 'clerkWage', 'managerWage'].forEach(function (k) { H.ok(j[k] === false, 'refused: ' + k); });
    ['clerkInsAnother', 'clerkEdits', 'managerEditsNoPin', 'tabletAutocloses', 'clerkWage', 'managerWage'].forEach(function (k) { H.ok(o[k] === true, 'a hub with no modules admits: ' + k); });
  } finally { await srv.close(); await open.close(); rmDb(f); rmDb(f2); }
});

H.test('breaks and the compat projection: DB.punches\' exact shape, paid time minus unpaid breaks, a voided shift never paid', function () {
  const reg = require('../core/registry'), EV = require('../core/event'), hlc = require('../core/hlc');
  const clock = hlc.makeClock('fx');
  const fact = function (type, key, payload, actor) { return EV.makeEvent({ type: type, aggregate: reg.typeDef(type).aggregate, key: key, payload: payload, hlc: clock.now(), station: 'fx', actor: actor || null }); };
  const t0 = new Date(2026, 9, 31, 9, 0).getTime();
  const staff = [fact('employee.set', 'clk', { empId: 'clk', set: { name: 'Cam' } }), fact('employee.set', 'mgr', { empId: 'mgr', set: { name: 'Mo' } })];
  const in1 = fact('clock.in', 'clk', { empId: 'clk', at: t0, wage: 16 }, 'clk');
  const b1 = fact('break.start', 'clk', { empId: 'clk', shiftId: in1.id, at: t0 + 2 * HOUR }, 'clk'), b2 = fact('break.end', 'clk', { empId: 'clk', shiftId: in1.id, at: t0 + 2.5 * HOUR }, 'clk');
  const out1 = fact('clock.out', 'clk', { empId: 'clk', at: t0 + 4 * HOUR, shiftId: in1.id }, 'clk');
  const in2 = fact('clock.in', 'mgr', { empId: 'mgr', at: t0 + HOUR, wage: 20 }, 'mgr'), v2 = fact('clock.void', 'mgr', { empId: 'mgr', shiftId: in2.id, reason: 'test' }, 'own');
  const all = staff.concat([in1, b1, b2, out1, in2, v2]);
  const p = TCM.punches(all, S.fold(all));
  H.eq(p.length, 1, 'the voided shift is not there (it never pays)');
  H.deepEq(p[0], { staffId: 'clk', name: 'Cam', in: '09:00', inTs: t0, out: '13:00', outTs: t0 + 4 * HOUR,
    breaks: [{ start: '11:00', startTs: t0 + 2 * HOUR, end: '11:30', endTs: t0 + 2.5 * HOUR }], wage: 16 }, 'DB.punches\' shape, field for field');
  /* pos.html's own paid-time rule over the projection: 4 h clocked less a 30-minute unpaid break */
  const breakMs = p[0].breaks.reduce(function (s, b) { return s + (b.endTs - b.startTs); }, 0);
  H.eq((p[0].outTs - p[0].inTs - breakMs) / HOUR, 3.5, '3.5 paid hours');
  /* a shift with no wage written reads null, so pos.html uses the person's wage (pn.wage != null ? pn.wage : staffWage) — never $0 */
  const man = fact('clock.manual', 'mgr', { empId: 'mgr', in: t0 + 24 * HOUR, out: t0 + 26 * HOUR }, 'own'), noWage = fact('clock.in', 'clk', { empId: 'clk', at: t0 + 48 * HOUR }, 'clk');
  const pm = TCM.punches(all.concat([man, noWage]), S.fold(all));
  H.eq(pm.filter(function (x) { return x.inTs === t0 + 24 * HOUR; })[0].wage, null, 'a manual shift with no wage: null, not 0');
  H.eq(pm.filter(function (x) { return x.inTs === t0 + 48 * HOUR; })[0].wage, null, 'a clock-in with no wage: null, not 0');
  /* a second start while a break is open is not a second break; an end with nothing open changes nothing */
  const b3 = fact('break.start', 'clk', { empId: 'clk', shiftId: in1.id, at: t0 + 3 * HOUR }, 'clk'), b4 = fact('break.start', 'clk', { empId: 'clk', shiftId: in1.id, at: t0 + 3.1 * HOUR }, 'clk');
  const stray = fact('break.end', 'clk', { empId: 'other', shiftId: 'nope', at: t0 }, 'clk');
  H.eq(TCM.foldBreaks([b3, b4]).byShift[in1.id].length, 1, 'one open break at a time');
  H.deepEq(TCM.foldBreaks([stray]).byShift.nope, [], 'an end with no open break changes nothing');
});

/* the fixture's 14 facts are version 1's, never changed; its three employee.set facts were added at rollout step 4 (the staff.set the people
   were written as never left this machine) — so this proves the 17, and v1's own 14 are proved below, names aside (skeptic 11/1) */
H.test('history: version 1\'s saved fact log still verifies and still folds to the same punches (law 1 — a later version must keep this passing; its people added as employee.set at step 4)', function () {
  const EV = require('../core/event');
  const fx = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'modules', 'fixtures', 'timeclock-v1.json'), 'utf8'));
  H.eq(process.env.TZ, fx.tz, 'the fixture\'s times are read on its own clock');
  H.ok(fx.facts.length >= 14 && fx.facts.every(function (e) { return EV.verify(e); }), 'every saved fact still verifies (' + fx.facts.length + ')');
  H.deepEq(TCM.punches(fx.facts, S.fold(fx.facts)), fx.punches, 'the same punches, field for field');
  const v1 = fx.facts.slice(0, 14), noName = function (ps) { return ps.map(function (p) { const q = Object.assign({}, p); delete q.name; return q; }); };
  H.ok(v1.every(function (e) { return e.type !== 'employee.set'; }), 'the first 14 are version 1\'s own facts');
  H.deepEq(noName(TCM.punches(v1, S.fold(v1))), noName(fx.punches), 'version 1\'s own 14 facts alone fold to the same shifts, breaks, times and wages (only the names came from its old staff facts)');
  /* the negative control: one saved fact taken out changes the answer (the comparison can fail) */
  const less = fx.facts.filter(function (e) { return e.type !== 'clock.edit'; });
  H.ok(JSON.stringify(TCM.punches(less, S.fold(less))) !== JSON.stringify(fx.punches), 'without the manager\'s correction the punches differ');
});

H.testAsync('skeptic 11/1 (step 6): a break named after an extra clock-in is the shift\'s; a device named with a space can start a break; a wage on a punch is refused', async function () {
  const reg = require('../core/registry'), EV = require('../core/event'), hlc = require('../core/hlc');
  const ca = hlc.makeClock('tab-a'), cb = hlc.makeClock('tab-b');
  const mk = function (clock, st, type, key, payload, actor) { return EV.makeEvent({ type: type, aggregate: reg.typeDef(type).aggregate, key: key, payload: payload, hlc: clock.now(), station: st, actor: actor || null }); };
  const t0 = new Date(2026, 10, 2, 9, 0).getTime(), staff = [mk(ca, 'tab-a', 'employee.set', 'clk', { empId: 'clk', set: { name: 'Cam' } })];
  /* kit-3: A clocks Cam in (X); B, not yet seeing it, clocks Cam in too (Y) and starts and ends a break on Y; then both sync */
  const X = mk(ca, 'tab-a', 'clock.in', 'clk', { empId: 'clk', at: t0 }, 'clk'), Y = mk(cb, 'tab-b', 'clock.in', 'clk', { empId: 'clk', at: t0 + 60000 }, 'clk');
  const bs = mk(cb, 'tab-b', 'break.start', 'clk', { empId: 'clk', shiftId: Y.id, at: t0 + 2 * HOUR }, 'clk'), be = mk(cb, 'tab-b', 'break.end', 'clk', { empId: 'clk', shiftId: Y.id, at: t0 + 2.5 * HOUR }, 'clk');
  const out = mk(ca, 'tab-a', 'clock.out', 'clk', { empId: 'clk', at: t0 + 4 * HOUR, shiftId: X.id }, 'clk');
  const all = staff.concat([X, Y, bs, be, out]), p = TCM.punches(all, S.fold(all));
  H.eq(p.length, 1, 'one shift (the second clock-in is an extra tap of it)');
  H.eq(JSON.stringify(p[0].breaks.map(function (b) { return [b.startTs, b.endTs]; })), JSON.stringify([[t0 + 2 * HOUR, t0 + 2.5 * HOUR]]), 'the break B named after its own clock-in is on that shift, not lost and paid as worked time');
  /* A ends the break only after it has B's start (it is A's screen that shows the break), so A's clock has seen B's */
  const bs2 = mk(cb, 'tab-b', 'break.start', 'clk', { empId: 'clk', shiftId: Y.id, at: t0 + HOUR }, 'clk'); ca.observe(bs2.hlc);
  const mixed = staff.concat([X, Y, bs2, mk(ca, 'tab-a', 'break.end', 'clk', { empId: 'clk', shiftId: X.id, at: t0 + 1.25 * HOUR }, 'clk')]);
  H.eq(JSON.stringify(TCM.punches(mixed, S.fold(mixed))[0].breaks.map(function (b) { return [b.startTs, b.endTs]; })), JSON.stringify([[t0 + HOUR, t0 + 1.25 * HOUR]]), 'a break started on one tap and ended on the other is one break');
  const only = staff.concat([X, Y, bs, be]).filter(function (e) { return e !== X; });
  H.eq(TCM.punches(only, S.fold(only))[0].breaks.length, 1, 'the negative control: with only B\'s clock-in, the break is on it as before');
  /* kit-4: a station the hub enrolled as "Front Counter" clocks in, and its break names that clock-in */
  const f = dbFile('c6'); const srv = await startHubServer({ db: f, adminKey: ADMIN, modules: [S.STAFF, TCM.TIMECLOCK], grantSecret: 'g6', notify: function () {} });
  try {
    const A = await shop(srv), FC = await tablet(srv, 'Front Counter');
    const inn = await put(FC, 'clock.in', 'clk', { empId: 'clk', at: Date.now() - HOUR }, 'clk');
    H.ok(inn.ok && /^Front Counter\//.test(inn.id), 'a device named with a space clocks in');
    H.ok((await put(FC, 'break.start', 'clk', { empId: 'clk', shiftId: inn.id, at: Date.now() - 1800000 }, 'clk')).ok, 'and its break names that clock-in and lands (it was refused: no space allowed)');
    let refused = ''; try { FC.record('break.start', 'clk', { empId: 'clk', shiftId: 'Front Counter', at: Date.now() }, { actor: 'clk' }); } catch (e) { refused = String(e.message); }
    H.ok(/names its shift by the clock-in/.test(refused), 'the negative control: a shift id that is not a clock-in\'s is still refused');
    /* authority-5: a wage on a punch is refused even naming the owner; the hub reads none */
    H.ok(!(await put(A, 'clock.in', 'own', { empId: 'own', at: Date.now() - 600000, wage: 500 }, 'own')).ok, 'a wage on a clock-in naming the owner is refused (no PIN guards a punch)');
    H.ok((await put(A, 'clock.in', 'own', { empId: 'own', at: Date.now() - 600000 }, 'own')).ok, 'the same clock-in with no wage lands');
  } finally { await srv.close(); rmDb(f); }
});

H.test('stage-2 review: a break naming shift "constructor" cannot break anyone\'s punches; a skewed break end closes at its start; a break never outlasts its shift', function () {
  const reg = require('../core/registry'), EV = require('../core/event'), hlc = require('../core/hlc'), clock = hlc.makeClock('rv');
  const fact = function (type, key, payload, actor) { return EV.makeEvent({ type: type, aggregate: reg.typeDef(type).aggregate, key: key, payload: payload, hlc: clock.now(), station: 'rv', actor: actor || null }); };
  H.ok(/clock-in.s id/.test(String(reg.typeDef('break.start').admit({ empId: 'clk', shiftId: 'constructor', at: 1 }, function () { return false; }))), 'a NEW break naming "constructor" is refused at the door');
  const t0 = new Date(2026, 9, 31, 9, 0).getTime(), staff = [fact('employee.set', 'clk', { empId: 'clk', set: { name: 'Cam' } })];
  const inn = fact('clock.in', 'clk', { empId: 'clk', at: t0 }, 'clk');
  /* history that already holds such a fact (made before the door rule): the fold must not throw */
  const poison = fact('break.start', 'clk', { empId: 'clk', shiftId: 'constructor', at: t0 + 1000 }, 'clk');
  let threw = null; try { TCM.punches(staff.concat([inn, poison]), S.fold(staff)); } catch (e) { threw = e.message; }
  H.eq(threw, null, 'punches() over a poisoned history does not throw');
  /* a break.end written a moment BEFORE its start (a skewed tablet), and a shift closed with its break never ended */
  const bs = fact('break.start', 'clk', { empId: 'clk', shiftId: inn.id, at: t0 + 2 * HOUR }, 'clk'), be = fact('break.end', 'clk', { empId: 'clk', shiftId: inn.id, at: t0 + 2 * HOUR - 60000 }, 'clk');
  const out = fact('clock.out', 'clk', { empId: 'clk', at: t0 + 4 * HOUR, shiftId: inn.id }, 'clk');
  const p1 = TCM.punches(staff.concat([inn, bs, be, out]), S.fold(staff))[0];
  H.eq(p1.breaks[0].endTs, p1.breaks[0].startTs, 'the skewed end closes the break at its start (zero length), not left open');
  const inn2 = fact('clock.in', 'clk', { empId: 'clk', at: t0 + 24 * HOUR }, 'clk'), bs2 = fact('break.start', 'clk', { empId: 'clk', shiftId: inn2.id, at: t0 + 26 * HOUR }, 'clk'), out2 = fact('clock.out', 'clk', { empId: 'clk', at: t0 + 28 * HOUR, shiftId: inn2.id }, 'clk');
  const p2 = TCM.punches(staff.concat([inn2, bs2, out2]), S.fold(staff))[0];
  H.eq(p2.breaks[0].endTs, t0 + 28 * HOUR, 'a break never ended stops at the clock-out');
  const paid = (p2.outTs - p2.inTs - p2.breaks.reduce(function (a, b) { return a + (b.endTs - b.startTs); }, 0)) / HOUR;
  H.eq(paid, 2, 'so the shift pays its 2 hours before the break, not 0');
});

H.done();
