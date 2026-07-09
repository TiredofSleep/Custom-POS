const { chromium } = require('playwright-core');
const url = ('file://' + require('path').resolve(__dirname, '..', 'pos.html'));
const EXE = process.env.CHROMIUM_EXE || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
// A store in a state that exempts grocery but taxes prepared food + general goods.
const FLOW = {
  flowId:"mart", label:"Corner Mart", topology:"linear",
  branding:{ name:"Corner Mart", brandColor:"#555" },
  endpoints:{ customer:{persist:false}, payment:{tenders:["cash"], closeGate:"balanceLE0" },
    tax:{ rate:0.08, classes:{ grocery:0, prepared:0.08 } } },
  catalog:[
    {id:"milk", name:"Milk", price:2, category:"grocery", taxClass:"grocery", path:[] },   // exempt
    {id:"dog",  name:"Hot Dog", price:5, category:"deli", taxClass:"prepared", path:[] },   // 8%
    {id:"soda", name:"Soda", price:3, category:"drink", path:[] }                           // no class -> default 8%
  ],
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

  // grocery item alone is untaxed: $2 subtotal, $0 tax, $2 total
  await p.getByText('Milk',{exact:false}).first().click();
  await p.getByRole('button',{name:/Send order/}).click();
  const groceryOnly = await T();
  const groceryOk = !/Tax/.test(groceryOnly) && /Balance\s*\$2\.00/.test(groceryOnly);
  await p.getByRole('button',{name:/Take payment/}).first().click();

  // mixed basket: milk $2 (0%) + hot dog $5 (8% = $0.40) + soda $3 (default 8% = $0.24) = $0.64 tax, $10.64 total
  await p.getByText('Milk',{exact:false}).first().click();
  await p.getByText('Hot Dog',{exact:false}).first().click();
  await p.getByText('Soda',{exact:false}).first().click();
  await p.getByRole('button',{name:/Send order/}).click();
  const mixed = await T();
  const mixedOk = /Tax\s*\$0\.64/.test(mixed) && /Balance\s*\$10\.64/.test(mixed);

  await b.close();
  console.log('\n=== RESULTS ===');
  console.log('grocery item is exempt (milk alone: $0 tax):', groceryOk);
  console.log('mixed basket taxes each line at its class rate ($0.64 on $10):', mixedOk);
  console.log('console errors:', errors.length?errors:'NONE');
  process.exit(errors.length||!groceryOk||!mixedOk?1:0);
})().catch(e=>{ console.error('FATAL',e); process.exit(2); });
