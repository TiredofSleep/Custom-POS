const { chromium } = require('playwright-core');
const http = require('http'), fs = require('fs'), path = require('path');
const EXE = process.env.CHROMIUM_EXE || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const ROOT = path.resolve(__dirname, '..');
const TYPES = { '.html':'text/html', '.js':'text/javascript' };
function serve(){ return new Promise(r=>{ const s=http.createServer((rq,rs)=>{ if(rq.url==='/favicon.ico'){rs.statusCode=204;return rs.end();} const f=path.join(ROOT,rq.url.split('?')[0]); fs.readFile(f,(e,b)=>{ if(e){rs.statusCode=404;return rs.end('nf');} rs.setHeader('Content-Type',TYPES[path.extname(f)]||'text/plain'); rs.end(b); }); }); s.listen(0,'127.0.0.1',()=>r(s)); }); }

// 🧾 DAILY CLOSE surfaces COMPS. The report already shows net/tax/tips/tenders/drawer/COGS/waste; this pins that
// the value given away as comps shows as its own line so the owner sees it at close.
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
    // a PAID order today: $30 sold + a $20 comped line
    w.DB=w.loadDB();
    w.DB.records=[{id:'RP',number:1,status:'PAID',ts:Date.now(),tenders:[{type:'cash',amount:30}],
      lines:[{id:'a',name:'Steak',price:30,qty:1,category:'entree'},{id:'b',name:'Wine',price:0,qty:1,category:'drink',comped:{reason:'Kitchen error',amount:20,wasPrice:20}}]}];
    w.saveDB(w.DB);
    const cB=re=>{const b=[...doc().querySelectorAll('button')].find(x=>re.test(x.textContent.trim()));if(b){b.click();return true;}return false;};
    cB(/^Got it/); cB(/^Office/); await wait(250);
    const txt=doc().body.innerText;
    return { onReport:/Sales summary/.test(txt), net:/Net sales/.test(txt), comps:/Comps \(on the house\)/.test(txt), amt:/20\.00/.test(txt) };
  });

  await b.close(); server.close();
  console.log('\n=== RESULTS ===');
  console.log('the daily close renders a sales summary:', out.onReport && out.net);
  console.log('comps show as their own line with the amount given away:', out.comps && out.amt);
  console.log('console errors:', errors.length?errors:'NONE');
  const ok = out.onReport && out.net && out.comps && out.amt && !errors.length;
  process.exit(ok?0:1);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
