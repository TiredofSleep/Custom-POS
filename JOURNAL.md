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
stone. (Findings and the design changes they drove: next entry.)

*— to be continued —*
