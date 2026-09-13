# 🗣️ What restaurant operators want changed — market research

*Grievances and feature-wants gathered from restaurant-POS reviews and forums (Toast, Square for Restaurants,
Aloha, Clover, Lightspeed, TouchBistro) — mapped to what customPOS already does, so the roadmap is driven by what
real operators complain about, not guesswork. Sources at the bottom. (This is captured **as data** — the point is
the pattern of complaints, not any one review.)*

> Companion to [RESTAURANT-ROADMAP.md](RESTAURANT-ROADMAP.md) (our capability map) and
> [BURGER-BARN-STAGE.md](BURGER-BARN-STAGE.md) (grievance capture on-site). **Legend:** ✅ we already answer it ·
> 🟡 partial · 🆕 a gap worth building.

## The megatheme: lock-in & cost — and it's *our whole pitch*
This is the #1 thing operators say they'd change, on every platform. It is precisely what the sovereign model
exists to answer — so this isn't a to-build list, it's the sales story, already true:

| What operators hate | customPOS |
|---|---|
| **Proprietary hardware** — must buy Toast's Android terminals ($399–$799+), can't use your own; replacements only from them | ✅ Runs in a browser on hardware you already own; buy replacements anywhere |
| **Locked processing rates** (2.49–3.5%+), can't bring your own processor | ✅ We *recommend* a processor; the merchant account is yours — PCI never lands on us |
| **Contract auto-renewal** (2–3 yr, 30–60 day escape window) + hardware financing you still owe after leaving | ✅ You own the code; leave anytime, take it with you |
| **Core features as $75/mo add-ons** (online ordering, loyalty, marketing, gift cards, team mgmt each billed) | ✅ One instance, features included; revenue is the *service*, not per-feature upsell |
| **Online-ordering commissions** (2.5–3.5% on top of the fee) | 🟡 Online ordering is the hub project — but never a per-order commission |
| **Poor / slow support**, tier-1 can't help, escalations take days | ✅ The relationship *is* the product — "Claude keeps your POS perfect" |

## Operational grievances (the build signal)
| Grievance (who complains) | Our status | Note |
|---|---|---|
| **Cloud POS dies when the internet drops** — can't ring, can't take cards | ✅ | Offline-first single file keeps ringing; syncs on reconnect. *Honest caveat: live card **authorization** still needs a connection — store-and-forward is a processor feature.* |
| **Square can't route to the right kitchen station** on complex menus | ✅ | Per-item station fan-out is core |
| **Menu doesn't turn items off when 86'd / out of stock** | ✅ | 86/par + stock auto-disable; **day-part windows** now gate lunch-at-dinner etc. |
| **Complex/conditional modifier trees are hard to build** (Toast) | 🟡→🆕 | We have modifiers/add-ons; **nested/conditional modifiers** (e.g. "add cheese → which cheese") is a real gap |
| **KDS is rigid, little customization** (Toast) | ✅🟡 | We have a KDS with timers/bump/coursing; layout options could go further |
| **Reports are weak — need to pull several to get one answer; accounting/tips-in-payroll painful** | 🟡→🆕 | We have reports/P&L/paystub; a **one-screen daily "close" report** + cleaner tip export is worth building |
| **No delivery-driver report** — who took which delivery | 🆕 | Small, concrete: a driver/delivery summary |
| **No upsell suggestions** (Square/Toast weak) | 🆕 | We have combos; a **"suggested add-on" prompt** at ring/checkout is cheap and wanted |
| **Inventory is shallow — no wastage/spoilage tracking** (vs Lightspeed) | 🟡→🆕 | We track stock + reorder; a **wastage/waste-log** adjust is the gap |
| **Tips lost when a tab/table is transferred**; tip-out to support staff clumsy | 🟡 | Our transfer moves the check (tips ride the tenders); **tip-out by role** + keeping server attribution on transfer is worth pinning |
| **Loyalty should be built in, no extra app** | ✅ | Loyalty + gift cards are core |
| **Weak third-party integrations** (QuickBooks, delivery, etc.) | 🟡 | QBO exists on the Ozark instance; delivery ingestion is the hub project |
| **Hard to learn / long training** | ✅ | The builder + plain UI; training in hours not days |

## Where we already win (say it out loud)
Sovereign ownership · no proprietary hardware · bring-your-own processor · **offline-first reliability** · per-item
kitchen routing · built-in loyalty/gift/house-accounts · the full server flow we just built (seat-by-seat, split
by seat, comps, server assignment, transfer/merge, day-parts/happy-hour, reservations/waitlist, order types) ·
and the moat: **say a grievance in plain English → it's changed**, which is the exact opposite of "escalation
takes days."

## New gaps worth building (prioritized from the research)
1. **Nested / conditional modifiers** — the most-cited menu-build frustration.
2. **One-screen daily close report** + clean tip / tip-out export (payroll pain).
3. **Suggested add-on / upsell prompt** — wanted, and cheap on top of combos.
4. **Wastage / waste-log** in inventory — the inventory depth operators miss.
5. **Delivery-driver report** — small, concrete, repeatedly requested.
6. **Tip-out by role + tip attribution on transfer** — bartender/server pain.

These are recommendations, not commitments — the owner prioritizes (and real Burger Barn grievances outrank a
forum). Each ships through the safety pipeline with a test, like everything here.

## Sources
- [Toast POS Problems & Complaints (2026) — Sleft](https://www.sleftpayments.com/learning-hub/toast-pos-problems-complaints-2026)
- [Square for Restaurants Review — NerdWallet](https://www.nerdwallet.com/business/software/reviews/square-for-restaurants)
- [What Restaurants Want from POS Systems in 2025 — Access Computech](https://accesscomputech.com/blog/what-restaurants-want-from-pos-systems-in-2025.html)
- [Top POS features for restaurants — Lavu](https://lavu.com/3-features-to-look-for-in-restaurant-pos-software/)
- [44 Best Restaurant POS Features — Quantic](https://getquantic.com/restaurant-pos-system-features/)
- [POS Offline Mode: Why Your Restaurant Needs It — SpotOn](https://www.spoton.com/blog/pos-offline-mode/)
- [Restaurant POS Offline Mode — Clopos](https://www.clopos.com/en/blog/restaurant-pos-offline-mode)
- [Shopify POS in a cafe — modifiers/disconnects (community thread)](https://community.shopify.com/t/experiencing-difficulties-with-shopify-pos-in-a-cafe-setting-any-advice/35154/18)
