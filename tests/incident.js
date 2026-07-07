const { chromium } = require('playwright-core');
const url = ('file://' + require('path').resolve(__dirname, '..', 'pos.html'));
const EXE = process.env.CHROMIUM_EXE || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const FLOW = {
  flowId:"safeshop", label:"Safe Shop", topology:"linear",
  branding:{ name:"Safe Shop", brandColor:"#555" },
  endpoints:{ customer:{persist:false}, payment:{tenders:["cash"], closeGate:"balanceLE0" }, notify:{ template:"ready" } },
  safety:{ alertPhone:"5559999" },
  staff:[ {id:"e1", name:"Alex", pin:"1234"} ],
  catalog:[ {id:"c", name:"Coffee", price:3, category:"drink", path:[] } ],
  stations:[
    {id:"clock", type:"timeclock", label:"Time Clock", view:{} },
    {id:"office", type:"report", label:"Office", view:{money:true} }
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

  // clock Alex in, start shift, re-enter PIN -> action screen shows the Safety section
  await p.getByRole('button',{name:/^Time Clock/}).first().click();
  await enterPin('1234');
  await p.getByRole('button',{name:/Start shift/}).click();
  await enterPin('1234');
  const act = await T();
  const safetyShown = /Safety/.test(act) && /File report/i.test(act) && /Get help now/i.test(act);

  // file a (non-urgent) injury report
  await p.locator('#incType').selectOption('Injury');
  await p.locator('#incNote').fill('slipped on wet floor');
  await p.getByRole('button',{name:/File report/}).click();
  const filed = await T();
  const filedOk = /Incident filed and logged/i.test(filed);
  await p.getByRole('button',{name:/^OK/}).click();

  // now a panic alert
  await p.getByRole('button',{name:/Get help now/}).click();
  const helped = await T();
  const helpOk = /Help is on the way/i.test(helped) && /to a manager/i.test(helped);
  await p.getByRole('button',{name:/^OK/}).click();

  // manager view: switch to the Office report via the header control
  await p.locator('#changeStation').click();
  await p.getByRole('button',{name:/^Office/}).first().click();
  const rep = await T();
  const logOk = /Safety incidents/.test(rep) && /2 open/.test(rep) && /Injury/.test(rep) && /slipped on wet floor/.test(rep) && /🆘/.test(rep);

  // acknowledge one -> open count drops
  await p.locator('.card', { hasText:'Safety incidents' }).getByRole('button',{name:/Acknowledge/}).first().click();
  const afterAck = await T();
  const ackOk = /1 open/.test(afterAck);

  await b.close();
  console.log('\n=== RESULTS ===');
  console.log('on-shift Safety section (file / get help):', safetyShown);
  console.log('filing an incident confirms + logs:', filedOk);
  console.log('panic button sends help + confirms:', helpOk);
  console.log('manager report lists incidents (2 open, urgent flagged):', logOk);
  console.log('acknowledge drops the open count:', ackOk);
  console.log('console errors:', errors.length?errors:'NONE');
  process.exit(errors.length||!safetyShown||!filedOk||!helpOk||!logOk||!ackOk?1:0);
})().catch(e=>{ console.error('FATAL',e); process.exit(2); });
