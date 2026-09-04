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
- [x] **A-engine · monotonic clock wired** — the engine stamps with `hlcNow()` (shared block matches the hub; `tests/engine-clock.js` proves drift-equivalence + monotonicity under a frozen AND a backward wall clock + a save stamps a hybrid `upd`). ↳ *delete-as-tombstone deferred by design:* the engine has no record-delete feature and pushes the whole DB (all records present), so absence-never-delete + the status law are already enforced by the hub for everything the app does; the read-filter (`!r.deleted`) lands with the first record-delete feature (e.g. builder catalog-item removal / admin void-to-delete).

## Stage B — Delta sync (stop shipping the whole DB)
- [x] **B1 · `deltaSince(rev)` — DONE (hub + engine).** The hub owns a monotonic `rev` (bumps per changing push), stamps each changed record `_rev`, and serves `GET /api/db?since=N` = only what moved (an idempotent re-push doesn't bump the rev or re-broadcast). `rev` on the health poll + POST reply. `tests/delta-sync.js`. ↳ **engine done:** `SYNC.pull()` asks `?since=<SYNC.rev>` and `applyRemote` MERGES the delta into the local DB via the client half of `mergeArr` (`syncMergeArr`, stampNewer + the one-way status floor, byte-identical logic to the hub) instead of adopting the whole DB. Bonus fix the merge buys: a wholesale adopt used to WIPE a device's local-only collections (punches/bookings the hub doesn't sync); the merge preserves them. `tests/delta-pull.js` watches the wire — a fresh device bootstraps `?since=0`, a caught-up device pulls one record via `?since=<rev>`, and the local-only collection survives.
- [x] **B2 · Push only what changed — DONE.** `SYNC.push()` uploads only the records/customers whose content differs from `_pushed` (the hub's last-confirmed copy, refreshed from every hub response) — dirty by signature, not a flag. An idle save sends no request at all; ringing one order uploads one record. Safe because the hub upserts and absence never deletes, so a partial push can't drop what it omits. `tests/delta-push.js` reads the POST bodies: first order = 1 record, idle save = 0 requests, second order = 1 record (a different id), with the intrinsic negative control that the old whole-DB push cannot satisfy either claim.
- [x] **B3 · Per-collection mirror + self-heal — DONE.** Every save mirrors each collection under its own key (`cpmirror::<dkey>::<col>`, rewritten only when that collection moved); the whole-DB blob stays canonical (written every save — backward compatible + the source that heals a corrupt mirror). `loadDB` reads the blob normally and reaches for the mirror ONLY when the blob fails to parse — then it REBUILDS the shop instead of returning empty (the empty-shop disaster is the one Ozark named worst). `tests/mirror-persist.js`: a save mirrors records; editing one collection leaves another's mirror byte-identical (contained blast radius); a corrupted blob heals from the mirror; a corrupted mirror is harmless while the blob is good and a save re-heals it. ⚠️ **Lesson banked:** the mirror keys first shared the `custompos_*` namespace and 7 tests that locate the blob by `startsWith('custompos_demo_')` picked up a mirror key and crashed — a new key family must not collide with the one existing tools already scan. Fixed with the distinct `cpmirror::` prefix.
- [x] **B4 · Append-only delta log + checkpoints + replay — DONE.** `commit()` (the server's merge path) appends one line per changing rev — the exact delta, built with `deltaSince` so the log and the wire can't drift — and writes a full checkpoint every `CHECKPOINT_EVERY` revs. `hub-replay.js` rebuilds any revision from the nearest checkpoint + the log through the SAME `mergeArr` the hub uses (ctx=null so a logged `_rev` is preserved, not re-stamped), and REFUSES on a hole — naming the missing rev — rather than skipping it (a rebuild that quietly drops a rev is the "error that renders as good news"). `merge` stays pure; only `commit` has side effects, so the other tests drive merges without touching disk. `tests/hub-replay.js`: checkpoints land on the interval; the latest, an intermediate (checkpoint+log), and a pre-checkpoint rev all rebuild byte-identical; a doctored log with a missing rev is refused by name.

## Stage C — Guards at the door (convert, never reject; never 176 guards where data is read)
- [x] **C1 · `shapeGuard` — DONE.** `commit()` fills a missing required array (`lines`) on incoming records at the door, once, before the merge — and logs each repair. A flood past `SHAPE_REPAIR_CAP` (500) is a different event (a corrupt bulk push) and is refused loudly, changing nothing. `tests/shape-guard.js` pins the load-bearing NEGATIVE control: `mergeArr` does NOT fill `lines` (the guard lives at the door, never in the merge, where touching an unchanged record would restamp it and roll others back — the 8/03 class); plus a well-formed record is left exactly as-is (no needless repair/restamp).
- [x] **C2 · `stampSanitize` — DONE.** `commit()` clamps an incoming `upd` beyond honest skew (`CLOCK_SKEW_MS`, default 5 min) down to now — the work is real, only the *when* is a lie, and left alone a future stamp beats every honest later edit until the wall clock catches up (a poison pill). A future-dated **tombstone** is DROPPED, not clamped (a delete stamped ahead of now would outrank a real record and erase it); the source re-offers it once the clock is honest. `tests/stamp-sanitize.js`: a far-future edit is clamped and kept, a within-skew stamp is left alone, a far-future tombstone is dropped, a future delete doesn't erase a live record, and the same delete stamped honestly does apply.
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
