'use strict';
/* ============================================================================
 * THE BROWSER STORE — a tablet's journal in IndexedDB, behind the station's SYNCHRONOUS persist interface
 * @storage @sync @station — a tablet's journal in IndexedDB behind the station's synchronous store: one ordered write queue, a tab lease that fails closed, nothing written out of order
 * ----------------------------------------------------------------------------
 * (2026-09-23, step 2 of the wire: "the station log on disk — browser: IndexedDB with the same rows".)
 * The station asks its store for load / append (the journal), loadAccess / saveAccess, loadEffects / saveEffects,
 * and lease / release — all synchronous. IndexedDB is asynchronous. So:
 *   · openBrowserStore() reads everything ONCE, before the station is made, into an in-memory mirror; the station's
 *     synchronous calls are answered from the mirror.
 *   · Every write joins ONE queue, written to IndexedDB in order, in batched transactions. A refused write (a full
 *     disk, a quota) is retried in order with backoff, and while the store is behind, append/save THROW — so the
 *     log keeps the next rows in its own pending queue (never re-appended), the station's selfCheck says
 *     persistDirty, and nothing is ever written out of order. A row accepted before the failure is written first.
 *   · The tab lease lives in localStorage (synchronous, shared by every tab of the origin) with a GENERATION that
 *     rises whenever a different tab takes it. A tab that re-takes its lease after another tab held it knows its
 *     mirror may be stale: load() refuses, the station's reclaim fails closed, and the tab says "reload this page".
 *     It never writes over the other tab's work.
 *   · A write that was queued but not yet on disk when the page died is the same case as any lost write: the hub
 *     holds what was committed, and the next pull takes it back (texts held for an operator, never fired blind).
 *   · (batch `perf`, 9/25) The writing tab's station takes the journal's rows as IndexedDB gave them and the mirror is let
 *     go, so history is held once, not twice (E84). The cursor mark is one row in meta, overwritten in the same ordered
 *     queue, not a journal row per pull (E87). A lease this tab takes back with nobody else having held it says so
 *     (same), and the station goes on without re-reading (E71).
 * ========================================================================== */
/* @storage — a deep copy through JSON, so nothing the station holds shares an object with the store; undefined stays undefined */
function clone(v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }

/* @storage @station — opens this tablet's IndexedDB and reads it all once, before the station is made; with no IndexedDB, no station id, or a store that cannot be opened or read, it refuses and replaces nothing */
function openBrowserStore(stationId, opts) {
  opts = opts || {};
  const idb = opts.indexedDB || (typeof indexedDB !== 'undefined' ? indexedDB : null);
  const ls = opts.localStorage !== undefined ? opts.localStorage : (typeof localStorage !== 'undefined' ? localStorage : null);
  if (!idb) return Promise.reject(new Error('this browser has no IndexedDB, so this tablet cannot keep its log here'));
  if (typeof stationId !== 'string' || !stationId) return Promise.reject(new Error('openBrowserStore: a station id is required'));
  const name = (opts.prefix || 'custompos-') + stationId;

  return new Promise(function (ok, no) {
    const rq = idb.open(name, 1);
    rq.onupgradeneeded = function () { const d = rq.result;
      if (!d.objectStoreNames.contains('journal')) d.createObjectStore('journal', { autoIncrement: true });
      if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta'); };
    rq.onsuccess = function () { ok(rq.result); };
    rq.onerror = function () { no(new Error('this tablet\'s store could not be opened (' + ((rq.error && rq.error.message) || 'unknown') + ') — nothing was replaced')); };
    rq.onblocked = function () { no(new Error('this tablet\'s store is held by an older copy of the page — close other tabs and reload')); };
  }).then(function (db) {
    const read = function (store, how) { return new Promise(function (ok, no) {
      let tx; try { tx = db.transaction([store], 'readonly'); } catch (e) { no(e); return; }
      const r = how(tx.objectStore(store)); r.onsuccess = function () { ok(r.result); }; r.onerror = function () { no(r.error || new Error('read failed')); }; }); };
    return Promise.all([read('journal', function (s) { return s.getAll(); }), read('meta', function (s) { return s.get('access'); }), read('meta', function (s) { return s.get('effects'); }), read('meta', function (s) { return s.get('mark'); })])
      .then(function (got) { return makeStore(db, got[0] || [], got[1] == null ? null : got[1], got[2] == null ? [] : got[2], got[3] == null ? null : got[3]); },
            function (e) { try { db.close(); } catch (_) {} throw new Error('this tablet\'s store could not be read (' + ((e && e.message) || e) + ') — nothing was replaced'); });
  });

  /* @storage @sync — the synchronous store over what was read: every write joins one ordered, batched queue retried with backoff; a write is refused while the store is behind or closed, and a tab whose lease another tab took is told to reload */
  function makeStore(db, rows, access, effects, mark) {
    const mirror = rows.slice(), meta = { access: access, effects: effects, mark: mark };
    let handedOut = false, appended = false, rowCount = mirror.length;   /* the mirror is let go once the writing tab's station has it (audit E84) */
    const queue = [], waiters = [];
    let flushing = false, lastError = null, writes = 0, timer = null, backoff = 0, closed = false, stale = false, heldGen = null, inflight = 0;
    const leaseKey = 'custompos-lease:' + stationId;

    function settle() { if (queue.length || flushing) return; while (waiters.length) waiters.shift()(); }
    function schedule(ms) { if (timer || closed) return; timer = setTimeout(function () { timer = null; flush(); }, ms || 0); }
    function flush() {
      if (closed || flushing) return;
      if (!queue.length) { settle(); return; }
      flushing = true; const batch = queue.slice(0, 500); let done = false; inflight = batch.length;
      const failed = function (e) { if (done) return; done = true; flushing = false; inflight = 0; lastError = String((e && (e.name ? e.name + ': ' : '') + (e.message || '')) || e || 'the write was refused');
        backoff = Math.min(backoff ? backoff * 2 : 250, 5000); schedule(backoff); };
      let tx;
      try {
        tx = db.transaction(['journal', 'meta'], 'readwrite');
        const j = tx.objectStore('journal'), m = tx.objectStore('meta');
        batch.forEach(function (op) { if (op.row !== undefined) j.add(op.row); else m.put(op.value, op.key); });
      } catch (e) { failed(e); return; }
      tx.oncomplete = function () { if (done) return; done = true; flushing = false; inflight = 0; queue.splice(0, batch.length); writes += batch.length; lastError = null; backoff = 0;
        if (queue.length) schedule(0); else settle(); };
      tx.onerror = function () { failed(tx.error); };
      tx.onabort = function () { failed(tx.error); };
    }
    /* @storage @sync — the cursor mark is ONE row in meta, overwritten, in the same ordered queue as the facts (so it still lands only
       after the facts it covers): a pull that moves the cursor no longer adds a journal row forever (audit E87, batch `perf`) */
    function markRow(m) { const c = clone(m); accept({ key: 'mark', value: c }); meta.mark = c; }
    /* @storage @station — E88 (batch `sync` 9/25): the page is going away. Every row still queued (past the batch already being
       written) goes to IndexedDB in one last transaction, started BEFORE db.close() — IndexedDB finishes a transaction already
       begun, so a tap a few milliseconds before the page hid is kept. A disk that refuses it refuses it: the station has said so. */
    function lastFlush() {
      const rest = queue.slice(flushing ? inflight : 0); if (!rest.length) return 0;
      try {
        const tx = db.transaction(['journal', 'meta'], 'readwrite'), j = tx.objectStore('journal'), m = tx.objectStore('meta');
        rest.forEach(function (op) { if (op.row !== undefined) j.add(op.row); else m.put(op.value, op.key); });
        tx.oncomplete = function () { writes += rest.length; };
      } catch (e) { return 0; }
      return rest.length;
    }
    function accept(op) {
      if (closed) throw new Error('this tablet\'s store is closed');
      if (lastError) throw new Error('this tablet\'s store is behind (' + lastError + ') — the row waits, in order');
      queue.push(op); schedule(0);
    }

    const persist = {
      /* @storage — the journal, read into the page. The WRITING tab's station takes the rows IndexedDB just handed this page, as they
         are (nothing else holds them), and the store lets them go: one copy of history in memory, not three — the rows, a mirror
         of them and a clone (audit E84/E59, batch `perf`). A read-only tab keeps its mirror for the day it takes the station over. */
      load: function () {
        if (stale) throw new Error('another tab wrote to this tablet while this one slept — reload this page');
        if (handedOut) throw new Error('the journal of this tablet was already read into the page — reload this page to read it again');
        const writer = heldGen != null, out = (writer && !appended) ? mirror.splice(0, mirror.length) : clone(mirror);
        if (meta.mark) out.push({ mark: clone(meta.mark) });   /* the newest cursor mark (kept in meta, one row) reads last, so it is the last word */
        if (writer) { handedOut = true; mirror.length = 0; }
        return out;
      },
      append: function (row) { if (row && row.mark !== undefined && Object.keys(row).length === 1) { markRow(row.mark); return; } const c = clone(row); accept({ row: c }); rowCount++; appended = true; if (!handedOut) mirror.push(c); },
      loadAccess: function () { return clone(meta.access); },
      saveAccess: function (a) { const c = clone(a == null ? null : a); accept({ key: 'access', value: c }); meta.access = c; },
      loadEffects: function () { return clone(meta.effects); },
      saveEffects: function (list) { const c = clone(list || []); accept({ key: 'effects', value: c }); meta.effects = c; },
      /* the whole picture, for the screen and for tests */
      health: function () { return { pending: queue.length + (flushing ? 0 : 0), lastError: lastError, writes: writes, stale: stale, rows: rowCount, mirror: mirror.length }; },
      whenWritten: function () { return new Promise(function (r) { if (!queue.length && !flushing) r(); else { waiters.push(r); schedule(0); } }); },
      close: function () { if (!closed) lastFlush(); closed = true; if (timer) { clearTimeout(timer); timer = null; } try { db.close(); } catch (e) {} }   /* E88: the queue first, then the close */
    };
    if (ls) {
      const readLease = function () { try { const v = JSON.parse(ls.getItem(leaseKey) || 'null'); return (v && typeof v === 'object') ? v : null; } catch (e) { return null; } };
      persist.lease = function (nonce, ms) {
        const now = Date.now(), cur = readLease();
        if (cur && cur.nonce && cur.nonce !== nonce && Number(cur.until) > now) return { ok: false, holder: String(cur.nonce).slice(0, 8), until: cur.until };
        const gen = cur ? (cur.nonce === nonce ? (Number(cur.gen) || 1) : (Number(cur.gen) || 0) + 1) : 1, same = !!(cur && cur.nonce === nonce && heldGen != null && gen === heldGen);   /* same: nobody else held it since I last did (audit E71) */
        ls.setItem(leaseKey, JSON.stringify({ nonce: nonce, until: now + ms, gen: gen }));
        const back = readLease();
        if (!back || back.nonce !== nonce) return { ok: false, holder: back && String(back.nonce).slice(0, 8) };   // another tab wrote in the same instant
        if (heldGen != null && gen !== heldGen) stale = true;       // someone else held it since my mirror was current
        heldGen = gen; return { ok: true, ttlMs: ms, same: same };
      };
      persist.release = function (nonce) {
        const cur = readLease(); if (cur && cur.nonce === nonce) ls.setItem(leaseKey, JSON.stringify({ nonce: '', until: 0, gen: Number(cur.gen) || 1 }));
      };
    }
    return persist;
  }
}

if (typeof module !== 'undefined' && module.exports) module.exports = { openBrowserStore: openBrowserStore };
else if (typeof window !== 'undefined') window.openBrowserStore = openBrowserStore;   // a plain <script> in the browser
