// Stage D3 (render every screen against REAL, seeded data): the gate that catches "passes every other gate and
// still dies on the real data." Per-feature tests render one screen against the data that feature makes; this
// seeds ONE rich shop — a paid order with a customer, tenders and change; a live order; a booking; a route stop;
// a punched-in clock; an account customer with a balance — then draws EVERY station type and asserts not one of
// them throws. A record shaped like a real one that a renderer can't handle shows up HERE, where a synthetic
// empty-DB render was green.
const { chromium } = require('playwright-core');
const path = require('path');
const url = 'file://' + path.resolve(__dirname, '..', 'pos.html');
const EXE = process.env.CHROMIUM_EXE || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const FLOW = {
  flowId:'live', label:'Live', topology:'linear',
  branding:{ name:'Ozark-shaped Cleaner', brandColor:'#1f6feb' },
  endpoints:{ customer:{persist:true, account:true}, payment:{ tenders:['cash','card'], closeGate:'balanceLE0' }, notify:{ template:'ready' } },
  staff:[ {id:'e1', name:'Alex', pin:'1', phone:'5551111'} ],
  catalog:[ {id:'p', name:'Press Shirt', price:4.5, category:'service', path:['clean'], cost:1 },
            {id:'d', name:'Dry Clean', price:9, category:'service', path:['clean'], cost:2 } ],
  stations:[
    {id:'counter', type:'central',   label:'Front Counter', view:{money:true}},
    {id:'detail',  type:'detail',    label:'Detail',        view:{money:true}},
    {id:'press',   type:'production', label:'Press',         view:{money:false}},
    {id:'board',   type:'board',     label:'Job Board',     view:{money:false}},
    {id:'track',   type:'tracker',   label:'Tracker',       view:{money:false, external:true}},
    {id:'route',   type:'route',     label:'Route',         view:{money:false}},
    {id:'clock',   type:'timeclock', label:'Time Clock',    view:{}},
    {id:'book',    type:'booking',   label:'Appointments',  view:{}},
    {id:'office',  type:'report',    label:'Office',        view:{money:true}},
  ],
};

let ok = true;
function assert(name, cond){ console.log((cond?'✓':'✗')+' '+name); if(!cond) ok=false; }

(async () => {
  const errors = [];
  const b = await chromium.launch({ executablePath: EXE, args:['--no-sandbox'] });
  const p = await (await b.newContext()).newPage();
  p.on('console', m => { if (m.type()==='error') errors.push(m.text()); });
  p.on('pageerror', e => errors.push('pageerror: '+e.message));
  await p.addInitScript(f => { window.CUSTOMPOS_FLOW = f; }, FLOW);
  await p.goto(url);

  // --- generate REAL data by driving the UI (valid by construction) ---
  await p.getByRole('button',{name:/^Front Counter/}).first().click();
  await p.getByText('Press Shirt',{exact:false}).first().click();
  await p.getByText('Dry Clean',{exact:false}).first().click();
  await p.getByRole('button',{name:/Send order/}).click();
  await p.waitForTimeout(150);
  // a second order, paid in cash with change, so the report/receipt run against real tenders
  await p.getByText('Press Shirt',{exact:false}).first().click();
  await p.getByRole('button',{name:/Send order/}).click();
  await p.waitForTimeout(150);

  // augment with the other real shapes the engine itself creates, plus an account customer with a balance
  await p.evaluate(() => {
    const d = loadDB();
    (d.records||[]).forEach((r,i) => { if(i===0){ r.status='PAID'; r.tenders=[{type:'cash',amount:13.5,tendered:20,change:6.5}]; r.customer={name:'Jane Doe',phone:'5559999'}; r.ts=Date.now(); r.createdAt='09:00'; } });
    d.bookings = [{ id:'B1', name:'Pat', service:'Dry Clean', time:'10:00', staff:'e1', status:'BOOKED' }];
    d.stops = [{ id:'S1', phone:'5558888', name:'Sam', address:'1 Main St', day:'Mon', kind:'both', status:'OPEN' }];
    d.punches = [{ id:'P1', staffId:'e1', name:'Alex', inTs:Date.now()-3600000 }];
    d.customers = [{ phone:'5557777', name:'Account Co', isAccount:true, balance:42.5 }];
    saveDB(d);
  });

  // --- render EVERY station and catch any throw per screen ---
  const perStation = await p.evaluate((ids) => {
    const out = [];
    for (const id of ids){
      try { localStorage.setItem(skey(), id); DB = loadDB(); render(); out.push({ id, ok:true }); }
      catch(e){ out.push({ id, ok:false, err: (e && e.message) || String(e) }); }
    }
    return out;
  }, FLOW.stations.map(s=>s.id));

  // also page the report back a day (history path) and to a customer-facing tracker lookup, real code paths
  const reportHistory = await p.evaluate(() => { try { localStorage.setItem(skey(),'office'); reportDay='2000-01-01'; DB=loadDB(); render(); reportDay=null; return true; } catch(e){ return 'ERR:'+e.message; } });
  const crashes = await p.evaluate(() => (typeof CRASH!=='undefined' ? CRASH.queue().map(c=>c.message) : []));

  await b.close();

  const failed = perStation.filter(s => !s.ok);
  console.log('\nrendered:', perStation.map(s=>s.id+(s.ok?'✓':'✗')).join(' '));
  if (failed.length) console.log('render failures:', JSON.stringify(failed, null, 2));
  console.log('\n=== RESULTS ===');
  assert('every station type renders against real data without throwing', failed.length === 0);
  assert('the report history path renders too', reportHistory === true);
  assert('the crash reporter captured nothing during the sweep', Array.isArray(crashes) && crashes.length === 0);
  assert('no console or page errors across all screens', errors.length === 0);
  if (errors.length) console.log('errors:', errors);
  if (Array.isArray(crashes) && crashes.length) console.log('crashes:', crashes);
  console.log('\n'+(ok?'ALL PASS':'FAIL'));
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
