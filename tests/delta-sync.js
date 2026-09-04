// Pure-Node test for Stage B (delta sync): the hub bumps a rev per changing push, stamps each changed record
// with it, and serves only what moved since a rev — so a station pulls ~5KB a tick instead of the whole DB.
// The idempotent-re-push case is the one that mattered most in Ozark (re-broadcasting the whole DB every push).
const { merge, deltaSince } = require('../hub.js');
let ok = true;
function assert(name, cond){ console.log((cond?'✓':'✗')+' '+name); if(!cond) ok=false; }

let s = { records:[], customers:[], seq:0 };

merge(s, { records:[{id:'R1',status:'INPROGRESS',upd:100}], customers:[{phone:'111',name:'Ann',upd:100}] });
assert('first changing push bumps rev to 1', s.rev===1);
assert('the changed record is stamped _rev=1', s.records[0]._rev===1 && s.customers[0]._rev===1);

merge(s, { records:[{id:'R2',status:'READY',upd:200}] });                     // add a second record only
assert('a later push bumps rev to 2', s.rev===2);
assert('the new record carries _rev=2, the untouched one stays _rev=1',
  s.records.find(r=>r.id==='R2')._rev===2 && s.records.find(r=>r.id==='R1')._rev===1);

merge(s, { records:[{id:'R1',status:'INPROGRESS',upd:100}] });               // re-push R1 unchanged (idempotent)
assert('an idempotent re-push does NOT bump the rev (no re-broadcast)', s.rev===2);
assert('R1 keeps _rev=1 through the idempotent push', s.records.find(r=>r.id==='R1')._rev===1);

merge(s, { records:[{id:'R1',status:'READY',upd:300}] });                     // a real edit to R1
assert('a real edit bumps rev to 3 and re-stamps R1', s.rev===3 && s.records.find(r=>r.id==='R1')._rev===3);

// what a device on rev 2 pulls: only what moved after 2 (the R1 edit), not the whole DB
const d = deltaSince(s, 2);
assert('deltaSince(2) returns only the records changed after rev 2', d.records.length===1 && d.records[0].id==='R1');
assert('deltaSince(2) does NOT resend the unchanged R2', !d.records.find(r=>r.id==='R2'));
// a fresh device pulls everything
const full = deltaSince(s, 0);
assert('deltaSince(0) returns the whole set (a fresh device bootstraps)', full.records.length===2 && full.customers.length===1);

console.log('\n'+(ok?'ALL PASS':'FAIL'));
process.exit(ok?0:1);
