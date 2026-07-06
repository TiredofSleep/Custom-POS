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

  // ---- CHECKLIST-AS-GATE (repair Ready Shelf) ----
  await B('Repair shop'); await B('Front Counter');
  await B('Battery'); await B('Send order');          // path repair->ready, no config
  await changeTo('Repair Bench'); await B('Mark done here');   // -> ready
  await changeTo('Ready Shelf');
  const markDisabledBeforeQC = await p.getByRole('button',{name:/Mark done here/}).isDisabled();
  await p.getByRole('button',{name:/Powered on/}).click();
  await p.getByRole('button',{name:/Cleaned/}).click();
  const stillDisabledPartial = await p.getByRole('button',{name:/Mark done here/}).isDisabled();  // 2 of 3
  await p.getByRole('button',{name:/Case sealed/}).click();
  const markEnabledAfterQC = !(await p.getByRole('button',{name:/Mark done here/}).isDisabled());

  // ---- CAPACITY / PACING (counter) ----
  await p.getByText('change station').click();
  await B('Counter shop'); await B('Order Counter');
  for (let i=0;i<3;i++){ await B('Coffee'); await B('Send order'); }   // fill the queue to max=3
  await B('Coffee');                                                    // try a 4th
  const capTxt = await T();
  const atCapacity = /At capacity \(3 in the queue\)/.test(capTxt);
  const sendDisabled = await p.getByRole('button',{name:/Send order/}).isDisabled();

  await b.close();
  console.log('capacity view:', capTxt.replace(/\n+/g,' | ').slice(0,180));
  console.log('\n=== RESULTS ===');
  console.log('checklist gate: Mark done disabled before QC:', markDisabledBeforeQC);
  console.log('checklist gate: still disabled at 2 of 3:', stillDisabledPartial);
  console.log('checklist gate: enabled after all steps:', markEnabledAfterQC);
  console.log('capacity: at-capacity message at max:', atCapacity);
  console.log('capacity: Send blocked at capacity:', sendDisabled);
  console.log('console errors:', errors.length?errors:'NONE');
  process.exit(errors.length||!markDisabledBeforeQC||!stillDisabledPartial||!markEnabledAfterQC||!atCapacity||!sendDisabled?1:0);
})().catch(e=>{ console.error('FATAL',e); process.exit(2); });
