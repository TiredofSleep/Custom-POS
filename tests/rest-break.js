const { chromium } = require('playwright-core');
const url = ('file://' + require('path').resolve(__dirname, '..', 'pos.html'));
const EXE = process.env.CHROMIUM_EXE || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
// meal rule set high so it can't fire; a rest rule at 4h with none taken should remind
const FLOW = {
  flowId:"clockshop", label:"Rest Shop", topology:"linear",
  branding:{ name:"Rest Shop", brandColor:"#555" },
  endpoints:{ customer:{persist:false}, payment:{tenders:["cash"], closeGate:"balanceLE0" } },
  labor:{ mealAfterHrs:10, mealMins:30, restEveryHrs:4, restMins:10 },
  staff:[ {id:"e1", name:"Alex", pin:"1", wage:15} ],
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
  await enterPin('1'); await p.getByRole('button',{name:/Start shift/}).click();

  // backdate to 5h worked with no breaks -> rest reminder (not a meal one, meal is set to 10h)
  await p.evaluate(() => {
    const k = Object.keys(localStorage).find(x=>x.startsWith('custompos_demo_')) || 'custompos_demo_clockshop';
    const db = JSON.parse(localStorage.getItem(k));
    db.punches[0].inTs = Date.now() - 5*3600*1000;
    db.punches[0].breaks = [];
    localStorage.setItem(k, JSON.stringify(db));
  });
  await p.reload();
  await enterPin('1');   // straight to the action screen (already clocked in)
  const act = await T();
  const restShown = /without a break — take a 10-minute breather/i.test(act);
  const notMeal = !/meal break/i.test(act);

  // taking a break clears the reminder
  await p.getByRole('button',{name:/Start break/}).click();
  await p.getByRole('button',{name:/End break/}).click();
  const after = await T();
  const cleared = !/breather/i.test(after);

  await b.close();
  console.log('\n=== RESULTS ===');
  console.log('rest-break reminder appears after 4h with no break:', restShown);
  console.log('it is a rest reminder, not a meal one:', notMeal);
  console.log('taking a break clears the reminder:', cleared);
  console.log('console errors:', errors.length?errors:'NONE');
  process.exit(errors.length||!restShown||!notMeal||!cleared?1:0);
})().catch(e=>{ console.error('FATAL',e); process.exit(2); });
