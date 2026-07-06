const { chromium } = require('playwright-core');
const url = 'file:///workspace/custom-pos/pos.html';
const EXE = process.env.CHROMIUM_EXE || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const FLOW = {
  flowId:"hist", label:"History Co", topology:"linear",
  branding:{ name:"History Co", brandColor:"#555" },
  endpoints:{ customer:{persist:false}, payment:{tenders:["cash"], closeGate:"balanceLE0" } },
  catalog:[ {id:"w", name:"Widget", price:10, category:"retail", path:[] } ],
  stations:[ {id:"office", type:"report", label:"Office", view:{money:true} } ]
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

  await p.getByRole('button',{name:/^Office/}).first().click();
  // seed one sale today ($10) and one yesterday ($20)
  await p.evaluate(() => {
    const now = Date.now(); const yest = now - 24*3600*1000;
    DB.records.push({ id:"RA", number:1, status:"CLOSED", ts:now,  createdAt:"10:00", lines:[{name:"Widget",price:10,qty:1,category:"retail",path:[],stage:0}], tenders:[{type:"cash",amount:10}] });
    DB.records.push({ id:"RB", number:2, status:"CLOSED", ts:yest, createdAt:"10:00", lines:[{name:"Widget",price:20,qty:1,category:"retail",path:[],stage:0}], tenders:[{type:"cash",amount:20}] });
    saveDB(DB); render();
  });
  const today = await T();
  const todayOk = /Orders\s*1/.test(today) && /Total collected\s*\$10\.00/.test(today);

  // page back one day -> yesterday's $20 sale
  await p.getByRole('button',{name:/^←/}).click();
  const yest = await T();
  const yestOk = /Orders\s*1/.test(yest) && /Total collected\s*\$20\.00/.test(yest);

  // "Today" button returns to today
  await p.getByRole('button',{name:/^Today$/}).click();
  const back = /Total collected\s*\$10\.00/.test(await T());

  await b.close();
  console.log('\n=== RESULTS ===');
  console.log('report scoped to TODAY only ($10, not $30):', todayOk);
  console.log('paging back a day shows history ($20):', yestOk);
  console.log('"Today" returns to the current day ($10):', back);
  console.log('console errors:', errors.length?errors:'NONE');
  process.exit(errors.length||!todayOk||!yestOk||!back?1:0);
})().catch(e=>{ console.error('FATAL',e); process.exit(2); });
