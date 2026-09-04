// Stage C2 (stampSanitize at the door): a device with a fast clock stamps edits in the future; because
// stampNewer picks the higher stamp, that edit would beat every HONEST later edit until the wall clock catches
// up — a poison pill. The hub clamps a future stamp to now (the work is real, only the `when` lies) but DROPS
// a future-dated tombstone (a delete stamped ahead of now would outrank a real record and erase it). Pure Node.
const os = require('os'), path = require('path');
process.env.DATA = path.join(os.tmpdir(), 'custompos-stamp-'+process.pid+'.json');
process.env.CLOCK_SKEW_MS = String(5*60*1000);       // 5 min of honest skew
const hub = require('../hub.js');

let ok = true;
function assert(name, cond){ console.log((cond?'✓':'✗')+' '+name); if(!cond) ok=false; }
const realErr = console.error; console.error = () => {};   // silence the guard's log lines

const NOW = 2_000_000_000_000 * 1000;                // a fixed hybrid "now" for the direct calls
const SKEW = 5*60*1000 * 1000;                        // matches CLOCK_SKEW_MS in hybrid scale

// (1) a far-future real edit is CLAMPED to now (kept, not dropped; its clock corrected)
let g = hub.stampSanitize({ records:[{ id:'R1', status:'READY', upd: NOW + 1e12, lines:[] }] }, NOW);
const clampedKept = g.records.length === 1 && g.records[0].upd === NOW;

// (2) a stamp within honest skew is left ALONE (we don't clamp normal clock jitter)
let h = hub.stampSanitize({ records:[{ id:'R2', status:'READY', upd: NOW + Math.floor(SKEW/2), lines:[] }] }, NOW);
const skewLeftAlone = h.records[0].upd === NOW + Math.floor(SKEW/2);

// (3) a far-future TOMBSTONE is DROPPED (not clamped) — a future delete must not outrank real work
let t = hub.stampSanitize({ records:[{ id:'R3', deleted:true, upd: NOW + 1e12 }] }, NOW);
const futureTombstoneDropped = t.records.length === 0;

// (4) integration: a future tombstone does NOT delete a live record; the same delete stamped honestly DOES
let s = { records:[], customers:[], seq:0 };
s = hub.commit(s, { records:[{ id:'K1', status:'INPROGRESS', upd: Date.now()*1000, lines:[] }] });
const nowMs = Date.now();
s = hub.commit(s, { records:[{ id:'K1', deleted:true, upd:(nowMs + 10*60*1000)*1000 }] });   // 10 min future > skew
const survivedFutureDelete = !!s.records.find(r=>r.id==='K1') && !s.records.find(r=>r.id==='K1').deleted;
s = hub.commit(s, { records:[{ id:'K1', deleted:true, upd: Date.now()*1000 }] });             // honest stamp
const honestDeleteApplied = !!s.records.find(r=>r.id==='K1') && s.records.find(r=>r.id==='K1').deleted === true;

console.error = realErr;
console.log('\n=== RESULTS ===');
assert('a far-future real edit is clamped to now (kept, clock corrected)', clampedKept);
assert('a stamp within honest skew is left alone', skewLeftAlone);
assert('a far-future tombstone is DROPPED, not clamped', futureTombstoneDropped);
assert('a future tombstone does not delete a live record', survivedFutureDelete);
assert('the same delete stamped honestly DOES apply (re-offered when the clock is right)', honestDeleteApplied);

console.log('\n'+(ok?'ALL PASS':'FAIL'));
process.exit(ok ? 0 : 1);
