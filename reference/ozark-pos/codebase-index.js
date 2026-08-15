#!/usr/bin/env node
/* codebase-index.js — make this system findable by keyword. READ-ONLY except for --write.
 *
 *   node codebase-index.js                      coverage: how much of the system is labelled
 *   node codebase-index.js --find money card    every unit tagged money AND card
 *   node codebase-index.js --find route         …or one tag on its own
 *   node codebase-index.js --untagged           the work list, most-used first
 *   node codebase-index.js --tags               the controlled vocabulary, with counts
 *   node codebase-index.js --write              regenerate CODE-INDEX.md
 *
 * Owner, 2026-08-12: "this whole system should be labeled out internally so that finding anything is searchable
 * or at least narrowable by keyword... let's get organized and write the 80% of prose that turns this operational
 * flow of code into literature for technical use."
 *
 * ⚠️ WHY A TOOL FIRST, BEFORE WRITING ANY PROSE. There are 1,340 top-level functions here and roughly a fifth of
 * the file is already explanation — good explanation, written where it was needed most. But nobody could ANSWER
 * "how much is labelled?", "which parts are dark?", or "show me everything that touches a card", so the writing
 * could never be finished, only added to. Coverage you cannot measure is coverage that stalls. This makes the
 * remaining work a countable list that shrinks.
 *
 * THE CONVENTION, and it is deliberately the simplest thing that greps:
 *
 *     /* @money @card — charge a card already on file, the ONE way this app does it.
 *        …then as much prose as the unit deserves… *\/
 *     function chargeSavedCard(c, card, cents, opts){ … }
 *
 * A tag is @word from a CLOSED vocabulary (below). Unknown tags are reported as errors, because "narrowable by
 * keyword" only works if the keywords are the same words every time — @cards and @card would split the answer in
 * half and nobody would notice. The em-dash sentence after the tags is the unit's PURPOSE: what it is for, in one
 * line, in plain words. Everything after that is free prose.
 *
 * ⚠️ A LABEL IS NOT A RESTATEMENT OF THE NAME. "@money — charges a card" on chargeSavedCard earns nothing. The
 * purpose line should say what a reader cannot get from the signature: what it OWNS, what it refuses, or what it
 * costs. This file counts labels; it cannot judge them. That part is on whoever writes them.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const S = require('./src-scan');

/* ---------------------------------------------------------------------------------------------------------
   THE CONTROLLED VOCABULARY. One word per idea, chosen to match what somebody would actually type when they
   are looking for something. Grouped only for reading; the tool treats them as a flat set.
   --------------------------------------------------------------------------------------------------------- */
const VOCAB = {
  'money, and everything that can move it': ['money', 'card', 'ar', 'collections', 'drawer', 'credit', 'refund', 'price', 'tax', 'payroll'],
  'the shop floor, in the order a garment travels': ['intake', 'quick', 'detail', 'assemble', 'rack', 'pickup', 'quote', 'garment', 'order', 'bag', 'split', 'press'],
  'the route': ['route', 'driver', 'wizard', 'stop', 'delivery'],
  'keeping every device the same': ['sync', 'hub', 'merge', 'delta', 'mirror', 'storage', 'clock'],
  'talking to people': ['sms', 'email', 'print', 'portal', 'receipt'],
  'who is allowed to do what': ['employee', 'permission', 'timeclock', 'owner'],
  'the record of what happened': ['log', 'trail', 'audit', 'error', 'invariant'],
  'running the business': ['customer', 'account', 'store', 'inventory', 'supplies', 'checklist', 'feedback', 'report', 'settings', 'admin'],
  'the app itself': ['screen', 'nav', 'render', 'input', 'scan', 'keyboard', 'startup']
};
const ALL = Object.keys(VOCAB).reduce((a, k) => a.concat(VOCAB[k]), []);
const KNOWN = new Set(ALL);

/* --------------------------------------------------------------------------------------------------------- */
const args = process.argv.slice(2);
const flag = n => args.indexOf('--' + n) >= 0;
const after = n => { const i = args.indexOf('--' + n); return i < 0 ? [] : args.slice(i + 1).filter(a => !a.startsWith('--')); };
const file = args.find(a => /\.html?$/i.test(a)) || path.join(__dirname, 'Ozark-POS.html');
const app = S.load(file);
const funcs = app.funcs();

/* the prose block immediately above a declaration is its banner — walk up while lines are prose */
function bannerOf(f){
  const out = [];
  for (let i = f.from - 1; i >= 0 && app.prose[i]; i--) out.unshift(app.lines[i]);
  return out.join('\n');
}
/* the tail of the declaration line itself, for one-liners documented with a trailing comment */
function trailOf(f){
  const ln = app.lines[f.from] || '';
  const m = ln.match(/\/\*([\s\S]*?)\*\/\s*$/) || ln.match(/\/\/(.*)$/);
  return m ? m[1] : '';
}

const TAG_RE = /@([a-z][a-z0-9]*)/g;
const units = funcs.map(f => {
  const text = bannerOf(f) + '\n' + trailOf(f);
  const tags = []; let m;
  while ((m = TAG_RE.exec(text))) if (!tags.includes(m[1])) tags.push(m[1]);
  /* the purpose line: the em-dash sentence on the line carrying the first tag */
  let purpose = '';
  text.split('\n').some(l => {
    if (!/@[a-z]/.test(l)) return false;
    const p = l.split(/—|--/).slice(1).join('—').trim();
    if (p) purpose = p.replace(/\s+/g, ' ').replace(/\*\/\s*$/, '').trim();
    return !!p;
  });
  const documented = text.replace(/\s/g, '').length > 40;   /* has SOME explanation, tagged or not */
  return { f, name: f.name, at: f.at, lines: f.to - f.from + 1, tags, purpose, documented,
           bad: tags.filter(t => !KNOWN.has(t)) };
});

const uses = {};
(function(){
  /* one pass over the file counting every bare mention, so "most used" is cheap to ask for */
  const names = new Map(units.map(u => [u.name, 0]));
  const word = /[A-Za-z_$][\w$]*/g;
  app.lines.forEach((ln, i) => { if (app.prose[i]) return; let m; const c = S.code(ln);
    const own = c.match(/^function\s+([\w$]+)/);
    while ((m = word.exec(c))) if (names.has(m[0]) && (!own || own[1] !== m[0])) names.set(m[0], names.get(m[0]) + 1); });
  names.forEach((v, k) => uses[k] = v);
})();

const pad = (s, n) => String(s) + ' '.repeat(Math.max(0, n - String(s).length));

/* --------------------------------------------------------------------------------------------------- COVERAGE */
function coverage(){
  const tagged = units.filter(u => u.tags.length);
  const withPurpose = units.filter(u => u.purpose);
  const documented = units.filter(u => u.documented);
  const bad = units.filter(u => u.bad.length);
  const pc = n => Math.round(n * 100 / units.length) + '%';
  console.log('╔ LABELLING COVERAGE — ' + units.length + ' top-level units in ' + path.basename(file));
  console.log('║   explained at all (a banner or a trailing note) .... ' + pad(documented.length, 5) + pc(documented.length));
  console.log('║   TAGGED with a searchable keyword .................. ' + pad(tagged.length, 5) + pc(tagged.length));
  console.log('║   carrying a one-line PURPOSE ....................... ' + pad(withPurpose.length, 5) + pc(withPurpose.length));
  console.log('╚   the goal is a keyword on everything a person would go looking for.');
  if (bad.length){
    console.log('\n⚠ TAGS OUTSIDE THE VOCABULARY — these split a search in half and nobody notices:');
    bad.forEach(u => console.log('   L' + pad(u.at, 8) + pad(u.name, 26) + u.bad.map(t => '@' + t).join(' ')));
  }
  console.log('');
}

/* ------------------------------------------------------------------------------------------------------- FIND */
function find(words){
  if (!words.length) return console.log('give me a keyword: --find money\n');
  const want = words.map(w => w.replace(/^@/, '').toLowerCase());
  const bad = want.filter(w => !KNOWN.has(w));
  if (bad.length) console.log('⚠ not in the vocabulary: ' + bad.join(', ') + '   (try --tags)\n');
  const hits = units.filter(u => want.every(w => u.tags.includes(w)));
  console.log('── ' + want.map(w => '@' + w).join(' + ') + '  →  ' + hits.length + ' unit(s) ──');
  /* ⚠️ RANK BY WHAT SOMEBODY IS LOOKING FOR, NOT BY WHAT IS CALLED MOST. This sorted by fan-in, and measured
     cold-start on ten real questions that put the wanted unit at #1 only twice: renderDetail came #21 of 48 for
     @detail and chargeSavedCard #15 of 117 for @card. The reason is structural — a SCREEN is called exactly once
     by design (through the render map) and a money door a handful of times, while a formatting helper is called
     two hundred. Most-called is not most-important.
     So: units somebody deliberately wrote a PURPOSE line for come first (a human judged them worth explaining),
     then the substantial ones, then fan-in as the tie-break. */
  /* ⚠️ SIZE WAS ALSO WRONG, and measuring caught it: ranking [purpose, size, uses] lifted renderDetail from #21
     to #2 but dropped computeTotals from #2 to #38 for @money — the single most important unit under the single
     most important keyword — because it is only a few lines while screens are long. Neither fan-in alone nor size
     alone predicts what somebody wants. What does: whether a human bothered to write a purpose line, and then how
     widely it is used. */
  const weight = u => {
    /* a NAME containing the keyword is the strongest signal of all: somebody typing "detail" wants renderDetail
       or detailLine long before they want a helper that merely touches the detail screen. */
    const named = want.some(w => u.name.toLowerCase().indexOf(w) >= 0) ? 1 : 0;
    return [u.purpose ? 1 : 0, named, uses[u.name] || 0];
  };
  hits.sort((a, b) => { const A = weight(a), B = weight(b);
    return (B[0] - A[0]) || (B[1] - A[1]) || (B[2] - A[2]); }).forEach(u => {
    console.log('  ' + pad('L' + u.at, 9) + pad(u.name, 28) + pad((uses[u.name] || 0) + ' uses', 10) + u.tags.map(t => '@' + t).join(' '));
    if (u.purpose) console.log('      ' + u.purpose.slice(0, 150));
  });
  /* a keyword search that finds nothing must say whether the SUBJECT is missing or only the LABEL is */
  if (!hits.length){
    const loose = units.filter(u => want.some(w => new RegExp(w, 'i').test(u.name)));
    if (loose.length) console.log('   nothing tagged that yet, but these names match: ' +
      loose.slice(0, 12).map(u => u.name).join(', '));
  }
  console.log('');
}

/* --------------------------------------------------------------------------------------------------- UNTAGGED */
function untagged(){
  const list = units.filter(u => !u.tags.length).sort((a, b) => (uses[b.name] || 0) - (uses[a.name] || 0));
  console.log('── THE WORK LIST — ' + list.length + ' units with no keyword, most-used first ──');
  console.log('   (most used = a label there helps the most people find the most things)\n');
  list.slice(0, 60).forEach(u => console.log('  ' + pad('L' + u.at, 9) + pad(u.name, 30) +
    pad((uses[u.name] || 0) + ' uses', 10) + pad(u.lines + 'L', 6) + (u.documented ? 'has prose, needs a tag' : 'undocumented')));
  if (list.length > 60) console.log('  …and ' + (list.length - 60) + ' more');
  console.log('');
}

/* ------------------------------------------------------------------------------------------------------- TAGS */
function tags(){
  const count = {}; units.forEach(u => u.tags.forEach(t => count[t] = (count[t] || 0) + 1));
  Object.keys(VOCAB).forEach(group => {
    console.log('── ' + group + ' ──');
    console.log('   ' + VOCAB[group].map(t => '@' + t + (count[t] ? '(' + count[t] + ')' : '')).join('  '));
  });
  console.log('');
}

/* ------------------------------------------------------------------------------------------------------ WRITE */
function write(){
  const out = ['# CODE-INDEX.md — every labelled unit in the system, by keyword',
    '',
    '> ⚠️ **GENERATED — do not edit by hand.** `node codebase-index.js --write` rebuilds it from the source.',
    '> The labels live in `Ozark-POS.html` beside the code they describe, which is the only place they cannot',
    '> drift out of date. This file is a directory, not documentation.',
    '',
    'Owner, 2026-08-12: *"this whole system should be labeled out internally so that finding anything is',
    'searchable or at least narrowable by keyword."* Search a keyword here, or from a terminal:',
    '',
    '```bash',
    'node codebase-index.js --find money card',
    '```',
    ''];
  const tagged = units.filter(u => u.tags.length);
  out.push('**' + tagged.length + ' of ' + units.length + ' units labelled.** ' +
           units.filter(u => !u.tags.length).length + ' still to go — `node codebase-index.js --untagged`.', '');
  Object.keys(VOCAB).forEach(group => {
    const rows = [];
    VOCAB[group].forEach(t => {
      const hits = tagged.filter(u => u.tags.includes(t)).sort((a, b) => (uses[b.name] || 0) - (uses[a.name] || 0));
      if (hits.length) rows.push({ t, hits });
    });
    if (!rows.length) return;
    out.push('## ' + group.charAt(0).toUpperCase() + group.slice(1), '');
    rows.forEach(r => {
      out.push('### `@' + r.t + '` — ' + r.hits.length + ' unit' + (r.hits.length === 1 ? '' : 's'), '');
      out.push('| unit | line | uses | what it is for |');
      out.push('|---|---|---|---|');
      r.hits.forEach(u => out.push('| `' + u.name + '` | ' + u.at + ' | ' + (uses[u.name] || 0) + ' | ' +
        (u.purpose || '').replace(/\|/g, '\\|').slice(0, 190) + ' |'));
      out.push('');
    });
  });
  const p = path.join(path.dirname(file), 'CODE-INDEX.md');
  fs.writeFileSync(p, out.join('\n'), 'utf8');
  console.log('wrote ' + p + '  (' + tagged.length + ' labelled units)');
}

/* --------------------------------------------------------------------------------------------------- THE RATCHET
   ⚠️ Coverage you cannot measure stalls; coverage with no ratchet REGRESSES. Six gates check whether the code is
   correct and none checked whether it is still organised, so a single untagged function could quietly start the
   slide back.
   ⚠️ IT RATCHETS ON THE COUNT, NEVER ON A FIXED ZERO. A gate demanding perfection on day one gets commented out on
   day two; one that only forbids getting WORSE is one nobody argues with. Same reasoning as REVIEW-not-FAIL in
   audit-patterns rule I, and the same reason the tiered plan writes prose where it earns its place instead of
   everywhere. When the count improves, the baseline is lowered automatically — the ratchet only ever tightens. */
const BASELINE = path.join(__dirname, '.labels-baseline.json');

/* ⚠️ AN UNREFERENCED FUNCTION IS EITHER MARKED OR IT IS A LOOSE END. Phase 4a read all 48 and banner-marked 47;
   the count is ratcheted so the next one cannot quietly join them. Three things are deliberately NOT counted:
   · anything already carrying a HISTORICAL banner — it has been read and judged;
   · anything referenced from the STATIC MARKUP rather than the script (setStore, supportModal are wired there);
   · anything inside a byte-identical shared block. mirrorDrift looks unreferenced HERE and is called by the HUB
     on every mirror report — the app carries the block only so both ends provably agree. Counting it would
     teach a reader that the honest banner on it is a mistake. */
function orphanCount(){
  const raw = fs.readFileSync(file, 'utf8');
  const outside = raw.split(app.appJs).join('\n@@\n');
  const shared = [];
  ['STAMP-SCALE v1', 'MIRROR-ALGO v1'].forEach(nm => {
    const a = app.lines.findIndex(l => l.indexOf('/* <' + nm + '>') === 0);
    const b = app.lines.findIndex(l => l.indexOf('/* </' + nm + '>') === 0);
    if (a >= 0 && b > a) shared.push([a, b]);
  });
  const inShared = i => shared.some(([a, b]) => i >= a && i <= b);
  const esc2 = n => n.replace(/\$/g, '\\$');
  return funcs.filter(f => {
    if (inShared(f.from)) return false;
    const word = new RegExp('\\b' + esc2(f.name) + '\\b');
    const own = new RegExp('^function\\s+' + esc2(f.name) + '\\b');
    for (let i = 0; i < app.lines.length; i++){
      if (app.prose[i] || own.test(app.lines[i])) continue;
      if (word.test(S.code(app.lines[i]))) return false;
    }
    if (word.test(outside)) return false;
    const banner = (function(){ const o = []; for (let i = f.from - 1; i >= 0 && app.prose[i]; i--) o.unshift(app.lines[i]); return o.join('\n'); })();
    return !/HISTORICAL/.test(banner);
  }).map(f => f.name);
}

function gate(){
  const untagged = units.filter(u => !u.tags.length).length;
  const bad = units.filter(u => u.bad.length);
  let base = { untagged: Infinity };
  try { base = JSON.parse(fs.readFileSync(BASELINE, 'utf8')); } catch (e) { /* first run sets it */ }
  console.log('── LABEL RATCHET ──');
  console.log('   untagged now: ' + untagged + '   allowed: ' + (base.untagged === Infinity ? '(no baseline yet)' : base.untagged));
  if (bad.length){
    console.log('\n✗ ' + bad.length + ' tag(s) outside the vocabulary — a search only narrows if the keyword is the same word every time:');
    bad.forEach(u => console.log('   L' + u.at + '  ' + u.name + '  ' + u.bad.map(t => '@' + t).join(' ')));
    process.exit(1);
  }
  if (untagged > base.untagged){
    console.log('\n✗ ' + (untagged - base.untagged) + ' new unit(s) with no keyword. Add one, or run --untagged to see them.');
    console.log('  Every unit is findable today; that is a state worth keeping rather than re-earning.');
    process.exit(1);
  }
  const orphans = orphanCount();
  const baseOrph = (base.orphans == null) ? Infinity : base.orphans;
  console.log('   unreferenced and unmarked: ' + orphans.length + '   allowed: ' + (baseOrph === Infinity ? '(no baseline yet)' : baseOrph));
  if (orphans.length > baseOrph){
    console.log('\n✗ ' + (orphans.length - baseOrph) + ' function(s) nothing calls, carrying no HISTORICAL banner:');
    orphans.slice(0, 12).forEach(n => console.log('   ' + n));
    console.log('  Either wire it up, or mark it — an unreferenced function with no note is a question nobody can answer later.');
    process.exit(1);
  }
  if (untagged < base.untagged || orphans.length < baseOrph || base.untagged === Infinity){
    fs.writeFileSync(BASELINE, JSON.stringify({ untagged: untagged, orphans: orphans.length, of: units.length,
      note: 'Written by codebase-index.js --gate. Lower is better; the gate refuses an increase. See ORGANIZATION-PLAN.md.' }, null, 2) + '\n', 'utf8');
    console.log('   ✅ improved — baseline lowered to ' + untagged);
  } else console.log('   ✅ holding at ' + untagged);
  console.log('');
}

if (flag('gate')) gate();
else if (flag('find')) find(after('find'));
else if (flag('untagged')) untagged();
else if (flag('tags')) tags();
else if (flag('write')) { coverage(); write(); }
else coverage();

process.exit(0);
