'use strict';
/* ============================================================================
 * WHICH TABLET RUNS OLD SOFTWARE — v1's own build verdict from markPushingDevice, VERBATIM (2026-09-25, batch `sync`: S19)
 * ----------------------------------------------------------------------------
 * Every function inside kit() is v1's own, copied by a script (never retyped) from hub-server.js:
 *   buildVerdict 3676-3688 (inline)
 * @sync @startup @hub — every tablet's build judged against the one the hub serves, with v1's 45 minutes' grace to update itself
 * v1 marks each station on every push (hub-server.js markPushingDevice): behind the served build is NORMAL for a while after a
 * deploy (stations update only when free), so the alarm waits 45 minutes (behindSince) before calling one OLD, says why
 * ('stuck on … for N min — hub is serving …', or 'it never reports a build (too old to)'), and shows 'updating…' meanwhile
 * (updatingSince). v2's hub runs it on every pull (hub/hub.js buildNote); the Devices list and the owner's Home alarm read it.
 * kit(env) needs Date (the hub's clock: Date.now()).
 * ========================================================================== */
function kit(env) {
  var Date = env.Date || global.Date;
/* @sync @startup @hub — one station's verdict: behind the served build for 45 minutes (or never saying its build) is OLD, with why; meanwhile 'updating'. */
function buildVerdict(d, rev, missing){
      const GRACE = 45 * 60 * 1000;                       // 45 min of auto-update grace before we call it stale
      if (d.appRev && d.appRev === rev) { delete d.behindSince; }
      else if (!d.behindSince) { d.behindSince = Date.now(); }
      const behindFor = d.behindSince ? (Date.now() - d.behindSince) : 0;
      const why = [];
      if (missing.length) why.push('its push carried no ' + missing.join('/') + ' — that code predates the feature');
      if (!d.appRev)      why.push('it never reports a build (too old to)');
      else if (d.appRev !== rev && behindFor > GRACE)
        why.push('stuck on ' + d.appRev + ' for ' + Math.round(behindFor / 60000) + ' min — hub is serving ' + rev + ', so auto-update is not taking');
      if (why.length) { d.oldBuild = true; d.oldBuildWhy = why.join('; '); d.oldBuildAt = Date.now(); }
      else { delete d.oldBuild; delete d.oldBuildWhy; delete d.oldBuildAt; }
      // informational only — the Devices tab shows "updating…", nothing alarms
      if (d.appRev && d.appRev !== rev) d.updatingSince = d.behindSince; else delete d.updatingSince;
}
  return { buildVerdict: buildVerdict };
}
/*ADAPTER*/
module.exports = { kit: kit };
