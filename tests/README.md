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
