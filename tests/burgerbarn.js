const { chromium } = require('playwright-core');
const http = require('http'), fs = require('fs'), path = require('path');
const EXE = process.env.CHROMIUM_EXE || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const ROOT = path.resolve(__dirname, '..');
const TYPES = { '.html':'text/html', '.js':'text/javascript' };
function serve(){ return new Promise(r=>{ const s=http.createServer((rq,rs)=>{ if(rq.url==='/favicon.ico'){rs.statusCode=204;return rs.end();} const f=path.join(ROOT,rq.url.split('?')[0]); fs.readFile(f,(e,b)=>{ if(e){rs.statusCode=404;return rs.end('nf');} rs.setHeader('Content-Type',TYPES[path.extname(f)]||'text/plain'); rs.end(b); }); }); s.listen(0,'127.0.0.1',()=>r(s)); }); }

(async () => {
  const errors = [];
  const server = await serve(); const port = server.address().port;
  const b = await chromium.launch({ executablePath: EXE, args:['--no-sandbox'] });
  const ctx = await b.newContext(); const p = await ctx.newPage();
  p.on('console', m => { if (m.type()==='error') errors.push(m.text()); });
  p.on('pageerror', e => errors.push('pageerror: '+e.message));
  await p.goto(`http://127.0.0.1:${port}/builder.html`);

  // build the real Hamburger Barn template
  await p.locator('button.trade').filter({ hasText: 'burger-joint' }).click();
  await p.getByRole('button',{name:/Build it for me/}).click();
  await p.waitForFunction(() => window.__build && window.__build.html);

  const cfg = await p.evaluate(() => {
    const f = window.__build.flow, byName = n => f.catalog.find(i=>i.name===n);
    return {
      name: f.branding.name,
      bubbaToGrill: (byName('Bubba Burger').path||[]).join()==='grill',
      onionToFry: (byName('Onion Rings').path||[]).join()==='fry',
      shakeToShakes: (byName('Milkshake').path||[]).join()==='shakes',
      specialPar: byName('Blue Plate Special').par===10,
      hasTip: !!f.endpoints.payment.tip,
      itemCount: f.catalog.length
    };
  });

  // drive the ACTUAL generated POS in the live preview: one order fans out to grill + fry
  const fr = p.frameLocator('#preview');
  await fr.getByText('Front Counter', { exact:false }).first().click();
  await fr.getByText('Bubba Burger', { exact:false }).first().click();
  await fr.getByRole('button',{ name:/^Single/ }).first().click();     // required Patty choice
  await fr.getByRole('button',{ name:/Add to order/ }).click();
  await fr.getByText('Onion Rings', { exact:false }).first().click();
  await fr.getByRole('button',{ name:/Send order/ }).click();
  await fr.getByText('change station').click();
  await fr.getByText('Grill', { exact:false }).first().click();
  const grill = await fr.locator('main').innerText();
  await fr.getByText('change station').click();
  await fr.getByText('Fry Station', { exact:false }).first().click();
  const fry = await fr.locator('main').innerText();

  const grillOk = /Bubba Burger/.test(grill) && !/Onion Rings/.test(grill);
  const fryOk = /Onion Rings/.test(fry) && !/Bubba Burger/.test(fry);

  await b.close(); server.close();
  console.log('grill:', grill.replace(/\n+/g,' | '));
  console.log('fry:', fry.replace(/\n+/g,' | '));
  console.log('\n=== RESULTS ===');
  console.log('real menu built ('+cfg.itemCount+' items), Hamburger Barn:', cfg.name==='Hamburger Barn' && cfg.itemCount>=18);
  console.log('items routed right (burger→grill, rings→fry, shake→shakes):', cfg.bubbaToGrill && cfg.onionToFry && cfg.shakeToShakes);
  console.log('daily special has an 86 count; tips on:', cfg.specialPar && cfg.hasTip);
  console.log('live POS fan-out: Grill sees the burger only:', grillOk);
  console.log('live POS fan-out: Fry sees the onion rings only:', fryOk);
  console.log('console errors:', errors.length?errors:'NONE');
  const ok = cfg.name==='Hamburger Barn' && cfg.bubbaToGrill && cfg.onionToFry && cfg.shakeToShakes && cfg.specialPar && cfg.hasTip && grillOk && fryOk && !errors.length;
  process.exit(ok?0:1);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
