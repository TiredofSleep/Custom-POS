<h1 align="center">customPOS</h1>

<p align="center">
  <strong>Build your own point-of-sale. Download it. Own the code.</strong><br>
  A free, config-driven POS builder — then customize it locally with <a href="https://claude.com/claude-code">Claude Code</a>.<br>
  <em>No subscription. No lock-in. Your software, your machine, your data.</em>
</p>

<p align="center">
  <a href="https://github.com/TiredofSleep/Custom-POS/actions/workflows/ci.yml"><img src="https://github.com/TiredofSleep/Custom-POS/actions/workflows/ci.yml/badge.svg" alt="tests"></a>
</p>

---

> **Status: working product, active build.** The public home of customPOS — generalized from a real,
> in-production single-file POS running a two-location wet cleaner. A landing page, a builder wizard, a
> [gallery of 24 ready-to-run trade templates](docs/TEMPLATES.md), a full-featured engine, a sync hub, and a
> payments seam are all live and tested (**77 browser suites, zero console errors**). Star/watch to follow along.

## What this is

Most point-of-sale software is something you *rent*: a monthly subscription, your data on someone else's
server, and no way to change how it works. **customPOS is the opposite.**

You go to the builder, answer a few questions about your business, and download a **single self-contained
file** that *is* your POS. It runs in a browser, stores its own data, needs no install and no build step —
and the source code is **yours**. Keep it forever. Change anything. Owe no one.

Think **Webflow or Squarespace — but you download and own the actual working code**, not just the markup.

## Why it works this way

- **One file, zero build, runs offline.** No servers to rent, no dependencies to break. Open it in Chrome and
  it works.
- **You own it.** MIT licensed. Download it and it's yours — no account required to keep using it.
- **Customize it with AI.** The download comes with its own map (a `CLAUDE.md` + code guide) so you can point
  [Claude Code](https://claude.com/claude-code) at the file and change prices, workflows, receipts, or anything
  else — in plain English, on your own computer.
- **Modular.** Turn on only what your business needs — inventory, delivery routes, staff time-clock, checklists,
  and more — and leave the rest off.

## How we keep it free

The software is free and always will be. **We make money only when you do** — through an optional, built-in
card-payment integration. If you choose to accept card payments, you sign up through our processor partner and
we earn a small share of the processing that already costs you money no matter whose POS you use. Don't want
card payments? The POS is still 100% free and fully yours. **No paywalls, no feature gates, no subscription.**

> *Software is free. Knowledge is free.* This project is a deliberate stance on how technology — and AI — should
> serve people: by helping them **own** their tools, not rent them.

The card-payment module the free model rests on has a **validated blueprint** in
[docs/PAYMENTS-MODULE.md](docs/PAYMENTS-MODULE.md) — a processor-agnostic interface with a certified
CardConnect/CardPointe reference adapter, PCI-safe by design (**the browser never touches a card number**;
credentials live only on the business's own server, never in the downloaded file).

## Who it's for

Small businesses that want a real POS without a monthly bill or a vendor holding their data hostage —
**service shops** (dry cleaners, laundromats, alterations, repair), **food** (cafés, a real burger joint with a
kitchen display), **retail** (inventory, barcodes, receipts), and **appointment/service** businesses (salons with
staff, commission, and a booking calendar). More business types to come.

## What's built

- ✅ **Landing page** — [`index.html`](index.html): the customPOS.com front door — the pitch, the honest
  monetization story, and the trust FAQ every owner asks. One self-contained file, light/dark.
- ✅ **Config-driven engine** — [`pos.html`](pos.html), one self-contained file. Everything below runs on it **by
  config alone** — a cleaner, a diner, a shop, and a salon on the exact same code:
  - **Money:** cash + change, cards (PCI-safe), **house accounts (A/R)**, sales tax, **discounts + coupon codes**,
    tips + commission, deposits, **split checks**, **refunds/voids**, printable receipts.
  - **Back office:** **end-of-day Z-report** (by tender / category), **cash-drawer count**, **labor hours**,
    **sales history** day by day, reorder + A/R statements.
  - **Operations:** **inventory** (stock, low/out, receive), **barcode scan + search**, **appointments** (book →
    check-in), **kitchen display** with bump + prep timers, **floor / table plan** (a spatial state machine —
    tables, salon chairs, auto bays, spa rooms), **quotes/estimates**, **checklists**, capacity/pacing,
    per-item routing & fan-out, timers/SLAs, flags, modifiers, 86 counts.
  - **People & customers:** **staff time-clock + PIN + clock-in welcome**, roles/tips/commission, customer
    profiles + "the usual", **loyalty + gift cards**, **text-when-ready**, status board + customer tracker.
  - **Worker rights** (defaults tilt toward the worker): **staff scheduling** (weekly grid, OT flag,
    publish → text), **breaks + real-time earnings** with meal/rest reminders, **time-off requests**, **shift
    coverage** (no double-book / no hidden OT), **incident reports + 🆘 panic alert**, **tip pooling by hours**,
    and a **worker portal** — your own schedule, hours, and a **pay estimate with overtime shown at 1.5×**.
  - **Business health** (survive the hard days): **labor as % of sales** with a high-payroll flag, **gross
    margin** (cost of goods → real profit), **top items by sales + margin**, **busy-hours** bars to staff the
    rush, and a **win-back list** that re-invites lapsed regulars in one tap.
- ✅ **The builder** — [`builder.html`](builder.html): pick a trade, deep-configure clickable workstations & items,
  **download your POS** plus a generated **`CLAUDE.md`**. A [gallery of **24 starter templates**](docs/TEMPLATES.md)
  — retail, café, dry cleaner, repair, salon, bar, dispensary, bakery, butcher (by-weight), pizzeria, florist,
  laundromat, tattoo studio, the real **Hamburger Barn**, a **full-service restaurant** with a floor plan, and
  more — each ships with its trade's features already on. Many were seeded by AI personas role-playing real
  owners; **contributing a new one is the easiest way to help.** Live preview.
- ✅ **Payments** — a processor-agnostic interface with a simulator that works out of the box; the certified
  CardConnect/CardPointe adapter ([docs/PAYMENTS-MODULE.md](docs/PAYMENTS-MODULE.md)) swaps in on your own server.
  Onboarding a new merchant is one command: [`tools/validate-cardconnect.js`](tools/validate-cardconnect.js) runs
  the full Fiserv Integration-Validation transaction gauntlet against your UAT credentials and prints every
  retref mapped to the form's boxes (credentials come from env vars — no secrets in the repo).
- ✅ **Payments service (any POS)** — [`payments/pay-server.js`](payments/pay-server.js): a standalone,
  zero-dependency card-processing microservice. Gives customPOS *or a third-party POS* certified CardConnect
  payments behind one neutral REST API (`/charge`, `/refund`, `/void`, `/inquire`, terminal + hosted-tokenizer) —
  PCI SAQ-A (card data never touches it), a shared-key gate, and a simulator so you can integrate before any
  merchant account exists. Full guide: [`payments/README.md`](payments/README.md).
- ✅ **Multi-device hub** — [`hub.js`](hub.js), a zero-dependency Node sync server so several devices (each a
  different station) share one live POS. Sync is opt-in (`?hub=…`); the downloaded POS is fully local otherwise.
- ✅ **One-click build** — `node build.js` → `dist/custompos.html`, a single self-contained file that runs the
  whole builder with **no server** (host it anywhere as customPOS.com).
- ✅ **Tested** — 58 browser test suites in [`tests/`](tests), each driving the real app, all green with zero
  console errors.

**Next:** the worker portal on personal-device auth, calendar-dated PTO balances, and hosting customPOS.com.
The whole build story is in [JOURNAL.md](JOURNAL.md).

### Try it
- **The landing page:** open [`index.html`](index.html).
- **Just the builder, no server:** `node build.js` then open `dist/custompos.html`.
- **Builder + engine over http:** `python3 -m http.server 8000` → visit `http://localhost:8000/builder.html`.
- **The demo engine:** open [`pos.html`](pos.html) directly to play with the demo trades.
- **Share a POS across devices:** `node hub.js` then open `http://<host>:8090/pos.html?hub=http://<host>:8090`
  on each device.

### Run the tests
```bash
npm install
npx playwright install chromium              # playwright-core ships no browser
export CHROMIUM_EXE="$(node -e "console.log(require('playwright-core').chromium.executablePath())")"
npm test                                     # runs every tests/*.js, fails on any console error
```
CI runs the same suite on every push (see the badge above). A GitHub Pages workflow publishes the landing page +
builder + demo engine (`.github/workflows/pages.yml`).

## License

[MIT](LICENSE) © Brayden Sanders. Free to use, modify, and redistribute. When you download your POS, it's yours.
