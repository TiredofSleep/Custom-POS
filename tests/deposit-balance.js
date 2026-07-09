const { chromium } = require('playwright-core');
const url = ('file://' + require('path').resolve(__dirname, '..', 'pos.html'));
const EXE = process.env.CHROMIUM_EXE || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
// A pre-order trade (bakery/florist): take a deposit now, collect the balance at pickup. The ready-text carries
// {balance}, and the internal board shows what's still owed on any order that took a deposit.
const FLOW = {
  flowId:"preorder", label:"Cake Shop", topology:"linear",
  branding:{ name:"Sweet Crumb", brandColor:"#c2708a" },
  endpoints:{ customer:{persist:true}, payment:{tenders:["cash"], closeGate:"balanceLE0", deposit:{pct:50} },
    notify:{ template:"Hi {name}, order #{number} at {biz} is ready! Balance due: {balance}." } },
  catalog:[ {id:"cake", name:"Custom Cake", price:100, category:"custom", path:[] } ],
  stations:[ {id:"reg", type:"central", label:"Counter", view:{money:true} },
             {id:"board", type:"board", label:"Order Board", view:{money:false} } ]
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

  await p.getByRole('button',{name:/^Counter/}).first().click();
  await p.locator('#custPhone').fill('5559999');
  await p.locator('#custName').fill('Rosa');
  await p.getByRole('button',{name:/Look up \/ attach/}).click();
  await p.getByText('Custom Cake',{exact:false}).first().click();

  // take the 50% deposit ($50 of $100), then send
  await p.getByRole('button',{name:/Take 50% deposit/}).click();
  const depOk = /✓ .*Take 50% deposit \$50\.00/.test(await T());
  await p.getByRole('button',{name:/Send order/}).click();

  // ready-text fills {balance} with the $50 still owed
  await p.getByRole('button',{name:/📱 Text ready/}).click();
  const after = await T();
  const balTokenOk = /Balance due: \$50\.00\./.test(after) && /✓ Texted 5559999/.test(after);

  // the internal Order Board shows the balance-due pill on that order
  await p.evaluate(() => unbind());                                  // back to the station picker
  await p.getByRole('button',{name:/Order Board/}).first().click();  // bind the board
  const board = await p.locator('main').innerText();
  const boardPillOk = /💵 \$50\.00 due/.test(board);

  await b.close();
  console.log('\n=== RESULTS ===');
  console.log('50% deposit ($50 of $100) is taken at intake:', depOk);
  console.log('ready-text fills {balance} with the amount still owed ($50):', balTokenOk);
  console.log('internal board shows the balance-due pill:', boardPillOk);
  console.log('console errors:', errors.length?errors:'NONE');
  process.exit(errors.length||!depOk||!balTokenOk||!boardPillOk?1:0);
})().catch(e=>{ console.error('FATAL',e); process.exit(2); });
