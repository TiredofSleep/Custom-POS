const { chromium } = require('playwright-core');
const http = require('http'), fs = require('fs'), path = require('path');
const EXE = process.env.CHROMIUM_EXE || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const ROOT = path.resolve(__dirname, '..');
const TYPES = { '.html':'text/html', '.js':'text/javascript' };
function serve(){ return new Promise(r=>{ const s=http.createServer((rq,rs)=>{ if(rq.url==='/favicon.ico'){rs.statusCode=204;return rs.end();} const f=path.join(ROOT,rq.url.split('?')[0]); fs.readFile(f,(e,b)=>{ if(e){rs.statusCode=404;return rs.end('nf');} rs.setHeader('Content-Type',TYPES[path.extname(f)]||'text/plain'); rs.end(b); }); }); s.listen(0,'127.0.0.1',()=>r(s)); }); }

// 👤 SEAT-BY-SEAT ordering: pick a table, pick a seat, and each item rings to that seat. Pins the seat picker,
// the per-line seat stamp (draft shows 👤 S1 / S2), and the seatChip helper. (The seat then rides onto the
// record + KDS via the same l.seat field — verified live.)
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
    const cB=re=>{const el=[...doc().querySelectorAll('button')].find(x=>re.test(x.textContent.trim()));if(el){el.click();return true;}return false;};
    const cT=re=>{const el=[...doc().querySelectorAll('.tile')].find(x=>re.test(x.textContent));if(el){el.click();return true;}return false;};
    cB(/^Got it/); cB(/^Server Station/); await wait(150);
    cB(/^1$/); await wait(120);
    const seatPicker = [...doc().querySelectorAll('button')].some(x=>/^Seat 1/.test(x.textContent.trim())) &&
                       [...doc().querySelectorAll('button')].some(x=>/Whole table/.test(x.textContent.trim()));
    cB(/^Seat 1/); await wait(60); cT(/Calamari/); await wait(120);
    cB(/^Seat 2/); await wait(60); cT(/Ribeye/); await wait(80); cB(/^Rare|^Med rare|^Medium/); cB(/Add to order/); await wait(120);
    const chipS1=[...doc().querySelectorAll('.line')].some(l=>/Calamari/.test(l.textContent)&&/S1/.test(l.textContent));
    const chipS2=[...doc().querySelectorAll('.line')].some(l=>/Ribeye/.test(l.textContent)&&/S2/.test(l.textContent));
    const chipHelper=/S7/.test(w.seatChip({seat:7})) && w.seatChip({})==="";
    return { seatPicker, chipS1, chipS2, chipHelper };
  });

  await b.close(); server.close();
  console.log('\n=== RESULTS ===');
  console.log('picking a table shows the seat picker (Whole table + Seat N):', out.seatPicker);
  console.log('items ring to the chosen seat (draft shows S1 / S2):', out.chipS1 && out.chipS2);
  console.log('seatChip renders a seat and is blank when unseated:', out.chipHelper);
  console.log('console errors:', errors.length?errors:'NONE');
  const ok = out.seatPicker && out.chipS1 && out.chipS2 && out.chipHelper && !errors.length;
  process.exit(ok?0:1);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
