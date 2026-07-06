const { chromium } = require('playwright-core');
const url = 'file:///workspace/custom-pos/pos.html';
const EXE = process.env.CHROMIUM_EXE || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const FLOW = {
  flowId:"shop", label:"Stock Shop", topology:"linear",
  branding:{ name:"Stock Shop", brandColor:"#555" },
  endpoints:{ customer:{persist:false}, payment:{tenders:["cash"], closeGate:"balanceLE0" } },
  catalog:[ {id:"w", name:"Widget", price:5, category:"retail", stock:2, reorderAt:1, path:[] } ],
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
  const start = await T();
  const startOk = /2 in stock/.test(start);

  // sell one -> on-hand 1, at reorderAt -> low
  await p.getByText('Widget',{exact:false}).first().click();
  await p.getByRole('button',{name:/Send order/}).click();
  await p.getByRole('button',{name:/Take payment/}).click();
  await p.getByRole('button',{name:/Done — close/}).click();
  const afterOne = await T();
  const lowOk = /1 in stock/.test(afterOne) && /low/i.test(afterOne);

  // sell the last one -> out of stock, tile disabled
  await p.getByText('Widget',{exact:false}).first().click();
  await p.getByRole('button',{name:/Send order/}).click();
  await p.getByRole('button',{name:/Take payment/}).click();
  await p.getByRole('button',{name:/Done — close/}).click();
  const afterTwo = await T();
  const outOk = /out of stock/i.test(afterTwo);
  const tileDisabled = await p.getByRole('button',{name:/Widget/}).first().isDisabled();

  // Office: reorder list flags the widget, then receive 5 clears it
  await changeTo(/^Office/);
  const rep = await T();
  const reorderOk = /Stock/.test(rep) && /to reorder/.test(rep) && /Widget/.test(rep) && /0 on hand/.test(rep);
  await p.locator('input.rcv').first().fill('5');
  await p.getByRole('button',{name:/^Receive/}).first().click();
  const afterRcv = await T();
  const receivedOk = /5 on hand/.test(afterRcv) && !/to reorder/.test(afterRcv);

  await b.close();
  console.log('start:', start.replace(/\n+/g,' | '));
  console.log('office:', rep.replace(/\n+/g,' | '));
  console.log('\n=== RESULTS ===');
  console.log('catalog shows on-hand (2 in stock):', startOk);
  console.log('selling to threshold flags low (1 in stock, low):', lowOk);
  console.log('selling out marks out of stock:', outOk);
  console.log('out-of-stock tile is disabled:', tileDisabled);
  console.log('Office reorder list flags the item (0 on hand):', reorderOk);
  console.log('receiving stock restores on-hand + clears reorder:', receivedOk);
  console.log('console errors:', errors.length?errors:'NONE');
  process.exit(errors.length||!startOk||!lowOk||!outOk||!tileDisabled||!reorderOk||!receivedOk?1:0);
})().catch(e=>{ console.error('FATAL',e); process.exit(2); });
