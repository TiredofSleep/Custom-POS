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
  const pickBtn = async n => p.getByRole('button',{name:n}).first().click();
  const changeTo = async n => { await p.getByText('change station').click(); await pickBtn(n); };
  const T = async () => (await p.locator('main').innerText());

  await pickBtn(/Repair shop/);           // THIRD trade, config-only
  await pickBtn(/Front Counter/);
  // Phone screen: required Device + Data-loss waiver flag
  await pickBtn(/^Phone screen/);
  await pickBtn(/^iPhone/);
  await pickBtn(/Data-loss waiver/);
  await pickBtn(/Add to order/);
  // Battery: skips diagnostics (path repair->ready)
  await pickBtn(/^Battery/);                      // no config -> adds directly
  await pickBtn(/Take 50% deposit/);
  await pickBtn(/Send order/);

  // Diagnostics: should see the Phone screen (waiver flag -> ack gate) but NOT the Battery
  await changeTo(/Diagnostics/);
  const diag = await T();
  const diagSeesPhoneNotBattery = /Phone screen/.test(diag) && /Data-loss waiver/.test(diag) && !/Battery/.test(diag);
  const ackGate = await p.getByRole('button',{name:/Acknowledge/}).isVisible();
  await pickBtn(/Acknowledge/);           // approve/waiver
  await pickBtn(/Mark done here/);        // phone -> repair

  // Repair Bench: should see BOTH the phone (now here) and the battery (started here)
  await changeTo(/Repair Bench/);
  const bench = await T();
  const benchSeesBoth = /Phone screen/.test(bench) && /Battery/.test(bench);
  await pickBtn(/Mark done here/);        // already acknowledged at diagnostics (once per ticket) -> no re-gate

  // Ready Shelf: a QC checklist gates completion — tick all steps, then finish -> READY
  await changeTo(/Ready Shelf/);
  await p.getByRole('button',{name:/Powered on/}).click();
  await p.getByRole('button',{name:/Cleaned/}).click();
  await p.getByRole('button',{name:/Case sealed/}).click();
  await pickBtn(/Mark done here/);

  // Front Counter: balance after 50% deposit, take balance, close
  await changeTo(/Front Counter/);
  const ck = await T();
  const hasBalance = /Take balance/.test(ck);
  await pickBtn(/Take balance/);
  await pickBtn(/Done — close/);
  const done = /completed today/.test(await T());

  await b.close();
  console.log('diagnostics:', diag.replace(/\n+/g,' | '));
  console.log('bench:', bench.replace(/\n+/g,' | '));
  console.log('\n=== RESULTS ===');
  console.log('config-only 3rd trade loads + runs:', /Phone screen/.test(diag));
  console.log('split path: Battery skips Diagnostics, Phone does not:', diagSeesPhoneNotBattery);
  console.log('waiver flag gates diagnostics until acknowledged:', ackGate);
  console.log('re-converge: Repair Bench sees phone + battery:', benchSeesBoth);
  console.log('deposit/balance closes the repair ticket:', hasBalance && done);
  console.log('console errors:', errors.length?errors:'NONE');
  process.exit(errors.length||!diagSeesPhoneNotBattery||!ackGate||!benchSeesBoth||!(hasBalance&&done)?1:0);
})().catch(e=>{ console.error('FATAL',e); process.exit(2); });
