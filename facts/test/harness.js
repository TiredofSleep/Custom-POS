'use strict';
/* 10/18: EVERY RUN SEES ONE FIXED CLOCK. The proofs were written on America/Chicago time, and once only the deploy script set it for the suite,
   so a run anywhere else (a UTC CI machine, another PC) saw another day — proofs about "today", evenings and weekdays then failed for no
   fault in the code. An explicit TZ (a proof's own negative control) is still respected. Node reads TZ at runtime. */
if (!process.env.TZ) process.env.TZ = 'America/Chicago';
/* A tiny test harness: no dependencies, plain output, non-zero exit on any failure.
   test() is synchronous; testAsync() queues a Promise-returning proof that done() runs, in order, at the end. */
const fs = require('fs'), path = require('path');
let pass = 0, fail = 0, current = '(between proofs)';
const failures = [], asyncs = [];

/* =====================================================================================================================
 * SHARDS AND THE SMOKE LIST (10/18, enterprise batch 2). Both are opt-in; a plain run is exactly what it always was.
 *   CUSTOMPOS_SHARD="i/N" (1-based) — every proof still REGISTERS (sections still print, the file's own setup still runs), but only the
 *     proofs whose running index k (0-based, H.test and H.testAsync counted together, in the order they are written) has k mod N = i-1
 *     run. The run ends with one human line ("SHARD i/N: P passed, F failed …") and one machine line (RESULT_TAG + JSON) that
 *     test/run.js reads: the shard, the counts, the indexes it ran, a hash of every registered name in order (so the runner can tell
 *     that every shard saw the SAME suite, and that each proof ran in exactly one shard), the failed names and the slowest proofs.
 *   CUSTOMPOS_SMOKE=1 — only the proofs named in test/smoke.txt run (CUSTOMPOS_SMOKE_LIST names another list: the shard proofs' fixtures).
 *     A listed name the suite no longer registers (a proof renamed or removed) is a FAILURE by name, never a proof silently dropped.
 *   A typo in either (CUSTOMPOS_SHARD=4/3, =0/2, =two) stops the run at once: a run that ran nothing must never read as a pass.
 *   The shared pieces (the selector, the smoke list's reading, the runner's verdict) are test/shards.js.
 * ===================================================================================================================== */
const { RESULT_TAG, parseShard, inShard, parseSmoke, namesHash } = require('./shards');
const SHARD = parseShard(process.env.CUSTOMPOS_SHARD);
const SMOKE_FILE = process.env.CUSTOMPOS_SMOKE === '1' ? (process.env.CUSTOMPOS_SMOKE_LIST || path.join(__dirname, 'smoke.txt')) : null;
if (process.env.CUSTOMPOS_SMOKE && process.env.CUSTOMPOS_SMOKE !== '1') throw new Error('CUSTOMPOS_SMOKE must be 1 or unset (got ' + JSON.stringify(process.env.CUSTOMPOS_SMOKE) + ') — nothing was run');
const SMOKE = SMOKE_FILE ? parseSmoke(fs.readFileSync(SMOKE_FILE, 'utf8')) : null, SMOKE_SET = SMOKE ? new Set(SMOKE) : null;
const registered = [], ranIdx = [], timings = [];
let inProof = null;
/* @proof — the proofs' own stopwatch in ms since t0: process.hrtime is never the Date a proof pins (atClock swaps global.Date) */
const ms = function (t0) { return Number(process.hrtime.bigint() - t0) / 1e6; };
/* @proof — a proof is registered (its running index taken, its name kept) and told whether it runs in this run (the shard, the smoke list).
   A proof registered while another proof's body runs is a FAULT in the suite file, said by name (10/18: a 9/24 merge left §330–§335
   inside the body of §263's last proof — they existed only when that proof ran, so a shard without it never had them); it still runs. */
function enlist(name) {
  if (inProof !== null) report('a proof registered INSIDE the body of another proof — "' + String(name).slice(0, 100) + '" inside "' + String(inProof).slice(0, 100) + '": it exists only when the outer proof runs (a shard without it never has it); close the outer proof first', 'a fault in the suite file, not in the code under test');
  const k = registered.length; registered.push(name);
  const run = inShard(k, SHARD) && (!SMOKE_SET || SMOKE_SET.has(name));
  if (run) ranIdx.push(k);
  return run;
}

/* 10/18: AN ERROR NOBODY CAUGHT FAILS THE PROOF THAT WAS RUNNING — IT NEVER ENDS THE RUN. A throw inside a proof's async callback (an
   onSave, a timer) used to kill the whole process with no summary (the 10/18 waste-1017 run died at proof ~1,094 on a random card id), so
   every proof after it went unrun and unreported. It is now one named failure and the run goes on to its summary. */
process.on('uncaughtException', function (e) { report('UNCAUGHT ERROR during: ' + current, e); });
process.on('unhandledRejection', function (e) { report('UNHANDLED REJECTION during: ' + current, e); });
function report(name, e) { fail++; failures.push(name); console.log('  ✗ ' + name + '\n      ' + (e && e.stack ? e.stack.split('\n').slice(0, 2).join(' | ') : e)); }
/* @proof — a synchronous proof: registered, and run now when this run selects it (its time kept); a throw is its failure, by name */
function test(name, fn) {
  if (!enlist(name)) return;
  current = name; const t0 = process.hrtime.bigint(), outer = inProof; inProof = name;
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { report(name, e); }
  finally { inProof = outer; timings.push([ms(t0), name]); }
}
/* @proof — an async proof: registered now, and queued for done() when this run selects it */
function testAsync(name, fn) { if (enlist(name)) asyncs.push({ name: name, fn: fn }); }
function section(title) { console.log('\n— ' + title + ' —'); }
function eq(a, b, msg) { if (a !== b) throw new Error((msg ? msg + ': ' : '') + 'expected ' + JSON.stringify(b) + ' got ' + JSON.stringify(a)); }
function ok(v, msg) { if (!v) throw new Error(msg || 'expected truthy, got ' + JSON.stringify(v)); }
function deepEq(a, b, msg) { const A = JSON.stringify(a), B = JSON.stringify(b); if (A !== B) throw new Error((msg ? msg + ': ' : '') + 'not deep-equal\n  A=' + A.slice(0, 300) + '\n  B=' + B.slice(0, 300)); }
/* @proof — what this run has seen so far: every registered name in order, the indexes it ran, the shard and the smoke list (copies) */
function runInfo() { return { registered: registered.slice(), ran: ranIdx.slice(), shard: SHARD ? SHARD.i + '/' + SHARD.n : null, smoke: SMOKE ? SMOKE.slice() : null, smokeFile: SMOKE_FILE }; }
/* @proof — the end of a run: the queued async proofs in order (two minutes each), the smoke list's names checked, the summary; a shard or smoke run adds its RESULT_TAG line */
async function done() {
  /* the async proofs start only once the file's synchronous run is over — wherever done() is called — so no proof's two minutes are
     spent waiting behind synchronous proofs still to run (9/25: done() sat mid-file and a server deploy failed on it) */
  await new Promise(function (r) { setImmediate(r); });
  for (const t of asyncs) {
    current = t.name; inProof = t.name; const t0 = process.hrtime.bigint();
    /* a proof that never answers FAILS, by name, after two minutes — it must never freeze the run (a deploy runs these) */
    let timer = null; const limit = new Promise(function (_, no) { timer = setTimeout(function () { no(new Error('timed out after 120 s — something never answered')); }, 120000); });
    try { await Promise.race([t.fn(), limit]); pass++; console.log('  ✓ ' + t.name); }
    catch (e) { report(t.name, e); }
    finally { clearTimeout(timer); inProof = null; timings.push([ms(t0), t.name]); }
  }
  current = '(after the last proof)';
  /* a smoke list that names a proof the suite no longer has is a failure by name — a renamed proof never silently drops out of the smoke run */
  if (SMOKE) { const have = new Set(registered); SMOKE.filter(function (n) { return !have.has(n); }).forEach(function (n) { report('the smoke list (' + path.basename(SMOKE_FILE) + ') names a proof this suite does not have — renamed or removed? ' + n, 'fix the name in the list'); }); }
  console.log('\n' + pass + ' passed, ' + fail + ' failed' + (fail ? '\n  failed: ' + failures.join(' | ') : ''));
  if (SHARD || SMOKE) {
    console.log((SHARD ? 'SHARD ' + SHARD.i + '/' + SHARD.n : 'SMOKE') + ': ' + pass + ' passed, ' + fail + ' failed (' + ranIdx.length + ' of the ' + registered.length + ' proofs registered ran here)');
    const slow = timings.slice().sort(function (a, b) { return b[0] - a[0]; }).slice(0, 25).map(function (t) { return [Math.round(t[0]), t[1]]; });
    console.log(RESULT_TAG + JSON.stringify({ shard: SHARD ? SHARD.i + '/' + SHARD.n : null, smoke: !!SMOKE, pass: pass, fail: fail, failed: failures, registered: registered.length,
      hash: namesHash(registered), ran: ranIdx, slow: slow, ms: Math.round(process.uptime() * 1000) }));
  }
  if (fail) process.exitCode = 1;
  setTimeout(function () { process.exit(process.exitCode || 0); }, 300).unref();   /* a server a failed proof left open must not keep the run alive */
}
module.exports = { test: test, testAsync: testAsync, section: section, eq: eq, ok: ok, deepEq: deepEq, done: done,
  parseShard: parseShard, inShard: inShard, parseSmoke: parseSmoke, namesHash: namesHash, runInfo: runInfo, RESULT_TAG: RESULT_TAG };
