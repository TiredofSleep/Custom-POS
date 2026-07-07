const { chromium } = require('playwright-core');
const url = ('file://' + require('path').resolve(__dirname, '..', 'pos.html'));
const EXE = process.env.CHROMIUM_EXE || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
(async () => {
  const errors = [];
  const b = await chromium.launch({ executablePath: EXE, args:['--no-sandbox'] });
  const ctx = await b.newContext(); const p = await ctx.newPage();
  p.on('console', m => { if (m.type()==='error') errors.push(m.text()); });
  p.on('pageerror', e => errors.push('pageerror: '+e.message));
  await p.goto(url);
  const pick = async n => p.getByRole('button',{name:new RegExp('^'+n)}).first().click();  // anchored: avoid module-line text
  const changeTo = async n => { await p.getByText('change station').click(); await pick(n); };
  const T = async () => (await p.locator('main').innerText());

  // ---- FLAG + ACK GATE (counter: Muffin has Nut allergy flag) ----
  await pick('Order Counter');
  await p.getByRole('button',{name:/^Muffin/}).click();       // opens config (flags)
  await p.getByRole('button',{name:/Nut allergy/}).click();   // toggle flag on
  await p.getByRole('button',{name:/Add to order/}).click();
  await p.getByRole('button',{name:/Send order/}).click();
  await changeTo('Kitchen');
  const kit = await T();
  const flagShown = /Nut allergy/.test(kit);
  const ackGate = await p.getByRole('button',{name:/Acknowledge/}).isVisible();
  await p.getByRole('button',{name:/Acknowledge/}).click();
  const markAppears = await p.getByRole('button',{name:/Mark done here/}).isVisible();

  // ---- DEPOSIT + BALANCE (cleaners: 50% deposit, balance at pickup) ----
  await p.getByText('change station').click();
  await p.getByRole('button',{name:/Cleaners/}).click();
  await pick('Front Counter');
  await p.getByRole('button',{name:/Wash & Fold/}).click();    // $2.75, path rack (no mods)
  const db = await p.getByRole('button',{name:/Take 50% deposit/});
  const depAmtText = await db.innerText();                     // "Take 50% deposit $1.38"
  await db.click();                                            // enable deposit
  await p.getByRole('button',{name:/Send order/}).click();
  // finish the item at Rack so it's READY
  await changeTo('Rack');
  await p.getByRole('button',{name:/Mark done here/}).click();
  await changeTo('Front Counter');
  const beforePay = await T();
  const balanceIsHalf = /Take balance \$1\.3[78]/.test(beforePay);  // remaining after 50% deposit
  await p.getByRole('button',{name:/Take balance/}).click();
  await p.getByRole('button',{name:/Done — close/}).click();
  const done = /completed today/.test(await T());

  await b.close();
  console.log('kitchen(flag):', kit.replace(/\n+/g,' | '));
  console.log('counter(deposit balance):', beforePay.replace(/\n+/g,' | '));
  console.log('\n=== RESULTS ===');
  console.log('flag surfaces at the right station:', flagShown);
  console.log('flag gates completion until acknowledged:', ackGate && markAppears);
  console.log('deposit computed (50% of $2.75 = $1.38):', /\$1\.3[78]/.test(depAmtText));
  console.log('balance-due = remaining after deposit:', balanceIsHalf);
  console.log('deposit+balance order closes:', done);
  console.log('console errors:', errors.length?errors:'NONE');
  process.exit(errors.length||!flagShown||!(ackGate&&markAppears)||!balanceIsHalf||!done?1:0);
})().catch(e=>{ console.error('FATAL',e); process.exit(2); });
