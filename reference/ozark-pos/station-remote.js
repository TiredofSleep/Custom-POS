#!/usr/bin/env node
/* ============================================================================================
   🛠 CHANGE A STATION'S SETTINGS WITHOUT STANDING AT IT. Run on the droplet.

   Owner, 2026-08-15: "do we have a backdoor to actually work on these systems now at each station without
   having to be at each computer? that seems worth building into our app".

   ⚠️ SETTINGS ONLY — NEVER A COMMAND. The owner chose that level knowingly over "run this on that PC",
   which would have made one leaked hub key equal to full control of every machine in the business,
   including the ones that take cards. This tool cannot fix a problem nobody anticipated. That is the trade.
   ⚠️ hubUrl AND hubKey ARE REFUSED, by the hub and again by the shell. Repointing a station at another hub
   would hand over the whole shop on its next sync.
   ⚠️ A station only picks this up if it runs the shell from 2026-08-15 or later. The three stations
   installed on 8/14 need one more visit each (re-run the installer) before they can be managed remotely.

   usage:
     node station-remote.js                                    what every station wants and has applied
     node station-remote.js WS-MQQOMYXSGMH stationId=WS-MQQOMYXSGMH
     node station-remote.js WS-… storeScope=all printAgent=true
     node station-remote.js WS-… --restart          (waits for an idle screen on that station)
     node station-remote.js WS-… --recache          (re-fetch the app from the hub)
     node station-remote.js --log 20                the append-only record of who changed what
   ============================================================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');

const HERE = fs.existsSync('/opt/ozark') ? '/opt/ozark' : __dirname;
const PORT = process.env.OZARK_PORT || 8090;

function hubKey(){
  try {
    const env = fs.readFileSync(path.join(HERE, 'hub.env'), 'utf8');
    const m = env.match(/^OZARK_HUB_KEY=(.*)$/m);
    return m ? m[1].trim() : '';
  } catch (e) { return ''; }
}
function call(method, p, body){
  return new Promise((resolve, reject) => {
    const data = body ? Buffer.from(JSON.stringify(body)) : null;
    const rq = http.request({ host: '127.0.0.1', port: PORT, path: p, method,
      headers: Object.assign({ 'x-ozark-key': hubKey(), 'x-ozark-device': 'station-remote' },
        data ? { 'Content-Type':'application/json', 'Content-Length': data.length } : {}) },
      r => { let b=''; r.on('data', c => b += c); r.on('end', () => {
        try { resolve(JSON.parse(b)); } catch (e) { reject(new Error('hub said: ' + b.slice(0,200))); } }); });
    rq.on('error', reject);
    if (data) rq.write(data);
    rq.end();
  });
}
const when = ms => ms ? new Date(ms).toLocaleString('en-US', { timeZone: 'America/Chicago',
  month:'numeric', day:'numeric', hour:'numeric', minute:'2-digit' }) : '—';

(async () => {
  const args = process.argv.slice(2);

  if (args[0] === '--log') {
    const n = Number(args[1] || 20);
    let lines = [];
    try { lines = fs.readFileSync(path.join(HERE, 'hub-data', 'station-config-log.jsonl'), 'utf8')
      .split(/\n/).filter(Boolean).slice(-n); } catch (e) { console.log('no changes recorded yet'); return; }
    console.log('\n🛠 STATION SETTINGS — the append-only record\n');
    lines.forEach(l => { try { const d = JSON.parse(l);
      console.log('   ' + when(d.at).padEnd(17) + String(d.id).padEnd(17) + String(d.kind).padEnd(15) +
        JSON.stringify(d.detail || d.running || '').slice(0, 70) + (d.by ? '  by ' + d.by : '')); } catch (e) {} });
    console.log('');
    return;
  }

  if (!args.length || args[0].indexOf('WS-') !== 0) {
    const r = await call('GET', '/api/station-config');
    const all = r.stations || {};
    console.log('\n🛠 STATIONS — what the hub wants, and what each has applied\n');
    const ids = Object.keys(all);
    if (!ids.length) console.log('   nothing set for any station yet.');
    ids.forEach(id => {
      const s = all[id];
      console.log('── ' + id + (s.by ? '   (last set by ' + s.by + ' ' + when(s.at) + ')' : ''));
      if (s.want) console.log('   wants   : ' + JSON.stringify(s.want));
      if (s.applied) console.log('   applied : ' + JSON.stringify(s.applied) + '   ' + when(s.appliedAt));
      if (s.restartAt) console.log('   restart requested ' + when(s.restartAt));
      if (s.lastError) console.log('   ⚠️ last error: ' + s.lastError);
      if (s.codeMismatchAt) console.log('   ⚠️ running app ' + s.codeSha + ' — NOT what the hub serves (' + when(s.codeMismatchAt) + ')');
      console.log('');
    });
    console.log('to set:   node station-remote.js WS-… storeScope=all printAgent=true');
    console.log('history:  node station-remote.js --log 20\n');
    return;
  }

  const id = args[0];
  const want = {}; let restart = false, recache = false;
  args.slice(1).forEach(a => {
    if (a === '--restart') { restart = true; return; }
    if (a === '--recache') { recache = true; return; }
    const i = a.indexOf('=');
    if (i < 0) { console.log('⚠️ ignoring "' + a + '" — expected key=value'); return; }
    const k = a.slice(0, i); let v = a.slice(i + 1);
    if (v === 'true') v = true; else if (v === 'false') v = false;
    else if (v !== '' && !isNaN(Number(v)) && k !== 'stationId' && k !== 'stationName') v = Number(v);
    else if (v.charAt(0) === '{' || v.charAt(0) === '[') { try { v = JSON.parse(v); } catch (e) {} }
    want[k] = v;
  });

  const r = await call('POST', '/api/station-config', { id, want, restart, recache, by: process.env.USER || 'owner' });
  if (!r.ok) { console.log('⚠️ ' + (r.error || 'refused')); process.exit(1); }
  console.log('\n✅ queued for ' + id);
  if (Object.keys(want).length) console.log('   wants: ' + JSON.stringify(r.want));
  if (restart) console.log('   restart: it will wait until nobody is mid-task on that screen');
  if (recache) console.log('   re-fetch the app: on the next heartbeat');
  if (r.refused && r.refused.length) console.log('   ⛔ REFUSED (never settable remotely): ' + r.refused.join(', '));
  console.log('\n   The station applies this within about a minute, then reports back what it actually did.');
  console.log('   Check:  node station-remote.js\n');
})().catch(e => { console.error('failed: ' + e.message); process.exit(1); });
