'use strict';
/* ============================================================================
 * RECORD — the tablet's one door for a fact, and the one way a kit's save reaches it (moved out of station/app.js 2026-10-31)
 * @fact @employee @station — a fact recorded under the person who authorised it, a refusal said and never thrown; a kit's facts recorded, then sent
 * ----------------------------------------------------------------------------
 * Moved here from station/app.js (owner 10/31: "the point is for all the systems to grow stronger together... and to be sure that
 * what i am sharing with people is functional because i use it daily"). The page's rec() is put() with the page's own default
 * actor (the person working the screen) and its toast; every kit's onSave is one saver(), where the page used to write the same
 * three steps out by hand at each kit (record each fact under the right person, then sync), 24 times.
 * ========================================================================== */

/* @fact @employee — records one fact on station S under actor (none: no actor on it); a refused fact goes to refused(why) and the answer is false, never a throw */
function put(S, type, key, payload, actor, refused) {
  try { S.record(type, key, payload, actor ? { actor: actor } : undefined); return true; } catch (e) { if (refused) refused(e.message); return false; }
}
/* @fact @sync @employee — a kit's onSave: who() names the person once per save, every fact goes through rec under them, then sync().
   o (each optional, each one kit's own need, named so the differences show): before(facts) runs first; stop: after a refused fact the
   rest are not recorded; then(facts) runs after the facts and before the sync; after(facts) runs after the sync; ok: the answer is
   whether every fact was recorded (a kit that raises an alarm on false asks for it) — without ok there is no answer, as before */
function saver(rec, sync, who, o) {
  o = o || {};
  return function (facts) {
    var w = who(), ok = true;
    if (o.before) o.before(facts);
    facts.forEach(function (f) { if (o.stop && !ok) return; if (!rec(f.type, f.key, f.payload, w)) ok = false; });
    if (o.then) o.then(facts);
    sync();
    if (o.after) o.after(facts);
    if (o.ok) return ok;
  };
}

module.exports = { put: put, saver: saver };
