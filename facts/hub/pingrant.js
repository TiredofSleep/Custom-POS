'use strict';
/* ============================================================================
 * THE PIN DOUBLE CHECK — the hub checks the PIN for every privileged fact (E30; owner 9/25: "YES! PIN double check")
 * @permission @hub @employee @owner — a person's PIN, checked by the HUB, grants that person on that tablet a short signed pass;
 * the privileged facts they write travel with it, and without one the hub refuses them
 * ----------------------------------------------------------------------------
 * hub/authority.js already refuses a privileged fact that names someone without the right. What it could not stop is a stolen
 * tablet (or its key) writing those facts NAMING THE OWNER: every tablet holds the staff list. The hub now asks for the PIN
 * itself: a tablet sends the PIN it was just given (over HTTPS, once — it is never written anywhere) and the hub checks it
 * against the person's own PIN record, with the same hash the tablets use (core/staff.js pinHash). A good PIN earns a GRANT:
 *   { emp, station, since, exp, sig } — sig = HMAC-SHA256(the hub's own secret, those fields). It names one person on one
 *   tablet, lasts TTL (30 minutes), and is renewed (without the PIN) while it is still good, up to MAX_SESSION (12 hours)
 *   from the PIN that began it. The secret lives in the hub's data folder (pin-grant.key, 0600) and never leaves the hub.
 * A privileged fact (core/staff.js PIN_CHECKED — people, roles, store credit, payroll edits) is admitted only with a grant for
 * the person it names, from the tablet that sent it, for a fact dated inside the grant (never after it ends) and sent no
 * later than GRACE (2 hours) after it ends — so a tablet that was offline a while still delivers, and a lost tablet's
 * leftover pass dies within hours. A clock-in or clock-out is NOT checked here: nobody is ever kept off the clock by the
 * internet. Wrong PINs: five free per tablet and person, then that pair is locked 15 minutes, and the owner is told once.
 * ⚠️ What this cannot do (said plainly): a PIN is four digits and every tablet holds the PIN records, so someone with a stolen
 * tablet and time can still work a PIN out offline — revoke a lost tablet at once (POST /v2/admin/revoke).
 * ========================================================================== */
const crypto = require('crypto'), fs = require('fs'), path = require('path');
const TTL_MS = 30 * 60000, MAX_SESSION_MS = 12 * 3600000, GRACE_MS = 2 * 3600000, FREE_TRIES = 5, LOCK_MS = 15 * 60000;
const DOOR_MS = 30 * 60000;   /* owner 10/18: a risky door (hub/riskdoors.js) takes a PIN entered within this long — never a renewed pass */

/* @permission @hub — the hub's PIN grants. o: {dataDir (the secret's folder), secret (a proof's own, instead of the file), now, alert(a)} */
function grantsFor(o) {
  o = o || {};
  const now = o.now || Date.now, file = o.dataDir ? path.join(o.dataDir, 'pin-grant.key') : null;
  let secret = o.secret ? Buffer.from(String(o.secret)) : null;
  /* @permission @hub @storage — the hub's own secret: read from its file, or made once (32 random bytes, owner-only file) */
  function key() {
    if (secret) return secret;
    if (file) { try { const t = fs.readFileSync(file, 'utf8').trim(); if (/^[0-9a-f]{64}$/.test(t)) { secret = Buffer.from(t, 'hex'); return secret; } } catch (e) {} }
    const s = crypto.randomBytes(32);
    if (file) { try { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, s.toString('hex') + '\n', { mode: 0o600 }); } catch (e) {} }
    secret = s; return secret;
  }
  const sign = function (g) { return crypto.createHmac('sha256', key()).update(['g1', g.emp, g.station, g.since, g.exp].join('|')).digest('hex'); };
  const make = function (emp, station, since) { const g = { emp: String(emp), station: String(station), since: since, exp: now() + TTL_MS }; g.sig = sign(g); return g; };
  const tries = new Map();   /* station|emp → {n, first, lockedUntil, told} — wrong PINs, in memory */
  /* @permission @hub — is this a grant the hub signed, for this person on this tablet? null, or why not */
  function genuine(g, station, emp) {
    if (!g || typeof g !== 'object' || typeof g.sig !== 'string' || !Number.isInteger(g.exp) || !Number.isInteger(g.since)) return 'no PIN grant from the hub';
    const want = sign(g), sb = Buffer.from(g.sig), wb = Buffer.from(want); if (sb.length !== wb.length || !crypto.timingSafeEqual(sb, wb)) return 'a PIN grant the hub did not sign';   /* 10/18: compared by BYTES — a signature of 64 characters that are not all one byte made timingSafeEqual throw (a hub error, not the plain refusal) */
    if (g.station !== String(station)) return 'a PIN grant from another tablet';
    if (emp != null && g.emp !== String(emp)) return 'a PIN grant for someone else';
    return null;
  }
  /* @permission @hub — may this fact (by emp, from station, dated at) pass on grant g? null, or why not */
  function verify(g, station, emp, at) {
    const bad = genuine(g, station, emp); if (bad) return bad;
    if (Number(at) > g.exp) return 'the PIN grant had ended before this was done';
    if (now() > g.exp + GRACE_MS) return 'the PIN grant ended more than 2 hours ago';
    return null;
  }
  /* @permission @hub @employee — a PIN typed on a tablet, checked by the hub against the person's own record: a grant, or why not.
     staff: the hub's fold of the staff facts; pinHash(pin, salt, iter) → Promise<hex> (core/staff.js) */
  function check(station, empId, pin, staff, pinHash, pinIter) {
    const k = String(station) + '|' + String(empId), t = now(), tr = tries.get(k);
    if (tr && tr.lockedUntil > t) return Promise.resolve({ ok: false, refused: 'too many wrong PINs for this person on this tablet — try again in ' + Math.ceil((tr.lockedUntil - t) / 1000) + ' s', retryMs: tr.lockedUntil - t });
    const who = staff && staff.byId ? staff.byId.get(String(empId)) : null;
    if (!who || who.active === false || !who.pin || !who.pin.salt || !who.pin.hash) return Promise.resolve({ ok: false, refused: 'no active employee with a PIN by that id' });
    return Promise.resolve(pinHash(String(pin == null ? '' : pin), who.pin.salt, pinIter ? pinIter(who.pin) : undefined)).then(function (h) {
      if (h === who.pin.hash) { tries.delete(k); return { ok: true, grant: make(who.id, station, now()) }; }
      const x = tries.get(k) && now() - tries.get(k).first < LOCK_MS ? tries.get(k) : { n: 0, first: now(), lockedUntil: 0, told: false }; x.n++;
      if (x.n >= FREE_TRIES) { x.lockedUntil = now() + LOCK_MS; if (!x.told && o.alert) { x.told = true; try { o.alert({ key: 'pin-grant-locked:' + k, kind: 'pin-locked', station: String(station), note: '🔒 ' + x.n + ' wrong PINs for ' + (who.name || empId) + ' on tablet ' + station + ' — the hub refuses that person\'s privileged changes from it for 15 minutes. If this was not a fumble, revoke the tablet (Admin → Devices).' }); } catch (e) {} } }
      tries.set(k, x);
      return { ok: false, refused: 'wrong PIN' };
    });
  }
  /* @permission @hub — a RISKY DOOR (owner 10/18: "Server checks PIN on risky actions" — a card refund or void, a group text, a new
     device's setup code, a saved card erased; hub/riskdoors.js): a grant the hub signed, for this tablet, still good NOW, from a PIN
     typed in the last DOOR_MS (30 minutes). A renewal keeps its PIN's time (since), so it never stretches a door the way it may
     stretch a privileged fact's pass — a lost tablet's leftover pass opens none of these. null, or why not */
  function door(g, station) {
    const bad = genuine(g, station, null); if (bad) return bad;
    if (now() > g.exp) return 'the PIN pass has ended';
    if (now() - g.since > DOOR_MS) return 'the PIN was entered more than 30 minutes ago';
    return null;
  }
  /* @permission @hub — a grant still good, renewed without the PIN (the person keeps working), up to 12 hours from the PIN */
  function renew(g, station) {
    const bad = genuine(g, station, null); if (bad) return { ok: false, refused: bad };
    if (now() > g.exp) return { ok: false, refused: 'the PIN grant has ended — the PIN again, please' };
    if (now() - g.since > MAX_SESSION_MS) return { ok: false, refused: 'twelve hours since the PIN — the PIN again, please' };
    return { ok: true, grant: make(g.emp, station, g.since) };
  }
  return { check: check, renew: renew, verify: verify, door: door, DOOR_MS: DOOR_MS, TTL_MS: TTL_MS, GRACE_MS: GRACE_MS, MAX_SESSION_MS: MAX_SESSION_MS, FREE_TRIES: FREE_TRIES, LOCK_MS: LOCK_MS };
}
module.exports = { grantsFor: grantsFor, TTL_MS: TTL_MS, GRACE_MS: GRACE_MS, DOOR_MS: DOOR_MS };
