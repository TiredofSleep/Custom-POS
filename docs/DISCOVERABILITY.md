# Getting found — the discoverability playbook for custompos.org

> The second half of the mission: *"then figure out how to help people find us."* This is the honest plan.
> **The on-page SEO is already done and good.** The needle now moves on OFF-page things — a launch, a few
> backlinks, the GitHub repo's own reach, and time. This file separates what is DONE from the handful of
> things only **you** (Brayden) can do, and gives you ready-to-post drafts so it's copy-paste, not homework.

## The honest truth about "help people find us"
Nobody types a brand they've never heard of. Discovery for a free tool like this comes from three places, in
order of how much they actually move traffic:

1. **A launch on a place developers and small-business owners already read** (Hacker News, a few subreddits,
   Indie Hackers). One good launch beats a month of SEO tuning — it brings real visitors *today* and, more
   importantly, the **backlinks** that make Google trust the site for everything else.
2. **The GitHub repo itself.** `custompos` on GitHub is a front door Google ranks and developers browse.
   Topics, a sharp description, and stars are its version of SEO.
3. **Search (SEO).** This is the long game. It's already set up correctly (below). It pays off over *months*,
   and it pays off **faster** once #1 and #2 give Google reasons to trust the domain.

⚠️ **A caution carried over from [ESTATE-INVENTORY.md](../ESTATE-INVENTORY.md):** when you check whether this
is working, quote **content actually served**, not raw request counts — most raw hits are bots. And three
traffic sources measure three different windows; don't quote them side by side as if they matched.

---

## ✅ DONE (this session and before) — no action needed
- **On-page SEO is thorough.** Every page has a real `<title>`, meta description, keyword set, canonical URL,
  Open Graph + Twitter cards, and `theme-color`. The home page and all six trade pages carry **JSON-LD
  structured data** (`SoftwareApplication` + `FAQPage` + `WebSite`) — that's what earns the rich results with
  the FAQ drop-downs right in Google.
- **`robots.txt`** allows everything and points at the sitemap. ✔
- **`sitemap.xml`** — *fixed this session:* it used to list a page that no longer exists (`app.html`, removed
  when the toy demo was retired) and carried stale July dates. Now it lists only real pages, dated today. A
  sitemap that points at a dead page is a small credibility ding with crawlers; it's clean now.
- **Google Search Console verification tag** is already in the home page (`google-site-verification`), so the
  property is claimable/claimed.
- **The trade pages target real high-intent searches** — e.g. the dry-cleaner page is built around
  *"SPOT alternative"* and *"free dry cleaner POS software,"* which is exactly what a shop owner types.

---

## 👉 WHAT ONLY YOU CAN DO — the short list (each is a few minutes)

### 1. Submit the sitemap in Google Search Console (2 min, biggest SEO lever)
Go to [search.google.com/search-console](https://search.google.com/search-console) → pick the `custompos.org`
property → **Sitemaps** → enter `sitemap.xml` → Submit. Then **URL Inspection** → paste `https://custompos.org/`
→ **Request indexing**. This tells Google to come look now instead of waiting to stumble in.

### 2. Set the GitHub repo's description and topics (2 min, paste-ready below)
On the repo page (github.com/TiredofSleep/Custom-POS), click the ⚙️ next to **About** and paste:

- **Description:**
  `Build your own point-of-sale, download one self-contained file, and own the code. Free, open-source, offline-first, no subscription. Generalized from a real in-production wet-cleaner POS.`
- **Website:** `https://custompos.org`
- **Topics** (add these — they're how developers browse GitHub):
  `pos` · `point-of-sale` · `pos-system` · `open-source` · `self-hosted` · `offline-first` · `small-business`
  · `retail` · `restaurant-pos` · `dry-cleaner` · `no-lock-in` · `single-file` · `vanilla-javascript` ·
  `local-first` · `pos-builder`
- Tick **Releases** and **Packages** off if empty; keep **Use your GitHub Pages website** if offered.

### 3. Launch it (the big one) — pick ONE to start, drafts are below
Post to **one** venue first, watch the replies for a day, then do the next. Don't blast all at once — you
want to answer comments while they're live. Best first target for this project: **r/selfhosted** (friendly to
"own your data" tools) or **Hacker News "Show HN"**. See the ready-to-post drafts at the bottom.

### 4. Add it to the directories people search when shopping for software (10 min total)
- **AlternativeTo.net** — add customPOS as an alternative to **SPOT**, **Xplor/DryClean**, **Square POS**,
  **Toast**. High-intent shoppers live here.
- **awesome-selfhosted** (github.com/awesome-selfhosted/awesome-selfhosted) — open a PR adding customPOS under
  *Point of Sale*. It's the canonical list; a merge there is a permanent, trusted backlink.
- **Indie Hackers** product page + a "I built this" post.

---

## 📝 Ready-to-post launch drafts
Honest, no overclaiming. The strongest thing you have is *it's real* — a two-store wet cleaner runs on it
daily. Lead with that; it's the credibility nobody else in "free POS" has.

### A. Hacker News — "Show HN"
> **Title:** Show HN: customPOS – build a point-of-sale, download one file, own the code
>
> I run a two-location wet cleaner and got tired of renting our point-of-sale — a monthly subscription, our
> customer data on someone else's server, and no way to change how it works. So I built our own, and then
> generalized it into a free builder anyone can use.
>
> You answer a few questions about your business (restaurant, retail, salon, dry cleaner, repair shop,
> jewelry…), and it generates a single self-contained HTML file that IS your POS. No install, no account, no
> backend required — it runs in a browser and stores data locally. If you want several stations to share
> data, there's an optional zero-dependency sync hub. Everything is MIT-licensed; you own the code and can
> change it (I use Claude Code to customize ours).
>
> It's the actual system running our shop — intake, garment tracking, assembly, house accounts, "text when
> ready," a cash drawer, payroll, the works — not a mock-up. 98 automated test suites, and the whole sync
> layer is built around lessons we learned the hard way running it live for real money.
>
> Site: https://custompos.org  ·  Code: https://github.com/TiredofSleep/Custom-POS
>
> Happy to answer anything about the architecture or how it holds up on a real shop floor.

*(Post Tue–Thu, ~8–10am US Eastern. Then STAY and answer every comment for a few hours — that's what keeps it
on the front page.)*

### B. r/selfhosted
> **Title:** I generalized the POS that runs my dry cleaner into a free, self-hostable builder — one file, own your data
>
> After years of paying a subscription for point-of-sale software that kept our customer data on someone
> else's server, I built our own for our two-store wet cleaner — then turned it into a free builder anyone can
> use.
>
> - **One self-contained HTML file** is your whole POS. Runs in a browser, stores data locally, works offline.
> - **Optional sync hub** (one small Node file, zero dependencies) if you want multiple stations/devices to
>   share live data. Self-host it anywhere — a $5 droplet runs ours.
> - **MIT-licensed.** No subscription, no account, no lock-in. Your code, your machine, your data.
> - Not a toy: it's the real system running our shop, with 98 automated test suites.
>
> Builder + templates: https://custompos.org — Code: https://github.com/TiredofSleep/Custom-POS
> Would love feedback from people who've self-hosted business tools — especially on the sync/backup side.

### C. r/smallbusiness (less technical, lead with the money/ownership angle)
> **Title:** Tired of paying monthly for POS software, I built a free one you download and own — sharing it
>
> I own a dry cleaner and the point-of-sale subscriptions never stop — and you never actually own anything.
> I built our own and made it free for other small businesses. You pick your type of shop, download one file,
> and it's yours — no monthly fee, no company holding your data hostage. Works for restaurants, retail,
> salons, cleaners, repair shops and more.
> It's the same system running my two stores every day. https://custompos.org
> Not selling anything — genuinely just sharing it. Happy to help anyone set it up.

*(Read each subreddit's self-promotion rules first; r/smallbusiness has a promo-day convention. Being the
actual owner-operator, not a vendor, is your pass here — say so plainly.)*

---

## What I did NOT do (and why)
- **No keyword stuffing or doorway pages.** The on-page work is already at the point of diminishing returns;
  more meta tags don't move rankings. Backlinks and a launch do.
- **No paid ads.** Not worth it for a free tool with no revenue to recover the spend; the launch venues above
  are free and better-targeted.
- **Nothing that overclaims.** Every draft above is true. "Free POS" is a scam-heavy search term; *being the
  real operator who runs it* is the one thing that cuts through, so the whole strategy leans on it.

## How to tell if it's working (without fooling yourself)
- **Search Console** (not raw logs) is the honest source for search traffic: impressions and clicks per query,
  which pages, which terms. Check it ~weekly.
- **GitHub stars/traffic** (Insights → Traffic) shows referrers and clones — that's your launch's echo.
- Remember the estate caution: **content served, not request count**; and don't compare two sources measured
  over different windows.
