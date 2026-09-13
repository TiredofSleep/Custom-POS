const { chromium } = require('playwright-core');
const http = require('http'), fs = require('fs'), path = require('path');
const EXE = process.env.CHROMIUM_EXE || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const ROOT = path.resolve(__dirname, '..');
const TYPES = { '.html':'text/html', '.js':'text/javascript' };
function serve(){ return new Promise(r=>{ const s=http.createServer((rq,rs)=>{ if(rq.url==='/favicon.ico'){rs.statusCode=204;return rs.end();} const f=path.join(ROOT,rq.url.split('?')[0]); fs.readFile(f,(e,b)=>{ if(e){rs.statusCode=404;return rs.end('nf');} rs.setHeader('Content-Type',TYPES[path.extname(f)]||'text/plain'); rs.end(b); }); }); s.listen(0,'127.0.0.1',()=>r(s)); }); }

// 🔀 CONDITIONAL / NESTED MODIFIERS: a modifier option or add-on can `reveal` a follow-up group that only shows
// once it's chosen (Bubba "Extra cheese" → required "Which cheese"), gates Add until answered, and rides onto the line.
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
    const bubba=[...doc().querySelectorAll('.tile')].find(x=>/Bubba Burger/.test(x.textContent)); if(bubba)bubba.click(); await wait(120);
    const hiddenBefore=!/Which cheese/.test(doc().body.innerText);
    cB(/^Single/); cB(/Extra cheese/); await wait(120);
    const shownAfter=/Which cheese/.test(doc().body.innerText);
    const addBtn=[...doc().querySelectorAll('button')].find(x=>/Add to order/.test(x.textContent));
    const gatedUntilAnswered=!!(addBtn && addBtn.disabled);
    cB(/^Swiss/); await wait(100);
    const addBtn2=[...doc().querySelectorAll('button')].find(x=>/Add to order/.test(x.textContent));
    const enabledAfter=!!(addBtn2 && !addBtn2.disabled);
    cB(/Add to order/); await wait(100);
    const line=[...doc().querySelectorAll('.line')].map(l=>l.textContent).find(x=>/Bubba/.test(x))||"";
    return { hiddenBefore, shownAfter, gatedUntilAnswered, enabledAfter, lineHasCheese:/Swiss/.test(line) };
  });

  await b.close(); server.close();
  console.log('\n=== RESULTS ===');
  console.log('the revealed group is hidden until its trigger is chosen:', out.hiddenBefore && out.shownAfter);
  console.log('a required reveal gates "Add" until answered:', out.gatedUntilAnswered && out.enabledAfter);
  console.log('the nested choice rides onto the line:', out.lineHasCheese);
  console.log('console errors:', errors.length?errors:'NONE');
  const ok = out.hiddenBefore && out.shownAfter && out.gatedUntilAnswered && out.enabledAfter && out.lineHasCheese && !errors.length;
  process.exit(ok?0:1);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
