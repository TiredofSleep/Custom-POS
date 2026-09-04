// The engine's sync clock must be the SAME clock the hub uses, and it must never go backward even when the
// station's wall clock does (a dead CMOS battery is a real shop scenario). Loads the app, compares its
// stampScale/stampNewer to the hub's across a battery of inputs (drift guard), and proves hlcNow() stays
// monotonic under a frozen and a backward Date.now. Part of Phase 2 Stage A (docs/PHASE-2-SUBSTRATE.md).
const { chromium } = require('playwright-core');
const path = require('path');
const url = 'file://' + path.resolve(__dirname, '..', 'pos.html');
const EXE = process.env.CHROMIUM_EXE || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const hub = require('../hub.js');
const FLOW = { flowId:'x', label:'X', topology:'linear', branding:{name:'X',brandColor:'#555'},
  endpoints:{ customer:{persist:false}, payment:{tenders:['cash'],closeGate:'balanceLE0'} },
  catalog:[{id:'w',name:'Widget',price:10,category:'goods',path:[]}],
  stations:[{id:'reg',type:'central',label:'Register',view:{money:true}}] };
(async () => {
  const errors = [];
  const b = await chromium.launch({ executablePath: EXE, args:['--no-sandbox'] });
  const p = await (await b.newContext()).newPage();
  p.on('console', m => { if (m.type()==='error') errors.push(m.text()); });
  p.on('pageerror', e => errors.push('pageerror: '+e.message));
  await p.addInitScript(f => { window.CUSTOMPOS_FLOW = f; }, FLOW);
  await p.goto(url);

  // drift guard: the engine and the hub must rank the same battery of stamp pairs identically
  const pairs = [[500,500],[1_700_000_400_000,1_700_000_000_000_000],[1_700_000_000_000_000,1_700_000_400_000],
                 [0,5],[1_700_000_000_000,1_700_000_000_000*1000+1],[9e14,9e14*1000]];
  const engine = await p.evaluate(ps => ps.map(([a,b]) => [stampScale(a), stampNewer(a,b)]), pairs);
  const hubOut = pairs.map(([a,c]) => [hub.stampScale(a), hub.stampNewer(a,c)]);
  const driftOk = JSON.stringify(engine) === JSON.stringify(hubOut);

  // the mixed-scale bug specifically: the genuinely-newer bare-ms stamp must beat the older hybrid one
  const mixedOk = await p.evaluate(() => stampNewer(1_700_000_400_000, 1_700_000_000_000_000) && !stampNewer(1_700_000_000_000_000, 1_700_000_400_000));

  // a real save stamps a hybrid-scale upd (proves saveDB switched to hlcNow) — do this on the PRISTINE clock,
  // before the overrides below pollute Date.now
  await p.getByRole('button',{name:/^Register/}).first().click();
  await p.getByText('Widget',{exact:false}).first().click();
  await p.getByRole('button',{name:/Send order/}).click();
  const updHybrid = await p.evaluate(() => { const r=(DB.records||[])[0]; return !!r && r.upd > 1e15; });

  // hlcNow stays monotonic under a FROZEN wall clock…
  const frozenOk = await p.evaluate(() => { const R=5; Date.now = () => R; const a=hlcNow(),b=hlcNow(),c=hlcNow(); return b>a && c>b; });
  // …and under a BACKWARD wall clock (each call earlier than the last)
  const backwardOk = await p.evaluate(() => { let t=1e12; Date.now = () => (t-=1000); const a=hlcNow(),b=hlcNow(),c=hlcNow(); return b>a && c>b; });

  await b.close();
  console.log('\n=== RESULTS ===');
  console.log('engine stampScale/stampNewer match the hub across the battery:', driftOk);
  console.log('the mixed-scale bug is fixed (newer bare-ms beats older hybrid):', mixedOk);
  console.log('hlcNow stays monotonic under a FROZEN wall clock:', frozenOk);
  console.log('hlcNow stays monotonic under a BACKWARD wall clock:', backwardOk);
  console.log('a save stamps a hybrid-scale upd (Date.now switch took):', updHybrid);
  console.log('console errors:', errors.length?errors:'NONE');
  process.exit(errors.length||!driftOk||!mixedOk||!frozenOk||!backwardOk||!updHybrid?1:0);
})().catch(e=>{ console.error('FATAL',e); process.exit(2); });
