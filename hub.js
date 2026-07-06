#!/usr/bin/env node
/*
  customPOS — the hub (optional multi-device sync server)
  ======================================================
  Zero-dependency Node server. Two jobs:
    1. Serve the app files (pos.html, builder.html, …) over http.
    2. /api/db — the shared data. Devices PUSH their DB and PULL the merged one, so several
       computers/phones (each a different station) share one live POS.

  Merge is by record id (a union — new records added, existing ones updated), seq = max, and
  customers by phone. Data persists to a JSON file so it survives a restart.

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

// union merge: incoming records upsert by id; seq = max; customers upsert by phone
function merge(store, incoming){
  if (!incoming) return store;
  store.records = store.records || []; store.customers = store.customers || [];
  const byId = new Map(store.records.map(r => [r.id, r]));
  (incoming.records || []).forEach(r => byId.set(r.id, r));
  store.records = [...byId.values()];
  const byPhone = new Map(store.customers.map(c => [c.phone, c]));
  (incoming.customers || []).forEach(c => byPhone.set(c.phone, c));
  store.customers = [...byPhone.values()];
  store.seq = Math.max(store.seq || 0, incoming.seq || 0);
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
    return res.end(JSON.stringify({ db: DB }));
  }
  if (url === '/api/db' && req.method === 'POST') {
    let body = '';
    req.on('data', d => { body += d; if (body.length > 60e6) req.destroy(); });
    req.on('end', () => {
      try { const j = JSON.parse(body || '{}'); DB = merge(DB, j.db); save(DB); } catch (e) {}
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ db: DB }));
    });
    return;
  }
  if (url === '/api/health') { res.setHeader('Content-Type','application/json'); return res.end(JSON.stringify({ ok:true, records:(DB.records||[]).length })); }
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
module.exports = { server, merge };
