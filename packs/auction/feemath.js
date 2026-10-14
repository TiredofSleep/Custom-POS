/* ============================================================================
 * AUCTION FEE MATH (pack: auction, unit A1) — the pure money math an auction company settles with: the consignor's
 * commission and schedule fees, the buyer's premium, sales tax by class, the buyer's invoice and the consignor's
 * settlement statement. MATH_VERSION 1.
 * @money @price @tax @invariant — owns every auction money number; refuses any input it cannot compute exactly
 * ----------------------------------------------------------------------------
 * The rules it enforces (README.md in this folder says them in plain words):
 *   - Whole cents everywhere. Rates are whole basis points (1000 = 10.00%). Tax rates are whole thousandths of a
 *     percent (9875 = 9.875%).
 *   - Rounding is half up, done ONCE, at the level the rule names: roundBp = (cents*bp + 5000) div 10000.
 *   - Every amount is a whole number of cents from 0 to MAX_CENTS ($10,000,000.00), a sold price is at least 1 cent,
 *     and every total stays under the same ceiling. A float, a string, NaN, a negative, an unknown field (a typo) or
 *     anything above the ceiling is REFUSED with a FeeMathError. Nothing is ever coerced or clipped.
 *   - Inputs are never changed. No requires, no clock, no I/O, no randomness: the same input gives the same output.
 *   - Every result carries mathVersion and mathText, the arithmetic written out for a person to check.
 * Loads as CommonJS (module.exports) and, in a browser, as the global AuctionFeeMath.
 * ========================================================================== */
(function (factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module !== null && module.exports) { module.exports = api; }
  if (typeof window === 'object' && window !== null) { window.AuctionFeeMath = api; }
  else if (typeof self === 'object' && self !== null) { self.AuctionFeeMath = api; }
}(function () {
  'use strict';

  const MATH_VERSION = 1;
  const MAX_CENTS = 1000 * 1000 * 1000;   /* $10,000,000.00: the ceiling for any one amount and for any total */
  const MAX_BP = 10000;                   /* 100.00% */
  const MAX_MILLI_PCT = 100000;           /* 100.000% */
  const MAX_QTY = MAX_CENTS;              /* the plan sets no quantity ceiling, so it reuses the one number; unit x qty can pass 2^53 only far above the money ceiling, so the line check after the multiply stays exact */
  const BP_ONE = 10000;                   /* basis points in 100% */
  const EXACT_HELD = 16;                  /* consignor basis: held lines up to which every way they could end is tried (65,536 ways, a few milliseconds) */
  const MILLI_ONE = 100000;               /* thousandths of a percent in 100% */

  const KINDS = ['flat', 'sliding', 'incremental'];
  const BASES = ['item', 'line', 'consignor'];
  const MODES = ['each', 'onemoney', 'choice'];
  const CHANNELS = ['floor', 'online', 'phone', 'absentee'];
  const TAX_CLASSES = ['general', 'farm', 'titled', 'other'];
  const TAX_RULES = ['taxable', 'exemptWithCert', 'exempt'];
  const FEE_KINDS = ['card', 'storage', 'title', 'other'];
  const ADJ_KINDS = ['writeoff', 'waive', 'correction'];
  const PAY_METHODS = ['cash', 'check', 'card', 'wire', 'ach', 'platform', 'other'];
  const RISKS = ['consignor', 'house'];

  const SCHED_KEYS = ['kind', 'basis', 'brackets', 'minCents', 'capCents', 'lotFeeCents', 'noSaleFeeCents',
    'titledNoSaleFeeCents', 'buybackFee', 'lotFeeOn'];
  const PREM_KEYS = ['kind', 'brackets', 'capCents', 'minCents'];
  const TAX_KEYS = ['rateMilliPct', 'premiumTaxed', 'classes', 'certValidOnExpiryDay', 'certWithoutExpiryCounts'];
  const TERMS_KEYS = ['v', 'premium', 'tax', 'rounding', 'cardFeeBp', 'payByHours', 'pickupBusinessDays',
    'storagePerDayCents', 'confirmAboveCents', 'record'];
  const LINE_KEYS = ['lotNo', 'line', 'hammerId', 'bidderNo', 'contractId', 'title', 'unitCents', 'qty', 'mode',
    'channel', 'taxClass', 'passed', 'buyback', 'titled', 'held', 'buyerBalanceCents', 'buyerForgivenCents'];
  const TAX_LINE_KEYS = ['lotNo', 'line', 'taxClass', 'lineCents', 'premiumCents', 'premiumExact'];
  const CERT_KEYS = ['certId', 'partyId', 'state', 'form', 'number', 'expires', 'photoId'];
  const PAY_KEYS = ['payId', 'cents', 'method', 'ref', 'drawerId', 'voided', 'returned', 'refundedCents'];
  const FEE_KEYS = ['kind', 'cents', 'rateBp', 'reason'];
  const ADJ_KEYS = ['kind', 'cents', 'reason'];
  const EXPENSE_KEYS = ['cents', 'what'];
  const ADVANCE_KEYS = ['cents', 'method', 'ref'];
  const CONTRACT_KEYS = ['contractId', 'partyId', 'saleId', 'schedule', 'charges', 'absolute', 'unpaidRisk',
    'settleBusinessDays', 'signedOn', 'docPhotoId', 'forgivenCountsAsPaid'];
  const CTX_KEYS = ['saleDate', 'cert'];

  /* ---------- refusals and input checks ---------- */

  /* @money @invariant @error — the one refusal this library throws: it names the field and what was wrong, never a guess. */
  function FeeMathError(path, message) {
    this.name = 'FeeMathError';
    this.code = 'FEEMATH_REFUSED';
    this.path = path;
    this.message = path + ': ' + message;
    this.stack = (new Error(this.message)).stack;
  }
  FeeMathError.prototype = Object.create(Error.prototype);
  FeeMathError.prototype.constructor = FeeMathError;

  /* @money @invariant @error — throws the refusal; every check below ends here, so nothing half-checked is ever computed. */
  function refuse(path, message) { throw new FeeMathError(path, message); }

  /* @money @error — a short, safe picture of a refused value for the refusal message. */
  function show(v) {
    if (typeof v === 'string') return JSON.stringify(v.length > 40 ? v.slice(0, 40) + '...' : v);
    if (typeof v === 'number' || typeof v === 'boolean' || v === null || v === undefined) return String(v);
    if (Array.isArray(v)) return 'a list';
    return typeof v === 'object' ? 'an object' : typeof v;
  }

  /* @money @invariant — a whole number in [lo, hi] or a refusal; a string, float, NaN or Infinity is never coerced. */
  function wholeIn(v, lo, hi, path) {
    if (typeof v !== 'number' || !Number.isInteger(v)) refuse(path, 'must be a whole number, got ' + show(v));
    if (v < lo) refuse(path, 'must be at least ' + lo + ', got ' + v);
    if (v > hi) refuse(path, (hi === MAX_CENTS ? 'is above the ' + fmt(MAX_CENTS) + ' ceiling' : 'must be at most ' + hi) + ', got ' + v);
    return v;
  }

  /* @money @invariant — an amount of cents from lo (0 unless the rule needs 1) up to the $10,000,000.00 ceiling, or a refusal. */
  function centsIn(v, path, lo) { return wholeIn(v, lo === undefined ? 0 : lo, MAX_CENTS, path); }

  /* @money @invariant — an optional amount of cents: absent (or null) stays null, anything present must pass centsIn. */
  function optCents(v, path) { return v === undefined || v === null ? null : centsIn(v, path); }

  /* @money @invariant — an optional yes/no field: absent means false; anything but true or false is refused (no "yes", no 1). */
  function optBool(v, path) {
    if (v === undefined) return false;
    if (v !== true && v !== false) refuse(path, 'must be true or false, got ' + show(v));
    return v;
  }

  /* @money @invariant — a required yes/no field: only true or false, never a missing value read as false. */
  function reqBool(v, path) {
    if (v !== true && v !== false) refuse(path, 'must be true or false, got ' + show(v));
    return v;
  }

  /* @money @invariant — one word from a closed list, or a refusal naming the list. */
  function oneOf(v, list, path) {
    if (list.indexOf(v) < 0) refuse(path, 'must be one of ' + list.join(', ') + ', got ' + show(v));
    return v;
  }

  /* @money @invariant — a plain object holding only the named fields: a misspelt field (a cap that would be silently skipped) is refused. */
  function onlyKeys(o, allowed, path) {
    if (o === null || typeof o !== 'object' || Array.isArray(o)) refuse(path, 'must be an object, got ' + show(o));
    Object.keys(o).forEach((k) => {
      if (allowed.indexOf(k) < 0) refuse(path + '.' + k, 'is not a field this rule knows (a typo?); allowed: ' + allowed.join(', '));
    });
    return o;
  }

  /* @money @invariant — a list (it may be empty), or a refusal. */
  function listOf(v, path) {
    if (!Array.isArray(v)) refuse(path, 'must be a list, got ' + show(v));
    return v;
  }

  /* @money @invariant — non-empty text (a lot number, an id), or a refusal; a number is never quietly turned into text. */
  function textIn(v, path) {
    if (typeof v !== 'string' || v.trim() === '') refuse(path, 'must be non-empty text, got ' + show(v));
    return v;
  }

  /* @money @invariant — a lot number or line suffix: non-empty text with no space at either end, so "12" and "12 " can never count as two lots (two lot fees, no clash caught). */
  function lotText(v, path) {
    textIn(v, path);
    if (v.trim() !== v) refuse(path, 'must not start or end with a space, got ' + show(v) + '; one lot is written one way');
    return v;
  }

  /* @tax @invariant — a real calendar date written YYYY-MM-DD (no clock, no time zone), or a refusal; 2026-02-30 is refused. */
  function isoDate(v, path) {
    if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) refuse(path, 'must be a date written YYYY-MM-DD, got ' + show(v));
    const y = Number(v.slice(0, 4)), m = Number(v.slice(5, 7)), d = Number(v.slice(8, 10));
    const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
    const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if (m < 1 || m > 12 || d < 1 || d > days[m - 1]) refuse(path, 'is not a real calendar date: ' + v);
    return v;
  }

  /* ---------- whole-number arithmetic and the one rounding rule ---------- */

  /* @money @invariant — whole-number division of a non-negative whole number, exact in floating point (no 0.9999 drift). */
  function div(a, b) { return (a - (a % b)) / b; }

  /* @money @price — half-up rounding of an exact amount held in cents x 10000 (cents times basis points), done once. */
  function roundNum(num) { return div(num + 5000, BP_ONE); }

  /* @money @price @invariant — cents x basis points rounded half up ONCE, (cents*bp + 5000) div 10000; refuses a fraction, a negative, a rate above 100% or cents above the ceiling. */
  function roundBp(cents, bp) {
    centsIn(cents, 'cents');
    wholeIn(bp, 0, MAX_BP, 'bp');
    return roundNum(cents * bp);
  }

  /* @money @tax @invariant — cents x a tax rate in thousandths of a percent, rounded half up ONCE: (cents*rate + 50000) div 100000. */
  function roundMilliPct(cents, milliPct) {
    centsIn(cents, 'cents');
    wholeIn(milliPct, 0, MAX_MILLI_PCT, 'rateMilliPct');
    return div(cents * milliPct + 50000, MILLI_ONE);
  }

  /* @money @invariant — adds amounts of cents; a total past the $10,000,000.00 ceiling is refused, never wrapped or clipped. */
  function sumCents(list, path) {
    let t = 0;
    for (let i = 0; i < list.length; i++) {
      t += list[i];
      if (t > MAX_CENTS) refuse(path, 'the total passes the ' + fmt(MAX_CENTS) + ' ceiling');
    }
    return t;
  }

  /* ---------- the math written out ---------- */

  /* @money @print — cents as dollars for the math text: 123456 -> "$1,234.56", -500 -> "-$5.00". */
  function fmt(c) {
    const neg = c < 0, a = neg ? -c : c, r = a % 100;
    const d = String(div(a, 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (neg ? '-$' : '$') + d + '.' + (r < 10 ? '0' : '') + r;
  }

  /* @money @print — an exact amount held in cents x `one` as dollars, showing the fraction of a cent the rounding will settle. */
  function fmtExact(num, one) {
    const r = num % one;
    if (r === 0) return fmt(num / one);
    return fmt(div(num, one)) + String(one + r).slice(1).replace(/0+$/, '');
  }

  /* @money @print — basis points as a percent: 3000 -> "30.00%". */
  function pct(bp) { const r = bp % 100; return div(bp, 100) + '.' + (r < 10 ? '0' : '') + r + '%'; }

  /* @tax @print — thousandths of a percent as a percent: 9875 -> "9.875%". */
  function pctMilli(m) { return div(m, 1000) + '.' + String(1000 + (m % 1000)).slice(1) + '%'; }

  /* @money @price @print — a rate table in words: "30.00% up to $100.00; 20.00% above $100.00". */
  function bracketsText(b) {
    return b.map((br, i) => {
      const lo = i === 0 ? null : b[i - 1].uptoCents;
      if (br.uptoCents === null) return pct(br.bp) + (lo === null ? ' on any amount' : ' above ' + fmt(lo));
      return pct(br.bp) + (lo === null ? ' up to ' : ' over ' + fmt(lo) + ' up to ') + fmt(br.uptoCents);
    }).join('; ');
  }

  /* @money @price @print — the minimum and cap in words, at the level they apply ("each item", "each line", ...). */
  function minCapText(minCents, capCents, level) {
    const parts = [];
    if (minCents !== null) parts.push('minimum ' + fmt(minCents));
    if (capCents !== null) parts.push('cap ' + fmt(capCents));
    return parts.length ? ' ' + parts.join(' and ').replace(/^m/, 'M').replace(/^c/, 'C') + ' on ' + level + '.' : '';
  }

  /* @money @price @print — one charge written out: the slices and their rates, the exact result, any minimum or cap, and the rounding (or, when the invoice rounds once over all its lines, the exact amount with no per-line rounding claimed). */
  function chargeText(kind, b, bc, st, exactOnly) {
    let s = bc.parts.length ? bc.parts.map((p) => fmt(p.sliceCents) + ' x ' + pct(p.bp)).join(' + ') : fmt(0);
    if (kind === 'sliding' && b.length > 1) s += ' (all of it at its bracket\'s rate)';
    s += ' = ' + fmtExact(bc.exact, BP_ONE);
    if (st.clamp === 'min') s += ', raised to the ' + fmt(st.cents) + ' minimum';
    if (st.clamp === 'cap') s += ', held to the ' + fmt(st.cents) + ' cap';
    if (st.clamp === null && st.num % BP_ONE !== 0) s += exactOnly ? ', kept exact (the invoice rounds its premium once)' : ', rounded half up to ' + fmt(st.cents);
    return s;
  }

  /* ---------- rate tables ---------- */

  /* @money @price @invariant — a rate table: upper bounds (inclusive) rise, rates run 0 to 100.00%, and only the last bracket is open-ended (uptoCents null). */
  function checkBrackets(b, path) {
    listOf(b, path);
    if (b.length === 0) refuse(path, 'needs at least one bracket');
    let prev = 0;
    return b.map((raw, i) => {
      const p = path + '[' + i + ']', last = i === b.length - 1;
      onlyKeys(raw, ['uptoCents', 'bp'], p);
      wholeIn(raw.bp, 0, MAX_BP, p + '.bp');
      if (raw.uptoCents === null) {
        if (!last) refuse(p + '.uptoCents', 'only the last bracket may be open-ended (null)');
      } else {
        if (last) refuse(p + '.uptoCents', 'the last bracket must be open-ended: uptoCents null');
        centsIn(raw.uptoCents, p + '.uptoCents', 1);
        if (raw.uptoCents <= prev) refuse(p + '.uptoCents', 'must be above the bracket before it (' + fmt(prev) + ')');
        prev = raw.uptoCents;
      }
      return { uptoCents: raw.uptoCents, bp: raw.bp };
    });
  }

  /* @money @price — the exact charge on one amount, in cents x 10000, before any minimum, cap or rounding: sliding (and flat) puts the WHOLE amount at the rate of the bracket it falls in, bounds inclusive; incremental charges each slice at its own rate. */
  function bracketCharge(kind, b, amount) {
    if (kind !== 'incremental') {
      let i = 0;
      while (b[i].uptoCents !== null && amount > b[i].uptoCents) { i++; }
      return { exact: amount * b[i].bp, parts: [{ sliceCents: amount, bp: b[i].bp, bracket: i }] };
    }
    let exact = 0, from = 0;
    const parts = [];
    for (let j = 0; j < b.length && from < amount; j++) {
      const top = b[j].uptoCents === null ? amount : Math.min(amount, b[j].uptoCents);
      if (top > from) {
        exact += (top - from) * b[j].bp;
        parts.push({ sliceCents: top - from, bp: b[j].bp, bracket: j });
      }
      from = top;
    }
    return { exact: exact, parts: parts };
  }

  /* @money @price @invariant — an optional cap: absent means no cap; a cap of $0.00 is refused, because a form that writes 0 for "no cap" would silently zero every charge (a no-charge deal is written bp 0). */
  function optCap(v, path) {
    const c = optCents(v, path);
    if (c === 0) refuse(path, 'a cap of $0.00 would zero every charge; leave the field out for no cap, or write the rate as bp 0');
    return c;
  }

  /* @money @price — holds an exact charge between the minimum and the cap (each in whole cents), then rounds it half up once. */
  function settle(exact, minCents, capCents) {
    let num = exact, clamp = null;
    if (minCents !== null && num < minCents * BP_ONE) { num = minCents * BP_ONE; clamp = 'min'; }
    if (capCents !== null && num > capCents * BP_ONE) { num = capCents * BP_ONE; clamp = 'cap'; }
    return { exact: exact, num: num, clamp: clamp, cents: roundNum(num) };
  }

  /* ---------- the consignor's schedule and hammer lines ---------- */

  /* @money @price @invariant — the buyback fee: a rate on the buyback price ({bp}) or a flat amount per buyback line ({cents}), never both. */
  function checkBuyback(v, path) {
    if (v === undefined || v === null) return null;
    onlyKeys(v, ['bp', 'cents'], path);
    const hasBp = v.bp !== undefined, hasCents = v.cents !== undefined;
    if (hasBp === hasCents) refuse(path, 'must be {bp} or {cents}, exactly one of them');
    return hasBp ? { bp: wholeIn(v.bp, 0, MAX_BP, path + '.bp') } : { cents: centsIn(v.cents, path + '.cents') };
  }

  /* @money @price @invariant — the titled no-sale fee: absent means a titled lot pays the plain no-sale fee; $0.00 is refused, because 0 could mean "not set" (pay the plain fee) or "free", and the math never guesses which. */
  function optTitledFee(v, path) {
    const c = optCents(v, path);
    if (c === 0) refuse(path, 'is $0.00, which could mean "not set" or "titled lots pay nothing"; leave it out for the plain no-sale fee');
    return c;
  }

  /* @money @price @invariant — a consignor fee schedule checked whole: kind, basis, rate table, minimum <= cap (a cap of 0 refused), the fees, and the lot-fee setting (sold lots only unless "offered"). */
  function checkSched(s, path) {
    onlyKeys(s, SCHED_KEYS, path);
    const out = {
      kind: oneOf(s.kind, KINDS, path + '.kind'),
      basis: oneOf(s.basis, BASES, path + '.basis'),
      brackets: checkBrackets(s.brackets, path + '.brackets'),
      minCents: optCents(s.minCents, path + '.minCents'),
      capCents: optCap(s.capCents, path + '.capCents'),
      lotFeeCents: optCents(s.lotFeeCents, path + '.lotFeeCents') || 0,
      noSaleFeeCents: optCents(s.noSaleFeeCents, path + '.noSaleFeeCents') || 0,
      titledNoSaleFeeCents: optTitledFee(s.titledNoSaleFeeCents, path + '.titledNoSaleFeeCents'),
      buybackFee: checkBuyback(s.buybackFee, path + '.buybackFee'),
      lotFeeOn: s.lotFeeOn === undefined ? 'sold' : oneOf(s.lotFeeOn, ['sold', 'offered'], path + '.lotFeeOn')
    };
    if (out.kind === 'flat' && out.brackets.length !== 1) refuse(path + '.brackets', 'a flat schedule has exactly one bracket (uptoCents null)');
    if (out.minCents !== null && out.capCents !== null && out.minCents > out.capCents) {
      refuse(path + '.minCents', 'the minimum ' + fmt(out.minCents) + ' is above the cap ' + fmt(out.capCents));
    }
    return out;
  }

  /* @money @invariant — hammer lines checked whole: lot number, price, quantity and mode, one outcome each (sold, passed or bought back), no lot line twice (nor two spellings that print alike); works out each line's money (unit x qty only for "each"). */
  function checkLines(lines, path) {
    listOf(lines, path);
    const seen = Object.create(null), printed = Object.create(null);
    return lines.map((raw, i) => {
      const p = path + '[' + i + ']';
      onlyKeys(raw, LINE_KEYS, p);
      const lotNo = lotText(raw.lotNo, p + '.lotNo');
      const line = raw.line === undefined ? '' : lotText(raw.line, p + '.line');
      const key = lotNo + '\u0000' + line;
      if (seen[key]) refuse(p, 'lot ' + lotNo + line + ' appears twice; a clash is held for a person, never charged twice');
      seen[key] = true;
      if (printed[lotNo + line] !== undefined && printed[lotNo + line] !== key) refuse(p, 'lot ' + show(lotNo) + ' line ' + show(line) + ' prints as ' + lotNo + line + ', like another line here; write each lot number one way');
      printed[lotNo + line] = key;
      if (raw.buyback === true && raw.passed === false) refuse(p + '.passed', 'a buyback is not a sale, so it cannot say passed: false');
      const passed = optBool(raw.passed, p + '.passed'), buyback = optBool(raw.buyback, p + '.buyback');
      const outcome = buyback ? 'buyback' : passed ? 'passed' : 'sold';
      const mode = oneOf(raw.mode, MODES, p + '.mode');
      const qty = wholeIn(raw.qty, 1, MAX_QTY, p + '.qty');
      if (mode === 'choice' && qty !== 1) refuse(p + '.qty', 'a choice taking is one line per item (12A, 12B), so qty must be 1');
      const unit = centsIn(raw.unitCents, p + '.unitCents', outcome === 'sold' ? 1 : 0);
      const lineCents = mode === 'each' ? unit * qty : unit;
      if (lineCents > MAX_CENTS) refuse(p, 'the line ' + fmt(unit) + ' x ' + qty + ' is above the ' + fmt(MAX_CENTS) + ' ceiling');
      const held = optBool(raw.held, p + '.held');
      if (held && outcome !== 'sold') refuse(p + '.held', 'only a sold line can be held as disputed');
      return {
        i: i, lotNo: lotNo, line: line, label: lotNo + line, unitCents: unit, qty: qty, mode: mode, outcome: outcome,
        units: mode === 'each' ? qty : 1, lineCents: lineCents, titled: optBool(raw.titled, p + '.titled'), held: held, raw: raw
      };
    });
  }

  /* ---------- commission and schedule fees ---------- */

  /* @money @price — the schedule's fees: a lot fee once per lot (sold lots only unless lotFeeOn is "offered"), a no-sale fee once per lot with nothing sold or bought back (the titled fee if any of its lines is titled and the schedule has one), a buyback fee per buyback line. */
  function feesOf(s, ls) {
    const order = [], byLot = Object.create(null), fees = [];
    ls.forEach((l) => {
      const k = l.lotNo;
      if (!byLot[k]) { byLot[k] = []; order.push(k); }
      byLot[k].push(l);
    });
    order.forEach((k) => {
      const g = byLot[k];
      const anySold = g.some((o) => o.outcome === 'sold'), anyBuyback = g.some((o) => o.outcome === 'buyback');
      if (s.lotFeeCents > 0 && (anySold || s.lotFeeOn === 'offered')) {
        fees.push({ kind: 'lot', lotNo: g[0].lotNo, cents: s.lotFeeCents, text: 'Lot fee, lot ' + g[0].lotNo + ': ' + fmt(s.lotFeeCents) });
      }
      if (!anySold && !anyBuyback) {
        const useTitled = g.some((o) => o.titled) && s.titledNoSaleFeeCents !== null;
        const c = useTitled ? s.titledNoSaleFeeCents : s.noSaleFeeCents;
        if (c > 0) fees.push({ kind: useTitled ? 'titledNoSale' : 'noSale', lotNo: g[0].lotNo, cents: c, text: (useTitled ? 'Titled no-sale fee' : 'No-sale fee') + ', lot ' + g[0].lotNo + ': ' + fmt(c) });
      }
    });
    ls.forEach((l) => {
      if (l.outcome !== 'buyback' || s.buybackFee === null) return;
      const byRate = s.buybackFee.bp !== undefined;
      if (byRate && l.lineCents === 0) refuse('lines[' + l.i + '].unitCents', 'a buyback fee of ' + pct(s.buybackFee.bp) + ' needs the buyback price, and lot ' + l.label + ' has none; the math never charges a rate on an unknown amount');
      const c = byRate ? roundNum(l.lineCents * s.buybackFee.bp) : s.buybackFee.cents;
      if (c > 0) {
        fees.push({ kind: 'buyback', lotNo: l.lotNo, line: l.line, cents: c,
          text: 'Buyback fee, lot ' + l.label + ': ' + (byRate ? fmt(l.lineCents) + ' x ' + pct(s.buybackFee.bp) + ' = ' + fmtExact(l.lineCents * s.buybackFee.bp, BP_ONE) + (l.lineCents * s.buybackFee.bp % BP_ONE ? ', rounded half up to ' + fmt(c) : '') : fmt(c) + ' flat') });
      }
    });
    return fees;
  }

  /* @money @price — one sold line's commission on the item or line basis: the charge on one item (or on the whole line), the minimum and cap at that level, rounded half up once, then times the items. A total past the ceiling is refused by the caller's sum. */
  function lineCommission(s, l) {
    const item = s.basis === 'item';
    const basisCents = item ? l.unitCents : l.lineCents;
    const units = item ? l.units : 1;
    const bc = bracketCharge(s.kind, s.brackets, basisCents), st = settle(bc.exact, s.minCents, s.capCents);
    return { basisCents: basisCents, units: units, bc: bc, st: st, cents: st.cents * units };
  }

  /* @money @price — commission on already-checked lines: one rounding per basis unit (each item, each line, or the consignor's sold total), the minimum and cap at that same level, nothing on passed or bought-back lines. */
  function commissionOf(s, ls) {
    const sold = ls.filter((l) => l.outcome === 'sold');
    const level = s.basis === 'item' ? 'each item' : s.basis === 'line' ? 'each line' : 'the consignor\'s sold total';
    const text = ['Commission: ' + s.kind + ', ' + s.basis + ' basis. Rates: ' + bracketsText(s.brackets) + '.' + minCapText(s.minCents, s.capCents, level)];
    const perUnit = [];
    let cents = 0;
    if (s.basis === 'consignor') {
      if (sold.length > 0) {
        const total = sumCents(sold.map((l) => l.lineCents), 'lines (the consignor\'s sold total)');
        const bc = bracketCharge(s.kind, s.brackets, total), st = settle(bc.exact, s.minCents, s.capCents);
        perUnit.push({ lotNo: null, line: null, basisCents: total, units: 1, exact: bc.exact, eachCents: st.cents, cents: st.cents, clamp: st.clamp });
        cents = st.cents;
        text.push('  Sold total ' + fmt(total) + ' over ' + sold.length + ' line' + (sold.length === 1 ? '' : 's') + ': ' + chargeText(s.kind, s.brackets, bc, st) + '.');
      } else {
        text.push('  Nothing sold, so no commission (a minimum applies only to a sale).');
      }
    } else {
      sold.forEach((l) => {
        const lc = lineCommission(s, l), basisCents = lc.basisCents, units = lc.units, bc = lc.bc, st = lc.st, c = lc.cents;
        cents = sumCents([cents, c], 'commission total');
        perUnit.push({ lotNo: l.lotNo, line: l.line, basisCents: basisCents, units: units, exact: bc.exact, eachCents: st.cents, cents: c, clamp: st.clamp });
        text.push('  Lot ' + l.label + (units > 1 ? ' (' + units + ' at ' + fmt(basisCents) + ' each), each: ' : ': ') +
          chargeText(s.kind, s.brackets, bc, st) + (units > 1 ? '; x ' + units + ' = ' + fmt(c) : '') + '.');
      });
      if (sold.length === 0) text.push('  Nothing sold, so no commission.');
    }
    text.push('Commission total: ' + fmt(cents) + '.');
    const fees = feesOf(s, ls);
    const feesCents = sumCents(fees.map((f) => f.cents), 'fees');
    if (fees.length) text.push('Schedule fees: ' + fees.map((f) => f.text).join('; ') + '. Fees total: ' + fmt(feesCents) + (s.lotFeeCents > 0 ? ' (lot fee on ' + (s.lotFeeOn === 'offered' ? 'every lot offered' : 'sold lots only') + ')' : '') + '.');
    else text.push('Schedule fees: none.');
    return {
      mathVersion: MATH_VERSION, kind: s.kind, basis: s.basis, brackets: s.brackets.map((b) => ({ uptoCents: b.uptoCents, bp: b.bp })),
      minCents: s.minCents, capCents: s.capCents, lotFeeOn: s.lotFeeOn,
      cents: cents, perUnit: perUnit, fees: fees.map((f) => Object.assign({}, f)), feesCents: feesCents,
      totalCents: sumCents([cents, feesCents], 'commission + fees'), mathText: text.join('\n')
    };
  }

  /* @money @price — one consignor's commission and schedule fees for one sale, from their stamped schedule; `cents` is the commission alone, `feesCents` the lot, no-sale and buyback fees, `totalCents` both. */
  function commission(sched, lines) {
    return commissionOf(checkSched(sched, 'sched'), checkLines(lines, 'lines'));
  }

  /* ---------- buyer's premium ---------- */

  /* @money @price @invariant — a buyer's-premium table: rate brackets (a kind is required once there are two or more tiers), an optional per-line minimum and cap, minimum <= cap. */
  function checkPrem(p, path) {
    onlyKeys(p, PREM_KEYS, path);
    const brackets = checkBrackets(p.brackets, path + '.brackets');
    let kind = 'flat';
    if (p.kind === undefined) {
      if (brackets.length > 1) refuse(path + '.kind', 'a premium with ' + brackets.length + ' tiers must say sliding or incremental; the math never guesses');
    } else {
      kind = oneOf(p.kind, KINDS, path + '.kind');
    }
    if (kind === 'flat' && brackets.length !== 1) refuse(path + '.brackets', 'a flat premium has exactly one bracket (uptoCents null)');
    const out = { kind: kind, brackets: brackets, minCents: optCents(p.minCents, path + '.minCents'), capCents: optCap(p.capCents, path + '.capCents') };
    if (out.minCents !== null && out.capCents !== null && out.minCents > out.capCents) {
      refuse(path + '.minCents', 'the minimum ' + fmt(out.minCents) + ' is above the cap ' + fmt(out.capCents));
    }
    return out;
  }

  /* @money @price — the premium on one already-checked line of at least 1 cent; exactOnly writes the exact amount without a per-line rounding, for an invoice that rounds once. */
  function premiumOf(p, lineCents, exactOnly) {
    const head = 'Premium, ' + p.kind + ': ' + bracketsText(p.brackets) + '.' + minCapText(p.minCents, p.capCents, 'each line');
    const bc = bracketCharge(p.kind, p.brackets, lineCents), st = settle(bc.exact, p.minCents, p.capCents);
    return {
      mathVersion: MATH_VERSION, kind: p.kind, cents: st.cents, exact: st.num, rawExact: bc.exact, clamp: st.clamp,
      parts: bc.parts.map((x) => Object.assign({}, x)), mathText: head + ' ' + chargeText(p.kind, p.brackets, bc, st, exactOnly) + '.'
    };
  }

  /* @money @price — the buyer's premium on one hammer line of at least 1 cent (a sold price; 0 is refused, never priced): the tier rates, then the per-line minimum and cap; `cents` is rounded half up, `exact` (cents x 10000, after the minimum and cap) is kept for an invoice that rounds once over all its lines. */
  function premium(prem, lineCents) {
    return premiumOf(checkPrem(prem, 'prem'), centsIn(lineCents, 'lineCents', 1), false);
  }

  /* ---------- sales tax ---------- */

  /* @tax @invariant — a sale's tax terms: the rate, whether the premium is taxed, a rule for each listed class, and the two certificate settings (both off unless set). */
  function checkTaxTerms(t, path) {
    onlyKeys(t, TAX_KEYS, path);
    const classes = onlyKeys(t.classes, TAX_CLASSES, path + '.classes');
    const rules = Object.create(null);
    Object.keys(classes).forEach((c) => { rules[c] = oneOf(classes[c], TAX_RULES, path + '.classes.' + c); });
    if (Object.keys(rules).length === 0) refuse(path + '.classes', 'must give a rule for at least one class');
    return {
      rateMilliPct: wholeIn(t.rateMilliPct, 0, MAX_MILLI_PCT, path + '.rateMilliPct'),
      premiumTaxed: reqBool(t.premiumTaxed, path + '.premiumTaxed'),
      rules: rules,
      certValidOnExpiryDay: optBool(t.certValidOnExpiryDay, path + '.certValidOnExpiryDay'),
      certWithoutExpiryCounts: optBool(t.certWithoutExpiryCounts, path + '.certWithoutExpiryCounts')
    };
  }

  /* @tax — whether a buyer's exemption certificate counts on the sale date: only when it is unexpired that day; its expiry day itself, and a certificate with no expiry, count only when the tax terms say so. */
  function certStatus(cert, saleDate, t) {
    if (cert === undefined || cert === null) return { counts: false, status: 'none', reason: 'no exemption certificate on file' };
    onlyKeys(cert, CERT_KEYS, 'cert');
    if (cert.expires === undefined || cert.expires === null) {
      return t.certWithoutExpiryCounts
        ? { counts: true, status: 'noExpiry', reason: 'certificate on file with no expiry date, counted (certWithoutExpiryCounts)' }
        : { counts: false, status: 'noExpiry', reason: 'certificate on file has NO expiry date, so it does not count (set certWithoutExpiryCounts to count it)' };
    }
    const exp = isoDate(cert.expires, 'cert.expires');
    if (saleDate < exp) return { counts: true, status: 'valid', reason: 'certificate valid: it expires ' + exp + ', after the sale date ' + saleDate };
    if (saleDate === exp) {
      return t.certValidOnExpiryDay
        ? { counts: true, status: 'expiresToday', reason: 'certificate expires ' + exp + ', the sale date, counted (certValidOnExpiryDay)' }
        : { counts: false, status: 'expiresToday', reason: 'certificate expires ' + exp + ', the sale date itself, so it counts as expired (set certValidOnExpiryDay to count it)' };
    }
    return { counts: false, status: 'expired', reason: 'certificate EXPIRED ' + exp + ', before the sale date ' + saleDate };
  }

  /* @tax @money — tax on already-checked lines: each class rule decides taxable or not, the taxable premium (if premiumTaxed) is rounded once, then the rate is applied once to the whole base and rounded half up once. */
  function taxOf(ls, t, cert, saleDate) {
    const cs = certStatus(cert, saleDate, t);
    const text = ['Tax: ' + pctMilli(t.rateMilliPct) + (t.premiumTaxed ? ', premium taxed' : ', premium NOT taxed') + '. Sale date ' + saleDate + '; ' + cs.reason + '.'];
    let hammerBase = 0, premExact = 0;
    const out = ls.map((l) => {
      const rule = t.rules[l.taxClass];
      if (rule === undefined) refuse('lines (lot ' + l.label + ').taxClass', 'class "' + l.taxClass + '" has no rule in the tax terms; the math never guesses taxable or exempt');
      const taxable = rule === 'taxable' || (rule === 'exemptWithCert' && !cs.counts);
      const why = rule === 'exempt' ? 'exempt class' : rule === 'exemptWithCert' ? (cs.counts ? 'exempt: certificate counts' : 'taxed: no certificate that counts') : 'taxable class';
      if (taxable) {
        hammerBase = sumCents([hammerBase, l.lineCents], 'tax base');
        premExact += l.premExact;
      }
      text.push('  Lot ' + l.label + ' (' + l.taxClass + ', ' + why + '): ' + (taxable ? fmt(l.lineCents) + (t.premiumTaxed ? ' + premium ' + fmtExact(l.premExact, BP_ONE) : '') + ' in the base' : 'not in the base'));
      return { lotNo: l.lotNo, line: l.line, taxClass: l.taxClass, rule: rule, taxable: taxable, why: why };
    });
    const premBase = t.premiumTaxed ? roundNum(premExact) : 0;
    const base = sumCents([hammerBase, premBase], 'tax base');
    const cents = roundMilliPct(base, t.rateMilliPct);
    const exactTax = base * t.rateMilliPct;
    text.push('Tax base ' + fmt(hammerBase) + (t.premiumTaxed ? ' + taxed premium ' + fmt(premBase) : '') + ' = ' + fmt(base) +
      '; x ' + pctMilli(t.rateMilliPct) + ' = ' + fmtExact(exactTax, MILLI_ONE) + (exactTax % MILLI_ONE ? ', rounded half up once' : '') + '. Tax: ' + fmt(cents) + '.');
    return {
      mathVersion: MATH_VERSION, cents: cents, baseCents: base, hammerBaseCents: hammerBase, premiumBaseCents: premBase,
      cert: { counts: cs.counts, status: cs.status, reason: cs.reason }, lines: out, mathText: text.join('\n')
    };
  }

  /* @tax @money — sales tax on one buyer's lines for one sale: class rules (taxable; exempt; exempt only with a certificate that counts on the sale date), the premium in the base only when premiumTaxed, the rate applied once and rounded half up once. */
  function tax(lines, taxTerms, cert, saleDate) {
    const t = checkTaxTerms(taxTerms, 'taxTerms');
    const date = isoDate(saleDate, 'saleDate');
    listOf(lines, 'lines');
    const seen = Object.create(null);
    const ls = lines.map((raw, i) => {
      const p = 'lines[' + i + ']';
      onlyKeys(raw, TAX_LINE_KEYS, p);
      const lotNo = lotText(raw.lotNo, p + '.lotNo');
      const line = raw.line === undefined ? '' : lotText(raw.line, p + '.line');
      if (seen[lotNo + '\u0000' + line]) refuse(p, 'lot ' + lotNo + line + ' appears twice');
      seen[lotNo + '\u0000' + line] = true;
      if (raw.premiumCents !== undefined && raw.premiumExact !== undefined) refuse(p, 'give premiumCents or premiumExact, not both');
      const premExact = raw.premiumExact !== undefined
        ? wholeIn(raw.premiumExact, 0, MAX_CENTS * BP_ONE, p + '.premiumExact')
        : (raw.premiumCents === undefined ? 0 : centsIn(raw.premiumCents, p + '.premiumCents') * BP_ONE);
      return { lotNo: lotNo, line: line, label: lotNo + line, taxClass: oneOf(raw.taxClass, TAX_CLASSES, p + '.taxClass'), lineCents: centsIn(raw.lineCents, p + '.lineCents', 1), premExact: premExact };
    });
    return taxOf(ls, t, cert, date);
  }

  /* ---------- the buyer's invoice ---------- */

  /* @money @invariant — a sale's terms as the invoice reads them: version, a premium table for floor and online (phone and absentee optional), tax terms, and where each rounding happens (premium per line or per invoice; tax per invoice). */
  function checkTerms(T, path) {
    onlyKeys(T, TERMS_KEYS, path);
    wholeIn(T.v, 1, Number.MAX_SAFE_INTEGER, path + '.v');
    const pr = onlyKeys(T.premium, CHANNELS, path + '.premium');
    if (pr.floor === undefined) refuse(path + '.premium.floor', 'is required');
    if (pr.online === undefined) refuse(path + '.premium.online', 'is required');
    const premiumTables = {};
    CHANNELS.forEach((c) => { if (pr[c] !== undefined) premiumTables[c] = checkPrem(pr[c], path + '.premium.' + c); });
    const rd = onlyKeys(T.rounding, ['premium', 'tax'], path + '.rounding');
    return {
      v: T.v, premium: premiumTables, tax: checkTaxTerms(T.tax, path + '.tax'),
      rounding: { premium: oneOf(rd.premium, ['line', 'invoice'], path + '.rounding.premium'), tax: oneOf(rd.tax, ['invoice'], path + '.rounding.tax') }
    };
  }

  /* @money @price — which premium table a line pays: its own channel's, or the floor table for a phone or absentee bid when the terms give that channel none. */
  function premFor(T, channel) { return T.premium[channel] || T.premium.floor; }

  /* @money @refund @invariant — buyer payments, each counted net: a voided or returned (bounced) payment counts 0, a refund comes off the payment it refunds and can never exceed it; a payment id used twice is refused. */
  function checkPayments(list) {
    listOf(list, 'payments');
    const seen = Object.create(null);
    return list.map((raw, i) => {
      const p = 'payments[' + i + ']';
      onlyKeys(raw, PAY_KEYS, p);
      const payId = textIn(raw.payId, p + '.payId');
      if (seen[payId]) refuse(p + '.payId', 'payment ' + payId + ' appears twice');
      seen[payId] = true;
      const cents = centsIn(raw.cents, p + '.cents', 1);
      const method = oneOf(raw.method, PAY_METHODS, p + '.method');
      const voided = optBool(raw.voided, p + '.voided'), returned = optBool(raw.returned, p + '.returned');
      const refunded = raw.refundedCents === undefined ? 0 : centsIn(raw.refundedCents, p + '.refundedCents');
      if (refunded > cents) refuse(p + '.refundedCents', 'a refund (' + fmt(refunded) + ') can never exceed the payment (' + fmt(cents) + ')');
      if (refunded > 0 && (voided || returned)) refuse(p + '.refundedCents', 'a voided or returned payment brought nothing in, so nothing can be refunded from it');
      const netCents = voided || returned ? 0 : cents - refunded;
      return { payId: payId, cents: cents, method: method, voided: voided, returned: returned, refundedCents: refunded, netCents: netCents };
    });
  }

  /* @money @invariant — buyer fees (card, storage, title, other), each a whole amount of at least 1 cent. */
  function checkFees(list) {
    listOf(list, 'fees');
    return list.map((raw, i) => {
      const p = 'fees[' + i + ']';
      onlyKeys(raw, FEE_KEYS, p);
      if (raw.rateBp !== undefined) wholeIn(raw.rateBp, 0, MAX_BP, p + '.rateBp');
      return { kind: oneOf(raw.kind, FEE_KINDS, p + '.kind'), cents: centsIn(raw.cents, p + '.cents', 1) };
    });
  }

  /* @money @ar @invariant — invoice adjustments, signed: a write-off or waiver can only lower what is owed, a correction may go either way, and none is zero. */
  function checkAdjustments(list) {
    listOf(list, 'adjustments');
    return list.map((raw, i) => {
      const p = 'adjustments[' + i + ']';
      onlyKeys(raw, ADJ_KEYS, p);
      const kind = oneOf(raw.kind, ADJ_KINDS, p + '.kind');
      const cents = wholeIn(raw.cents, -MAX_CENTS, MAX_CENTS, p + '.cents');
      if (cents === 0) refuse(p + '.cents', 'an adjustment of zero changes nothing; leave it out');
      if (kind !== 'correction' && cents > 0) refuse(p + '.cents', 'a ' + kind + ' lowers what is owed, so it must be negative, got ' + cents);
      return { kind: kind, cents: cents };
    });
  }

  /* @money @ar — one buyer's invoice for one sale: hammer + premium (by channel) + tax + fees +/- adjustments, less payments net of voided, returned and refunded; disputed (held) lines are listed but never due; write-offs and waivers (forgivenCents, which a statement line carries) may bring the balance to $0.00 and no lower. ctx = {saleDate, cert} for the tax. */
  function invoice(terms, lines, payments, fees, adjustments, ctx) {
    const T = checkTerms(terms, 'terms');
    onlyKeys(ctx, CTX_KEYS, 'ctx');
    const saleDate = isoDate(ctx.saleDate, 'ctx.saleDate');
    const ls = checkLines(lines, 'lines');
    let bidderNo = null;
    ls.forEach((l) => {
      const p = 'lines[' + l.i + ']';
      if (l.outcome !== 'sold') refuse(p, 'lot ' + l.label + ' was not sold (passed or bought back), so it has no place on a buyer\'s invoice');
      oneOf(l.raw.channel, CHANNELS, p + '.channel');
      oneOf(l.raw.taxClass, TAX_CLASSES, p + '.taxClass');
      if (l.raw.bidderNo === undefined) return;
      textIn(l.raw.bidderNo, p + '.bidderNo');
      if (bidderNo !== null && l.raw.bidderNo !== bidderNo) refuse(p + '.bidderNo', 'an invoice is one buyer\'s, but this line is bidder ' + l.raw.bidderNo + ' and an earlier one is bidder ' + bidderNo);
      bidderNo = l.raw.bidderNo;
    });
    const due = ls.filter((l) => !l.held);
    const held = ls.filter((l) => l.held);
    const perLine = T.rounding.premium === 'line';
    let premExactSum = 0;
    const outLines = due.map((l) => {
      const pr = premiumOf(premFor(T, l.raw.channel), l.lineCents, !perLine);
      premExactSum += pr.exact;
      return { lotNo: l.lotNo, line: l.line, label: l.label, lineCents: l.lineCents, channel: l.raw.channel, taxClass: l.raw.taxClass,
        premiumCents: perLine ? pr.cents : null, premiumExact: pr.exact, premiumText: pr.mathText };
    });
    const hammerCents = sumCents(due.map((l) => l.lineCents), 'hammer total');
    const premiumCents = perLine ? sumCents(outLines.map((o) => o.premiumCents), 'premium total') : centsIn(roundNum(premExactSum), 'premium total');
    const taxRes = taxOf(outLines.map((o) => ({ lotNo: o.lotNo, line: o.line, label: o.label, taxClass: o.taxClass, lineCents: o.lineCents,
      premExact: perLine ? o.premiumCents * BP_ONE : o.premiumExact })), T.tax, ctx.cert, saleDate);
    const feeList = checkFees(fees), adjList = checkAdjustments(adjustments), payList = checkPayments(payments);
    const feesCents = sumCents(feeList.map((f) => f.cents), 'fees total');
    const adjCents = adjList.reduce((a, x) => a + x.cents, 0);
    if (adjCents > MAX_CENTS || adjCents < -MAX_CENTS) refuse('adjustments', 'together pass the ' + fmt(MAX_CENTS) + ' ceiling');
    const charges = sumCents([hammerCents, premiumCents, taxRes.cents, feesCents], 'invoice charges');
    const totalCents = charges + adjCents;
    if (totalCents < 0) refuse('adjustments', 'take the invoice below zero (' + fmt(totalCents) + '); a write-off can never exceed what is owed');
    if (totalCents > MAX_CENTS) refuse('adjustments', 'take the invoice total past the ' + fmt(MAX_CENTS) + ' ceiling (' + fmt(totalCents) + ')');
    const paidCents = sumCents(payList.map((p) => p.netCents), 'payments total');
    const balanceCents = totalCents - paidCents;
    /* Forgiveness (write-offs and waivers) is never money in. It may bring what is still owed down to $0.00 and no further:
       forgiving more than is owed would become a refund claim, and a refund is a person's decision (record a correction). */
    const forgivenCents = -adjList.reduce((a, x) => a + (x.kind === 'correction' ? 0 : x.cents), 0);
    const owedBeforeForgiven = balanceCents + forgivenCents;
    if (forgivenCents > Math.max(0, owedBeforeForgiven)) {
      refuse('adjustments', 'write-offs and waivers of ' + fmt(forgivenCents) + ' are more than the ' + fmt(Math.max(0, owedBeforeForgiven)) + ' still owed before them; forgiveness never turns into a refund');
    }

    const text = ['Invoice (terms v' + T.v + ', math version ' + MATH_VERSION + '; premium rounded per ' + T.rounding.premium + ', tax per invoice).'];
    outLines.forEach((o) => {
      text.push('  Lot ' + o.label + ' (' + o.channel + '): hammer ' + fmt(o.lineCents) + '; ' + o.premiumText);
    });
    held.forEach((l) => text.push('  Lot ' + l.label + ': ' + fmt(l.lineCents) + ' HELD (disputed), not due.'));
    text.push('Hammer ' + fmt(hammerCents) + ' + premium ' + fmt(premiumCents) + (perLine ? '' : ' (' + fmtExact(premExactSum, BP_ONE) + ' rounded once)') +
      ' + tax ' + fmt(taxRes.cents) + ' + fees ' + fmt(feesCents) + (adjCents ? ' ' + (adjCents < 0 ? '- ' + fmt(-adjCents) : '+ ' + fmt(adjCents)) + ' adjustments' : '') + ' = total ' + fmt(totalCents) + '.');
    text.push(taxRes.mathText);
    feeList.forEach((f) => text.push('  Fee (' + f.kind + '): ' + fmt(f.cents)));
    adjList.forEach((a) => text.push('  Adjustment (' + a.kind + '): ' + (a.cents < 0 ? '-' + fmt(-a.cents) : '+' + fmt(a.cents))));
    payList.forEach((p) => text.push('  Payment ' + p.payId + ' (' + p.method + ') ' + fmt(p.cents) +
      (p.voided ? ' VOIDED, counts 0' : p.returned ? ' RETURNED, counts 0' : p.refundedCents ? ' less refund ' + fmt(p.refundedCents) + ' = ' + fmt(p.netCents) : '')));
    text.push('Total ' + fmt(totalCents) + ' - paid ' + fmt(paidCents) + ' = balance ' + fmt(balanceCents) + (balanceCents < 0 ? ' (overpaid: the buyer is owed ' + fmt(-balanceCents) + ')' : balanceCents === 0 ? (forgivenCents ? ' (settled, ' + fmt(forgivenCents) + ' of it forgiven, not paid)' : ' (paid in full)') : ' due') + '.');

    return {
      mathVersion: MATH_VERSION, termsV: T.v, saleDate: saleDate, bidderNo: bidderNo, forgivenCents: forgivenCents,
      lines: outLines.map((o) => ({ lotNo: o.lotNo, line: o.line, lineCents: o.lineCents, channel: o.channel, taxClass: o.taxClass, premiumCents: o.premiumCents, premiumExact: o.premiumExact })),
      held: held.map((l) => ({ lotNo: l.lotNo, line: l.line, lineCents: l.lineCents })),
      hammerCents: hammerCents, premiumCents: premiumCents, taxCents: taxRes.cents, tax: taxRes, feesCents: feesCents, adjustmentsCents: adjCents,
      totalCents: totalCents, payments: payList, paidCents: paidCents, balanceCents: balanceCents, mathText: text.join('\n')
    };
  }

  /* ---------- the consignor's settlement statement ---------- */

  /* @money @invariant — settlement deductions (expenses or advances): each a whole amount of at least 1 cent, with only its known fields. */
  function checkDeductions(list, keys, path) {
    listOf(list, path);
    return list.map((raw, i) => {
      const p = path + '[' + i + ']';
      onlyKeys(raw, keys, p);
      const out = Object.assign({}, raw);
      out.cents = centsIn(raw.cents, p + '.cents', 1);
      return out;
    });
  }

  /* @money @invariant — the extra holdback that keeps a consignor from being paid now more than they would be owed if any held line never clears (a sliding rate that falls as the total rises, a no-sale fee larger than the lot fee, a minimum): the worst, over every way the held lines could end (each one paid, or its lot left unsold), of commission + fees - the held hammer that did clear, less the commission and fees already deducted. Exact on the item and line bases, and on the consignor basis up to 16 held lines; past that a safe bound that can only hold back a little more. */
  function extraHoldback(s, ls, held, heldCount, com) {
    const deducted = com.cents + com.feesCents;
    if (heldCount === 0) return { cents: 0, worstCents: deducted };
    const lots = Object.create(null), order = [];
    ls.forEach((l) => {
      if (!lots[l.lotNo]) { lots[l.lotNo] = { held: [], cleared: false }; order.push(l.lotNo); }
      if (held[l.i]) lots[l.lotNo].held.push(l);
      else if (l.outcome === 'sold') lots[l.lotNo].cleared = true;
    });
    const byLot = (fees) => { const m = Object.create(null); fees.forEach((f) => { m[f.lotNo] = (m[f.lotNo] || 0) + f.cents; }); return m; };
    const feesIfSold = byLot(com.fees);
    const feesIfUnsold = byLot(feesOf(s, ls.map((l) => (held[l.i] ? Object.assign({}, l, { outcome: 'passed' }) : l))));
    let worst = 0;
    if (s.basis !== 'consignor') {
      /* Commission is per line here, so the worst case splits lot by lot: in each lot, either none of its held lines clears
         (its fees as an unsold lot, if nothing else in it sold) or the best set of them does (each adds its commission and
         gives back its own hammer). */
      let clearedCom = com.cents;
      order.forEach((k) => {
        const g = lots[k], unsold = feesIfUnsold[k] || 0, sold = feesIfSold[k] || 0;
        if (g.held.length === 0) { worst += unsold; return; }
        const gain = g.held.map((l) => { const c = lineCommission(s, l).cents; clearedCom -= c; return c - l.lineCents; });
        const up = gain.filter((x) => x > 0);
        const best = up.length ? up.reduce((a, x) => a + x, 0) : Math.max.apply(null, gain);
        worst += Math.max(unsold, sold + best);
      });
      worst += clearedCom;
    } else {
      /* One commission on the consignor's total. A lot whose sold lines are all held is "open": its fees depend on whether
         any of them clears. Up to EXACT_HELD held lines, every way they could end is tried (exact). Past that, a safe
         bound: within a bracket, commission - (total - paid total) never rises (a rate is at most 100%, and one more cent
         moves the rounded charge by at most a cent), so its largest value is at the smallest total the held lines could
         add or where a bracket starts; each open lot's fees then take their larger case on their own, which can only hold
         back a little more than the true worst. */
      let paidTotal = 0, anyPaid = false, heldTotal = 0, smallest = MAX_CENTS, fixedFees = 0;
      const heldList = [];
      ls.forEach((l) => {
        if (l.outcome !== 'sold') return;
        if (held[l.i]) { heldList.push(l); heldTotal += l.lineCents; smallest = Math.min(smallest, l.lineCents); } else { paidTotal += l.lineCents; anyPaid = true; }
      });
      const open = order.filter((k) => lots[k].held.length > 0 && !lots[k].cleared);
      order.forEach((k) => { if (open.indexOf(k) < 0) fixedFees += feesIfSold[k] || 0; });
      const comAt = (t) => settle(bracketCharge(s.kind, s.brackets, t).exact, s.minCents, s.capCents).cents;
      if (heldList.length <= EXACT_HELD) {
        worst = -MAX_CENTS * 4;
        for (let m = 0; m < (1 << heldList.length); m++) {
          let t = paidTotal;
          const soldOpen = Object.create(null);
          heldList.forEach((l, j) => { if (m & (1 << j)) { t += l.lineCents; soldOpen[l.lotNo] = true; } });
          let v = (anyPaid || m > 0 ? comAt(t) : 0) + fixedFees - (t - paidTotal);
          open.forEach((k) => { v += soldOpen[k] ? (feesIfSold[k] || 0) : (feesIfUnsold[k] || 0); });
          if (v > worst) worst = v;
        }
      } else {
        let worstCom = anyPaid ? comAt(paidTotal) : 0;
        [paidTotal + smallest].concat(s.brackets.filter((b) => b.uptoCents !== null).map((b) => b.uptoCents + 1)
          .filter((t) => t > paidTotal + smallest && t <= paidTotal + heldTotal))
          .forEach((t) => { worstCom = Math.max(worstCom, comAt(t) - (t - paidTotal)); });
        worst = worstCom + fixedFees;
        open.forEach((k) => { worst += Math.max(feesIfUnsold[k] || 0, feesIfSold[k] || 0); });
      }
    }
    return { cents: Math.max(0, worst - deducted), worstCents: worst };
  }

  /* @money @report — one consignor's settlement statement for one sale, from the contract's stamped schedule: gross (sold lines), commission and schedule fees, expenses, advances, and the holdback the conservative paid rule demands; net = gross - commission - fees - expenses - advances - holdback. A line counts as buyer-paid only when that buyer's WHOLE invoice for the sale is at 0 or less without counting write-offs and waivers as paid (unless the contract says forgivenCountsAsPaid); the holdback also covers the worst case of held lines that never clear. */
  function statement(contract, lines, expenses, advances, unpaidRisk) {
    onlyKeys(contract, CONTRACT_KEYS, 'contract');
    const risk = oneOf(unpaidRisk, RISKS, 'unpaidRisk');
    if (contract.unpaidRisk !== undefined && contract.unpaidRisk !== risk) {
      refuse('unpaidRisk', 'is "' + risk + '" but the contract says ' + show(contract.unpaidRisk) + '; the contract\'s own word is the rule');
    }
    if (contract.charges !== undefined && contract.charges !== null && listOf(contract.charges, 'contract.charges').length > 0) {
      refuse('contract.charges', 'math version 1 does not apply contract charges (their rule is not defined yet); record each one as an expense');
    }
    const forgivenPaid = optBool(contract.forgivenCountsAsPaid, 'contract.forgivenCountsAsPaid');
    const s = checkSched(contract.schedule, 'contract.schedule');
    const ls = checkLines(lines, 'lines');
    const seenHammer = Object.create(null), byBidder = Object.create(null), forgiven = [];
    let consignor = contract.contractId === undefined ? null : textIn(contract.contractId, 'contract.contractId');
    ls.forEach((l) => {
      const p = 'lines[' + l.i + ']';
      if (l.raw.contractId !== undefined) {
        textIn(l.raw.contractId, p + '.contractId');
        if (consignor !== null && l.raw.contractId !== consignor) refuse(p + '.contractId', 'lot ' + l.label + ' is on contract ' + l.raw.contractId + ', not ' + consignor + '; a statement pays one consignor');
        consignor = l.raw.contractId;
      }
      if (l.outcome !== 'sold') return;
      const hid = textIn(l.raw.hammerId, p + '.hammerId');
      if (seenHammer[hid]) refuse(p + '.hammerId', 'hammer ' + hid + ' is on this statement twice; a line is paid once');
      seenHammer[hid] = true;
      const bal = wholeIn(l.raw.buyerBalanceCents, -MAX_CENTS, MAX_CENTS, p + '.buyerBalanceCents');
      if (l.raw.buyerForgivenCents === undefined && !forgivenPaid) {
        refuse(p + '.buyerForgivenCents', 'is required: how much of this buyer\'s invoice was written off or waived (the invoice\'s forgivenCents, 0 if none), because forgiven money is not paid money');
      }
      const forg = l.raw.buyerForgivenCents === undefined ? 0 : centsIn(l.raw.buyerForgivenCents, p + '.buyerForgivenCents');
      forgiven[l.i] = forg;
      if (l.raw.bidderNo === undefined) return;
      const b = textIn(l.raw.bidderNo, p + '.bidderNo'), prev = byBidder[b];
      if (prev && (prev.bal !== bal || prev.forg !== forg)) {
        refuse(p + '.buyerBalanceCents', 'bidder ' + b + ' has one invoice for the sale, but two of its lines here disagree on it (' + fmt(prev.bal) + ' / ' + fmt(prev.forg) + ' forgiven vs ' + fmt(bal) + ' / ' + fmt(forg) + '); the paid rule reads the whole invoice');
      }
      byBidder[b] = { bal: bal, forg: forg };
    });
    const com = commissionOf(s, ls);
    const exp = checkDeductions(expenses, EXPENSE_KEYS, 'expenses');
    const adv = checkDeductions(advances, ADVANCE_KEYS, 'advances');
    const expensesCents = sumCents(exp.map((e) => e.cents), 'expenses total');
    const advancesCents = sumCents(adv.map((a) => a.cents), 'advances total');

    const text = ['Settlement statement' + (contract.contractId ? ' for contract ' + contract.contractId : '') + ' (math version ' + MATH_VERSION + '). Unpaid risk: ' + risk +
      (risk === 'consignor' ? ' (a line waits until its buyer has paid the whole invoice).' : ' (the house pays unpaid lines as if collected).') +
      (forgivenPaid ? ' Write-offs and waivers count as paid (forgivenCountsAsPaid).' : '')];
    let gross = 0, heldLines = 0, heldCount = 0;
    const heldIdx = Object.create(null);
    const outLines = ls.map((l) => {
      if (l.outcome !== 'sold') {
        text.push('  Lot ' + l.label + ': ' + (l.outcome === 'passed' ? 'passed, no sale' : 'bought back at ' + fmt(l.lineCents)) + ', not in gross.');
        return { hammerId: l.raw.hammerId === undefined ? null : l.raw.hammerId, lotNo: l.lotNo, line: l.line, lineCents: l.lineCents, inGross: false, status: l.outcome, buyerPaid: null, heldCents: 0 };
      }
      gross = sumCents([gross, l.lineCents], 'gross');
      const bal = l.raw.buyerBalanceCents, forg = forgiven[l.i];
      const owed = forgivenPaid ? bal : bal + forg;   /* what the buyer would still owe if nothing had been forgiven */
      const paid = owed <= 0;
      let status, heldCents = 0;
      if (l.held) { status = 'disputed'; heldCents = l.lineCents; }
      else if (paid) { status = 'paid'; }
      else if (risk === 'consignor') { status = 'unpaidHeld'; heldCents = l.lineCents; }
      else { status = 'unpaidHouse'; }
      if (heldCents > 0) { heldIdx[l.i] = true; heldCount++; }
      heldLines = sumCents([heldLines, heldCents], 'holdback');
      const owes = bal > 0 ? 'buyer still owes ' + fmt(bal) + ' on the sale' : 'buyer\'s invoice is at ' + fmt(bal) + ' only because ' + fmt(forg) + ' of it was written off or waived, which is not payment';
      const said = status === 'disputed' ? 'DISPUTED, held back'
        : status === 'paid' ? 'buyer paid in full (invoice balance ' + fmt(bal) + (forg && forgivenPaid ? ', ' + fmt(forg) + ' forgiven and counted as paid' : '') + ')'
          : status === 'unpaidHeld' ? owes + ', held back' : owes + ', paid as if collected (house risk)';
      text.push('  Lot ' + l.label + ' (hammer ' + l.raw.hammerId + '): ' + fmt(l.lineCents) + ', ' + said + '.');
      return { hammerId: l.raw.hammerId, lotNo: l.lotNo, line: l.line, lineCents: l.lineCents, inGross: true, status: status, buyerPaid: paid, buyerBalanceCents: bal, buyerForgivenCents: forg, heldCents: heldCents };
    });
    const extra = extraHoldback(s, ls, heldIdx, heldCount, com);
    const holdback = sumCents([heldLines, extra.cents], 'holdback');
    const net = gross - com.cents - com.feesCents - expensesCents - advancesCents - holdback;

    text.push('Gross (sold lines): ' + fmt(gross) + '.');
    text.push(com.mathText.split('\n').map((x) => '  ' + x).join('\n'));
    exp.forEach((e) => text.push('  Expense' + (e.what ? ' (' + e.what + ')' : '') + ': ' + fmt(e.cents)));
    adv.forEach((a) => text.push('  Advance already paid' + (a.ref ? ' (' + a.ref + ')' : '') + ': ' + fmt(a.cents)));
    if (extra.cents > 0) {
      text.push('  Held back a further ' + fmt(extra.cents) + ': if the held lines never clear, commission and fees less the held hammer that does clear could come to ' +
        fmt(extra.worstCents) + ', more than the ' + fmt(com.cents + com.feesCents) + ' deducted here; the difference waits until they clear.');
    }
    text.push(fmt(gross) + ' gross - ' + fmt(com.cents) + ' commission - ' + fmt(com.feesCents) + ' fees - ' + fmt(expensesCents) + ' expenses - ' +
      fmt(advancesCents) + ' advances - ' + fmt(holdback) + ' held back' + (extra.cents ? ' (' + fmt(heldLines) + ' of held lines + ' + fmt(extra.cents) + ' further)' : '') +
      ' = ' + fmt(net) + (net < 0 ? ' (nothing is payable now)' : ' net to the consignor') + '.');

    return {
      mathVersion: MATH_VERSION, contractId: contract.contractId === undefined ? null : contract.contractId, unpaidRisk: risk, forgivenCountsAsPaid: forgivenPaid, lines: outLines,
      grossCents: gross,
      commission: { kind: com.kind, basis: com.basis, brackets: com.brackets, minCents: com.minCents, capCents: com.capCents, cents: com.cents, perUnit: com.perUnit, mathText: com.mathText },
      fees: com.fees, feesCents: com.feesCents, expenses: exp, expensesCents: expensesCents, advances: adv, advancesCents: advancesCents,
      heldLinesCents: heldLines, extraHoldbackCents: extra.cents, holdbackCents: holdback, netCents: net, mathText: text.join('\n')
    };
  }

  return Object.freeze({
    MATH_VERSION: MATH_VERSION,
    MAX_CENTS: MAX_CENTS,
    MAX_BP: MAX_BP,
    MAX_MILLI_PCT: MAX_MILLI_PCT,
    FeeMathError: FeeMathError,
    roundBp: roundBp,
    roundMilliPct: roundMilliPct,
    commission: commission,
    premium: premium,
    tax: tax,
    invoice: invoice,
    statement: statement,
    formatCents: fmt
  });
}));
