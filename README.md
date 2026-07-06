<h1 align="center">customPOS</h1>

<p align="center">
  <strong>Build your own point-of-sale. Download it. Own the code.</strong><br>
  A free, config-driven POS builder — then customize it locally with <a href="https://claude.com/claude-code">Claude Code</a>.<br>
  <em>No subscription. No lock-in. Your software, your machine, your data.</em>
</p>

---

> **Status: early build (day 1).** This repository is the public home of customPOS, a project being
> generalized from a real, in-production single-file POS running a two-location wet cleaner. The engine,
> the builder wizard, and the templates are under active construction. Star/watch to follow along.

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

Small businesses that want a real POS without a monthly bill or a vendor holding their data hostage — starting
with **service shops** (dry cleaners, laundromats, alterations, repair) and **simple retail** (track inventory,
ring up sales, print a receipt), with more business types to come.

## Status (working prototype)

- ✅ **Config-driven engine** — [`pos.html`](pos.html), one self-contained file. 14 primitives (routing/fan-out,
  timers, deposits, flags, modifiers, 86, checklists, capacity, tips/commission, loyalty, gift cards, profile
  recall, status board + customer tracker…) that four very different trades run on **by config alone**.
- ✅ **The builder** — [`builder.html`](builder.html): pick a trade, name it, **download your POS** (the engine
  with your config baked in) plus a generated **`CLAUDE.md`** so your own Claude Code can take over. Live preview.
- ✅ **Payments** — a processor-agnostic interface with a simulator that works out of the box; the certified
  CardConnect/CardPointe adapter ([docs/PAYMENTS-MODULE.md](docs/PAYMENTS-MODULE.md)) swaps in on your own server.
- ✅ **Multi-device hub** — [`hub.js`](hub.js), a zero-dependency Node sync server so several devices (each a
  different station) share one live POS. Sync is opt-in (`?hub=…`); the downloaded POS is fully local otherwise.
- ✅ **One-click build** — `node build.js` → `dist/custompos.html`, a single self-contained file that runs the
  whole builder with **no server** (host it anywhere as customPOS.com).
- ✅ **Tested** — 14 browser test suites in [`tests/`](tests), zero console errors.

**Next:** more trade templates, a drag-to-arrange visual flow editor, and hosting customPOS.com. The whole build
story is in [JOURNAL.md](JOURNAL.md).

### Try it
- **Just the builder, no server:** `node build.js` then open `dist/custompos.html`.
- **Builder + engine over http:** `python3 -m http.server 8000` → visit `http://localhost:8000/builder.html`.
- **The demo engine:** open [`pos.html`](pos.html) directly to play with the four demo trades.
- **Share a POS across devices:** `node hub.js` then open `http://<host>:8090/pos.html?hub=http://<host>:8090`
  on each device.

## License

[MIT](LICENSE) © Brayden Sanders. Free to use, modify, and redistribute. When you download your POS, it's yours.
