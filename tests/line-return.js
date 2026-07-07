const { chromium } = require('playwright-core');
const url = 'file:///workspace/custom-pos/pos.html';
const EXE = process.env.CHROMIUM_EXE || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const FLOW = {
  flowId:"ret", label:"Return Co", topology:"linear",
  branding:{ name:"Return Co", brandColor:"#555" },
  endpoints:{ customer:{persist:false}, payment:{tenders:["cash"], closeGate:"balanceLE0" }, tax:{rate:0.10} },
  catalog:[ {id:"w", name:"Widget", price:10, category:"retail", path:[] }, {id:"g", name:"Gadget", price:20, category:"retail", path:[] } ],
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

  // ring Widget + Gadget ($30 + 10% = $33), pay cash, close
  await p.getByRole('button',{name:/^Register/}).first().click();
  await p.getByText('Widget',{exact:false}).first().click();
  await p.getByText('Gadget',{exact:false}).first().click();
  await p.getByRole('button',{name:/Send order/}).click();
  await p.getByRole('button',{name:/Take payment \$33\.00/}).click();
  await p.getByRole('button',{name:/Done — close/}).click();

  // Office: return just the Gadget (its share of $33 = $22)
  await changeTo(/^Office/);
  await p.locator('label:has-text("Gadget") input.retline').check();
  await p.getByRole('button',{name:/Return selected/}).click();
  const rep = await T();

  const ok = {
    net:   /Net sales\s*\$10\.00/.test(rep),           // only the Widget still sold
    tax:   /Tax collected\s*\$1\.00/.test(rep),         // tax on $10
    refund:/Refunds\s*−\$22\.00/.test(rep),             // Gadget's share of the total
    collected: /Total collected\s*\$11\.00/.test(rep),  // $33 − $22
    cash:  /Cash\s*\$11\.00/.test(rep),
    returned: /Returned: Gadget/.test(rep),
    stillOrder: /Orders\s*1/.test(rep)                  // order isn't fully refunded
  };

  await b.close();
  console.log('report:', rep.replace(/\n+/g,' | '));
  console.log('\n=== RESULTS ===');
  Object.entries(ok).forEach(([k,v])=>console.log(k+':', v));
  console.log('console errors:', errors.length?errors:'NONE');
  process.exit(errors.length || Object.values(ok).some(v=>!v) ? 1 : 0);
})().catch(e=>{ console.error('FATAL',e); process.exit(2); });
