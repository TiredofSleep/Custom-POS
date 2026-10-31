'use strict';
/* =====================================================================================================================
 * THE SUITE IN SHARDS (10/18, enterprise batch 2) — what the harness (test/harness.js), the runner (test/run.js) and the shard proofs
 * (test/proofs/880-shards.test.js) share: how a run names its shard, which proofs belong to it, the smoke list's reading, and the
 * runner's verdict over the shards' answers. Test-only: nothing here is shipped to a tablet or the hub, and it has no dependencies.
 *   A run with CUSTOMPOS_SHARD="i/N" registers every proof (in the order written; H.test and H.testAsync share one running index) and runs
 *   the ones whose index k has k mod N = i-1. Each shard ends with a RESULT_TAG line: the indexes it ran and a hash of every name it
 *   registered. The runner's verdict (checkShards) refuses a set of shards that did not see the same suite, or where a proof ran in
 *   two shards, in none, or in the wrong one — so a shard that silently ran nothing can never read as a pass.
 * ===================================================================================================================== */
const crypto = require('crypto');
const RESULT_TAG = '@@CUSTOMPOS-SHARD-RESULT ';

/* @proof — the shard a run is, from CUSTOMPOS_SHARD: "i/N" (1-based, 1 <= i <= N) → { i, n }; unset or empty → null; anything else throws */
function parseShard(s) {
  if (s == null || s === '') return null;
  const m = /^\s*(\d+)\s*\/\s*(\d+)\s*$/.exec(String(s)), i = m ? +m[1] : 0, n = m ? +m[2] : 0;
  if (!m || n < 1 || i < 1 || i > n) throw new Error('CUSTOMPOS_SHARD must be "i/N" with 1 <= i <= N (got ' + JSON.stringify(s) + ') — nothing was run');
  return { i: i, n: n };
}
/* @proof — whether the proof at running index k (0-based, registration order) belongs to shard sh; no shard → every proof */
function inShard(k, sh) { return !sh || k % sh.n === sh.i - 1; }
/* @proof — a smoke list's text → its proof names, one per line, in order: blank lines and lines starting with # are notes, never names */
function parseSmoke(text) {
  return String(text).replace(/\r\n/g, '\n').split('\n').map(function (l) { return l.replace(/\s+$/, ''); }).filter(function (l) { return l.trim() !== '' && !/^\s*#/.test(l); });
}
/* @proof — a hash of a list of proof names in order: two runs that registered the same proofs in the same order share it */
function namesHash(names) { const h = crypto.createHash('sha256'); names.forEach(function (n) { h.update(String(n)); h.update('\u0000'); }); return h.digest('hex').slice(0, 16); }
/* @proof — the shard's answer in a log: the JSON on its last RESULT_TAG line, or null (a shard that died before its summary) */
function parseResult(text) {
  const lines = String(text).split(/\r?\n/);
  for (let k = lines.length - 1; k >= 0; k--) if (lines[k].indexOf(RESULT_TAG) === 0) { try { return JSON.parse(lines[k].slice(RESULT_TAG.length)); } catch (e) { return null; } }
  return null;
}
/* @proof — how many shards: CUSTOMPOS_SHARDS (a whole number 1..32) when set, else the machine's CPUs less one, at least 1 and at most 4 */
function shardCount(envValue, cpus) {
  if (envValue != null && envValue !== '') {
    if (!/^\s*\d+\s*$/.test(String(envValue)) || +envValue < 1 || +envValue > 32) throw new Error('CUSTOMPOS_SHARDS must be a whole number from 1 to 32 (got ' + JSON.stringify(envValue) + ')');
    return +envValue;
  }
  return Math.min(4, Math.max(1, (cpus | 0) - 1));
}
/* @proof — the runner's verdict over N shards' answers (results[i-1] is shard i's parsed RESULT_TAG line, or null): [] when every shard
   answered, all saw the same suite (count and hash of the names in order), each ran only proofs of its own shard, and — outside a smoke
   run — every proof ran in exactly one shard; otherwise each problem, in plain words */
function checkShards(results, n) {
  const bad = [];
  if (!Array.isArray(results) || results.length !== n) return ['expected ' + n + ' shard answers, got ' + (Array.isArray(results) ? results.length : 'none')];
  results.forEach(function (r, k) { if (!r) bad.push('shard ' + (k + 1) + '/' + n + ' ended without its summary (it crashed or was stopped)'); else if (r.shard !== (k + 1) + '/' + n) bad.push('shard ' + (k + 1) + '/' + n + ' answered as ' + JSON.stringify(r.shard)); });
  const got = results.filter(Boolean); if (!got.length) return bad;
  const R = got[0].registered, hash = got[0].hash;
  got.forEach(function (r) { if (r.registered !== R || r.hash !== hash) bad.push('shard ' + r.shard + ' registered a different suite (' + r.registered + ' proofs, ' + r.hash + ') than shard ' + got[0].shard + ' (' + R + ', ' + hash + ') — a proof registered only in some runs'); });
  const seen = new Map(); let smoke = false;
  results.forEach(function (r, k) {
    if (!r) return; smoke = smoke || !!r.smoke;
    (r.ran || []).forEach(function (idx) {
      if (!(idx >= 0 && idx < R) || idx % n !== k) bad.push('shard ' + r.shard + ' ran proof #' + idx + ', which is not one of its own');
      if (seen.has(idx)) bad.push('proof #' + idx + ' ran in shard ' + seen.get(idx) + ' and again in shard ' + r.shard); else seen.set(idx, r.shard);
    });
  });
  if (!smoke && got.length === n) { const missing = []; for (let k = 0; k < R; k++) if (!seen.has(k)) missing.push(k); if (missing.length) bad.push(missing.length + ' proof(s) ran in no shard: #' + missing.slice(0, 10).join(', #')); }
  return bad;
}

module.exports = { RESULT_TAG: RESULT_TAG, parseShard: parseShard, inShard: inShard, parseSmoke: parseSmoke, namesHash: namesHash, parseResult: parseResult, shardCount: shardCount, checkShards: checkShards };
