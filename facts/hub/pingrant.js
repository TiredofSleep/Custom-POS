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
 * 11/1 (a skeptic of Custom POS, which shares this file): a pass names the PIN it was earned with (pf: the first 16 hex of that person's
 * PIN hash, signed in with the rest), so changing a PIN, or making the person inactive, ends every pass made before — wherever the caller
 * hands in its record of the person (the hub's three do: hub/authority.js, the /v2/pin-grant renewal, hub/riskdoors.js). And the guesses
 * still being checked count against the five free ones: a burst sent at once used to be hashed whole before the first wrong one counted.
 * 11/2 (round 2): "inactive" alone only paused a pass — switched back on within its life, it worked again. The print now also names how many
 * times the person was switched back on (passPrint), so a switch-off ends every pass made before. A PIN change dated BEFORE a later-dated
 * one does not take (the staff fold's one order); the hub's judge now says so (aggregates/staff.js outranked, hub/authority.js).
 * ⚠️ Still true (round 2, F3 — the owner's call, todo 2026-11-02-pin-pass-round-2): a privileged change waiting on a tablet (offline,
 * or refused) is sent by that person's NEXT pass on that tablet — the shop's offline design — so a change made there with a PIN since
 * changed lands when the real person next enters theirs. A fact does not yet name the PIN that approved it.
 * ⚠️ What this cannot do (said plainly): a PIN is four digits and every tablet holds the PIN records, so someone with a stolen
 * tablet and time can still work a PIN out offline — revoke a lost tablet at once (POST /v2/admin/revoke).
 * ========================================================================== */
const crypto = require('crypto'), fs = require('fs'), path = require('path');
const TTL_MS = 30 * 60000, MAX_SESSION_MS = 12 * 3600000, GRACE_MS = 2 * 3600000, FREE_TRIES = 5, LOCK_MS = 15 * 60000;
const DOOR_MS = 30 * 60000;   /* owner 10/18: a risky door (hub/riskdoors.js) takes a PIN entered within this long — never a renewed pass */
/* @permission @employee — a PIN record's fingerprint in a pass: the first 16 hex of its hash (the hash itself never leaves the hub in one) */
function pinPrint(rec) { return (rec && typeof rec.hash === 'string') ? rec.hash.slice(0, 16) : ''; }
/* @permission @employee — a person's print in a pass: their PIN's print, and (11/2, a Custom POS skeptic, round 2) how many times they were switched
   back on (aggregates/staff.js reactivated) — so switching a person off and on again ends every pass made before, as a changed PIN does */
function passPrint(who) { const p = pinPrint(who && who.pin); return (p && who.reactivated > 0) ? p + '.' + who.reactivated : p; }

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
  /* the pass's format is g2 since 11/1 (it names the PIN): a g1 pass from before reads as unsigned, and that person enters the PIN again */
  const sign = function (g) { return crypto.createHmac('sha256', key()).update(['g2', g.emp, g.station, g.since, g.exp, typeof g.pf === 'string' ? g.pf : ''].join('|')).digest('hex'); };
  const make = function (emp, station, since, pf) { const g = { emp: String(emp), station: String(station), since: since, exp: now() + TTL_MS, pf: String(pf || '') }; g.sig = sign(g); return g; };
  const tries = new Map();   /* station|emp → {n, first, lockedUntil, told, flying} — wrong PINs, and the PINs being checked now, in memory */
  /* @permission @hub — is the person this pass names still the one who earned it: active, with the same PIN? null, or why not. who: the
     caller's current record of that person (null: none); a caller that hands in nothing (a proof of something else) is not asked */
  function current(g, who) {
    if (who === undefined) return null;
    if (!who || who.active === false || !who.pin || passPrint(who) !== g.pf) return 'the PIN this pass was earned with has changed, or that person is no longer active';
    return null;
  }
  /* @permission @hub — is this a grant the hub signed, for this person on this tablet? null, or why not */
  function genuine(g, station, emp) {
    if (!g || typeof g !== 'object' || typeof g.sig !== 'string' || !Number.isInteger(g.exp) || !Number.isInteger(g.since)) return 'no PIN grant from the hub';
    const want = sign(g), sb = Buffer.from(g.sig), wb = Buffer.from(want); if (sb.length !== wb.length || !crypto.timingSafeEqual(sb, wb)) return 'a PIN grant the hub did not sign';   /* 10/18: compared by BYTES — a signature of 64 characters that are not all one byte made timingSafeEqual throw (a hub error, not the plain refusal) */
    if (g.station !== String(station)) return 'a PIN grant from another tablet';
    if (emp != null && g.emp !== String(emp)) return 'a PIN grant for someone else';
    return null;
  }
  /* @permission @hub — may this fact (by emp, from station, dated at) pass on grant g? null, or why not */
  function verify(g, station, emp, at, who) {
    const bad = genuine(g, station, emp) || current(g, who); if (bad) return bad;
    if (Number(at) > g.exp) return 'the PIN grant had ended before this was done';
    if (now() > g.exp + GRACE_MS) return 'the PIN grant ended more than 2 hours ago';
    return null;
  }
  /* @permission @hub @employee — a PIN typed on a tablet, checked by the hub against the person's own record: a grant, or why not.
     staff: the hub's fold of the staff facts; pinHash(pin, salt, iter) → Promise<hex> (core/staff.js) */
  function check(station, empId, pin, staff, pinHash, pinIter) {
    const k = String(station) + '|' + String(empId), t = now(); let x = tries.get(k);
    if (x && x.lockedUntil > t) return Promise.resolve({ ok: false, refused: 'too many wrong PINs for this person on this tablet — try again in ' + Math.ceil((x.lockedUntil - t) / 1000) + ' s', retryMs: x.lockedUntil - t });
    const who = staff && staff.byId ? staff.byId.get(String(empId)) : null;
    if (!who || who.active === false || !who.pin || !who.pin.salt || !who.pin.hash) return Promise.resolve({ ok: false, refused: 'no active employee with a PIN by that id' });
    if (!x || (t - x.first >= LOCK_MS && !x.flying)) { x = { n: 0, first: t, lockedUntil: 0, told: false, flying: 0 }; tries.set(k, x); }
    /* the guesses still being checked count against the five free ones (skeptic 11/1: a burst sent at once was all hashed before the first wrong one counted) */
    if (x.n + (x.flying || 0) >= FREE_TRIES) return Promise.resolve({ ok: false, refused: 'too many PINs for this person on this tablet are being checked at once — wait a moment and try again' });
    x.flying = (x.flying || 0) + 1;
    return Promise.resolve(pinHash(String(pin == null ? '' : pin), who.pin.salt, pinIter ? pinIter(who.pin) : undefined)).then(function (h) {
      x.flying--;
      if (h === who.pin.hash) { x.n = 0; if (!x.flying && tries.get(k) === x) tries.delete(k); return { ok: true, grant: make(who.id, station, now(), passPrint(who)) }; }
      if (now() - x.first >= LOCK_MS && x.lockedUntil <= now()) { x.n = 0; x.first = now(); }
      x.n++;
      if (x.n >= FREE_TRIES) { x.lockedUntil = now() + LOCK_MS; if (!x.told && o.alert) { x.told = true; try { o.alert({ key: 'pin-grant-locked:' + k, kind: 'pin-locked', station: String(station), note: '🔒 ' + x.n + ' wrong PINs for ' + (who.name || empId) + ' on tablet ' + station + ' — the hub refuses that person\'s privileged changes from it for 15 minutes. If this was not a fumble, revoke the tablet (Admin → Devices).' }); } catch (e) {} } }
      tries.set(k, x);
      return { ok: false, refused: 'wrong PIN' };
    }, function (e) { x.flying--; throw e; });
  }
  /* @permission @hub — a RISKY DOOR (owner 10/18: "Server checks PIN on risky actions" — a card refund or void, a group text, a new
     device's setup code, a saved card erased; hub/riskdoors.js): a grant the hub signed, for this tablet, still good NOW, from a PIN
     typed in the last DOOR_MS (30 minutes). A renewal keeps its PIN's time (since), so it never stretches a door the way it may
     stretch a privileged fact's pass — a lost tablet's leftover pass opens none of these. null, or why not */
  function door(g, station, who) {
    const bad = genuine(g, station, null) || current(g, who); if (bad) return bad;
    if (now() > g.exp) return 'the PIN pass has ended';
    if (now() - g.since > DOOR_MS) return 'the PIN was entered more than 30 minutes ago';
    return null;
  }
  /* @permission @hub — a grant still good, renewed without the PIN (the person keeps working), up to 12 hours from the PIN */
  function renew(g, station, who) {
    const bad0 = genuine(g, station, null), bad = bad0 || current(g, who); if (bad) return { ok: false, refused: bad0 ? bad : bad + ' — the PIN again, please' };
    if (now() > g.exp) return { ok: false, refused: 'the PIN grant has ended — the PIN again, please' };
    if (now() - g.since > MAX_SESSION_MS) return { ok: false, refused: 'twelve hours since the PIN — the PIN again, please' };
    return { ok: true, grant: make(g.emp, station, g.since, g.pf) };
  }
  return { check: check, renew: renew, verify: verify, door: door, current: current, DOOR_MS: DOOR_MS, TTL_MS: TTL_MS, GRACE_MS: GRACE_MS, MAX_SESSION_MS: MAX_SESSION_MS, FREE_TRIES: FREE_TRIES, LOCK_MS: LOCK_MS };
}
module.exports = { grantsFor: grantsFor, pinPrint: pinPrint, passPrint: passPrint, TTL_MS: TTL_MS, GRACE_MS: GRACE_MS, DOOR_MS: DOOR_MS };
