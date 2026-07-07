# customPOS Payments Service — certified card processing for any POS

A standalone, zero-dependency card-processing service. It gives **any** point-of-sale — customPOS or a
third-party system you didn't write — certified **CardConnect / CardPointe (Fiserv)** card payments behind one
small, neutral HTTP API. Run it on the merchant's own server, point a POS at it, and take live cards.

The software (this service and all of customPOS) is **free**. The only paid, opt-in piece is the certified
card integration itself — a small share of processing a merchant already pays a processor. That's the whole
business model: free software, funded by an honest processing rate for those who choose it.

---

## Why it's built this way (PCI SAQ-A — the card never touches you)

Card data never touches this service, the POS, or the browser's own code:

```
   Browser (any POS)                 This service (merchant's server)         CardConnect / Fiserv
   ─────────────────                 ────────────────────────────────         ────────────────────
   [hosted iFrame tokenizer]  ──card──────────────────────────────────────▶  tokenize  ──▶  TOKEN
        │  (or a registered terminal reads the tap/dip/swipe)                                  │
        ▼                                                                                      │
   token ──────────▶  POS backend  ──POST /charge {token, amountCents}──▶  charge the token ──▶ approved
```

1. The **browser** captures the card with the processor's **hosted iFrame** (card-not-present) or a
   **registered physical terminal** (card-present). Either way it produces a **token**, never a card number.
2. The **POS backend** calls this service with the token: `POST /charge`, `/refund`, `/void`.
3. This service speaks the certified CardConnect protocol and returns a **normalized** result.

Because raw card data goes straight from the browser to the processor, you (and the POS) stay in the smallest
PCI scope (**SAQ-A**). Keep card numbers out of your logs and you're done.

---

## Run it

```bash
# Simulator — no processor, no account. Integrate and demo end-to-end today:
PAY_KEY=devsecret node payments/pay-server.js        # or:  npm run pay

# Live CardConnect (UAT) — credentials from the environment, never the repo:
PAY_KEY=$(openssl rand -hex 24) \
PAY_PROVIDER=cardconnect CP_ENV=uat \
CP_SITE=yoursite CP_MID=496xxxxxxxxx CP_USER=apiuser CP_PASS=... \
  node payments/pay-server.js

# Production: CP_ENV=prod  (+ put it behind HTTPS — see "Deploy" below)
```

### Environment

| Var | What it is | From |
|---|---|---|
| `PAY_KEY` | Shared secret; callers send `Authorization: Bearer <PAY_KEY>` | you generate it |
| `PAY_PROVIDER` | `cardconnect` or `sim` (defaults to `cardconnect` when `CP_MID` is set, else `sim`) | you |
| `PAY_PORT` | Port to listen on (default `8091`) | you |
| `CP_ENV` | `uat` (testing) or `prod` (live) | you |
| `CP_SITE` | CardConnect site prefix | processor onboarding |
| `CP_MID` | Merchant ID (one per location) | processor onboarding |
| `CP_USER` / `CP_PASS` | Gateway API credentials | processor onboarding |
| `CP_TERM_HOST` / `CP_TERM_HSN` / `CP_TERM_KEY` | Physical-terminal host, serial, key | only if using a terminal |

With no `CP_*` vars set it runs the **simulator** (approves everything except any `$_.13` amount, which
declines) so a POS integration can be built and demoed before any merchant account exists.

---

## REST API

All amounts are **integer cents** (`1250` = $12.50) — this service converts to whatever the processor wants
(the gateway takes a dollar string, a terminal takes cents; you never deal with that). Every money endpoint
requires `Authorization: Bearer <PAY_KEY>`.

| Method & path | Body | Returns |
|---|---|---|
| `GET /health` | — | `{ ok, provider, mode, terminal }` (public) |
| `GET /tokenizer` | — | `{ url, mode }` — the hosted-iFrame URL to embed (public) |
| `POST /charge` | `{ amountCents, token, cvv?, expiry?, capture?, ecomind?, cof?, cofscheduled? }` | normalized result |
| `POST /refund` | `{ ref, amountCents? }` (omit amount = full refund) | normalized result |
| `POST /void` | `{ ref }` | normalized result |
| `GET /inquire/:ref` | — | normalized status |
| `POST /terminal/connect` | — | `{ status }` |
| `POST /terminal/charge` | `{ amountCents }` | normalized result (customer taps the terminal) |

**Normalized result** (identical shape for every provider, so the POS never parses processor fields):

```json
{ "status": "approved", "ref": "123456789012", "brand": "Visa", "last4": "1443",
  "amountCents": 1250, "authcode": "OK", "cvv": "M", "message": "Approval" }
```

`status` is one of `approved` · `declined` · `refunded` · `voided` · `error`. `ref` (the CardConnect
*retref*) is what you keep on the sale — it's what you pass back to `/refund` and `/void`.

### Example

```bash
# 1) browser tokenizes the card via GET /tokenizer's iFrame  ->  token "9418...1443"
# 2) charge it:
curl -sX POST http://localhost:8091/charge \
  -H "Authorization: Bearer $PAY_KEY" -H "Content-Type: application/json" \
  -d '{ "amountCents": 1250, "token": "9418594164541443", "cvv": "123", "ecomind": "E" }'
# -> { "status":"approved", "ref":"...", "brand":"Visa", "last4":"1443", ... }
```

---

## Integrate any POS

**customPOS** ships a processor-agnostic `PAYMENTS` interface (`charge` / `refund` / `void`) with a simulator
by default; point its adapter at this service's URL + `PAY_KEY` and it takes live cards with no engine changes
(see `docs/PAYMENTS-MODULE.md`).

**A third-party POS** integrates in two small steps — no SDK, no rewrite:

1. **Capture** — embed the iFrame from `GET /tokenizer` on your checkout page (or connect a terminal). You get a
   token back in the browser.
2. **Charge** — from your backend, `POST /charge` with that token and the amount in cents. Store the returned
   `ref` on the sale so you can `/refund` or `/void` later.

Anything that can POST JSON over HTTPS and show an iFrame can now take certified card payments.

---

## Bringing a new merchant live

The **software integration is certified once** (see `docs/PAYMENTS-MODULE.md` §7 and the validation runner
below) — you do **not** re-certify code per merchant. Each new merchant is account setup, not engineering:

1. **Board the merchant** with the processor → they get their own `CP_SITE` / `CP_MID` / `CP_USER` / `CP_PASS`
   (and, for card-present, a registered terminal → `CP_TERM_HSN` + key).
2. **Drop those into this service's environment** on their server. Never in the browser, the POS file, or git.
3. **(Optional) Smoke-test** their credentials in UAT before the first real sale:
   ```bash
   CP_ENV=uat CP_SITE=… CP_MID=… CP_USER=… CP_PASS=… node tools/validate-cardconnect.js
   ```
   It runs the full transaction gauntlet and prints every result — a 30-second confidence check that their MID
   and terminal are wired right.
4. **Flip `CP_ENV=prod`** and go live.

> Confirm with your CardConnect/Fiserv partner whether their program wants any per-merchant "welcome"
> transaction — some do, most don't once the integration is certified. That's the only piece outside this repo.

`tools/validate-cardconnect.js` is the one-command runner that earned (and re-checks) certification: it runs
card-not-present, customer-initiated, merchant-initiated/recurring, void, and full + partial refund fully
automated (add `--present` for the physical-terminal taps), and prints each *retref* mapped to the boxes on
Fiserv's Integration-Validation form.

---

## Deploy (before it faces the internet)

- **HTTPS only.** Put it behind a TLS reverse proxy (Caddy/nginx/a cloud load balancer). Caddy will get and
  renew the certificate for you.
- **Set `PAY_KEY`** to a long random secret and send it from the POS backend, not the browser. (The service
  warns loudly on startup if `PAY_KEY` is unset.)
- **Secrets live only in the server environment** — never in the repo, the browser bundle, or a downloaded POS.
- **Don't log card data.** Tokens and last4 are fine; never log a PAN or CVV.
- One service can serve one merchant (one MID); run one per merchant, or extend the adapter to select the MID
  per request if you're hosting many.

## Test

```bash
node tests/pay-server.js     # exercises the service end-to-end against the simulator (part of `npm test`)
```

*Part of [customPOS](../README.md). Free software, funded honestly.*
