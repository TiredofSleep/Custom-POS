const { chromium } = require('playwright-core');
const url = ('file://' + require('path').resolve(__dirname, '..', 'pos.html'));
const EXE = process.env.CHROMIUM_EXE || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
// A `route` station turns on the delivery-route module (inert without one); FLOW.route.days seeds day chips.
const FLOW = {
  flowId:"rt", label:"Route Test", topology:"hub-and-spoke",
  branding:{ name:"Route Cleaners", brandColor:"#2ea043" },
  endpoints:{ customer:{persist:true}, payment:{tenders:["cash"], closeGate:"balanceLE0"} },
  route:{ days:["Mon","Wed","Fri"] },
  catalog:[ {id:"g1", name:"Shirt", price:5, category:"press", path:[]} ],
  stations:[
    {id:"counter", type:"central", label:"Front Counter", view:{money:true}},
    {id:"route",   type:"route",   label:"Route",         view:{money:true}}
  ]
};
(async () => {
  const errors = [];
  const b = await chromium.launch({ executablePath: EXE, args:['--no-sandbox'] });
  const ctx = await b.newContext(); const p = await ctx.newPage();
  p.on('console', m => { if (m.type()==='error') errors.push(m.text()); });
  p.on('pageerror', e => errors.push('pageerror: '+e.message));
  await p.addInitScript(f => { window.CUSTOMPOS_FLOW = f; }, FLOW);
  await p.goto(url);
  const dbOf = async () => p.evaluate(()=>JSON.parse(localStorage.getItem('custompos_demo_rt')));

  await p.getByRole('button',{name:/^Route/}).first().click();
  // inject one READY order for Pat (something to deliver)
  await p.evaluate(()=>{
    const d=JSON.parse(localStorage.getItem('custompos_demo_rt')||'{"records":[],"seq":1,"customers":[],"stops":[]}'); d.seq=1;
    d.records.push({ id:'R1', number:1, status:'READY', createdAt:'10:00', ts:Date.now(), customer:{name:'Pat',phone:'555-1'},
      lines:[{id:'L1',name:'Shirt',price:5,qty:1,category:'press',path:[],stage:0}], tenders:[] });
    (d.customers=d.customers||[]).push({phone:'555-1',name:'Pat'});
    localStorage.setItem('custompos_demo_rt', JSON.stringify(d)); render();
  });

  // schedule a stop for Pat via the form (day/kind left default = any day, both)
  await p.getByPlaceholder('phone').fill('555-1');
  await p.getByPlaceholder('name').fill('Pat');
  await p.getByRole('button',{name:/Add stop/}).click();
  const added = (await dbOf()).stops.length===1;

  // driver works the stop: picked up (opens a drop order), then delivered (closes the ready order)
  await p.getByRole('button',{name:/Picked up/}).click();
  await p.getByRole('button',{name:/Delivered/}).click();

  const d = await dbOf();
  await b.close();
  const stop = d.stops[0];
  const pu = d.records.find(r=>r.number===stop.pickupOrder);
  const o1 = d.records.find(r=>r.number===1);
  const pickupOk   = stop.pickedUp===true && !!pu && pu.undetailed===true && pu.customer.name==='Pat' && pu.fromRoute===stop.id;
  const deliverOk  = stop.delivered===true && o1.status==='CLOSED';

  console.log('stop:', JSON.stringify({picked:stop.pickedUp, pickupOrder:stop.pickupOrder, delivered:stop.delivered}));
  console.log('\n=== RESULTS ===');
  console.log('a stop can be scheduled on the route:', added);
  console.log('"picked up" opens an undetailed drop order for the customer:', pickupOk);
  console.log('"delivered" closes the customer\'s ready order:', deliverOk);
  console.log('console errors:', errors.length?errors:'NONE');
  process.exit(errors.length||!added||!pickupOk||!deliverOk?1:0);
})().catch(e=>{ console.error('FATAL',e); process.exit(2); });
