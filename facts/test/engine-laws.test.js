'use strict';
/* ============================================================================
 * THE PROOFS — one per law. If any of these fails, the model is not what we say it is.
 *   always forward · a station holds its own facts · self-issued receipts · hash receipts
 *   punch it all in, in order · nothing dropped · every station watching itself · a hub watching all
 * ========================================================================== */
const H = require('./harness');
const registry = require('../core/registry');
const { openShiftId } = require('../aggregates/timeclock');
const { makeStation } = require('../core/station');
const { makeHub } = require('../hub/hub');
const sync = require('../sync/sync');
const hlc = require('../core/hlc');

/* a test-only aggregate with a side-effect, for the effects law */
registry.registerType('test.text', { aggregate: 'testagg', tier: 'immediate', effects: ['sms'], doc: 'test-only: an event that texts a customer at commit' });
registry.registerAggregate('testagg', { fold: function (evs) { return { n: evs.length }; }, doc: 'test-only' });

/* controllable time */
let T = 1789000000000;
const now = function () { return T; };
const HOUR = 3600000;

/* an in-memory persist that hands back COPIES, so a "restart" is a real reload */
function mem() {
  const st = { events: [], access: null };
  return {
    load: function () { return JSON.parse(JSON.stringify(st.events)); },
    save: function (evs) { st.events = JSON.parse(JSON.stringify(evs)); },
    loadAccess: function () { return st.access; },                              // the device's hub access lives WITH its log
    saveAccess: function (a) { st.access = a; },
    _st: st
  };
}
/* @proof — a fact as HISTORY holds it, from before a rule for NEW facts (10/7: the customer v1 handed over with no store): the type's admit is set aside for this one record only */
function beforeRule(type, fn) { const def = registry.typeDef(type), ad = def.admit; def.admit = null; try { return fn(); } finally { def.admit = ad; } }
function att(id, hub, nowFn) { const s = makeStation({ id: id, now: nowFn || now }); if (hub) sync.attach(s, hub); return s; }
function homeAll(hub, list, rounds) { for (let r = 0; r < (rounds || 2); r++) list.forEach(function (s) { sync.home(s, hub); }); }

/* ---------------------------------------------------------------- */
H.section('1 · a station is sovereign: it records offline and issues its own receipt');
H.test('append is idempotent: the same event twice is one event', function () {
  const A = makeStation({ id: 'i', now: now });
  const e = A.record('clock.in', 'p', { empId: 'p', at: T });
  A.log.append(e); A.log.append(JSON.parse(JSON.stringify(e)));
  H.eq(A.log.size(), 1);
});

/* ---------------------------------------------------------------- */
H.section('2 · hash receipts: the hub must echo EXACTLY what I wrote, or I keep sending');
H.test('a witnessed event gets its echo; a re-commit owes nothing; the hub holds no duplicates', function () {
  const hub = makeHub(); const S = att('s', hub);
  const e = S.record('clock.in', 'p', { empId: 'p', at: T });
  H.ok(S.lastCommit.ok); H.eq(S.lastCommit.acked, 1); H.eq(e.pos, 1, 'delivery position set only after the matching echo');
  H.ok(S.commit('again').nothingOwed); H.eq(hub.master.length, 1);
});
H.test('a lying witness (wrong hash echoed) is refused; an honest one then lands it, counted as backlog', function () {
  const hub = makeHub(); const S = att('s', hub); sync.detach(S);
  const e = S.record('clock.in', 'p', { empId: 'p', at: T });
  S.setTransport(function () { return { epoch: hub.epoch, eventAcks: [{ id: e.id, ok: true, hash: 'deadbeef', pos: 99 }], receiptAcks: [] }; });   // a liar wearing the real hub's epoch
  const c = S.commit('liar'); H.eq(c.refused, 1); H.eq(c.acked, 0); H.eq(e.pos, null, 'not accepted');
  sync.attach(S, hub);
  const c2 = S.commit('honest'); H.eq(c2.acked, 1); H.eq(c2.backlog, 1, 'the receipt check re-sent it'); H.eq(e.pos, 1);
});

/* ---------------------------------------------------------------- */

/* ---------------------------------------------------------------- */

/* ---------------------------------------------------------------- */
H.section('5 · punch it all in, in order: the owner\'s night (the bug that started this)');
H.test('phone with a SLOW clock punches out 10:36pm; counter autocloses next morning → the punch is the end, both on record, no dispute', function () {
  const alerts = []; const hub = makeHub({ notify: function (a) { alerts.push(a); } });
  const asm = att('assembly', hub), phone = att('phone', hub, function () { return T - HOUR; }), counter = att('counter', hub);
  const T0 = T;
  asm.record('clock.in', 'emp1', { empId: 'emp1', at: T0 });
  sync.home(counter, hub);                                                          // the counter knows he is IN — and will not hear from the phone tonight
  T = T0 + 13.7 * HOUR; sync.home(phone, hub);
  const out = phone.record('clock.out', 'emp1', { empId: 'emp1', at: T, shiftId: openShiftId(phone.project('timeclock'), 'emp1') });
  T = T0 + 23.3 * HOUR;                                                              // next morning the counter still shows him open, and the system gives up
  counter.record('clock.autoclose', 'emp1', { empId: 'emp1', at: T, reason: '23h shift — likely forgotten', shiftId: openShiftId(counter.project('timeclock'), 'emp1') });
  homeAll(hub, [asm, phone, counter]);
  [asm, phone, counter].forEach(function (s) {
    const P = s.project('timeclock');
    H.eq(P.shifts.length, 1, s.id + ' one shift'); H.eq(P.shifts[0].closedBy, 'punch', s.id + ' closed by the real punch');
    H.eq(P.shifts[0].out, out.payload.at, s.id + ' out = 10:36pm'); H.eq(P.shifts[0].closes.length, 2, s.id + ' BOTH closes on record');
    H.eq(P.shifts[0].disputed, false, s.id + ' a system guess is not a dispute');
  });
  H.eq(alerts.length, 0);
});
H.test('same story, but the punch lands AFTER the autoclose in the order → the punch still wins (kind, not order)', function () {
  const hub = makeHub(); const asm = att('assembly', hub), counter = att('counter', hub), phone = att('phone', hub);
  asm.record('clock.in', 'b2', { empId: 'b2', at: T });
  T += 10 * HOUR; sync.home(counter, hub); counter.record('clock.autoclose', 'b2', { empId: 'b2', at: T, reason: 'guess', shiftId: openShiftId(counter.project('timeclock'), 'b2') });
  T += 1 * HOUR; sync.home(phone, hub); const out = phone.record('clock.out', 'b2', { empId: 'b2', at: T - 2 * HOUR });   // the phone shows him autoclosed and names nothing; a human punch made BEFORE the system gave up still supersedes it (the guarded fallback)
  homeAll(hub, [asm, counter, phone]);
  [asm, counter, phone].forEach(function (s) {
    const sh = s.project('timeclock').shifts[0];
    H.eq(sh.closedBy, 'punch'); H.eq(sh.out, out.payload.at); H.eq(sh.closes.length, 2); H.eq(sh.disputed, false);
  });
});

/* ---------------------------------------------------------------- */
H.section('6 · a genuine dispute: two HUMAN facts disagree → both kept, both applied, flagged, emailed once');
H.test('two stations punch the same shift out at different times while apart', function () {
  const alerts = []; const hub = makeHub({ notify: function (a) { alerts.push(a); } });
  const asm = att('assembly', hub), B = att('counterB', hub), C = att('counterC', hub);
  asm.record('clock.in', 'd', { empId: 'd', at: T });
  sync.home(B, hub); sync.home(C, hub);
  sync.detach(B); sync.detach(C);                                            // both offline
  T += 8 * HOUR;
  const ob = B.record('clock.out', 'd', { empId: 'd', at: T, shiftId: openShiftId(B.project('timeclock'), 'd') });                 // both saw the open shift and name it
  const oc = C.record('clock.out', 'd', { empId: 'd', at: T + 30 * 60000, shiftId: openShiftId(C.project('timeclock'), 'd') });
  sync.attach(B, hub); sync.attach(C, hub);
  homeAll(hub, [B, C, asm]);
  const later = hlc.compare(ob.hlc, oc.hlc) > 0 ? ob : oc;
  [asm, B, C].forEach(function (s) {
    const sh = s.project('timeclock').shifts[0];
    H.eq(sh.disputed, true, s.id + ' flagged'); H.eq(sh.closes.length, 2, s.id + ' both facts kept');
    H.eq(sh.out, later.payload.at, s.id + ' the later-applied is current');
    H.ok(s.log.has(ob.id) && s.log.has(oc.id), s.id + ' holds both events');
  });
  H.eq(alerts.length, 1, 'exactly one alert'); H.eq(alerts[0].detail.closes.length, 2, 'the alert carries BOTH facts'); H.ok(/BOTH are retained/.test(alerts[0].note));
});

/* ---------------------------------------------------------------- */
H.section('7 · convergence and nothing dropped');
H.test('the same facts arriving in opposite orders produce the identical present and the identical log', function () {
  const hub = makeHub(); const a = att('a', hub), b = att('b', hub), c = att('c', hub);
  a.record('clock.in', 'e1', { empId: 'e1', at: T }); T += 1; b.record('clock.in', 'e2', { empId: 'e2', at: T }); T += 1;
  c.record('clock.out', 'e1', { empId: 'e1', at: T }); T += 1; a.record('clock.out', 'e2', { empId: 'e2', at: T }); T += 1; b.record('clock.autoclose', 'e1', { empId: 'e1', at: T });
  homeAll(hub, [a, b, c]);
  const all = hub.master.map(function (e) { return JSON.parse(JSON.stringify(e)); });
  const X = makeStation({ id: 'x', now: now }), Y = makeStation({ id: 'y', now: now });
  X.ingest(all); Y.ingest(all.slice().reverse());
  H.deepEq(X.project('timeclock'), Y.project('timeclock'), 'same present');
  H.deepEq(X.log.sorted().map(function (e) { return e.id; }), Y.log.sorted().map(function (e) { return e.id; }), 'same order');
  H.deepEq(a.project('timeclock'), X.project('timeclock'), 'and the live stations agree with them');
});

/* ---------------------------------------------------------------- */
/* round 3: a gap is REFUSED BY NUMBER instead of recorded — the hub never holds a hole it did not make itself, a first
   receipt of #20,000,000 cannot make the ledger unusable, and the station is told exactly which receipt to send first */

/* ---------------------------------------------------------------- */
H.section('9 · the fold applies everything: duplicates and orphans are visible, never lost');
H.test('a second clock-in while open is recorded on the shift, and no phantom second shift appears', function () {
  const A = makeStation({ id: 'a', now: now });
  A.record('clock.in', 'p', { empId: 'p', at: T }); T += 1; A.record('clock.in', 'p', { empId: 'p', at: T });
  const P = A.project('timeclock'); H.eq(P.shifts.length, 1); H.eq(P.shifts[0].extraIns.length, 1);
});
H.test('a clock-out that arrives before its clock-in is visible as an orphan, then attaches when the in arrives', function () {
  const hub = makeHub(); const A = att('a', hub);
  const inn = A.record('clock.in', 'p', { empId: 'p', at: T }); T += 1; const out = A.record('clock.out', 'p', { empId: 'p', at: T });
  const D = makeStation({ id: 'd', now: now });
  D.ingest([JSON.parse(JSON.stringify(hub.master[1]))]);                    // only the out
  let P = D.project('timeclock'); H.eq(P.orphans.length, 1); H.eq(P.shifts.length, 0);
  D.ingest([JSON.parse(JSON.stringify(hub.master[0]))]);                    // now the in
  P = D.project('timeclock'); H.eq(P.orphans.length, 0); H.eq(P.shifts.length, 1); H.eq(P.shifts[0].out, out.payload.at);
  void inn;
});

/* ---------------------------------------------------------------- */

/* ---------------------------------------------------------------- */
H.section('11 · tiles: work is deferred to Home; the idle timer fires ONLY IF INACTIVE');
H.test('events inside an open tile wait for Home; Home sends them all at once', function () {
  const hub = makeHub(); const R = att('rack', hub);
  R.openTile('rack');
  R.record('clock.in', 'p', { empId: 'p', at: T }); T += 1; R.record('clock.out', 'p', { empId: 'p', at: T });
  H.eq(hub.master.length, 0, 'nothing sent mid-tile'); H.eq(R.outbox().events.length, 2);
  const c = R.closeTile('home'); H.eq(c.tile, 'rack'); H.eq(c.acked, 2); H.eq(hub.master.length, 2); H.eq(R.tile, null);
});
H.test('Rack/Assembly: the 15-MINUTE inactivity timer returns to Home and commits — and every touch resets it', function () {
  const hub = makeHub(); const R = att('assembly', hub); const MIN = 60000;
  R.openTile('assembly'); R.record('clock.in', 'p', { empId: 'p', at: T });
  H.eq(R.tick(), null, 'not idle yet');
  T += 10 * MIN; R.touch();                                                 // walked off, came back, scanned again
  T += 10 * MIN; H.eq(R.tick(), null, '20 min since open but only 10 since the last touch: still active');
  T += 6 * MIN;  const t = R.tick(); H.ok(t && t.timedOut, 'idle past 15 min → Home'); H.eq(t.acked, 1); H.eq(hub.master.length, 1); H.eq(R.tile, null);
});
H.test('Detail/Quick are NEVER kicked — they send only when finished or backed out of; a punch outside a tile sends at once; an explicit per-tile override is honoured', function () {
  const hub = makeHub(); const S = makeStation({ id: 's', now: now, tileTimeouts: { pickup: 60000 } }); sync.attach(S, hub);
  S.record('clock.in', 'p', { empId: 'p', at: T }); H.eq(hub.master.length, 1, 'a punch outside any tile is sent immediately');
  S.openTile('detail'); S.record('clock.in', 'q', { empId: 'q', at: T }); T += 3 * HOUR; H.eq(S.tick(), null, 'three idle hours on Detail: still there');
  H.eq(hub.master.length, 1, 'nothing sent mid-ticket'); const c = S.closeTile('finished'); H.eq(c.acked, 1, 'finished → sent');
  S.openTile('quick'); T += 3 * HOUR; H.eq(S.tick(), null, 'Quick never kicks either'); S.closeTile('backed-out');
  S.openTile('pickup'); T += 61000; const t = S.tick(); H.ok(t && t.timedOut, 'an explicit 60s override on Pickup is honoured');
});

/* ---------------------------------------------------------------- */
H.section('12 · side-effects fire once, at commit, only after the hub has witnessed the event');
H.test('a text is not sent while offline, is sent exactly once when witnessed, and never again', function () {
  const hub = makeHub(); const fired = [];
  const F = makeStation({ id: 'f', now: now, onEffect: function (fx, e) { fired.push(fx + ':' + e.id); } });
  F.record('test.text', 'cust1', { msg: 'your order is ready' });
  H.eq(fired.length, 0, 'not witnessed → no text');
  sync.attach(F, hub); const c = F.commit('home'); H.eq(c.acked, 1); H.eq(c.effects, 1); H.eq(fired.length, 1);
  F.commit('again'); F.commit('and again'); H.eq(fired.length, 1, 'once');
});

/* ---------------------------------------------------------------- */
H.section('13 · the catalog is generated from the code');
H.test('every registered clock event appears with its tier', function () {
  const md = registry.catalogMarkdown();
  ['clock.in', 'clock.out', 'clock.autoclose', 'clock.edit'].forEach(function (t) { H.ok(md.indexOf('`' + t + '`') >= 0, t); });
  H.ok(md.indexOf('| immediate |') >= 0);
});

/* ================================================================================================
 * 14 · THE ADVERSARIES' FINDINGS (2026-09-16) — one proof per break, so none can come back
 * ================================================================================================ */
const evmod = require('../core/event');
H.section('14a · hashes are over the WIRE form: an undefined field, a Date, a NaN survive the hop');
H.test('hashOf(e) === hashOf(JSON.parse(JSON.stringify(e))) for awkward payloads', function () {
  const S = makeStation({ id: 's', now: now });
  const e1 = S.record('clock.autoclose', 'p', { empId: 'p', at: T, reason: undefined });
  const e2 = S.record('clock.edit', 'p', { empId: 'p', shiftId: e1.id, in: undefined, out: T + 5, when: new Date(T), ratio: NaN, nested: { a: undefined, b: [1, undefined, 3] } });
  [e1, e2].forEach(function (e) { H.eq(evmod.hashOf(e), evmod.hashOf(JSON.parse(JSON.stringify(e))), 'wire-stable'); H.ok(evmod.verify(JSON.parse(JSON.stringify(e))), 'verifies after a JSON hop'); });
  H.ok(!('reason' in e1.payload), 'the undefined member is gone from the fact itself');
});
H.test('the adversary\'s exact case: an autoclose with reason:undefined reaches every station and the hub verifies its own copy', function () {
  const hub = makeHub(); const a = att('a', hub), b = att('b', hub), c = att('c', hub);
  a.record('clock.in', 'p', { empId: 'p', at: T }); sync.home(b, hub); sync.home(c, hub);
  T += HOUR; b.record('clock.autoclose', 'p', { empId: 'p', at: T, reason: undefined });
  homeAll(hub, [a, b, c]);
  H.ok(hub.master.every(function (e) { return evmod.verify(e); }), 'hub copies verify');
  [a, b, c].forEach(function (s) { H.eq(s.log.size(), 2, s.id + ' holds both'); H.eq(s.project('timeclock').shifts[0].status, 'closed', s.id); H.eq(s.failures.filter(function (f) { return f.kind === 'ingest-refused'; }).length, 0, s.id + ' refused nothing'); });
});

H.section('14b · one total order: distinct events never tie; malformed clocks never enter a stamp');
H.test('a clock whose wall returns Infinity/NaN still issues finite, increasing stamps', function () {
  let w = Infinity; const C = hlc.makeClock('z', { now: function () { return w; } });
  const s1 = C.now(); H.ok(Number.isFinite(s1.t)); w = NaN; const s2 = C.now(); H.ok(Number.isFinite(s2.t)); H.ok(hlc.compare(s2, s1) > 0);
});


H.section('14d · a new hub is a new witness: everything is re-offered, nothing is lost');
H.test('a persisted hub is the SAME witness after a restart (no re-offer needed)', function () {
  const store = { st: null }; const P = { load: function () { return store.st; }, save: function (s) { store.st = JSON.parse(JSON.stringify(s)); } };
  const hub1 = makeHub({ persist: P }); const a = att('a', hub1); a.record('clock.in', 'p', { empId: 'p', at: T });
  const hub2 = makeHub({ persist: P }); H.eq(hub2.epoch, hub1.epoch); H.eq(hub2.master.length, 1); H.eq(hub2.head, 1);
  sync.attach(a, hub2); const c = a.commit('again'); H.ok(c.nothingOwed, 'nothing owed to the same witness');
});

H.section('14e · a close names its shift: never attached to yesterday');
H.test('day-2 clock-in offline on the phone; clock-out online at the counter → orphan, NOT yesterday\'s shift; attaches when the in arrives', function () {
  const alerts = []; const hub = makeHub({ notify: function (x) { alerts.push(x); } });
  const phone = att('phone', hub), counter = att('counter', hub);
  phone.record('clock.in', 'p', { empId: 'p', at: T }); T += 8 * HOUR; phone.record('clock.out', 'p', { empId: 'p', at: T, shiftId: openShiftId(phone.project('timeclock'), 'p') });
  homeAll(hub, [phone, counter]);
  T += 16 * HOUR; sync.detach(phone); phone.record('clock.in', 'p', { empId: 'p', at: T });          // wifi down: held on the phone
  T += 9 * HOUR; counter.record('clock.out', 'p', { empId: 'p', at: T });                              // counter has no open shift for p
  homeAll(hub, [counter]);
  let P = counter.project('timeclock');
  H.eq(P.shifts.length, 1); H.eq(P.shifts[0].closes.length, 1, 'day-1 shift untouched'); H.eq(P.shifts[0].disputed, false); H.eq(P.orphans.length, 1, 'the out is visibly waiting');
  H.eq(alerts.length, 0, 'no false dispute');
  sync.attach(phone, hub); homeAll(hub, [phone, counter]);
  [phone, counter].forEach(function (s) { P = s.project('timeclock'); H.eq(P.shifts.length, 2, s.id); H.eq(P.orphans.length, 0, s.id); H.eq(P.shifts[1].status, 'closed', s.id); H.eq(P.shifts[1].closes.length, 1, s.id); });
});
H.test('same, but the phone\'s clock is FAST so the out sorts before the in: the second pass attaches it', function () {
  const hub = makeHub(); const fast = att('fast', hub, function () { return T + 3 * HOUR; }), counter = att('counter', hub);
  fast.record('clock.in', 'p', { empId: 'p', at: T });                                                   // stamped 3h ahead
  T += 1; counter.record('clock.out', 'p', { empId: 'p', at: T + 8 * HOUR });                            // stamped now → sorts BEFORE the in
  homeAll(hub, [fast, counter]);
  [fast, counter].forEach(function (s) { const P = s.project('timeclock'); H.eq(P.orphans.length, 0, s.id); H.eq(P.shifts[0].status, 'closed', s.id); });
});

H.section('14f · effects are owed by the log: witnessed via a pull still fires once; a full disk never loses one');
H.test('effectsDone survives a reboot: a restored device does not re-text', function () {
  const store = mem(); let effects = []; const P = Object.assign(store, { loadEffects: function () { return effects.slice(); }, saveEffects: function (l) { effects = l.slice(); } });
  const hub = makeHub(); const fired = [];
  const F1 = makeStation({ id: 'f', now: now, persist: P, onEffect: function (fx, e) { fired.push(e.id); } }); sync.attach(F1, hub);
  F1.record('test.text', 'k', { msg: 'x' }); H.eq(fired.length, 1);
  const F2 = makeStation({ id: 'f', now: now, persist: P, onEffect: function (fx, e) { fired.push(e.id); } }); sync.attach(F2, hub);
  F2.commit('boot'); sync.pull(F2, hub); H.eq(fired.length, 1, 'no second text after the reboot');
});
H.test('storage full: record() does not throw, the failure is logged, the hub still witnesses it and the text fires', function () {
  const hub = makeHub(); const fired = []; let full = true;
  let kp = null; const P = { load: function () { return []; }, save: function () { if (full) throw new Error('QuotaExceededError: storage full'); }, loadKeys: function () { return kp; }, saveKeys: function (k) { kp = k; } };
  const S = makeStation({ id: 's', now: now, persist: P, onEffect: function (fx, e) { fired.push(e.id); } }); sync.attach(S, hub);
  let threw = false; try { S.record('test.text', 'k', { msg: 'x' }); } catch (e) { threw = true; }
  H.eq(threw, false, 'the UI never sees a storage error'); H.ok(S.failures.some(function (f) { return f.kind === 'persist'; }), 'logged');
  H.eq(hub.master.length, 1); H.eq(fired.length, 1, 'effect fired'); H.eq(S.selfCheck().persistDirty, true);
  full = false; H.ok(S.log.flush()); H.eq(S.selfCheck().persistDirty, false);
});

/* ================================================================================================ */
/* §15 — ROUND 2 OF THE ADVERSARIES (2026-09-16): signed receipts, identity, durability, bounds     */
/* ================================================================================================ */
/* round 3 replaced the carrier QUORUM (two names from one process defeated it) with HOLD-AND-ASK: a carried event for an
   issuer this hub has never met stays visible and pending until the issuer itself appears with that key, or an operator
   accepts it. A dead phone's facts still rebuild a dead hub — by a human's decision, never by counting names. */

H.section('15b · durability before witness: the hub never says "I hold it" until its store does');
H.test('the hub hands out COPIES: mutating what it returns changes nothing it serves', function () {
  const hub = makeHub(); const S = att('m', hub); S.record('clock.in', 'p', { empId: 'p', at: T });
  hub.master[0].payload.at = 1; H.eq(hub.changesSince(0)[0].payload.at, T); H.ok(hub.master.every(function (e) { return evmod.verify(e); }));
});


H.section('15d · a close cannot precede the in it closes; a shift belongs to one person');
H.test('yesterday\'s stray unnamed punch-out never lands on today\'s open shift; a close naming another person\'s shift is an orphan', function () {
  const hub = makeHub(); const a = att('a', hub);
  a.record('clock.in', 'p', { empId: 'p', at: T }); T += 8 * HOUR; a.record('clock.out', 'p', { empId: 'p', at: T, shiftId: openShiftId(a.project('timeclock'), 'p') });
  T += 16 * HOUR; const dayTwoIn = T; a.record('clock.in', 'p', { empId: 'p', at: T });
  a.record('clock.out', 'p', { empId: 'p', at: dayTwoIn - 2 * HOUR });         // stamped before today's in
  let P = a.project('timeclock'); H.eq(P.shifts.length, 2); H.eq(P.shifts[1].status, 'open', 'today is still open'); H.eq(P.orphans.length, 1);
  a.record('clock.out', 'q', { empId: 'q', at: T + HOUR, shiftId: P.shifts[1].id });
  P = a.project('timeclock'); H.eq(P.shifts[1].status, 'open'); H.eq(P.orphans.length, 2, 'q cannot close p\'s shift');
});

H.section('15e · effects: the done-mark is made durable BEFORE the text goes; a disk that refuses HOLDS the text, never doubles it');
H.test('saveEffects refuses → the text is held (not fired, not lost); the disk returns → it fires exactly once', function () {
  let refuse = true, saved = []; const P = Object.assign(mem(), { loadEffects: function () { return saved.slice(); }, saveEffects: function (l) { if (refuse) throw new Error('disk'); saved = l.slice(); } });
  const hub = makeHub(); const fired = []; const F = makeStation({ id: 'f', now: now, persist: P, onEffect: function (fx, e) { fired.push(e.id); } }); sync.attach(F, hub);
  F.record('test.text', 'k', { msg: 'x' }); H.eq(hub.master.length, 1, 'witnessed'); H.eq(fired.length, 0, 'held'); H.eq(F.selfCheck().effectsDirty, true);
  refuse = false; F.commit('again'); H.eq(fired.length, 1, 'fired once the mark was durable'); H.eq(saved.filter(function (r) { return typeof r === 'string'; }).length, 1);
  F.commit('x'); sync.pull(F, hub); H.eq(fired.length, 1, 'once');
});
H.test('an unreadable effects store at boot holds EVERY effect until an operator resolves it; after resolution new work texts normally', function () {
  let saved2 = null; const P = Object.assign(mem(), { loadEffects: function () { throw new Error('corrupt'); }, saveEffects: function (l) { saved2 = l.slice(); } });
  const hub = makeHub(); const fired = []; const G = makeStation({ id: 'g', now: now, persist: P, onEffect: function (fx, e) { fired.push(e.id); } }); sync.attach(G, hub);
  G.record('test.text', 'k', { msg: 'a' }); H.eq(hub.master.length, 1); H.eq(fired.length, 0, 'nothing fires blind'); H.eq(G.effectsUnknown, true);
  H.ok(G.resolveEffects('seed')); H.eq(G.effectsUnknown, false); G.commit('after'); H.eq(fired.length, 0, 'the already-witnessed text is treated as sent');
  const e2 = G.record('test.text', 'k', { msg: 'b' }); H.eq(fired.length, 1); H.eq(fired[0], e2.id); H.ok(saved2 && saved2.filter(function (r) { return typeof r === 'string'; }).length === 2);
});

H.section('15f · scale and windows: a journal writes one line per fact; one window per station');
H.test('a second window on the same station opens READ-ONLY and says so, instead of two tabs erasing each other\'s receipts', function () {
  const store = Object.assign(mem(), { lease: function () { return { ok: false, holder: 'the other tab' }; } });
  const S = makeStation({ id: 'w', now: now, persist: store }); H.eq(S.readOnly, true);
  let msg = ''; try { S.record('clock.in', 'p', { empId: 'p', at: T }); } catch (e) { msg = e.message; } H.ok(/read-only/.test(msg), msg);
  H.ok(S.failures.some(function (f) { return f.kind === 'lease'; }));
});
H.section('15g · the reviewer\'s three: a re-offer survives a reboot; a malformed hub answer never throws out of record(); a persisted station must keep its key');
H.test('a malformed hub answer (a string, a bad epoch, junk acks) never throws out of record(); the fact is recorded, owed, and lands on the next honest commit', function () {
  const hub = makeHub(); const S = makeStation({ id: 'm', now: now });
  const answers = ['nope', { epoch: 42 }, { eventAcks: 'x' }, { eventAcks: [null, 7, { ok: true }] }, { eventAcks: [{ id: 'zz', ok: true, hash: 'h', pos: 1 }] }];
  answers.forEach(function (a, i) {
    S.setTransport(function () { return a; });
    let threw = false, e; try { T += 1; e = S.record('clock.in', 'p' + i, { empId: 'p' + i, at: T }); } catch (err) { threw = true; }
    H.eq(threw, false, 'answer #' + i + ' did not throw'); H.eq(e.pos, null, 'answer #' + i + ' witnessed nothing'); H.eq(S.lastCommit.ok, S.lastCommit.ok && S.lastCommit.acked === 0, 'nothing acked');
  });
  sync.attach(S, hub); const c = S.commit('honest'); H.eq(c.acked, 5); H.eq(c.backlog, 5); H.ok(S.selfCheck().ok);
});
/* ================================================================================================ */
/* §16 — ROUND 3 OF THE ADVERSARIES (2026-09-16 night): boot trusts nothing; a read-only window is inert;  */
/*       carriers are authenticated; the hub undoes, never deletes; the fold keeps a human's punch          */
/* ================================================================================================ */
function leaseStore(extra) {                                     // a persist with a TTL lease, like a real adapter
  const st = mem(); let holder = null, until = 0;
  return Object.assign(st, { lease: function (nonce, ms) { const t = now(); if (!holder || holder === nonce || t >= until) { holder = nonce; until = t + ms; return { ok: true }; } return { ok: false, holder: holder }; }, release: function (nonce) { if (holder === nonce) { holder = null; until = 0; } }, _lease: function () { return { holder: holder, until: until }; } }, extra || {});
}
H.section('16a · a read-only window is INERT: it records nothing, sends nothing, acks nothing, writes no store, texts nobody');
H.test('the lease is RENEWED while the writer works: a second window after the TTL is still refused; a writer that went silent past the TTL loses it and halts instead of forking', function () {
  const store = leaseStore(); const hub = makeHub();
  const W = makeStation({ id: 'n', now: now, persist: store, leaseMs: 1000 }); sync.attach(W, hub);
  for (let i = 0; i < 5; i++) { T += 400; W.record('clock.in', 'p' + i, { empId: 'p' + i, at: T }); }   // busy: renews on every record
  H.eq(makeStation({ id: 'n', now: now, persist: store, leaseMs: 1000 }).readOnly, true, 'a second window after 2 s of a busy writer is refused');
  T += 5000;                                                                       // the writer went silent past the TTL
  const R = makeStation({ id: 'n', now: now, persist: store, leaseMs: 1000 }); H.eq(R.readOnly, false, 'the lease was free');
  let msg = ''; try { W.record('clock.in', 'z', { empId: 'z', at: T }); } catch (e) { msg = e.message; } H.ok(/lease lost/.test(msg), 'the old writer halts rather than fork: ' + msg); H.eq(W.readOnly, true);
});




H.section('16d · effects: the operator seam cannot be mistyped, and "seed" means everything ever witnessed');
H.test('resolveEffects refuses anything but seed|clear; seed after a hub change treats every once-witnessed text as sent', function () {
  const store = Object.assign(mem(), { loadEffects: function () { return store._fx; }, saveEffects: function (l) { store._fx = l.slice(); } }); store._fx = [];
  const hub1 = makeHub(); const fired = []; const F = makeStation({ id: 'fx2', now: now, persist: store, onEffect: function (fx, e) { fired.push(e.id); } }); sync.attach(F, hub1);
  F.record('test.text', 'k', { msg: 'one' }); T += 1; F.record('test.text', 'k', { msg: 'two' }); H.eq(fired.length, 2);
  store._fx = { corrupt: true };                                                   // the effects store is damaged; the hub died too
  const hub2 = makeHub(); const G = makeStation({ id: 'fx2', now: now, persist: store, onEffect: function (fx, e) { fired.push(e.id); } }); sync.attach(G, hub2);
  H.eq(G.effectsUnknown, true); H.eq(G.resolveEffects('Seed'), false); H.eq(G.resolveEffects(undefined), false); H.eq(G.resolveEffects('keep'), false); H.eq(G.effectsUnknown, true, 'still held');
  H.eq(G.resolveEffects('seed'), true); sync.home(G, hub2); H.eq(fired.length, 2, 'nothing re-texted: both were witnessed once, under the old hub');
  T += 1; G.record('test.text', 'k', { msg: 'three' }); H.eq(fired.length, 3, 'new work texts once');
});



H.section('16g · the fold keeps a human\'s punch; the clock cannot be poisoned from inside its own range');
H.test('double clock-in across two devices (the critic\'s Dana): after the offline phone syncs, the named punch-out still ends the day, nothing is orphaned, the sweep has nothing to close — and a sweep that fires anyway loses to the punch', function () {
  const hub = makeHub(); const phone = att('phone', hub), counter = att('counter', hub); sync.detach(phone);
  const inPhone = phone.record('clock.in', 'dana', { empId: 'dana', at: T });                 // 07:39 on the offline phone
  T += 2 * 60000; counter.record('clock.in', 'dana', { empId: 'dana', at: T });               // 07:41 at the counter (it shows Dana out)
  T += 8 * HOUR; const sid = openShiftId(counter.project('timeclock'), 'dana'); const out = counter.record('clock.out', 'dana', { empId: 'dana', at: T, shiftId: sid });
  H.eq(counter.project('timeclock').shifts[0].status, 'closed', '16:02 the counter shows the day closed');
  sync.attach(phone, hub); homeAll(hub, [phone, counter], 3);                                 // 17:35 the phone syncs: its in sorts FIRST and opens the shift
  [phone, counter].forEach(function (s) {
    const P = s.project('timeclock'); H.eq(P.shifts.length, 1, s.id + ' one shift'); H.eq(P.orphans.length, 0, s.id + ' no orphan'); H.eq(P.shifts[0].status, 'closed', s.id + ' still closed');
    H.eq(P.shifts[0].closedBy, 'punch', s.id + ' the human punch is the end'); H.eq(P.shifts[0].out, out.payload.at); H.eq(P.shifts[0].in, inPhone.payload.at, s.id + ' the earlier in opens it'); H.eq(P.shifts[0].extraIns.length, 1, s.id + ' the counter\'s in became an extra tap');
  });
  H.eq(openShiftId(counter.project('timeclock'), 'dana'), null, 'the 04:00 sweep finds nothing open');
  T += 11 * HOUR; counter.record('clock.autoclose', 'dana', { empId: 'dana', at: T, reason: 'forced', shiftId: sid });   // a sweep that named the counter's in anyway
  homeAll(hub, [phone, counter]);
  [phone, counter].forEach(function (s) { const P = s.project('timeclock'); H.eq(P.shifts[0].closedBy, 'punch', s.id + ' kind beats order'); H.eq(P.shifts[0].closes.length, 2); H.eq(P.orphans.length, 0); H.eq(P.shifts[0].out, out.payload.at); });
});
H.test('a skewed clock-out that sorts before its in: day 1 closes by its own punch, day 2 opens a new shift — no 32-hour shift, no orphaned real punch', function () {
  const hub = makeHub(); const fast = att('fast', hub, function () { return T + 10 * HOUR; }), counter = att('counter', hub); sync.detach(fast);
  fast.record('clock.in', 'lee', { empId: 'lee', at: T });                          // 09:00 day 1, stamped 10h ahead
  T += 8 * HOUR; counter.record('clock.out', 'lee', { empId: 'lee', at: T });      // 17:00 day 1, unnamed, sorts BEFORE the in
  T += 16 * HOUR; counter.record('clock.in', 'lee', { empId: 'lee', at: T });      // 09:00 day 2
  T += 8 * HOUR; counter.record('clock.out', 'lee', { empId: 'lee', at: T });      // 17:00 day 2
  sync.attach(fast, hub); homeAll(hub, [fast, counter], 3);
  [fast, counter].forEach(function (s) { const P = s.project('timeclock'); H.eq(P.shifts.length, 2, s.id); H.eq(P.orphans.length, 0, s.id); H.eq(P.shifts[0].status, 'closed'); H.eq(P.shifts[1].status, 'closed'); H.ok(P.shifts[0].out - P.shifts[0].in <= 8 * HOUR + 1, s.id + ' day 1 is one shift long'); });
});
H.test('a manager edit that leaves a shift ending before it began is flagged as invalid and the hub alerts', function () {
  const alerts = []; const hub = makeHub({ notify: function (a) { alerts.push(a); } }); const a = att('a', hub);
  a.record('clock.in', 'p', { empId: 'p', at: T }); T += 8 * HOUR; const sid = openShiftId(a.project('timeclock'), 'p'); a.record('clock.out', 'p', { empId: 'p', at: T, shiftId: sid });
  a.record('clock.edit', 'p', { empId: 'p', shiftId: sid, in: T + 2 * HOUR }, { actor: 'manager' });   // a typo: 18:00 for 08:00
  const P = a.project('timeclock'); H.eq(P.invalid.length, 1); H.eq(P.invalid[0].why, 'out before in'); H.ok(alerts.some(function (x) { return x.kind === 'invalid-shift'; }));
});
H.test('a stamp at the very top of the range cannot poison a peer (drift cap), and a wall clock broken from boot still records', function () {
  const C = hlc.makeClock('q', { now: now }); const s0 = C.now();
  C.observe({ t: hlc.MAX_T - 1, c: hlc.MAX_C, id: 'evil' }); const s1 = C.now(); H.ok(hlc.compare(s1, s0) > 0); H.ok(s1.t < T + 2 * 24 * HOUR, 'a stamp a lifetime ahead of my wall was ordered, not obeyed'); H.ok(hlc.sane(s1));
  C.observe({ t: T + 3600000, c: 0, id: 'peer' }); H.eq(C.peek().t, T + 3600000, 'an hour ahead is believed');
  [NaN, 0, -5, Infinity].forEach(function (w) { const S = makeStation({ id: 'bw' + String(w), now: function () { return w; } }); const e = S.record('clock.in', 'p', { empId: 'p', at: 1789000000000 }, { defer: true }); H.ok(hlc.sane(e.hlc), 'broken wall ' + w + ' still issues a valid stamp'); });
});
H.section('16h · the critics\' round: an id is minted in its issuer\'s namespace; a clone halts, never forks; a store has one owner; a failed text is remembered; a boxed tablet is retired');
H.test('a text whose gateway call THROWS is remembered on disk: a reboot still lists it as failed (never silently clean) and does not re-fire it; an operator\'s retry fires it exactly once', function () {
  let fx = []; const store = Object.assign(mem(), { loadEffects: function () { return JSON.parse(JSON.stringify(fx)); }, saveEffects: function (l) { fx = JSON.parse(JSON.stringify(l)); } });
  const hub = makeHub(); let fail = true; const fired = []; const hook = function (f, e) { if (fail) throw new Error('text provider 503'); fired.push(e.id); };
  const S = makeStation({ id: 'tw', now: now, persist: store, onEffect: hook }); sync.attach(S, hub);
  const e = S.record('test.text', 'k', { msg: 'ready' }); H.eq(e.pos, 1); H.eq(S.effectsFailed.length, 1); H.eq(fired.length, 0); H.ok(fx.some(function (r) { return r && typeof r === 'object' && r.failed; }), 'the failure is on disk');
  const R = makeStation({ id: 'tw', now: now, persist: store, onEffect: hook }); sync.attach(R, hub); sync.home(R, hub);
  H.eq(R.effectsFailed.length, 1, 'a reboot still lists it'); H.eq(R.selfCheck().effectsFailed, 1); H.eq(fired.length, 0, 'and did not re-fire on its own: the done-mark was durable');
  fail = false; H.eq(R.retryEffects(), 1); H.eq(fired.length, 1); H.eq(R.effectsFailed.length, 0); sync.home(R, hub); H.eq(fired.length, 1, 'once');
  const R2 = makeStation({ id: 'tw', now: now, persist: store, onEffect: function () { fired.push('again'); } }); sync.attach(R2, hub); sync.home(R2, hub); H.eq(R2.effectsFailed.length, 0); H.eq(fired.length, 1);
});
H.test('a wall clock corrected by NTP (+25 min) while the operator is scanning does not kick the Rack tile nor abandon a commit: timers run on the monotonic clock', function () {
  let M = 0; const hub = makeHub(); const R = makeStation({ id: 'ntp', now: now, mono: function () { return M; } }); sync.attach(R, hub);
  R.openTile('rack'); R.record('clock.in', 'p', { empId: 'p', at: T }); M += 1000; T += 25 * 60000;                     // one real second passed; the wall jumped
  H.eq(R.tick(), null, 'no kick'); H.ok(R.tile && R.tile.name === 'rack'); H.eq(hub.master.length, 0, 'still in the tile');
  M += 16 * 60000; const t = R.tick(); H.ok(t && t.timedOut, 'sixteen REAL minutes idle → Home'); H.eq(hub.master.length, 1);
});
/* ================================================================================================ */
/* §17 — ROUND 4 OF THE ADVERSARIES (2026-09-17, small hours): the lease on EVERY path that writes; a fork proven   */
/*       by evidence — including the second adoption in one session; adopted facts never text blind; attempts as    */
/*       durable as outcomes; the rotation chain and retired pins at the hub; honest epochs; the fold by evidence    */
/* ================================================================================================ */
function ownClockLease() {                                       // a lease service on ITS OWN clock (server-side): the station's wall may lie to it
  const st = mem(); let holder = null, until = 0; const S = { clock: 0 };
  return Object.assign(st, { _svc: S, lease: function (nonce, ms) { const t = S.clock; if (!holder || holder === nonce || t >= until) { holder = nonce; until = t + ms; return { ok: true }; } return { ok: false, holder: holder }; }, release: function (nonce) { if (holder === nonce) { holder = null; until = 0; } } });
}
function cloneStore(st) { const c = mem(); c._st.events = JSON.parse(JSON.stringify(st._st.events)); c._st.access = st._st.access; return c; }
function fxStore(base) { let fx = []; return Object.assign(base || mem(), { loadEffects: function () { return JSON.parse(JSON.stringify(fx)); }, saveEffects: function (l) { fx = JSON.parse(JSON.stringify(l)); }, _fx: function () { return fx; }, _setFx: function (v) { fx = v; } }); }

H.section('17a · the lease is checked on EVERY path that writes: a closed, lapsed or displaced window applies nothing; a live writer is never taken over');
H.test('renewal is judged on the MONOTONIC clock: a wall stepped back two minutes on every tap, while the lease service keeps its own time, still renews — the second window stays refused', function () {
  const store = ownClockLease(); const svc = store._svc; let wall = T, M = 0; const hub = makeHub();
  const W = makeStation({ id: 'ntpl', now: function () { return wall; }, mono: function () { return M; }, persist: store, leaseMs: 1000 }); sync.attach(W, hub);
  for (let i = 0; i < 6; i++) { M += 400; svc.clock += 400; wall -= 120000; W.record('clock.in', 'p' + i, { empId: 'p' + i, at: T }); }   // real time moves on; the wall runs BACKWARD
  const R = makeStation({ id: 'ntpl', now: function () { return wall; }, mono: function () { return M; }, persist: store, leaseMs: 1000 }); H.eq(R.readOnly, true, 'the writer kept renewing: the second window is refused');
  H.eq(W.mine().length, 6); H.ok(W.selfCheck().ok, W.selfCheck().problems.join('; '));
});
H.test('a lease service that throws ONCE mid-day does not halt a writer that still holds the lease by its own record (it retries next time); at boot the same failure fails CLOSED', function () {
  const store = leaseStore(); let boom = false; const realLease = store.lease; store.lease = function (n, ms) { if (boom) { boom = false; throw new Error('IndexedDB blocked'); } return realLease(n, ms); };
  const hub = makeHub(); const W = makeStation({ id: 'lt', now: now, persist: store, leaseMs: 1000 }); sync.attach(W, hub);
  W.record('clock.in', 'p', { empId: 'p', at: T }); T += 400; boom = true; const e = W.record('clock.in', 'q', { empId: 'q', at: T });
  H.eq(W.readOnly, false, 'still the writer'); H.eq(e.pos, 2); H.ok(W.failures.some(function (f) { return /will retry/.test(f.error || ''); }));
  T += 400; W.record('clock.in', 'r', { empId: 'r', at: T }); H.eq(W.mine().length, 3); H.ok(W.selfCheck().ok);
  const store2 = leaseStore(); let boom2 = true; const rl2 = store2.lease; store2.lease = function (n, ms) { if (boom2) { boom2 = false; throw new Error('blocked'); } return rl2(n, ms); };
  const C = makeStation({ id: 'lt3', now: now, persist: store2 }); H.eq(C.readOnly, true, 'at boot: fails CLOSED');
});
H.test('a second tab\'s auto-reclaim waits a full TTL of ITS OWN monotonic time after the last refusal: a +31 s wall jump cannot hand it the station in the same instant; whatever happens, exactly one writer and no lost fact', function () {
  const store = ownClockLease(); const svc = store._svc; let wall = T, M = 0; const hub = makeHub();
  const W = makeStation({ id: 'wj', now: function () { return wall; }, mono: function () { return M; }, persist: store, leaseMs: 1000 }); sync.attach(W, hub); W.openTile('detail');
  M += 100; svc.clock += 100; W.record('clock.in', 'p', { empId: 'p', at: T }, { actor: 'pat' });
  const R = makeStation({ id: 'wj', now: function () { return wall; }, mono: function () { return M; }, persist: store, leaseMs: 1000 }); sync.attach(R, hub); H.eq(R.readOnly, true);
  wall += 31000; svc.clock += 31000; M += 1;                                       // NTP steps the wall (and the service's clock); one real millisecond passed
  H.eq(R.tick(), null, 'the second tab has not waited a TTL of real time'); H.eq(R.readOnly, true);
  W.touch(); M += 1; W.record('clock.out', 'p', { empId: 'p', at: T + 1, shiftId: openShiftId(W.project('timeclock'), 'p') }, { actor: 'pat' }); H.eq(W.mine().length, 2); H.eq(store._st.events.length, 2);
  M += 1000; svc.clock += 1000; R.tick(); M += 1; let threw = false; try { W.touch(); W.record('clock.in', 'z', { empId: 'z', at: T + 2 }, { actor: 'pat' }); } catch (e) { threw = true; }
  H.eq((W.readOnly ? 0 : 1) + (R.readOnly ? 0 : 1), 1, 'exactly one writer'); void threw;
  const writer = W.readOnly ? R : W; H.ok(writer.mine().length >= 2, 'the facts survived the handover'); H.ok(writer.selfCheck().ok, writer.selfCheck().problems.join('; '));
});


H.section('17c · an attempt is as durable as its outcome: retries, quota edges, torn rows, junk rows, empty messages, and a red selfCheck');
H.test('retryEffects under a disk that refuses writes fires nothing (the retry mark must land first), so a reboot cannot double the text; when the disk returns the retry fires once', function () {
  let refuse = false; const store = fxStore(); const realSave = store.saveEffects; store.saveEffects = function (l) { if (refuse) throw new Error('quota'); return realSave(l); };
  const hub = makeHub(); let fail = true; const fired = []; const hook = function (f, e) { if (fail) throw new Error('text provider 503'); fired.push(e.id); };
  const S = makeStation({ id: 'rt', now: now, persist: store, onEffect: hook }); sync.attach(S, hub); S.record('test.text', 'k', { msg: 'x' }); H.eq(S.effectsFailed.length, 1);
  fail = false; refuse = true; H.eq(S.retryEffects(), 0, 'no mark, no fire'); H.eq(fired.length, 0); H.eq(S.effectsFailed.length, 1);
  const R = makeStation({ id: 'rt', now: now, persist: store, onEffect: hook }); sync.attach(R, hub); H.eq(R.effectsFailed.length, 1, 'the reboot still lists it');
  refuse = false; H.eq(R.retryEffects(), 1); H.eq(fired.length, 1); H.eq(R.effectsFailed.length, 0); H.eq(R.retryEffects(), 0); H.eq(fired.length, 1, 'once');
});
H.test('a gateway throw whose failed row the store refuses is still remembered: the pre-hook mark is already the object form, so the reboot lists it as "outcome unknown" instead of silently clean', function () {
  const store = fxStore(); let cap = Infinity; const realSave = store.saveEffects; store.saveEffects = function (l) { if (JSON.stringify(l).length > cap) throw new Error('quota'); return realSave(l); };
  const hub = makeHub(); const S = makeStation({ id: 'qe', now: now, persist: store, onEffect: function () { cap = JSON.stringify(store._fx()).length + 2; throw new Error('text provider 503'); } }); sync.attach(S, hub);
  S.record('test.text', 'k', { msg: 'x' }); H.eq(S.effectsFailed.length, 1); H.ok(store._fx().some(function (r) { return r && typeof r === 'object' && r.attempting; }), 'the attempt is on disk in object form');
  cap = Infinity; const R = makeStation({ id: 'qe', now: now, persist: store, onEffect: function () {} }); sync.attach(R, hub); H.eq(R.effectsFailed.length, 1); H.ok(/outcome unknown/.test(R.effectsFailed[0].error)); H.ok(!R.selfCheck().ok);
});
H.test('one torn row in the effects store HOLDS everything (as before) but the intact failed rows are carried through — and seed keeps them listed rather than erasing them', function () {
  const store = fxStore(); const hub = makeHub(); let fail = true; const fired = [];
  const S = makeStation({ id: 'tr', now: now, persist: store, onEffect: function (f, e) { if (fail) throw new Error('503'); fired.push(e.id); } }); sync.attach(S, hub);
  S.record('test.text', 'k', { msg: 'x' }); H.eq(S.effectsFailed.length, 1); store._fx().push(null);
  const R = makeStation({ id: 'tr', now: now, persist: store, onEffect: function (f, e) { if (fail) throw new Error('503'); fired.push(e.id); } }); sync.attach(R, hub);
  H.eq(R.effectsUnknown, true); H.eq(R.effectsFailed.length, 1, 'the intact failed row survived the torn one'); H.eq(R.resolveEffects('seed'), true); H.eq(R.effectsFailed.length, 1, 'seed did not erase it'); sync.home(R, hub); H.eq(fired.length, 0);
  fail = false; H.eq(R.retryEffects(), 1); H.eq(fired.length, 1);
});
H.test('a failed row that names another station\'s event, an effect its type does not have, or a duplicate key is quarantined — retryEffects fires nothing for those, and a duplicate fires once; an empty error message survives the reboot', function () {
  const hub = makeHub(); const B = att('bb', hub); const bev = B.record('test.text', 'k', { msg: 'b' });
  const st = fxStore(); const fired = []; const A = makeStation({ id: 'aa', now: now, persist: st, onEffect: function (f, e) { fired.push(f + ':' + e.id); } }); sync.attach(A, hub); sync.home(A, hub);
  const own = A.record('clock.in', 'p', { empId: 'p', at: T }); const txt = A.record('test.text', 'k', { msg: 'a' }); H.eq(fired.length, 1);
  st._setFx([{ k: bev.id + '|sms', id: bev.id, effect: 'sms', failed: 'x' }, { k: own.id + '|sms', id: own.id, effect: 'sms', failed: 'x' }, { k: txt.id + '|email', id: txt.id, effect: 'email', failed: 'x' }, { k: txt.id + '|sms', id: txt.id, effect: 'sms', failed: 'dup' }, { k: txt.id + '|sms', id: txt.id, effect: 'sms', failed: 'dup2' }]);
  const R = makeStation({ id: 'aa', now: now, persist: st, onEffect: function (f, e) { fired.push(f + ':' + e.id); } }); sync.attach(R, hub);
  H.eq(R.effectsFailed.length, 1, 'only the row that names my fact with its real effect is listed'); H.eq(R.retryEffects(), 1); H.deepEq(fired.slice(1), ['sms:' + txt.id]);
  const st2 = fxStore(); const S2 = makeStation({ id: 'em', now: now, persist: st2, onEffect: function () { throw ''; } }); sync.attach(S2, hub); S2.record('test.text', 'k', { msg: 'e' });
  H.eq(S2.effectsFailed.length, 1); const S3 = makeStation({ id: 'em', now: now, persist: st2, onEffect: function () {} }); H.eq(S3.effectsFailed.length, 1, 'an empty message is still a failure after the reboot'); H.eq(S3.effectsFailed[0].error, '(no message)');
});

H.section('17d · the commit point: a bound monotonic clock by default, a late answer from a dead witness ignored, a system fact is not a touch, a Promise outcome is handed back');
H.test('a system fact recorded inside an open Rack tile is not a touch: the 15-minute idle clock runs from the last HUMAN act; closeTile under a Promise transport hands back the pending answer', function () {
  let M = 0; const hub = makeHub(); const R = makeStation({ id: 'sysfact', now: now, mono: function () { return M; } }); sync.attach(R, hub);
  R.openTile('rack'); R.record('clock.in', 'p', { empId: 'p', at: T }, { actor: 'pat' }); M += 14 * 60000; R.record('clock.autoclose', 'q', { empId: 'q', at: T }); M += 2 * 60000;
  const t = R.tick(); H.ok(t && t.timedOut, 'kicked 16 minutes after the last human act, not 2 minutes after the sweep'); H.eq(hub.master.length, 2);
  const P = makeStation({ id: 'pt', now: now }); P.setAccess(hub.enroll('pt')); /* retargeted 9/22: the hub admits enrolled devices only */ P.setTransport(function (b) { return Promise.resolve(hub.receive(b, 'pt')); }); P.openTile('detail'); P.record('clock.in', 'p', { empId: 'p', at: T });
  const out = P.closeTile('finished'); H.eq(out.tile, 'detail'); H.ok(out.pending && typeof out.pending.then === 'function', 'the caller can await the send');
  return out.pending.then(function (r) { H.eq(r.acked, 1); });
});


H.section('17f · the fold decides by evidence: a close ahead in the order beats a demotion by position; ties break in the one order; overlaps, long shifts and stranded punches are told');
H.test('a tablet a day ahead (past the drift cap): every punch NAMED correctly still folds to two 8-hour shifts on every station — the named punch-out ahead in the order closes day 1 before day 2\'s in is demoted', function () {
  const hub = makeHub(); const fast = att('fast', hub, function () { return T + 30 * HOUR; }), counter = att('counter', hub); const notify = [];
  const d1in = fast.record('clock.in', 'p', { empId: 'p', at: T });                 // day 1 09:00, stamped 30 h ahead
  homeAll(hub, [fast, counter]);
  T += 8 * HOUR; counter.record('clock.out', 'p', { empId: 'p', at: T, shiftId: d1in.id });   // day 1 17:00, named
  T += 16 * HOUR; const d2in = counter.record('clock.in', 'p', { empId: 'p', at: T });         // day 2 09:00 — sorts BEFORE the fast tablet's day-1 in? no: after; the fast in sorts last
  T += 8 * HOUR; counter.record('clock.out', 'p', { empId: 'p', at: T, shiftId: d2in.id });
  homeAll(hub, [fast, counter], 3); void notify;
  [fast, counter].forEach(function (s) {
    const P = s.project('timeclock'); H.eq(P.shifts.length, 2, s.id + ' two shifts'); H.eq(P.orphans.length, 0, s.id + ' no orphan');
    P.shifts.forEach(function (sh) { H.eq(sh.status, 'closed'); H.eq(sh.closedBy, 'punch'); H.eq(sh.out - sh.in, 8 * HOUR, s.id + ' eight hours'); H.eq(sh.invalid, null); H.eq(sh.extraIns.length, 0); });
  });
});
H.test('equal-rank closes tie-break in the ONE order (the later stamp is current), never by which pass pushed them: a named punch that sorts before its day-ahead in attaches in the repair pass and does not out-rank the later punch', function () {
  const hub = makeHub(); const fast = att('fast', hub, function () { return T + 30 * HOUR; }), counter = att('counter', hub);
  const d1in = fast.record('clock.in', 'p', { empId: 'p', at: T }); homeAll(hub, [fast, counter]);   // the in is stamped 30 h ahead: beyond the cap, the counter orders it but never obeys it
  T += 8 * HOUR; const early = counter.record('clock.out', 'p', { empId: 'p', at: T, shiftId: d1in.id });             // named; its stamp sorts BEFORE the in → an orphan until the repair pass
  T += 60000; const late = fast.record('clock.out', 'p', { empId: 'p', at: T, shiftId: d1in.id });                  // named; stamped after the in → attached in the main pass
  homeAll(hub, [fast, counter], 3); void early;
  [fast, counter].forEach(function (s) { const sh = s.project('timeclock').shifts[0]; H.eq(sh.closes.length, 2, s.id + ' both punches on the shift'); H.eq(sh.disputed, true); H.eq(sh.out, late.payload.at, s.id + ' the later STAMP is the current value, not the one the repair pass pushed last'); H.eq(s.project('timeclock').orphans.length, 0); });
});
H.test('what a person must see: a manager edit that widens a shift over a pocket-punch shift makes both INVALID (overlap); a 32-hour shift is SUSPECT; a human punch stranded after the day moved on is an ORPHAN alert; an edit with an impossible time is refused', function () {
  const alerts = []; const hub = makeHub({ notify: function (x) { alerts.push(x); } }); const k = att('k', hub);
  k.record('clock.in', 'dana', { empId: 'dana', at: T }); const s1 = openShiftId(k.project('timeclock'), 'dana');
  T += 5 * HOUR; k.record('clock.out', 'dana', { empId: 'dana', at: T, shiftId: s1 }); T += 30000; k.record('clock.in', 'dana', { empId: 'dana', at: T }); const s2 = openShiftId(k.project('timeclock'), 'dana');
  T += 3 * HOUR; k.record('clock.out', 'dana', { empId: 'dana', at: T, shiftId: s2 }); H.eq(k.project('timeclock').invalid.length, 0);
  k.record('clock.edit', 'dana', { empId: 'dana', shiftId: s1, out: T }, { actor: 'manager' });   // widened over the second shift
  const P = k.project('timeclock'); H.eq(P.invalid.length, 2); H.ok(/overlaps/.test(P.invalid[0].why)); H.ok(alerts.some(function (x) { return x.kind === 'invalid-shift' && /overlaps/.test(x.detail.why); }));
  T += 1; k.record('clock.in', 'sam', { empId: 'sam', at: T }); const s3 = openShiftId(k.project('timeclock'), 'sam'); T += 32 * HOUR; k.record('clock.out', 'sam', { empId: 'sam', at: T, shiftId: s3 });
  H.ok(k.project('timeclock').suspect.some(function (x) { return x.empId === 'sam'; })); H.ok(alerts.some(function (x) { return x.kind === 'suspect-shift'; }));
  T += 1; k.record('clock.out', 'ghost', { empId: 'ghost', at: T });               // a punch-out with no in at all
  H.eq(alerts.filter(function (x) { return x.kind === 'orphan-punch'; }).length, 0, 'not yet: the day has not moved on'); T += 7 * HOUR; k.record('clock.in', 'x', { empId: 'x', at: T });
  H.ok(alerts.some(function (x) { return x.kind === 'orphan-punch'; }), 'told once the day moved past it');
  let m = ''; try { k.record('clock.edit', 'dana', { empId: 'dana', shiftId: s1, out: 1e300 }); } catch (e) { m = e.message; } H.ok(/real time/.test(m));
});

/* ================================================================================================ */
/* §18 — ROUND 5 OF THE ADVERSARIES (2026-09-17, before dawn): the lease on every write; adoption in the log; attempts  */
/*       as durable as outcomes; the writer nonce; rotated-away keys; the tap window                                  */
/* ================================================================================================ */

H.section('18b · adoption is written to the log; adopted texts are held BEFORE the fact lands; a torn effects store is never overwritten');
H.test('a hook that returns a REJECTING Promise is a failure, listed; the hook is handed a copy (annotating it cannot corrupt my log)', function () {
  const hub = makeHub(); const store = fxStore(); let fail = true;
  const S = makeStation({ id: 'ah', now: now, persist: store, onEffect: function (f, e) { e.payload.providerId = 'SM1'; return fail ? Promise.reject(new Error('text provider 503')) : Promise.resolve(); } }); sync.attach(S, hub);
  const e = S.record('test.text', 'k', { msg: 'x' }); H.eq(e.pos, 1);
  return new Promise(function (r) { setTimeout(r, 0); }).then(function () {
    H.eq(S.effectsFailed.length, 1, 'the rejection was remembered'); H.ok(/text provider 503/.test(S.effectsFailed[0].error)); H.ok(S.selfCheck().problems.every(function (p) { return !/tampered/.test(p); }), 'my log row is untouched');
    H.eq(S.log.get(e.id).payload.providerId, undefined); fail = false; H.eq(S.retryEffects(), 1);
    return new Promise(function (r2) { setTimeout(r2, 0); }).then(function () { H.eq(S.effectsFailed.length, 0); H.ok(S.selfCheck().ok, S.selfCheck().problems.join('; ')); });
  });
});
H.test('a DEPLOY that adds a text to an existing type never texts the history: on the first boot after the update every already-witnessed fact\'s new text is HELD for the operator', function () {
  const hub = makeHub(); const store = fxStore(); const fired = [];
  if (!registry.knows('crit.pickup')) registry.registerType('crit.pickup', { aggregate: 'testagg', tier: 'immediate', effects: [], doc: 'test-only' });
  const S = makeStation({ id: 'dep', now: now, persist: store, onEffect: function (f, e) { fired.push(e.id); } }); sync.attach(S, hub);
  for (let i = 0; i < 5; i++) { T += 1; S.record('crit.pickup', 'o' + i, { n: i }); } H.eq(fired.length, 0); S.close();
  registry.typeDef('crit.pickup').effects.push('sms');                            // v2.1: a text on pickup
  const S2 = makeStation({ id: 'dep', now: now, persist: store, onEffect: function (f, e) { fired.push(e.id); } }); sync.attach(S2, hub); sync.home(S2, hub);
  H.eq(fired.length, 0, 'nobody was texted about last week'); H.eq(S2.effectsFailed.length, 5, 'held and listed'); H.ok(/app was updated/.test(S2.effectsFailed[0].error)); H.ok(!S2.selfCheck().ok);
  T += 1; S2.record('crit.pickup', 'o9', { n: 9 }); H.eq(fired.length, 1, 'new work texts once');
  registry.typeDef('crit.pickup').effects.pop();
});



H.section('18e · the fold: seconds of skew are a tap; the guarded fallback is by evidence');
H.test('Dana\'s double tap with a phone 20 s slow (synced, so its in sorts AFTER the counter\'s but its time is earlier) is ONE shift with an extra tap — never a phantom open shift; the guarded fallback finds the autoclosed night shift even after today\'s clock-in', function () {
  const hub = makeHub(); const counter = att('counter', hub), phone = att('phone', hub, function () { return T - 20000; });
  counter.record('clock.in', 'dana', { empId: 'dana', at: T }); sync.home(phone, hub); T += 5000; phone.record('clock.in', 'dana', { empId: 'dana', at: T - 20000 }); homeAll(hub, [counter, phone]);
  [counter, phone].forEach(function (s) { const P = s.project('timeclock'); H.eq(P.shifts.length, 1, s.id + ' one shift'); H.eq(P.shifts[0].extraIns.length, 1); H.eq(P.invalid.length, 0); });
  T += 8 * HOUR; counter.record('clock.out', 'dana', { empId: 'dana', at: T, shiftId: openShiftId(counter.project('timeclock'), 'dana') }); homeAll(hub, [counter, phone]);
  H.eq(openShiftId(counter.project('timeclock'), 'dana'), null, 'nothing left open'); H.ok(Math.abs(counter.project('timeclock').shifts[0].out - counter.project('timeclock').shifts[0].in - 8 * HOUR) < 10000, 'eight hours, give or take the tap');
  /* the night shift */
  const hub2 = makeHub(); const c2 = att('c2', hub2), ph = att('ph', hub2, function () { return T + 30 * HOUR; }); sync.detach(ph);
  T += 5 * HOUR; c2.record('clock.in', 'n', { empId: 'n', at: T }); const night = openShiftId(c2.project('timeclock'), 'n');
  T += 6 * HOUR; c2.record('clock.autoclose', 'n', { empId: 'n', at: T, shiftId: night, reason: 'sweep' });        // the 04:00 sweep
  const punchAt = T - HOUR; ph.record('clock.out', 'n', { empId: 'n', at: punchAt });                             // the real punch at 03:00, unnamed, on a day-ahead phone
  sync.attach(ph, hub2); homeAll(hub2, [c2, ph], 3); H.eq(c2.project('timeclock').shifts[0].closedBy, 'punch');
  T += 10 * HOUR; c2.record('clock.in', 'n', { empId: 'n', at: T }); homeAll(hub2, [c2, ph], 3);                   // today's clock-in
  [c2, ph].forEach(function (s) { const P = s.project('timeclock'); H.eq(P.shifts[0].closedBy, 'punch', s.id + ' the punch is still the night shift\'s end'); H.eq(P.orphans.length, 0, s.id + ' no orphan'); H.eq(P.shifts.length, 2); });
});


H.section('19 · round 6 (solo, 2026-09-22): a fork is proven by evidence, not by a log shape; a restored rotation is the same fact; adoption is linear');

H.test('a DST-stuck tablet in the fleet inflates the counter clock by an hour: two taps of Dana eleven minutes apart (both walls right) are ONE shift of eight hours, not 7.82 h + a 19 h autoclose — a stamp that ran ahead of its own wall rewinds the start instead of opening an earlier shift', function () {
  const hub = makeHub(); const counter = att('counter', hub), phone = att('phone', hub), tablet = att('tablet', hub, function () { return T + HOUR; }); const all = [counter, phone, tablet];
  const MIN = 60000; const D1 = T + 24 * HOUR;
  T = D1 - 16 * HOUR; counter.record('clock.in', 'kay', { empId: 'kay', at: T }); T += 8 * HOUR; counter.record('clock.out', 'kay', { empId: 'kay', at: T, shiftId: openShiftId(counter.project('timeclock'), 'kay') }); homeAll(hub, all);
  sync.detach(phone);                                                                              // no wifi since last night
  T = D1 - 30 * MIN; tablet.record('clock.in', 'kay', { empId: 'kay', at: T + HOUR }); homeAll(hub, [counter, tablet]);   // Kay on the tablet nobody moved for DST; the counter pulls it and its clock runs ahead
  T = D1; const a = counter.record('clock.in', 'dana', { empId: 'dana', at: T }); homeAll(hub, [counter, tablet]);
  T = D1 + 11 * MIN; const b = phone.record('clock.in', 'dana', { empId: 'dana', at: T });          // the phone still says "not clocked in"
  H.ok(a.hlc.t > b.hlc.t, "the counter's stamp sorts AFTER the phone's although its wall is earlier");
  T = D1 + 3 * HOUR; sync.attach(phone, hub); homeAll(hub, all);
  all.forEach(function (s) { const P = s.project('timeclock'); const d = P.shifts.filter(function (x) { return x.empId === 'dana'; }); H.eq(d.length, 1, s.id + ': one shift'); H.eq(d[0].in, D1, s.id + ': started at the first tap'); H.eq(d[0].extraIns.length, 1); H.eq(P.invalid.length, 0, s.id + ': nothing invalid'); });
  T = D1 + 8 * HOUR; counter.record('clock.out', 'dana', { empId: 'dana', at: T, shiftId: openShiftId(counter.project('timeclock'), 'dana') }); homeAll(hub, all);
  all.forEach(function (s) { const P = s.project('timeclock'); H.eq(openShiftId(P, 'dana'), null, s.id + ': she is OUT'); const d = P.shifts.filter(function (x) { return x.empId === 'dana'; })[0]; H.eq(d.out - d.in, 8 * HOUR, s.id + ': eight hours, exactly'); });
  T = D1 + 19 * HOUR; H.eq(openShiftId(counter.project('timeclock'), 'dana'), null, 'nothing for the sweep to close');
  const folds = all.map(function (s) { return JSON.stringify(s.project('timeclock').shifts); }); H.eq(folds[0], folds[1]); H.eq(folds[1], folds[2], 'identical on every station');
});

/* ================================================================================================================
   §20 — THE HUB IS THE AUTHORITY (2026-09-22). Owner: "yes, do it, start with the hub as single authority".
   Every law below was proven before against the sovereign-station model (signed facts, receipt numbers, pins);
   those proofs were retired with that machinery (in git, v2-eventsourced 58464c0). These re-prove each law that
   still applies, against the device-access model, plus the new laws of enrolment and revocation.
   ================================================================================================================ */
const EV = require('../core/event');
function jstore() { const lines = []; let access = null; return { load: function () { return JSON.parse(JSON.stringify(lines)); }, append: function (row) { lines.push(JSON.parse(JSON.stringify(row))); }, loadAccess: function () { return access; }, saveAccess: function (a) { access = a; }, _lines: lines }; }
function hubStore() { let snap = null, failing = false; return { load: function () { return snap == null ? null : JSON.parse(JSON.stringify(snap)); }, save: function (s) { if (failing) throw new Error('disk full'); snap = JSON.parse(JSON.stringify(s)); }, _fail: function (v) { failing = v; }, _snap: function () { return JSON.parse(JSON.stringify(snap)); }, _set: function (v) { snap = JSON.parse(JSON.stringify(v)); } }; }
function has(list, re) { return list.some(function (x) { return re.test(typeof x === 'string' ? x : JSON.stringify(x)); }); }

H.section('20a · a station records offline; every fact carries a unique id in its own namespace and a content hash');
H.test('records offline with no hub at all: unique ids, content hashes, a correct fold, and a restart from its own log projects the same', function () {
  const P = mem(); const S = makeStation({ id: 'solo', now: now, persist: P });
  const a = S.record('clock.in', 'p', { empId: 'p', at: T }); T += HOUR; const b = S.record('clock.out', 'p', { empId: 'p', at: T, shiftId: a.id });
  H.ok(a.id.indexOf('solo/') === 0 && a.id !== b.id); H.ok(/^[0-9a-f]{64}$/.test(a.hash)); H.eq(a.pos, null, 'nobody has witnessed it yet');
  const P1 = S.project('timeclock'); H.eq(P1.shifts.length, 1); H.eq(P1.shifts[0].out - P1.shifts[0].in, HOUR);
  const S2 = makeStation({ id: 'solo', now: now, persist: P }); H.deepEq(S2.project('timeclock'), P1, 'the same projection after a restart');
  H.eq(S2.mine().length, 2); H.ok(S2.selfCheck().problems.every(function (p) { return /no hub access/.test(p); }), 'the only thing missing is hub access');
});
H.test('a payload JSON cannot carry, or one the aggregate declares invalid, is refused BEFORE anything is minted', function () {
  const S = makeStation({ id: 'val', now: now });
  let m = ''; try { S.record('clock.in', 'p', { empId: 'p', at: T, big: BigInt(1) }); } catch (e) { m = e.message; } H.ok(/transmissible/.test(m), m);
  m = ''; try { S.record('clock.in', 'p', { at: T }); } catch (e) { m = e.message; } H.ok(/invalid clock.in/.test(m), m);
  H.eq(S.log.all().length, 0, 'nothing landed');
});
H.test('a changed payload no longer matches its hash: selfCheck names the tampered fact', function () {
  const S = makeStation({ id: 'tam', now: now }); const e = S.record('clock.in', 'p', { empId: 'p', at: T });
  S.log.get(e.id).payload.empId = 'q';
  const c = S.selfCheck(); H.eq(c.ok, false); H.ok(c.problems.some(function (p) { return p.indexOf('does not match its hash') >= 0 && p.indexOf(e.id) >= 0; }));
});
H.test('a garbage row in the stored log is quarantined at boot, counted, named by selfCheck, and the station still records', function () {
  const P = mem(); const S = makeStation({ id: 'gb', now: now, persist: P }); S.record('clock.in', 'p', { empId: 'p', at: T });
  P._st.events.push({ junk: true }); P._st.events.push('nonsense');
  const S2 = makeStation({ id: 'gb', now: now, persist: P }); H.eq(S2.log.quarantined, 2); H.eq(S2.mine().length, 1);
  T += 1; H.ok(S2.record('clock.out', 'p', { empId: 'p', at: T }).id); H.ok(has(S2.selfCheck().problems, /quarantined/));
});
H.test('an unreadable log halts the boot read-only: never start empty and overwrite', function () {
  const P = mem(); P.load = function () { throw new Error('disk read error'); };
  const S = makeStation({ id: 'ur', now: now, persist: P }); H.eq(S.readOnly, true); H.eq(S.haltKind, 'log');
  let m = ''; try { S.record('clock.in', 'p', { empId: 'p', at: T }); } catch (e) { m = e.message; } H.ok(/read-only/.test(m));
});
H.test('a store is owned by ONE station: another station id booted on it halts and cannot be handed access', function () {
  const P = mem(); const hub = makeHub(); const A = makeStation({ id: 'own', now: now, persist: P }); sync.attach(A, hub);
  const B = makeStation({ id: 'other', now: now, persist: P }); H.eq(B.readOnly, true); H.eq(B.haltKind, 'store');
  H.eq(B.setAccess('abc'), false); H.eq(P._st.access.station, 'own', 'the access on disk is untouched');
});

H.section('20b · the hub admits a fact only from a device enrolled as that station, intact, registered and valid');
H.test('no token, an unknown token, and a fact in another station name are all refused and alerted; nothing is stored; the real device is admitted', function () {
  const alerts = []; const hub = makeHub({ notify: function (a) { alerts.push(a.kind); } });
  const A = att('A', hub), B = att('B', hub);
  const e = A.record('clock.in', 'p', { empId: 'p', at: T }, { defer: true });
  H.ok(/not enrolled/.test(hub.receive({ station: 'A', events: [e] }).refused));
  H.ok(/not enrolled/.test(hub.receive({ station: 'A', token: 'f'.repeat(48), events: [e] }).refused));
  const r = hub.receive({ station: 'B', token: B.accessToken, events: [e] }); H.eq(r.eventAcks[0].ok, false); H.ok(/only as its own station/.test(r.eventAcks[0].reason));
  H.eq(hub.head, 0, 'nothing stored'); H.ok(alerts.indexOf('unknown-device') >= 0 && alerts.indexOf('wrong-station') >= 0);
  H.eq(A.commit('now').acked, 1, 'the real device is admitted');
});
H.test('corrupted in transit: the hub refuses a fact whose content no longer matches its hash, stores nothing, and the station keeps it owed', function () {
  const hub = makeHub(); const A = att('ct', hub);
  A.setTransport(function (b) { const c = JSON.parse(JSON.stringify(b)); c.events.forEach(function (x) { x.payload.empId = 'mallory'; }); return hub.receive(c); });
  const e = A.record('clock.in', 'p', { empId: 'p', at: T });
  H.eq(hub.head, 0); H.eq(A.lastCommit.refused, 1); H.eq(e.pos, null, 'still owed');
  sync.attach(A, hub); H.eq(A.commit('clean').acked, 1); H.eq(hub.master[0].hash, e.hash); H.eq(hub.master[0].payload.empId, 'p');
});
H.test('the registry is checked at the door: an unregistered type, a misfiled aggregate and an invalid payload are refused, alerted, and nothing is stored', function () {
  const alerts = []; const hub = makeHub({ notify: function (a) { alerts.push(a.kind); } }); const S = att('rg', hub);
  const mk = function (type, agg, payload) { T += 1; return EV.makeEvent({ type: type, aggregate: agg, key: 'k', payload: payload, hlc: { t: T, c: 0, id: 'rg' }, station: 'rg', at: T }); };
  const r = hub.receive({ station: 'rg', token: S.accessToken, events: [mk('nope.never', 'timeclock', {}), mk('clock.in', 'testagg', { empId: 'p', at: T }), mk('clock.in', 'timeclock', { at: T })] });
  H.deepEq(r.eventAcks.map(function (a) { return a.ok; }), [false, false, false]); H.eq(hub.head, 0);
  H.ok(alerts.indexOf('unregistered') >= 0 && alerts.indexOf('invalid-payload') >= 0);
});
H.test('bounded stamps: a counter of 2 to the 53rd is refused by the hub and by every station, and never reaches a clock', function () {
  const hub = makeHub(); const A = att('bs', hub), B = att('bs2', hub);
  const good = A.record('clock.in', 'p', { empId: 'p', at: T }, { defer: true });
  const bad = JSON.parse(JSON.stringify(good)); bad.id = 'bs/huge'; bad.hlc.c = Math.pow(2, 53); bad.hash = EV.hashOf(bad);
  const r = hub.receive({ station: 'bs', token: A.accessToken, events: [bad] }); H.eq(r.eventAcks[0].ok, false); H.ok(/hlc stamp/.test(r.eventAcks[0].reason));
  H.eq(B.ingest([Object.assign({}, bad, { pos: 1, epoch: 'x' })]).refused, 1); H.ok(B.clock.now().c < 1000, 'the clock never observed it');
});
H.test('an id is minted in its issuer namespace: a fact under another station id prefix is malformed at every door', function () {
  const hub = makeHub(); const A = att('sq', hub); const B = att('victim', hub);
  const e = A.record('clock.in', 'p', { empId: 'p', at: T }, { defer: true });
  const squat = JSON.parse(JSON.stringify(e)); squat.id = 'victim/' + e.id.split('/')[1]; squat.hash = EV.hashOf(squat);
  H.ok(/namespace/.test(EV.shapeError(squat))); const r = hub.receive({ station: 'sq', token: A.accessToken, events: [squat] }); H.eq(r.eventAcks[0].ok, false); H.eq(hub.head, 0);
  H.eq(B.ingest([squat]).refused, 1);
});
H.test('station ids named like prototype members (toString, constructor, __proto__) are ordinary stations', function () {
  const hub = makeHub(); const S = ['toString', 'constructor', '__proto__'].map(function (id) { return att(id, hub); });
  S.forEach(function (s, i) { T += 1; s.record('clock.in', 'e' + i, { empId: 'e' + i, at: T }); }); homeAll(hub, S);
  H.eq(hub.head, 3); S.forEach(function (s) { H.eq(s.log.all().length, 3, s.id); }); H.deepEq(hub.watch().laggards, []); H.eq(hub.status(hub.master[0].id).complete, true);
});
H.test('identical wall stamps still sort identically everywhere: the tie falls through to the station, then the id', function () {
  const hub = makeHub(); const A = att('tieA', hub), B = att('tieB', hub);
  const a = A.record('clock.in', 'p', { empId: 'p', at: T }); const b = B.record('clock.in', 'q', { empId: 'q', at: T });
  H.eq(a.hlc.t, b.hlc.t); homeAll(hub, [A, B]);
  H.deepEq(A.log.sorted().map(function (x) { return x.id; }), B.log.sorted().map(function (x) { return x.id; }));
});
H.test('every hub read is a copy: changing what it hands out changes nothing it holds', function () {
  const hub = makeHub(); const A = att('cp', hub); A.record('clock.in', 'p', { empId: 'p', at: T });
  const m = hub.master; m[0].payload.empId = 'x'; m.push({}); hub.changesSince(0)[0].payload.empId = 'y'; hub.eventsOf('cp')[0].hash = '0'; hub.watch().stations.cp.cursor = 999; hub.alerts.push({ key: 'x' });
  H.eq(hub.master.length, 1); H.eq(hub.master[0].payload.empId, 'p'); H.eq(hub.master[0].hash, A.mine()[0].hash); H.ok(hub.watch().stations.cp.cursor !== 999); H.eq(hub.alerts.length, 0);
});
H.test('a hub snapshot whose positions are strings (a BIGINT adapter) loads as numbers and goes on witnessing', function () {
  const P = hubStore(); const hub = makeHub({ persist: P }); const A = att('bi', hub); A.record('clock.in', 'p', { empId: 'p', at: T });
  const snap = P._snap(); snap.master.forEach(function (e) { e.pos = String(e.pos); }); snap.head = String(snap.head); P._set(snap);
  const hub2 = makeHub({ persist: P }); H.eq(hub2.epoch, hub.epoch, 'nothing was judged damaged'); H.eq(typeof hub2.master[0].pos, 'number');
  sync.attach(A, hub2); T += 1; H.eq(A.record('clock.out', 'p', { empId: 'p', at: T }).pos, 2);
});

H.section('20c · the hub is durable before it speaks; a new or forgetful hub gets everything back from the stations');
H.test('hub storage fails: nothing is witnessed, every ack says retry, the same fact twice in one bundle is one fact, and when the disk returns it lands once', function () {
  const P = hubStore(); const hub = makeHub({ persist: P }); const A = att('df', hub);
  P._fail(true); const e = A.record('clock.in', 'p', { empId: 'p', at: T });
  H.eq(e.pos, null); H.eq(hub.head, 0); H.ok(A.failures.some(function (f) { return f.kind === 'hub-refused' && /storage/.test(f.reason); }));
  const r = hub.receive({ station: 'df', token: A.accessToken, events: [e, e] }); H.ok(r.eventAcks.every(function (a) { return !a.ok && /retry/.test(a.reason); })); H.eq(hub.head, 0);
  P._fail(false); H.eq(A.commit('back').acked, 1); H.eq(hub.head, 1); H.eq(makeHub({ persist: P }).head, 1, 'and it is durable');
});
H.test('a damaged hub store at boot: the bad row is quarantined, the hub takes a NEW epoch and says why, and the station re-offers what it lost', function () {
  const P = hubStore(); const alerts = []; const hub = makeHub({ persist: P }); const A = att('dm', hub);
  A.record('clock.in', 'p', { empId: 'p', at: T }); T += 1; A.record('clock.out', 'p', { empId: 'p', at: T });
  const snap = P._snap(); snap.master[1].payload.empId = 'zz'; P._set(snap);
  const hub2 = makeHub({ persist: P, notify: function (a) { alerts.push(a.kind); } });
  H.ok(hub2.epoch !== hub.epoch); H.ok(alerts.indexOf('store-inconsistent') >= 0); H.eq(hub2.watch().quarantinedRows, 1); H.eq(hub2.head, 1);
  sync.attach(A, hub2); sync.home(A, hub2); H.eq(hub2.eventsOf('dm').length, 2, 'the station re-offered what the hub lost');
});
H.test('the hub dies and a fresh one starts empty: every station, enrolled again, re-offers what it holds, and a new fact reaches everyone', function () {
  const hub = makeHub(); const A = att('f1', hub), B = att('f2', hub);
  A.record('clock.in', 'p', { empId: 'p', at: T }); T += 1; B.record('clock.in', 'q', { empId: 'q', at: T }); homeAll(hub, [A, B]);
  const hub2 = makeHub(); sync.attach(A, hub2); sync.attach(B, hub2); homeAll(hub2, [A, B]);
  H.eq(hub2.head, 2); T += 1; A.record('clock.out', 'p', { empId: 'p', at: T }); homeAll(hub2, [A, B]);
  H.eq(B.log.all().length, 3); H.eq(hub2.status(hub2.master[2].id).complete, true);
});
H.test('a text fires exactly once across a hub change: witnessed by the first hub it is sent; re-witnessed by a fresh hub it is not sent again', function () {
  const hub = makeHub(); const fired = []; const S = makeStation({ id: 'tx', now: now, persist: fxStore(), onEffect: function (fx, e) { fired.push(e.id); } }); sync.attach(S, hub);
  const e = S.record('test.text', 'c1', {});
  H.deepEq(fired, [e.id]);
  const hub2 = makeHub(); sync.attach(S, hub2); sync.home(S, hub2); H.eq(hub2.head, 1); H.deepEq(fired, [e.id], 'once');
});
H.test('a quiet restore: the hub went back to an old backup under the SAME identity and holds nothing past my fact; the pull sees its record ends short, re-offers at once, and the hub alerts', function () {
  const P = hubStore(); const alerts = []; const hub = makeHub({ persist: P }); const A = att('qr', hub);
  A.record('clock.in', 'p', { empId: 'p', at: T }); const backup = P._snap();
  T += 1; const lost = A.record('clock.out', 'p', { empId: 'p', at: T }); H.eq(lost.pos, 2);
  P._set(backup); const hub2 = makeHub({ persist: P, notify: function (a) { alerts.push(a.kind); } }); H.eq(hub2.epoch, hub.epoch, 'same identity'); H.eq(hub2.head, 1);
  sync.attach(A, hub2); const h = sync.home(A, hub2); H.eq(h.pull.lost, 1); H.eq(hub2.eventsOf('qr').length, 2, 'mine is back'); H.ok(alerts.indexOf('witness-lost') >= 0);
});
H.test('a restore that gave my position to another fact: the pull sees the other fact where mine was, re-offers mine at once, and nothing is lost', function () {
  const P = hubStore(); const hub = makeHub({ persist: P }); const A = att('pr', hub), B = att('pr2', hub);
  A.record('clock.in', 'p', { empId: 'p', at: T }); const backup = P._snap();
  T += 1; const lost = A.record('clock.out', 'p', { empId: 'p', at: T }); H.eq(lost.pos, 2);
  P._set(backup); const hub2 = makeHub({ persist: P }); sync.attach(A, hub2); sync.attach(B, hub2);
  T += 1; const other = B.record('clock.in', 'q', { empId: 'q', at: T }); H.eq(other.pos, 2, 'the other fact took my old position');
  const h = sync.home(A, hub2); H.eq(h.pull.lost, 1); H.eq(hub2.eventsOf('pr').length, 2); H.eq(hub2.head, 3);
});
H.test('journal persistence: a punch appends one line and its echo one more; a reboot replays the facts, their witness marks and the access', function () {
  const J = jstore(); const hub = makeHub(); const S = makeStation({ id: 'jn', now: now, persist: J }); sync.attach(S, hub);
  const n0 = J._lines.length; const e = S.record('clock.in', 'p', { empId: 'p', at: T });
  H.eq(J._lines.length - n0, 2, 'one line for the fact, one for its echo'); H.ok(J._lines.some(function (r) { return r.ev && r.ev.id === e.id; }));
  const S2 = makeStation({ id: 'jn', now: now, persist: J }); H.eq(S2.mine().length, 1); H.eq(S2.mine()[0].pos, 1, 'the witness mark survived the reboot'); H.eq(S2.accessToken, S.accessToken);
});
H.test('journal: a refused append is queued, never re-appended wholesale; when the disk returns exactly the missing row lands, and selfCheck says so meanwhile', function () {
  const J = jstore(); let refuse = false; const app = J.append; J.append = function (row) { if (refuse) throw new Error('disk'); return app(row); };
  const S = makeStation({ id: 'jq', now: now, persist: J }); S.record('clock.in', 'p', { empId: 'p', at: T });
  refuse = true; T += 1; S.record('clock.out', 'p', { empId: 'p', at: T }); H.ok(has(S.selfCheck().problems, /disk has not taken/));
  const before = J._lines.length; refuse = false; S.tick(); H.eq(J._lines.length, before + 1, 'exactly the missing row');
  H.ok(!has(S.selfCheck().problems, /disk has not taken/)); H.eq(makeStation({ id: 'jq', now: now, persist: J }).mine().length, 2);
});

H.section('20d · a hub watching all: who has seen each fact, who is behind');
H.test('the hub knows who has seen each fact: seenBy and missingFrom follow every station cursor, and laggards clear after Home', function () {
  const hub = makeHub(); const A = att('w1', hub), B = att('w2', hub), C = att('w3', hub);
  const e = A.record('clock.in', 'p', { empId: 'p', at: T });
  let s = hub.status(e.id); H.deepEq(s.seenBy, ['w1']); H.deepEq(s.missingFrom, ['w2', 'w3']); H.eq(s.complete, false);
  sync.pull(B, hub); s = hub.status(e.id); H.deepEq(s.missingFrom, ['w3']); H.deepEq(hub.watch().laggards, ['w1', 'w3']);
  sync.pull(C, hub); sync.pull(A, hub); H.eq(hub.status(e.id).complete, true); H.deepEq(hub.watch().laggards, []);
});
H.test('after everyone goes Home, every station holds every fact and watches itself clean; nothing was dropped anywhere', function () {
  const hub = makeHub(); const S = ['h1', 'h2', 'h3'].map(function (id) { return att(id, hub); });
  S.forEach(function (s, i) { T += 1; s.record('clock.in', 'e' + i, { empId: 'e' + i, at: T }, { defer: true }); });
  homeAll(hub, S); S.forEach(function (s) { H.eq(s.log.all().length, 3, s.id); H.ok(s.selfCheck().ok, s.id + ' clean'); }); H.eq(hub.head, 3);
  hub.master.forEach(function (e) { H.eq(hub.status(e.id).complete, true); });
});

H.section('20e · the commit point under a bad network');
H.test('hub down: two punches fail and are held; hub up: the next commit carries both as backlog, oldest first', function () {
  const hub = makeHub(); const A = att('hd', hub); sync.detach(A);
  const a = A.record('clock.in', 'p', { empId: 'p', at: T }); T += 1; const b = A.record('clock.out', 'p', { empId: 'p', at: T });
  H.eq(A.lastCommit.ok, false); H.eq(A.lastCommit.held, 2);
  sync.attach(A, hub); const c = A.commit('back'); H.eq(c.acked, 2); H.eq(c.backlog, 2); H.deepEq(hub.master.map(function (e) { return e.id; }), [a.id, b.id]);
});
H.test('an answer that never comes is waited on for the timeout, then abandoned: the next commit goes out and nothing is lost or doubled', function () {
  const hub = makeHub(); const A = att('to', hub); let hang = true;
  A.setTransport(function (b) { if (hang) return new Promise(function () {}); return hub.receive(b); });
  A.record('clock.in', 'p', { empId: 'p', at: T }); H.eq(A.inFlight, true);
  hang = false; T += 10000; H.eq(A.commit('soon').deferred, true, 'within the timeout it waits');
  T += 30000; const c = A.commit('later'); H.eq(c.acked, 1); H.eq(hub.head, 1); H.eq(A.inFlight, false);
});
H.test('an answer with no epoch is malformed: the fact stays recorded AND owed, never parked in limbo', function () {
  const A = att('ne', makeHub()); A.setTransport(function (b) { return { eventAcks: b.events.map(function (e) { return { id: e.id, ok: true, hash: e.hash, pos: 1 }; }) }; });
  const e = A.record('clock.in', 'p', { empId: 'p', at: T }); H.eq(A.lastCommit.ok, false); H.ok(/no epoch/.test(A.lastCommit.error)); H.eq(e.pos, null); H.eq(A.log.outbox(A.epoch).length, 1);
});
H.test('300 facts owed against a wire that carries 200 at a time: the commit goes out in chunks, oldest first, and every one lands once', function () {
  const hub = makeHub(); const A = att('bk', hub); sync.detach(A);
  const ids = []; for (let i = 0; i < 300; i++) { T += 1; ids.push(A.record('clock.in', 'e' + i, { empId: 'e' + i, at: T }, { defer: true }).id); }
  let calls = 0; A.setTransport(function (b) { calls++; H.ok(b.events.length <= 200); return hub.receive(b); });
  const c = A.commit('back'); H.eq(c.acked, 300); H.eq(calls, 2); H.deepEq(hub.master.map(function (e) { return e.id; }), ids);
});

H.section('20f · texts are owed by the log; a fact taken back from the hub never texts blind');
H.test('response lost, then a routine pull witnesses my own fact: the text fires exactly once', function () {
  const hub = makeHub(); const fired = []; const S = makeStation({ id: 'rl', now: now, persist: fxStore(), onEffect: function (fx, e) { fired.push(e.id); } }); sync.attach(S, hub);
  S.setTransport(function (b) { hub.receive(b); throw new Error('connection reset'); });
  const e = S.record('test.text', 'c', {}); H.eq(fired.length, 0, 'no echo, no text'); H.eq(hub.head, 1, 'but the hub has it');
  sync.pull(S, hub); H.deepEq(fired, [e.id]); sync.attach(S, hub); sync.home(S, hub); H.deepEq(fired, [e.id], 'once');
});
H.test('a station restored from a backup re-texts NOTHING: the facts it takes back have their texts marked done AND listed; only retryEffects fires them', function () {
  const hub = makeHub(); const fired = []; const P = fxStore(); const S = makeStation({ id: 'rb', now: now, persist: P, onEffect: function (fx, e) { fired.push(e.id); } }); sync.attach(S, hub);
  const backup = cloneStore(P);
  const e = S.record('test.text', 'c', {}); H.deepEq(fired, [e.id]);
  const R = makeStation({ id: 'rb', now: now, persist: fxStore(backup), onEffect: function (fx, x) { fired.push('R:' + x.id); } }); sync.attach(R, hub);
  const p = sync.pull(R, hub); H.eq(p.adopted, 1); H.deepEq(fired, [e.id], 'nothing re-texted'); H.eq(R.effectsFailed.length, 1); H.eq(R.selfCheck().ok, false, 'listed for an operator');
  H.eq(R.retryEffects(), 1); H.deepEq(fired, [e.id, 'R:' + e.id], 'only the operator fires it');
});
H.test('a fact taken back holds its text on disk BEFORE it lands: a refused effects write defers the take-back, the pull does not step past it, nothing fires', function () {
  const hub = makeHub(); const S = att('ah', hub); S.record('test.text', 'c', {});
  let refuse = true; const P = fxStore(); const base = P.saveEffects; P.saveEffects = function (l) { if (refuse) throw new Error('disk'); return base(l); };
  P._st.access = { station: 'ah', token: S.accessToken };
  const fired = []; const R = makeStation({ id: 'ah', now: now, persist: P, onEffect: function (fx, e) { fired.push(e.id); } }); sync.attach(R, hub);
  const p = sync.pull(R, hub); H.eq(p.adopted, 0); H.eq(p.deferred, true); H.eq(R.mine().length, 0, 'not landed'); H.ok(R.failures.some(function (f) { return f.kind === 'adopt-deferred'; })); H.eq(fired.length, 0);
  refuse = false; const p2 = sync.pull(R, hub); H.eq(p2.adopted, 1, 'the next pull takes it back'); H.eq(fired.length, 0, 'held, not fired'); H.eq(R.effectsFailed.length, 1);
});
H.test('selfCheck is RED while a text failed or its outcome is unknown, and clean once an operator retry succeeds', function () {
  const hub = makeHub(); let fail = true; const S = makeStation({ id: 'sr', now: now, persist: fxStore(), onEffect: function () { if (fail) throw new Error('gateway 503'); } }); sync.attach(S, hub);
  S.record('test.text', 'c', {}); const c = S.selfCheck(); H.eq(c.ok, false); H.ok(has(c.problems, /failed or outcome unknown/)); H.eq(c.effectsFailed, 1);
  fail = false; H.eq(S.retryEffects(), 1); H.eq(S.selfCheck().ok, true);
});
H.test('a fact taken back advances my own clock: the next punch on a restored copy whose wall lags still sorts after it', function () {
  const hub = makeHub(); const P = mem(); const A = makeStation({ id: 'ck', now: now, persist: P }); sync.attach(A, hub);
  const backup = cloneStore(P); T += HOUR; const late = A.record('clock.in', 'p', { empId: 'p', at: T });
  const R = makeStation({ id: 'ck', now: function () { return T - 2 * HOUR; }, persist: backup }); sync.attach(R, hub); sync.pull(R, hub);
  const next = R.record('clock.out', 'p', { empId: 'p', at: T - 2 * HOUR });
  H.ok(hlc.compareEvents(late, next) < 0, 'my own history is never re-ordered by a lagging wall');
});
H.test('reboot with a journal row still pending: the hub holds a fact my disk never got, and the next pull takes it back', function () {
  const J = jstore(); let refuse = false; const app = J.append; J.append = function (row) { if (refuse) throw new Error('disk'); return app(row); };
  const hub = makeHub(); const S = makeStation({ id: 'jp', now: now, persist: J }); sync.attach(S, hub);
  refuse = true; const e = S.record('clock.in', 'p', { empId: 'p', at: T }); H.eq(e.pos, 1, 'witnessed although my disk refused');
  refuse = false;
  const S2 = makeStation({ id: 'jp', now: now, persist: J }); H.eq(S2.mine().length, 0); sync.attach(S2, hub);
  const p = sync.pull(S2, hub); H.eq(p.adopted, 1); H.eq(S2.mine()[0].id, e.id);
});
H.test('taking back at scale: a restore of 1,500 facts in one pull is linear', function () {
  const hub = makeHub(); const A = att('big', hub); sync.detach(A);
  for (let i = 0; i < 1500; i++) { T += 1; A.record('clock.in', 'e' + i, { empId: 'e' + i, at: T }, { defer: true }); }
  sync.attach(A, hub); A.commit('backlog'); H.eq(hub.eventsOf('big').length, 1500);
  const B = makeStation({ id: 'big', now: now }); B.setAccess(A.accessToken); sync.attach(B, hub);
  const t0 = Date.now(); const p = sync.pull(B, hub); const ms = Date.now() - t0;
  H.eq(p.adopted, 1500); H.ok(ms < 4000, 'took ' + ms + ' ms');
});

H.section('20g · one window per station; the heartbeat retries what the disk refused; timers on the monotonic clock');
H.test('a second window on the same store is read-only: it records nothing, sends nothing, acks nothing, texts nobody, and erases nothing', function () {
  const store = fxStore(leaseStore()); const hub = makeHub(); const fired = [];
  const W = makeStation({ id: 'w', now: now, persist: store, onEffect: function () { fired.push('W'); } }); sync.attach(W, hub);
  const R = makeStation({ id: 'w', now: now, persist: store, onEffect: function () { fired.push('R'); } }); sync.attach(R, hub);
  H.eq(R.readOnly, true); H.ok(/another window/.test(R.halted));
  W.record('test.text', 'c', {}); H.deepEq(fired, ['W']);
  let m = ''; try { R.record('clock.in', 'p', { empId: 'p', at: T }); } catch (e) { m = e.message; } H.ok(/read-only/.test(m));
  H.eq(R.commit('x').readOnly, true); H.eq(sync.pull(R, hub).readOnly, true); H.eq(R.ingest(hub.changesSince(0)).readOnly, true); H.deepEq(fired, ['W']);
  H.eq(store.load().length, 1, 'the writer fact is on disk and nothing erased it');
});
H.test('a lease service that THROWS at boot fails closed; once it answers, the window takes the station back', function () {
  const store = leaseStore(); let broken = true; const lease = store.lease; store.lease = function (n, ms) { if (broken) throw new Error('lease service down'); return lease(n, ms); };
  const S = makeStation({ id: 'ls', now: now, persist: store }); H.eq(S.readOnly, true); H.eq(S.haltKind, 'lease');
  broken = false; H.deepEq(S.tick(), { reclaimed: true }); H.eq(S.readOnly, false); H.ok(S.record('clock.in', 'p', { empId: 'p', at: T }).id);
});
H.test('a kiosk that crashed and reloaded within the lease boots read-only, and takes the station back by itself a full lease later', function () {
  const store = leaseStore(); const A = makeStation({ id: 'kc', now: now, persist: store }); A.record('clock.in', 'p', { empId: 'p', at: T });
  T += 1000; const B = makeStation({ id: 'kc', now: now, persist: store }); H.eq(B.readOnly, true);
  T += 10000; H.eq(B.tick(), null, 'the old window might still be alive');
  T += 30000; H.deepEq(B.tick(), { reclaimed: true }); H.eq(B.mine().length, 1, 'the crashed window fact is there');
});
H.test('a tab that slept past its lease while another window took over applies NOTHING on wake: no punch, no pull', function () {
  const store = leaseStore(); const hub = makeHub(); const W = makeStation({ id: 'sl', now: now, persist: store }); sync.attach(W, hub);
  T += 40000; const X = makeStation({ id: 'sl', now: now, persist: store }); H.eq(X.readOnly, false, 'the lease had lapsed: the new window took it');
  X.record('clock.in', 'p', { empId: 'p', at: T });
  let m = ''; try { W.record('clock.in', 'q', { empId: 'q', at: T }); } catch (e) { m = e.message; } H.ok(/read-only/.test(m)); H.eq(W.readOnly, true);
  H.eq(sync.pull(W, hub).readOnly, true); H.eq(store.load().length, 1);
});
H.test('a lapse after a refused save: reclaim MERGES the fact the disk never took back into the log instead of dropping it', function () {
  const store = leaseStore(); let refuse = false; const save = store.save; store.save = function (l) { if (refuse) throw new Error('disk'); return save(l); };
  const W = makeStation({ id: 'lm', now: now, persist: store });
  refuse = true; const e = W.record('clock.in', 'p', { empId: 'p', at: T }); refuse = false;
  T += 40000; W.record('clock.out', 'p', { empId: 'p', at: T });
  H.eq(W.mine().length, 2); H.ok(W.mine().some(function (x) { return x.id === e.id; })); H.eq(store.load().length, 2, 'both on disk now');
});
H.test('a fact the disk refused: selfCheck is RED and the heartbeat retries the write until it lands', function () {
  const P = mem(); let refuse = true; const save = P.save; P.save = function (l) { if (refuse) throw new Error('disk'); return save(l); };
  const S = makeStation({ id: 'hb', now: now, persist: P }); S.record('clock.in', 'p', { empId: 'p', at: T });
  H.ok(has(S.selfCheck().problems, /disk has not taken/));
  S.tick(); H.eq(P._st.events.length, 0, 'still refused'); refuse = false; S.tick(); H.eq(P._st.events.length, 1); H.ok(!has(S.selfCheck().problems, /disk has not taken/));
});
H.test('a system fact recorded inside an open Rack tile is not a touch: the 15-minute idle clock runs on, and a person act resets it', function () {
  const hub = makeHub(); const S = att('rk', hub); S.openTile('rack');
  T += 10 * 60000; S.record('test.text', 'c', {}); T += 6 * 60000; const r = S.tick(); H.ok(r && r.timedOut, 'the system fact did not reset the idle clock');
  S.openTile('rack'); T += 10 * 60000; S.record('clock.in', 'p', { empId: 'p', at: T }, { actor: 'p' }); T += 6 * 60000; H.eq(S.tick(), null, 'a person act resets it');
});
H.test('a station built with neither clock runs its timers on the host monotonic clock, and a monotonic clock that throws is replaced and named', function () {
  const S = makeStation({ id: 'mono' }); S.openTile('rack'); H.eq(S.tick(), null, 'no real time has passed');
  const B = makeStation({ id: 'mono2', mono: function () { throw new Error('bad clock'); } }); H.ok(B.failures.some(function (f) { return f.kind === 'clock'; }));
});
H.testAsync('an HTTPS-shaped (Promise) transport: one commit in flight, the next queued behind it, nothing lost or doubled', async function () {
  const hub = makeHub(); const S = att('as', hub); let release = null;
  S.setTransport(function (b) { return new Promise(function (res) { release = function () { res(hub.receive(b)); }; }); });
  const tick = function () { return new Promise(function (r) { setTimeout(r, 0); }); };
  S.record('clock.in', 'p', { empId: 'p', at: T }); H.eq(S.inFlight, true);
  T += 1; S.record('clock.out', 'p', { empId: 'p', at: T }); H.eq(S.lastCommit.deferred, true, 'queued, not sent on top');
  release(); await tick(); H.eq(S.inFlight, true, 'the queued commit went out by itself');
  release(); await tick();
  H.eq(S.inFlight, false); H.eq(hub.master.length, 2); H.eq(S.log.outbox(hub.epoch).length, 0);
});
H.testAsync('close() makes the window inert at once: a tap and a LATE answer apply nothing, and the lease is released for the next window', async function () {
  const store = leaseStore(); const hub = makeHub(); const W = makeStation({ id: 'cl', now: now, persist: store }); sync.attach(W, hub);
  let late = null; W.setTransport(function (b) { return new Promise(function (res) { late = function () { res(hub.receive(b)); }; }); });
  const e = W.record('clock.in', 'p', { empId: 'p', at: T }); H.eq(W.inFlight, true);
  W.close(); H.eq(W.readOnly, true); H.eq(W.haltKind, 'closed');
  late(); await new Promise(function (r) { setTimeout(r, 0); });
  H.eq(W.log.get(e.id).pos, null, 'a late answer is not applied by a closed window');
  let m = ''; try { W.record('clock.in', 'q', { empId: 'q', at: T }); } catch (x) { m = x.message; } H.ok(/read-only/.test(m));
  H.eq(makeStation({ id: 'cl', now: now, persist: store }).readOnly, false, 'the lease was released');
});

H.section('20h · the hub is the authority: enrolment, replacement, revocation, and a cloned tablet');
H.test('an operator revokes a lost tablet: its facts stay served, it can send nothing more, the hub alerts once, and its own selfCheck says why', function () {
  const alerts = []; const hub = makeHub({ notify: function (a) { alerts.push(a.kind); } }); const A = att('lost', hub), B = att('peer', hub);
  const e = A.record('clock.in', 'p', { empId: 'p', at: T }); H.eq(hub.revoke('lost'), 1);
  T += 1; const x = A.record('clock.out', 'p', { empId: 'p', at: T }); H.eq(x.pos, null); H.ok(/revoked/.test(A.lastCommit.hubRefused || ''));
  T += 1; A.record('clock.in', 'q', { empId: 'q', at: T }); H.eq(alerts.filter(function (k) { return k === 'revoked-use'; }).length, 1, 'alerted once');
  H.ok(has(A.selfCheck().problems, /revoked/));
  sync.home(B, hub); H.ok(B.log.has(e.id), 'its facts stay served'); H.deepEq(hub.watch().revoked, ['lost']); H.eq(sync.pull(A, hub).ok, false);
});
H.test('a replacement tablet takes over the station id: enrolling it revokes the old device in the same save, and its history comes home from the hub', function () {
  const hub = makeHub(); const old = att('till', hub); const e = old.record('clock.in', 'p', { empId: 'p', at: T });
  const token = hub.enroll('till', { by: 'owner' }); const R = makeStation({ id: 'till', now: now }); R.setAccess(token); sync.attach(R, hub);
  const p = sync.pull(R, hub); H.eq(p.adopted, 1); H.ok(R.log.has(e.id));
  T += 1; H.ok(R.record('clock.out', 'p', { empId: 'p', at: T }).pos > 0); T += 1; old.record('clock.in', 'z', { empId: 'z', at: T }); H.ok(/revoked/.test(old.lastCommit.hubRefused || ''));
});
H.test('a cloned tablet (an imaged copy with the same access) is just that tablet: both keep working, every fact is admitted once, each text goes out once from the copy that recorded it, and each copy lists the other texts for an operator', function () {
  const hub = makeHub(); const P = fxStore(); const fired = [];
  const A = makeStation({ id: 'twin', now: now, persist: P, onEffect: function (fx, e) { fired.push('A:' + e.id); } }); sync.attach(A, hub);
  const B = makeStation({ id: 'twin', now: now, persist: fxStore(cloneStore(P)), onEffect: function (fx, e) { fired.push('B:' + e.id); } }); sync.attach(B, hub);
  const a = A.record('test.text', 'c1', {}); T += 1; const b = B.record('test.text', 'c2', {});
  homeAll(hub, [A, B]); H.eq(hub.head, 2); H.eq(A.readOnly || B.readOnly, false);
  H.deepEq(fired.slice().sort(), ['A:' + a.id, 'B:' + b.id].sort(), 'each text once, from the copy that recorded it');
  H.eq(A.effectsFailed.length, 1); H.eq(B.effectsFailed.length, 1); H.deepEq(A.project('testagg'), B.project('testagg'));
});

H.section('20i · the last paths the logic map asked for');
H.test('a pull that cannot reach the hub, that the hub refuses, or that gets garbage back fails, is logged, and moves nothing', function () {
  const hub = makeHub(); const A = att('pf', hub); A.record('clock.in', 'p', { empId: 'p', at: T }); const n = A.log.all().length, c = A.cursor;
  let r = sync.pull(A, { pull: function () { throw new Error('ECONNRESET'); } }); H.eq(r.ok, false); H.ok(/ECONNRESET/.test(r.error));
  r = sync.pull(A, { pull: function () { return 'garbage'; } }); H.eq(r.ok, false); H.ok(/malformed/.test(r.error));
  const B = makeStation({ id: 'pf2', now: now }); r = sync.pull(B, hub); H.eq(r.ok, false); H.ok(/not enrolled/.test(r.error));
  H.eq(A.log.all().length, n); H.eq(A.cursor, c); H.ok(A.failures.filter(function (f) { return f.kind === 'pull'; }).length >= 2);
});
H.test('a fact altered on its way to a station is refused at ingest, and a type this station does not know yet is refused and noted; the intact copy is taken when it comes', function () {
  const hub = makeHub(); const A = att('ia', hub), B = att('ib', hub); const e = A.record('clock.in', 'p', { empId: 'p', at: T });
  const bad = hub.changesSince(0)[0]; bad.payload.empId = 'mallory';
  H.eq(B.ingest([bad]).refused, 1); H.eq(B.log.has(e.id), false);
  const unknown = EV.makeEvent({ type: 'future.thing', aggregate: 'future', key: 'k', payload: {}, hlc: { t: T + 1, c: 0, id: 'ia' }, station: 'ia', at: T + 1 });
  H.eq(B.ingest([unknown]).refused, 1); H.ok(B.failures.some(function (f) { return f.kind === 'ingest-refused' && /needs the update/.test(f.reason); }));
  sync.pull(B, hub); H.ok(B.log.has(e.id)); H.eq(B.log.get(e.id).payload.empId, 'p');
});
H.test('a hub store that cannot be read witnesses nothing, overwrites nothing, names no epoch, enrolls nobody, and says so', function () {
  const alerts = []; let wrote = 0; const P = { load: function () { throw new Error('EIO'); }, save: function () { wrote++; } };
  const hub = makeHub({ persist: P, notify: function (a) { alerts.push(a.kind); } }); H.eq(hub.epoch, null); H.ok(alerts.indexOf('store-unreadable') >= 0);
  H.eq(hub.enroll('x'), null, 'no device can be enrolled'); H.ok(/cannot read its store/.test(hub.receive({ station: 'x', token: 't', events: [] }).refused)); H.eq(wrote, 0, 'nothing overwritten');
});

/* ------------------------------------------------------------------------------------------------ */
/* §21 — THE HUB'S DATABASE (2026-09-23). Owner: "are we on v2 with SQL?" node:sqlite behind the hub's
   two-call store: one transaction per save, a UNIQUE id, quarantine instead of delete, and an exclusive
   file lock that closes the logic map's one declared hole (two hub processes on one store).            */
H.section('21 · the hub\'s database: node:sqlite, one transaction per save, one hub per store');
const { openSqliteStore } = require('../hub/sqlite-store');
const fs21 = require('fs'), os21 = require('os'), path21 = require('path'), cp21 = require('child_process');
function dbFile(tag) { return path21.join(os21.tmpdir(), 'custompos-' + tag + '-' + process.pid + '-' + Date.now() + '.db'); }
function rmDb(f) { ['', '-journal', '-wal', '-shm'].forEach(function (s) { try { fs21.unlinkSync(f + s); } catch (e) {} }); try { fs21.rmSync(f + '.services', { recursive: true, force: true }); } catch (e) {} }   // the hub's own station's journal (hub/services.js)

H.test('the sqlite store: a hub on a database file is the SAME witness after a restart', function () {
  const f = dbFile('restart'); let s1 = null, s2 = null;
  try {
    s1 = openSqliteStore(f); const hub1 = makeHub({ persist: s1 }); const a = att('a', hub1);
    a.record('clock.in', 'p', { empId: 'p', at: T }); a.record('clock.out', 'p', { empId: 'p', at: T + HOUR });
    H.eq(hub1.master.length, 2); const ep = hub1.epoch; s1.close(); s1 = null;
    s2 = openSqliteStore(f); const hub2 = makeHub({ persist: s2 });
    H.eq(hub2.epoch, ep, 'same identity'); H.eq(hub2.head, 2); H.eq(hub2.master.length, 2); H.eq(hub2.alerts.length, 0, 'a clean boot raises nothing');
    sync.attach(a, hub2); H.ok(a.commit('again').nothingOwed, 'nothing owed to the same witness');
  } finally { if (s1) s1.close(); if (s2) s2.close(); rmDb(f); }
});
H.test('a second hub process on the same database refuses to start (the split-hub hole, closed)', function () {
  const f = dbFile('split'); let s1 = null, s3 = null;
  try {
    s1 = openSqliteStore(f); const hub1 = makeHub({ persist: s1 }); att('a', hub1).record('clock.in', 'p', { empId: 'p', at: T });
    let msg = ''; try { openSqliteStore(f); } catch (e) { msg = String(e.message); }
    H.ok(/another hub process holds this store/.test(msg), 'a second open in this process is refused: ' + msg);
    const code = 'try{ require(' + JSON.stringify(path21.join(__dirname, '..', 'hub', 'sqlite-store.js')) + ').openSqliteStore(' + JSON.stringify(f) + '); console.log("OPENED"); }catch(e){ console.log(String(e.message)); process.exit(3); }';
    const r = cp21.spawnSync(process.execPath, ['-e', code], { encoding: 'utf8', timeout: 20000 });
    H.eq(r.status, 3, 'the other process exits refused (' + String(r.stdout).trim() + ')'); H.ok(/another hub process holds this store/.test(r.stdout), 'and says why');
    H.eq(hub1.master.length, 1, 'the first hub is untouched');
    s1.close(); s1 = null; s3 = openSqliteStore(f); const hub3 = makeHub({ persist: s3 }); H.eq(hub3.head, 1, 'once the first hub stops, a restart opens the same store');
  } finally { if (s1) s1.close(); if (s3) s3.close(); rmDb(f); }
});
H.test('the sqlite store: a save that fails part-way leaves nothing behind, and the retry lands once', function () {
  const f = dbFile('rollback'); let failNext = false, s1 = null, s2 = null;
  try {
    s1 = openSqliteStore(f, { beforeCommit: function () { if (failNext) { failNext = false; throw new Error('disk went away mid-commit'); } } });
    const hub = makeHub({ persist: s1 }); const a = att('a', hub);
    failNext = true; a.record('clock.in', 'p', { empId: 'p', at: T });
    H.eq(hub.master.length, 0, 'nothing witnessed from a failed save'); H.ok(/disk went away/.test(String(hub.persistError)));
    const c = a.commit('retry'); H.eq(hub.master.length, 1, 'the retry lands'); H.ok(!c.nothingOwed || hub.master.length === 1);
    s1.close(); s1 = null; s2 = openSqliteStore(f); const hub2 = makeHub({ persist: s2 });
    H.eq(hub2.master.length, 1, 'exactly once on disk'); H.eq(hub2.alerts.length, 0);
  } finally { if (s1) s1.close(); if (s2) s2.close(); rmDb(f); }
});
H.test('the sqlite store: the database itself refuses a second copy of a fact', function () {
  const f = dbFile('unique'); let s1 = null;
  try {
    s1 = openSqliteStore(f); const hub = makeHub({ persist: s1 }); att('a', hub).record('clock.in', 'p', { empId: 'p', at: T });
    const snap = { epoch: hub.epoch, head: 2, master: hub.master.concat([Object.assign(hub.master[0], { pos: 2 })]), devices: [], cursors: [], alerts: [], alertKeys: [] };
    let threw = false; try { s1.save(snap); } catch (e) { threw = /UNIQUE/i.test(String(e.message)); }
    H.eq(threw, true, 'UNIQUE id refused it'); s1.close(); s1 = openSqliteStore(f); H.eq(s1.load().master.length, 1, 'and the refused save left nothing');
  } finally { if (s1) s1.close(); rmDb(f); }
});
H.test('the sqlite store: a row altered at rest is quarantined and KEPT, and the next boot is clean', function () {
  const f = dbFile('tamper'); let s1 = null, s2 = null, s3 = null;
  try {
    s1 = openSqliteStore(f); const hub1 = makeHub({ persist: s1 }); const a = att('a', hub1);
    a.record('clock.in', 'p', { empId: 'p', at: T }); a.record('clock.out', 'p', { empId: 'p', at: T + HOUR }); s1.close(); s1 = null;
    const { DatabaseSync } = require('node:sqlite'); const raw = new DatabaseSync(f);
    const r = raw.prepare('SELECT pos, body FROM events WHERE pos = 2').get(); const b = JSON.parse(r.body); b.payload.at = T + 9 * HOUR;
    raw.prepare('UPDATE events SET body = ? WHERE pos = 2').run(JSON.stringify(b)); raw.close();
    s2 = openSqliteStore(f); const hub2 = makeHub({ persist: s2 });
    H.ok(hub2.alerts.some(function (x) { return x.kind === 'store-inconsistent'; }), 'the altered row is noticed'); H.eq(hub2.master.length, 1);
    H.eq(s2.quarantined().length, 1, 'the evidence is kept'); H.eq(s2.quarantined()[0].pos, 2); const ep2 = hub2.epoch; s2.close(); s2 = null;
    s3 = openSqliteStore(f); const hub3 = makeHub({ persist: s3 });
    H.eq(hub3.epoch, ep2, 'the next boot keeps that identity'); H.eq(hub3.watch().quarantinedRows, 0, 'and finds nothing new to quarantine');
    sync.attach(a, hub3); sync.home(a, hub3); H.eq(hub3.master.length, 2, 'the station re-offers what the hub lost');
  } finally { if (s1) s1.close(); if (s2) s2.close(); if (s3) s3.close(); rmDb(f); }
});

/* ------------------------------------------------------------------------------------------------ */
/* §23 — THE BROWSER STORE (2026-09-23). A tablet's journal in IndexedDB behind the synchronous persist interface:
   read once into a mirror, written in ONE ordered queue, retried in order when the disk refuses, and a tab lease
   in localStorage whose generation catches a stale copy.                                                  */
H.section('23 · the browser store: IndexedDB behind the station, in order, never stale');
const { openBrowserStore } = require('../store/browser');
const { fakeIDB, fakeLocalStorage } = require('./fake-idb');
function w23(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

H.testAsync('the browser store: facts, echoes, the cursor mark, the access and the texts-sent record all survive a reload', async function () {
  const IDB = fakeIDB(), LS = fakeLocalStorage();
  const P1 = await openBrowserStore('bs1', { indexedDB: IDB, localStorage: LS });
  const hub = makeHub(); const S = makeStation({ id: 'bs1', now: now, persist: P1 }); sync.attach(S, hub);
  const e = S.record('clock.in', 'p', { empId: 'p', at: T });
  const O = att('bso', hub); O.record('clock.in', 'q', { empId: 'q', at: T + 1 });
  sync.pull(S, hub); H.eq(S.cursor, 2);
  await P1.whenWritten(); H.eq(P1.health().pending, 0); H.eq(P1.health().lastError, null);
  S.close(); P1.close();                                           // the page goes away (pagehide)
  const P2 = await openBrowserStore('bs1', { indexedDB: IDB, localStorage: LS });
  const S2 = makeStation({ id: 'bs1', now: now, persist: P2 });
  H.eq(S2.readOnly, false, 'the reloaded page is the writer'); H.eq(S2.log.size(), 2); H.eq(S2.log.get(e.id).pos, 1, 'the echo survived');
  H.eq(S2.cursor, 2, 'the cursor mark survived'); H.eq(S2.epoch, hub.epoch); H.eq(S2.accessToken, S.accessToken, 'and the access');
  S2.close(); P2.close();
});
H.testAsync('the browser store: when the disk refuses, later rows wait behind the refused ones; nothing is lost or reordered, and the tablet says it is behind', async function () {
  const IDB = fakeIDB(), LS = fakeLocalStorage();
  const P = await openBrowserStore('bs2', { indexedDB: IDB, localStorage: LS }); const S = makeStation({ id: 'bs2', now: now, persist: P });
  IDB.ctl.failTx = 2;
  const e1 = S.record('clock.in', 'a', { empId: 'a', at: T }), e2 = S.record('clock.in', 'b', { empId: 'b', at: T + 1 });
  await w23(30); H.ok(P.health().lastError && /full/.test(P.health().lastError), 'the store knows it is behind: ' + P.health().lastError);
  const e3 = S.record('clock.in', 'c', { empId: 'c', at: T + 2 });   // refused by the store while behind → held in the log's own queue
  H.eq(S.selfCheck().persistDirty, true, 'the tablet says so'); H.eq(S.log.size(), 3, 'and the fact is not lost in memory');
  await P.whenWritten(); H.eq(P.health().lastError, null, 'the disk came back');
  S.log.flush(); await P.whenWritten();
  const onDisk = IDB.rows('custompos-bs2', 'journal').filter(function (r) { return r.ev; }).map(function (r) { return r.ev.id; });
  H.deepEq(onDisk, [e1.id, e2.id, e3.id], 'every fact on disk, in the order it was recorded');
  S.close(); P.close();
  const P2 = await openBrowserStore('bs2', { indexedDB: IDB, localStorage: LS }); const S2 = makeStation({ id: 'bs2', now: now, persist: P2 });
  H.eq(S2.log.size(), 3); H.eq(S2.log.quarantined, 0, 'nothing torn'); S2.close(); P2.close();
});
H.testAsync('the browser store: a second tab on the same tablet opens read-only (the lease lives in localStorage, shared by every tab)', async function () {
  const IDB = fakeIDB(), LS = fakeLocalStorage();
  const P1 = await openBrowserStore('bs3', { indexedDB: IDB, localStorage: LS }); const S1 = makeStation({ id: 'bs3', now: now, persist: P1 });
  const P2 = await openBrowserStore('bs3', { indexedDB: IDB, localStorage: LS }); const S2 = makeStation({ id: 'bs3', now: now, persist: P2 });
  H.eq(S1.readOnly, false); H.eq(S2.readOnly, true, 'the second tab is read-only'); H.eq(S2.haltKind, 'lease');
  let m = ''; try { S2.record('clock.in', 'p', { empId: 'p', at: T }); } catch (x) { m = x.message; } H.ok(/read-only/.test(m), 'and cannot write');
  S1.close(); S2.close(); P1.close(); P2.close();
});
H.testAsync('the browser store: a tab whose lease another tab held meanwhile cannot re-read its stale copy; it stays read-only rather than write over the other tab', async function () {
  const IDB = fakeIDB(), LS = fakeLocalStorage();
  const P1 = await openBrowserStore('bs4', { indexedDB: IDB, localStorage: LS }); const realMono = function () { return Date.now(); };   /* the lease must lapse on a REAL clock: the tests freeze T */
  const S1 = makeStation({ id: 'bs4', now: now, mono: realMono, persist: P1, leaseMs: 60 });
  S1.record('clock.in', 'a', { empId: 'a', at: T }); await P1.whenWritten();
  await w23(90);                                                   // tab 1 sleeps past its lease
  const P2 = await openBrowserStore('bs4', { indexedDB: IDB, localStorage: LS }); const S2 = makeStation({ id: 'bs4', now: now, mono: realMono, persist: P2, leaseMs: 60 });
  H.eq(S2.readOnly, false, 'tab 2 took the lapsed lease'); S2.record('clock.in', 'b', { empId: 'b', at: T + 1 }); await P2.whenWritten();
  S2.close(); P2.close();                                          // ...and let go
  let m = ''; try { S1.record('clock.in', 'c', { empId: 'c', at: T + 2 }); } catch (x) { m = x.message; }
  H.eq(S1.readOnly, true, 'tab 1 does not write on its stale copy'); H.ok(/read-only/.test(m), m);
  H.ok(S1.failures.some(function (f) { return /reload this page|could not be read/.test(String(f.error || f.note || '')); }), 'and says why');
  const P3 = await openBrowserStore('bs4', { indexedDB: IDB, localStorage: LS }); const S3 = makeStation({ id: 'bs4', now: now, persist: P3 });
  H.eq(S3.log.size(), 2, 'a reload sees both tabs\' facts'); S1.close(); S3.close(); P1.close(); P3.close();
});
H.testAsync('the browser store: a store that cannot be opened is reported, never replaced by an empty one', async function () {
  const IDB = fakeIDB(); IDB.ctl.openError = 'UnknownError: the disk went away';
  let m = ''; try { await openBrowserStore('bs5', { indexedDB: IDB, localStorage: fakeLocalStorage() }); } catch (e) { m = String(e.message); }
  H.ok(/could not be opened/.test(m) && /nothing was replaced/.test(m), m);
  let m2 = ''; try { await openBrowserStore('bs5', { indexedDB: null, localStorage: null }); } catch (e) { m2 = String(e.message); }
  H.ok(/no IndexedDB/.test(m2) || /could not be opened/.test(m2), m2);
});

/* ------------------------------------------------------------------------------------------------ */
const shim = require('../station/crypto-shim');
const nodeCrypto = require('crypto');
H.test('the browser SHA-256 equals Node\'s byte for byte (ASCII, accents, emoji, long text) — the hub verifies every fact by it', function () {
  ['', 'abc', 'clock.in Someone', 'Café ñandú — 12½', '🧵 Out to Alterations 📅', 'x'.repeat(5000), 'multi\nline\ttext'].forEach(function (s) {
    H.eq(shim.createHash('sha256').update(s, 'utf8').digest('hex'), nodeCrypto.createHash('sha256').update(s, 'utf8').digest('hex'), JSON.stringify(s.slice(0, 20)));
  });
});
/* ── exported by the v2 exporter: the private suite's engine laws (sections 1–21, 23, and 31's first proof) end here; the
   shop's own sections follow in the private suite. */
H.done();
