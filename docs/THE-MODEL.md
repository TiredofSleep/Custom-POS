# The customPOS Model — Customer → Payment, and the path between

*This is the product in one page. It sits above the engineering detail in [ARCHITECTURE.md](ARCHITECTURE.md).*

## The spine
Every business — a taco cart, a dry cleaner, a repair shop, a boutique — **starts the same way (a customer)
and ends the same way (a payment).** Those two points are fixed. Everything else people asked us about in
testing was just **resolving the path between customer and payment.** So the engine is simple to state:

> **Customer  →  [ the path ]  →  Payment**

Two fixed endpoints, and a configurable path of steps in the middle. That's the whole shape.

## A POS is a flow of information
From customer to payment, information flows through *stations*: who is this, what do they want, what has to
happen to it, when is it ready, how do they pay. A retailer's path is short (customer → pick items → pay). A
dry cleaner's is long (customer → intake → process → ready → pickup → pay). Same spine, different stations in a
different order.

Because a POS **is** a flow of information, the builder is not a questionnaire — it's a **visual flow editor,
like a website creator.** You lay out your path by arranging stations (modules) between the fixed Customer and
Payment ends. The wizard questions from our earlier rounds still exist, but they're a *fast way to auto-arrange*
the flow for people who don't want to draw it themselves.

## The involvement ladder (a path for every level — this is the FIRST choice)
Before anything else, the builder asks **how hands-on you want to be**, and we engineer a real path for each:

1. **Build it for me** — pick your trade; we lay the standard flow for it; download. Done in a minute.
2. **Guided** — plain-language questions tune the flow (one simple question at a time).
3. **Visual builder** — drag and arrange the stations of your own flow, like moving blocks on a page.
4. **Claude Code** — download the file and point **your own Claude account** at it. The download ships with a
   generated guide so Claude "reads into" your project instantly and customizes it — locally, with no limits,
   forever.

Same file underneath. You choose how deep to go, and you can climb the ladder anytime — start with "build it
for me," and open it in Claude Code a year later when you want something custom.

## Modules are the building blocks
Each station on the path is a **module** — intake, item entry, modifiers, make/kitchen, ready/rack, pickup,
deposit, appointment, asset check-in, and so on. **Customer** and **Payment** are the fixed ends that are always
there. A per-trade **flow template** is simply a pre-arranged set of stations — the starting point you then
adjust.

## The library (we compile what everyone builds)
As people build flows and modules, **we keep compiling and organizing them into a shared, growing library** —
so the next boutique starts from what the last boutique figured out, and the next food truck from the last one.
Curated, organized, and free. Every business that builds makes customPOS better for the next.

## The request loop (custom needs become everyone's options)
Need a module or a flow that doesn't exist yet? **Send it in.** Requests come to us (by email), we build them
with Claude Code, and add them to the library. One shop's custom need becomes an option for every shop after it.
*(Process today: owner emails a request → it's handed to Claude Code → the new module/flow ships to the library.)*

## What ships in the download
- **Your POS** — one self-contained file, your flow baked in, your data local.
- **A generated `CLAUDE.md` + guide** — so your own Claude Code reads into the project from minute one.
- **The flow definition** — a shared description of your Customer→Payment path, so the visual builder and the
  code always stay in sync (edit either; they agree).

## Why this holds
It matches what 48 tested owners actually did: they all began with a customer and ended with a payment, and
every difference between them was a different path in between. Build the two endpoints as bedrock, make the
path visual and modular, meet people at their own level of involvement, and let the community's paths accumulate
into a library. That's customPOS.
