const { chromium } = require('playwright-core');
const url = 'file:///workspace/custom-pos/pos.html';
const EXE = process.env.CHROMIUM_EXE || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const FLOW = {
  flowId:"grill", label:"Grill House", topology:"linear",
  branding:{ name:"Grill House", brandColor:"#555" },
  endpoints:{ customer:{persist:false}, payment:{tenders:["cash"], closeGate:"balanceLE0" } },
  kds:{ warnSec:300, badSec:600 },
  catalog:[ {id:"b", name:"Burger", price:9, category:"food", path:["grill"] } ],
  stations:[
    {id:"reg",  type:"central", label:"Register", view:{money:true} },
    {id:"grill",type:"production", label:"Grill", view:{money:false} },
    {id:"kds",  type:"kds",     label:"Kitchen Display", view:{money:false} }
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

  // module registry names the KDS
  const setup = await T();
  const moduleOk = /Kitchen display/.test(setup);

  // ring a burger -> goes in progress to the grill
  await p.getByRole('button',{name:/^Register/}).first().click();
  await p.getByText('Burger',{exact:false}).first().click();
  await p.getByRole('button',{name:/Send order/}).click();

  // KDS shows the live ticket with a prep timer, and a Bump
  await changeTo(/Kitchen Display/);
  const kds = await T();
  const ticketOk = /#1/.test(kds) && /Burger/.test(kds) && /at grill/.test(kds) && /Bump/.test(kds) && /\d:\d\d/.test(kds);

  // bump it -> ticket clears (all caught up)
  await p.getByRole('button',{name:/Bump/}).click();
  const cleared = /All caught up/.test(await T());

  // and it's now ready at checkout
  await changeTo(/^Register/);
  const desk = await T();
  const readyOk = /#1/.test(desk) && /Take payment \$9\.00/.test(desk);

  await b.close();
  console.log('kds:', kds.replace(/\n+/g,' | '));
  console.log('\n=== RESULTS ===');
  console.log('kds station enables the Kitchen display module:', moduleOk);
  console.log('KDS shows the live ticket + prep timer + Bump:', ticketOk);
  console.log('bumping clears the ticket:', cleared);
  console.log('bumped ticket is ready to check out:', readyOk);
  console.log('console errors:', errors.length?errors:'NONE');
  process.exit(errors.length||!moduleOk||!ticketOk||!cleared||!readyOk?1:0);
})().catch(e=>{ console.error('FATAL',e); process.exit(2); });
