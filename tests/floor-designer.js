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

  await p.locator('button.trade').filter({ hasText: 'Dine-in' }).click();   // Full-service restaurant (has a floor)
  const canvasShown = await p.locator('.floorcanvas').count()===1;
  const startTiles = await p.locator('.ftile').count();

  // add a table -> edit it (editor shows for the newly-added, selected table)
  await p.getByRole('button',{name:/\+ Add table/}).click();
  await p.locator('.ed input.sm').nth(0).fill('VIP');
  await p.locator('.ed input.sm').nth(1).fill('8');
  await p.locator('.ed input.sm').nth(2).fill('Patio');

  // drag the first table across the canvas
  const tile0 = p.locator('.ftile').first();
  const box = await tile0.boundingBox();
  await p.mouse.move(box.x + box.width/2, box.y + box.height/2);
  await p.mouse.down();
  await p.mouse.move(box.x + box.width/2 + 60, box.y + box.height/2 + 40, { steps:6 });
  await p.mouse.up();

  await p.getByRole('button',{name:/Build it for me/}).click();
  await p.waitForFunction(() => window.__build && window.__build.html);
  const r = await p.evaluate(() => {
    const t = window.__build.flow.floor.tables;
    const vip = t.find(x=>x.label==='VIP');
    const first = t[0];
    return {
      count: t.length,
      vipOk: !!vip && vip.seats===8 && vip.section==='Patio',
      allPositioned: t.every(x=>typeof x.x==='number' && typeof x.y==='number'),
      firstMoved: first.x > 10   // started auto-placed at x=10; a drag moved it right
    };
  });

  await b.close(); server.close();
  console.log('result:', JSON.stringify(r), 'startTiles:', startTiles);
  console.log('\n=== RESULTS ===');
  console.log('floor designer canvas renders with tiles:', canvasShown && startTiles>=10);
  console.log('add table -> catalog grows by one:', r.count===startTiles+1);
  console.log('table edited (VIP, 8 seats, Patio):', r.vipOk);
  console.log('every table has an x,y position:', r.allPositioned);
  console.log('dragging a table moved it:', r.firstMoved);
  console.log('console errors:', errors.length?errors:'NONE');
  const ok = canvasShown && startTiles>=10 && r.count===startTiles+1 && r.vipOk && r.allPositioned && r.firstMoved && !errors.length;
  process.exit(ok?0:1);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
