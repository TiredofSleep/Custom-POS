const { chromium } = require('playwright-core');
const url = ('file://' + require('path').resolve(__dirname, '..', 'pos.html'));
const EXE = process.env.CHROMIUM_EXE || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const FLOW = {
  flowId:"bistro", label:"Bistro", topology:"linear",
  branding:{ name:"Bistro", brandColor:"#7a1f2b" },
  endpoints:{ customer:{persist:false}, payment:{tenders:["cash"], closeGate:"balanceLE0" }, coursing:true },
  courses:["Appetizers","Entrées","Desserts"],
  catalog:[
    {id:"cala", name:"Calamari", price:12, category:"app",    path:["line"], course:1 },
    {id:"steak",name:"Ribeye",   price:34, category:"entree", path:["line"], course:2 }
  ],
  stations:[
    {id:"server", type:"central",    label:"Server", view:{money:true} },
    {id:"line",   type:"production", label:"Kitchen Line", view:{money:false} },
    {id:"kds",    type:"kds",        label:"Kitchen Display", view:{money:false} }
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

  // ring an order with an appetizer (course 1) and an entrée (course 2)
  await p.getByRole('button',{name:/^Server/}).first().click();
  await p.getByText('Calamari',{exact:false}).first().click();
  await p.getByText('Ribeye',{exact:false}).first().click();
  await p.getByRole('button',{name:/Send order/}).click();

  // Kitchen line sees ONLY the appetizer; the entrée is held
  await changeTo(/Kitchen Line/);
  const line1 = await T();
  const line1Ok = /Calamari/.test(line1) && !/Ribeye/.test(line1);

  // KDS shows the fired course + the held entrée + a Fire button
  await changeTo(/Kitchen Display/);
  const kds1 = await T();
  const kdsHeldOk = /Appetizers/.test(kds1) && /held:.*Ribeye/.test(kds1) && /Fire Entrées/.test(kds1);

  // fire the next course -> the entrée is released
  await p.getByRole('button',{name:/Fire Entrées/}).click();
  const kds2 = await T();
  const firedOk = /Entrées/.test(kds2) && !/held:/.test(kds2);

  // now the kitchen line sees the entrée too
  await changeTo(/Kitchen Line/);
  const line2 = await T();
  const line2Ok = /Ribeye/.test(line2);

  await b.close();
  console.log('kds held:', kds1.replace(/\n+/g,' | '));
  console.log('\n=== RESULTS ===');
  console.log('kitchen sees only the fired course (Calamari, not Ribeye):', line1Ok);
  console.log('KDS shows fired course + held entrée + Fire button:', kdsHeldOk);
  console.log('firing the next course releases the entrée:', firedOk);
  console.log('kitchen now sees the released entrée:', line2Ok);
  console.log('console errors:', errors.length?errors:'NONE');
  process.exit(errors.length||!line1Ok||!kdsHeldOk||!firedOk||!line2Ok?1:0);
})().catch(e=>{ console.error('FATAL',e); process.exit(2); });
