const { chromium } = require('playwright-core');
const url = ('file://' + require('path').resolve(__dirname, '..', 'pos.html'));
const EXE = process.env.CHROMIUM_EXE || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const FLOW = {
  flowId:"stand", label:"Cash Stand", topology:"linear",
  branding:{ name:"Cash Stand", brandColor:"#555" },
  endpoints:{ customer:{persist:false}, payment:{tenders:["cash"], closeGate:"balanceLE0" } },
  catalog:[ {id:"t", name:"Taco", price:3.5, category:"food", path:[] } ],
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

  // ring 2 tacos = $7.00
  await p.getByRole('button',{name:/^Register/}).first().click();
  await p.getByText('Taco',{exact:false}).first().click();
  await p.getByText('Taco',{exact:false}).first().click();
  await p.getByRole('button',{name:/Send order/}).click();

  // "Make change" opens the amount-tendered pad
  await p.getByRole('button',{name:/Make change/}).click();
  const pad = await T();
  const padOk = /amount tendered/i.test(pad) && /Change due \$0\.00/.test(pad);

  // customer hands a $20 -> change due $13.00
  await p.locator('#cashRecv').fill('20');
  const withChange = await T();
  const changeOk = /Change due \$13\.00/.test(withChange);

  // take the cash -> paid
  await p.getByRole('button',{name:/✓ Take \$7\.00/}).click();
  const done = await T();
  const paidOk = /(Done — close|PAID|completed today)/.test(done);

  // the tender recorded what was handed over and the change given
  const tender = await p.evaluate(() => {
    const k = Object.keys(localStorage).find(x=>x.startsWith('custompos_demo_'));
    const db = JSON.parse(localStorage.getItem(k));
    const r = db.records[0]; const t = (r.tenders||[]).find(x=>x.type==='cash');
    return t;
  });
  const recordedOk = tender && Math.abs(tender.amount-7)<0.001 && Math.abs(tender.tendered-20)<0.001 && Math.abs(tender.change-13)<0.001;

  await b.close();
  console.log('\n=== RESULTS ===');
  console.log('cash opens an amount-tendered pad (no instant close):', padOk);
  console.log('entering $20 for a $7 sale shows change due $13.00:', changeOk);
  console.log('taking the cash completes the sale:', paidOk);
  console.log('tender records amount/tendered/change (7/20/13):', recordedOk);
  console.log('console errors:', errors.length?errors:'NONE');
  process.exit(errors.length||!padOk||!changeOk||!paidOk||!recordedOk?1:0);
})().catch(e=>{ console.error('FATAL',e); process.exit(2); });
