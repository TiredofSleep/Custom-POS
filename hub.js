#!/usr/bin/env node
/*
  customPOS — the hub (optional multi-device sync server)
  ======================================================
  Zero-dependency Node server. Two jobs:
    1. Serve the app files (pos.html, builder.html, …) over http.
    2. /api/db — the shared data. Devices PUSH their DB and PULL the merged one, so several
       computers/phones (each a different station) share one live POS.

  Merge is by record id (a union — new records added, existing ones updated), seq = max, and
  customers by phone. Conflict resolution is LAST-WRITE-WINS per record, but version-aware: each
  record carries `upd` (a modification timestamp the client stamps when the record's content
  changes), and the hub keeps the copy with the newer `upd` — so a device that pushes a stale copy
  of a record can't clobber a newer edit made elsewhere. Records with no `upd` fall back to plain
  last-write-wins. Data persists to a JSON file so it survives a restart. See docs/HUB-SYNC.md.

  Run:  node hub.js            (serves this folder on :8090, data in ./hub-data/db.json)
        PORT=9000 DATA=/tmp/db.json node hub.js
  Point a device at it:  open  http://<host>:8090/pos.html?hub=http://<host>:8090
  (A downloaded POS can also set window.CUSTOMPOS_HUB or localStorage 'custompos_hub'.)

  SECURITY NOTE: this reference hub is open (no auth) for local/LAN use. Before exposing it to the
  internet, put it behind HTTPS + an access key (see the origin app's hub for the pattern). Card
  secrets NEVER live here or in the browser — only in a payments adapter's own server env.
*/
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT || 8090);
const ROOT = __dirname;
const DATA = process.env.DATA || path.join(ROOT, 'hub-data', 'db.json');
const TYPES = { '.html':'text/html', '.js':'text/javascript', '.md':'text/markdown', '.json':'application/json', '.svg':'image/svg+xml', '.png':'image/png', '.ico':'image/x-icon' };

function load(){ try { return JSON.parse(fs.readFileSync(DATA, 'utf8')); } catch (e) { return { records:[], seq:0, customers:[] }; } }
function save(db){ try { fs.mkdirSync(path.dirname(DATA), { recursive:true }); fs.writeFileSync(DATA, JSON.stringify(db)); } catch (e) {} }

/* ===== SYNC CONTRACT v1 — generalized from the Ozark reference (docs/PHASE-2-SUBSTRATE.md, Stage A) =====
   The three laws a multi-station POS (a cleaner with a counter, a plant and a van) cannot run without:

   1. ONE comparison, scale-aware. `upd` can hold TWO clock scales on one number line — a legacy bare-
      millisecond stamp (~1.7e12) and a hybrid logical stamp (~1.7e15, ms*1000+counter). A bare `>=` lets a
      six-day-old write beat today's by a factor of 1000. `stampScale` promotes a bare-ms stamp; `stampNewer`
      is the ONLY winner-picker, and a tie goes to the newcomer — BOTH sides symmetric (a strict rule is the
      rollback bug the reference calls out).
   2. ABSENCE IS NEVER A DELETE. A record merely missing from a push is KEPT — the store is the base of the
      merge, incoming only upserts. Only a TOMBSTONE (`deleted:true`, itself a stamped record) removes, so it
      wins or loses by the same rule: a newer real edit re-creates, a newer tombstone deletes. Tombstones are
      never physically dropped — that is what makes a delete propagate instead of resurrecting on the next pull.
   3. (next unit — Stage A3) orders only ADVANCE: the one-way status law, enforced on the hub too. */
const HLC_SCALE = 1e15;
function stampScale(t){ t = +t || 0; return t < HLC_SCALE ? t * 1000 : t; }   // bare-ms -> hybrid magnitude
function stampNewer(a, b){ return stampScale(a) >= stampScale(b); }           // ties -> the newcomer (a)
let _hlc = 0;
function hlcNow(){ _hlc = Math.max(Date.now() * 1000, _hlc + 1); return _hlc; }  // monotonic; survives a wall-clock step-back

// Law 3 — orders only ADVANCE. An order's lifecycle runs one way; a backward status is never legitimate, so
// even a stamp that lies (the 8/03 mass-restamp that flipped 10 PAID orders to unpaid) cannot roll it back.
// The stamp still picks WHOSE fields win; this floor only forbids the status itself from going below what's
// already known. Records with no ranked status (customers, drafts) are untouched.
const ORDER_RANK = { INPROGRESS:1, READY:2, PAID:3, CLOSED:4, REFUNDED:5 };

// Stage B — DELTA SYNC. The hub owns a monotonic `rev`; every record that actually changes in a push is
// stamped `_rev = <this push's rev>`, so a device can pull only what moved since the rev it last held
// (Ozark: 229KB -> 5KB a sync). `bare` compares content ignoring `_rev`, so an idempotent re-push doesn't
// churn the rev or re-broadcast the whole database.
const bare = o => { if (!o) return ''; const { _rev, ...rest } = o; return JSON.stringify(rest); };

// upsert incoming into a COPY of the base keyed by `key`; the base is authoritative for what's present
// (absence never deletes); a record — real or tombstone — replaces only when stampNewer says so. When
// `advanceOnly` is set, a winning record's status can never fall below the status the base already held.
// `ctx` carries this push's rev and gets `changed` set when a real add/change lands (so it gets stamped).
function mergeArr(base, incoming, key, advanceOnly, ctx){
  const by = new Map((base || []).map(r => [r[key], r]));
  (incoming || []).forEach(r => {
    const prev = by.get(r[key]);
    let win = (!prev || stampNewer(r.upd, prev.upd)) ? r : prev;
    if (advanceOnly && prev && ORDER_RANK[prev.status] > (ORDER_RANK[win.status] || 0)) {
      win = { ...win, status: prev.status };   // one-way law: a stale stamp cannot roll an order backward
    }
    if (prev && bare(win) === bare(prev)) win = prev;                         // no real change -> keep stored copy + its _rev
    else if (ctx) { win = { ...win, _rev: ctx.rev }; ctx.changed = true; }    // a real add/change -> stamp this push's rev
    by.set(r[key], win);
  });
  return [...by.values()];
}
function merge(store, incoming){
  if (!incoming) return store;
  const ctx = { rev: (store.rev || 0) + 1, changed: false };
  store.records   = mergeArr(store.records   || [], incoming.records   || [], 'id', true, ctx);
  store.customers = mergeArr(store.customers || [], incoming.customers || [], 'phone', false, ctx);
  store.seq = Math.max(store.seq || 0, incoming.seq || 0);
  if (ctx.changed) store.rev = ctx.rev;
  return store;
}
// only what changed after revision `since` — what a device pulls each tick instead of the whole DB
function deltaSince(store, since){
  since = +since || 0;
  return { records:   (store.records   || []).filter(r => (r._rev || 0) > since),
           customers: (store.customers || []).filter(c => (c._rev || 0) > since),
           seq: store.seq || 0 };
}

/* B4 — APPEND-ONLY DELTA LOG + CHECKPOINTS. Every changing merge appends one line to a durable log: the
   EXACT delta for the new rev, built with `deltaSince` so the log and the wire can never drift (a device that
   pulls rev N and a replay that rebuilds rev N read the same bytes). A full checkpoint is written every
   CHECKPOINT_EVERY revs so a rebuild need not replay from rev 1. `hub-replay.js` rebuilds any revision from the
   nearest checkpoint + the log, and REFUSES on a hole (naming the missing rev) rather than silently skipping —
   a rebuild that quietly drops a rev is the "error that renders as good news" the reference warns against. */
const DATA_DIR = path.dirname(DATA);
const LOG = path.join(DATA_DIR, 'delta-log.jsonl');
const CHECKPOINT_EVERY = Number(process.env.CHECKPOINT_EVERY || 50);
function ckptPath(rev){ return path.join(DATA_DIR, 'checkpoint-' + rev + '.json'); }
function appendLog(rev, delta){ try{ fs.mkdirSync(DATA_DIR, { recursive:true }); fs.appendFileSync(LOG, JSON.stringify({ rev, ts: Date.now(), delta }) + '\n'); }catch(e){} }
function writeCheckpoint(store){ try{ fs.mkdirSync(DATA_DIR, { recursive:true }); fs.writeFileSync(ckptPath(store.rev || 0), JSON.stringify(store)); }catch(e){} }
/* C1 — SHAPE GUARD at the door. An incoming record can arrive missing a required array (a truncated push, an
   old client, a hand-rolled integration): later `r.lines.map(...)` then throws and a screen dies. Fill it HERE,
   once, on the way in — and NEVER inside the merge, where touching a record that didn't really change would
   restamp it and roll other fields back (the 8/03 mass-restamp class). Repair is the norm; a FLOOD of repairs
   is a different event (a corrupt bulk push), so cap it and refuse the whole push loudly rather than quietly
   "repairing" thousands of records into place. */
const REQUIRED_ARRAYS = { records: ['lines'] };   // a record must carry its line-items array
const SHAPE_REPAIR_CAP = 500;
function shapeGuard(incoming){
  if (!incoming || typeof incoming !== 'object') return incoming;
  let repaired = 0; const notes = [];
  (incoming.records || []).forEach(r => {
    (REQUIRED_ARRAYS.records || []).forEach(f => {
      if (r && !Array.isArray(r[f])) { r[f] = []; repaired++; if (notes.length < 10) notes.push((r.id!=null?r.id:'?')+'.'+f); }
    });
  });
  if (repaired > SHAPE_REPAIR_CAP) throw new Error('shapeGuard: '+repaired+' records missing a required array — refusing a malformed bulk push (cap '+SHAPE_REPAIR_CAP+')');
  if (repaired) console.error('shapeGuard repaired '+repaired+' record(s) at the door: '+notes.join(', ')+(repaired>notes.length?'…':''));
  return incoming;
}

/* C2 — STAMP SANITIZE at the door. A device with a fast clock stamps its edits in the future; because
   `stampNewer` picks the higher stamp, that edit would win against every HONEST later edit until the wall
   clock catches up — a future stamp is a poison pill. Clamp a future stamp to now: the WORK is real, only the
   `when` is a lie, so we keep the edit and correct the clock. The one exception is a future-dated TOMBSTONE —
   a delete stamped ahead of now would outrank a real record and erase it — so a future tombstone is DROPPED,
   not clamped; the source still holds it and re-offers it once the clock is honest. */
const HONEST_SKEW = Number(process.env.CLOCK_SKEW_MS || 5*60*1000) * 1000;   // allowed future skew, hybrid scale
function stampSanitize(incoming, now){
  if (!incoming || typeof incoming !== 'object') return incoming;
  now = now || Date.now() * 1000;                    // hybrid scale (ms*1000), same number line as `upd`
  const limit = now + HONEST_SKEW;
  let clamped = 0, dropped = 0;
  const clean = list => (list || []).filter(r => {
    if (r && stampScale(r.upd) > limit){
      if (r.deleted){ dropped++; return false; }     // a future-dated delete would outrank real work — drop it
      r.upd = now; clamped++;                         // a future real edit: keep the work, correct the clock
    }
    return true;
  });
  incoming.records   = clean(incoming.records);
  incoming.customers = clean(incoming.customers);
  if (clamped || dropped) console.error('stampSanitize: clamped '+clamped+' future stamp(s), dropped '+dropped+' future tombstone(s)');
  return incoming;
}

// merge + record durably. The server calls this; `merge` stays pure so tests can drive it without side effects.
function commit(store, incoming){
  incoming = shapeGuard(incoming);          // repair shape at the door, before the merge ever sees it
  incoming = stampSanitize(incoming);       // clamp future stamps / drop future tombstones, also at the door
  const before = store.rev || 0;
  store = merge(store, incoming);
  const after = store.rev || 0;
  if (after > before){                                   // something actually moved -> log this rev's delta
    appendLog(after, deltaSince(store, before));         // deltaSince(before) == exactly what got rev `after`
    if (after % CHECKPOINT_EVERY === 0) writeCheckpoint(store);
  }
  return store;
}

let DB = load();

function cors(res){ res.setHeader('Access-Control-Allow-Origin', '*'); res.setHeader('Access-Control-Allow-Headers', 'Content-Type'); res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS'); }

const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  cors(res);
  if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }

  if (url === '/api/db' && req.method === 'GET') {
    res.setHeader('Content-Type', 'application/json');
    let since = null; try { since = new URL(req.url, 'http://x').searchParams.get('since'); } catch (e) {}
    if (since !== null && /^\d+$/.test(since)) {                        // delta pull: only what moved since `since`
      return res.end(JSON.stringify({ db: deltaSince(DB, +since), rev: DB.rev || 0, delta: true }));
    }
    return res.end(JSON.stringify({ db: DB, rev: DB.rev || 0 }));       // full pull (a fresh device)
  }
  if (url === '/api/db' && req.method === 'POST') {
    let body = '';
    req.on('data', d => { body += d; if (body.length > 60e6) req.destroy(); });
    req.on('end', () => {
      try { const j = JSON.parse(body || '{}'); DB = commit(DB, j.db); save(DB); } catch (e) {}
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ db: DB, rev: DB.rev || 0 }));
    });
    return;
  }
  if (url === '/api/health') { res.setHeader('Content-Type','application/json'); return res.end(JSON.stringify({ ok:true, rev:DB.rev||0, records:(DB.records||[]).length })); }
  if (url === '/favicon.ico') { res.statusCode = 204; return res.end(); }

  // static files
  let f = path.join(ROOT, decodeURIComponent(url === '/' ? '/builder.html' : url));
  if (!f.startsWith(ROOT)) { res.statusCode = 403; return res.end('forbidden'); }   // no path traversal
  fs.readFile(f, (e, buf) => {
    if (e) { res.statusCode = 404; return res.end('not found'); }
    res.setHeader('Content-Type', TYPES[path.extname(f)] || 'text/plain');
    res.end(buf);
  });
});

if (require.main === module) {
  server.listen(PORT, () => console.log(`customPOS hub on http://localhost:${PORT}  (data: ${DATA})`));
}
module.exports = { server, merge, mergeArr, commit, shapeGuard, stampSanitize, deltaSince, stampNewer, stampScale, hlcNow, LOG, ckptPath, DATA_DIR };
