/* @facts @module @permission — THE STAFF MODULE: the shop's people, their role, their rights and their PIN, as facts; the one list the hub
   judges every person-naming fact by (facts/modules/define.js asks it). This repo's own file, rebuilt from the origin shop's rules.
     staff.set  {staffId, set: {name?, role? (owner|manager|staff), rights? [word…], active?, pin? {salt, hash, iter} | null}}
                — field by field, the latest of each wins. A PIN is only ever a salted PBKDF2-SHA256 hash, never the digits.
   Who may write one (authority self-or:employees, with a PIN the hub checked):
     · someone holding "employees", or an owner, may add or change anyone — except that only an OWNER makes or changes an owner;
     · a person may change only their OWN PIN (any other field about themselves needs "employees").
   A brand-new shop with nobody on staff admits its first facts, so the first owner can be written (define.js). */
'use strict';
const crypto = require('crypto');
const { defineModule } = require('./define');

const ROLES = ['owner', 'manager', 'staff'];
const RIGHT = /^[a-z][a-z0-9-]{0,39}$/;
const PIN_ITER = 100000, PIN_ITER_MIN = 20000, PIN_ITER_MAX = 1000000;
const HEX = function (n) { return new RegExp('^[0-9a-f]{' + n + '}$'); };

/* @facts @employee — why a staff.set payload is malformed, or null */
function validate(p) {
  if (typeof p.staffId !== 'string' || !/^[A-Za-z0-9_.:-]{1,64}$/.test(p.staffId)) return 'staffId names the person (letters, digits, _ . : -)';
  const s = p.set; if (!s || typeof s !== 'object' || Array.isArray(s) || !Object.keys(s).length) return 'set names at least one field';
  const bad = Object.keys(s).filter(function (k) { return ['name', 'role', 'rights', 'active', 'pin'].indexOf(k) < 0; }); if (bad.length) return 'unknown field: ' + bad[0];
  if (s.name != null && !(typeof s.name === 'string' && s.name.trim() && s.name.length <= 60)) return 'name is 1 to 60 characters';
  if (s.role != null && ROLES.indexOf(s.role) < 0) return 'role is ' + ROLES.join(', ');
  if (s.rights != null && !(Array.isArray(s.rights) && s.rights.length <= 40 && s.rights.every(function (r) { return RIGHT.test(String(r)); }))) return 'rights is a list of short lower-case words';
  if (s.active != null && typeof s.active !== 'boolean') return 'active is true or false';
  if (s.pin != null && !(s.pin && HEX(32).test(String(s.pin.salt)) && HEX(64).test(String(s.pin.hash)) && Number.isInteger(s.pin.iter) && s.pin.iter >= PIN_ITER_MIN && s.pin.iter <= PIN_ITER_MAX)) return 'pin is {salt (32 hex), hash (64 hex), iter} — a hash, never the digits';
  return null;
}
/* @facts @fold @employee — the people, from their facts: { byId: Map(id → {id, name, role, rights, active, pin}) } */
function fold(evs) {
  const byId = new Map();
  evs.forEach(function (e) {
    if (e.type !== 'staff.set') return;
    const p = e.payload || {}, was = byId.get(p.staffId) || { id: p.staffId, name: p.staffId, role: 'staff', rights: [], active: true, pin: null };
    const now = Object.assign({}, was, p.set); now.id = p.staffId; if (p.set.rights) now.rights = p.set.rights.slice();
    byId.set(p.staffId, now);
  });
  return { byId: byId };
}
/* @facts @permission — an owner holds every right; anyone else, the rights written on them */
function isOwner(who) { return !!who && who.role === 'owner' && who.active !== false; }
function can(who, right) { return isOwner(who) || (!!who && who.active !== false && (who.rights || []).indexOf(right) >= 0); }

/* @facts @permission @employee — the staff module's own rule, after self-or:employees passed: owners, and one's own PIN */
function rule(p, who, staff) {
  const s = p.set || {}, target = staff.byId.get(p.staffId) || null;
  if ((s.role === 'owner' || (target && target.role === 'owner')) && !isOwner(who)) return 'only an owner makes or changes an owner';
  if (String(p.staffId) === String(who.id) && !can(who, 'employees') && Object.keys(s).some(function (k) { return k !== 'pin'; })) return who.name + ' may change only their own PIN';
  /* the shop always keeps an active owner: the last one may not be demoted or switched off (stage-2 review: it could, and then nobody
     could ever make an owner again) */
  if (target && target.role === 'owner' && target.active !== false && ((s.role != null && s.role !== 'owner') || s.active === false)) {
    let others = 0; staff.byId.forEach(function (x) { if (x.id !== target.id && x.role === 'owner' && x.active !== false) others++; });
    if (!others) return 'the shop must keep an active owner — make someone else an owner first';
  }
  return null;
}
/* @facts @employee — what a brand-new shop's first fact must be: its owner, active (define.js asks before anyone is on staff) */
function firstOk(e) { const s = e && e.type === 'staff.set' && e.payload && e.payload.set; return !!(s && s.role === 'owner' && s.active !== false); }

/* @facts @employee — a PIN made into its record (Node; a browser makes the same with WebCrypto PBKDF2) */
function pinRecord(pin, salt) { salt = salt || crypto.randomBytes(16).toString('hex'); return { salt: salt, hash: crypto.pbkdf2Sync(String(pin), Buffer.from(salt, 'hex'), PIN_ITER, 32, 'sha256').toString('hex'), iter: PIN_ITER }; }
/* @facts @employee — does a PIN match its record (constant-time compare) */
function pinMatches(rec, pin) {
  if (!rec || !HEX(32).test(String(rec.salt)) || !HEX(64).test(String(rec.hash))) return false;
  const iter = Number.isInteger(rec.iter) && rec.iter >= PIN_ITER_MIN && rec.iter <= PIN_ITER_MAX ? rec.iter : PIN_ITER;
  const got = crypto.pbkdf2Sync(String(pin == null ? '' : pin), Buffer.from(rec.salt, 'hex'), iter, 32, 'sha256');
  return crypto.timingSafeEqual(got, Buffer.from(rec.hash, 'hex'));
}

/* the same two in a BROWSER (Unit 2.4): WebCrypto's PBKDF2, asynchronous; Node 20+ has the same globalThis.crypto.subtle, so a proof
   checks the browser's hash equals the hub's */
const subtleOf = function (s) { const c = s || (typeof globalThis !== 'undefined' && globalThis.crypto && globalThis.crypto.subtle); if (!c) throw new Error('no WebCrypto here (crypto.subtle) — a PIN cannot be hashed'); return c; };
const toHex = function (buf) { return Array.prototype.map.call(new Uint8Array(buf), function (b) { return ('0' + b.toString(16)).slice(-2); }).join(''); };
const fromHex = function (h) { const a = new Uint8Array(h.length / 2); for (let i = 0; i < a.length; i++) a[i] = parseInt(h.substr(i * 2, 2), 16); return a; };
/* @facts @employee — a PIN's hash in a browser (WebCrypto PBKDF2-SHA256), the same bytes pinRecord makes in Node */
async function pinHashAsync(pin, saltHex, iter, subtle) {
  const s = subtleOf(subtle), key = await s.importKey('raw', new TextEncoder().encode(String(pin == null ? '' : pin)), 'PBKDF2', false, ['deriveBits']);
  return toHex(await s.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: fromHex(saltHex), iterations: iter }, key, 256));
}
/* @facts @employee — a PIN made into its record, in a browser (a random salt from crypto.getRandomValues) */
async function pinRecordAsync(pin, subtle) { const salt = new Uint8Array(16); globalThis.crypto.getRandomValues(salt); const sh = toHex(salt); return { salt: sh, hash: await pinHashAsync(pin, sh, PIN_ITER, subtle), iter: PIN_ITER }; }
/* @facts @employee — does a PIN match its record, in a browser */
async function pinMatchesAsync(rec, pin, subtle) {
  if (!rec || !HEX(32).test(String(rec.salt)) || !HEX(64).test(String(rec.hash))) return false;
  const iter = Number.isInteger(rec.iter) && rec.iter >= PIN_ITER_MIN && rec.iter <= PIN_ITER_MAX ? rec.iter : PIN_ITER;
  const got = await pinHashAsync(pin, rec.salt, iter, subtle); let diff = 0; for (let i = 0; i < 64; i++) diff |= got.charCodeAt(i) ^ String(rec.hash).charCodeAt(i); return diff === 0;
}

/* the hub reads the list often (every person-naming fact): the facts already read are kept, and only new ones are added */
const memo = { seen: 0, facts: [], first: null, list: null, n: -1 };
/* @facts @fold @permission — the staff list as the hub judges by it: its facts so far, with this send's own laid on top */
function staffNow(master, staged) {
  if (master.length < memo.seen || (master.length && memo.first !== master[0])) { memo.seen = 0; memo.facts = []; memo.n = -1; memo.first = master[0] || null; }
  for (; memo.seen < master.length; memo.seen++) { const m = master[memo.seen]; if (m.type === 'staff.set') memo.facts.push(m); }
  const mine = (staged || []).filter(function (x) { return x.type === 'staff.set'; });
  let list;
  if (mine.length) list = fold(memo.facts.concat(mine));
  else { if (memo.n !== memo.facts.length) { memo.list = fold(memo.facts); memo.n = memo.facts.length; } list = memo.list; }
  return { byId: list.byId, isOwner: isOwner, can: can };
}

const STAFF = defineModule({
  name: 'staff', version: 1, layer: 'core',
  aggregate: { name: 'staff', fold: fold, doc: 'the shop\'s people: name, role, rights, active, PIN hash' },
  facts: { 'staff.set': { authority: 'self-or:employees', pin: true, rule: rule, validate: validate, creates: ['staffId'],
    doc: 'A person added or changed, field by field. payload {staffId, set: {name?, role?, rights?, active?, pin? {salt, hash, iter}}}' } },
  views: { list: function (facts) { return fold(facts); } },
  provides: { staff: staffNow, firstOk: firstOk }
});

module.exports = { STAFF: STAFF, fold: fold, isOwner: isOwner, can: can, pinRecord: pinRecord, pinMatches: pinMatches, validate: validate, ROLES: ROLES,
  pinRecordAsync: pinRecordAsync, pinMatchesAsync: pinMatchesAsync, pinHashAsync: pinHashAsync };
