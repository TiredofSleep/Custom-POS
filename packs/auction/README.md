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
3. **A ceiling of $10,000,000.00.** Every amount, and every total the math adds up (an invoice total and a statement's
   holdback included), stays at or under it. A sold price is at least 1 cent. A quantity may be up to 1,000,000,000 (the
   plan sets no quantity limit, so the same number is reused and the money ceiling does the real work).
4. **Bad input is refused, never fixed up.** A fraction of a cent, a number written as text, NaN, Infinity, a negative
   where none belongs, an amount over the ceiling, a field the rule does not know (a misspelt `capcents` would silently
   drop a cap), an impossible date, a tax class with no rule, a value that could mean two things (a cap of $0.00): each
   throws a `FeeMathError` with `code: 'FEEMATH_REFUSED'` and a `path` naming the field. Nothing is clipped or guessed.
5. **Inputs are never changed**, and the same input always gives the same output. No clock, no randomness, no I/O.
6. **Every result shows its working.** Each one carries `mathVersion: 1` and `mathText`, the arithmetic written out for a
   person to check ("Lot 7: $100.00 x 30.00% + $10.00 x 20.00% = $32.00"). The working always adds up to the number
   charged: when an invoice rounds its premium once, no line claims a rounding of its own.

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
| `minCents`, `capCents` | optional minimum and cap, applied at the basis's own level: each item, each line, or the consignor's total. A cap of $0.00 is refused (leave it out for no cap; write the rate as bp 0 for no commission) |
| `lotFeeCents` | optional fee per lot |
| `lotFeeOn` | `sold` (the default: lots that sold) or `offered` (every lot offered) |
| `noSaleFeeCents`, `titledNoSaleFeeCents` | optional fee for a lot that did not sell; the titled amount applies when the lot is titled and the schedule sets one. A titled fee of $0.00 is refused (leave it out and titled lots pay the plain fee) |
| `buybackFee` | optional `{ bp }` (a rate on the buyback price) or `{ cents }` (a flat amount per buyback). A rate on a buyback with no price is refused |

Each **line** is `{ lotNo, line?, unitCents, qty, mode, passed?, buyback?, titled? }`, where `mode` is `each` (times the
money: the line is `unitCents x qty`), `onemoney` (one price for the whole lot) or `choice` (one line per item taken,
such as 12A and 12B, so `qty` must be 1). `lotNo` is text with no space at either end; a choice or split lot puts its
suffix in `line`. Two spellings that print the same (`12A`, and `12` with line `A`) are refused, and so is a buyback
that says `passed: false`.

Returns `{ cents, perUnit[], fees[], feesCents, totalCents, mathText, ... }`. `cents` is the commission alone, `feesCents`
the schedule's fees, `totalCents` both. Passed and bought-back lines earn no commission.

### `premium(prem, lineCents)`
The buyer's premium on one hammer line of at least 1 cent. `prem` is `{ kind?, brackets, minCents?, capCents? }`. A
premium with two or more tiers must say `sliding` or `incremental`, because the math never guesses which one. The minimum
and cap apply per line (a cap of $0.00 is refused). Returns `{ cents, exact, clamp, parts[], mathText }`. `exact` is the
unrounded amount after the minimum and cap (in cents x 10000), kept for an invoice that rounds once over all its lines.

### `tax(lines, taxTerms, cert, saleDate)`
Sales tax on one buyer's lines. `taxTerms` is
`{ rateMilliPct, premiumTaxed, classes, certValidOnExpiryDay?, certWithoutExpiryCounts? }`, and `classes` gives each class
(`general`, `farm`, `titled`, `other`) a rule: `taxable`, `exempt`, or `exemptWithCert` (exempt only with a certificate
that counts on the sale date). The premium is in the base only when `premiumTaxed` is true. The rate is applied once to
the whole base. Each line is `{ lotNo, taxClass, lineCents (at least 1 cent), premiumCents? }`. `saleDate` is written
`YYYY-MM-DD`. Returns `{ cents, baseCents, cert: { counts, status, reason }, lines[], mathText }`. The certificate's
`status` (`valid`, `expired`, `expiresToday`, `noExpiry`, `none`) lets a screen warn about an expired certificate.

### `invoice(terms, lines, payments, fees, adjustments, ctx)`
One buyer's invoice for one sale:

**balance = hammer + premium + tax + fees +/- adjustments - payments**

- `terms` carries a premium table for `floor` and `online` (with `phone` and `absentee` optional; when a sale has none
  for them, those bids pay the floor's), the tax terms, and `rounding: { premium: 'line' | 'invoice', tax: 'invoice' }`.
  Rounded per invoice, the premium is the exact sum of the line premiums (each after its own minimum and cap) rounded
  once, and the taxed premium is the taxable lines' exact premium rounded once.
- Each line also carries its `channel` and `taxClass`. A line marked `held: true` (disputed, or two hammers on one lot)
  is listed but never due. If lines carry a `bidderNo`, they must all name the same buyer.
- Payments count net. A voided or returned (bounced) payment counts 0. A refund comes off its payment, can never be
  larger than it, and is refused on a voided or returned payment.
- A write-off or waiver can only lower what is owed, and together they may bring the balance to $0.00 and **no lower**:
  forgiving more than is still owed would become a refund claim, which is a person's decision. The total of write-offs
  and waivers comes back as `forgivenCents`.
- Adjustments can never take the invoice below zero or past the ceiling.
- `ctx` is `{ saleDate, cert }`, for the tax.

Returns every part, `totalCents`, `paidCents`, `balanceCents` (negative means overpaid), `forgivenCents` and `mathText`.

### `statement(contract, lines, expenses, advances, unpaidRisk)`
One consignor's settlement statement for one sale, from the contract's stamped schedule:

**net = gross - commission - fees - expenses - advances - holdback**, so gross = net + commission + fees + expenses +
advances + holdback.

- **gross** is the consignor's sold lines.
- **The paid rule (the conservative one):** a line counts as paid by its buyer only when that buyer's **whole invoice for
  the sale** is at $0.00 or less **without counting write-offs and waivers as payment**. Each sold line carries its
  `hammerId`, its buyer's invoice balance (`buyerBalanceCents`) and how much of that invoice was forgiven
  (`buyerForgivenCents`, the invoice's `forgivenCents`; 0 if none). A buyer who paid $600 of a $1,100 invoice and had the
  rest written off has not paid for a $1,000 lot. The contract setting `forgivenCountsAsPaid: true` counts forgiveness as
  paid instead (then `buyerForgivenCents` may be left out).
- Lines that name the same `bidderNo` must agree on its balance and forgiven amount, and a line that names a `contractId`
  must be on this statement's contract.
- Under `unpaidRisk: 'consignor'`, an unpaid line is held back in full. Under `'house'`, the house pays it as if
  collected. A disputed line is held back under both.
- Commission is worked out on every sold line, so when every held line is collected the consignor is owed exactly what
  was held back.
- **The further holdback.** A held line may never clear (a hammer is voided, a lot comes back unsold). Then the consignor
  is owed commission and fees on what is left, and that can be **more** than was deducted: a sliding rate that falls as
  the total rises, a no-sale fee larger than the lot fee, a minimum larger than the hammer. The statement holds that
  difference back too (`extraHoldbackCents`, beside `heldLinesCents`), so nothing is paid now that a later statement
  would take back. It is the worst case over every way the held lines could end, exact on the item and line bases and,
  on the consignor basis, for up to 16 held lines. Past 16 on the consignor basis a safe bound is used, which can hold
  back somewhat more than the exact worst case (in testing, about one lot's no-sale fee). Whatever is held back is
  released when the lines clear.
- A net below zero is shown as it is ("nothing is payable now"), not clipped.

### Also exported
`MATH_VERSION` (1), `MAX_CENTS`, `MAX_BP`, `MAX_MILLI_PCT`, `FeeMathError`, and `formatCents(cents)` ("$1,234.56").

## Choices made where the plan left one open

Each of these is the cautious reading. Where an auction company may reasonably decide otherwise, it is a setting.

| Question | What the math does | To change it |
|---|---|---|
| Does "up to $100.00" include $100.00? | Yes, every bracket bound is included | Write the bound you mean (`9999` for "under $100.00") |
| Lot fee on lots that did not sell? | No, sold lots only, and once per lot (not per choice taking) | `lotFeeOn: 'offered'` |
| Titled no-sale with no titled fee set? | The plain no-sale fee. A titled fee of $0.00 is refused as ambiguous | Set `titledNoSaleFeeCents` |
| A cap of $0.00 | Refused: it would zero every charge | Leave the cap out, or write bp 0 |
| A buyback | No commission and no no-sale fee. The buyback fee is per buyback line. Not in gross. A rate fee needs a price | |
| One-money and choice lines on an item basis | One unit at the hammer price. A choice line must have qty 1 | |
| How large a quantity? | Up to 1,000,000,000; the $10,000,000.00 money ceiling is the real limit | |
| A minimum on a consignor who sold nothing | No commission at all | |
| A multi-tier premium with no kind | Refused, never guessed | Say `sliding` or `incremental` |
| Phone and absentee bids with no premium table of their own | The floor table | Give them their own table |
| A certificate on its expiry day | Counts as expired | `certValidOnExpiryDay: true` |
| A certificate with no expiry date | Does not count | `certWithoutExpiryCounts: true` |
| Which classes a certificate covers | Every class marked `exemptWithCert` (mark only the classes the certificate covers) | |
| A tax class with no rule | Refused, never guessed | Give the class a rule |
| Fees in the tax base | Never, in math version 1 | A new math version |
| Taxed premium when the premium rounds per invoice | The taxed lines' exact premium, rounded once, then the tax rounded once | |
| Is a written-off or waived invoice "paid" for the consignor? | No: forgiveness is not payment, so the consignor's line waits (consignor risk) | Contract `forgivenCountsAsPaid: true` |
| Forgiving more than is owed | Refused; forgiveness stops at $0.00 | Record a correction (a person's decision) |
| A held line that may never clear | Held back in full, plus the worst case of the commission and fees it could leave owing | |
| Contract charges (their rule is not defined yet) | Refused; record each as an expense | A new math version |
| Line-by-line payment matching | Not used. Only a whole invoice at $0.00 or less counts as paid | A later version |

## Questions to settle with the auction company

Each has a cautious default today; the answer becomes a setting, not a rewrite.

1. Does a write-off or waiver count as the buyer having paid, for paying the consignor? (Default: no. `forgivenCountsAsPaid`.)
2. Is an exemption certificate good through its expiry date, or expired on it? (Default: expired on it. `certValidOnExpiryDay`.)
3. Does a certificate with no expiry date count? (Default: no. `certWithoutExpiryCounts`.)
4. Is the lot fee charged on every lot offered, or only on lots that sell? (Default: sold only. `lotFeeOn`.)
5. Should a titled lot that does not sell pay a different no-sale fee, and could it ever be free? (Default: the plain fee; $0.00 is refused.)
6. How large can one consignor's sale be? Totals past $10,000,000.00 are refused today.
7. Are contract charges (advertising, trucking and so on) ever a percentage of gross, or always flat? Until that is known they go in as expenses.

## Not in this unit

No facts, hub, screens or storage, and no spreadsheet page (that comes next). No card fee is calculated: a fee arrives as an
amount. No digest of a statement is made. No published vendor example is pinned in the proofs, because none has had all of its
inputs checked yet. Every proof figure is worked by hand in the test file's comments.

## The proofs

`tests/auction-feemath.js` holds 24 proofs: the sliding-vs-incremental headline ($22.00 vs $32.00 on $110.00), inclusive
bracket bounds, the three bases on the same sales, the minimum and cap at each basis, the fees, the premium by channel, tax
with valid, expired and missing certificates, rounding at each level, refusals of bad input, an invoice and a statement worked
end to end, the paid rule, the version stamp and working, purity, the module's shape, the function labels, a personal-data
guard, and, from a second look by an independent reference build, a differential fuzz and a code review: the premium rounded
once over capped lines with the premium taxed, fee edges, large quantities, the further holdback (checked by brute force over
every way the held lines could end), forgiveness that is not payment, working that matches the number, and one buyer / one
consignor / one spelling per lot. Each proof names the failure it prevents and has **negative controls**: copies of
`feemath.js` with one rule broken, which the proof must fail. A test that cannot fail is not evidence.
