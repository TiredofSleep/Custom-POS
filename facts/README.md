# facts/ — the v2 engine

This folder is the engine behind Custom POS's next step: the **Multi-Station Edition**. It comes from the origin shop's
second-generation system ("v2"), which runs a real two-store business today. Every tablet writes down each thing that happens
as a small, permanent note, a *fact*. Facts go to one small server, the *hub*. The hub checks each one and keeps the official
copy. Every screen is worked out from the facts. Nothing is overwritten or deleted, and a mistake is fixed by adding a new fact,
so the record always shows what really happened.

The plan, and why it is built this way, is in [../docs/V2-MODULAR-IMPORT.md](../docs/V2-MODULAR-IMPORT.md). This is
**Stage 1** is the engine, imported, with a small hub of our own. **Stage 2** adds the module system, the staff and a hub-checked
PIN, and the first module, the **time clock**. It runs in the app today: pick *Several computers* in the builder.

## What is here

| | What it is | Where it comes from |
|---|---|---|
| `core/` | facts and their hashes, the hybrid clock, the type registry, incremental folds, a station's log, the station itself | imported |
| `sync/` | how a station sends its facts and learns new ones; `http.js` is the same over HTTP | imported |
| `store/browser.js` | a tablet's journal in IndexedDB | imported |
| `station/crypto-shim.js` | a SHA-256 for the browser, proven equal to Node's | imported |
| `hub/` | the hub: enrolment, admitting each fact once, ordering, durable before it answers; its SQLite store | imported |
| `aggregates/timeclock.js` | the aggregate the engine laws are written against | imported (Stage 2 rebuilds the Time clock module from it) |
| `aggregates/staff.js`, `core/staff.js` | the shop's people as facts (`employee.set`, field by field; `staff.roles`, what each role may do) and the rules: roles, `can()`, PINs as PBKDF2 hashes (never the digits), and `PIN_CHECKED`, the facts the hub PIN-checks | imported (rollout step 4) |
| `core/abilities.js` | **the business's own file**: the abilities a person may be given and each role's defaults. The first import brings the origin shop's list as a working start; edit it for your business, and no later import writes over it | imported once, then **yours** |
| `hub/pingrant.js` | the PIN the hub checks itself: a 30-minute signed pass for one person on one tablet, renewed up to 12 hours from the PIN | imported (rollout step 4) |
| `station/record.js`, `station/views.js` | the shop's tablet pattern: one door for a fact, one way a screen's save reaches it, and the folds a screen reads | imported (rollout step 5 uses them) |
| `test/engine-laws.test.js`, `test/proofs/994–996` | the engine laws (114 proofs) and the shared files' own proofs from the shop's suite, each run here at exactly the count that passed upstream | imported |
| `server.js` | the hub on HTTP: enrol, receive, pull, health, watch, and nothing else | **this repo** |
| `bundle.js` | the engine for a browser, one file, zero dependencies | **this repo** |
| `test/wire.test.js`, `test/bundle.test.js` | the hub over HTTP, the bundle | **this repo** |
| `modules/define.js` | the module contract: `defineModule()` checks a manifest; `assemble()` gives the hub ONE judge of who may write what | **this repo** (Stage 2) |
| `modules/staff.js` | the shop's staff files in this repo's module shape: who may write `employee.set` and `staff.roles` (the shop's rules, which it keeps in its own hub), and the one list of people the hub judges by | **this repo** (thin, since rollout step 4) |
| `modules/timeclock.js` | the Time clock module: shared punches, breaks, corrections, and `punches()`, which rebuilds the app's own `DB.punches` | **this repo** (Stage 2) |
| `test/modules.test.js`, `staff.test.js`, `timeclock-module.test.js`, `cli.test.js` | the contract, the staff and PINs, the time clock (with a history fixture), the hub started as the docs say | **this repo** (Stage 2) |

**Imported files are never edited here.** They arrive only through the origin shop's private exporter, which refuses while
any real name, phone, address, server detail or secret survives, and which runs the engine laws inside its own output first.
`tools/import-facts.js` then takes only the files the export's manifest names, checking each one's size and SHA-256.
`facts/PROVENANCE.json` records what came in. `tests/facts-engine.js` fails if any imported file differs from it, so a
change is made upstream and re-exported, never by hand here.

## Run it

```
node tests/facts-engine.js          # the engine laws, the wire, the bundle, the modules (Node 22+)
node tests/public-refusal.js        # nothing that must never be published is in facts/ or packs/
CUSTOMPOS_ADMIN_KEY=<long random> node facts/server.js --db ../custompos-hub-data/facts.db --with-blob
node facts/bundle.js --out facts.bundle.js   # the bundle beside pos.html, which the builder puts in a "several stations" download
```

The hub needs **Node 22 or newer** (it uses the built-in `node:sqlite`) and an operator key of 16 or more characters. It
listens on 127.0.0.1. For anything beyond this one machine, put a TLS proxy in front (see [../docs/HUB-SYNC.md](../docs/HUB-SYNC.md)).

`--with-blob` makes it **one hub for both**: the repo's `hub.js` also answers `/api/db` (records, still synced as blobs until their
modules move) and serves the app's files: only the app's own pages and the bundle, never the rest of the folder. Its data must
live OUTSIDE the app's folder (the hub refuses to start otherwise: its database and the key that signs PIN passes would be one
request away). ⚠️ That blob API is open, as `hub.js` has always been: on its own it is for a LAN, and
beyond one, the proxy in front must guard it. The facts doors keep their own tokens and keys either way.

**A device**: the operator enrols it (`POST /v2/admin/enroll {station}` with the operator key) and gives the device its name and the
token shown once. The app's time clock asks for both the first time, and the hub refuses a token given with the wrong name at once
(every send says its name, and the hub checks it against the token). The token goes straight into the device's own engine store,
never the page's storage. A brand-new hub is then given the team: each PIN is TYPED on the device and leaves it only as a hash (a
several-stations download carries no PINs). The owner comes first; everyone after, including a hire added later on any device, is
added under an owner's or manager's PIN, which the hub checks itself. Every PIN screen in facts mode (the clock, money approvals, a
worker's own screen) checks the hub's hashes, so a device that asks for a PIN connects once. Disconnect forgets the hub; punches
made before a device joined are kept beside the shared ones.

## What it promises, and how that is checked

- **A device writes only as itself.** Its token is shown once at enrolment, and the hub keeps only its SHA-256. A revoked tablet
  lands nothing and is told why. (`wire.test.js`)
- **Each fact is admitted once**, checked against its hash, its registered type and its validator. A retry after a lost answer
  lands at the same position. (`engine-laws`, `wire`)
- **Durable before it speaks.** The hub answers only after its store has the write. A store that refuses makes the hub refuse to
  acknowledge, and the tablet keeps the fact until it lands. (`wire`)
- **One hub per database.** A second hub on the same file will not start. (`engine-laws`, `wire`)
- **Offline is normal.** A station records with no hub, and nothing is lost when it comes back. (`engine-laws`)
- **The browser and Node agree.** A fact made in the bundle verifies in Node. (`bundle`, `engine-laws`)
- **Who may write what is decided by the hub**, not by each tablet:
  - a clerk clocks only themselves in or out, and never needs a PIN pass for it, so nobody is kept off the clock by the internet;
  - a correction needs "payroll" AND a PIN the hub checked;
  - only an owner makes an owner;
  - a forgotten shift is closed by the hub alone.
  Every refusal is shown to land on a hub with no modules, so the refusal is the rule's, not the wire's.
  (`modules`, `staff`, `timeclock-module`)
- **A clock-in on one tablet is on every tablet**, in a real browser with tablets and one hub, through a reload, a hub that goes away
  and comes back, a hire added later and a staff name full of HTML. Every shift time, the tip pool and the labor cost come out the
  same from the shared punches as from blob mode's own clock run for the same actions at the same moments; blob mode through the same
  hub carries records but not punches. (`tests/facts-clock.js`)
- **The hub as a shop starts it** runs the rules, never enrols a name the judge trusts, serves only its allow-list, survives a
  malformed request and refuses a send under the wrong name. (`test/cli.test.js`)

It is honest about what it does not do: the hub cannot tell who is holding a tablet. A PIN checked by the hub, and an instant
revoke, are the defence for the facts that matter, not a guarantee. A PIN is short, and every tablet holds the PIN hashes, so a
lost tablet should be revoked at once.
