const { chromium } = require('playwright-core');
const url = ('file://' + require('path').resolve(__dirname, '..', 'pos.html'));
const EXE = process.env.CHROMIUM_EXE || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const FLOW = {
  flowId:"salon", label:"Sched Salon", topology:"linear",
  branding:{ name:"Sched Salon", brandColor:"#555" },
  endpoints:{ customer:{persist:false}, payment:{tenders:["cash"], closeGate:"balanceLE0" },
    notify:{ template:"ready" } },
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

  // module registry names Staff scheduling
  const moduleOk = /Staff scheduling/.test(await T());

  await p.getByRole('button',{name:/^Schedule/}).first().click();
  const grid = await T();
  const gridOk = /Alex/.test(grid) && /Sam/.test(grid) && /Mon/.test(grid) && /Sun/.test(grid);

  // give Alex 6 eight-hour days -> 48h -> overtime flag. Cells for row Alex are the first 7 shift buttons.
  async function setCell(dayIdx, start, end){
    // click Alex's cell for that day: within the first data row, the (dayIdx+1)-th button
    await p.locator('table tr').nth(1).locator('button').nth(dayIdx).click();
    await p.locator('#shiftStart').fill(start);
    await p.locator('#shiftEnd').fill(end);
    await p.getByRole('button',{name:/Save shift/}).click();
  }
  for (let d=0; d<6; d++) await setCell(d, '09:00', '17:00');   // 6 × 8h = 48h
  const afterShifts = await T();
  const hoursOk = /48\.0/.test(afterShifts) && /OT/.test(afterShifts);

  // publish -> stamps published + texts the staff with shifts
  await p.getByRole('button',{name:/Publish schedule/}).click();
  const published = await T();
  const publishOk = /✓ Published/.test(published) && /texted Alex/.test(published);

  // editing after publish un-publishes (no silent change)
  await setCell(6, '10:00', '14:00');
  const afterEdit = await T();
  const unpublishOk = !/✓ Published/.test(afterEdit) && /Publish schedule/.test(afterEdit);

  await b.close();
  console.log('\n=== RESULTS ===');
  console.log('schedule station enables the module:', moduleOk);
  console.log('weekly grid renders staff × days:', gridOk);
  console.log('weekly hours total + overtime flag (48h):', hoursOk);
  console.log('publish stamps + notifies staff:', publishOk);
  console.log('editing a published week un-publishes it:', unpublishOk);
  console.log('console errors:', errors.length?errors:'NONE');
  process.exit(errors.length||!moduleOk||!gridOk||!hoursOk||!publishOk||!unpublishOk?1:0);
})().catch(e=>{ console.error('FATAL',e); process.exit(2); });
