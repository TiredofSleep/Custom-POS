'use strict';
/* =====================================================================================================================
 * §994 · 10/31 — THE SHARED STATION FILES: station/record.js and station/views.js
 * Owner, 10/31: "the point is for all the systems to grow stronger together... and to be sure that what i am sharing with people is
 * functional because i use it daily." The door for a fact (put), a kit's onSave (saver) and the folds every screen reads (make) moved
 * out of station/app.js into their own files, which Custom POS imports unedited. These proofs pin what those files promise to whoever
 * uses them: through the files themselves, and through the station's own rec() and saveAs() cut from station/app.js as it ships.
 * station/views.js also runs under §458, §606, §608 and §910: their pages load it.
 * 11/1 (rollout step 3): the laws come first and need nothing but the harness and the shared files, so the exporter ships them as they
 * are (up to the marker "THE SHOP'S OWN"); the proof that cuts station/app.js, which never ships, comes after it.
 * ===================================================================================================================== */
const H = require('../harness');
const fs = require('fs'), path = require('path'), vm = require('vm');
const { makeStation } = require('../../core/station');
const TC994 = require('../../aggregates/timeclock');
const R994 = require('../../station/record');
const VWN994 = require('../../station/views');   /* the same file under Node, beside the bare page's copy below */
const VIEWS994 = path.join(__dirname, '..', '..', 'station', 'views.js');

/* @proof — a station of its own for one proof, on the shop's clock */
function station994(id) { return makeStation({ id: id, now: Date.now }); }
/* @proof — a clock-in fact for a save: its type, key and payload (a minute apart per n, so no two are the same) */
function punch994(emp, n) { return { type: 'clock.in', key: emp, payload: { empId: emp, at: Date.now() + (n || 0) * 60000 } }; }
/* @proof — a door that writes down every call [type, key, actor] and refuses the types listed: { rec, calls } */
function door994(refuse) { const calls = []; return { calls: calls, rec: function (t, k, p, a) { calls.push([t, k, a]); return (refuse || []).indexOf(t) < 0; } }; }
/* @proof — three facts for a save, the middle one of a type a door may refuse */
function three994() { return [{ type: 'a.one', key: 'k1', payload: {} }, { type: 'b.two', key: 'k2', payload: {} }, { type: 'a.three', key: 'k3', payload: {} }]; }
/* @proof — station/views.js (or a changed copy of its text) run in a bare page that has nothing but what make() is handed (no timers, no console, no storage) */
function bareViews994(text) { const m = { exports: {} }, ctx = {}; vm.createContext(ctx); vm.runInContext('(function (module, exports) {' + (text || fs.readFileSync(VIEWS994, 'utf8')) + '\n})', ctx)(m, m.exports); return m.exports; }

H.section('994 · 10/31 — THE SHARED STATION FILES: the door for a fact (station/record.js put), a kit\'s onSave (saver) and the folds every screen reads (station/views.js make), moved out of station/app.js unchanged and imported by Custom POS — what they promise, through themselves and through the station\'s own rec() and saveAs()');

H.test('put: a fact goes on the station\'s log under the person named; a refused one is said through refused() and answers false, never a throw, and nothing lands; no person named, no actor — negative control: the station itself throws on that fact', function () {
  const S = station994('s994a'), said = [], say = function (m) { said.push(m); };
  H.ok(R994.put(S, 'clock.in', 'e994', punch994('e994').payload, 'e994', say), 'recorded');
  const e = S.log.all()[S.log.size() - 1];
  H.ok(e.type === 'clock.in' && e.actor === 'e994', 'on the log, under the person named');
  const n = S.log.size();
  H.eq(R994.put(S, 'nope.994', 'x', {}, 'e994', say), false, 'an unknown type answers false');
  H.ok(said.length === 1 && /unknown event type/.test(said[0]) && S.log.size() === n, 'said through refused(), and nothing landed: ' + said[0]);
  H.ok(R994.put(S, 'clock.in', 'e995', punch994('e995', 1).payload, null) && S.log.all()[S.log.size() - 1].actor == null, 'no person named: no actor on the fact');
  let threw = false; try { S.record('nope.994', 'x', {}); } catch (err) { threw = true; }
  H.ok(threw, 'negative control: the station throws on that fact — put is what keeps a tablet going');
});

H.test('saver: who() names the person ONCE per save and every fact goes through the door under them, then one sync; the order is before, the facts, then, the sync, after; without ok there is no answer — negative control: asking per fact asks three times', function () {
  const d = door994(), seq = []; let asked = 0, synced = 0;
  const save = R994.saver(function (t, k, p, a) { seq.push('fact ' + k); return d.rec(t, k, p, a); }, function () { synced++; seq.push('sync'); }, function () { asked++; return 'e994'; },
    { before: function (f) { seq.push('before ' + f.length); }, then: function () { seq.push('then'); }, after: function () { seq.push('after'); } });
  const ans = save(three994());
  H.eq(asked, 1, 'the person is asked once');
  H.deepEq(d.calls.map(function (c) { return c[2]; }), ['e994', 'e994', 'e994'], 'every fact under them');
  H.eq(synced, 1, 'one sync');
  H.deepEq(seq, ['before 3', 'fact k1', 'fact k2', 'fact k3', 'then', 'sync', 'after'], 'in that order');
  H.eq(ans, undefined, 'no answer without ok, as the kits that never read one');
  const perFactSaver = function (rec, sync, who2) { return function (facts) { facts.forEach(function (f) { rec(f.type, f.key, f.payload, who2()); }); sync(); }; };
  let perFact = 0; perFactSaver(door994().rec, function () {}, function () { perFact++; return 'e994'; })(three994());
  H.eq(perFact, 3, 'negative control: a save that asks for each fact asks three times — the count above tells the two apart');
});

H.test('saver with stop and ok: after a refused fact the rest are not recorded (a card sale\'s facts go whole, or the kit raises its alarm), and the answer says whether every fact was recorded — negative controls: without stop the third fact is recorded; without ok there is nothing for an alarm to read', function () {
  const who = function () { return 'e994'; }, none = function () {};
  const d1 = door994(['b.two']), a1 = R994.saver(d1.rec, none, who, { stop: true, ok: true })(three994());
  H.ok(a1 === false && d1.calls.length === 2, 'stopped after the refused second fact, and answered false: ' + JSON.stringify(d1.calls));
  const d2 = door994(['b.two']), a2 = R994.saver(d2.rec, none, who, { ok: true })(three994());
  H.ok(a2 === false && d2.calls.length === 3, 'negative control: without stop the third fact is recorded (still answered false)');
  const d3 = door994();
  H.eq(R994.saver(d3.rec, none, who, { ok: true })(three994()), true, 'every fact recorded: true');
  const d4 = door994(['b.two']);
  H.eq(R994.saver(d4.rec, none, who)(three994()), undefined, 'negative control: without ok, nothing for an alarm to read');
});

H.test('views.make in a bare page with nothing but what it is handed: a fold is worked out once until the log grows; logFold hands its own top-level lists; memo(build) builds again only when a fact arrives — negative control: a log whose size never moves is never folded again, so the size is what the memo reads', function () {
  const VW = bareViews994(), S = station994('s994v'); let folds = 0, builds = 0;
  H.eq(Object.keys(VW).sort().join(' '), Object.keys(VWN994).sort().join(' '), 'the bare page\'s copy hands out what the file hands Node');
  const V2 = { timeclock: { AGG: TC994.AGG, fold: function (f) { folds++; return TC994.fold(f); } } };
  const v = VW.make({ V2: V2, log: function () { return S.log; } });
  S.record('clock.in', 'e994', punch994('e994').payload);
  v.foldOnce('timeclock'); v.foldOnce('timeclock');
  H.eq(folds, 1, 'folded once for two asks');
  const memo = v.memo(function () { builds++; return { list: [1, 2, 3] }; });
  const a = memo(); a.list.length = 0;
  H.eq(memo().list.length, 3, 'each answer has its own top-level lists: emptying one changes nobody else\'s');
  H.eq(builds, 1, 'built once for two asks');
  S.record('clock.in', 'e995', punch994('e995', 1).payload);
  memo(); v.foldOnce('timeclock');
  H.ok(builds === 2 && folds === 2, 'a new fact: built and folded once more');
  /* review 11/1: logFold's own promise, proven (this proof's title had claimed it while calling only foldOnce and memo) */
  const box = { box: { fold: function (f) { return { list: f.map(function (e) { return e.type; }) }; } } }, onLog = function () { return S.log; };
  const lf = VW.make({ V2: box, log: onLog }), l1 = lf.logFold('box'); l1.list.length = 0;
  H.ok(lf.logFold('box').list.length === 2, 'logFold hands each caller its own top-level lists: emptying one answer\'s list leaves the next answer whole');
  const FT = 'checkSay(); return freshTop(o); }', text = fs.readFileSync(VIEWS994, 'utf8');
  H.eq(text.split(FT).length, 2, 'the negative control\'s anchor is logFold\'s own line, found once');
  const sh = bareViews994(text.replace(FT, 'checkSay(); return o; }')).make({ V2: box, log: onLog }), s1 = sh.logFold('box'); s1.list.length = 0;
  H.eq(sh.logFold('box').list.length, 0, 'negative control: a logFold that hands out its memo lets one caller empty what every other caller reads');
  const stuck = { size: function () { return 7; }, all: function () { return S.log.all(); } };
  let sf = 0; const w = VW.make({ V2: { timeclock: { AGG: TC994.AGG, fold: function (f) { sf++; return TC994.fold(f); } } }, log: function () { return stuck; } });
  w.foldOnce('timeclock'); S.record('clock.in', 'e996', punch994('e996', 2).payload); w.foldOnce('timeclock');
  H.eq(sf, 1, 'negative control: a log whose size never moves is folded once and never again');
});

/* ── exported by the v2 exporter: the shared station files' laws end here; the shop's own proof follows in the private suite. */
H.done();
