// Stage D1 (the mirror): delta sync trusts `rev`, but a dropped push or a bug can leave two stations silently
// out of agreement with their rev counters still looking fine. Each station fingerprints its keyed collections
// (order-independent) and the hub NAMES which disagree; a heal is a full re-pull of the named collection. The
// fingerprint block MUST be byte-identical in pos.html and hub.js — a fingerprint that means one thing on the
// station and another on the hub would invent drift or hide it. Browser + fs + hub.
const path = require('path'), fs = require('fs'), os = require('os');
const DATA = path.join(os.tmpdir(), 'custompos-mirror-'+process.pid+'.json');
try { fs.unlinkSync(DATA); } catch(e){}
process.env.DATA = DATA;
const hub = require('../hub.js');
const { chromium } = require('playwright-core');
const EXE = process.env.CHROMIUM_EXE || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

let ok = true;
function assert(name, cond){ console.log((cond?'✓':'✗')+' '+name); if(!cond) ok=false; }

// (1) THE GATE: the /*<<FP>>*/ … /*<</FP>>*/ block is byte-identical in both files
function fpBlock(file){ const s = fs.readFileSync(path.resolve(__dirname,'..',file),'utf8');
  const a = s.indexOf('/*<<FP>>*/'), b = s.indexOf('/*<</FP>>*/'); return (a<0||b<0) ? null : s.slice(a, b+'/*<</FP>>*/'.length); }
const engBlock = fpBlock('pos.html'), hubBlock = fpBlock('hub.js');
assert('the fingerprint block exists in both files', !!engBlock && !!hubBlock);
assert('the fingerprint block is BYTE-IDENTICAL in pos.html and hub.js', engBlock === hubBlock);

(async () => {
  const errors = [];
  await new Promise(r => hub.server.listen(0, '127.0.0.1', r));
  const port = hub.server.address().port;
  const base = `http://127.0.0.1:${port}`;
  const b = await chromium.launch({ executablePath: EXE, args:['--no-sandbox'] });

  // (2) behavioral equivalence: the engine's fingerprint ranks the same battery the hub does, order-independently
  const p0 = await (await b.newContext()).newPage();
  p0.on('pageerror', e => errors.push('pageerror: '+e.message));
  await p0.goto(`${base}/pos.html`);
  const battery = [ {list:[{id:'a',x:1},{id:'b',x:2}], key:'id'},
                    {list:[{id:'b',x:2},{id:'a',x:1}], key:'id'},     // same set, different order -> same fp
                    {list:[{id:'a',x:9},{id:'b',x:2}], key:'id'},     // one record differs -> different fp
                    {list:[{phone:'1',n:'z'}], key:'phone'} ];
  const eng = await p0.evaluate(bt => bt.map(t => fingerprint(t.list, t.key)), battery);
  const hb  = battery.map(t => hub.fingerprint(t.list, t.key));
  assert('engine fingerprint matches the hub across the battery', JSON.stringify(eng) === JSON.stringify(hb));
  assert('fingerprint is order-independent (same set, any order, same hash)', JSON.stringify(eng[0]) === JSON.stringify(eng[1]));
  assert('fingerprint distinguishes a differing record', JSON.stringify(eng[0]) !== JSON.stringify(eng[2]));

  // (3) verify naming: identical stores agree; a drift is named
  const store = { records:[{id:'R1',status:'READY',upd:100,lines:[]}], customers:[] };
  const same = hub.verifyFingerprints(store, { records: hub.fingerprint(store.records,'id'), customers: hub.fingerprint(store.customers,'phone') });
  const drift = hub.verifyFingerprints(store, { records: hub.fingerprint([{id:'R1',status:'READY',upd:100,lines:[{qty:1}]}],'id'), customers: hub.fingerprint([],'phone') });
  assert('identical stations report no disagreement', same.disagree.length === 0);
  assert('a drifted collection is NAMED', drift.disagree.length === 1 && drift.disagree[0] === 'records');

  // (4) HEAL: a device that has silently drifted (rev still current, so delta pull sends nothing) reconciles via verify()
  const A = await b.newContext(); const pa = await A.newPage();
  await pa.goto(`${base}/pos.html?hub=${base}`);
  await pa.getByRole('button',{name:/^Order Counter/}).first().click();
  await pa.getByText('Coffee',{exact:false}).first().click();
  await pa.getByRole('button',{name:/Send order/}).click();
  await pa.waitForTimeout(400);

  const B = await b.newContext(); const pb = await B.newPage();
  pb.on('pageerror', e => errors.push('B pageerror: '+e.message));
  await pb.goto(`${base}/pos.html?hub=${base}`);
  const DKEY = await pb.evaluate(() => dkey());
  await pb.waitForFunction((k)=>{ try{ return (JSON.parse(localStorage.getItem(k)||'{}').records||[]).length>0; }catch(e){ return false; } }, DKEY, {timeout:8000});
  // silently corrupt B's copy with a STALE upd (older than the hub's), leaving rev untouched so delta pull skips it
  const drifted = await pb.evaluate((k)=>{ const d=JSON.parse(localStorage.getItem(k)); d.records[0].lines=[{name:'GHOST',qty:9,price:0}]; d.records[0].upd=1; localStorage.setItem(k, JSON.stringify(d)); return d.records[0].lines[0].name; }, DKEY);
  const hubName = await pb.evaluate(async (bs)=>{ const j=await fetch(bs+'/api/db').then(r=>r.json()); const r=(j.db.records||[])[0]; return (r.lines[0]||{}).name; }, base);
  // the mirror detects and heals
  const vres = await pb.evaluate(() => SYNC.verify());
  await pb.waitForTimeout(400);
  const afterHeal = await pb.evaluate((k)=>{ const r=JSON.parse(localStorage.getItem(k)).records[0]; return (r.lines[0]||{}).name; }, DKEY);

  await b.close();
  await new Promise(r => hub.server.close(r));
  try { fs.unlinkSync(DATA); } catch(e){}

  assert('B genuinely drifted (its ghost differs from the hub)', drifted === 'GHOST' && hubName !== 'GHOST');
  assert('verify() named the records collection as disagreeing', !!vres && vres.disagree && vres.disagree.indexOf('records') >= 0);
  assert('after the heal, B matches the hub again (ghost gone)', afterHeal !== 'GHOST' && afterHeal === hubName);
  assert('no unexpected page errors', errors.length === 0);
  if (errors.length) console.log('errors:', errors);
  console.log('\n'+(ok?'ALL PASS':'FAIL'));
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
