# customPOS — Starter Template Gallery

Every business starts from a **template**: a working POS that already thinks like your trade — the right
lifecycle, the right stations, and a sensible starter menu you edit to your own. Pick the closest match in the
[guided builder](https://custompos.org), then change anything.

This gallery is also an **invitation**. Templates are the front door of the [request loop](THE-MODEL.md): a real
business's shape, captured once, becomes a starting point everyone can reuse. Many of the templates below were
**seeded by AI personas** role-playing real owners through the builder — that's the community engine, and you're
invited to add to it (see [Contribute a template](#contribute-a-template)).

Every template here **boots clean through the engine** with zero console errors — that's the automated gate in
`tests/templates.js`. If it's in the gallery, a real owner can download it and ring a sale today.

---

## The gallery

Each row lists what the template demonstrates and which **modules** it turns on (modules light up from the
stations in the flow — see the [module library](MODULE-LIBRARY.md)).

### Simple & fast (one screen)
| Template | For | Shows off |
|---|---|---|
| **Simple counter** | Any shop that just rings things up | The irreducible core: one register, cash + card. |
| **Market stall / booth** | Flea market, farmers market, craft booth | Cash-first, no tax, a **custom-price** "anything" item. |
| **Food truck** | One-window street food | Fast counter with tips, item costs for margin. |
| **Ice cream / Scoop shop** | Summer scoop window | **Required modifiers** (size, cone vs cup) + add-ons, kept dead simple. |
| **Convenience / C-store** | Gas-station shop, corner store | **Age-restricted** items (ID check), lottery, tracked stock. |

### Made-to-order (a kitchen or make-line)
| Template | For | Shows off |
|---|---|---|
| **Café / Counter** | Coffee & quick food | Intake → make-line → **kitchen display** → pickup, split checks. |
| **Boba / bubble tea** *(via Café)* | Heavy drink customization | Start from Café; add sweetness/ice/topping modifier groups. |
| **Burger bar** | Fast-casual burgers | Course-fired kitchen, margin-aware menu. |
| **Bistro** | Sit-down restaurant | Floor plan, tables & tabs, coursing, tips. |
| **Bar / pub** | Drinks by the seat | **Table/seat tabs**, 21+ ID check, tips. |
| **Pizzeria (+ delivery)** | Walk-in & phone orders | Kitchen + KDS **plus a delivery route** on a food flow. |

### Take it in, do work, give it back
| Template | For | Shows off |
|---|---|---|
| **Bakery (pre-order + counter)** | Custom cakes + pastries | **Deposit** on a pre-order, order board, ready-text, counter sales. |
| **Florist (+ delivery)** | Arrangements & deliveries | **Custom-price** quote, deposit, **delivery route**, ready-text. |
| **Repair shop** | Phones, bikes, gear | Quote → deposit → fix → ready, aging clock. |
| **Dry cleaner / Laundry** | Full clean & laundry | Tag → clean → assemble → **rack** → pickup, status board + tracker. |
| **Full-plant cleaner (advanced)** | Multi-store plant + route | Everything on: 2-store plant, per-piece tags, smart assembly, route, refund approvals. |

### Services & appointments
| Template | For | Shows off |
|---|---|---|
| **Salon / Spa** | Chairs & appointments | **Performers + commission**, tips, loyalty, booking. |
| **Mobile / home services** | Groomer, cleaner, handyman | On-the-go checkout + booking, tips, text-when-done. |

### Retail & inventory
| Template | For | Shows off |
|---|---|---|
| **Retail store** | Sell from stock | Catalog, stock levels, reorder, reports. |
| **Consignment / Thrift** | One-of-a-kind resale | **Custom-price** unique items + consignor **store-credit accounts**. |
| **Dispensary (21+)** | Age-gated retail | 21+ ID gate, member accounts, tracked inventory, tax. |
| **Butcher / Deli (by weight)** | Price-by-the-pound | **By-weight** items (enter the pounds, it multiplies) + fixed deli items. |

### Start from nothing
| Template | For | Shows off |
|---|---|---|
| **Blank** | Design it yourself | An empty flow — add exactly the stations you want. |

---

## What a template is (under the hood)

A template is one **FLOW** object — the same config the engine reads at runtime. The shape is documented in
[FLOW-SCHEMA.md](FLOW-SCHEMA.md); the short version:

```js
key: {
  flowId, label, topology:"linear"|"hub-and-spoke", blurb,
  branding:{ name, brandColor },
  endpoints:{ customer, payment, tax?, notify?, loyalty?, quotes?, deposit?, approvals? },
  catalog:[ { id, name, price, category, path:[station ids], /* + optional: cost, ageRestricted,
              customPrice, stock/reorderAt, modifiers, addons, flags */ } ],
  stations:[ { id, type, label, view:{money} } ]   // station "type" is what turns modules on
}
```

The **engine/module split is discovered by the config**: a capability is *engine* if every business has it
(ring a sale, take cash, own your data) and a *module* if it only lights up on certain answers (a kitchen
display, a delivery route, staff scheduling). Templates are just pre-filled answers.

---

## Contribute a template

Templates are the easiest way to help the next owner — and the heart of the community. To add one:

1. **Design it** in the [builder](https://custompos.org) (or copy the closest existing template in
   `builder.html`'s `TEMPLATES` object and edit it).
2. Keep it **honest and minimal** — a real menu with real prices, and only the stations the business truly
   needs. Every `path[]` id must point at a station that exists in the flow.
3. **Prove it boots:** `node tests/templates.js` boots every template through the engine and fails on any
   console error. Yours must pass.
4. Open a PR that adds your template to `TEMPLATES` and a row to this gallery.

No trade is too niche — a niche template is exactly what makes the next owner in that niche feel seen. The
personas that seeded this gallery imagined bakeries, butchers, florists, and scoop shops; the real ones will
imagine the rest.

*Software is free. Knowledge is free. The templates are ours, together.*
