'use strict';
/* ============================================================================
 * STAFF — who works here, what each may do, and the PIN that proves it is them (2026-09-23, plan A3).
 * @employee @permission @owner — roles and abilities, PINs as salted hashes, a tablet's wrong-PIN lock, and the list of facts the hub PIN-checks; the same for every business
 * ----------------------------------------------------------------------------
 * Carried over rule for rule from v1's own code (rolePerms, can, isOwner, empByPin, saveEmployee) and proven against
 * verbatim copies of those functions in the suite (§38).
 *
 *   · The owner can do everything. Anyone else: their own per-person override first, then the shop's role list, then
 *     the built-in defaults.
 *   · A PIN is at least 4 digits, unique, and a disabled employee's PIN never works. v1 trims what was typed.
 *   · WHICH abilities there are is the business's own: core/abilities.js (the shop's is v1's twelve). A module adds
 *     its own with addAbility(). Since 11/1 nothing of the shop's prices is in this file: discounts and voids are
 *     core/discountvoid.js. That is what lets Custom POS share this file as it is (V2-MODULAR-IMPORT.md Part 3b, step 2).
 *
 * PINS ARE KEPT ONLY AS SALTED HASHES (PBKDF2-SHA256, a random salt per person). ⚠️ Be honest about what that buys:
 * a 4-digit PIN has 10,000 possibilities, so no hash makes it secret from someone holding the whole log. What it
 * does is keep PINs out of sight — nobody reading the log, a backup, a feed report or a screen sees one — and v1
 * kept them in plain text on every station. The real guard is where the log lives: the shop's tablets and the hub.
 * ========================================================================== */
const ROLES = ['owner', 'manager', 'staff'];

/* ---------------- the abilities: the business's own list (core/abilities.js), then what its modules add ----------------
   ABILITIES ([key, words], in the Admin screen's order), ABILITY_KEYS and ROLE_PERMS (each role's defaults) are made
   once from the business's file and only ever added to, never replaced, so every reader that took them at load sees the
   same lists. abilitiesFrom() is the one way a list becomes them (a builder can check a business's file with it too). */
/* review 11/1: at most 40 — the staff fold refuses a role list longer than that (aggregates/staff.js), and the owner's defaults hold
   every ability, so a 41st would leave Admin → Roles unable to save; it stops the start instead */
const MAX_ABILITIES = 40;
/* @permission — one ability onto a set of lists: a short key (a letter, then letters, digits or _) and its words, never twice; `where` names who asked */
function addOne(into, key, label, where) {
  key = String(key == null ? '' : key);
  if (!/^[a-z][A-Za-z0-9_]{0,31}$/.test(key)) throw new Error(where + ': "' + key + '" is not an ability key (a letter, then letters, digits or _)');
  if (key in {}) throw new Error(where + ': "' + key + '" is a name every object already has (can() would read it off any person)');
  if (into.ABILITY_KEYS.indexOf(key) >= 0) throw new Error(where + ': "' + key + '" is already an ability');
  if (typeof label !== 'string' || !label.trim()) throw new Error(where + ': "' + key + '" needs its words (what the Admin screen shows)');
  if (into.ABILITY_KEYS.length >= MAX_ABILITIES) throw new Error(where + ': "' + key + '" would be ability ' + (MAX_ABILITIES + 1) + ' — at most ' + MAX_ABILITIES + ' (a role\'s list holds no more)');
  into.ABILITIES.push([key, label]); into.ABILITY_KEYS.push(key);
}
/* @permission @employee — a business's list as this file holds it: its abilities in its order, then each role's defaults in its order; anything the file gets wrong (a key, its words, a role, a default naming no ability) stops the start, naming the file */
function abilitiesFrom(shop) {
  const at = 'core/abilities.js', out = { ABILITIES: [], ABILITY_KEYS: [], ROLE_PERMS: { owner: [], manager: [], staff: [] } }, rp = (shop && shop.ROLE_PERMS) || {};
  ((shop && shop.ABILITIES) || []).forEach(function (a, i) { if (!Array.isArray(a)) throw new Error(at + ': ABILITIES[' + i + '] is [key, words]'); addOne(out, a[0], a[1], at); });
  Object.keys(rp).forEach(function (r) { if (ROLES.indexOf(r) < 0) throw new Error(at + ': ROLE_PERMS names "' + r + '", which is not a role (' + ROLES.join(', ') + ')'); });
  ROLES.forEach(function (r) {
    (rp[r] || []).forEach(function (k) {
      if (out.ABILITY_KEYS.indexOf(k) < 0) throw new Error(at + ': ROLE_PERMS.' + r + ' names "' + k + '", which is not in its ABILITIES');
      if (out.ROLE_PERMS[r].indexOf(k) < 0) out.ROLE_PERMS[r].push(k);
    });
  });
  return out;
}
const START = abilitiesFrom(require('./abilities'));
const ABILITIES = START.ABILITIES, ABILITY_KEYS = START.ABILITY_KEYS, ROLE_PERMS = START.ROLE_PERMS;
/* @permission @employee @owner — a module's new ability: its key, the words the Admin screen shows, and the roles that have it until the shop changes them (the owner always).
   ⚠️ Call it where the HUB loads it too — from the module's aggregates/ file, which the hub and the tablets both load — never only from
   a core/ kit the tablet alone has. The hub judges every person's change and every role list by its own list (review 11/1): an
   ability only the tablet knows makes the hub refuse the whole save that names it — a role list, or a person's change (even making
   them inactive) — while the tablet that recorded it has already applied it. */
function addAbility(key, label, roles) {
  (roles || []).forEach(function (r) { if (ROLES.indexOf(r) < 0) throw new Error('staff.addAbility: "' + r + '" is not a role (' + ROLES.join(', ') + ')'); });
  addOne(START, key, label, 'staff.addAbility');
  ['owner'].concat(roles || []).forEach(function (r) { if (ROLE_PERMS[r].indexOf(key) < 0) ROLE_PERMS[r].push(key); });
}

/* v1 rolePerms: the shop's own list for the role, else the built-in default */
/* @permission @employee — v1 rolePerms: what a role may do — the shop's own list for it, else v1's built-in default */
function rolePerms(roles, role) { return (roles && roles[role]) || ROLE_PERMS[role] || []; }
/* v1 can(): the owner always; a per-person override when there is one; else the role */
/* @permission @employee @owner — v1 can(): may this person do this — the owner always, then their own override, then their role */
function can(emp, a, roles) {
  const r = emp ? emp.role : null; if (!r) return false; if (r === 'owner') return true;
  if (emp.perms && emp.perms[a] !== undefined) return !!emp.perms[a];
  return rolePerms(roles, r).indexOf(a) >= 0;
}
/* @permission @owner — v1 isOwner: is this person an owner (the role, never a per-person override) */
function isOwner(emp) { return !!emp && emp.role === 'owner'; }

/* ---------------- PINs ---------------- */
const PIN_ITER = 20000;   /* the cost of every PIN hash made before 9/25 — a record without `iter` was made at this */
/* E65 (9/25): a PIN hash made today costs PIN_ITER_NOW rounds (5× the old — about 25 ms on a desktop, a few times that on a
   tablet; a PIN box checks the candidates at once, so a wrong PIN still answers in well under a second). The record carries
   its own cost ({salt, hash, iter}), so an old hash keeps working and is made again at today's cost on its owner's next good
   PIN (station/app.js pinRehash). ⚠️ Said plainly: no cost makes a 4-digit PIN secret from someone holding the log (10,000
   tries); it multiplies their work by 5. Two more digits multiply it by 100 — an owner decision. */
const PIN_ITER_NOW = 100000;
const PIN_ITER_MAX = 1000000;   /* the most a record may ask for (aggregates/staff.js): a PIN box must never be made to hang */
/* @employee @permission — E65: the rounds a PIN record was made with (an old record, or a nonsense one, is the old cost) */
function pinIter(rec) { const n = rec && rec.iter; return (Number.isInteger(n) && n >= PIN_ITER && n <= PIN_ITER_MAX) ? n : PIN_ITER; }
/* @employee @permission — E65: a PIN hash made at less than today's cost, to be made again on that person's next good PIN */
function pinStale(rec) { return !!(rec && rec.salt && rec.hash) && pinIter(rec) < PIN_ITER_NOW; }
/* @employee @input — a PIN as typed, trimmed (v1 empByPin / saveEmployee trim what was TYPED, never what is stored) */
function pinText(pin) { return String(pin == null ? '' : pin).trim(); }           // v1 empByPin / saveEmployee trim what was TYPED
/* @employee @permission — v1 saveEmployee's rule: a PIN is at least 4 digits, digits only */
function pinValid(pin) { return /^[0-9]{4,}$/.test(pin); }                          // v1 saveEmployee: at least 4 digits
/* @employee — hex text to bytes (a PIN record's salt, for the browser's PBKDF2) */
function hexBytes(h) { const b = new Uint8Array(h.length / 2); for (let i = 0; i < b.length; i++) b[i] = parseInt(h.substr(i * 2, 2), 16); return b; }
/* @employee — bytes to hex text (a PIN hash as the record keeps it) */
function toHex(buf) { return Array.prototype.map.call(new Uint8Array(buf), function (x) { return ('0' + x.toString(16)).slice(-2); }).join(''); }
/* the hash of a PIN exactly as it is held (v1 compares the stored PIN exactly; only what is typed is trimmed).
   In Node (the feed, the tests) — the same bytes as the browser's: */
/* @employee @permission — a PIN's hash at the record's own cost (E65: iter; none is the old 20,000); costs one PBKDF2 */
function pinHashSync(pin, salt, iter) { return require('crypto').pbkdf2Sync(String(pin == null ? '' : pin), Buffer.from(salt, 'hex'), iter || PIN_ITER, 32, 'sha256').toString('hex'); }   /* iter: the record's own cost (pinIter) — none is the old cost */
/* anywhere: the browser's own PBKDF2 (a station), else Node's */
/* @employee @permission — the same hash on a tablet (the browser's own PBKDF2), at the record's own cost (E65) */
async function pinHash(pin, salt, iter) {
  const sub = typeof globalThis !== 'undefined' && globalThis.crypto && globalThis.crypto.subtle;
  if (!sub) return pinHashSync(pin, salt, iter);
  const key = await sub.importKey('raw', new TextEncoder().encode(String(pin == null ? '' : pin)), 'PBKDF2', false, ['deriveBits']);
  return toHex(await sub.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: hexBytes(salt), iterations: iter || PIN_ITER }, key, 256));
}
/* @employee @permission — 16 random bytes for a new PIN record's salt (the browser's crypto, else Node's) */
function newSalt() {
  const b = new Uint8Array(16);
  if (typeof globalThis !== 'undefined' && globalThis.crypto && globalThis.crypto.getRandomValues) globalThis.crypto.getRandomValues(b);
  else { const r = require('crypto').randomBytes(16); for (let i = 0; i < 16; i++) b[i] = r[i]; }
  return toHex(b);
}
/* what the log keeps for a PIN: never the PIN */
/* @employee @permission — a new PIN record {salt, hash, iter} at today's cost (E65); never the PIN */
async function pinRecord(pin, salt) { salt = salt || newSalt(); return { salt: salt, hash: await pinHash(pin, salt, PIN_ITER_NOW), iter: PIN_ITER_NOW }; }   /* E65: today's cost, written down */
/* @employee @permission — the same record, in Node (the feed, the proofs) */
function pinRecordSync(pin, salt) { salt = salt || newSalt(); return { salt: salt, hash: pinHashSync(pin, salt, PIN_ITER_NOW), iter: PIN_ITER_NOW }; }
/* @employee @permission — does this person have a PIN on file (a salted hash, never the PIN) */
function hasPin(e) { return !!(e && e.pin && e.pin.salt && e.pin.hash); }
/* v1 empByPin: the FIRST active employee (optionally owners only) whose PIN it is; nothing for an empty PIN */
/* @employee @permission — who a typed PIN may belong to: active people with a PIN on file (owners only when asked), in v1's order */
function pinCandidates(employees, opts) { opts = opts || {}; return (employees || []).filter(function (x) { return hasPin(x) && x.active !== false && (!opts.ownerOnly || x.role === 'owner'); }); }
/* @employee @permission — v1 empByPin: who this PIN is, each record checked at its own cost, all at once (E65); v1's first match wins */
async function empByPin(pin, employees, opts) {
  pin = pinText(pin); if (!pin) return null;
  const list = pinCandidates(employees, opts);
  const got = await Promise.all(list.map(function (x) { return pinHash(pin, x.pin.salt, pinIter(x.pin)); }));   /* E65: all at once (the browser's crypto runs them side by side); still v1's FIRST match in list order */
  for (let i = 0; i < list.length; i++) if (got[i] === list[i].pin.hash) return list[i];
  return null;
}
/* @employee @permission — the same, in Node (the proofs against v1's own empByPin) */
function empByPinSync(pin, employees, opts, hashFn) {
  pin = pinText(pin); if (!pin) return null; hashFn = hashFn || pinHashSync;
  const list = pinCandidates(employees, opts);
  for (let i = 0; i < list.length; i++) if (hashFn(pin, list[i].pin.salt, pinIter(list[i].pin)) === list[i].pin.hash) return list[i];
  return null;
}
/* is this PIN already someone else's? (v1 saveEmployee refuses it — against EVERY employee, active or not) */
/* @employee @permission — v1 saveEmployee's taken-PIN check, each record at its own cost (E65) */
async function pinTaken(pin, employees, exceptId) {
  pin = pinText(pin);
  const list = (employees || []).filter(function (x) { return hasPin(x) && x.id !== exceptId; });
  for (let i = 0; i < list.length; i++) if (await pinHash(pin, list[i].pin.salt, pinIter(list[i].pin)) === list[i].pin.hash) return list[i];
  return null;
}

/* ---------------- E65 (9/25 — v2's own guard; v1 has no limit): a tablet's wrong-PIN lock ----------------
   FREE wrong PINs on one tablet, then each further wrong PIN locks every PIN box on that tablet for LOCK_MS, doubling each
   time up to MAX_MS. The count starts again only after QUIET_MS with no wrong PIN — a good PIN does NOT clear it, or anyone
   who knows their own PIN could reset the lock between guesses at the owner's. A mistyped PIN or two is never locked.
   QUIET_MS is 15 minutes (skeptic, 9/25; the builder had an hour): with an hour, a shared counter tablet whose staff mistype a
   PIN every half hour or so — an ordinary day — kept one count all day and locked the time clock and every approval for 15
   minutes at a time by afternoon. With 15 minutes only a burst locks; a guesser at the counter still waits weeks for 10,000. */
const PIN_GUARD = { FREE: 5, LOCK_MS: 30000, MAX_MS: 15 * 60000, QUIET_MS: 15 * 60000 };
/* @permission @employee — E65: how long this tablet's PIN boxes stay locked, in ms (0: open). g = the tablet's guard, or nothing. */
function pinLockLeft(g, now) { return (g && g.until > now) ? g.until - now : 0; }
/* @permission @employee — E65: a wrong PIN on this tablet: the guard after it ({n, at, until, lockMs}). Costs nothing to keep. */
function pinGuardWrong(g, now) {
  const n = ((g && g.at && now - g.at < PIN_GUARD.QUIET_MS) ? (Number(g.n) || 0) : 0) + 1;
  const lockMs = n >= PIN_GUARD.FREE ? Math.min(PIN_GUARD.MAX_MS, PIN_GUARD.LOCK_MS * Math.pow(2, n - PIN_GUARD.FREE)) : 0;
  return { n: n, at: now, until: lockMs ? now + lockMs : 0, lockMs: lockMs };
}

/* v1 saveEmployee's refusals, in v1's order. change = {name, role, pin?, active}; pinTakenBy = who already has the
   PIN (from pinTaken), or null. Returns the words v1 shows, or null when the save may go ahead. */
/* @employee @permission @owner — v1 saveEmployee's refusals: a name, a 4-digit PIN nobody else has, and never the shop's last active owner removed */
function employeeSaveCheck(employees, id, change, pinTakenBy) {
  const name = String(change.name || '').trim();
  if (!name) return 'Enter a name';
  if (change.pin != null && !pinValid(pinText(change.pin))) return 'PIN must be at least 4 digits';
  if (change.pin != null && pinTakenBy) return 'That PIN is already used by someone else';
  const e = id ? (employees || []).filter(function (x) { return x.id === id; })[0] : null;
  if (e && e.role === 'owner') {                                    // never leave the shop with no active owner
    const others = (employees || []).filter(function (x) { return x.id !== id && x.role === 'owner' && x.active !== false; }).length;
    if (others === 0 && (change.role !== 'owner' || change.active === false)) return 'You can\'t remove the last active owner';
  }
  return null;
}

/* @permission @hub @employee — THE PIN DOUBLE CHECK (E30; owner 9/25: "YES! PIN double check"): the privileged facts the HUB admits
   only with a PIN it checked itself (hub/pingrant.js) — people, roles, store credit given or taken, payroll edits. A clock-in or
   clock-out is not among them: nobody is kept off the clock by the internet. The station sends its grants for these; the hub asks.
   Owner 9/26 ("build the refund rule"): money given back and debt taken off are privileged too — the owner's approval of a refund,
   a refund, a payment voided or reversed, a correction to what a customer owes (hub/authority.js refundRule / adjustRule). Every
   tablet door that writes one is behind a PIN — the PIN box at the button (refunds, approvals, reversals) or the PIN that opened
   the screen (the owner's write-off and account credit). A grant that has ended holds the change on the tablet until that
   person's next PIN sends it, as for the other privileged facts. */
const PIN_CHECKED = ['employee.set', 'staff.roles', 'credit.issued', 'credit.removed', 'clock.manual', 'clock.edit', 'clock.void',
  'order.refundDecided', 'payment.refunded', 'payment.voided', 'charge.adjusted'];
PIN_CHECKED.push('card.removed');   /* owner 10/18 ("Server checks PIN on risky actions"): a saved card taken off file — the 🗑 asks a manager's PIN, and the hub erases the token of every card a fact says was removed */

module.exports = {
  PIN_CHECKED: PIN_CHECKED,
  ROLE_PERMS: ROLE_PERMS, ABILITIES: ABILITIES, ABILITY_KEYS: ABILITY_KEYS, ROLES: ROLES, addAbility: addAbility, abilitiesFrom: abilitiesFrom, PIN_ITER: PIN_ITER,
  PIN_ITER_NOW: PIN_ITER_NOW, PIN_ITER_MAX: PIN_ITER_MAX, pinIter: pinIter, pinStale: pinStale, PIN_GUARD: PIN_GUARD, pinLockLeft: pinLockLeft, pinGuardWrong: pinGuardWrong,   /* E65 */
  rolePerms: rolePerms, can: can, isOwner: isOwner,
  pinText: pinText, pinValid: pinValid, pinHash: pinHash, pinHashSync: pinHashSync, newSalt: newSalt, pinRecord: pinRecord, pinRecordSync: pinRecordSync, hasPin: hasPin,
  empByPin: empByPin, empByPinSync: empByPinSync, pinTaken: pinTaken, employeeSaveCheck: employeeSaveCheck
};
