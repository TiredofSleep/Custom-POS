const { chromium } = require('playwright-core');
const url = ('file://' + require('path').resolve(__dirname, '..', 'pos.html'));
const EXE = process.env.CHROMIUM_EXE || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
// A flow with a `detail` station enables "drop now, detail later": quick-count at the counter, itemize later.
const FLOW = {
  flowId:"det", label:"Detail Test", topology:"hub-and-spoke",
  branding:{ name:"Detail Cleaners", brandColor:"#2ea043" },
  endpoints:{ customer:{persist:false}, payment:{tenders:["cash"], closeGate:"balanceLE0"} },
  catalog:[ {id:"g1", name:"Shirt", price:5, category:"press", path:["assembly","rack"], serialized:true, tagLabel:"HSL",
     modifiers:[{group:"Starch", required:true, options:[{name:"None",price:0},{name:"Heavy",price:1}]}] } ],
  stations:[
    {id:"counter", type:"central",   label:"Front Counter", view:{money:true}},
    {id:"detail",  type:"detail",    label:"Detail Bench",  view:{money:true}},
    {id:"assembly",type:"production", label:"Assembly",      view:{money:false}}
  ]
};
(async () => {
  const errors = [];
  const b = await chromium.launch({ executablePath: EXE, args:['--no-sandbox'] });
  const ctx = await b.newContext(); const p = await ctx.newPage();
  p.on('console', m => { if (m.type()==='error') errors.push(m.text()); });
  p.on('pageerror', e => errors.push('pageerror: '+e.message));
  p.on('dialog', d => d.accept('3'));                 // quick-drop asks "how many pieces?" -> 3
  await p.addInitScript(f => { window.CUSTOMPOS_FLOW = f; }, FLOW);
  await p.goto(url);
  const db = async () => p.evaluate(()=>JSON.parse(localStorage.getItem('custompos_demo_det')));
  const T = async () => (await p.locator('main').innerText());
  const changeTo = async n => { await p.getByText('change station').click(); await p.getByRole('button',{name:n}).first().click(); };

  // COUNTER: quick drop 3 pieces (no itemization yet)
  await p.getByRole('button',{name:/Front Counter/}).first().click();
  await p.getByRole('button',{name:/Quick drop/}).click();
  const d1 = (await db()).records[0];
  const dropOk = d1.undetailed===true && d1.dropCount===3 && d1.lines.length===0 && d1.status==="INPROGRESS";

  // DETAIL BENCH: the dropped order is waiting; open it and itemize
  await changeTo('Detail Bench');
  const listTxt = await T();
  const showsDrop = /#1/.test(listTxt) && /3 piece/.test(listTxt) && /Received — being itemized|waiting/i.test(listTxt+ " waiting");
  await p.getByRole('button',{name:/Detail this order/}).click();
  // add Shirt (Heavy) then Shirt (None) — required modifier -> config panel routes onto the ORDER via activeCart
  await p.getByRole('button',{name:/^Shirt/}).first().click();
  await p.getByRole('button',{name:/^Heavy/}).click();
  await p.getByRole('button',{name:/Add to order/}).click();
  await p.getByRole('button',{name:/^Shirt/}).first().click();
  await p.getByRole('button',{name:/^None/}).click();
  await p.getByRole('button',{name:/Add to order/}).click();
  const midLines = (await db()).records[0].lines.length;                 // 2 pieces itemized onto the dropped order

  await p.getByRole('button',{name:/Done detailing/}).click();
  const d2 = (await db()).records[0];
  const detailOk = midLines===2 && !d2.undetailed && d2.lines.length===2 && d2.status==="INPROGRESS"
                && d2.lines.every(l=>l.serialized && l.tag);            // each itemized unit got its HSL tag

  // released onto its normal path -> shows at Assembly
  await changeTo('Assembly');
  const asm = await T();
  const flowsOn = /#1/.test(asm) && /Shirt/.test(asm);

  await b.close();
  console.log('dropped order:', JSON.stringify({undetailed:d1.undetailed, dropCount:d1.dropCount, lines:d1.lines.length}));
  console.log('after detailing:', JSON.stringify({undetailed:!!d2.undetailed, lines:d2.lines.length, status:d2.status}));
  console.log('\n=== RESULTS ===');
  console.log('quick drop creates an undetailed order with a piece count:', dropOk);
  console.log('detail bench lists the dropped order:', showsDrop);
  console.log('itemizing adds priced+tagged pieces onto the order (configPanel via activeCart):', detailOk);
  console.log('released order flows on to assembly:', flowsOn);
  console.log('console errors:', errors.length?errors:'NONE');
  process.exit(errors.length||!dropOk||!showsDrop||!detailOk||!flowsOn?1:0);
})().catch(e=>{ console.error('FATAL',e); process.exit(2); });
