const { chromium } = require('playwright-core');
const url = ('file://' + require('path').resolve(__dirname, '..', 'pos.html'));
const EXE = process.env.CHROMIUM_EXE || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const FLOW = {
  flowId:"cafe", label:"Kind Cafe", topology:"linear",
  branding:{ name:"Kind Cafe", brandColor:"#555" },
  endpoints:{ customer:{persist:false}, payment:{tenders:["cash"], closeGate:"balanceLE0", roundUp:{cause:"the food bank"} } },
  catalog:[ {id:"c", name:"Coffee", price:4.25, category:"drink", path:[] } ],   // $4.25 -> round up to $5.00 (+$0.75)
  stations:[ {id:"reg", type:"central", label:"Register", view:{money:true} }, {id:"office", type:"report", label:"Office", view:{money:true} } ]
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
  const goTo = async re => { await p.locator('#changeStation').click(); await p.getByRole('button',{name:re}).first().click(); };

  await p.getByRole('button',{name:/^Register/}).first().click();
  await p.getByText('Coffee',{exact:false}).first().click();
  await p.getByRole('button',{name:/Send order/}).click();

  // the round-up option offers to round $4.25 up to $5.00 (+$0.75) for the food bank
  const preRound = await T();
  const offered = /Round up for the food bank/.test(preRound) && /Round up to \$5\.00 \(\+\$0\.75\)/.test(preRound);
  await p.getByRole('button',{name:/Round up to \$5\.00/}).click();
  const rounded = await T();
  const confirmedOk = /Rounded up \$0\.75 for the food bank/.test(rounded) && /Balance\s*\$5\.00/.test(rounded);

  // pay it, then the report shows the community round-up total
  await p.getByRole('button',{name:/Take payment/}).first().click();
  await goTo(/^Office/);
  const rep = await T();
  const communityOk = /Community/.test(rep) && /Rounded up for the food bank[\s\S]{0,20}\$0\.75/.test(rep);

  await b.close();
  console.log('\n=== RESULTS ===');
  console.log('checkout offers to round up to the next dollar:', offered);
  console.log('rounding up adds the donation to the balance:', confirmedOk);
  console.log('report tallies the community round-ups:', communityOk);
  console.log('console errors:', errors.length?errors:'NONE');
  process.exit(errors.length||!offered||!confirmedOk||!communityOk?1:0);
})().catch(e=>{ console.error('FATAL',e); process.exit(2); });
