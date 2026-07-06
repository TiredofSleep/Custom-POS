const { chromium } = require('playwright-core');
const url = 'file:///workspace/custom-pos/pos.html';
const EXE = process.env.CHROMIUM_EXE || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const FLOW = {
  flowId:"est", label:"Estimate Co", topology:"linear",
  branding:{ name:"Estimate Co", brandColor:"#555" },
  endpoints:{ customer:{persist:false}, payment:{tenders:["cash"], closeGate:"balanceLE0" }, quotes:true },
  catalog:[ {id:"j", name:"Big Job", price:250, category:"service", path:[] } ],
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
  // build a draft and save it as a quote (no payment)
  await p.getByText('Big Job',{exact:false}).first().click();
  await p.getByRole('button',{name:/Save as quote/}).click();
  const saved = await T();
  const savedOk = /Saved quotes/.test(saved) && /Quote #1/.test(saved) && /\$250\.00/.test(saved) && !/1× Big Job/.test(saved.split('Saved quotes')[0]);   // draft cleared

  // load it back into the order, then ring it up
  await p.getByRole('button',{name:/^Load/}).click();
  const loaded = await T();
  const loadedOk = /1× Big Job/.test(loaded) && !/Saved quotes/.test(loaded);   // quote consumed

  await p.getByRole('button',{name:/Send order/}).click();
  await p.getByRole('button',{name:/Take payment \$250\.00/}).click();
  const paidOk = /Done — close/.test(await T());

  await b.close();
  console.log('saved:', saved.replace(/\n+/g,' | '));
  console.log('\n=== RESULTS ===');
  console.log('save-as-quote stores the draft + clears the order:', savedOk);
  console.log('loading a quote restores it into the order (and consumes it):', loadedOk);
  console.log('a loaded quote rings up like any order:', paidOk);
  console.log('console errors:', errors.length?errors:'NONE');
  process.exit(errors.length||!savedOk||!loadedOk||!paidOk?1:0);
})().catch(e=>{ console.error('FATAL',e); process.exit(2); });
