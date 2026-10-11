#!/usr/bin/env node
/* ============================================================================================
   🆔 THE STATION-IDENTITY TEST — run: node test-preload.js

   ⚠️ WHY THIS EXISTS. The hub grew THREE device records for one machine in one evening —
   WS-MSS5QFPEQHN, WS-SHELL-AVH6JJ, WS-SHELL-Z3IXXR — because the preload only ever filled a BLANK, so
   every storage move minted a fresh identity and abandoned the old record. A ghost record is
   indistinguishable from a real station that has gone quiet (same frozen lastSeen, same frozen build), and
   that registry is the instrument this project uses to find a station running a stale build. It is also
   where the hub picks the station that runs the automatic jobs.

   ⚠️ IT LOADS THE REAL preload.js, not a copy of its logic. A test that re-implements what it is testing
   proves only that the author is consistent with himself. `electron` is shimmed because there is no
   Electron here — everything else is the shipped file.

   The three cases are the three things that actually happen to a station:
     1. a wipe        — packaging change / reinstall / cleared profile  → the SAME id comes back
     2. an install    — over a station that has been running in Chrome  → its history is ADOPTED, not orphaned
     3. an ordinary   — restart with nothing changed                    → nothing is written at all
   ============================================================================================ */
'use strict';
const path = require('path');
const Module = require('module');

let pass = 0, fail = 0;
function check(what, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log('  ✅ ' + what); }
  else { fail++; console.log('  ❌ ' + what + '\n       got  ' + JSON.stringify(got) + '\n       want ' + JSON.stringify(want)); }
}

/* the shim: require('electron') inside preload.js gets this instead */
let ADOPTED = [];
let STORE = {};
const fakeElectron = {
  ipcRenderer: {
    sendSync(channel, arg) {
      if (channel === 'station-config') return fakeElectron.__cfg;
      if (channel === 'station-adopt-id') { ADOPTED.push(arg); return true; }
      return null;
    }
  }
};
const realLoad = Module._load;
Module._load = function (req, parent, isMain) {
  if (req === 'electron') return fakeElectron;
  return realLoad.apply(this, arguments);
};

global.localStorage = {
  getItem(k) { return Object.prototype.hasOwnProperty.call(STORE, k) ? STORE[k] : null; },
  setItem(k, v) { STORE[k] = String(v); },
  removeItem(k) { delete STORE[k]; }
};

/* ⚠️ THE OVERRIDE EXISTS FOR THE NEGATIVE CONTROL. A test that cannot fail is not evidence, so this was
   pointed at a copy carrying the OLD fill-a-blank logic and cases 1 and 4 failed, which is what proves the
   assertions are pinned to the behaviour and not to the sunshine. */
const PRELOAD = process.env.OZARK_PRELOAD ? path.resolve(process.env.OZARK_PRELOAD) : path.join(__dirname, 'preload.js');
function runPreload(cfg, storage) {
  ADOPTED = []; STORE = Object.assign({}, storage || {});
  fakeElectron.__cfg = cfg;
  delete require.cache[require.resolve(PRELOAD)];
  require(PRELOAD);
  return { store: STORE, adopted: ADOPTED };
}

const CFG = { hubKey: 'HUBKEYVALUE', hubUrl: 'https://hub.example.com', stationName: 'Arkadelphia Counter',
              stationId: 'WS-SHELL-ABC123', storeScope: 1, printAgent: true };
const ws = r => JSON.parse(r.store.ozarkpos_ws || 'null');

console.log('\n1 · a wiped profile gets THIS MACHINE\'S id back, not a new one');
{
  const r = runPreload(CFG, {});                       /* nothing in storage — the packaging-change case */
  check('the shell\'s id is restored', ws(r).id, 'WS-SHELL-ABC123');
  check('the station is named', ws(r).name, 'Arkadelphia Counter');
  check('nothing was adopted (there was nothing to adopt)', r.adopted, []);
  check('the hub key is filled in', r.store.ozarkpos_huk, 'HUBKEYVALUE');
}

console.log('\n2 · THE CONFIG DECIDES — a page id never overrules station.json');
{
  /* ⚠️ This case used to assert the OPPOSITE, and it was wrong. It pinned "the page wins once", which was
     meant to let a station migrating from Chrome keep its history — a thing that cannot happen, because the
     shell serves a different ORIGIN and localStorage is per-origin, so a migrating page opens EMPTY. What
     the rule did instead was cement a throwaway id minted during an unconnected first launch. See case 4.
     A test locks in a mistake exactly as firmly as a fix; this one did, for one day. */
  const had = { ozarkpos_ws: JSON.stringify({ id: 'WS-MQQOMYXSGMH', name: 'Arkadelphia Counter' }) };
  const r = runPreload(CFG, had);
  check('the configured id wins over whatever the page was carrying', ws(r).id, 'WS-SHELL-ABC123');
  check('and nothing is handed back to the shell to write down', r.adopted, []);
}

console.log('\n3 · an ordinary restart changes nothing');
{
  const had = { ozarkpos_ws: JSON.stringify({ id: 'WS-SHELL-ABC123', name: 'Arkadelphia Counter' }) };
  const r = runPreload(CFG, had);
  check('the id is unchanged', ws(r).id, 'WS-SHELL-ABC123');
  check('nothing is adopted', r.adopted, []);
}

console.log('\n4 · THE REGRESSION THE ARKADELPHIA COUNTER ACTUALLY HIT');
{
  /* ⚠️ 2026-08-14, at the counter. The shell was launched ONCE before the hub key was pasted. The page
     minted a throwaway id, and the rule this test used to pin — "the page wins once, the shell wins forever
     after" — wrote that throwaway into station.json as the station's PERMANENT identity, registering a
     second device on the hub. It had to be undone by hand: clear the page storage, write the real id back.
     ⚠️ The rule existed to let a station migrating from Chrome keep its history, and it CANNOT do that: the
     shell serves a different ORIGIN, localStorage is per-origin, so a migrating page always opens empty.
     A capability that never worked, and a trap that did. The config decides now. */
  const unconnected = Object.assign({}, CFG); delete unconnected.stationId; delete unconnected.hubKey;
  runPreload(unconnected, {});                                    /* launched with no key: page mints its own */
  const pageMinted = { ozarkpos_ws: JSON.stringify({ id: 'WS-SHELL-THROWAWAY', name: CFG.stationName }) };

  const fixed = Object.assign({}, CFG, { stationId: 'WS-MQQOS70YF2R' });   /* the counter's REAL hub id */
  const r = runPreload(fixed, pageMinted);
  check('writing the real id into station.json is enough to take the identity back', ws(r).id, 'WS-MQQOS70YF2R');
  check('⚠️ ...and nothing hands the throwaway back to the config to undo it', r.adopted, []);

  const again = runPreload(fixed, { ozarkpos_ws: JSON.stringify({ id: 'WS-MQQOS70YF2R', name: CFG.stationName }) });
  check('...and it stays taken on the next launch', ws(again).id, 'WS-MQQOS70YF2R');

  const afterWipe = runPreload(fixed, {});
  check('...and through a storage wipe, which is what this whole file is about', ws(afterWipe).id, 'WS-MQQOS70YF2R');
}

console.log('\n5 · a renamed station keeps its id (a name is not an identity)');
{
  const had = { ozarkpos_ws: JSON.stringify({ id: 'WS-SHELL-ABC123', name: 'Old Name' }) };
  const r = runPreload(CFG, had);
  check('the new name is taken', ws(r).name, 'Arkadelphia Counter');
  check('the id survives the rename', ws(r).id, 'WS-SHELL-ABC123');
}

console.log('\n6 · a shell with no id of its own falls back to the page rather than blanking it');
{
  const cfg = Object.assign({}, CFG); delete cfg.stationId;
  const had = { ozarkpos_ws: JSON.stringify({ id: 'WS-REAL-1', name: 'Arkadelphia Counter' }) };
  const r = runPreload(cfg, had);
  check('the page\'s id is left intact', ws(r).id, 'WS-REAL-1');
  /* ⚠️ falling back is fine; WRITING IT DOWN was the trap, because it made a throwaway permanent */
  check('⚠️ but it is NOT written back into the config', r.adopted, []);
}

console.log('');
console.log('7 · 🛣 THE PAGE IS TOLD WHERE THE HUB IS, so it calls the hub DIRECTLY');
{
  /* ⚠️ 2026-08-19. The shell proxied /api/* and stripped `accept-encoding` on the way, so every station
     pulled 5,018 KB instead of 427 KB per sync — 11.7x — which is why the desktop app felt slower than
     Chrome and why the watchdog then killed a starved shell with somebody mid-edit. The permanent answer is
     not a better proxy: it is not to sit in the middle. The shell tells the page the hub's real address and
     Chromium does its own compression, connection reuse and HTTP/2. */
  const r = runPreload(CFG, {});
  check('the hub address is handed to the page', r.store.ozarkpos_hubapi, 'https://hub.example.com');

  /* ⚠️ FORCED, like the hub key: this is a fact about the machine and the shell owns those. A page that kept
     a stale address after the hub moved would be a station nobody could fix without clearing its storage. */
  const stale = runPreload(CFG, { ozarkpos_hubapi: 'https://an-old-address.example.com' });
  check('⚠️ ...and it OVERRULES a stale address the page was carrying', stale.store.ozarkpos_hubapi, 'https://hub.example.com');

  /* ⚠️ A shell with no hubUrl configured must not write an empty string — hubApiBase() then falls back to the
     page's own origin, which is the proxy, which is the right answer for a station set up that way. */
  const none = Object.assign({}, CFG); delete none.hubUrl;
  const r2 = runPreload(none, {});
  check('a shell with no hub address writes nothing, so the page keeps using the proxy', r2.store.ozarkpos_hubapi, undefined);
}

console.log('');
console.log('8 · 🔌 THE SEAM ITSELF — every field the preload reads must actually cross it');
{
  /* ⚠️ THIS SECTION EXISTS BECAUSE EVERY OTHER ASSERTION IN THIS FILE IS BLIND TO THE REAL BUG.
     The direct-to-hub change (2026-08-19) shipped a preload reading `cfg.hubUrl` while main.js's
     station-config handler did not send it. The whole change was INERT on a real station, and case 7 above
     passed anyway -- because this file SHIMS electron and hands the preload a config object of its own
     making. A mock cannot fail the way the seam fails. Found by reading main.js, not by a gate.
     So: read what the preload really asks for, read what main.js really answers with, and compare. */
  const fs = require('fs'), path = require('path');
  const src = fs.readFileSync(PRELOAD, 'utf8');
  const main = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8');

  const wants = [];
  src.replace(/cfg\.([A-Za-z_$][A-Za-z0-9_$]*)/g, function(_, k){ if (wants.indexOf(k) < 0) wants.push(k); return _; });
  check('the preload asks for a plausible number of fields (a scrape that finds none proves nothing)',
    wants.length >= 4 && wants.length <= 20, true);

  const at = main.indexOf("ipcMain.on('station-config'");
  check('main.js still answers the station-config channel', at > 0, true);
  const reply = main.slice(at, at + 500);

  const missing = wants.filter(function(k){ return reply.indexOf(k + ':') < 0; });
  check('⚠️ main.js sends every field the preload reads' + (missing.length ? ' -- MISSING ' + missing.join(', ') : ''),
    missing.length, 0);

  /* the one this section was written for, pinned by name so a rename cannot quietly drop it */
  check('⚠️ ...including hubUrl, which is what makes the page call the hub directly', reply.indexOf('hubUrl:') > 0, true);
}

Module._load = realLoad;
console.log('\n══ ' + pass + ' passed, ' + fail + ' failed ══\n');
process.exit(fail ? 1 : 0);
