const { chromium } = require('playwright-core');
const url = 'file:///workspace/custom-pos/pos.html';
const EXE = process.env.CHROMIUM_EXE || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const FLOW = {
  flowId:"cafe", label:"Report Cafe", topology:"linear",
  branding:{ name:"Report Cafe", brandColor:"#555" },
  endpoints:{ customer:{persist:false}, payment:{tenders:["cash","card"], closeGate:"balanceLE0" }, tax:{rate:0.10} },
  catalog:[ {id:"c", name:"Coffee", price:10, category:"drink", taxable:true, path:[] } ],
  stations:[
    {id:"reg",    type:"central", label:"Register", view:{money:true} },
    {id:"office", type:"report",  label:"Office",   view:{money:true} }
  ]
};
(async () => {
  const errors = [];
  const b = await chromium.launch({ executablePath: EXE, args:['--no-sandbox'] });
  const ctx = await b.newContext(); const p = await ctx.newPage();
  p.on('console', m => { if (m.type()==='error') errors.push(m.text()); });
  p.on('pageerror', e => errors.push('pageerror: '+e.message));
  await p.addInitScript(f => { window.CUSTOMPOS_FLOW = f; }, FLOW);
  await p.goto(url);
  const T = async () => (await p.locator('main').innerText());
  const changeTo = async n => { await p.getByText('change station').click(); await p.getByRole('button',{name:n}).first().click(); };

  // ---- ring a $10 coffee, pay CASH (balance $11 with 10% tax) ----
  await p.getByRole('button',{name:/^Register/}).first().click();
  await p.getByText('Coffee',{exact:false}).first().click();
  await p.getByRole('button',{name:/Send order/}).click();
  await p.getByRole('button',{name:/Take payment \$11\.00/}).click();
  await p.getByRole('button',{name:/Done — close/}).click();

  // ---- ring a second $10 coffee, pay CARD ----
  await p.getByText('Coffee',{exact:false}).first().click();
  await p.getByRole('button',{name:/Send order/}).click();
  await p.getByRole('button',{name:/Pay by card \$11\.00/}).click();
  await p.getByRole('button',{name:/Done — close/}).click();

  // ---- open the Office end-of-day report ----
  await changeTo(/^Office/);
  const rep = await T();
  const salesOk = /Orders\s*2/.test(rep) && /Items sold\s*2/.test(rep)
    && /Net sales\s*\$20\.00/.test(rep) && /Tax collected\s*\$2\.00/.test(rep)
    && /Total collected\s*\$22\.00/.test(rep);
  const tenderOk = /Cash\s*\$11\.00/.test(rep) && /Card\s*\$11\.00/.test(rep);
  const catOk = /drink\s*\$20\.00/i.test(rep);
  const drawerOk = /Expected cash\s*\$11\.00/.test(rep);

  // ---- cash drawer over/short from the counted input ----
  await p.locator('#cashCount').fill('11');
  const balanced = /balanced ✓/.test(await T());
  await p.locator('#cashCount').fill('9');
  const short = /short \$2\.00/.test(await T());
  await p.locator('#cashCount').fill('13');
  const over = /over \+\$2\.00/.test(await T());

  await b.close();
  console.log('report:', rep.replace(/\n+/g,' | '));
  console.log('\n=== RESULTS ===');
  console.log('sales summary (2 orders, net $20, tax $2, collected $22):', salesOk);
  console.log('by tender (cash $11 / card $11):', tenderOk);
  console.log('by category (drink $20):', catOk);
  console.log('cash drawer expected cash $11:', drawerOk);
  console.log('counted = expected -> balanced:', balanced);
  console.log('counted short -> "short $2.00":', short);
  console.log('counted over -> "over +$2.00":', over);
  console.log('console errors:', errors.length?errors:'NONE');
  process.exit(errors.length||!salesOk||!tenderOk||!catOk||!drawerOk||!balanced||!short||!over?1:0);
})().catch(e=>{ console.error('FATAL',e); process.exit(2); });
