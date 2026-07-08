# Ozark-parity roadmap — "build a full dry cleaner from a blank slate"

**Goal (owner):** the builder at custompos.org must be able to produce a POS with the *full* feature depth of
the reference production dry cleaner (the origin app) — from a blank slate, using generalized tools (config +
a small set of toggle-able modules), with no trade-specific code hardcoded into a single business.

**Verified answer (from a two-sided audit, 2026-07):** *Yes, it can be done* — but it needs new **engine
primitives**, not just template data. The generalized engine already implements 9 of the 14 core primitives
(timers, 86/par, item routing, money math, deposits/A-R, status board + sanitized tracker, loyalty, profiles,
checklists). The `cleaner` template already builds a working single-store counter→detail→assembly→rack→pickup
POS. What's missing is the handful of mechanics that make a *real* plant-grade cleaner + delivery route.

This file is the execution checklist. Keep it current: check items off as they ship, in verified increments
(engine change → build the cleaner from blank → confirm the feature → commit).

> **Scope note.** "Build from blank" = the **downloaded single-file engine** produced by the builder. The
> optional **sync hub** (auth, public tracker portal, SMS/Twilio, card processing, photo store, rolling
> backups) and the **real card-payment module** are *separate infrastructure tracks* the owner deploys — they
> are intentionally not part of what the blank-slate builder emits. The reference `hub.js` is a minimal open
> sync server on purpose.

---

## Gap map (engine, not template data)

| # | Gap | What a full cleaner needs | Engine today |
|---|---|---|---|
| 1 | Named lifecycle | `Received→Detailed→Assembled→Racked→Ready→PickedUp` from config, incl. public-tracker phrasing | hardcoded `INPROGRESS/READY/PAID/CLOSED` |
| 2 | Multi-store | `storeId` on records, per-station store scope, plant vs drop store, "assembled at <plant>" | no store field anywhere |
| 3 | Per-piece units | a durable per-garment tag (HSL), per-piece status/location/flags, per-garment history across visits | lines carry only a `qty` |
| 4 | In/out reconciliation | count-in vs count-out gate before an order can be marked ready | manual checkbox only |
| 5 | Detail-station entry | itemize/price/tag garments at the detail station | detail is a pass-through "mark done" |
| 6 | Assembly | bay assignment + smart bag splitting (spread thick items, comforters solo, bulk scan) | none |
| 7 | Print seam | garment tags, bag/rack labels, tickets, per-store colored-paper routing, print-agent hook | `window.print()` of a screen receipt |
| 8 | Delivery route | route / stop / driver / manifest / scan-to-rack, per-day scheduling | none (no sub-record system) |
| 9 | Roles + money-gate | refund/void manager-approval, a permission layer | no roles; refunds/voids ungated |

Smaller: multiple modifier groups + weight/scale items in the *builder* UI (engine already supports some);
open/close **recurring checklists** with photo/count/signature capture; per-customer/asset persistent flags.

---

## Build stages (each: engine primitive → builder toggle → verify from blank → commit)

- [ ] **Stage 1 — Foundation**
  - [ ] 1a. Config-driven **named lifecycle stages**: `FLOW.stages` (ordered, with internal + public-tracker
        labels); derive an order's stage from its least-advanced incomplete line; show it on the board, the
        sanitized tracker, and receipts. Generalizes the origin app's `trackStatusLabel`.
  - [ ] 1b. **`storeId` / location** on every record; a store list in config; per-station store scope
        (a station can be pinned to a store); order belongs to the customer's store.
  - [ ] 1c. Extensible **sub-records** on a record (child objects: pieces, route-stop) — the substrate Stages
        3/8 hang on.
- [ ] **Stage 2 — Per-piece unit model + HSL tag module** (Gap 3)
  - [ ] lines can expand to individual **piece units** (item flag `perPiece` or flow setting); each piece has
        id, durable tag/HSL, status, current station, location, flags, bag.
  - [ ] per-garment **profile/history recall** keyed by tag (extends the existing entity-profile primitive).
- [ ] **Stage 3 — Detail entry + Assembly** (Gaps 4, 5, 6)
  - [ ] detail station can add/price/tag pieces (not just "mark done").
  - [ ] assembly **bay** assignment + **smart bag split** (config: max/bag, thick-spread, solo categories,
        bulk scan) + **in/out reconciliation** gate (piece count in == out before Ready).
- [ ] **Stage 4 — Print seam** (Gap 7)
  - [ ] a `print()` seam with templates (garment tag, bag/rack label, ticket, receipt) + **route by the
        order's `storeId`** (kernel invariant) + a local print-agent hook (falls back to browser print).
- [ ] **Stage 5 — Delivery route module** (Gap 8)
  - [ ] route/stop/driver as config + sub-records; driver view, manifest, per-stop pickup/no-pickup,
        scan-to-rack, per-day scheduling; a "picked up a bag" → uncounted intake.
- [ ] **Stage 6 — Roles + money-gating** (Gap 9)
  - [ ] a permission layer (roles → allowed actions) + **request→approve** gate on refunds/voids/discounts.
- [ ] **Stage 7 — Expose + prove**
  - [ ] surface every new module/config in the **builder** UI (toggles + settings).
  - [ ] ship an **"Ozark-grade dry cleaner"** template that turns them all on.
  - [ ] **Validation:** from a blank slate, build a dry cleaner and confirm the full loop
        (intake → tag pieces → assemble w/ bags + reconciliation → rack → ready-text → route delivery →
        pickup w/ A-R) works end-to-end with 0 console errors.

## Kernel invariants (hold in every stage)
- Print routing follows the **order's** attributes (storeId), never the workstation.
- Card secrets live hub-side only; money-moving actions are gated.
- Every capability is **data-as-config** (an owner setting), not a code path per trade.
- Verify in the browser with **0 console errors** before checking a box.
