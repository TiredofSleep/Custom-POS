const { chromium } = require('playwright-core');
const http = require('http'), fs = require('fs'), path = require('path');
const EXE = process.env.CHROMIUM_EXE || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const ROOT = path.resolve(__dirname, '..');
const TYPES = { '.html':'text/html', '.js':'text/javascript' };
function serve(){ return new Promise(r=>{ const s=http.createServer((rq,rs)=>{ if(rq.url==='/favicon.ico'){rs.statusCode=204;return rs.end();} const f=path.join(ROOT,rq.url.split('?')[0]); fs.readFile(f,(e,b)=>{ if(e){rs.statusCode=404;return rs.end('nf');} rs.setHeader('Content-Type',TYPES[path.extname(f)]||'text/plain'); rs.end(b); }); }); s.listen(0,'127.0.0.1',()=>r(s)); }); }

(async () => {
  const errors = [];
  const server = await serve(); const port = server.address().port;
  const b = await chromium.launch({ executablePath: EXE, args:['--no-sandbox'] });
  const ctx = await b.newContext(); const p = await ctx.newPage();
  p.on('console', m => { if (m.type()==='error') errors.push(m.text()); });
  p.on('pageerror', e => errors.push('pageerror: '+e.message));
  await p.goto(`http://127.0.0.1:${port}/builder.html`);

  await p.locator('button.trade').filter({ hasText: 'Made-to-order' }).click();   // Café
  // business: toggle loyalty on (café has none by default)
  await p.getByRole('button',{name:'loyalty'}).click();
  // add an item, edit it: name, price, route it through Bar, add a flag
  await p.getByRole('button',{name:'+ Add item'}).click();
  await p.locator('#itemName').fill('Milkshake');
  await p.locator('#itemPrice').fill('6');
  await p.locator('.ed button').filter({ hasText: /^Bar$/ }).click();   // add Bar to this item's path
  await p.locator('.ed').getByRole('button',{name:'+ flag'}).click();
  // configure a workstation: give the Bar a QC checklist
  await p.locator('.chip').filter({ hasText: /^Bar/ }).click();
  await p.locator('.ed').getByRole('button',{name:'+ checklist step'}).click();
  // build
  await p.getByRole('button',{name:/Build & download my POS/}).click();
  await p.waitForFunction(() => window.__build && window.__build.html);

  const r = await p.evaluate(() => {
    const f = window.__build.flow;
    const bar = f.stations.find(s=>s.label==='Bar');
    const shake = f.catalog.find(i=>i.name==='Milkshake');
    return {
      loyaltyOn: !!f.endpoints.loyalty,
      itemAdded: f.catalog.length===4 && !!shake,
      itemPriced: shake && shake.price===6,
      itemRouted: shake && (shake.path||[]).includes(bar.id),
      itemFlagged: shake && (shake.flags||[]).length>=1,
      stationChecklist: bar && (bar.checklist||[]).length>=1
    };
  });
  await p.waitForTimeout(300);
  const preview = await p.frameLocator('#preview').locator('#bizName').innerText();

  await b.close(); server.close();
  console.log('result:', JSON.stringify(r), 'preview:', preview);
  console.log('\n=== RESULTS ===');
  console.log('business module toggled (loyalty on):', r.loyaltyOn);
  console.log('item added + named + priced:', r.itemAdded && r.itemPriced);
  console.log('module follows the ITEM (path routed to Bar):', r.itemRouted);
  console.log('flag attached to the item:', r.itemFlagged);
  console.log('module follows the WORKSTATION (Bar checklist):', r.stationChecklist);
  console.log('edited config builds a running POS:', preview.length>0);
  console.log('console errors:', errors.length?errors:'NONE');
  const ok = r.loyaltyOn && r.itemAdded && r.itemPriced && r.itemRouted && r.itemFlagged && r.stationChecklist && preview.length>0 && !errors.length;
  process.exit(ok?0:1);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
