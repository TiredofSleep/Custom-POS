/* check-app-js.js — pre-deploy syntax check for Ozark-POS.html's inline JavaScript.
   THE deploy gate: a malformed inline <script> would brick every station within seconds of a deploy
   (stations auto-reload on the new appRev), and `node --check` can't parse HTML. This extracts each
   inline <script> block and compiles it (vm.Script = full parser, nothing executed).

   Usage:   node check-app-js.js Ozark-POS.html
   Exit 0 = all inline scripts parse; exit 1 = syntax error (line number is relative to the script block;
   add the block's starting line to locate it in the HTML). Run this BEFORE every app deploy —
   see OPERATIONS-TECH.md §3. */
'use strict';
const fs = require('fs');
const vm = require('vm');

const file = process.argv[2] || 'Ozark-POS.html';
let src;
try { src = fs.readFileSync(file, 'utf8'); }
catch (e) { console.error('Cannot read ' + file + ': ' + e.message); process.exit(1); }

// find inline <script> blocks (skip src= ones — external files aren't part of the single-file app)
const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
let m, n = 0, bad = 0;
while ((m = re.exec(src))) {
  const attrs = m[1] || '';
  if (/\bsrc\s*=/i.test(attrs)) continue;                 // external script tag — nothing inline to check
  if (/\btype\s*=\s*["'](?!text\/javascript|module)/i.test(attrs)) continue; // templates/JSON blobs
  n++;
  const body = m[2];
  const startLine = src.slice(0, m.index).split('\n').length;
  try {
    new vm.Script(body, { filename: file + ':script#' + n });
    console.log('script #' + n + ' (starts ~line ' + startLine + '): OK (' + body.length + ' chars)');
  } catch (e) {
    bad++;
    console.error('script #' + n + ' (starts ~line ' + startLine + '): SYNTAX ERROR');
    console.error('  ' + (e.stack || e.message).split('\n').slice(0, 5).join('\n  '));
  }
}
console.log(n + ' inline script block(s) checked; ' + bad + ' with errors');
process.exit(bad ? 1 : 0);
