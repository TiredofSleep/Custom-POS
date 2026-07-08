const { chromium } = require('playwright-core');
const url = ('file://' + require('path').resolve(__dirname, '..', 'pos.html'));
const EXE = process.env.CHROMIUM_EXE || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
// counter cafe: tips on, pooled by hours; two staff; a worker portal to see the share
const FLOW = {
  flowId:"cafe", label:"Pool Cafe", topology:"linear",
  branding:{ name:"Pool Cafe", brandColor:"#555" },
  endpoints:{ customer:{persist:false}, payment:{tenders:["cash","card"], closeGate:"balanceLE0", tip:{presets:[20]}, tipPool:true } },
  staff:[ {id:"e1", name:"Alex", pin:"1111"}, {id:"e2", name:"Sam", pin:"2222"} ],
  catalog:[ {id:"c", name:"Coffee", price:100, category:"drink", path:[] } ],
  stations:[
    {id:"reg",   type:"central",   label:"Register",   view:{money:true} },
    {id:"clock", type:"timeclock", label:"Time Clock", view:{} },
    {id:"office",type:"report",    label:"Office",     view:{money:true} },
    {id:"me",    type:"worker",    label:"My Portal",  view:{} }
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
  const digit = async d => p.getByRole('button',{name:d,exact:true}).click();
  const enterPin = async pin => { for(const d of pin.split('')) await digit(d); await p.getByRole('button',{name:'✓',exact:true}).click(); };
  const goTo = async re => { await p.locator('#changeStation').click(); await p.getByRole('button',{name:re}).first().click(); };

  // clock both workers in, then backdate so Alex has 3h and Sam has 1h (pool splits 75/25)
  await p.getByRole('button',{name:/^Time Clock/}).first().click();
  await enterPin('1111'); await p.getByRole('button',{name:/Start shift/}).click();
  await enterPin('2222'); await p.getByRole('button',{name:/Start shift/}).click();
  await p.evaluate(() => {
    const k = Object.keys(localStorage).find(x=>x.startsWith('custompos_demo_'));
    const db = JSON.parse(localStorage.getItem(k));
    const now = Date.now();
    db.punches.find(p=>p.staffId==='e1').inTs = now - 3*3600*1000;   // Alex 3h
    db.punches.find(p=>p.staffId==='e2').inTs = now - 1*3600*1000;   // Sam 1h
    localStorage.setItem(k, JSON.stringify(db));
  });

  // ring a $100 coffee with a 20% ($20) tip, pay cash
  await goTo(/^Register/);
  await p.getByText('Coffee',{exact:false}).first().click();
  await p.getByRole('button',{name:/Send order/}).click();
  await p.getByRole('button',{name:/20%/}).first().click();          // tip $20
  await p.getByRole('button',{name:/Take payment/}).first().click(); // pay cash in full → PAID

  // read the Office report: tip pool splits Alex $15 / Sam $5 (3h:1h)
  await goTo(/^Office/);
  const rep = await T();
  const poolShown = /Tip pool — shared by hours/.test(rep);
  const splitOk = /Alex[\s\S]{0,40}\$15\.00/.test(rep) && /Sam[\s\S]{0,40}\$5\.00/.test(rep) && /Pool total[\s\S]{0,20}\$20\.00/.test(rep);

  // worker portal: Alex sees his tip share (~$15)
  await goTo(/^My Portal/);
  await enterPin('1111');
  const dash = await T();
  const portalShare = /tip share today/.test(dash) && /\$15\.00/.test(dash);

  await b.close();
  console.log('\n=== RESULTS ===');
  console.log('report shows a tip-pool card:', poolShown);
  console.log('tips split by hours (Alex $15 / Sam $5 of $20):', splitOk);
  console.log('worker portal shows the worker\'s tip share:', portalShare);
  console.log('console errors:', errors.length?errors:'NONE');
  process.exit(errors.length||!poolShown||!splitOk||!portalShare?1:0);
})().catch(e=>{ console.error('FATAL',e); process.exit(2); });
