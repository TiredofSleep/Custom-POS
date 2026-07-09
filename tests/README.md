# pos.html engine tests

Browser-driven checks for the [`../pos.html`](../pos.html) engine skeleton. Each script drives the app in a real
Chromium via Playwright and asserts behavior end-to-end (and fails on any console error) — the project standard is
*verify in a browser with zero console errors before calling anything done.*

## What each covers
| Test | Proves |
|---|---|
| `rules-and-fanout.js` | required/suggested modifiers, 86 par-count, routing fan-out, money-blind maker views |
| `timer.js` | timer/SLA service — aging (green→red) and back-scheduled due (OVERDUE) |
| `deposit-and-flags.js` | deposit + balance-due gate; flag engine + acknowledge gate |
| `board-tracker-modules.js` | internal status board, sanitized customer tracker, module registry (stations auto-enable modules) |
| `repair-trade.js` | a THIRD trade (repair shop) running on the same engine by config alone — split path, waiver gate, deposit |
| `tax-receipt.js` | sales tax on the discounted base, discount buttons, printable receipt (subtotal/discount/tax/total) |
| `report.js` | end-of-day Z-report — sales summary, by-tender, by-category, cash-drawer over/short, refund-to-original-tender, labor hours |
| `timeclock.js` | staff PIN clock-in/out, the welcome screen (daily message + specials), on-the-clock list, bad-PIN rejection |
| `builder-timeclock.js` | the builder configures staff (name+PIN), the clock-in message + specials, and a Time Clock station into a live POS |
| `inventory.js` | stock on-hand shown on tiles, low-stock + out-of-stock (tile disabled), Office reorder list, receive-stock replenish |
| `booking.js` | appointments — book a customer/service/time/staff, day schedule, check-in converts a booking into a live order |
| `notify.js` | "text when ready" — processor-agnostic notify seam, template tokens ({name}/{number}/{biz}), sent confirmation |
| `split.js` | split the check evenly N ways — equal shares, mixed cash/card per share, balance clears exactly |
| `house-account.js` | charge to a customer's house account (A/R), report splits A/R from collected, record-payment settles |
| `scan.js` | search/scan box (big menus or scan-enabled) — barcode + Enter rings the item, partial-name filter + Enter rings first match |
| `coupon.js` | named coupon codes (% or $ off) applied at checkout, tax recomputes on the discounted base, clear/reject paths |
| `quotes.js` | save a draft as a quote/estimate, load it back into the order (consuming it), ring it up like any order |
| `kds.js` | interactive kitchen display — live tickets oldest-first with an aging prep timer, Bump fires the ticket ready |
| `report-history.js` | the Z-report is scoped to a single day (fixes counting all history) + pages back through prior days |
| `landing.js` | the customPOS.com landing page — pitch, honest monetization, trust FAQ, feature grid, CTA links, mobile no-overflow |
| `import.js` | bulk item import — paste CSV (name/price/category/barcode), header auto-skip, into the built catalog |
| `backup.js` | data ownership — JSON backup, customers/catalog CSV export, customer CSV import (merge by phone), restore-from-backup |
| `build-stamp.js` | downloads carry a build banner + CUSTOMPOS_BUILD (version/date/business); CLAUDE.md + setup screen show the version |
| `pwa.js` | install-as-app — a branded web manifest, theme-color, apple web-app meta, and a generated home-screen icon |
| `hub-merge.js` | hub conflict resolution (unit) — version-aware last-write-wins: newer `upd` wins, stale push rejected, union add, seq-max |
| `tax-included.js` | VAT-style tax-included pricing — tax extracted from the price (total unchanged), net-of-tax in the report |
| `line-return.js` | line-level returns — refund selected items' share of the total; report nets sales/tax/refunds proportionally |
| `station-reorder.js` | builder flow editing — move a workstation earlier/later reorders the generated flow |
| `pay-server.js` | the standalone payments service — health, auth gate, charge/decline/refund/void/inquire/terminal (sim provider) |
| `floor.js` | floor / table state machine — tables render + color by state, advance through the service flow, jump states, section filter, persistence |
| `coursing.js` | course pacing / hold-until — kitchen sees only fired courses, held courses wait, expo fires the next course |
| `floor-designer.js` | builder floor designer — canvas of tiles, add/edit tables, drag to position (x,y) into the built flow |
| `schedule.js` | staff scheduling — weekly staff×day grid, set shifts, weekly hours + overtime flag, publish→notify, edit un-publishes |
| `breaks.js` | worker-rights breaks + pay — on-shift action screen, start/end unpaid break, real-time earnings ($/h), meal-break reminder surfaced after 5h (worker-protective default) |
| `turns.js` | table turn-time analytics — a turn runs from seated→cleared, floor shows turns today / average turn / covers served, cleared table returns to empty |
| `timeoff.js` | time-off requests — worker requests a day off, manager queue + approve/deny, approved day shows OFF and blocks scheduling (worker-protective), cancel restores it |
| `coverage.js` | shift coverage — offer a shift for coverage (↔ marker), reassign it to an eligible co-worker (skips anyone off/already-scheduled, flags OT), the shift moves |
| `incident.js` | worker safety — on-shift incident report + a panic "get help now" alert (notify seam), manager incident log in the Z-report with open count + acknowledge |
| `worker.js` | worker portal — PIN login to a personal dashboard (my week / hours / earnings), self-serve claim of an offered shift, request a day off, log out |
| `tippool.js` | tip pooling — the day's tips shared by hours worked, split shown in the Z-report (Alex $15 / Sam $5 for 3h:1h of $20) and each worker's share on their portal |
| `labor-cost.js` | owner survival metric — labor cost (hours × wage) and labor as a % of sales in the Z-report, with a high-share flag when payroll outruns the target |
| `winback.js` | win-back list — regulars not seen in N+ days surfaced in the report (excludes recent visitors), one-tap invite over the notify seam marks them invited |
| `margin.js` | cost of goods + gross margin — item cost drives a Z-report margin card (net − COGS = gross profit, margin %); only shows when items carry a cost |
| `paystub.js` | worker pay estimate — the portal splits clocked hours into regular + overtime (1.5× premium visible), adds tips, and shows an estimated gross |
| `top-items.js` | top items — the report ranks sold items by revenue with per-item margin (when costs are known), so owners can see winners vs losers |
| `busy-hours.js` | sales by hour — the report buckets net sales into hour bars and flags the busiest hour, so staffing can match demand |
| `rest-break.js` | rest-break reminder — after a stretch with no break at all (restEveryHrs), the on-shift screen nudges a short breather; taking a break clears it |
| `guided.js` | the guided setup interview — Shape → Name → **Menu (your own items, edit + paste-a-list)** → People → Pay → Run; "I have a team" bakes in the worker suite (time-clock + scheduling + portal) and pooled tips, and the owner's own catalog ships in the downloaded POS; the `?guided` deep-link opens it directly |
| `worker-signin.js` | worker portal stay-signed-in — PIN login persists per device (survives reload), log out clears it, and unchecking "keep me signed in" makes it session-only |
| `kudos.js` | shout-outs — a worker sends a teammate a kudos from the portal; the recipient sees it on their portal and is greeted with it at clock-in |
| `report-headline.js` | the "how today went" verdict — the report leads with one plain-language line fusing sales, gross margin, and labor % (color-coded good/watch) |
| `roundup.js` | round up for charity — checkout offers to round the total up to the next dollar for a named cause; the donation adds to the balance and the report tallies the community total |
| `age-check.js` | age-restricted items (gas / convenience / liquor) — a 21+/18+ item blocks payment until a photo-ID check is confirmed; unrestricted orders ring straight through |

## Running
Needs `playwright-core` and a Chromium binary. Each script reads `CHROMIUM_EXE` (falling back to a default path);
set it to your Chromium executable.

```bash
npm i -D playwright-core
CHROMIUM_EXE=/path/to/chromium node tests/rules-and-fanout.js
# or run all:
for t in tests/*.js; do CHROMIUM_EXE=/path/to/chromium node "$t" || echo "FAIL $t"; done
```

Exit code is non-zero on any failed assertion or console error.
