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
  const pick = async n => p.getByRole('button',{name:new RegExp('^'+n)}).first().click();  // anchored: avoid module-line text
  const changeTo = async n => { await p.getByText('change station').click(); await pick(n); };
  const T = async () => (await p.locator('main').innerText());
  const chipClass = () => p.locator('.pill.clock').first().getAttribute('class');

  // COUNTER aging timer
  await pick('Order Counter');
  await p.getByRole('button',{name:/^Coffee/}).click();
  await p.getByRole('button',{name:/Send order/}).click();
  await changeTo('Bar');
  const freshClass = await chipClass();                        // ~0s -> good
  // age it: set the record ts 700s in the past
  await p.evaluate(()=>{ const k='custompos_demo_counter'; const db=JSON.parse(localStorage.getItem(k)); db.records[0].ts = Date.now()-700000; localStorage.setItem(k, JSON.stringify(db)); });
  await p.reload();
  const agedClass = await chipClass();                         // 700s > badSec 600 -> bad
  const agedTxt = await T();

  // CLEANERS due timer -> overdue
  await p.getByText('change station').click();
  await p.getByRole('button',{name:/Cleaners/}).click();
  await pick('Front Counter');
  await p.getByRole('button',{name:/Wash & Fold/}).click();
  await p.getByRole('button',{name:/Send order/}).click();
  await changeTo('Rack');
  const dueFreshClass = await chipClass();                     // due in ~2d -> good
  await p.evaluate(()=>{ const k='custompos_demo_cleaners'; const db=JSON.parse(localStorage.getItem(k)); db.records[0].ts = Date.now()-200000000; localStorage.setItem(k, JSON.stringify(db)); });
  await p.reload();
  const overdueTxt = await T();
  const overdueClass = await chipClass();

  await b.close();
  console.log('aged counter view:', agedTxt.replace(/\n+/g,' | '));
  console.log('overdue cleaners view:', overdueTxt.replace(/\n+/g,' | '));
  console.log('\n=== RESULTS ===');
  console.log('fresh ticket chip is good:', /good/.test(freshClass));
  console.log('aged >10min ticket chip goes red (bad):', /bad/.test(agedClass) && /11:40|1[12]:/.test(agedTxt));
  console.log('due timer fresh is good:', /good/.test(dueFreshClass));
  console.log('past-due cleaners order shows OVERDUE red:', /bad/.test(overdueClass) && /OVERDUE/.test(overdueTxt));
  console.log('console errors:', errors.length?errors:'NONE');
  process.exit(errors.length || !/good/.test(freshClass) || !/bad/.test(agedClass) || !/OVERDUE/.test(overdueTxt) ? 1 : 0);
})().catch(e=>{ console.error('FATAL',e); process.exit(2); });
