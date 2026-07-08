const { chromium } = require('playwright-core');
const url = ('file://' + require('path').resolve(__dirname, '..', 'pos.html'));
const EXE = process.env.CHROMIUM_EXE || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
// A production station opts into bag splitting (bag) + in/out reconciliation (reconcile) — both pure config.
const FLOW = {
  flowId:"asm", label:"Assembly Test", topology:"hub-and-spoke",
  branding:{ name:"Assembly Cleaners", brandColor:"#2ea043" },
  endpoints:{ customer:{persist:false}, payment:{tenders:["cash"], closeGate:"balanceLE0"} },
  catalog:[ {id:"g1", name:"Shirt", price:5, category:"press", path:["assembly","rack"], serialized:true, tagLabel:"HSL"} ],
  stations:[
    {id:"counter", type:"central",    label:"Front Counter", view:{money:true}},
    {id:"assembly",type:"production",  label:"Assembly",      view:{money:false}, bag:{max:4}, reconcile:true},   // 5 pieces -> 2 bags
    {id:"rack",    type:"staging",     label:"Rack",          view:{money:false}}
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

  await p.getByRole('button',{name:/Front Counter/}).first().click();
  // ring 5 serialized Shirts (each becomes its own qty-1 unit line)
  for (let i=0;i<5;i++) await p.getByText('Shirt',{exact:false}).first().click();
  await p.getByRole('button',{name:/Send order/}).click();

  await changeTo('Assembly');
  // RECONCILIATION gate: 5 pieces counted in, 0 out -> "Mark done here" is blocked
  const markBlocked = await p.getByRole('button',{name:/Mark done here/}).isDisabled();
  const countInText = /0 of 5 pieces counted out/.test(await T());

  // SMART BAGGING: 5 pieces, max 4 per bag -> 2 bags, with bag chips on the pieces
  await p.getByRole('button',{name:/Bag these/}).click();
  const bags = await p.evaluate(()=>{ const d=JSON.parse(localStorage.getItem('custompos_demo_asm')); return d.records[0].bagsAt.assembly; });
  const afterBag = await T();
  const bagChips = /bag 1/.test(afterBag) && /bag 2/.test(afterBag);

  // count every piece OUT — the gate opens only when in == out
  let n = await p.getByRole('button',{name:'○'}).count();
  for (let i=0;i<n;i++) await p.getByRole('button',{name:'○'}).first().click();
  const reconciledText = /5 of 5 pieces counted out ✓/.test(await T());
  const markOpen = !(await p.getByRole('button',{name:/Mark done here/}).isDisabled());

  // and once reconciled, the order really can advance to the rack
  await p.getByRole('button',{name:/Mark done here/}).click();
  await changeTo('Rack');
  const atRack = /#1/.test(await T());

  await b.close();
  const gateOk = markBlocked===true && countInText && markOpen===true && reconciledText;
  const bagOk = bags===2 && bagChips;

  console.log('after bagging:', afterBag.replace(/\n+/g,' | '));
  console.log('\n=== RESULTS ===');
  console.log('reconciliation gate blocks Mark-done until every piece is counted out:', gateOk);
  console.log('smart bagging splits 5 pieces into 2 bags with bag chips:', bagOk);
  console.log('reconciled order advances to the rack:', atRack);
  console.log('console errors:', errors.length?errors:'NONE');
  process.exit(errors.length||!gateOk||!bagOk||!atRack?1:0);
})().catch(e=>{ console.error('FATAL',e); process.exit(2); });
