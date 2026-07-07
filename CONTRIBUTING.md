# Contributing to customPOS

Thanks for being here. customPOS exists to prove a point: that small businesses can **own** their software
instead of renting it. If you want to help, that principle is the north star — please read it before you build.

## The stance (please don't break it)

1. **The software is free, forever.** No subscription, no per-seat fee, no feature gated behind a paywall.
   Contributions that add a paywall, a license check, a "pro" tier, or a phone-home for licensing will be
   declined. The *only* revenue model is an optional, certified card-payment integration (a share of processing a
   business already pays) — and even that is opt-in and replaceable.
2. **Local-first, no lock-in.** A downloaded POS must keep working with **zero dependency on us** — offline, on
   the owner's own device, forever. Don't add a required server, a required account, or a required cloud call to
   any core path. Sync (the hub) is always opt-in.
3. **The owner's data is the owner's.** It lives in their browser (and their optional hub), never on our servers.
   Anything that touches data must keep it exportable and portable (see the Data & backup panel). No telemetry,
   no analytics beacons, no silent uploads.
4. **Secrets never reach the browser or the repo.** Card-processor credentials live only in a payments adapter's
   own server environment; the hub key lives only in the hub's environment. Don't commit secrets, real business
   PII, or infrastructure details.
5. **Readable over clever.** The whole product ships as source the owner can open in
   [Claude Code](https://claude.com/claude-code) and edit in plain English. We deliberately **don't minify** the
   downloaded file. Keep the code legible and commented; that legibility *is* a feature.

## How the code is laid out

| File | What it is |
|---|---|
| `index.html` | The customPOS.com landing page (self-contained). |
| `pos.html` | **The engine.** One self-contained file — the whole POS. Config-driven via `window.CUSTOMPOS_FLOW`. |
| `builder.html` | The wizard/studio: pick a trade, configure, download the engine with your config baked in. |
| `hub.js` | Optional zero-dependency Node sync server (see [docs/HUB-SYNC.md](docs/HUB-SYNC.md)). |
| `build.js` | Inlines the engine into the builder → `dist/custompos.html` (one hostable file). |
| `tests/` | Browser-driven tests; one file per feature. |
| `docs/` | The design docs, the payments blueprint, the sync model. |
| `JOURNAL.md` | The honest running build log — please keep it flowing. |

`pos.html` and `builder.html` are intentionally single-file monoliths (that's the ownership model). Find your way
around with the `/* ===== SECTION ===== */` banners and the module registry near the top of `pos.html`.

## The bar for a change

Every change is verified in a real browser with **zero console errors** before it's considered done. Concretely:

- **Add or update a test** for what you changed. Tests live in `tests/`, each drives the actual app via
  Playwright and fails on any console error.
- **Run the whole suite** and make sure it's green:
  ```bash
  npm i -D playwright-core
  CHROMIUM_EXE=/path/to/chromium bash -c 'for t in tests/*.js; do node "$t" || echo "FAIL $t"; done'
  ```
- **Keep the engine/module split honest.** A capability is *engine* only if every business needs it; otherwise
  it's a module that lights up on config. The test: *can a business skip this and still ring up and record a
  sale?* If yes, it's optional — gate it behind config, don't force it on everyone.
- **Update the docs you touched** — `tests/README.md`, the relevant `docs/*.md`, and add a `JOURNAL.md` entry
  telling the story of the change.

## Good first contributions

- A new trade template in `builder.html` (prove the engine bends to it — no engine changes).
- A new payments adapter behind the existing processor-agnostic interface (see
  [docs/PAYMENTS-MODULE.md](docs/PAYMENTS-MODULE.md)).
- Importers/exporters for more data types (customers, inventory) in the spirit of the existing CSV import.
- Accessibility and mobile polish — the low-tech operator path matters most.

## License

By contributing you agree your work is released under the repo's [MIT license](LICENSE). When someone downloads
their POS, it's theirs. That's the whole idea.
