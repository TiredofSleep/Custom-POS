const { chromium } = require('playwright-core');
const url = 'file:///workspace/custom-pos/pos.html';
const EXE = process.env.CHROMIUM_EXE || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const FLOW = {
  flowId:"salon", label:"Booking Salon", topology:"linear",
  branding:{ name:"Booking Salon", brandColor:"#555" },
  endpoints:{ customer:{persist:true}, payment:{tenders:["cash","card"], closeGate:"balanceLE0" } },
  performers:["Alex","Sam"],
  catalog:[ {id:"cut", name:"Haircut", price:35, category:"service", path:[], performer:true } ],
  stations:[
    {id:"book", type:"booking", label:"Appointments", view:{} },
    {id:"desk", type:"central", label:"Front Desk",  view:{money:true} }
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
  const T = async () => (await p.locator('main').innerText());
  const changeTo = async n => { await p.getByText('change station').click(); await p.getByRole('button',{name:n}).first().click(); };

  // module registry names Appointments
  const setup = await T();
  const moduleOk = /Appointments/.test(setup);

  // book Dana for a 09:30 Haircut with Alex
  await p.getByRole('button',{name:/^Appointments/}).first().click();
  await p.locator('#bkName').fill('Dana');
  await p.locator('#bkService').selectOption('cut');
  await p.locator('#bkTime').fill('09:30');
  await p.locator('#bkStaff').selectOption('Alex');
  await p.getByRole('button',{name:/Book it/}).click();
  const sched = await T();
  const bookedOk = /09:30/.test(sched) && /Dana/.test(sched) && /Haircut/.test(sched) && /Alex/.test(sched) && /Check in/.test(sched);

  // check in -> becomes order #1
  await p.getByRole('button',{name:/Check in/}).click();
  const afterCI = await T();
  const checkedInOk = /checked in #1/.test(afterCI);

  // Front Desk checkout has the order ready, with Alex as the provider
  await changeTo(/Front Desk/);
  const desk = await T();
  const orderOk = /#1/.test(desk) && /Haircut/.test(desk) && /Take payment \$35\.00/.test(desk);

  await b.close();
  console.log('schedule:', sched.replace(/\n+/g,' | '));
  console.log('\n=== RESULTS ===');
  console.log('booking station enables the Appointments module:', moduleOk);
  console.log('books a customer + service + time + staff:', bookedOk);
  console.log('check-in converts the booking into order #1:', checkedInOk);
  console.log('the checked-in order is ready to pay at the desk:', orderOk);
  console.log('console errors:', errors.length?errors:'NONE');
  process.exit(errors.length||!moduleOk||!bookedOk||!checkedInOk||!orderOk?1:0);
})().catch(e=>{ console.error('FATAL',e); process.exit(2); });
