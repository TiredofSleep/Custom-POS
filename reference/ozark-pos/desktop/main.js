/* ============================================================================================
   🖥 OZARK POS — DESKTOP SHELL (spike)
   Owner, 2026-08-13: "let's move beyond all this localstorage mess and build an actual local app...
   let's build this to last and not need support!"  Scope: DESKTOP-APP-SPIKE.md.

   ⚠️ THE ONE RULE THIS FILE EXISTS TO OBEY: **the shell does not contain the app.** It SERVES the live
   `Ozark-POS.html` — kept as a cached copy on this disk, refreshed from the hub whenever it is reachable
   (see local-server.js). Bundling the HTML into the exe would turn every typo fix into an installer build
   and a signing run, and the whole thing would be abandoned inside a week. The shell changes a few times a
   year; the app changes several times a day. Caching it is what lets a station boot with no internet
   WITHOUT welding the app to the binary.

   So the split is: the hub owns the APP. The shell owns the MACHINE —
     · station identity in a real file that no browser reset can empty
     · printing, with the agent as a child this process owns rather than a Startup-folder script
     · one instance, enforced by the OS
     · restart after a crash, and a record that it happened
     · a heartbeat that keeps reporting even when the PAGE is broken

   ⚠️ IT DOES HOLD THE HUB KEY, and that is an improvement rather than a new risk: today the key sits in
   localStorage in PLAIN TEXT on every station, and here it is encrypted with the Windows user's own DPAPI
   key via safeStorage. It is also the piece that makes a reinstall not need a human. The key is handed to
   the page in preload.js, into the exact localStorage slot the app already reads, so `Ozark-POS.html`
   needs no change at all.
   ============================================================================================ */
'use strict';
const { app, BrowserWindow, shell, dialog, Menu, ipcMain, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const https = require('https');
const { fork } = require('child_process');
const LOCAL = require('./local-server');
const { execFileSync } = require('child_process');

/* ---------------------------------------------------------------------------------------------
   🏷 STATION IDENTITY — the whole reason this shell exists.
   On 2026-08-13 a station silently became Hot Springs because one localStorage key went missing, and
   the plant spent a day stamping every record with the wrong store. This file is not a browser store:
   clearing site data, a new Windows profile or a Chrome reset cannot touch it.
   --------------------------------------------------------------------------------------------- */
/* ⚠️ THE CONFIG FOLDER IS PINNED, and this is not a detail — it is the same class of mistake as the
   port. Electron derives userData from the app NAME, so it moved every time the packaging changed: dev runs
   used "ozark-pos-shell", the installer used "Ozark POS". Each move meant a brand-new station.json, no hub
   key, no cached app — the station came up nameless on sample data as if it had never been set up. A
   station's identity must not depend on how the binary was built. */
app.setPath('userData', path.join(app.getPath('appData'), 'OzarkPOS'));
const CFGDIR = app.getPath('userData');

/* ⚠️ AND CARRY FORWARD ANYTHING THE OLD FOLDERS HOLD, once. Without this the pin would itself be one
   more move: correct from now on, but abandoning the station that is already configured. Copy only what is
   missing, never overwrite. */
let ADOPTED = '', ADOPT_ERR = '';
(function adoptOldConfig(){
  try {
    if (fs.existsSync(path.join(CFGDIR, 'station.json'))) return;
    const appData = app.getPath('appData');
    for (const old of ['ozark-pos-shell', 'Ozark POS']) {
      const dir = path.join(appData, old);
      if (!fs.existsSync(path.join(dir, 'station.json'))) continue;
      fs.mkdirSync(CFGDIR, { recursive: true });
      for (const f of ['station.json', 'station.key']) {
        try { if (fs.existsSync(path.join(dir, f))) fs.copyFileSync(path.join(dir, f), path.join(CFGDIR, f)); } catch (e) {}
      }
      try {
        const srcApp = path.join(dir, 'app'), dstApp = path.join(CFGDIR, 'app');
        if (fs.existsSync(srcApp)) { fs.mkdirSync(dstApp, { recursive: true });
          for (const f of fs.readdirSync(srcApp)) fs.copyFileSync(path.join(srcApp, f), path.join(dstApp, f)); }
      } catch (e) {}
      ADOPTED = old;
      break;
    }
  } catch (e) { ADOPT_ERR = (e && e.message) || String(e); }
})();
const CFGFILE = path.join(CFGDIR, 'station.json');
const LOGFILE = path.join(CFGDIR, 'shell.log');

const DEFAULTS = {
  hubUrl: 'https://142-93-2-141.sslip.io',
  stationName: '',          /* blank on purpose — see firstRun() */
  printAgent: false,        /* 🖨 receipt-printer stations only — see the note in preload.js */
  storeScope: '',           /* '' = let the app work it out from the station name */
  /* 🏠 PHASE 2: serve the app from this machine so it starts with the hub unreachable.
     ⚠️ SET THIS false ONLY AS A ROLLBACK. Doing so changes the ORIGIN back to the hub, and IndexedDB is
     per-origin — the station will open on the database it had BEFORE Phase 2, not the one it has been
     using since. Neither is lost, but they are two separate stores and work done in one is not in the
     other until it syncs. Flip it deliberately, not to see what happens. */
  serveLocal: true,
  /* 💾 EVERY STATION IS A FULL OFF-SITE COPY. Owner, 2026-08-13: "every machine with this new app
     should be a full working offsite copy." It already holds the whole database — but in IndexedDB, buried
     in a Chromium profile, where it cannot be handed to a new hub. This writes a real encrypted file. */
  snapshotEveryHours: 6,
  healthEverySec: 60
};

/* ⚠️ THE LOG IS BOUNDED, because nothing else was going to bound it. It appends on every launch, every
   snapshot, every build the hub serves — small per line, but a station runs for years and nothing rotated
   it. One generation is kept (shell.log.1) rather than deleted outright, so the previous stretch of history
   survives a roll; two generations is the ceiling, which is what makes it bounded rather than merely slow.
   ⚠️ Kept deliberately generous at 512 KB: this file is the ONLY record of what a station's shell did, and
   it is what answered "was that a second window or a reload?" on 8/14. Trimming it hard to save a megabyte
   would be trading the evidence for nothing. */
const LOG_MAX = 512 * 1024;
function log(line) {
  const stamp = new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' });
  const s = '[' + stamp + '] ' + line + '\n';
  try {
    try { if (fs.statSync(LOGFILE).size > LOG_MAX) fs.renameSync(LOGFILE, LOGFILE + '.1'); } catch (e) {}
    fs.appendFileSync(LOGFILE, s);
  } catch (e) {}
  process.stdout.write(s);
}

function readCfg() {
  try { return Object.assign({}, DEFAULTS, JSON.parse(fs.readFileSync(CFGFILE, 'utf8'))); }
  catch (e) { return Object.assign({}, DEFAULTS); }
}
function writeCfg(c) {
  try { fs.mkdirSync(CFGDIR, { recursive: true }); fs.writeFileSync(CFGFILE, JSON.stringify(c, null, 2)); }
  catch (e) { log('could not write station.json: ' + e.message); }
}

/* ⚠️ A NAMELESS STATION IS THE FAULT THIS REPLACES, so the shell refuses to be one. It asks once, writes
   the answer to disk, and never asks again — and the name is what the POS, the activity log and the device
   registry all use to recognise this machine. */
function firstRun(cfg) {
  if (cfg.stationName) return cfg;
  const os = require('os');
  cfg.stationName = os.hostname() || 'Ozark Station';
  writeCfg(cfg);
  log('first run — station named "' + cfg.stationName + '" from the computer name; edit ' + CFGFILE + ' to change it');
  return cfg;
}

/* 🔑 THE HUB KEY, ENCRYPTED AT REST.
   ⚠️ TODAY THAT KEY SITS IN localStorage IN PLAIN TEXT on every station. Electron's safeStorage encrypts
   it with the Windows user's own DPAPI key, so moving it into the shell is a security IMPROVEMENT over the
   status quo, not a new exposure -- and it is the piece that makes "reinstall without needing a human"
   possible at all.
   The flow is deliberately one-way: paste the key into station.json once, and the FIRST START encrypts it to
   station.key and deletes the plaintext. A credential that lingers in a config file because somebody forgot
   to tidy up is how secrets end up in backups. */
const KEYFILE = path.join(CFGDIR, 'station.key');
function loadHubKey(c) {
  if (c.hubKey) {                                  /* pasted in plain -- secure it and wipe it */
    try {
      if (safeStorage.isEncryptionAvailable()) {
        fs.writeFileSync(KEYFILE, safeStorage.encryptString(String(c.hubKey)));
        const plain = String(c.hubKey); delete c.hubKey; writeCfg(c);
        log('hub key encrypted to station.key and removed from station.json');
        return plain;
      }
      log('⚠️ safeStorage unavailable on this machine — the key stays in station.json in plain text');
      return String(c.hubKey);
    } catch (e) { log('could not secure the hub key: ' + e.message); return String(c.hubKey); }
  }
  try { if (fs.existsSync(KEYFILE)) return safeStorage.decryptString(fs.readFileSync(KEYFILE)); }
  catch (e) { log('could not read station.key: ' + e.message); }
  return '';
}

/* 🆔 ONE MACHINE, ONE DEVICE RECORD, FOREVER.
   ⚠️ THIS DID NOT WORK AND THE HUB PROVED IT: three records named "Brayden's PC (shell)" appeared in one
   evening — WS-MSS5QFPEQHN, WS-SHELL-AVH6JJ, WS-SHELL-Z3IXXR. The id the hub actually sees lives in the
   PAGE's localStorage, and the preload only ever filled a blank, so every storage move (a packaging change,
   a reinstall, a cleared profile) minted a fresh identity and abandoned the old record.
   ⚠️ THE DEVICE REGISTRY IS THIS PROJECT'S MAIN DIAGNOSTIC INSTRUMENT. The whole root cause of 8/05 was
   found by reading it ("Hot Springs Counter, no appRev, dating to 7/12"). A ghost record is indistinguishable
   from a real station that has gone quiet — same frozen lastSeen, same frozen build — so ghosts do not just
   clutter the list, they make the one question it answers unanswerable. The hub also appoints the station
   that runs the automatic jobs out of this registry.
   So the SHELL is authoritative, like the hub key: the machine owns its name, not the browser profile. */
function stationId(c) {
  if (!c.stationId) { c.stationId = 'WS-SHELL-' + Math.random().toString(36).slice(2, 8).toUpperCase(); writeCfg(c); }
  return c.stationId;
}
/* ⚠️ HISTORICAL — removed 2026-08-14, one day after it shipped. Kept under the owner's rule: never delete,
   just mark. It let the PAGE hand an id back to the shell, on the idea that installing over a counter which
   had run in Chrome for weeks should keep that station's history. Field evidence killed it twice over:
     · It could never do that. The shell serves a different ORIGIN (127.0.0.1:17817) and localStorage is
       per-origin, so a migrating page opens EMPTY and has no id to give back.
     · And it did harm. Launched once before the hub key was pasted, the page minted a throwaway id, and
       this function wrote that throwaway into station.json as the station's permanent identity. The
       Arkadelphia counter hit exactly that and had to be undone by hand at the counter.
   The identity now comes from station.json and nowhere else. Do NOT reintroduce this without also solving
   how a throwaway id from an unconnected first launch is told apart from a real one.
function adoptStationId(id) { ... }  */

/* ---------------------------------------------------------------------------------------------
   🖨 PRINTING — the agent becomes a child this process owns.
   ⚠️ Today it is a separate Node process kept alive by a Startup-folder .cmd and a keep-alive loop, with
   its config in a ONEDRIVE-SYNCED FOLDER. That combination is what printed an Arkadelphia invoice on the
   wrong printer and then stopped printing altogether on 8/13. As a child of the shell it starts when the
   app starts, dies when it dies, and is restarted here when it crashes.
   ⚠️ Its self-update watcher is disabled: it exists to respawn the agent when the synced files change, and
   in here the SHELL owns updates. Two things racing to restart the same process is how you get a loop.
   --------------------------------------------------------------------------------------------- */
let agent = null, agentStops = 0;
function startAgent(cfg) {
  if (!cfg.printAgent) { log('print agent disabled in station.json'); return; }
  /* ⚠️ TWO PLACES ON PURPOSE. Running from source the agent sits beside the repo; inside a PACKAGED exe
     there is no repo, so it ships as an extraResource. Hard-coding either one gives a shell that works in
     development and silently cannot print in production — which is the shape of fault this whole spike
     exists to remove. */
  const candidates = [ path.join(process.resourcesPath || '', 'print-agent.js'),
                       path.join(__dirname, '..', 'print-agent.js') ];
  const script = candidates.filter(p => { try { return p && fs.existsSync(p); } catch (e) { return false; } })[0];
  if (!script) { log('print agent not found (looked in: ' + candidates.join(' , ') + ') — skipping'); return; }
  try {
    agent = fork(script, [], {
      cwd: path.dirname(script),
      env: Object.assign({}, process.env, { OZARK_AGENT_WATCH_MS: '2147483647' }),
      stdio: ['ignore', 'pipe', 'pipe', 'ipc']
    });
    agent.stdout.on('data', d => log('  agent: ' + String(d).trim()));
    agent.stderr.on('data', d => log('  agent!: ' + String(d).trim()));
    agent.on('exit', code => {
      agent = null; agentStops++;
      log('print agent exited (' + code + ') — restart #' + agentStops);
      /* ⚠️ COUNTED, not silent. An agent that restarts every few seconds is a broken printer driver, and it
         must look different from one that has restarted once in a week. */
      if (agentStops < 20) setTimeout(() => startAgent(cfg), 3000);
      else log('print agent has failed ' + agentStops + ' times — not restarting again, fix the config');
    });
    log('print agent started (pid ' + agent.pid + ')');
  } catch (e) { log('could not start the print agent: ' + e.message); }
}

/* ---------------------------------------------------------------------------------------------
   💓 A HEARTBEAT THAT OUTLIVES THE PAGE.
   ⚠️ Every existing signal comes FROM the app: the device registry, the mirror, the crash reporter. So a
   station whose page has thrown simply goes quiet, and quiet is indistinguishable from "closed for the
   night" — which is exactly how Hot Springs sat on a five-day-old build without anyone knowing. This ping
   comes from the SHELL, so it keeps arriving when the page is dead.
   --------------------------------------------------------------------------------------------- */
let hbOk = null;   /* null = never tried, true/false = last outcome */

/* 🔄 A DEPLOY HAS TO REACH A SHELL STATION, AND IT DID NOT.
   ⚠️ MEASURED, NOT IMAGINED: twelve minutes after a deploy this station was still serving the previous
   build, and it had already reloaded twice. Here is the trap, and it is a nasty one.
   The APP decides to update when the HUB's appRev changes — but the shell serves the app from a cache
   refreshed every ten minutes, so the reload lands on THE SAME OLD BYTES. Worse, `SYNC.appRev` is taken
   from the first hub response after a page load, so the freshly reloaded old build now believes it is
   current and NEVER ASKS AGAIN. The station sits on stale code until the next deploy happens to coincide
   with a cache refresh. That is precisely the failure that put Hot Springs five days behind and cost a
   week of mysteries — rebuilt, accidentally, inside the thing meant to end it.
   So the SHELL owns this now: it already pings /api/health every minute, so it watches appRev there,
   pulls the new bytes immediately, and then asks the PAGE whether it is safe to reload.
   ⚠️ IT ASKS THE APP'S OWN updateSafe(), rather than inventing a second opinion about when a station may
   be interrupted. If somebody is mid-order it simply tries again on the next beat — a pending update is
   held, never abandoned, and never dropped on a customer's checkout. */
let APPREV = '';           /* the hub build this station has been told about */
let UPDATE_WAITING = false;  /* new bytes are on disk; the page has not been able to take them yet */
async function appUpdateIfSafe(log) {
  if (!UPDATE_WAITING || !win || win.isDestroyed()) return;
  let safe = false;
  try {
    safe = await win.webContents.executeJavaScript(
      "(function(){try{ if(typeof updateSafe==='function') return !!updateSafe();" +
      " return !document.querySelector('#modalRoot .modal'); }catch(e){ return false; }})()");
  } catch (e) { safe = false; }
  if (!safe) return;                       /* somebody is working — ask again in a minute */
  UPDATE_WAITING = false;
  log('a newer build is cached and the screen is free — reloading into it');
  try { win.reload(); } catch (e) { log('could not reload: ' + e.message); }
}

/* ══ 🛠 SETTINGS THIS STATION ACCEPTS FROM THE HUB ══════════════════════════════════════════════════════
   Owner, 2026-08-15: "do we have a backdoor to actually work on these systems now at each station without
   having to be at each computer?" This is that, at the level he chose: SETTINGS ONLY, never a command.

   ⚠️ THE SECOND LOCK. The hub already refuses to store hubUrl or hubKey, and the shell refuses to apply them
   again here. Two locks on the same door on purpose: repointing a station at another hub would hand over the
   entire shop on the next sync, and that is the one mistake in this file that could not be walked back.
   ⚠️ A RESTART WAITS FOR AN IDLE SCREEN. A settings change is harmless mid-shift; yanking the app out from
   under somebody at a till is not. Same rule the snapshot and the auto-update already follow.
   ⚠️ IT REPORTS WHAT IT ACTUALLY DID, not what it was told. "Asked for" and "applied" are different facts,
   and only the second one is worth trusting. */
const REMOTE_SETTABLE = ['stationId', 'stationName', 'storeScope', 'printAgent', 'printers',
                         'snapshotEveryHours', 'healthEverySec'];
const NEVER_REMOTE = ['hubUrl', 'hubKey'];
let CFG_AT = 0;

function hubPost(cfgIn, pathname, payload, done) {
  try {
    const base = String(cfgIn.hubUrl || '').replace(/\/+$/, '');
    const t = new URL(base + pathname);
    const lib = t.protocol === 'https:' ? https : http;
    const data = Buffer.from(JSON.stringify(payload));
    const rq = lib.request({ protocol: t.protocol, hostname: t.hostname,
      port: t.port || (t.protocol === 'https:' ? 443 : 80), path: t.pathname, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': data.length,
                 'x-ozark-key': HUBKEY || '', 'x-ozark-device': 'shell:' + cfgIn.stationName },
      timeout: 15000 }, r => { let b=''; r.on('data', c => { if (b.length < 4000) b += c; });
        r.on('end', () => { let j=null; try { j = JSON.parse(b); } catch(e){} done && done(null, j, r.statusCode); }); });
    rq.on('timeout', () => { rq.destroy(); done && done(new Error('timeout')); });
    rq.on('error', e => done && done(e));
    rq.end(data);
  } catch (e) { done && done(e); }
}

function applyStationConfig(cfgIn, want, restartAt, recacheAt) {
  const applied = {}, refused = [];
  try {
    Object.keys(want || {}).forEach(k => {
      if (NEVER_REMOTE.indexOf(k) >= 0) { refused.push(k); return; }   /* the second lock */
      if (REMOTE_SETTABLE.indexOf(k) < 0) { refused.push(k); return; }
      const now = JSON.stringify(cfgIn[k]);
      if (now === JSON.stringify(want[k])) return;                     /* already so — idempotent, say nothing */
      cfgIn[k] = want[k]; applied[k] = want[k];
    });
    if (refused.length) log('⛔ refused settings the hub may not set: ' + refused.join(', '));
    if (Object.keys(applied).length) {
      writeCfg(cfgIn);
      log('🛠 applied from the hub: ' + JSON.stringify(applied));
    }
  } catch (e) { log('🛠 could not apply hub settings: ' + e.message); return { applied, error: e.message }; }
  return { applied, refused };
}

function fetchStationConfig(cfgIn) {
  try {
    const base = String(cfgIn.hubUrl || '').replace(/\/+$/, '');
    const t = new URL(base + '/api/station-config?id=' + encodeURIComponent(stationId(cfgIn)));
    const lib = t.protocol === 'https:' ? https : http;
    const rq = lib.get({ protocol: t.protocol, hostname: t.hostname,
      port: t.port || (t.protocol === 'https:' ? 443 : 80), path: t.pathname + t.search,
      headers: { 'x-ozark-key': HUBKEY || '' }, timeout: 15000 }, r => {
      let b=''; r.on('data', c => { if (b.length < 20000) b += c; });
      r.on('end', () => {
        let j=null; try { j = JSON.parse(b); } catch (e) { return; }
        if (!j || !j.ok) return;
        const res = applyStationConfig(cfgIn, j.want, j.restartAt, j.recacheAt);
        const didAnything = Object.keys(res.applied || {}).length;
        if (didAnything || res.error) {
          hubPost(cfgIn, '/api/station-config',
            { id: stationId(cfgIn), applied: res.applied, error: res.error || '' }, () => {});
        }
        if (j.recacheAt && j.recacheAt > (cfgIn.__recachedAt || 0)) {
          cfgIn.__recachedAt = j.recacheAt; writeCfg(cfgIn);
          log('🛠 hub asked this station to re-fetch the app');
          LOCAL.refreshCache(cfgIn.hubUrl, path.join(CFGDIR, 'app'), log)
            .then(ch => { if (ch) { UPDATE_WAITING = true; appUpdateIfSafe(log); } }).catch(() => {});
        }
        if (j.restartAt && j.restartAt > (cfgIn.__restartedAt || 0)) {
          /* ⚠️ only when nobody is mid-task — a settings change can wait, a till cannot be yanked */
          restartWhenIdle(cfgIn, j.restartAt);
        }
      });
    });
    rq.on('timeout', () => rq.destroy());
    rq.on('error', () => {});
  } catch (e) {}
}
function restartWhenIdle(cfgIn, stamp) {
  if (!win || win.isDestroyed()) return;
  win.webContents.executeJavaScript(
    "(function(){try{ if(typeof updateSafe==='function') return !!updateSafe();" +
    " return !document.querySelector('#modalRoot .modal'); }catch(e){ return false; }})()")
    .then(safe => {
      if (!safe) return;                       /* try again on the next beat */
      cfgIn.__restartedAt = stamp; writeCfg(cfgIn);
      log('🛠 hub asked this station to restart, and the screen is free — restarting');
      app.relaunch(); app.exit(0);
    }).catch(() => {});
}

/* 🔎 tell the hub which app this station is ACTUALLY serving — see the banner in hub-server.js.
   ⚠️ An audit trail, not a lock: a machine that can alter the app can alter this too. */
function reportCode(cfgIn) {
  try {
    const f = path.join(CFGDIR, 'app', LOCAL.APP_FILE);
    const sha = require('crypto').createHash('sha1').update(fs.readFileSync(f)).digest('hex').slice(0, 12);
    if (sha === CODE_LAST) return; CODE_LAST = sha;
    hubPost(cfgIn, '/api/station-config', { id: stationId(cfgIn), codeSha: sha }, (e, j) => {
      if (j && j.match === false) {
        log('🔎 the hub says this station is serving ' + sha + ' but it serves ' + j.serving + ' — re-fetching');
        LOCAL.refreshCache(cfgIn.hubUrl, path.join(CFGDIR, 'app'), log)
          .then(ch => { if (ch) { UPDATE_WAITING = true; appUpdateIfSafe(log); } }).catch(() => {});
      }
    });
  } catch (e) {}
}
let CODE_LAST = '';

function heartbeat(cfg) {
  const url = String(cfg.hubUrl || '').replace(/\/+$/, '') + '/api/health';
  const lib = url.indexOf('https') === 0 ? https : http;
  /* ⚠️ IT LOGS THE FIRST SUCCESS AND EVERY CHANGE, not just failures. The first version only wrote a line
     when something went wrong, which meant a silent log was indistinguishable from a heartbeat that had
     never run — and I could not prove it worked without breaking it. Measure a signal the work itself
     writes. It stays quiet while nothing changes, so the log does not fill with "still fine". */
  const settle = (ok, why) => {
    if (hbOk === ok) return;
    hbOk = ok;
    log(ok ? 'heartbeat: hub reachable' : ('heartbeat: hub UNREACHABLE — ' + why));
  };
  try {
    const req = lib.get(url, { headers: { 'x-ozark-device': 'shell:' + cfg.stationName }, timeout: 8000 }, res => {
      let body = '';
      res.on('data', d => { if (body.length < 4000) body += d; });
      res.on('end', () => {
        settle(res.statusCode === 200, 'answered ' + res.statusCode);
        if (res.statusCode !== 200) return;
        let j = null; try { j = JSON.parse(body); } catch (e) { return; }
        if (!j || !j.appRev) return;
        if (APPREV && j.appRev !== APPREV) {
          log('the hub is serving a newer build (' + j.appRev + ') — fetching it');
          LOCAL.refreshCache(cfg.hubUrl, path.join(CFGDIR, 'app'), log)
            .then(changed => { if (changed) { UPDATE_WAITING = true; return appUpdateIfSafe(log); } })
            .catch(e => log('app cache: ' + e.message));
        }
        APPREV = j.appRev;
        /* an update held back because somebody was working gets another chance every beat */
        if (UPDATE_WAITING) appUpdateIfSafe(log);
        /* 🛠 settings waiting for this station. ⚠️ Only fetched when the hub says something CHANGED — one
           extra field on a response we already make, rather than a second poll every minute forever. */
        if ((j.cfgAt || 0) !== CFG_AT) { CFG_AT = j.cfgAt || 0; fetchStationConfig(cfg); }
        reportCode(cfg);   /* 🔎 cheap: hashes once and only speaks when the answer changes */
      });
    });
    req.on('timeout', () => { req.destroy(); settle(false, 'no answer in 8s'); });
    req.on('error', e => settle(false, e.message));
  } catch (e) { settle(false, e.message); }
}

/* 💾 A RESTORABLE COPY OF THE SHOP, FROM THIS STATION.
   ⚠️ WHAT THE STATION ALREADY HAD WAS NOT A BACKUP. Every station holds the complete database, which
   is why the shop keeps working when the hub is gone — but it lives in IndexedDB inside a browser
   profile. There is no way to get it OUT except through the app, so it could never rebuild a hub. A
   replica you cannot extract is redundancy, not backup.
   This asks the PAGE for its database (only the page can read its own IndexedDB), encrypts it with the
   same tool and format the hub uses, and writes it beside the station config. Any one of these files can
   restore the shop.
   ⚠️ IT IS ENCRYPTED WITH THE HUB KEY, deliberately: the station already holds that secret, so this adds
   no new credential to distribute to every counter. The cost is stated rather than hidden — ROTATING THE
   HUB KEY MAKES OLDER STATION SNAPSHOTS NEED THE OLD KEY. Keep the retired key with the backups if you
   ever rotate, or re-snapshot afterwards.
   ⚠️ IT SKIPS WHEN SOMEBODY IS WORKING. Serialising ~4.6MB is a brief blip, and a blip during a
   customer's checkout is exactly the kind of thing that teaches staff the software is slow. A backup that
   waits an hour is worth more than one that interrupts a sale. */
/* module scope on purpose: snapshotLocalDb below is defined out here, and the first version declared this
   inside the single-instance block — "HUBKEY is not defined", caught by the snapshot logging its own
   failure rather than silently writing nothing. */
let HUBKEY = '';
function snapshotDir(){ return path.join(CFGDIR, 'snapshots'); }
async function snapshotLocalDb(){
  try {
    if (!win || win.isDestroyed() || !HUBKEY) return;
    const busy = await win.webContents.executeJavaScript(
      "(function(){try{ return !!document.querySelector('#modalRoot .modal') || ['detail','quickform','assemble','pickup','routeConfirm'].indexOf(state.screen)>=0; }catch(e){ return true; }})()");
    if (busy) { return; }                       /* try again on the next tick */
    const json = await win.webContents.executeJavaScript(
      "(function(){try{ return (DB && DB.customers && DB.customers.length) ? JSON.stringify({db:DB}) : ''; }catch(e){ return ''; }})()");
    if (!json || json.length < 200000) return;   /* an empty or tiny database is not worth keeping */
    const dir = snapshotDir(); fs.mkdirSync(dir, { recursive: true });
    /* ⚠️ THE SHOP'S DATE, NOT THE COMPUTER'S IDEA OF UTC. toISOString() is UTC, so every snapshot taken
       after 7 PM Central was filed under TOMORROW'S date — measured on this machine: a 7:10 PM run wrote
       station-20260815.enc on the 14th. Nothing was lost, but a person restoring "yesterday" would reach
       for the wrong file, and the 14-file retention silently became ~7-14 days because one Central day
       could produce two names. This is the standing UTC-vs-Central trap in CLAUDE.md, in code I wrote the
       night before I quoted the rule. Anything a human reads is America/Chicago. */
    const stamp = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' }).replace(/-/g,'');
    const plain = path.join(dir, 'tmp-' + process.pid + '.json');
    const out = path.join(dir, 'station-' + stamp + '.enc');
    fs.writeFileSync(plain, json);
    try {
      execFileSync(process.execPath, [path.join(__dirname, 'backup-crypto.js'), 'encrypt', plain, out, '--pass', HUBKEY],
        { stdio: 'pipe', env: Object.assign({}, process.env, { ELECTRON_RUN_AS_NODE: '1' }) });
      log('snapshot written: ' + path.basename(out) + ' (' + Math.round(fs.statSync(out).size/1024) + ' KB, encrypted)');
    } finally { try { fs.unlinkSync(plain); } catch (e) {} }
    /* keep a fortnight; they are small and encrypted */
    try {
      fs.readdirSync(dir).filter(n=>/^station-\d+\.enc$/.test(n)).sort().reverse().slice(14)
        .forEach(n=>{ try { fs.unlinkSync(path.join(dir,n)); } catch(e){} });
    } catch (e) {}
  } catch (e) { log('snapshot failed: ' + ((e && e.message) || e)); }
}

/* --------------------------------------------------------------------------------------------- */
let win = null;
let cfg = firstRun(readCfg());

/* 🪟 ONE INSTANCE, ENFORCED BY THE OS.
   ⚠️ A second POS window is not a theoretical problem here: one left open since 8/05 overwrote the good
   window twice a minute and pushed stale records to the hub. The app grew a whole leader election to
   survive it. The OS can simply refuse. */
if (!app.requestSingleInstanceLock()) { log('another shell is already running — focusing it and exiting'); app.quit(); }
else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });

  /* the preload asks for this synchronously, BEFORE the app's own scripts run */
  ipcMain.on('station-config', (e) => {
    e.returnValue = { hubKey: HUBKEY, stationName: cfg.stationName, stationId: stationId(cfg),
                      storeScope: cfg.storeScope, printAgent: !!cfg.printAgent };
  });
  /* ⚠️ the 'station-adopt-id' channel is gone with adoptStationId — the page no longer names this station */

  /* Windows groups taskbar buttons by this id; without it the app shows up as "Electron". */
  try{ app.setAppUserModelId('com.ozarkcleaners.pos'); }catch(e){}
  app.whenReady().then(() => {
    HUBKEY = loadHubKey(cfg);
      /* ⚠️ SAY WHETHER THE CARRY-FORWARD HAPPENED. The first version swallowed its own failure, so a
       station silently came up nameless on sample data and looked like a fresh install — which is exactly
       the class of silence this whole shell was built to end. */
    if (ADOPTED) log('carried this station forward from the old config folder "' + ADOPTED + '"');
    if (ADOPT_ERR) log('⚠ could not carry forward the old config: ' + ADOPT_ERR);
  log('hub key: ' + (HUBKEY ? 'loaded (' + HUBKEY.length + ' chars)' : 'NOT SET — the app will load unconnected, on seed data'));
    /* say which station this is. "Which machine am I looking at" was answered by guesswork for a week. */
    log('station id: ' + stationId(cfg));
    Menu.setApplicationMenu(null);          /* no menu bar, no accidental navigation, no DevTools item */
    win = new BrowserWindow({
      width: 1440, height: 900, show: false,
      title: 'Ozark POS — ' + cfg.stationName,
      /* 🧥 the Ozark hanger, so the window and the taskbar look like the shop rather than like Electron.
         It is copied INTO desktop/ on purpose — the icon identifies the SHELL, so it must not depend on the
         repo folder being present at runtime the way a packaged install would not be. */
      icon: path.join(__dirname, 'icon.png'),
      backgroundColor: '#11314f',
      webPreferences: { nodeIntegration: false, contextIsolation: true, devTools: false,
        sandbox: false, preload: path.join(__dirname, 'preload.js') }
    });
    win.once('ready-to-show', () => win.show());

    /* ⚠️ EXTERNAL LINKS OPEN IN A REAL BROWSER, never in here. A POS window that can be navigated to
       anything is a POS window somebody will leave on a website. */
    win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });

    /* 🩹 CRASH RECOVERY. The app's own reporter cannot report the case where the renderer itself is gone. */
    win.webContents.on('render-process-gone', (_e, d) => {
      log('renderer gone (' + (d && d.reason) + ') — reloading');
      try { win.reload(); } catch (e) {}
    });
    win.webContents.on('unresponsive', () => { log('page unresponsive — reloading'); try { win.reload(); } catch (e) {} });
    win.webContents.on('did-fail-load', (_e, code, desc) => {
      log('load failed ' + code + ' ' + desc + ' — retrying in 5s');
      setTimeout(() => { try { win.reload(); } catch (e) { try { win.loadURL(cfg.hubUrl); } catch (_) {} } }, 5000);
    });

    /* ⚠️ SAY WHAT ACTUALLY LOADED. A shell that starts and shows a window proves nothing about whether the
       POS is in it — the page could be an error, a login wall, or the wrong build. The title comes from the
       app itself, so this line is the app confirming its own arrival. */
    /* 🏷 THE TITLE BAR NAMES THE STATION, and the page is not allowed to take that back.
       Today's whole saga was a station that did not know what it was — the plant reporting Hot Springs
       for a day. A window that says which station and which store it is turns that from an investigation
       into a glance. The app sets its own <title> on every load, so we override it and keep overriding. */
    const stationTitle = () => 'Ozark POS — ' + cfg.stationName + (cfg.storeScope ? '  ·  store ' + cfg.storeScope : '');
    win.on('page-title-updated', (e) => { e.preventDefault(); try{ win.setTitle(stationTitle()); }catch(err){} });
    win.webContents.on('did-finish-load', () => {
      try{ win.setTitle(stationTitle()); }catch(err){}
      log('page loaded: "' + win.webContents.getTitle() + '" ← ' + win.webContents.getURL());
    });

    log('shell starting — station "' + cfg.stationName + '" → ' + cfg.hubUrl);
    startApp();

    startAgent(cfg);
    heartbeat(cfg);
    setInterval(() => heartbeat(cfg), Math.max(15, Number(cfg.healthEverySec) || 60) * 1000);
  });

  /* 🏠 Serve the app from disk, refreshing the copy whenever the hub can be reached.
     ⚠️ THE ORDER MATTERS: refresh FIRST, then listen, then load. A station that boots offline must still
     come up on the copy it already has rather than waiting on a network call it will never get. */
  async function startApp(){
    if (!cfg.serveLocal) {                     /* rollback path — straight to the hub, Phase 1 behaviour */
      log('serveLocal is off — loading straight from the hub');
      win.loadURL(cfg.hubUrl);
      return;
    }
    const dir = path.join(CFGDIR, 'app');
    try { await LOCAL.refreshCache(cfg.hubUrl, dir, log); } catch (e) { log('app cache: ' + e.message); }

    const have = LOCAL.ensureServable(dir, log);   /* ⚠ a damaged copy reverts to .prev before anything is served */
    if (!have) {
      /* ⚠️ FIRST RUN WITH NO HUB. There is nothing on disk and nothing to fetch, so there is no local app
         to serve. Say so plainly and fall back to the hub URL, which will show its own retry — rather than
         serving a 404 from our own server, which would look like the app itself was broken. */
      log('⚠ no cached app yet and the hub is unreachable — falling back to the hub URL');
      win.loadURL(cfg.hubUrl);
      return;
    }

    try {
      await LOCAL.start({ hubUrl: cfg.hubUrl, dir, log });
    } catch (e) {
      /* ⚠️ THE PORT IS THE ORIGIN. If something else holds it we must NOT pick another: a different port
         is a different origin, and this station's entire local database would vanish from view. Refuse, and
         say exactly what to do. */
      const msg = 'Port ' + LOCAL.APP_PORT + ' is already in use, so the POS cannot start.\n\n'
        + 'That port is part of this station\'s identity — using a different one would hide all of its saved '
        + 'work. Close whatever is using it and start the POS again.\n\n(' + ((e && e.message) || e) + ')';
      log('REFUSING TO START: port ' + LOCAL.APP_PORT + ' in use — ' + ((e && e.message) || e));
      try { dialog.showErrorBox('Ozark POS', msg); } catch (_) {}
      app.quit();
      return;
    }

    win.loadURL('http://127.0.0.1:' + LOCAL.APP_PORT + '/' + LOCAL.APP_FILE);

    /* keep the copy current so a deploy reaches this station without anyone doing anything */
    setInterval(() => { LOCAL.refreshCache(cfg.hubUrl, dir, log).catch(() => {}); }, 10 * 60 * 1000);

    /* 💾 this station's own restorable copy. First one 3 minutes in, so a station that is only ever on
       briefly still produces one. */
    const snapMs = Math.max(1, Number(cfg.snapshotEveryHours) || 6) * 3600 * 1000;
    setTimeout(snapshotLocalDb, Math.max(5, Number(cfg.firstSnapshotSec) || 180) * 1000);
    setInterval(snapshotLocalDb, snapMs);
  }

  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', () => { if (agent) { try { agent.kill(); } catch (e) {} } });
}
