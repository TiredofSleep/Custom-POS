const { chromium } = require('playwright-core');
const url = ('file://' + require('path').resolve(__dirname, '..', 'pos.html'));
const EXE = process.env.CHROMIUM_EXE || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const FLOW = {
  flowId:"deli", label:"Deli", topology:"linear",
  branding:{ name:"Prime Cuts", brandColor:"#a33b3b" },
  endpoints:{ customer:{persist:false}, payment:{tenders:["cash"], closeGate:"balanceLE0" } },
  catalog:[
    {id:"ribeye", name:"Ribeye", price:15.99, category:"beef", byWeight:true, unit:"lb", path:[] },
    {id:"sub", name:"Deli Sandwich", price:8.5, category:"deli", path:[] }
  ],
  stations:[ {id:"reg", type:"central", label:"Counter", view:{money:true} } ]
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

  await p.getByRole('button',{name:/^Counter/}).first().click();

  // the tile advertises the per-unit price ("$15.99 / lb")
  const tileOk = /\$15\.99 \/ lb/.test(await T());

  // a by-weight item asks for the AMOUNT, then rings unit × amount (2.5 lb × $15.99 = $39.98)
  answers.push('2.5');
  await p.getByText('Ribeye',{exact:false}).first().click();
  const c1 = await T();
  const weighOk = /2\.5 lb × \$15\.99/.test(c1) && /\$39\.98/.test(c1);

  // a fixed-price item alongside it still rings flat
  await p.getByText('Deli Sandwich',{exact:false}).first().click();
  const flatOk = /1× Deli Sandwich/.test(await T());

  // decimal weights round to cents (0.75 lb × $15.99 = $11.99)
  answers.push('0.75');
  await p.getByText('Ribeye',{exact:false}).first().click();
  const roundOk = /0\.75 lb × \$15\.99/.test(await T()) && /\$11\.99/.test(await T());

  // a bad amount (0) is rejected — no line added
  answers.push('0');
  await p.getByText('Ribeye',{exact:false}).first().click();
  const beforeCount = (c1.match(/Ribeye/g)||[]).length;
  const rejectOk = ((await T()).match(/lb × /g)||[]).length === 2;   // still just the two good weighted lines

  await b.close();
  console.log('\n=== RESULTS ===');
  console.log('tile shows the per-unit price ($15.99 / lb):', tileOk);
  console.log('by-weight rings unit × amount (2.5 lb × $15.99 = $39.98):', weighOk);
  console.log('fixed-price item still rings flat:', flatOk);
  console.log('decimal weight rounds to cents (0.75 lb = $11.99):', roundOk);
  console.log('a zero/blank amount is rejected (no phantom line):', rejectOk);
  console.log('console errors:', errors.length?errors:'NONE');
  process.exit(errors.length||!tileOk||!weighOk||!flatOk||!roundOk||!rejectOk?1:0);
})().catch(e=>{ console.error('FATAL',e); process.exit(2); });
