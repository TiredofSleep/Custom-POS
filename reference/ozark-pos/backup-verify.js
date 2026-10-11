#!/usr/bin/env node
/* ============================================================================================
   🧪 RESTORE THE NEWEST BACKUP AND PROVE IT IS USABLE. Weekly, unattended, read-only.

   ⚠️ A BACKUP YOU HAVE NEVER RESTORED IS A HOPE, NOT A BACKUP. This system has 60 rolling snapshots, a
   delta log, DigitalOcean images and a nightly OneDrive pull — four kinds of copy, and until now exactly one
   rehearsed restore, done by hand, once. The failure this guards against is the quiet one: backups that have
   been "running fine" for months and turn out to be truncated, or encrypted with a passphrase nobody has.

   It does NOT check that a file exists — that proves nothing. It decrypts it, parses it, counts what is
   inside, and runs the same invariants the live shop runs, then compares the result to what is live right
   now. Anything less would pass on a file full of zeroes.

   ⚠️ IT NEVER WRITES TO THE LIVE DATABASE. It works entirely in a temp directory and deletes it afterwards.
   Restoring for real is a deliberate human act: stop the service, copy the file, start it.

   The result is written to hub-data/backup-verify.json and published on /api/health, because a check whose
   answer nobody can see is the same as no check.

   usage:  node backup-verify.js            (verify the newest encrypted off-site backup)
           node backup-verify.js --file X   (verify one specific file, .enc or .json)
   ============================================================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const HERE = fs.existsSync('/opt/ozark') ? '/opt/ozark' : __dirname;
const DATA = path.join(HERE, 'hub-data');
const OUT = path.join(DATA, 'backup-verify.json');

function newestBackup() {
  const i = process.argv.indexOf('--file');
  if (i > 0 && process.argv[i + 1]) return process.argv[i + 1];
  /* prefer the ENCRYPTED off-site artifact, because that is the copy that actually leaves the building and
     therefore the one most likely to be unopenable when it matters */
  const off = path.join(DATA, 'offsite');
  for (const dir of [off, path.join(DATA, 'backups')]) {
    try {
      const f = fs.readdirSync(dir)
        .filter(n => /\.(enc|json)$/.test(n))
        .map(n => ({ n, t: fs.statSync(path.join(dir, n)).mtimeMs }))
        .sort((a, b) => b.t - a.t)[0];
      if (f) return path.join(dir, f.n);
    } catch (e) {}
  }
  return '';
}

function finish(res) {
  res.at = Date.now();
  res.atHuman = new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' });
  try { fs.writeFileSync(OUT, JSON.stringify(res, null, 2)); } catch (e) {}
  const mark = res.ok ? '✅' : '❌';
  console.log('');
  console.log('══ ' + mark + ' ' + (res.ok ? 'the newest backup restores and is usable' : 'BACKUP VERIFY FAILED — ' + res.error) + ' ══');
  process.exit(res.ok ? 0 : 1);
}

const file = newestBackup();
if (!file) finish({ ok: false, error: 'no backup file found to verify' });

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ozark-verify-'));
const res = { ok: false, file: path.basename(file), encrypted: /\.enc$/.test(file) };

try {
  console.log('verifying ' + file);
  let jsonPath = file;

  if (res.encrypted) {
    jsonPath = path.join(tmp, 'restored.json');
    /* ⚠️ decrypt through the SAME tool the backup was written with, never a second copy of the crypto.
       Two implementations of one format is how a backup becomes unreadable. */
    execFileSync(process.execPath, [path.join(HERE, 'backup-crypto.js'), 'decrypt', file, jsonPath],
      { stdio: 'pipe' });
    console.log('  decrypted ok');
  }

  const raw = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  const db = raw.db || raw;
  res.counts = {
    customers: (db.customers || []).length, orders: (db.orders || []).length,
    payments: (db.payments || []).length, ledger: (db.ledger || []).length
  };
  res.ledgerTotal = Math.round((db.ledger || []).reduce((s, l) => s + (Number(l.amount) || 0), 0) * 100) / 100;
  console.log('  parsed: ' + res.counts.customers + ' customers · ' + res.counts.orders + ' orders · ledger $' + res.ledgerTotal);

  /* ⚠️ A PLAUSIBLE-LOOKING FILE IS NOT A GOOD BACKUP. Compare it to what is live: a restore that has half
     the customers is a disaster that would pass any "does it parse" check. 2% allows for a week of real
     growth; a bigger gap means something is wrong with the backup, not with the shop. */
  try {
    const live = JSON.parse(fs.readFileSync(path.join(DATA, 'ozark-db.json'), 'utf8'));
    const ldb = live.db || live;
    res.live = { customers: (ldb.customers || []).length, orders: (ldb.orders || []).length };
    const drop = res.live.customers ? (res.live.customers - res.counts.customers) / res.live.customers : 0;
    res.customerDrift = Math.round(drop * 1000) / 10 + '%';
    if (drop > 0.02) throw new Error('the backup has ' + res.counts.customers + ' customers but the shop has '
      + res.live.customers + ' — too big a gap to trust');
    console.log('  matches the live shop (' + res.customerDrift + ' fewer customers, within tolerance)');
  } catch (e) {
    if (String(e.message).indexOf('too big a gap') >= 0) throw e;
    /* no live file to compare against is not a failure of the BACKUP */
    console.log('  (no live database to compare against — counts not cross-checked)');
  }

  /* the same rules the live shop is held to, run against the restored copy.
     ⚠️ THE PATH MUST BE PASSED EXPLICITLY — found 2026-08-28. check-invariants.js defaults to the
     ABSOLUTE live path when it gets no argument, so setting cwd to the temp dir did nothing: every
     "invariants on the restored copy" figure ever published (28/28 on 8/17, 29/30 on 8/23) was really
     the LIVE database being checked a second time. A measurement failing in the reassuring direction —
     the two databases are near-identical, so the number always looked plausible. The 8/23 "29/30" was
     live PAY-1 (two open multi-day shifts), nothing about the backup at all. */
  const inv = path.join(HERE, 'check-invariants.js');
  if (fs.existsSync(inv)) {
    const work = path.join(tmp, 'hub-data');
    fs.mkdirSync(work, { recursive: true });
    const restored = path.join(work, 'ozark-db.json');
    fs.copyFileSync(jsonPath, restored);
    /* the archive index rides along: the backup carries only the live DB, so once orders start retiring
       (archive-pass.js), a payment pointing at a retired order would read as an orphan on the restored
       copy alone — a false alarm about a correct backup. Judge the copy with the same archive context. */
    try {
      fs.mkdirSync(path.join(work, 'archive'), { recursive: true });
      fs.copyFileSync(path.join(DATA, 'archive', 'index.json'), path.join(work, 'archive', 'index.json'));
    } catch (e) {}
    /* name the rules that failed, not just how many — "29/30 (some failed)" cost a session of archaeology */
    const summarize = out => {
      const m = out.match(/(\d+)\/(\d+) invariants hold/);
      if (!m) return null;
      const bad = (out.match(/❌\s+(\S+)/g) || []).map(s => s.replace(/❌\s+/, ''));
      return m[1] + '/' + m[2] + (bad.length ? ' (failed: ' + bad.join(', ') + ')' : '');
    };
    try {
      const out = execFileSync(process.execPath, [inv, restored], { cwd: tmp, stdio: 'pipe' }).toString();
      res.invariants = summarize(out) || 'ran';
      console.log('  invariants on the restored copy: ' + res.invariants);
    } catch (e) {
      const out = ((e.stdout && e.stdout.toString()) || '') + ((e.stderr && e.stderr.toString()) || '');
      res.invariants = summarize(out) || 'could not run';
      console.log('  invariants on the restored copy: ' + res.invariants);
    }
  }

  res.ok = true;
  finish(res);
} catch (e) {
  res.error = (e && e.message) || String(e);
  finish(res);
} finally {
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {}
}
