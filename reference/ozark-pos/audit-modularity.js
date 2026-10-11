#!/usr/bin/env node
/* audit-modularity.js — is this actually tunnelled architecture? READ-ONLY. Measures, never edits.
 *
 *   node audit-modularity.js Ozark-POS.html
 *   node audit-modularity.js Ozark-POS.html --trapped     just the engines stuck inside screens
 *
 * Owner, 2026-08-12: "each segment is a modular part, with possible different features depending on which screen
 * is using the code... the cash drawer is one engine of code... route is one engine, used in one way currently,
 * but possibly in different ways in the future... search is one engine, used different depending on the screen
 * requesting the search... that's clean, tunnelled architecture." And: "i imagine that's the cleanest code
 * anybody has ever had for a POS if we do it right."
 *
 * That model has exactly two failure modes, and this file measures both rather than arguing about them:
 *
 *   1 · AN ENGINE THAT ISN'T ONE — the logic lives inside a screen, so a second screen cannot use it without
 *       copying. This is the one that actually costs money here. Every money bug in CLAUDE.md's history is a
 *       copy that drifted: the card-expiry fix that had to be made FIVE times, four hand-written notes panels
 *       where the customer's reminder never reached Pickup, two definitions of what an order is worth.
 *
 *   2 · AN ENGINE THAT KNOWS ITS CALLER — variation baked into the engine (reading state.screen, or a global it
 *       could have been handed) instead of passed in by the caller. routeBag(cid,{ensure:true}) and
 *       saveDB(local,{full:true}) are the right shape: same engine, caller declares intent.
 *
 * It also reports fan-in, because an engine nothing calls is not an engine, and orphans, because a function
 * nobody calls is either dead or a bug where the wiring was forgotten.
 *
 * ⚠️ NOT A GATE. These are judgement calls about design, and a design report that fails a build teaches people
 * to silence it. It exits 0 always. Read it, pick the worst thing, fix that one.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const S = require('./src-scan');

const file = process.argv[2] || path.join(__dirname, 'Ozark-POS.html');
const only = (process.argv.find(a => a.startsWith('--')) || '').replace('--', '');
const app = S.load(file);
const funcs = app.funcs();

const pad = (s, n) => String(s) + ' '.repeat(Math.max(0, n - String(s).length));
const bar = n => '█'.repeat(Math.min(40, n));

console.log('══ MODULARITY SURVEY ══  ' + funcs.length + ' top-level functions in ' + app.lines.length + ' lines of app code');
console.log('   "one engine per job, variation from the CALLER" — measured, not asserted\n');

/* ---------------------------------------------------------------------------------------------------
   1 · ENGINES TRAPPED INSIDE SCREENS
   A render function that mutates the database is logic a second screen cannot reach. Drawing is a screen's
   job; deciding is an engine's. The test is deliberately about WRITES, not reads — a screen reading DB to
   draw itself is the entire point of a screen.
   --------------------------------------------------------------------------------------------------- */
function trapped(){
  console.log('── 1 · LOGIC TRAPPED INSIDE A SCREEN  (a second screen would have to copy it) ──');
  const WRITES = [
    [/\bsaveDB\s*\(/,                         'saves the database'],
    [/\bDB\.[a-zA-Z]+\s*\.push\s*\(/,         'adds a record'],
    [/\bDB\.[a-zA-Z]+\s*=\s*DB\.[a-zA-Z]+\.filter/, 'removes records'],
    [/\b[a-z]\.(status|paymentStatus|payMethod|balance|credit|rackLoc|delivered)\s*=[^=]/, 'writes a money/status field'],
    [/\bchargeSavedCard\s*\(|\brunPresentCharge\s*\(|\barBill\s*\(/, 'moves money'],
    [/\blogEvent\s*\(/,                       'writes the activity log']
  ];
  const hits = [];
  funcs.filter(f => /^render[A-Z]/.test(f.name)).forEach(f => {
    const body = app.bodyOf(f);
    const what = WRITES.filter(w => w[0].test(body)).map(w => w[1]);
    if (what.length) hits.push({ f, what });
  });
  if (!hits.length) console.log('   none — every screen only draws\n');
  else {
    hits.sort((a, b) => b.what.length - a.what.length).forEach(h => {
      console.log('  ⚠  ' + pad(h.f.name, 26) + 'L' + pad(h.f.at, 7) + h.what.join(' · '));
    });
    console.log('\n   ' + hits.length + ' of ' + funcs.filter(f => /^render[A-Z]/.test(f.name)).length +
                ' screens do more than draw. Each is logic that cannot be reused from another screen.\n');
  }
  return hits.length;
}

/* ---------------------------------------------------------------------------------------------------
   2 · AN ENGINE THAT KNOWS ITS CALLER
   Reading state.screen, or reaching for a global it could have been handed, is variation baked in. Navigation
   and telemetry are exempt: knowing the current screen IS their job.
   --------------------------------------------------------------------------------------------------- */
function knowsCaller(){
  console.log('── 2 · AN ENGINE THAT KNOWS WHO CALLED IT  (variation baked in, not passed in) ──');
  /* exempt = knowing the current screen IS the job: navigation, the repaint loop, the "is it safe to reload
     right now" guard, and telemetry that records which screen an event happened on */
  /* ⚠️ Two more exemptions after Phase 4d read all four survivors. Neither is an engine knowing its caller;
     both are screen-owning code doing its job, and a report that flags legitimate code stops being read:
       · acceptPickup — "go back to the screen I was on" after resolving a request. That is navigation.
       · bootTail     — a startup hook that refreshes the voice picker on the screen which uses it.
     refocusAssembleScan is exempt for the same reason: checking which screen is showing IS its whole job, and it
     exists precisely so the PRINT engine no longer had to. */
  const EXEMPT = /^(render$|render[A-Z]|go$|goBack$|keepScreen$|rerenderAfterIssue$|routeHold$|denyMsg$|arScope$|routeSetBag$|restoreSession$|navTile$|backBar$|updateSafe$|doAppReload$|trailAdd$|errNote$|f9Reprint$|f12Complete$|hardenUI$|acceptPickup$|bootTail$|refocusAssembleScan$)/;
  /* ⚠️ THE FIRST VERSION OF THIS SECTION CRIED WOLF: it flagged all 36 functions that merely MENTION
     state.screen, which in this codebase is mostly three innocent things — re-drawing after doing the work
     ("if we are still on that screen, repaint"), a guard that declines to act on the wrong screen
     (updateSafe refusing to reload mid-detail), and telemetry recording WHICH screen something happened on
     (trailAdd, errNote). None of those is variation baked into an engine, and a report that lists 36 items
     when 3 matter gets closed and never reopened. Only a line where the screen DECIDES A VALUE counts. */
  const real = []; let navOnly = 0;
  funcs.forEach(f => {
    if (EXEMPT.test(f.name)) return;
    const uses = [];
    for (let i = f.from; i <= f.to; i++){
      if (app.prose[i]) continue;
      const c = S.code(app.lines[i]);
      if (/\bstate\.screen\b/.test(c)) uses.push(c.trim());
    }
    if (!uses.length) return;
    /* ⚠️ A LINE IS THE WRONG UNIT IN THIS FILE. Many lines here hold half a dozen statements, so the second
       version of this section flagged clearPickup, acceptPickup and the three asmReminder functions purely
       because an UNRELATED assignment sat on the same physical line as a state.screen mention. Only the
       `;`-delimited statement the screen actually appears in is judged. */
    const suspect = uses.map(c => c.split(';').filter(seg => /\bstate\.screen\b/.test(seg)).join(' ; '))
      .filter(seg => {
        if (!seg) return false;
        if (/screen\s*:/.test(seg)) return false;                                       /* a log/trail payload */
        if (/\b(render|go|rerenderAfterIssue|keepScreen)\s*\(/.test(seg)) return false;  /* repaint or navigate */
        if (/\breturn\s*$/.test(seg)) return false;                                     /* a bare guard */
        return /\breturn\s+[^;\s]/.test(seg) || /[^=!<>+\-*/]=[^=]/.test(seg);           /* it decides a value */
      });
    if (suspect.length) real.push({ f, c: suspect[0] }); else navOnly++;
  });
  if (!real.length) console.log('   none — no engine lets the calling screen decide an outcome');
  else real.forEach(r => {
    console.log('  ⚠  ' + pad(r.f.name, 26) + 'L' + pad(r.f.at, 7) + 'the screen decides a value here');
    console.log('        ' + r.c.slice(0, 150));
  });
  console.log('   (' + navOnly + ' more mention state.screen only to repaint, guard, or log which screen it was —' +
              ' deliberately not flagged)');
  console.log('');
  return real.length;
}

/* ---------------------------------------------------------------------------------------------------
   3 · THE ENGINES THAT ARE ACTUALLY LOAD-BEARING
   Fan-in is the proof a tunnel is used. These are the units where a bug is worth the most and a test is worth
   the most — and where a SECOND copy would cost the most.
   --------------------------------------------------------------------------------------------------- */
function fanIn(){
  console.log('── 3 · THE LOAD-BEARING ENGINES  (fan-in — where one fix reaches furthest) ──');
  const scored = funcs.map(f => ({ f, n: app.callsTo(f.name) })).filter(x => x.n >= 12)
    .sort((a, b) => b.n - a.n).slice(0, 18);
  const top = scored.length ? scored[0].n : 1;   /* scale to the biggest, or every bar saturates and says nothing */
  scored.forEach(x => console.log('  ' + pad(x.n, 5) + pad(x.f.name, 24) + bar(Math.round(x.n * 40 / top))));
  console.log('');
}

/* ---------------------------------------------------------------------------------------------------
   4 · ORPHANS
   A function nobody calls is dead code or forgotten wiring. ⚠️ Both are worth knowing and they look identical
   from here, so this REPORTS and never judges: check-dead-buttons.js owns the "button points at nothing"
   direction, and this is the mirror of it.
   --------------------------------------------------------------------------------------------------- */
function orphans(){
  console.log('── 4 · DEFINED BUT NEVER CALLED  (dead code, or wiring somebody forgot) ──');
  /* ⚠️ callsTo() only counts `name(`, and its first run therefore reported renderAdmin, renderLoose, renderPNP,
     adminDash and fifteen others as never called — every one of them is reached through the app's own RENDER MAP
     as a BARE REFERENCE (`admin: renderAdmin`), which is the cleanest thing in the file. A tool that calls the
     good part dead is worse than no tool. So a bare mention counts as a reference too. */
  const referenced = name => {
    const re = new RegExp('\\b' + name.replace(/[$]/g, '\\$') + '\\b');
    for (let i = 0; i < app.lines.length; i++){
      if (app.prose[i]) continue;
      if (new RegExp('^function\\s+' + name + '\\b').test(app.lines[i])) continue;   /* its own definition */
      if (re.test(S.code(app.lines[i]))) return true;
    }
    return false;
  };
  const out = funcs.filter(f => !referenced(f.name));
  if (!out.length) console.log('   none — every function is reached from somewhere');
  else out.forEach(f => console.log('  ·  ' + pad(f.name, 26) + 'L' + f.at));
  console.log('');
  return out.length;
}

/* ---------------------------------------------------------------------------------------------------
   5 · A JOB DONE BY HAND WHERE AN ENGINE ALREADY EXISTS
   The specific ones this codebase has actually paid for. Each pair is (the engine, the hand-rolled shape).
   --------------------------------------------------------------------------------------------------- */
function handRolled(){
  console.log('── 5 · DONE BY HAND WHERE AN ENGINE ALREADY EXISTS ──');
  const CASES = [
    { engine: 'custName / custListLabel', why: 'prints a bare comma for a business with no contact person — the driver reported "a blank and a comma stop"',
      re: /\(\s*[a-z]\.last\s*\|\|\s*''\s*\)\s*\+\s*',\s*'\s*\+|\(\s*[a-z]\.first\s*\|\|\s*''\s*\)\s*\+\s*'\s*'\s*\+\s*\(\s*[a-z]\.last/ },
    { engine: 'money()', why: 'prints "$4.5" instead of "$4.50"', re: /\$'\s*\+\s*(?!money)[a-z][\w.]*\s*(?:\)|\+)/ },
    { engine: 'computeTotals()', why: 'a second definition of what an order is worth — wrong twice on 8/12, live, with the driver at the door',
      re: /\bprice\s*\*\s*(?:qty|quantity)\b/ },
    { engine: 'stopKeyOf()', why: 'a private idea of which stop a customer is at', re: /\.route\s*===?\s*[^&|)]*&&[^;]*\.stop\s*===?/ },
    { engine: 'rackLocReal()', why: "'#' and 'ABC: ' are not locations", re: /\.rackLoc\s*&&\s*[a-z]\.rackLoc\s*!==?\s*'#'/ }
  ];
  /* ⚠️ the ENGINE'S OWN BODY is not a hand-rolled copy of itself. custName and custListLabel both build a name
     from first/last by definition, and the first run of this section reported both of them as violations. */
  const OWN = /^(custName|custListLabel|money|computeTotals|stopKeyOf|rackLocReal|custIsBiz)$/;
  let total = 0;
  CASES.forEach(c => {
    const at = [];
    app.lines.forEach((ln, i) => { if (app.prose[i]) return; if (OWN.test(app.fnAt(i))) return;
      if (c.re.test(S.code(ln))) at.push(app.at(i)); });
    if (!at.length) return;
    total += at.length;
    console.log('  ⚠  ' + at.length + '× hand-rolled instead of ' + c.engine);
    console.log('        why it matters: ' + c.why);
    console.log('        lines ' + at.slice(0, 12).join(', ') + (at.length > 12 ? ' …and ' + (at.length - 12) + ' more' : ''));
  });
  if (!total) console.log('   none of the known ones');
  console.log('');
  return total;
}

/* ---------------------------------------------------------------------------------------------------
   6 · SHAPE OF THE FILE
   --------------------------------------------------------------------------------------------------- */
/* is every mention of this function inside an HTML attribute — i.e. it is only ever reached from a button? */
function onlyFromMarkup(f){
  const esc = f.name.replace(/\$/g, '\\$');
  const word = new RegExp('\\b' + esc + '\\b');
  const inAttr = new RegExp('on(?:click|change|input|submit|keyup|keydown)="[^"]{0,600}?\\b' + esc + '\\s*\\(');
  const own = new RegExp('^function\\s+' + esc + '\\b');
  let fromCode = 0;
  app.lines.forEach((ln, i) => { if (app.prose[i] || own.test(ln)) return;
    const c = S.code(ln); if (!word.test(c)) return; if (!inAttr.test(c)) fromCode++; });
  return fromCode === 0;
}
function shape(){
  console.log('── 6 · SHAPE ──');
  const screens = funcs.filter(f => /^render[A-Z]/.test(f.name));
  const sizes = funcs.map(f => f.to - f.from + 1).sort((a, b) => a - b);
  const mid = sizes[Math.floor(sizes.length / 2)];
  const big = funcs.filter(f => (f.to - f.from + 1) > 120).sort((a, b) => (b.to - b.from) - (a.to - a.from));
  const proseLines = app.prose.filter(Boolean).length;
  /* ⚠️ THIS SECTION USED TO SAY "engines: 1306", meaning "everything that is not a screen", and the owner called
     it straight away: "1306 engines seems excessive." He was right — the category was lazy, not the code. Most of
     that number is functions wired to exactly one button, which are the ENDS of wires, not engines. The honest
     count is the shared logic: neither a screen, nor a view builder, nor a button handler, and used in 3+ places. */
  const draws   = funcs.filter(f => !/^render[A-Z]/.test(f.name) && /(Html|HTML|Text|Body|Rows|Row|Panel|Bar|Label|Pill|Chip|Card|Tiles)$/.test(f.name));
  const handler = funcs.filter(f => { const r = app.callsTo(f.name); return r > 0 && !draws.includes(f) && !/^render[A-Z]/.test(f.name) && onlyFromMarkup(f); });
  const shared  = funcs.filter(f => !/^render[A-Z]/.test(f.name) && !draws.includes(f) && !handler.includes(f) && app.callsTo(f.name) >= 3);
  console.log('   screens (render*) .......... ' + screens.length);
  console.log('   view builders .............. ' + draws.length);
  console.log('   only wired to a button ..... ' + handler.length + '   (the ends of wires, not engines)');
  console.log('   SHARED LOGIC (3+ uses) ..... ' + shared.length + '   <- the real engine count');
  console.log('   used in exactly ONE place .. ' + funcs.filter(f => app.callsTo(f.name) === 1).length +
              '   (naming, not architecture)');
  console.log('   median function ............ ' + mid + ' lines');
  console.log('   explained in prose ......... ' + proseLines + ' lines (' +
              Math.round(proseLines * 100 / app.lines.length) + '% of the file)');
  console.log('   over 120 lines ............. ' + big.length +
              (big.length ? ':  ' + big.slice(0, 6).map(f => f.name + ' (' + (f.to - f.from + 1) + ')').join(', ') : ''));
  console.log('');
}

/* ---------------------------------------------------------------------------------------------------
   7 · THE ONE-USE POPULATION, AND WHY MOST OF IT SHOULD STAY
   "543 functions used once" sounds like bloat and mostly is not. Measured 2026-08-13: of 558, a third are named
   by a GATE (inlining one silently guts a test), nearly half are the target of a BUTTON (the name IS the
   wiring), and a fifth carry real prose (the name is the documentation). What is left is ~50, and reading them
   shows names that carry meaning — orderTaxable encodes "tax on everything, no per-item exemption game";
   pickupHeld and pickupNotReady are genuinely different questions.
   ⚠️ This section exists so that judgement can be RE-CHECKED rather than taken on trust. If the safe count ever
   grows large, the answer may change; today it does not justify touching a working file.
   --------------------------------------------------------------------------------------------------- */
function onceUsed(){
  console.log('── 7 · USED EXACTLY ONCE  (bloat, or naming?) ──');
  const GATES = ['test-money.js', 'test-render.js', 'test-hub.js', 'check-dead-buttons.js', 'audit-patterns.js',
                 'audit-modularity.js', 'codebase-index.js', 'deploy.sh', 'check-invariants.js', 'live-money.js',
                 'test-render-live.js', 'hub-server.js'];
  const gateText = GATES.map(f => { try { return fs.readFileSync(path.join(__dirname, f), 'utf8'); } catch (e) { return ''; } }).join('\n');
  /* ⚠️ REFUSE TO ANSWER RATHER THAN ANSWER ZERO. `fs` was not imported when this section was first written, so
     every read threw, gateText came back empty, and it reported "0 named by a gate" — which reads as "all of
     these are safe to inline". A measurement that fails silently in the REASSURING direction is worse than no
     measurement, and this one would have invited exactly the wrong change. */
  if (gateText.length < 20000){
    console.log('   ✗ could not read the gate files — refusing to report, because an empty read here would say');
    console.log('     "nothing is protected" and invite exactly the wrong change.');
    console.log('');
    return;
  }
  const fromMarkup = n => new RegExp('on(?:click|change|input|submit|keyup|keydown)="[^"]{0,600}?\\b' + n.replace(/\$/g, '\\$') + '\\s*\\(').test(app.appJs);
  const banner = f => { const o = []; for (let i = f.from - 1; i >= 0 && app.prose[i]; i--) o.unshift(app.lines[i]); return o.join('\n'); };
  const once = funcs.filter(f => app.callsTo(f.name) === 1);
  const gated = once.filter(f => new RegExp('\\b' + f.name.replace(/\$/g, '\\$') + '\\b').test(gateText));
  const btn = once.filter(f => fromMarkup(f.name));
  const prosed = once.filter(f => /—|--/.test(banner(f)) && banner(f).length > 120);
  const safe = once.filter(f => (f.to - f.from + 1) <= 2 && !gated.includes(f) && !btn.includes(f) && !prosed.includes(f));
  console.log('   used exactly once .............. ' + once.length);
  console.log('   named by a gate or tool ........ ' + gated.length + '   inlining one silently guts a test');
  console.log('   the target of a button ......... ' + btn.length + '   the name IS the wiring');
  console.log('   carrying real prose ............ ' + prosed.length + '   the name is the documentation');
  console.log('   left as inline candidates ...... ' + safe.length +
              '   (' + Math.round(safe.length * 100 / funcs.length) + '% of the file — read them before touching any)');
  console.log('');
}

if (!only || only === 'trapped') trapped();
if (!only || only === 'once')    onceUsed();
if (!only || only === 'caller')  knowsCaller();
if (!only || only === 'handrolled') handRolled();
if (!only || only === 'fanin')   fanIn();
if (!only || only === 'orphans') orphans();
if (!only || only === 'shape')   shape();

console.log('Nothing was changed. This is a DESIGN report, not a gate — it always exits 0.');
console.log('Pick the worst single item, fix that, run the six gates, commit. Then read it again.');
process.exit(0);
