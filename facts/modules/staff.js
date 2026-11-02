/* @facts @module @permission — THE STAFF MODULE: who works here, what each may do and the PIN that proves it is them — the origin shop's
   own staff files (imported, unedited) given this repo's module shape, so the hub judges every person-naming fact by ONE list of people.
   This repo's own file, and a thin one (docs/V2-MODULAR-IMPORT.md Part 3b, rollout step 4). What is the shop's, imported:
     facts/aggregates/staff.js   the facts and their fold: employee.set (field by field, latest wins, never deleted; a PIN only as a salted
                                 hash), staff.roles (what each role may do, set whole), staff.refused, staff.signedIn
     facts/core/staff.js         the rules: roles, can() (the owner always, then the person's own override, then the role's list), PINs
                                 (PBKDF2-SHA256, the same bytes in a browser and in Node), PIN_CHECKED (the facts the hub PIN-checks)
     facts/core/abilities.js     THE BUSINESS'S OWN FILE (yours): the abilities a person may be given and each role's defaults — the first
                                 import brings the origin shop's list as a working start; edit it, no later import writes over it
     facts/hub/pingrant.js       the PIN the hub checks: a signed 30-minute pass for one person on one tablet
   What this file adds is the shop's hub rules in this repo's module shape (the shop keeps them in its own hub/authority.js):
     employee.set   that person (their own PIN, time slip and language only), an owner, or someone holding "employees" — and only an
                    owner makes or changes an owner; the shop always keeps an active owner
     staff.roles    an owner, or someone holding "employees"
     both           with a PIN the hub checked (core/staff.js PIN_CHECKED), as at the shop
     staff.refused, staff.signedIn   any enrolled tablet (the shop's hub admits them from any tablet: they record a gate, never a change)
   A brand-new shop with nobody on staff admits its first fact only if it is its owner (define.js asks firstOk). */
'use strict';
const { defineModule } = require('./define');
const S = require('../core/staff');
const AGG = require('../aggregates/staff');   /* registers employee.set, staff.roles, staff.refused, staff.signedIn */

const SELF_FIELDS = ['pin', 'printSlip', 'lang'];   /* the shop's own list (hub/authority.js): what a person may change about themselves */

/* @facts @permission @employee @owner — employee.set, after self-or:employees passed: owners, a person's own few fields, and never the last active owner */
function employeeRule(p, who, staff) {
  const s = (p.set && typeof p.set === 'object') ? p.set : {}, ks = Object.keys(s), target = staff.byId.get(p.empId) || null;
  if ((s.role === 'owner' || (target && target.role === 'owner')) && !S.isOwner(who)) return 'only an owner makes or changes an owner';
  if (String(p.empId) === String(who.id) && !staff.can(who, 'employees') && ks.some(function (k) { return SELF_FIELDS.indexOf(k) < 0; })) return who.name + ' may change only their own PIN, time slip and language';
  /* the shop always keeps an active owner: its tablets refuse it (core/staff.js employeeSaveCheck) and its fold says so after the fact; here
     the hub refuses it too (stage-2 review: without this nobody could ever make an owner again). A null role or active leaves the field
     as it was (the shop's fold), so only a real other role, or active false, counts */
  if (target && target.role === 'owner' && target.active !== false && ((s.role != null && s.role !== 'owner') || s.active === false)) {
    const others = staff.employees.filter(function (x) { return x.id !== target.id && x.role === 'owner' && x.active !== false; }).length;
    if (!others) return 'the shop must keep an active owner — make someone else an owner first';
  }
  return null;
}
/* @facts @employee — what a brand-new shop's first fact must be: its owner, active (define.js asks before anyone is on staff) */
function firstOk(e) { const s = e && e.type === 'employee.set' && e.payload && e.payload.set; return !!(s && s.role === 'owner' && s.active !== false); }

/* the hub reads the list often (every person-naming fact): the staff facts already read are kept, and only new ones are added */
const memo = { seen: 0, facts: [], first: null, view: null, n: -1 };
/* @facts @fold @permission — the staff list as the hub judges by it: the shop's fold of its facts so far, with this send's own laid on top */
function staffNow(master, staged) {
  if (master.length < memo.seen || (master.length && memo.first !== master[0])) { memo.seen = 0; memo.facts = []; memo.n = -1; memo.first = master[0] || null; }
  for (; memo.seen < master.length; memo.seen++) { const m = master[memo.seen]; if (m.aggregate === AGG.AGG) memo.facts.push(m); }
  const mine = (staged || []).filter(function (x) { return x.aggregate === AGG.AGG; });
  let view;
  if (mine.length) view = AGG.fold(memo.facts.concat(mine));
  else { if (memo.n !== memo.facts.length) { memo.view = AGG.fold(memo.facts); memo.n = memo.facts.length; } view = memo.view; }
  return { byId: view.byId, employees: view.employees, rolePerms: view.rolePerms, isOwner: S.isOwner, can: function (who, right) { return S.can(who, right, view.rolePerms); } };
}

/* the shop's list of facts its hub PIN-checks decides which of these need a pass, so the two can never disagree */
const pinned = function (t) { return S.PIN_CHECKED.indexOf(t) >= 0; };
const STAFF = defineModule({
  name: 'staff', version: 2, layer: 'core',
  facts: {
    'employee.set': { adopt: true, authority: 'self-or:employees', self: 'empId', pin: pinned('employee.set'), rule: employeeRule },
    'staff.roles': { adopt: true, authority: 'needs:employees', pin: pinned('staff.roles') },
    'staff.refused': { adopt: true, authority: 'any' },
    'staff.signedIn': { adopt: true, authority: 'any' }
  },
  views: { list: function (facts) { return AGG.fold(facts); } },
  provides: { staff: staffNow, firstOk: firstOk }
});

/* @facts @permission — may this person do this, by a staff fold's role lists (the owner always, then their own override, then the role) */
function can(who, right, view) { return S.can(who, right, view && view.rolePerms); }

module.exports = { STAFF: STAFF, fold: AGG.fold, can: can, isOwner: S.isOwner, rules: S, employeeRule: employeeRule,
  pinRecord: S.pinRecord, pinRecordSync: S.pinRecordSync, empByPin: S.empByPin, pinValid: S.pinValid, pinText: S.pinText, ABILITIES: S.ABILITIES };
