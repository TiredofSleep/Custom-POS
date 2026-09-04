// Stage D4 (crash reporter): a station that throws on load is otherwise SILENT — a blank screen and a driver
// who says "it's broken." The reporter captures window.onerror + unhandledrejection, DEDUPES by fault (a render
// that throws on every 3s poll is ONE fault, not 400), CAPS per page-load, and batches to a hub endpoint
// OUTSIDE the synced DB (a crash must never ride the merge to every station). Browser + hub.
const path = require('path'), fs = require('fs'), os = require('os');
const DATA = path.join(os.tmpdir(), 'custompos-crash-'+process.pid+'.json');
try { fs.unlinkSync(DATA); } catch(e){}
process.env.DATA = DATA;
const hub = require('../hub.js');
const { chromium } = require('playwright-core');
const EXE = process.env.CHROMIUM_EXE || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

let ok = true;
function assert(name, cond){ console.log((cond?'✓':'✗')+' '+name); if(!cond) ok=false; }

(async () => {
  const errors = [];
  await new Promise(r => hub.server.listen(0, '127.0.0.1', r));
  const port = hub.server.address().port;
  const base = `http://127.0.0.1:${port}`;
  const b = await chromium.launch({ executablePath: EXE, args:['--no-sandbox'] });
  const p = await (await b.newContext()).newPage();
  p.on('pageerror', e => errors.push('pageerror: '+e.message));   // synthetic ErrorEvents don't trip this
  await p.goto(`${base}/pos.html?hub=${base}`);

  const fire = (msg, ln=1) => p.evaluate(([m,l]) => window.dispatchEvent(new ErrorEvent('error', { message:m, filename:'pos.html', lineno:l, colno:1 })), [msg, ln]);

  // (A) a crash batches to the hub, into a log OUTSIDE the synced DB
  await fire('hub-boom');
  await p.waitForTimeout(400);
  const logRaw = (() => { try { return fs.readFileSync(path.join(path.dirname(DATA),'crash-log.jsonl'),'utf8'); } catch(e){ return ''; } })();
  const landedInLog = /hub-boom/.test(logRaw);
  const dbClean = await p.evaluate(async (bs) => { const j = await fetch(bs+'/api/db').then(r=>r.json()); return !/hub-boom/.test(JSON.stringify(j)); }, base);

  // (B) DEDUPE: the same fault 400× is captured once
  const dedupe = await p.evaluate(() => {
    CRASH._reset(); const ev = () => window.dispatchEvent(new ErrorEvent('error',{message:'render-boom',filename:'pos.html',lineno:42,colno:1}));
    for (let i=0;i<400;i++) ev();
    return { count: CRASH.count(), distinct: CRASH.distinct() };
  });
  const dedupedOnce = dedupe.count === 1 && dedupe.distinct === 1;

  // (C) CAP: a storm of DISTINCT faults is capped, not an unbounded flood
  const capped = await p.evaluate(() => {
    CRASH._reset(); for (let i=0;i<60;i++) window.dispatchEvent(new ErrorEvent('error',{message:'boom-'+i,filename:'pos.html',lineno:i,colno:1}));
    return CRASH.count();
  });
  const capHeld = capped === 25;

  // (D) the reporter can't jam itself: after all that, a fresh distinct fault is still captured (guard cleared)
  const stillWorks = await p.evaluate(() => { CRASH._reset(); window.dispatchEvent(new ErrorEvent('error',{message:'after',filename:'pos.html',lineno:9,colno:1})); return CRASH.count()===1; });

  await b.close();
  await new Promise(r => hub.server.close(r));
  try { fs.unlinkSync(DATA); fs.unlinkSync(path.join(path.dirname(DATA),'crash-log.jsonl')); } catch(e){}

  console.log('\n=== RESULTS ===');
  assert('a crash batches to the hub crash-log', landedInLog);
  assert('the crash does NOT enter the synced DB', dbClean);
  assert('the same fault 400× is captured once (deduped)', dedupedOnce);
  assert('a storm of distinct faults is capped at 25', capHeld);
  assert('the reporter clears its guard and keeps working afterward', stillWorks);
  assert('no unexpected page errors', errors.length === 0);
  if (errors.length) console.log('errors:', errors);
  console.log('\n'+(ok?'ALL PASS':'FAIL'));
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
