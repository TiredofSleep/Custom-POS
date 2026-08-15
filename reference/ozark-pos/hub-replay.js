#!/usr/bin/env node
/* hub-replay.js — rebuild the database at ANY revision from a checkpoint plus the delta log.
 *
 *   node hub-replay.js                      # rebuild the LATEST revision, compare it to the live file, report
 *   node hub-replay.js --rev 18830          # rebuild that exact revision
 *   node hub-replay.js --rev 18830 --out /tmp/rebuilt.json
 *   node hub-replay.js --verify             # rebuild latest and PROVE it matches ozark-db.json, exit 1 if not
 *
 * ⚠️ IT NEVER WRITES TO THE LIVE DATABASE. Output goes to --out or to hub-data/rebuilt-<rev>.json. Restoring is
 * a deliberate, separate act by a human: stop the service, copy the rebuilt file over ozark-db.json, start it.
 *
 * WHY THIS EXISTS. Phase 4 stopped writing a full timestamped snapshot on every push (three full-size writes per
 * push was the ceiling that got worse with every order the shop took) and writes CHECKPOINTS on an interval
 * instead. That is only safe if every revision BETWEEN checkpoints is still recoverable — which is this tool.
 * Restore granularity actually improves: before, the last 30 pushes; now, any revision in the log.
 *
 * REPLAY IS UPSERT-BY-KEY FOR RECORDS, PLUS EXACTLY ONE RULE FOR TOMBSTONES.
 * For records it really is just "lay each revision down in order": the log holds what the HUB ALREADY DECIDED,
 * so hubMerge had already compared stamps and applied the one-way STATUS_RANK law before those records were
 * written. Re-deciding them here would be a second copy of the merge logic, and a second thing to drift.
 * ⚠️ BUT THAT REASONING DOES NOT EXTEND TO TOMBSTONES, and I shipped it claiming it did. A tombstone is
 * PERMANENT and rides every delta it appears in, so its presence in a revision is NOT evidence that the hub
 * deleted anything at that revision. Live data caught it: a July `upcharges` tombstone rode a delta and this
 * tool removed a record the hub was rightly keeping, because that record had been re-created afterwards with a
 * newer stamp. See `apply()` — the tombstone wins only if it is at least as new as the record, via stampScale.
 * The lesson worth keeping: "the hub already decided" is true of the records in a delta and false of the
 * tombstones in it.
 */
const fs = require('fs'), path = require('path');

const DATADIR = path.join(__dirname, 'hub-data');
const BACKUPS = path.join(DATADIR, 'backups');
const DBFILE  = path.join(DATADIR, 'ozark-db.json');
const DELTALOG = path.join(DATADIR, 'delta-log.jsonl');

/* the same key map the hub uses. If these ever disagree, the rebuild would silently key records wrongly, so
   test-hub.js asserts this list matches hub-server.js's HUB_KEYS_FOR_SEQ exactly. */
const KEYS = { prices:'id', upcharges:'id', employees:'id', customers:'id', orders:'id', payments:'id',
  ledger:'id', timeclock:'id', timeAcks:'id', timeOff:'id', routeLog:'id', checklist:'id', supplies:'id',
  devices:'id', voidRequests:'id', refundRequests:'id', batches:'id', collections:'id', supplyOrders:'id',
  garments:'hsl' };
/* ⚠️ WHAT THE LOG DOES NOT CARRY — stated out loud, because a rebuild that quietly ignores a collection is
   the same sin as an error rendering as good news.
   DERIVED, NOT LISTED. I first hard-coded activity and devices, and smsLog surfaced on the very next run — then
   hslLog, inventoryLog, payVac and support behind it. Enumerating them by hand means discovering each one as a
   scary red FAIL during a real restore. The rule is structural: `deltaSince` can only ever send what is in the
   hub's HUB_KEYS_FOR_SEQ, its two maps, or its three scalars. Anything else in the database is, by construction,
   not in the log.
   Live on 2026-08-11 that is: activity (6,000 rows), smsLog, hslLog, inventoryLog, support, payVac.
   ⚠️ DEVICES IS THE ONE EXCEPTION THAT IS IN THE KEY MAP AND STILL NOT CARRIED. The hub mutates device records
   itself on every push (markPushingDevice: lastSeen, appRev, pageAt, hubPushAt) and it mutates them IN PLACE on
   an object shared with the pre-merge copy — so seqStamp compares the record against itself, sees no change, and
   never assigns a new _seq. Proven live: WS-MQQOMYXSGMH moved five fields while its _seq stayed at 19598.
   Everything that is MONEY or CLOTHES — orders, customers, payments, ledger, collections, garments, prices,
   upcharges — IS in the key map and IS carried, and a difference in any of those is a real failure.
   test-hub.js asserts exactly that, so this can never quietly start excusing one of them. */
const WHY_UNCOVERED = {
  activity: 'recover from hub-data/activity-archive.jsonl — append-only and never trimmed',
  smsLog:   'recover from hub-data/sms-archive.jsonl — append-only and never trimmed',
  devices:  'hub-maintained bookkeeping, mutated in place so it never gets a new _seq — rebuilds from the checkpoint and re-populates as stations check in'
};
function logCovers(k){
  if (k === 'devices') return false;                    // in the key map, but see above
  return !!KEYS[k] || MAPS.indexOf(k) >= 0 || SCALARS.indexOf(k) >= 0;
}
function whyUncovered(k){ return WHY_UNCOVERED[k] || 'not in the hub HUB_KEYS_FOR_SEQ, so deltaSince can never include it — it comes from the checkpoint'; }
const MAPS = ['drawers', 'checklistDone'];
const SCALARS = ['settings', 'baseline', 'seq'];

/* <STAMP-SCALE v1> — the same promotion the app and the hub use. Kept in step by test-hub.js. */
function stampScale(v){ v = Number(v) || 0; if (v <= 0) return 0;
  return (v < 1e14) ? (v * 1000) : v; }
/* </STAMP-SCALE v1> */

const arg = n => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : null; };
const has = n => process.argv.indexOf(n) >= 0;

/* read the log, tolerating a torn final line — a half-written last line must never make the record unusable */
function logRead(){
  let txt = ''; try { txt = fs.readFileSync(DELTALOG, 'utf8'); } catch (e) { return []; }
  const out = [], lines = txt.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i].trim(); if (!ln) continue;
    try { out.push(JSON.parse(ln)); }
    catch (e) {
      const restBlank = lines.slice(i + 1).join('').trim() === '';
      if (restBlank) { console.log('  ⚠ last log line is torn (process died mid-write) — ignoring it'); break; }
      console.log('  ⚠ log line ' + (i + 1) + ' unreadable — skipped');
    }
  }
  out.sort((a, b) => (+a.rev || 0) - (+b.rev || 0));
  return out;
}

/* every checkpoint we could start from, newest first, with the revision each one holds */
function checkpoints(){
  let names = []; try { names = fs.readdirSync(BACKUPS); } catch (e) { return []; }
  const out = [];
  for (const n of names) {
    if (!/^ozark-\d{8}-\d{6}\.json$/.test(n)) continue;             // only the hub's own stamped snapshots
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(BACKUPS, n), 'utf8'));
      if (raw && raw.__meta && raw.db) out.push({ file: n, rev: +raw.__meta.rev || 0, savedAt: +raw.__meta.savedAt || 0 });
    } catch (e) {}
  }
  out.sort((a, b) => b.rev - a.rev);
  return out;
}

function apply(db, entry){
  const inc = entry.db || {};
  for (const coll in KEYS) {
    if (!Array.isArray(inc[coll])) continue;
    const key = KEYS[coll];
    if (!Array.isArray(db[coll])) db[coll] = [];
    const at = {};                                     // index once per collection, not once per record
    db[coll].forEach((r, i) => { if (r && r[key] != null) at[String(r[key])] = i; });
    for (const r of inc[coll]) {
      if (!r || r[key] == null) continue;
      const k = String(r[key]), i = at[k];
      if (i === undefined) { at[k] = db[coll].length; db[coll].push(r); } else { db[coll][i] = r; }
    }
  }
  for (const k of MAPS)    if (inc[k] !== undefined) db[k] = inc[k];
  for (const k of SCALARS) if (inc[k] !== undefined) db[k] = inc[k];
  /* a tombstone is the ONLY thing that removes a record — same law as the hub.
     ⚠️ THE FIELDS ARE c / k / t, NOT coll / id. I guessed coll/id and test-hub.js caught it immediately: the
     rebuild silently kept every deleted record, because no tombstone ever matched anything. A delete that does
     not replay is a deleted customer coming back to life on a restore.
     The hub's own rule (hubMergeArr) is "remove the record if the tombstone's stamp is newer than the record's".
     That comparison is NOT repeated here on purpose — the hub already made it when it produced this revision, so
     the record is either present in the log (it won) or absent (the tombstone won). Replay lays down the answer;
     re-deciding it is how a rebuild would drift from the hub. */
  const tomb = Array.isArray(entry._tomb) ? entry._tomb : [];
  if (tomb.length) {
    db._tomb = Array.isArray(db._tomb) ? db._tomb : [];
    const seen = {}; db._tomb.forEach(t => { if (t) seen[String(t.c) + '|' + String(t.k)] = t; });
    for (const t of tomb) {
      if (!t || !t.c || t.k == null) continue;
      const coll = t.c, key = KEYS[coll] || 'id';
      /* ⚠️ THE ONE RULE THIS TOOL DOES HAVE TO KNOW, and I was wrong to claim otherwise.
         I first deleted unconditionally, reasoning that "the hub already decided". That is false for
         tombstones: a tombstone is PERMANENT and rides every delta it appears in, so its presence is not
         evidence that the hub deleted anything at that revision. Found on live data — an upcharge tombstone
         from 2026-07-something rode a delta and my rebuild removed a record the hub was rightly keeping,
         because that record had been RE-CREATED afterwards with a newer stamp.
         So apply the hub's own rule (hubMergeArr): the tombstone wins only if it is at least as new as the
         record. stampScale is required because _t holds two different clocks — plain milliseconds on older
         records and ms*1000+counter on newer ones — and comparing them raw makes a hybrid stamp beat a
         millisecond one by a factor of a thousand regardless of which is actually newer. */
      if (Array.isArray(db[coll])) db[coll] = db[coll].filter(rec => {
        if (!rec || String(rec[key]) !== String(t.k)) return true;
        return !(stampScale(t.t) >= stampScale(rec._t));
      });
      const sk = String(t.c) + '|' + String(t.k);
      const was = seen[sk];
      if (!was) { db._tomb.push(t); seen[sk] = t; }
      else if ((+t.t || 0) > (+was.t || 0)) { db._tomb[db._tomb.indexOf(was)] = t; seen[sk] = t; }   // keep the newest, as the hub does
    }
  }
  return db;
}

(function main(){
  const log = logRead();
  if (!log.length) { console.log('The delta log is empty or missing — nothing to replay from.'); process.exit(1); }
  const logLo = +log[0].rev, logHi = +log[log.length - 1].rev;
  const target = arg('--rev') ? Number(arg('--rev')) : logHi;

  console.log('delta log      : ' + log.length + ' revision(s), rev ' + logLo + ' → ' + logHi);
  console.log('target         : rev ' + target);

  const cps = checkpoints();
  const base = cps.filter(c => c.rev <= target)[0] || null;
  if (!base) {
    console.log('⛔ No checkpoint at or below rev ' + target + '. Cannot rebuild: a replay needs a starting point.');
    console.log('   checkpoints available: ' + (cps.length ? cps.slice(0, 6).map(c => c.rev).join(', ') : 'none'));
    process.exit(1);
  }
  console.log('starting from  : ' + base.file + '  (rev ' + base.rev + ')');

  const need = log.filter(e => +e.rev > base.rev && +e.rev <= target);
  const gapAt = (function(){ let want = base.rev + 1; for (const e of need) { if (+e.rev !== want) return want; want++; } return (want <= target) ? want : 0; })();
  if (gapAt) {
    console.log('⛔ the log is MISSING rev ' + gapAt + ' — a rebuild would silently skip real changes. Stopping.');
    process.exit(1);
  }
  console.log('replaying      : ' + need.length + ' revision(s)');

  const raw = JSON.parse(fs.readFileSync(path.join(BACKUPS, base.file), 'utf8'));
  let db = raw.db;
  let recs = 0;
  for (const e of need) { apply(db, e); recs += Object.keys(e.db || {}).reduce((t, k) => t + ((e.db[k] || []).length || 0), 0); }
  console.log('records laid   : ' + recs);

  const wrapped = JSON.stringify({ __meta: { rev: target, savedAt: (need.length ? +need[need.length - 1].ts : base.savedAt), device: 'hub-replay' }, db: db });

  if (has('--verify')) {
    let live = null;
    try { live = JSON.parse(fs.readFileSync(DBFILE, 'utf8')); } catch (e) { console.log('⛔ cannot read the live file: ' + e.message); process.exit(1); }
    if ((+live.__meta.rev || 0) !== target) {
      console.log('ⓘ the live file is at rev ' + live.__meta.rev + ', target was ' + target + ' — rerun without --rev to compare like with like.');
      process.exit(1);
    }
    /* compare CONTENT, per collection, order-independent: after a merge two copies legitimately hold the same
       records in a different order, exactly as the mirror already accounts for. */
    /* ⚠️ _seq IS DELIBERATELY IGNORED. It is hub bookkeeping — the marker that answers "what changed since?"
       — and the hub re-stamps it whenever a record is touched again. A rebuild lays each record down exactly as
       it was logged, so its _seq is the revision that last CHANGED it, while the live copy's may have moved on.
       Comparing it would fail on metadata while the actual business content agreed. What must match is the
       records and their field values, and that a deleted thing stays deleted — which is asserted separately. */
    const strip = r => { const c = {}; Object.keys(r || {}).filter(k => k !== '_seq').sort().forEach(k => { c[k] = r[k]; }); return JSON.stringify(c); };
    const norm = o => { const c = {}; Object.keys(o || {}).sort().forEach(k => {
        c[k] = Array.isArray(o[k]) ? o[k].slice().map(strip).sort() : o[k]; }); return c; };
    const a = norm(db), b = norm(live.db);
    const keys = Array.from(new Set(Object.keys(a).concat(Object.keys(b)))).sort();
    let bad = 0, outside = 0;
    for (const k of keys) {
      const sa = JSON.stringify(a[k]), sb = JSON.stringify(b[k]);
      if (sa !== sb) {
        const la = Array.isArray(db[k]) ? db[k].length : '-', lb = Array.isArray(live.db[k]) ? live.db[k].length : '-';
        if (!logCovers(k)) {   /* outside the log by construction — report it honestly, do not call it a pass OR a failure */
          outside++;
          console.log('  ⓘ ' + k + ' differs, and the log does not carry it   rebuilt=' + la + '  live=' + lb);
          console.log('      ' + whyUncovered(k));
          continue;
        }
        bad++;
        console.log('  ❌ ' + k + ' differs   rebuilt=' + la + '  live=' + lb);
        if (process.env.OZARK_REPLAY_DEBUG) {
          console.log('     rebuilt: ' + JSON.stringify(db[k]).slice(0,400));
          console.log('     live   : ' + JSON.stringify(live.db[k]).slice(0,400));
        }
      }
    }
    if (bad) {
      console.log('\n❌ ' + bad + ' collection(s) differ — the log does NOT explain the live file.');
    } else if (outside) {
      console.log('\n✅ every collection the log carries matches exactly.');
      console.log('   ⓘ ' + outside + ' collection(s) sit outside the log by design (named above) and come from the checkpoint.');
      console.log('   Money and clothes — orders, customers, payments, ledger, collections, garments — are all carried and all match.');
    } else {
      console.log('\n✅ the rebuilt database matches the live one exactly. Checkpoint + log is a complete record.');
    }
    process.exit(bad ? 1 : 0);
  }

  const out = arg('--out') || path.join(DATADIR, 'rebuilt-' + target + '.json');
  fs.writeFileSync(out, wrapped);
  console.log('\nwrote          : ' + out);
  console.log('⚠️ the LIVE database was not touched. To restore: stop ozark-hub, copy this over ozark-db.json, start it.');
})();
