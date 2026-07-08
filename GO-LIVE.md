# GO-LIVE — putting customPOS on the internet at **custompos.org**

The domain is **custompos.org**, registered at **SiteGround** (so SiteGround is both your registrar and a web
host). GitHub Pages is now enabled, and the repo builds the whole site on every push. What's left is choosing
*where it's hosted* and pointing the domain — steps that use your SiteGround and GitHub logins.

> **What I can and can't do.** From this session I can build, package, and give you exact steps — but I can't log
> into your SiteGround account or edit your DNS; those need your browser. Everything below is either already done
> in the repo or a short sequence of clicks for you.

You have **two good options.** Pick one:

| | **Path A — GitHub Pages hosts, SiteGround does DNS** *(recommended)* | **Path B — SiteGround hosts the files** |
|---|---|---|
| Updates | **Automatic** — every push to `main` redeploys | Manual re-upload each time (or set up Git deploy) |
| SSL / HTTPS | Free, automatic (GitHub) | Free, automatic (SiteGround "Let's Encrypt") |
| Cost | $0 hosting (you already have the domain) | Uses the SiteGround plan you're paying for |
| Best when | The site keeps improving (it does) | You want everything under one SiteGround roof |

---

## Path A — GitHub Pages hosts, SiteGround points the domain *(recommended)*

**1. In the repo (I can do this part when you say go).** Add a `CNAME` file containing `custompos.org` and have
the Pages workflow publish it. *Do this AFTER step 2 below*, or the github.io site will redirect to a domain that
doesn't resolve yet. The ready file is **[deploy/CNAME.example](deploy/CNAME.example)**.

**2. In SiteGround → point the domain at GitHub (yours).**
Site Tools → **Domain → DNS Zone Editor**. **Add / edit** these (ADD only — don't delete mail/MX records):
```
A      @      185.199.108.153
A      @      185.199.109.153
A      @      185.199.110.153
A      @      185.199.111.153
CNAME  www    tiredofsleep.github.io.
```
If SiteGround already has an `A @` record pointing at its own server, replace it with the four above (that's what
moves the site to GitHub Pages). DNS takes minutes to a few hours — check with `dig custompos.org +short` (you
should see the 185.199.x.x IPs).

**3. In GitHub → set the custom domain (yours).** Repo → **Settings → Pages → Custom domain →** `custompos.org`
→ Save. Then tick **Enforce HTTPS** once it verifies. Live at **https://custompos.org**.

---

## Path B — host the files directly on SiteGround

The whole site is **four static files** — no server, no database. I'll hand you a ready-to-upload bundle
(`custompos-site.zip`) containing:
- `index.html` — the landing page
- `builder.html` — the guided builder
- `pos.html` — the live demo engine
- `app.html` — the one-file self-contained build (engine inlined)

**Steps (yours):**
1. SiteGround → Site Tools → **Site → File Manager** (or FTP).
2. Open your site's document root — usually **`public_html`** (for the primary domain) or
   `public_html/custompos.org` if it's an add-on/secondary domain.
3. **Upload the four files** from the zip (or upload the zip and use File Manager's *Extract*). If SiteGround put
   a placeholder `index.html` there, replace it with ours.
4. SiteGround → **Security → HTTPS Enforce** (and install the free Let's Encrypt cert under **Security → SSL
   Manager** if it isn't already).
5. Visit **https://custompos.org** — landing page. `/builder.html?guided` → the interview. `/pos.html` → the demo.

**To update later:** re-upload the changed files. (Or, nicer: SiteGround supports Git — you can point a
deployment at this repo so `git push` updates the site. Ask me and I'll write those steps for your plan.)

---

## Either way — verify (2 minutes)
- **https://custompos.org** shows the landing page (worker-rights + business-health sections visible).
- **Build my POS** → `/builder.html?guided` opens the guided interview.
- **Live demo** → `/pos.html` runs a POS with no console errors.
- On a phone: no sideways scrolling (the landing test already guarantees this).

## Nice-to-haves after launch (optional)
- **Social preview image** — a 1200×630 `og.png` at the site root + `<meta property="og:image" content="https://custompos.org/og.png">` so shared links unfurl with a picture.
- **Privacy-respecting analytics** (Plausible / GoatCounter) if you want traffic counts without tracking anyone.

## If something's off
- **Path A, site 404s at custompos.org but the github.io URL works:** DNS hasn't propagated, or the custom domain
  isn't set in Settings → Pages. Recheck the A records; give it time.
- **Path B, you see a SiteGround placeholder:** the real files went to the wrong folder — confirm the document
  root (`public_html` vs `public_html/custompos.org`).
- **"Certificate not ready":** normal right after setup; the host is still issuing it. Wait, then enforce HTTPS.

*My recommendation: **Path A.** It costs nothing extra, and every improvement I push goes live on its own — you'll
never have to re-upload. Tell me "do Path A" and I'll commit the `CNAME` the moment your DNS is pointed.*
