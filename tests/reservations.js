const { chromium } = require('playwright-core');
const http = require('http'), fs = require('fs'), path = require('path');
const EXE = process.env.CHROMIUM_EXE || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const ROOT = path.resolve(__dirname, '..');
const TYPES = { '.html':'text/html', '.js':'text/javascript' };
function serve(){ return new Promise(r=>{ const s=http.createServer((rq,rs)=>{ if(rq.url==='/favicon.ico'){rs.statusCode=204;return rs.end();} const f=path.join(ROOT,rq.url.split('?')[0]); fs.readFile(f,(e,b)=>{ if(e){rs.statusCode=404;return rs.end('nf');} rs.setHeader('Content-Type',TYPES[path.extname(f)]||'text/plain'); rs.end(b); }); }); s.listen(0,'127.0.0.1',()=>r(s)); }); }

// 🕐 RESERVATIONS + WAITLIST (the host stand on the floor): book/seat/cancel reservations; add/seat/clear the
// waitlist. Seating onto a table occupies it. Nothing is hard-deleted (cancelled / left / seated).
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
    const cB=re=>{const b=[...doc().querySelectorAll('button')].find(x=>re.test(x.textContent.trim()));if(b){b.click();return true;}return false;};
    cB(/^Got it/); cB(/^Floor/); await wait(200);
    const hostCards=/Reservations/.test(doc().body.innerText) && /Waitlist/.test(doc().body.innerText);
    w.addReservation('Test Party','4','7:00',''); w.addWaitlist('Joe','2','15','');
    let db=w.loadDB();
    const booked=(db.reservations||[]).some(r=>r.name==='Test Party' && r.status==='booked' && r.party===4);
    const waiting=(db.waitlist||[]).some(x=>x.name==='Joe' && x.status==='waiting');
    const rid=(db.reservations||[]).slice(-1)[0].id, wid=(db.waitlist||[]).slice(-1)[0].id;
    const empty=w.floorStates()[0].id;
    w.selTable='t2'; w.seatReservation(rid,'t2');
    w.selTable='t3'; w.seatWaitlist(wid,'t3');
    db=w.loadDB();
    const seatedResv=(db.reservations||[]).find(r=>r.id===rid); const seatedWl=(db.waitlist||[]).find(x=>x.id===wid);
    const seatedOk = seatedResv.status==='seated' && seatedResv.tableId==='t2' && (db.tables.t2||{}).state!==empty
                  && seatedWl.status==='seated' && (db.tables.t3||{}).state!==empty;
    // cancel a fresh reservation, and it leaves the active list (soft, not deleted)
    w.addReservation('Cancel Me','2','8:00',''); db=w.loadDB(); const cid=(db.reservations||[]).slice(-1)[0].id;
    w.cancelReservation(cid); db=w.loadDB();
    const cancelledSoft = (db.reservations||[]).some(r=>r.id===cid && r.status==='cancelled') && !w.todayReservations().some(r=>r.id===cid);
    return { hostCards, booked, waiting, seatedOk, cancelledSoft };
  });

  await b.close(); server.close();
  console.log('\n=== RESULTS ===');
  console.log('host stand shows Reservations + Waitlist cards:', out.hostCards);
  console.log('a reservation books and a walk-in joins the waitlist:', out.booked && out.waiting);
  console.log('seating a reservation/walk-in onto a table occupies it:', out.seatedOk);
  console.log('cancelling is soft (kept, dropped from the active list):', out.cancelledSoft);
  console.log('console errors:', errors.length?errors:'NONE');
  const ok = out.hostCards && out.booked && out.waiting && out.seatedOk && out.cancelledSoft && !errors.length;
  process.exit(ok?0:1);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
