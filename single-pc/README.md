# Ozark POS — Single-PC Edition

**One file. One computer. A whole dry-cleaning counter.**

This is the point of sale that ran a real two-store wet cleaner — drop-off, tagging, assembly, racking, pickup,
house accounts, a delivery route, payroll — from June to September 2026. On 30 September 2026 that shop moved to
its multi-computer successor, and this version was frozen. Instead of retiring it, we turned it into a single HTML
file anyone can run on one computer.

It is the same app that ran the shop. This edition only switches off the parts that needed a server, and says so on
screen. Free, MIT-licensed, no account, no subscription.

## Get it running (about two minutes)

1. **Download** [`ozark-pos-single-pc.html`](ozark-pos-single-pc.html) — from
   [custompos.org/single-pc.html](https://custompos.org/single-pc.html) ("Download the file"), or from this folder on
   GitHub (open the file, then the download button).
2. **Double-click it.** It opens in your web browser. Nothing installs, and it never needs the internet.
   - It was built and tested in **Google Chrome**. Microsoft Edge runs on the same engine. If your computer opens it
     in a different browser, right-click the file → **Open with** → Chrome.
   - **Open it the same way every time** — the same file, in the same browser. Your shop's data is kept by that
     browser (see below), so a different browser, or a private/incognito window, starts with an empty shop.
3. **Sign in** with one of the sample staff PINs:

   | who | PIN |
   |---|---|
   | Owner | **1234** |
   | Manager | **2222** |
   | Front Counter | **1111** |

   **Change them straight away** in ⚙ Admin → Employees. Anyone who reads this page knows these PINs.
4. **Make it yours:** ⚙ Admin → ⚙ Settings → **Stores** (your shop's name, address, ZIP, phone and tax rate —
   the ones in there are placeholders, with made-up 555 phone numbers) and ⚙ Admin → 🖨 Printing (receipt headers
   say YOUR CLEANERS until you change them). The receipt header is also the shop name printed on statements, bag
   tags, time slips and the payroll sheet.

The price book holds a dry cleaner's **sample prices**, not a recommendation — set your own in ⚙ Admin → 🏷️ Price
Book. There are no customers or orders until you add them. Three sample stores come set up (two counters and a
delivery route); a one-counter shop can remove the ones it doesn't need in Admin.

You can also **try it without downloading**: the "Try it in your browser" button on
[custompos.org/single-pc.html](https://custompos.org/single-pc.html) opens the same file. Anything you type there
stays in your own browser — the page sends nothing to us or anyone else.

## Where your data lives — please read this part

Everything is saved **inside this browser, on this computer**, every time something changes. **Nothing is copied
anywhere else.** That is what makes it private and able to run with no internet — and it also means:

- If the computer dies, or someone clears this browser's site data, **the shop's data is gone** unless you have a
  backup.
- **Back up often.** ⚙ Admin → ⚙ Settings → **⬇ Full backup (everything)** (owner only) downloads the whole shop as
  one `.json` file. Put copies somewhere else — a USB stick, another computer, your email. The Home screen shows when
  you last did it and turns **amber** if it has been more than a week (or never). Customers, orders, payments and
  the house-account ledger can also be downloaded as spreadsheets from the same place.
- **Restoring is the honest weak spot.** This edition has **no one-click restore** — the original app never needed
  one, because its server held the copies. Your backup file is the complete shop, in the same shape the
  multi-computer version's server keeps, so nothing in it is lost — but today, putting it back in takes someone
  comfortable with code. Back up anyway; a file you can't load with one click is far better than no file.
- **Starting over** after trying it out: back up first, then clear this site's data in the browser (in Chrome: the
  icon to the left of the address → Site settings → Delete data).

## What works

Quick drop-off → Detail → Assemble → Rack → Pickup, quotes, search, the route board, cash drawers, house accounts
and printed statements, the time clock and payroll, checklists, supplies, reports and the price book — the screens
the shop used every day.

**Payments:** cash, check, and **cards run on your own stand-alone card terminal** (any countertop machine or phone
reader). You run the card on the terminal as usual; the POS asks for the approval code the terminal gives you and
records the payment with it. The POS never charges a card by itself, and choosing "declined / not run" records
nothing.

## What it can't do on one computer

These need the shop's server (a "hub"), so in this edition they are **hidden** rather than left to fail:

texting customers · emailing statements · a card reader connected to the POS, pay links and saved cards · the
customer order tracker · website pickup, feedback and drop-box requests · photo storage · the long-term history
archive · QuickBooks · support tickets · setting up stations remotely · several computers sharing one shop.

The screens around those hidden controls say so too: nothing in this edition claims a customer was texted, and
drop-off tickets tell customers to ask for their total at pickup.

The file never contacts a server by itself. Every network call is refused before it leaves the browser — tap
**Single-PC Edition** in the top bar to see where your data is, the sample PINs, the limits, and how many calls were
refused. The one link that leaves the page is a route stop's 🧭 Navigate, which opens Google Maps in a new tab when
you tap it.

## Before you rely on it

It is the original shop's software, so a few things are still that shop's — change them or check them:

- The employee-rights screen states **Arkansas** rules (minimum wage, and the state and federal labor offices'
  numbers). Check your own state's.
- A Bible verse shows on the clock-in screen and on receipts by default. Receipts can turn it off in ⚙ Admin →
  🖨 Printing → Receipt.
- The daily, weekly and monthly checklists are that shop's routine. Edit them in ⚙ Admin.

## What's next

The shop that ran this version now runs on its successor, built for several computers at once. The next step for
customPOS is a **modular multi-station edition built from that newer system** — the hub-backed pieces above
(texting, a connected card reader, sharing one shop across computers) as parts you switch on. It isn't ready yet;
this folder will say so when it is.

## About this copy

Generated from the shop's private code by an exporter that first builds the public, name-free
[reference copy](../reference/ozark-pos/) (every real customer, employee, phone number, street address, server
address and payment reference replaced with invented ones), then runs that app's own test gates against this single
file before it is allowed out: 2,608 money assertions, 749 screen-render assertions, a dead-button check, and 40
single-PC checks (no network calls, no hub warnings, nothing that claims a text was sent, the shop's own name on
what it prints). The about-box, receipts and settings carry placeholder details — no real business's contact
information.

For developers: the tests in the reference copy test the multi-computer app. Pointed straight at this file they
report a handful of failures, because this edition renames the shop and its towns and doesn't promise texts. The
exporter runs them against this file with the same renames applied to the tests, and one assertion widened to accept
this edition's "Ask for your total at pickup" ticket line.

MIT licensed — see [LICENSE](LICENSE). Use it, change it, give it away.
