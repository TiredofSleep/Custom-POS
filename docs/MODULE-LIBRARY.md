# customPOS — the Module Library (primitives + packs)

*Mined from 12 industry veterans (~230 "can't-run-without-it" features). The finding: that depth collapses to
**~14 configurable primitives**. A salon's color timer, a cleaner's promise clock, a repair shop's parts-aging,
a restaurant's ticket SLA, and a pet dryer's heat cap are all **one timer service** with different settings. The
difference between trades is overwhelmingly **config data, not new code** — which is exactly what lets one free
engine match paid vertical software.*

## Three library layers (on the Customer → stations → Payment spine)

**Layer 1 — Primitives kernel (the engine).** ~14 mechanisms, each shipped once, config-driven, with no trade
knowledge baked in. Everything above is data that drives these:

| # | Primitive | What it is | Configured by |
|---|---|---|---|
| 1 | **Timer / SLA countdown** | a named clock on any order/line/entity/station | duration source (fixed / per-item / back-scheduled due-date / open-aging) + threshold stages + fire-action |
| 2 | **Par-count & 86 broadcast** | remaining-count that decrements, warns, auto-disables at zero, broadcasts everywhere | starting par + low threshold + what it disables + channels |
| 3 | **Line-item routing / fan-out** | splits one order into parallel streams by line attribute | routing rules (attr → destination) + station/printer/vendor map |
| 4 | **Hold-and-fire staging gate** | parks a line/order, releases on command/timer/condition | fire trigger + wait stage + who may fire |
| 5 | **Companion require/suggest** | force a required choice (block) or offer add-ons (prompt) | trigger item → required vs suggested + block/prompt + upcharge |
| 6 | **Contextual upsell prompt** | dismissible add-on at a chosen moment; logs declines to resurface | trigger moment + suggestion set + upcharge + resurface rule |
| 7 | **Flag / attribute engine** | tags on order/line/customer/asset; render bold, require-ack, or hard-block | flag vocab + where shown + block/ack/display + transient/persistent |
| 8 | **Checklist & gated-step** | ordered steps, can capture photo/count/signature, can gate a transition | step list + which block + capture type + schedule |
| 9 | **Capacity & pacing throttle** | meters demand vs capacity; caps bookings/intake, drips queue, quotes wait | capacity unit + window + drip rate + lead-time + quote formula |
| 10 | **Money math & split** | one calculator for commission/tip-pool/piecework/change/tax-mode/markup/deposit | the formula per money event |
| 11 | **Status broadcast & notify** | one state machine drives the internal board, ready-text, and public tracker | state list + who sees each + which transitions notify the customer |
| 12 | **Quick-tile / fast-entry grid** | one-tap tiles for top items/bundles; variant-matrix & scale tiles are the same grid | which items are tiles + layout + payload (line/bundle/matrix/weight) |
| 13 | **Deposit & balance ledger** | prepaid money-state; take deposit, track balance, gate release; store-credit is the reverse | deposit rule + release-gate strictness + refundable/applied + ties |
| 14 | **Entity profile & history recall** | persistent memory on customer/vehicle/pet/garment; auto-apply prefs, one-tap "the usual" | fields held + auto-apply vs suggest + recall/reorder action |

**Layer 2 — Cross-industry common packs.** Pre-wired bundles most trades reuse verbatim — each a small config
template over Layer-1 primitives plus a shared UI view (a board, a countdown chip, a checkout prompt):
`ready-status board + auto-text` · `sold-out/86 countdown` · `promise-by clock` · `approval-or-deposit-before-work`
· `commission/tip split` · `aging/abandonment clock` · `open/close/QC checklists` · `quick-tiles` · `loyalty` ·
`gift-receipt/store-credit` · `profile recall`. *(These recurred across 6+ trades each — see the cross-industry
list in the research.)*

**Layer 3 — Per-trade feature packs.** One config bundle per trade = which primitives are on + their
durations/thresholds/rate-tables/station-maps/flag-vocab/checklist-steps/tile-layouts, plus **at most one or two**
genuinely trade-unique modules that aren't just config (dry-cleaner per-piece durable tag + in/out reconciliation;
auto DVI photo-to-estimate; salon interleaved gap-booking; boutique size×color matrix; pet brachycephalic
heat-lock). **A trade ships as a JSON profile + a handful of custom modules.** The dry cleaner is reference profile #1.

## Engine components these imply (beyond the Flow runtime)
- A **rules/trigger evaluator**: `WHEN (item added / state change / time elapsed / count hits zero / condition) THEN
  (require choice, suggest add-on, route, block transition, notify, apply price)` — *one* evaluator powers
  require/suggest, upsell, 86-at-zero, approval gates, and timer fire-actions.
- A first-class **timer service** (fixed / per-item / back-scheduled / open-aging), persistent across restarts and
  shared through the hub so every station sees the same clock.
- An **event bus / broadcast layer** so any state or par-count change fans out to all terminals, boards, and the
  customer portal/SMS in real time. *(The hub sync + public portal + SMS seam already ARE this — generalize them.)*
- A **money/formula engine**, a **deposit/balance ledger**, a **profile/entity store**, a **checklist/gate engine**,
  and a **capacity/pacing service** — each the single home of its primitive.
- **Offline-first** local queue with deterministic sync-on-reconnect and per-session/location scoping.
- **Kernel invariants** (not per-trade code): print-routing follows the ORDER's attributes never the workstation;
  card secrets hub-only; money-moving actions gated; every trade profile obeys these the same way.

## Data-as-config rule (why Brayden can run it)
Par-counts, timers, deposits, flags, and checklist steps live as **data on the order/DB**, not code paths — so
86-ing an item, changing a turnaround time, or adding an allergen flag is an **owner setting**, not a developer task.

## Build sequence (from the synthesis)
1. Extract the **timer, status-machine, par-count/broadcast, routing, money-split** primitives from the origin app.
2. Express the **dry cleaner as a pure config profile** over them (reference Layer-3).
3. Add the **deposit-ledger, checklist-gate, profile-recall** primitives.
4. Prove it by standing up a **second trade** (coffee or repair) as config-only + at most one custom module.

*Ideas that arrive from real owners (see [IDEAS.md](IDEAS.md)) get mapped onto a primitive here, then shipped to
every trade at once.*
