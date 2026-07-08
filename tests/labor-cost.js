const { chromium } = require('playwright-core');
const url = ('file://' + require('path').resolve(__dirname, '..', 'pos.html'));
const EXE = process.env.CHROMIUM_EXE || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const FLOW = {
  flowId:"cafe", label:"Cost Cafe", topology:"linear",
  branding:{ name:"Cost Cafe", brandColor:"#555" },
  endpoints:{ customer:{persist:false}, payment:{tenders:["cash"], closeGate:"balanceLE0" } },
  labor:{ targetLaborPct:30 },
  staff:[ {id:"e1", name:"Alex", pin:"1111", wage:20} ],
  catalog:[ {id:"c", name:"Coffee", price:100, category:"drink", path:[] } ],
  stations:[
    {id:"reg",   type:"central",   label:"Register",   view:{money:true} },
    {id:"clock", type:"timeclock", label:"Time Clock", view:{} },
    {id:"office",type:"report",    label:"Office",     view:{money:true} }
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

  // clock Alex in, backdate to exactly 2h worked (2h × $20 = $40 labor cost)
  await p.getByRole('button',{name:/^Time Clock/}).first().click();
  await enterPin('1111'); await p.getByRole('button',{name:/Start shift/}).click();
  await p.evaluate(() => {
    const k = Object.keys(localStorage).find(x=>x.startsWith('custompos_demo_'));
    const db = JSON.parse(localStorage.getItem(k));
    db.punches[0].inTs = Date.now() - 2*3600*1000;
    localStorage.setItem(k, JSON.stringify(db));
  });

  // ring a single $100 coffee, pay cash -> $100 net sales; labor 40/100 = 40% (> target+10 -> high)
  await goTo(/^Register/);
  await p.getByText('Coffee',{exact:false}).first().click();
  await p.getByRole('button',{name:/Send order/}).click();
  await p.getByRole('button',{name:/Take payment/}).first().click();

  await goTo(/^Office/);
  const rep = await T();
  const costOk = /Labor cost[\s\S]{0,20}\$40\.00/.test(rep);
  const pctOk = /Labor as % of sales[\s\S]{0,30}40%/.test(rep);
  const flagged = /high/.test(rep);   // 40% > 30% target + 10 -> flagged

  await b.close();
  console.log('\n=== RESULTS ===');
  console.log('report shows labor cost (2h × $20 = $40):', costOk);
  console.log('report shows labor as % of sales (40%):', pctOk);
  console.log('a high labor share is flagged:', flagged);
  console.log('console errors:', errors.length?errors:'NONE');
  process.exit(errors.length||!costOk||!pctOk||!flagged?1:0);
})().catch(e=>{ console.error('FATAL',e); process.exit(2); });
