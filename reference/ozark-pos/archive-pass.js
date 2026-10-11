#!/usr/bin/env node
/* 🗄 archive-pass.js — retire long-settled orders out of the synced database, keep them forever, restorable.
   Owner 2026-08-24: "lets get that archive pass built now while we are ahead... make it all infinitely
   scalable by retiring old data but keeping it available to pull back into the loop."

   DRY-RUN BY DEFAULT. Run on the droplet:  node /opt/ozark/archive-pass.js          (report only)
                                            node /opt/ozark/archive-pass.js --apply  (do it)

   WHAT IT DOES, in the only safe order:
     1. pulls the live DB through the sync API (never touches the file — the hub owns it),
     2. selects orders that are DONE by every measure (see eligibility below), grouped into FAMILIES
        (split parents/children, bag links) — a family archives together or not at all,
     3. appends each order to hub-data/archive/orders-<year>.jsonl (append-only, partitioned by the
        order's own year), fsyncs, RE-READS and verifies every id landed,
     4. updates hub-data/archive/index.json (id → file/number/customer/when; rebuildable by scanning),
     5. only THEN pushes tombstones ({c:'orders',k:id,t:now}) as a delta — the hub deletes its copies,
        every station deletes theirs on the next pull, and the app's 1-year tombstone prune keeps even
        the tombstone list bounded. An activity row names the run so the shop can see what happened.
     6. reads the DB back and confirms the archived ids are gone.

   ELIGIBILITY — an order must clear EVERY bar:
     · status PickedUp (and paymentStatus 'paid'), Void, or Split (a dissolved shell)
     · every timestamp it carries (created/picked/ready/assembled/_t) older than the cutoff
       (OZARK_ARCHIVE_DAYS, default 400 — a year plus a season of slack)
     · no rack location claimed (a spot on the shelf is a live physical fact)
     · no collection row referencing it that is not closed/resolved/written off
     · no pending void or refund request naming it
     · not restored-and-held recently (o.archiveHold within 90 days — a pulled-back order stays around)
     · its whole FAMILY (parentId / splitFrom / bagOf / childOrders links) is eligible too

   PULLING BACK INTO THE LOOP: the app fetches GET /api/archive/get?id= and saves the order with a fresh
   _t — newer than the tombstone, so the ordinary merge resurrects it everywhere. No special machinery.
   A restored order that goes quiet is simply re-archived by a later pass (append-only: the jsonl keeps
   both lines; the index points at the newest).

   ⚠️ THE ARCHIVE DELETES NOTHING, EVER. jsonl files only grow; "removal" from the live DB happens only
   after the archive copy is verified readable. If ANY step fails the pass stops loudly with nothing lost.
   ⚠️ Money stays: payments and ledger rows are small and are the money truth — they are NOT archived.
   audit-integrity and check-invariants know the archive index, so a payment pointing at an archived
   order is not an orphan. */
'use strict';
const fs = require('fs'), path = require('path'), http = require('http');

const HERE = __dirname;
const DATADIR = process.env.OZARK_DATADIR || path.join(HERE, 'hub-data');
const ARCHDIR = path.join(DATADIR, 'archive');
const INDEX = path.join(ARCHDIR, 'index.json');
const PORT = +(process.env.OZARK_HUB_PORT || 8090);
const HOST = process.env.OZARK_HUB_HOST || '127.0.0.1';
const APPLY = process.argv.includes('--apply');
const daysArg = process.argv.indexOf('--days');
const DAYS = daysArg > -1 ? +process.argv[daysArg + 1] : +(process.env.OZARK_ARCHIVE_DAYS || 400);
const BATCH = 500;
const HOLD_DAYS = 90;
const CT = ms => new Date(ms).toLocaleString('en-US', { timeZone: 'America/Chicago' });

const KEY = process.env.OZARK_HUB_KEY ||
  ((fs.readFileSync(path.join(HERE, 'hub.env'), 'utf8').match(/^OZARK_HUB_KEY=(.*)$/m) || [])[1] || '').trim();
if (!KEY) { console.error('no hub key — set OZARK_HUB_KEY or run beside hub.env'); process.exit(1); }

const req = (method, p, body) => new Promise((res, rej) => {
  const data = body === undefined ? null : JSON.stringify(body);
  const r = http.request({ host: HOST, port: PORT, path: p, method, headers: Object.assign(
    { 'x-ozark-key': KEY, 'x-ozark-device': 'archive-pass' },
    data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}) }, x => {
    let d = ''; x.on('data', c => d += c);
    x.on('end', () => { let j = null; try { j = JSON.parse(d); } catch (e) {} res({ status: x.statusCode, json: j }); });
  });
  r.on('error', rej); if (data) r.write(data); r.end();
});

/* the same two-clock promotion the app and hub share: a hybrid stamp is ms*1000 */
const toMs = t => { t = +t || 0; return t > 3e14 ? Math.round(t / 1000) : t; };

(async () => {
  /* one pass at a time — a lock that a crashed run cannot hold forever */
  const LOCK = path.join(DATADIR, 'archive-pass.lock');
  try { const st = fs.statSync(LOCK); if (Date.now() - st.mtimeMs < 3600000) { console.error('another pass appears to be running (lock < 1h old) — refusing'); process.exit(1); } } catch (e) {}
  if (APPLY) fs.writeFileSync(LOCK, String(process.pid));
  const unlock = () => { try { fs.unlinkSync(LOCK); } catch (e) {} };

  const g = await req('GET', '/api/db');
  if (!g.json || typeof g.json.rev !== 'number' || !g.json.db) { console.error('could not read the DB from the hub'); unlock(); process.exit(1); }
  const db = g.json.db, baseRev = g.json.rev;
  /* refuse to act on a short read — a measurement that fails in the reassuring direction is worse than none */
  const MINCUST = +(process.env.OZARK_ARCHIVE_MIN_CUST || 100);   /* test harness hatch — production keeps the floor */
  if (!Array.isArray(db.orders) || !Array.isArray(db.customers) || db.customers.length < MINCUST) {
    console.error('DB read looks implausible (orders:' + (db.orders || []).length + ' customers:' + (db.customers || []).length + ') — refusing'); unlock(); process.exit(1); }

  const cutoff = Date.now() - DAYS * 86400000;
  const orders = db.orders;
  const byId = {}; orders.forEach(o => byId[o.id] = o);

  /* --- open references that BLOCK archiving --- */
  const blockedBy = {};   // orderId -> reason
  for (const c of (db.collections || [])) {
    if (!c.orderId) continue;
    if (!/resolved|closed|done|written|collected|cleared/i.test(String(c.status || ''))) blockedBy[c.orderId] = 'open collection (' + (c.status || 'open') + ')';
  }
  for (const v of (db.voidRequests || [])) if (v.orderId && /pending/i.test(String(v.status || ''))) blockedBy[v.orderId] = 'pending void request';
  for (const v of (db.refundRequests || [])) if (v.orderId && /pending/i.test(String(v.status || ''))) blockedBy[v.orderId] = 'pending refund request';

  /* --- per-order eligibility --- */
  function newestTs(o) {
    let m = 0; for (const f of ['createdAt', 'pickedAt', 'readyAt', 'asmAt', 'deliveredAt']) m = Math.max(m, +o[f] || 0);
    return Math.max(m, toMs(o._t));
  }
  function whyNot(o) {
    if (!/^(PickedUp|Void|Split)$/.test(String(o.status || ''))) return 'status ' + o.status;
    if (o.status === 'PickedUp' && String(o.paymentStatus || '') !== 'paid') return 'PickedUp but ' + (o.paymentStatus || 'unpaid');
    if (newestTs(o) >= cutoff) return 'too recent';
    if (String(o.rackLoc || '').trim()) return 'still claims rack spot ' + o.rackLoc;
    if (blockedBy[o.id]) return blockedBy[o.id];
    if (+o.archiveHold && Date.now() - o.archiveHold < HOLD_DAYS * 86400000) return 'restored recently (archiveHold)';
    return null;
  }

  /* --- families: split/bag links archive together or not at all --- */
  const parent = {}; const find = x => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  const union = (a, b) => { if (!byId[a] || !byId[b]) return; a = find(a); b = find(b); if (a !== b) parent[a] = b; };
  orders.forEach(o => parent[o.id] = o.id);
  orders.forEach(o => {
    for (const f of ['parentId', 'splitFrom', 'bagOf']) if (o[f] && byId[o[f]]) union(o.id, o[f]);
    for (const ch of (o.childOrders || [])) if (byId[ch]) union(o.id, ch);
  });
  const fams = {}; orders.forEach(o => (fams[find(o.id)] = fams[find(o.id)] || []).push(o));

  const eligible = [], nearMiss = {};
  for (const root of Object.keys(fams)) {
    const fam = fams[root];
    const reasons = fam.map(o => whyNot(o));
    if (reasons.every(r => r === null)) eligible.push(...fam);
    else {
      /* count families where at least one member was old enough — the "almost" report */
      if (fam.some((o, i) => reasons[i] !== null && reasons[i] !== 'too recent' && newestTs(o) < cutoff)) {
        for (let i = 0; i < fam.length; i++) if (reasons[i]) nearMiss[reasons[i]] = (nearMiss[reasons[i]] || 0) + 1;
      }
    }
  }

  console.log('🗄 ARCHIVE PASS — cutoff ' + DAYS + ' days (before ' + CT(cutoff) + ') · live orders: ' + orders.length);
  console.log('   eligible (whole families, every bar cleared): ' + eligible.length);
  if (Object.keys(nearMiss).length) { console.log('   old enough but blocked:'); for (const r of Object.keys(nearMiss)) console.log('     · ' + r + ' × ' + nearMiss[r]); }
  if (!eligible.length) { console.log('nothing to archive — the shop is young. This pass is rehearsed and waiting.'); unlock(); process.exit(0); }
  if (!APPLY) { console.log('\nDRY RUN — nothing written. The first few:');
    eligible.slice(0, 8).forEach(o => console.log('   ' + o.number + ' · ' + o.status + ' · ' + CT(newestTs(o))));
    unlock(); process.exit(0); }

  /* --- 3+4: durable append, verify, index — BEFORE any tombstone --- */
  fs.mkdirSync(ARCHDIR, { recursive: true });
  let index = {}; try { index = JSON.parse(fs.readFileSync(INDEX, 'utf8')) || {}; } catch (e) { index = {}; }
  const byFile = {};
  for (const o of eligible) {
    const y = new Date(+o.createdAt || Date.now()).getFullYear();
    const f = 'orders-' + y + '.jsonl'; (byFile[f] = byFile[f] || []).push(o);
  }
  const archivedAt = Date.now();
  for (const f of Object.keys(byFile)) {
    const fp = path.join(ARCHDIR, f);
    const lines = byFile[f].map(o => JSON.stringify({ at: archivedAt, order: o })).join('\n') + '\n';
    const fd = fs.openSync(fp, 'a'); fs.writeSync(fd, lines); fs.fsyncSync(fd); fs.closeSync(fd);
    /* verify by re-reading: every id we appended must parse back out of the file */
    const txt = fs.readFileSync(fp, 'utf8'); const got = new Set();
    for (const ln of txt.split('\n')) { if (!ln) continue; try { const j = JSON.parse(ln); if (j.order && j.order.id) got.add(j.order.id); } catch (e) {} }
    for (const o of byFile[f]) if (!got.has(o.id)) { console.error('VERIFY FAILED: ' + o.id + ' did not read back from ' + f + ' — stopping with nothing removed'); unlock(); process.exit(1); }
    for (const o of byFile[f]) index[o.id] = { f: f, num: o.number, cid: o.customerId, created: +o.createdAt || 0, at: archivedAt };
  }
  const tmp = INDEX + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(index)); fs.renameSync(tmp, INDEX);
  console.log('   archived ' + eligible.length + ' order(s) into ' + Object.keys(byFile).join(', ') + ' — verified readable');

  /* --- 5: tombstones, in batches, each against a fresh baseRev --- */
  let done = 0;
  for (let i = 0; i < eligible.length; i += BATCH) {
    const slice = eligible.slice(i, i + BATCH);
    const now = Date.now();
    const tombs = slice.map(o => ({ c: 'orders', k: o.id, t: now }));
    const act = [{ ts: now, type: 'Archive', emp: 'Blake Sandiford', ws: 'archive-pass',
      detail: slice.length + ' settled order(s) older than ' + DAYS + ' days moved to the hub archive (retrievable in Search → 🗄 Archive)' , store: 0 }];
    const fresh = await req('GET', '/api/db');
    const post = await req('POST', '/api/db', { delta: true, db: { _tomb: tombs, activity: act }, baseRev: fresh.json.rev });
    if (!post.json || !post.json.ok) { console.error('tombstone push refused at batch ' + i + ': ' + JSON.stringify(post.json) + ' — archive copies are safe; re-run to finish'); unlock(); process.exit(1); }
    done += slice.length;
    console.log('   tombstoned ' + done + '/' + eligible.length + ' (rev ' + post.json.rev + ')');
  }

  /* --- 6: read back --- */
  const after = await req('GET', '/api/db');
  const still = eligible.filter(o => (after.json.db.orders || []).some(x => x.id === o.id));
  if (still.length) { console.error('⚠️ ' + still.length + ' archived order(s) still in the live DB after tombstoning: ' + still.slice(0, 5).map(o => o.number).join(', ')); unlock(); process.exit(1); }
  console.log('✅ read back from the hub: all ' + eligible.length + ' gone from the live DB, safe in the archive, restorable.');
  unlock();
})().catch(e => { console.error('FAILED: ' + (e && e.message)); try { fs.unlinkSync(path.join(DATADIR, 'archive-pass.lock')); } catch (x) {} process.exit(1); });
