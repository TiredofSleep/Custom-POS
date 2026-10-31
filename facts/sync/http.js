'use strict';
/* ============================================================================
 * THE WIRE — a station talks to the v2 hub over HTTP(S) (2026-09-23, step 2 of ARCHITECTURE-V2's "Next").
 * @sync @hub — a station talks to the hub over HTTP(S): the device token rides in the body and a header, never the URL, and a network failure loses nothing
 * ----------------------------------------------------------------------------
 * httpHub(base) answers like an in-process hub, with Promises: receive(bundle) and pull(token, cursor, epoch, limit).
 * The device token rides in the BODY, never the URL (a URL is logged by every proxy on the way). In production
 * a TLS proxy sits in front with HTTPS; hub/server.js itself listens on 127.0.0.1.
 *   attach(station, remote)   commit goes over the wire. Enrolment is an OPERATOR step (hub/server.js /v2/admin/enroll):
 *                             the station must already hold its access token (station.setAccess), as in the shop.
 *   sync.pullAsync / sync.homeAsync do the rest with the same rules as the in-process pull.
 * A network failure is a thrown/rejected call: the station logs it and keeps the facts owed. Nothing is lost.
 * ========================================================================== */
/* @sync @hub — a station's wire to the hub over fetch; the device key rides in a header as well as the body (E31) */
function httpHub(base, opts) {
  opts = opts || {};
  const root = String(base || '').replace(/\/+$/, '');
  const timeoutMs = Number(opts.timeoutMs) || 30000;
  const doFetch = opts.fetch || (typeof fetch === 'function' ? fetch : null);
  if (!doFetch) throw new Error('httpHub needs fetch (Node 18+ or a browser)');
  /* E68 (batch `sync` 9/25): a pull may take longer than a commit, and asks for as many facts as the signal carries (pace) */
  const pullTimeoutMs = Number(opts.pullTimeoutMs) || timeoutMs, adaptive = opts.adaptive !== false;   /* the station page asks for 45 s (station/app.js) */
  const pace = { limit: Number(opts.pullLimit) || (adaptive ? 250 : 0), min: 25, max: 1000 };
  /* @sync @hub — one call to the hub; the device key rides in the x-custompos-token header too, so the hub's front door knows the
     sender before it reads a byte of the body (E31, 9/25); waitMs: a pull's own longer wait (E68) — merge 9/25 */
  function call(method, path, body, key, waitMs) {
    const tms = waitMs || timeoutMs;
    const ac = new AbortController(); const t = setTimeout(function () { ac.abort(); }, tms);
    const init = { method: method, headers: { 'content-type': 'application/json', accept: 'application/json' }, signal: ac.signal };
    if (typeof key === 'string' && key) init.headers['x-custompos-token'] = key;
    if (body !== undefined) init.body = JSON.stringify(body);
    return Promise.resolve().then(function () { return doFetch(root + path, init); })
      .then(function (r) { return r.text().then(function (txt) {
        let j = null; try { j = JSON.parse(txt); } catch (e) {}
        if (!j || typeof j !== 'object' || Array.isArray(j)) throw new Error('the hub answered HTTP ' + r.status + ' with no hub answer');
        if (typeof opts.onAnswer === 'function') { try { opts.onAnswer(j, path); } catch (e) {} }   /* opts.onAnswer: the page reads the build and the owner's reload request off every answer (E70 / S26) */
        return j; }); })
      .then(function (j) { clearTimeout(t); return j; }, function (err) { clearTimeout(t); throw (err && err.name === 'AbortError') ? new Error('the hub did not answer in ' + tms + ' ms') : err; });
  }
  /* @sync @hub — E68: the weak-signal pace. A pull that timed out asks for half as many facts next time (never under 25); a FULL page
     that came back in under a quarter of the wait asks for twice as many (never over the hub's 1000). Each answer is applied and
     its cursor kept before the next is asked for, so a phone in a weak area always moves forward. */
  function paced(lim, took, j, err) {
    if (!adaptive || !lim) return;
    if (err) { if (/did not answer/.test(String(err.message))) pace.limit = Math.max(pace.min, Math.floor(lim / 2)); return; }
    if (j && Array.isArray(j.events) && j.events.length >= lim && took < pullTimeoutMs / 4) pace.limit = Math.min(pace.max, lim * 2);
  }
  return {
    base: root,
    receive: function (bundle) { return call('POST', '/v2/receive', bundle, bundle && bundle.token); },
    pull: function (token, cursor, epoch, limit, at) { const lim = limit || pace.limit || undefined, body = { token: token, cursor: cursor, epoch: epoch, limit: lim, at: at }; if (typeof opts.info === 'function') { try { body.info = opts.info(); } catch (e) {} }   /* opts.info: what the page says of itself on each pull (its clock — E35); at: the fact held at the cursor (E6) */
      const t0 = Date.now(); return call('POST', '/v2/pull', body, token, pullTimeoutMs).then(function (j) { if (!limit) paced(lim, Date.now() - t0, j, null); return j; }, function (err) { if (!limit) paced(lim, Date.now() - t0, null, err); throw err; }); },
    get pullLimit() { return pace.limit; },
    health: function () { return call('GET', '/v2/health'); }
  };
}
/* @sync @hub @station — a station's commits go over the wire; enrolment stays the operator's step, so the station must already hold its access token */
function attach(station, remote) { station.setTransport(function (bundle) { return remote.receive(bundle); }); return station; }

module.exports = { httpHub: httpHub, attach: attach };
