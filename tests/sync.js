const path = require('path'), fs = require('fs'), os = require('os');
const DATA = path.join(os.tmpdir(), 'custompos-hub-test-' + process.pid + '.json');
try { fs.unlinkSync(DATA); } catch (e) {}
process.env.DATA = DATA;                       // fresh hub store, set BEFORE requiring hub.js
const hub = require('../hub.js');
const { chromium } = require('playwright-core');
const EXE = process.env.CHROMIUM_EXE || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

(async () => {
  const errors = [];
  await new Promise(r => hub.server.listen(0, '127.0.0.1', r));
  const port = hub.server.address().port;
  const base = `http://127.0.0.1:${port}`;
  const url = `${base}/pos.html?hub=${base}`;
  const DKEY = 'custompos_demo_counter';

  const b = await chromium.launch({ executablePath: EXE, args:['--no-sandbox'] });

  // DEVICE A (its own context = its own localStorage): make an order -> pushes to the hub
  const A = await b.newContext(); const pa = await A.newPage();
  pa.on('console', m => { if (m.type()==='error') errors.push('A: '+m.text()); });
  pa.on('pageerror', e => errors.push('A pageerror: '+e.message));
  await pa.goto(url);
  await pa.getByRole('button',{name:/^Order Counter/}).first().click();
  await pa.getByText('Coffee',{exact:false}).first().click();
  await pa.getByRole('button',{name:/Send order/}).click();
  await pa.waitForTimeout(600);   // let the push land

  // hub actually has it
  const hubHasIt = await pa.evaluate(async (b) => {
    const j = await fetch(b + '/api/db').then(r=>r.json()); return (j.db.records||[]).length;
  }, base);

  // DEVICE B (separate context/localStorage): pulls from the hub on boot -> sees A's order
  const B = await b.newContext(); const pb = await B.newPage();
  pb.on('console', m => { if (m.type()==='error') errors.push('B: '+m.text()); });
  pb.on('pageerror', e => errors.push('B pageerror: '+e.message));
  await pb.goto(url);
  await pb.waitForFunction((k) => { try { return (JSON.parse(localStorage.getItem(k)||'{}').records||[]).length>0; } catch(e){ return false; } }, DKEY, { timeout: 8000 });
  await pb.getByRole('button',{name:/^Bar/}).first().click();
  const barB = await pb.locator('main').innerText();
  const bSeesOrder = /#1/.test(barB) && /Coffee/.test(barB);

  await b.close();
  await new Promise(r => hub.server.close(r));
  try { fs.unlinkSync(DATA); } catch (e) {}

  console.log('device B Bar:', barB.replace(/\n+/g,' | '));
  console.log('\n=== RESULTS ===');
  console.log('order pushed to the hub:', hubHasIt === 1);
  console.log('separate device pulls it from the hub:', bSeesOrder);
  console.log('console errors:', errors.length?errors:'NONE');
  process.exit(errors.length || hubHasIt !== 1 || !bSeesOrder ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
