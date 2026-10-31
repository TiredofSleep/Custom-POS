'use strict';
/* ============================================================================
 * HLC — Hybrid Logical Clock. The ONE order every station applies events in.
 * @clock @fact — the one order every station applies facts in; a peer's stamp is believed only if a real clock could have issued it
 * ----------------------------------------------------------------------------
 * A structured stamp {t, c, id} compared only by compare(): no packed floats,
 * no scale to confuse (the old system's two-clocks bug). compareEvents() falls
 * through to (station, sseq, id), so no two distinct events can ever tie and
 * arrival order can never leak into a fold (round 1).
 *
 * Bounded and self-healing (rounds 2 and 3): a peer's stamp is absorbed only if
 * a real clock could have issued it (finite t below MAX_T, integer 0..MAX_C)
 * AND it is not more than MAX_DRIFT ahead of this station's own wall — a peer
 * whose clock says 2090 orders its own events late, but it cannot drag every
 * station's clock to the ceiling where the next stamp would be out of range.
 * A counter that cannot advance rolls the millisecond instead of repeating; a
 * wall clock that is broken from boot still issues a valid, increasing stamp.
 * ========================================================================== */
const MAX_C = 4294967296, MAX_T = 1e14;
const MAX_DRIFT_MS = 24 * 3600 * 1000;                            // a day ahead of my wall is the most I will believe of a peer
/* @clock — a stamp a real clock could have issued (finite t below MAX_T, a whole counter 0..MAX_C); anything else is ignored, never observed */
function sane(stamp) { return !!stamp && Number.isFinite(stamp.t) && stamp.t > 0 && stamp.t < MAX_T && Number.isInteger(stamp.c) && stamp.c >= 0 && stamp.c <= MAX_C; }

/* @clock @station — one station's clock: every stamp strictly after the last, a peer's stamp absorbed only if sane and at most a day ahead of the wall, a broken wall still ticking */
function makeClock(stationId, opts) {
  if (stationId == null || String(stationId) === '') throw new Error('hlc: a clock must know its station');
  const id = String(stationId);
  opts = opts || {};
  const wall = opts.now || Date.now;
  const maxDrift = (opts.maxDriftMs > 0) ? opts.maxDriftMs : MAX_DRIFT_MS;
  let t = 0, c = 0;
  /* @clock — the wall time, or null when the wall is broken (throws, NaN, zero, past MAX_T), so a bad wall clock never becomes a stamp */
  function wallOk() { let w; try { w = wall(); } catch (e) { w = NaN; } return (Number.isFinite(w) && w > 0 && w < MAX_T) ? w : null; }
  return {
    now() {
      const w = wallOk();
      if (w != null && w > t) { t = w; c = 0; }
      else if (t === 0) { t = 1; c = 0; }                             // a broken wall from boot: start at the floor, count from there
      else if (c + 1 === c || c >= MAX_C) { t = t + 1; c = 0; }      // the counter cannot advance → roll the ms: strictly increasing, always
      else { c += 1; }
      return { t: t, c: c, id: id };
    },
    observe(stamp) {
      if (!sane(stamp)) return;
      const w = wallOk();
      if (w != null && stamp.t > w + maxDrift) return;               // a stamp from a clock too far ahead of mine is ordered, not obeyed
      if (stamp.t > t) { t = stamp.t; c = stamp.c; }
      else if (stamp.t === t && stamp.c > c) { c = stamp.c; }
    },
    /* my OWN history is not a peer's claim: seed the clock from it with no drift cap (a wall a year behind my last stamp is
       the wall's fault; issuing stamps before my own history would file today under last year) */
    adopt(stamp) { if (!sane(stamp)) return; if (stamp.t > t) { t = stamp.t; c = stamp.c; } else if (stamp.t === t && stamp.c > c) { c = stamp.c; } },
    peek() { return { t: t, c: c, id: id }; },
    /* how far ahead of my wall my logical time has drifted (0 when the wall is broken or I am behind it) */
    drift() { const w = wallOk(); return (w == null) ? 0 : Math.max(0, t - w); },
    id: id
  };
}

/* @clock — the ONE order of two stamps: time, then counter, then station id; nothing else may order stamps */
function compare(a, b) {
  if (a.t !== b.t) return a.t < b.t ? -1 : 1;
  if (a.c !== b.c) return a.c < b.c ? -1 : 1;
  const ai = String(a.id), bi = String(b.id);
  return ai < bi ? -1 : (ai > bi ? 1 : 0);
}
/* Order two EVENTS; tolerant of a malformed stamp (sorts earliest) so a bad row can never crash a fold. */
/* @clock @fold — orders two facts with no tie ever (stamp, station, sseq, id), a malformed stamp sorting first, so arrival order never leaks into a fold and a bad row never crashes one */
function compareEvents(a, b) {
  const ah = a && a.hlc, bh = b && b.hlc;
  if (!ah || !bh) return (!ah && !bh) ? 0 : (!ah ? -1 : 1);
  const s = compare(ah, bh); if (s) return s;
  const as = String(a.station), bs = String(b.station);
  if (as !== bs) return as < bs ? -1 : 1;
  if (a.sseq !== b.sseq) return (a.sseq || 0) < (b.sseq || 0) ? -1 : 1;
  const ai = String(a.id), bi = String(b.id);
  return ai < bi ? -1 : (ai > bi ? 1 : 0);
}
/* @clock — stamp a is strictly later than b: the whole question a latest-wins fold asks */
function newer(a, b) { return compare(a, b) > 0; }

module.exports = { makeClock: makeClock, compare: compare, compareEvents: compareEvents, newer: newer, sane: sane, MAX_DRIFT_MS: MAX_DRIFT_MS, MAX_C: MAX_C, MAX_T: MAX_T };
