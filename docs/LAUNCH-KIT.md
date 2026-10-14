# Launch kit — put customPOS out there (copy-paste, in order)

> This is the *do-it-now* companion to [DISCOVERABILITY.md](DISCOVERABILITY.md) (which is the why/strategy).
> **Refreshed 2026-10-14** around the three things that are new and true: the **Single-PC Edition** (the real POS as one free
> file), **a live shop changed by asking Claude** ([custompos.org/built-with-claude.html](https://custompos.org/built-with-claude.html)),
> and the honest numbers behind both. Every number below is the one on the live site, dated **as of Oct 12, 2026** — keep it that
> way: a post that overclaims gets picked apart in the first hour and the real-shop story is the whole advantage.

**Attach a screenshot to every post that allows one** (they roughly double how a launch performs):
- `press/08-built-with-claude.png` — three real requests in the owner's words, what changed, and the numbers. Best for the Claude angle.
- `press/07-single-pc.png` — the Single-PC Edition's home screen. Best for the "free, one file" angle.
- `press/02-dashboard.png` — the money dashboard. Best for small-business readers.

## ⏱️ Where things stand, and the next step
- ✅ **Search engines:** custompos.org is verified in **Google Search Console** and **Bing Webmaster Tools**; sitemap submitted; the
  home, builder, trade, Single-PC and Built-with-Claude pages were sent for indexing (Oct 10–13). Nothing to do here.
- ✅ **GitHub "About":** description, website and 20 topics are set.
- 👉 **Next: post to ONE venue** (§2), attach a screenshot, then stay a couple of hours and answer every reply. Best first picks:
  **Show HN** (the Claude angle, Tue–Thu ~8–10 AM US Eastern) or **r/selfhosted** (the one-file angle).
- Then one venue every day or two, and the two directory listings (§3), which are permanent backlinks.

---

## §1 — The facts every post may use (and nothing else)
- The owner runs a **two-store wet cleaner** in Arkansas (Ozark Cleaners). The shop has run on its own POS since **June 2026**.
- The POS is **built and changed with Claude Code**: the owner says what he needs in plain words; Claude changes the code, writes a
  test named after the request, and the change goes live only if every test passes.
- **Oct 1–12:** 94 changes to the live system, on 9 of those 12 days (13 on Oct 12 alone); 48+ builds put live; the shop's test suite
  stands at **1,226 tests, all passing**. (As of Oct 12, 2026.)
- Money stays the owner's decision (no refunds or charges by the AI), every data fix lands on an activity log, secrets never in code,
  and a deploy is refused if any test fails.
- customPOS is **free and MIT**. The **builder** makes a POS from a few questions; the **Single-PC Edition** is the shop's own first
  system as one HTML file (~2 MB) that runs on one computer with zero network requests. ~100 automated test suites in the repo.
- Next: a **multi-station edition** built from the shop's newer, event-sourced system, brought in as modules — the first module set
  is for **auctions** (lots, consignors, bidders, settlement; the fee math is already in the repo).
- customPOS is **independent and not affiliated with Anthropic**.

---

## §2 — The launch posts (final, paste-ready)
Your one unfakeable edge: **it's the real system running your two stores, changed by asking.** Lead with that every time.

### Show HN (news.ycombinator.com/submit)
**Title** (pick one; HN rewards plain titles):
```
Show HN: How my shop changes its live POS by asking Claude Code (and a free version)
```
```
Show HN: customPOS – a free POS builder from a shop that edits its own POS with Claude Code
```
**URL:** `https://custompos.org/built-with-claude.html`
**First comment** (post it yourself right after submitting):
```
I run a two-store wet cleaner in Arkansas. Since June our point-of-sale has been our own
software, built with Claude Code. When something bugs me at the counter, I say it in plain
words; Claude changes the code, writes a test named after what I asked, and the change only
goes live if every test passes.

Some real ones from the last two weeks: "after clocking in or out the screen should return
home", "i don't want to get cash drawer alerts for any amount less than $1", "detail just let
me scan [a tag] onto the order twice". Each became a change plus a test the same day.

The numbers, as of Oct 12: 94 changes to the live system in 12 days, on 9 of those days;
1,226 tests, all passing; the deploy refuses anything that fails one. Money stays my call –
the AI never refunds or charges – and every data fix lands on an activity log.

customPOS is the free, MIT version of that idea: a builder that makes a POS from a few
questions, plus our shop's own first system as a single HTML file you can run on one PC
(no server, no account, no network requests). The page linked above walks through exactly
how a change happens and why we think it's safe to let an AI touch a live business.

Site: https://custompos.org  ·  Code: https://github.com/TiredofSleep/Custom-POS
Not affiliated with Anthropic – just a shop owner who uses their tools. Happy to answer anything.
```

### r/selfhosted
**Title:**
```
The POS that ran my wet cleaner, now free as one HTML file you run on your own PC – no server, no account
```
**Body:** (attach `press/07-single-pc.png`)
```
I run a two-store wet cleaner. Our first in-house point-of-sale was one big HTML file, and it
ran the shop from June to September 2026. I've now published it as a free "Single-PC Edition":

- One self-contained HTML file. Download it, double-click, run a one-counter shop on one PC.
- Zero network requests – the data lives in your browser on your machine. (A test proves it:
  served over http it makes exactly one request, for itself.)
- Cash, check, and cards on your own terminal (you type the approval). Backups to a file.
- MIT. No subscription, no account, no telemetry.

There's also a builder that makes a POS for other kinds of shops from a few questions, and an
optional zero-dependency sync hub if you want several stations. The shop itself has moved to a
newer multi-station system that I'm bringing into the project as modules.

Single-PC Edition: https://custompos.org/single-pc.html
Code: https://github.com/TiredofSleep/Custom-POS
Honest limits are on the page (no one-click restore yet, texting and card readers need a hub).
Feedback from people who self-host business tools is very welcome.
```

### r/ClaudeAI (the "how we use it" angle)
**Title:**
```
I let Claude Code change the POS of my real two-store shop every day – here's the process that keeps it safe
```
**Body:** (attach `press/08-built-with-claude.png`)
```
I own a wet cleaner with two stores. Our point-of-sale is our own software, built and changed
with Claude Code – one Claude session per shop computer, each with its own notes and log.

How a change happens: I say what I want in plain words. Claude finds the code (every function
carries a searchable label), changes it, writes a test named after my request – usually with a check
that the test really fails without the fix – runs all 1,226 tests, and deploys only if they all pass.
The previous build is kept for rollback. Money (refunds, charges) stays my decision, every data
fix is written to an activity log as "Claude", and secrets never go in the code.

Oct 1–12: 94 changes to the live system, on 9 of 12 days. Not every day is smooth, and the page is honest
about the limits.

I wrote it all up, with the real requests in my own words:
https://custompos.org/built-with-claude.html
The free, open-source version is at https://custompos.org (not affiliated with Anthropic).
```

### r/smallbusiness (lead with money and ownership, less technical)
**Title:**
```
I stopped renting my POS: my shop's own system, free for other small businesses
```
**Body:** (attach `press/02-dashboard.png`)
```
I own a two-store wet cleaner. Point-of-sale subscriptions never stop, and you never own anything,
so we built our own – and when something about it bugs me, I just say what I want and it gets
changed, usually the same day.

I've made it free for other small businesses: pick your type of shop and download one file, or
run our shop's own first system on a single computer. No monthly fee, no company holding your
data, and the back-office view goes all the way to what you actually kept after costs.

https://custompos.org – not selling anything, genuinely sharing it. Happy to help anyone set it up.
```
*(Check the sub's self-promotion rule first — r/smallbusiness has a promo-day convention. Being the real owner-operator,
not a vendor, is your pass. Say so plainly.)*

### Product Hunt (optional, higher effort)
- **Tagline:** `The free POS you download and own — and change by asking`
- **Gallery:** `press/08-built-with-claude.png`, `press/07-single-pc.png`, `press/02-dashboard.png`.
- **First comment:** the Show HN first comment, trimmed.

### Indie Hackers ("I built this" / product page)
- Reuse the Show HN first comment. IH likes the "generalized my own real business tool" angle; add one line on what's next
  (the multi-station edition, starting with auctions).

---

## §3 — Directory submissions (permanent backlinks)
### AlternativeTo.net
Add **customPOS** (URL `https://custompos.org`, license Open Source / Free) as an alternative to:
**SPOT**, **Xplor / DryClean POS**, **Square POS**, **Toast**, **Clover**, **Loyverse**. Suggested blurb:
```
Free, open-source point-of-sale. Build one from a few questions, or run a real shop's own system as one
self-contained HTML file on a single PC — no subscription, no account, works offline. Own the code and
change it by asking an AI coding assistant; an optional self-hosted hub links several stations.
```

### awesome-selfhosted (a trusted, permanent backlink — later, and in your own words)
**Not yet eligible, and it must be written by you.** Their rules (checked 2026-10-14, awesome-selfhosted-data CONTRIBUTING.md):
the software's **first release must be more than 4 months old** (the count starts at a GitHub release — customPOS has none yet), and
**machine- or LLM-generated contributions are not allowed**: the entry and the PR text must be written by a person, with an attestation.
**The first release, v0.39.0, was cut on 2026-10-14**, so it becomes eligible after **2027-02-14**. Then add
`software/custompos.yml` to awesome-selfhosted/awesome-selfhosted-data yourself, in your own words. Claude should not draft it.

---

## Etiquette that keeps you from getting flagged
- **One venue at a time.** Don't cross-post the same hour; you can't be present in five threads at once.
- **Be the owner, not a marketer.** Every community here rewards "I built this for my own shop" and punishes ad-speak. No
  superlatives, no "revolutionary", no "fully autonomous" — a person decides, and the page says so.
- **Answer everything** for the first few hours — questions, skepticism, feature asks. Replies > the post.
- **Never fake it.** No sock-puppet upvotes, no invented reviews, no customer names. The real-shop story is the whole advantage.
- **Numbers carry their date** ("as of Oct 12, 2026"). Refresh them from the live page before reusing a post later.

## Measuring it (without fooling yourself)
Baseline before any launch post (Oct 14, 2026): Google showed custompos.org **192 times with 10 clicks in 28 days** (average position
18; only 2 pages indexed), and the GitHub repo had **2 views in 14 days, 0 stars**. Search Console (impressions and clicks by query)
is the honest search signal; GitHub Insights → Traffic shows a launch's echo (ignore clones — most are automated). Quote **real
visitors**, not raw request counts — most raw hits are bots.
