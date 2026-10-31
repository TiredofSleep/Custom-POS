# facts/ — the v2 engine

This folder is the engine behind Custom POS's next step: the **Multi-Station Edition**. It comes from the origin shop's
second-generation system ("v2"), which runs a real two-store business today. Every tablet writes down each thing that happens
as a small, permanent note, a *fact*. Facts go to one small server, the *hub*. The hub checks each one and keeps the official
copy. Every screen is worked out from the facts. Nothing is overwritten or deleted, and a mistake is fixed by adding a new fact,
so the record always shows what really happened.

The plan, and why it is built this way, is in [../docs/V2-MODULAR-IMPORT.md](../docs/V2-MODULAR-IMPORT.md). This is
**Stage 1**: the engine, imported, with a small hub of our own. The modules (time clock first) come in Stage 2.

## What is here

| | What it is | Where it comes from |
|---|---|---|
| `core/` | facts and their hashes, the hybrid clock, the type registry, incremental folds, a station's log, the station itself | imported |
| `sync/` | how a station sends its facts and learns new ones; `http.js` is the same over HTTP | imported |
| `store/browser.js` | a tablet's journal in IndexedDB | imported |
| `station/crypto-shim.js` | a SHA-256 for the browser, proven equal to Node's | imported |
| `hub/` | the hub: enrolment, admitting each fact once, ordering, durable before it answers; its SQLite store | imported |
| `aggregates/timeclock.js` | the aggregate the engine laws are written against | imported (Stage 2 rebuilds the Time clock module from it) |
| `test/engine-laws.test.js` | the engine laws, 114 proofs | imported |
| `server.js` | the hub on HTTP: enrol, receive, pull, health, watch, and nothing else | **this repo** |
| `bundle.js` | the engine for a browser, one file, zero dependencies | **this repo** |
| `test/wire.test.js`, `test/bundle.test.js` | the hub over HTTP, the bundle | **this repo** |

**Imported files are never edited here.** They arrive only through the origin shop's private exporter, which refuses while
any real name, phone, address, server detail or secret survives, and which runs the engine laws inside its own output first.
`tools/import-facts.js` then takes only the files the export's manifest names, checking each one's size and SHA-256.
`facts/PROVENANCE.json` records what came in. `tests/facts-engine.js` fails if any imported file differs from it, so a
change is made upstream and re-exported, never by hand here.

## Run it

```
node tests/facts-engine.js          # the engine laws, the wire, the bundle (Node 22+)
node tests/public-refusal.js        # nothing that must never be published is in facts/ or packs/
CUSTOMPOS_ADMIN_KEY=<long random> node facts/server.js --db hub-data/facts.db
node facts/bundle.js --out dist/facts.bundle.js
```

The hub needs **Node 22 or newer** (it uses the built-in `node:sqlite`) and an operator key of 16 or more characters. It
listens on 127.0.0.1. For anything beyond this one machine, put a TLS proxy in front (see [../docs/HUB-SYNC.md](../docs/HUB-SYNC.md)).
The existing open `hub.js` at the repo root is unchanged and still serves blob mode.

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

It is honest about what it does not do: the hub cannot tell who is holding a tablet. A PIN checked by the hub (Stage 2) and an
instant revoke are the defence, not a guarantee.
