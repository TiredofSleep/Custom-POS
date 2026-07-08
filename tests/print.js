const { chromium } = require('playwright-core');
const url = ('file://' + require('path').resolve(__dirname, '..', 'pos.html'));
const EXE = process.env.CHROMIUM_EXE || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
// endpoints.print turns on templated printing; a print agent hook (window.CUSTOMPOS_PRINT) captures the jobs.
const FLOW = {
  flowId:"prn", label:"Print Test", topology:"hub-and-spoke",
  branding:{ name:"Print Cleaners", brandColor:"#2ea043" },
  endpoints:{ customer:{persist:false}, payment:{tenders:["cash"], closeGate:"balanceLE0"}, print:true },
  stores:[ {id:"ark",name:"Arkadelphia",plant:true}, {id:"hs",name:"Hot Springs"} ],
  catalog:[ {id:"g1", name:"Shirt", price:5, category:"press", path:["assembly","rack"], serialized:true, tagLabel:"HSL"} ],
  stations:[
    {id:"counter", type:"central",   label:"Front Counter", view:{money:true}},
    {id:"assembly",type:"production", label:"Assembly",      view:{money:false}, bag:{max:4}}
  ]
};
(async () => {
  const errors = [];
  const b = await chromium.launch({ executablePath: EXE, args:['--no-sandbox'] });
  const ctx = await b.newContext(); const p = await ctx.newPage();
  p.on('console', m => { if (m.type()==='error') errors.push(m.text()); });
  p.on('pageerror', e => errors.push('pageerror: '+e.message));
  await p.addInitScript(() => { window.__printJobs = []; window.CUSTOMPOS_PRINT = j => window.__printJobs.push(j); });  // capture, don't print
  await p.addInitScript(f => { window.CUSTOMPOS_FLOW = f; }, FLOW);
  await p.goto(url);
  const changeTo = async n => { await p.getByText('change station').click(); await p.getByRole('button',{name:n}).first().click(); };

  // device at Hot Springs (a drop store); ring 2 serialized shirts
  await p.getByRole('button',{name:/Hot Springs/}).first().click();
  await p.getByRole('button',{name:/Front Counter/}).first().click();
  await p.getByText('Shirt',{exact:false}).first().click();
  await p.getByText('Shirt',{exact:false}).first().click();
  await p.getByRole('button',{name:/Send order/}).click();

  await changeTo('Assembly');
  await p.getByRole('button',{name:/Bag these/}).click();       // 2 pieces, max 4 -> 1 bag
  await p.getByRole('button',{name:/🖨 Ticket/}).click();
  await p.getByRole('button',{name:/🖨 Tags/}).click();          // 2 serialized units -> 2 tag jobs
  await p.getByRole('button',{name:/🖨 Bag labels/}).click();    // 1 bag -> 1 label

  const jobs = await p.evaluate(()=>window.__printJobs);
  await b.close();

  const tickets = jobs.filter(j=>j.kind==='ticket');
  const tags    = jobs.filter(j=>j.kind==='tag');
  const labels  = jobs.filter(j=>j.kind==='bagLabel');
  const ticketOk = tickets.length===1 && /Order #1/.test(tickets[0].text) && /Hot Springs/.test(tickets[0].text) && /assembled at Arkadelphia/.test(tickets[0].text);
  const tagsOk   = tags.length===2 && tags.every(t=>/HSL:/.test(t.text)) && tags.every(t=>t.storeName==='Hot Springs');
  const bagOk    = labels.length===1 && /BAG 1/.test(labels[0].text);
  // kernel invariant: every job routes by the ORDER's store (Hot Springs), never the workstation
  const routeOk  = jobs.length>0 && jobs.every(j=>j.storeName==='Hot Springs');

  console.log('job kinds:', jobs.map(j=>j.kind).join(', '));
  console.log('ticket text:', (tickets[0]||{}).text);
  console.log('\n=== RESULTS ===');
  console.log('ticket prints via the agent seam with store + assembled-at line:', ticketOk);
  console.log('a garment tag prints per serialized unit, carrying the HSL tag:', tagsOk);
  console.log('a bag label prints per bag:', bagOk);
  console.log('every print job routes by the order store, not the workstation:', routeOk);
  console.log('console errors:', errors.length?errors:'NONE');
  process.exit(errors.length||!ticketOk||!tagsOk||!bagOk||!routeOk?1:0);
})().catch(e=>{ console.error('FATAL',e); process.exit(2); });
