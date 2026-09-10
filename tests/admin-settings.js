// Admin/Settings: a shop can change its own tax, tips, name and labor target from the Office — no config edit,
// no re-download. Saved settings live in DB.settings and OVERLAY the flow at load, so the money math just reads
// FLOW as before. This proves a tax change from the settings panel actually flows into an order's tax and
// survives a reload (the "no tax or admin configs" gap the owner flagged).
const { chromium } = require('playwright-core');
const path = require('path');
const url = 'file://' + path.resolve(__dirname, '..', 'pos.html');
const EXE = process.env.CHROMIUM_EXE || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const FLOW = {
  flowId:'admincfg', label:'Admin Cfg', topology:'linear',
  branding:{ name:'Test Diner', brandColor:'#1f6feb' },
  endpoints:{ customer:{persist:false}, payment:{ tenders:['cash','card'], closeGate:'balanceLE0' }, tax:{ rate:0, included:false } },
  catalog:[ {id:'w', name:'Plate', price:10, category:'food', path:[]} ],
  stations:[ {id:'reg', type:'central', label:'Counter', view:{money:true}},
             {id:'office', type:'report', label:'Office', view:{money:true}} ],
};

let ok = true;
function assert(name, cond){ console.log((cond?'✓':'✗')+' '+name); if(!cond) ok=false; }

(async () => {
  const errors = [];
  const b = await chromium.launch({ executablePath: EXE, args:['--no-sandbox'] });
  const p = await (await b.newContext()).newPage();
  p.on('console', m => { if (m.type()==='error') errors.push(m.text()); });
  p.on('pageerror', e => errors.push('pageerror: '+e.message));
  await p.addInitScript(f => { window.CUSTOMPOS_FLOW = f; }, FLOW);
  await p.goto(url);

  // open the Office → Business settings, set 8.25% tax and a new name
  await p.evaluate(() => bindStation('office'));
  await p.waitForTimeout(100);
  await p.evaluate(() => { const d=document.querySelector('details'); if(d) d.open=true; });
  const setCard = p.locator('details', { hasText: 'Business settings' });
  await setCard.getByPlaceholder('28').fill('30');                          // target labor
  await setCard.locator('input[type=number]').first().fill('8.25');         // sales tax rate %
  await setCard.locator('input[type=text]').first().fill('Downtown Diner'); // business name
  await setCard.getByRole('button',{name:/Save settings/}).click();
  await p.waitForTimeout(150);

  const saved = await p.evaluate(() => ({ rate: (loadDB().settings&&loadDB().settings.tax||{}).rate, flowRate: FLOW.endpoints.tax.rate, name: FLOW.branding.name }));
  assert('the tax rate is saved to DB.settings (8.25% -> 0.0825)', Math.abs(saved.rate - 0.0825) < 1e-9);
  assert('applySettings overlaid it onto the live flow', Math.abs(saved.flowRate - 0.0825) < 1e-9);
  assert('the business name change took', saved.name === 'Downtown Diner');

  // ring a $10 plate -> tax should now be 8.25% = $0.825
  await p.evaluate(() => bindStation('reg'));
  await p.getByText('Plate',{exact:false}).first().click();
  const tax = await p.evaluate(() => { const r = DB.records && DB.records[0] ? DB.records[0] : { lines:[{catId:'w',name:'Plate',qty:1,price:10}] };
    // build a pending-like record for the tax calc if needed
    const rec = (pending||draft||{ lines:[{catId:'w',name:'Plate',qty:1,price:10}], tenders:[] });
    return recordTax(rec); });
  assert('an order is now taxed at the configured 8.25% ($10 -> ~$0.83)', Math.abs(tax - 0.825) < 0.01);

  // reload -> settings persist and re-apply on boot
  await p.reload();
  await p.waitForTimeout(150);
  const afterReload = await p.evaluate(() => ({ rate: FLOW.endpoints.tax.rate, name: FLOW.branding.name }));
  assert('the tax rate persists across a reload', Math.abs(afterReload.rate - 0.0825) < 1e-9);
  assert('the business name persists across a reload', afterReload.name === 'Downtown Diner');

  await b.close();
  console.log('\n=== RESULTS ===');
  assert('no console or page errors', errors.length === 0);
  if (errors.length) console.log('errors:', errors);
  console.log('\n'+(ok?'ALL PASS':'FAIL'));
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
