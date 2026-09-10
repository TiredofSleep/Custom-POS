// Branding: a shop makes the app look like THEIR brand — upload a logo and pick a color, and the whole accent
// (buttons, links, selected states) follows via the --brand CSS variable. Light brand colors get dark ink for
// contrast. Saved in DB.settings, applied at load. This pins the "logo + brand scheme" feature.
const { chromium } = require('playwright-core');
const path = require('path');
const url = 'file://' + path.resolve(__dirname, '..', 'pos.html');
const EXE = process.env.CHROMIUM_EXE || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const FLOW = {
  flowId:'brand', label:'Brand', topology:'linear',
  branding:{ name:'Test Co', brandColor:'#1f6feb' },
  endpoints:{ customer:{persist:false}, payment:{ tenders:['cash'], closeGate:'balanceLE0' } },
  catalog:[ {id:'w', name:'Item', price:5, category:'x', path:[]} ],
  stations:[ {id:'reg', type:'central', label:'Counter', view:{money:true}} ],
};
const LOGO = 'data:image/svg+xml,'+encodeURIComponent("<svg xmlns='http://www.w3.org/2000/svg' width='120' height='40'><rect width='120' height='40' fill='#7c3aed'/></svg>");

let ok = true;
function assert(name, cond){ console.log((cond?'✓':'✗')+' '+name); if(!cond) ok=false; }

(async () => {
  const errors = [];
  const b = await chromium.launch({ executablePath: EXE, args:['--no-sandbox'] });
  const p = await (await b.newContext()).newPage();
  p.on('console', m => { if (m.type()==='error') errors.push(m.text()); });
  p.on('pageerror', e => errors.push('pageerror: '+e.message));
  await p.addInitScript(f => { window.CUSTOMPOS_FLOW = f; }, FLOW);
  await p.goto(url);
  await p.evaluate(() => bindStation('reg'));

  // contrast helper: a light brand gets dark ink, a dark brand gets white ink
  const ink = await p.evaluate(() => ({ light: readableInk('#f2c744'), dark: readableInk('#7c3aed'), white: readableInk('#ffffff') }));
  assert('a light brand color gets dark ink', ink.light === '#111418' && ink.white === '#111418');
  assert('a dark brand color gets white ink', ink.dark === '#ffffff');

  // save a brand color + logo through settings, and confirm the accent + header follow
  await p.evaluate((logo) => { saveSettings({ brandColor:'#7c3aed', logo }); render(); }, LOGO);
  const applied = await p.evaluate(() => ({
    brandVar: getComputedStyle(document.documentElement).getPropertyValue('--brand').trim(),
    flowColor: FLOW.branding.brandColor,
    logoShown: document.getElementById('brandLogo').style.display !== 'none' && !!document.getElementById('brandLogo').src,
    dotHidden: document.getElementById('brandDot').style.display === 'none',
  }));
  assert('the brand color drives the --brand accent variable', applied.brandVar === '#7c3aed');
  assert('the flow branding color updated', applied.flowColor === '#7c3aed');
  assert('the uploaded logo shows in the header (and the letter badge hides)', applied.logoShown && applied.dotHidden);

  // removing the logo falls back to the lettered badge
  await p.evaluate(() => { saveSettings({ logo:null }); render(); });
  const removed = await p.evaluate(() => ({ logoHidden: document.getElementById('brandLogo').style.display === 'none', dotShown: document.getElementById('brandDot').style.display !== 'none' }));
  assert('removing the logo restores the lettered badge', removed.logoHidden && removed.dotShown);

  // persists across reload
  await p.reload();
  await p.waitForTimeout(120);
  const afterReload = await p.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--brand').trim());
  assert('the brand color persists across a reload', afterReload === '#7c3aed');

  await b.close();
  console.log('\n=== RESULTS ===');
  assert('no console or page errors', errors.length === 0);
  if (errors.length) console.log('errors:', errors);
  console.log('\n'+(ok?'ALL PASS':'FAIL'));
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
