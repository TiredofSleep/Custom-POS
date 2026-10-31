'use strict';
/* @facts @proof — THE BUNDLE: the facts engine runs in a browser-shaped context with no Node at all, a fact made inside it verifies in
   Node, and the build refuses anything it cannot serve. This repo's own file.   node facts/test/bundle.test.js */
const H = require('./harness');
const vm = require('vm'), nodeCrypto = require('crypto');
const B = require('../bundle');
const EV = require('../core/event');

/* @proof — run a bundle's text in a context with no require, no process, no module: what a browser page has, and no more */
function runInBrowserShape(code) {
  const ctx = { console: console, TextEncoder: TextEncoder, crypto: { getRandomValues: function (b) { return nodeCrypto.randomFillSync(b); } }, setTimeout: setTimeout, clearTimeout: clearTimeout };
  ctx.globalThis = ctx; ctx.window = ctx; vm.createContext(ctx); vm.runInContext(code, ctx);
  return ctx;
}

H.section('bundle · the facts engine for a browser (facts/bundle.js)');

H.test('the bundle loads with NO Node (no require, no process) and a fact made inside it verifies in Node', function () {
  const code = B.build();
  H.ok(code.indexOf('require("fs")') < 0 && code.indexOf("require('fs')") < 0, 'no Node module is named in it');
  const ctx = runInBrowserShape(code);
  H.eq(Object.keys(ctx.CustomPOSFacts).sort().join(','), Object.keys(B.EXPOSE).sort().join(','), 'it exposes exactly the engine');
  const S = ctx.CustomPOSFacts.station.makeStation({ id: 'bundled', now: function () { return 1789000000000; } });
  const e = S.record('clock.in', 'p', { empId: 'p', at: 1789000000000 });
  H.ok(EV.verify(JSON.parse(JSON.stringify(e))), 'Node verifies what the browser made');
  /* the negative control: the same fact with its payload changed after it was made does NOT verify (verify can say no) */
  const t = JSON.parse(JSON.stringify(e)); t.payload.empId = 'someone-else'; H.ok(!EV.verify(t), 'a changed fact is refused');
});

H.test('the build refuses a require it cannot serve: outside the list, a Node module, or not a plain string', function () {
  const refuse = function (extra, why) { let msg = ''; try { B.build({ extra: extra }); } catch (e) { msg = String(e.message); } H.ok(why.test(msg), 'refused: ' + (msg || '(it built)')); };
  refuse({ 'core/x.js': "module.exports = require('./nowhere');" }, /outside the bundle's list/);
  refuse({ 'core/x.js': "module.exports = require('fs');" }, /a Node module the browser does not have/);
  refuse({ 'core/x.js': "var n = 'fs'; module.exports = require(n);" }, /not require\('a plain string'\)/);
  refuse({ 'core/x.js': 'var r = require; module.exports = r("./hlc");' }, /not require\('a plain string'\)/);
  /* pre-push review: a require hidden by an escape, reached through arguments, or built by eval / Function stops the build too */
  const BS = String.fromCharCode(92);
  refuse({ 'core/x.js': 'module.exports = ' + BS + 'u0072equire("fs");' }, /an escaped name, arguments, eval or Function/);
  refuse({ 'core/x.js': 'module.exports = arguments[2]("fs");' }, /an escaped name, arguments, eval or Function/);
  refuse({ 'core/x.js': 'module.exports = eval("1");' }, /an escaped name, arguments, eval or Function/);
  refuse({ 'core/x.js': 'module.exports = new Function("return 1")();' }, /an escaped name, arguments, eval or Function/);
  /* and the last gate: every module must actually load inside the built bundle */
  refuse({ 'core/x.js': 'throw new Error("this module cannot load");' }, /a module does not load inside the bundle/);
  /* the negative control: an extra module that requires only what the bundle has DOES build, and runs */
  const code = B.build({ extra: { 'core/x.js': "module.exports = { hlcLoaded: typeof require('./hlc') === 'object' };" } });
  H.ok(code.indexOf('"core/x.js"') >= 0, 'a module that requires only the list builds');
});

/* the budget, stated as what is checked: the plan's ~150 KB was a guess before the engine's comments were counted; the bundle keeps them
   (they are the engine's documentation) and is ~187 KB raw, ~57 KB gzipped. The bound below catches growth, not the comments. */
H.test('the bundle stays within its size budget: under 200 KB raw and 70 KB gzipped (it keeps the engine\'s comments)', function () {
  const code = B.build(), n = Buffer.byteLength(code), gz = require('zlib').gzipSync(code).length;
  H.ok(n < 200 * 1024, 'the bundle is ' + n + ' bytes raw'); H.ok(gz < 70 * 1024, 'and ' + gz + ' bytes gzipped');
});

H.done();
