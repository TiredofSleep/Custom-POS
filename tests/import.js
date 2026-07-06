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

  await p.locator('button.trade').filter({ hasText: 'Ring up items' }).click();   // Retail
  const before = await p.evaluate(() => window.__cfgLen === undefined ? null : null);
  const startCount = await p.evaluate(() => document.querySelectorAll('.chips')[1].querySelectorAll('.chip').length);

  // open the CSV importer and paste 3 items (with a header row that should be skipped)
  await p.getByRole('button',{name:/Import items \(CSV\)/}).click();
  await p.locator('#csvBox').fill('name, price, category, barcode\nBolt, 0.25, hardware, 7001\nNut, 0.15, hardware, 7002\nWasher, 0.10, hardware');
  await p.getByRole('button',{name:/^Import$/}).click();

  await p.getByRole('button',{name:/Build it for me/}).click();
  await p.waitForFunction(() => window.__build && window.__build.html);
  const r = await p.evaluate(() => {
    const f = window.__build.flow;
    const bolt = f.catalog.find(i=>i.name==='Bolt');
    const washer = f.catalog.find(i=>i.name==='Washer');
    return {
      added3: f.catalog.filter(i=>['Bolt','Nut','Washer'].includes(i.name)).length===3,
      headerSkipped: !f.catalog.some(i=>/^name$/i.test(i.name)),
      boltPriced: bolt && bolt.price===0.25 && bolt.category==='hardware' && bolt.barcode==='7001',
      washerNoBarcode: washer && washer.price===0.10 && washer.barcode===undefined
    };
  });

  await b.close(); server.close();
  console.log('start item chips:', startCount);
  console.log('result:', JSON.stringify(r));
  console.log('\n=== RESULTS ===');
  console.log('three items imported from CSV:', r.added3);
  console.log('header row skipped:', r.headerSkipped);
  console.log('fields parsed (price/category/barcode):', r.boltPriced);
  console.log('optional barcode handled (Washer has none):', r.washerNoBarcode);
  console.log('console errors:', errors.length?errors:'NONE');
  const ok = r.added3 && r.headerSkipped && r.boltPriced && r.washerNoBarcode && !errors.length;
  process.exit(ok?0:1);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
