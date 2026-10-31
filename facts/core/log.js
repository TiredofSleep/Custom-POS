'use strict';
/* ============================================================================
 * LOG — a station's append-only record. "ALWAYS FORWARD."
 * @fact @storage @sync — a station's append-only record of facts: nothing edited or removed, a refused write waits in order, a torn row quarantined
 * ----------------------------------------------------------------------------
 * Nothing here is ever edited or removed. Two persistence shapes behind one API:
 *   snapshot  persist.load() / persist.save(events)  — the whole array (small stations, tests)
 *   journal   persist.load() / persist.append(row)   — one line per fact ({ev}), one per echo ({ack}),
 *             one per re-offer ({unack}), one per adoption ({adopt}); a 20k-event station never rewrites
 * A refused write is never thrown at the operator: the log is DIRTY, the row waits in a pending queue in
 * order, and the next successful write or flush() drains it — never re-appending the log.
 *
 * Every row is verified at load (shape + hash + signature); a torn or unknown row is quarantined and
 * counted, an unreadable store is reported as UNREADABLE (the station halts). Marks are applied in journal
 * order so the LAST word wins.
 *
 * A journal also carries CURSOR MARKS ({mark: {cursor, epoch}}, 2026-09-23 — step 2 of the wire): where this station
 * had read the hub up to, written AFTER the facts that pull brought in. Journal writes go strictly in order, so a
 * mark on disk means every fact before it is on disk too; a log restored from an older backup brings back its own,
 * older mark. A reboot therefore resumes from the mark instead of re-reading the whole hub, and can never skip a fact.
 * The snapshot shape keeps no mark (a small store simply re-reads).
 *
 * Two kinds of metadata ride beside the witness marks, unhashed, never the fact:
 *   adopted   this copy took the fact back from the hub (a write it never saw land): its texts are listed for an
 *             operator and never fired blind; the mark survives a reboot
 *   everPos   the position a fact once held before it was re-offered — round 5: "ever witnessed" survives
 *             a re-offer, so an operator's seed never re-texts what went out
 * ========================================================================== */
const ev = require('./event');
const hlc = require('./hlc');

/* @fact @storage — one station's log over its storage (whole-array snapshot or line-per-row journal): every row verified at load, nothing ever edited, a failed write left dirty and retried in order */
function makeLog(persist) {
  const journal = !!(persist && typeof persist.append === 'function');
  let events = [];
  let quarantined = 0;
  const byId = new Map();
  const pending = [];                                            // journal rows not yet on disk, in order
  let sortedCache = null;                                        // extended on append in order, dropped when a fact sorts earlier (keepSorted)
  let mineCache = null;                                          /* one station's own facts in its clock's order, kept as facts arrive */
  const api = { persistError: null, dirty: false, quarantined: 0, journal: journal, writes: 0, unreadable: false };

  /* @fact — takes a fact in once by its id; a second copy of a held id is refused (false), never a duplicate */
  function adopt(e) { if (byId.has(e.id)) return false; events.push(e); byId.set(e.id, e); keepSorted(e); return true; }
  /* @fact @fold — a fact that sorts after everything already in order joins the kept orders at their end (the order a full sort
     gives: the sort is stable); one that sorts earlier — a peer's fact arriving late — means a fresh sort next time. A tablet no
     longer re-sorts all history after every fact (audit E15, batch `perf`). */
  function keepSorted(e) {
    if (sortedCache) { const last = sortedCache[sortedCache.length - 1]; if (!last || hlc.compareEvents(last, e) <= 0) sortedCache.push(e); else sortedCache = null; }
    if (mineCache && e.station === mineCache.id) { const l = mineCache.list, m = l[l.length - 1]; if (!m || hlc.compareEvents(m, e) <= 0) l.push(e); else mineCache = null; }
  }
  /* @fact — a stored fact is loaded only if well-formed and its hash still matches; anything else is quarantined */
  function goodEvent(e) { return !!e && typeof e === 'object' && ev.shapeError(e) === null && ev.verify(e); }
  /* @fact @sync — a hub echo row is believed only whole: an id, a hash, a positive whole position, an epoch string or none */
  function goodAck(a) { return !!a && typeof a === 'object' && typeof a.id === 'string' && typeof a.hash === 'string' && Number.isInteger(a.pos) && a.pos > 0 && (a.epoch == null || typeof a.epoch === 'string'); }
  /* @fact @sync — a re-offer row needs the fact's id and nothing more */
  function goodUnack(u) { return !!u && typeof u === 'object' && typeof u.id === 'string'; }
  /* @fact @sync — an adoption row (this copy took its own fact back from the hub) needs the fact's id */
  function goodAdopt(a) { return !!a && typeof a === 'object' && typeof a.id === 'string'; }
  /* @fact @sync — a cursor mark is trusted only whole (a cursor of 0 or more, an epoch string or none); a torn mark means re-reading the hub, never skipping a fact */
  function goodMark(m) { return !!m && typeof m === 'object' && Number.isInteger(m.cursor) && m.cursor >= 0 && (m.epoch == null || typeof m.epoch === 'string'); }
  let lastMark = null;                                           // the latest cursor mark, in journal order
  (function load() {
    let raw;
    try { raw = (persist && typeof persist.load === 'function') ? persist.load() : []; }
    catch (err) { quarantined = -1; api.quarantined = -1; api.unreadable = true; return; }
    if (raw == null) raw = [];
    if (!Array.isArray(raw)) { quarantined = -1; api.quarantined = -1; api.unreadable = true; return; }
    const marks = [];
    raw.forEach(function (row) {
      if (journal && row && typeof row === 'object') {
        const kinds = ['ev', 'ack', 'unack', 'adopt', 'mark'].filter(function (k) { return row[k] !== undefined; });
        if (kinds.length !== 1) { quarantined++; return; }                          // a row is one thing; {ev, ack} together is damage
        if (kinds[0] === 'mark') { if (goodMark(row.mark)) lastMark = { cursor: row.mark.cursor, epoch: row.mark.epoch == null ? null : row.mark.epoch }; else quarantined++; return; }   // a torn mark is never trusted
        if (kinds[0] === 'ack') { if (goodAck(row.ack)) marks.push(row); else quarantined++; return; }
        if (kinds[0] === 'unack') { if (goodUnack(row.unack)) marks.push(row); else quarantined++; return; }
        if (kinds[0] === 'adopt') { if (goodAdopt(row.adopt)) marks.push(row); else quarantined++; return; }
        if (goodEvent(row.ev)) { if (!adopt(row.ev)) quarantined++; } else quarantined++;
        return;
      }
      if (goodEvent(row)) { if (!adopt(row)) quarantined++; } else quarantined++;
    });
    marks.forEach(function (m) {                                  // in journal order, so the LAST word wins
      if (m.ack) { const e = byId.get(m.ack.id); if (e && m.ack.hash === e.hash) { e.pos = m.ack.pos; e.epoch = (m.ack.epoch == null ? null : m.ack.epoch); } else quarantined++; }
      else if (m.unack) { const e = byId.get(m.unack.id); if (e) { if (e.pos != null) e.everPos = e.pos; if (Number.isInteger(m.unack.everPos)) e.everPos = m.unack.everPos; e.pos = null; e.epoch = null; } else quarantined++; }
      else { const e = byId.get(m.adopt.id); if (e) e.adopted = true; else quarantined++; }
    });
    api.quarantined = quarantined;
  })();

  /* ---- writing ---- */
  /* @fact @storage — writes the pending journal rows in order and stops at the first failure: the log goes dirty, nothing is lost or written twice */
  function drain() {                                             // journal: everything pending, in order; stop at the first failure
    while (pending.length) {
      try { persist.append(pending[0]); pending.shift(); api.writes++; }
      catch (err) { api.persistError = String((err && err.message) || err); api.dirty = true; return false; }
    }
    api.persistError = null; api.dirty = false; return true;
  }
  /* @fact @storage — queues one journal row behind any still waiting, then drains, so rows reach the disk strictly in order */
  function journalRow(row) { pending.push(row); return drain(); }
  /* @fact @storage — rewrites the whole snapshot; a failure marks the log dirty instead of being thrown at the operator */
  function snapshotSave() {
    if (!(persist && typeof persist.save === 'function')) return true;
    try { persist.save(events); api.writes++; api.persistError = null; api.dirty = false; return true; }
    catch (err) { api.persistError = String((err && err.message) || err); api.dirty = true; return false; }
  }
  /* @fact @sync — the journal row that records where the hub filed a fact (id, hash, position, epoch) */
  function ackRow(e) { return { ack: { id: e.id, hash: e.hash, pos: e.pos, epoch: e.epoch } }; }

  /* @fact @station — one station's own facts in its clock's order: kept as they arrive (keepSorted), sorted afresh only after one
     arrived out of order; each caller gets its own list (audit E15, batch `perf`: a sort of all history on every commit) */
  function mine(stationId) {
    if (mineCache && mineCache.id === stationId) return mineCache.list.slice();
    const list = events.filter(function (e) { return e.station === stationId; }).sort(hlc.compareEvents);   // one station's own clock orders its own facts
    mineCache = { id: stationId, list: list }; return list.slice();
  }
  /* @fact @station — one station's latest fact in its own clock's order, or null */
  function lastOf(stationId) { const m = mine(stationId); return m.length ? m[m.length - 1] : null; }

  api.append = function (e) {
    if (byId.has(e.id)) return byId.get(e.id);
    adopt(e);
    if (!persist) return e;
    if (journal) journalRow({ ev: e }); else snapshotSave();
    return e;
  };
  /* this copy took a fact of its own back from the hub: durable metadata, so a reboot still knows */
  api.markAdopted = function (id) {
    const e = byId.get(id); if (!e || e.adopted) return false;
    e.adopted = true;
    if (persist) { if (journal) journalRow({ adopt: { id: e.id } }); else snapshotSave(); }
    return true;
  };
  api.has = function (id) { return byId.has(id); };
  api.get = function (id) { return byId.get(id) || null; };
  api.all = function () { return events.slice(); };
  api.from = function (i) { return events.slice(i); };   /* the facts taken in since the log held i of them, in the order they came (batch perf) */
  api.sorted =function () { if (!sortedCache) sortedCache = events.slice().sort(hlc.compareEvents); return sortedCache.slice(); };
  api.mine = mine;
  api.lastOf = lastOf;
  /* Everything the current witness has not echoed — own facts unwitnessed, and anything (own or carried)
     witnessed only by an older hub. */
  api.outbox = function (epoch) {
    return events.filter(function (e) { return e.pos == null || (epoch != null && e.epoch !== epoch); });
  };
  api.ack = function (id, hash, pos, epoch) {
    const e = byId.get(id);
    if (!e) return { ok: false, reason: 'unknown event' };
    if (hash !== e.hash) return { ok: false, reason: 'hash mismatch: the hub does not hold what I wrote' };
    if (!(Number.isInteger(pos) && pos > 0)) return { ok: false, reason: 'malformed position' };
    const was = (e.pos == null || (epoch != null && e.epoch !== epoch));
    if (was) { e.pos = pos; e.epoch = (epoch == null ? null : epoch); if (persist) { if (journal) journalRow(ackRow(e)); else snapshotSave(); } }
    return { ok: true, newlyWitnessed: was };
  };
  /* The witness turned out not to hold it (or a new witness took over): owed again, and the journal says so — but
     "it was witnessed once" is kept (everPos), so an effect that already fired is never re-fired by a seed. */
  api.reoffer = function (id) {
    const e = byId.get(id);
    if (!e || e.pos == null) return false;
    e.everPos = e.pos; e.pos = null; e.epoch = null;
    if (persist) { if (journal) journalRow({ unack: { id: e.id, everPos: e.everPos } }); else snapshotSave(); }
    return true;
  };
  api.everWitnessed = function (e) { return !!e && (e.pos != null || Number.isInteger(e.everPos)); };
  /* where this station has read the hub up to — journal only, queued BEHIND the facts that pull brought in */
  api.markCursor = function (cursor, epoch) {
    if (!(persist && journal) || !Number.isInteger(cursor) || cursor < 0) return false;
    const m = { cursor: cursor, epoch: (epoch == null ? null : String(epoch)) };
    if (lastMark && lastMark.cursor === m.cursor && lastMark.epoch === m.epoch) return true;   // nothing moved: no row
    lastMark = m; journalRow({ mark: m }); return true;
  };
  api.lastMark = function () { return lastMark ? { cursor: lastMark.cursor, epoch: lastMark.epoch } : null; };
  api.flush = function () { if (!persist) return true; return journal ? drain() : snapshotSave(); };
  api.pending = function () { return pending.length; };
  api.size = function () { return events.length; };
  /* @fact @fold — the facts taken in after the first n, in the order they came (core/incfold.js follows the log with this: a new fact costs its own step, never a copy of all history) */
  api.since = function (n) { return events.slice(Math.max(0, n | 0)); };
  return api;
}

module.exports = { makeLog: makeLog };
