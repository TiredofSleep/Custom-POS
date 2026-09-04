// Stage D2 (check-invariants): a read-only, machine-checked pass over the DB that catches faults a screen
// never shows — a duplicate order id, an order in limbo, a line/tender whose value would break the money math.
// It checks the INPUTS to the money math but never re-derives a total (money math lives only in the app), and
// it does NOT flag a phone shared by two customers (correct in Ozark — a person and their org). Pure Node.
const { checkInvariants } = require('../check-invariants.js');

let ok = true;
function assert(name, cond){ console.log((cond?'✓':'✗')+' '+name); if(!cond) ok=false; }
const rules = res => res.problems.map(p=>p.rule);

// a clean shop passes
const clean = { records:[
  { id:'R1', number:1, status:'READY', lines:[{qty:2,price:5}], tenders:[] },
  { id:'R2', number:2, status:'PAID',  lines:[{qty:1,price:3}], tenders:[{type:'cash',amount:3}] },
  { id:'R3', number:3, status:'CLOSED', deleted:true },                          // a well-formed tombstone
], customers:[ {phone:'111',name:'Jason Watson'}, {phone:'111',name:'Clark County Sheriff'} ] };  // SHARED phone — legit
const c = checkInvariants(clean);
assert('a clean shop passes with zero violations', c.ok && c.count === 0);
assert('a shared customer phone is NOT flagged (a person and their org)', !rules(c).includes('duplicate-customer'));

// each fault is caught
const planted = { records:[
  { id:'D1', number:1, status:'READY',  lines:[], tenders:[] },
  { id:'D1', number:2, status:'READY',  lines:[], tenders:[] },                  // duplicate id
  { id:'X1', number:1, status:'READY',  lines:[], tenders:[] },                  // duplicate order number (#1)
  { id:'L1', number:5, status:'READY',  lines:[{qty:'two',price:5}], tenders:[] }, // non-numeric qty
  { id:'P1', number:6, status:'READY',  lines:[{qty:1,price:null}], tenders:[] },  // non-numeric price
  { id:'T1', number:7, status:'PAID',   lines:[{qty:1,price:3}], tenders:[{type:'cash',amount:'oops'}] }, // bad tender
  { id:'Z1', number:8, status:'WAT',    lines:[], tenders:[] },                  // unknown status (limbo)
  { deleted:true },                                                              // tombstone with no id
], customers:[] };
const p = checkInvariants(planted);
assert('a duplicate order id is caught',        rules(p).includes('duplicate-id'));
assert('a duplicate order number is caught',    rules(p).includes('duplicate-order-number'));
assert('a non-numeric line qty is caught',      rules(p).includes('bad-line-qty'));
assert('a non-numeric line price is caught',    rules(p).includes('bad-line-price'));
assert('a non-numeric tender amount is caught', rules(p).includes('bad-tender-amount'));
assert('an unknown status (limbo) is caught',   rules(p).includes('unknown-status'));
assert('a tombstone with no id is caught',      rules(p).includes('tombstone-no-id'));
assert('the count equals the length of its own problem list', p.count === p.problems.length);

// it unwraps an {db, rev} envelope (hub files/responses wrap)
const wrapped = checkInvariants({ rev:9, db: clean });
assert('an {db, rev} envelope is unwrapped and checked', wrapped.ok && wrapped.count === 0);

console.log('\n'+(ok?'ALL PASS':'FAIL'));
process.exit(ok ? 0 : 1);
