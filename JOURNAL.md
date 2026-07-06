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

*— to be continued —*
