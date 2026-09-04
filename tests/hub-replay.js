// Stage B4 (append-only delta log + checkpoints + replay): the hub logs every rev's delta and checkpoints on
// an interval; hub-replay.js rebuilds any revision from the nearest checkpoint + the log, byte-identical to
// what the hub held — and REFUSES on a hole rather than silently skipping a rev (a rebuild that quietly drops
// a rev hands back a plausible DB that never existed). Pure Node.
const os = require('os'), fs = require('fs'), path = require('path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cpreplay-'));
process.env.DATA = path.join(dir, 'db.json');
process.env.CHECKPOINT_EVERY = '3';                 // checkpoint every 3 revs so the test exercises checkpoints
const hub = require('../hub.js');
const { replay } = require('../hub-replay.js');

let ok = true;
function assert(name, cond){ console.log((cond?'✓':'✗')+' '+name); if(!cond) ok=false; }

let store = { records:[], customers:[], seq:0 };
const snap = {};
function step(incoming){ store = hub.commit(store, incoming); snap[store.rev] = JSON.parse(JSON.stringify(store)); }

step({ records:[{id:'R1',status:'INPROGRESS',upd:100}], customers:[{phone:'111',name:'Ann',upd:100}] }); // rev1
step({ records:[{id:'R2',status:'READY',upd:200}] });                                                     // rev2
step({ records:[{id:'R1',status:'READY',upd:300}] });                                                     // rev3 -> checkpoint
step({ records:[{id:'R3',status:'INPROGRESS',upd:400}] });                                                // rev4
step({ records:[{id:'R2',status:'PAID',upd:500}] });                                                      // rev5
step({ customers:[{phone:'222',name:'Bo',upd:600}] });                                                    // rev6 -> checkpoint

const eq = (a,b) => JSON.stringify(a) === JSON.stringify(b);

// checkpoints landed on the interval
const ckpt3 = fs.existsSync(path.join(dir,'checkpoint-3.json'));
const ckpt6 = fs.existsSync(path.join(dir,'checkpoint-6.json'));

// rebuild the latest rev, an intermediate rev (needs checkpoint-3 + one log step), and a pre-checkpoint rev
const r6 = replay(dir, 6), r4 = replay(dir, 4), r2 = replay(dir, 2);

// a HOLE must be refused, naming the missing rev. Doctor a copy of the log with rev 4 removed and rebuild to 5.
const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'cpreplay-hole-'));
fs.copyFileSync(path.join(dir,'checkpoint-3.json'), path.join(dir2,'checkpoint-3.json'));
const kept = fs.readFileSync(hub.LOG,'utf8').split('\n').filter(Boolean).filter(l => JSON.parse(l).rev !== 4);
fs.writeFileSync(path.join(dir2,'delta-log.jsonl'), kept.join('\n')+'\n');
let holeErr = null; try { replay(dir2, 5); } catch(e){ holeErr = e.message; }

// clean up
try { fs.rmSync(dir, {recursive:true, force:true}); fs.rmSync(dir2, {recursive:true, force:true}); } catch(e){}

console.log('\n=== RESULTS ===');
assert('a checkpoint is written every CHECKPOINT_EVERY revs (3 and 6)', ckpt3 && ckpt6);
assert('replay rebuilds the latest rev byte-identical to the live store', eq(r6, snap[6]));
assert('replay rebuilds an intermediate rev (checkpoint-3 + log) byte-identical', eq(r4, snap[4]));
assert('replay rebuilds a pre-checkpoint rev (empty base + log) byte-identical', eq(r2, snap[2]));
assert('a delta-log hole is REFUSED, naming the missing rev', !!holeErr && /rev 4/.test(holeErr));
if (holeErr) console.log('   hole error:', holeErr);

console.log('\n'+(ok?'ALL PASS':'FAIL'));
process.exit(ok ? 0 : 1);
