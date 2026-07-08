const { chromium } = require('playwright-core');
const url = ('file://' + require('path').resolve(__dirname, '..', 'pos.html'));
const EXE = process.env.CHROMIUM_EXE || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const FLOW = {
  flowId:"salon", label:"Pay Salon", topology:"linear",
  branding:{ name:"Pay Salon", brandColor:"#555" },
  endpoints:{ customer:{persist:false}, payment:{tenders:["cash"], closeGate:"balanceLE0" } },
  staff:[ {id:"e1", name:"Alex", pin:"1111", wage:20} ],
  catalog:[ {id:"c", name:"Cut", price:30, category:"service", path:[] } ],
  stations:[ {id:"clock", type:"timeclock", label:"Time Clock", view:{} }, {id:"me", type:"worker", label:"My Portal", view:{} } ]
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

  // clock Alex in, backdate to exactly 45h worked -> 40 reg + 5 OT
  await p.getByRole('button',{name:/^Time Clock/}).first().click();
  await enterPin('1111'); await p.getByRole('button',{name:/Start shift/}).click();
  await p.evaluate(() => {
    const k = Object.keys(localStorage).find(x=>x.startsWith('custompos_demo_')) || 'custompos_demo_salon';
    const db = JSON.parse(localStorage.getItem(k));
    db.punches[0].inTs = Date.now() - 45*3600*1000;
    localStorage.setItem(k, JSON.stringify(db));
  });

  // worker portal: pay estimate = 40h×$20 ($800) + 5h×$30 ($150) = $950 gross, OT premium visible
  await goTo(/^My Portal/);
  await enterPin('1111');
  const dash = await T();
  const payCard = /My pay — estimate/.test(dash);
  const regOk = /Regular · 40\.00 h × \$20\.00[\s\S]{0,20}\$800\.00/.test(dash);
  const otOk = /Overtime · 5\.00 h × \$30\.00[\s\S]{0,30}\$150\.00/.test(dash) && /1\.5×/.test(dash);
  const grossOk = /Estimated gross[\s\S]{0,20}\$950\.00/.test(dash);

  await b.close();
  console.log('\n=== RESULTS ===');
  console.log('portal shows a pay estimate card:', payCard);
  console.log('regular pay 40h × $20 = $800:', regOk);
  console.log('overtime 5h at 1.5× ($30) = $150, premium flagged:', otOk);
  console.log('estimated gross $950:', grossOk);
  console.log('console errors:', errors.length?errors:'NONE');
  process.exit(errors.length||!payCard||!regOk||!otOk||!grossOk?1:0);
})().catch(e=>{ console.error('FATAL',e); process.exit(2); });
