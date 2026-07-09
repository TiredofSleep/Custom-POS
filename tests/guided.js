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

  // G3 menu: the owner sets their OWN item, and pastes a couple more
  const menu = await T();
  const menuOk = /What do you sell/i.test(menu);
  await p.locator('.row2 input.nm').first().fill('Rosa Latte');
  await p.getByRole('button',{name:/Paste a list/}).click();
  await p.locator('#gPaste').fill('Croissant, 4.00, food\nCold Brew, 5.25, drink');
  await p.getByRole('button',{name:/Add these/}).click();
  await p.getByRole('button',{name:/Continue/}).click();

  // G4 people: "I have a team" -> worker suite turns on; set a manager role + require refund approval; pool tips
  await p.locator('button.trade').filter({ hasText: 'I have a team' }).click();
  const teamPanel = await T();
  const teamOk = /your team/i.test(teamPanel);
  await p.locator('.row2 select').first().selectOption('manager');   // give the first person a manager role
  await p.getByRole('button',{name:/require a manager\/owner to approve refunds/}).click();
  await p.getByRole('button',{name:/pool tips by hours/}).click();
  await p.getByRole('button',{name:/Continue/}).click();

  // G5 payments: make sure "text customers when ready" is on (the team suite already flips it on), then edit the ready message
  if (await p.locator('input.nm').count() === 0) await p.getByRole('button',{name:/text customers when ready/}).click();
  const cardHint = /records a card sale/i.test(await T());   // honest 'card records only' label (café has cards on)
  await p.locator('input.nm').last().fill('Hi {name}, your order is ready at {biz}!');
  await p.getByRole('button',{name:/Continue/}).click();

  // G6 deployment: several computers, then build
  await p.locator('button.trade').filter({ hasText: 'Several computers' }).click();
  await p.getByRole('button',{name:/Build my POS/}).click();

  // step 3: the POS is built with the worker suite baked in
  await p.waitForFunction(() => window.__build && window.__build.html);
  const built = await p.evaluate(() => ({
    name: window.__build.flow.branding.name,
    html: window.__build.html,
    types: (window.__build.flow.stations||[]).map(s=>s.type),
    tipPool: !!(window.__build.flow.endpoints.payment.tipPool),
    card: (window.__build.flow.endpoints.payment.tenders||[]).includes('card'),
    items: (window.__build.flow.catalog||[]).map(i=>i.name),
    role: (window.__build.flow.staff&&window.__build.flow.staff[0]||{}).role,
    refundApproval: !!(window.__build.flow.endpoints.approvals&&window.__build.flow.endpoints.approvals.refund),
    notify: ((window.__build.flow.endpoints.notify||{}).template)||''
  }));
  const nameOk = built.name === "Rosa's Cafe";
  // the owner's own menu made it into the downloadable POS (edited item + pasted items)
  const menuBuilt = menuOk && built.items.includes('Rosa Latte') && built.items.includes('Croissant') && built.items.includes('Cold Brew');
  const workerSuite = ['timeclock','schedule','worker'].every(t => built.types.includes(t));
  // the deeper People/Pay answers landed in the flow: a manager role, refund-approval gate, and the edited ready-text
  const roleOk = built.role === 'manager';
  const approvalOk = built.refundApproval === true;
  const notifyOk = /your order is ready/i.test(built.notify);
  const injectOk = built.html.includes('window.CUSTOMPOS_FLOW') && built.html.includes('"type":"worker"');
  const appText = await p.locator('#app').innerText();
  const ready = /your pos is ready/i.test(appText);
  // the deployment answer ("several computers") produced real run-it guidance, on-screen and in CLAUDE.md
  const runGuidance = /how to run it/i.test(appText) && /sync hub/i.test(appText);
  const claudeMd = await p.evaluate(() => window.__build.claudeMd);
  const mdGuidance = /How you'll run it/.test(claudeMd) && /Several computers/.test(claudeMd);

  // deep link: builder.html?guided drops straight into the interview (the landing page uses this)
  await p.goto(`http://127.0.0.1:${port}/builder.html?guided`);
  const deep = await p.locator('#app').innerText();
  const deepLinkOk = /guided setup/i.test(deep) && /what kind of business/i.test(deep);

  await b.close(); server.close();
  console.log('\n=== RESULTS ===');
  console.log('guided setup starts the interview:', startedOk);
  console.log('?guided deep-link opens the interview directly:', deepLinkOk);
  console.log('"team" turns on the worker suite panel:', teamOk);
  console.log('finished build keeps the entered name:', nameOk);
  console.log("owner's own menu (edited + pasted) is in the build:", menuBuilt);
  console.log('worker suite baked in (timeclock+schedule+worker):', workerSuite);
  console.log('tips pooled + cards enabled from answers:', built.tipPool && built.card);
  console.log('manager role set on first teammate:', roleOk);
  console.log('refund-approval gate turned on:', approvalOk);
  console.log('honest "card records a sale" hint shown:', cardHint);
  console.log('edited ready-text carried into the build:', notifyOk);
  console.log('downloadable POS inlines the flow (worker station):', injectOk);
  console.log('lands on the ready-to-download screen:', ready);
  console.log('deployment answer produces run-it guidance on screen:', runGuidance);
  console.log('CLAUDE.md carries the run-it guidance:', mdGuidance);
  console.log('console errors:', errors.length?errors:'NONE');
  process.exit(errors.length||!startedOk||!deepLinkOk||!menuBuilt||!teamOk||!nameOk||!workerSuite||!(built.tipPool&&built.card)||!injectOk||!ready||!runGuidance||!mdGuidance||!roleOk||!approvalOk||!cardHint||!notifyOk?1:0);
})().catch(e=>{ console.error('FATAL',e); process.exit(2); });
