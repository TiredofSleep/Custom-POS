const { chromium } = require('playwright-core');
const http = require('http'), fs = require('fs'), path = require('path');
const EXE = process.env.CHROMIUM_EXE || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const ROOT = path.resolve(__dirname, '..');
const TYPES = { '.html':'text/html', '.js':'text/javascript' };
function serve(){ return new Promise(r=>{ const s=http.createServer((rq,rs)=>{ if(rq.url==='/favicon.ico'){rs.statusCode=204;return rs.end();} const f=path.join(ROOT,rq.url.split('?')[0]); fs.readFile(f,(e,b)=>{ if(e){rs.statusCode=404;return rs.end('nf');} rs.setHeader('Content-Type',TYPES[path.extname(f)]||'text/plain'); rs.end(b); }); }); s.listen(0,'127.0.0.1',()=>r(s)); }); }

// 🎁 COMP a line — take an item to $0 with a reason on the record (distinct from a %-off discount). Reversible.
// Manager approval is opt-in per instance (FLOW.endpoints.approvals.comp); here we pin the core comp/un-comp
// behavior + that it lands on the activity log as its own 'comp' action.
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
    w.prompt=(m)=>/PIN/i.test(m)?'2222':'Kitchen error';       // reason, then a manager PIN (bistro gates comps on approval)
    const r={ id:'RC', number:77, status:'READY', tenders:[], lines:[ {id:'x',name:'Ribeye',price:34,qty:1,seat:1}, {id:'y',name:'Wine',price:11,qty:1,seat:2} ] };
    w.DB=w.loadDB(); w.DB.records=[r]; w.DB.activity=w.DB.activity||[]; w.saveDB(w.DB);
    const before=w.recordTotal(r);
    w.compLine(r, r.lines[0]);
    const l=r.lines[0];
    const compedOk = l.price===0 && !!l.comped && l.comped.reason==='Kitchen error' && l.comped.wasPrice===34 && w.recordTotal(r)===11;
    const chipOk = /comp/.test(w.compChip(l));
    const logged = (w.loadDB().activity||[]).some(a=>a.type==='comp' && /Ribeye/.test(a.detail||''));
    w.compLine(r, r.lines[0]);                                 // un-comp
    const restoredOk = r.lines[0].price===34 && !r.lines[0].comped && w.recordTotal(r)===45;
    return { before, compedOk, chipOk, logged, restoredOk };
  });

  await b.close(); server.close();
  console.log('\n=== RESULTS ===');
  console.log('comping a line takes it to $0 with a reason; order total drops (45→11):', out.before===45 && out.compedOk);
  console.log('the comped line shows a comp badge:', out.chipOk);
  console.log('the comp is logged as its own audit action:', out.logged);
  console.log('un-comp restores the price and total (→45):', out.restoredOk);
  console.log('console errors:', errors.length?errors:'NONE');
  const ok = out.before===45 && out.compedOk && out.chipOk && out.logged && out.restoredOk && !errors.length;
  process.exit(ok?0:1);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
