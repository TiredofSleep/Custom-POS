#!/usr/bin/env node
/* @facts @hub — THE FACTS HUB ON THE WIRE: enrol a device, take its facts, hand out what is new, say it is alive. Nothing else.
   This repo's own file (not imported). The origin shop's hub server is ~134 KB with its cards, texts and e-mail behind it; that is
   shop code and is not brought here (docs/V2-MODULAR-IMPORT.md, Stage 1). Everything that makes the engine safe lives in
   facts/hub/hub.js, which this only puts on HTTP:
     · a device writes only as itself: its token (shown once at enrolment, only its SHA-256 kept) must be enrolled as that station;
     · each fact is admitted once, checked against its hash, its registered type and its validator, then ordered;
     · the hub answers only after its SQLite store has the write (durable before it speaks), and a second hub on the same database
       will not start (the store holds an exclusive lock).
   Routes:
     GET  /v2/health          alive, epoch, head — no secrets
     POST /v2/receive         a device proposes its own facts          body { station, token, events }
     POST /v2/pull            a device learns what came after its cursor  body { token, cursor, epoch, limit }
     POST /v2/pin             a person's PIN, checked by the hub → a short pass   body { token, staffId, pin }   (Stage 2: only with a staff module)
     POST /v2/admin/enroll    the OPERATOR enrols a device             header x-custompos-admin; body { station, by }
     POST /v2/admin/revoke    the OPERATOR ends a device's access      header x-custompos-admin; body { station }
     GET  /v2/admin/watch     who is behind, refusing or revoked       header x-custompos-admin
   Tokens ride in the body, never the URL. Every refusal is a JSON answer that says why: malformed 400, a sender with no key and a
   body over 64 KB 401, no or wrong operator key 403, no such route 404, too large 413.
   It listens on 127.0.0.1 by default; put a TLS proxy in front for anything beyond this machine (docs/HUB-SYNC.md).
   usage:  CUSTOMPOS_ADMIN_KEY=<long random> node facts/server.js --db hub-data/facts.db [--port 8790] [--host 127.0.0.1]
   Needs Node 22 or newer (node:sqlite). */
'use strict';
const http = require('http');
const crypto = require('crypto');
const { makeHub } = require('./hub/hub');
const { openSqliteStore } = require('./hub/sqlite-store');
const path = require('path');
const { assemble } = require('./modules/define');
const { grantsFor } = require('./modules/pingrant');
require('./aggregates/timeclock');   /* the fact types this hub knows; in Stage 2 each module registers its own */

const MAX_BODY = 8 * 1024 * 1024;   /* a whole receive of 1000 facts fits many times over */
const PREAUTH_MAX = 64 * 1024;      /* what a sender the hub cannot name may send before it is cut off */
const PREAUTH_MS = 15000;           /* and how long it has to send it */
const MAX_CONN = 256;               /* connections at once (a small shop has a handful of tablets) */

/* @facts @hub — the operator key check: SHA-256 both sides, compared in constant time */
function sameKey(given, key) { const a = crypto.createHash('sha256').update(String(given || '')).digest(), b = crypto.createHash('sha256').update(String(key)).digest(); return crypto.timingSafeEqual(a, b); }
/* @facts @hub — one JSON answer, never cached */
function send(res, code, body) { const s = JSON.stringify(body); res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Length': Buffer.byteLength(s) }); res.end(s); }
/* @facts @hub — a refusal that also ENDS the connection: a refused sender is cut off, never left streaming a body for a minute
   (pre-push review: after a 401 the old answer kept reading — gigabytes in seconds from one client) */
function refuse(req, res, code, body) {
  if (res.headersSent) { req.socket.destroy(); return; }
  res.setHeader('Connection', 'close'); send(res, code, body);
  res.on('finish', function () { try { req.socket.end(); } catch (e) {} setTimeout(function () { try { req.socket.destroy(); } catch (e) {} }, 1000).unref(); });
}

/* @facts @hub — start a hub on a database file: resolves {url, port, hub, store, server, close}; rejects when another hub holds the file */
function startHubServer(opts) {
  opts = opts || {};
  const adminKey = opts.adminKey || process.env.CUSTOMPOS_ADMIN_KEY || '';
  if (String(adminKey).length < 16) return Promise.reject(new Error('the hub needs an operator key of 16+ characters (CUSTOMPOS_ADMIN_KEY) — without one, nobody could enrol a device'));
  let store = null;
  try { store = opts.store || (opts.db ? openSqliteStore(opts.db) : null); } catch (e) { return Promise.reject(e); }
  /* Stage 2: the modules this hub runs (opts.modules, each from defineModule). With them, ONE judge decides who may write what, and the
     hub checks PINs itself for the facts that need it (facts/modules/define.js, pingrant.js). Without them, it admits any registered type. */
  const mods = opts.modules || [];
  let grants = null, A = null;
  try {
    if (mods.length) { grants = grantsFor({ secret: opts.grantSecret, dataDir: opts.dataDir || (opts.db ? path.dirname(path.resolve(opts.db)) : null), now: opts.now }); A = assemble(mods, { grantCheck: grants.check }); }
  } catch (e) { if (store && !opts.store) store.close(); return Promise.reject(e); }
  const staffSource = mods.filter(function (m) { return typeof m.provides.staff === 'function'; })[0] || null;
  const hub = makeHub({ persist: store, authority: A ? A.judge : null, notify: opts.notify || function (a) { console.error('[hub alert] ' + (a && (a.kind || a.type) || '') + ' ' + JSON.stringify(a).slice(0, 300)); }, now: opts.now });
  const operator = function (req) { return sameKey(req.headers['x-custompos-admin'], adminKey); };

  /* @facts @hub — the body as JSON, with the front door's limits: a sender with no known key (device token or operator key) gets 64 KB */
  function readJson(req, res, then) {
    const known = operator(req) || !!hub.allowedDevice(String(req.headers['x-custompos-token'] || ''));
    const cap = known ? MAX_BODY : PREAUTH_MAX;
    if (!known) req.setTimeout(PREAUTH_MS, function () { req.destroy(); });   /* a sender the hub cannot name gets 15 s for its whole body */
    let size = 0, over = false; const parts = [];
    req.on('data', function (c) { if (over) return; size += c.length; if (size > cap) { over = true; refuse(req, res, known ? 413 : 401, { refused: known ? 'the body is too large' : 'too large from a sender with no key' }); return; } parts.push(c); });
    req.on('end', function () {
      if (over) return;
      let j; try { j = JSON.parse(Buffer.concat(parts).toString('utf8') || 'null'); } catch (e) { send(res, 400, { refused: 'malformed JSON' }); return; }
      if (!j || typeof j !== 'object' || Array.isArray(j)) { send(res, 400, { refused: 'a request is one JSON object' }); return; }
      then(j);
    });
  }

  const server = http.createServer(function (req, res) {
    const url = String(req.url || '').split('?')[0];
    /* CORS (Unit 2.4): a downloaded POS page is opened from a file or another host and talks to this hub across origins. Any origin may
       ask, because no door here trusts the browser's ambient credentials: there are no cookies, and every door needs a device token
       or the operator key in the request itself. A browser's pre-check (OPTIONS) is answered here and says which headers may come. */
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (req.method === 'OPTIONS') { res.writeHead(204, { 'Access-Control-Allow-Methods': 'GET, POST', 'Access-Control-Allow-Headers': 'content-type, accept, x-custompos-token, x-custompos-admin', 'Access-Control-Max-Age': '600', 'Content-Length': '0' }); res.end(); return; }
    try {
      if (req.method === 'GET' && url === '/v2/health') {
        /* a store that refuses writes is NOT healthy: one retry, then 503, so a monitor or a proxy's health check sees a full disk
           (pre-push review). The error's own words (they may name a path) stay on the operator's watch. */
        let bad = !!(hub.persistError || hub.storeUnreadable);
        if (bad && typeof hub.retrySave === 'function') { try { hub.retrySave(); } catch (e) {} bad = !!(hub.persistError || hub.storeUnreadable); }
        send(res, bad ? 503 : 200, { ok: !bad, epoch: hub.epoch, head: hub.head, store: bad ? 'refusing writes' : 'ok' }); return;
      }
      if (req.method === 'GET' && url === '/v2/admin/watch') { if (!operator(req)) { refuse(req, res, 403, { refused: 'the operator key is needed' }); return; } send(res, 200, hub.watch()); return; }
      if (req.method !== 'POST' || ['/v2/receive', '/v2/pull', '/v2/pin', '/v2/admin/enroll', '/v2/admin/revoke'].indexOf(url) < 0) { refuse(req, res, 404, { refused: 'no such route' }); return; }
      if (url.indexOf('/v2/admin/') === 0 && !operator(req)) { refuse(req, res, 403, { refused: 'the operator key is needed' }); return; }
      readJson(req, res, function (j) {
        try {
          if (url === '/v2/receive') { send(res, 200, hub.receive(j)); return; }
          /* the pull carries `at` (the fact the tablet holds at its cursor — how a hub restored from an older copy is caught and takes a
             new identity) and `info` (the tablet's clock, build and scope, for the watch); both go to the hub (pre-push review: dropped) */
          if (url === '/v2/pull') { send(res, 200, hub.pull(j.token, j.cursor, j.epoch, j.limit, typeof j.at === 'string' ? j.at : undefined, (j.info && typeof j.info === 'object' && !Array.isArray(j.info)) ? j.info : undefined)); return; }
          if (url === '/v2/pin') {   /* a person's PIN, checked by the hub: a pass for that person on this tablet (facts/modules/pingrant.js) */
            const dev = hub.allowedDevice(String(j.token || ''));
            if (!dev) { refuse(req, res, 401, { refused: 'not enrolled' }); return; }
            if (!grants || !staffSource) { send(res, 404, { refused: 'this hub checks no PINs (it runs no staff module)' }); return; }
            send(res, 200, grants.issue(staffSource.provides.staff(hub.facts(), []), j.staffId, dev.station, j.pin)); return;
          }
          if (url === '/v2/admin/enroll') {
            let t = null; try { t = hub.enroll(j.station, { by: String(j.by || 'operator').slice(0, 120) }); } catch (e) { send(res, 400, { refused: String(e.message) }); return; }
            if (!t) { send(res, 503, { refused: 'the hub could not make the enrolment durable — retry' }); return; }
            send(res, 200, { ok: true, station: j.station, token: t }); return;
          }
          /* a revoke the store could not keep is said plainly: the lost tablet still has access (pre-push review: it answered ok) */
          const n = hub.revoke(j.station);
          if (!n && hub.enrolled(j.station)) { send(res, 503, { refused: 'the hub could not make the revoke durable — retry; that device still has access' }); return; }
          send(res, 200, { ok: true, revoked: n });
        } catch (e) { send(res, 500, { refused: 'the hub could not answer: ' + String(e && e.message || e).slice(0, 200) }); }
      });
    } catch (e) { send(res, 500, { refused: 'the hub could not answer' }); }
  });
  /* the doors' limits (pre-push review: 3,000 half-sent requests held ~245 MB): at most MAX_CONN connections, 10 s for the headers */
  server.maxConnections = opts.maxConnections || MAX_CONN;
  server.headersTimeout = 10000;
  server.requestTimeout = 60000;
  return new Promise(function (resolve, reject) {
    server.once('error', function (e) { if (store && !opts.store) store.close(); reject(e); });
    server.listen(opts.port || 0, opts.host || '127.0.0.1', function () {
      const host = opts.host || '127.0.0.1', port = server.address().port;
      resolve({ url: 'http://' + host + ':' + port, port: port, hub: hub, store: store, server: server,
        close: function () { return new Promise(function (ok) { server.close(function () { if (store && !opts.store) store.close(); ok(); }); if (typeof server.closeAllConnections === 'function') server.closeAllConnections(); }); } });
    });
  });
}

module.exports = { startHubServer: startHubServer, MAX_BODY: MAX_BODY, PREAUTH_MAX: PREAUTH_MAX };

if (require.main === module) {
  const a = process.argv.slice(2), opt = function (n, d) { const i = a.indexOf(n); return i >= 0 ? a[i + 1] : d; };
  const db = opt('--db', null), port = opt('--port', '8790'), host = opt('--host', '127.0.0.1');
  const usage = function (why) { console.error((why ? why + '\n' : '') + 'usage: CUSTOMPOS_ADMIN_KEY=<long random> node facts/server.js --db <file> [--port 8790] [--host 127.0.0.1]'); process.exit(2); };
  if (!db || db[0] === '-') usage('--db needs a file');
  if (!/^\d{1,5}$/.test(String(port)) || +port < 1 || +port > 65535) usage('--port needs a number from 1 to 65535');   /* never a random port a proxy cannot find */
  if (!host || host[0] === '-') usage('--host needs an address');
  startHubServer({ db: db, port: +port, host: host })
    .then(function (s) { console.log('facts hub on ' + s.url + ' · epoch ' + s.hub.epoch + ' · head ' + s.hub.head); })
    .catch(function (e) { console.error('the hub did not start: ' + e.message); process.exit(1); });
}
