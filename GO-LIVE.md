# GO-LIVE — putting customPOS.com on the internet

This is the honest, step-by-step path from "it's in the repo" to "it's live at **custompos.com**."
The site is **already built and already deploying** — every push to `main` publishes it. What's left is a domain
and a DNS switch, which only you can do because they cost a little money and use your accounts.

> **What's automated vs. what's yours.** The build + deploy is automated (GitHub Pages, on every push). Buying
> the domain, pointing DNS, and flipping the "custom domain" switch are **yours** — they need a credit card and
> your registrar/GitHub logins. This doc gets you exactly to that line and through it.

---

## What's already true (no action needed)
- **The site builds itself.** `.github/workflows/pages.yml` runs on every push to `main`: it runs `node build.js`,
  assembles `index.html` (landing) + `builder.html` (the builder) + `pos.html` (the demo engine) + `app.html`
  (the one-file self-contained build), and publishes them to **GitHub Pages**.
- **It's live right now at the GitHub Pages URL.** Find it under the repo's **Settings → Pages** (it looks like
  `https://tiredofsleep.github.io/Custom-POS/`). Open it — that's the real site, today, minus the pretty domain.
- **Everything is static and self-contained.** No server to run for the website itself. (The optional sync `hub.js`
  and the payments service are separate, per-business, and only needed by a shop that wants them.)

## Step 1 — Register the domain (yours; ~$10–15/year)
Buy **custompos.com** at any registrar (Cloudflare, Namecheap, Porkbun, Google Domains successor, etc.).
Cloudflare and Porkbun are near cost price and have clean DNS panels. That's the only recurring cost of the site.

## Step 2 — Point DNS at GitHub Pages (yours; ~5 minutes + propagation)
In the registrar's DNS settings, **add** these records (don't delete anything unrelated):

**Apex (`custompos.com`) — four A records to GitHub's Pages IPs:**
```
A   @   185.199.108.153
A   @   185.199.109.153
A   @   185.199.110.153
A   @   185.199.111.153
```
*(Optional but recommended — the same four as AAAA/IPv6: `2606:50c0:8000::153`, `…8001::153`, `…8002::153`, `…8003::153`.)*

**`www` subdomain — a CNAME to the Pages host:**
```
CNAME   www   tiredofsleep.github.io.
```
DNS can take from minutes to a few hours to propagate. You can check with `dig custompos.com +short`.

## Step 3 — Tell GitHub Pages the domain (yours; 1 minute)
Two equivalent ways — do **one**:
- **In the UI:** repo **Settings → Pages → Custom domain →** type `custompos.com` → **Save**. GitHub writes the
  `CNAME` file for you and verifies DNS.
- **In the repo:** add a file named `CNAME` at the repo root containing exactly `custompos.com`, and make the
  Pages workflow copy it into the published site (add `cp CNAME _site/` to the "Assemble the site" step in
  `.github/workflows/pages.yml`). A ready-to-use snippet is in **[deploy/CNAME.example](deploy/CNAME.example)**.

> ⚠️ **Order matters.** Do Step 2 (DNS) **before** Step 3, or before adding a `CNAME` file. If Pages is told the
> custom domain before DNS resolves, the `github.io` URL will redirect to a domain that doesn't answer yet and the
> site looks "down" until DNS catches up. Point DNS first, then set the domain.

## Step 4 — Turn on HTTPS (yours; 1 click, after DNS resolves)
Back in **Settings → Pages**, once the domain verifies, check **Enforce HTTPS**. GitHub provisions a free Let's
Encrypt certificate automatically (can take a few minutes to an hour after the domain first resolves). Done — the
site is live at **https://custompos.com** with a valid certificate.

## Step 5 — Verify (2 minutes)
- `https://custompos.com` shows the landing page.
- `https://www.custompos.com` redirects to the apex (GitHub does this automatically with the CNAME file present).
- **Build my POS** → `https://custompos.com/builder.html?guided` opens the guided interview.
- **Live demo** → `https://custompos.com/pos.html` runs a POS.
- Open the browser console on each — it should be clean (the CI already guarantees zero console errors).

---

## After launch — nice-to-haves (optional)
- **Social preview image.** Add an `og:image` (a 1200×630 PNG) so links unfurl with a picture on social/Slack.
  Drop `og.png` at the repo root, copy it in the Pages workflow, and add
  `<meta property="og:image" content="https://custompos.com/og.png">` to `index.html`'s head.
- **Analytics, privacy-respecting.** If you want traffic counts, a cookieless option (Plausible, GoatCounter)
  keeps the "we never track your customers" promise honest. Purely optional.
- **A short launch note.** The JOURNAL.md is the story of how it was built — a nice thing to link when you tell
  the world.

## If something's off
- **Site 404s at the custom domain but works at github.io:** DNS hasn't propagated, or the custom domain isn't set
  in Settings → Pages. Re-check Step 2 and Step 3; give it time.
- **"Certificate not yet available":** normal right after first setup — GitHub is still issuing it. Wait, then
  re-tick Enforce HTTPS.
- **A change didn't show up:** confirm the **deploy demo to GitHub Pages** action ran green on your last push to
  `main` (repo → Actions).

*Everything up to the credit card and the DNS panel is done. The rest is yours — and it's about fifteen minutes of
clicking, most of it waiting for DNS.*
