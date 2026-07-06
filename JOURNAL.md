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

*— to be continued —*
