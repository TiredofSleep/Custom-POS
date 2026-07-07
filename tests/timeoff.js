const { chromium } = require('playwright-core');
const url = ('file://' + require('path').resolve(__dirname, '..', 'pos.html'));
const EXE = process.env.CHROMIUM_EXE || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const FLOW = {
  flowId:"salon", label:"Sched Salon", topology:"linear",
  branding:{ name:"Sched Salon", brandColor:"#555" },
  endpoints:{ customer:{persist:false}, payment:{tenders:["cash"], closeGate:"balanceLE0" }, notify:{ template:"ready" } },
  staff:[ {id:"e1", name:"Alex", pin:"1", phone:"5551111"}, {id:"e2", name:"Sam", pin:"2", phone:"5552222"} ],
  catalog:[ {id:"c", name:"Cut", price:30, category:"service", path:[] } ],
  stations:[ {id:"sched", type:"schedule", label:"Schedule", view:{} } ]
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

  await p.getByRole('button',{name:/^Schedule/}).first().click();

  // open Alex's Wednesday cell (row 1, day index 2 -> the 3rd shift button) and request a day off
  const cell = (rowIdx, dayIdx) => p.locator('table tr').nth(rowIdx).locator('button').nth(dayIdx);
  await cell(1, 2).click();
  await p.locator('#offReason').fill('doctor');
  await p.getByRole('button',{name:/Request day off/}).click();

  // it becomes a pending request: the cell reads off?, and a manager queue shows it
  const pending = await T();
  const pendingOk = /off\?/.test(pending) && /Time-off requests/.test(pending) && /Alex · Wed — doctor/.test(pending);

  // approve from the queue -> the cell flips to OFF
  await p.locator('.card', { hasText:'Time-off requests' }).getByRole('button',{name:/^Approve$/}).click();
  const approved = await T();
  const approvedOk = /OFF/.test(approved) && !/Time-off requests/.test(approved);

  // now try to schedule Alex that same Wednesday -> blocked (worker-protective)
  await cell(1, 2).click();
  const offEditor = await T();
  const editorBlocks = /Approved day off/.test(offEditor) && /Clear the day off to schedule/.test(offEditor);

  // cancel the day off -> the cell returns to schedulable (+)
  await p.getByRole('button',{name:/Cancel day off/}).click();
  await cell(1, 2).click();
  const canSchedule = /Save shift/.test(await T());

  await b.close();
  console.log('\n=== RESULTS ===');
  console.log('a requested day off shows pending + in the manager queue:', pendingOk);
  console.log('approving flips the cell to OFF and clears the queue:', approvedOk);
  console.log('an approved day blocks scheduling (worker-protective):', editorBlocks);
  console.log('cancelling the day off makes it schedulable again:', canSchedule);
  console.log('console errors:', errors.length?errors:'NONE');
  process.exit(errors.length||!pendingOk||!approvedOk||!editorBlocks||!canSchedule?1:0);
})().catch(e=>{ console.error('FATAL',e); process.exit(2); });
