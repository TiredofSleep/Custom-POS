# CLAUDE.md — customPOS (orientation for any Claude session)

**Read this first.** This is the founding-state source of truth for the customPOS project.

## What this is
**customPOS** is a free, config-driven **point-of-sale builder**. A small business owner configures their POS in
a web wizard (eventually at customPOS.com), then **downloads a single self-contained HTML file that they fully
own** and can customize locally with **Claude Code**. Think "Webflow/Squarespace, but you download and own the
actual working code." No SaaS, no subscription, no lock-in.

It is being **generalized from a real, in-production single-file POS** (a two-location wet cleaner). That origin
app is a ~4,000-line single HTML file (vanilla JS, `localStorage`, optional Node sync hub) — the proven
architecture we are turning into a reusable engine.

## The monetization (why the software can be free)
Revenue is **decoupled from the software**. It comes from an optional **card-payment integration**
(CardPointe / Fiserv / Clover Connect, certification in process): we give the payment module away and earn a
**percentage of card processing** through a processor partner registration. Free software is the on-ramp; we
only earn when the business processes payments. **No subscriptions, no feature gates, ever.**

## Architecture direction (the three-layer split)
Preserve the origin app's DNA: **single file, zero build, runs offline, easy for Claude Code to edit.** Do NOT
rewrite into a framework. Generalize by splitting every part into one of three layers:
- **ENGINE** — the universal spine (data layer, order lifecycle, payments interface, customers, search, drawer,
  admin core, boot). Stays in the template.
- **MODULE** — optional, pluggable capabilities toggled per business (inventory, delivery route, payroll,
  checklists, SMS, statements, assembly/back-of-house, etc.).
- **CONFIG** — pure per-business data (catalog/price book, locations, terminology, branding). This is what the
  builder wizard generates and injects into the engine.

The five generalization abstractions the engine needs: (1) a terminology layer, (2) configurable item
attributes, (3) a configurable order lifecycle, (4) a module registry that builds the UI from enabled modules,
(5) a branding layer. See the private planning docs (below) for detail.

## ⚠️ CRITICAL: this is a PUBLIC repository
**NEVER commit real business data, PII, secrets, or infrastructure details here.** Specifically:
- **No real emails, phone numbers, street addresses, or person names** in code, config, or docs (the origin app
  contains a business's and a third party's real contact info — it must never be copied in).
- **No secrets** — API keys, hub keys, payment-processor credentials, passwords. Secrets live only in a server
  env file, never in the repo (that rule is inherited from the origin app).
- **No server IPs, droplet details, or deployment specifics** for any real business.
- The engine ships with a **neutral demo config only** (a placeholder "Demo Store" with sample items) — never a
  real business's price book, customers, or settings.

When porting engine code from the origin app, **scrub all business-specific data into a neutral config in the
same change** — before it is ever committed. Treat every commit as world-readable, because it is.

## Status (day 1)
- **Done:** repo created (MIT), README (public pitch), this orientation file.
- **Research:** a verified landscape pass concluded there is **no better OSS POS to fork** — no existing project
  is simultaneously permissive-licensed + single-file + zero-build + local-first, so we generalize our own.
- **Next (Phase 1):** port the engine from the origin app with `seed()`/settings extracted into an external,
  neutral `CONFIG` object (no real business data). Then add the five abstractions (Phase 2), a second template —
  simple retail (Phase 3), the builder site (Phase 4), and the payment module (Phase 5).

## Notes for collaborators
- The detailed vision, engine/module/config audit, and research findings live in **private** planning docs in
  the origin repo (not published here to keep this repo clean of business-internal references). Ask the owner if
  you need them.
- Verify any engine work in Chrome with **0 console errors** before calling it done — the origin app's standard.
- Keep this file current as the project takes shape.
