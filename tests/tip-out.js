const { chromium } = require('playwright-core');
const http = require('http'), fs = require('fs'), path = require('path');
const EXE = process.env.CHROMIUM_EXE || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const ROOT = path.resolve(__dirname, '..');
const TYPES = { '.html':'text/html', '.js':'text/javascript' };
function serve(){ return new Promise(r=>{ const s=http.createServer((rq,rs)=>{ if(rq.url==='/favicon.ico'){rs.statusCode=204;return rs.end();} const f=path.join(ROOT,rq.url.split('?')[0]); fs.readFile(f,(e,b)=>{ if(e){rs.statusCode=404;return rs.end('nf');} rs.setHeader('Content-Type',TYPES[path.extname(f)]||'text/plain'); rs.end(b); }); }); s.listen(0,'127.0.0.1',()=>r(s)); }); }

// 💸 TIP-OUT BY ROLE at close: when configured (tip.tipOut=[{role,pct}]), the report spells out each support
// role's cut of today's tips and what the servers keep — instead of doing it by hand for payroll.
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

  const out = await p.evaluate(async () => {
    const doc=()=>document.querySelector('#preview').contentDocument;
    const w=document.querySelector('#preview').contentWindow;
    const wait=ms=>new Promise(r=>setTimeout(r,ms));
    w.DB=w.loadDB();
    w.DB.records=[{id:'RT',number:1,status:'PAID',ts:Date.now(),tip:100,tenders:[{type:'card',amount:200}],lines:[{id:'a',name:'Steak',price:100,qty:1,category:'entree'}]}];
    w.saveDB(w.DB);
    const cB=re=>{const b=[...doc().querySelectorAll('button')].find(x=>re.test(x.textContent.trim()));if(b){b.click();return true;}return false;};
    cB(/^Got it/); cB(/^Office/); await wait(280);
    const txt=doc().body.innerText;
    return { shown:/Tip-out/.test(txt), kitchen:/Kitchen \(5%\)/.test(txt)&&/5\.00/.test(txt), bussers:/Bussers \(10%\)/.test(txt)&&/10\.00/.test(txt), kept:/Kept by servers/.test(txt)&&/85\.00/.test(txt) };
  });

  await b.close(); server.close();
  console.log('\n=== RESULTS ===');
  console.log('the daily close shows a tip-out breakdown:', out.shown);
  console.log('each role gets its % of tips (Kitchen 5%=$5, Bussers 10%=$10):', out.kitchen && out.bussers);
  console.log('servers keep the remainder ($85 of $100):', out.kept);
  console.log('console errors:', errors.length?errors:'NONE');
  const ok = out.shown && out.kitchen && out.bussers && out.kept && !errors.length;
  process.exit(ok?0:1);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
