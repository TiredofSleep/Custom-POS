const { chromium } = require('playwright-core');
const url = ('file://' + require('path').resolve(__dirname, '..', 'pos.html'));
const EXE = process.env.CHROMIUM_EXE || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const FLOW = {
  flowId:"cafe", label:"Margin Cafe", topology:"linear",
  branding:{ name:"Margin Cafe", brandColor:"#555" },
  endpoints:{ customer:{persist:false}, payment:{tenders:["cash"], closeGate:"balanceLE0" } },
  catalog:[ {id:"c", name:"Coffee", price:10, cost:3, category:"drink", path:[] } ],   // $10 sell, $3 cost → 70% margin
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

  // ring two coffees ($20 sold), pay cash
  await p.getByRole('button',{name:/^Register/}).first().click();
  await p.getByText('Coffee',{exact:false}).first().click();
  await p.getByText('Coffee',{exact:false}).first().click();
  await p.getByRole('button',{name:/Send order/}).click();
  await p.getByRole('button',{name:/Take payment/}).first().click();

  // report: net $20, COGS $6 (2 × $3), gross profit $14, margin 70%
  await goTo(/^Office/);
  const rep = await T();
  const marginCard = /Gross margin/.test(rep);
  const cogsOk = /Cost of goods[\s\S]{0,20}−\$6\.00/.test(rep);
  const profitOk = /Gross profit[\s\S]{0,20}\$14\.00/.test(rep);
  const pctOk = /Margin[\s\S]{0,20}70%/.test(rep);

  await b.close();
  console.log('\n=== RESULTS ===');
  console.log('report shows a gross-margin card:', marginCard);
  console.log('cost of goods (2 × $3 = $6):', cogsOk);
  console.log('gross profit ($20 − $6 = $14):', profitOk);
  console.log('margin % (14/20 = 70%):', pctOk);
  console.log('console errors:', errors.length?errors:'NONE');
  process.exit(errors.length||!marginCard||!cogsOk||!profitOk||!pctOk?1:0);
})().catch(e=>{ console.error('FATAL',e); process.exit(2); });
