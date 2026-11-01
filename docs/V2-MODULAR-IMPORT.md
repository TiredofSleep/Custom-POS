# Bringing the origin shop's v2 into Custom POS, as modules

*Roadmap, written 2026-10-10.*

*Status, 2026-10-31: **Stage 0 done** (in the origin shop's private repo) and **Stage 1 built here** and published that day with the owner's yes, after a second review.
The owner's direction that day: **v2 is to be the face of Custom POS.** The engine therefore leads, not sits behind the
blob-mode builder as an opt-in.*

- *Stage 0.* The private exporter exists. It refuses while anything real survives. It runs the engine laws inside its own output,
  traced, so every engine file is loaded. Its self-test proves each of its detectors on a sample only that detector catches, and
  two code-running reviewers tried to break it before it was trusted.
- *Stage 1.* The engine is in [`../facts/`](../facts/), imported through `tools/import-facts.js` and checked against the export's
  manifest. It comes with a small hub of this repo's own (`facts/server.js`), a browser bundler (`facts/bundle.js`), and the
  public refusal suite (`tests/public-refusal.js`).
- *Tests.* `tests/facts-engine.js` runs the 114 engine laws, the hub over HTTP and the bundle.
- *Stage 2, built the same night:*
  - `facts/modules/` holds the contract (`defineModule` / `assemble`, one judge for the hub) and the staff, with a PIN the hub checks
    itself (`staff.js`, `pingrant.js`). It also holds the **Time clock module** (`timeclock.js`), with breaks, a compat projection to
    `DB.punches`, and a history fixture.
  - The app's time clock runs on it in **facts mode**. The builder's *Several computers* turns that on and puts the engine in the
    download.
  - One hub answers both the facts and the blob records (`facts/server.js --with-blob`).
  - The gate is held: the two-station test (in Node and in a real browser), authority and PIN over a real hub, the history fixture,
    the time clock drawn in facts mode, and every shift time, the tip pool and labor cost equal from the compat projection and from
    blob mode's own clock run for the same actions at the same moments.
  - *A third review, before publishing* (three code-running reviewers, 27 findings, all taken): the documented hub command ran no
    rules and, with `--with-blob`, served its own database; a several-stations download carried every PIN; a reload left a tablet
    read-only; a mistyped device name went unnoticed; a staff name could run as HTML; connecting wiped a tablet's earlier punches.
    Most fixes came with a test (`facts/test/cli.test.js`, and the new checks in the module tests, `tests/facts-clock.js` and
    `tests/builder-facts.js`). An earlier version of this line said every fix had a test that failed before it, which was not true;
    the skeptic pass below found several fixes without one.
  - *A skeptic pass, then a pause.* Of 21 findings, 19 held up. One was in the published `hub.js`: a single bad GET could stop it.
    That fix was published alone, with a test. The rest showed where the bugs come from: the app side was wired into `pos.html` by
    hand for each module. **Stage 2's app half is held back, unpublished, until the time clock runs on the planned system in
    [Part 3b](#part-3b--the-app-side-module-system).** The findings key is in the JOURNAL (2026-10-31, night, "A skeptic pass, and
    a pause").
  - *Part 3b, rewritten the same night.* Its first version was designed from this repo alone and rebuilt the shop's own app design
    under new names. It now follows the shop's app, and where the two overlap they share one copy: generic code the shop runs comes
    here through the exporter, and fixes go into the shop's v2 first.
- *Not yet:* the optional hub job that closes a forgotten shift (`timeclock.autoCloseAfterHrs`) — the fact type is ready and only
  the hub may write it.

---

## Part 1 — In plain words (for a shop owner)

### What v2 is

The origin shop (a two-store wet cleaner) has run on two systems:

- **v1** is one big file that runs a whole shop. It is moving into Custom POS as the **Single-PC Edition**: one file
  on one computer, no server needed. It is not retired; it becomes a product of its own.
- **v2** is what the shop runs today. Every tablet writes down each thing that happens as a small, permanent note
  ("an employee clocked in at 8:02", "order 1841 paid $23.50"). The notes go to one small server, the **hub**. The hub
  checks each note and keeps the official copy. Every screen is then worked out from the notes. Nothing is ever
  overwritten or deleted. A mistake is fixed by adding a new note, so the record always shows what really happened.

That design is why v2 is safer for a shop with several tablets, a plant and a van. Two tablets can't overwrite
each other's work. A tablet that was offline all morning catches up without losing anything. Refunds,
pay-rate changes and store credit are checked by the hub itself, not just by the tablet.

### What "v2 as modules" means

Picture a phone and its apps. Custom POS will offer v2's abilities as separate pieces you switch on in the builder:
**Time clock**, **Checklists**, **Customers**, **Orders**, **Money and the drawer**, **Garment tags**, **Delivery
route**, **Card payments**, **Texts**, and more. Each piece brings its own screens, its own rules, its own printouts
and its **own tests**. Only the pieces you switch on go into your download. A pizza shop never carries garment-tag
code, and a cleaner without a van never carries route code.

### How the three editions fit together

| | **Builder POS** (today) | **Single-PC Edition** (new) | **Multi-Station Edition** (this plan) |
|---|---|---|---|
| What it is | The file the builder at custompos.org makes from your settings | The origin shop's v1 file, with no real names in it | The builder's file plus v2's note-keeping, built from modules |
| Computers | One, or several with the optional open hub | Exactly one | Several tablets and PCs, plus a hub |
| Where data lives | In the browser, synced as whole records | In the browser | As permanent notes, with the official copy on your hub |
| Server needed | No (optional) | No | Yes: a small server or one of your own PCs |
| Best for | Most small shops | A shop that wants exactly the origin shop's v1, on one PC | Shops with several stations, a back room, a van, staff PINs |

The Single-PC Edition and the Builder POS stay just as they are. The Multi-Station Edition is a new choice in the
builder ("one computer" or "several stations"), added one module at a time.

### What this plan does *not* do

It does **not** copy the shop's v2 into this public project. The shop's code is full of that one shop's own rules
(which days each store is closed, its holidays, its courier rush prices) and its own money history. We **rebuild**
each piece cleanly, using the shop's working code as the answer key, and we bring its tests along so the rebuilt
piece has to behave the same way.

### What stays free

Everything. Custom POS is MIT-licensed, and every module in this plan will be MIT too. There are no feature gates,
so the Multi-Station Edition is just as free as the rest. The only cost is running a hub if you want several devices
(a few dollars a month, or free on a PC you already own). Custom POS earns money only from optional card processing,
as it always has.

### How the shop is protected

- Nothing leaves the shop's private code except through a **scrubber** (Stage 0). The scrubber **refuses to run**
  if any real name, phone number, address, server address or secret survives. It then runs the shop's own tests
  against what it produced, so a scrubbed file that no longer works never ships.
- The owner says yes before anything goes public.
- This work never touches the shop's live system, its data or its server.

### What you will see first

**A time clock that every station shares.** Today in Custom POS, a clock-in made on one tablet stays on that
tablet; the hub never sees it. The Time clock module is the first one to move over, and it fixes that.

---

## Part 2 — The chosen shape

Three shapes were considered after a read-only survey of v2 (numbers are in the appendix).

| Shape | What it means | Verdict |
|---|---|---|
| **A. Engine transplant** | Import only v2's generic engine (notes, ordering, folds, hub), re-express Custom POS's features on it, and bring none of the shop's business code | **Used as step one** of C, not on its own: it brings none of v2's business depth |
| **B. v2 as a heavy pack** | Scrub all of v2 and ship it as a second engine file for "full-plant cleaner" | **Rejected** |
| **C. Strangler** | Add the engine as an opt-in storage mode, then move one module at a time, rebuilt rather than copied, with its tests | **Chosen** |

**Chosen: C, starting with A's engine-only import, then the Time clock module.**

Why C:

- Every step ships and is tested on its own. Nothing is half-moved for months.
- It matches the four layers in [FLOW-SCHEMA.md](FLOW-SCHEMA.md). v2's fact types map onto the module contract's
  `updates`, its aggregates onto `subRecords`, and its folds onto `views`.
- It finally lets the builder **strip** modules a shop doesn't use. Today `MODULES` in `pos.html` only reports
  labels, and the whole engine always ships.
- It keeps this repo's doctrine ([OZARK-REFERENCE.md](OZARK-REFERENCE.md)): the origin app is a reference, not a
  source to copy from.

Why not B:

- It breaks that doctrine: about 1.57 MB of v2 is v1 code copied verbatim, with the shop's rules hard-coded inside.
- It would mean two engines with different data models, screens and design.
- It would be a file of about 4.5 MB, with one card processor, one text provider and one accounting package
  wired straight in.
- It needs the heaviest scrub, again on every refresh, because the live shop keeps changing.
- Pulling config out of verbatim code breaks the shop's own port-and-recheck pipeline.

If the owner ever wants an exact copy of the shop's v2 for a second location of the *same* business, that is a
private build. It is never published.

Why not A alone: the engine is about one-twentieth of v2. The value people want is in the modules.

*Amended 2026-10-31, late (the owner: "the point is for all the systems to grow stronger together").* "Rebuilt rather than copied"
now covers only the shop's own screens and rules. Generic code the shop runs is shared through the exporter, unedited, and never
rebuilt here. See [Part 3b, section 1](#1-the-rule-where-the-two-systems-overlap-they-share-one-copy).

---

## Part 3 — The module contract

### What one module is

A module is one folder. It brings everything it needs, and nothing outside its folder may reach into it.

| Part | What it holds | Maps to FLOW-SCHEMA |
|---|---|---|
| **Fact types** | Each note kind the module may write, with a `validate` (shape, judged on every fact ever recorded) and an optional `admit` (policy, judged only on new facts) | `updates` |
| **Authority** | Per fact type: who may write it (`self`, a right such as `payroll`, `owner`, or `hub-only`) and whether the hub must check a PIN itself | (new) |
| **Aggregate** | One incremental fold, `{init, step, view}`, that reads only the module's own fact prefixes | `subRecords` |
| **Views** | Named read models the screens use (for example `openShifts`, `hoursByEmployee`) | `views` |
| **Screens** | Renderers for the station types it provides, written against Custom POS's design tokens and station renderer | `provides` |
| **Hub services** | Scheduled or reactive jobs that run only on the hub and write `hub-only` facts | (new) |
| **Effects** | Outside actions (a text, a charge, an e-mail) declared on fact types. They fire once, after the hub has the fact, and only when the matching switch is on | (new) |
| **Print** | Templates for the receipts, slips and labels it owns | (new) |
| **Config** | The settings it reads (`needsConfig`), each with a safe default | `needsConfig` |
| **Compat projection** | Optional, temporary: rebuilds the old blob-shaped collection from the view, so existing blob-mode code keeps working while the move is in progress | (new) |
| **Proofs** | Its tests: each names the failure it prevents, and each ships a negative control that fails without the fix | (new) |
| **History fixtures** | A saved fact log from each released version, which every later version must still load and fold | (new) |

### The manifest (proposed shape)

```js
/* @module @timeclock — shared punches, breaks and shift corrections, as facts */
defineModule({
  name: 'timeclock', version: 1, layer: 'operations',          /* core | commerce | pack:<trade> | operations */
  requires: ['staff'],                                            /* the build refuses a missing one */
  provides: { stationTypes: ['timeclock'] },
  facts: {
    'clock.in':        { validate: vIn,     authority: 'self-or:payroll' },
    'clock.out':       { validate: vOut,    authority: 'self-or:payroll' },
    'clock.break':     { validate: vBreak,  authority: 'self-or:payroll' },   /* new: Custom POS has breaks; v2 does not */
    'clock.edit':      { validate: vEdit,   authority: 'needs:payroll', pin: true },
    'clock.void':      { validate: vVoid,   authority: 'needs:payroll', pin: true },
    'clock.manual':    { validate: vManual, authority: 'needs:payroll', pin: true },
    'clock.autoclose': { validate: vAuto,   authority: 'hub-only' }
  },
  aggregate: { name: 'timeclock', inc: { init: init, step: step, view: view } },
  views: ['shifts', 'openShifts', 'hoursByEmployee', 'orphans'],
  screens: { timeclock: renderClockStation, 'office:payroll': renderShiftEditor },
  hubServices: [{ id: 'autoclose', every: '15m', when: function (cfg) { return cfg.timeclock.autoCloseAfterHrs > 0; }, writes: ['clock.autoclose'] }],
  effects: [],
  print: { 'shift-slip': tplShiftSlip },
  needsConfig: ['labor.mealAfterHrs', 'labor.mealMins', 'labor.restEveryHrs', 'labor.restMins', 'timeclock.autoCloseAfterHrs'],
  compat: { punches: punchesFromView },                           /* feeds DB.punches readers until they read the view */
  proofs: 'proofs.js', fixtures: ['fixtures/v1.facts.json'],
  budgetKB: 60
});
```

The hub builds its authority table (v2 keeps one central `RULES` list) and its PIN-checked list from the manifests
of the modules it loads. A privileged fact type with no authority entry stops the hub from starting.

### The laws every module obeys

These come from v2's own design and its proofs. They are the reason the engine is worth importing.

1. **`validate` may only widen.** The hub re-validates every fact ever written each time it loads. If a later
   version narrows a validator, the history stops loading. Policy that can change belongs in `admit`, which judges
   new facts only. Custom POS starts with no history, so its validators can be strict from day one. After a
   release, though, they can only loosen.
2. **Constants inside a fold are law, not settings.** v2's time clock treats a shift over 16 hours as long and a
   second tap within 10 minutes as a double tap. Changing those numbers would change how *old* history reads. A
   shop-adjustable threshold is therefore stamped into the fact when it is written, or it ships as a new module
   version that must fold every saved fixture the same way.
3. **Config never changes what a fact means.** Config can hide a screen, change a default or set an `admit` rule.
   It never feeds into `validate` or `step`.
4. **A module with history is never removed.** Switching a module off hides its screens and makes `admit` refuse
   its new facts. Its fact types stay registered so the log still replays. The bundle keeps a dormant copy:
   validators and the fold, without screens.
5. **Effects fire once, after the hub has the fact, and only behind a switch.** Every outside path (cards, texts,
   e-mail, printing) has an off switch that is off by default, plus a proof that nothing leaves while it is off.
   An effect added after facts already exist never fires over old history (v2's `effectsDigest`).
6. **Folds read only their own prefixes.** One aggregate never reads another's facts. A screen or a hub service
   that needs two modules declares both in `requires`.
7. **Validate at the door.** A fact that fails `validate` is refused before it gets a receipt number, both on the
   station and on the hub.

### How Custom POS's Phase-2 laws carry over

[PHASE-2-SUBSTRATE.md](PHASE-2-SUBSTRATE.md) built sync safety for the blob. In facts mode, each of those laws has
a direct counterpart, and the proof travels with it:

| Phase-2 law (blob mode) | Facts-mode counterpart |
|---|---|
| Absence is never a delete | The log only appends. A void or a retirement is itself a fact |
| Ask the append-only record, never the flag | The record *is* the append-only log; every flag is a fold |
| One stamp comparison | One hybrid logical clock gives one total order on station and hub |
| Stamp sanitising | Clock stamps are bounded when they are made, so a lying clock never enters the order |
| Shape guard at the door | `validate` runs before a receipt number is spent |
| Delta sync | Pull by position and epoch |
| Mirror fingerprint | Hash receipts: the hub must echo exactly what the station wrote, or the station keeps sending |
| Blob guard | Facts carry photo ids, never image bytes |
| An error never renders as good news | The hub saves before it answers. A refused fact stays owed on the station and raises one alert |
| Idempotent charge | A fact id is admitted once, and an effect's done-mark is made durable before the outside call |
| Crash reporter, encrypted backup, backup-verify | Unchanged in shape; re-pointed at the hub's SQLite store in Stage 6 |

### Worked example: the Time clock module

**Why it goes first:**

- It fixes a real Custom POS gap. `DB.punches` is a device-local collection that the hub does not sync (see the
  comment above `applyRemote` in `pos.html`), so on a multi-station shop each tablet sees only its own clock-ins.
- It is v2's most proven aggregate. The engine's law proofs (private suite sections 1 to 22) were written against
  it: double taps across two devices, a clock-out that arrives before its clock-in, an autoclose guess that must
  never outrank a real punch.
- It is self-contained (418 lines, no brand words). It needs only `staff` for the authority checks.

**What comes from v2 (rebuilt, not copied):**

- The six `clock.*` fact types and their validators.
- The fold that resolves which shift a clock-out closes, keeps orphans visible and keeps both sides of a genuine
  dispute.
- The authority rules: `clock.in` and `clock.out` are the person themselves or someone with `payroll`; edit, void
  and manual need `payroll` plus a PIN the hub checks itself.

**What Custom POS adds:**

- `clock.break` facts, because Custom POS already tracks breaks and [WORKER-RIGHTS.md](WORKER-RIGHTS.md)
  reminders depend on them.
- The `FLOW.labor` rules (meal and rest timing) as `needsConfig`.
- Wage at punch time, carried on `clock.in` exactly as `DB.punches` carries it today.

**Its hub service is new.** v2 registers and folds `clock.autoclose`, but nothing in the shop writes it today.
Custom POS adds an optional hub job, off unless `timeclock.autoCloseAfterHrs` is set, so a forgotten clock-out is
closed as a visible guess.

**Its screens** are Custom POS's existing time-clock station, reading the `openShifts` view instead of
`DB.punches`. The compat projection `punchesFromView` feeds the existing tip-pool and labor-cost code
(`poolHours`, `dayLaborCost`) until they are moved to read the view directly.

**Its proofs:**

- the engine laws that use it, renamed;
- a two-station test: clock in on station A and see it on station B, with the negative control that blob mode
  does *not*;
- a privileged-fact test over a real hub: an edit without `payroll` is refused, an edit without a hub-checked PIN
  is refused, and an edit with both is admitted;
- a history-fixture test: the v1 fixture log folds to the saved views.

---

## Part 3b — The app-side module system

*Rewritten 2026-10-31, late, to follow the origin shop's own app. Not built yet.* The first version of this part (commit
`6165c46`, from a three-designer panel) was drawn from this repo alone. None of its designers read the shop's tablet app, which
had already solved the same problem and has run it every day since the shop switched to v2 on 9/30. So it rebuilt most of the
shop's design under new names. The owner, on reading it: *"i thought this was all organized and modeled around the POS i have
running at my shop... ?"* And on the rewrite: *"the point is for all the systems to grow stronger together... and to be sure that
what i am sharing with people is functional because i use it daily."*

Rebuilding had already cost something. Finding 0.4, a `role: null` that slipped past the last-owner rule, was in this repo's
rebuilt staff module. The shop's own staff fold never had it: a null role there leaves the person's role as it was.

Finding numbers (0.1 to 2.6) refer to the skeptic pass's list in [the JOURNAL](../JOURNAL.md) (2026-10-31, night, "A skeptic
pass, and a pause").

### 1. The rule: where the two systems overlap, they share one copy

| The code is… | Then |
|---|---|
| generic, and running at the shop | it comes here through the exporter, unedited, with the shop's own proofs. It is never rebuilt. |
| generic, but tangled with the shop's own rules | it is untangled **in the shop's v2 first** (a normal v2 change: the shop's suite, a 7 PM deploy with the owner's yes, then daily use), and exported after that. |
| the shop's own: its screens (v1's code, copied verbatim), its price rules, its card processor, its text provider | it stays private. A module here is written in the shop's shape, not copied. |
| needed here and not at the shop (breaks, auctions) | it is this repo's own module, in the same shape. If the shop ever wants it, it moves into v2 the same way. |

Two consequences:
- **Fixes flow both ways.** A bug found here in a shared file is fixed in v2, proven by the shop's suite, and exported again. An
  imported file is never patched here (already the rule; `PROVENANCE.json` checks it). A good idea that starts here and touches a
  shared file goes into v2 first.
- **What is shared is what the shop runs.** The exporter will refuse a file that changed after the build the shop is running, so
  every shared file has run at a real shop before it is published here. `PROVENANCE.json` names the shop build it came from.

This amends Part 2's "rebuilt rather than copied". That still holds for the shop's screens and rules (about 1.57 MB of v1 code
copied verbatim, with the shop's rules inside). It no longer holds for generic pieces.

### 2. How the shop's app is built

The shop's tablet page is `station/app.js` (7,110 lines). Beside it are 89 files in `core/` (the engine, the rules and the
screens), 22 folds in `aggregates/`, and the engine this repo already imported. Its pattern has five parts:

| Part | Where in v2 | What it does |
|---|---|---|
| **One door** | `rec(type, key, payload, actor)` in `station/app.js` | Records one fact on this tablet under the person whose PIN approved it, or else whoever is working the screen. A refused fact shows why and returns false. |
| **Screens read folds** | `views()`, `logFold(name)`, `foldOnce`, `followerOf` in `station/app.js`, over `core/incfold.js` | Every number on screen is folded from the facts, one fold per subject (orders, money, customers, clock, staff…). Each fold follows the log one fact at a time, so a tap costs the same in year five as on day one. An answer is reused until a fact arrives. A "screen check" switch freezes the answers and compares each followed fold with a whole fold, so a screen that writes into shared data names itself. |
| **Each function is a kit** | `core/<name>.js`: `kit(env)`, and below `/*ADAPTER*/`, `kitFor(folds, ctx)` | The kit is the screen code, written against a `DB` in the old shape and handed its doors (`toast`, `modal`, `can`, `saveDB`…). The adapter builds that `DB` from the folds, and gives the kit a `saveDB` that compares the `DB` with what it was and hands the differences to `ctx.onSave(facts)`. Example: `core/stafftime.js`, where a signed time change becomes a `punch.ack` fact. |
| **Redraw only on change** | `syncNow`, `syncRepaint`, `typing()`, `homeDue()` in `station/app.js` | One sync tick every 5 seconds. The screen is redrawn only when the tick brought new facts, never while someone is typing in a box, and Home only when something it shows changed. |
| **The hub checks the PIN** | `hub/pingrant.js`, `PIN_CHECKED` in `core/staff.js`, `hub/authority.js` | A PIN checked by the hub earns that person on that tablet a 30-minute pass. Privileged facts (people, roles, payroll edits, refunds…) are admitted only with one. Clock-in and clock-out are never checked, so the internet never keeps anyone off the clock. A change made after a pass ended waits on the tablet until that person's next PIN sends it. |

Under it all, the registry (`core/registry.js`, already imported) gives every fact type its one fold and its checks, including
the id rule (letters, digits and `_ . : -`, 1 to 64 of them) for any id a new fact creates.

### 3. What this repo has today, and what replaces it

| Stage 2 today (unpublished) | Replaced by |
|---|---|
| the FACTS MODE block in `pos.html` (about 190 lines: connect, pull, refresh, record, status) | the shop's door and folds, exported (rollout steps 1 and 3) |
| 16 places in `pos.html` that ask `FACTS.on` | none: the time clock becomes a kit, and a kit does not know which mode it runs in |
| `facts/modules/staff.js`, rebuilt, with its own fact type `staff.set` | the shop's `aggregates/staff.js` and `core/staff.js`: `employee.set`, field by field, and `staff.roles` |
| `facts/modules/pingrant.js`, rebuilt | the shop's `hub/pingrant.js` (91 lines, nothing of the shop's in it) |
| a planned `ids.js` | nothing new: the registry's id rule is already here |
| a planned way to close old open shifts at the switch | the shop's way: old punches come over as history (`aggregates/punches.js`), and an open one ends at that person's next clock-out (`station/app.js`: "a shift begun on v1 ends here") |
| the time clock module, `facts/modules/timeclock.js` | kept: it already uses the shop's `clock.*` types and fold. Breaks stay this repo's own (`clock.break`), because the shop has no breaks. |
| `define.js`: a module declares its facts, who may write them and which need a PIN | kept for this repo's own modules. In the shop the same rules are central lists (`hub/authority.js`, `PIN_CHECKED`); see section 6. |

### 4. The time clock, rebuilt in the shop's shape

- **`clockKit(env)`**: today's blob-mode clock code (`clockIn`, `clockOut`, `startBreak`, `endBreak`, the PIN pad), moved into one
  function. It reads `DB.staff` and `DB.punches` and calls `saveDB()`. In blob mode, `env` is the real `DB` and the real `saveDB`,
  so nothing changes.
- **`clockKitFor(folds, ctx)`**: the adapter. It builds `DB.punches` from the clock fold and the breaks fold (Stage 2's compat
  projection already does this). Its `saveDB` compares the punches with what they were: a new punch becomes `clock.in`, an out time
  becomes `clock.out`, a break becomes `clock.break`. Those go to `ctx.onSave(facts)`, then through the door, under the person
  whose PIN was entered.
- **The wiring is the shop's.** The shop's page repeats the same few lines of `onSave` (record each fact under the right person,
  then sync) 24 times. That becomes one helper in v2 first, and this repo uses the same helper.
- **What goes:** the FACTS MODE block and the `FACTS.on` checks.

### 5. The findings, and how this design answers them

| # | Finding | How it is answered |
|---|---|---|
| 0.2, 1.4 | a device name with a space was taken, and the refusal was never shown | the registry's id rule, checked at Connect; the door shows every refusal |
| 1.0 | a manager-approved refund logged, but the order stayed paid | the approval runs as a kit, and its save becomes the facts |
| 1.1 | an open punch from before the hub stayed open forever | carried over as history; it ends at the next clock-out |
| 1.2 | staff names ran as HTML in the Office report | one `esc()`, handed to every kit |
| 1.3, 2.4 | the sync redraw wiped typing; "redraw only on a change" had no test | the shop's redraw rule, with its proofs |
| 1.5 | a refused team add said "is on the hub" | the PIN pass: a privileged change without one waits on the tablet, counted in "waiting to send" |
| 1.6 | a read-only second tab saved its frozen punches | folds are never saved, and only one tab writes (`store/browser.js`, already imported) |
| 1.7, 1.8 | a double tap on Connect; "Checking…" left on screen | this repo's own (the shop connects by setup codes, which are v1's code): fixed and tested here |
| 2.2 | the cap on breaks had no test | a law of the breaks fold, proven here |

### 6. What the shop gains

- Its generic app code moves out of the 7,110-line `station/app.js` into small files with their own proofs, easier to read and test.
- The 24 copies of the `onSave` wiring become one.
- Every shared file gets a second set of reviewers: this repo's tests and reviews run against the same file the shop runs. This
  rewrite already checked one: the role-null gap above is not in the shop's code.
- **Later, only if the owner wants it:** this repo's idea of a module declaring its own write rules and PIN checks (`define.js`)
  could replace the shop's central lists, in v2 first. Then the two would share one module format.

### 7. Fitting the next modules (Stage 3 and on)

Checklists, time off, support tickets and supplies each have a small fold in v2 (`aggregates/checklist.js`, `timeoff.js`,
`support.js`, `supplies.js`). They come over shared once checked for the shop's own rules. Their screens in v2 are v1's code copied
verbatim, so the screens here are written as this repo's own kits, in the shop's shape. The auction modules are this repo's own,
in the same shape.

### 8. Rollout

1. **In the shop's v2 (the owner's yes; deployed at 7 PM):** move the generic app code out of `station/app.js`, unchanged:
   `station/views.js` (the folds the screens read, the followers, the screen check) and `station/record.js` (the door and one
   `onSave` helper). The shop's full suite and the screen check prove it. Nothing changes at the counter.
   *Built 2026-10-31, not deployed yet.* The 24 hand-written `onSave` wirings are now one `saveAs()`. The shop's suite passes 1,659
   of 1,659, including a new section that pins what the two files promise. The tablet page loads in Chrome. The deploy waits for
   the owner's yes, at 7 PM.
2. **In the shop's v2, a separate deploy:** untangle the staff rules. The discount helpers leave `core/staff.js` (they reach into
   the shop's price rules), and the list of abilities (Void, Un-rack, Payroll…) becomes one a shop's modules add to, with the
   shop's own list added at start. This touches the shop's permissions, so it is its own step, with its own proofs.
3. **The exporter:** add those files and `hub/pingrant.js`, `aggregates/staff.js`, `core/staff.js` and `aggregates/punches.js`,
   with the suite sections that prove them. Add the check that a file has not changed since the build the shop is running.
4. **Here:** import them. Replace the rebuilt staff and PIN files, and the `staff.set` type.
5. **Here:** the time clock as a kit and an adapter. Delete the FACTS MODE block and the `FACTS.on` checks. The parity tests
   (`tests/facts-clock.js`, `tests/builder-facts.js`) must pass, changed only where they name the old staff fact.
6. **One skeptic pass, then the owner's yes to publish.**

### 9. Risks

- **Steps 1 and 2 touch the shop's live tablet page and its permissions.** Step 1 is a pure move, step 2 a careful one, and the shop
  runs on both. Each gets the full suite, the screen check, a 7 PM deploy, the owner's yes, and a one-commit revert.
- **An adapter can misread a change**, since it compares before and after. The shop has run its kits this way every day since 9/30.
  Here, the parity test guards it: the same taps in blob mode and facts mode must give the same hours, tips and labor cost.
- **Shared files tie the two together.** A change in v2 can break this repo at the next import. That is the point: it is found
  here, and fixed in v2 for both.

### 10. Decisions for the owner

The first version asked five questions. The shop already answers four of them, and the owner answered the fifth (2026-10-31).

1. **Moving to several computers while people are on the clock.** *The shop's answer, adopted:* old punches come over as history,
   and an open shift ends at that person's next clock-out. Nobody has to clock in again.
2. **Which actions wait for the hub.** *The shop's answer, adopted:* nothing waits when it is written. A privileged change needs a
   pass from a PIN the hub checked; one made without a pass waits on the tablet until that person's next PIN. Clock-in and
   clock-out never wait.
3. **Going back to one computer.** *The shop's answer, adopted:* only by a deliberate step, never automatically. That is how the
   shop's own way back from v2 to v1 was planned.
4. **Customer and bidder contact details.** *Decided by the owner: erasable on request, the shop's way.* In his words: *"yes
   erasable on request... same as mine basically, it still lives in the history and activity log... just cleared from the UI"*.
   A request clears the person's details from every screen. The facts and the activity log keep them, as the shop's history keeps
   every retired record. It is built in v2 first (Stage 4), so both systems share it.
5. **Download size.** *Not a shop question.* The shop's tablets load a 2.9 MB page (912 KB compressed) every day. This repo's own
   limit is raised as shared files arrive, measured compressed. A builder that packs only the modules a shop uses comes later.

---

## Part 4 — Stage 0: the private exporter (nothing of v2 is copied before this exists)

The v1 snapshot in [`../reference/ozark-pos/`](../reference/ozark-pos/) reached this repo through a private
exporter whose discipline worked. v2 gets one built the same way. It lives in the shop's **private** repository,
beside the v2 code. It is a tools file, not part of the station bundle, and it never runs on the live server.

**Its discipline:**

1. **It never scrubs in place.** The private repo keeps its evidence. Each lesson stays pinned to the case that
   caused it. The exporter writes a *separate* tree to a temporary folder outside both repositories.
2. **It ships an explicit allowlist, not a denylist.** Each file that ships is named, with the public path it
   lands on (for example `core/hlc.js` becomes `facts/core/hlc.js`). Anything not listed does not ship. The first
   allowlist is the engine only (see Part 6).
3. **It uses explicit maps, read in context, never a clever regex.**
   - An identifier map: `OZARK_V2_*` becomes `CUSTOMPOS_*`, `x-ozark-*` headers become `x-custompos-*`, and
     `ozark-v2-*` storage keys become `custompos-*`.
   - A people map: name for name, keeping the shape where a test depends on it, exactly as v1's exporter learned.
   - A protected-words list for real surnames that are also ordinary English words, so the scrub never renames
     code.
4. **It refuses while anything real survives.** The refusal scan covers:
   - real names, from the people list;
   - phone numbers outside the fixture range;
   - e-mail addresses outside example domains;
   - IPv4 addresses other than loopback;
   - the business's hostnames and domain;
   - server paths under `/opt/`;
   - Windows user paths;
   - the brand word in identifiers;
   - the two town names.

   The scan prints counts and file:line locations, never the matched text.
5. **It runs the real gates on its own output:**
   - `node --check` on every emitted file;
   - a require-closure check (every relative `require` resolves inside the allowlist, with `crypto` mapped to the
     browser shim);
   - the v2 proofs that belong to the shipped files, run against the *exported* code, ending "N passed, 0 failed".
6. **It proves its own refusal.** A `--selftest` plants one of each forbidden kind into a throwaway copy and
   requires the scan to refuse each one, by kind. A scrubber whose refusal was never seen to fire is not evidence.
7. **It has a fast `--check` mode.** The scrub and refusal scan run, then it stops before the slow gates. It is
   cheap enough to run before every v2 commit, so a real number that slips into a fixture is caught the day it
   lands.
8. **It writes a manifest.** It emits a manifest (file, bytes, sha256, source commit). The import into Custom POS
   copies exactly what the manifest lists, from the exporter's output only, never from the private tree.

**A fresh people list comes before any ported business code.** v1's lists date from mid-August and cover the
people v1 knew. v2's ported kits also carry staff and newer customers, so treat the August counts as a lower bound.

- The engine files contain no customer references, so the first exports can run on the existing lists plus the
  pattern scans.
- Before any aggregate or kit with v1 comments in it is exported (Stage 3 onward), the private side builds a
  fresh refusal list from the hub's own staff and customer views. It is read-only, kept private, never printed and
  never committed to this repository.

**This public repo can never hold the people list.** Its own refusal suite (Stage 1) therefore scans only for
*patterns*: phones, e-mails, IPs, hostnames, server paths, user paths and brand identifiers. The name check
happens privately, at export time.

---

## Part 5 — The staged roadmap

Every stage ends at the same **standing gate**, on top of its own:

- `node run-tests.js` green: all the existing browser suites plus every module's proofs;
- the public refusal suite clean;
- the size budget held;
- the live render of every station with 0 console errors in Chrome (this repo's standard);
- `node --check` on every edited JS file;
- local commits only. The owner says yes before anything is pushed, because pushing publishes to custompos.org.

### Stage 0 — The private v2 exporter
- **What:** Part 4, starting with the engine allowlist.
- **Gate:**
  - `--selftest` refuses each planted kind;
  - `--check` passes on the real engine files;
  - the engine proofs (private sections 1 to 21; section 22 needs a hub server, see Stage 1) pass against the
    exported tree;
  - nothing is written inside either repository.

### Stage 1 — The facts engine, imported (Shape A's step)
- **What:**
  - Import the exporter's engine output into `facts/` (core, sync, browser store, hub, SQLite store).
  - Write a **new minimal hub server** for facts mode: enrolment, push, pull, health, and nothing else. v2's own
    server is 134 KB with 35 internal dependencies, most of them shop services, and it is not imported.
  - Re-target private section 22 (the hub over real HTTP) at the new server.
  - Port the bundler (`facts/bundle.js`, already a zero-dependency CommonJS-to-one-file bundler with a closed
    file list). The builder's `build.js` inlines the bundle only when a flow chooses `storage: "facts"`.
  - Keep the hub's one dependency on ported v1 code, the small stale-build helper (2.7 KB, generic, no brand
    words), labelled as a port.
  - Add the public refusal suite to `run-tests.js`.
- **Gate:**
  - the engine law proofs, renamed, pass in Node;
  - the bundle builds and refuses a require outside its list (negative control);
  - every existing suite is untouched and green (blob mode is not changed);
  - the hub refuses an unenrolled device;
  - durability before witness: a store that refuses a write makes the hub refuse to acknowledge.
- **Budget:** about 150 KB added to a facts-mode download (station side). Blob downloads add 0 bytes. *(As built: ~187 KB raw
  with the engine's comments kept, ~57 KB gzipped; facts/test/bundle.test.js bounds it at 200 KB raw and 70 KB gzipped.)*
- **Runtime:** the facts hub needs Node 22 or newer (`node:sqlite`). The existing open `hub.js` stays as it is for
  blob mode.

### Stage 2 — Module system, plus the first module (Time clock)
*Status, 2026-10-31: the hub half is built. The app half is held until the time clock runs in the shop's shape, on files shared
with the shop ([Part 3b](#part-3b--the-app-side-module-system)). Part 3b's rollout replaces the hand-wired facts mode in `pos.html`,
and the rebuilt staff and PIN files with the shop's own.*

- **What:**
  - `defineModule()`, the manifest checks (requires-closure, authority entries for every privileged type,
    `needsConfig` defaults), and the hub assembling `RULES` and the PIN list from manifests.
  - The Time clock module (Part 3 example).
  - During the move, one hub process serves both routes: the facts routes and the existing `/api/db` blob merge.
    A shop then has one hub URL while records are still blob and punches are facts.
- **Gate:**
  - the two-station test (with its negative control);
  - the authority and PIN tests over a real hub;
  - the history-fixture test;
  - render-live draws the time-clock station in facts mode;
  - tip pooling and labor cost give the same numbers from the compat projection as from `DB.punches` on the same
    seeded day.

### Stage 3 — The other operations modules
- **What:** checklists, time off, support tickets, supplies. Each is a small aggregate in v2 (under 70 lines each).
  Supplies' texts to suppliers wait for Stage 6 effects; until then they are recorded only.
- **Before it starts:** the fresh people list (Part 4).
- **Gate:** each module's proofs, history fixture and screens render, plus one export-diff review per module (what
  the shop's version has that the rebuilt one deliberately leaves out).

### Stage 4 — Core: customers, staff, price book, audit, money
- **What:**
  - Rebuild the core aggregates generically. A card payment carries a generic `processorRef`, not one processor's
    order id. Per-store tax comes from config.
  - Bring v2's refund law: a refund is the owner's, or the counter's only to complete an owner-approved refund, on
    that order, never more than approved and never twice.
  - Add a **blob-to-facts importer** so an existing Custom POS shop can switch to facts mode.
- **Gate:**
  - money proofs: a balance is a fold; no charge is admitted twice; refund only by approval; store credit never
    goes below zero;
  - the importer round-trip (a seeded blob shop imported to facts produces the same totals, customers and open
    balances), with a negative control that a dropped record is caught.

### Stage 5 — Orders, without the cleaner built in
- **What:** v2's orders aggregate is cleaner-shaped (detail, assemble, rack). Rebuild it as one generic order with
  stages taken from the flow's `stateMachine`. A stage change is a fact naming the stage. Whether that stage is
  allowed for this flow is an `admit` rule, never a `validate` rule (law 3).
- **Gate:**
  - every builder template runs end to end in facts mode;
  - `tests/ozark-grade.js` passes in facts mode;
  - an order can never move backward (the one-way status law, now as a fold).

### Stage 6 — Outside effects behind the existing seams
- **What:**
  - Card charges through Custom POS's existing `PAYMENTS` seam and its CardConnect adapter (`payments/pay-server.js`).
  - Texts and e-mail through `NOTIFY`.
  - Effects are declared on fact types and run by hub services behind `CUSTOMPOS_CARDS`, `CUSTOMPOS_SMS` and
    `CUSTOMPOS_EMAIL`, all off by default.
  - Backups re-pointed at the SQLite store.
- **Gate:**
  - one proof per switch that nothing leaves while it is off;
  - effects fire once across a retry, a reboot and a full disk;
  - tests talk only to fakes on 127.0.0.1;
  - no credential appears in the bundle, a fact, a log or a test.

### Stage 7 — The trade pack for cleaners
- **What:** garment tags (serialized units), production days, the delivery route, the drop box, inventory.
  - **Prerequisite:** split v2's four coupling hubs into a generic part and a pack part. These are admin (depended
    on by 17 modules), route (15), texts (12) and print (10).
  - Rules that were hard-coded in the shop become pack config with neutral defaults: closed weekdays per store,
    holidays, the rush table, which store is the plant, and route-weekday promise dates.
- **Gate:**
  - building with the pack removed still passes (the require-closure proves no generic module needs the pack);
  - the full-plant cleaner template passes in facts mode;
  - each moved rule has a test that it is read from config, not code.

### Stage 8 — The builder chooses
- **What:**
  - The builder asks "one computer or several stations?"
  - For several stations, it emits the single-file station page with only the enabled modules inlined, plus a hub
    package: the hub server, the module list, and an env example listing variable **names** only.
  - The builder also emits the enabled modules' proofs alongside the download, so a shop's own Claude Code
    session can run them after customizing.
- **Gate:**
  - for every template, both modes are built and the emitted output runs render-live and the module proofs;
  - the size report is printed and checked against the budgets.

### Later and optional — Facts mode with no hub
- **What:** a facts-mode download that runs the hub inside the page for a single PC.
- **Why it waits:** v2's hub requires a synchronous store that saves before it answers. A browser's durable
  storage is either asynchronous (IndexedDB) or small (localStorage). Until a proof shows durability before
  witness inside a browser, one-computer shops are served by the Builder POS and the Single-PC Edition. That is
  stated plainly, not hidden.

---

## Part 6 — The first unit (next session)

**Unit 0.1: the v2 exporter's engine-only `--check`, with a self-test, in the private repository.**

- **Where:** a new tools file in the shop's private repo, on the v2 branch. It is not in the station bundle's file
  list, and it is committed only by the session that owns that repo, with the owner's yes. No deploy is involved.
  Nothing is written into this public repo.
- **Allowlist:**
  - the station-side engine: `core/event.js`, `core/hlc.js`, `core/registry.js`, `core/incfold.js`, `core/log.js`,
    `core/station.js`, `sync/sync.js`, `sync/http.js`, `store/browser.js`, and the browser crypto shim;
  - the hub side: `hub/hub.js`, its stale-build helper `hub/buildwatch.js`, and `hub/sqlite-store.js`;
  - the test harness;
  - each with its public target path under `facts/`.
- **Maps:**
  - the three identifier families (env names, request headers, storage keys);
  - the one engine proof title that carries a real first name, which is mapped to a neutral title;
  - v1's existing people and protected-word lists, *imported* from the v1 exporter rather than copied.
- **Refusal scan:** every kind in Part 4. It prints counts and file:line only.
- **`--selftest`:** plants a phone number, an e-mail, an IP, a hostname, a server path, a Windows user path, a
  brand identifier and a listed surname into a temp copy, and requires a refusal for each, by kind.
- **Output gates:**
  - `node --check` on every emitted file;
  - the require-closure check, with no exceptions: every relative `require` lands inside the allowlist. The only
    Node built-ins allowed are `crypto` (mapped to the shim on the station side) and, on the hub side only,
    `node:sqlite` and `fs`.
- **Output:** a temp folder outside both repositories, plus `manifest.json` (path, bytes, sha256, source commit).
- **Done when:**
  - it exits 0 on the real engine files;
  - `--selftest` exits 0 only because each planted kind was refused;
  - it wrote nothing inside either repository;
  - `node --check` passes on the exporter itself;
  - each new function carries a `/* @tag — purpose */` label like its neighbours.
- **Not in this unit:**
  - running the engine proofs against the output (unit 0.2);
  - the fresh people list (before Stage 3);
  - any change to Custom POS.

---

## Part 7 — Risks, what must never be ported, and how the gates travel

### Risks

| Risk | What we do about it |
|---|---|
| **A real person's name, number or address reaches the public repo** | Allowlist, not denylist. The refusal scan blocks the export. A fresh people list comes before any ported business code. A public pattern suite runs on every test run. The owner says yes before any push |
| **Drift**: the live shop keeps changing v2 | The rule runs one way only (shop v2 → Custom POS, through the exporter). Parity is about behaviour, never byte-for-byte. Each module records the source commit it was rebuilt against, and a re-export diff shows what changed upstream |
| **Two storage modes live side by side for a while** | Facts mode is opt-in. Blob-mode suites are never edited to pass. Retiring blob mode is a separate decision, made only after facts mode reaches parity, and possibly never |
| **A narrowed validator breaks a shop's history** | Law 1, plus a history fixture per released module version that every later version must load |
| **Config re-reads history** | Laws 2 and 3. Thresholds are stamped into facts, and config feeds `admit`, never `validate` or `step` |
| **An effect fires twice, or fires over old history** | Effects only after the hub has the fact, a durable done-mark before the outside call, `effectsDigest`, and switches off by default |
| **The facts hub needs Node 22 and SQLite** | Stated in the hub package. The blob hub stays for shops that do not want facts mode |
| **The hub is internet-facing** | The facts hub enrols devices with hashed tokens and admits each fact id once. HTTPS is required, as [HUB-SYNC.md](HUB-SYNC.md) already says |
| **A stolen tablet** | Said plainly, as v2 says it: the hub cannot tell who is holding a tablet. A PIN checked by the hub, plus instant revoke, is the defence; it is not a guarantee |
| **Size creep** | A per-module budget in the manifest and a size report in every build. Scanner libraries load only with modules that need a camera |
| **Pressure to just copy v2 (Shape B)** | This document's Part 2. Any shortcut is a private build that is never published |

### Never ported, in any form

- **Credentials and secret files:** processor keys, merchant ids, API tokens, device keys, setup codes,
  card-vault and payment-link files, and env file contents. Env variable *names* may appear; values never do.
- **Live-money scar tissue specific to one shop:**
  - the duplicate-charge alarm tuned to one merchant;
  - the funding reconcile against one merchant's deposits;
  - the card-link and pay-link flows;
  - the monthly billing day and statement run;
  - month-end;
  - one processor's retry and expiry quirks.

  The **lesson** travels, as a generic law and a test named after the failure, for example "two sends with one
  key are one charge". The code does not.
- **The shop's rules as code:**
  - closed weekdays per store;
  - holidays;
  - the courier rush table;
  - "the plant is store 1";
  - route-weekday snapping;
  - the receipt verses;
  - the town names;
  - the archive rule.

  Where a rule is generally useful, it returns as pack config with a neutral default (Stage 7).
- **Migration-only code:** the copies of v1's punch and till history, the v1-to-v2 shadow feed, the port pipeline
  (tied to v1's file and one PC's paths), and the archive of retired attack scripts. Their lessons are already in
  the engine proofs.
- **Infrastructure:** fallback server URLs, server paths, local user paths, and anything naming the shop's server
  or domain.
- **The 6,328-line station page and v1's styles.** Screens are rebuilt on Custom POS's renderer and design tokens.
- **Activity wording or comments that name a person**, even in a test title.

### How the gates travel with the modules

- **A module's proofs live in its folder** and ship with it. `run-tests.js` finds them, so enabling a module in
  this repo automatically brings its gates into the standard run.
- **Each proof names the failure it prevents** and carries a negative control: the shape that
  [OZARK-REFERENCE.md](OZARK-REFERENCE.md) calls the most transferable thing in the origin app. Incident comments
  keep the *what happened* and drop the *who*.
- **The exporter runs v2's matching proofs against its own output** before anything is imported. The rebuilt
  module then has to pass the renamed proofs in Custom POS. A module counts as moved only when both have passed.
- **History fixtures** make backward compatibility a test, not a promise.
- **The builder emits the gates with the download** (Stage 8). A shop that customizes its file with Claude Code can
  re-run the proofs for exactly the modules it has.
- **The public refusal suite** runs on every test run, so a phone number or server address landing in any module
  fails before a commit, not after a publish.

---

## Appendix — The numbers (read-only survey, 2026-10-10)

- **v2 overall:** a small generic event-sourced engine (about 2,360 lines, 207 KB) around about 1.57 MB of v1
  code copied verbatim. 69 of 87 core kit files are ports of v1 functions, plus about 475 KB of adapter that
  rebuilds a v1-shaped database from the folds.
- **Engine:**
  - files: event, hlc, registry, incfold, log, station (66 KB), sync and http, the IndexedDB store, the hub
    (59 KB), the SQLite store;
  - generic patterns with shop content: authority and the hub-checked PIN;
  - nearly free of the brand word: 2 mentions in the HTTP transport and 2 in the browser store, all identifiers.
- **Aggregates:**
  - 22 files, 3,028 lines, 124 fact types, all validated, all with incremental folds, none declaring effects;
  - each requires only the registry, the clock and the incremental-fold helper (staff also requires its rules);
  - each fold reads only its own prefixes.
- **Coupling hubs** (how many modules depend on each): admin 17, route 15, texts 12, print 10, reports 8.
- **Vendor reach:** one card processor in 17 files, one text provider in 14, one accounting package in 8.
- **Station page:** 920 KB in one function, about 18 tabs, 229 action handlers. The full payload is about 3.8 MB
  plus 0.7 MB of barcode scanners. For comparison, Custom POS's `pos.html` is about 240 KB.
- **Tests:**
  - one 3.5 MB Node suite of 582 sections;
  - the first 22 sections are the engine-law proofs, written against the time clock;
  - section 22 drives the shop's full hub server, which is why Stage 1 writes a minimal one.
- **Custom POS today:**
  - a config-driven single-file engine;
  - a builder with 24 templates;
  - an open hub that syncs only records and customers (punches and bookings stay on each device);
  - 103 browser suites.
- **Personal-data exposure in v2's source** (counts only, a lower bound):
  - real full names whose surnames are ordinary words: about 22 mentions in 9 files;
  - the business's phone numbers: about 22 mentions in 7 files;
  - the owner's first name: 7 files;
  - the server's address: 12 files;
  - local user paths: 107 files.

  The engine allowlist in Part 6 avoids nearly all of these by design.
