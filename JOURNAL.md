# The customPOS Journal

*The story of how customPOS was made — kept as an honest, running log. Newest entries at the bottom of each
day. This is a living document; we add to it as the project grows.*

> **Why keep this?** customPOS is built in the open on a simple belief: **software should be free, knowledge
> should be free, and people should own their tools instead of renting them.** Part of giving the knowledge away
> is showing the *work* — the decisions, the dead ends, the reasons. If you're using customPOS, this is the
> story of why it is the way it is. If you're building something of your own, maybe it helps.

---

## Day 1 — 2026-07-06 · From one shop's POS to everyone's

### The origin
customPOS didn't start as a product. It started as a real point-of-sale system built for a small two-location
wet cleaner (**Ozark Cleaners**) to replace the expensive, rented software the industry pushes on small
businesses. That system was deliberately strange in one important way: instead of a big web of servers and
subscriptions, it was **one single HTML file** — vanilla JavaScript, no build step, no dependencies — that
stored its own data in the browser and synced through one small optional server. Open it in a browser and it
just works. You own the file.

Running a whole business on that for real taught us something: the weird architecture wasn't a compromise. It
was the point. It made the software **ownable**.

### The idea
> *"We're forking off of this to start customPOS.com. Break the system apart so it's modular and general, so we
> can help other businesses own their own software. They go to customPOS.com, build their POS, download it — and
> we recommend they get Claude Code for ongoing local customization."*

The mental model that made it click: **Webflow or Squarespace, but you download and own the actual working
code.** Configure it in a wizard, download a file that's truly yours, and keep customizing it forever — with an
AI assistant as your on-call developer.

### The business model (decided day one)
No SaaS. No subscription. No license server. The software is **free, forever.** Money comes from one place only:
an **optional card-payment integration** — once certified, we give the payment feature away and earn a small
share of the card processing that already costs the business money no matter whose POS they use. We only make
money when the business makes money. It's a deliberate ethical stance on how AI and software should serve
people: by helping them own their tools, not by holding their data hostage.

### First architectural read
We audited the origin app and found the good news hiding in plain sight: nearly all the business-specific stuff
(the price list, the locations, the terminology) was already concentrated in **one function** that seeds the
starter data. The rest of the app just *reads* from it. So "generalize the POS" was never going to be a rewrite
— it's mostly *lifting the business data out into a config* and letting a wizard generate it. We sketched a
three-layer split: a universal **engine**, optional **modules**, and pure per-business **config**.

### We checked whether we should just fork someone else's POS
Before building, we did a deep, fact-checked survey of the open-source POS landscape (dozens of agents, primary
sources, adversarial verification) to see if we could "start a few rungs up the ladder" by forking an existing
free POS. The verdict was clear and a little surprising: **there was nothing better to fork.** Almost every
mature open-source POS is a heavyweight server application, and the good ones are either copyleft-licensed (which
would block the "own your code" promise) or carry attribution clauses that conflict with true ownership. **No
existing project was permissively licensed AND single-file AND zero-build AND local-first — all at once. Ours
already was.** Even the closest cousin (an abandoned browser POS) still needed a build toolchain.

The most useful finding came from Webflow, the closest thing to "configure it, then download code you own":
Webflow deliberately exports only static markup — the *working, data-driven part* doesn't come with you. That's
the hard, unsolved problem. And it's the exact thing our architecture already solves, because the data lives
*inside* the downloadable file. That's the moat.

**Decision: don't fork. Generalize our own.**

### The repo
Created the public home — **github.com/TiredofSleep/custom-pos** — under the **MIT license** (maximally free;
you download it, it's yours). Seeded it with the pitch and an orientation file, plus a hard rule written into
the project's guide: this is a public repo, so **real business data, private info, and infrastructure details
never go in it** — the engine ships with a neutral demo config only. (The origin app stays private; we're
building a clean, general thing, not exposing one business's operation.)

### The pivot that mattered
The obvious next move was "copy the origin app over and start deleting the cleaner-specific parts." We didn't.
The owner reframed it:

> *"I don't want to just copy Ozark over. I want to focus on the meta — how to design a customPOS for someone.
> Let's answer all the questions people ask — where's my data, is it backed up, is it safe, what's it cost, how
> long to set up, can I get my data out, who supports me — questions we've mostly already answered just by
> building the first one. Then design a series of questions to get the shape of the system, so we figure out
> what's engine and what's module."*

That's a sharper idea than porting code. The real value of the origin app isn't the code — it's that building
it **answered the hard questions every business owner has before they'll trust software.** If we turn those
answers into a guided interview, the engine/module boundary falls out on its own.

### The design principle we landed on
**The engine/module split is discovered by the questionnaire, not decreed.** The test for any feature is simple:
*can a business skip this and still ring up and record a sale?* If yes, it's an optional module. If no business
can skip it, it's core engine. So designing the interview and designing the architecture became the *same
activity*. That produced a three-ring model — a small unskippable **core**, a set of **common modules** most
shops toggle on, and **vertical modules** (the cleaner's garment-tracking and bag-splitting machinery) that only
turn on for the businesses that need them — plus pure **config** data on top.

We also wrote down the **trust questions** every owner asks and how the architecture already answers each one
(local-first data you can export, offline-tolerant, backed up in tiers, no lock-in, keeps working even if *we*
disappear). Those answers are both the sales pitch and the checklist the product has to keep satisfying.

### Testing the design before trusting it
Instead of declaring the interview "done," we put it on trial. We sent **12 very different small businesses**
— a street-food cart, a full-service restaurant, a coffee shop, a clothing boutique, a dry cleaner, a hair
salon, an auto-repair shop, a bakery with custom cakes, a farmers-market craft booth, a bookstore, a
phone/computer repair shop, and a pet groomer — *through* the interview as role-played owners, each answering
honestly and then critiquing hard: where did it fail them, what did their trade need that no question asked,
what wording assumed a different kind of business? The point was to find the gaps *before* writing anything in
stone.

### What 12 businesses taught us
The result was humbling in the best way. The scorecard: the **dry cleaner** (the trade the tool grew from)
scored *mostly works*. The **full-service restaurant** scored a flat *no* — it can't run table service at all.
The **other ten all scored "partly,"** and every one of them said the same thing in different words: *I had to
force myself into a box that isn't my business, and doing so quietly turned off the things I actually run on.*

Three root problems, and they were structural, not cosmetic:

1. **The defining question was pick-ONE, but almost every real business runs two or more lifecycles at once.**
   A salon does services *and* sells retail product. A bakery has a walk-in case *and* custom-cake orders with
   deposits. A repair shop has a workbench *and* an accessory counter. A bookstore sells off the shelf *and*
   special-orders titles you come back for. Forcing a single choice silently deleted half of each business.

2. **The three "what you sell" options missed whole worlds:** made-to-order food (cook it in a minute, hand it
   over), dine-in with **open tabs** that stay open for an hour and get split, **booked appointments** with a
   real calendar, and **service + parts** repair (estimate → authorize → order parts → bill labor → invoice).
   None of those fit "sell from stock," "perform a service," or "take an item in and return it."

3. **The tool's own origin was leaking.** Words like *garment, rack, heat-seal, bag-split, assemble* showed up
   for businesses that have none of those things — and every non-cleaner said the same: it made them distrust
   that the tool was built for them. A restaurant doesn't have garments; it has *tickets, tabs, covers, courses,
   fire, 86, comp, cashout.* The vocabulary has to be theirs, not ours.

And a pile of features turned out to be **near-universal, not niche** — priced modifiers, discounts/markdowns,
deposits, tips, gift cards, loyalty, product variants (size × color), mixed tax on one ticket, and **offline
card payments** (existential for the cart and the market booth, do-or-die for a restaurant mid-rush). We'd
buried these as afterthoughts or missed them entirely.

### The redesign it drove
The clean "three rings stacked in a line" model was really the *dry cleaner's* shape wearing a general costume.
The test replaced it with something truer:

- **A lean core** (ring up, record, own & export your data — unchanged).
- **A shared "common commerce" layer** every business can draw from — modifiers, discounts, deposits, tips,
  gift cards, loyalty, variants, mixed / tax-included pricing, refunds — because the test proved these aren't
  vertical, they're universal.
- **Lifecycle-family "packs"** you can enable *more than one of at once:* Retail, Food & Hospitality,
  Appointments & Services, Take-in Service & Repair (the cleaner's world, generalized to also cover auto,
  device repair, and pet grooming), and Make-to-Order / Special-Order.
- **A trade-first wizard:** you pick the closest trade ("food cart," "café," "salon," "repair shop"…), which
  preloads *your* vocabulary and a sensible default set, then a short multi-select interview adjusts it. One
  click as "mobile food cart" now hides every irrelevant question instead of making you wade through laundry
  ones.

The meta-lesson, written down so we don't forget it: **a tool built for one trade quietly assumes that trade.**
The only way to build something genuinely general is to keep dragging it in front of businesses that aren't the
one it came from — and to believe them when they tell you it doesn't fit. Twelve fake owners just saved us from
shipping a dry-cleaner-shaped "universal" POS. We'll keep doing this every time the design moves.

### Round 2 — the IQ range, and the jargon cliff
We didn't trust v0.2 either. We sent it back out — this time **12 trades × 3 kinds of owner**: one who barely
uses a smartphone and quits the instant something confuses them, one typical owner, and one sharp power-user who
probes every limit and would happily crack the file open in Claude Code. 36 owners. The idea was to test not
just *does it fit my trade* but *can the least technical person alive finish it, and does the most demanding
person respect it?* — because a real tool has to be simple by default and deep on demand, and that's exactly the
tension most software fails.

The result was almost poetic. **Trade-first — picking "food cart" or "salon" as the very first thing — was a
clean win for everyone.** Every single owner, at every level, called it the best moment: it spoke their words
and hid the other trades' clutter. The cross-trade vocabulary leak from round 1 was gone.

And then the second screen abandoned 11 of the 12 low-tech owners. **All at the same spot. All on the same
words.** The one that killed them, named independently by nearly every low-tech owner: *"how do your things vary
— variants vs modifiers vs asset specs?"* Three words they'd never heard, in one line. Right behind it: the
heading word "lifecycle," the phrase "multi-select" (fear of picking wrong), and — cruelly — seeing questions
that *didn't apply to them* ("route to a kitchen?" at a dry cleaner) which made them think they'd broken it by
picking the wrong trade. The 12th low-tech owner (a café) only finished because *her daughter sat down and did
it with her.* For that whole band, the failure was total: they don't get a worse POS, they get **nothing.**

Meanwhile all 12 power-users sailed through the wizard — and none were satisfied. They stalled on the *trust*
step, because "we disclose the card rate as a percentage" reads as evasive to someone sharp: **give me the
number.** They wanted the export *schema*, the storage *ceiling*, the *config* they'd edit in Claude Code — real
facts, not adjectives. The bookstore owner walked over one missing feature (look up a book by ISBN instead of
typing thousands by hand).

So the same design was simultaneously **too hard for the bottom and too shallow for the top.** That's the
sentence that reorganized the wizard.

### The fix: one wizard, two doors
We stopped trying to make a single flow serve everyone. After you pick your trade, the wizard **forks**:

- **Express** (the default): a big *"Recommended setup for a food cart — build it for me"* button that applies
  sensible defaults and goes **straight to download.** No adjust screen at all. This one change rescues almost
  every low-tech owner we lost — they came to run a business, not to configure software.
- **Guided** (if you tap "customize"): **one plain question per screen**, the right answer already checked, and
  a strict ban on every software word that killed people ("lifecycle," "variants," "asset" — gone; a pet is a
  pet, a garment is a garment). Your trade's packs are turned on *for* you, named in *your* words ("Check-in &
  pet records," not "Take-in Service & Repair").
- **Advanced** (a collapsed drawer): every knob, plus the hard numbers the power-users demanded — exact card
  rate, export schema with a sample file, storage limits, and direct access to the config they'll customize.

The deeper principle we're keeping: **simple by default, deep on demand — and never make the simple owner walk
through the deep owner's screen to get there.** Two rounds of fake customers, forty-eight imaginary owners, and
the design is finally shaped like the people who'll use it instead of like the shop it was born in.

### The meta — "everyone starts with a customer and ends with a payment"
Two rounds of testing had earned enough. Staring at 48 owners' answers, the shape underneath all of them became
obvious — and it was much simpler than the packs and layers we'd been drawing:

> **Every business starts the same way (a customer) and ends the same way (a payment). Every question we'd been
> asking was just resolving the path between those two points.**

That one sentence reorganized the whole product:

- **The engine is two fixed endpoints and a configurable path.** Customer in, Payment out; everything else is
  the middle. A retailer's middle is short; a dry cleaner's is long; a restaurant's loops. Same spine.
- **A POS is a flow of information — so the builder should be visual, like a website creator, because it *is*
  one.** You don't fill out a form; you lay out your path by arranging stations (modules) between Customer and
  Payment. The wizard questions become just a *fast way to auto-arrange* that flow for people who'd rather not
  draw it.
- **The first choice is how involved you want to be** — and we engineer a real path for every level: *build it
  for me* → *guided* → *draw it yourself* → *open it in your own Claude Code and go limitless.* You can climb the
  ladder whenever you're ready; the file is the same underneath.
- **The download hands off to the owner's own Claude.** It ships with a generated guide so their Claude Code
  "reads into" the project instantly — the software is theirs, and so is the help.
- **We compile what everyone builds.** Every flow and module a shop makes gets curated into a shared, growing,
  free library, so the next shop starts ahead of where the last one did. And when someone needs something that
  doesn't exist, they send it in, we build it with Claude Code, and it becomes everyone's option.

We stopped calling them "lifecycle packs" and started calling them what they are: **paths.** The product is a
place to draw the path from your customer to your payment, save it as code you own, and keep shaping it — alone
or with an AI — forever. Written up in [docs/THE-MODEL.md](docs/THE-MODEL.md).

### One file, many stations
Then the deployment model fell out of the same idea. If the order is information that different stations see and
update, then **each device is just one station's window onto it.** So the single file, served as a website, is
the *whole* POS — and a computer sets itself up by going to the site, signing in, and answering one question:
*which station is this?* Counter, assembly, route phone, kitchen, customer tracker — the choices are exactly the
stations in the flow the owner drew. Pick one, lock it in, done. Countless machines share one POS with no install
and no IT project; a spare tablet is the kitchen screen today and the counter tomorrow. The visual builder does
double duty — it lays out the path *and* defines the menu of stations every device gets to pick from. Next, the
bedrock in code: the two endpoints, the flow between, and a device that binds itself to a station.

### The machine underneath — and the first code
Before writing a line of the engine, we mapped how information *actually* flows through 12 trades — who becomes
a record, which station sees what slice of it, what each station updates, how it fans out, how it cashes out.
Then we asked what was common to all of them. The answer was almost startlingly clean:

> **Every one of the 12 businesses is the same machine.** A customer opens one polymorphic *record*; it advances
> through a *state machine*; at "fire" points it's *routed* — projected, not copied — to *stations* that each see
> a filtered slice and may fire only certain updates; and it *cashes out* against a payment sink. The apparent
> differences — a linear taco cart, a fan-out restaurant, a loop-back repair shop, a plant-hub cleaner — are all
> the same graph with a different number of stations, a different routing key, and the payment pinned at a
> different point.

That gave us the thing to build: a **Flow** — one JSON document describing the two fixed endpoints, the record,
the state machine, and the stations (each with a *view-filter* and an *update-whitelist*). The engine executes
it, the visual builder edits it, the wizard emits it, Claude Code reads it. **One schema, four readers.** Written
up in [docs/FLOW-SCHEMA.md](docs/FLOW-SCHEMA.md).

And then — after a lot of thinking, deciding, and testing — **customPOS became software.** [`pos.html`](pos.html)
is the first code: a single self-contained file, no build, no dependencies, that runs the whole spine from a Flow
object. It has the two endpoints as bedrock, a state-machine interpreter that reads the stages from data (not
hardcode), one declarative station renderer, and the *"which station is this device?"* setup. We drove it in a
real browser and watched an order flow **Order Counter → Make Station → Checkout → done**, with the Make station
correctly showing the items but **hiding the prices** — because a station is genuinely a *projection* of the one
record, and the engine honored its `money:false` view-filter. Zero console errors.

It's tiny and neutral — a demo counter shop, no vertical baked in. But it's the proof that the whole design holds
in code: change the Flow, and the same engine is a different POS. Everything from here — the modules, the visual
builder, the wizard, the trades' deep features — hangs on this bedrock. The fork is now a foundation.

### 230 features, 14 knobs
We were a little afraid of this part. Every trade has a deep stack of insider features — a restaurant's fire/hold
coursing and 86 countdowns, a salon's color-processing timer, a repair shop's waiting-on-parts aging, a pet
groomer's cage-dryer heat cap. Twelve veterans handed us roughly **230 "can't-run-without-it" features.** If each
were custom code, "one free engine for every trade" would be a fantasy — you'd be rebuilding vertical software
twelve times.

They collapse to **~14 primitives.** That color timer, the promise clock, the parts-aging counter, the ticket
SLA, the dryer heat cap, the hold-shelf expiry, the return-window countdown — *all the same timer service* with a
different duration source and a different thing that fires at zero. The 86 broadcast, the low-stock warning, the
sold-out grey-out — one par-count service. Require-a-steak-temp, offer-fries, bond-builder-with-lightening,
capture-the-passcode-before-the-bench — one require/suggest rule. The differentiation between a taqueria and a
tailor is **durations, thresholds, rate tables, station maps, flag words, checklist steps, tile layouts** — data,
not code. Written up in [docs/MODULE-LIBRARY.md](docs/MODULE-LIBRARY.md): a primitives kernel, cross-industry
packs on top, and a per-trade profile that's mostly settings plus one or two genuinely custom modules.

That reframes the whole build. The engine ships each primitive **once**; a trade is a config file; a feature one
shop needs becomes a knob every shop can turn. It's also the exact thing that makes it usable by a non-technical
owner: 86-ing an item or changing a turnaround time is a *setting*, not a developer ticket.

### The order that splits and comes back together
So we built the next primitive into the engine: **routing fan-out.** The demo order now carries a `route` on each
line, and on "Send" it splits — drinks to the **Bar**, food to the **Kitchen** — each maker seeing *only its own
lines*, still money-blind. And the order won't go `Ready` until **both** stations finish; it re-converges on its
own. We drove it in a browser: the Bar saw the coffee (not the muffin), the Kitchen saw the muffin (not the
coffee), checkout stayed empty until both were done, then the order appeared, paid, and closed. Zero console
errors. That's the exact mechanism the restaurant — our worst-scoring trade in round 1 — actually needs, now
running as a generic primitive on the same 200-line engine. One order, many hands, back to one. The machine is
starting to breathe.

### Two businesses, one engine — and your store's shape
Then the owner made the setup dramatically simpler. Instead of forcing everyone to draw a flow diagram, he saw
it: *"just prompt for how many types of workstations — then when you enter your prices, give each item or
category a path. Path by item, or path by category."* An order's route isn't drawn per order; it's **composed
from the paths of the items on it.** And two topologies cover almost everyone: **hub-and-spoke** (a central
computer starts and finishes; work fans out and comes back) and **linear** (start here, end there). His own store
is the hub-and-spoke case — two central computers that open and close orders, most items flowing through
assembly, *but not all*: wash-&-fold skips it.

So we built exactly that, and used it to prove the whole thesis in code. The engine now routes by a **per-item
path**, and we stood up a **second, completely different business on the same engine — by config alone.** Flip a
switch at the top of the file and the "Demo Counter" (linear: Order → Bar/Kitchen → Checkout) becomes "Demo
Cleaners" (hub-and-spoke: a central Front Counter that starts *and* finishes; press items go Assembly → Rack;
wash-&-fold goes straight to Rack). We drove it in a browser: at **Assembly**, only the shirt showed up — the
wash-&-fold was never there, because its path skips assembly — and money stayed hidden; at **Rack** both
re-converged; the central **Front Counter** checked the finished order out. Then we flipped back to the counter
shop and its kitchen/bar fan-out still worked. Zero console errors, both businesses, **one unchanged engine.**

That's the moment the vision stopped being a claim. "A trade is config, not a rebuild" — we can now *show* it: two
trades, one file, no engine edits between them. Everything from here is more primitives and more config on a
foundation that has now earned trust. (He also tossed in another feature on the way past — let servers *track
their own order and items* down the path — logged in the ideas inbox as a filtered view of the same status
broadcast that drives the customer tracker.)

### Building the primitives — and a third trade
Then: *"do it all, don't stop until you're out of ideas and it's fully tested."* So we built the engine out,
one primitive at a time, each driven in a real browser with zero console errors before moving on:

- **The rules evaluator** — required modifier choices that block an order until made (steak temp, drink size,
  starch), suggested add-ons that upsell, and **86/par-count** that decrements an item and disables it everywhere
  at zero. All of it *data on the catalog item*, no code per trade.
- **The timer/SLA service** — one primitive, two modes: a ticket that ages green→yellow→red, and a
  back-scheduled promise-by that flips to **OVERDUE**. The salon color timer, the cleaner promise clock, the
  repair parts-aging — the same chip with different numbers.
- **Deposits + the flag engine** — take a 50% deposit at drop-off and charge only the balance at pickup; and
  flags (allergy, pre-existing damage, data-loss waiver) that ride the ticket, show **bold red** at the station
  that needs them, and **gate completion until a worker acknowledges** — acknowledged once per ticket, and that
  acknowledgment persists and broadcasts.
- **The status board + the customer tracker + the module contract** — two projections of the one state machine:
  an internal board of every live job by status and location, and a **sanitized** customer view that shows the
  order number, a friendly status, and item names — and *nothing else* (no prices, no internal detail). Plus a
  module registry so the **stations you turn on automatically enable their modules.**

And then the real exam: a **repair shop** — approval waiver, a split path where batteries skip diagnostics but
screen repairs don't, a deposit, an aging clock — stood up entirely as **config, with not one line of engine code
changed.** It just worked. Three trades now run on the same file, and a suite of five browser tests drives every
primitive across all of them: **5/5 green, zero console errors.**

The through-line of the whole session, now proven in running software: **the difference between a taqueria and a
tailor and a phone-repair bench is a config file.** That is the entire reason customPOS can be free and still do
what shops pay hundreds a month for. There are more primitives to build — commission/tip math, capacity/pacing,
profile recall, loyalty, gift cards, a real checklist — but the shape is set, and each is now just another knob on
a foundation that holds.

### The payments blueprint arrives (from another Claude)
A parallel Claude session — working the payments angle while this one built the engine — dropped a
**validated card-payment blueprint** into the repo ([docs/PAYMENTS-MODULE.md](docs/PAYMENTS-MODULE.md)). It's the
monetization core the whole free model depends on, and it's exactly right: a **processor-agnostic engine
interface** (`pay` / `saveCard` / `refund` / `void`) with swappable adapter modules, a scrubbed **CardConnect /
CardPointe** reference adapter that runs only on the business's own server, and the golden rule that **the browser
never touches a card number** — the card is captured by the processor's hosted tokenizer or a registered
terminal, and only a token + last-four + brand ever come back. It even carries the hard-won gotchas from real
validation (dollar-string on the gateway vs integer-cents on the terminal; void-before-settlement vs
refund-after) and the refund-safety rule inherited from the origin app: **no typed refund amounts, owner approval
required.** The integration has passed the processor's full transaction-scenario validation.

Two Claudes, two branches of the same vision, converging in one repo — one building the engine, one certifying
the way it earns its keep. The branch it came on had forked before this session's engine work, so we brought just
the blueprint onto main rather than merge a stale tree. The monetization is no longer a promise in a plan; it's a
proven, buildable module waiting for Phase 5.

### Running the list to the end
*"Keep going, and testing."* So we ran the primitives list down until it was, for practical purposes, done —
each one config-driven, each one driven in a real browser before moving on:

- **Money-math** — a per-provider commission engine and card tips. Built a **salon** as the proof: services
  performed at a chair by a named stylist, a tip prompt at checkout, and a Back Office that computes each
  stylist's sales × commission + tips = take-home. (Trade #4, config only.)
- **Profile recall** — persisted customers with a phone lookup and a one-tap **"the usual"** that re-rings a
  regular's last order, provider and all.
- **Loyalty + gift cards** — points that earn on every ticket and redeem for a discount; gift cards sold as a
  product and spent as a tender, a fully-covered ticket closing without cash.
- **Checklist-as-gate** — a QC checklist that blocks a station from advancing until every step is ticked (the
  repair bench can't shelf a device until it's powered-on, cleaned, and sealed).
- **Capacity & pacing** — a live wait estimate and a hard cap on the queue, so a slammed counter stops taking
  orders it can't make.

By the end the engine carries **fourteen primitives** and runs **four very different trades** — a counter shop,
a dry cleaner, a repair bench, and a salon — from **config alone, with nine browser test suites green and zero
console errors.** A taqueria, a tailor, a phone-repair bench, and a hair salon, one file, no code between them.

That's the thesis, delivered: not a slide, a running program. The software that shops pay hundreds a month for,
built once as a set of knobs, given away — and it earns its keep only when a shop chooses to take a card, through
a module that's already been certified. Free software, free knowledge, owned by the people who use it. There's
polish left — the visual builder, the wizard that writes these configs, the download bundle with its Claude Code
guide — but the hard part, the part everyone said couldn't be one engine, is done and tested.

### All the way through — customPOS.com, end to end
*"Keep going, all the way through!"* So we built the last mile — the part that turns an engine into a product.

First the seam: the engine now honors an **injected config** (`window.CUSTOMPOS_FLOW`). A *downloaded POS* is
just the engine plus one inlined flow — no demo picker, its own name in the header, ready to run.

Then the thing itself: **the builder** ([builder.html](builder.html)) — customPOS.com in one file. You pick your
trade from a handful of starter templates, name your business, and hit **"Build it for me."** It shows a live
preview of your *actual* POS running right there, and hands you two downloads: **your self-contained POS** (the
engine with your flow baked in) and a **generated `CLAUDE.md`** written for *your* build — your stations, your
catalog, plain-English things to ask Claude Code — so the moment you download it, your own AI developer already
understands your shop. That's the whole promise made real: configure it, download it, own the code, keep shaping
it with Claude. The Webflow-for-POS idea, except what you export is a working data-driven app, not dead markup.

And the money: **payments** are wired through the processor-agnostic interface from the certified blueprint. A
simulator adapter ships by default so a fresh download can take a (pretend) card out of the box — the ticket even
shows `💳 Visa ••NNNN` — while the real CardConnect adapter drops in on the business's own server, the browser
never touching a card number. The free software; the certified way it earns its keep; both in the repo.

By the end: an engine of fourteen primitives, four trades on it by config alone, a builder that stamps out an
owned POS with its own AI guide, payments on the processor-agnostic seam, and **twelve browser test suites, all
green, zero console errors.** From a single shop's hand-built POS to a machine that hands *any* small business its
own — free, owned, and customizable — in one sitting. Software is free. Knowledge is free. The code is yours.

*What's left is polish and reach: more templates, a drag-to-arrange visual editor, the multi-device hub, and
standing customPOS.com up in the world. The foundation is built, and it holds.*

### Reach — the hub and the one-click builder
*"Keep going."* Two more pieces of reach, both tested.

**The hub** ([hub.js](hub.js)) — a zero-dependency Node server that lets *real, separate devices* share one live
POS, not just tabs in one browser. It serves the app and exposes `/api/db`, union-merging orders by id so a
counter, an assembly screen, and a route phone all see the same tickets. It's **opt-in** — a downloaded POS is
fully local and owes nothing to anyone until a shop points it at a hub with `?hub=…`. We drove it end to end: an
order rung up on one device pushes to the hub, and a *separate* device pulls it down. This is the "each device is
a station" idea made real across a whole shop.

**One-click customPOS.com** — the builder used to need a web server to fetch the engine. Now `node build.js`
inlines the engine into the builder and emits a single **73 KB self-contained file** (`dist/custompos.html`) that
runs the entire thing with **no server at all**: open it anywhere, pick a trade, and download your POS + its
CLAUDE.md, offline. customPOS.com can be one static file you host anywhere — or email to someone.

Fourteen test suites now, all green. The engine, four trades, the builder, payments, the hub, and a
self-contained one-file distribution — the whole loop from *"help me set up a POS"* to *"here's your own
software, and here's how to keep changing it with AI."* Free, owned, tested, and real.

### The studio, and a real restaurant
*"Deepen it — make the workstations clickable with lots of settings, and modules that follow items and/or
workstations."* So the builder's second step became a **configuration studio.** Click a workstation and set its
role, whether it shows prices, and a QC checklist that gates it — **modules that follow the workstation.** Click
an item and set everything that trails it: which workstations it flows through, its required choices and add-ons,
its flags, whether a staffer performs it, its 86 limit — **modules that follow the item.** Business-wide knobs for
tenders, tips, deposits, loyalty, the order timer, and queue capacity sit up top. Add or remove stations and
items; the flow diagram is clickable; and the generated `CLAUDE.md` describes whatever you actually built.

Then: *"Ozark should be the dry-cleaner endpoint; the next one is the Hamburger Barn in Arkadelphia — grab that
menu and make it more real."* So we did. The dry-cleaner template grew into a full plant — laundered shirts with
starch and damage/stain flags, slacks, suits, dresses, coats, comforters, wash-&-fold, alterations — flowing
Front Counter → Detail/Tag → Assembly → Rack (with a real piece-count-in-vs-out QC checklist) past a status board
and a customer tracker. And a **real burger joint**: the actual Hamburger Barn menu off Pine Street — the Bubba
Burger, the Mushroom Swiss, the fried pickles and onion rings and Big Teaser Trio, catfish plates, milkshakes,
and a Blue Plate special that 86s when it runs out — nineteen items that **fan out live to a Grill, a Fry Station,
and a Shake Bar** with a Kitchen Display over the pass. We built it in the wizard and drove the actual generated
POS: one ticket, and the burger showed up at the grill while the onion rings showed up at the fry station. A real
Arkadelphia restaurant, running on the same engine as the cleaner and the salon, from a template you can edit and
own. Sixteen test suites, all green.

### The boring parts that actually run a business
*"Keep going with everything you know to do to help small businesses."* The fun primitives were done — routing,
timers, flags, loyalty — but a POS that can't compute sales tax, print a receipt, or close out the drawer at
night isn't a POS an owner can trust with the register. So we built the table stakes. **Sales tax** that applies
to the *discounted* base (discount a $100 ticket 10% and the tax lands on $99, not $100), with per-line `taxable`
so a gift card or a non-taxable service is left out of the math. **Discount buttons** the owner opts into. A
**printable receipt** that itemizes subtotal, discount, tax, and total and says thank you. And the one every
owner asks for on day one: an **end-of-day Z-report.** Bind any workstation as an *Office* and it totals the
day — orders, items, net sales, discounts, tax collected, tips, total collected — then breaks it down **by
tender** (cash vs card) and **by category**, and finishes with a **cash-drawer count**: here's the cash you
should have, type in what you actually counted, and it tells you *balanced ✓*, *over +$2.00*, or *short $2.00*.
All of it is still pure config — the report reads whatever the engine already recorded, so the cleaner, the
café, and the burger joint each get their own Z-report for free. Eighteen suites, all green.

### When the sale has to go the other way
Every real register has a **Refund** button, and the day the owner needs it is the day a customer is standing
at the counter unhappy — so it has to be dead simple and it has to be honest. We put it in the back-office
**Office** station (the manager view), not the front counter: pick a paid order, confirm the amount and tender,
and the engine reverses **each tender back to itself** — a card sale refunds to card (through the same processor
adapter that charged it), a cash sale to cash — and marks the order *REFUNDED*. The clever part is what it does
to the day's numbers: the reversal posts offsetting negative tenders on the same order, so the Z-report's
by-tender totals *net themselves* (charge $11 to card, refund $11, card shows $0), a **Refunds −$11** line
appears in the summary, and *Total collected* drops accordingly. No separate ledger, no double-counting — the
drawer math just tells the truth. Eighteen suites, all green.

### Clock in, and be welcomed
The owner had one request that wasn't about money at all: *"Each employee gets a welcome screen when they clock
in! Can just be a message with the daily specials and encouragement."* That line is the whole spirit of the
project — software that's a little kind — so we built it. Bind any device as a **Time Clock**, and it's a PIN
pad. A staffer taps in their PIN and the engine punches them in (or out — same PIN toggles), then greets them by
name: *👋 Welcome, Alex!*, the time, a rotating word of encouragement, the owner's message of the day, and
today's specials. Tap *Start shift* and it's ready for the next person; an **On the clock** list shows who's
working and how long. Punch back out and it thanks them with their hours for the day. It's all config —
`FLOW.staff` (names + PINs) and an optional `FLOW.welcome` (message + specials) — and the punches accumulate in
the data the engine already owns, so a payroll report later gets its hours for free. A wrong PIN just shakes its
head; nothing breaks. Nineteen suites, all green.

### Wiring it back into the studio
An engine feature nobody can configure isn't really a feature, so the last of these went back into the builder.
The workstation role dropdown now offers **Time Clock** (and the reports role got renamed to what it actually is
now — *Reports / Z-report / refunds*). And the Step-2 studio grew a **Staff & time clock** panel: add people with
their PINs, write the clock-in message of the day, and list today's specials one per line — all of it baked into
the one file you download, and named in the generated `CLAUDE.md` so your own Claude Code knows the staff are
there. Build a café, drop in a Time Clock station and a couple of people, and the POS you download greets them by
name on their first punch. Twenty suites, all green.

### The clock feeds the close
Once the time clock was writing punches into the same data the register uses, the payoff was almost free: the
end-of-day report grew a **Labor — hours today** line. It sums every punch by name, totals the day's hours, and
if anyone's still on the clock it says so (their hours are counted up to *right now*). The owner closing out at
night now sees the day whole on one screen — what came in, by tender and category, the drawer count, *and* what
the shift cost in hours — without a second system talking to the first, because there is no second system.
Twenty suites, all green.

### Knowing what's on the shelf
For a shop that sells *things*, the question that never stops is *how many are left?* So items got an optional
stock count. Set a Widget to 2 on hand and a reorder point of 1, and the register tile now reads **2 in stock**;
sell one and it says **1 in stock · low**; sell the last and it flips to **out of stock** and the button goes
dead so nobody rings up air. On-hand isn't a number we mutate and hope stays right — it's *derived*: starting
stock, plus anything received, minus everything sold, computed the same way the 86 counter already worked. The
back-office report grows a **Stock** card that badges *"1 to reorder"*, lists every tracked item with its on-hand
and a low/out tag, and gives each a **Receive** box — type in a delivery of 5, and the shelf refills and the
reorder flag clears. The builder exposes both fields (*In stock*, *Reorder at*) right on the item, so a retailer
can set it all up without touching code. Twenty-one suites, all green.

### The book of the day
Retail asks *how many are left*; a salon or a repair shop asks *who's coming in and when*. So a device can now be
an **Appointments** station. It's a small booking desk: type the customer, pick a service off the same catalog
the register uses, choose a time and (if the trade has providers) who it's with, and it lands on **today's
schedule**, sorted by time. The important part is the hand-off — a booking isn't a separate island of data. Tap
**Check in** and it becomes a real order, order number and all, provider already attached, flowing into the exact
same pipeline and checkout as a walk-in; the schedule marks it *checked in #N* so the front desk can see the loop
closed. One catalog, one order stream, whether the customer booked ahead or walked through the door. The builder
offers Appointments as a station role, so any service business can switch it on. Twenty-two suites, all green.

### "Your order's ready"
The single most-asked-for feature at a cleaner or a repair shop is the text that says *come get it*. So the
engine grew a notify seam — built exactly like payments, and for the same reason. Turn on **text when ready** and
a ready order with a customer on it shows a *📱 Text ready* button; tap it and the engine composes the message
from a template (*"Hi {name}, your order #{number} at {biz} is ready."*), sends it, and stamps the order *✓
Texted 5551234: …* so staff know it went. The send goes through a processor-agnostic adapter: a simulator that
just records the message ships by default so a downloaded POS works offline and demos honestly, and a hub adapter
(Twilio and friends) does the real send server-side — the browser never holds an API key, same discipline as card
numbers. The builder exposes it as a one-tap business toggle. Twenty-three suites, all green.

### "Can we split it?"
The table asks it every night, so the register can now answer. Turn on **split checks** and a ready order offers
*2 / 3 / 4 ways*; pick three and it shows *3 shares · $10.00 each · 0 of 3 paid*, and the pay button becomes
*Take share $10.00*. Each tap collects one equal share — and shares don't have to match: one guest pays cash,
the next by card, the engine just keeps knocking $10 off the balance until it hits zero and closes the ticket.
The last share always settles to the exact remaining penny, so a $30 split three ways never leaves a stray cent.
It rides on the same multi-tender balance math the checkout already had; splitting is just a nicer way to reach
zero. One builder toggle turns it on. Twenty-four suites, all green.

### Put it on my tab
Regulars and B2B customers don't pay at the counter — they run a tab and settle up later, and a POS that can't
do that loses them. So *house accounts* became a tender. With a customer attached, checkout offers **Charge to
account**; the order closes now, and the amount lands on the customer's balance as accounts-receivable. The honest
part is in the close-out: an on-account charge is money *owed*, not money *collected*, so the Z-report keeps them
separate — *Total collected* excludes it and a distinct **On account (A/R)** line reports it, while the drawer
count is untouched. The report also grows a **House accounts** card: who owes, how much, a running total, and a
**Record payment** box to settle a balance in part or full. Refund an on-account order and it credits the tab back,
too. It's real A/R, built from the same customer records and tender math already in the engine. Twenty-five
suites, all green.

### Beep
A grid of tap-tiles is lovely for a coffee shop with eight things; it's hopeless for a grocery with eight
hundred, and useless with a barcode scanner in your hand. So the intake grew a **search / scan** box — it shows
up automatically once a menu passes a handful of items, or any time you flip on *barcode scan*. Type a few
letters and the tiles filter live; hit Enter and the first match rings up. And because a USB barcode scanner is
really just a keyboard that types fast and presses Enter, the same box *is* the scanner integration: give an item
a barcode/SKU, scan it, and it drops straight into the order — no driver, no hardware config, works on the
nineteen-item Hamburger Barn menu and a nine-hundred-item market alike. The builder adds a *barcode scan* toggle
and a Barcode/SKU field on every item. Twenty-six suites, all green.

### Codes at the counter
The quick *10% / $5 off* buttons are fine until a shop runs a real promotion and wants a code customers can say
out loud. So discounts learned a second form: instead of `true`, an owner can hand the engine a list of **coupon
codes** — `SAVE10` for a percentage, `5BUCKS` for a flat amount. Checkout then shows a code box instead of the
quick buttons; type `SAVE10`, and it knocks 10% off, recomputes the tax on the discounted base (the tax engine
already did that math), and stamps *✓ SAVE10 applied*. A wrong code is politely refused, *Clear* takes it back
off, and switching codes just re-applies. The builder gets a **Coupon codes** editor that appears the moment
discounts are on — add a code, pick *% off* or *$ off*, set the number. Same discount plumbing underneath, now
with a name. Twenty-seven suites, all green.

### "Let me write that up for you"
Not every counter conversation ends in a sale — sometimes the customer wants a price to think about. A repair
shop quotes a screen job, a cleaner quotes a wedding dress, and the customer comes back Tuesday. So the engine
learned **quotes**. Turn it on and the order screen gains *Save as quote*: it tucks the current draft away with a
number and a total, clears the counter for the next customer, and lists it under **Saved quotes**. When they come
back, *Load* drops the whole thing back into the order exactly as it was — same items, same customer — and it
rings up like any walk-in. A quote is just a parked draft, so it costs nothing and rides the same order machinery;
the builder turns it on with one toggle. Twenty-eight suites, all green.

### The bump bar
A busy kitchen doesn't want a checkout screen — it wants a wall of tickets and a way to clear them. So a device
can be a **Kitchen Display**. It shows every working ticket **oldest first**, each with a **prep timer** that ages
green → yellow → red against the trade's thresholds, so the line cook can see at a glance which order has been
sitting too long. One big **Bump ✓** fires the whole ticket ready — every item marked done in a tap — and it drops
off the board and shows up ready at the counter. It reads the same order stream and completion math the production
stations already use; it's just the expo's view of it, built for speed. Twenty-nine suites, all green.

### Which day is "today"?
While wiring history into the report, a quiet bug surfaced: the Z-report said *today* but was actually totalling
**every sale ever recorded** — there was no date filter at all. On day one nobody notices; by week two the
"today" numbers are nonsense. So the report learned about days. Every record already carries a timestamp, so the
report now groups by the **local** calendar day and shows only that day's orders — and since the data was already
there, the same change unlocked **history**: page back a day at a time, jump to any date with a picker, or hit
*Today* to return. Close out tonight and the numbers are tonight's; look up last Saturday and it's Saturday's. A
correctness fix and a feature from the same three lines. Thirty suites, all green.

### A front door
All this machinery needed somewhere to land, so customPOS got a home page — and it's built the same way as
everything else: one self-contained HTML file, no frameworks, no external fonts or scripts, works in light or
dark. It says the plain thing up top — *build your own POS, download it, own the code* — and then does the
harder, more important job: it tells the truth about money. A panel that literally reads **$0 / forever** next
to an honest note that the *only* way the project earns is an optional certified card integration, a fee you
already pay a processor. Below that, the questions every owner actually asks before trusting software — where's
my data, is it backed up, does it work offline, am I locked in, what if you disappear — each answered in a
sentence, because trust is the entire pitch. A feature grid shows the twenty things the engine now does, and
every button leads to the builder or the live demo. The marketing and the product tell the same story because
they're made of the same stuff. Thirty-one suites, all green.

### Templates that arrive fully dressed
All these capabilities were reachable in the builder, but a first-time owner shouldn't have to know to turn them
on — the *template* should already think like their trade. So each starter grew into what that business actually
runs on. **Retail** ships with stock counts, barcodes, a scan box, sales tax, discounts, split checks and an
Office report. The **café** and the **Hamburger Barn** get an interactive Kitchen Display with bump and split
checks. The **cleaner** and the **repair shop** get ready-texts, quotes, and a Z-report — the repair shop's
estimates especially. The **salon** arrives with staff PINs and a clock-in welcome, an Appointments book, a Time
Clock, and ready-texts. Pick a trade, type your name, hit build, and the POS you download already knows how your
kind of shop works — every one of the six templates builds and runs its live preview with zero console errors.
Thirty-one suites, all green.

### Bring your own list
The scariest sentence in switching POS systems is *"and then re-type your two thousand items."* So the builder
learned to **import**. Open the items step, paste a CSV — `name, price, category, barcode`, one per line — hit
Import, and they're all in your catalog. It auto-detects and skips a header row, defaults a missing price to
zero and a missing category to "item", and treats the barcode as optional, so whatever a shop can export from
its old till or a spreadsheet drops straight in. It's the answer to one of the trust questions the whole project
is built around — *how do I move my existing data in?* — and now it's a paste away. Thirty-two suites, all green.

### Your data, in your hands
Two other Claudes reviewed the repo and landed on the same first note: the whole pitch is *you own your data*,
but the app itself had no button to take it out. Fair. So the back office grew a **Data & backup** card that says
the quiet part out loud — *your data lives only in this file, plus your optional hub; back it up regularly* — and
then makes it true. **Backup (JSON)** downloads the entire database as one portable file named for the shop and
the date. **Customers (CSV)** and **Sales (CSV)** export the lists a spreadsheet or an accountant wants. And
**Restore backup** reads a backup file back in and replaces the device's data, so a dead hard drive is a
five-second recovery, not a catastrophe. No server round-trip, no export queue — it's a Blob and a download, the
same offline-first way everything else works. The ownership promise stopped being a paragraph and became a row of
buttons. Thirty-three suites, all green.

### Know what you're running
The reviewers also asked for the small, professional thing: stamp the downloads so an owner (or their Claude Code)
knows what they've got. The engine now carries a version, and when the builder bakes a POS it reads that version,
adds an HTML comment banner — *customPOS · Your Shop · engine v0.32 · built 2026-07-07 · your software, your data*
— and injects a `CUSTOMPOS_BUILD` record right beside the flow. The generated `CLAUDE.md` opens with the version
and build date, and the running POS quietly shows *customPOS engine v0.32 · your build 2026-07-07* on its setup
screen. Nothing fancy — just the difference between a mystery file and a file that tells you what it is. Thirty-
four suites, all green.

### Add to home screen
On a phone at the counter, a browser tab feels like a toy; an app icon feels like a tool. So the POS is now
installable. It builds its own **web manifest** at runtime — branded with the shop's name and color — sets the
**theme color** to match, flips on the Apple "web-app capable" flags, and even draws its own **home-screen icon**:
a rounded square in the brand color with the business's first initial, generated as an inline SVG so there's still
no external file to host. Add it to your home screen and it launches full-screen, standalone, named for your shop.
No service worker, because it doesn't need one — the app has been offline-first from the start; this just gives it
the icon and the chrome-less window to match. Thirty-five suites, all green.

### Whose write wins?
The reviewers put a sharp question to the sync hub: *is it just implicit last-write-wins, and what stops a stale
device from clobbering good data?* Fair, and worth answering in code, not just prose. So records now carry an
`upd` stamp — the client bumps it in `saveDB` only when a record's content actually changes (it diffs against
the last save, so idle saves don't churn it) — and the hub merge keeps the copy with the **newer** stamp. A
back-office tab that's been sitting open can no longer push a stale order state over a fresher one from the
register; its older `upd` loses. Records with no stamp still fall back to plain last-write-wins, so nothing older
breaks. It's honest last-write-wins *at the record level*, not silent data loss — and it's unit-tested
(newer-wins, stale-rejected, union-add, seq-max) alongside the end-to-end two-device test. The whole model, plus
the "before you put this on the internet, add HTTPS and an access key" security note, is now written down in
`docs/HUB-SYNC.md`. Thirty-six suites, all green.

### Tax two ways
The reviewers flagged an honest gap: the engine only knew how to *add* tax on top, but plenty of the world quotes
prices with tax already **inside** — VAT, GST, a diner that lists "$110, tax included." So tax grew a second mode.
Flip `tax.included` and a $110 ticket at 10% stays $110 at the register — but the engine now knows $10 of that is
tax, labels the line *Tax (incl.)*, and in the Z-report reports **net sales of $100** with **$10 tax collected**,
because net should never include the tax you're holding for the state. Added-on-top mode is untouched and still
the default. It's the same prorated-discount, per-line-taxable math as before, just solved for the tax portion
instead of adding it — one config flag, both worlds correct. The builder toggles it right next to the rate.
Thirty-seven suites, all green.

### Stock moves for real reasons
"Receive more stock" was only half the truth — real shelves lose count to spoilage, breakage, transfers to the
other store, and the dreaded physical recount. So the Stock card's one Receive button became a reason-coded
**adjustment**: pick *Receive*, *Transfer in*, *Transfer out*, *Waste*, or *Recount*, type a number, Apply.
Receive and transfer-in add; waste and transfer-out subtract; **Recount** is the important one — it sets on-hand
to exactly the number you counted, doing the arithmetic for you regardless of what the system thought. Every
non-receive change lands in an **Adjustments** audit trail on the same card (time · item · reason · delta), so the
owner can see where the shrinkage went — the "periodic loss/theft count" the plan always wanted. Same derived
on-hand underneath; now it can go down for a reason, not just up. Thirty-seven suites, all green.

### Data in, data out — the whole way
Backup answered "get it all out"; the reviewers also wanted the everyday lists — prices, inventory, customers —
to move both directions. So the Data & backup card rounded out. **Catalog (CSV)** exports every item with its
price, category, barcode, and live on-hand — the price book an accountant or a spreadsheet wants. And **Import
customers (CSV)** reads a `name, phone, points, gift, balance` file and merges it into the book, upserting by
phone, so a shop switching from another system brings its regulars along instead of retyping them. Paired with
the builder's item import, customPOS now takes data in and hands it back at every layer that matters — catalog,
customers, sales, and the whole database — all plain CSV/JSON, all offline. Thirty-seven suites, all green.

### Just this one item back
Refunds reversed the whole ticket, but the counter reality is usually smaller: *the shirt was fine, she's just
returning the tie.* So returns went line-level. In the back office, each refundable order now lists its items with
tick-boxes; check the ones coming back, hit **Return selected**, and the engine refunds exactly their **share of
the grand total** — proration and all — to the original tender, credits a house-account tie back if that's how it
was paid, and marks those lines *returned*. The clever part is keeping the day honest: the Z-report treats a
partly-returned order proportionally — net sales and tax shrink to just the items still sold, the returned money
shows up under Refunds, and collected drops to match — while a full return (every line ticked) collapses into the
same clean REFUNDED state as before. A $30 order, return the $20 item, and the books read exactly right: $10 sold,
$1 tax, $22 refunded, $11 in the drawer. Thirty-eight suites, all green.

### Green somewhere other than here
Then CI told the truth the local run couldn't: the moment the tests ran on a real GitHub runner, a third of them
failed — not on logic, but because they hard-coded `file:///workspace/custom-pos/pos.html`, a path that only
exists in this one container. Exactly the kind of "works on my machine" the reviewers meant. So every test now
derives the file URL from `__dirname`, and the suite is portable: a CI workflow installs Chromium and runs all of
it on every push, a Pages workflow publishes the landing page and the live builder, and the README carries a
tests badge. While the plumbing was open, the builder's flow gained real editing — select a workstation and move
it **earlier / later** to reorder the whole pipeline — and the two big engine files got a table-of-contents banner
up top and section markers throughout, so the next person (or the next Claude) can find their way. Thirty-nine
suites, green — now provably, on someone else's computer.

### The money on-ramp, from another bench
A sibling Claude — running on the Arkadelphia assembly PC, against live Fiserv UAT — built the piece that turns
the payments blueprint into a business: **`tools/validate-cardconnect.js`**, a one-command runner for the
certified CardConnect/CardPointe integration. Getting a merchant approved by Fiserv means passing an "Integration
Validation" gauntlet — a couple dozen specific transactions (card-not-present, customer-initiated, merchant-
initiated/recurring, void, full and partial refund, and the card-present taps) whose retrefs you paste into a
form, usually across several rounds of back-and-forth. This runs all of them and prints each retref mapped to its
box. What makes it worth its weight is that it bakes in the rules that otherwise cost real round-trips to learn:
the gateway wants a dollar *string* while the terminal wants integer *cents*; a $0 verification must use
`capture:"N"` or it's rejected as "Invalid amount"; the CVV rides the initial capture and token-storage calls but
never a stored-token reuse; recurring needs `cof:"M"` + `ecomind:"R"`; the $1,100.xx amounts are *supposed* to
decline. Credentials come from env vars — no secrets in the file — and it uses Fiserv's public UAT test cards. It
came in as a clean, additive commit on top of a green tree, so it fast-forwarded straight into `main`; the
39-suite browser sweep is untouched (the runner needs live UAT creds, so it lives in `tools/`, outside the test
runner). The free software stays free — and the one paid, opt-in path it rests on just got a lot easier to turn
on. Thirty-nine suites, still green.

### Processing for anyone, not just us
*"Write it up for general use — I'd like to provide the credit-card processing to anyone who wants it."* That's
the whole business turned into a product: the certified integration shouldn't be welded to customPOS, it should
be a thing any shop with any POS can switch on. So the adapter became a **standalone service** —
`payments/pay-server.js`, zero dependencies, runs on the merchant's own server. It exposes one small, neutral
REST API — `/charge`, `/refund`, `/void`, `/inquire`, a card-present terminal pair, and a `/tokenizer` endpoint
that hands back the hosted-iFrame URL — and behind it sits the certified CardConnect adapter, with every
processor quirk (dollar-string vs integer-cents, `capture:"N"` on a $0 verify, CVV only on the initial capture,
`cof`/`ecomind` for recurring) hidden so the caller only ever speaks **cents**. The security model is the point:
the browser tokenizes the card straight to the processor's iFrame, the POS backend charges the *token*, and card
data never touches the service or the POS at all — PCI SAQ-A by construction. A shared `PAY_KEY` gates every
money call; a **simulator** provider means a third-party POS can integrate and demo the whole flow before any
merchant account exists, then flip three env vars to go live. Any system that can POST JSON and show an iFrame
can now take certified card payments. It ships with a full general-use guide (`payments/README.md`) — REST
reference, the two-step "integrate any POS" recipe, the per-merchant go-live checklist, and the deploy/PCI
rules — and a pure-Node test that drives charge, decline, refund, void, inquire, and the terminal against the
simulator. Free software; the one honest paid path is now a product anyone can plug in. Forty suites, all green.

### Two big maps arrive from the other room
Brayden had been designing in a ClaudeChat window in parallel, and handed over two substantial roadmap docs — a
**restaurant vertical** (spatial floor plan + table state machine, a section auto-sorter, a station-flow designer
with printers as first-class nodes, course pacing, category-level menu wizards) and a cross-vertical **worker
rights + scheduling** suite (a scheduling grid with predictive-scheduling compliance, a break-rules engine,
real-time earnings, a coverage marketplace, PTO, incident + panic reporting, state labor-law modules, a worker
portal — with the quiet radical premise that *the defaults tilt toward the worker* and taking protections away
takes deliberate editing, not a toggle). They landed in `docs/RESTAURANT-VERTICAL.md` and `docs/WORKER-RIGHTS.md`,
each with a reconciliation header written against the current v0.39 build so nothing gets rebuilt: a lot of the
groundwork — routing/fan-out, the KDS, 86, split checks, the clock-in briefing, tips/commission, the time-clock,
the notify seam, the export/ownership principle — already ships, which means both roadmaps start from primitives
that exist rather than from zero. The net-new in each (a spatial floor/table state machine; a scheduling grid +
break engine) are the natural next big builds, and both generalize far past their first vertical — a table state
machine is a salon chair, an auto bay, a spa room. Captured, cross-referenced from the Ideas inbox, nothing lost.
Forty suites, still green.

### The room, on a screen
*"Build it out."* So the first big piece of the restaurant roadmap landed — and, true to the whole project, it
landed as a **general primitive**, not a restaurant feature. A **floor / table state machine**: bind a device as
a **Floor** station and it shows a grid of tables, each a colored tile that moves through a service flow —
*Empty → Seated → Greeted → Ordered → Food out → Check → Paid → Bussing* — every state carrying its own color and
`next`, and every table stamping the moment it changed so the tile can show *minutes in state* and pulse red once
it's been sitting too long. Tap a table to advance it one step or jump it to any state; filter by **section**
(Main / Patio / Bar) so a server sees their room and a manager sees the whole floor; the states are all
`FLOW.floor.states`, so the exact same code is a salon's chairs, an auto shop's bays, or a spa's rooms — you just
rename the states. A new **Full-service restaurant** template ships with a ten-table dining room, a kitchen line,
cold station, bar, and a KDS, so an owner picks it and has a working floor in one click. The state lives in the
same synced DB as everything else, so it'll ride the hub to every device on the floor. Net-new still ahead — a
drag-drop floor *designer* and turn-time analytics — but the beating heart of the vertical, the table that knows
what's happening to it, is real and tested. Forty-one suites, all green.

### Fire the entrées
Fine dining runs on timing: the apps go out, the table eats, *then* the kitchen fires the mains — you don't want
the steak plated while they're still on calamari. So the engine learned **course pacing**. Give an item a
**course** (Appetizers = 1, Entrées = 2, Desserts = 3) and turn coursing on, and only the *fired* course reaches
the line — later courses **hold** in the kitchen, listed but not cooking. The KDS shows which course is up, what's
held behind it, and a **🔥 Fire Entrées** button; tap it and the held course releases to the line and the bump.
It rides the exact machinery that was already there — a held line just isn't "released" to its station yet, so
the order simply isn't *done* until every course has been fired and made, which is the truth of the table. Turn
it off and nothing changes; every non-restaurant trade is untouched. The bistro template ships with it wired
(apps/salads/drinks fire now, entrées hold, dessert holds behind them), and the builder gets a *course pacing*
toggle plus a Course dropdown on each item. Forty-two suites, all green.

### Draw your room
The floor plan was real, but the tables came out in an auto-flowed grid — fine for a demo, wrong for a shop that
knows exactly where table 12 sits by the window. So the builder grew a **floor designer**: a canvas with a
graph-paper grid where every table is a draggable tile. Grab one, drag it, drop it — it snaps to the grid and its
`x,y` is saved into the config; click a table to set its label, seats, and section, or add and delete tables. The
engine picks up those coordinates and lays the room out *spatially* instead of auto-flowing, so what the owner
drew is what the servers see. It's plain pointer events — no drag-drop library, nothing to bloat the one-file
build — and tables without coordinates still auto-flow, so nothing that existed before changed. Draw the room
once; every device on the floor shows it. Forty-three suites, all green.

### Who works when
A restaurant — any shop with staff — lives and dies by the schedule, and the software that owns the floor should
own the roster too. So the engine grew a **staff schedule**: a weekly grid, one row per person, one column per
day (Mon–Sun). Tap a cell, set a start and end time, save — the shift lands on the grid and the person's **weekly
hours** total ticks up. Cross forty in a week and the row flags **OT**, because a schedule that hides overtime is
how workers get cheated and owners get surprised; here it's on the surface before the week is even published.
When the roster's ready, **Publish** stamps it and *texts every scheduled person their shifts* through the same
notify seam that texts customers "your order's ready" — the worker finds out from the schedule itself, not by
squinting at a photo of a whiteboard. Edit any cell after publishing and it quietly **un-publishes**, so nobody
works off a stale copy — you publish again, everyone gets the new version. It rides the same synced DB, so the
schedule the owner builds in the back office is the schedule on every device. This is the first stone of a bigger
build — worker rights as a first-class part of the POS, not an afterthought — and it starts where the worker
does: knowing when they work, and knowing when they're owed overtime. Forty-four suites, all green.

### Breaks, and money you can see
The time clock knew when you clocked in and out; it didn't know the rest of a real shift — the break you're owed
and the money you're earning. So the clock grew up. Enter your PIN when you're already on and you don't just
clock out anymore — you land on **your shift**: how long you've worked, and, if the shop set your wage, **what
you've earned so far**, ticking up in real time. From there you **start a break** (unpaid time the clock now
subtracts from your paid hours and from the shop's labor total, so nobody's paying for lunch and nobody's getting
shorted) and **end it** when you're back. And because a schedule that hides overtime is how workers get cheated,
the clock watches the law *for the worker*: cross five hours with no meal break and it puts a reminder right on
the screen — *"you're due a 30-minute meal break."* Those rules are **worker-protective by default** — a shop
that configures nothing still reminds its people; an operator can *tune* the thresholds, but the protection
doesn't come with an off switch you flip by accident. The builder gets a **$/hr** field next to each person's
PIN, so a downloaded POS shows real earnings the day it opens. The reminder that you're owed a break, and the
number that says what your time is worth — both now live in the same little clock everyone already touches.
Forty-five suites, all green.

### How fast the room turns
A table that knows its state also, quietly, knows its *history* — when it filled and when it cleared. So the
floor learned to count **turns**. A turn runs from the moment a table leaves Empty to the moment it's bussed back
to Empty; the clock stamps both ends and files the span away. Now the floor wears a little scoreboard: **turns
today**, the **average turn length**, and **covers** served (seats × turns) — the three numbers a restaurant
actually runs on, sitting right above the room they describe. It's the same primitive as everything else here:
the states are `FLOW.floor.states`, so a salon counts chair-turns and an auto shop counts bay-turns with not one
line of special-case code. Nothing new to configure, nothing to switch on — seat a table and clear it and the
math just accrues. The floor plan told you *where*; now it tells you *how fast*. Forty-six suites, all green.

### Asking for a day
A schedule that only ever flows one way — manager pencils you in, you find out — isn't really a schedule, it's
a summons. So the grid learned to listen. A worker can **request a day off** right on their cell, with a reason
if they want; it lands as **pending**, the cell shows *off?*, and a **manager queue** collects every open request
in one place. Approve it and the day flips to a plain **OFF** — and, quietly, the software takes the worker's
side: an approved day off **clears any shift that was there** and **blocks scheduling over it**, so nobody gets
penciled onto a day they were promised free. Try it anyway and the grid stops you — *"Alex is approved off Wed —
clear the day off first."* Change your mind and cancel; the day's schedulable again. It's the same
un-publish-on-change honesty as the rest of the grid: approving a day off un-posts the week so the new version
goes out clean. Small feature, real principle — the roster is now a conversation, and the default answer protects
the person asking. Forty-seven suites, all green.

### Somebody cover me
Life happens mid-week, and the honest response to "I can't make my shift" isn't "tough" — it's "who can?" So the
grid got **coverage**. A worker **offers** a shift up; it wears a little ↔ so everyone can see it's looking for a
taker. The manager opens it and reassigns it to a co-worker — and the software does the bookkeeping that keeps it
fair: it **won't hand the shift to anyone approved off that day** or **already working it**, and it **flags** when
picking someone would push them into overtime, so coverage doesn't quietly become exploitation. Accept and the
shift simply moves — off one plate, onto another — and the week un-publishes so the new lineup goes out clean.
The real worker-to-worker marketplace (claim it yourself from your phone) waits on the worker portal; but the
thing that actually matters — a shift can change hands without anyone getting hurt by it — works today. Forty-eight
suites, all green.

### If something goes wrong
Most POS software treats the worker as a cost center — a pair of hands that rings up sales. But the person behind
the counter can get hurt, or scared, or wronged, and the software they're already standing at should have their
back. So the time clock grew a **Safety** section. On your shift you can **file an incident** — injury, safety
hazard, harassment, a near miss — with a note, and it's **logged, timestamped, and yours on the record**. And
there's a **🆘 Get help now** button that fires an **immediate alert to a manager** over the same texting seam
that tells customers their order's ready — because when you need help, you shouldn't have to go find a phone. The
report itself is never blocked on the alert going through; the record always lands. On the manager's end, the
Office report carries a **safety-incident log** — open reports first, the urgent ones flagged with the 🆘, each
one **acknowledged** so nothing filed just quietly disappears. A shop that wants it sets one alert number; a shop
that doesn't still gets the logged, acknowledged paper trail. It's a small thing to build and a large thing to
mean: the tool is on the worker's side when it counts. Forty-nine suites, all green.

### A place of your own
For weeks the worker's whole life inside the POS lived on the *manager's* screens — the schedule grid, the labor
report, the coverage queue. Useful, but it's the boss's window into the worker, not the worker's window into their
own work. So we built the **worker portal**: a station a staffer opens, taps in their PIN, and sees **their** side
of everything. Your hours today and this week, your **pay so far**, whether you're on the clock or on break. Your
**week** laid out day by day — posted or still a draft — with your days off marked. The **open shifts** anyone's
put up for coverage, and a **Claim** button that finally makes the pickup *worker-to-worker*: you take the shift
yourself, and the software still does the fair-play checks so you can't accidentally double-book or blow past
overtime. And a one-tap **request a day off** that drops straight into the manager's approval queue. It's all the
same synced data the manager sees — no separate system, no new database — just turned around to face the person
whose work it actually is. The pieces we'd been building for the boss's bench now have a home on the worker's.
Fifty suites, all green.

### Split the tips straight
Tips are the part of the paycheck that goes wrong most quietly. In a lot of shops the jar gets divided by feel, or
by whoever's counting, and the person who worked the double shift somehow comes out the same as the person who
left at noon. So customPOS learned to **pool tips and split them by the hours actually worked** — the fairest,
plainest rule there is. Turn it on and the Z-report grows a **tip-pool card**: everyone who clocked in, their
hours, and their exact share of the day's tips, adding up to the penny. Work three of the four hours and you get
three-quarters of the pool — no debate, no favorites, just arithmetic anyone can check. And the worker doesn't
have to trust the math from a distance: their **portal shows their own tip share for the day**, right next to
their hours and pay. It rides the hours the time clock already tracks (minus unpaid breaks), so it's honest by
construction. The builder gets a one-tap **"pool tips by hours"** toggle. Shops that tip-out by seat or provider
keep doing that; shops that want it fair by the clock now can, in one click. Fifty-one suites, all green.

### The one number that keeps the doors open
Ask an accountant what kills small restaurants and shops and they'll say the same thing two ways: *labor as a
percent of sales.* Pay your people too little and you can't keep them; let payroll run past what the day brings
in and you quietly bleed out. Most owners never see that number until the monthly books, when it's too late to
change the week. So the Z-report now shows it **every day**. It takes the hours the clock already tracked, times
each person's wage, to get the day's **labor cost** — then puts it against the day's sales and prints the
**percent**, plainly, with a gentle line: *a common healthy target is around 30%.* Cross the line by a wide
margin and the number turns red — *"payroll is eating a big share of sales today"* — not as a scold but as a
heads-up while there's still time to send someone home early or pick up the pace. It's the same honest hours the
tip pool and the earnings screen use, so a worker and an owner are looking at the same truth from two sides. One
number, shown daily, in plain money — the difference between finding out now and finding out too late. Fifty-two
suites, all green.

### Come back, we miss you
The cheapest customer to win is the one you already had. Every shop has regulars who just… drifted — moved, got
busy, forgot — and most owners have no idea who they are, because that knowledge is buried in a year of receipts.
customPOS already remembers who bought what and when, so it can just *ask the question*: who haven't we seen in a
while? The report now grows a **win-back list** — customers whose last visit was more than thirty days ago (tune
the window), newest-lapsed first, each with the number of days since they came in. Next to each name is one
button: **📱 Invite back**, which sends them a warm note over the same texting seam the shop already uses — *"We
miss you at Rae's, come see us soon"* — and marks them invited so nobody gets pestered twice. It's not a mailing
list or a marketing suite; it's the shop's own memory, turned into a reason to reach out to the exact people most
likely to come back. In lean times, that list is money sitting in the receipts, waiting to be asked. Fifty-three
suites, all green.

### What's actually left over
Revenue is a vanity number. A shop can ring up a great day and still lose money if the stuff it sold cost too
much to make. The number that matters is what's *left* — and most small operators are flying blind on it, because
their POS only ever told them what came in, never what it cost. So customPOS let each item carry a **cost** — what
it costs *you* — right next to its price in the builder. Then the Z-report does the subtraction nobody was doing:
**cost of goods** for everything sold today, **gross profit** (sales minus that cost), and the **margin percent**,
with a plain line — *what's left to cover rent, labor, and everything else.* Sell below cost and the number goes
red and says so, because a busy day at a loss is the most dangerous kind. It only appears when items actually
carry costs, so nobody sees an empty card; opt in by filling one number per item and the truth about the day's
profit shows up on the same report you already read at close. Revenue tells you if people came; margin tells you
if you'll make it. Fifty-four suites, all green.

### Show your work
The oldest trick against hourly workers is the murky paycheck — hours you can't verify, overtime that somehow
never shows up. The clock already knew every honest hour; now the worker's portal *does the pay math out loud.*
It splits your clocked time into **regular** and **overtime**, and it prints the overtime line at **time-and-a-half
with a 1.5× badge**, so the premium you're owed is impossible to quietly skip. Add your tip share, and it totals an
**estimated gross** — right there on your own screen, from your own hours. It says plainly that it's an estimate
and your official paystub is the final word, because we're not pretending to be payroll; we're making sure you
walk in already knowing roughly what you earned, instead of hoping the number at the end matches. Same hours the
owner's labor-cost line uses — one truth, shown to both sides. When money's tight, being able to see your own pay,
overtime and all, isn't a nicety. It's leverage. Fifty-five suites, all green.

### Know your winners
Not everything on the menu earns its place. Some items sell in a blur and barely clear their cost; some move
slowly but carry the whole margin. An owner running lean needs to know which is which, and the receipts already
hold the answer. So the Z-report now ranks the day's **top items by revenue** — what actually sold, most first —
and, when items carry a cost, prints each one's **margin** right beside it. Now "Coffee — 90%" and "Muffin — 80%"
sit in plain view, and the owner can see at a glance what to feature, what to reprice, and what's quietly not
worth the shelf. It's the same honest sale-and-cost data everything else here runs on, just tilted to answer the
merchandiser's question instead of the accountant's. In a good year you can afford not to look; in a hard one,
knowing your winners is how you spend a shrinking bit of attention where it pays. Fifty-six suites, all green.

### When the rush actually hits
The labor-percent number tells an owner *if* they're overstaffed; it doesn't tell them *when.* Cut the wrong hour
and you're slammed at noon with one person on; keep everyone through a dead afternoon and payroll eats the day.
The receipts know exactly when the money comes in, so the report now draws it: **net sales by hour**, a little bar
per hour, and a plain call-out of the **busiest** one — *staff to the rush, trim the lulls.* It's the missing half
of the labor story: the percent says how much you can afford to spend on people, and the busy-hours bars say where
to spend it. Same day's sales, bucketed by the clock on each sale — no new data to enter, it was always there in
the timestamps. For a shop trying to squeeze payroll without wrecking service, seeing the shape of the day is the
difference between cutting fat and cutting muscle. Fifty-seven suites, all green.

### The breather, too
The break-rules engine already watched for the meal break a long shift owes you. But there's a smaller kindness
it was missing: the plain rest break — the four-hours-on-your-feet-without-sitting-down kind that no one clocks
but everyone needs. So now, if you've been on a stretch past the rest interval and haven't taken a break at all,
the on-shift screen nudges you: *you've been on 5 hours without a break — take a ten-minute breather.* It's the
same worker-protective default as the rest of the engine — on by sensible defaults, tunable but not silently
removable — and it steps aside the moment you actually take a break. Meal breaks keep the law; rest breaks keep
the person. A small line of code, but it says the thing the whole track has been saying: the tool notices when
you're running yourself down, and it speaks up for you. Fifty-eight suites, all green.

*— to be continued —*
