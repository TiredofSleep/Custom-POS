#!/usr/bin/env node
/* find-duplication.js — where is this app still saying the same thing twice? READ-ONLY.
 *
 *   node find-duplication.js Ozark-POS.html
 *   node find-duplication.js Ozark-POS.html --styles      only the inline-style clusters
 *   node find-duplication.js Ozark-POS.html --code        only the repeated code windows
 *
 * Owner, 2026-08-08: "let's clean up all these separate hand written blocks throughout the system... now is
 * our chance to make this software clean, before launch and adding anymore messes... we need a good
 * foundation!"
 *
 * Every serious bug this week came from the same shape: two copies of one idea, drifting apart.
 *   · the home tiles and the keyboard map disagreed about which key opens Rack
 *   · four hand-written note blocks meant a customer's reminder never reached the counter
 *   · the pickup screen kept its own copy of the flagged-piece list, and that copy leaked a <div>
 *   · the chase list rendered at 84px a row on two screens because each built its own list
 *
 * So this measures duplication instead of arguing about it. It reports three kinds, worst first:
 *   STYLE  an identical inline style="…" string used in N places — belongs in one CSS class
 *   HTML   an identical markup fragment built in N places — belongs in one helper
 *   CODE   an identical run of statements in N places — belongs in one function
 *
 * It is deliberately conservative: exact matches only, after whitespace normalisation. Anything it reports
 * is genuinely the same text in more than one place, so there is nothing to argue about — only whether it is
 * worth extracting. It never edits anything.
 */
const fs = require('fs');
const path = require('path');

const file = process.argv[2] || path.join(__dirname, 'Ozark-POS.html');
const only = process.argv.find(a => a === '--styles' || a === '--code' || a === '--html');
const html = fs.readFileSync(file, 'utf8');
const m = html.match(/<script>([\s\S]*)<\/script>/);
if (!m) { console.error('no inline <script> in ' + file); process.exit(1); }
const appJs = m[1];
const OFFSET = html.slice(0, m.index).split('\n').length;          // script line 1 == file line OFFSET
const lines = appJs.split('\n');
const fileLine = i => i + OFFSET;

const norm = s => s.replace(/\s+/g, ' ').trim();
const pad = (s, n) => (s + ' '.repeat(n)).slice(0, n);

console.log('══ DUPLICATION ══  ' + lines.length + ' lines of app code in ' + path.basename(file) + '\n');

/* ─────────── 1. inline styles ─────────── */
function styles(){
  const seen = new Map();
  lines.forEach((ln, i) => {
    (ln.match(/style="([^"]{25,})"/g) || []).forEach(s => {
      const v = norm(s.slice(7, -1));
      if (v.indexOf("'+") >= 0 || v.indexOf('+ ') >= 0) return;      // built at runtime — not a fixed class
      if (!seen.has(v)) seen.set(v, []);
      seen.get(v).push(fileLine(i));
    });
  });
  const hits = [...seen.entries()].filter(([, at]) => at.length >= 3)
    .sort((a, b) => b[1].length * b[0].length - a[1].length * a[0].length);
  console.log('── STYLE · the same inline style="…" in 3+ places (each belongs in one CSS class) ──');
  if (!hits.length) console.log('   none\n');
  let waste = 0;
  hits.slice(0, 14).forEach(([v, at]) => {
    waste += (at.length - 1) * v.length;
    console.log('  ' + pad('×' + at.length, 5) + pad(v.length + 'ch', 6) + v.slice(0, 96) + (v.length > 96 ? '…' : ''));
    console.log('        lines ' + at.slice(0, 10).join(', ') + (at.length > 10 ? ' …' : ''));
  });
  const totalWaste = hits.reduce((t, [v, at]) => t + (at.length - 1) * v.length, 0);
  console.log('\n   ' + hits.length + ' repeated style string(s) · ~' +
    Math.round(totalWaste / 1024) + 'KB of the file is the same styling written again\n');
}

/* ─────────── 2. repeated markup fragments ─────────── */
function frags(){
  const seen = new Map();
  lines.forEach((ln, i) => {
    // literal runs of markup between the app's string-concatenation seams
    (ln.match(/'(<[^']{40,})'/g) || []).forEach(s => {
      const v = norm(s.slice(1, -1));
      if (!seen.has(v)) seen.set(v, []);
      seen.get(v).push(fileLine(i));
    });
  });
  const hits = [...seen.entries()].filter(([, at]) => at.length >= 2)
    .sort((a, b) => b[1].length * b[0].length - a[1].length * a[0].length);
  console.log('── HTML · the same markup fragment built in 2+ places (belongs in one helper) ──');
  if (!hits.length) console.log('   none');
  hits.slice(0, 10).forEach(([v, at]) => {
    console.log('  ' + pad('×' + at.length, 5) + v.slice(0, 100) + (v.length > 100 ? '…' : ''));
    console.log('        lines ' + at.slice(0, 8).join(', ') + (at.length > 8 ? ' …' : ''));
  });
  console.log('');
}

/* ─────────── 3. repeated statement runs ─────────── */
function code(){
  const WIN = 3;                                   // three identical statements in two places is a helper
  const body = lines.map(l => {
    const t = norm(l);
    if (!t || t.startsWith('//') || t.startsWith('/*') || t.startsWith('*')) return '';
    return t;
  });
  const seen = new Map();
  for (let i = 0; i + WIN <= body.length; i++) {
    const win = body.slice(i, i + WIN);
    if (win.some(l => !l || l.length < 12)) continue;
    const key = win.join(' ⏎ ');
    if (key.length < 90) continue;
    if (!seen.has(key)) seen.set(key, []);
    seen.get(key).push(fileLine(i));
  }
  const hits = [...seen.entries()].filter(([, at]) => at.length >= 2)
    // drop overlapping windows of the same cluster
    .filter(([, at]) => at.every((v, k) => k === 0 || v - at[k - 1] > WIN))
    .sort((a, b) => b[0].length * b[1].length - a[0].length * a[1].length);
  console.log('── CODE · the same ' + WIN + '-statement run in 2+ places (belongs in one function) ──');
  if (!hits.length) console.log('   none');
  hits.slice(0, 10).forEach(([k, at]) => {
    console.log('  ×' + at.length + '  lines ' + at.join(', '));
    k.split(' ⏎ ').forEach(l => console.log('        ' + l.slice(0, 108) + (l.length > 108 ? '…' : '')));
  });
  console.log('');
}

if (!only || only === '--styles') styles();
if (!only || only === '--html') frags();
if (!only || only === '--code') code();

console.log('Nothing was changed. Extract worst-first, one commit each, and run all five gates between.');
