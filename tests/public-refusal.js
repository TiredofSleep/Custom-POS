/* @proof @facts — THE PUBLIC REFUSAL SUITE. Pure Node, no browser.
   Every module this repo carries — the facts engine in facts/ and each trade pack in packs/ — is scanned for what must never be
   published: phone numbers (the 555 exchange is the fixtures' own), e-mail addresses (example domains only), IP addresses other than
   loopback, server paths, personal user folders, the origin shop's brand, and the shapes of secrets. Every file in scope is read,
   whatever its extension; only binaries are skipped. A maintainer's own private words (tests/private-words.local.txt, which git
   ignores) are refused too, when that file is present.
   The people list behind the private exporter can never live here, so this scans PATTERNS only (docs/V2-MODULAR-IMPORT.md, Part 4).
   It prints the kind and file:line of each hit, never the matched text. Its own negative controls: one planted sample per pattern,
   each of which must be caught, and a planted file in a temp tree that proves the walk reaches into packs/ and past .js files
   (a scanner that cannot fail is not evidence).
   The older reference trees (reference/, single-pc/) are the origin shop's first, separately scrubbed release and are not modules; the
   docs name these patterns in prose to explain them. Neither is in scope. */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SCOPE = ['facts', 'packs'];
const BINARY_EXT = /\.(png|jpe?g|gif|ico|webp|woff2?|ttf|otf|db|sqlite|zip|gz|pdf)$/i;
const SEP = '[-.\\s/\\u2010-\\u2015]';
const OK_MAIL = /@(example\.(com|org|net)|[a-z0-9.-]+\.(example|test|invalid|localhost))$/i;
/* a number shaped like a phone that is not one, by file and count: 2^32, the engine clock's counter ceiling */
const NUMBER_OK = [['facts/core/event.js', '4294967296', 1], ['facts/core/hlc.js', '4294967296', 1]];
/* a maintainer's private words: one a line, # for a comment; the file never enters git */
const LOCAL_WORDS_FILE = path.join(__dirname, 'private-words.local.txt');
const LOCAL_WORDS = fs.existsSync(LOCAL_WORDS_FILE) ? fs.readFileSync(LOCAL_WORDS_FILE, 'utf8').split(/\r?\n/).map(function (w) { return w.trim().toLowerCase(); }).filter(function (w) { return w.length >= 3 && w[0] !== '#'; }) : [];

/* @proof — every regex hit's offset */
function hits(r, s) { const out = []; let m; const g = new RegExp(r.source, r.flags.indexOf('g') >= 0 ? r.flags : r.flags + 'g'); while ((m = g.exec(s))) out.push({ i: m.index }); return out; }
/* @proof — each pattern: a name and a finder over one file's text → offsets */
const PATTERNS = [
  ['phone', function (s) { const r = new RegExp('(?<![0-9A-Za-z_])(?:\\+?1' + SEP + '{0,2})?(?:\\(([2-9]\\d\\d)\\)' + SEP + '{0,2}|([2-9]\\d\\d)' + SEP + '{0,2})([2-9]\\d\\d)' + SEP + '{0,2}(\\d{4})(?![0-9])', 'g'); const out = []; let m; while ((m = r.exec(s))) if (m[3] !== '555') out.push({ i: m.index, digits: (m[1] || m[2]) + m[3] + m[4] }); return out; }],
  ['email', function (s) { const r = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g, out = []; let m; while ((m = r.exec(s))) if (!OK_MAIL.test(m[0])) out.push({ i: m.index }); return out; }],
  ['ipv4', function (s) { const r = /(?<![0-9]|[0-9]\.)(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?![0-9]|\.[0-9])/g, out = []; let m; while ((m = r.exec(s))) if (m[1] !== '127' && m[0] !== '0.0.0.0') out.push({ i: m.index }); return out; }],
  ['server-path', function (s) { const r = /(^|[^A-Za-z0-9_.])\/(?:opt|root|srv|home)\//gm, out = []; let m; while ((m = r.exec(s))) out.push({ i: m.index + m[1].length }); return out; }],
  ['user-folder', function (s) { return hits(/[A-Za-z]:[\\/]+Users[\\/]+|\/Users\/[A-Za-z]|%USERPROFILE%/i, s); }],
  ['origin-brand', function (s) { return hits(/ozark|droplet/i, s); }],
  ['secret', function (s) { return hits(new RegExp([
    '\\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{16,}', 'Bearer\\s+[A-Za-z0-9._~+\\/-]{20,}', '-----BEGIN [A-Z ]*PRIVATE KEY-----', 'eyJ[\\w-]{8,}\\.[\\w-]{8,}\\.[\\w-]{8,}',
    'gh[pousr]_[A-Za-z0-9]{36}', 'github_pat_[A-Za-z0-9_]{60,}', 'AKIA[0-9A-Z]{16}', 'xox[abprs]-[A-Za-z0-9-]{10,}', '\\b(?:AC|SK)[0-9a-f]{32}\\b', 'AIza[0-9A-Za-z_-]{35}',
    '(?:pass(?:word)?|secret|api[_-]?key|auth[_-]?token)["\']?\\s*[:=]\\s*["\'][^"\'\\s]{8,}["\']'].join('|'), 'i'), s); }],
  ['private-word', function (s) { const low = s.toLowerCase(), out = []; LOCAL_WORDS.forEach(function (w) { let i = low.indexOf(w); while (i >= 0) { out.push({ i: i }); i = low.indexOf(w, i + 1); } }); return out; }]
];

/* @proof — every non-binary file in scope under a root, as forward-slash paths (binary: a known extension, or a NUL in its first 8 KB) */
function files(root) {
  const out = [];
  SCOPE.forEach(function (top) {
    const d0 = path.join(root, top); if (!fs.existsSync(d0)) return;
    (function w(d) { fs.readdirSync(d, { withFileTypes: true }).forEach(function (e) {
      const p = path.join(d, e.name); if (e.isDirectory()) { w(p); return; }
      if (BINARY_EXT.test(e.name)) return;
      const head = fs.readFileSync(p).subarray(0, 8192); if (head.indexOf(0) >= 0) return;
      out.push(path.relative(root, p).split(path.sep).join('/'));
    }); })(d0);
  });
  return out;
}
/* @proof — the files in scope under a root, read */
function read(root) { const map = {}; files(root).forEach(function (rel) { map[rel] = fs.readFileSync(path.join(root, rel), 'utf8'); }); return map; }

/* @proof — the scan over {path: text}: [{kind, file, line}] plus the count-checked exceptions */
function scan(map) {
  const found = [], used = {};
  Object.keys(map).forEach(function (rel) {
    const s = map[rel];
    PATTERNS.forEach(function (p) {
      p[1](s).forEach(function (h) {
        if (p[0] === 'phone') { const ok = NUMBER_OK.filter(function (n) { return n[0] === rel && n[1] === h.digits; })[0]; if (ok) { used[rel + h.digits] = (used[rel + h.digits] || 0) + 1; return; } }
        found.push({ kind: p[0], file: rel, line: s.slice(0, h.i).split('\n').length });
      });
    });
  });
  NUMBER_OK.forEach(function (n) { if (map[n[0]] != null && (used[n[0] + n[1]] || 0) !== n[2]) found.push({ kind: 'number-ok drift', file: n[0], line: 0 }); });
  return found;
}

let fail = 0;
/* @proof — one check, said */
function check(ok, words) { console.log((ok ? '  ✓ ' : '  ✗ ') + words); if (!ok) fail++; }

console.log('\n— public refusal: ' + SCOPE.join('/, ') + '/ —' + (LOCAL_WORDS.length ? ' (with ' + LOCAL_WORDS.length + ' private words from the local list)' : ''));
const map = read(ROOT);
check(Object.keys(map).length > 10, Object.keys(map).length + ' files in scope (the scan reads real files)');
const found = scan(map);
if (found.length) { const by = {}; found.forEach(function (f) { (by[f.kind] = by[f.kind] || []).push(f.file + ':' + f.line); }); Object.keys(by).forEach(function (k) { console.log('      ' + k + ' ×' + by[k].length + ' — ' + by[k].slice(0, 8).join(', ')); }); }
check(!found.length, 'nothing that must never be published is in a module');

/* the negative controls: each pattern catches a planted sample, built from parts so this file carries none whole (phones use the N11
   code 311, which can never be a real area code) */
const PLANTS = [['phone', '+1 311 ' + '201 3344'], ['phone', '311' + '\u2013201\u20133344'], ['email', 'someone@' + 'gmail.com'], ['ipv4', 'at 203.0.' + '113.7.'],
  ['server-path', ' /op' + 't/app/x'], ['user-folder', 'C:' + '\\Users\\' + 'someone'], ['origin-brand', 'Oza' + 'rk'],
  ['secret', 'sk_' + 'live_' + 'abcdefghijklmnop1234'], ['secret', 'gh' + 'p_' + 'a'.repeat(36)], ['secret', 'AK' + 'IA' + 'ABCDEFGHIJKLMNOP'],
  ['secret', 'xox' + 'b-' + '1234567890-abcdef'], ['secret', 'AI' + 'za' + 'B'.repeat(35)], ['secret', 'pass' + 'word: "' + 'hunter22hunter' + '"']];
PLANTS.forEach(function (pl) { const hit = scan({ 'packs/planted.js': '/* ' + pl[1] + ' */\n' }).some(function (f) { return f.kind === pl[0]; }); check(hit, 'a planted ' + pl[0] + ' is caught (' + pl[1].slice(0, 4) + '…)'); });
check(!scan({ 'packs/clean.js': "var t = '555-0100'; var m = 'a@example.com'; var h = '127.0.0.1';\n" }).length, 'the fixtures\' own values (555, example.com, loopback) are not refused');
check(scan({ 'facts/core/hlc.js': 'x\n' }).some(function (f) { return f.kind === 'number-ok drift'; }), 'an allowed number that is no longer where it is listed is refused (the list stays true)');
/* the walk itself: a temp tree with a phone planted in a CSV deep in packs/ and a key in a shell script — both must be read and caught */
(function () {
  const t = fs.mkdtempSync(path.join(os.tmpdir(), 'custompos-refusal-'));
  try {
    fs.mkdirSync(path.join(t, 'packs', 'trade', 'seed'), { recursive: true }); fs.mkdirSync(path.join(t, 'facts'), { recursive: true });
    fs.writeFileSync(path.join(t, 'packs', 'trade', 'seed', 'customers.csv'), 'name,phone\nA,311-' + '201-3344\n');
    fs.writeFileSync(path.join(t, 'packs', 'trade', 'deploy.sh'), '#!/bin/sh\nexport KEY=sk_' + 'live_' + 'abcdefghijklmnop1234\n');
    fs.writeFileSync(path.join(t, 'packs', 'trade', 'logo.png'), Buffer.from([137, 80, 78, 71, 0, 0, 0]));
    const m2 = read(t), f2 = scan(m2);
    check(f2.some(function (f) { return f.kind === 'phone' && /customers\.csv$/.test(f.file); }), 'the walk reads a .csv deep in packs/ and catches its phone');
    check(f2.some(function (f) { return f.kind === 'secret' && /deploy\.sh$/.test(f.file); }), 'the walk reads a .sh and catches its key');
    check(!Object.keys(m2).some(function (k) { return /logo\.png$/.test(k); }), 'a binary is skipped, not misread');
  } finally { fs.rmSync(t, { recursive: true, force: true }); }
})();

console.log('\n' + (fail ? fail + ' failed' : 'public refusal: all checks passed'));
process.exit(fail ? 1 : 0);
