const { chromium } = require('playwright-core');
const url = ('file://' + require('path').resolve(__dirname, '..', 'pos.html'));
const EXE = process.env.CHROMIUM_EXE || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const FLOW = {
  flowId:"bistro", label:"Bistro", topology:"linear",
  branding:{ name:"Bistro", brandColor:"#7a1f2b" },
  endpoints:{ customer:{persist:false}, payment:{tenders:["cash"], closeGate:"balanceLE0" } },
  floor:{ label:"Dining Room", sections:["Main","Patio"], tables:[
    {id:"t1",label:"1",seats:2,section:"Main"},
    {id:"t2",label:"2",seats:4,section:"Main"},
    {id:"p1",label:"P1",seats:4,section:"Patio"}
  ] },
  catalog:[ {id:"x", name:"Plate", price:20, category:"food", path:[] } ],
  stations:[ {id:"floor", type:"floor", label:"Floor", view:{} }, {id:"reg", type:"central", label:"Server", view:{money:true} } ]
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

  // module registry names the Floor plan
  const setup = await T();
  const moduleOk = /Floor \/ table plan/.test(setup);

  await p.getByRole('button',{name:/^Floor/}).first().click();
  const start = await T();
  const startOk = /0 of 3 tables occupied/.test(start) && /Empty/.test(start);

  // tap table 1 -> the panel opens and stays open as we advance through the service states
  await p.locator('.tabletile').filter({ hasText: /^1/ }).click();
  await p.getByRole('button',{name:/→ Seated/}).click();
  const seated = await T();
  const seatedOk = /1 of 3 tables occupied/.test(seated);

  await p.getByRole('button',{name:/→ Greeted/}).click();
  await p.getByRole('button',{name:/→ Ordered/}).click();
  const advancedOk = /Ordered/.test(await T());

  // jump straight to Bussing via the state buttons (panel already open)
  await p.locator('.card .opts').getByRole('button',{name:/^Bussing$/}).click();
  const bussingOk = /Bussing/.test(await T());

  // section filter — Patio has only 1 table (P1)
  await p.getByRole('button',{name:/^Patio$/}).click();
  const patio = await T();
  const filterOk = /of 1 tables occupied/.test(patio) && /P1/.test(patio);

  // state survives a re-render (persisted): back to All, table 1 still Bussing
  await p.getByRole('button',{name:/^All$/}).click();
  const persisted = /Bussing/.test(await T());

  await b.close();
  console.log('\n=== RESULTS ===');
  console.log('floor station enables the Floor plan module:', moduleOk);
  console.log('tables render, none occupied at start:', startOk);
  console.log('advancing a table to Seated marks it occupied:', seatedOk);
  console.log('service states advance in order (…→ Ordered):', advancedOk);
  console.log('can jump straight to any state (Bussing):', bussingOk);
  console.log('section filter shows only that section (Patio):', filterOk);
  console.log('table state persists across re-render:', persisted);
  console.log('console errors:', errors.length?errors:'NONE');
  process.exit(errors.length||!moduleOk||!startOk||!seatedOk||!advancedOk||!bussingOk||!filterOk||!persisted?1:0);
})().catch(e=>{ console.error('FATAL',e); process.exit(2); });
