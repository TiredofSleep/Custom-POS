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

const CFG = { hubKey: 'HUBKEYVALUE', stationName: 'Arkadelphia Counter', stationId: 'WS-SHELL-ABC123',
              storeScope: 1, printAgent: true };
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

Module._load = realLoad;
console.log('\n══ ' + pass + ' passed, ' + fail + ' failed ══\n');
process.exit(fail ? 1 : 0);
