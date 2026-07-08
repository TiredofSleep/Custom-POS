const { chromium } = require('playwright-core');
const url = ('file://' + require('path').resolve(__dirname, '..', 'pos.html'));
const EXE = process.env.CHROMIUM_EXE || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const FLOW = {
  flowId:"cafe", label:"Busy Cafe", topology:"linear",
  branding:{ name:"Busy Cafe", brandColor:"#555" },
  endpoints:{ customer:{persist:false}, payment:{tenders:["cash"], closeGate:"balanceLE0" } },
  catalog:[ {id:"c", name:"Coffee", price:10, category:"drink", path:[] } ],
  stations:[ {id:"reg", type:"central", label:"Register", view:{money:true} }, {id:"office", type:"report", label:"Office", view:{money:true} } ]
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
  const goTo = async re => { await p.locator('#changeStation').click(); await p.getByRole('button',{name:re}).first().click(); };

  // seed today's orders: one small at 9am, a bigger rush at 2pm (same day so the report picks them up)
  await p.getByRole('button',{name:/^Register/}).first().click();
  await p.evaluate(() => {
    const k = Object.keys(localStorage).find(x=>x.startsWith('custompos_demo_')) || 'custompos_demo_cafe';
    const db = JSON.parse(localStorage.getItem(k)) || {records:[],seq:0,customers:[]};
    const d9 = new Date(); d9.setHours(9,0,0,0);
    const d14 = new Date(); d14.setHours(14,0,0,0);
    db.records = [
      { id:"R1", number:1, status:"CLOSED", lines:[{name:"Coffee",price:10,qty:1,category:"drink"}], tenders:[{type:"cash",amount:10}], ts:d9.getTime() },
      { id:"R2", number:2, status:"CLOSED", lines:[{name:"Coffee",price:10,qty:3,category:"drink"}], tenders:[{type:"cash",amount:30}], ts:d14.getTime() }
    ];
    db.seq = 2;
    localStorage.setItem(k, JSON.stringify(db));
  });

  await goTo(/^Office/);
  const rep = await T();
  const card = /Busy hours/.test(rep);
  const has9 = /9a[\s\S]{0,30}\$10\.00/.test(rep);
  const has2 = /2p[\s\S]{0,30}\$30\.00/.test(rep);
  const busiest = /Busiest around 2p/.test(rep);

  await b.close();
  console.log('\n=== RESULTS ===');
  console.log('report shows a Busy hours card:', card);
  console.log('9am hour shows $10:', has9);
  console.log('2pm hour shows $30:', has2);
  console.log('busiest hour flagged (2p):', busiest);
  console.log('console errors:', errors.length?errors:'NONE');
  process.exit(errors.length||!card||!has9||!has2||!busiest?1:0);
})().catch(e=>{ console.error('FATAL',e); process.exit(2); });
