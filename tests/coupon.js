const { chromium } = require('playwright-core');
const url = ('file://' + require('path').resolve(__dirname, '..', 'pos.html'));
const EXE = process.env.CHROMIUM_EXE || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const FLOW = {
  flowId:"coupshop", label:"Coupon Shop", topology:"linear",
  branding:{ name:"Coupon Shop", brandColor:"#555" },
  endpoints:{ customer:{persist:false}, payment:{tenders:["cash"], closeGate:"balanceLE0" }, tax:{rate:0.10},
    discounts:[ {code:"SAVE10", pct:10}, {code:"5BUCKS", amount:5} ] },
  catalog:[ {id:"w", name:"Widget", price:100, category:"retail", path:[] } ],
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

  // a bad code is rejected
  await p.locator('#couponCode').fill('NOPE');
  await p.getByRole('button',{name:/^Apply/}).click();
  const noDisc = /Balance\s*\$110\.00/.test(await T()) && !/applied/.test(await T());   // $100 + 10% tax, nothing off

  // SAVE10 -> 10% off $100 = $10, tax recomputes on $90
  await p.locator('#couponCode').fill('SAVE10');
  await p.getByRole('button',{name:/^Apply/}).click();
  const pct = await T();
  const pctOk = /✓ SAVE10 applied/.test(pct) && /Discount\s*−\$10\.00/.test(pct) && /Tax\s*\$9\.00/.test(pct) && /Balance\s*\$99\.00/.test(pct);

  // switch to 5BUCKS -> flat $5 off
  await p.locator('#couponCode').fill('5BUCKS');
  await p.getByRole('button',{name:/^Apply/}).click();
  const flat = await T();
  const flatOk = /✓ 5BUCKS applied/.test(flat) && /Discount\s*−\$5\.00/.test(flat) && /Balance\s*\$104\.50/.test(flat);   // (100-5)*1.10

  // clear removes the discount
  await p.getByRole('button',{name:/^Clear/}).click();
  const cleared = /Balance\s*\$110\.00/.test(await T()) && !/applied/.test(await T());

  await b.close();
  console.log('after SAVE10:', pct.replace(/\n+/g,' | '));
  console.log('\n=== RESULTS ===');
  console.log('unknown code is rejected (no discount):', noDisc);
  console.log('percentage coupon applies + tax recomputes:', pctOk);
  console.log('flat-amount coupon applies:', flatOk);
  console.log('clear removes the coupon:', cleared);
  console.log('console errors:', errors.length?errors:'NONE');
  process.exit(errors.length||!noDisc||!pctOk||!flatOk||!cleared?1:0);
})().catch(e=>{ console.error('FATAL',e); process.exit(2); });
