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
      try { const j = JSON.parse(body || '{}'); DB = merge(DB, j.db); save(DB); } catch (e) {}
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
module.exports = { server, merge, mergeArr, deltaSince, stampNewer, stampScale, hlcNow };
