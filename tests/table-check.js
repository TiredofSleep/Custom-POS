const { chromium } = require('playwright-core');
const url = ('file://' + require('path').resolve(__dirname, '..', 'pos.html'));
const EXE = process.env.CHROMIUM_EXE || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const FLOW = {
  flowId:"bistro", label:"Table Bistro", topology:"linear",
  branding:{ name:"Table Bistro", brandColor:"#7a1f2b" },
  endpoints:{ customer:{persist:false}, payment:{tenders:["cash"], closeGate:"balanceLE0" } },
  floor:{ label:"Dining Room", tables:[ {id:"t1",label:"T1",seats:2}, {id:"t2",label:"T2",seats:4} ] },
  catalog:[ {id:"p", name:"Plate", price:20, category:"food", path:[] } ],
  stations:[ {id:"server", type:"central", label:"Server", view:{money:true} }, {id:"floor", type:"floor", label:"Floor", view:{} } ]
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

  // ring a check to table T2 at the server station
  await p.getByRole('button',{name:/^Server/}).first().click();
  const hasPicker = /🍽 Table/.test(await T());
  await p.getByRole('button',{name:/^T2/}).first().click();     // tag this order to table 2
  await p.getByText('Plate',{exact:false}).first().click();
  await p.getByRole('button',{name:/Send order/}).click();
  const checkout = await T();
  const chipOk = /🍽 T2/.test(checkout);   // the check shows its table

  // the floor shows table 2 with the open check + occupied
  await goTo(/^Floor/);
  const floor = await T();
  const tileOk = /T2/.test(floor) && /\$20\.00 open/.test(floor) && !/2 of 2 tables occupied/.test(floor);
  await p.locator('.tabletile').filter({ hasText:'T2' }).click();
  const panel = await T();
  const panelOk = /Open check/.test(panel) && /\$20\.00 due/.test(panel);

  await b.close();
  console.log('\n=== RESULTS ===');
  console.log('the ringing station shows a table picker when a floor exists:', hasPicker);
  console.log('a check tagged to a table shows its table chip:', chipOk);
  console.log('the floor tile shows the open check total + occupies the table:', tileOk);
  console.log('tapping the table shows its open check:', panelOk);
  console.log('console errors:', errors.length?errors:'NONE');
  process.exit(errors.length||!hasPicker||!chipOk||!tileOk||!panelOk?1:0);
})().catch(e=>{ console.error('FATAL',e); process.exit(2); });
