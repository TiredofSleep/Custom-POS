#!/usr/bin/env node
/*
  customPOS — hub-replay: rebuild the hub DB at any revision from a checkpoint + the append-only delta log.
  ===================================================================================================
  The hub writes one log line per changing rev (the exact delta that got that rev) and a full checkpoint
  every CHECKPOINT_EVERY revs (see hub.js, Stage B4). This tool rebuilds the store AT a target rev by taking
  the newest checkpoint at or before the target and replaying the log deltas up to it — through the SAME
  mergeArr the live hub uses, so the rebuild is byte-for-byte what the hub held at that rev.

  It REFUSES on a hole. If the log is missing a rev between the checkpoint and the target, it throws naming
  the missing rev rather than skipping it — a rebuild that silently drops a rev would hand back a plausible
  DB that never existed, the "error that renders as good news" the reference is built to prevent.

  Run:  node hub-replay.js <targetRev> [dataDir]     (dataDir defaults to ./hub-data)
        node hub-replay.js --latest [dataDir]         (rebuild the highest rev the log reaches)
*/
'use strict';
const fs = require('fs');
const path = require('path');
const { mergeArr } = require('./hub.js');

function readLog(dir){
  const LOG = path.join(dir, 'delta-log.jsonl');
  if (!fs.existsSync(LOG)) return [];
  return fs.readFileSync(LOG, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
}
function newestCheckpointAtOrBefore(dir, target){
  let best = { records:[], customers:[], seq:0, rev:0 };   // the empty base if there is no checkpoint yet
  let bestRev = -1;
  for (const f of fs.existsSync(dir) ? fs.readdirSync(dir) : []){
    const m = /^checkpoint-(\d+)\.json$/.exec(f);
    if (!m) continue;
    const rev = +m[1];
    if (rev <= target && rev > bestRev){ best = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); bestRev = rev; }
  }
  return best;
}

// Rebuild the store exactly as the hub held it at `target`. Throws on a hole or a short log.
function replay(dir, target){
  const log = readLog(dir).sort((a,b) => a.rev - b.rev);
  if (target == null) target = log.length ? log[log.length-1].rev : 0;
  const base = newestCheckpointAtOrBefore(dir, target);
  const from = base.rev || 0;
  if (target < from) throw new Error(`target rev ${target} is below the nearest checkpoint (${from})`);
  const steps = log.filter(e => e.rev > from && e.rev <= target);

  // contiguity: the deltas must be exactly from+1 .. target, no gap
  let expect = from + 1;
  for (const e of steps){
    if (e.rev !== expect) throw new Error(`delta log hole: expected rev ${expect}, found rev ${e.rev} (refusing to rebuild a revision that never existed)`);
    expect++;
  }
  if (expect - 1 !== target) throw new Error(`delta log reaches rev ${expect-1}, short of target ${target} (missing rev ${expect})`);

  // apply each delta through the SAME mergeArr the hub uses; ctx=null so the logged _rev is preserved, not re-stamped
  const store = { records:[...(base.records||[])], customers:[...(base.customers||[])], seq: base.seq||0, rev: from };
  for (const e of steps){
    store.records   = mergeArr(store.records,   (e.delta.records  ||[]), 'id',    true,  null);
    store.customers = mergeArr(store.customers, (e.delta.customers||[]), 'phone', false, null);
    store.seq = Math.max(store.seq, e.delta.seq || 0);
    store.rev = e.rev;
  }
  return store;
}

module.exports = { replay, readLog, newestCheckpointAtOrBefore };

if (require.main === module){
  const args = process.argv.slice(2);
  const latest = args[0] === '--latest';
  const target = latest ? null : (args[0] != null ? +args[0] : null);
  const dir = (latest ? args[1] : args[1]) || path.join(__dirname, 'hub-data');
  try {
    const store = replay(dir, target);
    console.error(`rebuilt rev ${store.rev}: ${store.records.length} records, ${store.customers.length} customers`);
    process.stdout.write(JSON.stringify(store));
  } catch (e){ console.error('REPLAY FAILED:', e.message); process.exit(1); }
}
