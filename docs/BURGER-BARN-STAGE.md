# 🍔 Burger Barn — Stage 2: the restaurant proving ground

*Ozark Cleaners is Stage 1 (a real dry cleaner running customPOS in production). **Burger Barn is Stage 2** —
the first real restaurant. It turns "we have a restaurant engine" into "a working restaurant runs on it and
their owner will vouch for it."*

> Read with: [THE-MODEL.md](THE-MODEL.md) (the sovereign customer→payment model), [RESTAURANT-VERTICAL.md](RESTAURANT-VERTICAL.md)
> (the engine's restaurant design — **already largely built, v0.45+**), and [AI-PRODUCTION-SAFETY.md](AI-PRODUCTION-SAFETY.md)
> (the rails that make live customization safe).

## Why Burger Barn, why now
A vertical isn't real until a real business in it depends on the software and *says so*. Ozark proves the
cleaner line; Burger Barn proves the restaurant line. The plan is deliberately **learn-then-build**: the owner
works shifts on **Toast** at Burger Barn, collects the real grievances, and those grievances become the spec —
we do **not** guess a restaurant POS blind. The differentiator sells itself here: take a Toast complaint, and
turn it into a fixed feature *overnight*, while the owner watches.

## What already exists (configure / close gaps — don't rebuild)
The restaurant engine is well underway (see RESTAURANT-VERTICAL.md, engine v0.45+): per-item routing + station
fan-out, an interactive **Kitchen Display** with bump + prep timers, **modifiers / add-ons / flags**, **86 /
par** counts, **split checks**, **tips + per-provider commission**, the **floor/table state machine** + a
drag-drop floor designer, **course pacing / hold-until**, **table-turn analytics**, and a status board +
customer/staff order tracker. A **burger-joint builder template** exists and is covered by `tests/burgerbarn.js`
(Bubba Burger→grill, Onion Rings→fry, Milkshake→shakes, Blue Plate Special par, tips). **Start from that
template; the Stage-2 work is closing the gaps a real line exposes, not a rebuild.**

## The stage, in order
1. **Learn on the incumbent.** Work Toast at Burger Barn. Live the rush.
2. **Capture every grievance** (template below). Each one is a feature or a fix.
3. **Configure the burger-joint template** to Burger Barn's real menu, stations, and prices via the builder.
4. **Close the gaps** the grievances + a real line expose — through the [safety pipeline](AI-PRODUCTION-SAFETY.md)
   (draft → gates → staging preview → owner approves → deploy → rollback ready).
5. **Meet the enterprise-ready bar** (checklist below) before the line depends on it.
6. **Go live**, then keep taking Burger Barn's grievances and turning them around fast — that lived story, told
   by a burger owner, sells the next ten restaurants.

## 📝 Toast grievance capture (fill this on-site)
The point of the trip. For each pain, note it plainly — Claude turns it into the change later.

| # | The grievance (plain English) | When it bites (rush? open? close?) | What Toast does / makes you do | What "fixed" looks like | Gap vs our engine? |
|---|---|---|---|---|---|
| 1 | | | | | |
| 2 | | | | | |
| 3 | | | | | |

Prompts to make sure you catch the real ones:
- **Speed at the window** — how many taps to ring a common combo? Where does the line stall?
- **Modifiers & combos** — "no onion, add cheese, make it a combo" — how painful?
- **86'ing** — marking something sold out mid-rush; does everyone see it instantly?
- **The kitchen ticket** — does the line get it right, fast, legible? Reprints?
- **Order types** — counter vs drive-thru vs call-in vs delivery apps — how are they kept straight?
- **Tips & tip-out**, **split checks**, **voids/comps** — who can, how hard, how audited?
- **End of day** — cash-out, reports, does it reconcile? What does the owner re-key by hand?
- **Change requests** — has Burger Barn ever wanted Toast to do something and just… couldn't? (That's the sale.)

## ✅ Enterprise-ready bar for a live restaurant
Burger Barn is a "solid stage" only when its instance clears these (the restaurant version of Tier-1 readiness):
- [ ] **Its own isolated instance** — Burger Barn's data/config/customizations never touch Ozark's or any other.
- [ ] **The safe change pipeline works** — a grievance → fix reaches the live line only via draft → gates →
      staging preview → owner approval → deploy → **one-click rollback**. Never a raw edit during service.
- [ ] **Speed** — a common combo rings in a few taps, sub-second; the KDS ticket fires instantly and correctly.
- [ ] **Reliability at rush** — the hub doesn't blink; the card reader doesn't drop; backups proven; a restore
      rehearsed.
- [ ] **Payments** — Burger Barn's own merchant account + reader (customPOS recommends, never becomes the
      processor — keeps PCI off us).
- [ ] **Offline survival** — the line keeps ringing if the internet hiccups.
- [ ] **The core workflow covers the real menu** — modifiers/combos, 86'ing, order types, tips, split checks,
      day-parts — all exercised against Burger Barn's actual menu, with tests pinning them.
- [ ] **A support answer** for a non-technical shift lead at 7pm.

## The loop that is the whole business
Once live, Stage 2 runs the flywheel: **Burger Barn says a grievance → Claude drafts it → the gates prove it →
the owner previews and approves → it deploys to their instance → rollback stands ready.** They own their code;
they pay for the relationship, not the lock-in. Do that visibly, and the next restaurant is a referral, not a
cold sale.
