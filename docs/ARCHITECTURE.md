# customPOS Architecture (v0.3 — after two rounds of user-testing)

> **Status: evolving design, earned not guessed.** v0.1 was a clean "three rings stacked in a line." Round 1
> sent 12 role-played businesses through it — 1 fit, the restaurant failed, 10 force-fit — which drove the v0.2
> four-layer redesign (below). Round 2 sent 12 trades × 3 owner-sophistication levels (36 owners) through v0.2:
> the **trade-first first screen was a universal win**, but the **"confirm & adjust" second screen was a jargon
> cliff that abandoned 11 of 12 low-tech owners at the same spot**, while power-users completed but wanted real
> numbers and depth. The **v0.3 two-track wizard** (below) is that fix. See [../JOURNAL.md](../JOURNAL.md).

## The core insight from the test
**A tool built for one trade quietly assumes that trade.** v0.1 was really the dry cleaner's shape in a general
costume: a single "what do you sell?" lifecycle (pick one), garment/rack/heat-seal vocabulary leaking into every
business, and near-universal commerce features (modifiers, discounts, tips, gift cards, deposits, variants)
buried as afterthoughts or missing. Three structural fixes define v0.2.

## The four layers

Instead of one linear stack, customPOS is a **lean core + a shared commerce layer + composable lifecycle packs +
operations modules**, all fed by **config**.

### 1. Core (always on — the irreducible spine)
Ring up and record a sale, and own your data. No question asked; every business gets it.
- Data layer: local-first storage, autosave, save-on-exit, schema migration, crash-recovery fallback.
- **Own & export** your data (CSV/JSON out) — the anti-lock-in guarantee.
- Catalog of sellable things; create/record an order; order numbering; work-queue home; search.
- Cash payment + change; refunds to original tender; receipts (browser print).
- Audit log; boot/render spine.
- **Tax is core but richer than v0.1:** per-line taxable/exempt, multiple rates (e.g. liquor), and
  **tax-included / out-the-door** pricing — nearly every business tested had mixed tax on one ticket.

### 2. Common Commerce layer (shared — available to ANY vertical)
The test's biggest correction: these are **not vertical**, they're near-universal. Promoted from buried toggles
(or absence) to a first-class shared layer any business can switch on:
`priced modifiers` · `discounts / markdowns / coupons` · `deposits + balance-due` · `tips (presets, pooling,
per-provider attribution)` · `gift cards + gift receipts` · `loyalty / rewards / member pricing` ·
`product variants (size × color × …, per-variant stock & barcode)` · `mixed per-line pricing on one ticket`
(per-piece + per-pound + quote; parts + labor) · `store credit`.

### 3. Lifecycle Packs (composable — enable ONE OR MORE)
The root fix: **"what do you sell?" becomes multi-select.** A business turns on every family it runs. Each pack
brings its own screens, documents, and vocabulary.

| Pack | Lifecycle | Brings | Fits |
|---|---|---|---|
| **Retail** | ring → pay | variants/SKU matrix, return-to-stock/exchange, markdowns, wholesale **PO + receiving** (ISBN/UPC lookup), gift receipts | boutique, bookstore, gift shop, market booth |
| **Food & Hospitality** | ring → make → hand off / seat → tab → fire → split → settle | **priced modifiers**, **kitchen routing / order queue (KDS)**, **open tabs + tables + split checks**, live **86 / sold-out** list, coursing, tip-out, **Z-report / server cashout** | food cart, café, restaurant |
| **Appointments & Services** | book → check-in → perform → pay | **booking calendar** (provider columns, durations, no-double-book, deposit-backed no-shows, online self-book), **commission / pay-model engine**, per-provider tips, **recall / rebook** | salon, barber, pet grooming |
| **Take-in Service & Repair** | intake asset → diagnose/estimate → authorize → do work → ready → fulfill | **tracked-asset entity** (vehicle/device/pet/garment: VIN/IMEI/breed, intake **condition photos + signed waiver**), **estimate → authorize → parts + labor → invoice**, "waiting on parts/approval" board, **warranty** rework, promised/ready-by date | dry cleaner, auto repair, phone/computer repair, grooming custody |
| **Make-to-Order / Special-Order** | take order + deposit → produce/source → future-dated pickup → balance due | **deposit + balance-due**, **production/pickup due-date calendar**, future-dated orders, allergen/spec labels | bakery custom cakes, special-order books, custom work |

*The dry cleaner (our origin) is now just "Take-in Service & Repair" with the garment attribute set + optional
back-of-house processing (assembly/bag-split/rack) as advanced add-ons — no longer the shape of the whole app.*

### 4. Operations Modules (common, optional — cross-cutting)
multi-device **sync** · **offline / store-and-forward card payments** (decoupled from "requires cloud") · SMS ·
email/marketing · house-accounts + statements + A/R · staff **roles/permissions** · time-clock · payroll ·
**consumables reorder** (distinct from wholesale PO) · daily checklists · feedback/reviews · public track portal ·
data **importers** (Square/Shopify/Lightspeed/Vagaro/Booksy/Gingr/Mitchell1/RepairShopr/SPOT/spreadsheet) ·
thermal print-agent · cash drawer / **cash-box count** · end-of-day / per-event totals.

### Config (pure per-business data)
Trade **vocabulary pack** (dish/drink, product/title, service, ticket/RO/job, appointment, pet, garment) ·
terminology · locations (**incl. mobile / pop-up** + per-event tagging) · tax config · catalog/prices ·
attribute / modifier / variant definitions · branding / receipt footer.

## The wizard (v0.3 — TWO-TRACK, after the IQ-range test)
Round 2's lesson: one wizard cannot serve both a low-tech owner (who abandons at the first unfamiliar word) and
a power-user (who wants depth). So the wizard **forks right after the trade pick** into an Express track and an
Advanced track — same engine underneath.

**Step 1 — Pick your trade (universal; the validated win).** "food cart, café, restaurant, boutique, cleaner,
salon, barber, auto repair, phone repair, grooming, market booth, bakery, bookstore…" — plus a **sub-profile**
where it matters (*counter / one-person* vs *full-service*). This preloads *your* vocabulary, **auto-enables the
pack set your trade needs** (grooming → appointments + pet check-in; bakery → case + custom orders; salon/repair
→ service + retail), and **hard-hides everything irrelevant**. Then it forks:

**Express track (default — rescues the 11/12 low-tech abandonments):**
- A big **"Recommended setup for a [trade] — build it for me"** button. Applies sane per-trade defaults and goes
  **straight to download.** No adjust screen. (A quiet "change details later" link is always there.)
- This is the single highest-leverage, lowest-effort change in the whole design.

**Guided track (for owners who tap "customize"):** progressive disclosure — **one plain question per screen,
big text, the right answer pre-checked, a big "Looks good → Next."** Never a wall of simultaneous choices. And
**no software words, ever** — the round-2 kill-list is banned from owner-facing copy: ~~lifecycle, variants,
modifiers, asset specs, per-line, multi-select, asset, custody, PCI~~ → plain trade questions instead
("Do some things come in sizes or add-ons? Yes/No"). Pack labels are renamed to the trade's own words
("Take-in Service & Repair" → *"Check-in & pet records"* for grooming; "Make-to-Order" → *"Special orders"* for
a bookstore). A pet is a pet, a garment is a garment — never an "asset."

**Advanced (collapsed section, for the power-users):** every toggle exposed for the ~125–140 owners who want
control, plus the trust facts they demand as **real numbers, not adjectives**: the **exact card rate**
(flat vs interchange-plus) + processor / bring-your-own; a **documented export format + schema with guaranteed
round-trip re-import** (and a downloadable sample export); the **storage ceiling** in writing (localStorage vs
IndexedDB, max SKUs/orders/photos, search-at-scale); **access to the config object** so editing the file in
Claude Code is deterministic and survives a wizard re-run; and the **multi-terminal offline sync conflict
model** spelled out. "Discloses the rate as a %" reads as evasive to a power-user — give the number.

**Step 3 — Deployment & trust (plain language, both tracks):** one computer / several / off-site backup; import
from what — and plainly: card payments work **offline** during a rush, card data is safe, and **one-click export
gets everything out** (including loyalty balances, gift-card liability, and relational pet/vehicle/asset history).
Owners want to know they can get *out*, not just in.

## New primitive the tests surfaced
**Personalization field** — a first-class free-text/structured field type (cake message, engraving, custom spec,
color-formula note). Every make-to-order trade needs it and priced modifiers can't model it.

## Vocabulary rule (hard requirement)
Never leak one trade's words into another. Default nouns and documents come from the chosen trade's vocabulary
pack (order/ticket/check/appointment/estimate/invoice; item/dish/product/service/pet/garment). The cleaner's
`garment/rack/heat-seal/bag-split/assemble/stain-timer/set-tag` language appears **only** when the garment
attribute set + back-of-house add-ons are enabled.

## What this changes about the build
- The engine/module manifest is now: **Core → Common Commerce → Lifecycle Packs → Operations Modules → Config.**
- First build targets should exercise **at least two packs in one business** (e.g. a salon = Appointments +
  Retail, or a bakery = Retail + Make-to-Order) so the composability is real from day one — the single biggest
  thing v0.1 got wrong.
- Offline store-and-forward payments and the shared commerce layer are foundational, not late add-ons.

## Readiness (after round 2)
Verdict: **build-ready with changes.** The trade-first spine + four-layer architecture are validated across all
12 trades and all 3 sophistication bands and are worth building on. The **prerequisite before any low-tech owner
can finish** is the v0.3 wizard fix set — all but one item is *low effort*:
1. Express "build it for me" button (skip adjust → download). — HIGH impact / LOW effort
2. Purge software jargon from owner-facing copy. — HIGH / LOW
3. Hard-hide non-applicable questions per trade. — HIGH / LOW
4. Trade → auto-enable packs + rename pack labels to trade words. — HIGH / MEDIUM
5. Guided track = one plain question per screen, pre-checked. — HIGH / MEDIUM
6. Within-trade sub-profiles (cart/counter vs full-service). — MEDIUM / MEDIUM
7. Trust step: real card rate + export schema/sample + storage ceiling + config access. — MEDIUM / MEDIUM
8. First-class personalization field type. — MEDIUM / MEDIUM
Per-trade *depth* features (restaurant floor map + comp/void, auto flat-rate labor + parts markup, boutique
matrix SKUs, bookstore ISBN lookup, grooming vaccination-expiry + breed×size, salon commission + card-on-file)
are the **high-tech conversion backlog** — sequence them into whichever pack ships first.

## Open decisions (for the owner)
1. **Which lifecycle pack to build first.** Recommendation: **Core + Common Commerce + Take-in Service & Repair**
   first — closest to the proven origin app (scored *mostly works* across mid/high) and generalizes to
   auto/device/pet, so we validate the pack model on familiar ground. Then **Retail**, then hardest **Food & Hospitality**.
2. Whether "simplest retail" (the earlier second-vertical pick) still leads, or Take-in leads and Retail is the
   fast-follow. (Round 2 showed "simplest retail" still needs variants + markdowns + gift cards to be real.)
3. Whether to run a **round-3 validation of the v0.3 express path** (cheap; confirms low-tech owners now finish)
   before writing engine code, or fold v0.3 in and start building the first pack.
