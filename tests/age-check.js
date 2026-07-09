const { chromium } = require('playwright-core');
const url = ('file://' + require('path').resolve(__dirname, '..', 'pos.html'));
const EXE = process.env.CHROMIUM_EXE || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
// a gas-station / convenience counter: beer needs a 21+ ID check, water doesn't
const FLOW = {
  flowId:"gas", label:"Gas Stop", topology:"linear",
  branding:{ name:"Gas Stop", brandColor:"#555" },
  endpoints:{ customer:{persist:false}, payment:{tenders:["cash"], closeGate:"balanceLE0" } },
  catalog:[
    {id:"beer", name:"Beer 6-pack", price:9, category:"beer", path:[], ageRestricted:21 },
    {id:"water", name:"Water", price:2, category:"drink", path:[] }
  ],
  stations:[ {id:"reg", type:"central", label:"Register", view:{money:true} } ]
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

  await p.getByRole('button',{name:/^Register/}).first().click();

  // ring a beer -> the age gate blocks payment
  await p.getByText('Beer 6-pack',{exact:false}).first().click();
  await p.getByRole('button',{name:/Send order/}).click();
  const gated = await T();
  const blockedOk = /Age-restricted order/.test(gated) && /21\+/.test(gated) && !/Take payment/.test(gated);

  // check the ID -> payment unlocks
  await p.getByRole('button',{name:/ID checked/}).click();
  const unlocked = await T();
  const unlockedOk = /Take payment/.test(unlocked) && !/Age-restricted order/.test(unlocked);
  await p.getByRole('button',{name:/Take payment/}).first().click();
  const paidOk = /(PAID|Done — close|completed today)/.test(await T());

  // a water-only order rings straight through — no gate
  await p.getByText('Water',{exact:false}).first().click();
  await p.getByRole('button',{name:/Send order/}).click();
  const water = await T();
  const noGateOk = /Take payment/.test(water) && !/Age-restricted order/.test(water);

  await b.close();
  console.log('\n=== RESULTS ===');
  console.log('age-restricted item blocks payment until ID check:', blockedOk);
  console.log('checking the ID unlocks the tenders:', unlockedOk);
  console.log('after verify, the order can be paid:', paidOk);
  console.log('a non-restricted order has no gate:', noGateOk);
  console.log('console errors:', errors.length?errors:'NONE');
  process.exit(errors.length||!blockedOk||!unlockedOk||!paidOk||!noGateOk?1:0);
})().catch(e=>{ console.error('FATAL',e); process.exit(2); });
