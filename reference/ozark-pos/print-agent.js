/* ============================================================================
   🖨  OZARK PRINT AGENT  —  runs on ANY station that auto-prints (assembly PC,
   Arkadelphia counter, Hot Springs counter)  (DEAD SIMPLE)
   ----------------------------------------------------------------------------
   A web page in Chrome can't silently choose a printer. This tiny local helper
   can. The POS sends each order's invoice text + which store it's for, and the
   agent prints it to that store's printer — plain and fast, no clicks — with a
   REAL scannable Code 128 barcode and the rack location LARGE at the bottom.

   Per-station config: print-agent.config.json
     plant (two printers):   {"printers":{"1":"EPSON Ark","2":"EPSON HS"}}
     counter (one printer):  {"printers":{"default":"EPSON TM-T88V Receipt"}}
   Any storeId with no exact entry uses "default"; if there's exactly ONE
   configured printer, everything routes there (a counter never errors on a
   cross-store order).

   Hardened (v4): /health reports the VERSION so the POS can flag a stale
   agent · /test prints a self-test ticket with a real barcode · the agent
   watches its own two files (this one + print-text.ps1) and RESTARTS ITSELF
   when OneDrive/git delivers an update, so stations can't drift again (the
   Startup keep-alive loop respawns it).  THE runbook: PRINT-AGENT-RUNBOOK.md.
   ============================================================================ */
const http = require('http');
const fs   = require('fs');
const os   = require('os');
const path = require('path');
const cp   = require('child_process');

const AGENT_VERSION = 6;   // bump when print-agent.js / print-text.ps1 change behavior — the POS warns on old versions (v5 = QR on route invoices; v6 = updates itself from the hub)

let CFG = { port: 8091, printers: {} };
  /* ⚠️ A PER-STATION FILE MUST NOT LIVE IN A SYNCED FOLDER. print-agent.config.json holds THIS PC's printer
     names, but it sat in the OneDrive folder and was tracked in git — so any sync or pull could put one
     station's names (or the untouched template) onto another machine. That is how the Arkadelphia plant PC
     ended up asking Windows to print to a printer literally named "REPLACE WITH THE ARKADELPHIA PRINTER
     NAME": the shipped TEMPLATE is what the folder carries, and the folder wins whenever it syncs.
     So the LOCAL copy is now authoritative and OneDrive cannot reach it:
         %LOCALAPPDATA%\OzarkPrintAgent\print-agent.config.json      (Windows)
         ~/.ozark-print-agent/print-agent.config.json                (anything else)
     The synced file is still read as a FALLBACK, so nothing breaks on a station that has not been migrated —
     and when that happens the agent says so and offers the one command that fixes it for good. */
/* 2026-08-21: the local config was MISSING from the real disk while every tool said it was there. Cause: a
   Claude session launched from the Claude desktop app (an MSIX package) runs inside an app container, and
   everything it writes under AppDataLocal lands in PackagesClaude_*LocalCacheLocal instead. The 8/14
   'sync-proof local config' only ever existed in that overlay; the shell never needed it (it passes printer
   names itself), and the standalone agent fell through to the synced TEMPLATE the moment Chrome was back.
   The candidates below did NOT fix that (the environment was fine) and are kept only because they cost
   nothing; the fix was writing the file via a Scheduled Task, which runs outside the container. The
   STARTLOG below is what found it -- it names the path and whether the file was there, from the agent's own
   point of view. Keep it. */
function localCfgCandidates() {
  const c = [];
  if (process.env.LOCALAPPDATA) c.push(path.join(process.env.LOCALAPPDATA, 'OzarkPrintAgent'));
  try { c.push(path.join(os.homedir(), 'AppData', 'Local', 'OzarkPrintAgent')); } catch (e) {}
  try { const u = os.userInfo().username; if (u) c.push(path.join('C:', 'Users', u, 'AppData', 'Local', 'OzarkPrintAgent')); } catch (e) {}
  try { c.push(path.join(os.homedir(), '.ozark-print-agent')); } catch (e) {}
  return c;
}
const LOCALCFGDIR = (function () {
  /* a test hatch with TWO switches, like OZARK_AGENT_TEST_HUB and the shell's OZARK_CONFIG_DIR: where the
     config lives is never a setting. ⚠️ It exists because the candidates scan below prefers ANY existing
     file — including the REAL machine's C:\Users\<user>\AppData\Local\OzarkPrintAgent — which defeated the
     harness's LOCALAPPDATA override on any PC with a real local config (found 2026-08-28 on the Assembly
     PC: the test child loaded the plant's real config, bound the plant's real port, and rememberHub would
     have WRITTEN a throwaway test-hub URL into the plant's real printer config). */
  if (process.env.OZARK_SMOKE === '1' && process.env.OZARK_AGENT_LOCALCFG_DIR) return process.env.OZARK_AGENT_LOCALCFG_DIR;
  const cands = localCfgCandidates();
  for (const d of cands) { try { if (fs.existsSync(path.join(d, 'print-agent.config.json'))) return d; } catch (e) {} }
  return cands[0] || path.join(os.homedir(), '.ozark-print-agent');
})();
const LOCALCFG  = path.join(LOCALCFGDIR, 'print-agent.config.json');
/* startup record: WHICH config the agent loaded and why, written where a hidden console cannot hide it. */
const STARTLOG = path.join(os.tmpdir(), 'ozark-print-agent-start.log');
function startLog(obj) { try { fs.appendFileSync(STARTLOG, new Date().toISOString() + ' ' + JSON.stringify(obj) + String.fromCharCode(10)); } catch (e) {} }
startLog({ pid: process.pid, cwd: process.cwd(), dirname: __dirname, LOCALAPPDATA: process.env.LOCALAPPDATA || null, USERPROFILE: process.env.USERPROFILE || null, homedir: (function(){ try { return os.homedir(); } catch (e) { return 'ERR ' + e.message; } })(), user: (function(){ try { return os.userInfo().username; } catch (e) { return 'ERR ' + e.message; } })(), candidates: localCfgCandidates(), chosen: LOCALCFGDIR, localExists: fs.existsSync(LOCALCFG) });
const SYNCEDCFG = path.join(__dirname, 'print-agent.config.json');
let CFGFROM = '';
try {
  if (fs.existsSync(LOCALCFG)) {
    Object.assign(CFG, JSON.parse(fs.readFileSync(LOCALCFG, 'utf8')));
    CFGFROM = LOCALCFG;
    console.log('Loaded printer config from ' + LOCALCFG + '  (local to this PC — sync cannot touch it)');
  } else {
    Object.assign(CFG, JSON.parse(fs.readFileSync(SYNCEDCFG, 'utf8')));
    CFGFROM = SYNCEDCFG;
    console.log('Loaded print-agent.config.json from the synced folder.');
    console.log('   ⚠ That file is SHARED — a OneDrive sync or git pull can overwrite this PC\'s printer names.');
    console.log('   To make this PC\'s settings permanent, copy it somewhere only this PC can see:');
    console.log('       mkdir "' + LOCALCFGDIR + '"');
    console.log('       copy "' + SYNCEDCFG + '" "' + LOCALCFG + '"');
    console.log('   then edit that copy. The agent prefers it automatically from the next restart.');
  }
} catch (e) {
  console.log('⚠ No printer config found — create one with your printer name(s) (see PRINT-AGENT-RUNBOOK.md).');
  console.log('   Preferred location (safe from sync): ' + LOCALCFG);
}
/* ⚠️ SAY IT AT STARTUP. The plant PC ran for weeks with the Arkadelphia line still reading "REPLACE WITH THE
   ARKADELPHIA PRINTER NAME" — every store-1 ticket failed and the only person who could tell was whoever
   was standing at the printer. A half-finished setup has to announce itself. */
setTimeout(function(){
  const ph = cfgPlaceholders();
  if (ph.length) {
    console.log('');
    console.log('⚠⚠  print-agent.config.json IS NOT FINISHED — these are still template text, not printer names:');
    ph.forEach(p => console.log('      ' + p));
    console.log('    Jobs for those stores will fall back to another printer (wrong coloured paper) until you');
    console.log('    put the real Windows printer name in. Run  Get-Printer | Select Name  to see the names.');
    console.log('');
  }
}, 0);

const PS1 = path.join(__dirname, 'print-text.ps1');

/* 🔁 SELF-UPDATE: when the code files change on disk (OneDrive sync / git pull), exit cleanly —
   the Startup keep-alive loop (print-agent-loop.cmd) respawns us on the NEW code within seconds.
   This is what keeps every station current without anyone touching it again. */
let lastPrintAt = 0;
(function watchSelf(){
  const WATCH_MS = Number(process.env.OZARK_AGENT_WATCH_MS || 60000);
  /* the CONFIG is watched too. The runbook has said for weeks that a config change "needs one manual
     restart", and that is exactly the step somebody skips at 4pm with a bag waiting — they fix the printer
     name, nothing changes, and they conclude the fix did not work. Same keep-alive loop respawns us. */
  const files = [__filename, PS1, CFGFROM].filter(Boolean);
  const boot = {};
  files.forEach(function(f){ try { boot[f] = fs.statSync(f).mtimeMs; } catch (e) { boot[f] = 0; } });
  setInterval(function(){
    try {
      for (const f of files) {
        const m = fs.statSync(f).mtimeMs;
        if (boot[f] && m && m !== boot[f]) {
          if (Date.now() - lastPrintAt < 10000) return;          // never restart mid-print burst
          console.log('↻ agent code updated on disk — restarting to load it (keep-alive loop respawns me)');
          process.exit(0);
        }
      }
    } catch (e) {}
  }, WATCH_MS);
})();

/* 🛰 SELF-UPDATE FROM THE HUB — the build that ends "redo the print agents" (2026-08-21).
   The watcher above only noticed the files changing ON DISK, which meant OneDrive or a git pull — and OneDrive
   is exactly the delivery that never arrives at a counter (measured 8/20: a station's copy of the synced
   folder unchanged since 8/14). Owner: "i want them to submit a support ticket, and we work through it, send
   out the fixes." So the agent now asks the HUB for its own two files and replaces itself when they differ.

   ⚠️ THE AGENT NEVER ACCEPTS CODE FROM A WEB PAGE. The POS page only POKES it (`/update?hub=<origin>`); the
   agent then fetches the files ITSELF over HTTPS from a hub on a hard-coded allowlist, compares a sha against
   what it is running, and only then writes. Accepting a payload from localhost would have let ANY website
   open on a counter push code into the thing that controls the printers — cors() is wide open on purpose for
   /print, so the trust has to live in the allowlist, not in the caller.
   ⚠️ The learned hub address is remembered in the LOCAL config (sync cannot reach it), so after one poke the
   agent keeps itself current on its own timer even when no page is open.
   ⚠️ Atomic: write .new then rename, both files, and only exit when BOTH landed; never mid-print burst. The
   keep-alive loop (Chrome stations) or the shell's supervisor (shell stations) respawns the new code. */
const HUB_ALLOW = ['hub.example.com', 'track.cleaners.example.com', 'hub.cleaners.example.com', 'cleaners.example.com'];
const UPDATE_FILES = ['print-agent.js', 'print-text.ps1'];
let UPDATE_HUB = String(CFG.hubUrl || '').replace(/\/+$/, '');
let updateBusy = false, lastUpdateCheck = 0, updatePausedUntil = 0;
function hubAllowed(u) {
  try {
    const x = new URL(u);
    /* a test hatch with TWO switches, like the smoke test's config override: never one stray variable */
    if (process.env.OZARK_SMOKE === '1' && process.env.OZARK_AGENT_TEST_HUB && u.indexOf(process.env.OZARK_AGENT_TEST_HUB) === 0) return true;
    return x.protocol === 'https:' && HUB_ALLOW.indexOf(x.hostname) >= 0;
  } catch (e) { return false; }
}
function fetchText(u, cb) {
  const lib = u.indexOf('https:') === 0 ? require('https') : http;
  const rq = lib.get(u, { timeout: 15000 }, r => {
    if (r.statusCode !== 200) { r.resume(); return cb(new Error('HTTP ' + r.statusCode)); }
    const ch = []; r.on('data', c => ch.push(c)); r.on('end', () => cb(null, Buffer.concat(ch)));
  });
  rq.on('timeout', () => { rq.destroy(new Error('timeout')); });
  rq.on('error', cb);
}
function sha1(buf) { return require('crypto').createHash('sha1').update(buf).digest('hex'); }
function checkHubUpdate(why, done) {
  done = done || function () {};
  if (!UPDATE_HUB || updateBusy) return done(null, { skipped: true });
  if (Date.now() < updatePausedUntil) return done(null, { skipped: 'paused', pausedUntil: updatePausedUntil });
  if (Date.now() - lastPrintAt < 10000) return done(null, { skipped: 'printing' });
  updateBusy = true; lastUpdateCheck = Date.now();
  const dir = __dirname, pending = {}; let left = UPDATE_FILES.length, failed = null;
  UPDATE_FILES.forEach(function (name) {
    fetchText(UPDATE_HUB + '/' + name, function (err, buf) {
      if (err) failed = failed || (name + ': ' + err.message);
      else if (!buf || buf.length < 200 || (name === 'print-agent.js' && buf.indexOf('AGENT_VERSION') < 0)) failed = failed || (name + ': does not look like the agent');
      else pending[name] = buf;
      if (--left) return;
      updateBusy = false;
      if (failed) { console.log('🛰 hub update check (' + why + '): ' + failed); return done(null, { error: failed }); }
      const changed = UPDATE_FILES.filter(function (n) {
        let cur = null; try { cur = fs.readFileSync(path.join(dir, n)); } catch (e) {}
        return !cur || sha1(cur) !== sha1(pending[n]);
      });
      if (!changed.length) return done(null, { current: true });
      try {
        changed.forEach(function (n) { fs.writeFileSync(path.join(dir, n + '.new'), pending[n]); });
        changed.forEach(function (n) { fs.renameSync(path.join(dir, n + '.new'), path.join(dir, n)); });
      } catch (e) { console.log('🛰 could not write the update: ' + e.message); return done(null, { error: e.message }); }
      console.log('🛰 updated from the hub: ' + changed.join(', ') + ' — restarting to load it (the loop/supervisor respawns me)');
      done(null, { updated: changed });
      setTimeout(function () { process.exit(0); }, 300);
    });
  });
}
function rememberHub(u) {
  u = String(u || '').replace(/\/+$/, '');
  if (!hubAllowed(u)) return false;
  if (u !== UPDATE_HUB) {
    UPDATE_HUB = u;
    try { if (!fs.existsSync(LOCALCFGDIR)) fs.mkdirSync(LOCALCFGDIR, { recursive: true });
      /* ⚠️ THE LOCAL CONFIG IS AUTHORITATIVE, so creating it must carry the WHOLE effective config.
         The first version wrote a file holding only hubUrl; on a station still running from the synced
         config, the next restart loaded that sparse local file instead and the printers were GONE. The
         test caught it (the agent came up on the default port with no printers). If the local file does
         not exist yet, start from what this agent is actually running with. */
      let j = null; try { j = JSON.parse(fs.readFileSync(LOCALCFG, 'utf8')); } catch (e) { j = null; }
      if (!j) j = JSON.parse(JSON.stringify(CFG));
      j.hubUrl = u; fs.writeFileSync(LOCALCFG, JSON.stringify(j, null, 2));
      console.log('🛰 will keep myself current from ' + u + '  (remembered in ' + LOCALCFG + ')');
    } catch (e) { console.log('🛰 could not remember the hub address: ' + e.message); }
  }
  return true;
}
/* on its own timer once it knows the hub — a page does not have to be open for a fix to arrive */
setInterval(function () { checkHubUpdate('timer'); }, Number(process.env.OZARK_AGENT_HUB_MS || 10 * 60000));
if (UPDATE_HUB) setTimeout(function () { checkHubUpdate('startup'); }, 5000);

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'POST,GET,OPTIONS');
  // Chrome Private Network Access: an HTTPS page (the cloud-hub POS) calling
  // http://localhost sends a preflight that requires this header. Without it the
  // browser blocks the request and the POS silently falls back to the print box.
  res.setHeader('Access-Control-Allow-Private-Network', 'true');
}
function send(res, code, obj) { cors(res); res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); }

/* Build the printed text: optional per-store header (name/address/phone from
   CFG.headers) centered and prepended to the invoice the POS sent. Centering is
   done by padding with leading spaces against the widest line on the whole
   receipt — safe because the print script uses a monospace font. */
function withHeader(storeId, text) {
  const h = CFG.headers && CFG.headers[String(storeId)];
  let headLines = [];
  if (Array.isArray(h)) headLines = h.slice();
  else if (typeof h === 'string' && h) headLines = h.split('\n');
  if (!headLines.length) return text || '';

  const bodyLines = (text || '').split('\n');
  let maxLen = 0;
  for (const l of headLines.concat(bodyLines)) if (l.length > maxLen) maxLen = l.length;

  const centered = headLines.map(function (l) {
    const pad = Math.max(0, Math.floor((maxLen - l.length) / 2));
    return ' '.repeat(pad) + l;
  });
  return centered.join('\n') + '\n' + (text || '');
}

/* Find the order number in the invoice text so we can draw a real barcode of it.
   The POS prints it as "*2-06-07-26-0042*" and "Order: 2-06-07-26-0042". */
/* ⚠️ MIRROR OF bcFromText() IN Ozark-POS.html — keep the two identical. The app draws the barcode when a
   ticket goes out through the print BOX; this agent draws it on the auto-print path. A rule applied in only
   one of them means the same ticket is barcoded differently depending on which path it took.
   🧾 A PICKUP RECEIPT CARRIES NO BARCODE (owner, 2026-08-14: "pickup receipts are just for customers, they
   don't need barcodes"). It can settle several orders at once and it lists them all, so the loose rule at the
   bottom of this function used to give it a barcode for whichever order was printed first — measured, a
   three-order receipt scanned as the first order alone. Asked first, so no later rule can undo it. */
function orderNumberFrom(text) {
  if (!text) return '';
  if (/^[ \t]*PICKUP RECEIPT[ \t]*$/m.test(text)) return '';
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].trim().match(/^\*([0-9A-Za-z][0-9A-Za-z\-\. ]*)\*$/);
    if (m) return m[1].trim();
  }
  let m = text.match(/Order:\s*([0-9A-Za-z][0-9A-Za-z\-]*)/);  if (m) return m[1];
  m = text.match(/BAG\s+([0-9A-Za-z][0-9A-Za-z\-]*)/);          if (m) return m[1];
  m = text.match(/\b(\d{1,2}-\d{2}-\d{2}-\d{2}-\d{3,4}(?:-\d+)?)\b/); if (m) return m[1];
  return '';
}

/* Pull the piece count off the invoice text so it can be printed LARGE next to the rack:
   a bag ticket says "BAG x-y (4 pcs)"; a full invoice says "Total pieces   4". */
function piecesFrom(text) {
  if (!text) return '';
  let m = text.match(/\((\d+)\s*pcs?\)/i);      // bag ticket -> that bag's count
  if (m) return m[1];
  m = text.match(/Total pieces\D+(\d+)/i);       // full invoice -> order total
  if (m) return m[1];
  return '';
}

/* Replace the POS's faux text barcode (block chars) with a [[BARCODE]] marker the
   print script turns into a real Code 39. Drops the redundant "*number*" line so
   the readable number prints once, under the barcode. */
function injectBarcodeMarker(text, bc) {
  if (!bc) return text;
  const marker = '[[BARCODE]]';
  const blockRe = /[▀-▟]/;                 // ▀..▟ block elements (fauxBar)
  const starRe  = /^\s*\*[0-9A-Za-z].*\*\s*$/;       // the "*number*" line
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (blockRe.test(lines[i])) {
      lines[i] = marker;
      if (i > 0 && starRe.test(lines[i - 1])) lines.splice(i - 1, 1);
      return lines.join('\n');
    }
  }
  for (let i = 0; i < lines.length; i++) { if (/scan barcode/i.test(lines[i])) { lines[i] = marker; return lines.join('\n'); } }
  for (let i = 0; i < lines.length; i++) { if (starRe.test(lines[i]))          { lines[i] = marker; return lines.join('\n'); } }
  lines.push(marker);
  return lines.join('\n');
}

/* ⚠️ AN UNFILLED TEMPLATE LINE IS NOT A PRINTER NAME. Live, 2026-08-13: the Arkadelphia plant PC ran for
   weeks with `"1": "REPLACE WITH THE ARKADELPHIA PRINTER NAME"` still in its config. Every store-1 job came
   back `Printer not found: REPLACE WITH THE ARKADELPHIA PRINTER NAME`, the POS fell through to the print box,
   and the browser sent it to the Windows default — which is how an Arkadelphia invoice printed on the wrong
   paper, and later read as "the print agent didn't print at all".
   The placeholder was TRUTHY, so printerFor returned it as an exact match and the default / only-printer
   fallbacks below could never run. Treating it as unconfigured is what makes those fallbacks do their job. */
function isPlaceholder(v) {
  return /replace\s*with|your\s.*printer\s*name|printer\s*name\s*here|^<.*>$/i.test(String(v || '').trim());
}
/* Pick the printer for a store — exact entry, else "default", else the station's only printer.
   A one-printer counter must NEVER error on a cross-store order (that was the silent-fallback hole:
   an HS customer rung at the Arkadelphia counter asked for a store-2 printer the counter didn't map).
   ⚠️ Falling back means an Arkadelphia ticket can come out on Hot Springs paper. That is deliberate and it is
   the lesser fault: the invoice gets stapled to the bag either way, and a bag with no ticket is a garment
   nobody can match to an order. The wrong colour is visible; a missing ticket is a lost garment. */
function printerFor(storeId) {
  const exact = CFG.printers[String(storeId)];
  if (exact && !isPlaceholder(exact)) return { name: exact, via: '' };
  const why = exact ? ' (store ' + storeId + ' is still the unfilled template line)' : '';
  if (CFG.printers.default && !isPlaceholder(CFG.printers.default)) return { name: CFG.printers.default, via: ' (default)' + why };
  const uniq = Array.from(new Set(Object.values(CFG.printers).filter(v => v && !isPlaceholder(v))));
  if (uniq.length === 1) return { name: uniq[0], via: ' (only printer)' + why };
  return null;
}
/* every config entry still carrying template text — reported at startup and on /health, so a half-finished
   setup announces itself instead of waiting for somebody to notice a bag with no ticket. */
function cfgPlaceholders() {
  return Object.keys(CFG.printers || {}).filter(k => isPlaceholder(CFG.printers[k]))
    .map(k => k + ' = "' + CFG.printers[k] + '"');
}

/* print plain text (monospace) to the store's printer, with the rack location LARGE at the bottom.
   qrB64 (optional) = a base64 PNG of a QR code (order #) the POS renders for ROUTE invoices; we drop it
   to a temp file and hand PS1 -QRFile, which draws it crisply (NearestNeighbor) above the Code 128 so a
   phone camera can rack the order easily. */
function printJob(storeId, text, rack, copies, qrB64, cb) {
  lastPrintAt = Date.now();
  const pick = printerFor(storeId);
  if (!pick) return cb(new Error('No printer configured for store ' + storeId + ' and no default (check print-agent.config.json — see PRINT-AGENT-RUNBOOK.md)'));
  const printer = pick.name;
  if (pick.via) console.log('… store ' + storeId + ' has no exact printer — using "' + printer + '"' + pick.via);

  const bc = orderNumberFrom(text);
  const pcs = piecesFrom(text);
  const prepared = injectBarcodeMarker(withHeader(storeId, text), bc);

  const tmp = path.join(os.tmpdir(), 'ozark-' + process.pid + '-' + Date.now() + '.txt');
  try { fs.writeFileSync(tmp, prepared, 'utf8'); } catch (e) { return cb(e); }

  let qrFile = '';
  if (qrB64) { try { qrFile = path.join(os.tmpdir(), 'ozark-qr-' + process.pid + '-' + Date.now() + '.png'); fs.writeFileSync(qrFile, Buffer.from(qrB64, 'base64')); } catch (e) { qrFile = ''; } }

  const args = [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', PS1,
    '-TextFile', tmp, '-Printer', printer, '-Rack', (rack || ''), '-Copies', String(copies || 1),
    '-Barcode', (bc || ''), '-Pieces', (pcs || '')
  ];
  if (qrFile) args.push('-QRFile', qrFile);   // only when there's a QR → an older print-text.ps1 (mid-sync) still runs every non-route print
  cp.execFile('powershell.exe', args, { timeout: 20000 }, function (err, stdout, stderr) {
    setTimeout(function () { try { fs.unlinkSync(tmp); } catch (e) {} if (qrFile) { try { fs.unlinkSync(qrFile); } catch (e) {} } }, 5000);
    if (err) return cb(new Error('print failed: ' + ((stderr || err.message || '').toString().trim())));
    cb(null, printer);
  });
}

http.createServer(function (req, res) {
  if (req.method === 'OPTIONS') return send(res, 200, { ok: true });
  if (req.url === '/health')    return send(res, 200, { ok: true, agent: 'ozark-print', version: AGENT_VERSION, station: os.hostname(), printers: CFG.printers, ps1: fs.existsSync(PS1), unconfigured: cfgPlaceholders(), updatePaused: (Date.now() < updatePausedUntil ? new Date(updatePausedUntil).toISOString() : false) });
  if (req.url.indexOf('/test') === 0) {                       // GET /test?store=1 → print a self-test ticket with a REAL barcode
    let sid = '1';
    try { sid = new URL(req.url, 'http://x').searchParams.get('store') || Object.keys(CFG.printers).filter(k => k !== 'default')[0] || '1'; } catch (e) {}
    const t = '      OZARK CLEANERS\n   PRINT AGENT SELF-TEST\n================================\n' +
              'Station: ' + os.hostname() + '\nAgent:   v' + AGENT_VERSION + '\nStore:   ' + sid + '\n' +
              'Order: TEST-1234\n*TEST-1234*\n--------------------------------\nBAG TEST  (5 pcs)\n--------------------------------\n' +
              'A REAL barcode must show above.\nScan it — it should read\nTEST-1234. If you see blocky\ncharacters instead, the agent\ndid not draw it: see\nPRINT-AGENT-RUNBOOK.md\n';
    printJob(sid, t, 'STOP 7', 1, '', function (err, printer) {
      if (err) { console.log('✗ self-test:', err.message); return send(res, 500, { ok: false, version: AGENT_VERSION, error: err.message }); }
      console.log('✓ self-test → "' + printer + '"');
      send(res, 200, { ok: true, version: AGENT_VERSION, printer: printer });
    });
    return;
  }
  /* 🛑 PAUSE the self-update (owner, 2026-09-01: the update loop stomped a working-tree fix at second scale).
     LOOPBACK ONLY — a web page must not be able to switch a station's updates off. Auto-resumes (default
     15 min, cap 60): a pause that can be forgotten must un-pause itself, or this becomes the
     watchdog-that-stopped-watching. /health shows it; /update/resume ends it early. */
  if (req.url.indexOf('/update/pause') === 0) {
    const ra = String(req.socket.remoteAddress || '');
    if (ra !== '127.0.0.1' && ra !== '::1' && ra !== '::ffff:127.0.0.1') return send(res, 403, { ok: false, error: 'pause is loopback-only' });
    let min = 15; try { min = Number(new URL(req.url, 'http://x').searchParams.get('min')) || 15; } catch (e) {}
    if (min > 60) min = 60; if (min < 1) min = 1;
    updatePausedUntil = Date.now() + min * 60000;
    console.log('🛑 self-update PAUSED for ' + min + ' min (until ' + new Date(updatePausedUntil).toLocaleTimeString() + ') — auto-resumes');
    return send(res, 200, { ok: true, pausedUntil: updatePausedUntil, minutes: min });
  }
  if (req.url.indexOf('/update/resume') === 0) {
    const ra = String(req.socket.remoteAddress || '');
    if (ra !== '127.0.0.1' && ra !== '::1' && ra !== '::ffff:127.0.0.1') return send(res, 403, { ok: false, error: 'resume is loopback-only' });
    updatePausedUntil = 0; console.log('▶️ self-update resumed');
    return send(res, 200, { ok: true });
  }
  if (req.url.indexOf('/update') === 0) {                       // GET /update?hub=https://... → a POKE, never a payload
    let hub = ''; try { hub = new URL(req.url, 'http://x').searchParams.get('hub') || ''; } catch (e) {}
    if (hub && !rememberHub(hub)) return send(res, 400, { ok: false, error: 'that hub address is not on the allowlist', allow: HUB_ALLOW });
    if (!UPDATE_HUB) return send(res, 400, { ok: false, error: 'no hub address known yet — poke with ?hub=' });
    return checkHubUpdate('poke', function (e, r) { send(res, 200, Object.assign({ ok: true, hub: UPDATE_HUB, version: AGENT_VERSION }, r || {})); });
  }
  if (req.url === '/print' && req.method === 'POST') {
    let body = '';
    req.on('data', d => { body += d; if (body.length > 4e6) req.destroy(); });
    req.on('end', function () {
      let j; try { j = JSON.parse(body); } catch (e) { return send(res, 400, { ok: false, error: 'bad JSON' }); }
      printJob(j.storeId, j.text || '', j.rack || '', Number(j.copies) || 1, j.qr || '', function (err, printer) {
        if (err) { console.log('✗', err.message); return send(res, 500, { ok: false, error: err.message }); }
        console.log('✓ store ' + j.storeId + ' -> "' + printer + '"' + (j.rack ? '  RACK ' + j.rack : ''));
        send(res, 200, { ok: true, printer: printer });
      });
    });
    return;
  }
  send(res, 404, { ok: false, error: 'not found' });
}).listen(CFG.port, '127.0.0.1', function () {
  console.log('🖨  Ozark Print Agent on http://localhost:' + CFG.port + '  (plain + fast)');
  console.log('    Printers:', JSON.stringify(CFG.printers));
});
