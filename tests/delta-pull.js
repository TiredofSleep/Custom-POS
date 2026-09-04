// Stage B1 (engine half): a station must PULL only what moved since the rev it holds, and MERGE it in — not
// re-download and overwrite the whole shop every 3s. This test watches the actual wire: a fresh device
// bootstraps with `?since=0` (the whole set), then a caught-up device that polls again asks `?since=<rev>`
// and the hub sends back ONLY the record that changed. The negative control is built in: against the old
// whole-DB pull, EVERY poll returned all records, so "a later poll carries exactly one record" is a claim
// that could not be true before the fix. Also pins the regression the merge fixes: a wholesale adopt WIPED
// this device's local-only collections (punches/bookings the hub doesn't sync) — the merge must preserve them.
const path = require('path'), fs = require('fs'), os = require('os');
const DATA = path.join(os.tmpdir(), 'custompos-delta-test-' + process.pid + '.json');
try { fs.unlinkSync(DATA); } catch (e) {}
process.env.DATA = DATA;                       // fresh hub store, set BEFORE requiring hub.js
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
  const url = `${base}/pos.html?hub=${base}`;
  const DKEY = 'custompos_demo_counter';

  const b = await chromium.launch({ executablePath: EXE, args:['--no-sandbox'] });

  // DEVICE A — make an order (pushes to the hub)
  const A = await b.newContext(); const pa = await A.newPage();
  pa.on('console', m => { if (m.type()==='error') errors.push('A: '+m.text()); });
  pa.on('pageerror', e => errors.push('A pageerror: '+e.message));
  await pa.goto(url);
  await pa.getByRole('button',{name:/^Order Counter/}).first().click();
  await pa.getByText('Coffee',{exact:false}).first().click();
  await pa.getByRole('button',{name:/Send order/}).click();
  await pa.waitForTimeout(600);

  // DEVICE B — record every /api/db GET it makes: the `since` it asked for and how many records came back
  const pulls = [];
  const B = await b.newContext(); const pb = await B.newPage();
  pb.on('console', m => { if (m.type()==='error') errors.push('B: '+m.text()); });
  pb.on('pageerror', e => errors.push('B pageerror: '+e.message));
  pb.on('response', async resp => {
    try { const u = new URL(resp.url()); if (u.pathname !== '/api/db' || resp.request().method() !== 'GET') return;
      const j = await resp.json();
      pulls.push({ since: u.searchParams.get('since'), delta: !!(j && j.delta), rev: j && j.rev,
                   n: (j && j.db && j.db.records ? j.db.records.length : 0) });
    } catch (e) {}
  });
  await pb.goto(url);
  // B bootstraps: its FIRST pull is `?since=0` and pulls the one existing order
  await pb.waitForFunction((k) => { try { return (JSON.parse(localStorage.getItem(k)||'{}').records||[]).length>0; } catch(e){ return false; } }, DKEY, { timeout: 8000 });
  // give B a local-only collection the hub never syncs, to prove a pull doesn't wipe it
  await pb.evaluate((k) => { const d=JSON.parse(localStorage.getItem(k)); d.punches=[{id:'P1',who:'ana'}]; localStorage.setItem(k, JSON.stringify(d)); }, DKEY);
  await pb.waitForTimeout(300);
  const revBefore = await pb.evaluate(() => SYNC.rev);

  // A makes a SECOND order while B is caught up (A is already at the register — just ring + send again)
  await pa.getByText('Coffee',{exact:false}).first().click();
  await pa.getByRole('button',{name:/Send order/}).click();
  await pa.waitForTimeout(600);

  // let B poll again (poller runs every 3s) and fold in the delta
  await pb.waitForFunction((k) => { try { return (JSON.parse(localStorage.getItem(k)||'{}').records||[]).length===2; } catch(e){ return false; } }, DKEY, { timeout: 8000 });
  await pb.waitForTimeout(300);

  const finalRecords = await pb.evaluate((k) => (JSON.parse(localStorage.getItem(k)).records||[]).length, DKEY);
  const punchKept   = await pb.evaluate((k) => (JSON.parse(localStorage.getItem(k)).punches||[]).length, DKEY);

  await b.close();
  await new Promise(r => hub.server.close(r));
  try { fs.unlinkSync(DATA); } catch (e) {}

  // the FIRST pull B made was a bootstrap: since=0, brought the existing order
  const boot = pulls[0];
  // a pull made AFTER B was caught up (since = the rev it held) that carried exactly the one new record
  const deltaPull = pulls.find(p => p.since && +p.since >= revBefore && +p.since > 0 && p.delta && p.n === 1);
  // and NO caught-up pull ever re-sent both records (the whole-DB-every-tick behavior the fix removes)
  const noWholeResend = !pulls.some(p => p.since && +p.since > 0 && p.n === 2);

  console.log('\npull log:', JSON.stringify(pulls));
  console.log('rev B held before A\'s 2nd order:', revBefore);
  console.log('\n=== RESULTS ===');
  assert('a fresh device bootstraps with ?since=0', boot && boot.since === '0' && boot.n >= 1);
  assert('a caught-up poll asks ?since=<rev> and gets ONLY the one changed record (delta)', !!deltaPull);
  assert('no caught-up poll ever re-sends the whole record set', noWholeResend);
  assert('B still ends with both orders (delta merged in, nothing lost)', finalRecords === 2);
  assert('a pull does NOT wipe B\'s local-only collection (punches survive)', punchKept === 1);
  assert('no console errors', errors.length === 0);
  if (errors.length) console.log('errors:', errors);
  console.log('\n'+(ok?'ALL PASS':'FAIL'));
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
