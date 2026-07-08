const { chromium } = require('playwright-core');
const url = ('file://' + require('path').resolve(__dirname, '..', 'pos.html'));
const EXE = process.env.CHROMIUM_EXE || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const FLOW = {
  flowId:"salon", label:"Portal Salon", topology:"linear",
  branding:{ name:"Portal Salon", brandColor:"#555" },
  endpoints:{ customer:{persist:false}, payment:{tenders:["cash"], closeGate:"balanceLE0" }, notify:{ template:"ready" } },
  staff:[ {id:"e1", name:"Alex", pin:"1234", wage:20}, {id:"e2", name:"Sam", pin:"5678", wage:18} ],
  catalog:[ {id:"c", name:"Cut", price:30, category:"service", path:[] } ],
  stations:[ {id:"me", type:"worker", label:"My Portal", view:{} }, {id:"sched", type:"schedule", label:"Schedule", view:{} } ]
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
  const schedCell = (rowIdx, dayIdx) => p.locator('table tr').nth(rowIdx).locator('button').nth(dayIdx);

  // module registry names the Worker portal
  const moduleOk = /Worker portal/.test(await T());

  // set up (via the manager's Schedule station): give Sam a Monday shift and offer it for coverage
  await p.getByRole('button',{name:/^Schedule/}).first().click();
  await schedCell(2, 0).click();                                  // row 2 = Sam, day 0 = Mon
  await p.locator('#shiftStart').fill('09:00'); await p.locator('#shiftEnd').fill('17:00');
  await p.getByRole('button',{name:/Save shift/}).click();
  await schedCell(2, 0).click();
  await p.getByRole('button',{name:/Offer for coverage/}).click();

  // switch to the Worker portal and log in as Alex
  await p.locator('#changeStation').click();
  await p.getByRole('button',{name:/^My Portal/}).first().click();
  await enterPin('1234');
  const dash = await T();
  const dashOk = /Hi Alex/.test(dash) && /this week/.test(dash) && /My week/.test(dash) && /Open shifts/.test(dash) && /Sam's shift/.test(dash);

  // Alex claims Sam's open Monday shift (self-serve pickup — the marketplace half)
  await p.getByRole('button',{name:'Claim',exact:true}).click();
  const claimed = await T();
  const claimedOk = /Mon[\s\S]{0,30}09:00–17:00/.test(claimed) && /No shifts are up for coverage/.test(claimed);

  // Alex requests Wednesday off from the portal (row of day buttons under "Request a day off")
  await p.locator('.card', { hasText:'Request a day off' }).getByRole('button',{name:/^Wed/}).click();
  const afterReq = await T();
  const reqOk = /Wed …/.test(afterReq) || /off requested/.test(afterReq);

  // log out returns to the PIN gate
  await p.getByRole('button',{name:/Log out/}).click();
  const loggedOut = /Enter your PIN/.test(await T());

  await b.close();
  console.log('\n=== RESULTS ===');
  console.log('worker station enables the Worker portal module:', moduleOk);
  console.log('PIN login shows the personal dashboard + open shift:', dashOk);
  console.log('worker self-claims an open shift (marketplace half):', claimedOk);
  console.log('worker requests a day off from the portal:', reqOk);
  console.log('log out returns to the PIN gate:', loggedOut);
  console.log('console errors:', errors.length?errors:'NONE');
  process.exit(errors.length||!moduleOk||!dashOk||!claimedOk||!reqOk||!loggedOut?1:0);
})().catch(e=>{ console.error('FATAL',e); process.exit(2); });
