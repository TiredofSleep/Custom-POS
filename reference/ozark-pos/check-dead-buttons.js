#!/usr/bin/env node
/* check-dead-buttons.js — find controls that LOOK live but do nothing. Read-only.
 *
 *   node check-dead-buttons.js Ozark-POS.html
 *
 * Every dead control found this week was found by stumbling on it in production:
 *   • the customer card's "📲 Text" button called a function that did not exist (fixed 8/4)
 *   • the driver's "👥 Everyone on the route" emitted go('routeList',{route:sel}) with a LITERAL
 *     `sel`, so tapping it threw "ReferenceError: sel is not defined" and did nothing (fixed 8/5)
 * Both are mechanically detectable. This finds the whole class in one pass:
 *   A. a handler calls a function that is never defined            → the button is dead
 *   B. a handler references a bare identifier that is not a global → it throws on click
 *      (the {route:sel} bug: a template variable that was never interpolated into the HTML)
 * Run it before any release alongside check-app-js.js and test-money.js.
 */
const fs = require('fs');
const file = process.argv[2] || 'Ozark-POS.html';
const src = fs.readFileSync(file, 'utf8');

// ---- what the app defines -------------------------------------------------------------------------
const defined = new Set();
[/function\s+([A-Za-z_$][\w$]*)\s*\(/g,
 /(?:var|let|const)\s+([A-Za-z_$][\w$]*)\s*=/g,
 /(?:var|let|const)\s+([A-Za-z_$][\w$]*)\s*,/g].forEach(rx => {
  let m; while ((m = rx.exec(src))) defined.add(m[1]);
});
/* Multi-declarator statements: `var l2='…', abc='…'` only registered l2, so abc read as undefined and got
   reported as a dead control. A false positive here is corrosive — it teaches you to skim past the output,
   which is exactly how a real dead button survives. Walk the whole declaration list. */
{
  const rx = /(?:var|let|const)\s+([^;\n]{0,400})/g;
  let m;
  while ((m = rx.exec(src))) {
    let depth = 0, cur = '';
    for (const ch of m[1]) {                              // split on top-level commas only
      if ('([{'.includes(ch)) depth++;
      else if (')]}'.includes(ch)) depth--;
      if (ch === ',' && depth <= 0) { cur = ''; continue; }
      cur += ch;
      const d = cur.match(/^\s*([A-Za-z_$][\w$]*)\s*=/);
      if (d) { defined.add(d[1]); }
    }
  }
}
// browser + language globals a handler may legitimately touch
`window document location history navigator console alert confirm prompt setTimeout setInterval
 clearTimeout clearInterval JSON Math Date Number String Boolean Array Object RegExp Promise parseInt
 parseFloat isNaN isFinite encodeURIComponent decodeURIComponent localStorage sessionStorage fetch
 event this true false null undefined new typeof return if else for while function var let const
 in of delete void instanceof do break continue switch case default try catch finally throw`
  .split(/\s+/).filter(Boolean).forEach(w => defined.add(w));

// ---- every inline handler in the file -------------------------------------------------------------
const handlers = [];
const hrx = /\son(click|change|input|submit|keydown|keyup|blur|focus)\s*=\s*"([^"]*)"/gi;
let h;
while ((h = hrx.exec(src))) {
  handlers.push({ ev: h[1], code: h[2].replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&'),
                  line: src.slice(0, h.index).split('\n').length });
}

/* Strip string literals BEFORE looking for identifiers, or text inside a message is read as code —
   'Card declined (test)' otherwise looks like a call to declined(). Inline handlers live in an HTML
   attribute, so their quotes arrive escaped as \' and \" — handle those first or the stripper mis-pairs. */
const strip = s => s.replace(/\'/g, "'").replace(/\\"/g, '"')   // un-escape first so quotes pair correctly
                    .replace(/'[^']*'/g, "''")                        // then blank every string literal
                    .replace(/"[^"]*"/g, '""');
handlers.forEach(x => { x.bare = strip(x.code); });

// ---- A. calls to functions that do not exist ------------------------------------------------------
const deadCalls = new Map();
handlers.forEach(x => {
  let m; const rx = /\b([A-Za-z_$][\w$]*)\s*\(/g;
  while ((m = rx.exec(x.bare))) {
    const fn = m[1];
    if (defined.has(fn)) continue;
    if (/^(if|for|while|switch|catch|return|typeof|function)$/.test(fn)) continue;
    if (x.bare.slice(0, m.index).match(/\.\s*$/)) continue;          // a method call, not a global
    if (!deadCalls.has(fn)) deadCalls.set(fn, []);
    deadCalls.get(fn).push(x);
  }
});

// ---- B. bare identifiers that will throw on click (the {route:sel} class) -------------------------
const bareRefs = new Map();
handlers.forEach(x => {
  // strip string literals, then look at what's left as a value position
  const stripped = x.code.replace(/'[^']*'/g, "''").replace(/"[^"]*"/g, '""');
  let m; const rx = /[:,(]\s*([A-Za-z_$][\w$]*)\s*[,)}\]]/g;
  while ((m = rx.exec(stripped))) {
    const id = m[1];
    if (defined.has(id)) continue;
    if (/^\d/.test(id)) continue;
    const key = id + ' @' + x.line;
    if (!bareRefs.has(key)) bareRefs.set(key, x);
  }
});

console.log('══ DEAD-CONTROL SCAN — ' + file + ' ══');
console.log(handlers.length + ' inline handlers · ' + defined.size + ' known names\n');

console.log('── A. handlers calling a function that is NEVER DEFINED (button does nothing) ──');
if (!deadCalls.size) console.log('   ✅ none');
else [...deadCalls.entries()].sort((a, b) => b[1].length - a[1].length).forEach(([fn, uses]) => {
  console.log('   ❌ ' + fn + '()  — ' + uses.length + ' control(s), first at line ' + uses[0].line);
  console.log('        ' + uses[0].code.slice(0, 110));
});

console.log('\n── B. handlers referencing a bare identifier that is not a global (throws on click) ──');
if (!bareRefs.size) console.log('   ✅ none');
else [...bareRefs.entries()].forEach(([key, x]) => {
  console.log('   ❌ ' + key.split(' @')[0] + '  at line ' + x.line);
  console.log('        ' + x.code.slice(0, 110));
});

const problems = deadCalls.size + bareRefs.size;
console.log('\n══ ' + (problems ? problems + ' suspect control(s) — verify each by hand' : 'no dead controls found') + ' ══');
process.exit(0);
