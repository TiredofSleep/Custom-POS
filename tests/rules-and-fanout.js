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
  const pick = async n => p.getByText(n,{exact:false}).first().click();
  const changeTo = async n => { await p.getByText('change station').click(); await pick(n); };
  const T = async () => (await p.locator('main').innerText());

  // COUNTER: modifiers (required Size) + add-on + 86 par-count
  await pick('Order Counter');
  await p.getByRole('button',{name:/^Latte/}).click();          // has required Size -> config panel opens
  const sendDisabledDuringConfig = await p.getByRole('button',{name:/Send order/}).isDisabled();
  await p.getByRole('button',{name:/^Large/}).click();          // required choice
  await p.getByRole('button',{name:/Oat milk/}).click();        // suggested add-on
  await p.getByRole('button',{name:/Add to order/}).click();
  const draftTxt = await T();
  const latteConfigured = /Latte/.test(draftTxt) && /Large/.test(draftTxt) && /Oat milk/.test(draftTxt) && /\$6\.50/.test(draftTxt); // 4.75+1.00+0.75

  // 86: Muffin par=1. Add one muffin, send, then Muffin tile should be disabled + "86"
  await p.getByRole('button',{name:/^Muffin/}).click();         // opens config (has optional flag)
  await p.getByRole('button',{name:/Add to order/}).click();    // add without a flag
  await p.getByRole('button',{name:/Send order/}).click();      // order with Latte+Muffin sent; Muffin now sold 1 of 1
  const muffinBtn = p.getByRole('button',{name:/^Muffin/});
  const muffin86 = (await muffinBtn.isDisabled()) && /86/.test(await T());

  // Bar sees the configured Latte, money-blind
  await changeTo('Bar');
  const bar = await T();
  const barSeesMods = /Latte/.test(bar) && /Large/.test(bar) && /Oat milk/.test(bar) && !/\$\d/.test(bar);

  // CLEANERS: required Starch modifier flows through as a mod label at assembly
  await p.getByText('change station').click();
  await p.getByRole('button',{name:/Cleaners/}).click();
  await pick('Front Counter');
  await p.getByRole('button',{name:/^Shirt/}).click();
  await p.getByRole('button',{name:/^Heavy/}).click();          // required starch
  await p.getByRole('button',{name:/Add to order/}).click();
  await p.getByRole('button',{name:/Send order/}).click();
  await changeTo('Assembly');
  const asm = await T();
  const asmSeesStarch = /Shirt/.test(asm) && /Heavy/.test(asm) && !/\$\d/.test(asm);

  await b.close();
  console.log('draft:', draftTxt.replace(/\n+/g,' | '));
  console.log('bar:', bar.replace(/\n+/g,' | '));
  console.log('assembly:', asm.replace(/\n+/g,' | '));
  console.log('\n=== RESULTS ===');
  console.log('required modifier blocks send until chosen:', sendDisabledDuringConfig);
  console.log('modifier+addon priced correctly (Latte Large +Oat = $6.50):', latteConfigured);
  console.log('86/par-count disables item at zero remaining:', muffin86);
  console.log('production station sees modifiers, money-blind:', barSeesMods);
  console.log('cross-trade: cleaners Starch modifier reaches Assembly:', asmSeesStarch);
  console.log('console errors:', errors.length?errors:'NONE');
  process.exit(errors.length||!latteConfigured||!muffin86||!barSeesMods||!asmSeesStarch||!sendDisabledDuringConfig?1:0);
})().catch(e=>{ console.error('FATAL',e); process.exit(2); });
