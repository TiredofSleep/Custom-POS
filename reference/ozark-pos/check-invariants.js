#!/usr/bin/env node
/* check-invariants.js — the three promises this shop makes, checked against live data. READ-ONLY.
 *
 *   ssh -i ~/.ssh/ozark_hub root@142.93.2.141 "node /opt/ozark/check-invariants.js"
 *
 * Owner, 2026-08-05: "make sure we are hardening the idea that we keep inventory record of clothes for all
 * time, and we keep track of what we have physically, and what we are owed for... make sure that the
 * engines and checkpoints that are being passed through are solid, and unanimous, completely unambiguous."
 *
 * So the promises are written down here as rules a machine can check, not as intentions:
 *
 *   INVENTORY  — every garment that ever entered is still on the record, for all time.
 *   PHYSICAL   — for everything we still hold, the system can say WHERE it is.
 *   MONEY      — everything that left is either paid, on an account, or on the chase list.
 *
 * A garment passes checkpoints: Quick → Detail → Assemble → Rack → Pickup/Deliver. At each one exactly one
 * thing must become true. Where a rule is genuinely ambiguous it is reported as ⓘ and named as such rather
 * than being quietly counted as a pass — an invariant nobody trusts is worse than no invariant.
 *
 * Exit code is the number of FAILED invariants, so this can gate a deploy.
 */
const fs = require('fs');
const DB = process.argv[2] || '/opt/ozark/hub-data/ozark-db.json';
const raw = JSON.parse(fs.readFileSync(DB, 'utf8'));
const db = raw.db || raw;
const O = db.orders || [], C = db.customers || [], P = db.payments || [], L = db.ledger || [], G = db.garments || [];
const cust = id => C.find(c => c.id === id);
const nm = c => c ? ((c.first || '') + ' ' + (c.last || '')).trim() : '(unknown)';
const m = n => '$' + (+(n || 0)).toFixed(2);
const r2 = n => Math.round((+n || 0) * 100) / 100;
// ⚠️ THE DROPLET RUNS UTC; THE SHOP RUNS CENTRAL. Every timestamp reported out of here is read by someone
// standing in Arkansas, so it is formatted in Arkansas time. Printing toISOString() cost real credibility
// on 2026-08-06: a sale at 8:56am was reported to the owner as 1:56pm, five hours in his future, and the
// Enderby double charge was reported an hour off too. A date can also land on the WRONG DAY — anything
// after 7pm Central is already tomorrow in UTC.
const SHOP_TZ = 'America/Chicago';
const day = t => t ? new Date(t).toLocaleDateString('en-CA', { timeZone: SHOP_TZ }) : '?';          // YYYY-MM-DD, shop-local
const stamp = t => t ? new Date(t).toLocaleString('en-US', { timeZone: SHOP_TZ, month: 'numeric',
  day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '?';                                     // e.g. 8/3, 8:04 AM

const TERMINAL = ['PickedUp', 'Void', 'Split'];
const OPEN = ['Received', 'Quick', 'Detailed', 'In Process', 'Assembled', 'Racked', 'Ready'];
const HELD = ['Assembled', 'Racked', 'Ready'];          // cleaned and physically in our building
const billTo = c => { if (c && c.billTo) { const p = cust(c.billTo); if (p && p.id !== c.id) return p; } return c; };

let failed = 0, checked = 0;
const rule = (id, claim, ok, detail) => {
  checked++;
  if (ok) { console.log('  ✅ ' + id + '  ' + claim); return; }
  failed++;
  console.log('  ❌ ' + id + '  ' + claim);
  (detail || []).slice(0, 12).forEach(d => console.log('        ' + d));
  if ((detail || []).length > 12) console.log('        … and ' + (detail.length - 12) + ' more');
};
const note = (id, text, detail) => {
  console.log('  ⓘ  ' + id + '  ' + text);
  (detail || []).slice(0, 8).forEach(d => console.log('        ' + d));
};

console.log('══ INVARIANTS ══  ' + (raw.__meta ? 'rev ' + raw.__meta.rev + '  ' : '') +
  O.length + ' orders · ' + C.length + ' customers · ' + G.length + ' garment tags\n');

/* ─────────────────────────── 1. INVENTORY — the record is forever ─────────────────────────── */
console.log('── INVENTORY: every garment that ever entered is still on the record ──');

const tombOrders = (db._tomb || []).filter(t => t && t.c === 'orders');
rule('INV-1', 'no order has ever been deleted (terminal states only, never removal)',
  tombOrders.length === 0,
  tombOrders.map(t => 'tombstoned order key ' + t.k));

// ── nothing is ever deleted, and no new deletion may appear ──────────────────────────────────────────────
// Owner, 2026-08-08: "there should never be a tombstone... you either add a file or merge and edit one...
// once it launches, it never unlaunches or deletes, because it legally and morally and ethically should not."
// Deletion had already cost real things: 4 LEDGER rows (money) removed by tombstone on 8/5, and one order line
// that permanently lost its item name because its price item was deleted. The app no longer creates a
// tombstone for a customer, and syncStamp no longer infers one from a record merely being ABSENT.
// The 3,563 historical tombstones are kept (never delete, not even a tombstone) but nothing may join them.
const NO_DELETE = ['orders', 'payments', 'ledger', 'customers', 'garments', 'collections'];
const CUTOFF_HLC = 1786240000000000;                        // ~2026-08-08 evening, when the law took effect
const tombAll = (db._tomb || []);
const tombSacred = tombAll.filter(t => t && NO_DELETE.indexOf(t.c) >= 0);
const tombNew = tombAll.filter(t => t && (+t.t || 0) > CUTOFF_HLC);
rule('INV-1b', 'no NEW deletion has been recorded since the no-delete law took effect',
  tombNew.length === 0,
  tombNew.map(t => 'a tombstone was created for ' + t.c + '/' + t.k + ' at ' + stamp(Math.floor((+t.t) / 1000)) +
    ' \u2014 that path still deletes and must be changed to a mark'));
if (tombSacred.length) note('INV-1c', tombSacred.length + ' historical tombstone(s) target business records ' +
  '(' + [...new Set(tombSacred.map(t => t.c))].join(', ') + ') \u2014 kept as history; the paths that made them are closed',
  [...new Set(tombSacred.map(t => t.c))].map(c => c + ': ' + tombSacred.filter(t => t.c === c).length));
else rule('INV-1c', 'no tombstone has ever targeted a business record', true);

const badStatus = O.filter(o => TERMINAL.indexOf(o.status) < 0 && OPEN.indexOf(o.status) < 0);
rule('INV-2', 'every order sits in a known state — no order is in limbo',
  badStatus.length === 0,
  badStatus.map(o => o.number + ' has status ' + JSON.stringify(o.status)));

const dupNum = {};
O.forEach(o => (dupNum[o.number] = dupNum[o.number] || []).push(o));
const dups = Object.keys(dupNum).filter(k => dupNum[k].length > 1);
// ── an order must have the SHAPE the screens are entitled to expect ───────────────────
// ⚠️ Written after a live outage on 2026-08-13: the Hot Springs counter could not use the Detail screen at all,
// because six orders had no `lines` array. renderDetail reads `o.lines.length`, so it threw the instant anybody
// opened one, and render()'s catch turned that into "this screen hit a snag" with nothing reaching the hub.
// The cause was a repair script that built its orders by hand and never set it — the app itself always does.
// 176 places read one of these lists without a guard, so this is not a screen's problem to solve one call site
// at a time: the record is either the right shape or it is a fault, and a fault should be VISIBLE before an
// employee finds it. The hub's shapeGuard now fills these in at the door; this is how we know it is working.
const shapeBad = [];
O.forEach(o => { if (!Array.isArray(o.lines)) shapeBad.push('order ' + (o.number || o.id) + ' has no lines array'); });
C.forEach(c => {
  if (c.cards != null && !Array.isArray(c.cards)) shapeBad.push('customer ' + (c.id) + ' has a non-array cards field');
  if (c.phones != null && !Array.isArray(c.phones)) shapeBad.push('customer ' + (c.id) + ' has a non-array phones field');
});
rule('INV-2b', 'every order carries the lists a screen is entitled to expect (no missing lines array)',
  shapeBad.length === 0, shapeBad.slice(0, 20));

rule('INV-3', 'every order number is unique — a scan can only mean one order',
  dups.length === 0, dups.map(n => n + ' used by ' + dupNum[n].length + ' orders'));

// a garment tag identifies ONE physical piece; the same tag live on two open orders is an ambiguity
const hslLive = {};
O.filter(o => OPEN.indexOf(o.status) >= 0).forEach(o =>
  (o.lines || []).forEach(l => { if (l.hsl) (hslLive[l.hsl] = hslLive[l.hsl] || []).push(o.number); }));
const hslClash = Object.keys(hslLive).filter(h => new Set(hslLive[h]).size > 1);
rule('INV-4', 'no heat-seal tag is live on two different open orders at once',
  hslClash.length === 0, hslClash.map(h => 'HSL ' + h + ' on ' + [...new Set(hslLive[h])].join(' + ')));

// a dissolved parent must have left its pieces somewhere traceable
const orphanSplit = O.filter(o => o.status === 'Split' &&
  !((o.childOrders || []).length) && !((o.splits || []).length));
rule('INV-5', 'a dissolved order names where its pieces went (children or bags)',
  orphanSplit.length === 0,
  orphanSplit.map(o => o.number + ' is Split but names no children and no bags'));

const countMismatch = O.filter(o => OPEN.indexOf(o.status) >= 0 && !o.uncounted &&
  (o.lines || []).length && o.pieceCount != null && o.pieceCount !== (o.lines || []).length);
rule('INV-6', 'a counted order\'s piece count matches the pieces actually on it',
  countMismatch.length === 0,
  countMismatch.map(o => o.number + ' says ' + o.pieceCount + ' pieces but carries ' + (o.lines || []).length));

/* ─────────────────── 2. PHYSICAL — we can say where everything we hold is ─────────────────── */
console.log('\n── PHYSICAL: for everything still in our hands, the system knows WHERE ──');

const held = O.filter(o => HELD.indexOf(o.status) >= 0);
const noLoc = held.filter(o => o.status !== 'Assembled' && !String(o.rackLoc || '').trim());
rule('PHY-1', 'every finished order waiting for a customer has a location',
  noLoc.length === 0,
  noLoc.map(o => o.number + ' is ' + o.status + ' with no rack location · ' + nm(cust(o.customerId))));

// each bag of a multi-bag order is scanned to its own spot (they legitimately differ)
const bagNoLoc = [];
held.filter(o => o.status !== 'Assembled').forEach(o =>
  (o.splits || []).forEach(s => { if (!String(s.rackLoc || '').trim()) bagNoLoc.push(o.number + ' bag ' + (s.number || '?')); }));
rule('PHY-2', 'every BAG of a finished order has its own location',
  bagNoLoc.length === 0, bagNoLoc);

// assembled-but-never-racked is the gap that lost two deliveries on 8/5
const stuckAsm = O.filter(o => o.status === 'Assembled');
if (stuckAsm.length) {
  /* ⚠️ A CHECKER THAT REPORTS NORMAL WORK AS A FAULT TRAINS PEOPLE TO IGNORE IT. Owner, 2026-08-10: the 19 this
     used to list "are probably the route orders waiting to be racked to the van" — and 16 of them were. A bag
     that is cleaned, assembled and waiting for the next van run is not stranded; it is exactly where it should
     be. What IS stranded is a bag with no rack location AND no route to leave on: nobody can scan it and no
     driver will collect it. Count both, but only ask for action on the second. */
  const asmRoute = stuckAsm.filter(o => { const c = cust(o.customerId) || {}; return !!(c.route || o.delivery || o.deliveryDate); });
  const asmLost  = stuckAsm.filter(o => asmRoute.indexOf(o) < 0);
  if (asmLost.length) {
    note('PHY-3', asmLost.length + ' order(s) are ASSEMBLED with no rack location AND no route to leave on' +
      ' — nobody can scan them and no driver will collect them' +
      (asmRoute.length ? '  (a further ' + asmRoute.length + ' are assembled and waiting for a van run, which is normal)' : ''),
      asmLost.map(o => o.number + '  ' + nm(cust(o.customerId)) + '  promised ' + o.promise));
  } else {
    rule('PHY-3', 'nothing is stranded between assembly and the rack', true,
      asmRoute.length ? [asmRoute.length + ' assembled and waiting for a van run — normal, not stranded'] : []);
  }
} else rule('PHY-3', 'nothing is stranded between assembly and the rack', true);

// handed over the counter OR delivered on the route — either way the shelf is empty and must read empty,
// or the next picker is sent to a spot that now holds somebody else's clothes. releaseRack() moves the
// location to rackLocWas at every checkout site, so the history survives and the shelf frees up.
const ghost = O.filter(o => o.status === 'PickedUp' && String(o.rackLoc || '').trim());
rule('PHY-4', 'nothing that has left still claims a spot on the rack',
  ghost.length === 0, ghost.map(o => o.number + ' is PickedUp but still shows ' + o.rackLoc));

/* ─────────────────── 3. MONEY — everything that left is accounted for ─────────────────── */
console.log('\n── MONEY: everything that left is paid, on an account, or on the chase list ──');

// the ledger IS the truth; the balance field must agree with it
const drift = [];
C.forEach(c => {
  const rows = L.filter(l => l.customerId === c.id);
  if (!rows.length && !(+c.balance)) return;
  let calc = 0;
  rows.forEach(l => { const a = +l.amount || 0; calc += /charge/i.test(l.type) ? a : -a; });
  const paid = P.filter(p => { const o = O.find(x => x.id === p.orderId); return o && billTo(cust(o.customerId) || {}).id === c.id; })
    .reduce((t, p) => t + (+p.amount || 0), 0);
  if (Math.abs(r2(calc) - r2(c.balance)) > 0.005 && rows.length)
    drift.push(nm(c) + ': balance ' + m(c.balance) + ' but ledger says ' + m(calc) + '  (' + rows.length + ' rows, ' + m(paid) + ' paid)');
});
rule('MON-1', 'every balance equals its own ledger — the ledger is the truth',
  drift.length === 0, drift);

// An order may legitimately be charged twice and then credited back (the 7/22 sync issue was corrected
// exactly that way). What must never happen is the NET landing above what the clothes are worth. So the
// rule is about the net, not about duplicate rows — a rule that fires on an already-fixed mistake trains
// people to ignore it.
const store = id => ((db.settings || {}).stores || []).find(s => s.id === id) || {};
const orderTotal = o => {                       // matches the app's computeTotals; validated against 57 real single-payment orders
  let sub = 0;
  (o.lines || []).forEach(l => { sub += (+l.price || 0); (l.upcharges || []).forEach(u => sub += (+u.amt || +u.amount || 0)); });
  (o.orderUpcharges || []).forEach(u => sub += (u.basis === 'percent' ? sub * (+u.amt || 0) / 100 : (+u.amt || 0)));
  sub = r2(sub);
  return r2(sub + r2(sub * (store(o.storeId).tax || 0)));
};
const overBilled = [], overCredited = [];
const byOrder = {};
L.filter(l => l.orderId).forEach(l => (byOrder[l.orderId] = byOrder[l.orderId] || []).push(l));
Object.keys(byOrder).forEach(oid => {
  const o = O.find(x => x.id === oid); if (!o) return;
  let net = 0;
  byOrder[oid].forEach(l => { const a = +l.amount || 0; if (/charge/i.test(l.type)) net += a; else net -= a; });
  net = r2(net);
  const worth = orderTotal(o);
  if (net > worth + 0.005) overBilled.push(o.number + ' billed ' + m(net) + ' net but the order is only worth ' + m(worth) +
    '  (' + byOrder[oid].length + ' ledger rows)');
  if (net < -0.005) overCredited.push(o.number + ' has been credited ' + m(-net) + ' more than it was ever charged');
});
rule('MON-2', 'no order has been billed for more than it is worth',
  overBilled.length === 0, overBilled);
rule('MON-2b', 'no order has been credited back more than it was charged',
  overCredited.length === 0, overCredited);

const orphanPay = P.filter(p => p.orderId && !O.find(o => o.id === p.orderId));
rule('MON-3', 'every payment points at an order that still exists',
  orphanPay.length === 0, orphanPay.map(p => m(p.amount) + ' ' + (p.method || '') + ' → missing order ' + p.orderId));

// the promise: nothing walks out unaccounted for
const gone = O.filter(o => o.status === 'PickedUp' && o.status !== 'Void');
const unaccounted = [];
gone.forEach(o => {
  if (orderTotal(o) < 0.005) return;                                        // a $0 order owes nothing — MON-4b asks whether it SHOULD have been $0
  if (o.paymentStatus === 'paid') return;                                   // paid outright
  const c = cust(o.customerId); if (!c) return;
  const payer = billTo(c);
  if ((+payer.balance || 0) > 0.005) return;                                // sitting on someone's account
  if (P.some(p => p.orderId === o.id)) return;                              // a payment exists against it
  if ((db.collections || []).some(x => (x.custId || x.customerId) === c.id ||
      JSON.stringify(x).indexOf(o.number) >= 0)) return;                    // on the chase list
  if (L.some(l => l.orderId === o.id)) return;                              // billed to the ledger
  unaccounted.push(o.number + '  ' + nm(c) + '  delivered ' +
    day(o.deliveredAt));
});
rule('MON-4', 'nothing has left the building unpaid AND unbilled AND unchased',
  unaccounted.length === 0, unaccounted);

// The promise is "we know what we are owed FOR." An order carrying real pieces that prices to nothing is
// not a bargain, it is a piece of work nobody put a number on — and once it walks out the door that money
// is gone. Every one found on 2026-08-05 was a Wash & Fold bag that skipped the scale: W&F is priced by
// weight at Detail, and an order that goes Quick → route without ever being detailed keeps the placeholder
// "Wash & Fold — weigh at detail" line at $0.00.
const freebies = gone.filter(o => (o.lines || []).length && orderTotal(o) < 0.005);
rule('MON-4b', 'nothing with real pieces on it left the building priced at zero',
  freebies.length === 0,
  freebies.map(o => o.number + '  ' + nm(cust(o.customerId)) + '  ' + (o.lines || []).length + ' piece(s) · ' +
    ((o.lines || []).some(l => l.wf) ? 'Wash & Fold never weighed' : 'no price on any piece') +
    ' · left ' + day(o.pickedAt || o.deliveredAt)));

// the same hole, caught before it costs anything — still in our hands, still fixable at the counter
const unpricedHeld = held.filter(o => (o.lines || []).length && orderTotal(o) < 0.005);
if (unpricedHeld.length) note('MON-4c', unpricedHeld.length + ' order(s) are finished and waiting with no price on them — price them before they go out',
  unpricedHeld.map(o => o.number + '  ' + nm(cust(o.customerId)) + '  ' + (o.lines || []).length + ' piece(s)'));
else rule('MON-4c', 'nothing waiting for a customer is still unpriced', true);

/* ── MON-10: an order marked unpaid that its OWN payments already cover ───────────────────────────────
   Written 2026-08-10, after Dan Marchetti was charged $17.52 twice. $17.52 was collected against order
   2-07-16-26-0014 at 12:28 and the money stayed, but the order stayed marked "unpaid": the field edit was
   made on a station stamping millisecond-scale _t and lost the merge to an HLC-stamped copy, while the ledger
   row survived because array adds always do. Eleven minutes later a second person saw an unpaid order and
   collected it again.
   NO EXISTING RULE CAUGHT THIS. MON-1 compares the balance to the ledger and both agreed. MON-4 only fires
   when an order is unpaid AND unbilled AND unchased, and this one was billed. So the exact state that invites
   a duplicate collection was invisible to every check. It is not any more. */
/* ⚠️ AN "ACCOUNT" PAYMENT IS NOT MONEY, and counting it as money made this rule lie about real receivable.
   Live on 2026-08-11: four Regional Medical Center orders, $257.61, each carrying a payment row with
   method "Account" and a ledger row of type CHARGE, with the customer's balance going UP to $603.64. That is
   the booking entry that moves a pickup onto the monthly statement — the OPPOSITE of being paid. MON-10 read
   those rows as cash in hand and told the owner somebody was about to collect the money twice, when in fact
   nobody had collected it once. He very nearly marked them paid on the strength of it, which would have
   forgiven $257.61 of real receivable.
   A rule that cries wolf about money is worse than no rule: it trains people to overrule it, and the next time
   it fires will be the Marchetti case, which was real. So "collected" now means money that actually moved.
   Every other method in the live record (Card, Cash, Check, Card monthly auto, Card ····NNNN, Card void) is
   real money; Account is the only booking-only one, and it is always paired with a ledger CHARGE. */
const MONEY_MOVED = m => !/^\s*account\s*$/i.test(String(m || ''));
const paidCoverage = {};
(db.payments || []).forEach(p => {
  if (!p || !p.orderId) return;
  if (!MONEY_MOVED(p.method)) return;                      // billed to the statement, not collected
  paidCoverage[p.orderId] = Math.round(((paidCoverage[p.orderId] || 0) + (+p.amount || 0)) * 100) / 100;
});
const paidButUnpaid = (db.orders || []).filter(o => {
  if (!o || o.status === 'Void') return false;
  if (String(o.paymentStatus || '') === 'paid' || String(o.paymentStatus || '') === 'waived') return false;
  const got = paidCoverage[o.id] || 0;
  if (got < 0.005) return false;
  return got >= orderTotal(o) - 0.005;                     // its own payments already cover it
});
rule('MON-10', 'no order reads unpaid when its own payments already cover it',
  paidButUnpaid.length === 0,
  paidButUnpaid.map(o => o.number + '  ' + nm(cust(o.customerId)) + '  worth $' + orderTotal(o).toFixed(2) +
    ', collected $' + (paidCoverage[o.id] || 0).toFixed(2) + ', reads "' + (o.paymentStatus || '-') +
    '" — somebody will collect it again'));

// ── is anything we actually USE priced at nothing? ──────────────────────────────────────────────────────
// Owner, 2026-08-08: "now you are saying that active upcharges aren't even upcharging." He was right to be
// alarmed and I was wrong — his live book had the prices; I had read the blank seed. But the question deserves
// a permanent answer rather than my word, so it is a rule now.
// A $0 price is only legitimate two ways: basis 'manual' (the amount is typed in when used) or the HSL tag
// (deliberately free). Anything else priced $0 AND attached to a real order is money walking out the door.
const MANUAL_OK = u => /manual/i.test(u.basis || '') || /^hsl/i.test(u.name || '');
const upById = {}; (db.upcharges || []).forEach(u => { upById[u.id] = u; });
const zeroInUse = {};
O.forEach(o => {
  if (o.status === 'Void') return;
  (o.lines || []).forEach(l => (l.upcharges || []).forEach(u => {
    const def = upById[u.id] || {};
    if (MANUAL_OK(def) || MANUAL_OK(u)) return;
    if ((+u.amt || +u.amount || 0) > 0.004) return;
    const k = (u.name || def.name || u.id || '?');
    (zeroInUse[k] = zeroInUse[k] || { n: 0, book: +def.amount || 0, eg: o.number }).n++;
  }));
  (o.orderUpcharges || []).forEach(u => {
    if (MANUAL_OK(u)) return;
    if ((+u.amt || +u.amount || 0) > 0.004) return;
    const k = (u.name || '?') + ' (order-level)';
    (zeroInUse[k] = zeroInUse[k] || { n: 0, book: 0, eg: o.number }).n++;
  });
});
const zk = Object.keys(zeroInUse);
rule('MON-8', 'nothing we actually charge for is priced at zero',
  zk.length === 0,
  zk.map(k => k + ' applied ' + zeroInUse[k].n + '\u00d7 at $0.00 (price book says ' +
    m(zeroInUse[k].book) + ') \u2014 e.g. ' + zeroInUse[k].eg));

// and the same question of the price book itself, before it costs anything
const zeroPrices = (db.prices || []).filter(p => !(+p.price > 0));
const zeroPriceUsed = zeroPrices.filter(p => O.some(o => (o.lines || []).some(l => l.priceId === p.id)));
rule('MON-9', 'no garment type in the price book is priced at zero',
  zeroPrices.length === 0,
  zeroPrices.map(p => p.name + ' (' + p.service + ')' +
    (zeroPriceUsed.indexOf(p) >= 0 ? '  \u26a0 ALREADY RUNG IN' : '  \u2014 not used yet')));

const negative = C.filter(c => (+c.balance || 0) < -0.005);
if (negative.length) note('MON-5', negative.length + ' customer(s) carry a CREDIT balance (money we owe them) — expected after a refund or overpayment',
  negative.map(c => nm(c) + '  ' + m(c.balance)));
else rule('MON-5', 'no unexplained credit balances', true);

// ── have we already been PAID for something we are still holding? ────────────────────────────────────────
// Owner, 2026-08-08: "are the old orders really old orders? check the logs." One of three was not.
// Rhonda Ranson's 2-07-24-26-0003 was paid $41.61 on a card on 7/28 and handed over — the activity log shows
// the pickup running three times — yet the order still read Ready/unpaid with six pieces claiming rack #75.
// Same class as Brenda Bramwell on 8/06: the pickup happened, the record lost a sync merge, and the clothes
// stayed on the books forever. MON-4 could not see it because that rule only inspects orders that LEFT.
// So ask the opposite question: is anything we still hold already paid for, or already logged as picked up?
const paidWhileHeld = [];
held.forEach(o => {
  const pays = P.filter(p => p.orderId === o.id);
  const paid = r2(pays.reduce((t, p) => t + (+p.amount || 0), 0));
  const pickedInLog = (db.activity || []).some(a => a && /^Pickup$/i.test(a.type || '') &&
    String(a.detail || '').indexOf(o.number) >= 0);
  if (paid <= 0.005 && !pickedInLog) return;
  paidWhileHeld.push(o.number + '  ' + nm(cust(o.customerId)) + '  ' + o.status +
    (paid > 0.005 ? ' · ALREADY PAID ' + m(paid) + (pays[0] ? ' (' + (pays[0].method || '') + ' ' + stamp(pays[0].date || pays[0].ts) + ')' : '') : '') +
    (pickedInLog ? ' · a Pickup is in the activity log' : '') +
    ' · still claims ' + (String(o.rackLoc || '').trim() || 'no spot') + ' with ' + ((o.lines || []).length) + ' piece(s)');
});
rule('PHY-5', 'nothing we are still holding has already been paid for or picked up',
  paidWhileHeld.length === 0, paidWhileHeld);

/* ─────────── 4. AGING — how long have we been holding somebody's clothes? ───────────
   Arkansas Code § 18-28-101: clothing left at a cleaner and unclaimed for SIX MONTHS is abandoned property;
   the business may dispose of it and keep the proceeds, and no notice is required for the disposal itself.
   ⚠ THE PART NOBODY GUESSES: "An owner of a business who disposes of property pursuant to this section shall
   waive all rights to recover fees for performing work on the object." Sell the garment OR chase the cleaning
   charge — never both. A balance left standing on a disposed order is a receivable that cannot lawfully be
   collected, which is exactly the false money the MONEY rules above exist to refuse.
   Industry figure worth knowing: roughly 15% of items at a typical cleaner go unclaimed. Routine, not rare. */
console.log('\n── AGING: how long have we been holding somebody\'s clothes? ──');
const ABANDON = ((db.settings || {}).abandonDays) || 180;
const DAYMS = 86400000, nowMs = Date.now();
const ageOf = o => Math.floor((nowMs - (o.readyAt || o.detailedAt || o.createdAt || nowMs)) / DAYMS);
const aging = held.map(o => ({ o, d: ageOf(o) })).sort((a, b) => b.d - a.d);
const abkt = (lo, hi) => aging.filter(x => x.d >= lo && (hi == null || x.d < hi));
const bAb = abkt(ABANDON, null);
console.log('   ' + aging.length + ' order(s) in our hands · oldest ' + (aging[0] ? aging[0].d : 0) + ' days');
[['30\u201359 days', abkt(30, 60)], ['60\u201389 days', abkt(60, 90)], ['90\u2013' + (ABANDON - 1) + ' days', abkt(90, ABANDON)]]
  .forEach(([lbl, arr]) => { if (arr.length) console.log('   ' + lbl.padEnd(16) + arr.length + '  ' +
    arr.slice(0, 4).map(x => x.o.number).join(', ')); });
rule('AGE-1', 'nothing held past the ' + ABANDON + '-day abandonment line (Arkansas \u00a7 18-28-101)',
  bAb.length === 0,
  bAb.map(x => x.o.number + '  ' + nm(cust(x.o.customerId)) + '  ' + x.d + ' days  ' + (x.o.rackLoc || '') +
    '  \u2192 may be disposed of, but that WAIVES the right to collect ' + m(orderTotal(x.o))));
const nearAb = aging.filter(x => x.d >= 90);
if (nearAb.length) note('AGE-2', nearAb.length + ' order(s) waiting 90+ days \u2014 call before they reach ' + ABANDON +
  ' days, because disposing of them forfeits the cleaning charge on those pieces',
  nearAb.map(x => x.o.number + '  ' + nm(cust(x.o.customerId)) + '  ' + x.d + ' days \u00b7 ' + m(orderTotal(x.o))));
else rule('AGE-2', 'nothing is within sight of the abandonment line', true);

/* ─────────── 5. SCALE — will this still work at the volume being planned? ───────────
   Owner, 2026-08-08: "we are getting ready to process over 100k pieces a year... 10k a month this winter...
   let's make sure the system can handle it."
   What breaks first is not the screens. It is that THE WHOLE DATABASE SYNCS TO EVERY DEVICE: every station
   downloads and parses the entire file whenever the hub's rev moves, the hub rewrites it plus a backup on
   every save, and it keeps 60 rolling backups. So the file size is the ceiling, and orders are what grow.
   Measured, not guessed — and it shouts before it hurts rather than after. */
console.log('\n── SCALE: headroom at the volume being planned ──');
const bytesOf = x => JSON.stringify(x || {}).length;
const rowAvg = a => (a && a.length) ? Math.round(a.reduce((t, x) => t + bytesOf(x), 0) / a.length) : 0;
const dbMB = fs.statSync(DB).size / 1048576;
const perOrder = rowAvg(O);
const piecesOnFile = O.reduce((t, o) => t + ((o.lines || []).length), 0);
const piecesPerOrder = O.length ? (piecesOnFile / O.length) : 2.6;
const ordersMo = Math.round(10000 / Math.max(1, piecesPerOrder));
console.log('   synced database ..... ' + dbMB.toFixed(2) + ' MB  (' + O.length + ' orders \u00b7 ' + C.length +
  ' customers \u00b7 ' + (db.activity || []).length + ' activity)');
console.log('   one order costs ..... ' + perOrder + ' bytes and carries ' + piecesPerOrder.toFixed(1) + ' pieces');
console.log('   at 10,000 pieces/month that is ~' + ordersMo + ' orders/month:');
[1, 2, 3].forEach(y => {
  const n = ordersMo * 12 * y, mb = dbMB + (n * perOrder) / 1048576;
  console.log('      year ' + y + ':  ' + String(n).padStart(6) + ' orders  \u2192  ~' + mb.toFixed(0) +
    ' MB synced to every device,  ~' + (mb * 60 / 1024).toFixed(1) + ' GB of rolling backups');
});
const SYNC_WARN = 25, SYNC_FAIL = 60;
rule('SCALE-1', 'the synced database is under ' + SYNC_FAIL + ' MB (a full pull still lands on a route phone)',
  dbMB < SYNC_FAIL,
  [dbMB.toFixed(1) + ' MB \u2014 every device downloads and parses this whenever anything changes, and the hub keeps' +
   ' 60 backups of it (' + (dbMB * 60 / 1024).toFixed(1) + ' GB). Completed orders need to move to a hub-side' +
   ' archive, the same way activity-archive.jsonl already works.']);
if (dbMB >= SYNC_WARN && dbMB < SYNC_FAIL)
  note('SCALE-2', 'the synced database has passed ' + SYNC_WARN + ' MB (' + dbMB.toFixed(1) + ' MB) \u2014 start archiving' +
    ' completed orders off the sync set before the route phone feels it');
else rule('SCALE-2', 'database size is comfortable for a full sync (' + dbMB.toFixed(1) + ' MB)', dbMB < SYNC_WARN);

/* ─────────────────────────────── verdict ─────────────────────────────── */
const owed = C.reduce((t, c) => t + Math.max(0, +c.balance || 0), 0);
console.log('\n── STANDING ──');
console.log('   pieces still in our hands: ' + held.reduce((t, o) => t + ((o.lines || []).length), 0) +
  '  across ' + held.length + ' orders');
console.log('   garment tags on record (all time): ' + G.length);
console.log('   owed to us right now: ' + m(owed));
console.log('\n══ ' + (checked - failed) + '/' + checked + ' invariants hold' +
  (failed ? '  —  ' + failed + ' FAILED' : '  —  clean') + ' ══');
process.exit(failed);
