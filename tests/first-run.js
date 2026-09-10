// First-run prompt: the very first screen invites a shop to make it theirs (logo + brand color) — but it's
// OPTIONAL and skippable, and never blocks the app. This proves it appears once, that Skip and Apply both
// dismiss it (and Apply saves the brand color), and that it stays gone after.
const { chromium } = require('playwright-core');
const path = require('path');
const url = 'file://' + path.resolve(__dirname, '..', 'pos.html');
const EXE = process.env.CHROMIUM_EXE || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const FLOW = {
  flowId:'fr', label:'FR', topology:'linear',
  branding:{ name:'First Run Co', brandColor:'#1f6feb' },
  endpoints:{ customer:{persist:false}, payment:{ tenders:['cash'], closeGate:'balanceLE0' } },
  catalog:[ {id:'w', name:'Item', price:5, category:'x', path:[]} ],
  stations:[ {id:'reg', type:'central', label:'Counter', view:{money:true}} ],
};

let ok = true;
function assert(name, cond){ console.log((cond?'✓':'✗')+' '+name); if(!cond) ok=false; }

(async () => {
  const errors = [];
  const b = await chromium.launch({ executablePath: EXE, args:['--no-sandbox'] });

  // (1) SKIP path — the prompt shows on first run and Skip dismisses it without changing anything
  const c1 = await b.newContext(); const p = await c1.newPage();
  p.on('console', m => { if (m.type()==='error') errors.push(m.text()); });
  p.on('pageerror', e => errors.push('pageerror: '+e.message));
  await p.addInitScript(f => { window.CUSTOMPOS_FLOW = f; }, FLOW);
  await p.goto(url);
  const seenFirst = await p.locator('.card', { hasText: 'Make it yours' }).first().isVisible();
  assert('the first-run prompt appears on the very first screen', seenFirst);
  // the app is NOT blocked — the station tile is right there to click
  const stationClickable = await p.getByRole('button',{name:/^Counter/}).first().isVisible();
  assert('it does NOT block the app (the station picker is still usable)', stationClickable);
  await p.getByRole('button',{name:/Skip for now/}).click();
  await p.waitForTimeout(120);
  const goneAfterSkip = !(await p.locator('.card', { hasText: 'Make it yours' }).count());
  assert('Skip dismisses the prompt', goneAfterSkip);
  const skipFlag = await p.evaluate(() => localStorage.getItem('custompos_firstrun_done'));
  assert('Skip records that first-run is done (won\'t nag again)', skipFlag === '1');
  await p.reload(); await p.waitForTimeout(120);
  const stillGone = !(await p.locator('.card', { hasText: 'Make it yours' }).count());
  assert('the prompt stays gone after a reload', stillGone);

  // (2) APPLY path — a fresh visitor sets a brand color and it saves + dismisses
  const c2 = await b.newContext(); const p2 = await c2.newPage();
  p2.on('pageerror', e => errors.push('p2 pageerror: '+e.message));
  await p2.addInitScript(f => { window.CUSTOMPOS_FLOW = f; }, FLOW);
  await p2.goto(url);
  await p2.locator('.card', { hasText:'Make it yours' }).locator('input[type=color]').fill('#e11d48');
  await p2.getByRole('button',{name:/Apply & continue/}).click();
  await p2.waitForTimeout(150);
  const applied = await p2.evaluate(() => ({ saved:(loadDB().settings&&loadDB().settings.brandColor), brandVar:getComputedStyle(document.documentElement).getPropertyValue('--brand').trim(), done:localStorage.getItem('custompos_firstrun_done') }));
  assert('Apply saves the chosen brand color', applied.saved === '#e11d48');
  assert('Apply themes the app immediately (--brand set)', applied.brandVar === '#e11d48');
  assert('Apply also records first-run done', applied.done === '1');

  await b.close();
  console.log('\n=== RESULTS ===');
  assert('no console or page errors', errors.length === 0);
  if (errors.length) console.log('errors:', errors);
  console.log('\n'+(ok?'ALL PASS':'FAIL'));
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
