const { chromium } = require('playwright-core');
const url = 'file:///workspace/custom-pos/pos.html';
const EXE = process.env.CHROMIUM_EXE || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const FLOW = {
  flowId:"diner", label:"Split Diner", topology:"linear",
  branding:{ name:"Split Diner", brandColor:"#555" },
  endpoints:{ customer:{persist:false}, payment:{tenders:["cash","card"], closeGate:"balanceLE0", split:true } },
  catalog:[ {id:"p", name:"Plate", price:30, category:"food", path:[] } ],
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
  await p.getByText('Plate',{exact:false}).first().click();
  await p.getByRole('button',{name:/Send order/}).click();

  // split 3 ways -> $10 shares
  await p.getByRole('button',{name:/^3 ways/}).click();
  const split = await T();
  const splitOk = /3 shares · \$10\.00 each · 0 of 3 paid/.test(split) && /Take share \$10\.00/.test(split);

  // take share 1 (cash) -> balance $20, 1 of 3
  await p.getByRole('button',{name:/Take share \$10\.00/}).click();
  const one = await T();
  const oneOk = /Balance\s*\$20\.00/.test(one) && /1 of 3 paid/.test(one);

  // take share 2 by card -> balance $10, 2 of 3
  await p.getByRole('button',{name:/Share by card \$10\.00/}).click();
  const two = await T();
  const twoOk = /Balance\s*\$10\.00/.test(two) && /2 of 3 paid/.test(two);

  // take final share -> paid in full, closes out
  await p.getByRole('button',{name:/Take share \$10\.00/}).click();
  const three = await T();
  const doneOk = /Done — close/.test(three);

  await b.close();
  console.log('split:', split.replace(/\n+/g,' | '));
  console.log('\n=== RESULTS ===');
  console.log('split 3 ways shows $10 shares (0 of 3):', splitOk);
  console.log('first share (cash) leaves $20, 1 of 3:', oneOk);
  console.log('second share (card) leaves $10, 2 of 3:', twoOk);
  console.log('third share clears the balance -> paid:', doneOk);
  console.log('console errors:', errors.length?errors:'NONE');
  process.exit(errors.length||!splitOk||!oneOk||!twoOk||!doneOk?1:0);
})().catch(e=>{ console.error('FATAL',e); process.exit(2); });
