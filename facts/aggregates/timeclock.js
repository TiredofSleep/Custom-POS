'use strict';
/* ============================================================================
 * TIMECLOCK — the first aggregate. "Log it all and punch it all in, in order."
 * @timeclock @payroll @fact — every punch is a fact every station applies in the one order; a human punch outranks the autoclose guess, and what a person must see is shown, never guessed away
 * ----------------------------------------------------------------------------
 * No winner, no loser: every punch is a fact; every station applies every fact
 * in the one order; the shift you see is the honest result of ALL of them.
 * Kind decides authority, never survival: a human punch outranks the system's
 * autoclose guess regardless of order, and the guess stays on the record.
 *
 * A CLOSE NAMES ITS SHIFT (round 1). Resolution: by the in it names — whether
 * that in opened the shift or joined it as an extra tap (round 3: a double
 * clock-in across two devices used to orphan the real punch-out) → the
 * employee's OPEN shift → for a HUMAN punch, one guarded fallback → else an
 * ORPHAN, visible, attached on a later pass. Never guessed onto a shift a human
 * already closed.
 *
 * A CLOSE CANNOT PRECEDE THE IN IT CLOSES (round 2): every unnamed attachment
 * requires at >= shift.in. A close naming another employee's shift is an orphan.
 *
 * A SECOND IN IS AN EXTRA TAP BY EVIDENCE, NOT BY POSITION (round 4): before a
 * clock-in that arrives while a shift is open is demoted to an extra tap, every
 * close that fits the OPEN shift and happened before the new in — an orphan seen
 * earlier, or a close still AHEAD in the order (a day-ahead tablet, a rebooted
 * clock) — is applied first. Only if the shift is still open afterwards is the
 * new in a tap. A skewed clock can no longer swallow a whole day.
 *
 * TIES BETWEEN EQUAL-RANK CLOSES ARE BROKEN IN THE ONE ORDER (round 4): the
 * later stamp is the current value, never the push order of a repair pass.
 *
 * A TAP WINDOW (round 5): an in that happened within ten minutes BEFORE the open shift
 * began is a second tap on it (devices disagree by seconds), never an earlier shift;
 * the guarded punch fallback finds the latest AUTOCLOSED shift the punch fits by
 * evidence, never the last shift in the array.
 *
 * WHAT A PERSON MUST SEE (round 4): an orphaned human punch that stays an orphan
 * (kind 'orphan', once the day has moved on), two shifts of one person that
 * OVERLAP (invalid), a shift longer than 16 hours or a second clock-in 12+
 * hours after the first (kind 'suspect'), and an edit that leaves out-before-in
 * (invalid). detectConflicts() hands them all to the hub, which alerts once.
 *
 * DISPUTES ARE BETWEEN HUMANS AT THE CLOCK: two real punches with different
 * times. A manager's edit is authority, not a dispute — it resolves one.
 * ========================================================================== */
const registry = require('../core/registry');
const hlc = require('../core/hlc');
const incfold = require('../core/incfold');

const AGG = 'timeclock';
const HOUR = 3600000;
const LONG_SHIFT_MS = 16 * HOUR, LATE_TAP_MS = 12 * HOUR, ORPHAN_GRACE_MS = 6 * HOUR, TAP_WINDOW_MS = 10 * 60000;   // an in within ten minutes BEFORE the open shift began is a second tap on it (device skew), never an earlier shift
const vEmp = function (p) { return (p && typeof p.empId === 'string' && p.empId && p.empId !== '__proto__') ? null : 'empId must be a non-empty string'; };
const realTime = function (x) { return Number.isFinite(x) && x > 0 && x < 1e14; };
const vAt = function (p) { return realTime(p && p.at) ? null : 'at must be a real time'; };
const vShift = function (p) { return (p.shiftId == null || (typeof p.shiftId === 'string' && p.shiftId)) ? null : 'shiftId must be a string'; };
registry.registerType('clock.in',        { aggregate: AGG, tier: 'immediate', doc: 'A person starts a shift. payload {empId, at}. key = empId.',
  validate: function (p) { return vEmp(p) || vAt(p); } });
registry.registerType('clock.out',       { aggregate: AGG, tier: 'immediate', doc: 'A REAL punch out. payload {empId, at, shiftId?}. A human fact: outranks an autoclose regardless of order.',
  validate: function (p) { return vEmp(p) || vAt(p) || vShift(p); } });
registry.registerType('clock.autoclose', { aggregate: AGG, tier: 'immediate', doc: 'The system closed a shift it believed forgotten. payload {empId, at, reason?, shiftId?}. A guess: stays on record, never outranks a punch.',
  validate: function (p) { return vEmp(p) || vAt(p) || vShift(p); } });
registry.registerType('clock.edit',      { aggregate: AGG, tier: 'immediate', doc: 'A manager corrected a shift. payload {empId, shiftId, in?, out?}. Authority: resolves, never disputes. Must name its shift. Times are real times.',
  validate: function (p) { return vEmp(p) || ((typeof p.shiftId === 'string' && p.shiftId) ? null : 'an edit must name its shift') || ((p.in == null || realTime(p.in)) ? null : 'in must be a real time') || ((p.out == null || realTime(p.out)) ? null : 'out must be a real time'); } });

/* plan C4 (v1 delClock / addClock): a shift VOIDED stays on the record, marked, and never pays; a shift a manager ADDS
   for time the clock missed is its own closed shift. Both are payroll edits (a fresh PIN) and owe the employee a
   sign-off (the punches aggregate). */
registry.registerType('clock.void',      { aggregate: AGG, tier: 'immediate', doc: 'A manager voided a shift: it stays on the record, marked, and never pays. payload {empId, shiftId, reason?}.',
  validate: function (p) { return vEmp(p) || ((typeof p.shiftId === 'string' && p.shiftId) ? null : 'a void must name its shift'); } });
registry.registerType('clock.manual',    { aggregate: AGG, tier: 'immediate', doc: 'A manager added a shift the clock missed. payload {empId, in, out}. A closed shift of its own.',
  validate: function (p) { return vEmp(p) || ((realTime(p.in) && realTime(p.out) && p.out > p.in) ? null : 'in and out are real times, out after in'); } });

const RANK = { autoclose: 1, punch: 2, edit: 3 };
const CLOCK_TYPES = ['clock.in', 'clock.out', 'clock.autoclose', 'clock.edit', 'clock.void', 'clock.manual'], CLOCK_TYPE_SET = new Set(CLOCK_TYPES);

/* ----------------------------------------------------------------------------
 * 9/26 (core/incfold.js): the fold as init / step / view, kept up to date one fact at a time — fold() below is exactly these.
 * Everything the fold decides is ONE EMPLOYEE's business (a close naming another person's shift is an orphan), so the state
 * is kept per employee: their facts in the one order, their shifts and the working state the punches read, and their share
 * of the answer. Two decisions of the old loop read AHEAD in the order — a second in is an extra tap only if no close still
 * ahead fits the open shift before it (round 4), and an in whose stamp ran ahead rewinds the start unless some close NAMES it
 * (round 6). A fact stepped at the end has nothing ahead; so each such decision is written down (the demotions, the rewound
 * ins), and a later close that would have changed one replays that one employee from their own first fact — exactly what the
 * whole fold would have done. The old passes after the loop (voids, orphans tried again, overlaps, long shifts, late taps) are
 * each one employee's too: worked out after every fact for the shifts that changed and their neighbours by start, on copies
 * wherever the answer differs from the working shift, so the answer is ready and view() only lays it out. An employee's facts
 * are kept as plain columns (never the fact objects), so a checkpoint's copy of them is cheap.
 * ========================================================================== */
/* @timeclock @fold — is this fact a close: a punch out, the system's autoclose, a manager's edit */
function isClose(e) { return e.type === 'clock.edit' || e.type === 'clock.out' || e.type === 'clock.autoclose'; }
/* @timeclock @fold — when a close says its shift ended: an edit's out, anything else's at */
function closeTime(e) { const p = e.payload || {}; return e.type === 'clock.edit' ? p.out : p.at; }
/* @timeclock @fold — a shift's current close: the highest rank; among equals, the LATER stamp in the one order (never push order) */
function effective(s) { let best = null; s.closes.forEach(function (c) { if (!best || c.rank > best.rank || (c.rank === best.rank && hlc.compare(c.hlc, best.hlc) > 0)) best = c; }); return best; }
/* @timeclock @fold — two shifts by when they began (a stable sort keeps the order they were made among equals) */
function byStart(x, y) { return x.in - y.in; }
/* @timeclock @fold — two places in an employee's order by start: when the shift began, then the fact that made it */
function byKey(a, b) { return (a[0] - b[0]) || (a[1] - b[1]); }
/* @timeclock @fold — where a place sits (or would sit) in an employee's order by start (binary search) */
function keyAt(list, en) { let lo = 0, hi = list.length; while (lo < hi) { const m = (lo + hi) >> 1; if (byKey(list[m], en) < 0) lo = m + 1; else hi = m; } return lo; }
/* @timeclock @fold — where the shift made by fact number q sits in the shop's list (binary search: the list is in the order made) */
function placeOf(s, q) { const l = s.seqs; let lo = 0, hi = l.length; while (lo < hi) { const m = (lo + hi) >> 1; if (l[m] < q) lo = m + 1; else hi = m; } return lo; }
/* @timeclock @fold — which of two moments an open shift changed hands came later: the loop (by fact), the voids, the orphan passes (by pass, then fact) */
function byWhen(a, b) { return (a[0] - b[0]) || (a[1] - b[1]) || (a[2] - b[2]); }
/* @timeclock @fold — does a shift (open: never ended) run past the moment the next one began? */
function runsPast(prev, nextIn) { return (prev.out == null ? Infinity : prev.out) > nextIn; }
/* @timeclock @fold — a shift (by the fact that made it) in or out of one of the answer's lists: disputed, invalid, suspect */
function flag(set, q, on) { if (on) set.add(q); else set.delete(q); }

/* @timeclock @fold — one employee's share of the fold: their facts in the one order as plain columns (kept so they alone can be
   replayed), their shifts and what the punches read (the open shift and since which fact, each in's shift, the closes fitting
   nothing yet, the voids, the demotions and rewound starts a later close could overturn, the shifts the system closed), and their
   share of the answer (the order by start, the voids by shift, the copies the orphan passes made, the orphans still left) */
function empState(emp) {
  return { emp: emp, fx: { q: [], id: [], ty: [], at: [], sid: [], pin: [], pout: [], rs: [], st: [], ac: [], ht: [], hc: [], hi: [] }, closeAt: [],
    shifts: [], openBy: [], open: null, openAt: 0, byIn: new Map(), seqOf: new Map(), orphans: [], voids: [], ahead: [], inflated: [], ac: new Set(),
    order: [], okey: new Map(), voidOf: new Map(), ovIds: [], left: [] };
}
/* @timeclock @fold @fact — a fact kept in its employee's columns: what the fold reads of it and nothing else (its stamp as three numbers when it is the usual {t, c, id}); returns its place */
function keepFact(X, e, q) {
  const f = X.fx, p = e.payload || {}, h = e.hlc, plain = !!h && typeof h === 'object' && Object.keys(h).join() === 't,c,id';
  f.q.push(q); f.id.push(e.id); f.ty.push(CLOCK_TYPES.indexOf(e.type)); f.at.push(p.at); f.sid.push(p.shiftId); f.pin.push(p.in); f.pout.push(p.out); f.rs.push(p.reason);
  f.st.push(e.station); f.ac.push(e.actor); f.ht.push(plain ? h.t : null); f.hc.push(plain ? h.c : null); f.hi.push(plain ? h.id : h);
  return f.id.length - 1;
}
/* @timeclock @fold @fact — a kept fact as the fold's rules read it (for a replay and the closes waiting on a shift): id, type, payload, stamp, station, actor */
function factOf(X, k) {
  const f = X.fx;
  return { id: f.id[k], type: CLOCK_TYPES[f.ty[k]], key: X.emp, payload: { empId: X.emp, at: f.at[k], shiftId: f.sid[k], in: f.pin[k], out: f.pout[k], reason: f.rs[k] },
    hlc: f.ht[k] === null ? f.hi[k] : { t: f.ht[k], c: f.hc[k], id: f.hi[k] }, station: f.st[k], actor: f.ac[k] };
}
/* @timeclock @fold — an employee's shifts that are open now, in the order they were made (a shift never reopens, so the list is pruned as it is read): a clock-out costs that person's open shifts, never every shift ever (audit E58, batch `perf`) */
function openOf(X) { const l = X.openBy; let w = 0; for (let r = 0; r < l.length; r++) if (l[r].status === 'open') l[w++] = l[r]; l.length = w; return l; }
/* @timeclock @fold — a new shift, filed under its employee with the fact that made it, and (outside a replay) at the end of the shop's list */
function fileShift(s, X, sh, cx) {
  X.shifts.push(sh); if (sh.status === 'open') X.openBy.push(sh); X.byIn.set(sh.id, sh); X.seqOf.set(sh.id, cx.seq); cx.touched.add(sh.id);
  if (!cx.replay) { s.all.push(sh); s.seqs.push(cx.seq); }
}
/* @timeclock @fold — a shift after a close: its current close decides out and status; the open shift closed hands over to the latest still open; disputed and out-before-in marked */
function settle(X, sh, cx) {
  const eff = effective(sh);
  if (eff) { sh.out = eff.at; sh.closedBy = eff.kind; sh.status = 'closed'; if (X.open === sh) { X.open = null; const rest = openOf(X).filter(function (x) { return x.status === 'open'; }); if (rest.length) { rest.sort(byStart); X.open = rest[rest.length - 1]; X.openAt = cx.seq; } } }
  if (eff && eff.rank === RANK.autoclose) X.ac.add(sh); else X.ac.delete(sh);
  const punches = sh.closes.filter(function (c) { return c.rank === RANK.punch; });
  const edited = sh.closes.some(function (c) { return c.rank === RANK.edit; });
  sh.disputed = !edited && new Set(punches.map(function (c) { return c.at; })).size > 1;
  sh.invalid = (sh.out != null && sh.out < sh.in) ? 'out before in' : null;
  cx.touched.add(sh.id);
}
/* @timeclock @fold — the shifts the system closed that a punch at `at` fits (in <= at < the guess), in the order they were made: read from the employee's autoclosed shifts, never every shift (ov: the orphan passes' copies stand in for their shifts) */
function guessedFits(X, at, ov) {
  const ids = []; X.ac.forEach(function (r) { ids.push(r.id); });
  if (ov) ov.forEach(function (c, id) { if (!X.ac.has(X.byIn.get(id))) ids.push(id); });
  const out = [];
  ids.forEach(function (id) { const sh = (ov && ov.get(id)) || X.byIn.get(id); if (sh.status !== 'closed' || at < sh.in) return; const eff = effective(sh); if (eff && eff.rank === RANK.autoclose && at < eff.at) out.push(sh); });
  return out.sort(function (a, b) { return X.seqOf.get(a.id) - X.seqOf.get(b.id); });
}
/* @timeclock @fold — which shift a close belongs to: the in it names (the opener OR an extra tap), else the latest open shift that began before it (a close cannot precede the in it closes), else for a HUMAN punch the latest shift the system closed that it fits — by evidence, never by array position */
function target(X, p, rank, at) {
  if (p.shiftId) return X.byIn.get(p.shiftId) || null;
  if (!Number.isFinite(at)) return null;
  const cands = openOf(X).filter(function (s) { return s.status === 'open' && at >= s.in; });
  if (cands.length) { cands.sort(byStart); return cands[cands.length - 1]; }
  if (rank >= RANK.punch) { const fits = guessedFits(X, at, null); if (fits.length) { fits.sort(byStart); return fits[fits.length - 1]; } }
  return null;
}
/* @timeclock @fold — a close put on its shift (an edit on the shift it names, a punch or an autoclose on its target); false when it fits no shift yet */
function applyClose(X, e, cx) {
  const p = e.payload || {};
  if (e.type === 'clock.edit') {
    const sh = p.shiftId ? X.byIn.get(p.shiftId) : null;
    if (!sh) return false;
    sh.edits.push({ id: e.id, in: p.in, out: p.out, station: e.station, actor: e.actor });
    if (p.in != null) sh.in = p.in;
    if (p.out != null) sh.closes.push({ id: e.id, kind: 'edit', rank: RANK.edit, at: p.out, station: e.station, hlc: e.hlc });
    settle(X, sh, cx); if (cx.applied) cx.applied.add(e.id); return true;
  }
  const kind = (e.type === 'clock.out' ? 'punch' : 'autoclose');
  const sh = target(X, p, RANK[kind], p.at);
  if (!sh) return false;
  sh.closes.push({ id: e.id, kind: kind, rank: RANK[kind], at: p.at, station: e.station, hlc: e.hlc, reason: p.reason || null });
  settle(X, sh, cx); if (cx.applied) cx.applied.add(e.id); return true;
}
/* @timeclock @fold — does this close fit the employee's OPEN shift, and did it happen no later than `before`? */
function fitsOpen(X, e, before) {
  const p = e.payload || {}; if (!X.open) return false;
  const at = closeTime(e); if (!Number.isFinite(at) || at > before) return false;
  if (p.shiftId) return X.byIn.get(p.shiftId) === X.open;
  return e.type !== 'clock.edit' && at >= X.open.in;
}
/* @timeclock @fold — before a second in is demoted to an extra tap, the open shift gets every close already seen that fits it (an orphan)... */
function attachOrphansTo(X, before, cx) {
  if (!X.orphans.length || !X.open) return;
  const keep = [];
  X.orphans.forEach(function (k) { const e = factOf(X, k); if (X.open && fitsOpen(X, e, before) && applyClose(X, e, cx)) return; keep.push(k); });
  X.orphans = keep;
}
/* @timeclock @fold — ...and every close still AHEAD in the order that fits it (a tablet a day ahead, a counter whose clock reset): applied now, skipped later. Only a replay has closes ahead; a fact stepped at the end has none */
function closeAhead(X, before, from, cx) {
  const l = X.closeAt; let lo = 0, hi = l.length; while (lo < hi) { const m = (lo + hi) >> 1; if (l[m] < from) lo = m + 1; else hi = m; }
  for (let i = lo; i < l.length; i++) { if (!X.open) break; if (cx.applied && cx.applied.has(X.fx.id[l[i]])) continue; const e = factOf(X, l[i]); if (!isClose(e)) continue; if (fitsOpen(X, e, before)) applyClose(X, e, cx); }
}
/* @timeclock @fold — one of the employee's facts (e, kept at k) through the fold's rules (the old loop's body): an in opens a shift or, only by evidence, is an extra tap (a demotion and a rewound start written down, for a later close that may overturn them); a manual shift is added whole; a void waits for the answer; a close finds its shift or waits as an orphan */
function processAt(s, X, k, e, cx) {
  cx.seq = X.fx.q[k];
  if (cx.applied && cx.applied.has(e.id)) return;
  const p = e.payload || {}, emp = X.emp;
  if (e.type === 'clock.in') {
    const behind = !!(X.open && Number.isFinite(p.at) && p.at < X.open.in - TAP_WINDOW_MS);    /* its wall says it happened well BEFORE the open shift began */
    /* round 6: a stamp that ran AHEAD of its own wall by at least that gap is why it sorted after — a fleet-mate's fast clock (a
       DST-stuck tablet) inflated the recorder's clock. Had the stamp been honest this tap would have opened the shift, so it is a
       second tap that REWINDS the start, never an earlier shift — unless some out NAMES this in (then it is a shift of its own, however
       its stamp sorted); an honest stamp that far behind is an earlier shift arriving late */
    const inflated = behind && !s.named.has(e.id) && e.hlc && Number.isFinite(e.hlc.t) && (e.hlc.t - p.at) >= (X.open.in - p.at);
    if (inflated) { X.inflated.push(e.id); s.inflOwner.set(e.id, emp); }
    const earlier = behind && !inflated;
    if (X.open && !earlier) { attachOrphansTo(X, p.at, cx); closeAhead(X, p.at, k + 1, cx); if (X.open) X.ahead.push({ before: p.at, open: X.open, openIn: X.open.in }); }
    if (X.open && !earlier) { const o = X.open; o.extraIns.push({ id: e.id, at: p.at, station: e.station, rewound: inflated || undefined }); X.byIn.set(e.id, o); if (inflated) { o.inWas = o.in; o.in = p.at; } cx.touched.add(o.id); return; }
    const sh = { id: e.id, empId: emp, in: p.at, out: null, closedBy: null, status: 'open', closes: [], extraIns: [], edits: [], disputed: false, invalid: null, suspect: null };
    fileShift(s, X, sh, cx); if (!earlier) { X.open = sh; X.openAt = cx.seq; } return;
  }
  if (e.type === 'clock.manual') {                               /* a shift the clock missed, added whole */
    const sh = { id: e.id, empId: emp, in: p.in, out: p.out, closedBy: 'edit', status: 'closed', closes: [{ id: e.id, kind: 'edit', rank: RANK.edit, at: p.out, station: e.station, hlc: e.hlc }], extraIns: [], edits: [], disputed: false, invalid: null, suspect: null, manual: true };
    fileShift(s, X, sh, cx); return;
  }
  if (e.type === 'clock.void') { X.voids.push(k); return; }
  if (isClose(e) && !applyClose(X, e, cx)) X.orphans.push(k);
}
/* @timeclock @fold — would this close, had it been known then, have been applied AHEAD at an earlier in of this employee (it fits
   the shift that in was demoted onto and happened no later than it)? Then that in decided wrong. Read from the demotions written
   down, never the facts */
function reopens(X, e) {
  const p = e.payload || {}, at = closeTime(e);
  if (!Number.isFinite(at)) return false;
  for (let i = 0; i < X.ahead.length; i++) { const r = X.ahead[i];
    if (at > r.before) continue;
    if (p.shiftId) { if (X.byIn.get(p.shiftId) === r.open) return true; continue; }
    if (e.type !== 'clock.edit' && at >= r.openIn) return true;
  }
  return false;
}
/* @timeclock @fold — one employee folded again from their own first fact, because a later close overturned what an earlier in
   decided: their shifts rebuilt, put back in the shop's list where each was made, their answer worked out again. Costs that
   employee's history, and only when a demotion or a rewound start is overturned (a skewed clock, a manager's edit before a tap) */
function replayEmp(s, X) {
  X.seqOf.forEach(function (q) { s.disputed.delete(q); s.invalid.delete(q); s.suspect.delete(q); });
  X.left.forEach(function (k) { s.orph.delete(X.fx.q[k]); }); s.openOut.delete(X.emp);
  X.inflated.forEach(function (id) { s.inflOwner.delete(id); });
  const fresh = empState(X.emp); fresh.fx = X.fx; fresh.closeAt = X.closeAt; Object.assign(X, fresh);
  const cx = { seq: 0, applied: new Set(), touched: new Set(), replay: true };
  for (let k = 0; k < X.fx.id.length; k++) processAt(s, X, k, factOf(X, k), cx);
  /* the shop's list: everyone else's shifts as they stand, this employee's merged back in by the fact that made each */
  const mine = X.shifts, all = [], seqs = []; let j = 0;
  s.all.forEach(function (d, i) { if (d.empId === X.emp) return; const q = s.seqs[i]; while (j < mine.length && X.seqOf.get(mine[j].id) < q) { all.push(mine[j]); seqs.push(X.seqOf.get(mine[j++].id)); } all.push(d); seqs.push(q); });
  while (j < mine.length) { all.push(mine[j]); seqs.push(X.seqOf.get(mine[j++].id)); }
  s.all = all; s.seqs = seqs;
  answer(s, X, null, true);
}
/* @timeclock @fold — a copy of a working shift for the orphan passes (its closes and edits its own), one per shift per answer */
function ovOwn(ov, raw) { let c = ov.get(raw.id); if (!c) { c = Object.assign({}, raw); c.closes = raw.closes.slice(); c.edits = raw.edits.slice(); ov.set(raw.id, c); } return c; }
/* @timeclock @fold — the shift a close belongs to in the orphan passes, read through their copies (target's rules exactly) */
function ovTarget(X, ov, p, rank, at) {
  if (p.shiftId) { const r = X.byIn.get(p.shiftId); return r ? (ov.get(r.id) || r) : null; }
  if (!Number.isFinite(at)) return null;
  const cands = X.openBy.map(function (r) { return ov.get(r.id) || r; }).filter(function (sh) { return sh.status === 'open' && at >= sh.in; });
  if (cands.length) { cands.sort(byStart); return cands[cands.length - 1]; }
  if (rank >= RANK.punch) { const fits = guessedFits(X, at, ov); if (fits.length) { fits.sort(byStart); return fits[fits.length - 1]; } }
  return null;
}
/* @timeclock @fold — a copy settled as settle() settles a working shift; the open shift (o.open) hands over, and o.t says when */
function ovSettle(X, ov, sh, o, when) {
  const eff = effective(sh);
  if (eff) { sh.out = eff.at; sh.closedBy = eff.kind; sh.status = 'closed'; if (o.open === sh.id) { o.open = null; o.t = null; const rest = X.openBy.map(function (r) { return ov.get(r.id) || r; }).filter(function (x) { return x.status === 'open'; }); if (rest.length) { rest.sort(byStart); o.open = rest[rest.length - 1].id; o.t = when; } } }
  const punches = sh.closes.filter(function (c) { return c.rank === RANK.punch; });
  const edited = sh.closes.some(function (c) { return c.rank === RANK.edit; });
  sh.disputed = !edited && new Set(punches.map(function (c) { return c.at; })).size > 1;
  sh.invalid = (sh.out != null && sh.out < sh.in) ? 'out before in' : null;
}
/* @timeclock @fold — a close tried again in the orphan passes (an out that sorted before its in attaches now), on copies: an edit on the shift it names, a punch or an autoclose on its target */
function ovApply(X, ov, e, o, when) {
  const p = e.payload || {};
  if (e.type === 'clock.edit') {
    const r = p.shiftId ? X.byIn.get(p.shiftId) : null; if (!r) return false;
    const sh = ovOwn(ov, r);
    sh.edits.push({ id: e.id, in: p.in, out: p.out, station: e.station, actor: e.actor });
    if (p.in != null) sh.in = p.in;
    if (p.out != null) sh.closes.push({ id: e.id, kind: 'edit', rank: RANK.edit, at: p.out, station: e.station, hlc: e.hlc });
    ovSettle(X, ov, sh, o, when); return true;
  }
  const kind = (e.type === 'clock.out' ? 'punch' : 'autoclose');
  const tg = ovTarget(X, ov, p, RANK[kind], p.at); if (!tg) return false;
  const sh = ovOwn(ov, X.byIn.get(tg.id));
  sh.closes.push({ id: e.id, kind: kind, rank: RANK[kind], at: p.at, station: e.station, hlc: e.hlc, reason: p.reason || null });
  ovSettle(X, ov, sh, o, when); return true;
}
/* @timeclock @fold — the employee's share of the answer after a fact (the old passes after the loop, for one person): the voids
   applied (a voided open shift hands over to the latest one still open and not voided), the closes fitting nothing tried again
   on copies (up to three passes), then every shift that changed — and its neighbours in the order by start — worked out again:
   overlaps, long shifts and late taps marked, on a copy whenever the answer differs from the working shift. Costs what changed
   (`full`, after a replay: the employee's every shift) */
function answer(s, X, touched, full) {
  const f = X.fx, voidOf = new Map();                           /* the voids: the last one naming a shift is the one it keeps */
  X.voids.forEach(function (k) { const t = X.byIn.get(f.sid[k]); if (t) voidOf.set(t.id, k); });
  const redo = new Set(full ? X.seqOf.keys() : touched);
  if (!full) { voidOf.forEach(function (k, id) { if (X.voidOf.get(id) !== k) redo.add(id); }); X.voidOf.forEach(function (k, id) { if (!voidOf.has(id)) redo.add(id); }); }
  X.voidOf = voidOf;
  /* who is on the clock once the voids are applied: a voided open shift is nobody's open shift (v1 openClock skips it) */
  const o = { open: X.open ? X.open.id : null, t: X.open ? [0, 0, X.openAt] : null };
  if (X.open && voidOf.has(X.open.id)) {
    let cur = X.open; const gone = new Set();
    for (let i = 0; i < X.voids.length; i++) { const k = X.voids[i], T = X.byIn.get(f.sid[k]); if (!T) continue; gone.add(T);
      if (cur !== T) continue;
      const rest = X.openBy.filter(function (x) { return x.status === 'open' && !gone.has(x); });
      if (!rest.length) { cur = null; o.t = null; break; }
      rest.sort(byStart); cur = rest[rest.length - 1]; o.t = [1, 0, f.q[k]]; }
    o.open = cur ? cur.id : null;
  }
  /* the closes that fit nothing, tried again (an out that sorted before its in attaches now), on copies of the shifts they reach */
  const ov = new Map(); let left = X.orphans;
  if (X.orphans.length) {
    let rem = X.orphans.slice();
    for (let pass = 0; pass < 3 && rem.length; pass++) {
      const still = []; rem.forEach(function (k) { if (!ovApply(X, ov, factOf(X, k), o, [2, pass, f.q[k]])) still.push(k); });
      if (still.length === rem.length) { rem = still; break; } rem = still;
    }
    left = rem;
  }
  if (!full) X.ovIds.forEach(function (id) { redo.add(id); });
  ov.forEach(function (c, id) { redo.add(id); }); X.ovIds = Array.from(ov.keys());
  /* the order by start (a voided shift overlaps nothing): each shift that changed moved to its place; it and its neighbours, old and new, marked again */
  const base = function (id) { return ov.get(id) || X.byIn.get(id); }, marks = new Set(redo);
  if (full) {
    X.order = []; X.okey = new Map();
    X.seqOf.forEach(function (q, id) { if (voidOf.has(id)) return; const en = [base(id).in, q, id]; X.order.push(en); X.okey.set(id, en); });
    X.order.sort(byKey);
  } else {
    redo.forEach(function (id) {
      const was = X.okey.get(id), now = voidOf.has(id) ? null : base(id).in;
      if (was && now !== null && was[0] === now) return;
      if (was) { const j = keyAt(X.order, was); if (X.order[j - 1]) marks.add(X.order[j - 1][2]); if (X.order[j + 1]) marks.add(X.order[j + 1][2]); X.order.splice(j, 1); X.okey.delete(id); }
      if (now !== null) { const en = [now, X.seqOf.get(id), id]; X.order.splice(keyAt(X.order, en), 0, en); X.okey.set(id, en); }
    });
    redo.forEach(function (id) { const en = X.okey.get(id); if (!en) return; const j = keyAt(X.order, en); if (X.order[j - 1]) marks.add(X.order[j - 1][2]); if (X.order[j + 1]) marks.add(X.order[j + 1][2]); });
  }
  marks.forEach(function (id) {
    const raw = X.byIn.get(id), b = ov.get(id) || raw, vk = voidOf.get(id), q = X.seqOf.get(id);
    let invalid = b.invalid;
    if (vk === undefined) { const en = X.okey.get(id), j = keyAt(X.order, en), pv = X.order[j - 1], nx = X.order[j + 1];
      if (!invalid && pv && runsPast(base(pv[2]), en[0])) invalid = 'overlaps shift ' + pv[2];
      if (!invalid && nx && runsPast(b, nx[0])) invalid = 'overlaps shift ' + nx[2]; }
    let suspect = null;
    if (b.out != null && b.out - b.in > LONG_SHIFT_MS) suspect = 'longer than 16 hours';
    else if (b.extraIns.some(function (t) { return Number.isFinite(t.at) && t.at - b.in > LATE_TAP_MS; })) suspect = 'a second clock-in 12+ hours after the first';
    let d = raw;
    if (vk !== undefined || b !== raw || invalid !== raw.invalid || suspect !== null) {
      d = b !== raw ? b : Object.assign({}, raw); d.invalid = invalid; d.suspect = suspect;
      if (vk !== undefined) { d.voided = true; d.voidedBy = f.ac[vk] || null; d.voidReason = f.rs[vk] || null; }
    }
    s.all[placeOf(s, q)] = d;
    flag(s.disputed, q, d.disputed); flag(s.invalid, q, d.invalid); flag(s.suspect, q, d.suspect);
  });
  if (o.open !== null) s.openOut.set(X.emp, { q: X.seqOf.get(o.open), t: o.t }); else s.openOut.delete(X.emp);
  X.left.forEach(function (k) { s.orph.delete(f.q[k]); });
  left.forEach(function (k) { const edit = CLOCK_TYPES[f.ty[k]] === 'clock.edit'; s.orph.set(f.q[k], { id: f.id[k], type: CLOCK_TYPES[f.ty[k]], empId: X.emp, at: edit ? f.pout[k] : f.at[k], shiftId: f.sid[k] || null, station: f.st[k] }); });
  X.left = left.slice();
}
const INC = {
  /* @timeclock @fold — the clock facts: every punch, autoclose, edit, void and manual shift (the old fold read them from whatever it was given) */
  accepts: function (e) { return !!e && CLOCK_TYPE_SET.has(e.type); },
  /* @timeclock @fold — no punch yet: nobody's facts, no shift, nobody on the clock */
  init: function () { return { n: 0, named: new Set(), inflOwner: new Map(), emps: new Map(), all: [], seqs: [], openOut: new Map(), disputed: new Set(), invalid: new Set(), suspect: new Set(), orph: new Map() }; },
  /* @timeclock @fold — one fact: kept under its employee; a close that names a rewound in, or overturns a demotion, replays that
     employee (rare, and only them); anything else goes through the fold's rules once and the employee's answer is brought up to date */
  step: function (s, e) {
    const p = e.payload || {}, emp = p.empId || e.key, seq = s.n++;
    let X = s.emps.get(emp); if (!X) { X = empState(emp); s.emps.set(emp, X); }
    const k = keepFact(X, e, seq); if (isClose(e)) X.closeAt.push(k);
    const again = [];
    if (isClose(e) && typeof p.shiftId === 'string' && !s.named.has(p.shiftId)) { s.named.add(p.shiftId); if (s.inflOwner.has(p.shiftId)) again.push(s.inflOwner.get(p.shiftId)); }   /* an in some out NAMES is a shift of its own, whatever its stamp did */
    if (isClose(e) && again.indexOf(emp) < 0 && reopens(X, e)) again.push(emp);
    again.forEach(function (w) { replayEmp(s, s.emps.get(w)); });
    if (again.indexOf(emp) >= 0) return;
    const cx = { seq: seq, applied: null, touched: new Set(), replay: false };
    processAt(s, X, k, e, cx); answer(s, X, cx.touched, false);
  },
  /* @timeclock @fold — the answer as fold() has always given it: every shift in the order made, who is open (in the order the old
     fold's map gained them), the disputes, invalid and suspect shifts, the orphans — laid out from what the steps keep ready */
  view: function (s) {
    const open = Object.create(null);
    Array.from(s.openOut.entries()).sort(function (a, b) { return byWhen(a[1].t, b[1].t); }).forEach(function (en) { open[en[0]] = s.all[placeOf(s, en[1].q)]; });
    const inOrder = function (qs) { return Array.from(qs).sort(function (a, b) { return a - b; }).map(function (q) { return s.all[placeOf(s, q)]; }); };
    const disputes = inOrder(s.disputed).map(function (sh) { return { shiftId: sh.id, empId: sh.empId, closes: sh.closes.filter(function (c) { return c.rank === RANK.punch; }), effective: { id: effective(sh).id, at: sh.out } }; });
    const invalid = inOrder(s.invalid).map(function (sh) { return { kind: 'invalid', shiftId: sh.id, empId: sh.empId, why: sh.invalid, in: sh.in, out: sh.out, closes: [] }; });
    const suspect = inOrder(s.suspect).map(function (sh) { return { kind: 'suspect', shiftId: sh.id, empId: sh.empId, why: sh.suspect, in: sh.in, out: sh.out, closes: [] }; });
    const orphans = Array.from(s.orph.keys()).sort(function (a, b) { return a - b; }).map(function (q) { return Object.assign({}, s.orph.get(q)); });
    return { shifts: s.all, open: open, disputes: disputes, invalid: invalid, suspect: suspect, orphans: orphans };
  }
};
/* @timeclock @fold — the shifts from every punch in the one order: a close finds the shift it names or the open one it fits, a second in is an extra tap only by evidence, a close that fits nothing stays an orphan; voids kept and never paid; overlaps, 16-hour shifts and late taps marked */
function fold(events) { return incfold.foldVia(INC, events, AGG); }
/* @timeclock — the id of the shift an employee has open now, or null when they are off the clock */
function openShiftId(projection, emp) { const s = projection && projection.open && projection.open[emp]; return s ? s.id : null; }
/* what the hub alerts on: disputes, invalid shifts, suspect shifts, and HUMAN orphans the day has moved past (a punch that
   arrived before its in attaches within minutes; one still orphaned six shop-hours later is a person's lost time) */
/* @timeclock @fold — what the hub alerts on: two human punches that disagree, an invalid or suspect shift, a human punch still fitting no shift six hours on */
function detectConflicts(events) {
  const sorted = events.slice().sort(hlc.compareEvents);
  const f = fold(sorted);
  let newest = 0; sorted.forEach(function (e) { const at = e.payload && e.payload.at; if (Number.isFinite(at) && at > newest) newest = at; });
  const orphans = f.orphans.filter(function (o) { return o.type !== 'clock.autoclose' && Number.isFinite(o.at) && newest - o.at >= ORPHAN_GRACE_MS; })
    .map(function (o) { return { kind: 'orphan', eventId: o.id, shiftId: o.shiftId, empId: o.empId, type: o.type, at: o.at, station: o.station, why: 'a human punch that fits no shift', closes: [] }; });
  return f.disputes.concat(f.invalid, f.suspect, orphans);
}

registry.registerAggregate(AGG, { fold: fold, inc: INC, detectConflicts: detectConflicts,
  doc: 'Punches are facts; a shift is an IN and every close ever applied to it. A close names its in (opener or extra tap) and can never precede the in it closes; a second in is an extra tap only if nothing closes the open shift before it (closes ahead in the order are applied first); an unplaceable close is an orphan. A human punch outranks an autoclose regardless of order; equal ranks are broken by the one order. Two human punches with different times = disputed (both kept, later current, hub alerts); a manager edit resolves; out-before-in and overlapping shifts are invalid; 16h+ shifts and 12h-late taps are suspect; a human orphan the day moved past is alerted.' });

module.exports = { fold: fold, detectConflicts: detectConflicts, openShiftId: openShiftId, AGG: AGG, RANK: RANK, LONG_SHIFT_MS: LONG_SHIFT_MS, LATE_TAP_MS: LATE_TAP_MS, ORPHAN_GRACE_MS: ORPHAN_GRACE_MS, TAP_WINDOW_MS: TAP_WINDOW_MS };
