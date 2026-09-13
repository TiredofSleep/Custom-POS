const { chromium } = require('playwright-core');
const http = require('http'), fs = require('fs'), path = require('path');
const EXE = process.env.CHROMIUM_EXE || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const ROOT = path.resolve(__dirname, '..');
const TYPES = { '.html':'text/html', '.js':'text/javascript' };
function serve(){ return new Promise(r=>{ const s=http.createServer((rq,rs)=>{ if(rq.url==='/favicon.ico'){rs.statusCode=204;return rs.end();} const f=path.join(ROOT,rq.url.split('?')[0]); fs.readFile(f,(e,b)=>{ if(e){rs.statusCode=404;return rs.end('nf');} rs.setHeader('Content-Type',TYPES[path.extname(f)]||'text/plain'); rs.end(b); }); }); s.listen(0,'127.0.0.1',()=>r(s)); }); }

// 🔀 TRANSFER / MERGE tables: move a table's open check to another table — a transfer when the target is empty,
// a merge when it already has a check. The source table is freed either way. (Money logic pinned on the built engine.)
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
    w.DB=w.loadDB();
    w.DB.records=[ {id:'A1',number:1,status:'READY',tableId:'t1',tenders:[],lines:[{id:'a',name:'Steak',price:30,qty:1}]},
                   {id:'B1',number:2,status:'READY',tableId:'t2',tenders:[],lines:[{id:'b',name:'Wine',price:11,qty:1}]} ];
    const empty=w.floorStates?w.floorStates()[0].id:'empty';
    w.DB.tables={ t1:{state:'assigned',since:Date.now(),server:'Riley'}, t2:{state:'assigned',since:Date.now(),server:'Sam'} };
    w.saveDB(w.DB);
    w.moveTable('t1','t2');                                  // merge (t2 occupied)
    let db=w.loadDB();
    const merge={ onT2:(db.records||[]).filter(r=>r.tableId==='t2').length, onT1:(db.records||[]).filter(r=>r.tableId==='t1').length, t1empty:(db.tables.t1||{}).state===empty };
    w.moveTable('t2','t3');                                  // transfer (t3 empty)
    db=w.loadDB();
    const transfer={ onT3:(db.records||[]).filter(r=>r.tableId==='t3').length, t3occupied:(db.tables.t3||{}).state && (db.tables.t3||{}).state!==empty, t2empty:(db.tables.t2||{}).state===empty };
    return { merge, transfer };
  });

  await b.close(); server.close();
  console.log('\n=== RESULTS ===');
  console.log('merge onto an occupied table combines checks + frees the source:', out.merge.onT2===2 && out.merge.onT1===0 && out.merge.t1empty);
  console.log('transfer to an empty table moves the checks + occupies it:', out.transfer.onT3===2 && out.transfer.t3occupied && out.transfer.t2empty);
  console.log('console errors:', errors.length?errors:'NONE');
  const ok = out.merge.onT2===2 && out.merge.onT1===0 && out.merge.t1empty && out.transfer.onT3===2 && out.transfer.t3occupied && out.transfer.t2empty && !errors.length;
  process.exit(ok?0:1);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
