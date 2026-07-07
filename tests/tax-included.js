const { chromium } = require('playwright-core');
const url = 'file:///workspace/custom-pos/pos.html';
const EXE = process.env.CHROMIUM_EXE || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const FLOW = {
  flowId:"vat", label:"VAT Shop", topology:"linear",
  branding:{ name:"VAT Shop", brandColor:"#555" },
  endpoints:{ customer:{persist:false}, payment:{tenders:["cash"], closeGate:"balanceLE0" }, tax:{rate:0.10, included:true} },
  catalog:[ {id:"w", name:"Widget", price:110, category:"retail", path:[] } ],
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

  await p.getByRole('button',{name:/^Register/}).first().click();
  await p.getByText('Widget',{exact:false}).first().click();
  await p.getByRole('button',{name:/Send order/}).click();
  const co = await T();
  // included tax: the $10 is inside the $110 — total does NOT go up, tax shows as "incl."
  const checkoutOk = /Tax \(incl\.\)\s*\$10\.00/.test(co) && /Balance\s*\$110\.00/.test(co);

  await p.getByRole('button',{name:/Take payment \$110\.00/}).click();
  await p.getByRole('button',{name:/Done — close/}).click();

  await changeTo(/^Office/);
  const rep = await T();
  // net sales excludes the tax that was inside the price; tax still reported; collected = 110
  const reportOk = /Net sales\s*\$100\.00/.test(rep) && /Tax collected\s*\$10\.00/.test(rep) && /Total collected\s*\$110\.00/.test(rep);

  await b.close();
  console.log('checkout:', co.replace(/\n+/g,' | '));
  console.log('\n=== RESULTS ===');
  console.log('included tax is inside the price (total stays $110, tax incl. $10):', checkoutOk);
  console.log('report: net $100 excl. tax, tax $10, collected $110:', reportOk);
  console.log('console errors:', errors.length?errors:'NONE');
  process.exit(errors.length||!checkoutOk||!reportOk?1:0);
})().catch(e=>{ console.error('FATAL',e); process.exit(2); });
