#!/usr/bin/env node
/* hub-chain.js — make the append-only records TAMPER-EVIDENT, and prove it.
 *
 *   node hub-chain.js --seal      # chain any new lines and record today's head hash  (run nightly)
 *   node hub-chain.js --verify    # walk every chain and report the first line that does not add up
 *   node hub-chain.js --heads     # print the current head hashes (this is what gets anchored off-box)
 *
 * WHY. `activity-archive.jsonl`, `order-history.jsonl`, `trail.jsonl`, `sms-archive.jsonl`,
 * `card-events.jsonl`, `client-errors.jsonl` and `delta-log.jsonl` are append-only **by convention only**.
 * Anyone with droplet access could edit a single line and nothing in the system would ever notice. For a
 * business whose whole promise is "we keep a record of every garment and every dollar, forever", that gap is
 * the difference between *we do not overwrite* and *we can prove nobody did*.
 *
 * HOW. Each line gets a hash of (the previous line's hash + its own canonical content). Change any past line
 * and every hash after it stops matching, so verification names the first altered line rather than shrugging.
 * Canonical = keys sorted, so merely re-serialising a record can never change its hash.
 *
 * ⚠️ A CHAIN ALONE DOES NOT STOP SOMEONE WHO CAN REWRITE THE WHOLE FILE — they would simply recompute every
 * link. That is why --seal writes `chain-heads.json` and why the nightly job COMMITS IT TO GIT: the head hash
 * then lives on GitHub, off the droplet, in a history the droplet cannot rewrite. An insider would have to
 * alter the log *and* a record they do not control. Without that anchor this tool is theatre.
 *
 * ⚠️ IT NEVER REWRITES A RECORD. Chaining is stored ALONGSIDE, in `<name>.chain`, one hash per line. The
 * archives themselves stay byte-for-byte what the hub wrote — anything else would mean this tool modifying the
 * very evidence it exists to protect, and would break every reader that already parses them.
 *
 * ⚠️ HONEST ABOUT HISTORY. Lines written before sealing began cannot be proven — they are hashed from today
 * forward and the head file records where each chain started. Claiming otherwise would be the same sin as an
 * error rendering as good news.
 */
const fs = require('fs'), path = require('path'), crypto = require('crypto');

const DATADIR = path.join(__dirname, 'hub-data');
const HEADS   = path.join(DATADIR, 'chain-heads.json');
const GENESIS = '0'.repeat(64);

/* every append-only record the hub keeps. Add to this list whenever a new one is created. */
const FILES = [
  'activity-archive.jsonl',
  'order-history.jsonl',
  'trail.jsonl',
  'sms-archive.jsonl',
  'card-events.jsonl',
  'client-errors.jsonl',
  'idempotency.jsonl',
  'delta-log.jsonl'
];

const has = n => process.argv.indexOf(n) >= 0;

/* canonical: sort keys so a re-serialisation cannot change the hash. A line that is not JSON is hashed as its
   raw text — it still belongs to the chain, and refusing to hash it would leave a gap an editor could hide in. */
function canon(line){
  try { const o = JSON.parse(line); return JSON.stringify(o, Object.keys(o).sort()); }
  catch (e) { return line; }
}
function link(prev, line){ return crypto.createHash('sha256').update(prev + '\n' + canon(line)).digest('hex'); }
function lines(file){
  try { return fs.readFileSync(file, 'utf8').split('\n').filter(l => l.length > 0); }
  catch (e) { return null; }
}
function readHeads(){ try { return JSON.parse(fs.readFileSync(HEADS, 'utf8')); } catch (e) { return {}; } }

function seal(){
  const heads = readHeads();
  let sealed = 0, added = 0;
  for (const name of FILES) {
    const src = path.join(DATADIR, name);
    const L = lines(src);
    if (L === null) continue;                                   // that record does not exist yet — not an error
    const chainFile = src + '.chain';
    let chain = lines(chainFile) || [];
    if (chain.length > L.length) {
      console.log('  ⛔ ' + name + ': the chain has MORE links (' + chain.length + ') than the record has lines (' +
                  L.length + '). The record has been TRUNCATED. Not sealing — investigate first.');
      continue;
    }
    let prev = chain.length ? chain[chain.length - 1] : GENESIS;
    const start = chain.length;
    for (let i = start; i < L.length; i++) { prev = link(prev, L[i]); chain.push(prev); }
    if (L.length > start) {
      fs.writeFileSync(chainFile, chain.join('\n') + '\n');
      added += (L.length - start);
    }
    heads[name] = { head: prev, lines: L.length, sealedAt: Date.now(),
                    since: (heads[name] && heads[name].since) || start };   // where this chain began
    sealed++;
  }
  heads.__sealedAt = new Date().toISOString();
  fs.writeFileSync(HEADS, JSON.stringify(heads, null, 2) + '\n');
  console.log('sealed ' + sealed + ' record(s), ' + added + ' new line(s) chained');
  console.log('heads written to ' + HEADS);
  console.log('\n⚠️  COMMIT chain-heads.json TO GIT. Without an anchor off this machine, anyone who can rewrite');
  console.log('    the log can recompute every link and this proves nothing.');
  return 0;
}

function verify(){
  const heads = readHeads();
  let bad = 0, checked = 0, unproven = 0;
  for (const name of FILES) {
    const src = path.join(DATADIR, name);
    const L = lines(src);
    if (L === null) continue;
    const chain = lines(src + '.chain');
    if (!chain) { console.log('  ⓘ ' + name + ' — not sealed yet, so nothing can be proven about it'); unproven++; continue; }
    if (chain.length > L.length) {
      console.log('  ❌ ' + name + ' — TRUNCATED: ' + chain.length + ' links but only ' + L.length + ' lines. ' +
                  (chain.length - L.length) + ' line(s) were removed from the end.');
      bad++; continue;
    }
    let prev = GENESIS, firstBad = -1;
    for (let i = 0; i < chain.length; i++) {
      prev = link(prev, L[i]);
      if (prev !== chain[i]) { firstBad = i; break; }
    }
    if (firstBad >= 0) {
      console.log('  ❌ ' + name + ' — line ' + (firstBad + 1) + ' does not match its hash. It was CHANGED after sealing.');
      console.log('       ' + String(L[firstBad]).slice(0, 160));
      bad++;
    } else {
      const tail = L.length - chain.length;
      console.log('  ✅ ' + name + ' — ' + chain.length + ' line(s) verified' +
                  (tail ? '  (+' + tail + ' appended since the last seal, not yet chained)' : '') +
                  (heads[name] && heads[name].since ? '   [chain begins at line ' + (heads[name].since + 1) + ']' : ''));
      checked++;
    }
  }
  console.log('');
  if (bad) console.log('❌ ' + bad + ' record(s) FAILED — the named line was altered or removed after it was sealed.');
  else console.log('✅ every sealed record is intact' + (unproven ? '  (' + unproven + ' not sealed yet)' : ''));
  console.log('⚠️  This proves nobody edited a LINE. It cannot prove nobody rewrote the WHOLE file unless the');
  console.log('    head hash in chain-heads.json is anchored off this machine (git). Check it matches.');
  return bad ? 1 : 0;
}

function showHeads(){
  const heads = readHeads();
  console.log('sealed at: ' + (heads.__sealedAt || 'never'));
  for (const name of FILES) {
    if (!heads[name]) continue;
    console.log('  ' + name.padEnd(26) + heads[name].head.slice(0, 16) + '…  ' + heads[name].lines + ' lines');
  }
  return 0;
}

if (has('--verify'))      process.exit(verify());
else if (has('--heads'))  process.exit(showHeads());
else if (has('--seal'))   process.exit(seal());
else { console.log('usage: hub-chain.js --seal | --verify | --heads'); process.exit(2); }
