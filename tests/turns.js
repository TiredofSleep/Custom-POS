const { chromium } = require('playwright-core');
const url = ('file://' + require('path').resolve(__dirname, '..', 'pos.html'));
const EXE = process.env.CHROMIUM_EXE || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const FLOW = {
  flowId:"bistro", label:"Bistro", topology:"linear",
  branding:{ name:"Bistro", brandColor:"#7a1f2b" },
  endpoints:{ customer:{persist:false}, payment:{tenders:["cash"], closeGate:"balanceLE0" } },
  floor:{ label:"Dining Room", tables:[
    {id:"t1",label:"1",seats:2},
    {id:"t2",label:"2",seats:4}
  ] },
  catalog:[ {id:"x", name:"Plate", price:20, category:"food", path:[] } ],
  stations:[ {id:"floor", type:"floor", label:"Floor", view:{} } ]
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

  await p.getByRole('button',{name:/^Floor/}).first().click();
  const start = await T();
  const startOk = /turns today/.test(start) && /avg turn/.test(start) && /covers/.test(start) && /—/.test(start);

  // seat table 2 (4 seats) -> a turn begins
  await p.locator('.tabletile').filter({ hasText: /^2/ }).click();
  await p.getByRole('button',{name:/→ Seated/}).click();

  // backdate the seat time to 45 minutes ago so the turn has a realistic, deterministic length
  await p.evaluate(() => {
    const k = Object.keys(localStorage).find(x=>x.startsWith('custompos_demo_'));
    const db = JSON.parse(localStorage.getItem(k));
    db.tables.t2.seatedTs = Date.now() - 45*60*1000;
    localStorage.setItem(k, JSON.stringify(db));
  });
  await p.reload();   // station stays bound → floor view renders directly

  // clear the table back to Empty -> the turn completes and logs
  await p.locator('.tabletile').filter({ hasText: /^2/ }).click();
  await p.locator('.card .opts').getByRole('button',{name:/^Empty$/}).click();

  const done = await T();
  const oneTurn = /1[\s\S]{0,40}turns today/.test(done);
  const avgShown = /4[45]:\d\d/.test(done);           // ~45 min average shown as M:SS (fmtDur under 1h)
  const coversOk = /4[\s\S]{0,20}covers/.test(done);  // table 2 seats 4
  const backToEmpty = /0 of 2 tables occupied/.test(done);

  await b.close();
  console.log('\n=== RESULTS ===');
  console.log('floor shows a turn-analytics card from the start:', startOk);
  console.log('a completed turn is counted (1 today):', oneTurn);
  console.log('average turn length shown (~45m):', avgShown);
  console.log('covers = seats of turned tables (4):', coversOk);
  console.log('cleared table returns to empty:', backToEmpty);
  console.log('console errors:', errors.length?errors:'NONE');
  process.exit(errors.length||!startOk||!oneTurn||!avgShown||!coversOk||!backToEmpty?1:0);
})().catch(e=>{ console.error('FATAL',e); process.exit(2); });
