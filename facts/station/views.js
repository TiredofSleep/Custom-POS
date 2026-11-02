'use strict';
/* ============================================================================
 * VIEWS — what every screen reads, folded from the tablet's facts once per new fact (moved out of station/app.js 2026-10-31)
 * @fold @render @station — each aggregate's answer over the whole log, worked out once per new fact through its follower; the screen check; fresh top-level lists
 * ----------------------------------------------------------------------------
 * Moved here from station/app.js word for word (owner 10/31: "the point is for all the systems to grow stronger together...
 * and to be sure that what i am sharing with people is functional because i use it daily"): the code Custom POS shares is the
 * code this shop runs. What the shop folds stays on its page (views(), viewsAll()); how a fold is kept, reused and checked is here.
 * The page hands in what this file used to reach for:
 *   V2           the modules by name (V2[name].fold, V2[name].AGG), with V2.incfold and V2.registry when followers are wanted
 *   log()        the tablet's log now (null before a station is open)
 *   follow       the followers' setting (the tablet keeps two checkpoints: station/app.js TABLET_FOLLOW)
 *   checkOn()    whether the screen check is on (the page's localStorage custompos-freeze-views = 1)
 *   say(why)     where a difference the screen check found is said (the console and the tablet's error log)
 *   setTimeout / clearTimeout   the page's timers, or null: without them the idle moment's work never starts by itself
 * ========================================================================== */

/* @fold @render — the folds a page reads, kept one fact at a time and reused until a fact arrives, with the screen check, over what the page hands in */
function make(o) {
  var V2 = o.V2, logOf = o.log, follow = o.follow, checkOn = o.checkOn || function () { return false; }, say = o.say || function () {},
    later = o.setTimeout || null, cancel = o.clearTimeout || null;
  var logFoldMemo = {}, follows = {}, checkMisses = [], checkNew = [];
  /* @render @fold — a page's views made once per new fact: build() runs when the log grew (or was replaced) since the last answer;
     each call gets a fresh wrapper and fresh top-level lists, so a caller that sorts or reassigns them changes nobody else's; what is
     inside is READ-ONLY (a followed fold's records are its live state) */
  function memo(build) {
    var m = { log: null, n: -1, v: null };
    return function () {
      var lg = logOf(), n = lg ? lg.size() : 0;
      if (!m.v || m.log !== lg || m.n !== n) { m = { log: lg, n: n, v: build() }; checkSay(); }
      return freshTop(m.v);
    };
  }
  /* @render @fold — one aggregate's answer over this tablet's whole log (V2[name]: 'till', 'inbox', 'textLog', 'punches' …), for
     every screen, tick and kit that used to fold all history itself: its follower's answer, or a whole fold once per new fact */
  function logFold(name) { var o = foldOnce(name); checkSay(); return freshTop(o); }
  /* @fold — one aggregate's answer over the whole log, worked out once per new fact: through its follower when the aggregate
     carries inc, else folded whole; the screen check looks it over (memoCheck) */
  function foldOnce(name) {
    var lg = logOf(), n = lg ? lg.size() : 0, k = logFoldMemo[name];
    if (!k || k.log !== lg || k.n !== n) { var fw = followerOf(name); k = logFoldMemo[name] = { log: lg, n: n, out: memoCheck(name, fw ? fw(lg) : V2[name].fold(lg ? lg.all() : []), !!fw) }; if (fw) followMaintSoon(); }
    return k.out;
  }
  var followMaintTimer = null;
  /* @fold @render — the idle moment's work for the followers (core/incfold.js maintain; lazy: no copy of a fold's state ever lands
     on a tap): 2.5 s after the last new fact, one aggregate's checkpoint per quiet moment, until none is due */
  function followMaintSoon() {
    if (typeof later !== 'function') return;
    if (followMaintTimer && cancel) cancel(followMaintTimer);
    followMaintTimer = later(function () { followMaintTimer = null;
      var ks = Object.keys(follows); for (var i = 0; i < ks.length; i++) { var f = follows[ks[i]]; if (f && typeof f.maintain === 'function' && f.maintain()) { followMaintSoon(); return; } } }, 2500);
    if (followMaintTimer && followMaintTimer.unref) followMaintTimer.unref();
  }
  /* @fold — the follower of one aggregate's fold over this tablet's log (core/incfold.js follower: fed only what the log gained
     since the last call; a replaced log, or a shorter one, starts it over), made on first use; null while the aggregate has no inc */
  function followerOf(name) {
    if (!Object.prototype.hasOwnProperty.call(follows, name)) { var m = V2[name], def = (m && m.AGG && V2.incfold && V2.registry) ? V2.registry.aggregate(m.AGG) : null; follows[name] = (def && def.inc) ? V2.incfold.follower(def.inc, m.AGG, follow) : null; }
    return follows[name];
  }
  /* @render @proof — the SCREEN CHECK (localStorage custompos-freeze-views = 1, for whoever clicks through every screen before the
     switch). A whole fold's answer is deep-frozen, so a screen that writes into what the next screen reads throws and names
     itself in the error log. A FOLLOWED fold's answer is its live state and is never frozen (the next step would throw):
     it is compared with a fresh whole fold instead — a difference is named, aggregate and all, in the error log (checkSay) —
     and the screens are handed that whole fold, deep-frozen. Off, nothing is frozen, nothing compared, nothing costs. */
  function memoCheck(name, o, followed) {
    if (!checkOn()) return o;
    if (followed) { var lg = logOf(), full = V2[name].fold(lg ? lg.all() : []), a = canonOf(o), b = canonOf(full);
      if (a !== b) { var at = 0; while (at < a.length && a[at] === b[at]) at++;
        var why = 'screen check: the ' + name + ' fold (' + V2[name].AGG + '), followed one fact at a time, differs from its whole fold at ' + (lg ? lg.size() : 0) + ' facts — char ' + at + ': followed …' + a.slice(Math.max(0, at - 40), at + 60) + ' | whole …' + b.slice(Math.max(0, at - 40), at + 60);
        checkMisses.push({ name: name, agg: V2[name].AGG, n: lg ? lg.size() : 0, why: why }); if (checkMisses.length > 50) checkMisses.shift(); checkNew.push(why); }
      o = full; }
    (function freeze(x) { if (!x || typeof x !== 'object' || Object.isFrozen(x)) return; Object.freeze(x); var t = Object.prototype.toString.call(x); if (t === '[object Map]' || t === '[object Set]') x.forEach(function (y) { freeze(y); }); else Object.keys(x).forEach(function (k) { freeze(x[k]); }); })(o);
    return o;
  }
  /* @proof @error — the screen check's differences said once each, after the memo holds the answer (the page's say: the console,
     and the tablet's error log, 🩹 Errors) */
  function checkSay() { if (!checkNew.length) return; var said = checkNew.splice(0); said.forEach(function (w) { say(w); }); }
  return { memo: memo, logFold: logFold, foldOnce: foldOnce, followerOf: followerOf, checkSay: checkSay, follows: follows, misses: checkMisses };
}
/* @proof — a fold's answer as one text for the screen check: Maps and Sets with their order (from any window), undefined kept apart */
function canonOf(v) { return JSON.stringify(v, function (k, x) { var t = Object.prototype.toString.call(x); if (t === '[object Map]') return { __map: Array.from(x.entries()) }; if (t === '[object Set]') return { __set: Array.from(x.values()) }; return x === undefined ? '__undefined' : x; }); }
/* @render — a fold's answer with its own top-level lists (what is inside them is shared, and read-only) */
function freshTop(o) { if (Array.isArray(o)) return o.slice(); if (!o || typeof o !== 'object') return o; var c = {}; Object.keys(o).forEach(function (k) { c[k] = Array.isArray(o[k]) ? o[k].slice() : o[k]; }); return c; }

module.exports = { make: make, canonOf: canonOf, freshTop: freshTop };
