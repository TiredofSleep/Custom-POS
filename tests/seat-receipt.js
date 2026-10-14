const { chromium } = require('playwright-core');
const http = require('http'), fs = require('fs'), path = require('path');
const EXE = process.env.CHROMIUM_EXE || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const ROOT = path.resolve(__dirname, '..');
const TYPES = { '.html':'text/html', '.js':'text/javascript' };
function serve(){ return new Promise(r=>{ const s=http.createServer((rq,rs)=>{ if(rq.url==='/favicon.ico'){rs.statusCode=204;return rs.end();} const f=path.join(ROOT,rq.url.split('?')[0]); fs.readFile(f,(e,b)=>{ if(e){rs.statusCode=404;return rs.end('nf');} rs.setHeader('Content-Type',TYPES[path.extname(f)]||'text/plain'); rs.end(b); }); }); s.listen(0,'127.0.0.1',()=>r(s)); }); }

// 👤🧾 PER-SEAT RECEIPT: when an order was rung by seat, the receipt groups its items under each seat (+ Shared)
// with per-seat subtotals — the itemized companion to split-by-seat.
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
    const seated={ id:'RR', number:9, status:'READY', tenders:[], lines:[ {id:'a',name:'Calamari',price:12,qty:1,seat:1}, {id:'b',name:'Ribeye',price:34,qty:1,seat:2}, {id:'c',name:'Bread',price:6,qty:1,seat:null} ] };
    const seatedHtml=w.receiptPanel(seated).innerHTML;
    const flat={ id:'RF', number:10, status:'READY', tenders:[], lines:[ {id:'x',name:'Burger',price:9,qty:1} ] };
    const flatHtml=w.receiptPanel(flat).innerHTML;
    return {
      grouped: /Seat 1/.test(seatedHtml) && /Seat 2/.test(seatedHtml) && /Shared/.test(seatedHtml) && /Calamari/.test(seatedHtml) && /Ribeye/.test(seatedHtml),
      total: /Total/.test(seatedHtml),
      flatUngrouped: !/Seat 1/.test(flatHtml) && /Burger/.test(flatHtml)
    };
  });

  await b.close(); server.close();
  console.log('\n=== RESULTS ===');
  console.log('a seated order receipt groups items by seat (+ Shared) with subtotals:', out.grouped);
  console.log('it still shows the order total:', out.total);
  console.log('a non-seated order receipt stays a flat list:', out.flatUngrouped);
  console.log('console errors:', errors.length?errors:'NONE');
  const ok = out.grouped && out.total && out.flatUngrouped && !errors.length;
  process.exit(ok?0:1);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
