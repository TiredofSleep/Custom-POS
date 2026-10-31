'use strict';
/* ============================================================================
 * THE HUB'S DATABASE — node:sqlite behind the hub's two-call store (load, save)
 * @hub @storage @fact — the hub's facts, enrolments, cursors and alerts in one SQLite file, each save one all-or-nothing transaction
 * ----------------------------------------------------------------------------
 * (2026-09-23) Owner: "are we on v2 with SQL?" — the first step of ARCHITECTURE-V2's "Next". Node 22 went onto the
 * server beside Node 18 the same night (a separate install; the live hub still ran Node 18 then). node:sqlite is built
 * into Node 22+, so the zero-dependency law holds.
 *
 * The hub's logic does not change: it still hands a whole snapshot to save() and believes it only when save()
 * returned. What changes is what a save IS:
 *   · ONE TRANSACTION. New facts, enrolments, cursors and alerts land together or not at all. A throw rolls back
 *     every row; the hub turns the throw into "retry" and undoes what it staged. Nothing is ever half-written.
 *   · FACTS ARE APPEND-ONLY ROWS keyed by position, with a UNIQUE id, so the database itself refuses a second copy of
 *     a fact, below the hub's own idempotency check.
 *   · ONE HUB PER STORE — the logic map's declared hole, closed. The store opens in EXCLUSIVE locking mode and
 *     writes at once, so it takes the file's exclusive lock and holds it until close(). A second hub process on
 *     the same file cannot read it and refuses to start ("another hub process holds this store"), so two hubs can
 *     never hand out the same position to different facts.
 *   · A ROW THAT FAILS AT BOOT IS KEPT, NOT DELETED. The hub quarantines a row that does not verify (altered at
 *     rest); the first save after that boot moves it to the quarantine table, so the next boot is clean and the
 *     evidence stays for a person.
 *   · ALERTS ARE ROWS (E14 / E82, 9/25). Each alert is one row, written when it is new or changed, never deleted; each alert
 *     key (what stops a repeat) is one row, written once. A save no longer rewrites every alert the hub ever raised, so a
 *     save costs the same with ten alerts or ten thousand. load() hands back the newest ALERT_LOAD and every key. A store
 *     written before this keeps its alerts: the first open moves them from the old meta value into the rows.
 * ========================================================================== */
const { DatabaseSync } = require('node:sqlite');

const META_KEYS = ['epoch', 'head', 'devices', 'cursors'];
const ALERT_LOAD = 1000;                                           // the newest alerts a load hands the hub (hub.js ALERT_KEEP)

/* @hub @storage — an alert's version: a new one, or a counted one that counted again (the stranger's knock), is written again */
function alertVersion(a) { return String(a.ts || 0) + ':' + String(a.n || 0) + ':' + String(a.lastAt || 0); }
/* @hub @storage — a store written before 9/25 kept every alert in one meta value, rewritten on each save: move them into
   the rows once, inside the opening transaction, and drop the old value (nothing is lost; the next open finds none) */
function alertsIntoRows(db) {
  const J = function (k) { const r = db.prepare('SELECT v FROM meta WHERE k = ?').get(k); if (!r) return null; try { return JSON.parse(r.v); } catch (e) { return null; } };
  const old = J('alerts'), oldKeys = J('alertKeys');
  if (old == null && oldKeys == null) return;
  const pa = db.prepare('INSERT OR IGNORE INTO alerts (k, body) VALUES (?, ?)'), pk = db.prepare('INSERT OR IGNORE INTO alertkeys (k) VALUES (?)');
  (Array.isArray(oldKeys) ? oldKeys : []).forEach(function (k) { if (typeof k === 'string') pk.run(k); });
  (Array.isArray(old) ? old : []).forEach(function (a) { if (a && typeof a.key === 'string') { pa.run(a.key, JSON.stringify(a)); pk.run(a.key); } });
  db.prepare('DELETE FROM meta WHERE k IN (?, ?)').run('alerts', 'alertKeys');
}
/* @hub @storage — the hub's SQLite file, locked to one process; a store from before 9/25 has its alert list moved into rows once */
function openSqliteStore(file, opts) {
  opts = opts || {};
  const db = new DatabaseSync(file);
  try {
    db.exec('PRAGMA locking_mode = EXCLUSIVE');                    // never release a file lock once taken
    db.exec('PRAGMA journal_mode = DELETE');                       // rollback journal: the exclusive lock is the whole file's
    db.exec('PRAGMA synchronous = FULL');                          // durable before the hub speaks
    db.exec('BEGIN IMMEDIATE');
    db.exec('CREATE TABLE IF NOT EXISTS events (pos INTEGER PRIMARY KEY, id TEXT NOT NULL UNIQUE, body TEXT NOT NULL)');
    db.exec('CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)');
    db.exec('CREATE TABLE IF NOT EXISTS quarantine (qid INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, pos INTEGER, id TEXT, body TEXT, why TEXT)');
    db.exec('CREATE TABLE IF NOT EXISTS alerts (seq INTEGER PRIMARY KEY AUTOINCREMENT, k TEXT NOT NULL UNIQUE, body TEXT NOT NULL)');
    db.exec('CREATE TABLE IF NOT EXISTS alertkeys (seq INTEGER PRIMARY KEY AUTOINCREMENT, k TEXT NOT NULL UNIQUE)');
    alertsIntoRows(db);
    db.prepare('INSERT OR REPLACE INTO meta (k, v) VALUES (?, ?)').run('openedAt', JSON.stringify({ at: Date.now(), pid: process.pid }));   // a WRITE: takes the exclusive lock, held until close()
    db.exec('COMMIT');
  } catch (e) {
    try { db.close(); } catch (_) {}
    const busy = /locked|busy/i.test(String((e && e.message) || e));
    throw new Error(busy ? 'another hub process holds this store (' + file + ') — one hub per store; this one will not start'
                         : 'the hub store could not be opened (' + String((e && e.message) || e) + ')');
  }

  const q = {
    rows: db.prepare('SELECT pos, id, body FROM events ORDER BY pos'),
    meta: db.prepare('SELECT k, v FROM meta'),
    put: db.prepare('INSERT INTO events (pos, id, body) VALUES (?, ?, ?)'),
    setMeta: db.prepare('INSERT OR REPLACE INTO meta (k, v) VALUES (?, ?)'),
    maxPos: db.prepare('SELECT COALESCE(MAX(pos), 0) AS m FROM events'),
    quarantine: db.prepare('INSERT INTO quarantine (at, pos, id, body, why) VALUES (?, ?, ?, ?, ?)'),
    drop: db.prepare('DELETE FROM events WHERE pos = ?')
  };
  let savedHead = 0, reconciled = false, closed = false, savedKeyCount = 0;
  const written = { alerts: 0, keys: 0, saves: 0 };                // what the saves wrote (the proof of E82; the watch may show it)
  const savedAlert = new Map();                                    // alert key -> the version the store holds
  q.putAlert = db.prepare('INSERT OR REPLACE INTO alerts (k, body) VALUES (?, ?)');
  q.putKey = db.prepare('INSERT OR IGNORE INTO alertkeys (k) VALUES (?)');
  /* @hub @storage — a fact as stored in its row, without the position and epoch that have columns of their own */
  function bodyOf(e) { const x = Object.assign({}, e); delete x.pos; delete x.epoch; return JSON.stringify(x); }

  /* load: null for a new store; otherwise the hub's snapshot shape. A row whose body is not JSON comes back as a
     fact that cannot verify, so the hub quarantines it and counts it. */
  /* @hub @storage — the store as the hub's snapshot (null when new): every fact, the meta, the newest ALERT_LOAD alert rows and every alert key */
  function load() {
    const meta = {}; q.meta.all().forEach(function (r) { meta[r.k] = r.v; });
    const rows = q.rows.all();
    if (!rows.length && meta.epoch == null) return null;
    const J = function (k, d) { try { return meta[k] == null ? d : JSON.parse(meta[k]); } catch (e) { return d; } };
    const master = rows.map(function (r) { let e; try { e = JSON.parse(r.body); } catch (err) { e = { id: r.id, damaged: true }; } e.pos = r.pos; return e; });
    const alerts = db.prepare('SELECT body FROM (SELECT seq, body FROM alerts ORDER BY seq DESC LIMIT ?) ORDER BY seq').all(ALERT_LOAD).map(function (r) { try { return JSON.parse(r.body); } catch (e) { return null; } }).filter(Boolean);
    const alertKeys = db.prepare('SELECT k FROM alertkeys ORDER BY seq').all().map(function (r) { return r.k; });
    savedAlert.clear(); alerts.forEach(function (a) { savedAlert.set(a.key, alertVersion(a)); }); savedKeyCount = alertKeys.length;
    return { epoch: J('epoch', null), head: J('head', 0), master: master, devices: J('devices', []), cursors: J('cursors', []), alerts: alerts, alertKeys: alertKeys };
  }

  /* save: one transaction. The first save after a boot also moves rows the hub did not keep to quarantine. */
  /* @hub @storage — one transaction: the new facts, the meta, and only a new or changed alert row and a new key (E82); a failure leaves nothing */
  function save(snap) {
    if (closed) throw new Error('the hub store is closed');
    const alertsNow = new Map(); let nk = 0;                      // only a new or changed alert is written, and only a new key
    db.exec('BEGIN IMMEDIATE');
    try {
      if (!reconciled) {
        const kept = new Map(); (snap.master || []).forEach(function (e) { kept.set(e.pos, e.id); });
        const now = Date.now();
        q.rows.all().forEach(function (r) {
          if (kept.get(r.pos) === r.id) return;
          q.quarantine.run(now, r.pos, r.id, r.body, 'did not verify when the hub loaded it');
          q.drop.run(r.pos);
        });
        savedHead = q.maxPos.get().m;
      }
      const m = snap.master || []; let i = m.length - 1;
      while (i >= 0 && m[i].pos > savedHead) i--;                // master is in position order: only the tail is new
      for (let j = i + 1; j < m.length; j++) q.put.run(m[j].pos, m[j].id, bodyOf(m[j]));
      META_KEYS.forEach(function (k) { q.setMeta.run(k, JSON.stringify(snap[k] == null ? null : snap[k])); });
      (snap.alerts || []).forEach(function (a) { if (!a || typeof a.key !== 'string') return; const v = alertVersion(a); if (savedAlert.get(a.key) !== v) { q.putAlert.run(a.key, JSON.stringify(a)); alertsNow.set(a.key, v); } });
      const ks = snap.alertKeys || [];
      for (let j = Math.min(savedKeyCount, ks.length); j < ks.length; j++) if (typeof ks[j] === 'string') { q.putKey.run(ks[j]); nk++; }
      if (typeof opts.beforeCommit === 'function') opts.beforeCommit();   // test seam: a failure here must leave nothing behind
      db.exec('COMMIT');
    } catch (e) {
      try { db.exec('ROLLBACK'); } catch (_) {}
      throw e;                                                    // the hub turns this into "retry" and undoes what it staged
    }
    reconciled = true; savedHead = Math.max(savedHead, Number(snap.head) || 0);
    alertsNow.forEach(function (v, k) { savedAlert.set(k, v); }); savedKeyCount = Math.max(savedKeyCount, (snap.alertKeys || []).length);
    written.saves++; written.alerts += alertsNow.size; written.keys += nk;
    return true;
  }

  /* @hub @storage — closes the database once, releasing the lock that keeps a second hub off it */
  function close() { if (closed) return; closed = true; try { db.close(); } catch (_) {} }   // releases the lock
  /* @hub @storage @fact — the facts set aside because they could not verify, with the reason, in order */
  function quarantined() { return db.prepare('SELECT pos, id, why FROM quarantine ORDER BY qid').all().map(function (r) { return { pos: r.pos, id: r.id, why: r.why }; }); }
  /* @storage @backup — a consistent copy of the WHOLE database (facts, enrolments, cursors, alerts, quarantine) into a NEW file:
     SQLite's VACUUM INTO on this connection, between saves (audit E9). It never writes over a file that is already there. */
  function copyTo(dest) {
    if (closed) throw new Error('the hub store is closed');
    if (require('fs').existsSync(dest)) throw new Error('the copy goes to a new file only — ' + dest + ' is already there');
    db.prepare('VACUUM INTO ?').run(String(dest));
    return dest;
  }
  return { load: load, save: save, close: close, quarantined: quarantined, file: file, written: function () { return Object.assign({}, written); }, copyTo: copyTo };
}

module.exports = { openSqliteStore: openSqliteStore, ALERT_LOAD: ALERT_LOAD };
