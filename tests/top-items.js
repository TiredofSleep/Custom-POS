const { chromium } = require('playwright-core');
const url = ('file://' + require('path').resolve(__dirname, '..', 'pos.html'));
const EXE = process.env.CHROMIUM_EXE || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const FLOW = {
  flowId:"cafe", label:"Top Cafe", topology:"linear",
  branding:{ name:"Top Cafe", brandColor:"#555" },
  endpoints:{ customer:{persist:false}, payment:{tenders:["cash"], closeGate:"balanceLE0" } },
  catalog:[
    {id:"m", name:"Muffin", price:5, cost:1, category:"food", path:[] },     // 80% margin
    {id:"c", name:"Coffee", price:20, cost:2, category:"drink", path:[] }     // 90% margin, higher revenue
  ],
  stations:[ {id:"reg", type:"central", label:"Register", view:{money:true} }, {id:"office", type:"report", label:"Office", view:{money:true} } ]
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
  const goTo = async re => { await p.locator('#changeStation').click(); await p.getByRole('button',{name:re}).first().click(); };

  // ring one order: 1 Coffee ($20) + 2 Muffins ($10) -> Coffee is the top seller by revenue
  await p.getByRole('button',{name:/^Register/}).first().click();
  await p.getByText('Coffee',{exact:false}).first().click();
  await p.getByText('Muffin',{exact:false}).first().click();
  await p.getByText('Muffin',{exact:false}).first().click();
  await p.getByRole('button',{name:/Send order/}).click();
  await p.getByRole('button',{name:/Take payment/}).first().click();

  await goTo(/^Office/);
  const rep = await T();
  const card = /Top items/.test(rep);
  const coffeeRow = /Coffee\s*×1[\s\S]{0,30}\$20\.00[\s\S]{0,15}90%/.test(rep);
  const muffinRow = /Muffin\s*×2[\s\S]{0,30}\$10\.00[\s\S]{0,15}80%/.test(rep);
  // Coffee (revenue $20) should be listed above Muffin (revenue $10)
  const order = rep.indexOf('Coffee') < rep.indexOf('Muffin');

  await b.close();
  console.log('\n=== RESULTS ===');
  console.log('report shows a Top items card:', card);
  console.log('Coffee row: ×1, $20, 90% margin:', coffeeRow);
  console.log('Muffin row: ×2, $10, 80% margin:', muffinRow);
  console.log('ranked by revenue (Coffee above Muffin):', order);
  console.log('console errors:', errors.length?errors:'NONE');
  process.exit(errors.length||!card||!coffeeRow||!muffinRow||!order?1:0);
})().catch(e=>{ console.error('FATAL',e); process.exit(2); });
