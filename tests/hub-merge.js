// Pure-Node unit test for the hub's conflict resolution (no browser). Verifies version-aware last-write-wins.
const { merge } = require('../hub.js');
let ok = true;
function assert(name, cond){ console.log((cond?'✓':'✗')+' '+name); if(!cond) ok=false; }

// a newer edit (higher upd) wins over an older stored copy
let store = { records:[{ id:"R1", status:"INPROGRESS", upd:100 }], customers:[], seq:1 };
merge(store, { records:[{ id:"R1", status:"PAID", upd:200 }], seq:1 });
assert('newer upd wins (INPROGRESS -> PAID)', store.records[0].status==='PAID');

// a STALE push (lower upd) must NOT clobber the newer stored copy
merge(store, { records:[{ id:"R1", status:"INPROGRESS", upd:150 }], seq:1 });
assert('stale push (older upd) is rejected', store.records[0].status==='PAID');

// a brand-new record is added (union)
merge(store, { records:[{ id:"R2", status:"READY", upd:300 }], seq:2 });
assert('new record added by union', store.records.length===2 && !!store.records.find(r=>r.id==='R2'));

// records with no upd fall back to plain last-write-wins
let s2 = { records:[{ id:"A", v:1 }], customers:[], seq:0 };
merge(s2, { records:[{ id:"A", v:2 }] });
assert('no-upd falls back to last-write-wins', s2.records[0].v===2);

// customers upsert by phone; seq takes the max
let s3 = { records:[], customers:[{ phone:"111", name:"Old", points:1 }], seq:5 };
merge(s3, { customers:[{ phone:"111", name:"New", points:9 }, { phone:"222", name:"Two" }], seq:3 });
assert('customer upserts by phone', s3.customers.find(c=>c.phone==='111').name==='New' && s3.customers.length===2);
assert('seq keeps the max', s3.seq===5);

console.log('\n'+(ok?'ALL PASS':'FAIL'));
process.exit(ok?0:1);
