/* ============================================================================================
   🏠 PHASE 2 — THE SHELL SERVES THE APP.
   Owner, 2026-08-13: "seems like we are just running a different kind of web browser instead of a standalone
   app that uses open source html software?" He was right. Phase 1 owned the machine; the software still came
   down the wire on every launch, so a station that rebooted during an outage could not start at all.

   Now the app is served from ONE fixed local origin, from a copy on this disk, and /api/* is proxied to the
   hub. Boot with the internet down and the shop works — every station already holds the whole database and
   syncs when the line returns.

   ⚠️ THE PORT IS PART OF THE ORIGIN, AND INDEXEDDB IS PER-ORIGIN. Change this number and every station's
   local database becomes invisible — the POS opens on an EMPTY SHOP, which is the most alarming thing it can
   do. It is a constant. It is not configurable, it is not auto-selected, and if it is busy this server
   REFUSES TO START rather than quietly moving (see listen()). 17817 is above the registered range and below
   Windows' ephemeral range (49152+), so nothing should ever be handed it by accident.
   ============================================================================================ */
'use strict';
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const APP_PORT = 17817;                    /* ⚠️ NEVER CHANGE — see the banner above */
const APP_FILE = 'Ozark-POS.html';
/* ⚠️ the page references these by name; miss one and the offline app renders broken, which reads to staff as
   "it is not working" even though it is. */
const ASSETS = ['ozark-mark.jpg', 'ozark-logo-full.jpg', 'ozark-icon-192.png', 'ozark-icon-512.png',
                'ozark-maskable-512.png', 'manifest.webmanifest',
                'qrcode.js']   /* ⚠️ Ozark-icon.svg and Ozark-logo.svg were removed 2026-08-21: referenced by NOTHING (app, manifest,
                   site, track — zero mentions) and 404 on the hub. The shell's prefetch tolerated the miss, so nobody noticed
                   for weeks; the service worker's all-or-nothing install did not, and two dead entries blocked offline for
                   the whole POS. A list entry nobody uses is not harmless — it is a 404 waiting for a stricter reader. */;
const TYPES = { '.html':'text/html; charset=utf-8', '.js':'text/javascript', '.css':'text/css',
                '.jpg':'image/jpeg', '.png':'image/png', '.svg':'image/svg+xml',
                '.webmanifest':'application/manifest+json', '.ico':'image/x-icon' };

/* ⚠️ A TRUNCATED DOWNLOAD WOULD BRICK A STATION. The app is ~1.5MB and always carries its own title and a
   closing tag, so a partial body is cheap to spot. Nothing is swapped in until it passes. */
function looksLikeTheApp(buf) {
  if (!buf || buf.length < 200000) return false;
  const s = buf.toString('utf8');
  return s.indexOf('<title>Ozark Cleaners POS') > 0 && s.trim().slice(-7).toLowerCase() === '</html>';
}

function get(url, timeoutMs) {
  return new Promise(resolve => {
    let done = false;
    const fin = v => { if (!done) { done = true; resolve(v); } };
    try {
      const lib = url.indexOf('https') === 0 ? https : http;
      const req = lib.get(url, { timeout: timeoutMs || 20000 }, res => {
        if (res.statusCode !== 200) { res.resume(); return fin(null); }
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => fin(Buffer.concat(chunks)));
        res.on('error', () => fin(null));
      });
      req.on('timeout', () => { req.destroy(); fin(null); });
      req.on('error', () => fin(null));
    } catch (e) { fin(null); }
  });
}

/* ⚠️ ALL-OR-NOTHING, with ONE ROLLBACK SLOT. Write beside the live copy, keep the outgoing one as .prev,
   then rename. This is writeAtomic and the manifest-last commit marker from the hub, applied to the app
   itself: at no instant is there a half-written app on disk for the shell to load. */
function swapIn(dir, name, buf) {
  const live = path.join(dir, name), tmp = live + '.new', prev = live + '.prev';
  fs.writeFileSync(tmp, buf);
  try {
    if (fs.existsSync(live)) fs.copyFileSync(live, prev);
    /* ⚠️ SEED THE ROLLBACK SLOT ON THE **FIRST** DOWNLOAD TOO. Testing caught this: .prev was only
       written when replacing an existing copy, so a station that had downloaded exactly once had NOTHING to
       fall back to — the case most likely to happen, because it is the state every new station is in. A
       rollback slot that only appears after the second success is not a rollback slot. */
    else fs.writeFileSync(prev, buf);
  } catch (e) {}
  fs.renameSync(tmp, live);
}

async function refreshCache(hubUrl, dir, log) {
  fs.mkdirSync(dir, { recursive: true });
  const base = String(hubUrl).replace(/\/+$/, '');
  const html = await get(base + '/' + APP_FILE);
  if (!html) { log('app cache: hub unreachable — keeping the copy already on disk'); return false; }
  if (!looksLikeTheApp(html)) { log('⚠️ app cache: the hub sent something that is not the app (' + html.length + ' bytes) — REFUSED, keeping the copy on disk'); return false; }

  const livePath = path.join(dir, APP_FILE);
  let same = false;
  try { same = fs.existsSync(livePath) && fs.readFileSync(livePath).equals(html); } catch (e) {}
  if (!same) { swapIn(dir, APP_FILE, html); log('app cache: updated (' + Math.round(html.length / 1024) + ' KB)'); }

  for (const a of ASSETS) {
    try {
      if (fs.existsSync(path.join(dir, a))) continue;      /* assets are static; fetch once */
      const b = await get(base + '/' + a, 15000);
      if (b && b.length) { fs.writeFileSync(path.join(dir, a), b); }
    } catch (e) {}
  }
  return !same;
}

/* ⚠️ THE PROXY SITS IN THE MONEY PATH — card charges pass through here. The rule, learned the hard way on
   logSmsOut the same day: AN UNCLEAR ANSWER MUST NEVER BE REPORTED AS SUCCESS. Every failure below answers
   502 with an explicit error, never a 200 with an empty body, because the app treats a 200 as the hub having
   spoken. And the timeout is deliberately LONGER than anything the hub takes, or this would invent failures
   the hub never had. */
const PROXY_TIMEOUT_MS = 60000;

const KEEPALIVE_HTTPS = new https.Agent({ keepAlive: true, keepAliveMsecs: 15000, maxSockets: 8 });
const KEEPALIVE_HTTP  = new http.Agent({ keepAlive: true, keepAliveMsecs: 15000, maxSockets: 8 });
function proxy(req, res, hubUrl, log) {
  let target;
  try { target = new URL(req.url, hubUrl); } catch (e) { return fail(res, 'bad url'); }
  const lib = target.protocol === 'https:' ? https : http;
  const headers = Object.assign({}, req.headers);
  /* ⚠️ DO NOT STRIP accept-encoding. Deleting it forced the hub to answer this station UNCOMPRESSED, and it
     is the reason the desktop app felt slower than Chrome — measured against the live hub on 2026-08-19:
         /api/db   with gzip  427 KB      without gzip  5,018 KB   (11.7x)
         the app   with gzip  555 KB      without gzip  1,635 KB
     Every sync pulled megabytes instead of hundreds of kilobytes. On a shop network that is the sluggishness
     the counter reported, it is why pushes stopped coming back inside 60s ("Sync unstuck" three times in one
     morning), and it starved the very HTTP server the station watchdog probes — so the watchdog decided the
     shell was hung and killed it WITH SOMEBODY MID-EDIT, which reads as a freeze.
     ⚠️ It is safe to pass through because this proxy never READS the body — it pipes upstream straight to the
     renderer and forwards every response header, content-encoding included, so Chromium decompresses it
     exactly as it does in the browser. Anything that starts inspecting a proxied body must decompress first. */
  delete headers.host; delete headers.connection;

  /* ⚠️ KEEP THE CONNECTION WARM. The app polls the hub every four seconds; without an agent Node opens a
     fresh TLS connection for each one, so the station pays a full handshake several times a minute and a
     flaky shop network gets many more chances to fail mid-negotiation. One pooled agent per protocol. */
  const up = lib.request({
    protocol: target.protocol, hostname: target.hostname,
    port: target.port || (target.protocol === 'https:' ? 443 : 80),
    path: target.pathname + target.search, method: req.method, headers, timeout: PROXY_TIMEOUT_MS,
    agent: (target.protocol === 'https:' ? KEEPALIVE_HTTPS : KEEPALIVE_HTTP)
  }, ur => {
    res.writeHead(ur.statusCode || 502, ur.headers);
    ur.pipe(res);
    ur.on('error', () => { try { res.destroy(); } catch (e) {} });
  });
  up.on('timeout', () => { up.destroy(); fail(res, 'the hub did not answer in ' + (PROXY_TIMEOUT_MS / 1000) + 's'); });
  up.on('error', e => fail(res, (e && e.message) || 'hub unreachable'));
  req.pipe(up);
  req.on('error', () => { try { up.destroy(); } catch (e) {} });
}
function fail(res, why) {
  if (res.headersSent || res.writableEnded) return;
  try {
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'shell: ' + why }));
  } catch (e) {}
}

function sendFile(res, file, d) {
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
                       'Cache-Control': 'no-store' });
  res.end(d);
}

/* ⚠️ A HAND-MAINTAINED LIST OF ASSETS IS A LIST SOMEBODY WILL FORGET TO UPDATE — and this one already had
   been. The crash reporter caught it the night before the counter rollout: `/qrcode.js` was 404ing on this
   station every time a screen wanted a QR code, because it was never in ASSETS. Nobody would have seen it
   from the shop floor; route invoices would simply have stopped carrying a QR, quietly.
   ⚠️ So a MISS IS NOT AN ERROR, IT IS A CACHE MISS: fetch it from the hub, keep it, serve it. The next new
   asset the app grows will never need this file edited at all. ASSETS stays as the PREFETCH list, because a
   station must come up complete with no internet — on-demand is the safety net, not the plan.
   ⚠️ Deliberately NOT a general proxy: one plain filename, no directories, no `..`, and only extensions the
   app actually serves. This port is the shop's app and an authenticated hub tunnel; it does not become a way
   to fetch arbitrary paths. */
function serveFile(res, dir, name, hubUrl, log) {
  const file = path.join(dir, name);
  fs.readFile(file, (e, d) => {
    if (!e) return sendFile(res, file, d);
    const plain = /^[A-Za-z0-9._-]+$/.test(name) && TYPES[path.extname(name).toLowerCase()];
    /* the boundary stays exactly where it was: one plain filename, no directories, no '..', and only
       extensions the app serves. Anything else is refused before we look anywhere. */
    if (!plain) { res.writeHead(404); res.end('not cached'); return; }
    /* 🌱 ...and if the hub cannot answer either, the installer may have shipped a copy. Belt and braces:
       ensureServable already lays the seed's assets down at boot, but a file the app grows LATER — the
       /qrcode.js class of miss — would otherwise 404 forever on a station that is offline. */
    const fromSeed = () => {
      try {
        const sd = seedDir();
        const s = sd ? path.join(sd, name) : '';
        if (s && fs.existsSync(s)) {
          const b = fs.readFileSync(s);
          try { fs.writeFileSync(file, b); } catch (err) {}
          log('served ' + name + ' from the copy bundled with this installer (the hub could not be reached)');
          return sendFile(res, file, b);
        }
      } catch (err) {}
      res.writeHead(404); res.end('not cached');
    };
    if (!hubUrl) return fromSeed();
    get(String(hubUrl).replace(/\/+$/, '') + '/' + name, 15000).then(buf => {
      if (!buf || !buf.length) return fromSeed();
      try { fs.writeFileSync(file, buf); log('cached a file the app asked for and we did not have: ' + name + ' (' + Math.round(buf.length / 1024) + ' KB)'); } catch (err) {}
      sendFile(res, file, buf);
    }).catch(fromSeed);
  });
}

/* ⚠️ VALIDATE WHAT IS ON DISK BEFORE SERVING IT, not only what was downloaded.
   Testing Phase 2 caught this: refreshCache checks the download, but if the hub is unreachable AND the
   cached file is damaged — a power cut mid-write, a bad sector, a half-finished copy — the shell would
   happily serve the wreckage and the station would show a broken page with no explanation. The .prev slot
   existed and nothing ever used it. That is the whole reason the scope said to prove this case. */
/* 🌱 THE SPARE TYRE — the copy of the app that ships INSIDE the installer (see make-seed.js).
   ⚠️ It is the LAST resort, never a preference. Order is always: this station's cache → its .prev rollback
   slot → the seed. `refreshCache` still runs at boot and every ten minutes and the hub's copy always wins,
   so CLAUDE.md's rule that the shell loads the live app FROM THE HUB is intact. A seed is not the app.
   ⚠️ Resolved two ways on purpose: packaged (`process.resourcesPath/seed`) and from a dev checkout
   (`desktop/seed`). Hard-coding either gives a shell that works in development and silently has no spare in
   production — the exact shape of fault the print-agent path already had to learn. */
function seedDir() {
  /* ⚠️ A TEST HATCH, and it needs TWO switches on purpose — the same rule the smoke test's config override
     follows. Where the app comes from is not a setting: one stray environment variable must never be able to
     point a till at somebody else's copy of the POS. Both must be set, and `looksLikeTheApp` still judges
     whatever is found, so even here the worst case is a refusal rather than a bad app. */
  if (String(process.env.OZARK_SMOKE || '') === '1' && String(process.env.OZARK_SEED_DIR || '').trim()) {
    const t = process.env.OZARK_SEED_DIR.trim();
    try { return fs.existsSync(path.join(t, APP_FILE)) ? t : ''; } catch (e) { return ''; }
  }
  const tries = [ path.join(process.resourcesPath || '', 'seed'), path.join(__dirname, 'seed') ];
  for (const d of tries) { try { if (d && fs.existsSync(path.join(d, APP_FILE))) return d; } catch (e) {} }
  return '';
}

/* copy the seed in — the APP AND ITS ASSETS.
   ⚠️ Assets are not optional here. Copying only the HTML would leave a station whose logo, icons and
   /qrcode.js all 404 against a hub that is down, and a broken-looking app reads to staff as "it is not
   working" even though the shop could have kept running. */
function seedInto(dir, log) {
  const src = seedDir();
  if (!src) return false;
  let html;
  try { html = fs.readFileSync(path.join(src, APP_FILE)); } catch (e) { return false; }
  /* the same check the download path uses — a seed gets no more trust than the hub does */
  if (!looksLikeTheApp(html)) { log('⚠ the app bundled with this installer is damaged — ignoring it'); return false; }
  try { fs.mkdirSync(dir, { recursive: true }); swapIn(dir, APP_FILE, html); } catch (e) { return false; }
  let n = 0;
  for (const a of ASSETS) {
    try {
      if (fs.existsSync(path.join(dir, a))) continue;
      if (!fs.existsSync(path.join(src, a))) continue;
      fs.copyFileSync(path.join(src, a), path.join(dir, a)); n++;
    } catch (e) {}
  }
  /* ⚠️ SAY HOW OLD IT IS, not just that it happened. A stale build that looks current is the most expensive
     failure in this project's history — Hot Springs ran five days behind and nothing said so. */
  let age = '';
  try {
    const i = JSON.parse(fs.readFileSync(path.join(src, 'SEED-INFO.json'), 'utf8'));
    age = ' (build ' + i.appRev + ', packed ' + String(i.builtAt).slice(0, 10) + ')';
  } catch (e) {}
  log('🌱 started from the app bundled with this installer' + age + ', plus ' + n + ' asset(s). '
      + 'This station is WORKING but may be behind — it updates itself as soon as the hub is reachable.');
  return true;
}

function ensureServable(dir, log) {
  const live = path.join(dir, APP_FILE), prev = live + '.prev';
  let ok = false, had = false;
  try { had = fs.existsSync(live); } catch (e) {}
  try { ok = looksLikeTheApp(fs.readFileSync(live)); } catch (e) { ok = false; }
  if (ok) return true;
  /* ⚠️ "damaged" and "not there yet" are different events and the old wording said damaged for both — which
     is alarming and wrong on the one occasion it matters most, a fresh install during an outage. */
  if (had) {
    log('⚠ the cached app is damaged — trying the previous copy');
    try {
      if (fs.existsSync(prev) && looksLikeTheApp(fs.readFileSync(prev))) {
        fs.copyFileSync(prev, live);
        log('reverted to the previous copy of the app');
        return true;
      }
    } catch (e) {}
  }
  if (seedInto(dir, log)) return true;
  log('⚠ no usable copy of the app on disk' + (seedDir() ? '' : ' and no seed shipped with this build'));
  return false;
}

function start(opts) {
  const { hubUrl, dir, log } = opts;
  return new Promise((resolve, reject) => {
    const srv = http.createServer((req, res) => {
      const u = (req.url || '/').split('?')[0];
      if (u.indexOf('/api/') === 0) return proxy(req, res, hubUrl, log);
      const name = (u === '/' || u === '') ? APP_FILE : decodeURIComponent(u).replace(/^\/+/, '');
      if (name.indexOf('..') >= 0) { res.writeHead(400); res.end('no'); return; }
      serveFile(res, dir, name, hubUrl, log);
    });
    /* ⚠️ 127.0.0.1 ONLY. This serves the shop's app and proxies an authenticated hub; it must never be
       reachable from the network. */
    srv.on('error', e => reject(e));
    srv.listen(APP_PORT, '127.0.0.1', () => { log('serving the app on http://127.0.0.1:' + APP_PORT); resolve(srv); });
  });
}

module.exports = { start, refreshCache, ensureServable, looksLikeTheApp, seedDir, seedInto,
                   APP_PORT, APP_FILE, ASSETS };
