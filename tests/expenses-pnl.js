// Expenses integration: the report used to stop at gross margin ("what's left to cover rent, labor and
// everything else"). Now an owner records the overhead they actually pay (supplies, rent, utilities…) and the
// Bottom-line card carries the whole money story down to NET profit: Net sales − COGS − Labor − Expenses.
// This proves the math ties out, that adding/voiding an expense moves the bottom line, and that it's logged.
const { chromium } = require('playwright-core');
const path = require('path');
const url = 'file://' + path.resolve(__dirname, '..', 'pos.html');
const EXE = process.env.CHROMIUM_EXE || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const FLOW = {
  flowId:'pnl', label:'P&L', topology:'linear',
  branding:{ name:'Bottom Line Co', brandColor:'#1f6feb' },
  endpoints:{ customer:{persist:false}, payment:{ tenders:['cash'], closeGate:'balanceLE0' } },
  staff:[ {id:'e1', name:'Alex', pin:'1', wage:2} ],
  catalog:[ {id:'w', name:'Widget', price:20, category:'goods', path:[], cost:5} ],
  stations:[ {id:'reg', type:'central', label:'Counter', view:{money:true}},
             {id:'office', type:'report', label:'Office', view:{money:true}} ],
};

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

  // revenue: ring a $20 widget (cost $5); force it PAID today, and clock 1h of labor at $2 = $2
  await p.getByRole('button',{name:/^Counter/}).first().click();
  await p.getByText('Widget',{exact:false}).first().click();
  await p.getByRole('button',{name:/Send order/}).click();
  await p.waitForTimeout(150);
  await p.evaluate(() => { const d=loadDB(); const r=d.records[0]; r.status='PAID'; r.tenders=[{type:'cash',amount:20}]; r.ts=Date.now();
    d.punches=[{ staffId:'e1', wage:2, inTs:Date.now()-3600000, outTs:Date.now(), out:true }]; saveDB(d); });

  // record a $3 supplies expense via the Office report UI (scoped to the Expenses card)
  await p.evaluate(() => bindStation('office'));
  await p.waitForTimeout(100);
  const exCard = p.locator('.card', { hasText: 'Expenses' });
  await exCard.getByPlaceholder('$ amount').fill('3');
  await exCard.getByPlaceholder('vendor / note').fill('ACME');
  await exCard.getByRole('button',{name:/^Add$/}).click();
  await p.waitForTimeout(150);

  const bl1 = await p.locator('.card', { hasText: 'Bottom line' }).innerText();
  // Net 20, COGS 5, gross 15, labor 2, expenses 3 -> net profit 10
  assert('the bottom-line card shows net sales', /Net sales\s*\$20\.00/.test(bl1));
  assert('it subtracts cost of goods', /Cost of goods\s*−\$5\.00/.test(bl1));
  assert('it subtracts labor from the punch clock', /Labor\s*−\$2\.00/.test(bl1));
  assert('it subtracts the operating expense just entered', /Operating expenses\s*−\$3\.00/.test(bl1));
  assert('it lands on the correct NET profit (20−5−2−3 = 10)', /Net profit\s*\$10\.00/.test(bl1));

  // the expense hit the activity log (money discipline)
  const logged = await p.evaluate(() => (loadDB().activity||[]).some(a => a.type==='money' && /expense/.test(a.detail) && a.amt===3));
  assert('the expense is recorded on the activity log', logged);

  // void the expense -> net profit rises by $3 to $13
  await p.locator('.card', { hasText:'Expenses' }).getByText('void', { exact:true }).first().click();
  await p.waitForTimeout(150);
  const bl2 = await p.locator('.card', { hasText: 'Bottom line' }).innerText();
  assert('voiding the expense removes it from operating expenses', !/Operating expenses/.test(bl2));
  assert('and the net profit rises back to $13 (20−5−2)', /Net profit\s*\$13\.00/.test(bl2));

  const voidLogged = await p.evaluate(() => (loadDB().activity||[]).some(a => /voided expense/.test(a.detail)));
  assert('the void is logged too', voidLogged);

  await b.close();
  console.log('\n=== RESULTS ===');
  assert('no console or page errors', errors.length === 0);
  if (errors.length) console.log('errors:', errors);
  console.log('\n'+(ok?'ALL PASS':'FAIL'));
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
