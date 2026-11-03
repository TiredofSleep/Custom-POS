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

### A door a regular person can walk through
All of this — the scheduling, the fair tips, the margin math, the safety line — is worthless if the person who
needs it can't get it set up. The builder had a fast path for someone who already knew what a "station" was, but
that's not the owner we're building for. So the builder grew a **guided setup**: a plain-language interview that
asks the five questions a real owner can actually answer. *What kind of business is this?* (pick the closest
picture). *What's it called?* *Who works here* — just you, or a team? Say "a team" and the software quietly turns
on the whole worker suite: a time clock, fair scheduling, a worker portal, a safety line — no jargon, just *on*,
because those protections should be the default, not a thing you have to know to ask for. *How do people pay?*
*How will you run it* — one computer, several, or with off-site backup? Five answers later there's a **Build my
POS** button, and out comes the same single self-contained file, configured, downloadable, yours. The expert
editor is still one click away for anyone who wants it; but now the front door is a conversation, not a control
panel — and it hands a nervous first-timer a working point-of-sale with their people already protected. That's the
whole thesis in one screen: the tools that help you survive shouldn't require an expert to switch on. Fifty-nine
suites, all green.

### Your own app, on your own phone
The worker portal was real, but it forgot you the moment you closed the tab — fine for a shared back-office
tablet, wrong for the thing it's actually meant to be: an app a worker keeps on *their own phone.* So the portal
learned to remember. Sign in with your PIN and, unless you say otherwise, it **stays signed in on that device** —
reload, come back tomorrow, it's still your schedule, your hours, your pay, no PIN dance every time. There's a
plain **"keep me signed in on this device"** checkbox, on by default because the portal is personal, and easy to
uncheck on a register everyone shares. Log out and it forgets you cleanly. It's a small persistence trick — one
key in local storage, per device — but it changes what the portal *is*: not a screen at work you borrow, but a
little window into your own working life that lives in your pocket. The worker's half of customPOS now feels like
it belongs to the worker. Sixty suites, all green.

### Say the kind thing
Every feature so far was about money and time — the hard, countable things. But the reason people stay at a hard
job for hard pay is rarely the money; it's that someone noticed. Recognition costs nothing and it's the first
thing to vanish when everyone's stretched thin. So customPOS grew **shout-outs**. On your portal there's a little
box: pick a teammate, say something kind, send it with a ⭐. It lands on *their* portal — "⭐ Alex: great save on
the rush" — and, the next morning, it greets them the moment they clock in, tucked in with the day's specials.
No manager approval, no points, no leaderboard to game; just a person telling another person they did well, and
the software making sure it's *seen*. It rides the same synced data as everything else, so a kind word typed on
one device reaches its person on any other. It's the smallest feature in the whole build and maybe the truest to
why we're building it: a point-of-sale that treats the people behind the counter like people. Sixty-one suites,
all green.

### How today went, in one line
Over a dozen increments, the owner's report grew rich — sales, margin, labor percent, top items, busy hours. All
true, all useful, and all a little much to read when you're closing up exhausted at the end of a hard day. So the
report learned to *lead with the answer.* Right at the top, before all the detail, one plain line: **"Solid day.
$420 in · 68% margin · labor 27% of sales."** — or, when something's off, **"Worth a look — labor is running
high, margins are thin,"** with the bar down the side turning from green to amber. It's not new data; it's the
numbers already there, read the way a trusted bookkeeper would read them back to you: the verdict first, the
detail underneath if you want it. A stressed owner glancing at their phone after close gets the one thing they
actually need to know — *are we okay?* — in a sentence, and only digs deeper on the days the sentence says to.
Everything we measured now rolls up into the question all of it was for. Sixty-two suites, all green.

### A little good, at the register
Small shops survive on being part of a place — the regulars, the little league sponsorship, the jar by the till.
So customPOS got a **round up for charity** option. Turn it on for a cause — "the food bank" — and at checkout the
customer's $4.25 total comes with a gentle offer: *round up to $5.00, +$0.75 for the food bank?* One tap and the
seventy-five cents joins the order; the end-of-day report tallies it in a **Community ♥** line — *rounded up $18
for the food bank today — set it aside to donate.* No middleman skims it, no platform takes a cut; the shop
collects it and gives it, plainly. It's optional, off unless a shop chooses it, and it turns the moment of paying
— usually the coldest part of a transaction — into a tiny act of neighborliness. A point-of-sale that helps a
small business survive should also help it be the kind of place worth surviving for. Sixty-three suites, all green.

## 2026-07-08 — Launch day: custompos.org goes live, and learns to be found

### The last hundred feet
The site had been built for days — landing page, builder, engine, all green in CI, quietly served from a github.io address. But a project isn't real until it lives at its own name. custompos.org was registered and pointed at a host's placeholder — "Awesome Site in The Making" — and the last hundred feet was DNS: tell the domain to serve the GitHub build instead of the placeholder.

That last stretch is exactly where an earlier, remote session had to stop — it could write every file and every instruction but couldn't reach into a browser to change DNS. This time the assistant ran locally, with the browser in reach. And it *still* couldn't finish the DNS by itself: a hard safety rail refused to overwrite an existing DNS record on an account that also carried a live business's email. Which is precisely right — you do not want an automated hand near the records your email depends on. So the division of labor became the honest one: the assistant opened the exact editor, showed the current records, confirmed there was nothing to harm (the mail records were left untouched), and the owner made the two edits by hand — the apex and www, repointed to GitHub. Minutes later the domain answered with the real site over a valid certificate. The only thing still showing the placeholder was the owner's own browser, clinging to a cached address the rest of the internet had already forgotten.

### Found by the world
Live is not the same as findable, and a free POS builder nobody can find helps no one. So the landing page grew a full head of meta: a title and description written for how people actually search ("free POS builder for any business"), Open Graph and Twitter cards with a generated 1200×630 share image so a pasted link unfurls into something real, and — the part search engines actually chew on — structured data: the software marked explicitly free, price zero, MIT-licensed; the page's FAQ marked up so the answers can surface directly in results. A robots.txt and a sitemap so crawlers know where to look.

Then the bigger bet. A business that's searching isn't looking for "POS builder" — it's looking for "restaurant POS," "salon POS," "dry cleaner POS." So each trade got its own front door: a real page tuned to that search, speaking that trade's language, linking straight into the builder pre-loaded with that trade's template. Six of them, generated from one small data file so a seventh is a five-minute edit. The generic promise, made specific enough to be found.

### A blank slate
And one small thing that matters more than its size: not every business fits a template. So the builder learned to start from nothing — "Start from scratch," an empty catalog and a bare register, for the shop that wants to build its own from the first item up. The templates are the fast path; the blank slate is the promise that the fast path was never the only one.

The doors are open, the sign is lit, and the map now points here from a dozen directions.

## 2026-07-08 — Proving the promise: a whole plant, built from generalized parts

The claim underneath customPOS is a bold one: that a single small business's real software, broken into general
parts, can rebuild *itself* for anyone — no per-trade code, just configuration. It was time to prove it on the
hardest case we had — the origin app itself: a two-store wet cleaner with per-garment tracking, a plant that
assembles the other store's orders, a pickup-and-delivery route, and an owner-approval gate on refunds. Could
the generalized engine be configured back into *that*, from a blank slate?

A two-sided audit said yes — but only with new engine **primitives**, not more template data. So we built them,
one verified increment at a time, and the discipline that kept them honest was a single rule: **every capability
is a setting, not a code path for one trade.** If a feature only made sense for a cleaner, it was the wrong
feature.

The reframe that unlocked the hardest one came from the owner. Garment tracking — the "HSL" tag that follows a
shirt through cleaning — *sounds* trade-specific. He said: *"HSL tracking is just unique inventory with stops
before it sells."* That's it exactly. A tracked garment is a **serialized unit**: one item, its own durable tag,
moving through stops before it's fulfilled. Mark any catalog item `serialized` and it becomes that — a jeweler's
serial, a repair shop's IMEI, a rental's asset tag. The cleaner's magic turned out to be everyone's.

The rest followed the same shape. **Multi-store**: a `stores` list turns any shop into a plant-and-drop network,
orders stamped with the store that owns them, drop-store orders reading "assembled at the plant." **Smart
assembly**: bag-splitting that keeps comforters alone and spreads the thick pieces, plus an in/out
reconciliation gate that won't release an order until every piece is counted back out. **Drop now, detail
later**: count the bags at the counter, itemize them at the bench — a cleaner's rush-hour trick that's also a
repair shop taking in a device before it quotes. **Printing** that routes each tag and label by the *order's*
store, never the workstation. A **delivery route** whose "picked up" opens an uncounted order and whose
"delivered" closes the ready ones. And a **money-gate**: refunds that need a manager's PIN and land in an audit
log — the owner's own anti-theft rule, generalized to "some actions need approval."

None of it is a cleaner feature. All of it is a switch. To prove that isn't just a nice story, the last thing
built was a template that flips every switch at once — "Full-plant cleaner + route" — and a test that walks one
order all the way through it from that config alone: two serialized shirts into a drop store, bagged and
reconciled and tagged at assembly with the tags routed to the right store, racked, marked ready behind a
customer tracker that says "assembled at Main Plant" and nothing it shouldn't, then delivered on the route. One
order, every primitive, zero console errors. A whole plant, standing up from a config file.

The point was never the cleaner. The point was that the cleaner was never special — and now there's a test that
proves it.

*— to be continued —*

## 2026-10-10 — Not retired: the real one, in one file

### The shop moved on; the software didn't have to
On the last night of September, the wet cleaner this whole project grew out of switched to its successor — a newer
system built for several computers sharing one shop. The old version, one HTML file that had run two stores, a plant
and a van since June, was frozen that night. The tidy thing would have been to retire it. The owner said the opposite:
*"custom pos needs to have v1 as a standalone 'single pc POS' file... not fully retired."* He was right. Most shops
aren't two stores and a van. A one-counter cleaner doesn't need a server humming in a data centre; it needs the
counter to work. So the frozen v1 became the **Single-PC Edition**: download one file, double-click it, run a shop
on one computer.

### Switching the server off — honestly
Making it run without a server was the easy half. The hard half was making sure it never *pretends* to have one.
v1 decided whether to sync by asking "was I loaded over the web?" — and on custompos.org the answer is yes, so a
hosted copy would have reached for the shop's sync API on our own site. Now one flag tells the app's own checks it is
alone, and a guard at the very top refuses every road out — fetch, XHR, sockets, beacons, service workers — before the
app runs. Everything that needs a server (texting, emailed statements, a connected card reader, pay links, the
customer tracker, photos, QuickBooks) is hidden and named, not left to fail. Texting starts **off**, so a drop-off
can never say "Text sent" when nothing was sent. That is the oldest rule the origin shop learned: *an error must never
render as good news.*

Two calls worth writing down. **Cards:** v1 had deliberately removed hand-keyed card entry — at a shop with a
connected terminal, it was a theft risk. On one computer the stand-alone terminal is the only reader there is, so the
POS asks for the approval code the terminal printed; no code, no payment, and "declined" records nothing.
**Restore:** v1 never had a "load a backup" button, because its server held the copies. Building one in a hurry is
how data gets eaten, so instead the limit is stated plainly in the app, the read-me and the landing page: full backup
to one file, yes; one-click restore, not yet.

### Whose data is in it: nobody's
It starts with no customers, three sample staff, placeholder store details and a sample price book. The readable
reference copy of the app was refreshed to this final v1 at the same time, and before any of it was allowed near this
public repo it was checked again — not just against the exporter's list of known names, but against the shop's own
records: every customer and staff name, phone number, house-number-and-street and payment reference, compared with
everything about to be published. Whatever that turned up went into the exporter itself, so it is replaced at the
source on every build rather than patched by hand in one copy, and the gates were re-run on the result: 2,608 money
assertions, 0 failed. The lesson is the one the origin codebase keeps teaching: *measure before you narrate.* "The
scan passed" is a claim about the scan.

### Proving "zero network"
A promise like "this file never talks to a server" is only worth the test behind it. `tests/single-pc.js` opens the
file from disk and records every request: the only one is the file itself. Then it serves the folder over http, the
way custompos.org does, and the server writes down every hit: exactly one, the page. To make sure the test could
fail, it was pointed at the multi-computer copy of the same app, served the same way — and within four seconds that
one asked for the database, the payment status, a key rotation, an activity trail, a crash report, a script and its
logo images. Same code, one flag,
opposite result. A test that cannot fail is not evidence; this one fails on exactly the thing it guards.

### Getting found
The edition got its own front door, `single-pc.html`, aimed at the search a small cleaner actually types — *free
offline dry cleaner POS* — with the usual honest metadata and structured data, including FAQ markup that a test
holds to the visible FAQ word for word (search engines read one, people read the other; they should never disagree).
It's linked from the home page, the dry-cleaner page and every trade page. One small trap found on the way: the site
is assembled file by file by the Pages workflow, so a new page that isn't on its copy list would sit in the repo and
404 on the live site. It's on the list now.

What's next is the other half of the owner's sentence: the shop's newer system, brought here as a **modular**
multi-station edition — the server-backed pieces as parts you switch on. The single file is the floor; that will be
the ceiling. All 103 suites green.

### The plan for the ceiling
The modular edition has a written plan now, [docs/V2-MODULAR-IMPORT.md](docs/V2-MODULAR-IMPORT.md), and the first decision in it is what *not* to do: copy the shop's newer system in whole. It is full of one shop's rules and money history. Instead its engine — every device writes small permanent notes, one hub keeps the official copy, every screen is worked out from the notes — comes in first, behind the same kind of scrubber that guards this release, and then each ability is rebuilt as a module that brings its own screens, rules and tests, with the shop's working code as the answer key. The first module planned is the time clock, because it fixes a real gap here: a clock-in made on one tablet never reaches the others today.

## 2026-10-12 — Built with Claude: putting the real method on the front page

### The part the site wasn't saying
The owner looked at the site and said it plainly: customPOS *"is not highlighting claude enough for building it and being
able to customize it based on prompts"*, and it needed *"a spotlight on the page about how this works, and how we are
editing a live shop with customizations every day."* He was right. The site mentioned Claude Code twice, in a FAQ answer and
a step card, as if it were a footnote. In the shop this project came from, it is the method: the owner says what he wants
at the counter, Claude Code changes the live system, a proof named after his words is written, and the build goes live
only if every proof passes on the server.

### Measure before you narrate
The first rule was that every claim on the page had to be traceable to a file or the git history, so the numbers were
counted before a word was written, all of it read-only against the shop's private repositories. Since the switch to the
shop's multi-station system on the night of September 30: 94 commits to the live system from Oct 1 to Oct 12, on 9 of the 12
days (13 on Oct 12 alone); 1,226 proofs passing on Oct 12, up 147 since the build that went live the morning of Oct 1; at
least 48 builds named live in the desk logs; at least 6 deploys the server refused. Across the whole history, 2,082 of 2,128 commits carry a Claude co-author
line. Each figure is dated, because they grow most days.

Counting turned up two traps. Git reads a bare date like *2026-10-01* as "that date at the current time of day", so a
late-evening count first showed one commit on Oct 1 instead of 36; the counts were re-run from midnight. And the honest
version of the owner's "every day" is "9 of the 12 days": three days were quiet, and the page says which. The "live"
label on each example was checked too, by asking git whether that commit sits inside a build the logs call live, not by
assuming.

### Real words, no names
The heart of the page is a wall of real requests in the owner's own words (typos kept) beside what changed and when: the
double Rush charge, the card-on-file button, asking which store a customer will pick up at, the $1 drawer-alert rule, a
frozen card reader, a Happy Bag change that was written, held back because the records showed a person and his company
account, and re-done after Claude asked. The sources are full of customer and staff names, ticket and tag numbers, and the
shop's server details, so every quote was taken from a cleaned list with brackets where a name was, and nothing was copied
from a raw commit message. A new test, `tests/claude-spotlight.js`, guards the page against phone-shaped numbers, e-mails,
ticket-, tag- and IP-shaped numbers and a list of private words. One slip was caught on the way: the guard's own
negative control had been given a ticket number seen while fact-checking. It was swapped for an obviously fake one before
anything was committed. The lesson is the usual one, aimed at ourselves: the guard is only as clean as its test data.

### Saying the limits out loud
A page about letting an AI touch a live business is only believable if it says where that goes wrong, so the limits are
on it with dates: a "dry run" that actually sent its changes, a build that went live at 4:26 PM instead of 7 PM because of
a time-zone trap, a customer merge stopped only by its dry run. It also says that the 7 PM rule is a discipline rather than
a lock, that AI usage costs money, that the shop's own code is private, and that the multi-station system it runs is not in
customPOS yet. It says once, plainly, that Claude is made by Anthropic and customPOS is independent and not affiliated
with Anthropic. No logos were used.

### Wiring
The page is `built-with-claude.html`, with a spotlight band right under the home page's hero carrying three real requests
and the four headline numbers. It is in the sitemap, linked from the home page's nav and footer, from single-pc.html, and
from every trade page through the generator, and it is on the Pages workflow's copy list, since a page left off that list
sits in the repo and 404s live. The test checks that too. Along the way the home page's header, which wrapped onto two
lines on a phone, was put back on one. 104 suites.

### What the second look caught
Before anything was pushed, three separate checks read the page again: one re-counted every claim against the shop's
repositories, one looked for anything private, and one looked at it on screens from 320px to 1440px. They found real
problems, and they are worth writing down:

- **Words that went past the record.** "43 of the 50 sections" was 43 of 50 *headings*; the proof file actually gained 91
  sections. "1,079 at the first deploy after the switch" was wrong: an earlier build was already live by 7:45 that morning,
  so it now says "the build that went live the morning of Oct 1". "19 carry his words in the title" was really 19 that
  *name* him there and 5 that quote him. The section label "Every day, live" said what the owner hoped, not what the
  record shows (9 of 12 days). The $1 drawer-alert card said the morning count was left alone until he asked; the morning
  alert was in the first change, and what Claude asked about was the morning count's on-screen flag and the theft watch.
  "The owner asked Claude to compare prices" could not be traced; "Claude compared the prices" can. "One session at a
  time" was wrong too: each desk has its own session, and the rule is that each one works alone by default.
- **A hash is not a hiding place.** The guard had kept the words that would point at the shop's server as SHA-256 hashes,
  and the first draft of this entry said that meant the public file named none of them. A hash of a short word is reversed by guessing
  in milliseconds, so in effect it did name them. The hashes are gone, and they never reached a pushed commit: the
  unpushed commit that carried them was replaced rather than patched, because a fix on top would still have published
  them. The public test now lists only words that are already public; any private words live in a git-ignored local
  file that the guard reads when it is there. The IP-shaped check still catches any hostname built from an address.
- **Seen, but not seen.** The request-to-change animation ran in the first four seconds, below the fold on most screens,
  so it was over before anyone scrolled to it. It now starts when it scrolls into view (and a reader who asks for less
  motion still gets every line at once). Several light-theme colors were under the contrast a reader needs, the home
  page's focus ring had got weaker than the browser's own, and single cards were stranded on their own rows at tablet
  width. All fixed, and the home band's "since the switch", which the home page never explains, now says "Oct 1–12".

The counts themselves held up. What was wrong was what some of them were said to mean, which is the part a reader can't
check.

## 2026-10-13 — Auction fee math: the first piece for an auction customer

### Why the math comes first
The multi-station edition has its first real customer: an auction company that runs live and online sales and settles
them on paper today. The plan for them starts with the money math rather than the engine or the screens. That is the
one place where a mistake costs a consignor real money. It needs no hub, and it can be right before the customer has
answered a single question. Every answer they give later (which commission basis, whether the premium is taxed, what a
lot fee covers) becomes a setting, not a rewrite.

So the first piece is a library, `packs/auction/feemath.js`. It works out a consignor's commission and fees, a buyer's
premium and tax, the buyer's invoice and the consignor's statement, and nothing else. It stores nothing and moves
nothing. Every result carries its working as plain text ("$100.00 x 30.00% + $10.00 x 20.00% = $32.00"), so a person
can check any number against a calculator.

### Ten dollars on a $110 lot
The plan picked one example to anchor everything. Take the rates "30% up to $100, 20% above" and a lot that sells for
$110. Read *sliding*, the whole $110 sits in the upper bracket: $22.00. Read *incremental*, the first $100 pays 30% and
the last $10 pays 20%: $32.00. Same words, a $10 argument with a consignor. The library makes the schedule say which one
it means, and the first proof pins both answers.

The same idea runs all the way through. Money is whole cents. Rates are whole basis points. Rounding is half up and
happens once, at the level the rule names. Anything the math cannot compute exactly is refused with the field's name
instead of being fixed up: a fraction of a cent, a number written as text, an amount over the $10,000,000 ceiling, a
misspelt field, a tax class with no rule. A misspelt `capcents` would otherwise drop the cap without a word, so a typo
is refused like any other bad input.

### Writing the choices down
Some rules had more than one fair reading. Each time the library takes the cautious one, says so in the code and the
pack's README, and makes it a setting where the customer may decide otherwise. A lot fee is charged on sold lots unless
the schedule says every lot offered. An exemption certificate on its expiry day counts as expired. A certificate with
no expiry date does not count, a premium with two tiers must say which kind it is, and phone bids pay the floor
premium. The biggest choice is the paid rule. A consignor is paid for a line only when that buyer's *whole* invoice
for the sale is paid. A buyer who has paid more than this lot's price but still owes on the invoice has not paid for it
yet. Splitting payments line by line can come later. Guessing at it now could pay a consignor money the house never
collected.

### Proofs that can fail
Each of the 17 proofs names the failure it prevents and has negative controls. A control is a copy of the library
with one rule deliberately broken, such as the half-up rounding, the minimum, the certificate expiry, or the line in
the paid rule. The proof has to fail on that copy. 70 broken copies, each one seen failing. Each break has to land on
text that appears exactly once in the source, so a later edit cannot quietly turn a control into a no-op. Each broken
copy also has to still do plain arithmetic, so it fails for the rule and not because it crashed.

That second look found two weak controls. The proofs for "a premium with two tiers must name its kind" and "nothing over
the ceiling" did fail on their broken copies, but only because a second guard caught the same input under another field's
name. The money was still safe, but the control proved less than it claimed. Now the first broken copy really guesses a
kind, and the refusal proof reports every case a broken copy lets through, not just the first.

The plan suggested pinning a software vendor's published worked example as well. It isn't pinned, because nobody has
yet checked that the example states all of its inputs, and a number with half its inputs missing proves nothing. Every
figure in the proofs is worked by hand in the test's comments instead. 105 suites.

## 2026-10-13 — Auction fee math, second look: what three checkers found

### Three ways of checking the same math
After the first version of the auction fee math, three separate checks went over it. One built an independent reference
version of the same rules from the plan alone, without reading the library. One fed both versions hundreds of thousands
of random sales and compared every number. One read the code looking for ways to lose money. None of them found a
consignor or buyer charged a wrong cent. They did find places where the house could pay out money it had never
collected, rules nobody had pinned with a proof, and a few inputs that could mean two things.

### Paying out money that never came in
The biggest find was in the holdback. When a buyer hasn't paid, the consignor's line waits, and commission is charged on
every sold line so the release is exact once the buyer pays. But some held lines never clear: a hammer gets voided, a lot
comes back unsold. Then the consignor is owed commission and fees on what is left, and that can be *more* than what was
taken. With a sliding rate that falls as the total rises, a consignor who sold $1,000.00 that cleared and $0.01 that didn't
would have been paid $100.00 too much. A no-sale fee larger than the lot fee, or a per-item minimum, does the same thing
on a smaller scale. The statement now holds back that difference as well, worked out over every way the held lines could
end. A proof re-runs each example statement for every one of those endings, by brute force, and checks the net paid now
is never above the worst of them.

The second find was write-offs. A buyer who paid $600 of a $1,100 invoice and had the rest written off is at a $0.00
balance, so the old rule called the consignor's $1,000 lot paid, though the house had received $600. Forgiveness is not
payment now: each statement line also carries how much of the buyer's invoice was written off or waived, and the line
waits. If an auction company wants forgiveness to count as paid, that is a contract setting, and it's one of the
questions for them. A write-off can also no longer be bigger than what is owed, because past $0.00 it would turn into a
refund claim, and a refund is a person's decision.

### Proofs that hadn't been pinned
The review broke one rule at a time in copies of the library and ran the whole suite against each copy. Seven broken
copies passed. One charged a buyer an uncapped premium when the invoice rounds once, one rounded the taxed premium twice,
one truncated a half-cent buyback fee, one charged a no-sale fee per choice taking instead of per lot, and one allowed a
refund on a voided payment. The code was right on every one of those paths. Nothing *proved* it. Each now has a
hand-worked proof, and the copy that slipped through is its negative control. There are 24 proofs now, with 104 broken
copies, each seen failing.

### Inputs that could mean two things
A cap of $0.00 used to zero every commission without a word, which is what a form writing 0 for "no cap" would do. It is
refused now, and so is a titled no-sale fee of $0.00 (did it mean "not set" or "free"?). A rate fee on a buyback with no
price is refused instead of charged as nothing. A quantity limit of 1,000,000 that nobody had written down is gone: the
plan sets none, so quantities go up to 1,000,000,000 and the $10,000,000.00 money ceiling does the real work. Lot numbers
with stray spaces, or two spellings that print the same, are refused. So is a statement where one buyer's lines disagree
about that buyer's balance.

### What stays a question
Where the plan leaves a choice, the cautious answer is the default and a setting changes it: whether forgiveness counts as
paid, whether a certificate is good on its expiry day, whether one with no expiry counts, and whether the lot fee covers
unsold lots. The pack's README lists them as questions for the auction company. The comparison run still shows
differences between the two versions, and every one of them traces back to one of those written-down readings. The
independent version had two small gaps of its own, a date it didn't check and a number type it accepted, and those were
fixed in it as well. 105 suites.

## 2026-10-31 — v2 comes in: the exporter, the engine, a small hub

The owner said it plainly today: v2 is to be the face of Custom POS. v2 is the origin shop's second system, the one where every
tablet writes down what happened as a permanent fact, and one small hub keeps the official copy. Until today, that sentence in
our roadmap had a gate in front of it. Nothing of the shop's code could come here until a scrubber existed that refuses to run
while anything real survives. So the day started on the private side.

### A scrubber that has to prove it can say no
The exporter lives in the shop's private repo and never ships itself. It copies an allowlist of the engine, about 400 KB with its
laws, into a folder outside every repository, and maps the shop's brand out of identifiers. Its prose maps are explicit,
each with the number of times it must match, so a file that changed upstream refuses instead of half-scrubbing. Then it scans
for what must never leave: names, phones, e-mails, addresses, server details, the shop's towns, secrets.

The name check is the interesting part. The shop's customer list cannot come here. A private list of salted hashes, made from a
quiet copy of the shop's data, lets the exporter recognise every customer's and employee's name, phone and e-mail without
holding any of them in plain text. Even so, a hash of a phone number reverses by guessing, so that file is treated exactly like
the plain list. It never enters a repo, and never a synced folder.

The first version passed its own self-test, and then two reviewers were given the code and told to break it. They found 22
holes, and they reproduced every one in a sandbox:
- A customer written the way the shop stores one, `{ first: 'A', last: 'B' }`, got past the scan. So did a name inside
  `camelCase`.
- So did a phone with a +1 in front.
- Handed the wrong folder, it would have deleted it.
- A missing name list switched the name check off without a word.
- The self-test still passed with several detectors weakened.

All 22 are fixed. The self-test now gives each of its 48 detectors a sample that only that detector catches, and requires it to
be refused with the detector on and to pass with it off. Then, as its own negative control, eight deliberate weakenings were run
against it in throwaway copies. Two survived at first. Their samples were sharpened until all eight failed it. A test that cannot
fail is not evidence, and that includes the test of the tests.

### The laws run inside the export
A scrubbed engine that no longer works is not a distribution. The exporter runs the engine's own laws inside its output: 114
proofs, under a trace that records every file each one loads. Every load has to stay inside the export, and every engine file has
to be loaded by some proof. The one exception is written down by name: the HTTP transport, whose proofs need a server, which is
today's other job. To show the laws can fail, a copy whose log accepts the same fact twice has to fail them. The first attempt at
that copy didn't fail, because a second guard caught the duplicate, so both guards come out in the control.

### What came in here
`facts/` holds the engine, imported by `tools/import-facts.js`. It takes only the files the export's manifest names, checks each
one's SHA-256, and records them in `facts/PROVENANCE.json`. A hand edit to an imported file fails the suite. The rule is to change
it upstream and export again, so the record of where this code came from stays true.

Three files are our own. `facts/server.js` is the hub on HTTP and nothing else: enrol a device, take its facts, hand out what's
new, say it's alive. The shop's server is many times larger, with its cards, texts and e-mail behind it, and none of that belongs
here. `facts/bundle.js` puts the engine in one file for a browser and refuses to build if anything asks for a module it can't
serve. `tests/public-refusal.js` scans every module for phones, e-mails, IPs, server paths, personal folders, the shop's brand and
secret shapes, and plants one sample of each to prove it can.

The proofs that matter most for a business run over real HTTP:
- an unenrolled device lands nothing, and is told why;
- a retry after a lost answer lands once;
- a hub that is down means "not yet," never "lost";
- a disk that refuses a write makes the hub refuse to acknowledge, so a tablet is never told a fact is safe before it is.

### A second look, as a stranger would read it
Before the first push, two more reviewers read everything as the public will. Between them they found 25 things.

The ones that mattered most were quiet. The small hub was dropping one field of every pull: the field that lets the engine notice a hub restored from an older backup. Without it, a tablet that had read past the restore point would simply never see what was written after it, with no alert. The engine was right; our wrapper had thrown its evidence away. Other things the reviewers found:
- The health check said "ok" while the disk refused every write.
- A revoke that could not be saved answered "ok", while the lost tablet kept its access.
- A refused sender could keep streaming a body for a minute.
- One check could be fooled by letter case on Windows.
- Several tests would still have passed with the thing they test broken.

All of that is fixed now, and each fix has a proof that fails without it.

The reviewers also caught two words that would have been published for the first time: the private name of a scripting identity, and the hosting service in our own scanner's pattern. Fixing those in a later commit would not do, because a pushed history publishes every commit. So the commits were rebuilt before anything left the machine. The private exporter now reads a private word list as well, so that class is refused at the source next time.

### Not yet
The builder doesn't emit a facts-mode download yet. That comes with the first module, the time clock, in Stage 2. Nothing here
is published until the owner says so.

## 2026-10-31 (night) — Stage 2: the time clock, shared

Stage 1 put the engine in the repo. Stage 2 put it in front of someone: the time clock, which until tonight lived on one device.
A clock-in on the counter's tablet never reached the back room, because `DB.punches` was the one collection the hub never synced.

### Who may write what
The first piece was the module contract. A module names each kind of fact it owns, and for each one says who may write it: anyone,
only the person it is about, that person or someone holding a named right, an owner, or the hub alone. It can also ask that the
hub check a PIN itself. Modules are put together into one judge that the hub runs on every fact, so a rule is the hub's, not each
tablet's.

The tests for this all have the same shape. Each fact the rules refuse is sent once to a hub with the rules and once to a hub
without them. It must land on the second, which shows the refusal came from the rule and not from a broken wire.

### A PIN the hub checks
The hard question was the stolen tablet. Every fact carries the name of the person who made it, but that name is whatever the
tablet put there. So the facts that matter (fixing a shift, voiding one, changing who works here) need a PIN the hub checks itself.
The tablet sends the PIN once, the hub checks it against that person's hash, and it hands back a pass. The pass is signed, lasts 30
minutes, and is good for that one person on that one tablet. Five wrong tries lock that pair for a while.

Clocking in and out are deliberately *not* behind the pass. Nobody should be kept off the clock because the internet is down.

### Rebuilt, not copied
The time clock module adopts the engine's clock facts and their fold, which works out which clock-out closes which shift, keeps
orphans visible, and never lets a guess outrank a punch. It adds what Custom POS already had: unpaid breaks, and the wage at punch
time.

Then it rebuilds `DB.punches`, in exactly the shape the app always had, from the facts. So the tip pool, labor cost, pay estimate
and reports read shared punches without a line of them changing. A test gives both versions the same punches and checks the numbers
come out the same.

A saved history from this first version is now part of the suite, and every later version must still read it the same way. The
history found a bug on its first run. A shift a manager adds by hand carries no wage, and it came out as $0, which the labor-cost
code would have counted as free. It reads as "no wage recorded" now, so the person's own wage applies, as it always did.

### In a browser
The last piece was the app itself. In facts mode each device keeps its own log in the browser and sends it to the hub. The first
device brings the team over from setup: the owner first, then everyone else under the owner's PIN, checked by the hub. Only hashes
ever leave the page.

The proof is two browser tablets and one real hub. Alex clocks in on one, appears on the other, takes a break there and clocks out
there, and the first tablet sees the shift closed. The same steps in the old mode, as the negative control, show the second tablet
never hears of it.

The builder's *Several computers* now produces such a download. Its test found that a download with the engine inside was broken:
JavaScript's string `replace` reads `$&` in a replacement as a code, and the engine's own source has one. It is a one-word fix
(a replacer function), and every *several stations* download would have been broken without it.

### A third review, before it went public
Three code-running reviewers tried to break Stage 2 before it was published. They found 27 things. All were taken, and each fix has a
test that failed before it. The serious ones:

- **The hub as the docs start it ran no rules.** Every test had built the hub inside the test, with its modules. The documented
  command built it without them, so a clerk could have corrected their own hours. A new test now starts the hub exactly as a shop
  would, as its own process.
- **With `--with-blob` the hub served its own folder**, so its database and the key that signs PIN passes were one request away. It
  now serves only the app's own pages, and it refuses to start with its data inside the folder it serves.
- **A several-stations download carried every PIN**, and the hub hands that file to anyone on its network. The download now carries
  none. Each PIN is typed on a tablet when the team joins the hub and leaves it only as a hash. Every PIN screen checks the hub's
  hashes, including money approvals and a worker's own screen.
- **A reload left the tablet read-only** while the screen still said "Welcome". The old page now lets go when it closes.
- **A mistyped device name went unnoticed** until every punch came back refused. The engine reads a device's name from its token
  alone, so our own front door now checks the name a device gives against its token. Connect sends an empty bundle to ask.
- **A staff name could run as HTML** on every tablet, and connecting wiped a tablet's earlier punches. Names are drawn as text now,
  and earlier punches are kept beside the shared ones.

The browser test now plays a fuller day. It covers a wrong name at Connect, a reload, the hub going away and coming back, a hire
added later under a manager's PIN, and a name full of HTML. The gate is also stricter. Before, the same punches were fed to both
modes. Now blob mode's own clock runs the same actions at the same moments under a fixed browser clock, and every shift time must
match. The negative control now goes through a real hub that does carry records, so "the punch never arrived" cannot be blamed on
a dead hub.

### A skeptic pass, and a pause
Before pushing, a second set of reviewers checked the fixes themselves: three skeptics, each followed by a verifier. Of 21 findings,
19 held up and 2 were refuted. **The paragraph above is wrong in one claim.** Several fixes had no test that failed before them
(finding 2.5 below).

The one that mattered most was already public: **the published `hub.js` died on a single bad GET**, a malformed `%` escape or a NUL
in a path. Its folder check also served files from a neighbouring folder whose name merely began like its own. That fix went out
alone, with a test that runs a copy of the hub as its own process, so a crash shows as a dead process. Nine of that test's 13 checks
fail on the old hub.

Then the owner looked at the shape of the work and said: *"seems like you are hand building every module instead of planning a
modular system."* He was right about half of it:
- **The hub side is modular.** A module declares its facts, who may write them, and its rules, and the hub builds one judge from them.
- **The app side was not.** The shared time clock was about 190 lines wired into `pos.html` by hand, plus 14 places that asked "are
  we in facts mode?". Nearly every app-side finding in the last two reviews came from that glue. Each next module would have needed
  another chunk like it, and we would have found the same bugs again.

So Stage 2's app half is held back, unpublished. Three designers wrote competing designs for the app side, and a judge scored them
against the code and merged them. The result is Part 3b of [the plan](docs/V2-MODULAR-IMPORT.md):
- a module file gains an `app` part: the collections it rebuilds, the stations it serves, and named commands;
- one runtime in the bundle does connect, status, people and PINs, the pull loop, rebuilding, redrawing and refusals, for every module;
- `pos.html` chooses its storage once and writes through one `act()`;
- one conformance kit every module must pass.

The time clock is rebuilt on it before any of Stage 2 is published.

The findings, by number (Part 3b refers to them):

| # | Finding | Where it went |
|---|---|---|
| 0.1 | `hub.js` killed by one GET (`%E0%A4%A`, `%00`) | fixed and published alone |
| 0.2 | a device name with a space: Connect takes it, every break on its shifts is refused | Part 3b: one id grammar |
| 0.4 | `role: null` on the last owner slipped past the last-owner rule | fixed |
| 0.5 | the "data outside the served folder" check fooled by a folder named `..x` | fixed |
| 0.6 | the hub-in-one could not serve record images | fixed |
| 1.0 | a manager-approved refund in facts mode logged, but the order stayed paid | Part 3b: gather, then change by id |
| 1.1 | a punch open from before the hub stayed open forever | Part 3b: closed at the switch, and the list is shown |
| 1.2 | staff names still ran as HTML in the Office report | Part 3b rollout, step 1 |
| 1.3 | the 3-second sync redraw wiped what someone was typing | Part 3b: one redraw path, never over typing |
| 1.4 | the refusal from 0.2 was never shown | Part 3b: refusals shown on every screen |
| 1.5 | a refused team add said "is on the hub" | Part 3b: checked before, waits for the hub |
| 1.6 | a read-only second tab saved its frozen punches over the real ones | Part 3b: rebuilt views are never saved |
| 1.7 | a double tap on Connect locked the tablet for 30 s | Part 3b: one connect at a time |
| 1.8 | the "Checking…" message stayed after a PIN was accepted | Part 3b: cleared every time, error or not |
| 2.0 | the builder's banner fix had no test | open |
| 2.1 | the bound on PIN passes had no test | fixed: counted, not timed |
| 2.2 | the cap of breaks at clock-out had no test | Part 3b: a module law the kit proves |
| 2.3 | the two `hub.js` fixes had no test | fixed with 0.1 |
| 2.4 | "redraw only on a change" and the refusal status line had no test | Part 3b: kit checks B3, B4 |
| 2.5 | "every fix has a test that failed before it" was not true | corrected here |
| 2.6 | the *Several computers* note gave a command only that machine could reach | open |

Refuted: a clerk putting a break on a coworker's shift, and a future-dated break. Neither gets around anything. Punches carry no PIN
by design, and that trust is the same in blob mode.

### Built like the shop, not beside it
The owner read the panel's design and asked: *"i thought this was all organized and modeled around the POS i have running at my
shop... ?"* Only the engine was. The panel had read this repo and nothing else. The shop's own tablet app had solved the same
problem, and has run its answer every day since the 9/30 switch:
- one door for every change;
- screens that read folds;
- each function a kit with an adapter;
- a redraw only when a fact arrives;
- a PIN the hub checks.

The panel's design rebuilt most of that under new names.

Rebuilding had already cost a bug. Finding 0.4, a `role: null` that got past the last-owner rule, was in this repo's rebuilt staff
module. The shop's staff fold never had it: there, a null role leaves the role as it was.

Then the owner set the rule: *"the point is for all the systems to grow stronger together... and to be sure that what i am sharing
with people is functional because i use it daily."* So Part 3b of [the plan](docs/V2-MODULAR-IMPORT.md) is rewritten:
- where the two systems overlap, they share one copy;
- generic code the shop runs comes here through the exporter, unedited;
- code tangled with the shop's own rules is untangled in the shop's v2 first, then exported;
- a fix to a shared file goes into v2 first.

The rebuilt staff and PIN files will be replaced by the shop's own. The time clock becomes a kit, the way the shop runs its
functions. The shop answers four of the first version's five open questions itself. The "Where it went" column above is that first
version's; Part 3b section 5 has the answers now.

## 2026-11-01 — The shop's own staff files, in place of ours

The origin shop did its half first. In its v2, and live at its two stores by 9 AM:
- the code every screen shares moved out of its 7,110-line tablet page, into `station/views.js` and `station/record.js`;
- its staff rules were untangled from its prices: the discount helpers went to their own file;
- the list of abilities became the business's own file, `core/abilities.js`;
- its private exporter learned to ship those files, and to refuse any file that is not the build the shop is running.

The owner's words for what this is for: *"we are trying to build a modular system so nobody has to spend the money to do this work
again... copy, paste, customize."*

### What came in

One export of the shop's live build (873dc0ea): 28 files. Each of the shop's proofs runs here at exactly the count that passed
upstream: the engine laws (114), then the shared files' own suite sections (4, 5 and 3). The engine files were already here and came
back byte for byte. Nine are new: six files, and the three proofs that came with them (994 to 996). The six:
- the staff fold and the staff rules;
- the business's list of abilities;
- the PIN pass;
- the two station files.

`core/abilities.js` is marked *yours* in the export. The first import copies it as a working start. No later import writes over it,
and the provenance check only asks that it is there. A restaurant writes its own list. A cleaner's "Un-rack ready orders" is in the
start because the start is a cleaner's.

### What went

- **The rebuilt staff module, and its `staff.set`.** `facts/modules/staff.js` is now a thin module over the shop's `employee.set` and
  `staff.roles`. The shop keeps its hub rules for them in its own `hub/authority.js`, so this repo writes the same rules in its own
  module shape:
  - a person changes only their own PIN, time slip and language;
  - anything else needs `employees`;
  - only an owner makes or changes an owner.

  Which facts need a PIN the hub checked is asked of the shop's own list, `PIN_CHECKED`, so the two cannot disagree.
- **The rebuilt PIN pass.** The shop's `hub/pingrant.js` replaces it, with the shop's door, `/v2/pin-grant`. That door renews a pass
  without the PIN for up to 12 hours. A send carries its passes the shop's way, one per person, so a flood of junk passes is never
  read: one signature per fact, for that fact's own person.

### Two places this repo stays stricter than the shop

Both refuse more, never less:
- A pay rate needs `employees` here. At the shop, `payroll` may set one too — and, as the step 6 review found, anything else in the
  same change, so long as a rate rides along (by design there: the shop's Admin save is one fact under the payroll person).
- The hub refuses a change that would leave no active owner. At the shop the tablets refuse it, and the fold reports it after the
  fact.

The skeptic pass's finding 0.4, a `role: null` that got past the last-owner rule, is gone the way the plan said it would be. In the
shop's fold, a null leaves the field as it was. The test now proves exactly that: the owner is still an owner.

### What it kept

The time clock's history fixture was written as version 1 of the time clock and is never regenerated. Its people were written as
`staff.set`, which never left this machine. The 14 saved facts stay as they were. The same three people are added at the end as
`employee.set`. A type nobody registers is never folded, and the punches come out field for field the same.

### How it was checked

- The two browser tests drive the real page on several tablets. Both pass, changed only where they named the old fact:
  - the team brought onto a hub;
  - a hire approved by a PIN the hub checked;
  - every shift and the tip pool equal to one computer's.
- Thirteen deliberate breaks were made in a copy of `facts/`, one rule at a time. Twelve turned a test red. The thirteenth was a
  send's earlier staff facts not counting for its later ones, which is the shop's own "lay this send on top". It needed a new test,
  and now that break turns it red too.
- The bundle grew to about 242 KB raw and 74 KB gzipped. The plan raises the limit as shared files arrive, measured compressed.

### The time clock, as a kit

The plan's step 5 made the time clock the way the shop makes each of its functions: one kit, written against the old shape of the
data, and handed its save. In `pos.html` that is `clockKit(env)`: clock in, clock out, start a break, end a break. It is the code one
computer always ran, now written once.

On a hub, `clockKitFor()` is its adapter. It builds the punches from the facts and gives the kit a save that compares what changed:
- a new punch becomes a clock-in;
- an out time becomes a clock-out;
- a new break becomes a break start, and its end a break end.

Those go through the shop's own door, `station/record.js`, under the person who punched. The staff list is folded one fact at a time
by the shop's `station/views.js`, the way its tablets keep it.

The old facts mode asked "are we on a hub?" in 16 places across the screens. Now only the host asks, in eight small functions: which
kit, whose staff, whose PIN, the gate, the status line, the team card, the boot, and "not connected yet". The kit and the clock screen
never ask, and a test reads their code to check it.

What the block that connects a device does is still this repo's own. The shop connects its tablets with setup codes, which are v1's
code, so there was nothing to share. It is named the *station host* now, which is what it is.

### Two old faults, found by the new test

The new test made the device refuse a punch on purpose, then checked what the person sees. Two faults, both in the old facts mode
too:
- a refused punch kept the typed PIN, so the next PIN was added onto it and read as "not recognized";
- a refused clock-out kept the on-shift screen up, which hid the refusal.

A refusal now ends that PIN entry: the typed PIN is cleared and the on-shift screen closes, so the refusal is seen.

### A shift left open, ended

The skeptic pass's finding 1.1: a shift left open on a device when it joined the hub stayed open forever, because a clock-out only
knew the hub's shifts. Now the kit ends it at that person's next clock-out. That shift is the device's own history, so closing it
writes no fact. The person's next clock-in is a fact like any other.

At the shop, v1's old punches became facts, so every tablet sees them. Here they still stay on the device that held them. The shop's
history fact has no breaks and no wage, and these punches have both. Moving them is its own design step.

### How it was checked

- The two browser tests that drive the real page on several tablets pass unchanged. Every shift time, the tip pool and labor cost
  equal one computer's.
- The new browser test checks the points above.
- Eleven deliberate breaks were made in a copy of the page, one rule of the kit or its adapter at a time. Every one turned a browser
  test red.

### A skeptic pass, again

Step 6 of the plan: one review before anything is published. Three reviewers each took one angle:
- the hub's judgement of who may write what, and the PIN the hub checks;
- the clock kit and its adapter;
- whether this repo matches the shop it copies, and whether its tests can fail.

A checker then tried to refute every finding by running it. All 18 held. The reviewers also listed 42 attacks the code withstood.

**New in step 5, and caught:** a device that had a shift open from before it joined the hub, while another tablet had clocked the same
person in, closed the old shift and left the hub's running. The shop's own clock always takes its open shift first. Now this repo does
too: the old shift ends when the person's shift on the hub begins.

**Older faults the new eyes found:**
- staff names from the hub were drawn as HTML on the Office, in five places;
- a break named after a second clock-in vanished from the punches;
- a device named "Front Counter" could never start a break;
- one tablet could stall the hub for twenty seconds with a flood of staff facts;
- a module could name "constructor" as a right, and everyone would hold it;
- a wage could ride on a clock-in, the one fact that never needs a PIN;
- the import trusted its "yours" mark file by file;
- a proof dropped from the list stopped running without a word.

Each is fixed with a test that failed before the fix. Then each fix was undone in a copy, one at a time, and a test turned red every
time.

**The shop's, fixed there first.** The review read the shop's code too, where it is shared or compared:
- the same stall was in the shop's judge;
- a changed PIN did not end the passes earned with the old one;
- a burst of guesses got past the wrong-PIN lock.

Those are fixed in the shop's v2, with its suite. The two in the PIN pass reach this repo the only way shared code does: in the next
export of the build the shop is running.

One more was the shop's by design. There, a person with payroll may save any field of a person as long as a pay rate rides along,
permissions included. The fix was written, and the shop's own suite refused it: its Admin save records a manager's edit and the rate
a payroll person re-approved as one fact, under the payroll person. Closing the gap means splitting that save in two, which is a
change to the shop's screens and the owner's call. This repo never had the gap.

### 2026-11-02, morning — The shop's PIN fixes come back through the front door

The owner said "deploy now", and at 6:57 AM the shop's hub was running the two PIN-pass fixes the step 6 review had found. An hour
earlier this repo could not have taken them: the exporter only ships a hub file the shop actually runs. Now it does, so the live build
was exported and imported, and the only files that changed were the PIN pass and its proofs. That is the system working as planned:
a flaw found here, fixed in the shop first, used there by real staff, then arriving here unedited.

A pass now carries a short print of the PIN it was earned with. Two places in this repo hand the hub's record of the person to the
pass check: the judge and the renewal. If someone's PIN is changed because a person watched them type it, every pass made with the
old one stops working, for a change and for a renewal alike. A person switched off loses their pass the same way. Twelve guesses sent at
once now get at most five checks; before, more than five went through.

The new test runs over real HTTP. Undoing either wire, the burst count, or the whole file turned it red, four times out of four.

### 2026-11-02, evening — What the morning entry overstated, and a warning that arrives the same way

The morning entry said that when someone's PIN is changed, every pass made with the old one stops working. That holds for passes. It was
not the whole story. A second review of this repo found three gaps in the code the two systems share.

First, switching a person off and back on brought their old passes back to life. Now each switch back on is counted, and a pass names
the count, so a pass from before a switch-off never works again.

Second, a tablet with its clock set a few minutes fast could record a change to a person's PIN that sorts after the owner's real,
later change. The owner's change was accepted but did not take, and nobody was told. Refusing such changes would not work: a tablet
that keeps re-sending wins any time limit, and an honest tablet a minute fast would be turned away. So the hub now tells. A warning
names the person, what did not take, and the tablet behind it, and says to revoke that tablet. A third review then caught the warning
crying wolf: a change made on a tablet while it was offline, arriving after someone's later change, was also told to revoke the honest
tablet. Now the hub only says "revoke" when it can see the clock ran ahead. A late delivery is told as the older change, with no revoke.

Third, still open and the owner's call: a change waiting on a tablet goes through on that person's next PIN there, even if it was made
with a PIN that has since changed.

The warning first lived in the shop's own judge file, which is never exported. Rather than write it again here, the shop moved it into
the shared staff file, ran it live, and the export of that build was imported unedited. To use it, the module contract gained one
option, `tell`: a module may let a fact in and tell a person. The staff module tells with the shop's own words. The review also made
the contract stricter: a warning with nothing to say, or one that crashes, is reported as a fault rather than dropped, and a rule that
refuses with something other than words still refuses.

Undoing each piece turned a test red, every time: 10 here, 12 in the shop.
