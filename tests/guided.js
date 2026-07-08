const { chromium } = require('playwright-core');
const http = require('http');
const fs = require('fs');
const path = require('path');
const EXE = process.env.CHROMIUM_EXE || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const ROOT = path.resolve(__dirname, '..');
const TYPES = { '.html':'text/html', '.js':'text/javascript', '.md':'text/markdown', '.json':'application/json' };
function serve() {
  return new Promise(resolve => {
    const s = http.createServer((req, res) => {
      if (req.url === '/favicon.ico') { res.statusCode = 204; return res.end(); }
      const f = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
      fs.readFile(f, (e, buf) => { if (e) { res.statusCode = 404; return res.end('not found'); }
        res.setHeader('Content-Type', TYPES[path.extname(f)] || 'text/plain'); res.end(buf); });
    });
    s.listen(0, '127.0.0.1', () => resolve(s));
  });
}
(async () => {
  const errors = [];
  const server = await serve(); const port = server.address().port;
  const b = await chromium.launch({ executablePath: EXE, args:['--no-sandbox'] });
  const ctx = await b.newContext(); const p = await ctx.newPage();
  p.on('console', m => { if (m.type()==='error') errors.push(m.text()); });
  p.on('pageerror', e => errors.push('pageerror: '+e.message));
  await p.goto(`http://127.0.0.1:${port}/builder.html`);
  const T = async () => (await p.locator('#app').innerText());

  // enter the guided interview from step 1
  await p.getByRole('button',{name:/Guided setup/}).click();
  const g1 = await T();
  const startedOk = /what kind of business/i.test(g1);

  // G1 shape: pick the café (Made-to-order), continue
  await p.locator('button.trade').filter({ hasText: 'Made-to-order' }).click();
  await p.getByRole('button',{name:/Continue/}).click();

  // G2 name it
  await p.locator('#gName').fill("Rosa's Cafe");
  await p.getByRole('button',{name:/Continue/}).click();

  // G3 people: "I have a team" -> worker suite turns on; add a waged person; pool tips
  await p.locator('button.trade').filter({ hasText: 'I have a team' }).click();
  const teamPanel = await T();
  const teamOk = /your team/i.test(teamPanel);
  await p.getByRole('button',{name:/pool tips by hours/}).click();   // a payment answer that changes config (off → on)
  await p.getByRole('button',{name:/Continue/}).click();

  // G4 payments: café already takes cash + cards; just continue
  await p.getByRole('button',{name:/Continue/}).click();

  // G5 deployment: several computers, then build
  await p.locator('button.trade').filter({ hasText: 'Several computers' }).click();
  await p.getByRole('button',{name:/Build my POS/}).click();

  // step 3: the POS is built with the worker suite baked in
  await p.waitForFunction(() => window.__build && window.__build.html);
  const built = await p.evaluate(() => ({
    name: window.__build.flow.branding.name,
    html: window.__build.html,
    types: (window.__build.flow.stations||[]).map(s=>s.type),
    tipPool: !!(window.__build.flow.endpoints.payment.tipPool),
    card: (window.__build.flow.endpoints.payment.tenders||[]).includes('card')
  }));
  const nameOk = built.name === "Rosa's Cafe";
  const workerSuite = ['timeclock','schedule','worker'].every(t => built.types.includes(t));
  const injectOk = built.html.includes('window.CUSTOMPOS_FLOW') && built.html.includes('"type":"worker"');
  const ready = /your pos is ready/i.test(await p.locator('#app').innerText());

  await b.close(); server.close();
  console.log('\n=== RESULTS ===');
  console.log('guided setup starts the interview:', startedOk);
  console.log('"team" turns on the worker suite panel:', teamOk);
  console.log('finished build keeps the entered name:', nameOk);
  console.log('worker suite baked in (timeclock+schedule+worker):', workerSuite);
  console.log('tips pooled + cards enabled from answers:', built.tipPool && built.card);
  console.log('downloadable POS inlines the flow (worker station):', injectOk);
  console.log('lands on the ready-to-download screen:', ready);
  console.log('console errors:', errors.length?errors:'NONE');
  process.exit(errors.length||!startedOk||!teamOk||!nameOk||!workerSuite||!(built.tipPool&&built.card)||!injectOk||!ready?1:0);
})().catch(e=>{ console.error('FATAL',e); process.exit(2); });
