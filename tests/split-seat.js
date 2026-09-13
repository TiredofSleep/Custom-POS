const { chromium } = require('playwright-core');
const http = require('http'), fs = require('fs'), path = require('path');
const EXE = process.env.CHROMIUM_EXE || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const ROOT = path.resolve(__dirname, '..');
const TYPES = { '.html':'text/html', '.js':'text/javascript' };
function serve(){ return new Promise(r=>{ const s=http.createServer((rq,rs)=>{ if(rq.url==='/favicon.ico'){rs.statusCode=204;return rs.end();} const f=path.join(ROOT,rq.url.split('?')[0]); fs.readFile(f,(e,b)=>{ if(e){rs.statusCode=404;return rs.end('nf');} rs.setHeader('Content-Type',TYPES[path.extname(f)]||'text/plain'); rs.end(b); }); }); s.listen(0,'127.0.0.1',()=>r(s)); }); }

// 💳👤 SPLIT & PAY BY SEAT — each guest pays their own check. Rings 3 lines (seat 1, seat 2, a shared line),
// fires them, then at payment splits BY SEAT and pays each bucket with a different tender; the order only closes
// when every seat is paid, and each tender is tagged to its seat.
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

  // unit-check the seat-split math on a synthetic order (seat1 $12, seat2 $34, shared $16)
  const unit = await p.evaluate(() => {
    const w=document.querySelector('#preview').contentWindow;
    const r={ id:"RT", number:99, status:"READY", tenders:[], lines:[ {id:"a",name:"A",price:12,qty:1,seat:1}, {id:"b",name:"B",price:34,qty:1,seat:2}, {id:"c",name:"C",price:16,qty:1,seat:null} ] };
    const bkts=w.seatBuckets(r).reduce((o,x)=>{o[x.label]=w.seatAmount(r,x);return o;},{});
    r.tenders.push({type:"cash",amount:12,seatKey:"s1"}); const balAfter1=w.recordBalance(r);
    r.tenders.push({type:"card",amount:34,seatKey:"s2"}); r.tenders.push({type:"cash",amount:16,seatKey:"shared"});
    return { total:w.recordTotal(r), bkts, balAfter1, balEnd:w.recordBalance(r) };
  });

  // drive the real flow
  const flow = await p.evaluate(async () => {
    const doc=()=>document.querySelector('#preview').contentDocument;
    const w=document.querySelector('#preview').contentWindow;
    const wait=ms=>new Promise(r=>setTimeout(r,ms));
    const cB=re=>{const b=[...doc().querySelectorAll('button')].find(x=>re.test(x.textContent.trim()));if(b){b.click();return true;}return false;};
    const cT=re=>{const b=[...doc().querySelectorAll('.tile')].find(x=>re.test(x.textContent));if(b){b.click();return true;}return false;};
    const cLink=re=>{const b=[...doc().querySelectorAll('a')].find(x=>re.test(x.textContent.trim()));if(b){b.click();return true;}return false;};
    cB(/^Got it/); await wait(80); cB(/^Server Station/); await wait(150);
    cB(/^1$/); await wait(120);
    cB(/^Seat 1/); await wait(60); cT(/Calamari/); await wait(100);
    cB(/^Seat 2/); await wait(60); cT(/Ribeye/); await wait(80); cB(/^Rare|^Med rare|^Medium/); cB(/Add to order/); await wait(100);
    cB(/Whole table/); await wait(60); cT(/Bistro Burger/); await wait(120);
    cB(/Send order/); await wait(200);
    // fire everything at the Kitchen Line — bump until the order is READY
    cLink(/change station/); await wait(120); cB(/^Kitchen Line/); await wait(150);
    for(let i=0;i<12;i++){ const rc=(w.loadDB().records||[]).slice(-1)[0]; if(rc&&rc.status==='READY') break; cB(/Mark done here/); await wait(150); }
    const readied=(w.loadDB().records||[]).slice(-1)[0].status;
    // back to server, open the ready order, split by seat, pay each bucket
    cLink(/change station/); await wait(120); cB(/^Server Station/); await wait(200);
    const openIt=[...doc().querySelectorAll('button, .card, .line, a')].find(x=>/Calamari|Ribeye|Bistro Burger|#/.test(x.textContent||'')); if(openIt)openIt.click(); await wait(200);
    const bySeat=cB(/By seat/); await wait(150);
    const bucketRows=[...doc().querySelectorAll('.line')].filter(l=>/Seat 1|Seat 2|Shared/.test(l.textContent)).length;
    // pay: cash, card, cash — advanceSeat moves to the next unpaid bucket after each
    cB(/ cash$/); await wait(150);
    cB(/Pay by card|by card/); await wait(200);
    cB(/ cash$/); await wait(200);
    const rec=(w.loadDB().records||[]).slice(-1)[0];
    const tagged=(rec.tenders||[]).filter(t=>t.seatKey).length;
    return { readied, bySeat, bucketRows, status:rec.status, balance:w.recordBalance(rec), tenders:(rec.tenders||[]).length, tagged };
  });

  await b.close(); server.close();
  console.log('\n=== RESULTS ===');
  console.log('seat-split math (total 62; Seat 1=12, Seat 2=34, Shared=16):', unit.total===62 && unit.bkts['Seat 1']===12 && unit.bkts['Seat 2']===34 && unit.bkts['Shared']===16);
  console.log('paying seat 1 leaves the rest due (bal 50 → 0):', unit.balAfter1===50 && unit.balEnd===0);
  console.log('order fires to READY:', flow.readied==='READY');
  console.log('"By seat" shows a row per seat + shared (3):', flow.bySeat && flow.bucketRows===3);
  console.log('paying each bucket closes the order, every tender seat-tagged:', flow.status==='PAID' && flow.balance<=0.0001 && flow.tagged===flow.tenders && flow.tenders>=3);
  console.log('console errors:', errors.length?errors:'NONE');
  const ok = unit.total===62 && unit.bkts['Seat 1']===12 && unit.bkts['Seat 2']===34 && unit.bkts['Shared']===16 && unit.balAfter1===50 && unit.balEnd===0
    && flow.readied==='READY' && flow.bySeat && flow.bucketRows===3 && flow.status==='PAID' && flow.balance<=0.0001 && flow.tagged===flow.tenders && flow.tenders>=3 && !errors.length;
  process.exit(ok?0:1);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
