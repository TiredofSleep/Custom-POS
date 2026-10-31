'use strict';
/* ============================================================================
 * STATION — records offline, proposes to the hub. "Every station watching itself."
 * @station @fact @sync @storage — a tablet's own recording engine: facts saved offline, sent to the hub on tile finished, texts owed by the log, one window per station
 * ----------------------------------------------------------------------------
 * A station has an id, its own clock, its own append-only log, and it RECORDS
 * OFFLINE: no network between a tap and a saved fact. The HUB IS THE AUTHORITY
 * (2026-09-22): it admits a fact only from a device enrolled as that station
 * (the device's access token), orders it, and refuses a second fact under a
 * held id. The station never judges forks or keys any more — the id of every
 * fact is its idempotency key, and the hub's answer is final.
 *
 * THE COMMIT POINT IS "TILE FINISHED": commit() sends what the hub has not
 * echoed — this station's own facts, oldest first, in chunks a wire can carry.
 * A failed commit is logged and still owed. The transport may be synchronous
 * (tests) or return a Promise (HTTPS); overlapping commits are serialized — one
 * in flight, one queued — and an answer that never comes is given up on.
 *
 * A NEW HUB IS A NEW WITNESS: when the epoch changes, everything of mine is owed
 * again. A fact of mine the hub had witnessed and then LOST (a restored backup
 * under the same identity) is re-offered and the hub is told.
 *
 * A FACT OF MINE THAT COMES BACK FROM THE HUB and is not in my log (a disk that
 * lost a write, a restored backup, a clone of this tablet) is TAKEN BACK — never
 * a halt. Its texts never fire blind: they are marked done AND listed for an
 * operator, durably, BEFORE the fact lands.
 *
 * EFFECTS ARE OWED BY THE LOG, AND MADE DURABLE BEFORE THEY FIRE: the attempt is
 * written first; a hook that throws — or returns a Promise that rejects — is
 * remembered on disk and listed after a reboot; an operator's retryEffects()
 * writes "retrying" before it fires each once more. Any text a DEPLOY added to
 * facts already witnessed is held for the operator, never fired at the whole
 * history. An unreadable effects store is HELD and never overwritten until an
 * operator resolves it. The hook is handed a copy, never the log's row.
 *
 * ONE WINDOW PER STATION: a lease, renewed on the MONOTONIC clock while the
 * window works, honouring the TTL the service granted. close() flushes, then
 * releases and is a writer no more. A lapsed lease is never silently re-taken:
 * the window re-reads the store (reclaim) before it writes again; a crashed
 * window's reload reclaims by itself one full TTL after it was last refused.
 * A halted, closed or read-only window is INERT.
 * ========================================================================== */
const hlc = require('./hlc');
const ev = require('./event');
const registry = require('./registry');
const makeLog = require('./log').makeLog;

const DEFAULT_TILE_TIMEOUTS = { rack: 15 * 60 * 1000, assembly: 15 * 60 * 1000 };   // owner: 15 minutes, only if inactive; Detail/Quick/Pickup never kick
const FAILURE_CAP = 500;
const LEASE_MS = 30000;
const COMMIT_TIMEOUT_MS = 30000;
const REFUSED_STREAK = 3;                                        // the same fact refused this many commits in a row is a problem selfCheck names
const MAX_BUNDLE = 200;                                          // facts per push: a weekend's backlog goes out in chunks any wire can carry
const CLOCK_GUARD_MS = 5 * 60 * 1000;                            /* E35: v1's CLOCK_SKEW_MS — a tablet more than 5 minutes off the hub's clock records nothing */
const REGISTRY_ROW = '__effects_registry__';

/* the host's monotonic clock, BOUND (performance.now unbound throws "Illegal invocation" in browsers and Node alike) */
/* @clock @station — the device's monotonic clock (never set back by hand), bound so it can be called; none when the host has none */
function hostMono() {
  try { if (typeof performance !== 'undefined' && performance && typeof performance.now === 'function') { const p = performance; const v = p.now(); if (Number.isFinite(v)) return function () { return p.now(); }; } } catch (e) {}
  return null;
}
/* @fact @sync — a fact without this copy's private marks (adopted, everPos), as it goes on the wire */
function strip(e) { if (!e || (e.adopted === undefined && e.everPos === undefined)) return e; const c = Object.assign({}, e); delete c.adopted; delete c.everPos; return c; }

/* @station @fact @sync — builds a station: its id, clock and append-only log, recording offline and proposing to the hub, which is the authority; refuses an id with a slash */
function makeStation(opts) {
  if (opts.id == null || String(opts.id) === '') throw new Error('a station must know itself: id is required');
  const id = String(opts.id);
  if (id.indexOf('/') >= 0) throw new Error('a station id may not contain "/" — it is the event-id namespace separator');
  const name = opts.name || id;
  const persist = opts.persist || null;
  const nowMs = opts.now || Date.now;
  /* @station @invariant — a timing option in milliseconds, the default when unset; refuses anything that is not a positive number */
  function validMs(v, dflt, what) { if (v == null) return dflt; if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) throw new Error('station ' + id + ': ' + what + ' must be a positive number of milliseconds'); return v; }
  const leaseMs = validMs(opts.leaseMs, LEASE_MS, 'leaseMs');
  const commitTimeoutMs = validMs(opts.commitTimeoutMs, COMMIT_TIMEOUT_MS, 'commitTimeoutMs');
  const failures = [];
  /* @station @error — remembers a failure with its time for the health line, keeping the newest 500 */
  function noteFailure(f) { failures.push(Object.assign({ ts: nowMs() }, f)); if (failures.length > FAILURE_CAP) failures.splice(0, failures.length - FAILURE_CAP); }
  /* @error — an error's message as words, never empty */
  function failMsg(err) { return String((err && err.message) || err) || '(no message)'; }

  /* ---- the monotonic clock: probed once; a reading that throws or is not a number counts as "no time passed" ---- */
  let monoSrc = null, monoLast = 0, monoNoted = false;
  (function pickMono() {
    /* a caller that injects a wall clock without a monotonic one wants its timers on THAT clock (tests, simulations);
       a caller that injects neither gets the host's monotonic clock — never the wall */
    const candidates = opts.mono ? [opts.mono, hostMono(), nowMs] : (opts.now ? [nowMs] : [hostMono(), nowMs]);
    for (let i = 0; i < candidates.length; i++) {
      const fn = candidates[i]; if (typeof fn !== 'function') continue;
      try { const v = fn(); if (Number.isFinite(v)) { monoSrc = fn; monoLast = v; if (i > 0 && opts.mono) noteFailure({ kind: 'clock', error: 'the monotonic clock given at construction throws or returns a non-number — replaced by ' + (i === 1 ? 'the host clock' : 'the wall clock') }); return; } } catch (e) {}
    }
    monoSrc = nowMs;
  })();
  /* @clock @station — the monotonic clock's time, never going backwards; a reading that fails counts as no time passed (and is noted once) */
  function mono() {
    let v; try { v = monoSrc(); } catch (e) { v = NaN; }
    if (!Number.isFinite(v)) { if (!monoNoted) { monoNoted = true; noteFailure({ kind: 'clock', error: 'the monotonic clock returned a non-number — treated as no time passed' }); } return monoLast; }
    if (v > monoLast) monoLast = v;                                // never backwards
    return monoLast;
  }

  let readOnly = false, halted = null, haltKind = null;          // halted = the reason this window is not a writer
  /* @station @error — makes this window read-only for good, keeping the first reason it stopped writing */
  function halt(kind, why) { readOnly = true; if (!halted) { halted = why; haltKind = kind; } noteFailure({ kind: 'halted', what: kind, error: why }); }
  /* @station @error — makes this window read-only with a new reason, replacing the old one */
  function rehalt(kind, why) { readOnly = true; halted = why; haltKind = kind; noteFailure({ kind: 'halted', what: kind, error: why }); }

  /* ---- access: the token the hub issued this device. Losing it never stops recording — only sending, until an operator
          enrolls the device again. A store whose access names another station is not this station's store. ---- */
  const hasAccessStore = !!(persist && typeof persist.loadAccess === 'function' && typeof persist.saveAccess === 'function');
  let access = null, accessDirty = false, accessRefused = null;
  /* @station @identity @storage — reads this device's access token from its store; a store that fails to read still records, it just cannot send */
  function loadAccessNow() {
    if (!hasAccessStore) return { ok: true, value: access };
    try { const a = persist.loadAccess(); return { ok: true, value: (a && typeof a === 'object' && typeof a.token === 'string') ? { station: (a.station == null ? id : String(a.station)), token: a.token } : null }; }
    catch (e) { noteFailure({ kind: 'persist', what: 'access-load', error: failMsg(e) + ' — this station records normally and cannot send until the access store reads or an operator enrolls it again' }); return { ok: false }; }
  }
  (function () { const r = loadAccessNow(); if (r.ok) access = r.value; })();
  if (access && access.station !== id) halt('store', 'this store belongs to station "' + access.station + '", not "' + id + '" — a store is owned by one station; open it as that station, or give this one a fresh store');
  /* @station @identity @storage — saves this device's access token; a failed save is noted and retried */
  function saveAccessNow() { if (!hasAccessStore || readOnly) return true; try { persist.saveAccess(access); accessDirty = false; return true; } catch (e) { accessDirty = true; noteFailure({ kind: 'persist', what: 'access-save', error: failMsg(e) + ' — will retry' }); return false; } }

  /* ---- one window per station: take the lease, renew it on the monotonic clock, honour the TTL the service GRANTED ---- */
  const nonce = id + '-' + Math.random().toString(36).slice(2, 10);
  let leaseAt = -Infinity, leaseRefusedAt = null, leaseGrant = leaseMs;
  const hasLease = !!(persist && typeof persist.lease === 'function');
  /* @station @storage — by my own clock, do I still hold this station's one-window lease */
  function leaseFresh() { return !hasLease || mono() - leaseAt < leaseGrant; }   // by my own record, do I still hold it?
  /* @station @storage — asks for this station's one-window lease; too short a grant counts as refused, and a service failing at boot fails closed */
  function takeLease() {
    if (!hasLease) return true;
    try {
      const l = persist.lease(nonce, leaseMs);
      if (l && l.ok) {
        const granted = (l.ttlMs != null) ? Number(l.ttlMs) : leaseMs;   // a service may grant LESS than asked: renew against what it granted
        if (!(Number.isFinite(granted) && granted > 0) || granted < leaseMs / 3) { leaseRefusedAt = mono(); noteFailure({ kind: 'lease', error: 'the lease service granted ' + granted + ' ms of the ' + leaseMs + ' asked — too little to work under; treated as refused' }); return false; }
        leaseGrant = Math.min(leaseMs, granted); leaseAt = mono(); leaseRefusedAt = null; return true;
      }
      leaseRefusedAt = mono(); noteFailure({ kind: 'lease', error: 'another window holds this station', holder: l && l.holder }); return false;
    } catch (e) {
      const still = leaseFresh() && leaseAt !== -Infinity;         // a service that throws once mid-day: I still hold it by my own record → retry next time; at boot: fail CLOSED
      noteFailure({ kind: 'lease', error: 'lease service failed (' + failMsg(e) + ')' + (still ? ' — still within my lease by my own clock; will retry' : ' — failing CLOSED') });
      return still;
    }
  }
  /* @station @storage — keeps the lease on every write; a lapsed one re-reads the store first, and a lease another window took makes this one read-only */
  function renewLease() {                                       // called on EVERY write path; cheap when recent
    if (readOnly || !hasLease) return !readOnly;
    const age = mono() - leaseAt;
    if (age < leaseGrant / 3) return true;
    if (age >= leaseGrant) {                                     // provably lapsed (the tab slept): another window may have written — re-read before writing
      if (sameLease()) return true;
      readOnly = true; haltKind = 'lease'; halted = 'my lease lapsed (' + Math.round(age) + ' ms without renewal) — re-reading the store before writing again';
      if (station.reclaim()) { noteFailure({ kind: 'lease', note: 'my lease had lapsed; the store was re-read and the lease re-taken; continuing' }); return true; }
      rehalt('lease', 'lease lost — another window took this station while mine had lapsed; this one is now read-only'); return false;
    }
    if (takeLease()) return true;
    rehalt('lease', 'lease lost — another window took this station; this one is now read-only'); return false;
  }
  if (!halted && !takeLease()) halt('lease', 'another window holds ' + id + ' — opened read-only');
  /* @station @storage — a lapsed lease THIS window takes back when the store says nobody else held it meanwhile (the same
     generation): the log in memory is what is on disk, so it goes on without re-reading and re-hashing every fact — the route
     phone back from Maps, a counter PC woken from sleep (audit E71, batch `perf`). Anything else re-reads, as before. */
  function sameLease() {
    if (!hasLease) return false;
    try {
      const l = persist.lease(nonce, leaseMs); if (!(l && l.ok && l.same === true)) return false;
      const granted = (l.ttlMs != null) ? Number(l.ttlMs) : leaseMs; if (!(Number.isFinite(granted) && granted > 0) || granted < leaseMs / 3) return false;
      leaseGrant = Math.min(leaseMs, granted); leaseAt = mono(); leaseRefusedAt = null;
      noteFailure({ kind: 'lease', note: 'my lease had lapsed and nobody else held it — taken back without re-reading the store' }); return true;
    } catch (e) { return false; }
  }

  const clock = hlc.makeClock(id, { now: opts.now, maxDriftMs: opts.clockGuardMs > 0 ? opts.clockGuardMs : undefined });   /* E35 skeptic: with the clock guard on, a peer's stamp more than 5 minutes past my wall is ordered, never obeyed — a fact the hub took before the rule cannot drag this tablet's stamps where the hub refuses them */
  let log = makeLog(persist);
  if (log.unreadable) halt('log', 'my log could not be read — boot read-only rather than start over');
  /* @fact @station — this station's own facts in the log */
  function mine() { return log.mine(id); }
  let cursor = 0, hubEpoch = null, lastCommit = null;
  /* ⚠️ A FACT THIS COPY CANNOT APPLY YET IS NEVER STEPPED PAST (2026-09-23). Found with the live shadow feed: a page bundled
     before customer.created learned its `src` note refused thousands of customers, read on past them, and said "All good" — they
     were gone from that tablet for good. Now each such fact (an unknown type, or a payload this copy's validator refuses:
     the hub has code this copy lacks) is remembered by position; the pull still reads on so everything else stays current,
     but the SAVED cursor mark stays before the first one, so the next boot — the reload that brings the update — reads
     them again. The health line names them until then. */
  const unapplied = new Map();                                         // hub position → { id, type }
  /* @sync @fact — the cursor mark to save: never past a fact from the hub this copy could not apply yet, so the next boot reads it again */
  function markAt(c) { let lo = c; unapplied.forEach(function (_, pos) { if (pos - 1 < lo) lo = pos - 1; }); return Math.max(0, lo); }
  /* where I had read the hub up to comes back WITH my log (its cursor mark, written behind the facts it covers): a reboot
     resumes there instead of re-reading the whole hub, and a log restored from an older backup brings its own older mark */
  /* @sync @storage — where I had read the hub up to, restored from the mark saved with my log */
  function restoreMark(orZero) { const m = log.lastMark ? log.lastMark() : null; if (m && typeof m.epoch === 'string') { hubEpoch = m.epoch; cursor = m.cursor; } else if (orZero) cursor = 0; }
  restoreMark(false);
  const refusedStreak = new Map();                                // id -> consecutive commits the hub refused it
  const attempted = new Set();                                    // ids sent at least once and not yet echoed (the backlog)
  let transportStreak = 0;                                        // consecutive commits that never reached the hub while facts were owed

  /* ---- effects: the done-set, the attempts in flight, the attempts that FAILED, the rows kept aside — all durable ----
     a row is a key string (done), { k, id, effect, ts, attempting? | retrying? | failed? } (attempted), or the registry row;
     anything else is junk: the store is HELD until an operator resolves it, and never overwritten until then */
  const hasEffectsStore = !!(persist && typeof persist.loadEffects === 'function' && typeof persist.saveEffects === 'function');
  let effectsDone = new Set(), effectsUnknown = false, effectsDirty = false, effectsFailed = [], storedDigest = null;
  const attempting = new Map();                                   // k -> row currently between the durable mark and the hook's return
  const orphanFailed = new Map();                                 // k -> a failed/attempting row whose fact I do not hold (yet): kept aside, re-listed when it arrives
  const regDigest = registry.effectsDigest();
  /* @storage — one row of the effects store as {k}: a bare key, or a row with a key; anything else is junk */
  function effectRow(k) { return (typeof k === 'string' && k) ? { k: k } : (k && typeof k === 'object' && typeof k.k === 'string' && k.k) ? k : null; }
  /* @invariant @sms — does a failed or in-flight text row name a fact of mine that really owes that text */
  function effectRowValid(r) {                                    // a failed/attempting row must name a fact of MINE with that effect
    const e = log.get(r.id); if (!e || e.station !== id) return false;
    const def = registry.typeDef(e.type); if (!def || def.effects.indexOf(r.effect) < 0) return false;
    return r.k === e.id + '|' + r.effect;
  }
  /* @sms @storage @error — reads which texts were done, in flight or failed from disk; an unreadable store holds EVERY text until an operator resolves it */
  function loadEffects() {
    effectsDone = new Set(); effectsFailed = []; effectsUnknown = false; attempting.clear(); orphanFailed.clear(); storedDigest = null;
    try {
      const raw = hasEffectsStore ? persist.loadEffects() : [];
      if (raw == null) return;
      if (!Array.isArray(raw)) { effectsUnknown = true; noteFailure({ kind: 'persist', what: 'effects-load', error: 'effects store unreadable — all effects HELD until resolved' }); return; }
      let junk = 0, dups = 0; const seen = new Set();
      raw.forEach(function (k) {
        const r = effectRow(k); if (!r) { junk++; return; }
        if (r.k === REGISTRY_ROW) { storedDigest = (typeof r.digest === 'string') ? r.digest : null; return; }
        if (seen.has(r.k)) { dups++; return; } seen.add(r.k); effectsDone.add(r.k);
        const failed = ('failed' in r) ? (String(r.failed) || '(no message)') : (r.attempting || r.retrying) ? 'attempted — outcome unknown (the window crashed or the disk refused after the attempt); an operator decides' : null;
        if (failed == null) return;
        const row = { k: r.k, id: r.id, effect: r.effect, error: failed, ts: Number(r.ts) || 0 };
        if (effectRowValid(row)) effectsFailed.push(row); else orphanFailed.set(r.k, row);   // kept aside: its done-mark stays (nothing fires blind), listed the moment its fact arrives
      });
      if (dups) noteFailure({ kind: 'persist', what: 'effects-load', error: dups + ' duplicate effect row(s) ignored' });
      if (orphanFailed.size) noteFailure({ kind: 'persist', what: 'effects-load', error: orphanFailed.size + ' failed-effect row(s) name facts I do not hold — kept aside, never fired, listed when the fact arrives' });
      if (junk) { effectsUnknown = true; noteFailure({ kind: 'persist', what: 'effects-load', error: junk + ' unreadable effect row(s) — all effects HELD until resolved; ' + effectsFailed.length + ' intact failed row(s) carried through' }); }
    } catch (e) { effectsUnknown = true; noteFailure({ kind: 'persist', what: 'effects-load', error: failMsg(e) + ' — all effects HELD until resolved' }); }
  }
  loadEffects();
  if (persist && !hasEffectsStore && opts.onEffect) noteFailure({ kind: 'persist', what: 'effects-store', error: 'this persist has no effects store: done-marks live in memory only — a reboot cannot know what was texted; give persist.loadEffects()/saveEffects()' });
  const versionByKey = Object.create(null);
  let transport = null, effectHook = opts.onEffect || null;
  const tileTimeouts = Object.assign({}, opts.tileTimeouts || {});
  let tile = null, inFlight = false, inFlightSince = 0, generation = 0, queued = false;

  /* @fact — the record a fact is about: its aggregate and key */
  function keyOf(e) { return e.aggregate + '|' + e.key; }
  let versionsOf = null, versionsN = -1, versionsExact = false;   /* the log and size versionByKey was last brought up to; exact = it is each key's newest fact in the log */
  /* @station @fold — each key's newest fact (what a record is basedOn), rebuilt only when the log holds something new: an idle
     sync tick rebuilt it over all history every 5 seconds (audit E15, batch `perf`). While the map is exact, the facts that
     arrived since are compared into it one by one (the newest in the one order wins, as a rebuild's last write does) —
     a pull no longer sorts all history; anything else (a boot, a reclaim, a record that is not its key's newest) rebuilds whole. */
  function rebuildVersions() {
    if (versionsOf === log && versionsN === log.size()) return;
    if (versionsOf === log && versionsExact && versionsN >= 0 && versionsN < log.size()) {
      log.from(versionsN).forEach(function (e) { const k = keyOf(e), h = versionByKey[k], he = h ? log.get(h) : null; if (!he || hlc.compareEvents(he, e) < 0) versionByKey[k] = e.id; });
      versionsN = log.size(); return;
    }
    Object.keys(versionByKey).forEach(function (k) { delete versionByKey[k]; }); log.sorted().forEach(function (e) { versionByKey[keyOf(e)] = e.id; }); versionsOf = log; versionsN = log.size(); versionsExact = true;
  }
  /* @station @fold — a record's own fact becomes its key's newest (what the next record there is basedOn, as before); if a fact
     already held sorts after it, the map is no longer the log's own newest and the next pull rebuilds it whole, as it always did */
  function noteVersion(e) { const k = keyOf(e), h = versionByKey[k], he = h ? log.get(h) : null; if (he && hlc.compareEvents(he, e) > 0) versionsExact = false; versionByKey[k] = e.id; }
  /* @sms @storage — the effects store's rows to write: done keys, failed and in-flight rows, and the registry's digest */
  function effectRows() {
    const by = Object.create(null);
    effectsFailed.forEach(function (f) { by[f.k] = { k: f.k, id: f.id, effect: f.effect, failed: f.error, ts: f.ts }; });
    orphanFailed.forEach(function (f, k) { if (!by[k]) by[k] = { k: f.k, id: f.id, effect: f.effect, failed: f.error, ts: f.ts }; });
    attempting.forEach(function (row, k) { if (!by[k]) by[k] = row; });
    const rows = Array.from(effectsDone).map(function (k) { return by[k] || k; });
    rows.push({ k: REGISTRY_ROW, digest: regDigest });
    return rows;
  }
  /* the effects store is written only by a live writer, and NEVER over a held (unreadable) store except by the operator's resolve */
  /* @sms @storage — writes the effects store; never from a read-only window, and never over an unreadable one except when an operator resolves it */
  function saveEffects(resolving) {
    if (readOnly) return false;
    if (effectsUnknown && !resolving) { effectsDirty = true; return false; }
    if (!hasEffectsStore) return true;
    try { persist.saveEffects(effectRows()); effectsDirty = false; return true; }
    catch (e) { effectsDirty = true; noteFailure({ kind: 'persist', what: 'effects', error: failMsg(e) }); return false; }
  }
  /* @storage @error — flushes the log and any effects or access store owed to disk, noting a save that failed */
  function checkPersist() {
    if (readOnly) return;
    if (log.dirty) log.flush();
    if (log.persistError) { noteFailure({ kind: 'persist', what: 'log', error: log.persistError }); log.persistError = null; }
    if (effectsDirty) saveEffects();
    if (accessDirty) saveAccessNow();
  }
  /* @sync @fact — has the hub I last read witnessed this fact (a position under its identity) */
  function witnessed(e) { return e.pos != null && hubEpoch != null && e.epoch === hubEpoch; }
  /* @sms @fact — the side-effects (texts) this fact's type owes */
  function effectsOf(e) { const def = registry.typeDef(e.type); return (def && def.effects) ? def.effects : []; }
  /* a text whose sending this copy cannot know about (an adopted fact; a text a deploy added to history): never blind —
     marked done AND listed, so an operator's retryEffects() is the only way it fires. Returns whether anything changed. */
  /* @sms @error — marks a fact's texts done AND lists them for an operator, so a text this copy cannot account for never fires blind */
  function holdEffectsOf(e, why) {
    let changed = false;
    effectsOf(e).forEach(function (fx) { const k = e.id + '|' + fx; if (effectsDone.has(k)) { const o = orphanFailed.get(k); if (o) { orphanFailed.delete(k); effectsFailed.push(o); changed = true; } return; } effectsDone.add(k); effectsFailed.push({ k: k, id: e.id, effect: fx, error: why, ts: nowMs() }); changed = true; });
    if (changed) effectsDirty = true;
    return changed;
  }
  /* @sms @storage — failed-text rows kept aside because their fact had not arrived: listed for the operator once it has */
  function relistOrphans() {
    let n = 0; orphanFailed.forEach(function (row, k) { if (effectRowValid(row)) { orphanFailed.delete(k); effectsFailed.push(row); n++; } });
    if (n) effectsDirty = true; return n;
  }
  /* a DEPLOY that added a side-effect to a type: the facts already witnessed did not owe that text when they were made — hold
     every such key for the operator instead of texting the whole history on the first routine pull */
  /* @sms @deploy — after an update added texts to a type, holds those texts on facts already witnessed for an operator, instead of texting all of history */
  function reconcileRegistry() {
    if (effectsUnknown) return;
    if (storedDigest === regDigest) return;
    if (storedDigest == null && !mine().some(function (e) { return log.everWitnessed(e); })) { storedDigest = regDigest; if (hasEffectsStore) effectsDirty = true; return; }
    let held = 0;
    mine().forEach(function (e) { if (!log.everWitnessed(e)) return; if (holdEffectsOf(e, 'the app was updated: this text did not exist when this fact was witnessed — an operator decides (retryEffects)')) held++; });
    storedDigest = regDigest; if (hasEffectsStore || held) effectsDirty = true;
    if (held) noteFailure({ kind: 'effects', note: 'the registry of side-effects changed (an update): ' + held + ' already-witnessed fact(s) have new texts — HELD and listed for an operator, never fired blind' });
  }
  reconcileRegistry();
  let lostOwed = 0;                                                // facts of mine re-offered because the hub lost them under the same identity
  /* @sync @fact — the id of the fact I hold at my cursor under the identity I last read (null when I hold none there): the hub
     compares it with its own, so a store that went back in time and then grew past my cursor again is caught (E6, skeptic 9/25) */
  let atMemo = null;
  /* @sync @fact — the id of my fact at the hub position my cursor is on, remembered, for the hub's check that its store did not go back in time */
  function atCursor() {
    if (!(cursor > 0) || hubEpoch == null) return null;
    if (atMemo && atMemo.c === cursor && atMemo.ep === hubEpoch) { const m = log.get(atMemo.id); if (m && m.pos === cursor && m.epoch === hubEpoch) return atMemo.id; }
    const all = log.all(); let found = null;
    for (let i = all.length - 1; i >= 0; i--) { if (all[i].pos === cursor && all[i].epoch === hubEpoch) { found = all[i].id; break; } }
    atMemo = found ? { c: cursor, ep: hubEpoch, id: found } : null; return found;
  }
  /* ---- THIS TABLET'S CLOCK AGAINST THE HUB'S (E35, batch `sync` 9/25). Opt-in (the station page turns it on): the hub's time rides
     on every answer; the station keeps it on its own MONOTONIC clock, so a wall clock set right by hand is judged right at once ---- */
  const clockGuardMs = (opts.clockGuardMs > 0) ? opts.clockGuardMs : null;
  let hubClock = null;                                             // { hub: the hub's ms, mono: my monotonic ms when it answered }
  /* @sync @clock — the hub's time from an answer (only with the guard on; anything that is not a time is ignored) */
  function noteHubClock(ms) { if (!clockGuardMs || typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) return; hubClock = { hub: ms, mono: mono() }; }
  /* @sync @clock — how far my wall clock is from the hub's now (+ fast, - slow), or null before the hub has answered */
  function clockSkew() { if (!hubClock) return null; return Math.round(nowMs() - (hubClock.hub + (mono() - hubClock.mono))); }
  /* @sync @clock @station — the words when my clock is more than the guard off (or my next stamp is: stampAheadWords), or null: nothing is recorded under a wrong clock */
  function clockWrongWords() { const s = clockSkew(); if (s == null) return null; if (Math.abs(s) <= clockGuardMs) return stampAheadWords(); const a = Math.abs(s);
    const far = a >= 86400000 ? (a / 86400000).toFixed(1) + ' days' : a >= 3600000 ? (a / 3600000).toFixed(1) + ' hours' : Math.round(a / 60000) + ' minutes';
    return 'this tablet\'s clock is ' + far + (s > 0 ? ' FAST' : ' SLOW') + ' against the hub — set its date and time (Settings → Date & time → automatic); nothing is recorded until it is right, so no money or hours land on the wrong day'; }
  /* @sync @clock @station — E35 skeptic (9/25): my wall clock is right, but my NEXT STAMP is not — this tablet recorded earlier under
     a clock that ran ahead (offline, before the hub answered), and its own history seeds its clock (hlc adopt), so everything it
     records now carries that future time and the hub takes none of it (5 minutes, hub.js aheadOf) until the hub's clock gets
     there. Say so and record nothing, rather than take cash no other tablet will see for hours; what it holds sends by itself. */
  function stampAheadWords() {
    const a = Math.round(clock.peek().t - (hubClock.hub + (mono() - hubClock.mono))); if (!(a > clockGuardMs)) return null;
    const far = a >= 86400000 ? (a / 86400000).toFixed(1) + ' days' : a >= 3600000 ? (a / 3600000).toFixed(1) + ' hours' : Math.round(a / 60000) + ' minutes';
    return 'this tablet recorded earlier under a clock ' + far + ' FAST, and anything it records now would be dated then too — the hub takes nothing dated ahead of it, so nothing is recorded here for about ' + far + ' (use another tablet; what this one holds is kept and sends by itself then)'; }
  /* @sync @station — THE REFUSED GO LAST (E67, batch `sync` 9/25): a fact the hub refused (a validator tightened ahead of this
     tablet's build, a clock that ran ahead) moves behind every fact it has not refused, oldest first within each — so 200 of them
     can never fill a bundle and hold back the cash recorded after. They are still offered, every time, never dropped. */
  function refusedLast(own) { if (!refusedStreak.size) return own; return own.filter(function (e) { return !refusedStreak.has(e.id); }).concat(own.filter(function (e) { return refusedStreak.has(e.id); })); }
  /* @sync @fact — what I owe the hub, oldest first; the bundle also says which identity I last read and how far, so a hub whose
     store went back in time learns it before it hands out a position a second time (E6) */
  function outbox(limit) {
    const own = refusedLast(log.outbox(hubEpoch).filter(function (e) { return e.station === id; }));   // E67: what the hub keeps refusing goes to the back
    const events = own.slice(0, limit || Infinity).map(strip);
    const bundle = { station: id, token: access ? access.token : null, events: events, more: own.length > events.length };
    if (hubEpoch != null) bundle.known = { epoch: hubEpoch, cursor: cursor, at: atCursor() };
    if (clockGuardMs) bundle.sentAt = nowMs();                                     // E35: my clock, for the hub to judge
    if (lostOwed) bundle.lost = lostOwed;
    return bundle;
  }

  /* EFFECTS — durable intent first, then the side-effect. At most once. Never from a read-only window. */
  /* @sms @error — records how a text attempt ended: failed (listed for the operator) or done, then saves the effects store if still the writer */
  function settleEffect(k, e, fx, msg, retry) {
    attempting.delete(k);
    if (msg != null) { const f = retry ? effectsFailed.find(function (x) { return x.k === k; }) : null; if (f) { f.error = msg; f.ts = nowMs(); } else effectsFailed.push({ k: k, id: e.id, effect: fx, error: msg, ts: nowMs() }); noteFailure({ kind: 'effect', id: e.id, effect: fx, error: msg }); }
    else if (retry) effectsFailed = effectsFailed.filter(function (x) { return x.k !== k; });
    if (readOnly || !leaseFresh()) { noteFailure({ kind: 'lease', error: 'the lease lapsed while a text was in flight — its outcome is left on disk as unknown for the next writer to list' }); return; }
    saveEffects();                                                                 // best effort: a row that survives is listed at the next boot as outcome unknown
  }
  /* @sms — sends one text through the hook, the done-mark already on disk; a throw or rejection is recorded as failed */
  function fire(k, e, fx, retry) {                                 // the hook may be synchronous or return a Promise; either way the mark came first
    let out;
    try { out = effectHook(fx, ev.wire(strip(e))); } catch (err) { settleEffect(k, e, fx, failMsg(err), retry); return false; }
    if (out && typeof out.then === 'function') { Promise.resolve(out).then(function () { settleEffect(k, e, fx, null, retry); }, function (err) { settleEffect(k, e, fx, failMsg(err), retry); }); return true; }
    settleEffect(k, e, fx, null, retry); return true;
  }
  /* @sms @fact — fires each text owed by my witnessed facts at most once, the mark written to disk first; nothing from a read-only window or a held store */
  function runEffects() {
    if (readOnly || !effectHook || effectsUnknown) return 0;
    if (effectsDirty && !saveEffects()) return 0;                                  // the disk still refuses: hold everything
    let n = 0;
    mine().forEach(function (e) {
      if (!witnessed(e)) return;
      effectsOf(e).forEach(function (fx) {
        const k = e.id + '|' + fx;
        if (effectsDone.has(k)) return;
        effectsDone.add(k); attempting.set(k, { k: k, id: e.id, effect: fx, ts: nowMs(), attempting: true });
        if (!saveEffects()) { effectsDone.delete(k); attempting.delete(k); return; }   // not durable → held, not fired
        if (fire(k, e, fx, false)) n++;
      });
    });
    return n;
  }
  /* @sync @hub — takes a new hub identity: the cursor starts over, and on a change everything of mine is owed to the new witness */
  function setEpoch(ep) {
    if (ep == null || typeof ep !== 'string' || ep === hubEpoch) return false;
    const changed = hubEpoch != null; hubEpoch = ep; cursor = 0; unapplied.clear();   // no mark here: an older identity's mark is harmless (the hub answers a foreign epoch from zero), and the next pull writes the new one
    if (changed) noteFailure({ kind: 'epoch', note: 'the hub changed identity — everything of mine is owed to the new witness', epoch: ep });
    return changed;
  }
  /* ⚠️ THE HUB'S ANSWER IS UNTRUSTED INPUT: validate the shape; never throw. A refusal of the whole bundle (no access, a
     revoked device, a hub that cannot read its store) is not a witness: it teaches no epoch and acks nothing. */
  /* @sync @fact @invariant — applies the hub's answer (untrusted: its shape checked, never thrown on): acks, refusals, its clock and identity, then the owed texts */
  function applyAcks(res, bundle, reason, backlog, gen) {
    const owedNow = bundle.events.length;
    if (!res || typeof res !== 'object') return failCommit(reason, owedNow, backlog, 'malformed hub response: not an object');
    if (typeof res.refused === 'string' && res.refused) { transportStreak = 0; accessRefused = res.refused; return failCommit(reason, owedNow, backlog, 'the hub refused the bundle: ' + res.refused, { hubRefused: res.refused, refused: owedNow, acked: 0 }); }
    if (typeof res.epoch !== 'string' || !res.epoch) return failCommit(reason, owedNow, backlog, 'malformed hub response: no epoch (which witness is this?)');
    if (gen != null && gen !== generation && res.epoch !== hubEpoch) return failCommit(reason, owedNow, backlog, 'a late answer from an abandoned commit named a different witness (' + res.epoch + ') — ignored');
    if (readOnly) return failCommit(reason, owedNow, backlog, 'read-only window: an answer is not applied');
    if (!renewLease()) return failCommit(reason, owedNow, backlog, 'the lease was lost while the answer was in flight — nothing applied; what the other window holds is on disk, the rest is still owed');
    transportStreak = 0; accessRefused = null;
    noteHubClock(res.now);                                                         // E35: the hub's time on its answer
    setEpoch(res.epoch);
    let acked = 0, refused = 0;
    (Array.isArray(res.eventAcks) ? res.eventAcks : []).forEach(function (a) {
      if (!a || typeof a !== 'object' || typeof a.id !== 'string') { refused++; noteFailure({ kind: 'echo-refused', reason: 'malformed ack' }); return; }
      if (a.ok) {
        const r = log.ack(a.id, a.hash, a.pos, (typeof a.epoch === 'string' ? a.epoch : hubEpoch));
        if (r.ok) { acked++; attempted.delete(a.id); refusedStreak.delete(a.id); } else { refused++; noteFailure({ kind: 'echo-refused', id: a.id, reason: r.reason }); }
      } else {
        refused++; noteFailure({ kind: 'hub-refused', id: a.id, reason: a.reason });
        if (!/retry|storage/.test(a.reason || '')) refusedStreak.set(a.id, (refusedStreak.get(a.id) || 0) + 1);
      }
    });
    if (acked && lostOwed) lostOwed = 0;
    checkPersist();
    const effects = runEffects();
    const out = { ok: true, reason: reason, sent: bundle.events.length, backlog: backlog, acked: acked, refused: refused, effects: effects };
    if (bundle.more) out.more = true;
    if (halted) out.halted = halted;
    lastCommit = out; return out;
  }
  /* @sync @error — a commit that did not land: noted and returned, everything it carried still owed */
  function failCommit(reason, owed, backlog, msg, extra) { noteFailure({ kind: 'commit', reason: reason, error: msg, held: owed }); const out = Object.assign({ ok: false, reason: reason, held: owed, backlog: backlog, error: msg }, extra || {}); lastCommit = out; return out; }

  /* COMMIT — "tile finished, sent." Sync or async transport; one in flight, one queued; a hung answer is abandoned; a big
     backlog goes out in chunks, oldest first, looping while echoes land. */
  /* @sync @fact — tile finished, sent: my unsent facts go to the hub oldest first in chunks of 200, one commit in flight and one queued, a hung one abandoned */
  function commit(reason) {
    if (readOnly) { const out = { ok: false, reason: reason, readOnly: true, error: halted || 'read-only window' }; lastCommit = out; return out; }
    renewLease(); if (readOnly) { const out = { ok: false, reason: reason, readOnly: true, error: halted }; lastCommit = out; return out; }
    if (inFlight) {
      if (mono() - inFlightSince < commitTimeoutMs) { queued = true; const out = { ok: false, reason: reason, deferred: true, error: 'a commit is already in flight; queued' }; lastCommit = out; return out; }
      inFlight = false; queued = false; generation++; noteFailure({ kind: 'commit', reason: reason, error: 'the previous commit never answered in ' + commitTimeoutMs + ' ms — abandoned; everything it carried is still owed' });
    }
    const bundle = outbox(MAX_BUNDLE);
    const backlog = bundle.events.filter(function (e) { return attempted.has(e.id); }).length;
    bundle.events.forEach(function (e) { attempted.add(e.id); });
    const owed = bundle.events.length;
    if (!owed) { const out = { ok: true, reason: reason, sent: 0, backlog: 0, acked: 0, refused: 0, effects: runEffects(), nothingOwed: true }; lastCommit = out; return out; }
    if (!transport) { transportStreak++; return failCommit(reason, owed, backlog, 'no hub connection'); }
    let res;
    try { res = transport(bundle); } catch (err) { transportStreak++; return failCommit(reason, owed, backlog, failMsg(err)); }
    if (res && typeof res.then === 'function') {
      let p; try { p = Promise.resolve(res); } catch (err) { return failCommit(reason, owed, backlog, 'transport returned a broken thenable'); }   // a thenable that is not a Promise becomes one
      const gen = ++generation; inFlight = true; inFlightSince = mono();
      const safeApply = function (r) { try { return applyAcks(r, bundle, reason, backlog, gen); } catch (err) { return failCommit(reason, owed, backlog, 'while applying the hub answer: ' + failMsg(err)); } };
      return p.then(safeApply, function (err) { transportStreak++; return failCommit(reason, owed, backlog, failMsg(err)); })
        .then(function (out) { if (gen === generation) { inFlight = false; if (queued || (out && out.ok && out.more && out.acked > 0)) { const why = (out && out.more) ? 'next-chunk' : 'queued'; queued = false; commit(why); } } return out; });
    }
    let out; try { out = applyAcks(res, bundle, reason, backlog, null); } catch (err) { return failCommit(reason, owed, backlog, 'while applying the hub answer: ' + failMsg(err)); }
    let chunks = 0;
    while (out && out.ok && out.more && out.acked > 0 && chunks < 10000) { chunks++; const next = commit(reason); if (!next || next.deferred || next.readOnly) break; out = Object.assign({}, next, { acked: out.acked + (next.acked || 0), sent: out.sent + (next.sent || 0), refused: out.refused + (next.refused || 0), chunks: chunks }); }
    lastCommit = out; return out;
  }
  /* an outcome that may be a Promise (HTTPS): hand the caller the tile AND the pending answer, never a bare {tile} */
  /* @sync @station — a commit's outcome with the tile name, or the tile plus the pending answer when it is still in flight */
  function withTile(tname, out) { if (out && typeof out.then === 'function') return { tile: tname, pending: out }; return Object.assign({ tile: tname }, out); }
  let auditAt = 0;   /* where the rolling audit (selfCheck { rehash: N }) goes on from, in the log's own order */
  /* @station @audit — the next n facts of the rolling audit, wrapping to the start: every fact is reached once per lap (audit E27) */
  function auditSlice(all, n) {
    if (n >= all.length) { auditAt = 0; return all; }
    if (auditAt >= all.length) auditAt = 0;
    const out = all.slice(auditAt, auditAt + n); if (out.length < n) out.push.apply(out, all.slice(0, n - out.length));
    auditAt = (auditAt + n) % all.length; return out;
  }

  /* my OWN history seeds my clock unconditionally (a wall clock a year behind my last stamp is the wall's fault, not my log's);
     a peer's stamp is observed under the drift cap */
  /* @clock @fact — seeds my clock from the log: my own stamps adopted as they are, other stations' under the drift cap */
  function seedClock() { log.all().forEach(function (e) { if (e.station === id) clock.adopt(e.hlc); else clock.observe(e.hlc); }); }
  seedClock();
  rebuildVersions();
  if (log.quarantined > 0) noteFailure({ kind: 'persist', what: 'load', error: log.quarantined + ' garbage row(s) quarantined at boot' });

  const station = {
    id: id, name: name, clock: clock,
    get log() { return log; },
    get cursor() { return cursor; }, set cursor(v) { cursor = v; if (!readOnly) log.markCursor(markAt(cursor), hubEpoch); },   // the mark rides behind the facts just pulled — and never past one this copy could not apply
    atCursor: atCursor,
    get epoch() { return hubEpoch; }, get readOnly() { return readOnly; }, get halted() { return halted; }, get haltKind() { return haltKind; },
    get access() { return access ? { station: access.station, enrolled: true } : null },
    get accessToken() { return access ? access.token : null; },
    get accessRefused() { return accessRefused; },
    get failures() { return failures.slice(); }, get effectsFailed() { return effectsFailed.slice(); },
    get effectsUnknown() { return effectsUnknown; },
    get tile() { return tile ? Object.assign({}, tile) : null; },
    get lastCommit() { return lastCommit; }, get inFlight() { return inFlight; },
    setTransport(fn) { transport = fn || null; },
    /* an OPERATOR's enrollment hands this device its access token (production: pasted once, like today's hub key) */
    setAccess(token) {
      if (typeof token !== 'string' || !token) return false;
      if (halted && haltKind === 'store') return false;
      access = { station: id, token: token }; accessRefused = null; saveAccessNow(); return true;
    },
    /* A key the hub NEVER issued (a setup code typed in the operator box) is dropped — only while this device
       holds nothing of its own still to send, so no record is ever stranded — and the device is back at its connect screen */
    dropUnissuedAccess() {
      if (!access) return false; if (log.outbox(hubEpoch).some(function (e) { return e.station === id; })) return false;
      access = null; accessRefused = null; saveAccessNow(); return true;
    },
    onEffect(fn) { effectHook = fn || null; },
    setEpoch: setEpoch,
    noteHubClock: noteHubClock,
    get refusedOwed() { return refusedStreak.size ? log.outbox(hubEpoch).filter(function (e) { return e.station === id && refusedStreak.has(e.id); }).length : 0; },   /* E67: facts of mine the hub refuses, still owed */
    get clockSkew() { return clockSkew(); }, get clockWrong() { return clockGuardMs ? clockWrongWords() : null; },
    mine: mine,

    /* RECORD — the offline moment. Validate, THEN mint, append. */
    record(type, key, payload, meta) {
      if (readOnly) throw new Error('station ' + id + ' is read-only: ' + (halted || 'another window holds it'));
      if (!renewLease()) throw new Error('station ' + id + ' is read-only: ' + halted);
      if (!registry.knows(type)) throw new Error('unknown event type "' + type + '" — register it; every delta needs a home');
      const def = registry.typeDef(type); meta = meta || {};
      if (def.validate) { const bad = def.validate(payload || {}); if (bad) throw new Error('invalid ' + type + ': ' + bad); }
      if (def.admit) { const no = def.admit(payload || {}, function (dotted, v) { return registry.heldIn(log.all(), type, dotted, v); } /* 10/18: an id this tablet's history already holds is a reference (THE ID RULE, core/registry.js) — read only when an id breaks the rule */); if (no) throw new Error('invalid ' + type + ': ' + no); }   /* 10/1: a rule for new facts (never applied to a fact taken from the hub — history keeps what it was) */
      if (clockGuardMs) { const cw = clockWrongWords(); if (cw) throw new Error('⏰ ' + cw); }   // E35: never a fact under a clock the hub says is wrong
      const e = ev.makeEvent({ type: type, aggregate: def.aggregate, key: key, payload: payload, hlc: clock.now(),
        basedOn: versionByKey[def.aggregate + '|' + String(key)] || null, station: id, actor: meta.actor, at: meta.at });
      log.append(e); checkPersist();
      noteVersion(e);   /* versionByKey[key] = e.id, and whether the map is still each key's newest (batch perf) */
      if (tile && (meta.actor != null || meta.touch)) { tile.lastTouch = nowMs(); tile.touchedMono = mono(); }   // a person's act resets the idle clock; a system fact does not
      if (!tile && def.tier === 'immediate' && !meta.defer) commit('event:' + type);
      return e;
    },
    commit: commit,
    openTile(tname) {
      const t = (tileTimeouts[tname] !== undefined) ? tileTimeouts[tname] : (DEFAULT_TILE_TIMEOUTS[tname] !== undefined ? DEFAULT_TILE_TIMEOUTS[tname] : null);
      tile = { name: tname, openedAt: nowMs(), lastTouch: nowMs(), touchedMono: mono(), timeoutMs: (t > 0 ? t : null) }; return station.tile;
    },
    touch() { if (tile) { tile.lastTouch = nowMs(); tile.touchedMono = mono(); } renewLease(); },
    closeTile(why) { const t = tile; tile = null; const tname = t ? t.name : null; return withTile(tname, commit((why || 'home') + (t ? ':' + t.name : ''))); },
    tick() {
      /* a window that crashed never released its lease: the reload boots read-only, and takes the station back by itself once
         a FULL TTL of its own (monotonic) time has passed since it was last refused — a live writer that keeps renewing is
         never taken over, and a wall-clock jump cannot fake the wait */
      if (readOnly && haltKind === 'lease') {
        if (leaseRefusedAt != null && mono() - leaseRefusedAt < leaseGrant) return null;
        return station.reclaim() ? { reclaimed: true } : null;
      }
      renewLease(); if (readOnly) return null;
      checkPersist();                                                                // the heartbeat retries a refused write; nothing waits in memory for a tap
      if (inFlight && mono() - inFlightSince >= commitTimeoutMs) commit('tick');   // give up on a hung answer even with no tile open
      if (!tile || !(tile.timeoutMs > 0)) return null; const idle = mono() - tile.touchedMono; if (idle < tile.timeoutMs) return null; return Object.assign({ timedOut: true, idleMs: idle }, station.closeTile('idle-timeout'));
    },
    /* an OPERATOR retries the effects whose hook failed (a gateway 503) or whose outcome is unknown: "retrying" is written
       before each fires; success drops it from the list. A retry is a human's decision, never something a reboot does. */
    retryEffects() {
      if (readOnly || !effectHook || effectsUnknown) return 0;
      if (!renewLease()) return 0;
      if (effectsDirty && !saveEffects()) return 0;
      let n = 0; const list = effectsFailed.slice();
      for (let i = 0; i < list.length; i++) {
        const f = list[i]; const e = log.get(f.id);
        if (!e || !effectRowValid(f)) { effectsFailed = effectsFailed.filter(function (x) { return x.k !== f.k; }); noteFailure({ kind: 'effect', id: f.id, error: 'retry refused: the row names no fact of mine with that effect — dropped' }); continue; }
        if (e.pos == null) continue;                                                 // a fact currently owed again is not retried until it is witnessed
        const row = effectsFailed.find(function (x) { return x.k === f.k; }); if (!row) continue;
        const was = row.error; row.error = 'retrying'; row.ts = nowMs();
        if (!saveEffects()) { row.error = was; return n; }                           // the retry mark must land before the hook fires
        if (fire(f.k, e, f.effect, true)) n++;
      }
      saveEffects(); return n;
    },
    /* the window is closing: flush what it can, give the lease back so a reload is the same station — and be a writer no more */
    close() {
      if (!readOnly) { checkPersist(); const lost = (log.dirty ? 1 : 0) + (log.pending ? log.pending() : 0); if (lost) noteFailure({ kind: 'persist', what: 'close', error: 'CLOSED WITH ' + lost + ' WRITE(S) THE DISK STILL REFUSES — a fact may die with this window' }); }
      try { if (persist && typeof persist.release === 'function') persist.release(nonce); } catch (e) {}
      rehalt('closed', 'this window was closed');
    },
    /* a read-only window whose ONLY problem was the lease may become the writer once the lease is free: it re-reads the
       access store and the log first (the other window may have written), MERGES what it held and never flushed, and only
       then drops read-only */
    reclaim() {
      if (!readOnly || haltKind !== 'lease') return false;
      if (!takeLease()) return false;
      const a = loadAccessNow();
      if (a.ok && a.value && a.value.station !== id) { rehalt('store', 'this store belongs to station "' + a.value.station + '", not "' + id + '"'); return false; }
      if (a.ok) { if (a.value) access = a.value; else if (access) accessDirty = true; }
      const unflushed = log.all(), prevFailed = effectsFailed.slice(), prevDone = new Set(effectsDone), prevAttempting = new Map(attempting);
      const fresh = makeLog(persist);
      if (fresh.unreadable) { noteFailure({ kind: 'persist', what: 'load', error: 'reclaim: my log could not be read; staying read-only' }); return false; }
      log = fresh; restoreMark(true);   // the store's own mark; none → re-read from zero, which is always safe
      let merged = 0; unflushed.forEach(function (e) { if (!log.has(e.id)) { log.append(e); merged++; } else if (e.adopted && !log.get(e.id).adopted) log.markAdopted(e.id); });   // what I held and the disk never got
      if (hasEffectsStore) {
        loadEffects();
        if (!effectsUnknown && effectsDone.size === 0 && prevDone.size) { prevDone.forEach(function (k) { effectsDone.add(k); }); noteFailure({ kind: 'persist', what: 'effects-load', error: 'reclaim: the effects store came back empty — my done-marks were carried forward' }); effectsDirty = true; }
        prevFailed.forEach(function (f) { if (effectsDone.has(f.k)) return; if (!effectRowValid(f)) return; effectsDone.add(f.k); effectsFailed.push(f); effectsDirty = true; });   // a row the store already knows was resolved by the other window
        prevAttempting.forEach(function (row, k) { if (effectsDone.has(k)) return; effectsDone.add(k); effectsFailed.push({ k: k, id: row.id, effect: row.effect, error: 'attempted before a lease lapse — outcome unknown; an operator decides', ts: row.ts }); effectsDirty = true; });
      }
      rebuildVersions(); seedClock();
      readOnly = false; halted = null; haltKind = null;
      reconcileRegistry();
      noteFailure({ kind: 'lease', note: 'reclaimed the station; state re-read from the store' + (merged ? '; ' + merged + ' unflushed row(s) merged back' : '') });
      checkPersist();
      return true;
    },
    /* @sync @station — E86 (batch `sync` 9/25): the highest position the hub has given a fact of mine, read as a pull goes out; a fact
       witnessed after it (a commit whose small answer overtook the pull's big one) is never taken for one the hub lost */
    witnessMark() { let m = 0; mine().forEach(function (e) { if (witnessed(e) && e.pos > m) m = e.pos; }); return m; },
    /* INGEST — facts from the hub, the authority. Clone, check shape and hash. A fact of MINE I do not hold is taken back
       (its texts held for an operator BEFORE it lands); a fact of mine the hub had witnessed at a position it now gives to
       another fact was LOST by the hub — mine is owed again. A different fact under an id I hold is refused, never applied.
       E86: mark (witnessMark() when the pull went out) — a fact of mine witnessed after that is newer than the answer, never lost. */
    ingest(events, head, mark) {
      let added = 0, refused = 0, acked = 0, adopted = 0, lost = 0, holdAt = null;
      if (readOnly || !renewLease()) return { added: 0, refused: 0, acked: 0, adopted: 0, readOnly: true };
      const mineAt = new Map(); if (events && events.length) mine().forEach(function (e) { if (witnessed(e)) mineAt.set(e.pos, e); });   /* an empty pull (an idle tick) reads nothing from it (batch perf) */
      (events || []).forEach(function (raw) {
        if (readOnly) { refused++; return; }
        let e; try { e = ev.wire(raw); } catch (err) { refused++; noteFailure({ kind: 'ingest-refused', reason: 'not transmissible' }); return; }
        if (e && typeof e === 'object') { delete e.adopted; delete e.everPos; }        // another copy's metadata is not mine
        const shape = ev.shapeError(e);
        if (shape || !ev.verify(e)) { refused++; noteFailure({ kind: 'ingest-refused', id: e && e.id, reason: shape || 'content does not match its hash' }); return; }
        const def = registry.typeDef(e.type);
        if (!def || def.aggregate !== e.aggregate || (def.validate && def.validate(e.payload))) {
          refused++; if (Number.isInteger(e.pos) && e.epoch === hubEpoch) unapplied.set(e.pos, { id: e.id, type: e.type });   // read again after the update, never skipped
          noteFailure({ kind: 'ingest-refused', id: e.id, reason: 'not a registered event of that aggregate, or an invalid payload — this station needs the update the hub has' }); return; }
        if (unapplied.size && Number.isInteger(e.pos)) unapplied.delete(e.pos);
        const had = (e.pos != null && e.epoch === hubEpoch) ? mineAt.get(e.pos) : null;
        if (had && had.id !== e.id && log.reoffer(had.id)) { lost++; mineAt.delete(e.pos); }   // the hub gave my witnessed position to another fact: it lost mine
        clock.observe(e.hlc);
        if (!log.has(e.id)) {
          if (e.station === id) {
            /* a write of mine that never reached (or left) my disk — its texts are HELD, durably, BEFORE the fact lands */
            const heldNow = holdEffectsOf(e, 'taken back from the hub: this copy never saw the text go out — it fired before the write was lost, or never; an operator decides (retryEffects)');
            if (heldNow && !saveEffects()) { effectsOf(e).forEach(function (fx) { const k = e.id + '|' + fx; effectsDone.delete(k); effectsFailed = effectsFailed.filter(function (x) { return x.k !== k; }); }); refused++; if (e.pos != null && (holdAt == null || e.pos < holdAt)) holdAt = e.pos; noteFailure({ kind: 'adopt-deferred', id: e.id, reason: effectsUnknown ? 'the effects store is HELD (unreadable) — the fact stays on the hub until an operator resolves it' : 'the effects store refused the hold-mark — the fact stays on the hub until the disk returns' }); return; }
            log.append(e); log.markAdopted(e.id); adopted++; clock.adopt(e.hlc); relistOrphans();
            noteFailure({ kind: 'adopted', id: e.id, note: 'a fact recorded as this station was on the hub but not in my log (a lost write, a restored backup, or another copy of this tablet) — taken back; its texts are listed for an operator' });
          } else { log.append(e); added++; }
          if (e.pos != null && e.epoch != null) log.ack(e.id, e.hash, e.pos, e.epoch);
          return;
        }
        if (log.get(e.id).hash !== e.hash) { refused++; noteFailure({ kind: 'ingest-refused', id: e.id, reason: 'the hub holds a different fact under an id I hold — kept mine, refused theirs; an operator must look' }); return; }
        if (e.pos != null && e.epoch != null) { const r = log.ack(e.id, e.hash, e.pos, e.epoch); if (r.ok && r.newlyWitnessed) acked++; }
      });
      /* a QUIET restore: the hub's whole record ends before a position it had given a fact of mine — it lost that fact */
      if (Number.isInteger(head) && head >= 0 && !readOnly) mine().forEach(function (e) { if (witnessed(e) && e.pos > head && !(Number.isInteger(mark) && e.pos > mark) && log.reoffer(e.id)) lost++; });   /* E86: only what was witnessed before the pull went out */
      if (lost) { lostOwed += lost; noteFailure({ kind: 'reoffer', note: lost + ' fact(s) of mine the hub had witnessed are gone from it (its store went back in time) — owed again, and the hub is told' }); }
      checkPersist(); rebuildVersions(); runEffects();
      return { added: added, refused: refused, acked: acked, adopted: adopted, lost: lost, holdAt: holdAt, readOnly: readOnly || undefined };
    },
    project(aggregate) { const agg = registry.aggregate(aggregate); if (!agg) throw new Error('unknown aggregate "' + aggregate + '"'); return agg.fold(log.sorted().filter(function (e) { return e.aggregate === aggregate; })); },
    outbox: function () { return outbox(); }, noteFailure: noteFailure,
    /* An operator resolves an unreadable effects store. 'seed' = every effect of mine that was EVER witnessed (pos set under any
       hub, or re-offered since) is treated as done — they fired before, or nothing can know; 'clear' = fire them all. Anything
       else is refused: the store stays held, because a typo must never text every customer in the log. Failed rows stay listed. */
    resolveEffects(how) {
      if (!effectsUnknown || readOnly) return false;
      if (how !== 'seed' && how !== 'clear') return false;
      if (!renewLease()) return false;
      if (how === 'seed') { mine().forEach(function (e) { if (!log.everWitnessed(e)) return; effectsOf(e).forEach(function (fx) { effectsDone.add(e.id + '|' + fx); }); }); }
      effectsUnknown = false; const ok = saveEffects(true); if (!ok) effectsUnknown = true; else reconcileRegistry(); return ok;
    },
    /* @station @audit — the whole audit with no argument (every fact re-hashed, as before); { rehash: N } — the Home screen's
       health line — re-checks N facts a call on a rolling window, so all history is re-hashed every few hours of Home without a
       draw ever re-hashing all of it (audit E27, batch `perf`: 1.7 s of every 5 s at 31k facts); { rehash: false } checks the
       shape of every fact and hashes none. Everything that is not per-fact is checked every call. */
    selfCheck(opts) {
      const all = log.all(), problems = [], ids = new Set(), o = opts || {}, rehash = o.rehash !== false;
      const span = (Number.isInteger(o.rehash) && o.rehash >= 0) ? auditSlice(all, o.rehash) : all;
      if (halted) problems.push('HALTED: ' + halted);
      span.forEach(function (e) {
        if (ids.has(e.id)) problems.push('duplicate event id in my log: ' + e.id); ids.add(e.id);
        if (!registry.knows(e.type)) problems.push('event of unknown type in my log: ' + e.type);
        const shape = ev.shapeError(e);
        if (shape) problems.push('malformed event in my log (' + shape + '): ' + (e && e.id));
        else if (rehash && !ev.verify(e)) problems.push('content does not match its hash (tampered or corrupted): ' + e.id);
      });
      if (!access) problems.push('this device has no hub access — an operator enrolls it; facts are kept and sent after');
      if (accessRefused) problems.push('the hub refused this device: ' + accessRefused);
      if (log.dirty || (log.pending && log.pending() > 0)) problems.push('my log has writes the disk has not taken yet');
      if (accessDirty) problems.push('the access store refused a write');
      if (effectsUnknown) problems.push('effects store unreadable — texts HELD until an operator resolves it');
      if (effectsDirty) problems.push('the effects store refused a write — texts held');
      if (effectsFailed.length) problems.push(effectsFailed.length + ' text(s) failed or outcome unknown — an operator decides (retryEffects)');
      if (orphanFailed.size) problems.push(orphanFailed.size + ' failed text row(s) name facts I do not hold yet');
      refusedStreak.forEach(function (n, fid) { if (n >= REFUSED_STREAK) problems.push('the hub refused ' + fid + ' ' + n + ' times in a row'); });
      if (transportStreak >= REFUSED_STREAK && log.outbox(hubEpoch).some(function (e) { return e.station === id; })) problems.push(transportStreak + ' commits in a row never reached the hub while facts are owed');
      if (log.quarantined > 0) problems.push(log.quarantined + ' garbage row(s) quarantined from my log');
      if (unapplied.size) problems.push(unapplied.size + ' fact(s) from the hub this copy cannot apply yet — it needs the update (reload the page); they are read again after it, never skipped');
      const cwNow = clockGuardMs ? clockWrongWords() : null; if (cwNow) problems.push('⏰ ' + cwNow);
      const own = mine();
      return { ok: problems.length === 0, problems: problems, events: all.length, audited: span.length, mine: own.length, unwitnessed: own.filter(function (e) { return !witnessed(e); }).length,
        failures: failures.length, effectsFailed: effectsFailed.length, effectsUnknown: effectsUnknown, effectsDirty: effectsDirty, orphanEffects: orphanFailed.size,
        persistDirty: !!log.dirty, pending: log.pending ? log.pending() : 0, quarantined: log.quarantined, readOnly: readOnly, halted: halted, haltKind: haltKind, cursor: cursor, epoch: hubEpoch, enrolled: !!access, tileOpen: tile ? tile.name : null, unapplied: unapplied.size };
    }
  };
  return station;
}

module.exports = { makeStation: makeStation, DEFAULT_TILE_TIMEOUTS: DEFAULT_TILE_TIMEOUTS, LEASE_MS: LEASE_MS, COMMIT_TIMEOUT_MS: COMMIT_TIMEOUT_MS, REFUSED_STREAK: REFUSED_STREAK, MAX_BUNDLE: MAX_BUNDLE, CLOCK_GUARD_MS: CLOCK_GUARD_MS };
