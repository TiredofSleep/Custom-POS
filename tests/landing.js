const { chromium } = require('playwright-core');
const url = ('file://' + require('path').resolve(__dirname, '..', 'index.html'));
const EXE = process.env.CHROMIUM_EXE || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
(async () => {
  const errors = [];
  const b = await chromium.launch({ executablePath: EXE, args:['--no-sandbox'] });
  const ctx = await b.newContext(); const p = await ctx.newPage();
  p.on('console', m => { if (m.type()==='error') errors.push(m.text()); });
  p.on('pageerror', e => errors.push('pageerror: '+e.message));
  await p.goto(url);
  const T = async () => (await p.locator('body').innerText());

  const txt = await T();
  const hero = /Build your own POS/i.test(txt) && /Own the code/i.test(txt);
  const money = /\$0/.test(txt) && /card processing/i.test(txt) && /No subscription/i.test(txt);
  const faq = /Where is my data stored/i.test(txt) && /What if customPOS disappears/i.test(txt) && /work if the internet goes down/i.test(txt);
  const features = /End-of-day Z-report/i.test(txt) && /Kitchen display/i.test(txt) && /House accounts/i.test(txt);
  const pillars = /Built for the people behind the counter/i.test(txt) && /Know if you'll make it/i.test(txt) && /worker portal/i.test(txt) && /Labor as % of sales/i.test(txt);

  // primary CTA links to the builder; demo link to the engine
  const buildHref = await p.getByRole('link',{name:/Build my POS/}).first().getAttribute('href');
  const demoHref = await p.getByRole('link',{name:/live demo/i}).first().getAttribute('href');

  // a FAQ item that starts closed can be opened
  const closed = await p.locator('details:has-text("Am I locked in")').first();
  const before = await closed.evaluate(d => d.open);
  await closed.locator('summary').click();
  const after = await closed.evaluate(d => d.open);

  // no horizontal overflow at a phone width
  await p.setViewportSize({ width:360, height:780 });
  const noHScroll = await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

  await b.close();
  console.log('\n=== RESULTS ===');
  console.log('hero states the pitch:', hero);
  console.log('monetization is explained honestly ($0 + card processing):', money);
  console.log('trust FAQ present (data / offline / disappears):', faq);
  console.log('feature grid lists deep features:', features);
  console.log('worker-rights + business-health pillars present:', pillars);
  console.log('primary CTA -> guided builder:', buildHref==='builder.html?guided');
  console.log('demo link -> pos.html:', demoHref==='pos.html');
  console.log('FAQ details toggles open:', before===false && after===true);
  console.log('no horizontal scroll on mobile:', noHScroll);
  console.log('console errors:', errors.length?errors:'NONE');
  const ok = hero && money && faq && features && pillars && buildHref==='builder.html?guided' && demoHref==='pos.html' && before===false && after===true && noHScroll && !errors.length;
  process.exit(ok?0:1);
})().catch(e=>{ console.error('FATAL',e); process.exit(2); });
