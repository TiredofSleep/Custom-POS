const { chromium } = require('playwright-core');
const url = ('file://' + require('path').resolve(__dirname, '..', 'pos.html'));
const EXE = process.env.CHROMIUM_EXE || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
// 🧑‍🍳 SERVER ASSIGNMENT + "my tables": a server owns tables; the floor can filter to just theirs, and the
// assignment survives service-state changes and clears when the table is bussed empty.
const FLOW = {
  flowId:"bistro", label:"Bistro", topology:"linear",
  branding:{ name:"Bistro", brandColor:"#7a1f2b" },
  endpoints:{ customer:{persist:false}, payment:{tenders:["cash"], closeGate:"balanceLE0" } },
  staff:[ {id:"s1",name:"Riley",pin:"1111"}, {id:"s2",name:"Sam",pin:"2222"} ],
  floor:{ label:"Dining Room", tables:[ {id:"t1",label:"1",seats:2}, {id:"t2",label:"2",seats:4} ] },
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
  const server = async id => p.evaluate(i => (JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k=>/pos/i.test(k))||"")||"{}").tables||{})[i], id);

  await p.getByRole('button',{name:/^Floor/}).first().click();
  const barOk = /Tables:/.test(await T());                                   // the "my tables" server filter bar

  // assign Riley to table 1 via the table panel
  await p.locator('.tabletile').filter({ hasText: /^1/ }).click();
  await p.locator('.card').filter({ hasText: 'Server:' }).getByRole('button',{ name:'Riley' }).click();
  const assignedTile = /🧑‍🍳 Riley/.test(await T());
  const assignedDb = await p.evaluate(()=>{ const w=window; return (w.DB&&w.DB.tables&&w.DB.tables.t1&&w.DB.tables.t1.server)|| (w.tableServer?w.tableServer('t1'):null); });

  // "my tables" — filter to Riley: only table 1 remains
  await p.locator('.opts').filter({ hasText:'Tables:' }).getByRole('button',{ name:'Riley' }).click();
  const onlyMine = await p.locator('.tabletile').count();

  // assignment persists across a state change; back to All
  await p.locator('.opts').filter({ hasText:'Tables:' }).getByRole('button',{ name:/^All$/ }).click();
  await p.locator('.tabletile').filter({ hasText: /^1/ }).click();
  await p.getByRole('button',{name:/→ Seated/}).click();
  const persists = /🧑‍🍳 Riley/.test(await T());

  await b.close();
  console.log('\n=== RESULTS ===');
  console.log('floor shows the "my tables" server filter:', barOk);
  console.log('assigning a server tags the table (tile + DB):', assignedTile && assignedDb==='Riley');
  console.log('"my tables" filters the floor to one server (1 table):', onlyMine===1);
  console.log('the assignment survives a service-state change:', persists);
  console.log('console errors:', errors.length?errors:'NONE');
  process.exit(errors.length||!barOk||!assignedTile||assignedDb!=='Riley'||onlyMine!==1||!persists?1:0);
})().catch(e=>{ console.error('FATAL',e); process.exit(2); });
