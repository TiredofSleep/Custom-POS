'use strict';
/* ============================================================================
 * INCFOLD — a fold kept up to date one fact at a time, so a tap costs the same in year five as on day one (2026-09-26)
 * @fold @fact — each aggregate's fold split into init / step / view; the running state kept; a late fact replayed from a checkpoint
 * ----------------------------------------------------------------------------
 * Owner, 9/26: "i want it to always be about the same, i never want sticky or data overhead to be available as an issue."
 * Measured before (tools/perf-scale.js, this PC): every new fact re-folded ALL history — 0.24 s at a year of the shop, 1.5 s
 * at five, and more on a counter PC or a phone.
 *
 * THE CONTRACT an aggregate signs — registry.registerAggregate(AGG, { fold, inc: { … } }):
 *   inc.accepts(e)   the facts its fold reads (default: its own aggregate's, e.aggregate === AGG)
 *   inc.order        'hlc' — the fold sorts them by hlc.compareEvents (the default); 'arrival' — it reads them in log order
 *   inc.init()       a fresh state: plain data only (objects, arrays, Maps, Sets, numbers, strings, booleans, null) — no
 *                    functions, no class instances — so structuredClone copies it whole (the checkpoints)
 *   inc.step(s, e)   one fact into the state; it reads nothing but s and e (never the list of facts, never the clock)
 *   inc.view(s)      what fold() returns, worked out from the state. It may be called any number of times between steps and
 *                    never changes anything a later step reads (it may write derived fields idempotently: the same state, the
 *                    same writes). Its records may be the state's own objects: a caller reads them, never keeps them past the
 *                    next fact, never changes them.
 *   and the aggregate's fold(events) returns foldVia(inc, events, AGG): the full fold IS init + every step + view, so the
 *   incremental answer and the full answer are one code path and cannot drift apart.
 *
 * THE ENGINE (makeInc): facts arrive in any order, in any batches. A batch that sorts after everything held is one step
 * per fact. A fact that sorts earlier — a peer's fact arriving late, a tablet back from a day offline — is put in its place
 * and the state rebuilt from the newest checkpoint at or before it: a copy of the state kept every `every` facts (the
 * newest `keep` of them). Earlier than every kept checkpoint: rebuilt from the start — a whole fold, as before: rare, and
 * still right. The view is worked out once per change and handed to everyone until the next.
 * 9/26, after the five builders measured it (the copy is the cost — 1.1 s of money's state at five years):
 *   · a checkpoint the same feed would push out is never copied: loading five years makes the last `keep` copies, not 98;
 *   · a late fact TAKES the checkpoint it restores (no copy on the tap path) and its place is filled later: synchronously
 *     once `every` facts have passed (the hub), or — lazy: true, the tablet — when the screen is idle (maintain()), with a
 *     synchronous copy only if idle never comes for 4 × every facts;
 *   · the copy keeps each object's null prototype (structuredClone drops it, so a replayed state read an id like
 *     'constructor' differently from a fresh fold) and every shared reference.
 * ========================================================================== */
const hlc = require('./hlc');

const CHECKPOINT_EVERY = 1000, KEEP = 6;

/* @fold — a copy of a state for a checkpoint: Maps, Sets, arrays and plain objects, each object's prototype (null or Object's)
   kept, a shared object copied once and shared again (an order in both a list and a bay's set stays one order) */
function cloneState(s) {
  const seen = new Map();
  const c = function (x) {
    if (x === null || typeof x !== 'object') return x;
    const had = seen.get(x); if (had !== undefined) return had;
    let out;
    if (Array.isArray(x)) { out = new Array(x.length); seen.set(x, out); for (let i = 0; i < x.length; i++) out[i] = c(x[i]); return out; }
    if (x instanceof Map) { out = new Map(); seen.set(x, out); x.forEach(function (v, k) { out.set(c(k), c(v)); }); return out; }
    if (x instanceof Set) { out = new Set(); seen.set(x, out); x.forEach(function (v) { out.add(c(v)); }); return out; }
    if (x instanceof Date) { out = new Date(x.getTime()); seen.set(x, out); return out; }
    out = Object.getPrototypeOf(x) === null ? Object.create(null) : {}; seen.set(x, out);
    const ks = Object.keys(x); for (let i = 0; i < ks.length; i++) out[ks[i]] = c(x[ks[i]]);
    return out;
  };
  return c(s);
}
/* @fold @fact — the facts an aggregate's fold reads: its own declaration, else its own aggregate's */
function acceptsOf(inc, agg) { return typeof inc.accepts === 'function' ? inc.accepts : function (e) { return !!e && e.aggregate === agg; }; }
/* @fold — the full fold through the contract: the accepted facts in the fold's order, init, every step, view (an aggregate's fold() returns this) */
function foldVia(inc, events, agg) {
  const acc = acceptsOf(inc, agg), list = (events || []).filter(function (e) { return acc(e); });
  const sorted = inc.order === 'arrival' ? list : list.slice().sort(hlc.compareEvents);
  const s = inc.init();
  for (let i = 0; i < sorted.length; i++) inc.step(s, sorted[i]);
  return inc.view(s);
}
/* @fold — the first place in a sorted list where a fact sorting after e sits (binary search on hlc.compareEvents) */
function placeOf(list, e) {
  let lo = 0, hi = list.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (hlc.compareEvents(list[mid], e) <= 0) lo = mid + 1; else hi = mid; }
  return lo;
}
/* @fold @fact — one aggregate's fold kept up to date: feed(facts) takes new facts in any order, view() answers what fold() would
   over every fact fed so far. o: {every, keep (checkpoint spacing and how many are kept), lazy (true: never copy on the tap
   path — maintain() makes the checkpoints when the screen is idle; a late fact with none left rebuilds from the start, which
   is what every fact cost before)} */
function makeInc(inc, agg, o) {
  o = o || {};
  const every = Math.max(1, o.every || CHECKPOINT_EVERY), keep = Math.max(1, o.keep || KEEP), lazy = !!o.lazy, acc = acceptsOf(inc, agg), byHlc = inc.order !== 'arrival';
  let facts = [], state = inc.init(), cps = [], memo = null, lastCp = 0;
  const seen = new Set();
  const stats = { steps: 0, appended: 0, replays: 0, rebuilds: 0, checkpoints: 0 };
  /* @fold — a copy of the live state as the newest checkpoint (the oldest beyond `keep` let go) */
  function snap(n) { cps.push({ n: n, s: cloneState(state) }); lastCp = n; stats.checkpoints++; while (cps.length > keep) cps.shift(); }
  /* @fold — after stepping to `count` of `finalLen`: a checkpoint only when one is due AND this same feed would not push it out
     again (loading five years copies the last `keep`, never the 98 before them); never on a lazy tablet's tap path */
  function maybeSnap(count, finalLen) {
    if (lazy || count - lastCp < every) return;
    if (finalLen - count >= every * keep) return;
    snap(count);
  }
  /* @fold — one fact stepped onto the end */
  function append(e, finalLen) { facts.push(e); inc.step(state, e); stats.steps++; stats.appended++; maybeSnap(facts.length, finalLen); }
  /* @fold — the state rebuilt for facts[from..]: the newest checkpoint at or before `from` is TAKEN as the live state (no copy on
     this path; its place is filled later), else the state starts again from nothing */
  function replayFrom(from) {
    let ci = -1; for (let i = cps.length - 1; i >= 0; i--) if (cps[i].n <= from) { ci = i; break; }
    let start = 0;
    if (ci >= 0) { const c = cps[ci]; state = c.s; start = c.n; cps = cps.slice(0, ci); stats.replays++; }
    else { state = inc.init(); cps = []; stats.rebuilds++; }
    lastCp = cps.length ? cps[cps.length - 1].n : 0;
    const finalLen = facts.length;
    for (let i = start; i < finalLen; i++) { inc.step(state, facts[i]); stats.steps++; maybeSnap(i + 1, finalLen); }
  }
  /* @fold @fact — new facts in: those this fold reads, once each by id; one step each when they come after everything held, else put in place and replayed */
  function feed(list) {
    const mine = [];
    for (let i = 0; i < (list || []).length; i++) { const e = list[i]; if (acc(e) && !seen.has(e.id)) { seen.add(e.id); mine.push(e); } }
    if (!mine.length) return 0;
    memo = null;
    const finalLen = facts.length + mine.length;
    if (!byHlc) { mine.forEach(function (e) { append(e, finalLen); }); return mine.length; }
    mine.sort(hlc.compareEvents);
    const last = facts[facts.length - 1];
    if (!last || hlc.compareEvents(last, mine[0]) <= 0) { mine.forEach(function (e) { append(e, finalLen); }); return mine.length; }
    const from = placeOf(facts, mine[0]), tail = facts.slice(from), merged = [];
    let a = 0, b = 0;
    while (a < tail.length || b < mine.length) { if (b >= mine.length || (a < tail.length && hlc.compareEvents(tail[a], mine[b]) <= 0)) merged.push(tail[a++]); else merged.push(mine[b++]); }
    facts = facts.slice(0, from).concat(merged);
    replayFrom(from);
    return mine.length;
  }
  /* @fold — the idle moment's work (the tablet calls it when the screen is quiet): a checkpoint of the live state when none is
     kept, or when `every` facts have passed since the newest. Returns whether it copied. */
  function maintain() { if (!facts.length || (cps.length && facts.length - lastCp < every)) return false; snap(facts.length); return true; }
  /* @fold — what fold() would answer over every fact fed so far; worked out once per change */
  function view() { if (!memo) memo = { v: inc.view(state) }; return memo.v; }
  /* @fold — start again with nothing held (the log it followed was replaced) */
  function reset() { facts = []; state = inc.init(); cps = []; memo = null; lastCp = 0; seen.clear(); }
  /* @fold — how many checkpoints are held right now (10/18, tools/tablet-mem.js: what a follower's memory is, counted — never more than `keep`) */
  function held() { return cps.length; }
  return { feed: feed, view: view, reset: reset, maintain: maintain, held: held, size: function () { return facts.length; }, stats: stats };
}
/* @fold @fact — a log followed one fact at a time: each call feeds only what the log gained since the last (a replaced log starts
   over). log: {size(), since(n)} (core/log.js) or anything with all(); returns the fold's answer now. The function carries
   maintain() (the idle moment's checkpoint), held() (the checkpoints it holds now) and stats. */
function follower(inc, agg, o) {
  const m = makeInc(inc, agg, o); let followed = null, n = 0;
  const f = function (log) {
    if (log !== followed) { m.reset(); followed = log; n = 0; }
    const size = log ? (typeof log.size === 'function' ? log.size() : log.all().length) : 0;
    if (size < n) { m.reset(); n = 0; }
    if (size > n) { m.feed(typeof log.since === 'function' ? log.since(n) : log.all().slice(n)); n = size; }
    return m.view();
  };
  f.maintain = m.maintain; f.stats = m.stats; f.held = m.held;
  return f;
}

module.exports = { foldVia: foldVia, makeInc: makeInc, follower: follower, placeOf: placeOf, cloneState: cloneState, CHECKPOINT_EVERY: CHECKPOINT_EVERY, KEEP: KEEP };
