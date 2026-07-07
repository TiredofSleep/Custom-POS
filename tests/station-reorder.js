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

  await p.locator('button.trade').filter({ hasText: 'Ring up items' }).click();   // Retail: Register, Office, Sales Board
  const before = await p.evaluate(() => window.__cfgOrder = null);
  const startOrder = await p.evaluate(() => [...document.querySelectorAll('.chips')[0].querySelectorAll('.chip')].map(c=>c.textContent));

  // select the last station and move it earlier twice (to the front)
  await p.locator('.chip').filter({ hasText: 'Sales Board' }).click();
  await p.locator('.ed').getByRole('button',{name:/earlier/}).click();
  await p.locator('.ed').getByRole('button',{name:/earlier/}).click();

  await p.getByRole('button',{name:/Build it for me/}).click();
  await p.waitForFunction(() => window.__build && window.__build.html);
  const order = await p.evaluate(() => window.__build.flow.stations.map(s=>s.label));

  await b.close(); server.close();
  console.log('start chips:', JSON.stringify(startOrder));
  console.log('final order:', JSON.stringify(order));
  console.log('\n=== RESULTS ===');
  const movedToFront = order[0]==='Sales Board' && order.length===3 && order.includes('Register') && order.includes('Office');
  console.log('station reordered to the front of the flow:', movedToFront);
  console.log('console errors:', errors.length?errors:'NONE');
  process.exit(errors.length || !movedToFront ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
