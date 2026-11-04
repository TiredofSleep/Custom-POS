const { chromium } = require('playwright-core');
const http = require('http'), fs = require('fs'), path = require('path');
const EXE = process.env.CHROMIUM_EXE || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const ROOT = path.resolve(__dirname, '..');
const TYPES = { '.html':'text/html', '.js':'text/javascript' };
function serve(){ return new Promise(r=>{ const s=http.createServer((rq,rs)=>{ if(rq.url==='/favicon.ico'){rs.statusCode=204;return rs.end();} const f=path.join(ROOT,rq.url.split('?')[0]); fs.readFile(f,(e,b)=>{ if(e){rs.statusCode=404;return rs.end('nf');} rs.setHeader('Content-Type',TYPES[path.extname(f)]||'text/plain'); rs.end(b); }); }); s.listen(0,'127.0.0.1',()=>r(s)); }); }

// 💳👤 SPLIT & PAY BY SEAT — each guest pays their own. Drives the engine's own seat-split math + tender model
// on a real (built) engine: one bucket per seat (+ a "Shared" bucket), each seat's amount is its share of the
// total, tenders tag to a seat, and the order only clears when every seat is paid. (UI wiring verified live;
// this pins the money logic deterministically so it can't drift.)
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
    // seat1 $12, seat2 $34, shared $16 — no tax so the shares are exact
    const r={ id:"RT", number:99, status:"READY", tenders:[], splitMode:"seat",
      lines:[ {id:"a",name:"A",price:12,qty:1,seat:1}, {id:"b",name:"B",price:34,qty:1,seat:2}, {id:"c",name:"C",price:16,qty:1,seat:null} ] };
    const bkts=w.seatBuckets(r); const byLabel=l=>bkts.find(x=>x.label===l);
    const amounts={ s1:w.seatAmount(r,byLabel("Seat 1")), s2:w.seatAmount(r,byLabel("Seat 2")), shared:w.seatAmount(r,byLabel("Shared")) };
    const bucketCount=bkts.length;
    // pay each bucket with a seat-tagged tender; balance must only clear when all are paid
    r.tenders.push({type:"cash",amount:12,seatKey:"s1"});   const bal1=w.recordBalance(r); const s1cleared=w.seatDue(r,byLabel("Seat 1"))===0;
    r.tenders.push({type:"card",amount:34,seatKey:"s2"});   const bal2=w.recordBalance(r);
    const stillOpen = bal2>0.0001;                           // shared not yet paid
    r.tenders.push({type:"cash",amount:16,seatKey:"shared"});
    const balEnd=w.recordBalance(r);
    const allTagged=(r.tenders||[]).every(t=>t.seatKey);
    return { total:w.recordTotal(r), amounts, bucketCount, bal1, s1cleared, stillOpen, balEnd, allTagged };
  });

  await b.close(); server.close();
  console.log('\n=== RESULTS ===');
  console.log('total $62; one bucket per seat + shared (3):', out.total===62 && out.bucketCount===3);
  console.log('each seat billed its share (S1 12, S2 34, Shared 16):', out.amounts.s1===12 && out.amounts.s2===34 && out.amounts.shared===16);
  console.log('paying seat 1 clears only seat 1 (bal 50):', out.bal1===50 && out.s1cleared);
  console.log('order stays open until the shared bucket is paid too:', out.stillOpen && out.balEnd===0);
  console.log('every tender is tagged to its seat:', out.allTagged);
  console.log('console errors:', errors.length?errors:'NONE');
  const ok = out.total===62 && out.bucketCount===3 && out.amounts.s1===12 && out.amounts.s2===34 && out.amounts.shared===16
    && out.bal1===50 && out.s1cleared && out.stillOpen && out.balEnd===0 && out.allTagged && !errors.length;
  process.exit(ok?0:1);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
