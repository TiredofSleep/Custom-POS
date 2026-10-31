#!/usr/bin/env node
/* @facts @import — brings the facts engine into facts/ from the private exporter's output, exactly as its manifest lists, and
   checks that facts/ still matches what was brought in.
   usage:  node tools/import-facts.js <export folder>   → facts/ (the listed files) + facts/PROVENANCE.json
           node tools/import-facts.js --verify          → every imported file is still byte-for-byte what was imported (tests/facts-engine.js)

   The engine comes from the origin shop's v2. It reaches this public repo only through that shop's PRIVATE exporter, which refuses
   while any real name, phone, address, server detail or secret survives, and which runs the engine laws inside its own output before
   it writes a manifest (docs/V2-MODULAR-IMPORT.md, Part 4). This tool trusts nothing else: it takes only files the manifest names, only
   when each one's size and SHA-256 match, only from an export that says it was made from committed source, with the private people
   check on, and with the laws passing. It never reads the private repo.

   The imported files are not edited here. A change to one is made upstream and re-exported; --verify fails on a hand edit, so the
   provenance stays true. Files this repo writes itself live beside them (OWN below) and are never touched by an import. */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const FACTS = path.join(ROOT, 'facts');
const PROV = path.join(FACTS, 'PROVENANCE.json');
/* this repo's own files under facts/: written here, never by an import */
const OWN = ['facts/README.md', 'facts/PROVENANCE.json', 'facts/server.js', 'facts/bundle.js', 'facts/test/wire.test.js', 'facts/test/bundle.test.js'];

/* @facts — SHA-256 of a text file as git stores it (LF), so a Windows checkout that turned LF into CRLF still verifies */
function shaLF(buf) { return crypto.createHash('sha256').update(Buffer.from(buf.toString('utf8').replace(/\r\n/g, '\n'), 'utf8')).digest('hex'); }
/* @facts — every file under a folder, as forward-slash paths relative to base (the repo root unless given), with their real case */
function walk(dir, base) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  (function w(d) { fs.readdirSync(d, { withFileTypes: true }).forEach(function (e) { const p = path.join(d, e.name); if (e.isDirectory()) w(p); else out.push(path.relative(base || ROOT, p).split(path.sep).join('/')); }); })(dir);
  return out;
}
/* @facts — a path that is this repo's own in any letter case (a case-insensitive disk would land it on the own file) */
function ownAnyCase(p) { const l = String(p).toLowerCase(); return OWN.some(function (o) { return o.toLowerCase() === l; }); }

/* @facts @import — the import: refuses anything the manifest does not vouch for, then copies, then writes the provenance */
function importFrom(src) {
  const no = function (why) { console.error('refused: ' + why + ' — nothing was imported'); process.exit(1); };
  const mf = path.join(src, 'manifest.json');
  if (!fs.existsSync(mf)) no('no manifest.json in ' + src);
  const m = JSON.parse(fs.readFileSync(mf, 'utf8'));
  if (!m.unit || !Array.isArray(m.files) || !m.files.length) no('the manifest names no unit or no files');
  if (m.sourceClean !== true) no('the export was made from uncommitted source (sourceClean is not true)');
  if (!m.peopleList || m.peopleList.used !== true) no('the export ran without the private people check');
  if (!Array.isArray(m.proofs) || !m.proofs.length || !m.proofs.every(function (p) { return p.passed > 0; })) no('the manifest does not show the engine laws passing');
  const listed = new Set(m.files.map(function (f) { return f.path; }));
  const extra = walk(src).map(function (p) { return path.relative(src, path.join(ROOT, p)).split(path.sep).join('/'); }).filter(function (p) { return !listed.has(p) && p !== 'manifest.json' && p !== '.custompos-export'; });
  if (extra.length) no('the export folder holds files the manifest does not list: ' + extra.slice(0, 5).join(', '));
  m.files.forEach(function (f) {
    if (!/^facts\/[A-Za-z0-9_\-./]+\.js$/.test(f.path) || f.path.indexOf('..') >= 0) no('a listed path is not a plain facts/*.js file: ' + f.path);
    if (path.posix.normalize(f.path) !== f.path) no('a listed path is not in plain form: ' + f.path);
    if (ownAnyCase(f.path)) no(f.path + ' is this repo\'s own file (in some letter case) and cannot be imported over');
    const b = fs.readFileSync(path.join(src, f.path));
    if (b.length !== f.bytes) no(f.path + ' is ' + b.length + ' bytes; the manifest says ' + f.bytes);
    if (crypto.createHash('sha256').update(b).digest('hex') !== f.sha256) no(f.path + ' does not match its SHA-256');
    if (b.indexOf(13) >= 0) no(f.path + ' holds a carriage return — an export is LF, as git stores it (re-export)');
  });
  const lower = new Map();
  m.files.forEach(function (f) { const l = f.path.toLowerCase(); if (lower.has(l)) no('two listed paths differ only in letter case: ' + lower.get(l) + ', ' + f.path); lower.set(l, f.path); });
  /* a file a previous import brought in that this one no longer lists would linger unvouched: refuse rather than guess */
  const stale = walk(FACTS).filter(function (p) { return OWN.indexOf(p) < 0 && !listed.has(p); });
  if (stale.length) no('facts/ holds files neither this import nor this repo owns (remove them on purpose first): ' + stale.slice(0, 5).join(', '));
  m.files.forEach(function (f) { const to = path.join(ROOT, f.path); fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(path.join(src, f.path), to); });
  const prov = { what: 'the facts engine, from the origin shop\'s v2 through its private exporter (docs/V2-MODULAR-IMPORT.md)', unit: m.unit,
    sourceCommit: m.sourceCommit, exported: m.made, node: m.node, proofs: m.proofs,
    files: m.files.map(function (f) { return { path: f.path, bytes: f.bytes, sha256: f.sha256 }; }) };
  fs.writeFileSync(PROV, JSON.stringify(prov, null, 2) + '\n');
  console.log('imported ' + m.files.length + ' files from export ' + String(m.sourceCommit).slice(0, 8) + ' (' + m.unit + '; laws ' + m.proofs.map(function (p) { return p.passed; }).join('+') + ' passed upstream) → facts/');
}

/* @facts @proof — facts/ still matches what was imported: every listed file present BY ITS EXACT NAME and unchanged, nothing unvouched
   beside them. root: a copy of the repo to check instead (the suite's negative controls plant drift in a temp copy). */
function verify(root) {
  const R = root || ROOT, prov = path.join(R, 'facts', 'PROVENANCE.json'), bad = [];
  if (!fs.existsSync(prov)) return ['facts/PROVENANCE.json is missing'];
  const p = JSON.parse(fs.readFileSync(prov, 'utf8')), listed = new Set(), have = new Set(walk(path.join(R, 'facts'), R));
  p.files.forEach(function (f) {
    listed.add(f.path);
    if (ownAnyCase(f.path)) { bad.push(f.path + ' is listed as imported but is this repo\'s own file'); return; }
    if (!have.has(f.path)) { bad.push(f.path + ' is missing (by its exact name)'); return; }
    if (shaLF(fs.readFileSync(path.join(R, f.path))) !== f.sha256) bad.push(f.path + ' was changed after it was imported (change it upstream and re-export)');
  });
  have.forEach(function (q) { if (OWN.indexOf(q) < 0 && !listed.has(q)) bad.push(q + ' is in facts/ but neither imported nor this repo\'s own'); });
  return bad;
}

if (require.main === module) {
  const a = process.argv[2];
  if (a === '--verify') { const bad = verify(); if (bad.length) { bad.forEach(function (b) { console.error('✗ ' + b); }); process.exit(1); } console.log('✓ facts/ matches facts/PROVENANCE.json'); }
  else if (a) importFrom(path.resolve(a));
  else { console.error('usage: node tools/import-facts.js <export folder> | --verify'); process.exit(2); }
}
module.exports = { verify: verify, OWN: OWN };
