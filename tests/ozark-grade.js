const { chromium } = require('playwright-core');
const url = ('file://' + require('path').resolve(__dirname, '..', 'pos.html'));
const EXE = process.env.CHROMIUM_EXE || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
/* END-TO-END PROOF: a full plant-grade dry cleaner built from generalized config alone (the "Ozark-grade"
   template). One order flows intake(serialized HSL pieces) -> assembly(smart bag + in/out reconciliation +
   store-routed tag printing) -> rack -> READY(store-aware tracker) -> delivery route(closed). All engine
   primitives at once, 0 console errors. This is the roadmap's Stage-7 validation. */
const FLOW = {
  flowId:"ozark", label:"Full-plant cleaner", topology:"hub-and-spoke",
  branding:{ name:"My Cleaners", brandColor:"#2ea043" },
  endpoints:{ customer:{persist:true}, payment:{tenders:["cash","card","account"], closeGate:"balanceLE0", deposit:{pct:50}},
    notify:{template:"Hi {name}, your order #{number} at {biz} is ready for pickup."}, quotes:true, print:true, approvals:{refund:true} },
  timer:{ mode:"due", promiseSec:172800, warnSec:86400, label:"promise" },
  lifecycle:{ received:"Received — in line", ready:"Ready for pickup", done:"Picked up", dropped:"Received — being itemized",
    byStation:{ assembly:"In cleaning & pressing", rack:"Being racked" },
    public:{ byStation:{ assembly:"Cleaning your order", rack:"Almost ready" } } },
  stores:[ {id:"plant",name:"Main Plant",plant:true}, {id:"drop",name:"Drop Store"} ],
  route:{ days:["Mon","Wed","Fri"] },
  staff:[ {id:"own",name:"Owner",pin:"1234",role:"owner"}, {id:"prs",name:"Presser",pin:"3456",role:"staff"} ],
  catalog:[
    {id:"shirt",name:"Laundered Shirt",price:2.99,category:"laundry",path:["assembly","rack"],serialized:true,tagLabel:"HSL",
      modifiers:[{group:"Starch",required:true,options:[{name:"None",price:0},{name:"Light",price:0},{name:"Heavy",price:0.5}]}]},
    {id:"wf",name:"Wash & Fold",price:1.75,category:"wf",path:["rack"]}
  ],
  stations:[
    {id:"counter",type:"central",label:"Front Counter",view:{money:true}},
    {id:"detail",type:"detail",label:"Detail / Tag",view:{money:true}},
    {id:"assembly",type:"production",label:"Assembly",view:{money:false},bag:{max:4,solo:["household"],spread:["drycleaning"]},reconcile:true},
    {id:"rack",type:"staging",label:"Rack",view:{money:false}},
    {id:"route",type:"route",label:"Delivery Route",view:{money:true}},
    {id:"board",type:"board",label:"Status Board",view:{money:false}},
    {id:"tracker",type:"tracker",label:"Customer Tracker",view:{money:false,external:true}},
    {id:"office",type:"report",label:"Office",view:{money:true}}
  ]
};
(async () => {
  const errors = [];
  const b = await chromium.launch({ executablePath: EXE, args:['--no-sandbox'] });
  const ctx = await b.newContext(); const p = await ctx.newPage();
  p.on('console', m => { if (m.type()==='error') errors.push(m.text()); });
  p.on('pageerror', e => errors.push('pageerror: '+e.message));
  await p.addInitScript(() => { window.__printJobs=[]; window.CUSTOMPOS_PRINT = j => window.__printJobs.push(j); });
  await p.addInitScript(f => { window.CUSTOMPOS_FLOW = f; }, FLOW);
  await p.goto(url);
  const T = async () => (await p.locator('main').innerText());
  const changeTo = async n => { await p.getByText('change station').click(); await p.getByRole('button',{name:n}).first().click(); };
  const rec = async () => p.evaluate(()=>JSON.parse(localStorage.getItem('custompos_demo_ozark')).records[0]);

  // device at the Drop Store; intake 2 serialized shirts (Heavy)
  await p.getByRole('button',{name:/Drop Store/}).first().click();
  await p.getByRole('button',{name:/Front Counter/}).first().click();
  for (let i=0;i<2;i++){
    await p.getByText('Laundered Shirt').first().click();
    await p.getByRole('button',{name:/^Heavy/}).click();
    await p.getByRole('button',{name:/Add to order/}).click();
  }
  await p.evaluate(()=>attachCustomer('5559','Dana'));
  await p.getByRole('button',{name:/Send order/}).click();
  const intake = await rec();
  const serializedOk = intake.storeId==='drop' && intake.lines.length===2
    && intake.lines.every(l=>l.serialized && l.tag && l.tagLabel==='HSL')
    && intake.lines[0].tag !== intake.lines[1].tag;                       // each piece a distinct HSL unit

  // ASSEMBLY: bag -> print store-routed tags -> reconcile every piece -> advance
  await changeTo('Assembly');
  await p.getByRole('button',{name:/Bag these/}).click();
  await p.getByRole('button',{name:/🖨 Tags/}).click();
  let n = await p.getByRole('button',{name:'○'}).count();
  for (let i=0;i<n;i++) await p.getByRole('button',{name:'○'}).first().click();
  await p.getByRole('button',{name:/Mark done here/}).click();
  // RACK -> READY
  await changeTo('Rack');
  await p.getByRole('button',{name:/Mark done here/}).click();
  const bagged = await rec();
  const assemblyOk = bagged.bagsAt && bagged.bagsAt.assembly===1 && bagged.lines.every(l=>l.bag===1) && bagged.status==='READY';

  // store-aware customer tracker (sanitized) + store-routed print jobs
  await changeTo('Customer Tracker');
  const tr = await T();
  const trackerOk = /assembled at Main Plant/.test(tr) && !/\$\d/.test(tr) && /Laundered Shirt/.test(tr);
  const jobs = await p.evaluate(()=>window.__printJobs);
  const printOk = jobs.filter(j=>j.kind==='tag').length===2 && jobs.filter(j=>j.kind==='tag').every(j=>j.storeName==='Drop Store');

  // DELIVERY ROUTE: schedule the stop, deliver -> order CLOSED
  await changeTo('Delivery Route');
  await p.getByPlaceholder('phone').fill('5559');
  await p.getByPlaceholder('name').fill('Dana');
  await p.getByRole('button',{name:/Add stop/}).click();
  await p.getByRole('button',{name:/Delivered/}).click();
  const closed = (await rec()).status==='CLOSED';

  await b.close();
  console.log('intake storeId/lines/tags:', intake.storeId, intake.lines.length, intake.lines.map(l=>l.tag).join(','));
  console.log('tracker:', tr.replace(/\n+/g,' | '));
  console.log('tag print jobs -> store:', jobs.filter(j=>j.kind==='tag').map(j=>j.storeName).join(','));
  console.log('\n=== RESULTS (full Ozark-grade build from config) ===');
  console.log('serialized HSL pieces at intake, in the drop store:', serializedOk);
  console.log('smart bag (1 bag) + reconciliation gate -> READY:', assemblyOk);
  console.log('store-aware sanitized tracker (assembled at plant):', trackerOk);
  console.log('garment tags printed, routed by the order store:', printOk);
  console.log('delivery route closes the order:', closed);
  console.log('console errors:', errors.length?errors:'NONE');
  process.exit(errors.length||!serializedOk||!assemblyOk||!trackerOk||!printOk||!closed?1:0);
})().catch(e=>{ console.error('FATAL',e); process.exit(2); });
