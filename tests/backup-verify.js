// Stage E2 (backup-verify): a backup nobody has restored is a hope, not a safeguard. This decrypts the newest
// artifact, restores it, counts it against the live shop, runs the invariants against the restored copy, and
// publishes the result WITH its age. ok:null means never run (deliberately not true); a stale verify reads as
// stale, not fine; a backup that decrypts but is missing half the shop FAILS. Pure Node.
const os = require('os'), fs = require('fs'), path = require('path');
const { encrypt } = require('../backup.js');
const { verifyBackup, readStatus } = require('../backup-verify.js');

let ok = true;
function assert(name, cond){ console.log((cond?'✓':'✗')+' '+name); if(!cond) ok=false; }

const PASS = 'a-good-passphrase';
const live = { records:[{id:'R1',status:'PAID',upd:1,lines:[],tenders:[]},{id:'R2',status:'READY',upd:2,lines:[]}],
               customers:[{phone:'1',name:'A'},{phone:'2',name:'B'},{phone:'3',name:'C'},{phone:'4',name:'D'}], seq:2, rev:2 };

// (1) a good, fresh backup passes
const good = encrypt(live, PASS);
const rGood = verifyBackup({ live, backupBuf: good, passphrase: PASS });
assert('a good fresh backup verifies ok', rGood.ok === true && rGood.reasons.length === 0);
assert('it reports the restored counts and a fresh age', rGood.records === 2 && rGood.customers === 4 && rGood.stale === false);

// (2) a backup missing half the customers FAILS (decrypts fine, but the data is gone)
const halved = encrypt({ ...live, customers: live.customers.slice(0,2) }, PASS);
const rHalf = verifyBackup({ live, backupBuf: halved, passphrase: PASS });
assert('a backup missing half the customers fails', rHalf.ok === false && rHalf.reasons.some(x=>/customers/.test(x)));

// (3) a STALE backup reads as stale, not fine (even though it decrypts cleanly)
const rStale = verifyBackup({ live, backupBuf: good, passphrase: PASS, maxAgeMs: 3600000, now: Date.now() + 48*3600000 });
assert('a stale backup is not ok and is flagged stale', rStale.ok === false && rStale.stale === true);

// (4) the restored copy is run through the invariants — a fault inside it fails the verify
const corrupt = encrypt({ records:[{id:'D',status:'READY',upd:1,lines:[]},{id:'D',status:'READY',upd:2,lines:[]}], customers: live.customers, seq:1, rev:1 }, PASS);
const rInv = verifyBackup({ live, backupBuf: corrupt, passphrase: PASS });
assert('an invariant violation in the restored copy fails the verify', rInv.ok === false && rInv.reasons.some(x=>/invariant/.test(x)));

// (5) a wrong passphrase fails clearly (cannot authenticate), not a silent pass
const rWrong = verifyBackup({ live, backupBuf: good, passphrase: 'nope' });
assert('a backup that will not decrypt fails, not passes', rWrong.ok === false && rWrong.reasons.some(x=>/decrypt|authenticate/.test(x)));

// (6) no backup at all -> ok:null (never run), deliberately NOT true or false
const rNone = verifyBackup({ live, backupBuf: null, passphrase: PASS });
assert('no backup artifact reads as ok:null (never run), not a green tick', rNone.ok === null);

// (7) the published status file, when absent, reads as ok:null (never run)
const missing = path.join(os.tmpdir(), 'no-such-status-'+process.pid+'.json');
assert('a missing status file reads as ok:null', readStatus(missing).ok === null);

console.log('\n'+(ok?'ALL PASS':'FAIL'));
process.exit(ok ? 0 : 1);
