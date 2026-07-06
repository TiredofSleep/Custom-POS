const { chromium } = require('playwright-core');
const url = 'file:///workspace/custom-pos/pos.html';
const EXE = process.env.CHROMIUM_EXE || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const FLOW = {
  flowId:"mart", label:"Scan Mart", topology:"linear",
  branding:{ name:"Scan Mart", brandColor:"#555" },
  endpoints:{ customer:{persist:false}, payment:{tenders:["cash"], closeGate:"balanceLE0" }, scan:true },
  catalog:[
    {id:"a", name:"Apple",  price:1, category:"produce", barcode:"1001", path:[] },
    {id:"b", name:"Banana", price:2, category:"produce", barcode:"1002", path:[] },
    {id:"c", name:"Cola",   price:3, category:"drink",   barcode:"2001", path:[] }
  ],
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
  const hasBox = await p.locator('#catSearch').count()===1;

  // scan a barcode (type digits + Enter) -> Banana rings up
  await p.locator('#catSearch').fill('1002');
  await p.locator('#catSearch').press('Enter');
  const scanned = /1× Banana/.test(await T());

  // type a partial name + Enter -> first match (Cola) rings up
  await p.locator('#catSearch').fill('col');
  await p.locator('#catSearch').press('Enter');
  const byName = /1× Cola/.test(await T());

  // filtering hides non-matches (only Apple visible for "app")
  await p.locator('#catSearch').fill('app');
  const appleVisible = await p.getByRole('button',{name:/^Apple/}).isVisible();
  const bananaHidden = !(await p.getByRole('button',{name:/^Banana/}).isVisible());

  await b.close();
  console.log('\n=== RESULTS ===');
  console.log('search/scan box present (scan enabled):', hasBox);
  console.log('scanning a barcode rings the item (Banana):', scanned);
  console.log('typing a partial name + Enter rings first match (Cola):', byName);
  console.log('filter hides non-matches (Apple shown, Banana hidden):', appleVisible && bananaHidden);
  console.log('console errors:', errors.length?errors:'NONE');
  process.exit(errors.length||!hasBox||!scanned||!byName||!appleVisible||!bananaHidden?1:0);
})().catch(e=>{ console.error('FATAL',e); process.exit(2); });
