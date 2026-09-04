// Pure-Node test for the generalized SYNC CONTRACT (hub.js) — the substrate that lets custompos build a
// multi-station cleaner POS that doesn't lose clothes or roll paid orders back. Each assertion is named after
// the Ozark incident it prevents (docs/PHASE-2-SUBSTRATE.md, Stage A). A test that cannot fail is not evidence,
// so the two-clocks law also carries its negative control.
const { merge, stampNewer, stampScale, hlcNow } = require('../hub.js');
let ok = true;
function assert(name, cond){ console.log((cond?'✓':'✗')+' '+name); if(!cond) ok=false; }

// ---- Law 1: ONE comparison, scale-aware (the "two clocks on one number line" rollback) ----
const bareMs = 1_700_000_000_000;            // legacy Date.now() stamp
const hybridSameInstant = bareMs * 1000;     // the same instant on the hybrid clock
assert('stampScale promotes a bare-ms stamp to the hybrid magnitude', stampScale(bareMs) === hybridSameInstant);
assert('a hybrid stamp one tick later beats the bare-ms of the same instant', stampNewer(hybridSameInstant + 1, bareMs));
assert('a tie goes to the newcomer (symmetric app+hub — strict is the rollback bug)', stampNewer(500, 500));
// negative control: a naive bare >= gets the mixed-scale case WRONG; stampNewer must not agree with it.
const oldHybrid = 1_700_000_000_000_000;     // an OLDER real instant, hybrid-stamped (~1.7e15)
const newerBareMs = 1_700_000_400_000;       // a NEWER real instant, bare-ms (~1.7e12) — bigger in real time
const naiveSaysHybridWins = oldHybrid >= newerBareMs;                 // true — the bug: 1000x scale beats real time
assert('naive >= would let the 1000x-scale stamp win (the bug exists)', naiveSaysHybridWins === true);
assert('stampNewer ranks the genuinely-newer bare-ms stamp above the older hybrid one', stampNewer(newerBareMs, oldHybrid) && !stampNewer(oldHybrid, newerBareMs));

// ---- Law 2: ABSENCE IS NEVER A DELETE, and only a tombstone deletes ----
let store = { records:[{id:'R1',status:'PAID',upd:100},{id:'R2',status:'READY',upd:100}], customers:[], seq:1 };
merge(store, { records:[{id:'R1',status:'PAID',upd:100}], seq:1 });   // a push that OMITS R2 (a stale/partial device)
assert('a record omitted from a push is KEPT (the "lost clothes" class)', !!store.records.find(r=>r.id==='R2'));
merge(store, { records:[{id:'R2',deleted:true,upd:200}], seq:1 });    // a real delete = a newer tombstone
const r2 = store.records.find(r=>r.id==='R2');
assert('a newer tombstone marks the record deleted (and it is still stored)', r2 && r2.deleted===true);
merge(store, { records:[{id:'R2',deleted:true,upd:150}], seq:1 });    // a STALE resurrect (older than the tombstone)
assert('a stale copy does NOT resurrect a tombstoned record', store.records.find(r=>r.id==='R2').deleted===true);
merge(store, { records:[{id:'R2',status:'READY',upd:300}], seq:1 });  // a genuinely newer edit re-creates
assert('a newer real edit re-creates over a tombstone', !store.records.find(r=>r.id==='R2').deleted);

// ---- Law 1 applied to CUSTOMERS (was a blind overwrite; now stamp-guarded) ----
let s = { records:[], customers:[{phone:'111',name:'New',upd:200}], seq:0 };
merge(s, { customers:[{phone:'111',name:'Stale',upd:150}] });        // a stale customer edit
assert('a stale customer edit cannot clobber a newer one', s.customers.find(c=>c.phone==='111').name==='New');

// ---- Law 3: orders only ADVANCE (the 8/03 rollback that flipped 10 PAID orders to unpaid) ----
let o = { records:[{id:'O1',status:'PAID',total:20,upd:100}], customers:[], seq:1 };
merge(o, { records:[{id:'O1',status:'INPROGRESS',total:20,upd:999}], seq:1 });   // a LYING newer stamp
assert('a stale stamp cannot roll a PAID order back to INPROGRESS', o.records[0].status==='PAID');
merge(o, { records:[{id:'O1',status:'REFUNDED',total:20,upd:1000}], seq:1 });    // a legit refund
assert('a refund still ADVANCES past PAID (the law is a floor, not a freeze)', o.records[0].status==='REFUNDED');
let o2 = { records:[{id:'O2',status:'INPROGRESS',upd:100}], customers:[], seq:1 };
merge(o2, { records:[{id:'O2',status:'READY',upd:200}], seq:1 });                 // ordinary forward step
assert('an ordinary forward step (INPROGRESS -> READY) is unaffected', o2.records[0].status==='READY');

// ---- the clock itself ----
assert('hlcNow is monotonic even called in a tight loop', (()=>{ let a=hlcNow(),b=hlcNow(),c=hlcNow(); return b>a && c>b; })());

console.log('\n'+(ok?'ALL PASS':'FAIL'));
process.exit(ok?0:1);
