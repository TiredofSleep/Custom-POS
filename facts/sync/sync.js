'use strict';
/* ============================================================================
 * SYNC — replicate the LOG. The hub decides; stations never wait on it.
 * @sync @hub @fact — a station's log replicated through the hub: commit what I owe, pull what I lack in order, re-offer what a new or forgetful hub lost; a failure loses nothing
 *   attach(station, hub)   wire commit to the hub (production: an HTTPS POST carrying the device's access token).
 *                          In-process, attach also stands in for the OPERATOR'S SETUP: a station whose id no device
 *                          holds at THIS hub (a first boot, a brand-new hub) is enrolled. It never takes an id another device holds —
 *                          a replacement tablet is an explicit hub.enroll(), exactly as in the shop.
 *   pull(station, hub)     everything after my cursor, in order, in chunks; a hub under another epoch sends from
 *                          zero. Facts of mine the hub had and I lost are taken back by ingest; facts of mine the
 *                          hub lost are owed again and it is told on the next commit.
 *   home(station, hub)     the "back to Home" cycle: commit → pull → (a new or forgetful hub) commit again.
 *   pullAsync / homeAsync  the same, against a hub that answers with a Promise (sync/http.js — the wire). One
 *                          function applies every answer (applyAnswer), so the two can never drift apart.
 * Every step is caught: a failure is logged and nothing is lost. A read-only window pulls nothing.
 * ========================================================================== */
/* @sync @hub @station — wires a station's commits to an in-process hub, and enrols a first-boot station there as the operator would; never takes an id another device holds */
function attach(station, hub, opts) {
  if (!(opts && opts.enroll === false) && !station.readOnly && typeof hub.enrolled === 'function' && !hub.enrolled(station.id)) {
    const t = hub.enroll(station.id, { by: 'setup' }); if (t) station.setAccess(t);
  }
  station.setTransport(function (bundle) { return hub.receive(bundle); });
  return station;
}
/* @sync @station — cuts a station off its hub: its commits have nowhere to go until it is attached again */
function detach(station) { station.setTransport(null); return station; }

/* @sync — a pull's tally at zero: added, refused, acked, adopted, lost, epoch changed, chunks */
function newPullOut() { return { ok: true, added: 0, refused: 0, acked: 0, adopted: 0, lost: 0, epochChanged: false, chunks: 0 }; }
/* @sync @fact — one answer from the hub, applied: 'more' to ask again, 'stop' when done (or refused, or deferred). A record that
   ends before my cursor under the SAME identity (a hub that went back in time and did not say so) is read again from zero,
   so every position is checked against what I hold and nothing new is skipped (E6). */
function applyAnswer(station, r, out, mark) {   /* mark: E86 — station.witnessMark() when the pull went out */
  if (!r || typeof r !== 'object' || (typeof r.refused !== 'string' && (typeof r.epoch !== 'string' || !Array.isArray(r.events)))) { out.ok = false; out.error = 'malformed hub answer'; station.noteFailure({ kind: 'pull', error: out.error }); return 'stop'; }
  if (r.refused) { out.ok = false; out.error = r.refused; station.noteFailure({ kind: 'pull', error: r.refused }); return 'stop'; }
  if (typeof r.now === 'number' && typeof station.noteHubClock === 'function') station.noteHubClock(r.now);   // E35: the hub's time on its answer
  if (r.epoch !== station.epoch) out.epochChanged = station.setEpoch(r.epoch) || out.epochChanged;   // the hub answered from zero
  else if (!out.rewound && Number.isInteger(r.head) && r.head < station.cursor && !station.readOnly) { out.rewound = true; station.noteFailure({ kind: 'reoffer', note: 'the hub\'s record ends at ' + r.head + ', before where I had read (' + station.cursor + ') under the same identity — it went back in time; reading it again from the start' }); station.cursor = 0; return 'more'; }
  const res = station.ingest(r.events, r.head, mark);
  out.added += res.added; out.refused += res.refused; out.acked += res.acked; out.adopted += res.adopted || 0; out.lost += res.lost || 0; out.chunks++;
  if (station.readOnly) { out.readOnly = true; return 'stop'; }
  if (res.holdAt != null) { station.cursor = Math.max(station.cursor, res.holdAt - 1); out.deferred = true; return 'stop'; }   // a fact of mine I could not take back yet: never step past it
  if (r.events.length) station.cursor = Math.max(station.cursor, r.events[r.events.length - 1].pos);
  return (!r.more || !r.events.length) ? 'stop' : 'more';
}
/* @sync @error — a pull that threw: noted on the station and on the tally; the facts stay owed, nothing is lost */
function pullFailed(station, out, err) { const msg = String((err && err.message) || err); station.noteFailure({ kind: 'pull', error: msg }); out.ok = false; out.error = msg; }
/* @sync — the id of the fact the station holds at its cursor, for the hub's rewind check (E6); a station without it says nothing */
function atOf(station) { return typeof station.atCursor === 'function' ? station.atCursor() : undefined; }

/* @sync @hub — everything after my cursor from an in-process hub, chunk by chunk, through the one answer-applier; a read-only window pulls nothing */
function pull(station, hub) {
  const out = newPullOut();
  if (station.readOnly) { out.ok = false; out.readOnly = true; return out; }
  try {
    for (let guard = 0; guard < 100000; guard++) {
      if (applyAnswer(station, hub.pull(station.accessToken, station.cursor, station.epoch, undefined, atOf(station)), out) === 'stop') break;
    }
  } catch (err) { pullFailed(station, out, err); }
  return out;
}
/* @sync @hub — the same pull against a hub that answers with a Promise (the wire); stops if the window went read-only while an answer was on its way */
async function pullAsync(station, hub) {
  const out = newPullOut();
  if (station.readOnly) { out.ok = false; out.readOnly = true; return out; }
  try {
    for (let guard = 0; guard < 100000; guard++) {
      const mark = typeof station.witnessMark === 'function' ? station.witnessMark() : undefined;   /* E86: a commit's answer may overtake this one */
      const r = await hub.pull(station.accessToken, station.cursor, station.epoch, undefined, atOf(station));
      if (station.readOnly) { out.readOnly = true; return out; }       // the window went inert while the answer was on its way
      if (applyAnswer(station, r, out, mark) === 'stop') break;
    }
  } catch (err) { pullFailed(station, out, err); }
  return out;
}

/* @sync @hub — the back-to-Home cycle: commit, pull, and commit again at once when the hub is new or lost my facts */
function home(station, hub, reason) {
  const c1 = station.commit(reason || 'home');
  const p = pull(station, hub);
  const c2 = (p.lost > 0 || p.epochChanged) ? station.commit('re-offer') : null;   // a new witness, or one that lost my facts: what is owed goes at once
  return { commit: c1, pull: p, reoffer: c2 };
}
/* @sync @hub — the back-to-Home cycle over the wire: commit, pull, and re-offer at once when the hub is new or lost my facts */
async function homeAsync(station, hub, reason) {
  const c1 = await station.commit(reason || 'home');
  const p = await pullAsync(station, hub);
  const c2 = (p.lost > 0 || p.epochChanged) ? await station.commit('re-offer') : null;
  return { commit: c1, pull: p, reoffer: c2 };
}

module.exports = { attach: attach, detach: detach, pull: pull, home: home, pullAsync: pullAsync, homeAsync: homeAsync };
