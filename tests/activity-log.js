const { chromium } = require('playwright-core');
const url = ('file://' + require('path').resolve(__dirname, '..', 'pos.html'));
const EXE = process.env.CHROMIUM_EXE || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
// A shop that wants a paper trail: the report station carries an Activity Log of every meaningful action.
const FLOW = {
  flowId:"audit", label:"Audit Shop", topology:"linear",
  branding:{ name:"Audit Shop", brandColor:"#555" },
  endpoints:{ customer:{persist:false}, payment:{tenders:["cash","card"], closeGate:"balanceLE0" } },
  catalog:[ {id:"x", name:"Widget", price:10, category:"goods", path:[] } ],
  stations:[ {id:"reg", type:"central", label:"Register", view:{money:true} },
             {id:"office", type:"report", label:"Office", view:{money:true} } ]
};
(async () => {
  const errors = [];
  const b = await chromium.launch({ executablePath: EXE, args:['--no-sandbox'] });
  const ctx = await b.newContext(); const p = await ctx.newPage();
  p.on('console', m => { if (m.type()==='error') errors.push(m.text()); });
  p.on('pageerror', e => errors.push('pageerror: '+e.message));
  const answers = [];
  p.on('dialog', async d => { const a = answers.shift(); await d.accept(a==null?'':a); });
  await p.addInitScript(f => { window.CUSTOMPOS_FLOW = f; }, FLOW);
  await p.goto(url);
  const T = async () => (await p.locator('main').innerText());

  await p.getByRole('button',{name:/^Register/}).first().click();
  await p.getByText('Widget',{exact:false}).first().click();
  // override the line price $10 -> $8 (theft-relevant action)
  answers.push('8');
  await p.getByRole('button',{name:'✎$'}).first().click();
  await p.getByRole('button',{name:/Send order/}).click();
  await p.getByRole('button',{name:/Take payment/}).first().click();

  // over at the office, the activity log has the order, the cash payment, and the price override
  await p.evaluate(() => unbind());
  await p.getByRole('button',{name:/^Office/}).first().click();
  const office = await T();
  const hasLog = /Activity log/.test(office);
  const loggedOrder = /order.*created/i.test(office);
  const loggedCash = /cash \$8\.00/.test(office);
  const loggedOverride = /price of Widget changed \$10\.00 → \$8\.00/.test(office);

  // the "Overrides & voids" filter isolates the override and hides the cash line
  await p.getByRole('button',{name:/Overrides & voids/}).click();
  const filtered = await T();
  const filterOk = /price of Widget changed/.test(filtered) && !/cash \$8\.00/.test(filtered);

  // CSV export produces rows with the override
  const csv = await p.evaluate(() => activityCSV(new Date().toLocaleDateString('en-CA')));
  const csvOk = /time,type,detail/.test(csv) && /override/.test(csv) && /Widget/.test(csv);

  await b.close();
  console.log('\n=== RESULTS ===');
  console.log('report shows an Activity log card:', hasLog);
  console.log('order creation is logged:', loggedOrder);
  console.log('cash payment is logged ($8.00):', loggedCash);
  console.log('price override is logged ($10 → $8):', loggedOverride);
  console.log('the Overrides filter isolates overrides (hides money):', filterOk);
  console.log('activity exports to CSV with the override row:', csvOk);
  console.log('console errors:', errors.length?errors:'NONE');
  process.exit(errors.length||!hasLog||!loggedOrder||!loggedCash||!loggedOverride||!filterOk||!csvOk?1:0);
})().catch(e=>{ console.error('FATAL',e); process.exit(2); });
