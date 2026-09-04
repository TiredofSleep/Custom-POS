// Stage C3 (blobGuard at the door): a signature or garment photo pasted into a record as an inline data:image
// base64 URI would ride in the synced DB forever — on every push, pull, backup and log line. The hub
// externalizes it to content-addressed storage and leaves a short `cpblob:` reference, so the inline image
// never reaches the merged DB and the SAME image across many records costs exactly one file. Pure Node.
const os = require('os'), fs = require('fs'), path = require('path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cpblob-'));
process.env.DATA = path.join(dir, 'db.json');
const hub = require('../hub.js');

let ok = true;
function assert(name, cond){ console.log((cond?'✓':'✗')+' '+name); if(!cond) ok=false; }
const realErr = console.error; console.error = () => {};

const imgA = 'data:image/png;base64,' + Buffer.from('PRETEND-PNG-BYTES-A').toString('base64');
const imgB = 'data:image/png;base64,' + Buffer.from('PRETEND-PNG-BYTES-B').toString('base64');
const blobDir = () => path.join(dir, 'blobs');
const countBlobs = () => { try { return fs.readdirSync(blobDir()).length; } catch(e){ return 0; } }

// push a record carrying an inline image (in a nested field, to prove the walk recurses)
let s = { records:[], customers:[], seq:0 };
s = hub.commit(s, { records:[{ id:'R1', status:'READY', upd:100, lines:[], sig:{ image: imgA } }] });

const stored = s.records.find(r=>r.id==='R1');
const noInlineInDB = !/data:image\//.test(JSON.stringify(s));          // the base64 never reached the merged DB
const refInPlace = stored && typeof stored.sig.image==='string' && stored.sig.image.slice(0,7)==='cpblob:';
const oneFileWritten = countBlobs() === 1;

// the SAME image again, in a different record -> still ONE file (content-addressed dedup)
s = hub.commit(s, { records:[{ id:'R2', status:'READY', upd:200, lines:[], sig:{ image: imgA } }] });
const sameImageOneFile = countBlobs() === 1;
const sameRef = s.records.find(r=>r.id==='R2').sig.image === stored.sig.image;

// a DIFFERENT image -> a second file
s = hub.commit(s, { records:[{ id:'R3', status:'READY', upd:300, lines:[], photo: imgB }] });
const differentImageTwoFiles = countBlobs() === 2;

try { fs.rmSync(dir, {recursive:true, force:true}); } catch(e){}
console.error = realErr;
console.log('\n=== RESULTS ===');
assert('the inline base64 image never reaches the merged DB', noInlineInDB);
assert('the field now holds a short cpblob: reference', refInPlace);
assert('the image bytes are written to content-addressed storage (one file)', oneFileWritten);
assert('the same image in another record costs no extra file (dedup)', sameImageOneFile && sameRef);
assert('a different image writes a second file', differentImageTwoFiles);

console.log('\n'+(ok?'ALL PASS':'FAIL'));
process.exit(ok ? 0 : 1);
