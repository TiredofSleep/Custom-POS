const { chromium } = require('playwright-core');
const url = ('file://' + require('path').resolve(__dirname, '..', 'pos.html'));
const EXE = process.env.CHROMIUM_EXE || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const FLOW = {
  flowId:"clockshop", label:"Clock Shop", topology:"linear",
  branding:{ name:"Clock Shop", brandColor:"#555" },
  endpoints:{ customer:{persist:false}, payment:{tenders:["cash"], closeGate:"balanceLE0" } },
  staff:[ {id:"e1", name:"Alex", pin:"1234"}, {id:"e2", name:"Sam", pin:"5678"} ],
  welcome:{ message:"Smile — we're the friendliest shop in town.", specials:["Half-price muffins","Free refills till noon"] },
  catalog:[ {id:"c", name:"Coffee", price:3, category:"drink", path:[] } ],
  stations:[
    {id:"reg",   type:"central",   label:"Register",   view:{money:true} },
    {id:"clock", type:"timeclock", label:"Time Clock", view:{} }
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

  // module registry (on the setup/picker screen): the timeclock station lights up the Time clock module
  const setup = await T();
  const moduleOk = /Time clock/.test(setup);

  // bind the Time Clock, punch Alex in with PIN 1234
  await p.getByRole('button',{name:/^Time Clock/}).first().click();
  await enterPin('1234');
  const welcome = await T();
  const welcomeOk = /Welcome, Alex/i.test(welcome) && /friendliest shop/i.test(welcome)
    && /Today's specials/i.test(welcome) && /Half-price muffins/i.test(welcome);

  await p.getByRole('button',{name:/Start shift/}).click();
  const onClock = await T();
  const onClockOk = /On the clock/.test(onClock) && /Alex/.test(onClock) && !/Nobody clocked in/.test(onClock);

  // wrong PIN -> not recognized, buffer clears, no crash
  await enterPin('9999');
  const stillClock = /Enter your PIN/.test(await T());

  // Alex punches out -> goodbye, then On the clock empties
  await enterPin('1234');
  const bye = await T();
  const byeOk = /Thanks, Alex/i.test(bye) && /Clocked out/i.test(bye);
  await p.getByRole('button',{name:/^Done/}).click();
  const empty = /Nobody clocked in/.test(await T());

  await b.close();
  console.log('welcome screen:', welcome.replace(/\n+/g,' | '));
  console.log('\n=== RESULTS ===');
  console.log('timeclock station enables the Time clock module:', moduleOk);
  console.log('PIN clock-in shows welcome + message + specials:', welcomeOk);
  console.log('after start shift, staff shows On the clock:', onClockOk);
  console.log('wrong PIN rejected, pad still shown (no crash):', stillClock);
  console.log('PIN again clocks out with a goodbye:', byeOk);
  console.log('after clock-out, nobody on the clock:', empty);
  console.log('console errors:', errors.length?errors:'NONE');
  process.exit(errors.length||!moduleOk||!welcomeOk||!onClockOk||!stillClock||!byeOk||!empty?1:0);
})().catch(e=>{ console.error('FATAL',e); process.exit(2); });
