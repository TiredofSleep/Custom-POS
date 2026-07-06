# customPOS Architecture (v0.2 — after the 12-business user-test)

> **Status: evolving design, earned not guessed.** v0.1 was a clean "three rings stacked in a line." We put it
> on trial by sending 12 role-played small businesses (street-food cart → full-service restaurant → clothing
> boutique → dry cleaner → salon → auto repair → bakery → market booth → bookstore → phone repair → pet groomer)
> through the intake interview. 1 of 12 fit well; the restaurant didn't work at all; the other 10 had to
> "force-fit." This v0.2 is the redesign their feedback drove. See [../JOURNAL.md](../JOURNAL.md) for the story.

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

## The wizard (v0.2 flow)
**Trade-first, then multi-select, then trust.**
1. **Pick your trade** ("food cart, café, restaurant, boutique, cleaner, salon, repair, grooming, market booth,
   bakery, bookstore…"). This preloads *your* vocabulary and a sensible default pack + module set, and lets one
   click **hide every irrelevant question** (a mobile food cart skips the whole customer-records/rack/hardware
   detour).
2. **Confirm & adjust (multi-select):** which lifecycles do you run? how do you price (multi-select, per-line)?
   is everything taxed the same? do customers book a time? how are staff paid? deposits? gift cards / loyalty?
   how do your things vary (variants vs modifiers vs asset specs)? take custody of a customer's asset? route to
   a kitchen? what does the customer walk away with on paper?
3. **Deployment & trust (plain language):** one computer / several / off-site backup; import from what — **and**
   honestly disclose the real card-processing rate as a %, that payments work **offline** during a rush, that
   card data is **PCI-safe**, and that **one-click export** takes everything out (including loyalty balances,
   gift-card liability, and relational pet/vehicle/asset history). The test showed the interview only ever asked
   about importing *in*; owners want to know they can get *out*.

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

## Open decisions (for the owner)
1. **Which lifecycle pack to build first.** Recommendation: **Core + Common Commerce + Take-in Service & Repair**
   first — it's closest to the proven origin app (scored *mostly works*) and generalizes to auto/device/pet, so
   we validate the pack model on familiar ground. Then **Retail**, then the hardest, **Food & Hospitality**.
2. Whether "simplest retail" (the earlier second-vertical pick) still leads, or Take-in leads and Retail is the
   fast-follow. (The test showed "simplest retail" still needs variants + markdowns + gift cards to be real.)
3. How much back-of-house depth (KDS, table maps, commission tiers) to ship in a first pack vs defer to advanced.
