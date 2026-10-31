/* @facts @module @timeclock — THE TIME CLOCK MODULE: clock-ins and clock-outs every station shares, breaks, and the corrections a
   manager makes, as facts (docs/V2-MODULAR-IMPORT.md, Part 3's worked example). This repo's own file.
   What comes from the engine: the clock.* types and their fold (facts/aggregates/timeclock.js, imported) — which clock-out closes which
   shift, orphans kept visible, a real punch always outranking an automatic close, both sides of a genuine dispute kept. This module
   ADOPTS those types and gives each its authority:
     clock.in, clock.out            the person themselves, an owner, or someone with "payroll" — and NO PIN check by the hub: nobody is
                                    ever kept off the clock because the internet is down
     clock.edit, clock.void, clock.manual   "payroll" (or an owner) AND a PIN the hub checked (facts/modules/pingrant.js)
     clock.autoclose                the hub only
   What Custom POS adds: unpaid breaks (break.start / break.end, the same authority as a punch), the wage carried on clock.in as
   DB.punches carries it today (a shift with none written reads null, so the person's wage applies), and a COMPAT PROJECTION: punches(facts, staff) rebuilds DB.punches' exact shape from the facts, so the
   existing tip-pool, labor-cost and report code reads shared punches without being rewritten first. */
'use strict';
const { defineModule } = require('./define');
const TC = require('../aggregates/timeclock');

const isMs = function (v) { return typeof v === 'number' && Number.isFinite(v) && v > 0; };
/* @facts @timeclock — why a break fact is malformed, or null */
function vBreak(p) { if (typeof p.empId !== 'string' || !p.empId) return 'empId names the person'; if (typeof p.shiftId !== 'string' || !p.shiftId) return 'a break names its shift'; return isMs(p.at) ? null : 'at is a real time'; }
/* @facts @fold @timeclock — breaks by shift: { byShift: { shiftId: [{start, end|null}] } }; an end closes that shift's open break */
function foldBreaks(evs) {
  const byShift = {};
  evs.slice().sort(function (a, b) { return (a.payload.at - b.payload.at) || String(a.id).localeCompare(String(b.id)); }).forEach(function (e) {
    const p = e.payload, list = byShift[p.shiftId] = byShift[p.shiftId] || [];
    if (e.type === 'break.start') { if (!list.some(function (b) { return b.end == null; })) list.push({ start: p.at, end: null }); }
    else if (e.type === 'break.end') { const open = list.filter(function (b) { return b.end == null; })[0]; if (open && p.at >= open.start) open.end = p.at; }
  });
  return { byShift: byShift };
}

/* @facts @timeclock — local HH:MM, as the clock station shows the wall clock */
function hm(ms) { return new Date(ms).toTimeString().slice(0, 5); }
/* @facts @timeclock @payroll — DB.punches' exact shape from the facts: [{staffId, name, in, inTs, out, outTs, breaks:[{start,startTs,end,endTs}], wage}].
   staff: { byId } (the staff module's list) for names; a voided shift never pays, so it is left out, as DB.punches never held one. */
function punches(facts, staff) {
  const clock = facts.filter(function (e) { return /^clock\./.test(e.type); }), brk = foldBreaks(facts.filter(function (e) { return /^break\./.test(e.type); }));
  const view = TC.fold(clock), src = new Map(); clock.forEach(function (e) { if (e.type === 'clock.in' || e.type === 'clock.manual') src.set(e.id, e); });
  const byId = (staff && staff.byId) || new Map();
  return (view.shifts || []).filter(function (s) { return s.status !== 'void' && !s.voided; }).map(function (s) {
    /* the wage written at punch time; none written is null (not 0), so pos.html falls back to the person's wage as DB.punches always did — a 0 would cost the shift nothing (10/31: the history fixture caught a manual shift costed at $0) */
    const who = byId.get(String(s.empId)), from = src.get(s.id), wage = from && typeof from.payload.wage === 'number' ? from.payload.wage : null;
    const out = s.out != null ? s.out : null;
    return { staffId: s.empId, name: who ? who.name : String(s.empId), in: hm(s.in), inTs: s.in, out: out != null ? hm(out) : null, outTs: out,
      breaks: (brk.byShift[s.id] || []).map(function (b) { return { start: hm(b.start), startTs: b.start, end: b.end != null ? hm(b.end) : null, endTs: b.end }; }), wage: wage };
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
    'clock.in': Object.assign({ adopt: true }, PUNCH), 'clock.out': Object.assign({ adopt: true }, PUNCH),
    'clock.edit': Object.assign({ adopt: true }, FIX), 'clock.void': Object.assign({ adopt: true }, FIX), 'clock.manual': Object.assign({ adopt: true }, FIX),
    'clock.autoclose': { adopt: true, authority: 'hub-only' },
    'break.start': Object.assign({ validate: vBreak, doc: 'A break starts inside a shift. payload {empId, shiftId, at}' }, PUNCH),
    'break.end': Object.assign({ validate: vBreak, doc: 'The open break of a shift ends. payload {empId, shiftId, at}' }, PUNCH)
  },
  views: { shifts: function (facts) { return TC.fold(facts.filter(function (e) { return /^clock\./.test(e.type); })); }, breaks: foldBreaks, punches: punches },
  needsConfig: { 'labor.mealAfterHrs': 5, 'labor.mealMins': 30, 'labor.restEveryHrs': 4, 'labor.restMins': 10, 'timeclock.autoCloseAfterHrs': 0 }
});

module.exports = { TIMECLOCK: TIMECLOCK, punches: punches, openShift: openShift, foldBreaks: foldBreaks };
