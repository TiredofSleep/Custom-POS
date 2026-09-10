# Launch kit — put customPOS out there (copy-paste, in order)

> This is the *do-it-now* companion to [DISCOVERABILITY.md](DISCOVERABILITY.md) (which is the why/strategy).
> Everything below is ready to paste. Two product screenshots are in `press/` — **attach them to every post**,
> they roughly double how a launch performs: `press/02-dashboard.png` (the money dashboard) and
> `press/01-register.png` (the register).

## ⏱️ The next 20 minutes — four things, in order
1. **GitHub “About” (2 min).** Repo page → the ⚙️ next to **About** → paste the description + topics from §1 below.
2. **Google Search Console (2 min).** [search.google.com/search-console](https://search.google.com/search-console) →
   `custompos.org` → **Sitemaps** → enter `sitemap.xml` → Submit. Then **URL Inspection** → paste
   `https://custompos.org/` → **Request indexing**.
3. **Post to ONE launch venue (10 min).** Start with **r/selfhosted** *or* **Show HN** (§2). Attach a screenshot.
   Then stay for a couple of hours and answer every reply — that’s what keeps a post alive.
4. **AlternativeTo (5 min).** Add customPOS as an alternative to SPOT / Square / Toast (§3).

Do the other venues over the following days — one at a time, so you can answer comments while they’re warm.

---

## §1 — GitHub repo “About” (paste-ready)
**Description:**
```
Build your own point-of-sale, download one self-contained file, and own the code. Free, open-source, offline-first, no subscription. Generalized from a real in-production wet-cleaner POS.
```
**Website:** `https://custompos.org`

**Topics** (add each as a tag):
```
pos  point-of-sale  pos-system  open-source  self-hosted  offline-first  small-business  retail  restaurant-pos  dry-cleaner  no-lock-in  single-file  vanilla-javascript  local-first  pos-builder
```

---

## §2 — The launch posts (final, paste-ready)
Your one unfakeable edge: **it’s the real system running your two stores.** Lead with that every time.

### Show HN (news.ycombinator.com/submit)
**Title** (HN allows no image in the post; put the site as the URL):
```
Show HN: customPOS – build a point-of-sale, download one file, own the code
```
**URL:** `https://custompos.org`
**First comment** (post this yourself right after submitting):
```
I run a two-location wet cleaner and got tired of renting our point-of-sale — a monthly
subscription, our customer data on someone else's server, and no way to change how it works.
So I built our own, then generalized it into a free builder anyone can use.

You answer a few questions about your business (restaurant, retail, salon, dry cleaner,
repair shop, jewelry…) and it generates a single self-contained HTML file that IS your POS.
No install, no account, no backend required — it runs in a browser and stores data locally.
If you want several stations to share data, there's an optional zero-dependency sync hub.
MIT-licensed; you own the code and can change it (I use Claude Code to customize ours).

It's the actual system running our shop — intake, garment tracking, assembly, house accounts,
"text when ready," a cash drawer, payroll, an owner dashboard that goes all the way to net
profit — not a mock-up. ~100 automated test suites, and the whole sync/backup layer is built
around lessons learned running it live for real money.

Site: https://custompos.org  ·  Code: https://github.com/TiredofSleep/Custom-POS
Happy to answer anything about the architecture or how it holds up on a real shop floor.
```
*(Best window: Tue–Thu, ~8–10am US Eastern.)*

### r/selfhosted
**Title:**
```
I generalized the POS that runs my dry cleaner into a free, self-hostable builder — one file, own your data
```
**Body:** (attach `press/02-dashboard.png`)
```
After years of paying a subscription for point-of-sale software that kept our customer data
on someone else's server, I built our own for our two-store wet cleaner — then turned it into
a free builder anyone can use.

- One self-contained HTML file is your whole POS. Runs in a browser, stores data locally, works offline.
- Optional sync hub (one small Node file, zero dependencies) so multiple stations share live data.
  Self-host it anywhere — a $5 droplet runs ours.
- MIT-licensed. No subscription, no account, no lock-in. Your code, your machine, your data.
- Not a toy: it's the real system running our shop, ~100 automated test suites, encrypted
  self-verifying backups, an owner dashboard down to net profit.

Builder + templates: https://custompos.org — Code: https://github.com/TiredofSleep/Custom-POS
Would love feedback from folks who self-host business tools — especially on the sync/backup side.
```

### r/smallbusiness (lead with money/ownership, less technical)
**Title:**
```
Tired of paying monthly for POS software, I built a free one you download and own — sharing it
```
**Body:** (attach `press/02-dashboard.png`)
```
I own a dry cleaner and the point-of-sale subscriptions never stop — and you never actually own
anything. I built our own and made it free for other small businesses. You pick your type of shop,
download one file, and it's yours — no monthly fee, no company holding your data hostage. Works for
restaurants, retail, salons, cleaners, repair shops and more, and the back-office view goes all the
way to what you actually kept after costs.

It's the same system running my two stores every day: https://custompos.org
Not selling anything — genuinely just sharing it. Happy to help anyone set it up.
```
*(Check the sub’s self-promotion rule first — r/smallbusiness has a promo-day convention. Being the
real owner-operator, not a vendor, is your pass. Say so plainly.)*

### Product Hunt (optional, higher effort)
- **Tagline:** `The free POS you download and own — one file, no subscription`
- **Gallery:** both `press/` images. **First comment:** the Show-HN first comment, trimmed.

### Indie Hackers (“I built this” / Product page)
- Reuse the Show HN first comment. IH loves the “generalized my own real business tool” angle.

---

## §3 — Directory submissions (permanent backlinks)
### AlternativeTo.net
Add **customPOS** (URL `https://custompos.org`, license Open Source / Free) as an alternative to:
**SPOT**, **Xplor / DryClean POS**, **Square POS**, **Toast**, **Clover**. Suggested blurb:
```
Free, open-source point-of-sale you build from a few questions and download as one self-contained
file — no subscription, no account, works offline, with an optional self-hosted sync hub. Own the code.
```

### awesome-selfhosted (a merged PR here is a trusted, permanent backlink)
Repo: github.com/awesome-selfhosted/awesome-selfhosted — add under **Point of Sale / ERP**. Entry line:
```
- [customPOS](https://custompos.org) - Build a point-of-sale from a few questions and download it as one self-contained HTML file; optional zero-dependency sync hub for multiple stations. Own the code, works offline. ([Source Code](https://github.com/TiredofSleep/Custom-POS)) `MIT` `HTML/Nodejs`
```
> **I can open this PR for you** from a fork of your account — just say the word and I’ll prepare it and
> hand you the link to review before it’s submitted. (It posts under your GitHub identity, so I’ll only send
> it on your go.)

---

## Etiquette that keeps you from getting flagged
- **One venue at a time.** Don’t cross-post the same hour; you can’t be present in five threads at once.
- **Be the owner, not a marketer.** Every community here rewards “I built this for my own shop” and punishes
  ad-speak. No superlatives, no “revolutionary.”
- **Answer everything** for the first few hours — questions, skepticism, feature asks. Replies > the post.
- **Never fake it.** No sock-puppet upvotes, no invented reviews. The real-shop story is the whole advantage;
  don’t dilute it.

## Measuring it (without fooling yourself)
Search Console (impressions/clicks by query) is the honest search signal; GitHub Insights → Traffic shows the
launch’s echo. Quote **content served / real visitors**, not raw request counts — most raw hits are bots.
