const { chromium } = require('playwright-core');
const url = ('file://' + require('path').resolve(__dirname, '..', 'pos.html'));
const EXE = process.env.CHROMIUM_EXE || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const FLOW = {
  flowId:"cafe", label:"Verdict Cafe", topology:"linear",
  branding:{ name:"Verdict Cafe", brandColor:"#555" },
  endpoints:{ customer:{persist:false}, payment:{tenders:["cash"], closeGate:"balanceLE0" } },
  labor:{ targetLaborPct:30 },
  staff:[ {id:"e1", name:"Alex", pin:"1111", wage:10} ],
  catalog:[ {id:"c", name:"Coffee", price:10, cost:3, category:"drink", path:[] } ],  // 70% margin
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

  // Alex clocks in, backdate to 1h ($10 labor)
  await p.getByRole('button',{name:/^Time Clock/}).first().click();
  await enterPin('1111'); await p.getByRole('button',{name:/Start shift/}).click();
  await p.evaluate(() => { const k=Object.keys(localStorage).find(x=>x.startsWith('custompos_demo_')); const db=JSON.parse(localStorage.getItem(k)); db.punches[0].inTs=Date.now()-3600*1000; localStorage.setItem(k,JSON.stringify(db)); });

  // ring 5 coffees -> $50 net; labor $10 = 20% of sales; margin 70% -> "Solid day."
  await goTo(/^Register/);
  for(let i=0;i<5;i++) await p.getByText('Coffee',{exact:false}).first().click();
  await p.getByRole('button',{name:/Send order/}).click();
  await p.getByRole('button',{name:/Take payment/}).first().click();

  await goTo(/^Office/);
  const rep = await T();
  const verdictOk = /Solid day/.test(rep);
  const bitsOk = /\$50\.00 in/.test(rep) && /70% margin/.test(rep) && /labor 20% of sales/.test(rep);

  await b.close();
  console.log('\n=== RESULTS ===');
  console.log('report leads with a plain-language verdict:', verdictOk);
  console.log('verdict fuses sales + margin + labor %:', bitsOk);
  console.log('console errors:', errors.length?errors:'NONE');
  process.exit(errors.length||!verdictOk||!bitsOk?1:0);
})().catch(e=>{ console.error('FATAL',e); process.exit(2); });
