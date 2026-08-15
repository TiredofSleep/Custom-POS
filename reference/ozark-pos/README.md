# Ozark POS — a single-file point of sale, and the tests that hold it up

A production point-of-sale for a wet-cleaning plant and its delivery route: one HTML file, a
zero-dependency Node sync hub, and an optional desktop shell. It runs a real business — two stores, a
plant, a van — and has done since June 2026.

MIT licensed. Take any of it.

## What is actually interesting here

Not the POS. **The gates.** Seven harnesses that exist because something went wrong once and must not go
wrong again, each pinned to the failure that produced it:

| gate | what it refuses to let back in |
|---|---|
| `check-app-js.js` | a syntax error reaching a station |
| `test-money.js` | every money bug this shop has had — duplicate charges, expiry formats, refunds that never reached the card |
| `test-render.js` | a screen that throws, or prints `undefined` at a human |
| `test-render-live.js` | a build that passes every test and still dies on the REAL data |
| `check-dead-buttons.js` | a control wired to a function that does not exist |
| `test-hub.js` | the sync merge, delta pulls, and the rule that absence is never a delete |
| `audit-patterns.js` | flags set on the way in and cleared only on the happy path |

```bash
node check-app-js.js Ozark-POS.html && node test-money.js Ozark-POS.html \
  && node test-render.js Ozark-POS.html && node check-dead-buttons.js Ozark-POS.html && node test-hub.js
```

The comments are written for the next person to read at 2am. Where a rule exists because of an incident,
the incident is in the comment — that is deliberate, and it is most of the value.

## Running it

```bash
cp hub.env.example hub.env      # set OZARK_HUB_KEY at minimum
node hub-server.js              # serves the app and the sync API
```

Open `Ozark-POS.html`. It works offline; the hub is how devices agree with each other.

## ⚠️ About this copy

This is a **generated distribution**. Real customers, staff and phone numbers have been replaced with
fictional ones — every person you read about is invented, the events are not. The export refuses to run if
a known real name survives, and then runs the gates above against its own output, because a distribution
with no names in it that no longer works would be worse than not publishing at all.
