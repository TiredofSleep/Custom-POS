#!/usr/bin/env node
/* @facts @station — THE FACTS ENGINE FOR A BROWSER: every station-side engine module in one file, zero dependencies. This repo's own
   file (the origin shop's bundler lists the shop's own modules, so it is rebuilt here, not imported).
   Each module is wrapped in a function with its own module, exports and require. A require must be require('a plain string'): a
   relative one must land on a file in FILES, and `crypto` is station/crypto-shim.js (a SHA-256 the engine laws prove equal to Node's).
   Anything else — another Node module, a file outside the list, a require that is not a plain string — STOPS THE BUILD, so it is never
   a surprise on a tablet.
     node facts/bundle.js                     prints what it would build (files, bytes)
     node facts/bundle.js --out <file>        writes the bundle
     require('./facts/bundle').build()        the bundle's text; build({ extra: { 'core/x.js': '…' } }) adds modules (the proofs')
   The bundle sets globalThis.CustomPOSFacts = { station, sync, http, browserStore, registry, event, hlc, incfold, log, timeclock }. */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const FILES = ['station/crypto-shim.js', 'core/hlc.js', 'core/event.js', 'core/registry.js', 'core/incfold.js', 'core/log.js', 'core/station.js',
  'sync/sync.js', 'sync/http.js', 'store/browser.js', 'aggregates/timeclock.js'];
const EXPOSE = { station: 'core/station.js', sync: 'sync/sync.js', http: 'sync/http.js', browserStore: 'store/browser.js', registry: 'core/registry.js',
  event: 'core/event.js', hlc: 'core/hlc.js', incfold: 'core/incfold.js', log: 'core/log.js', timeclock: 'aggregates/timeclock.js' };

/* @facts @station — each module's requires, resolved: spec → module key; throws on anything the bundle cannot serve */
function resolveAll(key, src, have) {
  /* pre-push review: a require spelled with a \u escape, reached through arguments, or built by eval / Function got past the scan
     below and failed only on a tablet. None belongs in an engine module, so each stops the build here. */
  const sneaky = /\\u\{?[0-9a-fA-F]{2,6}\}?(?=[A-Za-z_$])|\\u\{?0*(?:4[1-9a-fA-F]|5[0-9aA]|6[1-9a-fA-F]|7[0-9aA])\}?|\barguments\b|\beval\b|\bFunction\s*\(/.exec(src);
  if (sneaky) throw new Error(key + ': ' + JSON.stringify(sneaky[0]) + ' — an escaped name, arguments, eval or Function has no place in an engine module (the bundle cannot vouch for what it loads)');
  const table = {}, dir = path.posix.dirname(key), any = /\brequire\b/g; let m;
  while ((m = any.exec(src))) {
    const lit = /^require\s*\(\s*(['"])([^'"\n]+)\1\s*\)/.exec(src.slice(m.index));
    if (!lit) throw new Error(key + ': a require that is not require(\'a plain string\') — the bundle cannot serve it');
    const spec = lit[2];
    if (spec === 'crypto') { table[spec] = 'station/crypto-shim.js'; continue; }
    if (spec[0] !== '.') throw new Error(key + ': require(\'' + spec + '\') — a Node module the browser does not have');
    let tgt = path.posix.normalize(path.posix.join(dir, spec)); if (!/\.js$/.test(tgt)) tgt += '.js';
    if (have.indexOf(tgt) < 0) throw new Error(key + ': require(\'' + spec + '\') lands outside the bundle\'s list (' + tgt + ')');
    table[spec] = tgt;
  }
  return table;
}

/* @facts @station — the bundle's text (opts.extra: more modules by key, for the proofs) */
function build(opts) {
  const extra = (opts && opts.extra) || {}, keys = FILES.concat(Object.keys(extra));
  const src = function (k) { return Object.prototype.hasOwnProperty.call(extra, k) ? extra[k] : fs.readFileSync(path.join(ROOT, k), 'utf8'); };
  const parts = keys.map(function (k) {
    const s = src(k), table = resolveAll(k, s, keys);
    return '__def(' + JSON.stringify(k) + ', ' + JSON.stringify(table) + ', function (module, exports, require) {\n' + s + '\n});';
  });
  const text = assemble(parts);
  /* the last gate: the built text runs once in a bare context (no require, no process) and every module loads — whatever the scan
     missed still stops the build, never a tablet */
  const vm = require('vm'), nodeCrypto = require('crypto');
  const ctx = { console: { log: function () {}, warn: function () {}, error: function () {} }, TextEncoder: TextEncoder, crypto: { getRandomValues: function (b) { return nodeCrypto.randomFillSync(b); } }, setTimeout: setTimeout, clearTimeout: clearTimeout };
  ctx.globalThis = ctx; vm.createContext(ctx);
  try { vm.runInContext(assemble(parts, true), ctx); }
  catch (e) { throw new Error('the built bundle does not run with no Node: ' + e.message); }
  try { keys.forEach(function (k) { ctx.__factsLoad(k); }); } catch (e) { throw new Error('a module does not load inside the bundle: ' + e.message); }
  return text;
}
/* @facts @station — the bundle's wrapper around its modules (gate: the build's own test copy also hands out its loader) */
function assemble(parts, gate) {
  return '/* the facts engine for a browser — built by facts/bundle.js; do not edit, rebuild */\n(function (G) {\n"use strict";\n' +
    'var __mods = {}, __cache = {};\n' +
    'function __def(k, table, fn) { __mods[k] = { table: table, fn: fn }; }\n' +
    'function __load(k) { if (__cache[k]) return __cache[k].exports; var m = __mods[k]; if (!m) throw new Error("not in the bundle: " + k); var mod = { exports: {} }; __cache[k] = mod;\n' +
    '  m.fn(mod, mod.exports, function (spec) { var t = m.table[spec]; if (!t) throw new Error(k + ": require(\\"" + spec + "\\") is not in the bundle"); return __load(t); }); return mod.exports; }\n' +
    parts.join('\n') + '\n' +
    (gate ? 'G.__factsLoad = __load;\n' : '') +
    'G.CustomPOSFacts = {' + Object.keys(EXPOSE).map(function (n) { return ' ' + n + ': __load(' + JSON.stringify(EXPOSE[n]) + ')'; }).join(',') + ' };\n' +
    '})(typeof globalThis !== "undefined" ? globalThis : this);\n';
}

module.exports = { build: build, FILES: FILES, EXPOSE: EXPOSE };

if (require.main === module) {
  const a = process.argv.slice(2), i = a.indexOf('--out'), text = build();
  if (i >= 0 && a[i + 1]) { fs.mkdirSync(path.dirname(path.resolve(a[i + 1])), { recursive: true }); fs.writeFileSync(a[i + 1], text); console.log('wrote ' + a[i + 1] + ' (' + FILES.length + ' modules, ' + Buffer.byteLength(text) + ' bytes)'); }
  else console.log('the facts bundle: ' + FILES.length + ' modules, ' + Buffer.byteLength(text) + ' bytes (add --out <file> to write it)');
}
