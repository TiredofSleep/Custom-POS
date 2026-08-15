/* ============================================================================================
   🔑 PRELOAD — the shell hands this machine's settings to the app before the app's own code runs.

   ⚠️ THIS IS THE POINT OF THE WHOLE SHELL. Everything below currently lives in `localStorage`, which is why
   a station could silently become Hot Springs, and why a browser reset means somebody has to re-connect a
   workstation by hand. The shell owns these facts on disk; the app keeps reading them exactly where it
   always has, so `Ozark-POS.html` needs no change at all.

   ⚠️ IT ONLY EVER FILLS A BLANK. If a value is already set in the page, the shell leaves it alone — a person
   who changed something on this machine outranks a config file, the same rule stationAdopt() follows in the
   app. The one exception is the hub key, which the shell is authoritative for because it is the thing a
   browser reset destroys.
   ============================================================================================ */
'use strict';
const { ipcRenderer } = require('electron');

try {
  const cfg = ipcRenderer.sendSync('station-config') || {};

  const fill = (k, v, force) => {
    if (v === undefined || v === null || v === '') return;
    try { if (force || !localStorage.getItem(k)) localStorage.setItem(k, String(v)); } catch (e) {}
  };

  /* the hub key — the shell is authoritative, because losing it is the failure this replaces */
  fill('ozarkpos_huk', cfg.hubKey, true);

  /* 🆔 THIS MACHINE'S IDENTITY — the shell is authoritative, and that is a correction.
     ⚠️ This used to only fill a blank, and the hub caught it: three device records named "Brayden's PC
     (shell)" in one evening, because each storage move minted a new id and abandoned the old record. A
     ghost in the device registry looks exactly like a real station that has gone quiet, and that registry
     is how a station on a stale build gets found at all. See the banner over stationId() in main.js.
     ⚠️ THE CONFIG DECIDES; THE PAGE IS ONLY A CACHE. An earlier version let the page win once, on the idea
     that installing over a counter which had run in Chrome for weeks should keep that station's history.
     ⚠️ ONE DAY OF FIELD EVIDENCE KILLED THAT IDEA, in both directions:
       · It cannot work. The shell serves the app from http://127.0.0.1:17817 — a different ORIGIN from the
         hub's address — and localStorage is per-origin, so on a migration the page ALWAYS opens empty and
         there is never a real id to inherit. Measured 2026-08-14: Assembly and Arkadelphia each ended up
         with a SECOND device record anyway.
       · And it actively caused harm. Launch the shell once BEFORE the hub key is pasted and the page mints
         a throwaway id; "the page wins once" then cemented that throwaway as the station's permanent
         identity. The Arkadelphia counter hit exactly this and had to be undone by hand.
     So a station's identity comes from station.json and nowhere else. Put the station's EXISTING hub id
     there before the first launch — INSTALL-THE-DESKTOP-APP.md says so — and the trap cannot happen. */
  if (cfg.stationName) {
    try {
      const cur = JSON.parse(localStorage.getItem('ozarkpos_ws') || 'null');
      const id = cfg.stationId || (cur && cur.id);      /* the CONFIG decides; the page is only a cache */
      if (id && (!cur || cur.id !== id || cur.name !== cfg.stationName)) {
        localStorage.setItem('ozarkpos_ws', JSON.stringify({ id: id, name: cfg.stationName }));
      }
    } catch (e) {}
  }

  /* 🪟 ONE WINDOW, ENFORCED BY THE OPERATING SYSTEM RATHER THAN AGREED BETWEEN TABS.
     ⚠️ Owner, 2026-08-14, looking at the second-window banner: "can we harden that out and force one window
     open at a time?" In a browser the app cannot close another tab, which is why it has a whole election.
     Here a second launch never becomes a window at all — requestSingleInstanceLock() sends it to focus the
     one already running. So the page is told, and a machine where a second window is IMPOSSIBLE stops
     warning about one. Forced every launch: this is a fact about the shell, not a preference a page keeps. */
  fill('ozarkpos_solo', '1', true);

  /* store scope — 'all' for the plant, a store id otherwise */
  if (cfg.storeScope === 'all') { fill('ozarkpos_allstores', '1'); }
  else if (cfg.storeScope) { fill('ozarkpos_store', String(cfg.storeScope)); fill('ozarkpos_allstores', '0'); }

  /* 🖨 AUTO-PRINT IS OFF UNLESS THIS MACHINE HAS A RECEIPT PRINTER.
     Owner, 2026-08-13: "this pc has a regular printer, i should be asked if i want to print, no auto-print
     on this machine." With the agent off, the app falls through to its print box and Windows asks — which is
     the right behaviour on a desk, and the wrong behaviour on a counter where nobody wants a dialog between
     them and a customer. It is one line of config per station rather than a code path. */
  fill('ozarkpos_useagent', cfg.printAgent ? '1' : '0', true);
} catch (e) { /* a preload that throws must never stop the POS from loading */ }
