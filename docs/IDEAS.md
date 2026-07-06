# customPOS — Ideas Inbox

*A running capture of feature ideas — from the owner, from businesses using customPOS, from anyone. This is the
front of the [request loop](THE-MODEL.md#the-request-loop): ideas land here, get organized into the module
library, and become options every business can turn on. Nothing gets lost; nothing is too small.*

> How to add: append an entry. Note the concrete feature, the problem it solves, which **station/trigger** it
> lives on, and — if you can see it — the general **primitive** underneath (so we build it once and every trade
> configures it).

---

## Open ideas

### Clock-in welcome screen  ·  *from Brayden*
When an employee clocks in, greet them with a **welcome screen** — a short message with the **daily specials**
and a bit of **encouragement**. Owner-editable, changes day to day.
- **Problem it solves:** starts a shift on a human note; gets specials/announcements in front of every staffer
  without a huddle; makes the workplace feel cared-for and organized.
- **Station / trigger:** fires on **clock-in** (time-clock module); shows on whatever device that person signs
  in to.
- **Primitive underneath:** a **shift-briefing / triggered message** — a screen shown on a trigger that can
  carry specials, a daily goal, an announcement, or today's checklist. Generalizes far beyond this one use.
- **Cross-industry:** yes — every trade with staff (restaurant pre-shift specials, salon daily goal, retail
  today's promo, cleaner's rush-list).
- **Depth later:** per-role messages, acknowledge-to-continue, rotating tips, tie into the daily checklist.

### Staff "track my order & items"  ·  *from Brayden*
Let staff — a restaurant server, a counter clerk — **track their own order and its items** as they move through
the shop: where each item is on the path right now (in the kitchen, at the bar, on the rack, ready).
- **Problem it solves:** the server/clerk stops walking to the pass to check; they see live status and know
  exactly when to run the plate or call the customer.
- **Station / trigger:** a per-actor filter on the **status board** — "my orders" — reading live line stages.
- **Primitive underneath:** **status broadcast & notify** (#11) filtered to a performer — the same state machine
  that drives the customer tracker, pointed inward at the staff.
- **Cross-industry:** yes — any trade where one person owns an order that others work (restaurant, cleaner,
  repair, salon).

---

*More to come — keep them coming.*
