const { chromium } = require('playwright-core');
const url = ('file://' + require('path').resolve(__dirname, '..', 'pos.html'));
const EXE = process.env.CHROMIUM_EXE || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const FLOW = {
  flowId:"notify", label:"Notify Shop", topology:"linear",
  branding:{ name:"NotifyShop", brandColor:"#555" },
  endpoints:{ customer:{persist:true}, payment:{tenders:["cash"], closeGate:"balanceLE0" },
    notify:{ template:"Hi {name}, your order #{number} at {biz} is ready." } },
  catalog:[ {id:"x", name:"Thing", price:10, category:"retail", path:[] } ],
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
  // attach a customer
  await p.locator('#custPhone').fill('5551234');
  await p.locator('#custName').fill('Dana');
  await p.getByRole('button',{name:/Look up \/ attach/}).click();
  // ring an order -> READY with the customer attached
  await p.getByText('Thing',{exact:false}).first().click();
  await p.getByRole('button',{name:/Send order/}).click();
  const ready = await T();
  const hasBtn = /📱 Text ready/.test(ready);

  // text the customer -> template filled with name / number / biz
  await p.getByRole('button',{name:/📱 Text ready/}).click();
  const after = await T();
  const textedOk = /✓ Texted 5551234/.test(after) && /Hi Dana, your order #1 at NotifyShop is ready\./.test(after) && !/📱 Text ready/.test(after);

  await b.close();
  console.log('after:', after.replace(/\n+/g,' | '));
  console.log('\n=== RESULTS ===');
  console.log('ready order with a customer offers "Text ready":', hasBtn);
  console.log('sending fills the template (name/number/biz) + confirms sent:', textedOk);
  console.log('console errors:', errors.length?errors:'NONE');
  process.exit(errors.length||!hasBtn||!textedOk?1:0);
})().catch(e=>{ console.error('FATAL',e); process.exit(2); });
