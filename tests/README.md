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
