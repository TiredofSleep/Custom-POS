const { chromium } = require('playwright-core');
const url = ('file://' + require('path').resolve(__dirname, '..', 'pos.html'));
const EXE = process.env.CHROMIUM_EXE || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
// A multi-location flow: a `stores` list turns on the (otherwise inert) multi-store module — no per-trade code.
const FLOW = {
  flowId:"chain", label:"Chain Cleaners", topology:"hub-and-spoke",
  branding:{ name:"Chain Cleaners", brandColor:"#2ea043" },
  endpoints:{ customer:{persist:true}, payment:{tenders:["cash"], closeGate:"balanceLE0"} },
  stores:[ {id:"ark", name:"Arkadelphia", plant:true}, {id:"hs", name:"Hot Springs"} ],   // plant + a drop store
  catalog:[ {id:"g1", name:"Shirt", price:6.50, category:"press", path:["assembly","rack"]} ],  // no mods -> adds directly
  stations:[
    {id:"counter", type:"central",    label:"Front Counter",     view:{money:true}},
    {id:"assembly",type:"production",  label:"Assembly",          view:{money:false}},
    {id:"board",   type:"board",       label:"Status Board",      view:{money:false}},
    {id:"tracker", type:"tracker",     label:"Customer Tracker",  view:{money:false, external:true}}
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

  // This device is at Hot Springs (a DROP store). Ring a Shirt.
  await p.getByRole('button',{name:/Hot Springs/}).first().click();     // store chooser (multi-store picker)
  await p.getByRole('button',{name:/Front Counter/}).first().click();   // station
  await p.getByText('Shirt',{exact:false}).first().click();             // no mods -> adds directly
  await p.getByRole('button',{name:/Send order/}).click();

  // Inspect the stamped order + the pure store helpers (config-driven, no trade code)
  const r = await p.evaluate(()=>{
    const d=JSON.parse(localStorage.getItem('custompos_demo_chain'));
    const rec=d.records[0];
    const cust=(d.customers||[])[0]||null;
    return { storeId: rec.storeId, home: homeStore(),
             chip: storeChip(rec), note: assembledAt(rec),
             plantNote: assembledAt({storeId:'ark'}),        // a plant order is NOT "assembled elsewhere"
             plantName: (plantStore()||{}).name,
             isPlantHS: isPlantStore('hs'), isPlantArk: isPlantStore('ark'),
             custStore: cust && cust.storeId };
  });

  await changeTo('Status Board');
  const board = await T();
  await changeTo('Customer Tracker');
  const tr = await T();

  await b.close();

  // stamping: the order belongs to the device's store; the customer's home store is remembered (sticky)
  const stampOk = r.storeId==='hs' && r.home==='hs' && r.custStore==='hs';
  // plant awareness: a drop-store order reads "assembled at <plant>"; a plant order does not
  const plantOk = /assembled at Arkadelphia/.test(r.note) && r.plantNote==='' && r.plantName==='Arkadelphia'
               && r.isPlantHS===false && r.isPlantArk===true;
  const chipOk = /Hot Springs/.test(r.chip);
  const boardOk = /Hot Springs/.test(board) && /assembled at Arkadelphia/.test(board);   // store chip + plant note on the board
  const trackerOk = /assembled at Arkadelphia/.test(tr) && !/\$\d/.test(tr) && !/Front Counter/.test(tr);  // customer-friendly, still sanitized

  console.log('order storeId / home / customer sticky store:', r.storeId, r.home, r.custStore);
  console.log('board:', board.replace(/\n+/g,' | '));
  console.log('tracker:', tr.replace(/\n+/g,' | '));
  console.log('\n=== RESULTS ===');
  console.log('order is stamped with the device store, customer home store remembered:', stampOk);
  console.log('drop-store order says "assembled at <plant>"; a plant order does not:', plantOk);
  console.log('store chip renders the store name:', chipOk);
  console.log('status board shows store chip + plant note:', boardOk);
  console.log('customer tracker shows the friendly plant note but stays sanitized:', trackerOk);
  console.log('console errors:', errors.length?errors:'NONE');
  process.exit(errors.length||!stampOk||!plantOk||!chipOk||!boardOk||!trackerOk?1:0);
})().catch(e=>{ console.error('FATAL',e); process.exit(2); });
