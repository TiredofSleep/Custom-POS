# Auction fee math (`packs/auction/feemath.js`)

This is the money math an auction company settles a sale with: what a consignor pays in commission and fees, what a
buyer pays in premium and tax, the buyer's invoice, and the consignor's settlement statement. It is the first piece of
the auction pack, written for an auction customer and kept generic so any auction company can use it.

It is a library with no screens and no storage. It never moves money: it works out the numbers and shows its working,
and a person decides what happens next.

- **One file, no dependencies.** In Node: `const F = require('./packs/auction/feemath.js')`. In a browser, a plain
  `<script src="packs/auction/feemath.js">` sets the global `AuctionFeeMath`.
- **Proofs:** `node tests/auction-feemath.js` (pure Node, no browser). `node run-tests.js` runs it with every other suite.

## The rules it enforces

1. **Whole cents only.** Every amount is a whole number of cents. Rates are whole **basis points** (1000 = 10.00%). Tax
   rates are whole **thousandths of a percent** (9875 = 9.875%).
2. **Rounding is half up, done once**, at the level the rule names: `(cents x bp + 5000) div 10000`. A tax is
   `(cents x rate + 50000) div 100000`. The division is exact whole-number division, so a total never drifts by a cent.
3. **A ceiling of $10,000,000.00.** Every amount, and every total the math adds up, stays at or under it. A sold price is
   at least 1 cent.
4. **Bad input is refused, never fixed up.** A fraction of a cent, a number written as text, NaN, Infinity, a negative
   where none belongs, an amount over the ceiling, a field the rule does not know (a misspelt `capcents` would silently
   drop a cap), an impossible date, a tax class with no rule: each throws a `FeeMathError` with `code: 'FEEMATH_REFUSED'`
   and a `path` naming the field. Nothing is clipped or guessed.
5. **Inputs are never changed**, and the same input always gives the same output. No clock, no randomness, no I/O.
6. **Every result shows its working.** Each one carries `mathVersion: 1` and `mathText`, the arithmetic written out for a
   person to check ("Lot 7: $100.00 x 30.00% + $10.00 x 20.00% = $32.00").

## The functions

### `roundBp(cents, bp)` and `roundMilliPct(cents, rateMilliPct)`
Cents times a rate, rounded half up once. Return whole cents. Refuse a fraction, a negative, a rate above 100%, or cents
above the ceiling.

### `commission(sched, lines)`
One consignor's commission and schedule fees for one sale.

The **schedule** (stamped into the consignor's contract):

| Field | Meaning |
|---|---|
| `kind` | `flat` (one rate), `sliding` (the WHOLE amount at the rate of the bracket it falls in) or `incremental` (each slice at its own rate) |
| `basis` | `item` (each unit's price), `line` (the hammer line's total) or `consignor` (the consignor's sold total in the sale) |
| `brackets` | `[{ uptoCents, bp }]`, bounds rising, **each bound included in its bracket** ("up to $100.00" includes $100.00); the last bracket has `uptoCents: null` |
| `minCents`, `capCents` | optional minimum and cap, applied at the basis's own level: each item, each line, or the consignor's total |
| `lotFeeCents` | optional fee per lot |
| `lotFeeOn` | `sold` (the default: lots that sold) or `offered` (every lot offered) |
| `noSaleFeeCents`, `titledNoSaleFeeCents` | optional fee for a lot that did not sell; the titled amount applies when the lot is titled and the schedule sets one |
| `buybackFee` | optional `{ bp }` (a rate on the buyback price) or `{ cents }` (a flat amount per buyback) |

Each **line** is `{ lotNo, line?, unitCents, qty, mode, passed?, buyback?, titled? }`, where `mode` is `each` (times the
money: the line is `unitCents x qty`), `onemoney` (one price for the whole lot) or `choice` (one line per item taken,
such as 12A and 12B, so `qty` must be 1). `lotNo` is text. A choice or split lot puts its suffix in `line`.

Returns `{ cents, perUnit[], fees[], feesCents, totalCents, mathText, ... }`. `cents` is the commission alone, `feesCents`
the schedule's fees, `totalCents` both. Passed and bought-back lines earn no commission.

### `premium(prem, lineCents)`
The buyer's premium on one hammer line. `prem` is `{ kind?, brackets, minCents?, capCents? }`. A premium with two or
more tiers must say `sliding` or `incremental`, because the math never guesses which one. The minimum and cap apply per
line. Returns `{ cents, exact, clamp, parts[], mathText }`. `exact` is the unrounded amount (in cents x 10000), kept for
an invoice that rounds once over all its lines.

### `tax(lines, taxTerms, cert, saleDate)`
Sales tax on one buyer's lines. `taxTerms` is
`{ rateMilliPct, premiumTaxed, classes, certValidOnExpiryDay?, certWithoutExpiryCounts? }`, and `classes` gives each class
(`general`, `farm`, `titled`, `other`) a rule: `taxable`, `exempt`, or `exemptWithCert` (exempt only with a certificate
that counts on the sale date). The premium is in the base only when `premiumTaxed` is true. The rate is applied once to
the whole base. Each line is `{ lotNo, taxClass, lineCents, premiumCents? }`. `saleDate` is written `YYYY-MM-DD`. Returns
`{ cents, baseCents, cert: { counts, status, reason }, lines[], mathText }`. The certificate's `status` (`valid`,
`expired`, `expiresToday`, `noExpiry`, `none`) lets a screen warn about an expired certificate.

### `invoice(terms, lines, payments, fees, adjustments, ctx)`
One buyer's invoice for one sale:

**balance = hammer + premium + tax + fees +/- adjustments - payments**

- `terms` carries a premium table for `floor` and `online` (with `phone` and `absentee` optional; when a sale has none
  for them, those bids pay the floor's), the tax terms, and `rounding: { premium: 'line' | 'invoice', tax: 'invoice' }`.
- Each line also carries its `channel` and `taxClass`. A line marked `held: true` (disputed, or two hammers on one lot)
  is listed but never due.
- Payments count net. A voided or returned (bounced) payment counts 0. A refund comes off its payment and can never be
  larger than it.
- A write-off or waiver can only lower what is owed. Adjustments can never take the invoice below zero.
- `ctx` is `{ saleDate, cert }`, for the tax.

Returns every part, `totalCents`, `paidCents`, `balanceCents` (negative means overpaid) and `mathText`.

### `statement(contract, lines, expenses, advances, unpaidRisk)`
One consignor's settlement statement for one sale, from the contract's stamped schedule:

**net = gross - commission - fees - expenses - advances - holdback**, so gross = net + commission + fees + expenses +
advances + holdback.

- **gross** is the consignor's sold lines.
- **The paid rule (the conservative one):** a line counts as paid by its buyer only when that buyer's **whole invoice for
  the sale** is at $0.00 or less. Each sold line carries its `hammerId` and its buyer's invoice balance
  (`buyerBalanceCents`).
- Under `unpaidRisk: 'consignor'`, an unpaid line is held back in full. Under `'house'`, the house pays it as if
  collected. A disputed line is held back under both.
- Commission is worked out on every sold line, so when a held line is collected later the consignor is owed exactly the
  held amount.
- A net below zero is shown as it is ("nothing is payable now"), not clipped.

### Also exported
`MATH_VERSION` (1), `MAX_CENTS`, `MAX_BP`, `MAX_MILLI_PCT`, `FeeMathError`, and `formatCents(cents)` ("$1,234.56").

## Choices made where the plan left one open

Each of these is the cautious reading. Where an auction company may reasonably decide otherwise, it is a setting.

| Question | What the math does | To change it |
|---|---|---|
| Does "up to $100.00" include $100.00? | Yes, every bracket bound is included | Write the bound you mean (`9999` for "under $100.00") |
| Lot fee on lots that did not sell? | No, sold lots only, and once per lot (not per choice taking) | `lotFeeOn: 'offered'` |
| Titled no-sale with no titled fee set? | The plain no-sale fee | Set `titledNoSaleFeeCents` |
| A buyback | No commission and no no-sale fee. The buyback fee is per buyback line. Not in gross | |
| One-money and choice lines on an item basis | One unit at the hammer price. A choice line must have qty 1 | |
| A minimum on a consignor who sold nothing | No commission at all | |
| A multi-tier premium with no kind | Refused, never guessed | Say `sliding` or `incremental` |
| Phone and absentee bids with no premium table of their own | The floor table | Give them their own table |
| A certificate on its expiry day | Counts as expired | `certValidOnExpiryDay: true` |
| A certificate with no expiry date | Does not count | `certWithoutExpiryCounts: true` |
| Which classes a certificate covers | Every class marked `exemptWithCert` (mark only the classes the certificate covers) | |
| A tax class with no rule | Refused, never guessed | Give the class a rule |
| Fees in the tax base | Never, in math version 1 | A new math version |
| Taxed premium when the premium rounds per invoice | The taxed lines' exact premium, rounded once, then the tax rounded once | |
| Contract charges (their rule is not defined yet) | Refused; record each as an expense | A new math version |
| Line-by-line payment matching | Not used. Only a whole invoice at $0.00 or less counts as paid | A later version |

## Not in this unit

No facts, hub, screens or storage, and no spreadsheet page (that comes next). No card fee is calculated: a fee arrives as an
amount. No digest of a statement is made. No published vendor example is pinned in the proofs, because none has had all of its
inputs checked yet. Every proof figure is worked by hand in the test file's comments.

## The proofs

`tests/auction-feemath.js` holds 17 proofs: the sliding-vs-incremental headline ($22.00 vs $32.00 on $110.00), inclusive
bracket bounds, the three bases on the same sales, the minimum and cap at each basis, the fees, the premium by channel, tax
with valid, expired and missing certificates, rounding at each level, refusals of bad input, an invoice and a statement worked
end to end, the paid rule, the version stamp and working, purity, the module's shape, the function labels, and a personal-data
guard. Each proof names the failure it prevents and has **negative controls**: copies of `feemath.js` with one rule broken,
which the proof must fail. A test that cannot fail is not evidence.
