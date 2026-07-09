const { chromium } = require('playwright-core');
const url = ('file://' + require('path').resolve(__dirname, '..', 'pos.html'));
const EXE = process.env.CHROMIUM_EXE || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const FLOW = {
  flowId:"stall", label:"Flea Stall", topology:"linear",
  branding:{ name:"Flea Stall", brandColor:"#555" },
  endpoints:{ customer:{persist:false}, payment:{tenders:["cash"], closeGate:"balanceLE0" } },
  catalog:[
    {id:"w", name:"Widget", price:5, category:"goods", path:[] },
    {id:"any", name:"Anything (custom price)", price:0, category:"goods", customPrice:true, path:[] }
  ],
  stations:[ {id:"reg", type:"central", label:"Register", view:{money:true} } ]
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

  // custom-price item prompts for a price, then rings at it
  answers.push('12');
  await p.getByText('Anything',{exact:false}).first().click();
  const c1 = await T();
  const customOk = /1× Anything/.test(c1) && /\$12\.00/.test(c1);

  // + increments the quantity (ring 6 in one tap, not six taps)
  await p.getByRole('button',{name:'+',exact:true}).first().click();
  const c2 = await T();
  const qtyOk = /2× Anything/.test(c2) && /\$24\.00/.test(c2);

  // ✎$ edits the line's price (haggling / made-a-deal)
  answers.push('5');
  await p.getByRole('button',{name:'✎$'}).first().click();
  const c3 = await T();
  const priceEditOk = /2× Anything/.test(c3) && /\$10\.00/.test(c3);

  // − decrements, and again removes the line
  await p.getByRole('button',{name:'−',exact:true}).first().click();
  const decOk = /1× Anything/.test(await T());
  await p.getByRole('button',{name:'−',exact:true}).first().click();
  const removeOk = /Tap items to build/.test(await T());

  await b.close();
  console.log('\n=== RESULTS ===');
  console.log('custom-price item prompts + rings at the entered price ($12):', customOk);
  console.log('+ increments quantity (2× = $24):', qtyOk);
  console.log('✎$ edits the line price (2× $5 = $10):', priceEditOk);
  console.log('− decrements the quantity:', decOk);
  console.log('− at qty 1 removes the line:', removeOk);
  console.log('console errors:', errors.length?errors:'NONE');
  process.exit(errors.length||!customOk||!qtyOk||!priceEditOk||!decOk||!removeOk?1:0);
})().catch(e=>{ console.error('FATAL',e); process.exit(2); });
