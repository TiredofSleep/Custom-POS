const { chromium } = require('playwright-core');
const url = ('file://' + require('path').resolve(__dirname, '..', 'pos.html'));
const EXE = process.env.CHROMIUM_EXE || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
// A two-location business: the report rolls up by store and can scope to one.
const FLOW = {
  flowId:"chain", label:"Two Stores", topology:"linear",
  branding:{ name:"Two Stores", brandColor:"#555" },
  stores:[ {id:"a", name:"Store A"}, {id:"b", name:"Store B"} ],
  endpoints:{ customer:{persist:false}, payment:{tenders:["cash"], closeGate:"balanceLE0" } },
  catalog:[ {id:"w", name:"Widget", price:10, category:"goods", path:[] } ],
  stations:[ {id:"reg", type:"central", label:"Register", view:{money:true} },
             {id:"office", type:"report", label:"Office", view:{money:true} } ]
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
  const ring = async () => { await p.getByText('Widget',{exact:false}).first().click(); await p.getByRole('button',{name:/Send order/}).click(); await p.getByRole('button',{name:/Take payment/}).first().click(); };

  // ring one $10 sale at Store A, then two at Store B
  await p.evaluate(() => setStore('a'));
  await p.getByRole('button',{name:/^Register/}).first().click();
  await ring();
  await p.evaluate(() => setStore('b'));
  await ring(); await ring();

  // the report rolls up by store: A $10 (1 order), B $20 (2 orders), all $30 (3)
  await p.evaluate(() => unbind());
  await p.getByRole('button',{name:/^Office/}).first().click();
  const all = await T();
  const rollupOk = /By store/.test(all)
    && /🏬 Store A[\s\S]*?1 order\(s\)[\s\S]*?\$10\.00/.test(all)
    && /🏬 Store B[\s\S]*?2 order\(s\)[\s\S]*?\$20\.00/.test(all)
    && /All stores[\s\S]*?3 order\(s\)[\s\S]*?\$30\.00/.test(all);

  // scope to Store B: its net sales are $20 and the roll-up card is gone
  await p.getByRole('button',{name:/^Store B$/}).click();
  const scoped = await T();
  const scopeOk = /Net sales\s*\$20\.00/.test(scoped) && !/By store/.test(scoped);

  await b.close();
  console.log('\n=== RESULTS ===');
  console.log('report rolls up net sales + orders per store (A $10, B $20, all $30):', rollupOk);
  console.log('scoping to one store filters the whole report to it (B = $20):', scopeOk);
  console.log('console errors:', errors.length?errors:'NONE');
  process.exit(errors.length||!rollupOk||!scopeOk?1:0);
})().catch(e=>{ console.error('FATAL',e); process.exit(2); });
