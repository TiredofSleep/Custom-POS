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
  const pick = async n => p.getByRole('button',{name:n}).first().click();   // station buttons (avoid module-line text collision)
  const changeTo = async n => { await p.getByText('change station').click(); await pick(n); };
  const T = async () => (await p.locator('main').innerText());

  // Cleaners: module registry line + board + tracker
  await p.getByRole('button',{name:/Cleaners/}).click();
  const setupTxt = await T();
  const moduleLine = /Modules enabled by your stations/.test(setupTxt) && /Customer tracker/.test(setupTxt) && /Status board/.test(setupTxt);

  // ring up a Shirt (Heavy) -> in progress
  await pick(/Front Counter/);
  await p.getByRole('button',{name:/^Shirt/}).click();
  await p.getByRole('button',{name:/^Heavy/}).click();
  await p.getByRole('button',{name:/Add to order/}).click();
  await p.getByRole('button',{name:/Send order/}).click();

  // Status board shows it in progress, with location "at assembly"
  await changeTo('Status Board');
  const board = await T();
  const boardOk = /in progress \(1\)/i.test(board) && /#1/.test(board) && /at assembly/.test(board);

  // Customer tracker: sanitized -> item name + friendly status, NO prices, NO "Heavy"/internal
  await changeTo('Customer Tracker');
  const tr = await T();
  const trackerSanitized = /#1/.test(tr) && /In progress/.test(tr) && /Shirt/.test(tr) && !/\$\d/.test(tr) && !/Heavy/.test(tr) && !/assembly/.test(tr);

  await b.close();
  console.log('setup module line:', setupTxt.split('\n').find(l=>/Modules enabled/.test(l)));
  console.log('board:', board.replace(/\n+/g,' | '));
  console.log('tracker:', tr.replace(/\n+/g,' | '));
  console.log('\n=== RESULTS ===');
  console.log('module contract: stations auto-enable modules (shown on setup):', moduleLine);
  console.log('status board shows live record + location:', boardOk);
  console.log('customer tracker is sanitized (items+status, no $ / no internal detail):', trackerSanitized);
  console.log('console errors:', errors.length?errors:'NONE');
  process.exit(errors.length||!moduleLine||!boardOk||!trackerSanitized?1:0);
})().catch(e=>{ console.error('FATAL',e); process.exit(2); });
