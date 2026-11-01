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

*Designed 2026-10-31, not built yet.* Part 3's contract covers the hub: what facts a module has, who may write each one, and its
rules. The app had no such contract. Stage 2 wired the time clock into pos.html by hand, about 190 lines plus 14 `if(FACTS.on)`
branches, and most of the 44 findings in its last two reviews were in that hand-wired code. The owner's words: *"seems like you are hand
building every module instead of planning a modular system."* This part is that plan.

A panel wrote three competing designs:
- **module file first:** each module is one file that declares everything;
- **fit the existing app first:** least change to pos.html;
- **design out each kind of review finding first.**

A judge scored the three against the code and checked their load-bearing claims, then merged them:
- **the fit-the-existing-app design won;**
- **from the module-file design:** the facts-mode screens live in the bundle, along with `strip`, `money:` and the module list;
- **from the findings design:** `writes`; open shifts from before the hub are closed at the switch; views are rebuilt in memory and
  never saved; one rule for ids; a double tap runs once; and the controls runner.

Nothing of Stage 2 is published until the time clock runs on this design. Finding numbers (0.1 to 2.6) refer to the skeptic
pass's list in [the JOURNAL](../JOURNAL.md) (2026-10-31, night, "A skeptic pass, and a pause").

### 1. Thesis

pos.html already reads data the right way. `render()` starts with `DB = loadDB()`, and every screen reads `DB.<collection>` without waiting. What Stage 2 hand-built is everything around the time clock's facts: connect, status, people and PINs, the pull loop, projection, redraw and refusals. That is about 190 lines plus 14 `FACTS.on` branches.

So reads stay as they are, and only writes change. A module is defined once, in `facts/modules/<name>.js`. That file keeps the hub part it has today and gains an `app` part, made of declarations and small pure functions:
- the `DB` collections it rebuilds;
- the stations it serves;
- named commands that turn a tap into facts.

pos.html gets one seam, chosen once at boot (`STORE`), and one write path, `act(name, args, who)`. In blob mode, `act` runs the old body, kept in pos.html under the same command name. In facts mode, one generic runtime in the bundle does the work for every module. The next module is a module file plus one `MODULES` line, with no new plumbing.

### 2. The module definition

The time clock keeps its hub half byte for byte and adds the following.

```js
const IDS = require('./ids');
const SHIFT_ID = IDS.FACT_ID;   /* one grammar for device names: Connect, the hub's enrolment and this admit (findings 0.2, 1.4); admit may widen (law 1) */
const isClock = function (e) { return /^clock\./.test(e.type); }, isBreak = function (e) { return /^break\./.test(e.type); };
/* @facts @fold @timeclock — what a plan reads: a person's open shift and whether it is on a break, over the facts the runtime hands in
   (what the hub witnessed, plus this tablet's own not yet sent, never one the hub refused) */
function clockView(facts, people) {
  const sh = TC.fold(facts.filter(isClock)), br = foldBreaks(facts.filter(isBreak));
  return { open: function (emp) { const id = TC.openShiftId(sh, emp); return id ? { id: id, onBreak: (br.byShift[id] || []).some(function (b) { return b.end == null; }) } : null; },
           punches: function () { return punches(facts, people); } };
}
/* @facts @timeclock — one punch fact, its shift named when it has one */
function punchFact(type, a, c, sid) { return { type: type, key: a.staffId, payload: sid ? { empId: a.staffId, shiftId: sid, at: c.now } : { empId: a.staffId, at: c.now } }; }
/* @facts @timeclock — clock in: someone already on is a refusal, never a silent no-op */
function planIn(a, c) { return c.view.open(a.staffId) ? { refuse: c.name(a.staffId) + ' is already on the clock' }
  : { facts: [punchFact('clock.in', a, c)], log: ['clock', c.name(a.staffId) + ' clocked in'] }; }
/* @facts @timeclock — clock out: an open break ends first, in the same send */
function planOut(a, c) { const s = c.view.open(a.staffId); if (!s) return { refuse: c.name(a.staffId) + ' is not on the clock' };
  return { facts: (s.onBreak ? [punchFact('break.end', a, c, s.id)] : []).concat([punchFact('clock.out', a, c, s.id)]), log: ['clock', c.name(a.staffId) + ' clocked out'] }; }
/* @facts @timeclock — a break starts or ends inside the open shift */
function planBreak(starting) { return function (a, c) { const s = c.view.open(a.staffId);
  if (!s || s.onBreak === starting) return { refuse: c.name(a.staffId) + (!s ? ' is not on the clock' : starting ? ' is already on a break' : ' is not on a break') };
  return { facts: [punchFact(starting ? 'break.start' : 'break.end', a, c, s.id)] }; }; }
/* @timeclock @storage — a punch from before the hub, sealed once at the switch: an open one and its open break close at that moment (finding 1.1) */
function sealPunch(p, at) { if (p.out != null) return p; const cl = function (b) { return b.end != null ? b : Object.assign({}, b, { end: hm(at), endTs: at }); };
  return Object.assign({}, p, { out: hm(at), outTs: at, sealed: true, breaks: (p.breaks || []).map(cl) }); }
/* @proof @timeclock — a law the kit proves over every fixture and generated history: a break lies inside its shift (finding 2.2) */
function breakInside(rows) { return rows.every(function (p) { return (p.breaks || []).every(function (b) { return b.startTs >= p.inTs && (p.outTs == null || (b.endTs != null && b.endTs <= p.outTs)); }); }); }

/* in defineModule({...}) beside facts/views/needsConfig: */
app: {
  stations: ['timeclock'], noun: ['punch', 'punches'],
  view: clockView,
  collections: { punches: { rows: function (v) { return v.punches(); }, legacy: 'seal', seal: sealPunch } },
  commands: {
    'clock.in':    { writes: ['clock.in'],               actor: 'self',         plan: planIn },
    'clock.out':   { writes: ['break.end', 'clock.out'], actor: 'self',         plan: planOut },
    'break.start': { writes: ['break.start'],            actor: 'self',         plan: planBreak(true) },
    'break.end':   { writes: ['break.end'],              actor: 'self',         plan: planBreak(false) },
    'clock.fix':   { writes: ['clock.edit'],             actor: 'pass:payroll', plan: planFix }   /* waits for the hub: clock.edit is pin:true */
  },
  laws: { 'a break lies inside its shift': breakInside },
  parity: function (p) { return [p.staffId, p.inTs, p.outTs, (p.breaks || []).map(function (b) { return [b.startTs, b.endTs]; })]; },
  fixtures: ['fixtures/timeclock-v1.json'], budgetKB: 6
}
```

The staff module's app part:
- `stations: ['worker']`. PIN screens need the hub's hashes, so the gate stands in front of them.
- `people(facts)`, the fold the people service reads. Only the module that provides staff may set it.
- `fromSetup`, which is today's `setOf`.
- Commands:
  - `'staff.first'` with `actor: 'first'`;
  - `'staff.add'` with `actor: 'pass:employees'`.

  Both write `staff.set`. PINs are hashed while the details are gathered, so a command carries `{salt, hash, iter}` and never the digits.

**What is declared (data):**
- name, version, requires, authority, `pin`, and the new `money: true` on a fact type;
- `stations`, `noun`, and each collection's `legacy` policy (`seal`, `import` or `none`);
- for each command, `writes` and `actor`.

`actor` takes one of these forms:

| Form | Meaning |
|---|---|
| `self` | The person matched by PIN on this screen, matched less than 60 s ago. |
| `right:<r>` | Asked now; a local PIN match of someone holding `r`. |
| `pass:<r>` | Asked now, plus a pass from the hub's PIN check. |
| `first` | Allowed only while the hub has no staff yet. |
| `device` | No person. |

Whether a command waits for the hub (`confirm`) is worked out, not written. A command that writes any `pin: true` type waits for the hub's answer before it says done. Every other command confirms on the tablet; a command may also set `confirm: 'hub'` itself, as `gift.redeem` does.

**What is code (pure, no DOM, runs in Node):** validate, admit, rule, fold, `view`, `plan`, `rows`, `seal`, the `laws` and `parity`. A plan returns `{ facts, log }` or `{ refuse }`. Returning nothing is a module bug, and the kit catches it.

**What define.js checks** (repo-owned, about 60 lines): the app part's shape, that `seal` is present for `legacy: 'seal'`, and that the actor forms are valid. `assemble` then checks the whole build:
- every `writes` type is owned by this module or one it requires;
- a `pin` type is asked with `pass:` (or `first`);
- a `money` type never has authority `any` and is never written by a `device` command;
- no command or collection has two homes.

```js
/* @facts @module @permission — the app parts against the judge: a command writes only what this hub judges, a PIN-checked type is asked with a hub pass, money names a person, one home per command */
mods.forEach(function (m) { if (!m.app) return; Object.keys(m.app.commands).forEach(function (n) { const c = m.app.commands[n];
  if (cmds[n]) throw new Error('command ' + n + ' is claimed by both ' + cmds[n] + ' and ' + m.name); cmds[n] = m.name;
  c.writes.forEach(function (t) { const r = rules[t];
    if (!r || (r.module !== m.name && m.requires.indexOf(r.module) < 0)) throw new Error(m.name + ' · ' + n + ' writes ' + t + ', which it neither owns nor requires');
    if (r.pin && !/^(pass:|first$)/.test(c.actor)) throw new Error(m.name + ' · ' + n + ': ' + t + ' needs a PIN the hub checked — actor pass:<right>');
    if (r.money && (r.kind === 'any' || c.actor === 'device')) throw new Error(m.name + ' · ' + n + ': ' + t + ' is money and must name a person'); }); }); });
```

**One module list.** A new file, `facts/modules/index.js`, lists the modules with plain `require`s. server.js uses it instead of the hard-coded list at line 188, and `/v2/health` adds `modules: [{name, version}]`. bundle.js works out `FILES` by following requires from its entry points, so a new module is one line in `index.js`.

**Shared id rules.** `facts/modules/ids.js` holds `STATION = [A-Za-z0-9][A-Za-z0-9 _.:-]{0,63}` and `FACT_ID`. Connect in gate.js, enrolment in server.js (which refuses names outside the grammar) and `admitBreak` all use it.

### 3. The browser runtime

**Where it lives:** two new repo-owned files, both in the bundle's `FILES` and exposed as `CustomPOSFacts.app`. The hub never loads either file.
- `facts/app/runtime.js`, about 280 lines, with no DOM.
- `facts/app/gate.js`, about 120 lines. It draws the facts-mode cards using `textContent` only and pos.html's CSS classes, and keeps today's DOM ids.

Rules for these files, enforced by bundle.js: none of the words `arguments` or `eval`, and no `Function(`, even in comments; no DOM or storage access when the file loads; plain relative `require`s only.

**Size.** About 36 KB raw and 10 KB gzipped at this repo's density, which brings the bundle to about 253 KB raw and 77 KB gzipped. Move the cap in bundle.test.js to 280/85 KB and print a size report per file. Blob downloads add 0 bytes.

**API**

```
rt = CustomPOSFacts.app.start(host, moduleNames)
     host: { flow, flowId, cfgKey, setupStaff, now, requestRender(why), report(words, kind), busy(label, promise), activity(type, words) }
rt.ready() / rt.status() → { state, text, owed: {punch: 2}, refused: [{ id, what, why }] }
rt.connect(hub, name, token)   one at a time: a second call gets the first call's promise
rt.disconnect({force}) / rt.retry()      retry: a lease tick only, never a save
rt.owns(col) / rt.overlay(db) / rt.strip(db) / rt.serves(stationType) / rt.handles(cmd)
rt.people() / rt.whoByPin(pin, ok) / rt.pass(who, pin)
rt.act(name, args, who) → { ok, why?, pending, settled: Promise }      returns at once
rt.gate(app, station) → true when a card was drawn                    (gate.js)
```

**What it owns**

| Concern | Behaviour |
|---|---|
| Connect | One at a time. Checks the name with `ids.STATION`. Sends an empty receive so the hub judges name and token. The token goes only to the station's own access store. Keeps today's `custompos_facts_<flow>` key and `custompos-facts-` IndexedDB prefix. |
| Status | One text. It never says "up to date" while anything is refused, read-only, revoked or on a wrong clock. Owed facts are counted by module noun ("1 punch waiting to send"). |
| Lease / read-only | `tick()` on every cycle, close on `pagehide`. A read-only tab has no write path. It shows its own log as it was when opened, labelled "read-only here: figures as of 14:02". |
| People / PIN | `whoByPin` checks one PIN at a time, tries the last match first, and always clears busy in a `finally`. It returns a person object the runtime remembers for 60 s; a bare id is never accepted as an actor. `pass` calls `/v2/pin`. Passes are kept in memory until they expire and ride only with the sends whose facts name that person. |
| Pull loop | One cycle in flight: tick, commit, `pullAsync`, then the redraw check. Every 5 s. |
| Views | Folded over the facts the hub witnessed plus this tablet's own unsent facts, minus refused ones. Memoized by (log length, refused count). |
| Projection | `rows(view)` plus the sealed legacy rows. Kept in memory only, never saved (finding 1.6). |
| Redraw | `host.requestRender` is called only when (log length, refused count, status text) moved. |
| Refusals | A transport wrapper reads every `eventAcks` entry. The first time a fact is refused, it is said once with the command's words; a later admission clears it. |
| Version | An "update this tablet" card when the hub lacks a module or version this tablet runs. |

**The command path:**

```js
/* @facts @storage @invariant — one command: refused, or its facts recorded together and the views redrawn; nothing waits between reading the view and recording */
function act(name, args, who) {
  const c = cmds[name];
  if (!c) return no('no module here has "' + name + '"');
  if (!ready()) return no(status().text);                                    /* not connected, read-only, revoked, wrong clock (1.6, 1.7) */
  const k = name + '|' + JSON.stringify(args); if (inflight.has(k)) return inflight.get(k);   /* a double tap is one command */
  const bad = actorProblem(c, args, who); if (bad) return no(bad);
  const out = c.plan(args, { view: viewOf(c.module), now: host.now(), name: nameOf, station: st.id });
  if (!out || (!out.refuse && !(Array.isArray(out.facts) && out.facts.length))) return no('the ' + name + ' command said nothing (a module bug)');
  if (out.refuse) return no(out.refuse);
  const why = precheck(out.facts, who); if (why) return no(why);             /* validate, admit, then the hub's own judge over the staff the hub witnessed (1.5) */
  const ids = out.facts.map(function (f, i) { return st.record(f.type, f.key, f.payload, { actor: who ? String(who.id) : null, defer: i < out.facts.length - 1 }).id; });
  label(ids, name, who); if (out.log) host.activity(out.log[0], out.log[1]); changed();
  const r = { ok: true, pending: c.confirm === 'hub', settled: c.confirm === 'hub' ? verdict(ids, 10000) : Promise.resolve({ ok: true }) };
  inflight.set(k, r); r.settled.then(function () { inflight.delete(k); }, function () { inflight.delete(k); }); return r;
}
/* @sync @facts — every send carries the passes its facts need, and every answer is read here first: a refusal is kept by fact id and said once, an admission clears it and settles whoever waits */
st.setTransport(function (b) { b.grants = passesFor(b.events);
  return remote.receive(b).then(function (res) { (res && Array.isArray(res.eventAcks) ? res.eventAcks : []).forEach(noteAck); return res; }); });
```

How the pieces behave:
- `no(why)` always calls `host.report`, so a screen that ignores the result still cannot hide a refusal.
- `precheck` is `assemble(mods, { noPins: true }).judge` with these inputs:
  - `master` is the facts the hub witnessed;
  - `staged` is the earlier facts in the same plan;
  - "that person is not on staff" is let through as waiting, because the hub may know them.
- `verdict` settles as admitted, as refused with the hub's reason, or after 10 s as "saved here, not confirmed yet", which is never shown as success.

### 4. The storage seam

The seam goes just before `let DB = loadDB()` (pos.html:485).

```js
/* @storage — this device's hub settings key: the address and the name only, never the token */
function factsKey(){ return "custompos_facts_"+flowId(); }
/* @storage @startup — THE SEAM, chosen once, before the shop is first read: this file alone, or the bundle's runtime for its modules' collections; everything else stays here, SYNC included */
const HOST = { flow:FLOW, flowId:flowId(), cfgKey:factsKey(), setupStaff:FLOW.staff||[], now:()=>Date.now(), requestRender, report, busy, activity:logActivity };
const RT = FLOW.storage!=="facts" ? null : (globalThis.CustomPOSFacts && CustomPOSFacts.app) ? CustomPOSFacts.app.start(HOST, factsModules()) : missingEngine();
const STORE = { mode:RT?"facts":"blob", owns:c=>!!(RT&&RT.owns(c)), overlay:d=>RT?RT.overlay(d):d, strip:d=>RT?RT.strip(d):d, gate:(a,s)=>RT?RT.gate(a,s):false,
  people:()=>RT?RT.people():(FLOW.staff||[]),
  whoByPin:(pin,ok)=>RT?RT.whoByPin(pin,ok):Promise.resolve((FLOW.staff||[]).find(s=>(!ok||ok(s)) && String(s.pin)===String(pin))||null) };
/* @storage @permission — every write a screen makes: one command by name, in this shop's mode; a refusal is said, never drawn as success */
function act(name, args, who){
  if(RT && RT.handles(name)) return RT.act(name, args, who);
  const fn=BLOB[name]; if(!fn){ report("This POS has no "+name); return { ok:false }; }
  DB=loadDB(); const r=fn(DB, args, who)||{};
  if(r.refuse){ report(r.refuse); return { ok:false, why:r.refuse }; }
  saveDB(DB); if(r.log) logActivity(r.log[0], r.log[1]); return { ok:true, settled:Promise.resolve({ ok:true }) }; }
/* @render @input — the one way anything but a tap redraws (a pull, SYNC, a timer, another tab): never over typing; a held redraw runs at the next tick that finds nobody typing */
function requestRender(why){ if(typing()){ requestRender.held=true; return; } requestRender.held=false; render(); }
/* @input — is someone typing in a box on this screen right now */
function typing(){ const a=document.activeElement, app=document.getElementById("app"); return !!(a && /^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName) && app && app.contains(a)); }
```

Supporting pieces:
- `BLOB` is built from the `MODULES` registry. For example, `clock: { label:"Time clock", stationTypes:["timeclock"], facts:"timeclock", blob:CLOCK_BLOB }`.
- `factsModules()` names the enabled entries that have `facts:`.
- `missingEngine()` draws "this download is missing its engine" on those stations. Today such a page silently falls back to blob mode and the data splits.
- A held redraw is deliberately **not** released on `focusout`, because a redraw between the blur and the click would swallow the tap.

**Reads.** `loadDB()` ends with `return STORE.overlay(dbDefaults(d))`, so every reader, backups included, sees the projections. Until the runtime is ready, an owned collection holds only its legacy rows, and the gate shows "Connecting to the hub…".

**Writes.** Every write goes through `act(cmd, {ids…})`, with ids and never record objects. `persistDB` starts with `db=STORE.strip(db)`: owned collections are written as their legacy rows only, never as a projection. Both `overlay` and `strip` do nothing in blob mode, so blob writes stay byte-identical. Approvals become "gather, then change":

```js
const who = await person({ action:"refund", label, ok:s=>s.role==="owner"||s.role==="manager" });   /* busy() clears in finally (1.8) */
if(who) withApprovalOn(r.id, who, rec=>refundRecord(rec));                                          /* the record read fresh by its id (1.0) */
```

**SYNC.** `applyRemote` compares the `fingerprint` of records, customers and seq before and after the merge, and calls `requestRender("sync")` only when something changed (finding 1.3). `push` and the merge skip any collection where `STORE.owns()` is true. Today that is none; in Stage 4 it is `customers`. The `storage` listener and the 30 s clock timer call `requestRender` instead of `render`.

**The 14 `FACTS.on` branches**

| Today | After |
|---|---|
| 800, 803 `withApproval` | `person()`; "connect first" is a runtime refusal |
| 1415 `clockEnter` | `STORE.whoByPin(pinBuf)` inside `busy()` |
| 1419-1422, the four punches | `act("clock.in" …)` etc.; the old bodies move to `CLOCK_BLOB` |
| 1424 staff list | `STORE.people()` |
| 1425, 1848 gates; 1487 status line; 1496 team card | one `if(STORE.gate(app, station)) return;` in `render()`, drawn only for stations a module serves |
| 1862 (two uses) worker PIN | `STORE.whoByPin` |
| 2594 `factsBoot()` | building `STORE` |

A static check, `tests/seam-guard.js`, keeps three things out of the screens:
- any `FACTS.` reference;
- `render()` inside timers or `fetch` callbacks;
- direct writes to an owned collection outside `BLOB` bodies.

### 5. Porting the time clock

```js
/* @timeclock — clock in from the PIN pad, in either mode: the Welcome only for a punch that was recorded; a refusal is said by act() */
function clockIn(staff){ const r=act("clock.in", { staffId:staff.id }, staff); if(r.ok){ clockWelcome={ name:staff.name, inbound:true, staffId:staff.id }; clockAction=null; pinBuf=""; } render(); }
```

`CLOCK_BLOB` holds the four old bodies, keyed by command name, each running on a DB read fresh for it. The blob `clock.in` adds the "already on the clock" refusal. Through the PIN pad nothing changes, because `clockEnter` already sends someone who is on the clock to the action screen. The four functions stay as globals that return at once, because tests/facts-clock.js:156 calls them.

| | Before | After |
|---|---|---|
| Facts glue in pos.html | 1222-1409, 188 lines | 0 (moved to runtime.js and gate.js) |
| `FACTS.on` branches | 14 | 0 |
| Added to pos.html | none | seam, `act`, `person`, `requestRender`/`typing`/`report`/`busy`, `esc` (renamed from `factsEsc`): about 45 lines; `CLOCK_BLOB` about 10 |
| Edited | none | about 30 lines: the clock functions, `clockEnter`, the head of `renderTimeclock`, the worker gate and PIN, `withApproval` and its 2 call sites, `applyRemote`, the listener, the timer, `loadDB`/`persistDB`, the `render()` gate line, the Office `esc` sites |

The net is about −135 lines (2,601 to about 2,465), with roughly 10% of the file touched and no screen rewritten.

**What stays:** `renderTimeclock`'s screens, `openPunch`, `workedMs`, `breakDue`, the tip pool, labor cost and reports. All of them read `DB.punches` as before. `factsKey()` and every DOM id the suite selects also stay, so tests/facts-clock.js and builder-facts.js should pass unedited.

**How existing data moves.** On the first boot as the writer:
- the legacy rows are `db.punchesBeforeFacts` if present (Stage 2 test devices only; Stage 2 was never published), otherwise `db.punches`;
- each open row is sealed at that moment, and a notice names it;
- `factsSince` marks that it was done, so running it twice changes nothing;
- the IndexedDB log and the token are untouched, so no tablet has to reconnect.

### 6. Fitting the next modules

**Stage 3 - `rowModule()`.** Booking, schedule, floor, KDS and route mostly save rows whole. One helper gives each of them `<p>.put` and `<p>.void` facts:
- the latest put wins;
- the engine already stamps `basedOn` on each fact, so a write based on an older copy shows as a conflict;
- `legacy: 'import'` brings in each device's rows once, de-duplicated by blob id;
- it is never used for money.

Each Stage 3 module is about 30 lines plus its `BLOB` table, with no screen changes.

**Customers (Stage 4).**
- Collection `customers`, keyed by phone, with `legacy: 'import', once: 'shop'`. These rows already ride SYNC, so one device imports them under an owner pass, and SYNC then stops carrying them.
- Commands: `customer.save`; `gift.redeem` (`money`, `confirm: 'hub'`, so an offline device cannot spend the same card twice); `account.charge` (`pass:checkout`).
- Balances are folds over facts, never fields that get set.

**Orders (Stage 5).**
- Collection `records`, projected field for field, with the shop-once import.
- Fact types:
  - `order.open`;
  - `order.line`;
  - `order.stage`, whose `admit` comes from the flow's `stateMachine` (law 3);
  - `order.pay` (`money`, `right:checkout`);
  - `order.refund` (`pass:refunds`, never more than was paid);
  - `order.close`.
- The 73 `saveDB(` sites can move to `act()` before Stage 5. Commands no module claims run their `BLOB` body in both modes, so the orders module later takes them over without touching the call sites.

**Auction lots.** The generic part is public; each company's premium and terms live in its private flow and its own prefixed module.

```js
defineModule({ name: 'auction', version: 1, layer: 'pack:auction', requires: ['staff', 'customers'],
  aggregate: { name: 'auction', fold: foldSale, inc: incSale },                 /* bids ranked by hub position, never by a tablet's clock */
  facts: { 'lot.set':    { authority: 'needs:catalog',    validate: vLot },
           'bid.floor':  { authority: 'needs:clerk',      validate: vBid, rule: aboveHigh, reads: 'own' },
           'bid.online': { authority: 'hub-only',         validate: vBid, rule: aboveHigh, reads: 'own' },
           'lot.hammer': { authority: 'needs:auctioneer', pin: true, money: true, validate: vHammer, rule: lotOpen, reads: 'own' },
           'settle.pay': { authority: 'needs:cashier',    pin: true, money: true, validate: vPay, rule: notOverpaid, reads: 'own' } },
  hubServices: [{ door: 'POST /v2/svc/auction/bid', writes: ['bid.online'] }],
  app: { stations: ['auction-block', 'auction-settle'], collections: { lots: { rows: lotsRows, legacy: 'none' } }, screens: 'auction.screens.js',
         commands: { 'bid.take':  { writes: ['bid.floor'],  actor: 'right:clerk',      confirm: 'hub', plan: planBid },
                     'lot.sell':  { writes: ['lot.hammer'], actor: 'pass:auctioneer',  plan: planHammer } } } });
```

Invoices and statements call `packs/auction/feemath.js`. A facts-only module adds 0 lines to pos.html: `render()`'s dispatch gains one generic "a module screen for this station type" line.

**Gaps the shape does not yet cover:**
- **G1. Rules that read the module's own state** (above the high bid, a refund within what was paid, a lot still open). Pass the hub's `readers` into `rule(p, who, staff, e, own)`, with this send's staged facts folded on top. Allow `reads:'own'` only with `aggregate.inc`, so the hub steps one shared follower instead of keeping a copy.
- **G2. People who are not staff** (online bidders). server.js runs declared `hubServices` doors, checks a bidder token there, and writes `hub-only` facts.
- **G3. Numbers people read** (order numbers, paddles, lot numbers). A `sequences` declaration: the hub assigns the number when it admits the fact, and the screen shows "#pending" until then.
- **G4. Per-shop bundles.** Every download carries every module; feemath alone is 61.8 KB. The builder should pack only the modules a shop uses (Stage 8, pulled forward for the auction).
- **G5. Personal details kept forever.** Decide before Stage 4 (see the decisions below).
- **G6. Outside effects.** `refundRecord` charges the card before it saves. Effects move to after the hub's verdict (Stage 6, law 5).
- **G7. Big collections.** Records need incremental `rows` from `aggregate.inc`, not refolds.

### 7. Conformance kit

Every module in `modules/index.js` gets these checks for free. Each check ships a deliberately broken copy that it must fail on; `tools/controls.js` applies `{file, find, replace}` and requires the check to go red.

**Node checks** (`facts/test/module-kit.test.js`):
- **N1 Manifest closure:** the define and assemble checks above.
- **N2 Ids:** station names across the whole grammar (spaces, dots, colons, 64 characters); every planned fact passes validate and admit.
- **N3 Plans:** run on a deep-frozen view; deterministic; facts or a refusal, never a throw or nothing.
- **N4 Judge parity:** for every role and right, the browser precheck and the hub judge agree (PINs aside).
- **N5 Folds:** the same view in any arrival order; duplicates change nothing; fixtures fold to their saved views; the declared `laws` hold.
- **N6 Pass cost:** for every pin type, 200 facts carrying 5,000 junk passes cost at most 800 HMACs, counted rather than timed.

**Browser checks** (`tests/module-kit.js`, run on a real hub at 127.0.0.1, both modes):
- **B1 Parity:** the module's script run in blob mode and in facts mode under a fixed clock gives equal `parity()` results; the `BLOB` names equal the command names.
- **B2 Hostile strings:** on every station, the Office included, `window.__pwned` stays undefined and there are 0 console errors.
- **B3 Typing:** typing key by key survives 7 s of pulls, SYNC polls and timers.
- **B4 Refusals:** a precheck refusal and a late hub refusal are both shown on whatever screen is open; the refused fact leaves every view; no success text appears.
- **B5 Two tabs:** the read-only tab changes nothing in localStorage or in the writer tab's view.
- **B6 Connect races:** a double Connect, Connect during boot, and Disconnect during a pull all end with one station and one timer.
- **B7 Stale gather:** an `applyRemote` injected during every `person()` step; the change still lands on the fresh record.
- **B8 Busy:** no busy message survives a PIN check.
- **B9 Switch:** an open legacy row, then the switch to facts mode; that person can still act; switching twice is the same as once.
- **B10 Write guard:** owned collections are handed to screens as Proxies whose traps throw. pos.html is not in strict mode, so freezing alone fails silently.

**The findings**

| Finding | Result |
|---|---|
| 0.2, 1.4 name vs `SHIFT_ID`; silent refusal | Impossible: `ids.js`, and `report()` shows on every screen. N2, B4 |
| 1.0 stale record after an approval | Impossible for `act` writes: gather first, then re-read by id. B7 |
| 1.1 open pre-hub punch stuck | Impossible: sealed at the switch; a plan never returns nothing. N3, B9 |
| 1.2 Office XSS | Caught: one `esc`; the Office sites are fixed in step 1. B2 |
| 1.3 redraw over typing | Impossible: `requestRender`. B3 |
| 1.5 refused team add claims success | Impossible: precheck with the hub's judge; `staff.add` waits for the hub; refused facts leave views. N4, B4 |
| 1.6 read-only tab saves frozen data | Impossible: projections are never saved; a read-only tab has no write path. B5 |
| 1.7 double Connect | Impossible: one connect at a time, plus in-flight dedup. B6 |
| 1.8 "Checking…" stuck | Impossible: `busy()` clears in `finally`. B8 |
| 2.1 pass bound untested | Caught by N6 for every pin type |
| 2.2 break cap untested | Caught by N5 where the module states the law (the time clock does) |
| 2.4 redraw and status untested | Caught by B3 and B4 for every module |
| 2.5 "every fix has a failing test" | Turned into a printed check by the controls runner |
| 0.4, 2.0, 2.3, 2.6 (and 0.1, 0.5, 0.6) | Left to the staff module, the builder, the docs and the hub fix |

### 8. Rollout

Each step ships on its own, and every suite stays green at each step.

1. **pos.html host seam, blob behaviour only.**
   - `requestRender` and `typing`; SYNC redraws only on a change.
   - `person()` and `busy()`; approvals change the record by id.
   - `esc`, and the Office escapes staff names.

   This fixes 1.0, 1.2, 1.3 and 1.8 in both modes. Add B2, B3, B7 and B8 for blob mode.
2. **The contract.**
   - `ids.js`, used by Connect, enrolment and `admitBreak`.
   - define.js `app`, `money` and `writes` checks; `modules/index.js` read by server.js and bundle.js; the module list in health.
   - App parts for staff and the time clock.
   - Node kit N1-N6.

   pos.html does not change.
3. **`act()` and `CLOCK_BLOB` in pos.html, still blob only.** The clock globals become thin wrappers, with identical behaviour.
4. **The runtime.**
   - runtime.js and gate.js go into the bundle, with the new cap, and `facts.bundle.js` is rebuilt.
   - Facts mode switches to `STORE`; the FACTS block is deleted; legacy punches are sealed.
   - Acceptance: facts-clock.js and builder-facts.js pass unedited.
5. **The browser kit and the controls runner.**
6. **Acceptance of the design:** the first Stage 3 module, built with `rowModule`. A facts-only module touches 0 lines of pos.html; a dual-mode one touches about 12, its `BLOB` table.

**What not to do:**
- Never save projections.
- Never let SYNC and a module own the same collection.
- Never put DOM code in a file the hub loads.
- Never move a dual-mode module's screens into the bundle while blob mode lives.
- Never narrow a released validator.
- Never edit the imported `facts/` files listed in PROVENANCE.json.
- Never change the cfg key or the IndexedDB prefix.
- Do not rewrite the 162 `innerHTML` sites.

### 9. Risks, and what to cut

**Risks:**
- **Two bodies per command (blob and facts).** B1 parity is the guard, and it is only as good as each module's script. Blob bodies retire when a module becomes facts-only.
- **The precheck can run behind the hub.** It may admit something the hub refuses. The hub stays final and the refusal is shown.
- **Refused facts are sent again on every commit,** by the engine's own design. The precheck keeps this rare; setting them aside needs an engine change at the origin.
- **Size.** About 253 KB now, and growing with every module until per-shop bundles exist.
- **Gating only served stations** means approvals on other stations depend on `person()` refusing politely when not connected.
- **Projection cost at Stage 5.** Records need G7 before orders move.

**Cut first:**
1. Module screens for facts-only modules, until the auction needs them.
2. The controls runner beyond a declared list of broken copies.
3. Generated histories in N5; keep the fixtures plus hand-written hostile histories.
4. The version card; health plus a status line is enough at first.

**Never cut:** one write path, one redraw path, refusals shown on every screen, projections never saved, connecting one at a time, and B1-B6.

### 10. Decisions for the owner (open)

1. **Moving to several computers while people are on the clock.** We can close every open shift at the moment of the switch and list the closed shifts on screen, so people clock in again and lose at most a minute. Or we can carry the open shifts onto the hub, which only works once everyone is on the hub, and more can go wrong. *Recommendation: close them at the switch and show the list.*
2. **Which actions wait for the hub before they say "done".** *Recommendation:* only staff changes, PIN-checked hour corrections, refunds, and gift-card or charge-account spending. Punches and sales say "saved" at once and send later, so a dead internet never keeps anyone off the clock or the register.
3. **Going back to one computer.** *Recommendation:* the shared hours stay on the hub. A single computer gets them only by a deliberate "take a copy" step, never automatically, so a stale copy can never overwrite real hours.
4. **Customer and bidder contact details.** Facts are kept forever. *Recommendation:* before customers move (Stage 4), keep names, phones and emails in a changeable list on the hub that can be erased on request, and put only an id in the facts.
5. **Download size.** *Recommendation:* raise the size limit now to about 280 KB so the shared engine fits. Before the auction module ships (its fee math alone is 62 KB), make the builder pack only the modules each shop uses.

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
*Status, 2026-10-31: the hub half is built. The app half is held until it runs on [Part 3b](#part-3b--the-app-side-module-system)'s
runtime; Part 3b's rollout replaces the hand-wired facts mode in `pos.html`.*

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
