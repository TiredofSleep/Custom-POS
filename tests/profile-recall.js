const { chromium } = require('playwright-core');
const url = 'file:///workspace/custom-pos/pos.html';
const EXE = process.env.CHROMIUM_EXE || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
(async () => {
  const errors = [];
  const b = await chromium.launch({ executablePath: EXE, args:['--no-sandbox'] });
  const ctx = await b.newContext(); const p = await ctx.newPage();
  p.on('console', m => { if (m.type()==='error') errors.push(m.text()); });
  p.on('pageerror', e => errors.push('pageerror: '+e.message));
  await p.goto(url);
  const B = async n => p.getByRole('button',{name:new RegExp('^'+n)}).first().click();
  const changeTo = async n => { await p.getByText('change station').click(); await B(n); };
  const T = async () => (await p.locator('main').innerText());

  await B('Salon');
  await B('Front Desk');
  // new customer
  await p.locator('#custPhone').fill('5551234');
  await p.locator('#custName').fill('Pat');
  await p.getByRole('button',{name:/Look up \/ attach/}).click();
  const attached = /Pat/.test(await T()) && /5551234/.test(await T());
  // build + send an order for Pat (Haircut by Alex)
  await B('Haircut'); await B('Alex'); await B('Add to order');
  await B('Send order');

  // NEW order: look up the same phone -> should recall Pat + offer "The usual (Haircut)"
  await p.locator('#custPhone').fill('5551234');
  await p.getByRole('button',{name:/Look up \/ attach/}).click();
  const recalled = await T();
  const recall = /Pat/.test(recalled) && /The usual \(Haircut\)/.test(recalled);
  // one-tap the usual -> Haircut (with Alex) added to the new draft
  await p.getByRole('button',{name:/The usual/}).click();
  const afterUsual = await T();
  const usualReadded = /1× Haircut/.test(afterUsual) && /Alex/.test(afterUsual);

  await b.close();
  console.log('recalled:', recalled.replace(/\n+/g,' | '));
  console.log('\n=== RESULTS ===');
  console.log('customer attached at intake:', attached);
  console.log('returning customer recalled by phone:', recall);
  console.log('"the usual" one-tap re-adds their last order (with provider):', usualReadded);
  console.log('console errors:', errors.length?errors:'NONE');
  process.exit(errors.length||!attached||!recall||!usualReadded?1:0);
})().catch(e=>{ console.error('FATAL',e); process.exit(2); });
