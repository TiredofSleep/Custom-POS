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
      /* a wage on a clock-in is a pay figure: never from a clerk, from someone with payroll yes (stage-2 review) */
      out.clerkWage = (await put(A, 'clock.in', 'clk', { empId: 'clk', at: t0 + 5 * HOUR, wage: 9999 }, 'clk')).ok;
      out.managerWage = (await put(A, 'clock.in', 'mgr', { empId: 'mgr', at: t0 + 5 * HOUR, wage: 22 }, 'mgr')).ok;
      return out;
    };
    const j = await run(srv, true), o = await run(open, false);
    ['selfIn', 'managerInsAnother', 'managerEditsWithPin', 'breakSelf', 'managerWage'].forEach(function (k) { H.ok(j[k] === true, 'admitted: ' + k); });
    ['clerkInsAnother', 'clerkEdits', 'managerEditsNoPin', 'tabletAutocloses', 'clerkWage'].forEach(function (k) { H.ok(j[k] === false, 'refused: ' + k); });
    ['clerkInsAnother', 'clerkEdits', 'managerEditsNoPin', 'tabletAutocloses', 'clerkWage'].forEach(function (k) { H.ok(o[k] === true, 'a hub with no modules admits: ' + k); });
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

H.test('history: version 1\'s saved fact log still verifies and still folds to the same punches (law 1 — a later version must keep this passing)', function () {
  const EV = require('../core/event');
  const fx = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'modules', 'fixtures', 'timeclock-v1.json'), 'utf8'));
  H.eq(process.env.TZ, fx.tz, 'the fixture\'s times are read on its own clock');
  H.ok(fx.facts.length >= 14 && fx.facts.every(function (e) { return EV.verify(e); }), 'every saved fact still verifies (' + fx.facts.length + ')');
  H.deepEq(TCM.punches(fx.facts, S.fold(fx.facts)), fx.punches, 'the same punches, field for field');
  /* the negative control: one saved fact taken out changes the answer (the comparison can fail) */
  const less = fx.facts.filter(function (e) { return e.type !== 'clock.edit'; });
  H.ok(JSON.stringify(TCM.punches(less, S.fold(less))) !== JSON.stringify(fx.punches), 'without the manager\'s correction the punches differ');
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
