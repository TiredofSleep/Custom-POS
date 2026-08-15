# The reference implementation — what "generalized enough to build Ozark" actually means

> **The whole origin app is now in this repo, at [`reference/ozark-pos/`](../reference/ozark-pos/).**
> Name-free, MIT, and it runs: 1,498 money assertions, 745 render assertions, 328 hub assertions, all green.
> Nothing here is a summary you have to trust — the source is beside it.

**Why it is here.** `OZARK-PARITY-ROADMAP.md` closed on 2026-07-08 with every stage shipped and
`tests/ozark-grade.js` proving the plant loop from config alone. That was true, and it was measured against a
reference nobody outside the origin project could read. The goal has always been that the builder can produce
*exactly* the origin app from generalized tools; you cannot check that claim against a description. Now the
target is in the repo.

⚠️ **This is a reference, not a source to copy from.** The origin app is ~1.5 MB and carries live-money scar
tissue this engine does not have and should not inherit — five years of one business's exceptions, hard-won
and specific. The engine is ~1/5 the size *because* each mechanism ships once, from config. Porting code
wholesale would destroy the thing that makes this project worth having. Read it for the **mechanism and the
reason**, then decide what the generalized shape is.

---

## The part worth reading first: the gates

`reference/ozark-pos/` ships seven test harnesses. They are the most transferable thing in it, because each
one exists for a failure that actually happened in a shop, and the comment says which:

| harness | the failure it refuses to let back |
|---|---|
| `check-app-js.js` | a syntax error reaching a till |
| `test-money.js` | every money bug that shop has had — duplicate charges, expiry formats, refunds that never reached the card |
| `test-render.js` | a screen that throws, or shows `undefined` to a human |
| `test-render-live.js` | ⚠️ a build that passes every other gate and **still dies on the real data** |
| `check-dead-buttons.js` | a control wired to a function that does not exist |
| `test-hub.js` | the merge, delta pulls, and the law that **absence is never a delete** |
| `audit-patterns.js` | a flag set on the way in and cleared only on the happy path |

**The transferable idea is not the assertions, it is the shape:** a test per lesson, named after the lesson,
with the incident in the comment. A generalized engine that emits a POS should be able to emit its gates too.

---

## What the origin app does that a generalized engine has to be able to express

Mapped into this repo's four layers, so it can be argued about in the language already used here.

### Core — where the origin app puts load the engine may not expect

| mechanism | why it exists | generalized shape |
|---|---|---|
| **Per-record merge, highest stamp wins, absence never deletes** | one station on a stale build wiped 21 records on every push | the sync contract, not a sync feature |
| **A hybrid clock, and reading two of them** | ~6,000 records carried millisecond stamps and 238 carried hybrid ones **on the same number line** — a stamp from six days earlier beat today's by a factor of 1,000 | any engine that ever merges needs one comparison function, in exactly one place |
| **Per-collection local persistence** | a whole-database write on every save cost 13 ms; per-collection costs 0.5 ms — and the hot path is the detail wizard, ~70 saves an order | "save what changed" is a Core concern once a shop has real volume |
| **Shape guard at the door** | six orders had no `lines` array; the detail screen read `o.lines.length` and every gate was green while a counter could not work | one guard where data ENTERS, not 176 guards where it is read |

### Common Commerce — the money interlocks

| mechanism | why it exists |
|---|---|
| **Duplicate-charge interlock** asking the *payments record*, not a flag | a household was charged twice, 44 seconds apart, because the one synced flag guarding the monthly run had been rolled back |
| **Ask the append-only ledger before collecting a debt** | a balance field and a status field both lied after a rollback; the ledger could not |
| **Idempotency keys on the card path** | a delivery charge whose success was written to an object the merge had already replaced |
| **Stored-credential flags** (`cof`/`cofscheduled`) | every charge after the first was rated as generic e-commerce |
| ⚠️ **A $0 verification is not proof a card can be charged** | a card "verified" at save time declined at the door next morning; the terminal had only *read* it |

### Lifecycle Packs — the cleaner pack, honestly described

Per-piece durable tags across visits · bay assignment with bag splitting · in/out reconciliation ·
per-store colored-paper print routing · a delivery route with stops, manifests and a driver wizard ·
lifecycle stages where **work only ever advances** (a one-way status law enforced on the server too).

⚠️ **The one-way law is the generalizable part.** Everything else is dry-cleaning vocabulary.

### Operations — what a real fleet turned out to need

Invariants (28 machine-checked rules across INVENTORY / PHYSICAL / MONEY) · a crash reporter that captures
faults **at load** and deduplicates by fault · encrypted off-site backups with a **weekly restore that is
actually performed** · per-station encrypted snapshots · a device registry that answers "which station is on
a stale build" · one appointed station for automatic work · remote station settings with a fixed vocabulary.

---

## ⚠️ What the parity roadmap never saw

It closed 2026-07-08. Everything below shipped **after** it, and most of it is not "features" — it is what a
POS turns out to need once several stations, a van and real money are involved for a few weeks.

1. **Delta sync, four phases** — the hub serves only what changed; devices push only what changed; local
   saves write only the collections that moved; the hub keeps an append-only delta log plus checkpoints and
   can rebuild any revision. ⚠️ Two bugs found by measuring rather than reasoning: tombstones were re-stamped
   on every push, so **every delta carried all 3,563 of them** (229,736 → 5,248 bytes per revision); and
   scalars/maps rode every delta whether or not they had changed (a further ~5.6 KB per revision, one of them
   unchanged in 2,406 of 2,408 sends).
2. **The mirror** — each station fingerprints its collections and the hub names which disagree. ⚠️ The
   algorithm block is byte-identical in app and hub, and a test fails if they drift.
3. **The hub refuses impossible timestamps** — clamped, not rejected, because the work is real and only the
   claim about *when* is false. ⚠️ A future-dated **tombstone** is dropped rather than clamped: a delete
   stamped "now" still outranks a real record.
4. **Image bytes can never enter the synced database** — converted to references at the door, not rejected.
5. **A desktop shell** that owns the machine (identity in a real file, printing, one instance, offline boot)
   while the hub still owns the app — so a deploy still reaches every station in about a minute.
6. **Backups that prove themselves** — encrypted, then decrypted weekly, counted against the live shop, and
   run through the same invariants. ⚠️ Published **with its age**, because a weekly job that silently stopped
   reads as "fine" forever.

---

## The five ideas underneath all of it

If nothing else survives the trip into a generalized engine, these should:

1. **An error must never render as good news.** An empty inbox on a failed fetch looks exactly like "no
   messages" — that is how a customer waited six days.
2. **Absence is never a delete.** Only a tombstone deletes. A record missing from a payload is kept.
3. **Ask the append-only record, never the flag.** Flags get rolled back by a merge; ledgers and payment
   rows do not.
4. **A test that cannot fail is not evidence.** Every fix here is disbelieved until it fails against the
   pre-fix code.
5. **Never delete, just mark.** Superseded code and docs carry a banner and stay, so a correction can be
   checked against what it corrected.

⚠️ And the one that cost the most to learn: **measure before you narrate.** A surprising number of the
incidents in that codebase are not bugs in the software — they are conclusions drawn from the wrong file, the
wrong machine, or data that predated the change.
