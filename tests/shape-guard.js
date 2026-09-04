// Stage C1 (shapeGuard at the door): a record can arrive missing a required array (a truncated push, an old
// client) — later `r.lines.map(...)` throws and a screen dies. The hub fills it at the door, once, on the way
// in; a flood of repairs (a corrupt bulk push) is refused loudly. The load-bearing assertion is the NEGATIVE
// one: the guard must NOT live inside the merge, where touching a record that didn't change would restamp it
// and roll other fields back (the Ozark 8/03 mass-restamp). Pure Node.
const os = require('os'), path = require('path');
process.env.DATA = path.join(os.tmpdir(), 'custompos-shape-'+process.pid+'.json');
const hub = require('../hub.js');

let ok = true;
function assert(name, cond){ console.log((cond?'✓':'✗')+' '+name); if(!cond) ok=false; }

// capture what shapeGuard logs (a repair must be recorded, not silent)
let logged = ''; const realErr = console.error; console.error = (...a) => { logged += a.join(' ')+'\n'; };

// (1) a record with no `lines` is repaired at the door
let s = { records:[], customers:[], seq:0 };
s = hub.commit(s, { records:[{ id:'R1', status:'INPROGRESS', upd:100 }] });   // note: no `lines`
const r1 = s.records.find(r => r.id === 'R1');
const repairedAtDoor = !!r1 && Array.isArray(r1.lines) && r1.lines.length === 0;
const repairWasLogged = /shapeGuard repaired 1 record/.test(logged);

// (2) NEGATIVE CONTROL: the merge path itself must NOT fill `lines` — the guard lives at the door, not in merge
const merged = hub.mergeArr([], [{ id:'R2', status:'INPROGRESS', upd:200 }], 'id', true, null);
const mergeStayedUnguarded = merged.length === 1 && !Array.isArray(merged[0].lines);

// (3) a FLOOD of repairs is refused loudly (a corrupt bulk push is a different event, not a repair job)
const flood = { records: Array.from({length:600}, (_,i)=>({ id:'F'+i, status:'INPROGRESS', upd:300 })) };  // 600 > cap 500
let refusedMsg = null, before = JSON.parse(JSON.stringify(s));
try { hub.commit(s, flood); } catch(e){ refusedMsg = e.message; }
const refusedFlood = !!refusedMsg && /refusing a malformed bulk push/.test(refusedMsg);
const storeUntouched = JSON.stringify(s.records) === JSON.stringify(before.records);   // the bad push changed nothing

// (4) a well-formed record with real lines is left exactly as-is (no needless repair/restamp)
logged = '';
let s2 = hub.commit({ records:[], customers:[], seq:0 }, { records:[{ id:'G1', status:'READY', upd:400, lines:[{name:'x'}] }] });
const g1 = s2.records.find(r=>r.id==='G1');
const goodLeftAlone = !!g1 && g1.lines.length === 1 && g1.lines[0].name === 'x' && !/repaired/.test(logged);

console.error = realErr;
console.log('\n=== RESULTS ===');
assert('a record missing `lines` is repaired at the door', repairedAtDoor);
assert('the repair is logged, not silent', repairWasLogged);
assert('NEGATIVE CONTROL: the merge path does NOT fill `lines` (guard is at the door, not in merge)', mergeStayedUnguarded);
assert('a flood of repairs is refused loudly (beyond the cap)', refusedFlood);
assert('a refused bulk push changes nothing', storeUntouched);
assert('a well-formed record is left exactly as-is (no needless repair)', goodLeftAlone);

console.log('\n'+(ok?'ALL PASS':'FAIL'));
process.exit(ok ? 0 : 1);
