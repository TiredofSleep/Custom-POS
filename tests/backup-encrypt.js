// Stage E1 (encrypted, tamper-evident backup): a backup that can silently restore to garbage is worse than
// none. The format authenticates itself — gzip -> AES-256-GCM, scrypt-derived key, self-describing header —
// so a wrong passphrase or a single flipped byte fails GCM authentication and THROWS rather than handing back
// a plausible-but-wrong DB. Pure Node.
const { encrypt, decrypt, readHeader } = require('../backup.js');

let ok = true;
function assert(name, cond){ console.log((cond?'✓':'✗')+' '+name); if(!cond) ok=false; }

const db = { records:[{id:'R1',status:'PAID',upd:123,lines:[{qty:2,price:5}],tenders:[{type:'cash',amount:10}]}],
             customers:[{phone:'111',name:'Ann'}], seq:7, rev:3 };
const PASS = 'correct horse battery staple';

const blob = encrypt(db, PASS);
const round = decrypt(blob, PASS);
assert('a round-trip decrypts byte-identical to the original', JSON.stringify(round) === JSON.stringify(db));

// a wrong passphrase throws (does NOT return a wrong DB)
let wrongThrew = false; try { decrypt(blob, 'wrong pass'); } catch(e){ wrongThrew = true; }
assert('a wrong passphrase throws (never returns a wrong DB)', wrongThrew);

// a single flipped byte in the ciphertext throws (GCM authenticates the whole message)
const tampered = Buffer.from(blob); tampered[tampered.length-1] ^= 0x01;
let tamperThrew = false; try { decrypt(tampered, PASS); } catch(e){ tamperThrew = true; }
assert('a flipped ciphertext byte throws (tamper-evident)', tamperThrew);

// corrupting a crypto-critical header field (the auth tag) also throws — GCM authenticates the whole message
const tagStr = Buffer.from(readHeader(blob).tag, 'utf8');   // the tag's base64 as it sits in the header JSON
const tagIdx = blob.indexOf(tagStr);
const tampered2 = Buffer.from(blob); tampered2[tagIdx] ^= 0x01;   // flip one char of the stored auth tag
let headerThrew = false; try { decrypt(tampered2, PASS); } catch(e){ headerThrew = true; }
assert('a corrupted auth tag throws', headerThrew && tagIdx > 0);

// the header is self-describing (readable without the passphrase) and names its KDF
const h = readHeader(blob);
assert('the header self-describes its KDF params without the passphrase', h.kdf === 'scrypt' && h.N > 0 && !!h.salt && !!h.iv && !!h.tag);

// two encryptions of the same data differ (random salt+iv) yet both decrypt — no deterministic ciphertext leak
const blob2 = encrypt(db, PASS);
assert('two backups of the same data differ (fresh salt/iv) but both decrypt',
  !blob.equals(blob2) && JSON.stringify(decrypt(blob2, PASS)) === JSON.stringify(db));

// a non-backup buffer is rejected clearly
let junkThrew = false; try { decrypt(Buffer.from('hello world not a backup'), PASS); } catch(e){ junkThrew = /not a customPOS backup/.test(e.message); }
assert('a non-backup buffer is rejected with a clear message', junkThrew);

console.log('\n'+(ok?'ALL PASS':'FAIL'));
process.exit(ok ? 0 : 1);
