# 🍽️ Restaurant POS — capability map & roadmap

*What a full restaurant POS actually needs (measured against Toast / Square for Restaurants / Aloha / TouchBistro
/ Revel), scored against what the customPOS engine already does, and a build order so the vertical is driven by a
plan — not spelled out feature by feature.*

> Read with [RESTAURANT-VERTICAL.md](RESTAURANT-VERTICAL.md) (engine design) and
> [BURGER-BARN-STAGE.md](BURGER-BARN-STAGE.md) (the Stage-2 proving ground + Toast grievance capture).

**Legend:** ✅ built · 🟡 partial / close · ❌ not yet. Status verified against `pos.html` and the `tests/` suite
(the test names in parentheses are the proof it exists).

## 1. Front of house / the server flow
| Capability | Status | Notes |
|---|---|---|
| Take & send orders from a station | ✅ | central "server" station (`rules-and-fanout`) |
| Floor plan, sections, drag-drop designer | ✅ | `floor.js`, `floor-designer.js` |
| Table states (open→seated→ordered→…) + turn timing + covers | ✅ | `floor.js`, `turns.js` |
| Coursing — apps/drinks first, fire entrées, add dessert later | ✅ | `coursing.js` |
| **Order by SEAT number** (seat 2's ribeye) | ✅ | seat picker at intake; seat rides the line → KDS/station/ticket/check (`seat-order.js`) |
| Split the check | ✅ | even 2/3/4-way **and by seat** (`split.js`, `split-seat.js`) |
| **Per-seat checks** (each guest pays their own) | ✅ | "By seat" at payment; tenders tagged to the seat (`split-seat.js`) |
| Transfer / merge tables, move a guest | ✅ | move a check to another table (transfer/merge); per-line seat move (`table-transfer.js`) |
| Server assignment (sections → a server, "my tables") | ✅ | assign a server to a table; "my tables" floor filter (`server-assign.js`) |
| Reservations + waitlist | ✅ | host stand on the floor: book/seat/cancel + waitlist add/seat/clear (`reservations.js`) |

## 2. Kitchen / expo
| Capability | Status | Notes |
|---|---|---|
| Per-item station routing / fan-out | ✅ | one order → grill + fry + bar (`rules-and-fanout`) |
| Kitchen Display (KDS) with aging timers + bump | ✅ | `kds.js` |
| Printed kitchen tickets routed by station | ✅ | `print.js` |
| 86 / par counts | ✅ | live, blocks the item everywhere |
| Course fire / hold to the line | ✅ | `coursing.js` |
| Allergen / prep flags on the ticket | ✅ | item `flags` |
| Seat # shown on the KDS ticket | 🟡 | rides on the seat build |

## 3. Menu & items
| Capability | Status | Notes |
|---|---|---|
| Categories + Toast-style category tabs | ✅ | new (PR #5) |
| Modifiers (required/optional), add-ons, price deltas | ✅ | e.g. Patty single/double, cheese, bacon |
| Combos / upsell ("make it a combo") | ✅ | add-on combos |
| Open price / by-weight | ✅ | `custom-price.js`, `by-weight.js` |
| **Day-part menus** (breakfast till 11) | ✅ | item `avail` window hides it off-hours (`dayparts.js`) |
| **Time-based / happy-hour pricing** | ✅ | item `happyPrice` + shop `happyHour` window (`dayparts.js`) |

## 4. Payments & checkout
| Capability | Status | Notes |
|---|---|---|
| Cash w/ change, card | ✅ | `cash-change.js`, `payments.js`, `idempotent-charge.js` |
| Tips + presets + **tip pooling** | ✅ | `tippool.js` |
| Discounts / coupons | ✅ | `coupon.js` |
| **Comps** (free item, reason-coded, manager-approved) | ✅ | per-line "comp"/"un-comp", reason + audit; approval opt-in (`comp.js`) |
| Voids / returns with audit + manager approval | ✅ | `line-return.js`, `approvals.js` |
| Gift cards + loyalty points | ✅ | `loyalty-giftcards.js` |
| House accounts / A/R, deposits, round-up | ✅ | `house-account.js`, `deposit-*.js`, `roundup.js` |
| Receipt — print & email | ✅ | `print.js`, `notify.js`, `tax-receipt.js` |
| **Pay-at-table / QR pay** | 🟡 | needs a hosted pay page (hub) the guest's phone loads — not a single-file engine feature |

## 5. Order types
| Capability | Status | Notes |
|---|---|---|
| Dine-in | ✅ | |
| Takeout / to-go | ✅ | |
| Own delivery routes (driver, stops, confirm) | ✅ | `route.js` |
| **Drive-thru mode** | ✅ | order types (dine-in/to-go/drive-thru) on the ticket + KDS (`order-types.js`) |
| **3rd-party delivery (DoorDash/UberEats) intake** | 🟡 | engine has the `channel` hook + chip; ingestion needs the hub + a merchant delivery account |
| **Online ordering / QR menu** | 🟡 | needs a hosted customer-facing page (hub), not a single-file engine feature |

## 6. Staff & labor
| Capability | Status | Notes |
|---|---|---|
| PIN login + roles | ✅ | |
| Time clock, breaks, schedule, time-off | ✅ | `timeclock.js`, `breaks.js`, `schedule.js`, `timeoff.js` |
| Labor cost vs sales, paystubs | ✅ | `labor-cost.js`, `paystub.js` |
| Manager approvals (voids/refunds/comps) | ✅ | `approvals.js` |

## 7. Inventory, reporting, back office
| Capability | Status | Notes |
|---|---|---|
| Stock tracking, reorder, low-stock, margin | ✅ | `inventory.js`, `margin.js` |
| Sales / top items / P&L / expenses | ✅ | `report-*.js`, `top-items.js`, `expenses-pnl.js` |
| Busy hours + table-turn analytics | ✅ | `busy-hours.js`, `turns.js` |
| Activity / audit log + CSV | ✅ | `activity-log.js` |
| Multi-store | ✅ | `multistore.js` |
| Accounting export (QuickBooks) | 🟡 | exists on the Ozark instance; not in the shared engine |

## 8. Compliance, platform & reliability (already strong)
| Capability | Status | Notes |
|---|---|---|
| Age gate by **typed birthdate** (computes age, refuses under-age) | ✅ | new (PR #5); `age-gate.js`, `age-check.js` |
| Tax: rate, zones, tax classes, tax-included | ✅ | `tax-*.js` |
| Offline-first single file / PWA | ✅ | `pwa.js`, `first-run.js` |
| Sync hub + delta + conflict merge, multi-register | ✅ | `sync.js`, `delta-*.js`, `hub-merge.js` |
| Encrypted, verified backups | ✅ | `backup*.js` |
| Crash/incident reporting + security guards | ✅ | `crash-reporter.js`, `injection.js`, `blob-guard.js` |

---

## The gap list (what a full-service line still needs)
Everything not ✅ above, collected:

1. **Order by seat number** (+ seat on the KDS ticket)
2. **Split & pay by seat / by item** (not just even N-way)
3. **Comps** — free item, reason-coded, manager-approved (separate from a discount)
4. **Server assignment** — sections/tables owned by a server; a "my tables" view
5. **Transfer / merge tables**, move a guest between seats/tables
6. **Day-part menus + happy-hour / time-based pricing**
7. **Reservations + waitlist**
8. **Pay-at-table / QR pay**
9. **Online ordering / QR menu**, and 3rd-party delivery intake
10. **Drive-thru mode** (only if a concept needs it)

## Build order (proposed)
Sequenced by daily value to a sit-down burger place like Hamburger Barn, and by how much each unlocks the rest.

- **P1 — the heart of the server flow**
  1. ✅ Seat-numbered ordering (assign each line to a seat; seats show on the ticket & KDS) — *shipped*
  2. ✅ Split & pay **by seat** — *shipped* (by-item split is a later refinement)
  3. ✅ Comps with reason (+ opt-in manager approval) — *shipped*
- **P2 — runs a real dining room**
  4. ✅ Server assignment + "my tables" — *shipped*
  5. ✅ Transfer / merge tables, move a guest — *shipped*
  6. ✅ Day-part menus + happy-hour pricing — *shipped*
- **P3 — reservations & the door**
  7. ✅ Reservations + waitlist — *shipped*
- **P4 — off-premise & self-serve**
  10. ✅ Drive-thru (order types: dine-in / to-go / drive-thru) — *shipped*
  8/9. Pay-at-table / QR pay · online ordering / QR menu · 3rd-party delivery intake — **need the hub + a
       hosted customer-facing page + (for delivery) the merchant's own accounts.** These are honestly *not*
       single-file engine features: the engine side is ready (an order `channel` hook + chip so an online or
       delivery order displays and routes like any other), but the customer-facing web + processor + delivery
       API are a hub/hosting/account project, sequenced after Burger Barn's on-premise flow proves out.

Each item ships through the safety pipeline (draft → gates/tests → live preview → owner approval → deploy → rollback),
with a test pinning the behavior — same as every change in this repo.

## How this changes the way we work
This doc is the plan of record: the build runs **down this list**, and the owner **steers** (reprioritize, veto,
add from real Burger Barn grievances) instead of spelling each feature out. When the owner works Toast at Burger
Barn, grievances captured in [BURGER-BARN-STAGE.md](BURGER-BARN-STAGE.md) get slotted into this order.
