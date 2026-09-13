const { chromium } = require('playwright-core');
const http = require('http'), fs = require('fs'), path = require('path');
const EXE = process.env.CHROMIUM_EXE || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const ROOT = path.resolve(__dirname, '..');
const TYPES = { '.html':'text/html', '.js':'text/javascript' };
function serve(){ return new Promise(r=>{ const s=http.createServer((rq,rs)=>{ if(rq.url==='/favicon.ico'){rs.statusCode=204;return rs.end();} const f=path.join(ROOT,rq.url.split('?')[0]); fs.readFile(f,(e,b)=>{ if(e){rs.statusCode=404;return rs.end('nf');} rs.setHeader('Content-Type',TYPES[path.extname(f)]||'text/plain'); rs.end(b); }); }); s.listen(0,'127.0.0.1',()=>r(s)); }); }

// 💡 SUGGESTED ADD-ON / UPSELL: an item's `suggest` list surfaces one-tap add buttons for complementary items
// not already on the ticket (Bubba → Fries / Milkshake / Drink). Tapping adds it and drops it from the suggestions.
(async () => {
  const errors = [];
  const server = await serve(); const port = server.address().port;
  const b = await chromium.launch({ executablePath: EXE, args:['--no-sandbox'] });
  const ctx = await b.newContext(); const p = await ctx.newPage();
  p.on('console', m => { if (m.type()==='error') errors.push(m.text()); });
  p.on('pageerror', e => errors.push('pageerror: '+e.message));
  await p.goto(`http://127.0.0.1:${port}/builder.html`);
  await p.locator('button.trade').filter({ hasText: 'Hamburger Barn' }).click();
  await p.getByRole('button',{name:/Build it for me/}).click();
  await p.waitForFunction(() => window.__build && window.__build.html);

  const out = await p.evaluate(async () => {
    const doc=()=>document.querySelector('#preview').contentDocument;
    const wait=ms=>new Promise(r=>setTimeout(r,ms));
    const cB=re=>{const b=[...doc().querySelectorAll('button')].find(x=>re.test(x.textContent.trim()));if(b){b.click();return true;}return false;};
    cB(/^Got it/); cB(/^Front Counter/); await wait(180);
    const bubba=[...doc().querySelectorAll('.tile')].find(x=>/Bubba Burger/.test(x.textContent)); if(bubba)bubba.click(); await wait(100);
    cB(/^Single/); cB(/Add to order/); await wait(120);
    const shown=/Want to add/.test(doc().body.innerText);
    const btns=[...doc().querySelectorAll('button')].map(b=>b.textContent.trim()).filter(x=>x.startsWith('+ ')&&/Fries|Milkshake|Fountain Drink/.test(x));
    const fb=[...doc().querySelectorAll('button')].find(x=>x.textContent.trim().startsWith('+ Fries')); if(fb)fb.click(); await wait(120);
    const friesAdded=[...doc().querySelectorAll('.line')].some(l=>/Fries/.test(l.textContent));
    const friesGone=![...doc().querySelectorAll('button')].some(x=>x.textContent.trim().startsWith('+ Fries'));
    return { shown, btnCount:btns.length, friesAdded, friesGone };
  });

  await b.close(); server.close();
  console.log('\n=== RESULTS ===');
  console.log('adding a main surfaces its suggested add-ons (Fries/Milkshake/Drink):', out.shown && out.btnCount===3);
  console.log('tapping a suggestion adds it and drops it from the list:', out.friesAdded && out.friesGone);
  console.log('console errors:', errors.length?errors:'NONE');
  const ok = out.shown && out.btnCount===3 && out.friesAdded && out.friesGone && !errors.length;
  process.exit(ok?0:1);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
