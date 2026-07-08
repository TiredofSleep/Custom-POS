const { chromium } = require('playwright-core');
const url = ('file://' + require('path').resolve(__dirname, '..', 'pos.html'));
const EXE = process.env.CHROMIUM_EXE || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const FLOW = {
  flowId:"salon", label:"Signin Salon", topology:"linear",
  branding:{ name:"Signin Salon", brandColor:"#555" },
  endpoints:{ customer:{persist:false}, payment:{tenders:["cash"], closeGate:"balanceLE0" } },
  staff:[ {id:"e1", name:"Alex", pin:"1234", wage:15} ],
  catalog:[ {id:"c", name:"Cut", price:30, category:"service", path:[] } ],
  stations:[ {id:"me", type:"worker", label:"My Portal", view:{} } ]
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
  const pinOnly = async pin => { for(const d of pin.split('')) await digit(d); };

  // bind the portal, log in with "keep me signed in" left checked (default)
  await p.getByRole('button',{name:/^My Portal/}).first().click();
  await pinOnly('1234'); await p.getByRole('button',{name:'✓',exact:true}).click();
  const loggedIn = /Hi Alex/.test(await T());

  // reload -> still signed in on this device (no PIN re-entry)
  await p.reload();
  const stillIn = /Hi Alex/.test(await T());

  // log out -> PIN gate; reload -> stays logged out (not auto-restored)
  await p.getByRole('button',{name:/Log out/}).click();
  const gate = /Enter your PIN/.test(await T());
  await p.reload();
  const stayedOut = /Enter your PIN/.test(await T());

  // log in again but UNCHECK "keep me signed in" -> reload returns to the PIN gate
  await pinOnly('1234'); await p.locator('#wkRemember').uncheck(); await p.getByRole('button',{name:'✓',exact:true}).click();
  const inAgain = /Hi Alex/.test(await T());
  await p.reload();
  const notRemembered = /Enter your PIN/.test(await T());

  await b.close();
  console.log('\n=== RESULTS ===');
  console.log('PIN login reaches the dashboard:', loggedIn);
  console.log('reload keeps the worker signed in (remember on):', stillIn);
  console.log('log out returns to the PIN gate:', gate);
  console.log('after logout, reload stays logged out:', stayedOut);
  console.log('unchecking "keep me signed in" -> reload asks for PIN again:', inAgain && notRemembered);
  console.log('console errors:', errors.length?errors:'NONE');
  process.exit(errors.length||!loggedIn||!stillIn||!gate||!stayedOut||!(inAgain&&notRemembered)?1:0);
})().catch(e=>{ console.error('FATAL',e); process.exit(2); });
