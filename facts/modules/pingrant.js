/* @facts @permission @hub — THE PIN THE HUB CHECKS: a person's PIN, checked by the hub itself, earns that person on that tablet a short
   signed pass (a grant); the facts that need it (pin: true in a module) travel with it, and without one the hub refuses them.
   This repo's own file, rebuilt from the origin shop's design. Why: every person-naming fact carries the name a tablet put on it, so a
   stolen tablet could name the owner. The hub now asks for the PIN itself. A tablet sends the PIN it was just given, over HTTPS, once —
   it is never written anywhere — and the hub checks it against that person's PIN hash from the staff facts.
     grant = { staffId, station, since, until, sig }   sig = HMAC-SHA256(the hub's own secret, those fields)
   A grant names one person on one tablet and lasts TTL (30 minutes). A fact is admitted with it when the fact was MADE inside the grant's
   time and arrives no later than GRACE (2 hours) after it ends, so a tablet that was briefly offline still delivers, and a lost
   tablet's leftover pass dies within hours. Wrong PINs: FREE_TRIES per tablet and person, then that pair is locked for LOCK_MS.
   The secret is made once (32 random bytes) in the hub's data folder (pin-grant.key, owner-only) or given by the caller; it never
   leaves the hub. Said plainly: a PIN is short and every tablet holds the PIN hashes, so someone with a stolen tablet and time could
   still work one out offline — revoke a lost tablet at once (POST /v2/admin/revoke). */
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { pinMatches } = require('./staff');

const TTL_MS = 30 * 60000, GRACE_MS = 2 * 3600000, FREE_TRIES = 5, LOCK_MS = 15 * 60000;
const MAX_GRANTS = 4, MAX_TRIES = 5000, ID = /^[A-Za-z0-9_.:-]{1,64}$/;

/* @facts @permission @hub — the hub's grants. o: { secret (a caller's own) | dataDir (pin-grant.key there), now } */
function grantsFor(o) {
  o = o || {};
  const now = o.now || Date.now, file = o.dataDir ? path.join(o.dataDir, 'pin-grant.key') : null;
  let secret = o.secret ? Buffer.from(String(o.secret)) : null;
  const tries = new Map();   /* station|staffId → { n, lockedUntil } */
  /* @facts @permission @storage — the hub's own secret: from its file, or made once (owner-only file) */
  function key() {
    if (secret) return secret;
    if (file) { try { const t = fs.readFileSync(file, 'utf8').trim(); if (/^[0-9a-f]{64}$/.test(t)) { secret = Buffer.from(t, 'hex'); return secret; } } catch (e) {} }
    const s = crypto.randomBytes(32);
    if (file) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, s.toString('hex') + '\n', { mode: 0o600 }); }
    secret = s; return secret;
  }
  const sign = function (g) { return crypto.createHmac('sha256', key()).update(['grant1', g.staffId, g.station, g.since, g.until].join('|')).digest('hex'); };
  /* @facts @permission — a PIN typed at a tablet, checked: {grant} or {refused}. staff: the hub's staff list ({byId}) */
  /* the wrong-PIN tracker stays small (stage-2 review: a stolen tablet sending made-up staff ids grew it by ~190 MB): a staff id that is
     not an id is refused before anything is kept; every unknown person on a tablet shares ONE bucket; spent entries are pruned, and the map
     is capped (the oldest go first) */
  function pruneTries(at) {
    if (tries.size < 500) return;
    tries.forEach(function (t, k) { if (t.lockedUntil <= at && t.at + LOCK_MS <= at) tries.delete(k); });
    while (tries.size > MAX_TRIES) tries.delete(tries.keys().next().value);
  }
  function issue(staff, staffId, station, pin) {
    if (typeof staffId !== 'string' || !ID.test(staffId)) return { refused: 'that PIN is not right' };   /* the same answer: nothing to learn */
    const at = now(), who = staff.byId.get(staffId), k = station + '|' + (who ? staffId : '?'), t = tries.get(k) || { n: 0, lockedUntil: 0, at: at };
    if (t.lockedUntil > at) return { refused: 'too many wrong PINs — try again in ' + Math.ceil((t.lockedUntil - at) / 60000) + ' min' };
    if (!who || who.active === false || !who.pin || !pinMatches(who.pin, pin)) {
      t.n++; t.at = at; if (t.n >= FREE_TRIES) { t.lockedUntil = at + LOCK_MS; t.n = 0; } tries.delete(k); tries.set(k, t); pruneTries(at);
      return { refused: 'that PIN is not right' };   /* one answer for a wrong PIN, an unknown person or no PIN: nothing to learn from it */
    }
    tries.delete(k);
    const g = { staffId: staffId, station: String(station), since: at, until: at + TTL_MS }; g.sig = sign(g);
    return { grant: g };
  }
  /* signatures already checked, so a send's grants are verified once each, not once per fact (a small, bounded memo) */
  const good = new Map();
  /* @facts @permission — is there a good grant among those a send carried, for this person on this tablet, for this fact? Only the first
     MAX_GRANTS that name this person and tablet are looked at (stage-2 review: 150 junk grants stalled the hub for 30 s) */
  function check(grants, staffId, station, e) {
    const at = now(), made = e && e.hlc && typeof e.hlc.t === 'number' ? e.hlc.t : (e && typeof e.at === 'number' ? e.at : at);
    const mine = (Array.isArray(grants) ? grants.slice(0, 64) : []).filter(function (g) { return g && typeof g === 'object' && g.staffId === String(staffId) && g.station === String(station); }).slice(0, MAX_GRANTS);
    return mine.some(function (g) {
      if (!(typeof g.since === 'number' && typeof g.until === 'number' && typeof g.sig === 'string' && /^[0-9a-f]{64}$/.test(g.sig))) return false;
      if (!(made >= g.since && made <= g.until && at <= g.until + GRACE_MS)) return false;
      const k = g.sig + '|' + g.staffId + '|' + g.station + '|' + g.since + '|' + g.until;
      if (good.has(k)) return true;
      const want = Buffer.from(sign(g), 'hex'), got = Buffer.from(g.sig, 'hex');
      if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) return false;
      good.set(k, true); if (good.size > 256) good.delete(good.keys().next().value);
      return true;
    });
  }
  return { issue: issue, check: check, triesSize: function () { return tries.size; } };
}

module.exports = { grantsFor: grantsFor, TTL_MS: TTL_MS, GRACE_MS: GRACE_MS, FREE_TRIES: FREE_TRIES, LOCK_MS: LOCK_MS };
