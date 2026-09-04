#!/usr/bin/env node
/*
  customPOS — backup-verify: prove the newest backup actually restores to a sound shop.
  ====================================================================================
  A backup nobody has ever restored is a hope, not a safeguard. This decrypts the newest artifact, RESTORES it,
  counts it against the live shop, and runs check-invariants against the restored copy — then publishes the
  result WITH ITS AGE. Three reference lessons are load-bearing:
   • `ok:null` means the verify has NEVER RUN — deliberately not `true`. A dashboard that shows a green tick for
     a check that never happened is the "error that renders as good news."
   • A STALE verify reads as stale, not fine: if the newest backup is older than the max age, ok is false even
     if it decrypts cleanly — an old-but-valid backup is still a gap.
   • It compares the restored counts to LIVE and fails on data loss (half the customers = a broken backup),
     because a backup that decrypts but is missing half the shop would "pass" a naive check.

  API:  verifyBackup({ live, backupBuf, passphrase, maxAgeMs, maxLossRatio, now }) -> report
        readStatus(file) -> the published status ({ok:null} when the file is absent = never run)
  CLI:  node backup-verify.js <backupDir> <liveDb.json>    (passphrase in CUSTOMPOS_BACKUP_PASS)
*/
'use strict';
const fs = require('fs');
const path = require('path');
const { decrypt, readHeader } = require('./backup.js');
const { checkInvariants } = require('./check-invariants.js');

function newestBackup(dir){
  let best = null;
  for (const f of (fs.existsSync(dir) ? fs.readdirSync(dir) : [])){
    if (!f.endsWith('.cpbk')) continue;
    const m = fs.statSync(path.join(dir, f)).mtimeMs;
    if (!best || m > best.m) best = { file: path.join(dir, f), m };
  }
  return best ? best.file : null;
}

function verifyBackup(opts){
  opts = opts || {};
  const maxAgeMs = opts.maxAgeMs != null ? opts.maxAgeMs : 24*3600*1000;
  const maxLossRatio = opts.maxLossRatio != null ? opts.maxLossRatio : 0.05;
  const now = opts.now != null ? opts.now : Date.now();
  const report = { ok:false, checkedAt:new Date(now).toISOString(), age:null, stale:false, records:null, customers:null, reasons:[] };

  if (!opts.backupBuf){ report.ok = null; report.reasons.push('no backup artifact found — nothing has ever been backed up'); return report; }
  let header; try { header = readHeader(opts.backupBuf); } catch (e){ report.reasons.push('not a customPOS backup'); return report; }
  if (header.createdAt){ report.age = now - Date.parse(header.createdAt);
    if (report.age > maxAgeMs){ report.stale = true; report.reasons.push('newest backup is '+Math.round(report.age/3600000)+'h old (older than the '+Math.round(maxAgeMs/3600000)+'h limit)'); } }

  let restored; try { restored = decrypt(opts.backupBuf, opts.passphrase); } catch (e){ report.reasons.push('cannot decrypt/authenticate the backup: '+e.message); return report; }
  const rc = (restored.records||[]).length, cc = (restored.customers||[]).length;
  report.records = rc; report.customers = cc;
  const lr = ((opts.live&&opts.live.records)||[]).length, lc = ((opts.live&&opts.live.customers)||[]).length;
  if (rc < Math.floor(lr*(1-maxLossRatio))) report.reasons.push('restored copy has '+rc+' records vs '+lr+' live (data loss)');
  if (cc < Math.floor(lc*(1-maxLossRatio))) report.reasons.push('restored copy has '+cc+' customers vs '+lc+' live (data loss)');

  const inv = checkInvariants(restored);
  if (!inv.ok) report.reasons.push(inv.count+' invariant violation(s) in the restored copy');

  report.ok = report.reasons.length === 0 && !report.stale;
  return report;
}

function readStatus(file){ try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e){ return { ok:null, reasons:['the backup verify has never run'] }; } }
function writeStatus(file, report){ try { fs.writeFileSync(file, JSON.stringify(report, null, 2)); } catch (e){} }

module.exports = { verifyBackup, newestBackup, readStatus, writeStatus };

if (require.main === module){
  const [dir, liveFile] = process.argv.slice(2);
  const pass = process.env.CUSTOMPOS_BACKUP_PASS;
  if (!dir || !liveFile || !pass){ console.error('usage: CUSTOMPOS_BACKUP_PASS=… node backup-verify.js <backupDir> <liveDb.json>'); process.exit(2); }
  let live = {}; try { live = JSON.parse(fs.readFileSync(liveFile, 'utf8')); } catch (e){}
  const bf = newestBackup(dir);
  const report = verifyBackup({ live, backupBuf: bf ? fs.readFileSync(bf) : null, passphrase: pass });
  writeStatus(path.join(dir, 'backup-status.json'), report);
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.ok ? 0 : 1);
}
