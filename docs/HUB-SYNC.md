# Hub sync — how several devices share one POS

customPOS is **local-first**: a downloaded POS keeps all its data in the browser and works with no server at
all. The **hub** (`hub.js`) is *optional* — turn it on only when you want several devices (registers, a kitchen
display, a back office) to share one live POS. This doc explains exactly how sync behaves, how conflicts are
resolved, and how to secure the hub before it touches the internet.

## Turning it on

A device syncs only when a hub URL is present, in one of three ways (checked in this order):

1. `?hub=https://hub.example.com` in the URL,
2. `window.CUSTOMPOS_HUB` set on the page,
3. `localStorage['custompos_hub']`.

No hub configured → the POS is 100% local and never makes a network call for data. This is opt-in by design.

## The data flow

- **Push:** every local save (`saveDB`) POSTs the whole DB to `/api/db`. The hub merges it into the shared
  store and returns the merged DB, which the device adopts.
- **Pull:** each device polls `GET /api/db` every 3 seconds and adopts the merged store.
- **Persistence:** the hub writes the store to a JSON file (`hub-data/db.json` by default), so it survives a
  restart.

Polling every 3s is deliberate for the reference hub — it's simple, robust, and fine for a handful of devices on
a shop LAN. For larger or higher-frequency deployments, a WebSocket/SSE push channel is the natural upgrade (the
merge semantics below stay the same); it just replaces the poll.

## Conflict resolution — version-aware last-write-wins

The store is a **union merged by record id**:

- **Records** upsert by `id`. Each record carries `upd`, a modification timestamp the client stamps whenever the
  record's *content* changes (see `saveDB` — it diffs each record against the last saved copy and bumps `upd`
  only on a real change, so no-op saves don't churn it). On merge, the hub keeps the copy with the **newer
  `upd`**. A device that pushes a **stale** copy of a record (older `upd`) therefore **cannot clobber** a newer
  edit made on another device. Records with no `upd` fall back to plain last-write-wins (the incoming write).
- **Customers** upsert by `phone`.
- **`seq`** (the order-number counter) takes the **max** of the two, so numbers never go backwards.

**What this does and doesn't guarantee.** It guarantees that a lagging device can't overwrite fresher data at the
*record* granularity — the common real-world hazard (a back-office tab that hasn't refreshed pushing an old order
state). It does **not** do field-level three-way merging: if two devices edit the *same* record inside the same
few-second window, the later `upd` wins for that whole record. For a small shop where one register owns a ticket
at a time, that's the right, predictable behavior. If you need per-field merging, that's a future enhancement, not
a silent gap — it's called out here on purpose.

The merge is unit-tested in [`tests/hub-merge.js`](../tests/hub-merge.js) (newer-wins, stale-rejected, union-add,
no-upd fallback, customer upsert, seq-max) and end-to-end in [`tests/sync.js`](../tests/sync.js).

## Security & auth

The **reference hub ships open** (no auth) so it's trivial to run on a trusted LAN: `node hub.js`, point devices
at `http://<host>:8090`. It already refuses path traversal on static files and caps request bodies.

**Before exposing a hub to the internet, you must add two things:**

1. **HTTPS** — put it behind a TLS-terminating reverse proxy (Caddy, nginx, a cloud load balancer). Caddy will
   even get and renew the certificate automatically.
2. **An access key** — gate `/api/db` on a shared secret (e.g. require an `Authorization: Bearer <key>` header or
   a `?key=` that matches an env var), and send that key from each device. The production origin app this project
   was generalized from uses exactly this pattern (a hub key held only in the server's env, never in the
   browser bundle). Keep the key in the hub's environment (`HUB_KEY=…`), not in the repo or the downloaded file.

**Secrets never live in the hub or the browser.** Card-processor credentials belong only to a payments adapter's
own server environment (see [PAYMENTS-MODULE.md](PAYMENTS-MODULE.md)); the hub only ever holds business data, and
that business data belongs to the owner — export it any time from the back office (Data & backup).

## Cost

The software is free. A hub is the only piece that costs anything to run, and only if you want cross-device sync:
a small always-on server (a few dollars a month). One computer? Skip the hub entirely — the POS is complete on
its own.
