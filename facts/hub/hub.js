'use strict';
/* ============================================================================
 * HUB — the ONE authority. "A hub watching all."
 * @hub @sync @fact @permission — the one authority: enrols devices, admits each fact once from the station it names, orders it, saves before it answers, and treats an unreadable store as damage
 * ----------------------------------------------------------------------------
 * (2026-09-22) The hub decides; stations propose. It:
 *   · ENROLLS DEVICES: an operator enrolls a device as a station and the hub
 *     hands back a secret ACCESS TOKEN (only its sha-256 is kept). Enrolling a
 *     station again — a replacement tablet — revokes the old device's token.
 *     Revoking a station (a sold or lost tablet) ends its access; its facts
 *     stay served. A clone of a tablet is simply that tablet: its facts carry
 *     unique ids and are admitted once each, and revoking the token ends both.
 *   · ADMITS a fact only from a device enrolled AS THAT FACT'S STATION, only
 *     when its content matches its hash, its type is registered and its payload
 *     is valid. A device writes only as itself; nobody relays for anybody.
 *   · IS THE IDEMPOTENCY KEY'S KEEPER: the same id with the same hash is a
 *     retry and gets the same position back; a different fact under a held id
 *     is refused and alerted. Nothing is ever admitted twice.
 *   · ORDERS: every admitted fact gets the next position; stations learn by
 *     cursor (pull), and a station that names another epoch starts from zero.
 *   · IS DURABLE BEFORE IT SPEAKS: a fact is echoed only after the store took
 *     the write; a failed save undoes exactly what this receive staged and
 *     answers "retry". Alerts are saved before anyone is told.
 *   · TREATS A STORE IT CANNOT READ AS DAMAGE, not absence: it witnesses
 *     nothing and never overwrites it. A damaged or partial store takes a NEW
 *     epoch, so every station re-offers what it holds.
 * What it no longer does (retired 9/22, in git): per-station signing keys,
 * key pins and rotations, receipt numbers and gap refusals, carried relays,
 * twin-hub detection by writer nonce. Two hub processes on one store is the
 * database's job: hub/sqlite-store.js holds an exclusive lock on its file (2026-09-23).
 * ========================================================================== */
const crypto = require('crypto');
const registry = require('../core/registry');
const ev = require('../core/event');
const incfold = require('../core/incfold');
const projections = require('./projections');   /* 10/18 (enterprise batch 2): the one read model — every reader's view of an aggregate, and the conflict check's follower, held once */
/* @hub @fold — 10/17: THE HUB'S FOLLOWERS KEEP ONE CHECKPOINT, NOT SIX. A follower keeps up to KEEP (6) whole copies of its aggregate's state
   so a late fact replays from a recent one — right for a tablet, wrong for the hub's conflict check, which holds its followers for the life of
   the process: measured on a busy shop's history, the orders follower held 47 MB at 6 checkpoints and 14 MB at one, customers 14 MB
   and 5 MB. With the shop's other followers and folds, a hub a shop-day old held ~258 MB
   — more than a small server should spend. With one, a fact up to ~1,000 places late still replays from it; one older (a tablet
   back after days offline) folds that aggregate from the start once (orders ~1.2 s) and the answer is the same. */
const HUB_FOLLOW = { keep: 1 };
/* 9/26 (core/incfold.js): a conflict check that is exactly its fold's notes — detectConflicts(x) { return fold(x).notes; } — is
   followed one fact at a time when its aggregate carries inc; any other check is called whole, as it always was */
const NOTES_ONLY = /^function\s*[\w$]*\s*\(\s*([\w$]+)\s*\)\s*\{\s*return\s+fold\(\s*\1\s*\)\.notes;?\s*\}$/;

const MAX_BUNDLE_IN = 1000;                                       // facts per receive; a station sends 200 at a time
const PULL_MAX = 1000;                                            // facts per pull answer; the station loops on `more`
/* E14 / E82 (9/25): the hub keeps the newest ALERT_KEEP alerts in memory and in each save; the store keeps every alert as a
   row, never deleted (hub/sqlite-store.js), and a kept key still stops a repeat. A stranger's knock (a device this hub never
   enrolled) is one counted alert, saved and told at most once per STRANGER_EVERY_MS. */
const ALERT_KEEP = 1000;
const STRANGER_EVERY_MS = 60000;
/* E63 (9/25 — v2's own guard; v1 keeps one database blob): a fact is at most FACT_MAX bytes as it travels (its JSON), and a
   pull answer stops adding facts once it holds PULL_BYTES (always at least one fact), so one tablet can neither grow the store
   by megabytes a fact nor make a fresh pull too large to send. The largest fact the proofs make is under 2 KB; a whole rack's
   inventory scan is well under the cap. Each can be lowered for a proof (opts.factMax, opts.pullBytes). */
const FACT_MAX = 256 * 1024;
const PULL_BYTES = 2 * 1024 * 1024;
const RESCUE_MS = 24 * 3600 * 1000;                               /* E38: how long a replaced tablet may hand in its offline work */
const CLOCK_SKEW_MS = 5 * 60 * 1000;                              /* v1 hub-server CLOCK_SKEW_MS: a stamp more than 5 minutes ahead of the hub is not trusted */
/* @hub — a deep copy through JSON, so an answer never shares an object with the hub's own state */
function clone(o) { return JSON.parse(JSON.stringify(o)); }
/* @sync @clock — how far, in words a person reads on an alert or a tablet ("20.0 hours") */
function howFar(ms) { const a = Math.abs(Number(ms) || 0); return a >= 86400000 ? (a / 86400000).toFixed(1) + ' days' : a >= 3600000 ? (a / 3600000).toFixed(1) + ' hours' : Math.round(a / 60000) + ' minutes'; }
/* @hub @sync — a new identity for the hub's record (time and random), so every station reads from zero and re-offers what it holds */
function newEpoch() { return 'hub-' + Date.now().toString(36) + '-' + crypto.randomBytes(4).toString('hex'); }
/* @hub @permission — a device token's sha-256; the hub keeps only this, never the token itself */
function tokenHash(t) { return crypto.createHash('sha256').update(String(t), 'utf8').digest('hex'); }
/* @hub @fact — freeze a fact and everything inside it (an admitted fact never changes) */
function deepFreeze(o) { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); Object.keys(o).forEach(function (k) { deepFreeze(o[k]); }); } return o; }
/* @hub @station — a station id the hub accepts: non-empty text up to 64 characters, never a slash */
function goodStationId(s) { return typeof s === 'string' && s.length > 0 && s.length <= 64 && s.indexOf('/') < 0; }

/* @hub @sync @storage — the one authority: admits a fact, gives it a position, saves before it witnesses; keeps devices, cursors and alerts;
   judges who may write a privileged fact (E30), refuses an oversized one (E63), counts strangers as one alert (E32); says at once
   when its store refuses a write (E10), and retrySave() tries the store again with nothing new (E20) */
function makeHub(opts) {
  opts = opts || {};
  const notify = opts.notify || function () {};
  const hubNow = opts.now || Date.now;
  const persist = opts.persist || null;
  const authority = typeof opts.authority === 'function' ? opts.authority : null;   // E30: who may write a privileged fact (hub/authority.js judgeFor)
  let epoch = opts.epoch || null;
  const master = [], byId = new Map();
  let head = 0;
  const devices = new Map();                                      // tokenHash -> { station, at, by, revoked: null | ms }
  const cursors = new Map();                                      // station -> { cursor, at, refused, refusedLast }
  const alerts = [], alertKeys = new Set(), warnings = [];
  let persistError = null, storeUnreadable = null, quarantinedRows = 0;
  let stranger = null, strangerToldAt = 0;                          // the one 'unknown-device' alert, and when it was last saved and told
  const factMax = opts.factMax > 0 ? opts.factMax : FACT_MAX, pullBytes = opts.pullBytes > 0 ? opts.pullBytes : PULL_BYTES;   /* E63 */
  const sizes = new WeakMap();
  /* @hub @sync — E63: a fact's size as it travels (its JSON, in bytes), counted once per fact and remembered */
  function bytesOf(e) { let n = sizes.get(e); if (n == null) { n = Buffer.byteLength(JSON.stringify(e), 'utf8'); sizes.set(e, n); } return n; }
  const byAgg = new Map(), aggPos = new Map();                    /* each aggregate's facts (the master's own objects) and its newest position — so a conflict check never filters every fact, and a reader can tell whether ITS aggregate moved */
  /* 9/26: a followed conflict check reads only the facts filed since the last. 10/18 (enterprise batch 2): its follower is the read model's
     (hub/projections.js) — ONE follower per aggregate, which the conflict check and every reader's view(agg) share: a stable {size, since}
     over the aggregate's byAgg list, stepped by a follower with one checkpoint (HUB_FOLLOW) */
  const proj = projections.projectionsFor({ log: function (agg) { return { size: function () { const l = byAgg.get(agg); return l ? l.length : 0; }, since: function (n) { const l = byAgg.get(agg); return l ? l.slice(n) : []; } }; },
    follower: function (def, agg) { return incfold.follower(def.inc, agg, HUB_FOLLOW); }, head: function (agg) { return aggPos.get(agg) || 0; }, headAll: function () { return head; }, all: function () { return facts(); }, freeze: function () { freezeAll(); } });
  const readers = opts.sharedViews !== false ? { live: proj.live, view: proj.view } : null;   /* 10/25 (§970): what the authority may read — the shared follower and views, never a copy (a proof's hub with sharedViews:false is not judged on them) */
  let frozenUpTo = 0, conflictTimer = null, lastCheckMs = 0; const conflictPending = new Set();
  const conflictDelayMs = (Number(opts.conflictDelayMs) > 0) ? Number(opts.conflictDelayMs) : 0;   /* 0: checked before the receive answers (every proof); the server passes a delay (audit E56) */

  /* ---- the store: one synchronous snapshot, believed only when save() returned ---- */
  /* @hub @storage — the whole state the hub saves: epoch, head, the facts, devices, cursors, alerts and their keys */
  function snapshot() {
    return { epoch: epoch, head: head, master: master, devices: Array.from(devices.entries()), cursors: Array.from(cursors.entries()), alerts: alerts, alertKeys: Array.from(alertKeys) };
  }
  /* @hub @storage — one save of the hub's whole state; a refusal is kept in persistError (save() below says it out loud); only the
     newest ALERT_KEEP alerts stay in memory (E14) */
  function saveOnce() {
    if (alerts.length > ALERT_KEEP) alerts.splice(0, alerts.length - ALERT_KEEP);   /* E14: the oldest leave memory; the store keeps their rows */
    if (!(persist && typeof persist.save === 'function')) return true;
    if (storeUnreadable) return false;
    try {
      const res = persist.save(snapshot());
      if (res && typeof res.then === 'function') { persistError = 'persist.save returned a Promise — the hub needs a SYNCHRONOUS store; durability before witness cannot wait on a callback'; return false; }
      if (res === false) { persistError = 'persist.save returned false'; return false; }
      persistError = null; return true;
    } catch (err) { persistError = String((err && err.message) || err); return false; }
  }
  let persistSince = null;
  /* @hub @storage @error — E10 (9/25): every save goes through here. The FIRST refused save is said at once — console.error, and
     one alert told straight to notify, because the store cannot keep an alert now (a full disk); the hub's server keeps it in
     its own list and the health answer fails. When the store takes writes again, that is told too. */
  function save() {
    const ok = saveOnce();
    if (!ok && persistError && persistSince == null) { persistSince = hubNow(); try { console.error('  ⛔ the hub store refused a write: ' + persistError); } catch (e) {}
      try { notify({ key: 'store-refusing:' + persistSince, kind: 'store-refusing', ts: persistSince, note: 'The hub could not save (' + persistError + '). The tablets keep their own work and retry, but nothing reaches the other counters and the hub\'s automatic work waits until the store takes writes again. Check the disk.' }); } catch (e) {} }
    else if (ok && persistSince != null) { const was = persistSince; persistSince = null; try { notify({ key: 'store-recovered:' + hubNow(), kind: 'store-recovered', ts: hubNow(), note: 'The hub store takes writes again (it refused them from ' + new Date(was).toISOString() + ').' }); } catch (e) {} }
    return ok;
  }
  /* @hub @storage — E20 (9/25): after a refused save, try the store again with what the hub already holds (nothing new): true
     once it takes the write, which clears persistError — so a job that waits on the store learns it recovered */
  function retrySave() { if (storeUnreadable) return false; if (!persistError) return true; return save(); }
  /* alerts are staged, saved, THEN told — an alert the store refused is not announced (it is raised again next time) */
  /* @hub @error — each alert told out as a copy; a listener that throws never stops the rest */
  function tell(list) { list.forEach(function (a) { try { notify(clone(a)); } catch (e) {} }); }
  /* @hub @error — stages an alert once: a key already raised or already staged is not staged again */
  function stageAlert(stage, a) { if (alertKeys.has(a.key) || stage.some(function (x) { return x.key === a.key; })) return; stage.push(Object.assign({ ts: hubNow() }, a)); }
  /* @hub @error — staged alerts join the kept list, and their keys stop a repeat */
  function applyAlerts(stage) { stage.forEach(function (a) { alertKeys.add(a.key); alerts.push(a); }); }
  /* @hub @error — staged alerts taken back out when the save that should have kept them failed */
  function unapplyAlerts(stage) { stage.forEach(function (a) { alertKeys.delete(a.key); const i = alerts.indexOf(a); if (i >= 0) alerts.splice(i, 1); }); }
  /* @hub @error — one alert staged, saved, then told; if the save fails it is taken back and never announced (it is raised again next time) */
  function raise(a) { const st = []; stageAlert(st, a); if (!st.length) return; applyAlerts(st); if (save()) tell(st); else unapplyAlerts(st); }

  (function load() {
    if (!(persist && typeof persist.load === 'function')) return;
    let st;
    try { st = persist.load(); }
    catch (e) { storeUnreadable = 'the hub store could not be read (' + String((e && e.message) || e) + ')'; alerts.push({ key: 'store-unreadable', kind: 'store-unreadable', ts: hubNow(), note: storeUnreadable + ' — this hub witnesses nothing and overwrites nothing until an operator restores it.' }); alertKeys.add('store-unreadable'); return; }
    if (st == null) return;                                                        // a new store
    if (typeof st !== 'object' || Array.isArray(st)) { storeUnreadable = 'the hub store is not a snapshot'; alerts.push({ key: 'store-unreadable', kind: 'store-unreadable', ts: hubNow(), note: storeUnreadable + ' — witnessing nothing; nothing was overwritten.' }); alertKeys.add('store-unreadable'); return; }
    let consistent = true, maxPos = 0;
    epoch = (typeof st.epoch === 'string' && st.epoch) ? st.epoch : epoch;
    (Array.isArray(st.master) ? st.master : []).forEach(function (e) {
      const pos = e ? Number(e.pos) : NaN;                                         // a DB adapter's BIGINT-as-string is coerced; a mark that is not a position is damage
      if (!e || !ev.verify(e) || byId.has(e.id) || !Number.isInteger(pos) || pos < 1) { quarantinedRows++; consistent = false; return; }
      e.pos = pos; e.epoch = epoch; master.push(e); byId.set(e.id, e); if (pos > maxPos) maxPos = pos;
    });
    master.sort(function (a, b) { return a.pos - b.pos; });
    master.forEach(fileByAgg);
    if ((Number(st.head) || 0) !== maxPos || new Set(master.map(function (e) { return e.pos; })).size !== master.length) consistent = false;
    head = maxPos;
    (Array.isArray(st.devices) ? st.devices : []).forEach(function (p) { if (Array.isArray(p) && typeof p[0] === 'string' && p[1] && goodStationId(p[1].station)) devices.set(p[0], { station: p[1].station, at: Number(p[1].at) || 0, by: p[1].by || null, revoked: p[1].revoked || null, rescue: p[1].rescue ? true : undefined, until: Number(p[1].until) || undefined }); });   /* rescue · until: E38 */
    (Array.isArray(st.alerts) ? st.alerts : []).forEach(function (a) { if (a && typeof a.key === 'string') alerts.push(a); });
    (Array.isArray(st.alertKeys) ? st.alertKeys : []).forEach(function (k) { if (typeof k === 'string') alertKeys.add(k); });
    if (consistent) (Array.isArray(st.cursors) ? st.cursors : []).forEach(function (p) { if (Array.isArray(p) && typeof p[0] === 'string' && p[1]) cursors.set(p[0], p[1]); });   // cursors mean nothing under a new epoch
    if (!consistent) {
      const old = epoch; epoch = newEpoch(); master.forEach(function (e) { e.epoch = epoch; });
      alerts.push({ key: 'store-inconsistent:' + epoch, kind: 'store-inconsistent', ts: hubNow(), note: 'The hub store was damaged or partial (' + quarantinedRows + ' row(s) quarantined). This hub took a new identity (' + epoch + ', was ' + old + ') so every station re-offers what it holds; nothing is lost that any station still has.' }); alertKeys.add('store-inconsistent:' + epoch);
    }
  })();
  stranger = alerts.filter(function (a) { return a.key === 'unknown-device'; })[0] || null;
  if (!epoch && !storeUnreadable) epoch = newEpoch();
  if (!storeUnreadable && !save() && persist) warnings.push('the store refused the first save: ' + persistError);
  tell(alerts.filter(function (a) { return a.key === 'store-unreadable' || String(a.key).indexOf('store-inconsistent:') === 0; }));

  /* ---- devices ---- */
  /* @hub @station @identity — the live devices enrolled as one station: not revoked, and a rescue device only while its window is open */
  function activeDevices(station) { const out = []; devices.forEach(function (d, h) { if (d.station === station && !d.revoked && !rescueOver(d)) out.push(h); }); return out; }
  /* @sync @station @identity — a replaced tablet's hand-in window (E38) is over: it counts as retired */
  function rescueOver(d) { return !!(d && d.until && hubNow() > d.until); }
  /* an OPERATOR enrolls a device as `station`; returns the access token (shown once, kept only as a hash). A second
     enrollment of the same station is a replacement device: the old token is revoked in the same save. */
  /* @hub @station @identity @permission — an operator makes a device this station: a fresh token shown once and kept only as a hash; a second enrolment replaces the old device (a rescue one revokes nobody and ends by itself); nothing if the save fails */
  function enroll(station, meta) {
    if (!goodStationId(station)) throw new Error('enroll: a station id is a non-empty string without "/"');
    if (storeUnreadable) return null;
    const token = crypto.randomBytes(24).toString('hex'), h = tokenHash(token), now = hubNow();
    const rescue = !!(meta && meta.rescue);   /* E38: a RESCUE enrolment lets a replaced tablet hand in its offline work — it revokes nobody, and ends by itself */
    const replaced = rescue ? [] : activeDevices(station);
    replaced.forEach(function (x) { devices.get(x).revoked = now; });
    devices.set(h, rescue ? { station: station, at: now, by: (meta && meta.by) || null, revoked: null, rescue: true, until: now + RESCUE_MS } : { station: station, at: now, by: (meta && meta.by) || null, revoked: null });
    if (!save()) { devices.delete(h); replaced.forEach(function (x) { devices.get(x).revoked = null; }); return null; }
    return token;
  }
  /* an OPERATOR ends a station's access (a sold, lost or retired tablet). Its facts stay served. Idempotent. */
  /* @hub @station @identity @permission — an operator ends a station's access (a sold or lost tablet), its facts still served; nothing changes if the save fails */
  function revoke(station) {
    const live = activeDevices(station); if (!live.length) return 0;
    const now = hubNow(); live.forEach(function (x) { devices.get(x).revoked = now; });
    if (!save()) { live.forEach(function (x) { devices.get(x).revoked = null; }); return 0; }
    return live.length;
  }
  /* @hub @station @identity — whether any live device is enrolled as this station */
  function enrolled(station) { return activeDevices(station).length > 0; }
  /* a tablet's ORDER-NUMBER BAND (v1 stationBand, owner 9/10): its place among the tablets that take orders, by first
     enrolment — 1..9, never shared, kept across a re-enrolment (a revoked device is remembered, never deleted). The
     copy from v1 and the hub's own services take no orders and take no band. 0 = none left: the numbers come from the scan. */
  const NO_BAND = ['v1-shadow', 'hub-services'];
  /* @hub @station @order — a station that takes no order-number band: the hub's own two, and an operator's scripting identity (a name
     starting "scriptdesk"): it records data fixes, never an order */
  const noBand = function (station) { return NO_BAND.indexOf(station) >= 0 || /^scriptdesk/i.test(String(station || '')); };
  /* @hub @station @order — a tablet's order-number band, 1 to 9 by first enrolment and kept across a re-enrolment; 0 when none is left or the station takes no orders */
  function bandOf(station) {
    const first = new Map(); devices.forEach(function (d) { if (noBand(d.station)) return; const t = first.get(d.station); if (t == null || d.at < t) first.set(d.station, d.at); });
    const order = Array.from(first.entries()).sort(function (a, b) { return (a[1] - b[1]) || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0); }).map(function (x) { return x[0]; });
    const i = order.indexOf(station); return i >= 0 && i < 9 ? i + 1 : 0;
  }
  /* @hub @identity @permission — the enrolled device a token belongs to, found by its hash; null for anything else */
  function deviceOf(token) { return (typeof token === 'string' && token) ? (devices.get(tokenHash(token)) || null) : null; }
  /* @hub @identity @permission — THE ONE DEVICE CHECK (10/18, enterprise batch 1 — security): the device a token belongs to when it is
     allowed in — enrolled, not revoked, and (a rescue key) its hand-in window not over; else null. Every door that asks "is this
     device allowed" asks this (hub/server.js, links, mint, setup codes, the address lookup); before, most asked only "enrolled and
     not revoked", so a rescue key past its window still opened them. A door may refuse more (a rescue key mints no numbers). */
  function allowedDevice(token) { const d = deviceOf(token); return (d && !d.revoked && !rescueOver(d)) ? d : null; }
  const deviceNo = new WeakMap(); let devicesNumbered = 0;   /* each enrolled device a number of its own while this hub runs — never anything made from its key */
  /* @hub @identity @watchdog — WHO IS CALLING, for the tablets' watch only (hub/tabletfaults.js, 10/18 batch 2) and NEVER a door — a door asks
     allowedDevice: the station a key was enrolled as, a number for THIS device (an old tablet replaced but still switched on is another
     device under the same name) and whether its key is allowed in now; null for a key this hub never issued */
  function callerOf(token) { const d = deviceOf(token); if (!d) return null; if (!deviceNo.has(d)) deviceNo.set(d, ++devicesNumbered); return { station: d.station, device: d.station + '#' + deviceNo.get(d), allowed: !d.revoked && !rescueOver(d) }; }
  /* @hub @permission — why this device may not send, or null: the store unreadable, a device never enrolled (one counted stranger alert, E32), a revoked one */
  function accessRefusal(dev, token, claimed) {
    if (storeUnreadable) return 'the hub cannot read its store — nothing is witnessed until an operator restores it';
    if (!dev) { strangerKnocked(claimed, token); return 'this device is not enrolled at the hub (no valid access token) — an operator enrolls it'; }
    if (rescueOver(dev)) return 'this tablet\'s time to hand in its offline work is over — an operator gives it another reconnect code, or retires it';
    if (dev.revoked) { raise({ key: 'revoked-use:' + dev.station, kind: 'revoked-use', station: dev.station, note: 'A device whose access to station "' + dev.station + '" was revoked tried to send. Nothing was admitted.' }); return 'this device\'s access to station "' + dev.station + '" was revoked — an operator enrolls a replacement'; }
    return null;
  }
  /* @hub @permission — a device this hub never enrolled knocked (E32 / E14, 9/25): ONE alert, 'unknown-device', counted — never
     one per station name the caller made up. The first knock is saved and told; later ones only count, and are saved and told
     at most once per STRANGER_EVERY_MS, so a flood of strangers costs the hub a counter, not a write per request. */
  function strangerKnocked(claimed, token) {
    const now = hubNow(), name = goodStationId(claimed) ? claimed.replace(/[\u0000-\u001f\u007f]/g, '?') : '?', first = !stranger;
    if (first) { stranger = { key: 'unknown-device', kind: 'unknown-device', ts: now, station: null, n: 0, firstAt: now }; alertKeys.add(stranger.key); }
    stranger.n++; stranger.lastAt = now; stranger.lastName = name;
    stranger.note = stranger.n + ' call(s) from devices this hub never enrolled (the last called itself "' + name + '" and presented ' + (token ? 'an access token this hub never issued' : 'no access token') + '). Nothing any of them sent was admitted. An operator enrolls a new device.';
    if (!first && now - strangerToldAt < STRANGER_EVERY_MS) return;
    strangerToldAt = now;
    const i = alerts.indexOf(stranger); if (i < 0 || i !== alerts.length - 1) { if (i >= 0) alerts.splice(i, 1); alerts.push(stranger); }   // the newest news
    if (save()) tell([stranger]);
  }
  /* @hub @sync @error — E63: a fact larger than factMax is refused at the door — never stored, never served — and makes ONE
     'too-large' alert per tablet (a tablet can make up type names; the key never carries one). The station holds it and says
     so. Facts already in the store are never judged again (a fact is forever); the pull budget below still serves them. */
  function tooLarge(e, station) {
    const n = Buffer.byteLength(JSON.stringify(e), 'utf8'); if (n <= factMax) return null;
    const what = String(e.type).slice(0, 60), kb = Math.round(factMax / 1024);
    return { reason: 'too large: a fact is at most ' + kb + ' KB and this ' + what + ' is ' + Math.ceil(n / 1024) + ' KB — held on the station, never admitted',
      alert: { key: 'too-large:' + station, kind: 'too-large', station: station, note: 'Station ' + station + ' sent a ' + what + ' of ' + Math.ceil(n / 1024) + ' KB; a fact is at most ' + kb + ' KB. Refused and held on that tablet. A tablet that keeps sending these is broken or not ours: check it, or revoke it.' } };
  }
  /* @hub @sync — E63: the facts one pull answer carries, from master[i]: at most `max`, and no more once PULL_BYTES is reached
     (the first fact always goes, however large, so a station never stalls) */
  function pullSlice(i, max) {
    const out = []; let bytes = 0;
    for (let j = i; j < master.length && out.length < max; j++) { const n = bytesOf(master[j]); if (out.length && bytes + n > pullBytes) break; bytes += n; out.push(clone(master[j])); }
    return out;
  }
  /* @sync @station @admin — a replaced (revoked) tablet that still tries to send: how many facts it holds, kept per station so Admin →
     Devices says so (E38) — its offline work is not lost, it is waiting for a rescue enrolment. Saved only when the number moves. */
  function stranded(dev, b) {
    if (!dev || !(dev.revoked || rescueOver(dev)) || !Array.isArray(b.events)) return;
    const c = cursors.get(dev.station) || { cursor: 0, at: 0, refused: 0, refusedLast: 0 };
    if (c.strandedOwes === b.events.length && !!c.strandedMore === !!b.more) return;
    c.strandedOwes = b.events.length; c.strandedMore = !!b.more; c.strandedAt = hubNow(); cursors.set(dev.station, c); save();
  }
  /* @hub @sync — counts a station's refused facts, the total and the last batch, for Admin → Devices */
  function countRefused(station, n) { const c = cursors.get(station) || { cursor: 0, at: 0, refused: 0, refusedLast: 0 }; c.refused = (c.refused || 0) + n; c.refusedLast = n; cursors.set(station, c); }
  /* ---- THE TABLETS' CLOCKS (E35, batch `sync` 9/25 — v1 stampSanitize / CLOCK_SKEW_MS, for facts that cannot be re-stamped) ---- */
  const clockSkewMs = (opts.clockSkewMs > 0) ? opts.clockSkewMs : CLOCK_SKEW_MS;
  /* @sync @clock — the hub's day an alert is keyed by (a wrong clock is told once a day, not once a sync) */
  function dayOf(ms) { try { return new Date(ms).toISOString().slice(0, 10); } catch (e) { return '?'; } }
  /* @sync @clock — a fact dated more than v1's 5 minutes past the hub's own clock is not admitted: its stamp would outrank every
     real later edit and file its money on a day that has not come. It stays on the tablet, owed and never lost, until that time. */
  function aheadOf(e, now) { const a = Math.max(Number(e.hlc && e.hlc.t) || 0, Number(e.at) || 0) - now; return a > clockSkewMs ? a : 0; }
  /* @sync @clock @station — what a tablet's clock read when it sent (its bundle's or pull's sentAt) against the hub's: kept per
     station for Admin → Devices, and an alert naming the station once a day while it is off by more than 5 minutes either way */
  function noteClock(stage, station, sentAt, now) {
    if (typeof sentAt !== 'number' || !Number.isFinite(sentAt) || sentAt <= 0) return;
    const c = cursors.get(station) || { cursor: 0, at: 0, refused: 0, refusedLast: 0 }; const sk = Math.round(sentAt - now);
    c.clockSkew = sk; c.clockAt = now; cursors.set(station, c);
    if (Math.abs(sk) > clockSkewMs) stageAlert(stage, { key: 'clock-skew:' + station + ':' + dayOf(now), kind: 'clock-skew', station: station, skewMs: sk,
      note: '⏰ Station ' + station + '\'s clock is ' + howFar(sk) + (sk > 0 ? ' FAST' : ' SLOW') + ' (it read ' + new Date(sentAt).toISOString() + ', the hub ' + new Date(now).toISOString() + '). What it records is dated wrong — a slow clock files today\'s money on another day. Set that tablet\'s date and time; its facts are listed under that station.' });
  }

  /* @hub @sync @backup — THE HUB TAKES A NEW IDENTITY (E6, 9/25): a store that went back in time (a restored backup, a server
     image) must never hand a position out a second time under the same epoch — a tablet past it would skip the new fact
     for good. Every fact is re-stamped under a new epoch and the cursors are forgotten, so every station re-pulls from zero
     and re-offers what it holds. Durable before anyone is told; a store that refuses leaves the old identity in place (null). */
  function takeNewEpoch(kind, note, station) {
    if (storeUnreadable) return null;
    const old = epoch, oldCursors = Array.from(cursors.entries()), ne = newEpoch();
    epoch = ne; restamp(ne); cursors.clear();
    const a = [{ key: String(kind || 'new-epoch') + ':' + ne, kind: String(kind || 'new-epoch'), station: station || null, ts: hubNow(), note: String(note || '') + ' This hub took a new identity (' + ne + ', was ' + old + '): every station reads it again from the start and re-offers what it holds, so nothing any station still has is lost.' }];
    applyAlerts(a);
    if (!save()) { unapplyAlerts(a); epoch = old; restamp(old); oldCursors.forEach(function (p) { cursors.set(p[0], p[1]); }); return null; }
    tell(a); return ne;
  }
  /* @hub @sync @backup — every fact stamped with an identity. A fact the hub's own readers were handed is frozen (facts(), audit
     E60) and cannot take a stamp in place — 10/17: a new identity threw on the first frozen fact, its epoch half changed and
     nothing saved, once anyone had typed a PIN. Such a fact is replaced by its own copy, stamped (the frozen payload inside is
     shared, never copied); the aggregates' lists are filed again from the master in the same order, the followers start over
     (none keeps the old objects alive) and the next facts() freezes the copies */
  function restamp(ep) {
    let swapped = 0;
    for (let i = 0; i < master.length; i++) { const e = master[i]; if (!Object.isFrozen(e)) { e.epoch = ep; continue; } const c = Object.assign({}, e); c.epoch = ep; master[i] = c; byId.set(c.id, c); swapped++; }
    if (swapped) { byAgg.clear(); aggPos.clear(); proj.reset(); master.forEach(fileByAgg); frozenUpTo = 0; }   /* 10/18: the read model's followers and views start over (hub/projections.js) */
    return swapped;
  }
  /* @hub @sync — the fact this hub holds at a position (master is in position order), or null */
  function factAt(pos) { let lo = 0, hi = master.length - 1; while (lo <= hi) { const mid = (lo + hi) >> 1, p = master[mid].pos; if (p === pos) return master[mid]; if (p < pos) lo = mid + 1; else hi = mid - 1; } return null; }
  /* @hub @audit — copies of the facts after position `from` up to and including `to`, found by position (the anchor's running hash
     at a position the shop PC recorded, S80) */
  function factsBetween(from, to) { let lo = 0, hi = master.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (master[mid].pos <= from) lo = mid + 1; else hi = mid; } const out = []; for (let i = lo; i < master.length && master[i].pos <= to; i++) out.push(clone(master[i])); return out; }
  /* @hub @sync — a device that read a position past this hub's head, under this hub's identity, saw a record this store no
     longer holds: the store went back in time (E6). So did one that holds a DIFFERENT fact at its cursor than this hub does
     (at: the id it holds there) — a store that went back and then grew past the device's cursor again (skeptic, 9/25) */
  function rewound(knownEpoch, cursor, at) {
    if (storeUnreadable || typeof knownEpoch !== 'string' || knownEpoch !== epoch || !Number.isInteger(cursor)) return false;
    if (cursor > head) return true;
    if (typeof at !== 'string' || cursor < 1) return false;
    const f = factAt(cursor); return !!f && f.id !== at;
  }
  /* @hub @sync @backup — the first device that shows the rewind makes the hub take a new identity before anything is served or
     admitted; false = the store refused the new identity (answer "retry", serve nothing) */
  function rewindCheck(knownEpoch, cursor, station, at) {
    if (!rewound(knownEpoch, cursor, at)) return true;
    const why = cursor > head ? 'had read up to position ' + cursor + ', but this hub holds only ' + head : 'holds a different fact at position ' + cursor + ' than this hub does';
    return !!takeNewEpoch('store-rewound', 'Station ' + station + ' ' + why + ' under the same identity: its store went back in time (restored from an older copy?).', station);
  }

  /* ---- @hub @sync @fact — RECEIVE: a device proposes facts of its own station; a store shown to have gone back in time takes a new identity first (E6) ---- */
  /* @hub @sync @permission — a device's facts, each judged in order (shape, size, hash, station, type, id, who may write it) and admitted durably or refused with its reason */
  function receive(bundle) {
    const b = (bundle && typeof bundle === 'object') ? bundle : {};
    const dev = deviceOf(b.token);
    const no = accessRefusal(dev, b.token, b.station);
    if (no) { stranded(dev, b); return { epoch: storeUnreadable ? null : epoch, refused: no }; }
    if (!Array.isArray(b.events)) return { epoch: epoch, refused: 'malformed bundle: events is not a list' };
    if (b.events.length > MAX_BUNDLE_IN) return { epoch: epoch, refused: 'bundle too large (' + b.events.length + ' facts; send ' + MAX_BUNDLE_IN + ' or fewer at a time)' };
    if (b.known && typeof b.known === 'object' && !rewindCheck(b.known.epoch, b.known.cursor, dev.station, b.known.at)) return { epoch: epoch, eventAcks: b.events.map(function (x) { return { id: (x && typeof x.id === 'string') ? x.id : null, ok: false, reason: 'storage: the hub could not take its new identity after a restore — retry' }; }) };   /* E6: before any position is handed out */
    const acks = [], staged = [], stage = [], stagedById = new Map();
    let refused = 0;
    const tNow = hubNow(); noteClock(stage, dev.station, b.sentAt, tNow);   /* E35: the sender's clock against the hub's */
    function no1(id, reason) { refused++; acks.push({ id: (typeof id === 'string' ? id : null), ok: false, reason: reason }); }
    b.events.forEach(function (raw) {
      let e; try { e = ev.wire(raw); } catch (err) { no1(null, 'not transmissible'); return; }
      if (e && typeof e === 'object' && !Array.isArray(e)) { delete e.pos; delete e.epoch; delete e.adopted; delete e.everPos; delete e.hubAt; }   // the hub assigns these; a sender's marks are not facts
      const shape = ev.shapeError(e);
      if (shape) { no1(e && e.id, 'malformed: ' + shape); return; }
      const big = tooLarge(e, dev.station); if (big) { stageAlert(stage, big.alert); no1(e.id, big.reason); return; }   /* E63: before the hash is even checked */
      if (!ev.verify(e)) { no1(e.id, 'its content does not match its hash (altered on the way)'); return; }
      if (e.station !== dev.station) { stageAlert(stage, { key: 'wrong-station:' + dev.station, kind: 'wrong-station', station: dev.station, note: 'The device enrolled as "' + dev.station + '" sent a fact claiming station "' + e.station + '". A device writes only as itself; refused.' }); no1(e.id, 'a device writes only as its own station ("' + dev.station + '")'); return; }
      const def = registry.typeDef(e.type);
      if (!def || def.aggregate !== e.aggregate) { stageAlert(stage, { key: 'unregistered:' + e.station + ':' + e.type, kind: 'unregistered', station: e.station, note: 'Station ' + e.station + ' sent a fact of a type this hub does not know ("' + e.type + '"): deploy the hub before the stations. Held on the station, never lost.' }); no1(e.id, 'not a registered event of that aggregate — retry after the hub is updated'); return; }
      if (def.validate) { const bad = def.validate(e.payload || {}); if (bad) { stageAlert(stage, { key: 'invalid-payload:' + e.station + ':' + e.type, kind: 'invalid-payload', station: e.station, note: 'Station ' + e.station + ' sent a ' + e.type + ' this hub judges invalid (' + bad + '). Validators must be widened, never tightened, ahead of the stations.' }); no1(e.id, 'invalid payload: ' + bad); return; } }
      const have = byId.get(e.id) || stagedById.get(e.id);
      if (have) {
        if (have.hash === e.hash) { acks.push({ id: e.id, ok: true, hash: e.hash, pos: have.pos, epoch: epoch, replay: true }); return; }
        stageAlert(stage, { key: 'id-collision:' + e.id, kind: 'id-collision', station: e.station, note: 'Two different facts were offered under the id ' + e.id + '. The first stays; the second was refused.' });
        no1(e.id, 'id collision: this hub holds a different fact under that id'); return;
      }
      if (def.admit) { const no = def.admit(e.payload || {}, function (dotted, v) { return registry.heldIn(master, e.type, dotted, v); } /* 10/18: an id the shop's history already holds is a reference (THE ID RULE, core/registry.js) — every fact read, since a fact put back by reseed is not filed by aggregate until a restart; asked only when an id breaks the rule */); if (no) { stageAlert(stage, { key: 'not-admitted:' + e.station + ':' + e.type, kind: 'invalid-payload', station: e.station, note: 'Station ' + e.station + ' sent a NEW ' + e.type + ' the hub does not take (' + no + ') — an out-of-date page; refresh it.' }); no1(e.id, 'invalid payload: ' + no); return; } }   /* 10/1: a rule for NEW facts only — after the replay check, so a fact the hub already holds is never refused by a rule newer than it */
      let why = authority ? authority(e, master, staged, b, readers) : null;   /* E30: judged by the hub's own fold of the staff facts — and (the PIN double check) the bundle's hub-checked PIN grants */
      if (why && typeof why === 'object') { if (why.alert) stageAlert(stage, why.alert); why = why.refuse || null; }   /* 10/25 (§970): a verdict that tells a person and admits (money on a voided ticket) */
      if (why) { stageAlert(stage, { key: 'not-allowed:' + e.station + ':' + e.type, kind: 'not-allowed', station: e.station, note: 'Station ' + e.station + ' sent a ' + e.type + ' the hub does not allow: ' + why + '. Held on the station, never admitted. If that tablet is lost or stolen, revoke it.' }); no1(e.id, 'not allowed: ' + why); return; }
      const ahead = aheadOf(e, tNow);   /* E35 (v1 stampSanitize): a stamp from the future is never admitted */
      if (ahead) { stageAlert(stage, { key: 'clock-ahead:' + dev.station + ':' + dayOf(tNow), kind: 'clock-ahead', station: dev.station, note: '⏰ Station ' + dev.station + ' sent facts dated ' + howFar(ahead) + ' AHEAD of the hub\'s clock — that tablet\'s clock is wrong. They were not admitted (held on the tablet, never lost). Set its date and time.' }); no1(e.id, 'clock: this fact is dated ' + howFar(ahead) + ' ahead of the hub — this tablet\'s clock is wrong; set its date and time (the fact is kept on this tablet)'); return; }
      e.pos = head + staged.length + 1; e.epoch = epoch; e.hubAt = hubNow();
      staged.push(e); stagedById.set(e.id, e);
      acks.push({ id: e.id, ok: true, hash: e.hash, pos: e.pos, epoch: epoch });
    });
    if (b.lost > 0) stageAlert(stage, { key: 'witness-lost:' + epoch, kind: 'witness-lost', station: dev.station, note: 'Station ' + dev.station + ' re-offered ' + b.lost + ' fact(s) this hub had already witnessed under this same identity: the hub store lost its tail (restored from an old backup?). They are admitted again; check the backups.' });
    countRefused(dev.station, refused);
    if (dev.rescue && !b.more && !refused) { const cr = cursors.get(dev.station); if (cr && cr.strandedOwes) { cr.strandedOwes = 0; cr.strandedMore = false; } }   /* E38: the replaced tablet has handed everything in */
    if (!staged.length && !stage.length) return { epoch: epoch, eventAcks: acks, now: tNow };
    staged.forEach(function (e) { master.push(e); byId.set(e.id, e); fileByAgg(e); }); head += staged.length; applyAlerts(stage);
    if (!save()) {                                                                  // undo exactly what this receive did; nothing staged is ever echoed
      staged.forEach(function (e) { master.pop(); byId.delete(e.id); }); head -= staged.length; unapplyAlerts(stage); unfileByAgg(staged);
      const ids = new Set(staged.map(function (e) { return e.id; }));
      return { epoch: epoch, now: tNow, eventAcks: acks.map(function (a) { return (a.ok && ids.has(a.id)) ? { id: a.id, ok: false, reason: 'storage: the hub could not make it durable — retry' } : a; }) };
    }
    tell(stage);
    /* what a person must see: each touched aggregate's own conflict check, after the facts are durable. An alert the store
       refuses stays in memory and is told anyway — better twice than never. */
    const touched = {}; staged.forEach(function (e) { touched[e.aggregate] = 1; });
    if (conflictDelayMs) { conflictsLater(Object.keys(touched)); return { epoch: epoch, eventAcks: acks, now: tNow }; }
    checkConflicts(Object.keys(touched));
    return { epoch: epoch, eventAcks: acks, now: tNow };
  }
  /* @hub @fact @audit — what a person must see: each named aggregate's own conflict check over ITS facts, after they are durable. An
     alert the store refuses stays in memory and is told anyway — better twice than never. Returns how many alerts were new. */
  function checkConflicts(aggs) {
    const found = [];
    aggs.forEach(function (agg) {
      const def = registry.aggregate(agg); if (!def || typeof def.detectConflicts !== 'function') return;
      conflictsOf(agg, def).forEach(function (d) {
        const said = (typeof def.describe === 'function') ? (def.describe(d) || null) : null;   // the aggregate words its own alert (money is not a shift)
        const kind = (said && said.kind) || (d.kind === 'invalid' ? 'invalid-shift' : d.kind === 'orphan' ? 'orphan-punch' : d.kind === 'suspect' ? 'suspect-shift' : 'dispute');
        const key = agg + ':' + (d.shiftId || '') + ':' + (d.eventId || '') + ':' + (d.closes || []).map(function (c) { return c.id; }).sort().join('+') + ':' + kind + (d.why ? ':' + d.why : '');
        const note = (said && said.note) || (kind === 'invalid-shift' ? 'A shift no longer makes sense (' + d.why + '). A person should review.'
          : kind === 'orphan-punch' ? 'A human punch fits no shift (' + (d.type || 'close') + ' for ' + d.empId + ' at ' + new Date(d.at).toISOString() + '). That time is on no shift; a person should review.'
          : kind === 'suspect-shift' ? 'A shift looks wrong (' + d.why + '). A person should review.'
          : 'Two human facts disagree. BOTH are retained and applied in order; the later-applied is the current value. A person should review.');
        stageAlert(found, { key: key, kind: kind, aggregate: agg, detail: d, note: note });
      });
    });
    if (found.length) { applyAlerts(found); save(); tell(found); }
    return found.length;
  }
  /* @hub @fold @audit — one aggregate's conflicts over ITS facts. A check that is exactly its fold's notes, on an aggregate that
     carries inc, is FOLLOWED (core/incfold.js): only the facts filed since the last check are stepped, never all history, and each
     note is handed on as a copy (an alert keeps it; the follower's state moves on). Any other check is called as it always was,
     on a copy of the aggregate's whole list */
  function conflictsOf(agg, def) {
    if (!(def.inc && NOTES_ONLY.test(String(def.detectConflicts)) && proj.follows(agg))) return def.detectConflicts((byAgg.get(agg) || []).slice());
    return (proj.live(agg).notes || []).map(function (d) { return structuredClone(d); });   /* 10/18: the read model's follower (one checkpoint, HUB_FOLLOW), shared with view(agg) */
  }
  /* @hub @fact @audit — a busy floor's receives coalesced into ONE check per aggregate a few seconds later, off the answer's path:
     a scan no longer costs a fold of the aggregate's whole history before the tablet hears back (audit E56, batch `perf`) */
  function conflictsLater(aggs) {
    aggs.forEach(function (a) { conflictPending.add(a); });
    if (conflictTimer) return;
    conflictTimer = setTimeout(function () { conflictTimer = null; try { flushConflicts(); } catch (e) { warnings.push('the conflict check stopped: ' + String((e && e.message) || e)); } }, Math.max(conflictDelayMs, 10 * lastCheckMs));   /* never more than a tenth of the hub's time, however long history grows */
    if (conflictTimer && conflictTimer.unref) conflictTimer.unref();
  }
  /* @hub @audit — run the checks that are waiting, now (the timer; a proof; a hub about to stop) */
  function flushConflicts() { if (conflictTimer) { clearTimeout(conflictTimer); conflictTimer = null; } const aggs = Array.from(conflictPending); conflictPending.clear(); if (!aggs.length) return 0; const t0 = Date.now(), n = checkConflicts(aggs); lastCheckMs = Date.now() - t0; return n; }
  /* @hub @fold — a fact filed under its aggregate (the master's own object), and the aggregate's newest position */
  function fileByAgg(e) { let l = byAgg.get(e.aggregate); if (!l) { l = []; byAgg.set(e.aggregate, l); } l.push(e); if (!(aggPos.get(e.aggregate) >= e.pos)) aggPos.set(e.aggregate, e.pos); }
  /* @hub @fold — a refused save's facts taken back out of their aggregates' lists (newest last, so each is its list's tail); a
     followed conflict check on a shortened list starts over (its next check steps the list from the start) */
  function unfileByAgg(list) { for (let i = list.length - 1; i >= 0; i--) { const e = list[i], l = byAgg.get(e.aggregate); if (l && l[l.length - 1] === e) l.pop(); const last = l && l.length ? l[l.length - 1].pos : 0; if (last) aggPos.set(e.aggregate, last); else aggPos.delete(e.aggregate); }
    if (frozenUpTo > master.length) frozenUpTo = master.length;   /* 10/18 review: a facts() read during the refused save must not leave the next facts admitted unfrozen */
    proj.cutBack(); }   /* 10/18 review: only what read the taken-back facts starts again (was: the whole aggregate, on every refused retry) (§915) */
  /* @hub @fold — the hub's facts for its OWN read-only readers (its folds, the tracking page, the automatic work, the backups):
     the master's objects themselves, frozen as they are first handed out (a fact never changes once admitted), in a fresh
     list — no copy of every fact per read (audit E60: hub.master cloned all history on every read). A reader that tried to
     change a fact would throw instead of corrupting the record; hub.master still hands out copies. */
  function facts() { freezeAll(); return master.slice(); }
  /* @hub @fact — every fact admitted so far frozen as facts() freezes it, without the list (10/18: the read model calls it before its
     follower steps them, so a shared view holds the facts' own frozen parts instead of copies of them) */
  function freezeAll() { for (; frozenUpTo < master.length; frozenUpTo++) deepFreeze(master[frozenUpTo]); }
  /* @hub — the newest position of each named aggregate's facts: a memo keyed on it refolds only when ITS facts moved */
  function aggHead(aggs) { return [].concat(aggs).map(function (a) { return aggPos.get(a) || 0; }).join(','); }

  /* @hub @sync @fact @backup — RESEED (audit E1, an OPERATOR only): facts of ANY station from a copy somebody still holds — a
     tablet's ⬇ Full backup, after the server was lost — each checked exactly as a device's own (shape, hash, registered type,
     valid payload). One already held is a replay; a different fact under a held id is refused. It widens nothing an operator
     could not already do (the operator enrols devices); every admitted batch is an alert naming who and how many. */
  function reseed(events, meta) {
    if (storeUnreadable) return { refused: 'the hub cannot read its store — nothing is admitted until an operator restores it', admitted: 0, held: 0, rejected: [] };
    const out = { admitted: 0, held: 0, rejected: [] }, staged = [], stagedById = new Map();
    (Array.isArray(events) ? events : []).forEach(function (raw) {
      const no1 = function (id, reason) { if (out.rejected.length < 200) out.rejected.push({ id: (typeof id === 'string' ? id : null), reason: reason }); };
      let e; try { e = ev.wire(raw); } catch (err) { no1(null, 'not transmissible'); return; }
      if (e && typeof e === 'object' && !Array.isArray(e)) { delete e.pos; delete e.epoch; delete e.adopted; delete e.everPos; delete e.hubAt; }
      const shape = ev.shapeError(e); if (shape) { no1(e && e.id, 'malformed: ' + shape); return; }
      if (!ev.verify(e)) { no1(e.id, 'its content does not match its hash (altered)'); return; }
      if (!goodStationId(e.station)) { no1(e.id, 'no station a device could be enrolled as'); return; }
      const def = registry.typeDef(e.type);
      if (!def || def.aggregate !== e.aggregate) { no1(e.id, 'not a registered event of that aggregate'); return; }
      if (def.validate) { const bad = def.validate(e.payload || {}); if (bad) { no1(e.id, 'invalid payload: ' + bad); return; } }
      const have = byId.get(e.id) || stagedById.get(e.id);
      if (have) { if (have.hash === e.hash) out.held++; else no1(e.id, 'id collision: this hub holds a different fact under that id'); return; }
      e.pos = head + staged.length + 1; e.epoch = epoch; e.hubAt = hubNow(); staged.push(e); stagedById.set(e.id, e);
    });
    out.refusedCount = (Array.isArray(events) ? events.length : 0) - out.held - staged.length;
    if (!staged.length) return out;
    const by = String((meta && meta.by) || 'operator').slice(0, 80), stations = {}; staged.forEach(function (e) { stations[e.station] = (stations[e.station] || 0) + 1; });
    const stage = []; stageAlert(stage, { key: 'reseeded:' + epoch + ':' + (head + staged.length), kind: 'reseeded', note: by + ' put back ' + staged.length + ' fact(s) this hub did not hold, from a copy (' + Object.keys(stations).map(function (s) { return s + ' ' + stations[s]; }).join(', ') + '); each was checked by its hash. ' + out.held + ' were already here.' });
    staged.forEach(function (e) { master.push(e); byId.set(e.id, e); fileByAgg(e); }); head += staged.length; applyAlerts(stage);   /* 10/18: filed by aggregate as receive files them — the conflict checks, the followers and aggHead missed a put-back fact until the next restart (load files them) */
    if (!save()) { staged.forEach(function (e) { master.pop(); byId.delete(e.id); }); head -= staged.length; unapplyAlerts(stage); unfileByAgg(staged); return { refused: 'storage: the hub could not make it durable — retry', admitted: 0, held: out.held, rejected: out.rejected }; }
    tell(stage); out.admitted = staged.length; return out;
  }

  /* ---- @hub @sync @fact — PULL: a device learns everything after its cursor; a device naming another epoch starts from zero, and a cursor past a rewound store's head makes the hub take a new identity (E6) ---- */
  /* @hub @sync — what a device has not seen, after its cursor: at most PULL_MAX facts and PULL_BYTES (E63), always at least one, and whether
     more waits. `at` is the id of the fact the tablet holds at its cursor (E6); `info` is what the tablet says of itself (its clock, build,
     store: E35 / S19 / S58). merge 9/25 (batches backup and sync both added a 5th argument): an OBJECT in the 5th place is the tablet's info
     (the sync batch's calls), a string there is `at` (the E6 calls) — `at` is only ever a fact id, so the two never mix. */
  function pull(token, cursor, knownEpoch, limit, at, info) {
    if (info === undefined && at && typeof at === 'object') { info = at; at = undefined; }
    const dev = deviceOf(token);
    const no = accessRefusal(dev, token, null);
    if (no) return { epoch: storeUnreadable ? null : epoch, refused: no };
    if (!rewindCheck(knownEpoch, cursor, dev.station, at)) return { epoch: epoch, refused: 'storage: the hub could not take its new identity after a restore — retry' };   /* E6: a rewound store answers under a new identity, from zero */
    const from = (knownEpoch === epoch && Number.isInteger(cursor) && cursor > 0) ? cursor : 0;
    const max = Math.max(1, Math.min(PULL_MAX, limit || PULL_MAX));
    let i = 0; while (i < master.length && master[i].pos <= from) i++;               // master is in position order
    const events = pullSlice(i, max);   /* E63: a byte budget as well as a count */
    const upTo = events.length ? events[events.length - 1].pos : from;
    note(dev.station, upTo);
    const tNow = hubNow(); pullInfo(dev.station, info, tNow);
    return { epoch: epoch, from: from, events: events, head: head, more: i + events.length < master.length, now: tNow };
  }
  /* @sync @clock @station — what a tablet says about itself when it pulls (its clock now; more below): kept per station, an
     alert raised the way receive raises one (saved, then told) */
  function pullInfo(station, info, now) {
    buildNote(station, info, now);   /* S19: before the early return — a page too old to say anything is judged too */
    if (!info || typeof info !== 'object' || Array.isArray(info)) return;
    scopeNote(station, info.scope);   /* S58 */
    const st = []; noteClock(st, station, info.sentAt, now); st.forEach(raise);
  }
  /* @store @station @hub — S58: the store a PERSON chose on a tablet (v1 stationRemember: 'all', or a store) — the tablet says it on
     its pulls and the hub keeps it per station, so a cleared or replaced tablet under the same name gets it back (scopeOf, on
     every pull answer) and Devices shows it. An adopted guess is never sent, so it never overwrites a person's choice. */
  function scopeNote(station, scope) {
    if (!(scope === 'all' || (Number.isInteger(scope) && scope >= 1 && scope <= 99))) return;
    const c = cursors.get(station) || { cursor: 0, at: 0, refused: 0, refusedLast: 0 };
    if (c.scope !== scope) { c.scope = scope; cursors.set(station, c); save(); }
  }
  /* @store @station @hub — S58: the store the hub remembers for a station (undefined: nobody chose one there yet) */
  function scopeOf(station) { const c = cursors.get(station); return c && c.scope != null ? c.scope : undefined; }
  const BUILDS = require('./buildwatch').kit({ Date: { now: function () { return hubNow(); } } });   /* S19: v1's build verdict on the hub's clock */
  /* @sync @startup @hub — S19: which build a tablet's page runs, since when its page is open and whether its storage is kept (its pull
     says), judged against the build this hub serves by v1's own rule (hub/buildwatch.js: 45 minutes to update itself, then OLD with
     the reason). Kept per station for Devices and the owner's Home alarm; saved with the cursors, never a fact. The copy from v1 and
     the hub's own station are no pages and are not judged; a hub serving no station files judges nobody. */
  function buildNote(station, info, now) {
    const rev = typeof opts.build === 'function' ? String(opts.build() || '') : ''; if (!rev || NO_BAND.indexOf(station) >= 0) return;
    const i = (info && typeof info === 'object' && !Array.isArray(info)) ? info : {}, c = cursors.get(station) || { cursor: 0, at: 0, refused: 0, refusedLast: 0 };
    const d = Object.assign({}, c.page || {}); d.appRev = typeof i.build === 'string' ? i.build.slice(0, 40) : ''; d.lastSeen = now;
    if (Number(i.pageAt) > 0) d.pageAt = Number(i.pageAt); if (typeof i.persist === 'string') d.persist = i.persist.slice(0, 80);
    BUILDS.buildVerdict(d, rev, []); c.page = d; cursors.set(station, c);
  }
  /* @hub @sync — a station's read cursor, moved forward only and stamped with when it last pulled */
  function note(st, c) { const cur = cursors.get(st) || { cursor: 0, at: 0, refused: 0, refusedLast: 0 }; cur.cursor = Math.max(Number(c) || 0, cur.cursor || 0); cur.at = hubNow(); cursors.set(st, cur); }

  /* ---- reads (every read is a copy) ---- */
  /* @hub @sync @fact — every admitted fact after a position, each a copy */
  function changesSince(pos) { return master.filter(function (e) { return e.pos > pos; }).map(clone); }
  /* @hub @fact — the admitted facts with these ids, as copies; an unknown id is skipped */
  function get(ids) { return (ids || []).map(function (id) { return byId.get(id); }).filter(Boolean).map(clone); }
  /* @hub @fact @station — every admitted fact one station wrote, as copies */
  function eventsOf(st) { return master.filter(function (e) { return e.station === st; }).map(clone); }
  /* @hub @station — every station the hub ever enrolled a device for, revoked ones included, sorted */
  function stationsKnown() { const s = new Set(); devices.forEach(function (d) { s.add(d.station); }); return Array.from(s).sort(); }
  /* @hub @sync @fact — where one fact stands: which live stations have read it and which still miss it */
  function status(id) {
    const e = byId.get(id); if (!e) return null;
    const live = stationsKnown().filter(function (s) { return enrolled(s); });
    const seenBy = live.filter(function (s) { return s === e.station || ((cursors.get(s) || {}).cursor || 0) >= e.pos; });
    const missingFrom = live.filter(function (s) { return seenBy.indexOf(s) < 0; });
    return { id: id, station: e.station, hash: e.hash, pos: e.pos, epoch: epoch, seenBy: seenBy, missingFrom: missingFrom, complete: missingFrom.length === 0 };
  }
  /* @hub @sync @station @admin — every station at a glance for Admin → Devices: how far behind, refusing, revoked, its clock, its build, its store, facts still stranded on it */
  function watch() {
    const stations = Object.create(null);
    stationsKnown().forEach(function (st) {
      const c = cursors.get(st) || { cursor: 0, at: 0, refused: 0, refusedLast: 0 };
      stations[st] = { enrolled: enrolled(st), revoked: !enrolled(st), cursor: c.cursor || 0, behind: Math.max(0, head - (c.cursor || 0)), lastPull: c.at || 0, refused: c.refused || 0, refusedLast: c.refusedLast || 0, facts: master.filter(function (e) { return e.station === st; }).length };
      if (c.clockAt) { stations[st].clockSkew = c.clockSkew || 0; stations[st].clockAt = c.clockAt; stations[st].clockWrong = Math.abs(c.clockSkew || 0) > clockSkewMs; }   /* E35: that tablet's clock, as last seen */
      if (c.page) Object.assign(stations[st], { appRev: c.page.appRev || '', pageAt: c.page.pageAt || 0, lastSeen: c.page.lastSeen || 0, oldBuild: !!c.page.oldBuild, oldBuildWhy: c.page.oldBuildWhy || '', updatingSince: c.page.updatingSince || 0, persist: c.page.persist || '' });   /* S19: its build and v1's verdict */
      if (c.scope != null) stations[st].scope = c.scope;   /* S58: the store a person chose there */
      if (c.strandedOwes) { stations[st].strandedOwes = c.strandedOwes; stations[st].strandedMore = !!c.strandedMore; stations[st].strandedAt = c.strandedAt || 0; }   /* E38: a replaced tablet still holds unsent facts */
      devices.forEach(function (d) { if (d.station === st && d.rescue && !d.revoked && !rescueOver(d)) stations[st].rescueUntil = Math.max(stations[st].rescueUntil || 0, d.until); });
    });
    const live = Object.keys(stations).filter(function (s) { return stations[s].enrolled; });
    return { epoch: storeUnreadable ? null : epoch, head: head, events: master.length, stations: stations,
      laggards: live.filter(function (s) { return stations[s].behind > 0; }),
      refusing: live.filter(function (s) { return stations[s].refusedLast > 0; }),
      revoked: Object.keys(stations).filter(function (s) { return stations[s].revoked; }),
      alerts: alerts.length, persistError: persistError, storeUnreadable: storeUnreadable, quarantinedRows: quarantinedRows, warnings: warnings.slice() };
  }

  const api = { receive: receive, pull: pull, enroll: enroll, revoke: revoke, enrolled: enrolled, deviceOf: deviceOf, allowedDevice: allowedDevice, bandOf: bandOf, note: note, changesSince: changesSince, get: get, eventsOf: eventsOf, status: status, watch: watch, takeNewEpoch: takeNewEpoch, reseed: reseed, factsBetween: factsBetween, retrySave: retrySave };
  api.facts = facts; api.aggHead = aggHead; api.flushConflicts = flushConflicts;   /* batch `perf`: the shared read, the per-aggregate head, the coalesced check */
  api.scopeOf = scopeOf;   /* S58 */
  api.callerOf = callerOf;   /* 10/18 (batch 2): who is calling, for the tablets' watch — never a door */
  /* 10/18 (enterprise batch 2): THE ONE READ MODEL — view(agg) is what that aggregate's fold answers over every fact now, frozen and shared
     by every reader, worked out once per move of its own facts (hub/projections.js). opts.sharedViews === false (a proof's seam, never
     read from the environment) leaves it off, so every reader folds its own as it did before 10/18 — the memory proof's comparison */
  if (opts.sharedViews !== false) { api.view = proj.view; api.viewStats = proj.stats; }
  Object.defineProperties(api, {
    alerts: { get: function () { return clone(alerts); }, enumerable: true },
    warnings: { get: function () { return warnings.slice(); }, enumerable: true },
    master: { get: function () { return master.map(clone); }, enumerable: true },
    head: { get: function () { return head; }, enumerable: true },
    epoch: { get: function () { return storeUnreadable ? null : epoch; }, enumerable: true },
    stations: { get: function () { return stationsKnown(); }, enumerable: true },
    persistError: { get: function () { return persistError; }, enumerable: true },
    persistErrorSince: { get: function () { return persistSince; }, enumerable: true },   /* E10: when the store began refusing (null while it takes writes) */
    storeUnreadable: { get: function () { return storeUnreadable; }, enumerable: true }
  });
  return api;
}

module.exports = { RESCUE_MS: RESCUE_MS, makeHub: makeHub, MAX_BUNDLE_IN: MAX_BUNDLE_IN, PULL_MAX: PULL_MAX, tokenHash: tokenHash, ALERT_KEEP: ALERT_KEEP, STRANGER_EVERY_MS: STRANGER_EVERY_MS, FACT_MAX: FACT_MAX, PULL_BYTES: PULL_BYTES, CLOCK_SKEW_MS: CLOCK_SKEW_MS, howFar: howFar };
