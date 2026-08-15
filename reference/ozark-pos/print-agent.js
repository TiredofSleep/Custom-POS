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

const AGENT_VERSION = 5;   // bump when print-agent.js / print-text.ps1 change behavior — the POS warns on old versions (v5 = QR on route invoices)

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
const LOCALCFGDIR = process.env.LOCALAPPDATA
  ? path.join(process.env.LOCALAPPDATA, 'OzarkPrintAgent')
  : path.join(os.homedir(), '.ozark-print-agent');
const LOCALCFG  = path.join(LOCALCFGDIR, 'print-agent.config.json');
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
  if (req.url === '/health')    return send(res, 200, { ok: true, agent: 'ozark-print', version: AGENT_VERSION, station: os.hostname(), printers: CFG.printers, ps1: fs.existsSync(PS1), unconfigured: cfgPlaceholders() });
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
