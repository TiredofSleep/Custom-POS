# PAYMENTS-MODULE.md — the card-payment module (the monetization core)

This is the design for customPOS's optional **card-payment module** — the piece described in
[THE-MODEL.md](THE-MODEL.md): the software is free, and the project sustains itself by earning a small share of
card processing through a processor-partner registration. This document is the **validated blueprint** for that
module, written from a real integration that has completed the processor's full transaction-scenario validation.

> **Public-repo rule (inherited from [CLAUDE.md](../CLAUDE.md)):** everything here is generic. No real merchant
> IDs, keys, hostnames of any live business, partner names, or negotiated pricing. A business's own credentials
> live only in **their** server's environment file — never in the downloaded HTML, never in this repo.

---

## 1. Where it sits in the engine/module/config split

Payments is an **ENGINE interface** with **pluggable adapter MODULES** and per-business **CONFIG**:

- **ENGINE** exposes one small, processor-agnostic interface (`pay`, `saveCard`, `refund`, `void`). The POS UI
  only ever calls this interface — it never knows which processor is behind it.
- **MODULE** = a processor adapter (CardConnect/CardPointe first; others can follow) that implements the
  interface. Adapters are swappable; the engine doesn't change when you add one.
- **CONFIG** = which adapter is enabled and the business's own credentials — supplied on the business's server,
  not baked into the downloaded file.

This keeps the single-file POS clean: **the browser never holds card data or secrets.** All processor calls
happen in the optional Node companion (the sync/hub server), which is the only place credentials live.

## 2. The golden rule: the browser never touches a card number

The design keeps the business **out of PCI scope** the easy way:

1. The card is captured by the **processor's own hosted field / tokenizer** (an iframe) or by a
   **registered physical terminal** — never by our HTML.
2. What comes back to the browser is a **token**, not a card number.
3. The **server** (holding the secret API key) exchanges that token for an authorization.
4. Our code stores only the **token + last four + brand** — never a PAN, never a CVV.

Because the raw card data never enters the merchant's page or database, the merchant qualifies for the
lightest-weight PCI self-assessment. This is a feature, not an afterthought — say so in the builder.

## 3. The engine-facing interface (processor-agnostic)

Every adapter implements the same shape. The engine calls these and gets a normalized result — it never sees
processor-specific fields.

```js
// A payments adapter implements this interface. Register one per business via CONFIG.
const PaymentsAdapter = {
  label: 'CardConnect',

  // Card-not-present: charge a token from the hosted tokenizer (iframe).
  charge(tokenOrCard, amountCents, ctx) { /* -> Result */ },

  // Card-present: start a sale on a registered terminal; the customer taps/dips/swipes.
  chargePresent(amountCents, ctx)        { /* -> Result */ },

  // Store a card for later (card-on-file) without (or with) a charge.
  saveCard(tokenOrCard, ctx)             { /* -> { token, last4, brand } */ },

  // Reverse an unsettled authorization (same day, before batch close).
  void(ref)                              { /* -> Result */ },

  // Return money on a settled transaction (or a partial amount of it).
  refund(ref, amountCents)               { /* -> Result */ },

  // Look up the current state of a transaction (for reconciliation).
  inquire(ref)                           { /* -> Result */ }
};

// Normalized result the engine understands, regardless of processor:
// { status: 'approved' | 'declined' | 'error',
//   ref,        // processor's retrieval reference (store this; refunds/voids need it)
//   auth,       // auth code
//   last4, brand,
//   token,      // reusable card-on-file token (never a PAN)
//   message }   // human-readable
```

The rest of the POS (pickup screen, drawer, refunds) only ever speaks this interface. Swapping processors is a
config change, not a code change.

## 4. Reference adapter — CardConnect / CardPointe

This is a faithful, **scrubbed** reference of the validated integration. It runs **server-side** (in the Node
companion), reads config from the environment, and is zero-dependency. Hostnames shown are the processor's
public developer-documented endpoints; **all credentials are placeholders**.

```js
'use strict';
const https = require('https');

// ---- CONFIG comes from the business's own server env — never hard-coded, never in the repo ----
const CP = {
  site: process.env.CP_SITE || '',          // your CardConnect site prefix
  mid:  process.env.CP_MID  || '',          // your Merchant ID
  user: process.env.CP_USER || '',          // gateway API user
  pass: process.env.CP_PASS || '',          // gateway API password
  env:  (process.env.CP_ENV || 'uat').toLowerCase()   // 'uat' (sandbox) | 'prod'
};
// Integrated terminal (card-present), if used:
const TERM = {
  host:    process.env.CP_TERM_HOST || 'boltgw-uat.cardpointe.com', // public gateway host
  hsn:     process.env.CP_TERM_HSN  || '',   // terminal hardware serial number
  authkey: process.env.CP_TERM_KEY  || ''    // terminal API auth key
};

const gwHost = () => CP.env === 'prod' ? `${CP.site}.cardconnect.com` : `${CP.site}-uat.cardconnect.com`;
const authHeader = () => 'Basic ' + Buffer.from(`${CP.user}:${CP.pass}`).toString('base64');
const dollars = (cents) => (Math.round(Number(cents) || 0) / 100).toFixed(2);  // gateway wants a dollar string

function req(method, host, path, headers, bodyObj) {
  return new Promise((resolve) => {
    const data = bodyObj ? JSON.stringify(bodyObj) : null;
    const opts = { method, host, path, headers: Object.assign({ 'Content-Type': 'application/json' }, headers) };
    if (data) opts.headers['Content-Length'] = Buffer.byteLength(data);
    const r = https.request(opts, (res) => {
      let buf = ''; res.on('data', d => buf += d);
      res.on('end', () => { let j = null; try { j = JSON.parse(buf); } catch (_) {} resolve({ status: res.statusCode, json: j, headers: res.headers }); });
    });
    r.on('error', (e) => resolve({ status: 0, error: e.message }));
    r.setTimeout(120000, () => { r.destroy(); resolve({ status: 0, error: 'timeout (no card presented?)' }); });
    if (data) r.write(data); r.end();
  });
}

// Normalize any gateway response to the engine's Result shape. respstat: A=approved, C=declined, B=retry.
function normalize(j) {
  if (!j) return { status: 'error', message: 'no response' };
  const last4 = String(j.account || j.token || '').replace(/\D/g, '').slice(-4);
  return {
    status:  j.respstat === 'A' ? 'approved' : (j.respstat === 'C' ? 'declined' : 'error'),
    ref:     j.retref || '',
    auth:    j.authcode || '',
    last4,
    brand:   (j.binInfo && (j.binInfo.product || j.binInfo.brand)) || 'Card',
    token:   j.token || j.account || '',
    message: j.resptext || ''
  };
}

// --- Card-not-present: auth + capture a token in one call ---
// ecomind 'E' = card-not-present (required by the stored-credential mandate for online/keyed).
// For a stored card being reused, pass cof:'C' (customer-initiated) or 'M' (merchant-initiated) + cofscheduled.
function charge(token, amountCents, opts = {}) {
  const body = {
    merchid: CP.mid, account: token, amount: dollars(amountCents), currency: 'USD',
    capture: 'Y', ecomind: opts.ecomind || 'E'
  };
  if (opts.expiry) body.expiry = opts.expiry;      // MMYY, when charging a tokenized PAN
  if (opts.cvv2)   body.cvv2   = opts.cvv2;
  if (opts.postal) body.postal = opts.postal;      // AVS — better rates
  if (opts.cof)  { body.cof = opts.cof; body.cofscheduled = opts.cofscheduled || 'N'; }
  return req('PUT', gwHost(), '/cardconnect/rest/auth', { Authorization: authHeader() }, body)
    .then(r => r.json ? normalize(r.json) : { status: 'error', message: 'HTTP ' + r.status });
}

function voidTxn(ref) {
  return req('PUT', gwHost(), '/cardconnect/rest/void', { Authorization: authHeader() }, { merchid: CP.mid, retref: ref })
    .then(r => normalize(r.json));
}

// Refund a SETTLED transaction (or a partial amount of it). Before settlement, void instead.
function refund(ref, amountCents) {
  return req('PUT', gwHost(), '/cardconnect/rest/refund', { Authorization: authHeader() },
    { merchid: CP.mid, retref: ref, amount: dollars(amountCents) }).then(r => normalize(r.json));
}

function inquire(ref) {
  return req('GET', gwHost(), `/cardconnect/rest/inquire/${encodeURIComponent(ref)}/${encodeURIComponent(CP.mid)}`,
    { Authorization: authHeader() }, null).then(r => normalize(r.json));
}

// --- Card-present: open a session with a registered terminal, then read+authorize on a tap/dip/swipe ---
let _session = { key: '', exp: 0 };
function termConnect() {
  const now = Date.now();
  if (_session.key && _session.exp > now + 5000) return Promise.resolve(_session.key);
  return req('POST', TERM.host, '/api/v2/connect', { Authorization: TERM.authkey },
    { hsn: TERM.hsn, merchantId: CP.mid, force: true }).then(r => {
      const raw = r.headers && r.headers['x-cardconnect-sessionkey'];
      if (!raw) return '';
      const key = String(raw).split(';')[0].trim();
      _session = { key, exp: now + 540000 };
      return key;
    });
}
function chargePresent(amountCents) {
  return termConnect().then(sk => {
    if (!sk) return { status: 'error', message: 'terminal not reachable' };
    // v4 authCard: amount in CENTS (integer), capture as a JSON boolean.
    return req('POST', TERM.host, '/api/v4/authCard',
      { Authorization: TERM.authkey, 'X-CardConnect-SessionKey': sk },
      { merchantId: CP.mid, hsn: TERM.hsn, amount: Math.round(amountCents), capture: true })
      .then(r => (r.json && r.json.respstat) ? normalize(r.json)
        : { status: 'error', message: (r.json && r.json.errorMessage) || 'terminal error' });
  });
}

module.exports = { label: 'CardConnect', charge, chargePresent, void: voidTxn, refund, inquire, saveCard: charge };
```

### Gotchas worth carrying forward (learned during validation)

- **Gateway amount is a dollar *string*** (`"12.50"`); the **terminal amount is integer *cents*** (`1250`). Two
  different conventions in the same processor — easy to get wrong.
- **`capture` is `"Y"` on the gateway but a JSON boolean `true` on the terminal.**
- **Refund needs a *settled* transaction.** Before the batch settles (default late-evening), a refund returns
  "txn not settled" — you **void** instead. Build both paths and pick based on settlement state.
- **Card-present connect is a `POST` with a JSON body**, and the session key comes back in a **response header**,
  not the body.
- **Stored credentials (card-on-file / recurring)** use `cof` + `cofscheduled`. The first, credential-establishing
  charge is customer-initiated (`cof:'C'`); later automatic charges are merchant-initiated (`cof:'M'`).

## 5. Configuration (per business, on their server only)

| Env var | What it is | Where it comes from |
|---|---|---|
| `CP_SITE` | CardConnect site prefix | processor onboarding |
| `CP_MID` | Merchant ID | processor onboarding (one per location) |
| `CP_USER` / `CP_PASS` | Gateway API credentials | processor onboarding |
| `CP_ENV` | `uat` (sandbox) or `prod` | you — start in `uat` |
| `CP_TERM_HOST` / `CP_TERM_HSN` / `CP_TERM_KEY` | Integrated-terminal host, serial, key | only if using a physical terminal |

The builder should collect **nothing** here — it ships a demo/simulator adapter. A real business wires these on
their own server when they choose to accept cards. **Secrets never enter the downloaded HTML or this repo.**

## 6. Refund safety (an engine principle, not just a processor detail)

Refunds are a classic internal-theft vector. The validated origin app locks them down and the engine should
inherit that:

- **No typed dollar amounts.** A refund is either the **whole order** or **specific line items ticked from the
  ticket** — the amount is always *computed from real ticket data*, never keyed in.
- **Already-refunded items are disabled** so nothing can be refunded twice.
- **Refunds are owner-approved.** Staff *request*; the owner approves; only then does money move. Both a void and
  a no-charge "redo" of the order stay behind that approval.

This belongs in the engine's order/refund logic, with the payments adapter only doing the money movement.

## 7. Validation status

The reference integration has completed the processor's full transaction-scenario validation:

- **Card-present** (approval + an intentional decline), **card-not-present** (multiple brands),
- **Void**, **refund** (full **and** partial),
- **Card-on-file** (store-with-charge, store-only, stored-token reuse),
- **Merchant-initiated / recurring** (establish, scheduled reuse, unscheduled reuse).

That means the flows in this document are proven end-to-end against the processor's sandbox — not theoretical.
The module can be built against this blueprint with confidence.

## 8. Build order (suggested, for Phase 5)

1. Ship a **simulator adapter** (no processor) so the POS works out of the box and the builder can demo checkout.
2. Add the **CardConnect adapter** above behind the engine interface.
3. Wire the **hosted tokenizer iframe** for card-not-present, and **terminal connect + authCard** for
   card-present.
4. Add **card-on-file** (save token) and **refund/void** using the same interface.
5. Keep every processor-specific field inside the adapter; the engine stays processor-agnostic.
