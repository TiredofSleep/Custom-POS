const { chromium } = require('playwright-core');
const http = require('http'), fs = require('fs'), path = require('path');
const EXE = process.env.CHROMIUM_EXE || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const ROOT = path.resolve(__dirname, '..');
const TYPES = { '.html':'text/html', '.js':'text/javascript' };
function serve(){ return new Promise(r=>{ const s=http.createServer((rq,rs)=>{ if(rq.url==='/favicon.ico'){rs.statusCode=204;return rs.end();} const f=path.join(ROOT,rq.url.split('?')[0]); fs.readFile(f,(e,b)=>{ if(e){rs.statusCode=404;return rs.end('nf');} rs.setHeader('Content-Type',TYPES[path.extname(f)]||'text/plain'); rs.end(b); }); }); s.listen(0,'127.0.0.1',()=>r(s)); }); }

// 🔞 A server selling alcohol must card by TYPED BIRTHDATE — the POS computes the age and refuses an under-age
// sale, no override tap. This drives the real full-service flow: ring a beer, fire it, then at payment the age
// gate demands a birthdate; an under-21 DOB is refused and logged, an of-age DOB clears the gate and opens tenders.
(async () => {
  const errors = [];
  const server = await serve(); const port = server.address().port;
  const b = await chromium.launch({ executablePath: EXE, args:['--no-sandbox'] });
  const ctx = await b.newContext(); const p = await ctx.newPage();
  p.on('console', m => { if (m.type()==='error') errors.push(m.text()); });
  p.on('pageerror', e => errors.push('pageerror: '+e.message));
  await p.goto(`http://127.0.0.1:${port}/builder.html`);

  // build the full-service (server) template — it has a bar with age-restricted drinks
  await p.locator('button.trade').filter({ hasText: 'Full-service' }).click();
  await p.getByRole('button',{name:/Build it for me/}).click();
  await p.waitForFunction(() => window.__build && window.__build.html);

  // unit-check the age math + the restricted flag, straight out of the generated engine (same-origin iframe)
  const unit = await p.evaluate(async () => {
    const w = document.querySelector('#preview').contentWindow;
    for (let i=0;i<60 && !(w.ageFromDOB && w.CUSTOMPOS_FLOW);i++) await new Promise(r=>setTimeout(r,100));
    const f = w.ageFromDOB, beer = w.CUSTOMPOS_FLOW.catalog.find(x=>x.name==='Draft Beer');
    return { minorUnder21: f('01/15/2010') < 21, adultOver21: f('06/20/1990') >= 21,
      garbageNull: f('hello')===null, badDateNull: f('02/30/2000')===null, futureNull: f('01/01/2050')===null,
      isoWorks: typeof f('1995-03-02')==='number', beerRestricted: beer && beer.ageRestricted===21 };
  });

  // drive the full server flow to a READY alcohol order, then exercise the gate
  const gate = await p.evaluate(async () => {
    const doc=()=>document.querySelector('#preview').contentDocument;
    const w=document.querySelector('#preview').contentWindow;
    const wait=ms=>new Promise(r=>setTimeout(r,ms));
    const clickBtn=re=>{const el=[...doc().querySelectorAll('button')].find(x=>re.test(x.textContent.trim()));if(el){el.click();return true;}return false;};
    const clickLink=re=>{const el=[...doc().querySelectorAll('a')].find(x=>re.test(x.textContent.trim()));if(el){el.click();return true;}return false;};
    clickBtn(/^Got it/); clickBtn(/^Server Station/); await wait(150);
    const beer=[...doc().querySelectorAll('.tile')].find(t=>/Draft Beer/.test(t.textContent)); if(beer)beer.click(); await wait(100);
    clickBtn(/Send order/); await wait(150);
    clickLink(/change station/); await wait(120); clickBtn(/^Bar/); await wait(150);
    clickBtn(/Mark done here/); await wait(200);
    clickLink(/change station/); await wait(120); clickBtn(/^Server Station/); await wait(200);
    const readyStatus=(w.loadDB().records||[]).map(r=>r.status);
    const openIt=[...doc().querySelectorAll('button, .card, .line, a')].find(x=>/Draft Beer/.test(x.textContent||'')); if(openIt)openIt.click(); await wait(200);
    const gateShown=!!doc().querySelector('#dobInput');
    // under-age → refused, still gated, logged
    doc().querySelector('#dobInput').value='01/15/2010';
    (function(){const v=[...doc().querySelectorAll('button')].find(x=>/Verify age/.test(x.textContent));if(v)v.click();})(); await wait(200);
    const recA=(w.loadDB().records||[])[0];
    const minorBlocked = !recA.ageVerified && !!doc().querySelector('#dobInput');
    const refusedLogged = (w.loadDB().ageLog||[]).some(a=>a.result==='refused' && a.age<21);
    // of-age → verified, gate clears, tenders open
    doc().querySelector('#dobInput').value='06/20/1990';
    (function(){const v=[...doc().querySelectorAll('button')].find(x=>/Verify age/.test(x.textContent));if(v)v.click();})(); await wait(200);
    const recB=(w.loadDB().records||[])[0];
    const adultVerified = !!(recB.ageVerified && recB.ageVerified.age>=21 && recB.ageVerified.method==='dob');
    const gateGone = !doc().querySelector('#dobInput');
    const tenderShown = [...doc().querySelectorAll('button')].some(x=>/Cash|Card|Pay|Charge|Tender/.test(x.textContent));
    const noRawDob = !('dob' in recB.ageVerified) && !('birthdate' in recB.ageVerified);   // we store the computed age, never the raw DOB
    return { readyStatus, gateShown, minorBlocked, refusedLogged, adultVerified, gateGone, tenderShown, noRawDob };
  });

  await b.close(); server.close();
  console.log('\n=== RESULTS ===');
  console.log('age math (minor<21, adult>=21, iso ok, garbage/badDate/future null):', unit.minorUnder21 && unit.adultOver21 && unit.isoWorks && unit.garbageNull && unit.badDateNull && unit.futureNull);
  console.log('bar drink is age-restricted (21):', unit.beerRestricted);
  console.log('order fires to READY and the age gate demands a birthdate:', JSON.stringify(gate.readyStatus)==='["READY"]' && gate.gateShown);
  console.log('under-age birthdate is REFUSED, still gated, and logged:', gate.minorBlocked && gate.refusedLogged);
  console.log('of-age birthdate verifies, clears the gate, opens tenders:', gate.adultVerified && gate.gateGone && gate.tenderShown);
  console.log('the raw DOB is NOT stored (only the computed age):', gate.noRawDob);
  console.log('console errors:', errors.length?errors:'NONE');
  const ok = unit.minorUnder21 && unit.adultOver21 && unit.isoWorks && unit.garbageNull && unit.badDateNull && unit.futureNull && unit.beerRestricted
    && JSON.stringify(gate.readyStatus)==='["READY"]' && gate.gateShown && gate.minorBlocked && gate.refusedLogged
    && gate.adultVerified && gate.gateGone && gate.tenderShown && gate.noRawDob && !errors.length;
  process.exit(ok?0:1);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
