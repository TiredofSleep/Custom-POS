const { chromium } = require('playwright-core');
const url = ('file://' + require('path').resolve(__dirname, '..', 'pos.html'));
const EXE = process.env.CHROMIUM_EXE || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
// A delivery shop: the shop's own rate is 8%, but a delivery into "Rivertown" is taxed at that town's 9.25%.
const FLOW = {
  flowId:"deliver", label:"Delivery Co", topology:"linear",
  branding:{ name:"Delivery Co", brandColor:"#555" },
  endpoints:{ customer:{persist:false}, payment:{tenders:["cash"], closeGate:"balanceLE0" },
    tax:{ rate:0.08, zones:[ {name:"Rivertown", rate:0.0925}, {name:"Old Town", rate:0.07} ] } },
  catalog:[ {id:"p", name:"Pizza", price:100, category:"food", path:[] } ],
  stations:[ {id:"reg", type:"central", label:"Register", view:{money:true} } ]
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

  await p.getByRole('button',{name:/^Register/}).first().click();
  await p.getByText('Pizza',{exact:false}).first().click();
  await p.getByRole('button',{name:/Send order/}).click();
  const atShop = await T();
  // default is the shop's own rate: 8% of $100 = $8.00, total $108.00
  const shopRateOk = /Tax \(8\.00%\).*\$8\.00/s.test(atShop) && /\$108\.00/.test(atShop);
  // the tax-area selector is present with both delivery towns
  const selectorOk = /Tax area/.test(atShop) && /Rivertown/.test(atShop) && /Old Town/.test(atShop);

  // choose the Rivertown delivery area -> tax recomputes at 9.25% = $9.25, total $109.25
  await p.locator('select').first().selectOption('Rivertown');
  const atRivertown = await T();
  const destRateOk = /Tax \(9\.25% · Rivertown\).*\$9\.25/s.test(atRivertown) && /\$109\.25/.test(atRivertown);

  // switch back to the shop -> back to 8%
  await p.locator('select').first().selectOption('');
  const backOk = /Tax \(8\.00%\).*\$8\.00/s.test(await T());

  await b.close();
  console.log('\n=== RESULTS ===');
  console.log('default order taxes at the shop rate (8% = $8):', shopRateOk);
  console.log('a tax-area selector offers the delivery towns:', selectorOk);
  console.log('choosing Rivertown taxes at the destination rate (9.25% = $9.25):', destRateOk);
  console.log('switching back to the shop returns to 8%:', backOk);
  console.log('console errors:', errors.length?errors:'NONE');
  process.exit(errors.length||!shopRateOk||!selectorOk||!destRateOk||!backOk?1:0);
})().catch(e=>{ console.error('FATAL',e); process.exit(2); });
