#!/usr/bin/env node
/* ============================================================================================
   🌐 THE LOCAL SERVER — run: node test-local-server.js

   ⚠️ WHY. The crash reporter caught `/qrcode.js` 404ing on a shell station the night before the counter
   rollout: the asset list is hand-maintained and it had been forgotten. Nobody would have seen that from the
   shop floor — route invoices would simply have stopped carrying a QR code, quietly. A miss is now a CACHE
   MISS (fetch from the hub, keep it, serve it) rather than a dead end.

   ⚠️ The other half of that change is a boundary, and a boundary needs a test that tries to cross it. This
   port serves the shop's app and tunnels an authenticated hub; on-demand fetching must NOT turn it into a
   way to pull arbitrary paths. The refusal cases below matter as much as the success ones.

   It runs a REAL server against a REAL (tiny) hub on a spare port. No mocks of the thing under test.
   ============================================================================================ */
'use strict';
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

/* the override exists for the negative control — pointed at a copy with the pre-fix serveFile, section 2
   fails all four ways, which is what makes the green run evidence rather than sunshine */
const LOCAL = require(process.env.OZARK_SRV ? path.resolve(process.env.OZARK_SRV) : './local-server');

let pass = 0, fail = 0;
function check(what, ok) {
  if (ok) { pass++; console.log('  ✅ ' + what); }
  else { fail++; console.log('  ❌ ' + what); }
}
function fetch(url) {
  return new Promise(resolve => {
    http.get(url, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ code: res.statusCode, body: Buffer.concat(chunks).toString('utf8'),
                                    type: res.headers['content-type'] || '' }));
    }).on('error', e => resolve({ code: 0, body: String(e.message), type: '' }));
  });
}

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ozark-srv-'));
  const served = [];                                   /* what the fake hub was ASKED for */

  /* the fake hub: knows one asset, and nothing else */
  const hub = http.createServer((req, res) => {
    served.push(req.url);
    if (req.url === '/qrcode.js') { res.writeHead(200, { 'Content-Type': 'text/javascript' }); return res.end('window.qrcode=1;'); }
    if (req.url === '/api/health') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end('{"ok":true}'); }
    res.writeHead(404); res.end('nope');
  });
  await new Promise(r => hub.listen(0, '127.0.0.1', r));
  const hubUrl = 'http://127.0.0.1:' + hub.address().port;

  /* one file already cached, so the hit path is exercised too */
  fs.writeFileSync(path.join(dir, 'Ozark-POS.html'), '<html>cached app</html>');

  const log = () => {};
  let srv;
  try { srv = await LOCAL.start({ hubUrl, dir, log }); }
  catch (e) {
    console.log('\n  ⚠ could not bind port ' + LOCAL.APP_PORT + ' — the shell is probably running. Close it and re-run.\n');
    hub.close(); process.exit(2);
  }
  const base = 'http://127.0.0.1:' + LOCAL.APP_PORT;

  console.log('\n1 · a file already on disk is served without asking the hub');
  {
    const r = await fetch(base + '/');
    check('the app comes back', r.code === 200 && r.body.indexOf('cached app') >= 0);
    check('and the hub was never asked for it', served.indexOf('/Ozark-POS.html') < 0);
  }

  console.log('\n2 · THE REGRESSION — a file we do not have is fetched, kept, and served');
  {
    const r = await fetch(base + '/qrcode.js');
    check('it is served rather than 404', r.code === 200 && r.body.indexOf('window.qrcode') >= 0);
    check('...with the right content type', /javascript/.test(r.type));
    check('...and it was written to the cache', fs.existsSync(path.join(dir, 'qrcode.js')));
    const before = served.length;
    const again = await fetch(base + '/qrcode.js');
    check('a second request is served from disk, not fetched twice', again.code === 200 && served.length === before);
  }

  console.log('\n3 · the boundary — this port must not become a way to fetch arbitrary paths');
  {
    const before = served.slice();
    const walk = await fetch(base + '/../../etc/passwd');
    check('a path with .. is refused outright', walk.code === 400 || walk.code === 404);
    const nested = await fetch(base + '/admin/secrets.js');
    check('a nested path is NOT fetched from the hub', nested.code === 404 && served.length === before.length);
    const odd = await fetch(base + '/dump.env');
    check('an extension the app never serves is NOT fetched', odd.code === 404 && served.length === before.length);
    const missing = await fetch(base + '/not-a-real-asset.png');
    check('a plain name the hub does not have answers 404, not a lie', missing.code === 404);
  }

  console.log('\n4 · /api still goes to the hub, untouched');
  {
    const r = await fetch(base + '/api/health');
    check('the health call is proxied', r.code === 200 && r.body.indexOf('"ok":true') >= 0);
  }

  try { srv.close(); } catch (e) {}
  hub.close();
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {}
  console.log('\n══ ' + pass + ' passed, ' + fail + ' failed ══\n');
  process.exit(fail ? 1 : 0);
})();
