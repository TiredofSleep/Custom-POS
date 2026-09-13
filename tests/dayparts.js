const { chromium } = require('playwright-core');
const http = require('http'), fs = require('fs'), path = require('path');
const EXE = process.env.CHROMIUM_EXE || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const ROOT = path.resolve(__dirname, '..');
const TYPES = { '.html':'text/html', '.js':'text/javascript' };
function serve(){ return new Promise(r=>{ const s=http.createServer((rq,rs)=>{ if(rq.url==='/favicon.ico'){rs.statusCode=204;return rs.end();} const f=path.join(ROOT,rq.url.split('?')[0]); fs.readFile(f,(e,b)=>{ if(e){rs.statusCode=404;return rs.end('nf');} rs.setHeader('Content-Type',TYPES[path.extname(f)]||'text/plain'); rs.end(b); }); }); s.listen(0,'127.0.0.1',()=>r(s)); }); }

// ⏰ DAY-PART MENUS + HAPPY-HOUR PRICING — items can carry an availability window (breakfast till 11) and a
// happy-hour price that applies inside a shop window. Time is injected so the test is deterministic.
(async () => {
  const errors = [];
  const server = await serve(); const port = server.address().port;
  const b = await chromium.launch({ executablePath: EXE, args:['--no-sandbox'] });
  const ctx = await b.newContext(); const p = await ctx.newPage();
  p.on('console', m => { if (m.type()==='error') errors.push(m.text()); });
  p.on('pageerror', e => errors.push('pageerror: '+e.message));
  await p.goto(`http://127.0.0.1:${port}/builder.html`);
  await p.locator('button.trade').filter({ hasText: 'Full-service' }).click();
  await p.getByRole('button',{name:/Build it for me/}).click();
  await p.waitForFunction(() => window.__build && window.__build.html);

  const out = await p.evaluate(() => {
    const w=document.querySelector('#preview').contentWindow;
    const wine=w.CUSTOMPOS_FLOW.catalog.find(x=>x.name==='House Wine');
    const at4=new Date(2026,0,1,16,0), at12=new Date(2026,0,1,12,0), at10=new Date(2026,0,1,10,0);
    const brunch={from:"09:00",to:"11:00"};
    return {
      wineHasHappy: wine && wine.happyPrice===6,
      happyOn4: w.happyActive(at4), happyOff12: w.happyActive(at12),
      wine4: w.itemPriceNow(wine,at4), wine12: w.itemPriceNow(wine,at12),
      brunchOpen: w.itemAvailNow({avail:brunch}, at10), brunchClosed: w.itemAvailNow({avail:brunch}, at4),
      allDay: w.itemAvailNow({}, at4),
      overnight: w.withinWindow({from:"22:00",to:"02:00"}, new Date(2026,0,1,1,0))
    };
  });

  await b.close(); server.close();
  console.log('\n=== RESULTS ===');
  console.log('bistro bar drink carries a happy-hour price:', out.wineHasHappy);
  console.log('happy hour is on at 4pm, off at noon:', out.happyOn4 && !out.happyOff12);
  console.log('wine rings $6 in happy hour, $11 otherwise:', out.wine4===6 && out.wine12===11);
  console.log('day-part item available in-window (10am), hidden out (4pm):', out.brunchOpen && !out.brunchClosed);
  console.log('an item with no window is always available; overnight window wraps midnight:', out.allDay && out.overnight);
  console.log('console errors:', errors.length?errors:'NONE');
  const ok = out.wineHasHappy && out.happyOn4 && !out.happyOff12 && out.wine4===6 && out.wine12===11 && out.brunchOpen && !out.brunchClosed && out.allDay && out.overnight && !errors.length;
  process.exit(ok?0:1);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
