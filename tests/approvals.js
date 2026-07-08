const { chromium } = require('playwright-core');
const url = ('file://' + require('path').resolve(__dirname, '..', 'pos.html'));
const EXE = process.env.CHROMIUM_EXE || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
// endpoints.approvals + staff roles turn on the manager/owner money-gate (inert without them).
const FLOW = {
  flowId:"appr", label:"Approval Test", topology:"hub-and-spoke",
  branding:{ name:"Approval Cleaners", brandColor:"#2ea043" },
  endpoints:{ customer:{persist:false}, payment:{tenders:["cash"], closeGate:"balanceLE0"}, approvals:{refund:true} },
  staff:[ {id:"o",name:"Owner",pin:"9999",role:"owner"}, {id:"s",name:"Sam",pin:"1111",role:"staff"} ],
  catalog:[ {id:"g1", name:"Shirt", price:10, category:"press", path:[]} ],
  stations:[
    {id:"counter", type:"central", label:"Front Counter", view:{money:true}},
    {id:"office",  type:"report",  label:"Office",        view:{money:true}}
  ]
};
(async () => {
  const errors = [];
  const b = await chromium.launch({ executablePath: EXE, args:['--no-sandbox'] });
  const ctx = await b.newContext(); const p = await ctx.newPage();
  p.on('console', m => { if (m.type()==='error') errors.push(m.text()); });
  p.on('pageerror', e => errors.push('pageerror: '+e.message));
  const pins = ['1111','9999'];                          // first a staff PIN (denied), then an owner PIN (approved)
  p.on('dialog', d => d.accept(pins.shift()));
  await p.addInitScript(f => { window.CUSTOMPOS_FLOW = f; }, FLOW);
  await p.goto(url);
  const status = async () => p.evaluate(()=>JSON.parse(localStorage.getItem('custompos_demo_appr')).records[0].status);

  await p.getByRole('button',{name:/Office/}).first().click();
  // inject one PAID order, then re-render the office
  await p.evaluate(()=>{
    const d=JSON.parse(localStorage.getItem('custompos_demo_appr')||'{"records":[],"seq":0,"customers":[]}');
    d.records.push({ id:'R1', number:1, status:'PAID', createdAt:'10:00', ts:Date.now(),
      lines:[{id:'L1',name:'Shirt',price:10,qty:1,category:'press',path:[],stage:0}], tenders:[{type:'cash',amount:10}] });
    localStorage.setItem('custompos_demo_appr', JSON.stringify(d)); render();
  });

  // attempt 1 — staff PIN 1111 -> NOT authorized, order stays PAID
  await p.getByRole('button',{name:/^Refund$/}).click();
  const afterDeny = await status();
  // attempt 2 — owner PIN 9999 -> approved, order becomes REFUNDED
  await p.getByRole('button',{name:/^Refund$/}).click();
  const afterApprove = await status();
  const audit = await p.evaluate(()=>JSON.parse(localStorage.getItem('custompos_demo_appr')).approvals||[]);

  await b.close();
  const gateOk = afterDeny==='PAID' && afterApprove==='REFUNDED';
  const auditOk = audit.length===1 && audit[0].by==='Owner' && audit[0].action==='refund';

  console.log('status after staff PIN / after owner PIN:', afterDeny, '/', afterApprove);
  console.log('audit:', JSON.stringify(audit));
  console.log('\n=== RESULTS ===');
  console.log('refund is blocked without an approver PIN and allowed with one:', gateOk);
  console.log('the approval is written to the audit log (who + what):', auditOk);
  console.log('console errors:', errors.length?errors:'NONE');
  process.exit(errors.length||!gateOk||!auditOk?1:0);
})().catch(e=>{ console.error('FATAL',e); process.exit(2); });
