const { chromium } = require('playwright-core');
const url = 'file:///workspace/custom-pos/pos.html';
const EXE = process.env.CHROMIUM_EXE || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

// a minimal injected single-business flow (what a downloaded POS carries)
const FLOW = {
  flowId:"myshop", label:"Joe's Coffee", topology:"linear",
  branding:{ name:"Joe's Coffee", brandColor:"#8a5a2b" },
  endpoints:{ customer:{persist:false}, payment:{tenders:["cash"], closeGate:"balanceLE0"} },
  catalog:[ {id:"a", name:"Drip", price:2.5, category:"drink", path:["bar"]} ],
  stations:[
    {id:"order", type:"intake", label:"Order", view:{money:true}},
    {id:"bar", type:"production", label:"Bar", view:{money:false}},
    {id:"checkout", type:"fulfillment", label:"Checkout", view:{money:true}}
  ]
};

(async () => {
  const errors = [];
  const b = await chromium.launch({ executablePath: EXE, args:['--no-sandbox'] });
  const ctx = await b.newContext(); const p = await ctx.newPage();
  p.on('console', m => { if (m.type()==='error') errors.push(m.text()); });
  p.on('pageerror', e => errors.push('pageerror: '+e.message));
  await p.addInitScript(f => { window.CUSTOMPOS_FLOW = f; }, FLOW);   // inject BEFORE the engine script runs
  await p.goto(url);
  const setup = await p.locator('main').innerText();
  const brandInHeader = (await p.locator('#bizName').innerText()) === "Joe's Coffee";
  const noDemoSelector = !/Demo business/.test(setup) && !/Counter shop|Cleaners|Repair shop|Salon/.test(setup);
  // and it actually runs as that single business
  await p.getByRole('button',{name:/^Order/}).first().click();
  await p.getByText('Drip',{exact:false}).first().click();
  await p.getByRole('button',{name:/Send order/}).click();
  await p.getByText('change station').click();
  await p.getByRole('button',{name:/^Bar/}).first().click();
  await p.getByRole('button',{name:/Mark done here/}).click();   // -> READY
  await p.getByText('change station').click();
  await p.getByRole('button',{name:/^Checkout/}).first().click();
  await p.getByRole('button',{name:/Take payment/}).click();
  await p.getByRole('button',{name:/Done/}).click();
  const ran = /completed today/.test(await p.locator('main').innerText());

  await b.close();
  console.log('setup:', setup.replace(/\n+/g,' | ').slice(0,160));
  console.log('\n=== RESULTS ===');
  console.log('injected flow drives the branding:', brandInHeader);
  console.log('no demo-business selector in a downloaded POS:', noDemoSelector);
  console.log('injected single-business POS runs end-to-end:', ran);
  console.log('console errors:', errors.length?errors:'NONE');
  process.exit(errors.length||!brandInHeader||!noDemoSelector||!ran?1:0);
})().catch(e=>{ console.error('FATAL',e); process.exit(2); });
