# Phase 2 — the sync & durability substrate

> **Standing plan. Execute top-to-bottom without re-asking.** The lifecycle/feature parity closed 2026-07-08
> ([OZARK-PARITY-ROADMAP.md](OZARK-PARITY-ROADMAP.md)); this is the second axis the roadmap never measured —
> what a POS turns out to need once several stations, a van, and real money are involved for weeks. Derived
> from [OZARK-REFERENCE.md](OZARK-REFERENCE.md). **Reference, not source: re-derive the generalized shape; never
> port the 1.5 MB app.**

## The five laws every unit must honor
1. **Absence is never a delete** — only a tombstone deletes; a record missing from a payload is kept.
2. **Ask the append-only record, never the flag** — flags get rolled back by a merge; ledgers/payments don't.
3. **One stamp-comparison function**, in exactly one place, used by every merge on both app and hub.
4. **A test that cannot fail is not evidence** — every unit ships a test that FAILS against the pre-fix code.
5. **An error must never render as good news** — a failed fetch must not look like "nothing here."

## How each unit ships (the discipline, non-negotiable)
- One unit per lesson; a test named after the Ozark incident it prevents; a negative control proving the test fails without the fix.
- Generalized + behavior-preserving where possible. Both gates green (`node run-tests.js`) before commit.
- Commit + push each unit; bump engine version; update this file's checklist.

---

## Stage A — The sync contract (the foundation; everything stands on it)
- [x] **A1 · One clock + one comparison — HUB DONE** (`hub.js`: `hlcNow`/`stampScale`/`stampNewer`, exported; `tests/sync-contract.js` incl. the mixed-scale negative control). ↳ *engine wiring pending:* stamp with `hlcNow()` instead of `Date.now()`.
- [x] **A2 · Tombstones — absence is never a delete — HUB DONE** (the store is the merge base; a `deleted:true` record competes by `stampNewer`; omitted records kept; customers now stamp-guarded). ↳ *engine wiring pending:* delete → write a tombstone; filter `deleted` on read.
- [x] **A3 · One-way status law, server-side too — HUB DONE** (`ORDER_RANK` floor in `mergeArr(advanceOnly)`: a lying stamp can't roll PAID→INPROGRESS; a refund still advances). Shipped `f235e7d` + this commit.
- [ ] **A-engine · wire the engine to the contract** — `hlcNow()` stamping, delete-as-tombstone, filter `deleted` on read, so the contract is live end-to-end in a downloaded POS (currently the hub enforces it; the engine doesn't yet delete-as-tombstone).

## Stage B — Delta sync (stop shipping the whole DB)
- [ ] **B1 · `deltaSince(rev)`** — the hub serves only records changed since a revision; devices pull deltas. *Test:* a device on rev N receives only what moved, not the whole DB; a fresh device still bootstraps fully.
- [ ] **B2 · Push only what changed** — a device pushes only the collections/records it edited (dirty by signature, not a flag). *Test:* an idle heartbeat pushes ~nothing; an edit pushes exactly that record.
- [ ] **B3 · Per-collection local persistence** — a save writes only the collections whose signature moved; legacy whole-DB write kept on a heartbeat so an old build never reads an empty shop. *Test:* a one-order edit writes one collection; a corrupt part falls back to the legacy blob and self-heals.
- [ ] **B4 · Append-only delta log + checkpoints + replay** — `deltaSince` also writes the log (reuse it so log and wire can't drift); checkpoints on an interval; `hub-replay.js` rebuilds any revision. *Test:* rebuild a revision from checkpoint+log byte-identical; a hole refuses (names the missing rev) rather than silently skipping.

## Stage C — Guards at the door (convert, never reject; never 176 guards where data is read)
- [ ] **C1 · `shapeGuard`** — fill a missing required array (e.g. `lines`) at the hub door; log it; cap it (thousands = a different event, refuse loudly). *Test:* a record with no `lines` is repaired at the door; the merge path stays UNguarded (a guard there mass-restamps — the 8/03 rollback class), pinned by an assertion.
- [ ] **C2 · `stampSanitize`** — clamp an incoming `_t` beyond honest skew to now (clamped, not rejected — the work is real, only the *when* is false); a future-dated **tombstone** is DROPPED, not clamped (a delete stamped "now" still outranks a real record). *Test:* a future stamp is clamped; a future tombstone is dropped and re-offered when the clock is right.
- [ ] **C3 · `blobGuard`** — an inline `data:image` in a push is written to content-addressed storage and replaced with a reference at the door (converted, not rejected/dropped). *Test:* an inline image never reaches the synced DB; the same image twice costs one file.

## Stage D — Observability & correctness proofs (the gates Ozark learned to need)
- [ ] **D1 · The mirror** — each station fingerprints its keyed collections at a revision; the hub names which disagree; heals both ways. The algorithm block is BYTE-IDENTICAL in app + hub, with a gate that fails if they drift. *Test:* a drifted collection is named; identical stations report match; the shared block is verified identical.
- [ ] **D2 · `check-invariants.js`** — read-only machine-checked rules across INVENTORY / PHYSICAL / MONEY (nothing deleted; no order in limbo; balance == its own ledger; no orphan payments; everything Ready has a location). Exits with the count failed so it can gate. *Test:* a planted violation is caught; a clean shop passes.
- [ ] **D3 · `test-render-live.js`** — draw every screen against REAL/seeded data, not just synthetic (the gate that catches "passes every other gate and still dies on the real data"). *Test:* a record shaped like a real one that throws is caught where the synthetic gate was green.
- [ ] **D4 · Crash reporter** — capture `window.onerror` + `unhandledrejection` at LOAD (a startup fault is the one you most need), dedupe by fault, cap per page-load, batch to a hub endpoint outside the synced DB. Surface in the owner report. *Test:* a thrown render is captured once (not 400×); the reporter can't jam itself (finally-cleared guard).

## Stage E — Durability that proves itself
- [ ] **E1 · Encrypted backup** — gzip → AES-256-GCM, key by scrypt, self-describing header. *Test:* a wrong passphrase throws; a tampered file throws (GCM authenticates); a round-trip is byte-identical.
- [ ] **E2 · `backup-verify.js`** — decrypt the newest artifact, count it against the live shop, run the invariants against the restored copy; publish the result WITH its age (`ok:null` = never run, deliberately not `true`). *Test:* a backup with half the customers fails; a good one passes; a stale verify reads as stale, not fine.
- [ ] **E3 · Idempotency keys on the money path** — a card charge carries an idempotency key; a retry with the same key never double-charges; the guard asks the append-only payments record, not a flag. *Test:* two sends with one key = one charge; the record is the source of truth.

## Stage F — Desktop shell (stretch; largest, most Ozark-specific — do last, mark optional)
- [ ] **F1 · Shell owns the machine** — station identity in a real file, printing, single-instance, offline boot — while the hub still owns the app so a deploy reaches every station in ~a minute. Only if the generalized value is clear; otherwise leave as a documented seam. The browser path stays supported forever (the driver is on a phone).

---

## Sequencing & checkpoints
A → B → C → D → E, in order (each stands on the prior). F optional/last. I execute a stage, run both gates, commit+push each unit, and update the checklist here. Natural check-in points are **stage boundaries** — I'll report what shipped and keep going, only stopping if genuinely blocked (e.g. push auth). No per-unit approval needed; that's the point of writing this down.
