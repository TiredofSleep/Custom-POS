/* @facts @module @timeclock — THE TIME CLOCK MODULE: clock-ins and clock-outs every station shares, breaks, and the corrections a
   manager makes, as facts (docs/V2-MODULAR-IMPORT.md, Part 3's worked example). This repo's own file.
   What comes from the engine: the clock.* types and their fold (facts/aggregates/timeclock.js, imported) — which clock-out closes which
   shift, orphans kept visible, a real punch always outranking an automatic close, both sides of a genuine dispute kept. This module
   ADOPTS those types and gives each its authority:
     clock.in, clock.out            the person themselves, an owner, or someone with "payroll" — and NO PIN check by the hub: nobody is
                                    ever kept off the clock because the internet is down
     clock.edit, clock.void, clock.manual   "payroll" (or an owner) AND a PIN the hub checked (facts/modules/pingrant.js)
     clock.autoclose                the hub only
   What Custom POS adds: unpaid breaks (break.start / break.end, the same authority as a punch), the wage a clock-in already written
   carries (no tablet writes one since 11/1 — wageRule; a shift with none reads null, so the person's wage applies), and a COMPAT PROJECTION: punches(facts, staff) rebuilds DB.punches' exact shape from the facts, so the
   existing tip-pool, labor-cost and report code reads shared punches without being rewritten first. */
'use strict';
const { defineModule } = require('./define');
const TC = require('../aggregates/timeclock');

const isMs = function (v) { return typeof v === 'number' && Number.isFinite(v) && v > 0; };
/* @facts @timeclock — why a break fact is malformed, or null */
function vBreak(p) { if (typeof p.empId !== 'string' || !p.empId) return 'empId names the person'; if (typeof p.shiftId !== 'string' || !p.shiftId) return 'a break names its shift'; return isMs(p.at) ? null : 'at is a real time'; }
/* @facts @fold @timeclock — breaks by shift: { byShift: { shiftId: [{start, end|null}] } }; an end closes that shift's open break */
function foldBreaks(evs) {
  /* stage-2 review: a plain {} let a fact naming shift "constructor" break every device's fold for good (facts are forever); a map with no
     prototype cannot be poisoned. The facts go in the order they were made (their hybrid clock), not by the time a tablet wrote in them,
     and an end written a moment before its start (a skewed tablet) closes the break at its start instead of leaving it open forever. */
  const byShift = Object.create(null), at = function (e) { return e.hlc ? [e.hlc.t || 0, e.hlc.c || 0] : [e.payload.at, 0]; };
  evs.slice().sort(function (a, b) { const x = at(a), y = at(b); return (x[0] - y[0]) || (x[1] - y[1]) || String(a.id).localeCompare(String(b.id)); }).forEach(function (e) {
    const p = e.payload, list = byShift[p.shiftId] = byShift[p.shiftId] || [];
    if (e.type === 'break.start') { if (!list.some(function (b) { return b.end == null; })) list.push({ start: p.at, end: null }); }
    else if (e.type === 'break.end') { const open = list.filter(function (b) { return b.end == null; })[0]; if (open) open.end = Math.max(p.at, open.start); }
  });
  return { byShift: byShift };
}
/* a shift id a break may name: an event id (station/…), as every clock-in's is — judged on NEW facts only (law 1). The station part is the
   hub's own rule for a station name (any text but "/", 1 to 64 characters): skeptic 11/1 found a device the hub enrolled as "Front Counter"
   could clock in and out but never start a break, because this allowed no space */
const SHIFT_ID = /^[^/]{1,64}\/[A-Za-z0-9_.:-]{1,128}$/;
/* @facts @timeclock — a new break must name a real-looking shift id */
function admitBreak(p) { return SHIFT_ID.test(String(p.shiftId)) ? null : 'a break names its shift by the clock-in\'s id'; }
/* @facts @timeclock @payroll — a wage on a clock-in is a pay figure, and a clock-in is never PIN-checked (nobody is kept off the clock), so
   no tablet writes one: the person's wage from setup applies, as the app has sent none since the stage-2 review. Skeptic 11/1: a lost
   tablet's key could put any wage on a punch by naming the owner, while the same figure as a rate (employee.set) needs "employees" and
   the owner's PIN checked by the hub. A punch the hub writes itself is not judged here. */
function wageRule(p) { return p.wage != null ? 'a clock-in carries no wage from a tablet — a pay rate is set on the person (employee.set), with a PIN the hub checked' : null; }

/* @facts @timeclock — local HH:MM, as the clock station shows the wall clock */
function hm(ms) { return new Date(ms).toTimeString().slice(0, 5); }
/* @facts @timeclock @payroll — DB.punches' exact shape from the facts: [{staffId, name, in, inTs, out, outTs, breaks:[{start,startTs,end,endTs}], wage}].
   staff: { byId } (the staff module's list) for names; a voided shift never pays, so it is left out, as DB.punches never held one.
   ids (optional, rollout step 5): a Map this fills with each punch → its shift's id (the clock-in fact's), for the clock kit's adapter
   (pos.html clockKitFor), which names the shift a clock-out or a break belongs to; the punch itself keeps DB.punches' exact shape. */
function punches(facts, staff, ids) {
  const clock = facts.filter(function (e) { return /^clock\./.test(e.type); });
  const view = TC.fold(clock), src = new Map(); clock.forEach(function (e) { if (e.type === 'clock.in' || e.type === 'clock.manual') src.set(e.id, e); });
  /* a break names the clock-in its tablet saw open; a second clock-in from a tablet that had not yet seen the first is an extra tap of the
     same shift (the engine's fold, extraIns), so each break is folded under the shift its clock-in belongs to — skeptic 11/1: a break named
     after the extra tap vanished from the punches and was paid as worked time (a start and its end may name different taps) */
  const shiftOf = new Map(); (view.shifts || []).forEach(function (s) { shiftOf.set(s.id, s.id); (s.extraIns || []).forEach(function (t) { if (t && t.id) shiftOf.set(t.id, s.id); }); });
  const brk = foldBreaks(facts.filter(function (e) { return /^break\./.test(e.type); }).map(function (e) {
    const to = shiftOf.get(e.payload.shiftId); return (to && to !== e.payload.shiftId) ? Object.assign({}, e, { payload: Object.assign({}, e.payload, { shiftId: to }) }) : e; }));
  const byId = (staff && staff.byId) || new Map();
  return (view.shifts || []).filter(function (s) { return s.status !== 'void' && !s.voided; }).map(function (s) {
    /* the wage written at punch time; none written is null (not 0), so pos.html falls back to the person's wage as DB.punches always did — a 0 would cost the shift nothing (10/31: the history fixture caught a manual shift costed at $0) */
    const who = byId.get(String(s.empId)), from = src.get(s.id), wage = from && typeof from.payload.wage === 'number' ? from.payload.wage : null;
    const out = s.out != null ? s.out : null;
    /* a break ends no later than its shift: a closed shift with a break never ended would count as on break until NOW, and pos.html's
       paid time (clocked minus breaks, floored at 0) would fall to nothing (stage-2 review) */
    const cap = function (t) { return out != null ? Math.min(t, out) : t; };
    const row = { staffId: s.empId, name: who ? who.name : String(s.empId), in: hm(s.in), inTs: s.in, out: out != null ? hm(out) : null, outTs: out,
      breaks: (brk.byShift[s.id] || []).map(function (b) { const st = cap(b.start), en = b.end != null ? cap(b.end) : (out != null ? out : null); return { start: hm(st), startTs: st, end: en != null ? hm(en) : null, endTs: en }; }), wage: wage };
    if (ids) ids.set(row, s.id);
    return row;
  }).sort(function (a, b) { return a.inTs - b.inTs; });
}
/* @facts @timeclock — the open shift of a person (its id is the clock.in fact's), or null */
function openShift(facts, empId) { return TC.openShiftId(TC.fold(facts.filter(function (e) { return /^clock\./.test(e.type); })), empId); }

const PUNCH = { authority: 'self-or:payroll', self: 'empId' };
const FIX = { authority: 'needs:payroll', self: 'empId', pin: true };
const TIMECLOCK = defineModule({
  name: 'timeclock', version: 1, layer: 'operations', requires: ['staff'],
  aggregate: { name: 'breaks', fold: foldBreaks, doc: 'unpaid breaks inside a shift (Custom POS\'s; the engine\'s clock has none)' },
  facts: {
    'clock.in': Object.assign({ adopt: true, rule: wageRule }, PUNCH), 'clock.out': Object.assign({ adopt: true }, PUNCH),
    'clock.edit': Object.assign({ adopt: true }, FIX), 'clock.void': Object.assign({ adopt: true }, FIX), 'clock.manual': Object.assign({ adopt: true }, FIX),
    'clock.autoclose': { adopt: true, authority: 'hub-only' },
    'break.start': Object.assign({ validate: vBreak, admit: admitBreak, doc: 'A break starts inside a shift. payload {empId, shiftId, at}' }, PUNCH),
    'break.end': Object.assign({ validate: vBreak, admit: admitBreak, doc: 'The open break of a shift ends. payload {empId, shiftId, at}' }, PUNCH)
  },
  views: { shifts: function (facts) { return TC.fold(facts.filter(function (e) { return /^clock\./.test(e.type); })); }, breaks: foldBreaks, punches: punches },
  needsConfig: { 'labor.mealAfterHrs': 5, 'labor.mealMins': 30, 'labor.restEveryHrs': 4, 'labor.restMins': 10, 'timeclock.autoCloseAfterHrs': 0 }
});

module.exports = { TIMECLOCK: TIMECLOCK, punches: punches, openShift: openShift, foldBreaks: foldBreaks };
