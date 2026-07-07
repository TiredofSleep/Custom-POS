# Restaurant Vertical Design Notes

> **Status (reconciled against the current build, engine v0.45).** Design intent handed over from a ClaudeChat
> session — *not* implementation-ready. Some already exists; the rest is roadmap.
>
> **Already shipped (configure, don't rebuild):** per-item routing + **fan-out** (production stations), an
> interactive **Kitchen Display (KDS)** with bump + aging prep timers, the **pre-shift welcome/briefing**
> (time-clock welcome: message + specials; ack-to-continue is the depth-later), **86 / par** counts, **split
> checks**, **tips + per-provider commission**, a **status board** + customer/staff **order tracker**,
> **capacity/pacing**, and item **modifiers / add-ons / flags** (a lightweight item wizard).
>
> **✅ Shipped since this doc arrived (v0.40):** the **floor / table state machine** — a `floor` station with a
> config-driven table grid (`FLOW.floor.tables`), a default restaurant state flow (Empty→Seated→Greeted→Ordered→
> Food out→Check→Paid→Bussing, each with a color + `next`, overridable via `FLOW.floor.states`), minutes-in-state
> timers with a warn-pulse, section filter (server vs. manager view), tap-to-advance / jump-to-any-state, and a
> "Full-service restaurant" builder template. It's the general spatial primitive (a table = a salon chair, an
> auto bay, a spa room). The **drag-drop floor designer** now ships too (v0.42) — a builder canvas where you add
> tables and drag them to lay out the real room (x,y persisted; the engine renders the spatial layout). Also
> shipped: **course pacing / hold-until** (v0.41), and **table turn-time analytics** (v0.45) — a turn runs
> seated→cleared and the floor shows **turns today / average turn / covers served** (section filter already
> scopes the view). Still net-new: per-section turn breakdown + a seat-time SLA.
>
> **Net-new (this doc's real value):** the **section auto-sorter**, **printers as
> first-class flow nodes** + a print-format editor,
> **bidirectional push** to servers (beyond board/tracker), and **category-level menu wizards** + menu import
> (CSV/OCR/URL/PDF). Split checks exist but only "evenly N ways" — by-seat / by-item is net-new.
>
> **Suggested first slice:** the **table state machine + a simple floor grid** (generalizes to salon chairs,
> auto bays, spa rooms per §"What Generalizes") or **course pacing** — both build on the existing station/KDS
> primitives. Keep every piece a general primitive with per-vertical config.

Handoff document for ClaudeCode to pick up when restaurant vertical work resumes. Captures design decisions and architectural direction for the restaurant template beyond what's currently in the burgerbarn config.

Not implementation-ready. Design intent that needs to be turned into config schema, primitives, and UI as we build.

## Core Concept

Restaurant POS is not just item entry and payment. It's floor management, service flow, and station coordination happening in real time. Current restaurant POS software treats tables as list items and ignores the spatial and temporal reality of how restaurants actually run. CustomPOS restaurant vertical should model what's actually happening on the floor.

Two big pieces:

1. **Spatial floor plan** — servers and managers see the actual layout of the restaurant, tables change state visually, sections are assigned pre-shift
2. **Station flow designer** — owners configure how orders route from station to station (including printers), what triggers transitions between stations, and how completions bubble back to servers

Both are grid-based visual designers. Both should feel more like designing a physical space than configuring software.

## Spatial Floor Plan

### Floor Plan Designer (Owner Configuration)

Grid-based drag-and-drop. Owner places table shapes on a canvas representing their floor.

**Table types available:**
- 2-top (round or square)
- 4-top (round or square)
- 6-top
- 8-top
- Booth (2, 4, 6)
- Round (6, 8, 10)
- Bar seats (individual, numbered)
- Custom shape (for weird spaces)

**Per-table configuration:**
- Table number (auto-assigned or manual override)
- Section assignment (default section, overridable per shift)
- Notes ("bad table near kitchen", "window table", "VIP table")
- Capacity (default from shape, overridable)

**Sections:**
- Owner defines named sections (main dining, patio, bar, private room)
- Tables assigned to sections
- Sections can be enabled/disabled per shift (patio closed in winter)

**Floor plan persistence:**
- Saved as JSON in the config
- Multiple floor plans supported (lunch layout vs. dinner layout, holiday configurations)
- Owner can toggle between layouts

### Server View

Server clocks in, sees welcome screen (details in Pre-Shift section below), then sees their assigned section.

**Server-view characteristics:**
- Only their tables visible, larger and more prominent
- Other sections shown grayed out for context but not interactive
- Constant real-time updates
- Tap a table to see its current state and take action
- Visual indicators for what needs attention (color coding below)

### Manager View

Manager sees whole floor at once.

**Manager-view characteristics:**
- All tables visible at scale
- Color coding shows state at a glance
- Response time indicators (numbers on tables showing minutes since last state change)
- Tap into any table for details
- Section totals (revenue, covers, average check) visible per section
- Alerts for tables lingering too long in any state

### Table States and Color Coding

Each table has a current state. States transition based on server actions and time.

**States:**
- **Empty** — no customers, ready for seating (default color, probably light gray)
- **Assigned** — host sat customers but server hasn't greeted (yellow, urgent)
- **Greeted** — server introduced themselves, drinks ordered (light blue)
- **Ordered** — food ordered, waiting for kitchen (blue)
- **Food out** — food delivered, active eating (green, calm)
- **Check requested** — server dropped check (light orange)
- **Paid** — payment complete, waiting for guests to leave (dark orange)
- **Bussing** — guests left, table being cleaned (purple)

**Timers:**
- Each state transition captures timestamp
- Manager view shows minutes-in-current-state on each table
- Configurable warning thresholds ("alert if table has been in 'greeted' for more than 5 minutes")
- Warnings shown as pulsing borders or flashing indicators

## Section Assignment (Auto-Sorter)

Pre-shift, system reads who has clocked in and assigns sections based on configured rules.

**Configuration options (owner-defined):**
- Balance tables per server (equal count) OR balance seats per server (equal capacity)
- Section rotation over shifts (fair distribution over time, not just this shift)
- Server preferences (Sarah always wants section 3 if she's working)
- Experience levels (new servers get smaller/easier sections)
- Blackout rules (don't put trainees on VIP tables)

**Handling call-outs mid-shift:**
- If a server leaves during shift, their section auto-redistributes
- Manager can override manually
- History preserved (who had what section when)

**Analytics fed back to auto-sorter:**
- Server performance by section (average check, tip percentage, table turn time)
- Over time, system learns which servers do well with which sections
- Suggestions ("Alex has 15% higher check average in section 4") without forcing

## Pre-Shift Greeting

When server clocks in, they see a welcome screen before entering service mode.

**Content:**
- Personal greeting ("Welcome back, Sarah")
- Their section assignment for the shift
- Today's specials (with descriptions and prices)
- Current 86 list (items unavailable today)
- Any special instructions from management ("we're testing the new dessert menu — push it")
- Reservations or large parties expected in their section
- Weather/event context ("Razorbacks game today, expect walk-ins from 6pm")

**Format:**
- Full-screen takeover, hard to skip
- Requires tap-through acknowledgment on specials and 86 list (confirms server has read)
- Estimated read time under 60 seconds
- Content configured by manager pre-shift

**Data captured:**
- Timestamp of clock-in
- Time to complete pre-shift briefing (how long they actually looked at it)
- Which items they acknowledged

## Station Flow Designer

This is the bigger architectural piece and connects to the existing visual flow work but extends it significantly.

### Current State

We already have visual flow from workstation to workstation. Need to extend to include:
- Printers as flow endpoints
- Owner-designed routing rules
- Bidirectional updates (station marks complete → server notified)
- Grid-based visual arranger

### Station Flow Designer (Owner Configuration)

Grid-based canvas where owner places stations and printers, then draws routing rules between them.

**Node types:**
- **Server stations** — where orders are taken (POS terminals)
- **Line cook stations** — where hot food is prepared (screens or printers)
- **Cold station** — salads, cold prep
- **Bar station** — drinks
- **Expo station** — where food is checked before delivery
- **Dessert station**
- **Printer nodes** — physical printers at specific stations
- **Custom stations** — owner-defined (pizza oven, sushi bar, etc.)

**Per-node configuration:**
- Node name and type
- Which items route to this node (by category or item flag)
- Screen or printer (which physical device)
- Timing rules ("hold this station's items until entrees fire")
- Priority (which orders get pulled first)

### Routing Rules

Owner draws connections between nodes showing where orders flow.

**Rule examples:**
- All appetizers route from server stations to line cook screen
- Salads route from server stations to salad station printer AND expo screen (fan-out)
- Hot entrees route from server stations to line cook screen, then to expo when marked complete
- Drinks route from server stations to bar printer
- Desserts hold until entrees complete, then route to dessert station

**Fan-out patterns:**
- Single order routes to multiple stations simultaneously
- Different items in one order route to different stations
- Same item can route to multiple stations (e.g., a burger prints on line cook screen AND salad station because it comes with side salad)

**Fan-in patterns:**
- Order status waits for all stations to mark complete before signaling server
- OR order status updates progressively (drinks ready, entrees still cooking)
- Configurable per station

### Bidirectional Updates

Critical piece: when stations mark complete, updates bubble back to servers automatically.

**Flow example:**
1. Server enters order at server station
2. Ticket fans out to line cook screen (hot items), salad station printer (salads), bar printer (drinks)
3. Bar completes drinks first → server sees "drinks ready for table 7"
4. Salad station marks salads complete → server sees "salads ready for table 7"
5. Line cook marks entrees complete → server sees "entrees ready for table 7"
6. When all complete, table status auto-updates to "food out" when server delivers

**Server-side experience:**
- Notifications appear on server's tablet/phone
- Sound/vibration options
- Prioritized by table (their tables first)
- Can dismiss or snooze notifications

**Station-side experience:**
- Line cook screen shows tickets in fire order
- Mark complete with single tap
- See what's coming next
- Timer per ticket showing how long it's been active

### Grid-Based Arranger

The station flow designer is a visual canvas.

**Canvas features:**
- Drag stations onto canvas
- Draw connection arrows between stations
- Configure routing rules per connection
- Test mode: send a sample ticket through the flow, see how it routes visually
- Save/load flow configurations

**Preset templates:**
- Quick service (counter → kitchen → pickup)
- Full service casual (server → kitchen/bar → server delivery)
- Fine dining (server → multiple prep stations → expo → server delivery with course pacing)
- Bar (server → bar → server delivery)
- Owner starts from template and customizes

## Printer Integration

Printers are first-class nodes in the flow.

**Printer configuration:**
- Physical location (which station)
- Network address (IP or Bluetooth)
- Print format (ticket layout, font size, character width)
- Header/footer customization
- What triggers printing (immediate, batched, timed)

**Print format editor:**
- Owner designs what each ticket looks like
- Different formats per printer if desired
- Variables inserted for order data (table, server, items, modifiers, time)
- Preview mode

**Reliability:**
- Print job queue with retry on failure
- Manual reprint option
- Alert if printer offline
- Fallback to nearest screen if printer fails

## Menu Item Wizards

Each menu item is configured through a wizard, not a generic form. Wizards are defined by category, with item-level overrides possible.

Rationale: filling in generic fields ("name, price, modifiers") makes owners think about database columns. Wizards ask the questions that actually matter for that category of item, in the order that makes sense for that category.

### Category-Level Wizards

Owner defines menu categories, each category has its own wizard flow. Sandwiches wizard asks different questions than steaks wizard.

**Sandwich wizard example:**
- Name and description
- Base bread choice (single, multi-select, or fixed)
- Protein options (required or optional)
- Cheese options (which, how many included, upcharge for extra)
- Standard toppings (list, defaults on, customer can remove)
- Premium toppings (list, defaults off, upcharge per)
- Condiments (unlimited or capped)
- Side included or upsell prompt
- Size variants (regular, large, kids) with price deltas
- Preparation notes to kitchen (toasted, pressed, etc.)
- Route to which stations (defaults from category)

**Steak wizard example:**
- Name and description
- Cut and weight
- Temperature required (must ask, no default)
- Sauce options (included choices, premium options)
- Side selections (usually two, with tiers of options)
- Preparation notes (butter basted, blackened, etc.)
- Timing note (fires with entrees or holds)
- Route to grill station, expo

**Salad wizard example:**
- Base greens
- Included ingredients (list)
- Protein options (add-on with pricing)
- Dressing choices (multi-select single default)
- Bread service (included or side)
- Half or full portion pricing
- Route to cold station

**Drink wizard example:**
- Type (soda, tea, coffee, cocktail, wine, beer)
- Size options with pricing
- Modifications (ice level, sweetener, milk type)
- Refills included yes/no
- Alcohol flag (triggers age verification)
- Route to bar or server station

**Dessert wizard example:**
- Base item
- Add-ons (ice cream, sauce, whipped cream)
- Sharing option (split price or per-plate)
- Timing (fires immediately or holds until entrees complete)
- Route to dessert station

### Item-Level Overrides

Individual items can override category defaults.

**Example: sandwiches category defaults, but The Big Boss overrides:**
- Locked bread type (only available on sourdough, not customer-choosable)
- Custom modifier group (specialty sauce not available on other sandwiches)
- Different routing (Big Boss fires from line cook screen, other sandwiches from cold station)
- Special preparation flag (fires slower, tell server to warn about wait)

### Wizard Builder for Owners

Owner defines wizards themselves, not just uses pre-built templates.

**Wizard designer:**
- Grid-based step editor (like the flow designer)
- Add steps: text field, single-select, multi-select, checkbox group, numeric, price adjustment
- Configure required vs. optional per step
- Set conditional logic (if X selected, show step Y)
- Preview the wizard as an operator would experience it during item entry

**Common step types:**
- Free text (name, description, kitchen notes)
- Single selection (bread type, temperature)
- Multi-selection with count limits (choose two sides from list)
- Multi-selection unlimited (toppings)
- Add-on with pricing (extra cheese +$1.50)
- Substitution (swap fries for salad, no charge)
- Yes/no toggle (toasted, dressing on side)
- Numeric (weight, portion count)
- Photo upload (item photo for POS display)

### Wizard Templates

Ship with pre-built wizards for common categories that owners can start from and customize.

**Included templates:**
- Sandwich
- Burger
- Salad
- Soup
- Steak
- Fish
- Pasta
- Pizza (with topping matrix)
- Sushi (with roll variations)
- Appetizer
- Dessert
- Drink (soft, coffee, tea)
- Beer
- Wine (by glass, by bottle)
- Cocktail (with modifications)

Owner picks template, customizes to their menu, saves as their version. Subsequent items in same category use their customized wizard.

### Menu Import from Existing Sources

For restaurants migrating from other systems, wizard flows should accept import from:
- CSV export from existing POS
- Menu photos (OCR + AI structuring)
- Website menu URL (scrape and structure)
- PDF menu

Import creates draft items with category assignments and lets owner walk each through the wizard to fill in the missing configuration.

### Data Model for Menu Items

Each menu item stores:
- Category (references wizard template)
- Configured values from wizard
- Override flags (which category defaults are overridden)
- Routing rules (which stations, from category or overridden)
- Price (base plus modifiers)
- Availability (in stock, 86'd, seasonal)
- Photos and description
- Kitchen notes
- Preparation time estimate

The wizard values become the modifier and option data the POS uses at order entry time.

## Data Model Additions

New concepts the engine needs to support:

**Table:**
- Unique ID
- Position (x, y on floor plan)
- Shape and capacity
- Section assignment
- Current state
- State history (timestamps of transitions)
- Current server (if any)
- Current ticket (if any)

**Section:**
- Name
- Tables (list of table IDs)
- Server assignment (rotates per shift)

**Shift:**
- Start and end times
- Servers clocked in
- Section assignments (from auto-sorter)
- Pre-shift briefing content
- Section changes during shift (call-outs)

**Station:**
- Type (server, line cook, cold, bar, expo, printer, custom)
- Physical device
- Item routing rules
- Position in flow

**Flow Rule:**
- Source station
- Destination station(s)
- Item criteria (which items follow this rule)
- Trigger (immediate, on completion of previous, timed)
- Fan-out or sequential

**Order:**
- Existing structure plus:
- Current stations (list of stations this order is active at)
- Completion status per station
- Overall status derived from station statuses

## Restaurant-Specific Primitives to Add

New primitives beyond the current 14 to support this vertical:

**Spatial:** floor plan, section, table state machine
**Flow routing:** station graph, routing rules, fan-out/fan-in
**Shift management:** clock in/out, section assignment, pre-shift briefing
**Course pacing:** hold-until rules, coursing (fire appetizers, then hold entrees until app finish)
**Split checks:** by item, by seat, by percentage, by dollar amount
**Tip management:** tip pool, tip-out percentages to support staff, credit card tip adjustment

Some of these might already be primitives under different names. Verify against the current primitive list.

## UI/UX Considerations

**Server experience during service:**
- Fast. Every tap saves seconds. Servers are running.
- Big touch targets. They're using this while carrying things.
- Minimize modal dialogs. Interruption is expensive.
- Voice or haptic feedback for confirmation without looking.
- Landscape and portrait orientations. Servers use both.

**Manager experience:**
- Whole floor visible at once. Don't force scrolling to see the room.
- Response times prominent. Slow tables are the primary alert.
- Drill-down available but not required. Manager should be able to run the shift from the overview.
- Analytics accessible during shift for quick decisions.

**Kitchen experience:**
- Line cooks are also running. Same UX principles as servers.
- Screens should be readable from a distance (bigger fonts than typical).
- Color coding for age of ticket (green new, yellow getting old, red overdue).
- Sound options for new tickets.

## Testing Considerations

**Multi-station scenarios:**
- Order enters at server station, fans out to three stations, all complete, server notified
- Order enters, one station marks complete, waits for others
- Order enters, station is offline, retry logic works
- Server station goes offline mid-order, order recovers
- Two servers try to modify same table simultaneously

**Floor plan edge cases:**
- Very large floor plans (100+ tables)
- Sections with no tables (patio closed)
- Overlapping tables (bad layout, should warn)
- Custom shape rendering across different screen sizes

**Auto-sorter edge cases:**
- More servers than sections
- Fewer servers than sections
- Server no-shows
- Mid-shift call-outs
- Trainees clocking in

## Priority Order

When work resumes on restaurant vertical, suggested order:

1. **Floor plan designer and rendering** — visual foundation for everything else
2. **Table state machine and visual updates** — makes the floor plan interactive
3. **Server section view vs. manager whole-floor view** — different perspectives from same data
4. **Section auto-sorter with configurable rules** — pre-shift automation
5. **Pre-shift briefing screen** — welcome content for servers
6. **Station flow designer extension** — grid-based visual editor for routing
7. **Printer integration** — printers as first-class nodes
8. **Bidirectional updates** — completions bubble back to servers
9. **Course pacing and hold rules** — fine dining timing
10. **Split checks and tip management** — payment complexity specific to restaurants

## What Generalizes Beyond Restaurants

Everything in this document generalizes. The restaurant vertical is the deepest exercise of the platform, but the primitives it needs are the primitives every service business needs. Build general, configure per vertical.

Spatial floor plan primitive generalizes to:
- Salons (chairs and stations)
- Spas (rooms and beds)
- Auto shops (bays)
- Tattoo shops (stations)
- Medical/veterinary offices (exam rooms)
- Hotels (rooms, if extending to hospitality)

Station flow designer generalizes to:
- Any business with multi-step production (dry cleaner already has stations)
- Salons with wash/cut/color/dry stations
- Any custom manufacturing (t-shirt printing has design/print/press/finish stations)
- Auto shops (intake, diagnostic, repair, quality check, pickup)
- Moving companies (quote, load, transport, deliver, unload, complete)

Section auto-sorter generalizes to:
- Any staffed business with territory assignments
- Delivery route assignments (moving companies, dry cleaning)
- Chair assignments in salons
- Bay assignments in auto shops
- Room assignments in spas

Pre-shift briefing generalizes to:
- Any staffed business
- Different content per vertical but same primitive
- Retail (today's promotions, focus items, staffing changes)
- Service businesses (today's appointments, VIP clients, special instructions)
- Trade businesses (today's jobs, safety notes, equipment status)

Menu item wizards are actually service-item wizards. The pattern generalizes to any business that sells configurable products or services:
- Coffee shop drinks (size, milk, sweetener, shots, temperature)
- Salon services (cut, color, treatment options with different questions each)
- Auto shop services (oil change, brake service, diagnostic each have different intake questions)
- Dry cleaning garments (shirt vs. dress vs. leather each have different intake)
- Tattoo work (custom vs. flash, sizing, placement, session length)
- Moving jobs (residential vs. commercial, size, distance, packing services)
- T-shirt printing (single vs. batch, sizes, colors, print locations, artwork type)

Each vertical defines its own service-item wizard templates. Owner customizes for their specific business. Same primitive across all verticals.

Table state machine generalizes to any spatial workflow with states over time:
- Salon chair (empty, client in, service in progress, service complete, cleaning)
- Auto bay (empty, vehicle in, diagnostic, work in progress, quality check, ready for pickup)
- Spa room (empty, prepared, client in, treatment, cleanup)
- Medical exam room (empty, prepped, patient waiting, exam in progress, patient dismissed, being cleaned)
- Tattoo station (empty, client consultation, work in progress, aftercare, station cleanup)

Build these as general primitives with per-vertical configurations, not as restaurant-only features. That preserves the multi-vertical architecture and means every improvement to a primitive benefits every vertical that uses it.

## Notes and Open Questions

Some things to think through as design continues:

**Sync considerations:** Table state changes must propagate fast across all devices seeing that table. Server marks table paid, manager view updates within seconds. Hub sync frequency may need to increase for restaurant use vs. dry cleaning.

**Offline mode:** What happens when a server's tablet loses connection? Local queue of state changes, sync when reconnected? Or refuse to accept changes until reconnected?

**Multi-location:** If a restaurant has two locations, do they share menu but not floor plan? Menu and floor plan both per-location? Configuration decision to expose.

**Reservation integration:** Not covered here but restaurants often use OpenTable or similar. Should CustomPOS have its own reservation system or integrate with third parties? Later question.

**Waitlist:** Front-of-house tool for managing walk-ins when full. Related to floor plan but separate concern. Maybe a follow-up feature.

**Reporting specific to restaurants:**
- Sales by section per shift
- Server performance (check average, table turn, tips)
- Item velocity (which items sell fastest by daypart)
- Labor cost as percentage of sales
- Food cost tracking (requires inventory integration)

## Handoff Notes

This document captures design intent. It is not implementation-ready.

Before implementation begins:
- Review against existing primitive list to identify overlap
- Verify no assumption breaks the current multi-vertical architecture
- Confirm with Brayden which primitives should generalize (Option B) vs. stay restaurant-specific (Option A)
- Prototype the floor plan designer separately before integrating with the engine
- Build the state machine carefully — it touches every other feature

When starting implementation, start with the floor plan designer as isolated component. Get the visual editor right first. Then integrate with engine.

Coordinate with Brayden on Burger Barn as testing partner. Some of this may be over-engineered for Burger Barn specifically (they may not need coursing rules if they're a burger place). Design generally, ship what Burger Barn needs first, expand as other restaurants adopt.
