/* Auction fee math (pack: auction, unit A1): the proofs. Pure Node, no browser.
   The library is packs/auction/feemath.js: the consignor's commission and fees, the buyer's premium, tax by class, the
   buyer's invoice and the consignor's statement, in whole cents.

   Every proof names the failure it prevents and carries NEGATIVE CONTROLS. A control is a copy of feemath.js with ONE
   rule broken (a source mutation), and the proof's own check must FAIL on that copy. Three guards keep the controls honest:
     - a mutation's anchor text must occur exactly once in the source, so a refactor breaks this test loudly instead of
       turning a control into a no-op;
     - a broken copy must still load and still do plain math (flat 10% of $100.00 = $10.00), so it fails for the rule
       and not because it crashed;
     - the unbroken source, loaded the same way as the broken copies, must pass, so a failure is the mutation's doing.
   "A test that cannot fail is not evidence."

   Every figure is worked by hand in the comments. No third-party numbers are pinned: a vendor's published worked
   example would only be used here if it stated all of its inputs, and none has been checked yet. */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const FILE = path.join(__dirname, '..', 'packs', 'auction', 'feemath.js');
const README = path.join(__dirname, '..', 'packs', 'auction', 'README.md');
const SRC = fs.readFileSync(FILE, 'utf8');
const LIB = require(FILE);

/* ---------- harness ---------- */

/* @proof — loads a copy of the library's source in a fresh context (no window, no globals), as CommonJS. */
function load(src, label) {
  const sandbox = { module: { exports: {} } };
  vm.runInNewContext(src, sandbox, { filename: label });
  return sandbox.module.exports;
}
const BASE = load(SRC, 'feemath.base.js');

/* @proof — a copy of the source with one rule broken; the anchor must occur exactly once. */
function mutant(find, repl) {
  const n = SRC.split(find).length - 1;
  if (n !== 1) throw new Error('mutation anchor must occur exactly once in feemath.js, found ' + n + ': ' + find);
  return load(SRC.replace(find, () => repl), 'feemath.mutant.js');
}

/* @proof — a broken copy must still do plain math, so its failure is the rule's and not a crash's. */
function sane(F) {
  try {
    return F.commission({ kind: 'flat', basis: 'line', brackets: [{ uptoCents: null, bp: 1000 }] },
      [{ lotNo: '1', unitCents: 10000, qty: 1, mode: 'each' }]).cents === 1000 && F.roundBp(100, 1000) === 10;
  } catch (e) { return false; }
}

/* @proof — runs one check; true passes, a string (the first mismatch) or a throw fails. */
function run(check, arg) {
  try {
    const v = check(arg);
    return v === true ? { pass: true, why: '' } : { pass: false, why: String(v) };
  } catch (e) { return { pass: false, why: 'threw ' + (e && e.message) }; }
}

/* @proof — compares [label, got, want] rows; returns true or the first mismatch in words. */
function expectAll(rows) {
  for (const [label, got, want] of rows) {
    if (JSON.stringify(got) !== JSON.stringify(want)) return label + ': got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want);
  }
  return true;
}

let failed = 0, proofs = 0, controls = 0;

/* @proof — one proof over the library: the real module and the unbroken copy pass, every broken copy fails. */
function proof(id, title, prevents, check, mutations) {
  proofs++;
  const out = [];
  let ok = true;
  for (const [name, lib] of [['the library', LIB], ['the unbroken source in a fresh context', BASE]]) {
    const r = run(check, lib);
    if (!r.pass) { ok = false; out.push('      FAILED on ' + name + ': ' + r.why); }
  }
  if (!mutations.length) { ok = false; out.push('      NO NEGATIVE CONTROL: a proof that cannot fail is not evidence'); }
  for (const m of mutations) {
    controls++;
    let F;
    try { F = mutant(m.find, m.repl); } catch (e) { ok = false; out.push('      CONTROL NOT BUILT (' + m.why + '): ' + e.message); continue; }
    if (!sane(F)) { ok = false; out.push('      CONTROL INVALID (' + m.why + '): the broken copy no longer does plain math'); continue; }
    const r = run(check, F);
    if (r.pass) { ok = false; out.push('      NEGATIVE CONTROL DID NOT FAIL: ' + m.why); }
    else out.push('      control failed, as it must: ' + m.why + '  [' + r.why.slice(0, 160) + ']');
  }
  report(id, title, prevents, ok, out);
}

/* @proof — one proof over source text: the real text passes, every planted variant fails. */
function sourceProof(id, title, prevents, check, real, plants) {
  proofs++;
  const out = [];
  let ok = true;
  const r = run(check, real);
  if (!r.pass) { ok = false; out.push('      FAILED on the real files: ' + r.why); }
  if (!plants.length) { ok = false; out.push('      NO NEGATIVE CONTROL'); }
  for (const p of plants) {
    controls++;
    const rp = run(check, p.input);
    if (rp.pass) { ok = false; out.push('      NEGATIVE CONTROL DID NOT FAIL: ' + p.why); }
    else out.push('      control failed, as it must: ' + p.why + '  [' + rp.why.slice(0, 110) + ']');
  }
  report(id, title, prevents, ok, out);
}

/* @proof — prints one proof's verdict, what it prevents and each control it saw fail. */
function report(id, title, prevents, ok, out) {
  console.log((ok ? '✓' : '✗') + ' P' + id + '  ' + title);
  console.log('      prevents: ' + prevents);
  out.forEach((l) => console.log(l));
  if (!ok) failed++;
}

/* @proof — true when the call is refused with the library's own refusal (and, if given, names the field). */
function refusal(label, fn, pathHas) {
  try { fn(); } catch (e) {
    if (!e || e.code !== 'FEEMATH_REFUSED') return label + ' threw something other than a refusal: ' + (e && e.message);
    if (pathHas && String(e.path).indexOf(pathHas) < 0) return label + ' was refused on the wrong field: ' + e.path;
    return true;
  }
  return label + ' was ACCEPTED';
}

const clone = (o) => JSON.parse(JSON.stringify(o));
/* @proof — freezes an input all the way down, so any write to it throws in strict code. */
function deepFreeze(o) {
  if (o && typeof o === 'object') { Object.values(o).forEach(deepFreeze); Object.freeze(o); }
  return o;
}

/* ---------- shared fixtures (made-up numbers) ---------- */

const LINE = (lotNo, unitCents, extra) => Object.assign({ lotNo: lotNo, unitCents: unitCents, qty: 1, mode: 'each' }, extra || {});
const FLAT10 = { kind: 'flat', basis: 'line', brackets: [{ uptoCents: null, bp: 1000 }] };
const B_30_20 = [{ uptoCents: 10000, bp: 3000 }, { uptoCents: null, bp: 2000 }];          /* 30% up to $100.00, 20% above */
const B_20_10 = [{ uptoCents: 10000, bp: 2000 }, { uptoCents: null, bp: 1000 }];          /* 20% up to $100.00, 10% above */
const FLOOR10 = { brackets: [{ uptoCents: null, bp: 1000 }] };                             /* floor premium: 10% */
const ONLINE = { kind: 'incremental', brackets: [{ uptoCents: 100000, bp: 1500 }, { uptoCents: null, bp: 1000 }], capCents: 50000, minCents: 500 };
const TAXT = { rateMilliPct: 9875, premiumTaxed: true, classes: { general: 'taxable', farm: 'exemptWithCert', titled: 'exempt' } };
const TERMS = { v: 1, premium: { floor: FLOOR10, online: ONLINE }, tax: TAXT, rounding: { premium: 'line', tax: 'invoice' }, confirmAboveCents: 500000, record: 'floor' };
const NO_TAX = { rateMilliPct: 9875, premiumTaxed: true, classes: { general: 'exempt' } };
const SALE_DATE = '2026-11-14';

/* ======================================================================== */

/* P1 — the headline example. Brackets 30% up to $100.00, 20% above, on a $110.00 lot:
   sliding: $110.00 is above $100.00, so ALL of it is charged at 20%: $22.00.
   incremental: $100.00 x 30% = $30.00, plus the $10.00 above at 20% = $2.00: $32.00. */
proof(1, 'Sliding vs incremental on $110.00 (30% up to $100.00, 20% above): $22.00 vs $32.00',
  'the two commission kinds swapped or mis-sliced, a $10.00 error on a $110.00 lot',
  (F) => {
    const ln = [LINE('7', 11000)];
    const sl = F.commission({ kind: 'sliding', basis: 'line', brackets: B_30_20 }, ln);
    const inc = F.commission({ kind: 'incremental', basis: 'line', brackets: B_30_20 }, ln);
    return expectAll([
      ['sliding', sl.cents, 2200],
      ['incremental', inc.cents, 3200],
      ['sliding text shows the arithmetic', /\$110\.00 x 20\.00%.* = \$22\.00/.test(sl.mathText), true],
      ['incremental text shows both slices', /\$100\.00 x 30\.00% \+ \$10\.00 x 20\.00% = \$32\.00/.test(inc.mathText), true]
    ]);
  },
  [
    { why: 'the kinds swapped in the bracket engine', find: "if (kind !== 'incremental') {", repl: "if (kind === 'incremental') {" },
    { why: 'incremental charges each bracket from zero instead of its own slice', find: 'exact += (top - from) * b[j].bp;', repl: 'exact += top * b[j].bp;' }
  ]);

/* P2 — "up to $100.00" includes $100.00. Sliding on exactly $100.00 is 30% = $30.00; on $100.01 it is 20% of
   $100.01 = $20.002, rounded half up to $20.00. Incremental on $100.01: $30.00 + $0.01 x 20% = $30.002 -> $30.00. */
proof(2, 'A bracket\'s upper bound is inclusive ("up to $100.00" includes $100.00)',
  'a lot priced exactly on a bracket bound charged at the next bracket\'s rate',
  (F) => {
    const S = { kind: 'sliding', basis: 'line', brackets: B_30_20 }, I = { kind: 'incremental', basis: 'line', brackets: B_30_20 };
    return expectAll([
      ['sliding at $100.00', F.commission(S, [LINE('1', 10000)]).cents, 3000],
      ['sliding at $100.01', F.commission(S, [LINE('1', 10001)]).cents, 2000],
      ['incremental at $100.00', F.commission(I, [LINE('1', 10000)]).cents, 3000],
      ['incremental at $100.01', F.commission(I, [LINE('1', 10001)]).cents, 3000]
    ]);
  },
  [{ why: 'the bound made exclusive', find: 'amount > b[i].uptoCents', repl: 'amount >= b[i].uptoCents' }]);

/* P3 — the three bases on the SAME sales (hand-worked). Lines:
     lot 1: 6 each at $30.00 (times the money)  -> line $180.00
     lot 2: one money $90.00 for a lot of 4      -> line $90.00 (one money is ONE unit at the hammer price)
     lot 3: $250.00                               -> line $250.00     consignor's sold total $520.00
   Sliding, 20% up to $100.00, 10% above:
     item:      lot 1 $30.00 x 20% = $6.00, x 6 = $36.00; lot 2 $90.00 x 20% = $18.00; lot 3 $250.00 x 10% = $25.00 -> $79.00
     line:      lot 1 $180.00 x 10% = $18.00; lot 2 $18.00; lot 3 $25.00                                             -> $61.00
     consignor: $520.00 x 10%                                                                                          -> $52.00
   Incremental, same brackets:
     item:      lot 1 $6.00 x 6 = $36.00; lot 2 $18.00; lot 3 $100 x 20% + $150 x 10% = $35.00                        -> $89.00
     line:      lot 1 $100 x 20% + $80 x 10% = $28.00; lot 2 $18.00; lot 3 $35.00                                     -> $81.00
     consignor: $100 x 20% + $420 x 10% = $62.00                                                                      -> $62.00 */
const BASES_LINES = [LINE('1', 3000, { qty: 6 }), LINE('2', 9000, { qty: 4, mode: 'onemoney' }), LINE('3', 25000)];
proof(3, 'The three bases (item, line, consignor) give different, hand-worked results on the same sales',
  'a basis read the wrong way: commission on the line when the contract says each item, on lines when it says the consignor\'s total, or a one-money lot multiplied by its count',
  (F) => {
    const c = (kind, basis) => F.commission({ kind: kind, basis: basis, brackets: B_20_10 }, BASES_LINES).cents;
    return expectAll([
      ['sliding item', c('sliding', 'item'), 7900], ['sliding line', c('sliding', 'line'), 6100], ['sliding consignor', c('sliding', 'consignor'), 5200],
      ['incremental item', c('incremental', 'item'), 8900], ['incremental line', c('incremental', 'line'), 8100], ['incremental consignor', c('incremental', 'consignor'), 6200],
      ['item basis per-unit rows', F.commission({ kind: 'sliding', basis: 'item', brackets: B_20_10 }, BASES_LINES).perUnit.map((u) => [u.lotNo, u.basisCents, u.units, u.eachCents, u.cents]),
        [['1', 3000, 6, 600, 3600], ['2', 9000, 1, 1800, 1800], ['3', 25000, 1, 2500, 2500]]]
    ]);
  },
  [
    { why: 'item basis charged on the line total', find: 'const basisCents = item ? l.unitCents : l.lineCents;', repl: 'const basisCents = l.lineCents;' },
    { why: 'consignor basis charged line by line', find: "if (s.basis === 'consignor') {", repl: 'if (false) {' },
    { why: 'a one-money lot multiplied by its count', find: "const lineCents = mode === 'each' ? unit * qty : unit;", repl: 'const lineCents = unit * qty;' },
    { why: 'a one-money lot counted as several items', find: "units: mode === 'each' ? qty : 1,", repl: 'units: qty,' }
  ]);

/* P4 — minimum and cap at each basis. Flat 10%, minimum $3.00, cap $50.00. Lines: lot 1 is 4 each at $5.00 (line
   $20.00); lot 2 is $900.00.
     item:      lot 1 each $5.00 x 10% = $0.50, raised to $3.00, x 4 = $12.00; lot 2 $90.00 held to $50.00   -> $62.00
     line:      lot 1 $20.00 x 10% = $2.00, raised to $3.00; lot 2 $50.00                                   -> $53.00
     consignor: $920.00 x 10% = $92.00, held to $50.00                                                      -> $50.00
     consignor, one $10.00 lot: $1.00 raised to $3.00. Consignor with nothing sold: $0.00 (no minimum on nothing). */
proof(4, 'A minimum and a cap apply at each basis\'s own level (each item, each line, the consignor\'s total)',
  'a minimum applied to the line when it is per item (or not at all), a cap ignored, or a minimum charged to a consignor who sold nothing',
  (F) => {
    const S = (basis) => ({ kind: 'flat', basis: basis, brackets: [{ uptoCents: null, bp: 1000 }], minCents: 300, capCents: 5000 });
    const ls = [LINE('1', 500, { qty: 4 }), LINE('2', 90000)];
    const item = F.commission(S('item'), ls);
    return expectAll([
      ['item', item.cents, 6200], ['item clamps', item.perUnit.map((u) => u.clamp), ['min', 'cap']],
      ['line', F.commission(S('line'), ls).cents, 5300],
      ['consignor cap', F.commission(S('consignor'), ls).cents, 5000],
      ['consignor minimum', F.commission(S('consignor'), [LINE('9', 1000)]).cents, 300],
      ['consignor with nothing sold', F.commission(S('consignor'), [LINE('9', 0, { passed: true })]).cents, 0],
      ['text names the minimum', /raised to the \$3\.00 minimum/.test(item.mathText), true],
      ['text names the cap', /held to the \$50\.00 cap/.test(item.mathText), true]
    ]);
  },
  [
    { why: 'the minimum dropped', find: 'num < minCents * BP_ONE', repl: 'num < 0' },
    { why: 'the cap dropped', find: 'capCents !== null && num > capCents * BP_ONE', repl: 'false' },
    { why: 'a minimum charged on a consignor who sold nothing', find: 'if (sold.length > 0) {', repl: 'if (true) {' }
  ]);

/* P5 — the schedule's fees. Flat 10% on each line; lot fee $5.00; no-sale fee $10.00; titled no-sale fee $25.00;
   buyback fee 5%. Lines: lot 1 sold $100.00; lot 2 passed; lot 3 passed, titled; lot 4 bought back at $300.00;
   lot 5 a choice lot taken twice (5A and 5B, $20.00 each).
     commission: $10.00 + $2.00 + $2.00                                   = $14.00
     fees (lot fee on sold lots, the default): lot fee lots 1 and 5 = $10.00 (ONE fee for lot 5, not one per taking);
       no-sale lot 2 = $10.00; titled no-sale lot 3 = $25.00; buyback lot 4: $300.00 x 5% = $15.00  -> $60.00
     lotFeeOn "offered": lot fees on lots 1-5 = $25.00                                             -> $75.00
     buyback fee {cents: 2000}: $20.00 instead of $15.00                                           -> $65.00
     no titled no-sale fee in the schedule: lot 3 pays the plain $10.00                            -> $45.00 */
const FEE_SCHED = { kind: 'flat', basis: 'line', brackets: [{ uptoCents: null, bp: 1000 }], lotFeeCents: 500, noSaleFeeCents: 1000, titledNoSaleFeeCents: 2500, buybackFee: { bp: 500 } };
const FEE_LINES = [
  LINE('1', 10000), LINE('2', 0, { passed: true }), LINE('3', 0, { passed: true, titled: true }),
  LINE('4', 30000, { passed: true, buyback: true }), LINE('5', 2000, { mode: 'choice', line: 'A' }), LINE('5', 2000, { mode: 'choice', line: 'B' })
];
proof(5, 'Lot, no-sale, titled no-sale and buyback fees',
  'a lot fee charged per taking or on unsold lots by default, the titled no-sale fee missed, commission charged on a buyback, or a no-sale fee on a buyback',
  (F) => {
    const r = F.commission(FEE_SCHED, FEE_LINES);
    const kinds = r.fees.map((f) => f.kind + ':' + f.lotNo + ':' + f.cents).sort();
    const without = Object.assign({}, FEE_SCHED); delete without.titledNoSaleFeeCents;
    return expectAll([
      ['commission', r.cents, 1400], ['fees', r.feesCents, 6000], ['total', r.totalCents, 7400],
      ['fee rows', kinds, ['buyback:4:1500', 'lot:1:500', 'lot:5:500', 'noSale:2:1000', 'titledNoSale:3:2500']],
      ['lot fee on every lot offered', F.commission(Object.assign({}, FEE_SCHED, { lotFeeOn: 'offered' }), FEE_LINES).feesCents, 7500],
      ['flat buyback fee', F.commission(Object.assign({}, FEE_SCHED, { buybackFee: { cents: 2000 } }), FEE_LINES).feesCents, 6500],
      ['titled falls back to the plain no-sale fee', F.commission(without, FEE_LINES).feesCents, 4500]
    ]);
  },
  [
    { why: 'a lot fee per taking (5A and 5B) instead of per lot', find: 'const k = l.lotNo;', repl: 'const k = l.label;' },
    { why: 'the titled no-sale fee ignored', find: 'const useTitled = g.some((o) => o.titled)', repl: 'const useTitled = false' },
    { why: 'a buyback charged commission as if sold', find: "const sold = ls.filter((l) => l.outcome === 'sold');", repl: "const sold = ls.filter((l) => l.outcome !== 'passed');" },
    { why: 'the lot fee charged on every lot by default', find: "(anySold || s.lotFeeOn === 'offered')", repl: '(true)' },
    { why: 'a no-sale fee charged on a buyback too', find: 'if (!anySold && !anyBuyback) {', repl: 'if (!anySold) {' }
  ]);

/* P6 — the buyer's premium. Floor: flat 10%. Online: incremental 15% up to $1,000.00, 10% above, minimum $5.00,
   cap $500.00, per line.
     floor $250.00 -> $25.00.   online $250.00 -> $37.50.
     online $2,000.00 -> $1,000 x 15% + $1,000 x 10% = $150.00 + $100.00 = $250.00.
     online $10,000.00 -> $150.00 + $900.00 = $1,050.00, held to the $500.00 cap.
     online $20.00 -> $3.00, raised to the $5.00 minimum.
     the same tiers SLIDING on $2,000.00 -> all of it at 10% = $200.00.
   On an invoice (tax exempt to isolate the premium): $250.00 each on floor, online, phone and absentee; phone and
   absentee have no table of their own, so they pay the floor's: $25.00 + $37.50 + $25.00 + $25.00 = $112.50. */
proof(6, 'Premium tiers, per-line cap and minimum; floor vs online (phone and absentee fall back to floor)',
  'an online buyer charged the floor premium (or the reverse), a premium over its cap or under its minimum, or a multi-tier premium guessed as sliding or incremental',
  (F) => {
    const inv = F.invoice(Object.assign({}, TERMS, { tax: NO_TAX }),
      [LINE('1', 25000, { channel: 'floor', taxClass: 'general' }), LINE('2', 25000, { channel: 'online', taxClass: 'general' }),
        LINE('3', 25000, { channel: 'phone', taxClass: 'general' }), LINE('4', 25000, { channel: 'absentee', taxClass: 'general' })],
      [], [], [], { saleDate: SALE_DATE });
    return expectAll([
      ['floor $250', F.premium(FLOOR10, 25000).cents, 2500],
      ['online $250', F.premium(ONLINE, 25000).cents, 3750],
      ['online $2,000', F.premium(ONLINE, 200000).cents, 25000],
      ['online $10,000 capped', [F.premium(ONLINE, 1000000).cents, F.premium(ONLINE, 1000000).clamp], [50000, 'cap']],
      ['online $20 minimum', [F.premium(ONLINE, 2000).cents, F.premium(ONLINE, 2000).clamp], [500, 'min']],
      ['sliding tiers on $2,000', F.premium({ kind: 'sliding', brackets: ONLINE.brackets }, 200000).cents, 20000],
      ['invoice premium by channel', inv.premiumCents, 11250],
      ['invoice line premiums', inv.lines.map((l) => l.premiumCents), [2500, 3750, 2500, 2500]],
      ['two tiers with no kind', refusal('a two-tier premium without a kind', () => F.premium({ brackets: ONLINE.brackets }, 1000), 'kind'), true]
    ]);
  },
  [
    { why: 'the cap dropped', find: 'capCents !== null && num > capCents * BP_ONE', repl: 'false' },
    { why: 'the minimum dropped', find: 'num < minCents * BP_ONE', repl: 'num < 0' },
    { why: 'every channel charged the floor table', find: 'return T.premium[channel] || T.premium.floor;', repl: 'return T.premium.floor;' },
    { why: 'a multi-tier premium with no kind guessed as incremental', find: "if (brackets.length > 1) refuse(path + '.kind', 'a premium with ' + brackets.length + ' tiers must say sliding or incremental; the math never guesses');", repl: "if (brackets.length > 1) kind = 'incremental';" }
  ]);

/* P7 — tax by class. Rate 9.875%. Classes: general taxable, farm exempt WITH a certificate, titled exempt. Sale date
   2026-11-14. Lines: lot 1 general $100.00 + $10.00 premium; lot 2 farm $200.00 + $20.00; lot 3 titled $1,000.00 + $100.00.
     premium taxed, no certificate: base $100 + $10 + $200 + $20 = $330.00; x 9.875% = $32.5875 -> $32.59
     premium NOT taxed, no certificate: base $300.00 -> $29.625 -> half up -> $29.63
     premium taxed, valid certificate (expires 2027-06-30): base $110.00 -> $10.8625 -> $10.86
     premium NOT taxed, valid certificate: base $100.00 -> $9.875 -> $9.88
     certificate EXPIRED 2026-10-01: taxed as if none -> $32.59
     certificate expiring ON the sale date: counts as expired by default -> $32.59; with certValidOnExpiryDay -> $10.86
     certificate with no expiry date: does not count by default -> $32.59; with certWithoutExpiryCounts -> $10.86
     titled is exempt in every case. */
const TAX_LINES = [
  { lotNo: '1', taxClass: 'general', lineCents: 10000, premiumCents: 1000 },
  { lotNo: '2', taxClass: 'farm', lineCents: 20000, premiumCents: 2000 },
  { lotNo: '3', taxClass: 'titled', lineCents: 100000, premiumCents: 10000 }
];
proof(7, 'Tax: premiumTaxed on and off; an exempt-with-certificate class with a valid, an expired and no certificate',
  'tax skipped on an expired certificate, charged despite a valid one, the premium taxed when the terms say not (or the reverse), or a half cent rounded down',
  (F) => {
    const T = (extra) => Object.assign({}, TAXT, extra || {});
    const t = (terms, cert) => F.tax(TAX_LINES, terms, cert, SALE_DATE);
    const valid = { certId: 'X-1', expires: '2027-06-30' };
    const none = t(T(), null);
    return expectAll([
      ['taxed premium, no certificate', none.cents, 3259],
      ['the base', [none.hammerBaseCents, none.premiumBaseCents, none.baseCents], [30000, 3000, 33000]],
      ['untaxed premium, no certificate', t(T({ premiumTaxed: false }), null).cents, 2963],
      ['valid certificate', [t(T(), valid).cents, t(T(), valid).cert.status], [1086, 'valid']],
      ['valid certificate, untaxed premium', t(T({ premiumTaxed: false }), valid).cents, 988],
      ['expired certificate', [t(T(), { expires: '2026-10-01' }).cents, t(T(), { expires: '2026-10-01' }).cert.status], [3259, 'expired']],
      ['expires on the sale date (default)', [t(T(), { expires: SALE_DATE }).cents, t(T(), { expires: SALE_DATE }).cert.counts], [3259, false]],
      ['expires on the sale date (setting on)', t(T({ certValidOnExpiryDay: true }), { expires: SALE_DATE }).cents, 1086],
      ['no expiry date (default)', t(T(), { certId: 'X-2' }).cents, 3259],
      ['no expiry date (setting on)', t(T({ certWithoutExpiryCounts: true }), { certId: 'X-2' }).cents, 1086],
      ['titled stays exempt with a certificate', t(T(), valid).lines.map((l) => l.taxable), [true, false, false]],
      ['titled stays exempt without one', none.lines.map((l) => l.taxable), [true, true, false]],
      ['text shows the base and the rate', /Tax base \$300\.00 \+ taxed premium \$30\.00 = \$330\.00; x 9\.875% = \$32\.5875/.test(none.mathText), true]
    ]);
  },
  [
    { why: 'a certificate counted whatever its expiry', find: 'if (saleDate < exp) return', repl: 'if (true) return' },
    { why: 'the exempt-with-certificate class always taxed', find: "(rule === 'exemptWithCert' && !cs.counts)", repl: "(rule === 'exemptWithCert')" },
    { why: 'the premium always taxed', find: 'const premBase = t.premiumTaxed ? roundNum(premExact) : 0;', repl: 'const premBase = roundNum(premExact);' },
    { why: 'the expiry day counted as valid by default', find: 'return t.certValidOnExpiryDay', repl: 'return true' },
    { why: 'a certificate with no expiry counted by default', find: 'return t.certWithoutExpiryCounts', repl: 'return true' },
    { why: 'tax truncated instead of rounded half up', find: 'cents * milliPct + 50000', repl: 'cents * milliPct' }
  ]);

/* P8 — rounding is half up, ONCE, at the level the rule names.
     roundBp: 105 x 10% = 10.5 -> 11; 104 x 10% = 10.4 -> 10; 1 x 50% = 0.5 -> 1; 1 x 49.99% = 0.4999 -> 0.
     roundMilliPct: $300.00 x 9.875% = 2962.5 -> 2963; 1 x 50.000% = 0.5 -> 1; 1 x 49.999% -> 0.
     premium per LINE: three $1.05 lines at 10% = $0.105 each -> $0.11 each -> $0.33.
     premium per INVOICE: $0.105 x 3 = $0.315 -> $0.32 (one rounding, a different and expected answer).
     tax per invoice: two taxable 5-cent lines at 10% = 1.0 cent on the 10-cent base -> 1 cent (per line it would be 2).
     commission per ITEM: 3 each at $1.05, 10% -> $0.105 -> $0.11 each -> $0.33; per LINE: $3.15 -> $0.315 -> $0.32. */
proof(8, 'Rounding happens once, half up, at the stamped level (per line vs per invoice give different, expected results)',
  'a half cent rounded down, or a total rounded line by line when the terms say once per invoice (or the reverse)',
  (F) => {
    const three = [1, 2, 3].map((n) => LINE(String(n), 105, { channel: 'floor', taxClass: 'general' }));
    const inv = (mode) => F.invoice(Object.assign({}, TERMS, { tax: NO_TAX, rounding: { premium: mode, tax: 'invoice' } }), three, [], [], [], { saleDate: SALE_DATE });
    const taxOnce = F.tax([{ lotNo: '1', taxClass: 'general', lineCents: 5 }, { lotNo: '2', taxClass: 'general', lineCents: 5 }],
      { rateMilliPct: 10000, premiumTaxed: false, classes: { general: 'taxable' } }, null, SALE_DATE);
    const c = (basis) => F.commission({ kind: 'flat', basis: basis, brackets: [{ uptoCents: null, bp: 1000 }] }, [LINE('1', 105, { qty: 3 })]).cents;
    return expectAll([
      ['roundBp 10.5', F.roundBp(105, 1000), 11], ['roundBp 10.4', F.roundBp(104, 1000), 10],
      ['roundBp 0.5', F.roundBp(1, 5000), 1], ['roundBp 0.4999', F.roundBp(1, 4999), 0],
      ['roundBp at the ceiling', F.roundBp(1000 * 1000 * 1000, 10000), 1000 * 1000 * 1000],
      ['roundMilliPct 2962.5', F.roundMilliPct(30000, 9875), 2963], ['roundMilliPct 0.5', F.roundMilliPct(1, 50000), 1], ['roundMilliPct 0.49999', F.roundMilliPct(1, 49999), 0],
      ['premium per line', inv('line').premiumCents, 33], ['premium per invoice', inv('invoice').premiumCents, 32],
      ['tax once per invoice', taxOnce.cents, 1],
      ['commission per item', c('item'), 33], ['commission per line', c('line'), 32]
    ]);
  },
  [
    { why: 'truncation instead of half up', find: 'div(num + 5000, BP_ONE)', repl: 'div(num, BP_ONE)' },
    { why: 'half up off by one (half a cent rounds down)', find: 'div(num + 5000, BP_ONE)', repl: 'div(num + 4999, BP_ONE)' },
    { why: 'the premium always rounded per line', find: "const perLine = T.rounding.premium === 'line';", repl: 'const perLine = true;' },
    { why: 'the premium always rounded per invoice', find: "const perLine = T.rounding.premium === 'line';", repl: 'const perLine = false;' },
    { why: 'tax half up off by one', find: 'cents * milliPct + 50000', repl: 'cents * milliPct + 49999' }
  ]);

/* P9 — bad input is refused, never coerced. Each case changes ONE thing in a call that is otherwise accepted. */
const STMT_CONTRACT = {
  contractId: 'C-1',
  schedule: { kind: 'sliding', basis: 'consignor', brackets: [{ uptoCents: 100000, bp: 2500 }, { uptoCents: null, bp: 1500 }], minCents: 2500,
    lotFeeCents: 300, noSaleFeeCents: 1000, titledNoSaleFeeCents: 2500, buybackFee: { bp: 500 } }
};
const STMT_LINES = [
  LINE('A1', 40000, { hammerId: 'h1', buyerBalanceCents: 0, buyerForgivenCents: 0 }),
  LINE('A2', 15000, { qty: 3, hammerId: 'h2', buyerBalanceCents: -300, buyerForgivenCents: 0 }),
  LINE('A3', 90000, { hammerId: 'h3', buyerBalanceCents: 500, buyerForgivenCents: 0 }),
  LINE('A4', 25000, { hammerId: 'h4', buyerBalanceCents: 0, buyerForgivenCents: 0, held: true }),
  LINE('A5', 0, { passed: true }),
  LINE('A6', 20000, { buyback: true })
];
const STMT_EXP = [{ cents: 4000, what: 'advertising' }, { cents: 8500, what: 'trucking' }];
const STMT_ADV = [{ cents: 10000, method: 'check', ref: '1001' }];
const INV_LINES = [
  LINE('101', 25000, { channel: 'floor', taxClass: 'general' }),
  LINE('102', 4000, { qty: 2, channel: 'online', taxClass: 'general' }),
  LINE('103', 60000, { qty: 3, mode: 'onemoney', channel: 'floor', taxClass: 'farm' }),
  LINE('104', 150000, { channel: 'floor', taxClass: 'titled' }),
  LINE('105', 7500, { channel: 'floor', taxClass: 'general', held: true })
];
const INV_PAYS = [
  { payId: 'P1', cents: 100000, method: 'cash' },
  { payId: 'P2', cents: 50000, method: 'check', ref: '2207', returned: true },
  { payId: 'P3', cents: 80000, method: 'card', ref: 'AUTH-1', refundedCents: 5000 },
  { payId: 'P4', cents: 20000, method: 'cash', voided: true }
];
const INV_FEES = [{ kind: 'card', cents: 1200 }, { kind: 'storage', cents: 500 }];
const INV_ADJ = [{ kind: 'writeoff', cents: -1000, reason: 'damaged on load-out' }, { kind: 'correction', cents: 250, reason: 'lot 102 count' }];
const INV_CTX = { saleDate: SALE_DATE, cert: { certId: 'X-9', expires: '2027-03-31' } };
const ZERO_PREMIUM_TERMS = Object.assign({}, TERMS, { premium: { floor: { brackets: [{ uptoCents: null, bp: 0 }] }, online: ONLINE } });

proof(9, 'A float, a negative, a value above $10,000,000.00, a typo, a guess: each is refused, never coerced',
  'a bad number silently turned into money: 100.5 cents, "100", NaN, a negative price, an amount over the ceiling, a misspelt cap that would be skipped, an unknown tax class guessed, an impossible date, a refund larger than its payment',
  (F) => {
    const S = (patch) => Object.assign({}, FLAT10, patch);
    const inv = (lines, pays, fees, adj, ctx, terms) => () => F.invoice(terms || TERMS, lines || INV_LINES, pays || INV_PAYS, fees || INV_FEES, adj || INV_ADJ, ctx || INV_CTX);
    const st = (contract, lines, risk) => () => F.statement(contract || STMT_CONTRACT, lines || STMT_LINES, STMT_EXP, STMT_ADV, risk || 'consignor');
    const baseline = [
      () => F.commission(FLAT10, [LINE('1', 10000)]), () => F.premium(FLOOR10, 10000), () => F.tax(TAX_LINES, TAXT, null, SALE_DATE),
      inv(), st(), () => F.roundBp(100, 1000)
    ];
    for (const b of baseline) b();   /* the unchanged calls are accepted, so each refusal below is about its one change */
    if (F.MAX_CENTS !== 1000 * 1000 * 1000) return 'the ceiling moved: ' + F.MAX_CENTS;
    if (F.commission(FLAT10, [LINE('1', 1000 * 1000 * 1000)]).cents !== 100 * 1000 * 1000) return 'exactly $10,000,000.00 was not accepted';
    const elevenMillion = [];
    for (let i = 0; i < 11; i++) elevenMillion.push(LINE(String(i), 100 * 1000 * 1000));
    const cases = [
      ['a float price',() => F.commission(FLAT10, [LINE('1', 100.5)]), 'unitCents'],
      ['a negative price', () => F.commission(FLAT10, [LINE('1', -1, { passed: true })]), 'unitCents'],
      ['a price one cent above $10M', () => F.commission(FLAT10, [LINE('1', 1000 * 1000 * 1000 + 1)]), 'unitCents'],
      ['NaN', () => F.commission(FLAT10, [LINE('1', NaN)]), 'unitCents'],
      ['Infinity', () => F.commission(FLAT10, [LINE('1', Infinity)]), 'unitCents'],
      ['a price written as text', () => F.commission(FLAT10, [LINE('1', '100')]), 'unitCents'],
      ['a sold line at 0 cents', () => F.commission(FLAT10, [LINE('1', 0)]), 'unitCents'],
      ['a times-the-money line past $10M', () => F.commission(FLAT10, [LINE('1', 500 * 1000 * 1000, { qty: 3 })]), 'lines[0]'],
      ['a consignor total past $10M', () => F.commission(S({ basis: 'consignor' }), elevenMillion), 'lines'],
      ['a fractional rate', () => F.commission(S({ brackets: [{ uptoCents: null, bp: 1000.5 }] }), [LINE('1', 100)]), 'bp'],
      ['a rate above 100%', () => F.commission(S({ brackets: [{ uptoCents: null, bp: 10001 }] }), [LINE('1', 100)]), 'bp'],
      ['a negative rate', () => F.commission(S({ brackets: [{ uptoCents: null, bp: -1 }] }), [LINE('1', 100)]), 'bp'],
      ['a misspelt cap ("capcents")', () => F.commission(S({ capcents: 5000 }), [LINE('1', 100)]), 'capcents'],
      ['a minimum above the cap', () => F.commission(S({ minCents: 5000, capCents: 1000 }), [LINE('1', 100)]), 'minCents'],
      ['a flat schedule with two brackets', () => F.commission(S({ brackets: B_30_20 }), [LINE('1', 100)]), 'brackets'],
      ['brackets that do not rise', () => F.commission(S({ kind: 'sliding', brackets: [{ uptoCents: 10000, bp: 1 }, { uptoCents: 10000, bp: 1 }, { uptoCents: null, bp: 1 }] }), [LINE('1', 100)]), 'uptoCents'],
      ['a last bracket with a bound', () => F.commission(S({ brackets: [{ uptoCents: 10000, bp: 1000 }] }), [LINE('1', 100)]), 'uptoCents'],
      ['an open bracket before the last', () => F.commission(S({ kind: 'sliding', brackets: [{ uptoCents: null, bp: 1 }, { uptoCents: null, bp: 1 }] }), [LINE('1', 100)]), 'uptoCents'],
      ['a choice taking with qty 2', () => F.commission(FLAT10, [LINE('5', 2000, { mode: 'choice', qty: 2, line: 'A' })]), 'qty'],
      ['the same lot line twice', () => F.commission(FLAT10, [LINE('1', 100), LINE('1', 200)]), 'lines[1]'],
      ['a line with no mode', () => F.commission(FLAT10, [{ lotNo: '1', unitCents: 100, qty: 1 }]), 'mode'],
      ['"yes" for passed', () => F.commission(FLAT10, [LINE('1', 100, { passed: 'yes' })]), 'passed'],
      ['a lot number given as a number', () => F.commission(FLAT10, [LINE(7, 100)]), 'lotNo'],
      ['an unknown line field ("pased")', () => F.commission(FLAT10, [LINE('1', 100, { pased: true })]), 'pased'],
      ['a buyback fee with both bp and cents', () => F.commission(S({ buybackFee: { bp: 1, cents: 1 } }), [LINE('1', 100)]), 'buybackFee'],
      ['a premium on a fractional line', () => F.premium(FLOOR10, 10.5), 'lineCents'],
      ['roundBp on a fraction', () => F.roundBp(1.5, 100), 'cents'],
      ['roundBp on a negative', () => F.roundBp(-1, 100), 'cents'],
      ['roundBp above the ceiling', () => F.roundBp(1000 * 1000 * 1000 + 1, 100), 'cents'],
      ['roundBp at a rate above 100%', () => F.roundBp(100, 10001), 'bp'],
      ['a tax class with no rule', () => F.tax([{ lotNo: '1', taxClass: 'other', lineCents: 100 }], TAXT, null, SALE_DATE), 'taxClass'],
      ['a date not on the calendar', () => F.tax(TAX_LINES, TAXT, null, '2026-02-30'), 'saleDate'],
      ['a date in another format', () => F.tax(TAX_LINES, TAXT, null, '11/14/2026'), 'saleDate'],
      ['premiumTaxed missing', () => F.tax(TAX_LINES, { rateMilliPct: 9875, classes: TAXT.classes }, null, SALE_DATE), 'premiumTaxed'],
      ['a tax rate above 100%', () => F.tax(TAX_LINES, Object.assign({}, TAXT, { rateMilliPct: 100001 }), null, SALE_DATE), 'rateMilliPct'],
      ['a certificate expiry that is not a date', () => F.tax(TAX_LINES, TAXT, { expires: '2027-13-01' }, SALE_DATE), 'cert.expires'],
      ['a write-off that adds money', inv(null, null, null, [{ kind: 'writeoff', cents: 1000 }]), 'adjustments[0]'],
      ['a refund larger than its payment', inv(null, [{ payId: 'P1', cents: 1000, method: 'cash', refundedCents: 1001 }]), 'refundedCents'],
      ['a refund on a returned check', inv(null, [{ payId: 'P1', cents: 1000, method: 'check', returned: true, refundedCents: 1 }]), 'refundedCents'],
      ['a passed line on an invoice', inv([LINE('1', 0, { passed: true, channel: 'floor', taxClass: 'general' })]), 'lines[0]'],
      ['a write-off bigger than the invoice', inv([LINE('1', 1000, { channel: 'floor', taxClass: 'titled' })], [], [], [{ kind: 'writeoff', cents: -2000 }]), 'adjustments'],
      ['the same payment twice', inv(null, [INV_PAYS[0], INV_PAYS[0]]), 'payId'],
      ['an invoice with no sale date', inv(null, null, null, null, { cert: null }), 'saleDate'],
      ['an invoice line with no channel', inv([LINE('1', 1000, { taxClass: 'general' })]), 'channel'],
      ['contract charges (no rule defined yet)', st(Object.assign({}, STMT_CONTRACT, { charges: [{ kind: 'advertising', cents: 100, rule: 'x' }] })), 'charges'],
      ['an unpaid risk different from the contract\'s', st(Object.assign({}, STMT_CONTRACT, { unpaidRisk: 'house' }), null, 'consignor'), 'unpaidRisk'],
      ['a sold line with no hammer id', st(null, [LINE('A1', 100, { buyerBalanceCents: 0, buyerForgivenCents: 0 })]), 'hammerId'],
      ['the same hammer twice', st(null, [LINE('A1', 100, { hammerId: 'h1', buyerBalanceCents: 0, buyerForgivenCents: 0 }), LINE('A2', 100, { hammerId: 'h1', buyerBalanceCents: 0, buyerForgivenCents: 0 })]), 'hammerId'],
      ['a fractional buyer balance', st(null, [LINE('A1', 100, { hammerId: 'h1', buyerBalanceCents: 0.5, buyerForgivenCents: 0 })]), 'buyerBalanceCents'],
      ['a statement line that does not say what was forgiven', st(null, [LINE('A1', 100, { hammerId: 'h1', buyerBalanceCents: 0 })]), 'buyerForgivenCents'],
      ['a fractional forgiven amount', st(null, [LINE('A1', 100, { hammerId: 'h1', buyerBalanceCents: 0, buyerForgivenCents: 0.5 })]), 'buyerForgivenCents'],
      ['a refund on a voided payment', inv(null, [{ payId: 'P1', cents: 1000, method: 'cash', voided: true, refundedCents: 1 }]), 'refundedCents'],
      ['a commission cap of $0.00', () => F.commission(S({ capCents: 0 }), [LINE('1', 100)]), 'capCents'],
      ['a premium cap of $0.00', () => F.premium({ brackets: [{ uptoCents: null, bp: 1000 }], capCents: 0 }, 100), 'capCents'],
      ['a titled no-sale fee of $0.00', () => F.commission(S({ noSaleFeeCents: 1000, titledNoSaleFeeCents: 0 }), [LINE('1', 100)]), 'titledNoSaleFeeCents'],
      ['a premium on a 0-cent line', () => F.premium(FLOOR10, 0), 'lineCents'],
      ['a tax line of 0 cents', () => F.tax([{ lotNo: '1', taxClass: 'general', lineCents: 0 }], TAXT, null, SALE_DATE), 'lineCents'],
      ['an invoice total past $10M', inv([LINE('1', 1000 * 1000 * 1000, { channel: 'floor', taxClass: 'titled' })], [], [], [{ kind: 'correction', cents: 1 }], null, ZERO_PREMIUM_TERMS), 'adjustments']
    ];
    const broken = [];
    for (const [label, fn, pathHas] of cases) {
      const r = refusal(label, fn, pathHas);
      if (r !== true) broken.push(r);
    }
    return broken.length ? broken.length + ' of ' + cases.length + ' cases broke: ' + broken.join('; ') : true;
  },
  [
    { why: 'fractions let through', find: "typeof v !== 'number' || !Number.isInteger(v)", repl: "typeof v !== 'number'" },
    { why: 'negatives let through', find: 'if (v < lo) refuse(', repl: 'if (false) refuse(' },
    { why: 'the ceiling dropped', find: 'if (v > hi) refuse(', repl: 'if (false) refuse(' },
    { why: 'unknown fields (typos) let through', find: 'if (allowed.indexOf(k) < 0) refuse(', repl: 'if (false) refuse(' },
    { why: 'totals let past the ceiling', find: 'if (t > MAX_CENTS) refuse(path,', repl: 'if (false) refuse(path,' },
    { why: 'a times-the-money line let past the ceiling', find: 'if (lineCents > MAX_CENTS) refuse(', repl: 'if (false) refuse(' },
    { why: 'a choice taking with qty above 1 let through', find: "if (mode === 'choice' && qty !== 1) refuse(", repl: 'if (false) refuse(' },
    { why: 'a duplicate lot line let through', find: 'if (seen[key]) refuse(', repl: 'if (false) refuse(' },
    { why: 'a refund above its payment let through', find: 'if (refunded > cents) refuse(', repl: 'if (false) refuse(' },
    { why: 'a refund on a voided payment let through (only a returned one refused)', find: 'if (refunded > 0 && (voided || returned)) refuse(', repl: 'if (refunded > 0 && returned) refuse(' },
    { why: 'a cap of $0.00 accepted (it zeroes every charge)', find: "if (c === 0) refuse(path, 'a cap of $0.00", repl: "if (false) refuse(path, 'a cap of $0.00" },
    { why: 'a titled no-sale fee of $0.00 accepted (not set, or free?)', find: "if (c === 0) refuse(path, 'is $0.00, which could mean", repl: "if (false) refuse(path, 'is $0.00, which could mean" },
    { why: 'a premium priced on a 0-cent line', find: "centsIn(lineCents, 'lineCents', 1), false)", repl: "centsIn(lineCents, 'lineCents'), false)" },
    { why: 'a 0-cent tax line accepted', find: "lineCents: centsIn(raw.lineCents, p + '.lineCents', 1)", repl: "lineCents: centsIn(raw.lineCents, p + '.lineCents')" },
    { why: 'an invoice total let past the ceiling', find: "if (totalCents > MAX_CENTS) refuse('adjustments',", repl: "if (false) refuse('adjustments'," },
    { why: 'a statement line read without its forgiven amount', find: 'if (l.raw.buyerForgivenCents === undefined && !forgivenPaid) {', repl: 'if (false) {' },
    { why: 'an unlisted tax class guessed', find: 'if (rule === undefined) refuse(', repl: 'if (false) refuse(' },
    { why: 'a write-off that adds money let through', find: "if (kind !== 'correction' && cents > 0) refuse(", repl: 'if (false) refuse(' },
    { why: 'impossible dates let through', find: 'if (m < 1 || m > 12 || d < 1 || d > days[m - 1]) refuse(', repl: 'if (false) refuse(' },
    { why: 'contract charges applied by guess', find: "if (contract.charges !== undefined && contract.charges !== null && listOf(contract.charges, 'contract.charges').length > 0) {", repl: 'if (false) {' }
  ]);

/* P10 — an invoice end to end, to the cent. Terms: floor premium 10%; online incremental 15% to $1,000 / 10% above
   (min $5, cap $500); tax 9.875%, premium taxed; general taxable, farm exempt with a certificate, titled exempt;
   premium rounded per line. The buyer has a farm certificate valid until 2027-03-31; the sale is 2026-11-14.
     lot 101 floor general $250.00            premium $25.00   taxed
     lot 102 online general 2 x $40.00 = $80.00   premium 15% = $12.00   taxed
     lot 103 floor farm, one money $600.00    premium $60.00   exempt (certificate counts)
     lot 104 floor titled $1,500.00           premium $150.00  exempt
     lot 105 floor general $75.00 DISPUTED: listed, never due
   hammer $250 + $80 + $600 + $1,500 = $2,430.00;  premium $25 + $12 + $60 + $150 = $247.00
   tax base $250 + $80 + $25 + $12 = $367.00; x 9.875% = $36.24125 -> $36.24
   fees: card $12.00 + storage $5.00 = $17.00;  adjustments: write-off -$10.00, correction +$2.50 = -$7.50
   total $2,430.00 + $247.00 + $36.24 + $17.00 - $7.50 = $2,722.74
   payments: cash $1,000.00; check $500.00 RETURNED = 0; card $800.00 less a $50.00 refund = $750.00; cash $200.00 VOIDED = 0
   paid $1,750.00;  balance $2,722.74 - $1,750.00 = $972.74 */
proof(10, 'Invoice balance = lines + premium + tax + fees - payments +/- adjustments, to the cent',
  'a disputed lot billed, a voided or bounced payment counted as money in, a refund not taken off, or an adjustment applied with the wrong sign',
  (F) => {
    const r = F.invoice(TERMS, INV_LINES, INV_PAYS, INV_FEES, INV_ADJ, INV_CTX);
    return expectAll([
      ['hammer', r.hammerCents, 243000], ['premium', r.premiumCents, 24700], ['tax', r.taxCents, 3624],
      ['fees', r.feesCents, 1700], ['adjustments', r.adjustmentsCents, -750], ['total', r.totalCents, 272274],
      ['paid', r.paidCents, 175000], ['balance', r.balanceCents, 97274],
      ['the identity', r.balanceCents, r.hammerCents + r.premiumCents + r.taxCents + r.feesCents + r.adjustmentsCents - r.paidCents],
      ['held lines', r.held.map((h) => h.lotNo), ['105']],
      ['net payments', r.payments.map((p) => p.netCents), [100000, 0, 75000, 0]],
      ['text ends on the balance', /balance \$972\.74 due\.$/.test(r.mathText), true]
    ]);
  },
  [
    { why: 'disputed lines billed', find: 'const due = ls.filter((l) => !l.held);', repl: 'const due = ls.filter((l) => true);' },
    { why: 'voided and returned payments counted', find: 'const netCents = voided || returned ? 0 : cents - refunded;', repl: 'const netCents = cents - refunded;' },
    { why: 'refunds not taken off', find: 'const netCents = voided || returned ? 0 : cents - refunded;', repl: 'const netCents = voided || returned ? 0 : cents;' },
    { why: 'adjustments applied with the wrong sign', find: 'const totalCents = charges + adjCents;', repl: 'const totalCents = charges - adjCents;' }
  ]);

/* P11 — a statement end to end, and identity 5: gross = net + commission + fees + expenses + advances + holdback.
   Schedule: sliding on the consignor's total, 25% up to $1,000.00, 15% above, minimum $25.00; lot fee $3.00 (sold
   lots); no-sale $10.00; titled no-sale $25.00; buyback 5%.
     A1 $400.00, buyer's invoice at $0.00 -> paid
     A2 3 x $150.00 = $450.00, buyer overpaid ($-3.00) -> paid
     A3 $900.00, buyer still owes $5.00 on the sale -> UNPAID
     A4 $250.00 DISPUTED
     A5 passed;  A6 bought back at $200.00
   gross $400 + $450 + $900 + $250 = $2,000.00
   commission: $2,000.00 is above $1,000.00, so all of it at 15% = $300.00
   fees: lot fee x 4 sold lots = $12.00; no-sale A5 $10.00; buyback A6 $200.00 x 5% = $10.00 -> $32.00
   expenses $40.00 + $85.00 = $125.00;  advances $100.00
   consignor risk: held back A3 $900.00 + A4 $250.00 = $1,150.00
     net = $2,000 - $300 - $32 - $125 - $100 - $1,150 = $293.00
   house risk: held back only the disputed A4 $250.00
     net = $2,000 - $300 - $32 - $125 - $100 - $250 = $1,193.00 */
proof(11, 'Statement: net + commission + fees + expenses + advances + holdback = gross (identity 5), under both unpaid risks',
  'a consignor paid for money not yet collected, an advance paid twice (not deducted), commission or fees left out, or a disputed lot paid out',
  (F) => {
    const c = F.statement(STMT_CONTRACT, STMT_LINES, STMT_EXP, STMT_ADV, 'consignor');
    const h = F.statement(STMT_CONTRACT, STMT_LINES, STMT_EXP, STMT_ADV, 'house');
    const ident = (r) => r.netCents + r.commission.cents + r.feesCents + r.expensesCents + r.advancesCents + r.holdbackCents;
    return expectAll([
      ['gross', c.grossCents, 200000], ['commission', c.commission.cents, 30000], ['fees', c.feesCents, 3200],
      ['expenses', c.expensesCents, 12500], ['advances', c.advancesCents, 10000],
      ['consignor holdback', c.holdbackCents, 115000], ['consignor net', c.netCents, 29300], ['identity 5 (consignor)', ident(c), c.grossCents],
      ['house holdback', h.holdbackCents, 25000], ['house net', h.netCents, 119300], ['identity 5 (house)', ident(h), h.grossCents],
      ['statuses (consignor)', c.lines.map((l) => l.status), ['paid', 'paid', 'unpaidHeld', 'disputed', 'passed', 'buyback']],
      ['statuses (house)', h.lines.map((l) => l.status), ['paid', 'paid', 'unpaidHouse', 'disputed', 'passed', 'buyback']],
      ['each line names its hammer', c.lines.slice(0, 4).map((l) => l.hammerId), ['h1', 'h2', 'h3', 'h4']],
      ['text shows the subtraction', /\$2,000\.00 gross - \$300\.00 commission - \$32\.00 fees - \$125\.00 expenses - \$100\.00 advances - \$1,150\.00 held back = \$293\.00/.test(c.mathText), true]
    ]);
  },
  [
    { why: 'advances not deducted', find: 'const net = gross - com.cents - com.feesCents - expensesCents - advancesCents - holdback;', repl: 'const net = gross - com.cents - com.feesCents - expensesCents - holdback;' },
    { why: 'commission not deducted', find: 'const net = gross - com.cents - com.feesCents', repl: 'const net = gross - com.feesCents' },
    { why: 'a disputed lot paid out', find: "if (l.held) { status = 'disputed'; heldCents = l.lineCents; }", repl: "if (false) { status = 'disputed'; heldCents = l.lineCents; }" },
    { why: 'the two unpaid risks swapped', find: "else if (risk === 'consignor') {", repl: "else if (risk === 'house') {" }
  ]);

/* P12 — the conservative paid rule: a line counts as buyer-paid only when that buyer's WHOLE invoice for the sale is
   at 0 or less. Flat 10% per line, three $100.00 lines, consignor risk:
     X: the buyer's invoice is at exactly $0.00 -> paid.
     Y: the buyer bought $1,000.00 in all and has paid $999.99. That is far more than Y's $100.00, but the invoice is
        not at zero, so Y is held back. Paying a consignor from a part-paid invoice is the mistake this rule stops.
     Z: the buyer overpaid by $25.00 -> paid.
   gross $300.00, commission $30.00, held back $100.00, net $170.00. Under house risk Y is paid: net $270.00. */
proof(12, 'The conservative paid rule: buyer-paid only when the buyer\'s whole invoice is at $0.00 or less',
  'a consignor paid out of a buyer\'s part-paid invoice (per-line allocation by guess), or a buyer at exactly $0.00 treated as unpaid',
  (F) => {
    const ls = [LINE('X', 10000, { hammerId: 'hx', buyerBalanceCents: 0, buyerForgivenCents: 0 }), LINE('Y', 10000, { hammerId: 'hy', buyerBalanceCents: 1, buyerForgivenCents: 0 }),
      LINE('Z', 10000, { hammerId: 'hz', buyerBalanceCents: -2500, buyerForgivenCents: 0 })];
    const c = F.statement({ schedule: FLAT10 }, ls, [], [], 'consignor');
    const h = F.statement({ schedule: FLAT10 }, ls, [], [], 'house');
    return expectAll([
      ['buyer-paid flags', c.lines.map((l) => l.buyerPaid), [true, false, true]],
      ['consignor risk statuses', c.lines.map((l) => l.status), ['paid', 'unpaidHeld', 'paid']],
      ['consignor risk holdback and net', [c.holdbackCents, c.netCents], [10000, 17000]],
      ['house risk statuses', h.lines.map((l) => l.status), ['paid', 'unpaidHouse', 'paid']],
      ['house risk holdback and net', [h.holdbackCents, h.netCents], [0, 27000]]
    ]);
  },
  [
    { why: 'a buyer at exactly $0.00 treated as unpaid', find: 'const paid = owed <= 0;', repl: 'const paid = owed < 0;' },
    { why: 'per-line allocation: paid once what is owed is less than the line', find: 'const paid = owed <= 0;', repl: 'const paid = owed <= l.lineCents;' },
    { why: 'unpaid lines never held back', find: "else if (risk === 'consignor') {", repl: 'else if (false) {' }
  ]);

/* P13 — every result is stamped MATH_VERSION 1 and carries its arithmetic as text a person can check. */
proof(13, 'Every result carries mathVersion 1 and a mathText that shows the arithmetic',
  'a draft stamped with the wrong math version (the hub could not recompute it), or a number shown with no working',
  (F) => {
    const results = {
      commission: F.commission({ kind: 'sliding', basis: 'line', brackets: B_30_20 }, [LINE('7', 11000)]),
      premium: F.premium(ONLINE, 2000),
      tax: F.tax(TAX_LINES, TAXT, null, SALE_DATE),
      invoice: F.invoice(TERMS, INV_LINES, INV_PAYS, INV_FEES, INV_ADJ, INV_CTX),
      statement: F.statement(STMT_CONTRACT, STMT_LINES, STMT_EXP, STMT_ADV, 'consignor')
    };
    const shows = { commission: '$110.00 x 20.00%', premium: '$20.00 x 15.00% = $3.00, raised to the $5.00 minimum', tax: 'Tax: $32.59', invoice: 'balance $972.74', statement: '$2,000.00 gross' };
    const rows = [['MATH_VERSION', F.MATH_VERSION, 1]];
    Object.keys(results).forEach((k) => {
      rows.push([k + ' mathVersion', results[k].mathVersion, 1]);
      rows.push([k + ' mathText shows "' + shows[k] + '"', typeof results[k].mathText === 'string' && results[k].mathText.indexOf(shows[k]) >= 0, true]);
    });
    return expectAll(rows);
  },
  [
    { why: 'the math version changed', find: 'const MATH_VERSION = 1;', repl: 'const MATH_VERSION = 2;' },
    { why: 'the text gives the answer without the working', find: "s += ' = ' + fmtExact(bc.exact, BP_ONE);", repl: "s = '= ' + fmtExact(bc.exact, BP_ONE);" },
    { why: 'dollars printed without thousands separators', find: ".replace(/\\B(?=(\\d{3})+(?!\\d))/g, ',')", repl: '' }
  ]);

/* P14 — inputs are never changed and the same input always gives the same output. Every input here is frozen all
   the way down, so any write to it throws. */
proof(14, 'Inputs are never changed; the same input gives the same output',
  'a schedule or line quietly rewritten by the math (the next statement then starts from changed facts), or a result that differs run to run',
  (F) => {
    const frozen = deepFreeze(clone({ s: FEE_SCHED, l: FEE_LINES, t: TERMS, il: INV_LINES, ip: INV_PAYS, f: INV_FEES, a: INV_ADJ, c: INV_CTX,
      sc: STMT_CONTRACT, sl: STMT_LINES, se: STMT_EXP, sa: STMT_ADV, tl: TAX_LINES, tt: TAXT }));
    const before = JSON.stringify(frozen);
    const once = () => JSON.stringify([
      F.commission(frozen.s, frozen.l), F.premium(frozen.t.premium.online, 200000), F.tax(frozen.tl, frozen.tt, null, SALE_DATE),
      F.invoice(frozen.t, frozen.il, frozen.ip, frozen.f, frozen.a, frozen.c), F.statement(frozen.sc, frozen.sl, frozen.se, frozen.sa, 'consignor')
    ]);
    const a = once(), b = once();
    return expectAll([['same output twice', a === b, true], ['inputs unchanged', JSON.stringify(frozen) === before, true]]);
  },
  [
    { why: 'a line written back into its input', find: "const key = lotNo + '\\u0000' + line;", repl: "raw.lotNo = lotNo; const key = lotNo + '\\u0000' + line;" },
    { why: 'a result that changes run to run', find: 'cents: cents, perUnit: perUnit,', repl: 'cents: cents, perUnit: perUnit, at: Math.random(),' }
  ]);

/* P15 — the module shape the spec asks for: zero dependencies, CommonJS for Node and the facts bundler, and a
   browser global for a plain <script> tag, without leaking a global anywhere else. */
sourceProof(15, 'Zero-dependency CommonJS that also sets the browser global AuctionFeeMath (and no global elsewhere)',
  'a require() that breaks the bundler and the browser, a page that cannot find the library, or a library that leaks globals into Node',
  (text) => {
    if (/\brequire\s*\(/.test(text)) return 'the source calls require()';
    const cjs = { module: { exports: {} } };
    vm.runInNewContext(text, cjs);
    const api = cjs.module.exports;
    const names = ['roundBp', 'roundMilliPct', 'commission', 'premium', 'tax', 'invoice', 'statement'];
    for (const n of names) if (typeof api[n] !== 'function') return 'CommonJS export lacks ' + n;
    if (api.MATH_VERSION !== 1) return 'CommonJS export lacks MATH_VERSION 1';
    if (cjs.AuctionFeeMath !== undefined) return 'a global leaked in a CommonJS context';
    const browser = { window: {} };
    vm.runInNewContext(text, browser);
    const g = browser.window.AuctionFeeMath;
    if (!g || typeof g.commission !== 'function') return 'no window.AuctionFeeMath in a browser context';
    if (g.commission({ kind: 'sliding', basis: 'line', brackets: B_30_20 }, [LINE('7', 11000)]).cents !== 2200) return 'the browser copy computes differently';
    const bare = {};
    vm.runInNewContext(text, bare);
    if (Object.keys(bare).length !== 0) return 'a context with neither module nor window gained globals: ' + Object.keys(bare).join(', ');
    return true;
  },
  SRC,
  [
    { why: 'a require() planted', input: SRC + "\nrequire('fs');\n" },
    { why: 'the browser global removed', input: SRC.replace('window.AuctionFeeMath = api;', 'void api;') },
    { why: 'a global set instead of module.exports', input: SRC.replace('if (typeof module === \'object\' && module !== null && module.exports) { module.exports = api; }', 'globalThis.AuctionFeeMath = api;') }
  ]);

/* P16 — every function is labelled: one /* @tag — purpose *\/ line directly above it, tags from the shared closed
   vocabulary (the same word list the origin project's code index uses). */
const VOCAB = ('money card ar collections drawer credit refund price tax payroll intake quick detail assemble rack pickup quote garment order ' +
  'bag split press route driver wizard stop delivery sync hub merge delta mirror storage clock sms email print portal receipt employee ' +
  'permission timeclock owner log trail audit error invariant archive docs customer account store inventory supplies checklist feedback ' +
  'report settings admin screen nav render input scan keyboard startup station shell install deploy watchdog chrome identity dpapi ' +
  'autostart backup agent fact fold shadow port proof switch').split(' ');
/* @proof — finds every named function and checks the line above it is a one-line label from the closed vocabulary. */
function labelCheck(text) {
  const lines = text.split(/\r?\n/);
  const header = lines.slice(0, 12).find((l) => /^\s*\*\s+@[a-z]/.test(l));
  if (!header) return 'the file header has no tag line';
  for (const t of header.match(/@([a-z]+)/g)) if (VOCAB.indexOf(t.slice(1)) < 0) return 'the header uses a tag outside the vocabulary: ' + t;
  let count = 0;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\s*function\s+([A-Za-z_$][\w$]*)\s*\(/);
    if (!m) continue;
    count++;
    const above = (lines[i - 1] || '').trim();
    const lab = above.match(/^\/\*\s+((?:@[a-z]+\s+)+)—\s+\S.*\*\/$/);
    if (!lab) return 'function ' + m[1] + ' has no one-line /* @tag — purpose */ label directly above it';
    for (const t of lab[1].trim().split(/\s+/)) if (VOCAB.indexOf(t.slice(1)) < 0) return 'function ' + m[1] + ' uses a tag outside the vocabulary: ' + t;
  }
  if (count < 30) return 'only ' + count + ' functions found; the check would be vacuous';
  return true;
}
sourceProof(16, 'Every function carries a one-line /* @tag — purpose */ label from the closed vocabulary',
  'an unlabelled function nobody can find by search, or a made-up tag (@cards next to @card) that splits a search',
  labelCheck, SRC,
  [
    { why: 'an unlabelled function planted', input: SRC + '\nfunction sneaky() { return 1; }\n' },
    { why: 'a tag outside the vocabulary', input: SRC.replace('/* @money @error — a short, safe picture', '/* @cards @error — a short, safe picture') },
    { why: 'a label no longer directly above its function', input: SRC.replace('  function refuse(path, message)', '  const spacer = 0;\n  function refuse(path, message)') }
  ]);

/* P17 — the unit's files carry no personal data. This repository is public: a phone number, an e-mail address or a
   server address must never land in it. Words that would point at a real customer or business live only in
   tests/private-words.local.txt (git-ignored, never committed); the guard reads that file when it is there. Plants are
   built at run time, so this file never contains what it hunts for. */
const LOCAL_WORDS_FILE = path.join(__dirname, 'private-words.local.txt');
const LOCAL_WORDS = fs.existsSync(LOCAL_WORDS_FILE)
  ? fs.readFileSync(LOCAL_WORDS_FILE, 'utf8').split(/\r?\n/).map((w) => w.trim().toLowerCase()).filter((w) => w && !w.startsWith('#'))
  : [];
const PLANTED_WORD = 'planted-' + 'private-word';
/* @proof — scans each file for phone-, e-mail- and address-shaped text and for any word on the private lists. */
function piiCheck(files) {
  for (const f of files) {
    const text = f.text, low = text.toLowerCase();
    const phone = text.match(/(?:\+?1[\s.-]?)?\(?\b\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/);
    if (phone) return f.name + ' holds a phone-shaped number';
    const mail = (text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || []).filter((m) => !/@example\.com$/i.test(m));
    if (mail.length) return f.name + ' holds an e-mail address';
    if (/\b\d{1,3}(?:[.-]\d{1,3}){3}\b/.test(text)) return f.name + ' holds an address-shaped number';
    if (low.indexOf(PLANTED_WORD) >= 0) return f.name + ' holds the planted private word';
    for (let i = 0; i < LOCAL_WORDS.length; i++) if (low.indexOf(LOCAL_WORDS[i]) >= 0) return f.name + ' holds a word from the local private list (line ' + (i + 1) + ')';
  }
  return true;
}
const UNIT_FILES = [
  { name: 'packs/auction/feemath.js', text: SRC },
  { name: 'packs/auction/README.md', text: fs.existsSync(README) ? fs.readFileSync(README, 'utf8') : '' },
  { name: 'tests/auction-feemath.js', text: fs.readFileSync(__filename, 'utf8') }
];
const plantInto = (extra) => UNIT_FILES.map((f, i) => (i === 0 ? { name: f.name, text: f.text + extra } : f));
sourceProof(17, 'The unit\'s files hold no phone, e-mail or server address, and no word from the private lists',
  'a customer\'s or the origin shop\'s details published in a public repository',
  (files) => {
    if (!files[1].text) return 'packs/auction/README.md is missing';
    return piiCheck(files);
  },
  UNIT_FILES,
  [
    { why: 'a phone number planted', input: plantInto('\n/* call (5' + '55) 01' + '0-0199 */\n') },
    { why: 'an e-mail address planted', input: plantInto('\n/* someone' + '@' + 'example.org */\n') },
    { why: 'a server address planted', input: plantInto('\n/* 10.' + '0.0.' + '7 */\n') },
    { why: 'a private word planted', input: plantInto('\n/* ' + PLANTED_WORD + ' */\n') }
  ].concat(LOCAL_WORDS.length ? [{ why: 'the first word of the local private list planted', input: plantInto('\n/* ' + LOCAL_WORDS[0] + ' */\n') }] : []));

/* ======================================================================== */
/* P18-P24 came from a second look: an independent reference build, a differential fuzz against it and a code review.
   Each closes a rule the first seventeen proofs did not pin, and each control is a break that once left the whole
   suite green. */

/* P18 — an invoice that rounds its premium once, over premiums that hit a per-line minimum and cap, with the premium
   taxed. Terms: floor 10%; online incremental 15% up to $1,000.00, 10% above, minimum $5.00, cap $500.00 per line; tax
   9.875%, premium taxed; general taxable, farm exempt only with a certificate (none here), titled exempt.
     lot 101 online general $20.00:      15% = $3.00, raised to the $5.00 minimum                -> $5.00
     lot 102 online general $10,000.00:  $150.00 + $900.00 = $1,050.00, held to the $500.00 cap  -> $500.00
     lot 103 floor general $1.05:        $0.105
     lot 104 floor general $1.05:        $0.105
     lot 105 floor titled $2.05:         $0.205 (exempt)
     lot 106 online farm $1.03:          $0.1545, raised to the $5.00 minimum (taxed: no certificate) -> $5.00
   hammer $20.00 + $10,000.00 + $1.05 + $1.05 + $2.05 + $1.03 = $10,025.18
   PER INVOICE: premium $5 + $500 + $0.105 + $0.105 + $0.205 + $5 = $510.415, rounded once -> $510.42
     taxed premium (every lot but 105): $5 + $500 + $0.105 + $0.105 + $5 = $510.21 exactly
     taxed hammer $10,023.13; base $10,533.34; x 9.875% = $1,040.167325 -> $1,040.17; total $11,575.77
   PER LINE: premiums $5.00, $500.00, $0.11, $0.11, $0.21, $5.00 = $510.43; taxed premium $510.22 (the rounded line
     premiums); base $10,533.35; x 9.875% = $1,040.168313 -> $1,040.17; total $11,575.78 */
const CAPPED_LINES = [
  LINE('101', 2000, { channel: 'online', taxClass: 'general' }), LINE('102', 1000000, { channel: 'online', taxClass: 'general' }),
  LINE('103', 105, { channel: 'floor', taxClass: 'general' }), LINE('104', 105, { channel: 'floor', taxClass: 'general' }),
  LINE('105', 205, { channel: 'floor', taxClass: 'titled' }), LINE('106', 103, { channel: 'online', taxClass: 'farm' })
];
proof(18, 'Premium rounded once per invoice over capped and minimum line premiums, and the taxed premium with it',
  'a buyer charged an uncapped premium when the invoice rounds once, a taxed premium that skips the cap or minimum, a taxed premium rounded twice, or a tax base built on unrounded line premiums',
  (F) => {
    const inv = (r) => F.invoice(Object.assign({}, TERMS, { rounding: { premium: r, tax: 'invoice' } }), CAPPED_LINES, [], [], [], { saleDate: SALE_DATE, cert: null });
    const once = inv('invoice'), lines = inv('line');
    return expectAll([
      ['hammer', once.hammerCents, 1002518],
      ['line premiums kept exact (cents x 10000)', once.lines.map((l) => l.premiumExact), [5000000, 500000000, 105000, 105000, 205000, 5000000]],
      ['premium rounded once', once.premiumCents, 51042],
      ['taxed premium, once, after the cap and minimum', once.tax.premiumBaseCents, 51021],
      ['tax base and tax', [once.tax.baseCents, once.taxCents], [1053334, 104017]],
      ['total', once.totalCents, 1157577],
      ['per line: premium', lines.premiumCents, 51043],
      ['per line: taxed premium is the rounded line premiums', lines.tax.premiumBaseCents, 51022],
      ['per line: tax base, tax and total', [lines.tax.baseCents, lines.taxCents, lines.totalCents], [1053335, 104017, 1157578]]
    ]);
  },
  [
    { why: 'the once-rounded premium adds the line premiums before their cap and minimum', find: 'premExactSum += pr.exact;', repl: 'premExactSum += pr.rawExact;' },
    { why: 'the taxed premium skips the cap and minimum', find: 'premiumExact: pr.exact, premiumText', repl: 'premiumExact: pr.rawExact, premiumText' },
    { why: 'the taxed premium rounded line by line, then again', find: 'premExact: perLine ? o.premiumCents * BP_ONE : o.premiumExact })', repl: 'premExact: perLine ? o.premiumCents * BP_ONE : roundNum(o.premiumExact) * BP_ONE })' },
    { why: 'per-line rounding taxes the unrounded premium', find: 'premExact: perLine ? o.premiumCents * BP_ONE : o.premiumExact })', repl: 'premExact: o.premiumExact })' }
  ]);

/* P19 — schedule fee edges. Flat 10% per line; no-sale fee $10.00; titled no-sale fee $25.00; buyback fee 5%.
     lot 4 bought back at $3.10: 5% = 15.5 cents -> 16 cents (half up; truncating would say 15)
     lot 5 offered as two choice takings, 5A and 5B, both passed: ONE no-sale fee, $10.00 (per lot, not per taking)
     lot 6: 6A passed and titled, 6B passed: ONE titled no-sale fee, $25.00
     fees $0.16 + $10.00 + $25.00 = $35.16; commission $0.00 (nothing sold)
     a 5% buyback fee on a buyback with no price: refused (a rate on an unknown amount is a guess)
     a flat $20.00 buyback fee on a buyback with no price: charged, $20.00 */
const EDGE_SCHED = { kind: 'flat', basis: 'line', brackets: [{ uptoCents: null, bp: 1000 }], noSaleFeeCents: 1000, titledNoSaleFeeCents: 2500, buybackFee: { bp: 500 } };
const EDGE_LINES = [
  LINE('4', 310, { passed: true, buyback: true }),
  LINE('5', 0, { mode: 'choice', line: 'A', passed: true }), LINE('5', 0, { mode: 'choice', line: 'B', passed: true }),
  LINE('6', 0, { mode: 'choice', line: 'A', passed: true, titled: true }), LINE('6', 0, { mode: 'choice', line: 'B', passed: true })
];
proof(19, 'Fee edges: a buyback fee rounded half up, one no-sale fee per lot when every taking passes, no rate on a buyback with no price',
  'a half-cent buyback fee truncated, a no-sale fee charged once per passed taking, or a percentage fee charged as $0.00 on a buyback whose price is unknown',
  (F) => {
    const r = F.commission(EDGE_SCHED, EDGE_LINES);
    const noPrice = [LINE('7', 0, { passed: true, buyback: true })];
    return expectAll([
      ['fee rows', r.fees.map((f) => f.kind + ':' + f.lotNo + ':' + f.cents).sort(), ['buyback:4:16', 'noSale:5:1000', 'titledNoSale:6:2500']],
      ['fees and commission', [r.feesCents, r.cents], [3516, 0]],
      ['buyback text shows the half cent', /\$3\.10 x 5\.00% = \$0\.155, rounded half up to \$0\.16/.test(r.mathText), true],
      ['a rate on a buyback with no price', refusal('a 5% buyback fee on a $0.00 buyback', () => F.commission(EDGE_SCHED, noPrice), 'unitCents'), true],
      ['a flat buyback fee with no price', F.commission(Object.assign({}, EDGE_SCHED, { buybackFee: { cents: 2000 } }), noPrice).feesCents, 2000]
    ]);
  },
  [
    { why: 'the buyback fee truncated instead of rounded half up', find: 'const c = byRate ? roundNum(l.lineCents * s.buybackFee.bp) : s.buybackFee.cents;', repl: 'const c = byRate ? div(l.lineCents * s.buybackFee.bp, BP_ONE) : s.buybackFee.cents;' },
    { why: 'a no-sale fee charged for every passed taking', find: 'if (!anySold && !anyBuyback) {', repl: "if (!anySold && !anyBuyback) { g.slice(1).forEach(() => fees.push({ kind: 'noSale', lotNo: g[0].lotNo, cents: s.noSaleFeeCents, text: '' }));" },
    { why: 'a percentage buyback fee charged as $0.00 when the price is unknown', find: 'if (byRate && l.lineCents === 0) refuse(', repl: 'if (false) refuse(' }
  ]);

/* P20 — quantity. The plan sets no ceiling on qty, so the library reuses the one number it has (1,000,000,000) and lets
   the $10,000,000.00 money ceiling do the real work. Flat 10% per line:
     one-money lot of 2,000,000 pieces for $5,000.00: the line is $5,000.00 (qty never multiplies one money) -> $500.00
     2,000,000 each at $0.01 = $20,000.00 -> $2,000.00
     item basis, 2,000,000 each at $1.00: 10% = $0.10 an item, raised to a $0.25 minimum, x 2,000,000 = $500,000.00
     100,000,001 each at $0.10 = $10,000,000.10: past the ceiling, refused
     qty 1,000,000,001: refused */
proof(20, 'Quantity: large lots up to 1,000,000,000 pieces are worked exactly; only the money ceiling refuses',
  'a real lot refused for an invented quantity limit, or a quantity so large the line could not be worked exactly',
  (F) => {
    const c = (sched, line) => F.commission(sched, [line]).cents;
    const ITEM_MIN = { kind: 'flat', basis: 'item', brackets: [{ uptoCents: null, bp: 1000 }], minCents: 25 };
    return expectAll([
      ['one money, 2,000,000 pieces', c(FLAT10, LINE('1', 500000, { qty: 2000000, mode: 'onemoney' })), 50000],
      ['2,000,000 each at a cent', c(FLAT10, LINE('1', 1, { qty: 2000000 })), 200000],
      ['item basis with a minimum, 2,000,000 items', c(ITEM_MIN, LINE('1', 100, { qty: 2000000 })), 50000000],
      ['a line past $10M', refusal('100,000,001 x $0.10', () => F.commission(FLAT10, [LINE('1', 10, { qty: 100000001 })]), 'lines[0]'), true],
      ['qty past the ceiling', refusal('qty 1,000,000,001', () => F.commission(FLAT10, [LINE('1', 1, { qty: 1000000001, mode: 'onemoney' })]), 'qty'), true]
    ]);
  },
  [
    { why: 'the old, undeclared 1,000,000 quantity limit', find: 'const MAX_QTY = MAX_CENTS;', repl: 'const MAX_QTY = 1000 * 1000;' },
    { why: 'no quantity ceiling at all', find: "wholeIn(raw.qty, 1, MAX_QTY, p + '.qty')", repl: "wholeIn(raw.qty, 1, Number.MAX_SAFE_INTEGER, p + '.qty')" }
  ]);

/* P21 — the holdback covers every way the held lines could end. Unpaid (consignor risk) and disputed lines are held back
   in full, and commission is charged on every sold line, so when they clear the release is exact. But a held line may
   never clear. Then the consignor is owed commission and fees on what is left, and that can be MORE than was deducted:
   a sliding rate that falls as the total rises, an unsold lot's no-sale fee above its lot fee, a per-item minimum larger
   than the hammer. The statement holds that difference back too, so nothing is paid now that a later statement would
   claw back. Every example is checked by brute force as well: the statement is re-run for each way its held lines could
   end (each one paid, or its lot unsold), and the net now must equal the least of those nets and the all-collected net.
   A  sliding on the consignor's total, 25% up to $1,000.00, 15% above. $1,000.00 paid; $0.01 unpaid (consignor risk).
      All sold: $1,000.01 x 15% = $150.00. If the $0.01 never clears: $1,000.00 x 25% = $250.00.
      Held back $0.01 + a further $100.00. Net $1,000.01 - $150.00 - $100.01 = $750.00 (what $1,000.00 alone pays).
   B  flat 10% per line, lot fee $3.00 (sold lots), no-sale fee $10.00. Lot 1 $100.00 paid; lot 2 $50.00 unpaid.
      All sold: $15.00 + $6.00 = $21.00. If lot 2 never clears: $10.00 + $3.00 + a $10.00 no-sale fee = $23.00.
      Held back $50.00 + $2.00. Net $150.00 - $21.00 - $52.00 = $77.00 (= $100.00 - $23.00).
   C  flat 10% per item, minimum $1.00 an item, no-sale fee $50.00. Lot 1 $500.00 paid; lot 2, 100 each at $0.01
      ($1.00), unpaid; lot 3 $5.00 unpaid. Commission $50.00 + 100 x $1.00 + $1.00 = $151.00. The worst end: lot 2
      clears and lot 3 does not: $50.00 + $100.00 + a $50.00 no-sale fee - lot 2's $1.00 = $199.00.
      Held back $6.00 + $48.00. Net $506.00 - $151.00 - $54.00 = $301.00 (= $501.00 - $150.00 - $50.00).
   D  sliding on the consignor's total, 10% up to $1,000.00, 30% up to $1,100.00, 5% above. $900.00 paid; unpaid
      $100.01, $250.00 and $10.00. All sold: $1,260.01 x 5% = $63.00. The worst end: only the $100.01 clears, so the
      total is $1,000.01, at 30%: $300.00 - $100.01 = $199.99. Held back $360.01 + $136.99.
      Net $1,260.01 - $63.00 - $497.00 = $700.01 (= $1,000.01 - $300.00).
   E  house risk, A's rates: $900.00 paid, $200.00 DISPUTED. All sold: $1,100.00 x 15% = $165.00. Without the
      disputed line: $900.00 x 25% = $225.00. Held back $200.00 + $60.00. Net $1,100.00 - $165.00 - $260.00 = $675.00.
   F  A with the $0.01 paid: nothing held, nothing further. Net $1,000.01 - $150.00 = $850.01.
   G  D plus fourteen more unpaid lots of $0.01: 17 held lines, past the 16 for which every end is tried, so the safe
      bound runs. All sold: $1,260.15 x 5% = $63.0075 -> $63.01. The bound looks at the smallest total the held lines can
      add ($900.01: $90.00 - $0.01) and at each bracket start: $1,000.01 gives $300.00 - $100.01 = $199.99, $1,100.01
      gives $55.00 - $200.01. Worst $199.99 (reached when only the $100.01 clears). Held back $360.15 + $136.98.
      Net $1,260.15 - $63.01 - $497.13 = $700.01.
   H  A's rates with a lot fee of $3.00 and a no-sale fee of $10.00: lot 1 $1,000.00 paid, lot 2 $50.00 unpaid. All
      sold: $1,050.00 x 15% = $157.50 + $6.00 fees. If lot 2 never clears: $250.00 + $3.00 + $10.00 = $263.00.
      Held back $50.00 + $99.50. Net $1,050.00 - $163.50 - $149.50 = $737.00 (= $1,000.00 - $263.00). */
const SOLD = (lotNo, unitCents, hammerId, balance, extra) => LINE(lotNo, unitCents, Object.assign({ hammerId: hammerId, buyerBalanceCents: balance, buyerForgivenCents: 0 }, extra || {}));
const SLIDE_25_15 = { kind: 'sliding', basis: 'consignor', brackets: [{ uptoCents: 100000, bp: 2500 }, { uptoCents: null, bp: 1500 }] };
const HOLD_CASES = [
  ['A', { schedule: SLIDE_25_15 }, [SOLD('1', 100000, 'h1', 0), SOLD('2', 1, 'h2', 1)], 'consignor', [1, 10000, 75000]],
  ['B', { schedule: { kind: 'flat', basis: 'line', brackets: [{ uptoCents: null, bp: 1000 }], lotFeeCents: 300, noSaleFeeCents: 1000 } },
    [SOLD('1', 10000, 'h1', 0), SOLD('2', 5000, 'h2', 2500)], 'consignor', [5000, 200, 7700]],
  ['C', { schedule: { kind: 'flat', basis: 'item', brackets: [{ uptoCents: null, bp: 1000 }], minCents: 100, noSaleFeeCents: 5000 } },
    [SOLD('1', 50000, 'h1', 0), SOLD('2', 1, 'h2', 700, { qty: 100 }), SOLD('3', 500, 'h3', 900)], 'consignor', [600, 4800, 30100]],
  ['D', { schedule: { kind: 'sliding', basis: 'consignor', brackets: [{ uptoCents: 100000, bp: 1000 }, { uptoCents: 110000, bp: 3000 }, { uptoCents: null, bp: 500 }] } },
    [SOLD('1', 90000, 'h1', 0), SOLD('2', 10001, 'h2', 1), SOLD('3', 25000, 'h3', 1), SOLD('4', 1000, 'h4', 1)], 'consignor', [36001, 13699, 70001]],
  ['E', { schedule: SLIDE_25_15 }, [SOLD('1', 90000, 'h1', 0), SOLD('2', 20000, 'h2', 0, { held: true })], 'house', [20000, 6000, 67500]],
  ['F', { schedule: SLIDE_25_15 }, [SOLD('1', 100000, 'h1', 0), SOLD('2', 1, 'h2', 0)], 'consignor', [0, 0, 85001]],
  ['G', { schedule: { kind: 'sliding', basis: 'consignor', brackets: [{ uptoCents: 100000, bp: 1000 }, { uptoCents: 110000, bp: 3000 }, { uptoCents: null, bp: 500 }] } },
    [SOLD('1', 90000, 'h1', 0), SOLD('2', 10001, 'h2', 1), SOLD('3', 25000, 'h3', 1), SOLD('4', 1000, 'h4', 1)]
      .concat([5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18].map((n) => SOLD(String(n), 1, 'h' + n, 1))), 'consignor', [36015, 13698, 70001]],
  ['H', { schedule: Object.assign({ lotFeeCents: 300, noSaleFeeCents: 1000 }, SLIDE_25_15) }, [SOLD('1', 100000, 'h1', 0), SOLD('2', 5000, 'h2', 1)], 'consignor', [5000, 9950, 73700]]
];
/* @proof — re-runs a statement for every way its held lines could end (each one paid, or its lot unsold), nothing held; returns the least net. */
function leastNetIfHeldLinesEnd(F, contract, lines, st) {
  const heldAt = st.lines.map((l, i) => (l.heldCents > 0 ? i : -1)).filter((i) => i >= 0);
  let least = Infinity;
  for (let m = 0; m < (1 << heldAt.length); m++) {
    const scenario = lines.map((l, i) => {
      const k = heldAt.indexOf(i), o = Object.assign({}, l);
      delete o.held;
      if (k >= 0 && !(m & (1 << k))) { o.passed = true; delete o.hammerId; delete o.buyerBalanceCents; delete o.buyerForgivenCents; return o; }
      if (o.hammerId !== undefined) { o.buyerBalanceCents = 0; o.buyerForgivenCents = 0; }
      return o;
    });
    least = Math.min(least, F.statement(contract, scenario, [], [], 'house').netCents);
  }
  return least;
}
proof(21, 'The holdback covers every way the held lines could end: nothing is paid now that a later statement would take back',
  'a consignor overpaid out of money the house never collected when a held line is voided: a sliding rate that falls with the total, a no-sale fee above the lot fee, or a per-item minimum',
  (F) => {
    const rows = [];
    for (const [name, contract, lines, risk, want] of HOLD_CASES) {
      const st = F.statement(contract, lines, [], [], risk);
      rows.push([name + ': held lines, further holdback, net', [st.heldLinesCents, st.extraHoldbackCents, st.netCents], want]);
      rows.push([name + ': identity 5', st.netCents + st.commission.cents + st.feesCents + st.expensesCents + st.advancesCents + st.holdbackCents, st.grossCents]);
      if (st.lines.filter((l) => l.heldCents > 0).length <= 8) {   /* G (17 held) is worked by hand above; 131,072 re-runs per copy would slow the suite */
        rows.push([name + ': net = the least net over every end (brute force)', st.netCents, Math.min(st.netCents + st.extraHoldbackCents, leastNetIfHeldLinesEnd(F, contract, lines, st))]);
      }
    }
    const a = F.statement(HOLD_CASES[0][1], HOLD_CASES[0][2], [], [], 'consignor');
    rows.push(['the text names the further holdback', /Held back a further \$100\.00/.test(a.mathText) && /\$100\.01 held back \(\$0\.01 of held lines \+ \$100\.00 further\) = \$750\.00/.test(a.mathText), true]);
    return expectAll(rows);
  },
  [
    { why: 'no further holdback (held hammer only)', find: 'return { cents: Math.max(0, worst - deducted), worstCents: worst };', repl: 'return { cents: 0, worstCents: worst };' },
    { why: 'an unsold lot\'s fees taken as if it sold', find: "const feesIfUnsold = byLot(feesOf(s, ls.map((l) => (held[l.i] ? Object.assign({}, l, { outcome: 'passed' }) : l))));", repl: 'const feesIfUnsold = feesIfSold;' },
    { why: 'only "nothing clears" checked, never "some clear"', find: 'worst += Math.max(unsold, sold + best);', repl: 'worst += unsold;' },
    { why: 'the bound ignores a sliding bracket that starts inside the held amounts', find: '.filter((t) => t > paidTotal + smallest && t <= paidTotal + heldTotal))', repl: '.filter(() => false))' },
    { why: 'the consignor-basis search tries only "nothing clears"', find: 'for (let m = 0; m < (1 << heldList.length); m++) {', repl: 'for (let m = 0; m < 1; m++) {' },
    { why: 'the consignor-basis search prices an open lot\'s fees as if it sold', find: 'v += soldOpen[k] ? (feesIfSold[k] || 0) : (feesIfUnsold[k] || 0);', repl: 'v += feesIfSold[k] || 0;' },
    { why: 'a disputed line under house risk left out of the worst case', find: 'if (heldCents > 0) { heldIdx[l.i] = true; heldCount++; }', repl: "if (heldCents > 0 && status !== 'disputed') { heldIdx[l.i] = true; heldCount++; }" }
  ]);

/* P22 — forgiveness is not payment. Floor premium 10%; the lot is titled, so no tax. One $1,000.00 lot: total $1,100.00.
   The buyer pays $600.00 cash and the house writes off the other $500.00: balance $0.00, forgivenCents $500.00.
   The consignor's statement, flat 10% per line, consignor risk; the line carries balance $0.00 and $500.00 forgiven:
     default: NOT paid. The house received $600.00, not the $1,000.00 hammer. Held back $1,000.00:
       $1,000.00 - $100.00 commission - $1,000.00 held back = -$100.00 (nothing payable now)
     contract.forgivenCountsAsPaid true: paid; net $1,000.00 - $100.00 = $900.00
     house risk: paid as if collected; net $900.00
   Forgiving more than is owed is refused: paid $1,100.00 and then a $1.00 write-off (nothing was owed), or paid $600.00
   and then $500.01 of waivers. Forgiving exactly what is owed (the case above) is accepted. */
const FORGIVE_LINE = [LINE('1', 100000, { channel: 'floor', taxClass: 'titled' })];
const FORGIVE_STMT = [LINE('1', 100000, { hammerId: 'h1', buyerBalanceCents: 0, buyerForgivenCents: 50000 })];
proof(22, 'Write-offs and waivers are not payment: a forgiven invoice does not release a consignor\'s money, and forgiveness never exceeds what is owed',
  'a consignor paid hammer money the house never received because a write-off brought the buyer to $0.00, or a write-off that turns into a refund claim',
  (F) => {
    const inv = (pays, adj) => () => F.invoice(TERMS, FORGIVE_LINE, pays, [], adj, { saleDate: SALE_DATE });
    const r = inv([{ payId: 'P1', cents: 60000, method: 'cash' }], [{ kind: 'writeoff', cents: -50000, reason: 'uncollectable' }])();
    const st = (contract, risk) => F.statement(Object.assign({ schedule: FLAT10 }, contract), FORGIVE_STMT, [], [], risk);
    const def = st({}, 'consignor'), on = st({ forgivenCountsAsPaid: true }, 'consignor'), house = st({}, 'house');
    return expectAll([
      ['invoice balance and forgiven', [r.balanceCents, r.forgivenCents], [0, 50000]],
      ['invoice text says forgiven, not paid', /\$500\.00 of it forgiven, not paid/.test(r.mathText), true],
      ['default: not paid, held back', [def.lines[0].status, def.lines[0].buyerPaid, def.holdbackCents, def.netCents], ['unpaidHeld', false, 100000, -10000]],
      ['setting on: paid', [on.lines[0].status, on.netCents], ['paid', 90000]],
      ['house risk: paid as if collected', [house.lines[0].status, house.netCents], ['unpaidHouse', 90000]],
      ['a write-off when nothing is owed', refusal('a $1.00 write-off on a paid invoice', inv([{ payId: 'P1', cents: 110000, method: 'cash' }], [{ kind: 'writeoff', cents: -100 }]), 'adjustments'), true],
      ['waivers past what is owed', refusal('$500.01 of waivers on $500.00 owed', inv([{ payId: 'P1', cents: 60000, method: 'cash' }], [{ kind: 'waive', cents: -50000 }, { kind: 'waive', cents: -1 }]), 'adjustments'), true]
    ]);
  },
  [
    { why: 'forgiveness counted as payment by default', find: 'const owed = forgivenPaid ? bal : bal + forg;', repl: 'const owed = bal;' },
    { why: 'forgiveness past what is owed let through', find: 'if (forgivenCents > Math.max(0, owedBeforeForgiven)) {', repl: 'if (false) {' },
    { why: 'the invoice does not report what was forgiven', find: "const forgivenCents = -adjList.reduce((a, x) => a + (x.kind === 'correction' ? 0 : x.cents), 0);", repl: 'const forgivenCents = 0;' },
    { why: 'a waiver not counted as forgiveness (write-offs only)', find: "(x.kind === 'correction' ? 0 : x.cents)", repl: "(x.kind === 'writeoff' ? x.cents : 0)" }
  ]);

/* P23 — the working matches the number. Three $1.05 floor lots at 10%: each premium is $0.105. Rounded per LINE, each
   line says "rounded half up to $0.11" and the premium is $0.33. Rounded once per INVOICE, no line may claim $0.11 (a
   person adding them would get $0.33): each says $0.105 kept exact, and the total says "$0.32 ($0.315 rounded once)". */
proof(23, 'Under invoice rounding the line working shows the exact premium, never a per-line rounding that is not charged',
  'working that adds up to a different total than the invoice charges, so a person checking it finds a cent that is not there',
  (F) => {
    const three = [1, 2, 3].map((n) => LINE(String(n), 105, { channel: 'floor', taxClass: 'general' }));
    const inv = (r) => F.invoice(Object.assign({}, TERMS, { tax: NO_TAX, rounding: { premium: r, tax: 'invoice' } }), three, [], [], [], { saleDate: SALE_DATE });
    const once = inv('invoice').mathText.split('\n'), line = inv('line').mathText.split('\n');
    const lots = (t) => t.filter((x) => /^ {2}Lot [123] \(floor\): hammer /.test(x));
    return expectAll([
      ['per invoice: three line texts', lots(once).length, 3],
      ['per invoice: each line exact', lots(once).every((x) => /\$1\.05 x 10\.00% = \$0\.105, kept exact/.test(x)), true],
      ['per invoice: no line claims a rounding', once.some((x) => /rounded half up to \$0\.11/.test(x)), false],
      ['per invoice: the total rounds once', once.some((x) => x.indexOf('premium $0.32 ($0.315 rounded once)') >= 0), true],
      ['per line: each line rounds', lots(line).every((x) => /rounded half up to \$0\.11/.test(x)), true]
    ]);
  },
  [{ why: 'line working always claims a per-line rounding', find: 'premiumOf(premFor(T, l.raw.channel), l.lineCents, !perLine)', repl: 'premiumOf(premFor(T, l.raw.channel), l.lineCents, false)' }]);

/* P24 — one buyer per invoice, one consignor per statement, one spelling per lot. Each case changes one thing in a call
   that is otherwise accepted, and every case is reported, so a control cannot pass because some other guard fired. */
proof(24, 'One buyer\'s balance, one consignor\'s lines, one spelling of a lot: anything else is refused',
  'a buyer counted both paid and unpaid, another consignor\'s lot paid out on this statement, two buyers on one invoice, or "12" and "12 " charged as two lots',
  (F) => {
    const B7 = (lotNo, hid, bal, forg) => SOLD(lotNo, 10000, hid, bal, { bidderNo: 'B7', buyerForgivenCents: forg });
    const st = (contract, lines) => () => F.statement(Object.assign({ schedule: FLAT10 }, contract), lines, [], [], 'consignor');
    const ok = st({ contractId: 'C-1' }, [B7('1', 'h1', 0, 0), B7('2', 'h2', 0, 0), SOLD('3', 100, 'h3', 0, { contractId: 'C-1' })])();
    const okInv = F.invoice(TERMS, [LINE('1', 100, { channel: 'floor', taxClass: 'general', bidderNo: '7' }), LINE('2', 100, { channel: 'floor', taxClass: 'general', bidderNo: '7' })], [], [], [], { saleDate: SALE_DATE });
    if (ok.lines.map((l) => l.status).join() !== 'paid,paid,paid' || okInv.bidderNo !== '7') return 'the agreeing cases were not accepted as they are';
    const cases = [
      ['one bidder, two balances', st({}, [B7('1', 'h1', 0, 0), B7('2', 'h2', 500, 0)]), 'buyerBalanceCents'],
      ['one bidder, two forgiven amounts', st({}, [B7('1', 'h1', 0, 0), B7('2', 'h2', 0, 100)]), 'buyerBalanceCents'],
      ['another contract\'s lot', st({ contractId: 'C-1' }, [SOLD('1', 100, 'h1', 0, { contractId: 'C-2' })]), 'contractId'],
      ['two contracts\' lots, no contract id', st({}, [SOLD('1', 100, 'h1', 0, { contractId: 'C-1' }), SOLD('2', 100, 'h2', 0, { contractId: 'C-2' })]), 'contractId'],
      ['two bidders on one invoice', () => F.invoice(TERMS, [LINE('1', 100, { channel: 'floor', taxClass: 'general', bidderNo: '7' }), LINE('2', 100, { channel: 'floor', taxClass: 'general', bidderNo: '8' })], [], [], [], { saleDate: SALE_DATE }), 'bidderNo'],
      ['a lot number with a trailing space', () => F.commission(FLAT10, [LINE('12', 100), LINE('12 ', 100)]), 'lotNo'],
      ['a line suffix with a leading space', () => F.commission(FLAT10, [LINE('12', 100, { mode: 'choice', line: ' A' })]), 'line'],
      ['"12A" and "12" line "A" in one list', () => F.commission(FLAT10, [LINE('12A', 100), LINE('12', 100, { mode: 'choice', line: 'A' })]), 'lines[1]'],
      ['a buyback that says passed: false', () => F.commission(FLAT10, [LINE('1', 100, { buyback: true, passed: false })]), 'passed']
    ];
    const broken = [];
    for (const [label, fn, pathHas] of cases) { const r = refusal(label, fn, pathHas); if (r !== true) broken.push(r); }
    return broken.length ? broken.length + ' of ' + cases.length + ' cases broke: ' + broken.join('; ') : true;
  },
  [
    { why: 'one bidder\'s lines may disagree on the invoice', find: 'if (prev && (prev.bal !== bal || prev.forg !== forg)) {', repl: 'if (false) {' },
    { why: 'another contract\'s lot accepted', find: 'if (consignor !== null && l.raw.contractId !== consignor) refuse(', repl: 'if (false) refuse(' },
    { why: 'two bidders accepted on one invoice', find: 'if (bidderNo !== null && l.raw.bidderNo !== bidderNo) refuse(', repl: 'if (false) refuse(' },
    { why: 'spaces around a lot number accepted', find: 'if (v.trim() !== v) refuse(', repl: 'if (false) refuse(' },
    { why: 'two spellings that print alike accepted', find: 'if (printed[lotNo + line] !== undefined && printed[lotNo + line] !== key) refuse(', repl: 'if (false) refuse(' },
    { why: 'a buyback with passed: false accepted', find: 'if (raw.buyback === true && raw.passed === false) refuse(', repl: 'if (false) refuse(' }
  ]);

/* ---------- verdict ---------- */
console.log('\n' + proofs + ' proofs, ' + controls + ' negative controls' + (failed ? ': ' + failed + ' FAILED' : ', every control seen failing'));
console.log(failed ? 'FAIL' : 'ALL PASS');
process.exit(failed ? 1 : 0);
