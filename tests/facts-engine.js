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
  const os = require('os'), verifyAt = require('../tools/import-facts').verify;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'custompos-prov-'));
  const fresh = function () { const d = fs.mkdtempSync(path.join(tmp, 'c-')); fs.cpSync(FACTS, path.join(d, 'facts'), { recursive: true }); return d; };
  const first = prov.files[0].path;
  try {
    check(!verifyAt(fresh()).length, 'a clean copy of facts/ passes the provenance check');
    const plants = [
      ['an edited imported file', function (d) { fs.appendFileSync(path.join(d, first), '\n// a hand edit\n'); }],
      ['a deleted imported file', function (d) { fs.unlinkSync(path.join(d, first)); }],
      ['a file nobody imported or owns', function (d) { fs.writeFileSync(path.join(d, 'facts', 'core', 'extra.js'), 'module.exports = 1;\n'); }],
      ['a renamed imported file', function (d) { fs.renameSync(path.join(d, first), path.join(d, first.replace(/\.js$/, '-renamed.js'))); }]
    ];
    plants.forEach(function (pl) { const d = fresh(); pl[1](d); check(verifyAt(d).length > 0, 'the provenance check names ' + pl[0]); });
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
})();

const env = Object.assign({}, process.env); Object.keys(env).forEach(function (k) { if (/^CUSTOMPOS_(SHARD|SHARDS|SMOKE)/.test(k)) delete env[k]; });
[['test/engine-laws.test.js', upstream, 'the engine laws'], ['test/wire.test.js', 13, 'the wire'], ['test/bundle.test.js', 3, 'the bundle'], ['test/modules.test.js', 4, 'the module contract'], ['test/staff.test.js', 5, 'the staff module and the PIN the hub checks'], ['test/timeclock-module.test.js', 4, 'the time clock module']].forEach(function (t) {
  const r = spawnSync(process.execPath, [path.join(FACTS, t[0])], { cwd: FACTS, encoding: 'utf8', env: env, timeout: 600000 });
  const m = /(\d+) passed, (\d+) failed\s*$/.exec(String(r.stdout || '').trim());
  const ok = r.status === 0 && m && +m[2] === 0 && +m[1] === t[1];
  check(ok, t[2] + ': ' + (m ? m[1] + ' passed, ' + m[2] + ' failed' : 'no summary (exit ' + r.status + ')') + ' — expected ' + t[1] + ' passed');
  if (!ok) console.log(String(r.stdout || '').split('\n').filter(function (l) { return /✗|FAIL|Error/.test(l); }).slice(0, 10).join('\n') + String(r.stderr || '').slice(0, 2000));
});

console.log('\n' + (fail ? 'facts engine: ' + fail + ' failed' : 'facts engine: all checks passed'));
process.exit(fail ? 1 : 0);
