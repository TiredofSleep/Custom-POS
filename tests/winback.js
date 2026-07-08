const { chromium } = require('playwright-core');
const url = ('file://' + require('path').resolve(__dirname, '..', 'pos.html'));
const EXE = process.env.CHROMIUM_EXE || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const FLOW = {
  flowId:"shop", label:"Winback Shop", topology:"linear",
  branding:{ name:"Winback Shop", brandColor:"#555" },
  endpoints:{ customer:{persist:true}, payment:{tenders:["cash"], closeGate:"balanceLE0" },
    notify:{ template:"Hi {name}, your order is ready." }, winback:{ days:30, message:"We miss you at {biz}, {name}!" } },
  catalog:[ {id:"c", name:"Coffee", price:5, category:"drink", path:[] } ],
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

  // bind Register first so the DB key exists, then seed: Rae last visited 90 days ago; Nia visited today
  await p.getByRole('button',{name:/^Register/}).first().click();
  await p.evaluate(() => {
    const k = Object.keys(localStorage).find(x=>x.startsWith('custompos_demo_')) || 'custompos_demo_shop';
    const db = JSON.parse(localStorage.getItem(k)) || {records:[],seq:0,customers:[]};
    const now = Date.now();
    db.customers = [ {phone:"5551111", name:"Rae"}, {phone:"5552222", name:"Nia"} ];
    db.records = [
      { id:"R1", number:1, status:"CLOSED", lines:[{name:"Coffee",price:5,qty:1,category:"drink"}], tenders:[{type:"cash",amount:5}], ts: now - 90*86400000, customer:{phone:"5551111",name:"Rae"} },
      { id:"R2", number:2, status:"CLOSED", lines:[{name:"Coffee",price:5,qty:1,category:"drink"}], tenders:[{type:"cash",amount:5}], ts: now, customer:{phone:"5552222",name:"Nia"} }
    ];
    db.seq = 2;
    localStorage.setItem(k, JSON.stringify(db));
  });

  // open the Office report — the win-back card lists Rae (90 days) but not Nia (seen today)
  await goTo(/^Office/);
  const rep = await T();
  const listsRae = /Win-back/.test(rep) && /Rae/.test(rep) && /90 days/.test(rep);
  const excludesNia = !/Nia/.test(rep);

  // invite Rae back -> marked invited
  await p.getByRole('button',{name:/Invite back/}).click();
  const after = await T();
  const invitedOk = /✓ invited/.test(after);

  await b.close();
  console.log('\n=== RESULTS ===');
  console.log('win-back lists a lapsed regular (Rae, 90 days):', listsRae);
  console.log('excludes a customer seen recently (Nia):', excludesNia);
  console.log('one-tap invite marks them invited:', invitedOk);
  console.log('console errors:', errors.length?errors:'NONE');
  process.exit(errors.length||!listsRae||!excludesNia||!invitedOk?1:0);
})().catch(e=>{ console.error('FATAL',e); process.exit(2); });
