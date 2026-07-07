const { chromium } = require('playwright-core');
const url = ('file://' + require('path').resolve(__dirname, '..', 'pos.html'));
const EXE = process.env.CHROMIUM_EXE || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
// waged staff + a short meal rule so we can prove the worker-protective reminder without waiting hours
const FLOW = {
  flowId:"breakshop", label:"Break Shop", topology:"linear",
  branding:{ name:"Break Shop", brandColor:"#555" },
  endpoints:{ customer:{persist:false}, payment:{tenders:["cash"], closeGate:"balanceLE0" } },
  staff:[ {id:"e1", name:"Alex", pin:"1234", wage:20} ],
  labor:{ mealAfterHrs:5, mealMins:30 },
  catalog:[ {id:"c", name:"Coffee", price:3, category:"drink", path:[] } ],
  stations:[ {id:"clock", type:"timeclock", label:"Time Clock", view:{} } ]
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

  await p.getByRole('button',{name:/^Time Clock/}).first().click();
  await enterPin('1234');                         // clock Alex in
  await p.getByRole('button',{name:/Start shift/}).click();

  // re-enter PIN -> on-shift action screen shows live earnings (waged) + a Start break button
  await enterPin('1234');
  const act = await T();
  const earningsShown = /Earned this shift/i.test(act) && /\$/.test(act);
  const canBreak = /Start break/i.test(act);

  // start a break -> button flips to End break; "on break" shows on the list
  await p.getByRole('button',{name:/Start break/}).click();
  const onBreak = await T();
  const breakStarted = /End break/i.test(onBreak);
  await p.getByRole('button',{name:/End break/}).click();
  const afterBreak = await T();
  const breakEnded = /Start break/i.test(afterBreak);

  // now prove the worker-protective meal reminder: backdate the punch to 6h ago and reload
  await p.evaluate(() => {
    const k = Object.keys(localStorage).find(x=>x.startsWith('custompos_demo_'));
    const db = JSON.parse(localStorage.getItem(k));
    db.punches[0].inTs = Date.now() - 6*3600*1000;   // worked ~6h, no meal taken (the short break was <60% of 30min)
    db.punches[0].breaks = [];
    localStorage.setItem(k, JSON.stringify(db));
  });
  await p.reload();
  await enterPin('1234');                           // straight to the action screen (already clocked in)
  const dueScreen = await T();
  const dueShown = /due a 30-minute meal break/i.test(dueScreen);
  const earnBig = /\$1(1|2)\d(\.\d\d)?/.test(dueScreen);  // ~6h * $20 ≈ $120

  await b.close();
  console.log('\n=== RESULTS ===');
  console.log('action screen shows real-time earnings:', earningsShown);
  console.log('worker can start a break:', canBreak);
  console.log('starting a break flips to End break:', breakStarted);
  console.log('ending a break returns to Start break:', breakEnded);
  console.log('meal-break reminder surfaced after 5h (worker-protective default):', dueShown);
  console.log('earnings reflect ~6h at $20/h:', earnBig);
  console.log('console errors:', errors.length?errors:'NONE');
  process.exit(errors.length||!earningsShown||!canBreak||!breakStarted||!breakEnded||!dueShown||!earnBig?1:0);
})().catch(e=>{ console.error('FATAL',e); process.exit(2); });
