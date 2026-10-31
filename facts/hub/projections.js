'use strict';
/* ============================================================================
 * PROJECTIONS — ONE READ MODEL ON THE HUB (2026-10-18, enterprise batch 2)
 * @hub @fold — one shared answer per aggregate, keyed by that aggregate's own head, followed one fact at a time and handed out frozen
 * ----------------------------------------------------------------------------
 * The 10/18 hub audit counted 13 memos and followers that each held their own copy of what the hub's facts fold to — the orders
 * up to five times over (the server's ready-text check, the card link, the automatic work, the tracking page, the archive watch,
 * the conflict check's follower), each worked out again from all history on a request or a timer. This is the one place they read
 * instead. A hub makes one (hub/hub.js) and hands its readers view(agg).
 *
 *   view(agg)     what aggregates/<agg>.js fold(hub.facts()) answers NOW — the same answer, canon for canon — worked out once per
 *                 move of that aggregate's own facts (src.head(agg), the hub's aggHead) and shared by every reader. It is READ-ONLY:
 *                 every object and list in it is frozen, and its Maps and Sets refuse set/add/delete/clear (a reader that tried to
 *                 change it throws instead of changing what every other reader sees). A reader may keep it as long as it likes: a
 *                 later fact never changes it — the next fact's view is a new object. Parts it shares with the facts are the facts'
 *                 own, frozen by the hub when it hands them out (hub.facts); nothing else is shared with anything that changes.
 *   live(agg)     the follower's own answer (core/incfold.js view(): the state's own records, changed by the next fact) — for the
 *                 hub's conflict check only, which copies each note it keeps; null for an aggregate this does not follow.
 *   follows(agg)  whether agg is followed one fact at a time: it carries inc, its fold reads only its own aggregate's facts (no
 *                 inc.accepts of its own) and its view hands out no function. Any other aggregate's view is its whole fold over
 *                 hub.facts() — keyed by its own head when it reads only its own facts, else by the hub's. A view that hands out a
 *                 function (the inbox's open(k)) closes over the state it was made from: a follower's state changes with the next
 *                 fact, a whole fold's never does — so such an aggregate is whole-folded, and its function answers as it always did.
 *   reset(agg)    start that aggregate again (a refused save took facts back out of its list); reset() starts every one again (a
 *                 new identity swapped the facts for copies — no follower may keep the old objects alive).
 *   stats()       per aggregate: views built, views handed out again, and whether it is followed (the proofs' count).
 *
 * src (the hub's own, hub/hub.js makeHub): log(agg) — a stable {size, since} over the aggregate's facts in arrival order;
 * follower(def, agg) — a follower with the hub's checkpoint policy (HUB_FOLLOW: one checkpoint); head(agg) — the aggregate's newest
 * position; headAll() — the hub's head; all() — every fact, frozen (hub.facts); freeze() — every fact frozen so far, without the
 * list, called before a follower steps them, so a view shares the facts' own parts instead of copying them.
 * ========================================================================== */
const registry = require('../core/registry');

const MAP_DOORS = ['set', 'delete', 'clear'], SET_DOORS = ['add', 'delete', 'clear'];

/* @hub @fold @error — what a shared read says to a reader that tried to change it: copy it first */
function refuseChange() { throw new TypeError('a shared read of the hub is read-only (hub/projections.js) — copy it before changing it'); }
/* @hub @fold — a Map or Set made read-only: its changing calls refuse (own, not enumerable — Object.keys and JSON never see them), then frozen */
function lockDoors(o, doors) { for (let i = 0; i < doors.length; i++) Object.defineProperty(o, doors[i], { value: refuseChange }); return Object.freeze(o); }
/* @hub @fold — a read-only copy of a fold's answer: every object, list, Map and Set copied once (a record in two lists stays one record;
   a null prototype stays null — incfold's cloneState rules) and frozen as it is made; a part ALREADY frozen — a fact's own payload, frozen
   by hub.facts — is the fact's and never changes, so it is shared, not copied (the copy costs what a whole fold costs, not twice it) */
function frozenCopy(v) {
  const seen = new Map();
  const c = function (x) {
    if (x === null || typeof x !== 'object') return x;
    const had = seen.get(x); if (had !== undefined) return had;
    let out;
    if (Array.isArray(x)) { if (Object.isFrozen(x)) return x; out = new Array(x.length); seen.set(x, out); for (let i = 0; i < x.length; i++) out[i] = c(x[i]); return Object.freeze(out); }
    if (x instanceof Map) { out = new Map(); seen.set(x, out); x.forEach(function (val, key) { out.set(c(key), c(val)); }); return lockDoors(out, MAP_DOORS); }
    if (x instanceof Set) { out = new Set(); seen.set(x, out); x.forEach(function (val) { out.add(c(val)); }); return lockDoors(out, SET_DOORS); }
    if (x instanceof Date) { out = new Date(x.getTime()); seen.set(x, out); return Object.freeze(out); }
    if (Object.isFrozen(x)) return x;
    /* a plain record copied whole by spread, which keeps V8's fast shape (measured 10/18: an order's 35 fields added one by one made every
       copy a slow dictionary — the orders view 7.6 MB; by spread 2.9 MB, less than the whole fold's own 3.6); its parts then copied in place */
    out = Object.getPrototypeOf(x) === null ? Object.assign(Object.create(null), x) : { ...x }; seen.set(x, out);
    const ks = Object.keys(out); for (let i = 0; i < ks.length; i++) { const y = out[ks[i]]; if (y !== null && typeof y === 'object') out[ks[i]] = c(y); }
    return Object.freeze(out);
  };
  return c(v);
}

/* @hub @fold — the hub's one read model: view(agg) frozen and shared, built once per move of that aggregate's facts — followed one fact
   at a time where the aggregate carries inc (the SAME follower the conflict check reads, so its state is held once), whole-folded otherwise */
function projectionsFor(src) {
  const followers = new Map(), memo = new Map(), counts = Object.create(null), handsFns = new Map();
  /* @hub @fold — the aggregate's fold reads only its own facts (inc with no accepts of its own): its own head says when its answer moved */
  function ownFacts(def) { return !!(def && def.inc && typeof def.inc.accepts !== 'function'); }
  /* @hub @fold — whether the aggregate's view hands out a function (asked once, of the view of nothing): a closure over the state it was made from */
  function fnsIn(agg, def) {
    if (handsFns.has(agg)) return handsFns.get(agg);
    let any = false; const seen = new Set();
    (function walk(x) { if (any || !x || typeof x !== 'object' || seen.has(x)) return; seen.add(x); Object.keys(x).forEach(function (k) { if (typeof x[k] === 'function') any = true; else walk(x[k]); }); })(def.inc.view(def.inc.init()));
    handsFns.set(agg, any); return any;
  }
  /* @hub @fold — whether an aggregate is followed one fact at a time: it carries inc, reads only its own facts and its view hands out no function */
  function follows(agg) { const def = registry.aggregate(agg); return ownFacts(def) && !fnsIn(agg, def); }
  /* @hub @fold — one aggregate's count of views built and handed out again */
  function countOf(agg) { return counts[agg] || (counts[agg] = { builds: 0, hits: 0 }); }
  /* @hub @fold — the follower's own answer now, every fact filed so far stepped in (frozen first); the state's own records: read, copied, never kept */
  function live(agg) {
    if (!follows(agg)) return null;
    let f = followers.get(agg);
    if (!f) { f = { log: src.log(agg), fw: src.follower(registry.aggregate(agg), agg) }; followers.set(agg, f); }
    if (typeof src.freeze === 'function') src.freeze();
    const v = f.fw(f.log); f.fed = f.log.size();   /* how far it has read: cutBack keeps it while its list is at least that long */
    return v;
  }
  /* @hub @fold — what the aggregate's fold answers over every fact now, frozen and shared; worked out again only when its facts moved */
  function view(agg) {
    const def = registry.aggregate(agg); if (!def) throw new Error('hub/projections: no aggregate "' + agg + '"');
    const fol = follows(agg), k = ownFacts(def) ? 'a' + src.head(agg) : 'h' + src.headAll(), m = memo.get(agg), n = countOf(agg);
    if (m && m.k === k) { n.hits++; return m.v; }
    const v = frozenCopy(fol ? live(agg) : def.fold(src.all()));
    memo.set(agg, { k: k, v: v }); n.builds++;
    return v;
  }
  /* @hub @fold — start one aggregate again (its list was shortened), or every one (the facts were swapped for copies) */
  function reset(agg) { if (agg == null) { followers.clear(); memo.clear(); return; } followers.delete(agg); memo.delete(agg); }
  /* @hub @fold — facts taken back off the end (a save the store refused): only what READ them starts again — a follower that read past
     its aggregate's list as it now stands, a view built at a head that is gone; what was built before them is still the truth and is
     kept. 10/18 review: starting the aggregate again on every refused retry rebuilt whole folds (a tracker lookup ~300 ms) for as long
     as the disk refused writes, from every tablet retrying (§915) */
  function cutBack() {
    followers.forEach(function (f, agg) { if ((f.fed || 0) > f.log.size()) followers.delete(agg); });
    memo.forEach(function (m, agg) { const def = registry.aggregate(agg); if (m.k !== (ownFacts(def) ? 'a' + src.head(agg) : 'h' + src.headAll())) memo.delete(agg); });
  }
  /* @hub @fold @proof — per aggregate: views built, views handed out again, followed or whole-folded */
  function stats() { const out = Object.create(null); Object.keys(counts).forEach(function (a) { out[a] = { builds: counts[a].builds, hits: counts[a].hits, followed: follows(a), live: followers.has(a) }; }); return out; }
  return { view: view, live: live, follows: follows, reset: reset, cutBack: cutBack, stats: stats };
}

module.exports = { projectionsFor: projectionsFor, frozenCopy: frozenCopy };
