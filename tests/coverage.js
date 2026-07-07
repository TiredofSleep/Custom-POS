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
  const cell = (rowIdx, dayIdx) => p.locator('table tr').nth(rowIdx).locator('button').nth(dayIdx);

  await p.getByRole('button',{name:/^Schedule/}).first().click();

  // give Alex a Monday shift, then offer it for coverage
  await cell(1, 0).click();
  await p.locator('#shiftStart').fill('09:00'); await p.locator('#shiftEnd').fill('17:00');
  await p.getByRole('button',{name:/Save shift/}).click();
  await cell(1, 0).click();
  await p.getByRole('button',{name:/Offer for coverage/}).click();

  // the cell now shows the coverage marker ↔
  const offered = await T();
  const offeredOk = /↔/.test(offered);

  // reopen the offered cell -> reassign to Sam
  await cell(1, 0).click();
  const editor = await T();
  const reassignShown = /Needs coverage/.test(editor) && /Sam/.test(editor);
  await p.locator('.card .opts').getByRole('button',{name:/^Sam/}).click();

  // Alex's Monday is now empty; Sam's Monday holds 09:00–17:00
  const alexMon = await cell(1,0).innerText();
  const samMon  = await cell(2,0).innerText();
  const movedOk = /\+/.test(alexMon) && /09:00–17:00/.test(samMon);

  await b.close();
  console.log('\n=== RESULTS ===');
  console.log('offering a shift marks it for coverage (↔):', offeredOk);
  console.log('an offered shift can be reassigned to a co-worker:', reassignShown);
  console.log('reassignment moves the shift (Alex→Sam):', movedOk);
  console.log('console errors:', errors.length?errors:'NONE');
  process.exit(errors.length||!offeredOk||!reassignShown||!movedOk?1:0);
})().catch(e=>{ console.error('FATAL',e); process.exit(2); });
