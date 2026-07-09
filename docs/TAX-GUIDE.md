# Customizing tax for your market

Sales/consumption tax works differently around the world and even between US states. customPOS keeps the
**engine** general and pushes the specifics into **config** (`FLOW.endpoints.tax`), so you tune it to your
market without touching engine code. This is the map. Everything lives under `endpoints.tax`; leave it out
entirely if you don't charge tax.

> Quick edit paths: the **builder** (Pay step) sets the rate, "tax included" toggle, and delivery tax areas.
> Per-item taxable is on each item in the **deep item editor**. For anything finer, point **Claude Code** at
> your downloaded `pos.html` and describe the rule — the config shapes below are what it will edit.

---

## 1. A single flat rate (the default)

Most US shops with one location:

```js
endpoints: { tax: { rate: 0.0825 } }     // 8.25%, added on top of the price
```

The rate is a decimal (0.0825 = 8.25%). Tax is added on top and shown as its own line. That's it.

## 2. Tax **included** in the price (VAT / GST markets)

Much of the world quotes prices tax-inclusive (EU VAT, UK, AU/NZ GST, etc.). Flip `included` and the price the
customer sees already contains the tax; the engine backs the tax portion out for your records:

```js
endpoints: { tax: { rate: 0.20, included: true } }   // 20% VAT already inside the shelf price
```

- The **total the customer pays does not change** — the tax is a slice of it, not an add-on.
- The report's "Net sales" excludes the tax; "Tax collected" shows the backed-out portion.
- Receipts label it "Tax (incl.)".
- Builder: the Pay step has a **"tax included in price / added on top"** toggle.

## 3. Per-item taxable (mixed baskets)

Some goods are exempt (many US states don't tax groceries; some don't tax clothing). Mark an item non-taxable
and it's excluded from the taxable base — discounts still prorate correctly across the rest:

```js
catalog: [
  { id:"milk",  name:"Milk",  price:3.5, taxable:false },   // grocery — exempt
  { id:"soda",  name:"Soda",  price:2.0 },                  // taxable (default)
]
```

Gift-card sales are never taxed automatically (category `"giftcard"`). Builder: each item has a **Taxable /
tax-exempt** toggle in the deep editor.

## 4. Destination tax for **delivery** (zones)

US sales tax is frequently **destination-based**: a delivery into another town/jurisdiction owes *that* place's
rate, not your shop's. Add the towns you deliver to as zones; your own rate stays the default:

```js
endpoints: { tax: {
  rate: 0.08,                                   // the shop's own (origin) rate — the default
  zones: [
    { name: "Downtown",         rate: 0.09   },
    { name: "Across the river", rate: 0.0825 },
  ]
} }
```

- At checkout on a delivery order, a **"Tax area (delivery destination)"** picker appears; choose the town and
  the tax recomputes at its rate. The ticket shows "Tax (9.00% · Downtown)".
- "Here at the shop" = your base rate (dine-in/pickup).
- Every tax-area choice is written to the **activity log** (audit trail).
- Builder: a **"Delivery tax areas"** editor appears in the Pay step for any flow with a delivery route (the
  **pizzeria** and **florist** templates ship example zones).

This is the right fit for a local shop with a handful of delivery towns. It intentionally does **not** call a
paid address-lookup tax API (Avalara/TaxJar) — that's an external dependency that would break the "one file,
runs offline, no subscription" promise. If you truly need street-address-level rates, that belongs in an
optional **hub-side** add-on, not the downloaded file.

---

## Market cheat-sheet

| Your situation | What to set |
|---|---|
| One US location, tax added at register | `{ rate: 0.0X }` |
| Groceries/clothing exempt | above + `taxable:false` on the exempt items |
| You deliver into other towns (destination tax) | above + `zones:[{name,rate},…]` |
| EU/UK/AU — prices already include VAT/GST | `{ rate: 0.XX, included: true }` |
| No tax at all (some booths, resale, wholesale) | omit `endpoints.tax` entirely |
| Multiple physical stores at different rates | give each store's flow its own `rate` (per-store roll-up is a separate, still-open feature) |

## What's not built yet (be honest with yourself)

- **Item tax *categories*** (e.g. one rate for food, another for prepared food/soda) — today an item is taxable
  or not, at one rate. A per-category rate table is a reasonable next step if your state needs it.
- **Automatic address → rate lookup** — deliberately out of the free/offline file (see above).
- **Tax holidays / date-driven rules** and **per-store roll-up reporting** — not yet.

If your market needs one of these, it's a config/engine change Claude Code can make against your own copy —
open [`docs/IDEAS.md`](IDEAS.md) and add it, or just describe the rule to Claude Code.
