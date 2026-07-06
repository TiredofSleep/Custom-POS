# customPOS — the Flow Schema (engine spec)

*Derived from mapping 12 trades' real information-flow topologies. This is the contract the engine executes,
the visual builder edits, the wizard emits, and Claude Code reads — **one schema, four readers.** A working
proof is in [`../pos.html`](../pos.html) (the v0 engine skeleton).*

## The machine underneath every trade
Every business is the same machine: a **customer** opens one polymorphic **record**; it advances through a
**state machine**; at "fire" points it is **routed** (projected, not copied) to **stations** that each see a
filtered slice and may fire only certain updates; it **cashes out** against a payment sink. The only two things
that never vary are the endpoints — a **customer source** at the front and a **payment sink** at the back.
Everything between is stations + routing over one shared record.

## Four layers
1. **Engine (fixed, universal):** the record runtime, the state-machine interpreter, the one declarative station
   renderer, the routing fan-out, the payment interface, hub sync.
2. **Flow Definition (the shared JSON — this doc):** endpoints + record schema + state machine + station array
   with per-station view/updates/routing. *This is what the visual builder edits and the wizard emits.*
3. **Modules (pluggable):** each contributes station **types**, sub-record **types**, **updates**, **views**.
4. **Brand/Catalog Config (pure data):** vocabulary, catalog/prices, item attributes, locations, taxes, branding.

## The universal RECORD
- **Header:** id/number, `customerRef` (or null when ephemeral), `locationId` (routes printing), channel,
  createdAt, promise/due, assignedTo, `status`.
- **Line items[]:** `type`, qty, open `attributes` map (modifiers, size/color, barcode, formula, VIN op-code…),
  price + discounts, optional per-line status, optional per-line performer, and a **`routeKey`** (the field
  routing fans on).
- **Sub-records[]:** child objects stations append — payments/ledger, media, child work-orders (parts PO),
  inspection findings, split-check children, route stops. *Each sub-record type is contributed by a module.*
- **State machine:** one `status` over a config-supplied ordered stage list (+ optional per-line statuses).
  Generic phases every trade maps onto: `DRAFT/OPEN → CAPTURED → [APPROVAL loop] → IN_PROGRESS → READY/STAGED →
  FULFILLED → CLOSED`, side states `VOID`/`REFUND`, and **gated** transitions. Retail collapses to `OPEN→CLOSED`;
  the cleaner expands to `Received→Detailed→Assembled→Racked→Ready→PickedUp`. Same object, different stage list.

## The STATION (a declarative 5-tuple)
`{ device, role, view, updates, position }`
- **device** — physical: counter PC, KDS, bench tablet, phone, printer, card reader.
- **role** — who is permitted here.
- **view** — a *live projection* of the one record: which header fields + which line subset (filter by
  `routeKey`/status) + which sub-records + a **`money` visible flag**. (A make station sees items, not prices —
  the same record, filtered.)
- **updates** — the closed set of state transitions it may fire + sub-record types it may append.
- **position** — `start | middle | parallel | end | external-customer`.

A station never invents state; it fires transitions from its allowed set and appends sub-records it may write.
Give the engine a view-filter + an update-whitelist and it renders/enforces **any** station in any trade.

### Recurring station types (the module palette)
`intake/capture` · `production/prep` (money-blind) · `expo/assembly/consolidation` (re-converge) ·
`staging/storage` · `fulfillment/checkout` · `approval/estimate + loop` · `procurement side-track` ·
`dispatch/kanban board` · `manager/back-office overlay` · `shared-ledger/inventory` (resource, not per-record) ·
`payment device` (amount-only) · `external-customer projection` (sanitized, narrow writes).

## The ROUTING primitive (one rule, fired by a transition)
`{ on: <transition | line-attribute | customer-flag>, by: <partition key: routeKey/line-type/status/role/
locationId | 'whole'>, to: <station id(s) | printer | external channel>, carry: <line subset | status-only |
ledger balance> }`. On the trigger, the engine partitions the record and hands each target a **live filtered
projection** intersected with that station's own view. This single mechanism expresses fan-out (fire lines to
grill vs bar), re-converge (feed expo/assembly with `'whole'`), print-by-location, the sanitized customer push
(`carry: status-only`), the parts side-track (spawn a child order), the A/R divert, and loops (target an earlier
station: approval → back to bench).

## CASH-OUT (the fixed sink; an interface every flow inherits)
- **Points** (where a tender may attach): pay-first (start station), at-pickup/checkout (end station),
  deposit+balance (both), on-account (diverts to an A/R statement, ages it), at-delivery (parallel route),
  self-pay (external projection via pay-link/QR). A flow may enable several at once.
- **Tenders** (config set): cash, check, card-present, card-key-in, saved-card, wallet/tap, gift/store-credit,
  loyalty-redeem, on-account, offline-queued.
- **Ledger:** each tender is a sub-record (deposit | balance | refund); `balance = total − Σtenders`; a record
  cannot reach `CLOSED` unless `balance ≤ 0` **or** the customer is on-account (the **closeGate**).
- **PCI (hard rule):** the card number never touches the record or the browser; secrets live hub-only; the
  device sees amount-only and returns auth+last4. Offline mode queues an encrypted tender and settles later.

## Recurring updates (the verb set)
`createCustomer/lookup` · `createRecord+number+promise+location` · `addLine/voidLine` · `setLineAttributes` ·
`attachMedia` · `assignActor/bay/route` · `fire/send` (fan-out) · `markWorking` · `markReady/bump` ·
`assignLocation` · `consolidate/assemble` · `advanceStatus` · `requestApproval→record approval` ·
`gateCheck` (waiver/vaccination, manager auth, balance-paid) · `spawnChildOrder→receive→flip line` ·
`notifyCustomer` (status-only) · `takeDeposit/takeTender/takeBalance` · `split` · `decrementInventory/restock` ·
`void/refund` (owner-gated) · `closeRecord` · `end-of-session reconcile`.

## The MODULE contract
A module declares: `{ provides: stationTypes[], subRecords[], updates[], views[], needsConfig[] }`. **Enabling any
station of a type auto-enables its module.** Ozark's assembly / rack / route / statements become the first
modules — validating the contract against a known-hard vertical.

## Example Flow (abridged — a cleaner)
```json
{ "flowId":"dry-cleaner", "version":1,
  "endpoints": {
    "customer": { "persist":true, "identityKeys":["phone","lastName"],
      "external": { "channels":["sms","web-tracker"], "show":["status","items"],
        "hide":["balance","address","payment","otherCustomers"], "customerUpdates":["approve","pay","reschedule"] } },
    "payment": { "provider":"cardpointe", "tenders":["cash","card-present","on-account"],
      "points":["at-pickup","deposit-balance","on-account"], "closeGate":"balanceLE0_or_isAccount" } },
  "informationObject": {
    "name":"order",
    "lineItem": { "routeKey":"prepStation", "attributes":[{"key":"item"},{"key":"color","type":"chips"},{"key":"hslBarcode"}] },
    "subRecords":[{"name":"payment","module":"payments"},{"name":"garment","module":"laundry"},{"name":"routeStop","module":"route"}],
    "stateMachine": { "initial":"Received",
      "states":["Received","Detailed","Assembled","Racked","Ready","PickedUp","Void"],
      "transitions":[
        {"from":"Received","to":"Detailed","update":"addLines","atStation":"detail"},
        {"from":"Detailed","to":"Assembled","update":"scanSort","atStation":"assembly"},
        {"from":"Assembled","to":"Racked","update":"assignLocation","atStation":"rack"},
        {"from":"Racked","to":"Ready","update":"markReady","atStation":"rack"},
        {"from":"Ready","to":"PickedUp","update":"takeBalance","atStation":"pickup","gate":"closeGate"} ] } },
  "stations":[
    {"id":"quick","type":"intake","position":"start","device":"counter-pc","view":{"scope":"whole"},"updates":["createRecord","takeDeposit"]},
    {"id":"detail","type":"production","position":"middle","device":"counter-pc","module":"laundry","view":{"money":false},"updates":["addLine","setLineAttributes"]},
    {"id":"assembly","type":"expo","position":"middle","device":"plant-pc","module":"assembly","view":{"money":false},"updates":["scanSort"]},
    {"id":"rack","type":"staging","position":"middle","device":"plant-pc","module":"rack","view":{"scope":"whole"},"updates":["assignLocation","markReady","notifyCustomer"]},
    {"id":"route","type":"procurement","position":"parallel","device":"phone","module":"route","view":{"scope":"whole"},"updates":["collect"]},
    {"id":"pickup","type":"fulfillment","position":"end","device":"counter-pc","module":"payments","view":{"money":true},"updates":["takeTender","void"]} ],
  "routing":[
    {"on":"createRecord","by":"locationId","to":"printer","carry":"ticket"},
    {"on":"advance:Detailed","by":"routeKey","to":"assembly","carry":"garment-lines"},
    {"on":"advance:Ready","to":["customer.external"],"carry":"status-only"},
    {"on":"customer.isAccount","to":"statements","carry":"balance"} ] }
```

## Build order (from the synthesis)
1. Two fixed endpoints as bedrock (customer source + payment sink). ✅ *(v0)*
2. Record runtime + state-machine interpreter reading the flow JSON. ✅ *(v0)*
3. One declarative station renderer (view-filter + update-whitelist). ✅ *(v0, proven money-blind)*
4. Routing fan-out as the one `{on,by,to,carry}` primitive. ✅ *(v0.2 fan-out; v0.3 per-item paths + re-converge)*
5. Module contract `{provides:…}`; enabling a station auto-enables its module. ✅ *(v0.7 module registry)*
6. Extract render()/home-tiles/admin-tabs to be built FROM the station array. ◑ *(picker/board/dispatch driven by the station array; full data-driven screens ongoing)*
7. Gate mechanism (balance-paid, manager-auth, waiver) as a first-class transition guard. ✅ *(closeGate + flag ack gate, v0.6/0.8)*

## Primitives implemented so far (see [MODULE-LIBRARY.md](MODULE-LIBRARY.md))
✅ timer/SLA · ✅ par-count/86 · ✅ routing fan-out · ✅ require/suggest modifiers · ✅ upsell add-ons ·
✅ flag engine (+ ack gate) · ✅ checklist-as-gate · ✅ capacity/pacing · ✅ money-math (tips + commission) ·
✅ status-broadcast (board + tracker) · ✅ deposit/balance ledger · ✅ gift cards + loyalty ·
✅ profile/entity recall ("the usual") · ◑ hold-and-fire (via approval/QC gates) · ◑ quick-tiles (catalog tiles).
**Four trades** — counter shop, cleaners, repair, salon — run on the one engine **by config alone**; **nine
browser test suites pass with zero console errors.** Plus the module contract, per-item paths, hub-and-spoke &
linear topologies, and persisted customers. Remaining polish: full data-driven screens, richer quick-tile/matrix,
and wiring the [payments module](PAYMENTS-MODULE.md) (Phase 5).
