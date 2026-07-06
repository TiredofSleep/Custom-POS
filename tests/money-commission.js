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
  // Haircut requires a performer
  await B('Haircut');
  const addDisabledNoPerformer = await p.getByRole('button',{name:/Add to order/}).isDisabled();
  await B('Alex');
  await B('Add to order');
  await B('Send order');

  // Chair sees the service with the performer, money-blind
  await changeTo('Chair');
  const chair = await T();
  const chairShowsPerformer = /Haircut/.test(chair) && /Alex/.test(chair) && !/\$\d/.test(chair);
  await B('Mark done here');

  // Front Desk: READY -> tip 20% of $35 = $7, balance $42, pay + close
  await changeTo('Front Desk');
  await p.getByRole('button',{name:/20% \$7\.00/}).click();
  const beforePay = await T();
  const tipAndBalance = /Tip → Alex/.test(beforePay) && /\$7\.00/.test(beforePay) && /Take payment \$42\.00/.test(beforePay);
  await p.getByRole('button',{name:/Take payment/}).click();
  await B('Done');

  // Back Office: commission 40% of $35 = $14, tips $7, take-home $21
  await changeTo('Back Office');
  const office = await T();
  const commissionOk = /Alex/.test(office) && /Service sales.*\$35\.00/s.test(office) && /Commission \(40%\).*\$14\.00/s.test(office) && /Tips.*\$7\.00/s.test(office) && /Take-home.*\$21\.00/s.test(office);

  await b.close();
  console.log('chair:', chair.replace(/\n+/g,' | '));
  console.log('office:', office.replace(/\n+/g,' | '));
  console.log('\n=== RESULTS ===');
  console.log('performer required before add:', addDisabledNoPerformer);
  console.log('chair shows performer, money-blind:', chairShowsPerformer);
  console.log('tip 20% attributed + added to balance ($42):', tipAndBalance);
  console.log('commission report: 40% of $35 = $14 + $7 tips = $21 take-home:', commissionOk);
  console.log('console errors:', errors.length?errors:'NONE');
  process.exit(errors.length||!addDisabledNoPerformer||!chairShowsPerformer||!tipAndBalance||!commissionOk?1:0);
})().catch(e=>{ console.error('FATAL',e); process.exit(2); });
