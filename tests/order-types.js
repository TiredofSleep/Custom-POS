const { chromium } = require('playwright-core');
const http = require('http'), fs = require('fs'), path = require('path');
const EXE = process.env.CHROMIUM_EXE || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const ROOT = path.resolve(__dirname, '..');
const TYPES = { '.html':'text/html', '.js':'text/javascript' };
function serve(){ return new Promise(r=>{ const s=http.createServer((rq,rs)=>{ if(rq.url==='/favicon.ico'){rs.statusCode=204;return rs.end();} const f=path.join(ROOT,rq.url.split('?')[0]); fs.readFile(f,(e,b)=>{ if(e){rs.statusCode=404;return rs.end('nf');} rs.setHeader('Content-Type',TYPES[path.extname(f)]||'text/plain'); rs.end(b); }); }); s.listen(0,'127.0.0.1',()=>r(s)); }); }

// 🚗 ORDER TYPES (dine-in / to-go / drive-thru) + the online/delivery CHANNEL hook. The intake picker sets the
// type; it rides onto the record, the ticket and the KDS chip. Channel is the display hook for an order handed
// in by the hub from online ordering / a delivery app (that ingestion is hub + account work, not the engine).
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
    const w=document.querySelector('#preview').contentWindow;
    const wait=ms=>new Promise(r=>setTimeout(r,ms));
    const cB=re=>{const b=[...doc().querySelectorAll('button')].find(x=>re.test(x.textContent.trim()));if(b){b.click();return true;}return false;};
    cB(/^Got it/); cB(/^Front Counter/); await wait(200);
    const picker=[...doc().querySelectorAll('button')].map(b=>b.textContent.trim()).filter(x=>/^Dine-in$|^To-go$|^Drive-thru$/.test(x));
    const typeChip=w.orderTypeChip({orderType:"Drive-thru"});
    const chanChip=w.channelChip({channel:"DoorDash"});
    const cfgTypes=(w.CUSTOMPOS_FLOW.endpoints.orderTypes||[]).join(",");
    return { picker, typeChip, chanChip, cfgTypes };
  });

  await b.close(); server.close();
  console.log('\n=== RESULTS ===');
  console.log('intake shows the order-type picker (Dine-in/To-go/Drive-thru):', out.picker.length===3);
  console.log('config carries the order types:', out.cfgTypes==="Dine-in,To-go,Drive-thru");
  console.log('order-type chip renders the type:', /Drive-thru/.test(out.typeChip));
  console.log('channel chip renders an online/delivery source:', /DoorDash/.test(out.chanChip));
  console.log('console errors:', errors.length?errors:'NONE');
  const ok = out.picker.length===3 && out.cfgTypes==="Dine-in,To-go,Drive-thru" && /Drive-thru/.test(out.typeChip) && /DoorDash/.test(out.chanChip) && !errors.length;
  process.exit(ok?0:1);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
