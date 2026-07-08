const { chromium } = require('playwright-core');
const url = ('file://' + require('path').resolve(__dirname, '..', 'pos.html'));
const EXE = process.env.CHROMIUM_EXE || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const FLOW = {
  flowId:"salon", label:"Kudos Salon", topology:"linear",
  branding:{ name:"Kudos Salon", brandColor:"#555" },
  endpoints:{ customer:{persist:false}, payment:{tenders:["cash"], closeGate:"balanceLE0" } },
  staff:[ {id:"e1", name:"Alex", pin:"1111"}, {id:"e2", name:"Sam", pin:"2222"} ],
  catalog:[ {id:"c", name:"Cut", price:30, category:"service", path:[] } ],
  stations:[ {id:"me", type:"worker", label:"My Portal", view:{} }, {id:"clock", type:"timeclock", label:"Time Clock", view:{} } ]
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
  const pinLogin = async pin => { for(const d of pin.split('')) await digit(d); await p.getByRole('button',{name:'✓',exact:true}).click(); };
  const goTo = async re => { await p.locator('#changeStation').click(); await p.getByRole('button',{name:re}).first().click(); };

  // Alex logs into the portal and sends Sam a shout-out
  await p.getByRole('button',{name:/^My Portal/}).first().click();
  await pinLogin('1111');
  await p.locator('#kudosTo').selectOption('e2');   // to Sam
  await p.locator('#kudosNote').fill('great save on the rush');
  await p.getByRole('button',{name:/Send ⭐/}).click();
  const alexView = await T();
  const alexGaveOk = /Shout-outs/.test(alexView);   // still on Alex's portal, no crash

  // Alex logs out; Sam logs in and sees the shout-out on the portal
  await p.getByRole('button',{name:/Log out/}).click();
  await pinLogin('2222');
  const samView = await T();
  const samGotOk = /⭐/.test(samView) && /Alex/.test(samView) && /great save on the rush/.test(samView);

  // Sam clocks in at the Time Clock and is greeted with the shout-out
  await goTo(/^Time Clock/);
  await pinLogin('2222');
  const welcome = await T();
  const greetedOk = /Welcome, Sam/i.test(welcome) && /Alex/.test(welcome) && /great save on the rush/.test(welcome);

  await b.close();
  console.log('\n=== RESULTS ===');
  console.log('a worker can send a shout-out from the portal:', alexGaveOk);
  console.log('the recipient sees it on their portal:', samGotOk);
  console.log('the recipient is greeted with it at clock-in:', greetedOk);
  console.log('console errors:', errors.length?errors:'NONE');
  process.exit(errors.length||!alexGaveOk||!samGotOk||!greetedOk?1:0);
})().catch(e=>{ console.error('FATAL',e); process.exit(2); });
