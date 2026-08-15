#!/usr/bin/env node
/* audit-patterns.js — hunt for MORE of the specific mistakes this system has actually made. READ-ONLY.
 *
 *   node audit-patterns.js Ozark-POS.html
 *   node audit-patterns.js Ozark-POS.html --undef     only the raw-value leaks
 *
 * Owner, 2026-08-08: "keep auditing based on all of the types of errors we have been finding."
 *
 * Not generic lint. Every rule here exists because this exact mistake was made in this file and cost
 * something real. The point is to find the SIBLINGS of each bug we already paid for.
 *
 *   A · RAW FIELD INTO HTML          "Type: undefined" printed at the top of the Detail screen because
 *                                    o.pressType was concatenated straight into markup. The render gate only
 *                                    catches these when the seeded data happens to trigger them; this finds
 *                                    the ones no test data has hit yet.
 *   B · UNBOUNDED LIST               the chase list rendered every record at 84px a row on two screens;
 *                                    "just racked" grew all shift. A list with no cap eventually owns the
 *                                    screen.
 *   C · SILENT CATCH AROUND UI       the pickup inbox hid itself on any hub error, which looks exactly like
 *                                    "nobody has requested a pickup" — that is how a customer waited 6 days.
 *                                    An error must never render as good news.
 *   D · GUARD WITH NO WAY OUT        updateSafe() refused to update on four screens with no timeout, so the
 *                                    detailing station could never update — three days stale while the owner
 *                                    reopened it twice.
 *   E · WHOLESALE OBJECT REPLACE     two forms did c.prefs={...three fields...}, so each silently erased any
 *                                    preference the other one showed.
 *   I · ENGINE REACHING SIDEWAYS      stopCust() decided WHERE A DOOR IS by asking WHO PAYS THE BILL. It read
 *                                    as reasonable and it was a guess about a physical address; it held three
 *                                    real addresses split into five and six separate stops for weeks, and the
 *                                    only way to join them under that rule was to bill those businesses for
 *                                    their employees' clothes. An engine owns one fact and takes its variation
 *                                    from its CALLER, never from another engine's data.
 *
 * Findings are ranked and each says WHY it matters. Nothing is edited. Some of these are judgement calls, so
 * they print as REVIEW rather than FAIL — a report that cries wolf gets ignored, and that has already
 * happened twice this week.
 */
const fs = require('fs');
const path = require('path');

const file = process.argv[2] || path.join(__dirname, 'Ozark-POS.html');
const only = (process.argv.find(a => a.startsWith('--')) || '').replace('--', '');
const html = fs.readFileSync(file, 'utf8');
const m = html.match(/<script>([\s\S]*)<\/script>/);
if (!m) { console.error('no inline <script> in ' + file); process.exit(1); }
const appJs = m[1];
const OFFSET = html.slice(0, m.index).split('\n').length;
const lines = appJs.split('\n');
const at = i => i + OFFSET;
const code = ln => ln.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/, '');

let issues = 0, reviews = 0;
const show = (tier, what, where, snip) => {
  if (tier === 'FAIL') issues++; else reviews++;
  console.log('  ' + (tier === 'FAIL' ? '❌' : '⚠ ') + ' ' + where.padEnd(9) + what);
  if (snip) console.log('        ' + snip.slice(0, 116));
};

console.log('══ PATTERN AUDIT ══  ' + lines.length + ' lines · every rule here is a mistake this file has already made\n');

/* ── A. a field concatenated raw into markup ───────────────────────────────────────────────────────────── */
function rawFields(){
  console.log("── A · RAW FIELD INTO VISIBLE TEXT  (the \"Type: undefined\" class) ──");
  /* Calibrated against the real bug: o.pressType was concatenated straight into the Detail heading, so an
     order with no press type printed "Type: undefined" to the customer's face.
     Ids inside onclick=""/value=""/href="" are NOT this bug — a record always has an id, and an undefined
     one breaks the handler loudly rather than lying quietly. So: TEXT positions only, no ids, no attributes.
     Getting this narrow matters. The first draft of this rule reported 111 fields, which is the same as
     reporting nothing. */
  const OPTIONAL = /\.(pressType|kind|promise|desc|brand|color|pattern|note|notes|reason|detail|comments|label|title|status|by|method|rackLoc|rackNote|attn|email|route|address|routeNotes|reminder|business|first|last|name)$/;
  const hits = [];
  lines.forEach((ln, i) => {
    const c = code(ln);
    if (c.indexOf("h+=") < 0 && c.indexOf("html+=") < 0 && c.indexOf("return '<") < 0) return;
    const re = /\+\s*([a-zA-Z_$][\w$]*\.[a-zA-Z_$][\w$.]*)\s*\+/g;
    let x;
    while ((x = re.exec(c))) {
      const expr = x[1];
      if (!OPTIONAL.test(expr)) continue;                                  // ids/counts/flags are not this bug
      const before = c.slice(Math.max(0, x.index - 90), x.index);
      /* inside an attribute? the last quote before us opened one */
      if (/(onclick|onchange|oninput|onkeydown|value|href|title|placeholder|id|data-[\w-]+)\s*=\s*[^"]*$/.test(before)) continue;
      if (/(esc|money|fmtDate|fmtPhone|statusPill)\s*\($/.test(before)) continue;
      if (/\|\|\s*$/.test(before)) continue;                               // already defaulted
      const after = c.slice(x.index, x.index + expr.length + 40);
      if (/\|\||\?/.test(after.slice(expr.length))) continue;              // guarded right after
      hits.push({ line: at(i), expr, snip: (before.slice(-34) + x[0] + after.slice(expr.length + 2, 30)).replace(/\s+/g, ' ') });
    }
  });
  if (!hits.length) console.log('   none');
  hits.slice(0, 20).forEach(h => show('REVIEW',
    h.expr + ' printed raw — shows the word "undefined" when unset', 'L' + h.line, h.snip));
  console.log('');
}

/* ── B. a list rendered with no ceiling ────────────────────────────────────────────────────────────────── */
function unbounded(){
  console.log('── B · UNBOUNDED LIST  (the chase-list / just-racked class) ──');
  /* Calibrated against the real bugs: the needs-collection list rendered every open record at 84px a row on
     TWO screens, and rack's "just racked" grew all shift. Both were fed straight from a DB collection.
     A list bounded by ONE order (its pieces, its bags, its cards) is not this bug — the counter must see all
     of them. So only sources that grow with business volume count. */
  const GROWS = /(DB\.(orders|customers|activity|collections|payments|ledger|garments|routeLog|timeclock|smsLog|voidRequests|refundRequests)|openCollections\(\)|pnpCustomers\(\)|overdueList\(\)|noEmailOwing\(\)|readArchive\()/;
  let n = 0;
  lines.forEach((ln, i) => {
    const c = code(ln);
    if (!/\.forEach\s*\(/.test(c)) return;
    if (!/(h|html)\s*\+=/.test(c)) return;
    if (/\.slice\s*\(/.test(c)) return;                                    // already capped
    if (!GROWS.test(c)) return;                                            // bounded by one record → not this bug
    n++;
    show('REVIEW', 'renders straight from a growing collection with no cap', 'L' + at(i), c.trim());
  });
  if (!n) console.log('   none');
  console.log('');
}

/* ── C. an error that can render as good news ──────────────────────────────────────────────────────────── */
function silentCatch(){
  console.log("── C · AN ERROR THAT RENDERS AS GOOD NEWS  (the hidden-pickup-inbox class) ──");
  /* Calibrated against the real bug: the pickup inbox set itself display:none on ANY hub error, which looks
     exactly like "nobody has requested a pickup" — a customer waited six days.
     `try{ toast(...) }catch(e){}` is the OPPOSITE of this bug: a defensive wrapper round something cosmetic.
     The first draft flagged 40 of those, which is why this now requires the failure path to HIDE or EMPTY
     something. */
  let n = 0;
  lines.forEach((ln, i) => {
    const c = code(ln);
    const isFail = /catch\s*\(|\.catch\s*\(/.test(c);
    if (!isFail) return;
    const tail = c.slice(c.search(/\.?catch\s*\(/));
    if (!/display\s*:\s*none|innerHTML\s*=\s*['"]{2}|innerHTML\s*=\s*''/.test(tail)) return;
    n++;
    show('FAIL', 'a failure path HIDES or EMPTIES a panel — indistinguishable from "nothing to show"',
      'L' + at(i), c.trim());
  });
  if (!n) console.log('   none');
  console.log('');
}

/* ── D. a guard that can never release ─────────────────────────────────────────────────────────────────── */
function stuckGuards(){
  console.log('── D · GUARD WITH NO WAY OUT  (the updateSafe class) ──');
  let n = 0;
  lines.forEach((ln, i) => {
    const c = code(ln);
    if (!/return\s+false\s*;/.test(c)) return;
    if (!/indexOf\(state\.screen\)|state\.screen\s*===/.test(c)) return;
    if (/idle|Date\.now\(\)|__lastAct|waited/.test(c)) return;            // has a time component
    n++;
    show('REVIEW', 'refuses based only on which screen is open, with no idle/timeout escape',
      'L' + at(i), c.trim());
  });
  if (!n) console.log('   none');
  console.log('');
}

/* ── E. an object replaced wholesale ───────────────────────────────────────────────────────────────────── */
function wholesale(){
  console.log('── E · WHOLESALE OBJECT REPLACE  (the c.prefs class) ──');
  /* Calibrated against the real bug: TWO SEPARATE FORMS each did c.prefs={starch,pants,spotting}, so adding a
     fourth preference meant whichever form you used second silently erased it.
     A defaults block plus one loader in the same function is fine, and so are two branches of one if/else.
     What is dangerous is the same object rebuilt from scratch in two DIFFERENT functions. */
  const fnAt = i => { for (let k = i; k >= 0; k--) { const mm = lines[k].match(/^\s*function\s+([\w$]+)/); if (mm) return mm[1]; } return '(top)'; };
  const seen = {};
  lines.forEach((ln, i) => {
    const c = code(ln);
    const re = /([a-zA-Z_$][\w$]*\.[a-zA-Z_$][\w$]*)\s*=\s*\{[^}]{18,}\}/g;
    let x;
    while ((x = re.exec(c))) {
      const t = x[1];
      if (/^(window|state|SYNC|opts|cfg|f|d|o|l|x|r|p|e|s|b|m)\./.test(t)) continue;
      /* a DEFAULTS INITIALISER is not a wholesale replace: `if(!x.y) x.y={...}` only ever fills a gap. The
         first draft flagged three of these in the payment-settings migration, which is correct code. */
      const guard = c.slice(0, x.index);
      if (guard.indexOf('!') >= 0 && guard.indexOf(t) >= 0) continue;   // `if(!a.b.c) a.b.c={...}` fills a gap; it does not replace
      if (/\|\|\s*$/.test(guard)) continue;
      (seen[t] = seen[t] || []).push({ line: at(i), fn: fnAt(i) });
    }
  });
  let n = 0;
  Object.keys(seen).forEach(k => {
    const fns = [...new Set(seen[k].map(v => v.fn))];
    if (fns.length < 2) return;                                            // same function → defaults, not drift
    n++;
    show('FAIL', k + ' is rebuilt from scratch in ' + fns.length + ' different functions — each erases what the others set',
      'L' + seen[k][0].line, fns.join(' · '));
  });
  if (!n) console.log('   none');
  console.log('');
}

/* ── F. a card charged outside the duplicate interlock ─────────────────────────────────────────────────── */
function unguardedCharges(){
  console.log('── F · A CARD CHARGED OUTSIDE THE INTERLOCK  (the English double-charge class) ──');
  /* Calibrated against the real bug: DR. Tobias & Cora Enderby were charged $37.93 twice, 44 seconds apart. The
     interlock added on 8/08 covers chargeSavedCard and runPresentCharge — but a path that calls the raw
     primitive itself skips it, protected only by chargeGuard()'s 1.5-second debounce, which is precisely what
     failed. This rule found payCardIframeRun (the keyed-card path at pickup) doing exactly that.
     A $0 call is a card VERIFICATION, not a charge, and is correctly exempt. */
  let n = 0;
  lines.forEach((ln, i) => {
    const c = code(ln);
    if (!/\bpayCharge(Token|Present)\s*\(/.test(c)) return;
    if (/^\s*function payCharge(Token|Present)\b/.test(c)) return;               // the primitive's own definition
    if (/,\s*0\s*,/.test(c)) return;                                            // $0 verification, not a charge
    /* look back to the top of the enclosing function for the interlock */
    let fn = '(top)', guarded = false;
    for (let k = i; k >= 0 && k > i - 40; k--) {
      if (/dupChargeOK\s*\(/.test(lines[k])) guarded = true;
      const mm = lines[k].match(/^\s*function\s+([\w$]+)/);
      if (mm) { fn = mm[1]; break; }
    }
    if (guarded) return;
    n++;
    show('FAIL', fn + '() charges a card without dupChargeOK — only the 1.5s debounce stands between a customer and a second charge',
      'L' + at(i), c.trim());
  });
  if (!n) console.log('   none');
  console.log('');
}

/* ── G. money shown to a human without money() ─────────────────────────────────────────────────────────── */
function rawMoney(){
  console.log('── G · MONEY PRINTED WITHOUT money()  (the "$4.5" class) ──');
  /* A price rendered raw shows "$4.5" instead of "$4.50", and a computed one shows "$12.300000000000001".
     Every amount a customer or an employee reads has to go through money(). */
  let n = 0;
  const MONEYISH = /\.(price|amount|amt|total|balance|due|open|sub|tax|paid|rate|surcharge|credit|owed)$/;
  lines.forEach((ln, i) => {
    const c = code(ln);
    if (c.indexOf("h+=") < 0 && c.indexOf("html+=") < 0 && c.indexOf("return '<") < 0) return;
    /* require a literal $ right before it. "total" and "amount" are ALSO used for counts ("3 of 5 found",
       the four press-station tallies) and a percentage basis — the first draft flagged all four of those. */
    const re = /\$\s*'\s*\+\s*([a-zA-Z_$][\w$]*\.[a-zA-Z_$][\w$.]*)\s*\+/g;
    let x;
    while ((x = re.exec(c))) {
      if (!MONEYISH.test(x[1])) continue;
      const before = c.slice(Math.max(0, x.index - 60), x.index);
      if (/money\s*\($/.test(before)) continue;
      if (/(value|onclick|data-[\w-]+)\s*=\s*[^"]*$/.test(before)) continue;     // an input value, not display
      n++;
      show('REVIEW', x[1] + ' shown without money() — renders "$4.5" or a floating-point tail',
        'L' + at(i), (before.slice(-40) + x[0]).replace(/\s+/g, ' '));
    }
  });
  if (!n) console.log('   none');
  console.log('');
}

/* ── H. a record changed without stamping _t ───────────────────────────────────────────────────────────── */
function unstamped(){
  console.log('── H · A CHANGE THE SYNC CAN UNDO  (the "lost clothes" class) ──');
  /* Calibrated against a whole family of real bugs (see CLAUDE.md 7/28): pickups, voids, queue decisions and
     rack moves all silently reverted because the record was changed without bumping _t, so the next merge
     preferred another device's older copy. A racked order went back to Assembled and the clothes were "lost".
     Rule: a line that assigns an order/customer status or payment field AND saves must stamp _t. */
  let n = 0;
  lines.forEach((ln, i) => {
    const c = code(ln);
    if (!/\b[a-z]\.(status|paymentStatus|payMethod|balance|rackLoc|delivered)\s*=/.test(c)) return;
    if (!/saveDB\s*\(/.test(c)) return;                                          // not persisted here
    const win = lines.slice(Math.max(0, i - 3), i + 4).join(' ');
    if (/_t\s*=\s*hlcNow\(\)|_t\s*=\s*now\b|_t\s*=\s*stamp\b/.test(win)) return; // stamped nearby
    /* a function already marked HISTORICAL cannot hurt anyone — reporting it every run is noise */
    if (/HISTORICAL/.test(lines.slice(Math.max(0, i - 8), i).join(' '))) return;
    n++;
    show('FAIL', 'changes a synced field and saves without stamping _t — another device can undo it',
      'L' + at(i), c.trim());
  });
  if (!n) console.log('   none');
  console.log('');
}

function crossedEngines(){
  console.log('── I · AN ENGINE REACHING INTO ANOTHER ENGINE’S FACTS  (the stopCust class) ──');
  /* ⚠️ Calibrated on a real one. stopCust() answered "whose door is this?" with billCust() -- the route engine
     reading a billing fact. Placement and billing are different questions about the same customer, and mixing
     them makes a driver's address depend on an invoice.
     Prints as REVIEW on purpose: honest crossings exist (a route screen showing what a customer owes;
     custOnAccount asking who pays, which IS its job). A report that cries wolf gets ignored -- that has already
     happened twice here. What must not survive is a PLACEMENT decision made from a BILLING fact. */
  const PLACE = /\b(stop|route|address|door)\b/i;
  const BILL  = /\b(billTo|billCust|billMonthly|isAccount|balance|ledger|arBill)\b/;
  /* the names that decide WHERE something goes -- a hit inside one of these is the shape that cost us */
  const PLACERS = /^(stopKeyOf|stopMembers|stopHeadOf|stopCust|stopOnRun|stopCarried|routeCustomersOn|custIsRoute|driverAddr|routeRenumber|routeStopRows|removeFromRoute)$/;
  let n = 0;
  /* ⚠️ NEVER JUDGE PROSE. code() strips a comment that opens and closes on one line, but not a line in the
     MIDDLE of a block comment -- and fnAt() walks backwards to the nearest `function`, so a banner written above
     one function is attributed to the function above THAT. On its first run this rule reported the sentence
     "billCust is not consulted here" as proof that billCust was being consulted: two of three findings were the
     rule reading its own explanation. Block-comment depth is therefore tracked across the file, and if the scan
     ends still INSIDE a comment it has desynced (a '/*' in a string), so it marks nothing as prose and the rule
     behaves exactly as before rather than silently going quiet. */
  const prose = (function(){
    const flags = []; let open = false;
    lines.forEach(ln => {
      let j = 0, sawCode = false;
      while (j < ln.length){
        if (open){ if (ln[j] === '*' && ln[j+1] === '/'){ open = false; j += 2; continue; } j++; continue; }
        if (ln[j] === '/' && ln[j+1] === '*'){ open = true; j += 2; continue; }
        if (ln[j] === '/' && ln[j+1] === '/') break;
        if (!/\s/.test(ln[j])) sawCode = true;
        j++;
      }
      flags.push(!sawCode);
    });
    return open ? lines.map(() => false) : flags;   /* desynced → judge everything, same as before */
  })();
  const fnAt = i => { for (let k = i; k >= 0; k--) { if (prose[k]) continue; const mm = lines[k].match(/^\s*function\s+([\w$]+)/); if (mm) return mm[1]; } return '(top)'; };
  lines.forEach((ln, i) => {
    const c = code(ln);
    if (!BILL.test(c)) return;
    if (prose[i]) return;                       /* a sentence about a rule is not a breach of it */
    const fn = fnAt(i);
    if (!PLACERS.test(fn)) return;
    /* already retired and labelled -- reporting it every run is the noise this file exists to avoid */
    if (/HISTORICAL/.test(lines.slice(Math.max(0, i - 14), i).join(' '))) return;
    n++;
    show('REVIEW', 'placement function "' + fn + '" reads a billing fact — a door must not be decided by an invoice',
      'L' + at(i), c.trim());
  });
  /* and the mirror: a billing function deciding something from where a customer stands */
  const BILLERS = /^(billCust|arBill|custOnAccount|recordAccountPayment|consumeCredit|orderARnet|clearOrderFromAR|monthlyAutoChargeRun)$/;
  lines.forEach((ln, i) => {
    const c = code(ln);
    if (!PLACE.test(c)) return;
    if (prose[i]) return;                       /* a sentence about a rule is not a breach of it */
    const fn = fnAt(i);
    if (!BILLERS.test(fn)) return;
    if (/HISTORICAL/.test(lines.slice(Math.max(0, i - 14), i).join(' '))) return;
    n++;
    show('REVIEW', 'billing function "' + fn + '" reads a placement fact — what somebody owes cannot depend on where they stand',
      'L' + at(i), c.trim());
  });
  if (!n) console.log('   none — placement and billing are still separate questions');
  console.log('');
}

if (!only || only === 'undef')     rawFields();
if (!only || only === 'unbounded') unbounded();
if (!only || only === 'catch')     silentCatch();
if (!only || only === 'guards')    stuckGuards();
if (!only || only === 'replace')   wholesale();
if (!only || only === 'charge')    unguardedCharges();
if (!only || only === 'money')     rawMoney();
if (!only || only === 'stamp')     unstamped();
if (!only || only === 'engines')   crossedEngines();

console.log('══ ' + issues + ' likely defect(s) · ' + reviews + ' to review ══');
console.log('Nothing was changed. REVIEW items are judgement calls — read the line before touching it.');
process.exit(0);
