'use strict';
/* ============================================================================
 * STAFF — the employees and what each role may do (2026-09-23 night, plan A3; v1 DB.employees, settings.rolePerms)
 * @employee @permission @owner @fact — who works here and what each role may do: field by field, latest wins, never deleted; a PIN only as a salted hash, and never a shop without an owner
 * ----------------------------------------------------------------------------
 * The rules are core/staff.js; these facts record who works here.
 *   · employee.set changes the fields it names; latest wins per field. Never deleted: a person who leaves is made
 *     inactive, and their PIN stops working (v1: "Disabling an employee blocks their PIN (kept for history)").
 *   · A PIN IS NEVER IN A FACT. Only {salt, hash} is accepted, and a field this validator does not know is refused —
 *     so a plain PIN cannot ride in under another name.
 *   · The shop's role lists (v1 Admin → Role permissions) are one fact, set whole.
 *   · The shop is never left with no active owner: the station refuses it (v1 saveEmployee); the fold says so if
 *     facts from two stations ever cross that line.
 * ========================================================================== */
const registry = require('../core/registry');
const hlc = require('../core/hlc');
const incfold = require('../core/incfold');
const rules = require('../core/staff');

const AGG = 'staff';
const FIELDS = ['name', 'role', 'active', 'perms', 'pin', 'rate', 'dept', 'vacAnnual', 'vacUsed', 'lang', 'printSlip'];   /* printSlip: v1 setPrintSlip — a time slip at every clock-out */   // pay fields (plan C4): v1 saveEmployee's rate, department, annual vacation, the vacation used per pay period, and the language of their screens
/* @employee @fact — a staff fact's required text: non-empty and no longer than max (64 unless told) */
function isStr(v, max) { return typeof v === 'string' && v.length > 0 && v.length <= (max || 64); }
/* @employee @permission @fact — a person's own permissions: only abilities the rules know, each true or false */
function permsErr(p) {
  if (!p || typeof p !== 'object' || Array.isArray(p)) return 'perms is {ability: true|false}';
  const ks = Object.keys(p); for (let i = 0; i < ks.length; i++) { if (rules.ABILITY_KEYS.indexOf(ks[i]) < 0) return 'perms: "' + ks[i] + '" is not an ability'; if (typeof p[ks[i]] !== 'boolean') return 'perms: ' + ks[i] + ' is true or false'; }
  return null;
}
/* @employee @permission @fact — a PIN as the log keeps it: {salt, hash}, or (E65, 9/25 — widened, never tightened) {salt, hash,
   iter} with the rounds it was made at, from the old cost up to PIN_ITER_MAX so no record can make a PIN box hang; never a PIN */
function pinErr(p) {
  if (p === null) return null;                                      // no PIN: this person cannot sign in
  const ks = (p && typeof p === 'object') ? Object.keys(p).sort().join(',') : '';
  if (ks !== 'hash,salt' && ks !== 'hash,iter,salt') return 'pin is {salt, hash} — never the PIN itself';
  if (!/^[0-9a-f]{32}$/.test(p.salt) || !/^[0-9a-f]{64}$/.test(p.hash)) return 'pin is a 16-byte salt and a SHA-256 hash, in hex';
  if ('iter' in p && !(Number.isInteger(p.iter) && p.iter >= rules.PIN_ITER && p.iter <= rules.PIN_ITER_MAX)) return 'pin.iter is the rounds it was hashed with, ' + rules.PIN_ITER + ' to ' + rules.PIN_ITER_MAX;
  return null;
}
registry.registerType('employee.set', { creates: ['empId'], aggregate: AGG, tier: 'immediate',
  doc: 'An employee added or changed, field by field. payload {empId, set: {name?, role? (owner|manager|staff), active?, perms? {ability: bool}, pin? {salt, hash, iter?} | null}, src?}. A PIN is only ever a salted hash.',
  validate: function (p) {
    if (!isStr(p.empId, 64) || p.empId === '__proto__') return 'empId names the employee';
    if (p.src != null && !isStr(p.src, 120)) return 'src is a short note';
    const s = p.set; if (!s || typeof s !== 'object' || Array.isArray(s)) return 'set lists what changed';
    const ks = Object.keys(s); if (!ks.length) return 'set lists what changed';
    for (let i = 0; i < ks.length; i++) if (FIELDS.indexOf(ks[i]) < 0) return 'set: "' + ks[i] + '" is not an employee field';
    if (s.name != null && !isStr(String(s.name).trim() ? s.name : '', 80)) return 'name is 1..80 characters';
    if (s.role != null && rules.ROLES.indexOf(s.role) < 0) return 'role is owner, manager or staff';
    if (s.active != null && typeof s.active !== 'boolean') return 'active is true or false';
    if (s.perms != null) { const b = permsErr(s.perms); if (b) return b; }
    if (s.rate != null && !(typeof s.rate === 'number' && s.rate >= 0 && s.rate <= 1000)) return 'rate is dollars an hour';
    if (s.dept != null && !(typeof s.dept === 'string' && s.dept.length <= 60)) return 'dept is a short name';
    if (s.vacAnnual != null && !(typeof s.vacAnnual === 'number' && s.vacAnnual >= 0 && s.vacAnnual <= 2000)) return 'vacAnnual is hours a year';
    if (s.vacUsed != null && !(typeof s.vacUsed === 'object' && !Array.isArray(s.vacUsed) && Object.keys(s.vacUsed).length <= 400 && Object.keys(s.vacUsed).every(function (k) { return /^[0-9]{10,15}$/.test(k) && typeof s.vacUsed[k] === 'number' && s.vacUsed[k] >= 0 && s.vacUsed[k] <= 1000; }))) return 'vacUsed is {pay period start (ms): hours}';
    if (s.lang != null && !(typeof s.lang === 'string' && s.lang.length <= 5)) return 'lang is a language code';
    if (s.printSlip != null && typeof s.printSlip !== 'boolean') return 'printSlip is true or false';
    if ('pin' in s) { const b = pinErr(s.pin); if (b) return b; }
    return null; } });
registry.registerType('staff.roles', { aggregate: AGG, tier: 'immediate',
  doc: 'What each role may do (the shop\'s own lists, over v1\'s defaults), set whole. payload {rolePerms: {owner?, manager?, staff?: [ability]}, src?}.',
  validate: function (p) {
    const r = p.rolePerms; if (!r || typeof r !== 'object' || Array.isArray(r)) return 'rolePerms is {role: [abilities]}';
    const ks = Object.keys(r);
    for (let i = 0; i < ks.length; i++) {
      if (rules.ROLES.indexOf(ks[i]) < 0) return 'rolePerms: "' + ks[i] + '" is not a role';
      if (!Array.isArray(r[ks[i]]) || r[ks[i]].length > 40 || !r[ks[i]].every(function (a) { return rules.ABILITY_KEYS.indexOf(a) >= 0; })) return 'rolePerms.' + ks[i] + ' lists abilities';
    }
    if (p.src != null && !isStr(p.src, 120)) return 'src is a short note';
    return null; } });

/* v1 empByPin 8/22 + denyMsg: a wrong PIN at a gate, and a person refused something their role does not allow, are
   written down — "a silent refusal reads as a broken button, and an unlogged one hides somebody quietly testing where
   the edges are". Never the PIN that was typed. */
registry.registerType('staff.refused', { aggregate: AGG, tier: 'immediate',
  doc: 'A gate said no: a PIN nobody has (or a disabled one), or a person without the right. payload {gate, why: pin|not-allowed, empId?}. Never the PIN typed.',
  validate: function (p) { if (!isStr(p.gate, 120)) return 'gate names what was asked for'; if (p.why !== 'pin' && p.why !== 'not-allowed') return 'why is pin or not-allowed'; if (p.empId != null && !isStr(p.empId, 64)) return 'empId names the person'; return null; } });
/* @audit @permission @log — v1 doLogin (8ce455c, owner 9/10: "activity log is supposed to catch every time someone clicks a tile
   and has a successful pin entry"): a tile opened with a good PIN is written down — the person is the fact's actor, the tablet
   its station, the screen here. Never the PIN typed. Nothing folds it but the Activity log (batch counterhome, S36). */
registry.registerType('staff.signedIn', { aggregate: AGG, tier: 'immediate',
  doc: 'Someone opened a screen with a good PIN (v1 logEvent \'Signed in\'). payload {gate: the screen, in its own words}; the actor is the person. Never the PIN typed.',
  validate: function (p) { if (!isStr(p.gate, 120)) return 'gate names the screen that was opened'; if (Object.keys(p).some(function (k) { return k !== 'gate'; })) return 'a sign-in carries only the screen'; return null; } });

/* 9/26 (core/incfold.js): the fold as init / step / view, kept up to date one fact at a time — fold() below is exactly these */
const INC = {
  /* @employee @permission @fold — nobody on staff, the default role lists, no refusal yet */
  init: function () { return { byId: new Map(), employees: [], rolePerms: null, refused: [] }; },
  /* @employee @permission @fold — one fact: the role lists set whole, a refusal written down, or a person changed field by field (a cleared PIN stays cleared) */
  step: function (s, e) {
    const p = e.payload || {};
    if (e.type === 'staff.roles') { s.rolePerms = JSON.parse(JSON.stringify(p.rolePerms)); return; }
    if (e.type === 'staff.refused') { s.refused.push({ gate: p.gate, why: p.why, empId: p.empId || null, station: e.station, at: e.at }); return; }
    if (e.type !== 'employee.set') return;
    let x = s.byId.get(p.empId);
    if (!x) { x = { id: p.empId, name: '', role: 'staff', active: true, perms: {}, pin: null, rate: 0, dept: '', vacAnnual: 0, vacUsed: {}, lang: '', since: e.at }; s.byId.set(p.empId, x); s.employees.push(x); }
    FIELDS.forEach(function (k) { if (k in p.set) x[k] = p.set[k] == null ? (k === 'pin' ? null : x[k]) : JSON.parse(JSON.stringify(p.set[k])); });
    x.changedAt = e.at;
  },
  /* @employee @permission @owner @fold — the people in the order first seen, the role lists, the refusals; a note (fresh each time) when no active owner is left */
  view: function (s) {
    const employees = s.employees, notes = [];
    if (employees.length && !employees.some(function (x) { return x.role === 'owner' && x.active !== false; })) notes.push({ kind: 'no-owner', why: 'no active owner is left — nobody can approve a discount or a void' });
    return { employees: employees, byId: s.byId, rolePerms: s.rolePerms, refused: s.refused, notes: notes };
  }
};
/* @employee @permission @fold — each person field by field (latest wins; a cleared PIN stays cleared), the role lists, the refused PINs; a note when no active owner is left */
function fold(events) { return incfold.foldVia(INC, events, AGG); }
/* @employee — one person by id from the staff fold, or null */
function emp(staff, id) { return (staff && staff.byId && staff.byId.get(id)) || null; }
registry.registerAggregate(AGG, { fold: fold, inc: INC, detectConflicts: function (events) { return fold(events).notes; }, describe: function (d) { return { kind: 'staff-note', note: String((d && d.why) || 'a staff question') }; },
  doc: 'Who works here and what each may do. Field by field, latest wins; never deleted (made inactive); a PIN only as a salted hash.' });
module.exports = { fold: fold, emp: emp, AGG: AGG, FIELDS: FIELDS };
