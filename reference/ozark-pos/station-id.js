#!/usr/bin/env node
/* ============================================================================================
   🆔 WHICH DEVICE ID IS THIS STATION? — read-only, run before installing the desktop app.

   ⚠️ WHY THIS EXISTS. `station.json` must carry the station's EXISTING hub id or the machine gets a brand
   new identity and the hub ends up with two rows for it — build history, mirror registration and scope all
   split in half. That happened at the Arkadelphia counter on 2026-08-14.

   ⚠️ AND "LOOK IT UP" IS NOT AS SIMPLE AS IT SOUNDS, which is the real reason this is a tool and not a
   sentence in a guide. A station NAME can have several records: a second window opened once, a browser
   profile reset, a machine replaced. Hot Springs Counter has TWO — one first seen 6/29 and active all day,
   one first seen 7/16 that had been quiet since 8/10 — and on 8/14 the install picked the quiet one, from a
   note in CLAUDE.md rather than from the records. Nothing broke. But nobody could say which was "the
   counter" without reading three documents, and that is exactly the kind of question a machine should
   answer from evidence.

   It states what it knows and REFUSES TO CHOOSE when the answer is genuinely ambiguous, because a confident
   wrong answer here is worse than a question: it gets written into a config file and lives for months.

   usage:  node station-id.js                 (every station, grouped by name)
           node station-id.js "Hot Springs"   (just the ones matching)
   ============================================================================================ */
'use strict';
const fs = require('fs');
const path = require('path');

const HERE = fs.existsSync('/opt/ozark') ? '/opt/ozark' : __dirname;
const FILE = path.join(HERE, 'hub-data', 'ozark-db.json');

let raw;
try { raw = JSON.parse(fs.readFileSync(FILE, 'utf8')); }
catch (e) {
  console.error('cannot read ' + FILE + ' — run this on the droplet (ssh … "node /opt/ozark/station-id.js")');
  process.exit(2);
}
/* ⚠️ the live file is {rev, db:{...}} and a script that reads raw.customers finds nothing and says so
   cheerfully. That exact mistake answered "no customer matched" on 8/13. Unwrap, then refuse a short read. */
const db = raw.db || raw;
const devices = db.devices || [];
if (!devices.length) { console.error('no device records found — refusing to report on an empty read'); process.exit(2); }

const want = (process.argv[2] || '').toLowerCase();
const when = ms => ms ? new Date(ms).toLocaleString('en-US', { timeZone: 'America/Chicago',
  month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—';
const days = ms => ms ? Math.floor((Date.now() - ms) / 86400000) : 9999;

const byName = {};
devices.forEach(d => {
  const n = String(d.name || '(unnamed)');
  if (want && n.toLowerCase().indexOf(want) < 0) return;
  (byName[n] = byName[n] || []).push(d);
});

const names = Object.keys(byName).sort();
if (!names.length) { console.log('no station matched "' + process.argv[2] + '"'); process.exit(1); }

console.log('');
console.log('🆔 STATION IDENTITIES — put the chosen id in station.json BEFORE the first launch');
console.log('');

names.forEach(name => {
  const rows = byName[name].slice().sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0));
  console.log('── ' + name + (rows.length > 1 ? '   ⚠️ ' + rows.length + ' RECORDS SHARE THIS NAME' : ''));
  rows.forEach(d => {
    console.log('   ' + String(d.id).padEnd(17) +
      String(d.type || '?').padEnd(13) +
      ('store=' + (d.allStores ? 'all' : d.store)).padEnd(10) +
      'first ' + when(d.firstSeen).padEnd(16) +
      'last ' + when(d.lastSeen).padEnd(16) +
      (d.appRev ? String(d.appRev).slice(0, 12) : '(never reported a build)'));
  });

  /* ⚠️ UNNAMED RECORDS ARE NOT A STATION. Grouping them by the empty string put a route PHONE and a counter
     PC under one heading and then recommended one of them — a tool inventing a station that does not exist.
     Caught on its own first run against real data. */
  if (name === '(unnamed)') {
    console.log('   ⚠️ these have no name; they are separate machines that were never named, not one station.');
    console.log('      Name them (Admin → Settings → this device) before treating any of them as an identity.');
    console.log('');
    return;
  }

  if (rows.length === 1) { console.log('   ✅ use ' + rows[0].id); console.log(''); return; }

  /* ⚠️ THE THROWAWAY FINGERPRINT: a WS-SHELL-* record whose first and last sighting are minutes apart and
     which never came back. That is a shell launched once BEFORE the hub key was pasted — the trap the
     Arkadelphia counter hit on 8/14. Recognising it is what lets this tool answer instead of punting, and it
     is deliberately narrow: only the shell's own prefix, only a lifetime under 15 minutes, and only when a
     record with a LONGER history shares the name. Everything else stays a question. */
  const oldest = Math.min.apply(null, rows.map(d => d.firstSeen || Date.now()));
  const throwaway = d => /^WS-SHELL-/.test(String(d.id)) &&
    ((d.lastSeen || 0) - (d.firstSeen || 0)) < 15 * 60000 &&
    (d.firstSeen || 0) > oldest;
  const ghosts = rows.filter(throwaway);
  const real = rows.filter(d => !throwaway(d));
  ghosts.forEach(g => console.log('   ⚠️ ' + g.id + ' looks like a THROWAWAY — seen once, for ' +
    Math.max(1, Math.round(((g.lastSeen || 0) - (g.firstSeen || 0)) / 60000)) +
    ' minute(s), never again. That is a shell launched before its hub key was pasted.'));

  const live = real.filter(d => days(d.lastSeen) < 2);
  if (real.length === 1) {
    console.log('   ✅ use ' + real[0].id + ' — the only record that is not a throwaway');
  } else if (live.length === 1) {
    console.log('   ✅ use ' + live[0].id + ' — the only one active in the last 48 hours');
    console.log('      the others have been quiet for ' + real.filter(d => d !== live[0])
      .map(d => days(d.lastSeen) + 'd').join(', ') + '; they are almost certainly a second window or an old profile');
  } else {
    console.log('   ⚠️ CANNOT CHOOSE FOR YOU — ' + live.length + ' of these were active in the last 48 hours.');
    console.log('      A name alone does not identify a machine. Decide from what the station was DOING:');
    console.log('      the one with the longer continuous history is usually the counter itself; a record');
    console.log('      that appeared later and went quiet is usually a second window somebody left open.');
    console.log('      ⚠️ Whichever you pick, the other becomes a permanent second row for that machine.');
  }
  console.log('');
});

console.log('Then:  "stationId": "WS-…"  in %APPDATA%\\OzarkPOS\\station.json, before the first launch.');
console.log('⚠️ Do NOT write that file with PowerShell — it adds a UTF-8 BOM and the shell silently falls');
console.log('   back to first-run defaults. See INSTALL-THE-DESKTOP-APP.md.');
console.log('');
