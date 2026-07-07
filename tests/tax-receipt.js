const { chromium } = require('playwright-core');
const url = ('file://' + require('path').resolve(__dirname, '..', 'pos.html'));
const EXE = process.env.CHROMIUM_EXE || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const FLOW = {
  flowId:"taxshop", label:"Tax Shop", topology:"linear",
  branding:{ name:"Tax Shop", brandColor:"#555" },
  endpoints:{ customer:{persist:false}, payment:{tenders:["cash"], closeGate:"balanceLE0" }, tax:{rate:0.10}, discounts:true },
  catalog:[ {id:"w", name:"Widget", price:100, category:"retail", path:[] }, {id:"g", name:"Gift card $25", price:25, category:"giftcard", path:[] } ],
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
  await p.getByText('Widget',{exact:false}).first().click();
  await p.getByRole('button',{name:/Send order/}).click();
  const beforeDisc = await T();
  const taxOk = /Tax\s*\$10\.00/.test(beforeDisc) && /Balance\s*\$110\.00/.test(beforeDisc);   // 10% of $100

  await p.getByRole('button',{name:/10% off/}).click();
  const afterDisc = await T();
  const discOk = /Discount\s*[−-]\s*\$10\.00/.test(afterDisc) && /Tax\s*\$9\.00/.test(afterDisc) && /Balance\s*\$99\.00/.test(afterDisc);  // tax on discounted base

  await p.getByRole('button',{name:/🧾 Receipt/}).click();
  const receipt = await T();
  const receiptOk = /Subtotal\s*\$100\.00/.test(receipt) && /Discount/.test(receipt) && /Tax\s*\$9\.00/.test(receipt) && /Total\s*\$99\.00/.test(receipt) && /Thank you/.test(receipt);

  await p.getByRole('button',{name:/Take payment \$99\.00/}).click();
  const paid = /Done — close/.test(await T());

  await b.close();
  console.log('after discount:', afterDisc.replace(/\n+/g,' | '));
  console.log('\n=== RESULTS ===');
  console.log('sales tax computed (10% of $100 = $10, balance $110):', taxOk);
  console.log('discount applies + tax recomputes on discounted base ($99):', discOk);
  console.log('printable receipt shows subtotal/discount/tax/total:', receiptOk);
  console.log('paid at the taxed total:', paid);
  console.log('console errors:', errors.length?errors:'NONE');
  process.exit(errors.length||!taxOk||!discOk||!receiptOk||!paid?1:0);
})().catch(e=>{ console.error('FATAL',e); process.exit(2); });
