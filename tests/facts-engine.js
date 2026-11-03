/* @proof @facts — THE FACTS ENGINE: its proofs, run from the standard suite. Pure Node, no browser.
   - facts/ is still byte-for-byte what was imported (tools/import-facts.js --verify): a hand edit to an imported file fails here.
   - the engine laws (facts/test/engine-laws.test.js): exactly as many pass here as passed inside the export upstream.
   - the wire (facts/test/wire.test.js): the engine over HTTP against this repo's small hub (facts/server.js).
   - the bundle (facts/test/bundle.test.js): the engine runs with no Node, and the build refuses what it cannot serve.
   Needs Node 22 or newer (node:sqlite). On an older Node this FAILS and says so: a run that ran nothing must never read as a pass. */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const FACTS = path.join(ROOT, 'facts');
let fail = 0;
/* @proof — one check, said */
function check(ok, words) { console.log((ok ? '  ✓ ' : '  ✗ ') + words); if (!ok) fail++; }

console.log('\n— the facts engine (facts/) —');
const major = Number(process.versions.node.split('.')[0]);
check(major >= 22, 'Node ' + process.versions.node + (major >= 22 ? '' : ' — the facts engine needs Node 22 or newer (node:sqlite); nothing below was run'));
if (major < 22) { console.log('\nfacts engine: FAILED (Node too old)'); process.exit(1); }

const bad = require('../tools/import-facts').verify();
check(!bad.length, 'facts/ matches facts/PROVENANCE.json' + (bad.length ? ': ' + bad.slice(0, 3).join('; ') : ''));
const prov = JSON.parse(fs.readFileSync(path.join(FACTS, 'PROVENANCE.json'), 'utf8'));
const upstream = (prov.proofs || []).reduce(function (n, p) { return n + (p.passed || 0); }, 0);

/* the provenance check can FAIL (pre-push review: a verify() that always said yes still passed this suite): a temp copy of facts/,
   one drift planted at a time — an edit, a deletion, an added file, a rename — and each must be named; the clean copy must pass */
(function () {
  const os = require('os'), IMP = require('../tools/import-facts'), verifyAt = IMP.verify;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'custompos-prov-'));
  const fresh = function () { const d = fs.mkdtempSync(path.join(tmp, 'c-')); fs.cpSync(FACTS, path.join(d, 'facts'), { recursive: true }); return d; };
  const first = prov.files.filter(function (f) { return !f.yours; })[0].path, yours = prov.files.filter(function (f) { return f.yours; }).map(function (f) { return f.path; });
  /* @proof — a copy whose PROVENANCE.json was changed by edit(p) */
  const provEdited = function (edit) { const d = fresh(), f = path.join(d, 'facts', 'PROVENANCE.json'), p = JSON.parse(fs.readFileSync(f, 'utf8')); edit(p); fs.writeFileSync(f, JSON.stringify(p, null, 2)); return d; };
  try {
    check(!verifyAt(fresh()).length, 'a clean copy of facts/ passes the provenance check');
    /* skeptic 11/1: the business's own files are a set pinned in tools/import-facts.js, never read off PROVENANCE.json itself */
    check(JSON.stringify(yours.slice().sort()) === JSON.stringify(IMP.YOURS.slice().sort()), 'the files marked yours are exactly the pinned set (' + IMP.YOURS.join(', ') + ')');
    const hubMarked = provEdited(function (p) { p.files.forEach(function (f) { if (f.path === 'facts/hub/hub.js') f.yours = 'planted'; }); });
    fs.appendFileSync(path.join(hubMarked, 'facts', 'hub', 'hub.js'), '\n// a hand edit under a planted mark\n');
    check(verifyAt(hubMarked).some(function (b) { return /hub\/hub\.js is marked yours/.test(b); }), 'a "yours" mark planted on the hub is named, and its hand edit does not pass');
    check(verifyAt(provEdited(function (p) { p.proofs = p.proofs.filter(function (x) { return !/996/.test(x.file); }); })).some(function (b) { return /996-pin-grants\.test\.js is never run/.test(b); }), 'a proof dropped from the list is named, never silently skipped');
    /* a business's own file (yours: core/abilities.js, the list of what staff may be allowed to do) is theirs to edit — but never to lose */
    yours.forEach(function (y) {
      const d = fresh(); fs.appendFileSync(path.join(d, y), '\n/* this business\'s own edit */\n');
      check(!verifyAt(d).length, 'a business may edit its own file (' + y + ') and the provenance check still passes');
      const g = fresh(); fs.unlinkSync(path.join(g, y));
      check(verifyAt(g).length > 0, 'a business\'s own file that is missing is named (' + y + ')');
    });
    const plants = [
      ['an edited imported file', function (d) { fs.appendFileSync(path.join(d, first), '\n// a hand edit\n'); }],
      ['a deleted imported file', function (d) { fs.unlinkSync(path.join(d, first)); }],
      ['a file nobody imported or owns', function (d) { fs.writeFileSync(path.join(d, 'facts', 'core', 'extra.js'), 'module.exports = 1;\n'); }],
      ['a renamed imported file', function (d) { fs.renameSync(path.join(d, first), path.join(d, first.replace(/\.js$/, '-renamed.js'))); }]
    ];
    plants.forEach(function (pl) { const d = fresh(); pl[1](d); check(verifyAt(d).length > 0, 'the provenance check names ' + pl[0]); });
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
})();

/* the bundle beside pos.html (facts.bundle.js — the hosted builder fetches it for a 'several stations' download) is exactly what facts/
   builds now; a stale one would ship an old engine in every download */
(function () {
  const want = require('../facts/bundle').build().replace(/\r\n/g, '\n'), file = path.join(ROOT, 'facts.bundle.js');
  const have = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n') : null;
  check(have === want, 'facts.bundle.js is what facts/ builds now' + (have === want ? '' : ' — rebuild it: node facts/bundle.js --out facts.bundle.js'));
})();

const env = Object.assign({}, process.env); Object.keys(env).forEach(function (k) { if (/^CUSTOMPOS_(SHARD|SHARDS|SMOKE)/.test(k)) delete env[k]; });
/* every imported proof file runs here at exactly the count that passed inside the export upstream (Unit 0.3: the engine laws and the
   shared files' own proofs, each its own file) */
(prov.proofs || []).map(function (p) { return [p.file.replace(/^facts\//, ''), p.passed, 'the imported proofs, ' + p.file.replace(/^facts\/test\//, '') + ', as upstream']; }).concat([['test/wire.test.js', 14, 'the wire'], ['test/bundle.test.js', 3, 'the bundle'], ['test/modules.test.js', 5, 'the module contract'], ['test/staff.test.js', 10, 'the staff module and the PIN the hub checks'], ['test/timeclock-module.test.js', 6, 'the time clock module'], ['test/cli.test.js', 2, 'the hub as a shop starts it']]).forEach(function (t) {
  const r = spawnSync(process.execPath, [path.join(FACTS, t[0])], { cwd: FACTS, encoding: 'utf8', env: env, timeout: 600000 });
  const m = /(\d+) passed, (\d+) failed\s*$/.exec(String(r.stdout || '').trim());
  const ok = r.status === 0 && m && +m[2] === 0 && +m[1] === t[1];
  check(ok, t[2] + ': ' + (m ? m[1] + ' passed, ' + m[2] + ' failed' : 'no summary (exit ' + r.status + ')') + ' — expected ' + t[1] + ' passed');
  if (!ok) console.log(String(r.stdout || '').split('\n').filter(function (l) { return /✗|FAIL|Error/.test(l); }).slice(0, 10).join('\n') + String(r.stderr || '').slice(0, 2000));
});

console.log('\n' + (fail ? 'facts engine: ' + fail + ' failed' : 'facts engine: all checks passed'));
process.exit(fail ? 1 : 0);
