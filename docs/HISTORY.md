# The road here — what we tried, what we changed, where it stands

This project has been built in the open, fast, by more than one hand. That means we took some turns and backed
out of a few. Keeping an honest record of them — the dead ends as *past*, the current platform as one *whole* —
is part of the "software is free, knowledge is free" promise. Nothing here is hidden; the git history holds the
full detail.

---

## Where it came from

customPOS was generalized from a **real, in-production single-file point-of-sale** running a two-location wet
cleaner. The valuable thing about that system was never its code — it was that building it forced answers to the
questions every owner actually asks before trusting software: *where's my data, is it backed up, am I locked in,
what's it cost, who helps me, what if you disappear.* customPOS is those answers, rebuilt as a neutral,
config-driven engine any trade can shape. (The trust answers live in [TRUST-AND-OPS-FAQ] territory on the
landing page; the shape-discovery thinking is in the design docs.)

## Turns we took — and the ones we backed out of

Honest is better than tidy. These are the notable course-corrections:

- **"Should we fork an existing open-source POS?"** → **No.** An audit of the OSS-POS landscape found nothing
  that beat our own single-file, offline-first, own-the-file approach without dragging in servers, build steps,
  or a database. Decision: build the neutral engine ourselves. *(Time spent researching, not wasted — it's why
  we're confident in the architecture.)*

- **One HTML file per trade** was an early instinct — a hand-built `restaurant.html`, `salon.html`, and so on.
  It doesn't scale: every fix would have to be made N times. The **config-driven single engine + templates**
  replaced it. *(The per-trade pages you still see — `restaurant.html`, `retail.html`, etc. — are a different,
  deliberate thing: lightweight SEO landing pages that funnel to the one builder. Same engine underneath.)*

- **Cash "make change" broke 22 tests.** A first pass made the primary cash button open a change-making pad,
  which broke every flow that expected an instant exact-cash tender. Reverted to: primary button pays exact,
  a separate **"＄ Make change"** button opens the pad. Backward-compatible, zero regressions. *(Caught by the
  test suite before it ever shipped — which is the point of the suite.)*

- **Commission was hardcoded to `category === "service"`.** A tattoo artist or barber whose items use a
  different category would have earned $0. Fixed so **any line a performer did** is commissionable. A small
  bug, but exactly the kind of buried per-trade assumption this project exists to purge.

- **Two exploratory branches, now archived.** The payments track was explored on side branches before it
  settled onto `main`:
  - `payments-module-design` (`23e1583`) — its content (`docs/PAYMENTS-MODULE.md`) is on `main` already,
    byte-identical.
  - `cardconnect-validation-runner` (`3fc05e8`) — fully contained in `main`, no unique diff.
  Both are **kept, not deleted** — the commits stay reachable for anyone who wants the exploration. Treat them
  as **archived / superseded**; all live payments work is on `main` (`docs/PAYMENTS-MODULE.md` +
  `tools/validate-cardconnect.js` + `payments/`).

## Where it stands now — the platform, whole

As of engine **v0.74**, with **81 browser test suites passing at zero console errors**:

- **The engine** (`pos.html`) — one self-contained file: local-first data with autosave + save-on-exit,
  full-JSON export (anti-lock-in), catalog + tax, order lifecycle + search, cash + change + refunds, receipts,
  and an **activity log / theft-watch** audit trail. Runs offline.
- **The builder** (`builder.html`) — pick a trade or take the guided interview (Shape → Name → Menu → People →
  Pay → Run), configure clickable stations and items, and **download a POS you own** plus a generated
  `CLAUDE.md` so your own Claude Code can keep changing it.
- **[24 starter templates](TEMPLATES.md)** — retail, café, bar, dispensary, dry cleaner, repair, salon, bakery,
  butcher (by-weight), pizzeria, florist, laundromat, tattoo, a full-service restaurant with a floor plan, and
  more. Many were seeded by AI personas role-playing real owners — the community engine.
- **Money, done properly** — per-item taxable, VAT-inclusive pricing, **destination tax zones** for delivery,
  and **per-category tax classes** (grocery exempt, prepared food taxed). Tips, deposits + balance-due,
  house accounts, gift cards, loyalty, round-up-for-charity.
- **The people behind the counter** — time clock, fair scheduling, breaks, coverage, PTO, real-time earnings,
  tip pooling, a worker portal, incident/panic reporting. Worker-protective defaults.
- **The owner's survival view** — "how today went" verdict, margin/COGS, labor as % of sales, top items, busy
  hours, win-back list, **multi-store roll-up**, and the activity/watch audit.
- **Reach** — an optional zero-dependency **sync hub** for multiple registers/locations, a processor-agnostic
  **payments seam** (simulator out of the box; certified CardConnect on your own server = the only revenue),
  and a public order-status portal pattern.
- **The docs set** — [THE-MODEL], [FLOW-SCHEMA], [MODULE-LIBRARY], [TEMPLATES], [TAX-GUIDE], [PAYMENTS-MODULE],
  [ARCHITECTURE], [WORKER-RIGHTS], plus [CONTRIBUTING] and this history.

*Everything above is on `main`, tested, and deployed to custompos.org. The mistakes are in the past tense on
purpose — they're how it got solid.*

[TRUST-AND-OPS-FAQ]: ../index.html
[THE-MODEL]: THE-MODEL.md
[FLOW-SCHEMA]: FLOW-SCHEMA.md
[MODULE-LIBRARY]: MODULE-LIBRARY.md
[TEMPLATES]: TEMPLATES.md
[TAX-GUIDE]: TAX-GUIDE.md
[PAYMENTS-MODULE]: PAYMENTS-MODULE.md
[ARCHITECTURE]: ARCHITECTURE.md
[WORKER-RIGHTS]: WORKER-RIGHTS.md
[CONTRIBUTING]: ../CONTRIBUTING.md
