const { chromium } = require('playwright-core');
const url = ('file://' + require('path').resolve(__dirname, '..', 'pos.html'));
const EXE = process.env.CHROMIUM_EXE || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const FLOW = {
  flowId:"biz", label:"Account Co", topology:"linear",
  branding:{ name:"Account Co", brandColor:"#555" },
  endpoints:{ customer:{persist:true}, payment:{tenders:["cash","account"], closeGate:"balanceLE0" } },
  catalog:[ {id:"p", name:"Plate", price:40, category:"service", path:[] } ],
  stations:[
    {id:"reg",    type:"central", label:"Register", view:{money:true} },
    {id:"office", type:"report",  label:"Office",   view:{money:true} }
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
  const changeTo = async n => { await p.getByText('change station').click(); await p.getByRole('button',{name:n}).first().click(); };

  await p.getByRole('button',{name:/^Register/}).first().click();
  await p.locator('#custPhone').fill('5551234');
  await p.locator('#custName').fill('Dana');
  await p.getByRole('button',{name:/Look up \/ attach/}).click();
  await p.getByText('Plate',{exact:false}).first().click();
  await p.getByRole('button',{name:/Send order/}).click();
  // put it on the house account
  await p.getByRole('button',{name:/Charge to account \$40\.00/}).click();
  const paid = /Done — close/.test(await T());

  // Office: A/R separated from collected, and the customer owes $40
  await changeTo(/^Office/);
  const rep = await T();
  const arOk = /Total collected\s*\$0\.00/.test(rep) && /On account \(A\/R\)\s*\$40\.00/.test(rep)
    && /House accounts/.test(rep) && /\$40\.00 owed/.test(rep) && /Dana/.test(rep);

  // record a $25 payment -> $15 still owed
  await p.locator('input.arpay').first().fill('25');
  await p.getByRole('button',{name:/Record payment/}).first().click();
  const partial = /\$15\.00 owed/.test(await T());

  // record the rest (blank = full) -> cleared
  await p.getByRole('button',{name:/Record payment/}).first().click();
  const cleared = /No outstanding balances/.test(await T());

  await b.close();
  console.log('office:', rep.replace(/\n+/g,' | '));
  console.log('\n=== RESULTS ===');
  console.log('charge-to-account settles the order (Done — close):', paid);
  console.log('report splits A/R from collected + lists who owes:', arOk);
  console.log('recording a partial payment reduces the balance ($15):', partial);
  console.log('recording the rest clears the account:', cleared);
  console.log('console errors:', errors.length?errors:'NONE');
  process.exit(errors.length||!paid||!arOk||!partial||!cleared?1:0);
})().catch(e=>{ console.error('FATAL',e); process.exit(2); });
