const { chromium } = require('playwright-core');
const fs = require('fs'), path = require('path');
const url = 'file:///workspace/custom-pos/pos.html';
const EXE = process.env.CHROMIUM_EXE || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const TMP = process.env.SCRATCH || '/tmp';
const FLOW = {
  flowId:"own", label:"Own Co", topology:"linear",
  branding:{ name:"Own Co", brandColor:"#555" },
  endpoints:{ customer:{persist:true}, payment:{tenders:["cash"], closeGate:"balanceLE0" } },
  catalog:[ {id:"w", name:"Widget", price:10, category:"retail", path:[] } ],
  stations:[ {id:"office", type:"report", label:"Office", view:{money:true} } ]
};
(async () => {
  const errors = [];
  const b = await chromium.launch({ executablePath: EXE, args:['--no-sandbox'] });
  const ctx = await b.newContext({ acceptDownloads:true }); const p = await ctx.newPage();
  p.on('console', m => { if (m.type()==='error') errors.push(m.text()); });
  p.on('pageerror', e => errors.push('pageerror: '+e.message));
  p.on('dialog', d => d.accept());
  await p.addInitScript(f => { window.CUSTOMPOS_FLOW = f; }, FLOW);
  await p.goto(url);
  const T = async () => (await p.locator('main').innerText());

  await p.getByRole('button',{name:/^Office/}).first().click();
  // seed one closed sale + a customer
  await p.evaluate(() => {
    DB.records.push({ id:"R1", number:1, status:"CLOSED", ts:Date.now(), createdAt:"10:00", lines:[{name:"Widget",price:10,qty:1,category:"retail",path:[],stage:0}], tenders:[{type:"cash",amount:10}] });
    DB.customers.push({ name:"Dana", phone:"5551234", points:5 });
    DB.seq=1; saveDB(DB); render();
  });

  // ⬇ Backup (JSON) — capture the download and parse it
  const [dlB] = await Promise.all([ p.waitForEvent('download'), p.getByRole('button',{name:/Backup \(JSON\)/}).click() ]);
  const backup = JSON.parse(fs.readFileSync(await dlB.path(),'utf8'));
  const backupOk = backup.app==='customPOS' && backup.data.records.length===1 && backup.data.customers.length===1 && backup.data.records[0].number===1;

  // ⬇ Customers (CSV)
  const [dlC] = await Promise.all([ p.waitForEvent('download'), p.getByRole('button',{name:/Customers \(CSV\)/}).click() ]);
  const csv = fs.readFileSync(await dlC.path(),'utf8');
  const csvOk = /name,phone,points/.test(csv) && /Dana,5551234,5/.test(csv);

  // ⬇ Catalog (CSV)
  const [dlCat] = await Promise.all([ p.waitForEvent('download'), p.getByRole('button',{name:/Catalog \(CSV\)/}).click() ]);
  const catCsv = fs.readFileSync(await dlCat.path(),'utf8');
  const catOk = /name,price,category,barcode/.test(catCsv) && /Widget,10,retail/.test(catCsv);

  // ⬆ Import customers (CSV) — a header + a new customer merges into the book
  const custFile = path.join(TMP, 'cust-'+Date.now()+'.csv');
  fs.writeFileSync(custFile, 'name,phone,points\nEli,5559999,12');
  await p.locator('#importCustFile').setInputFiles(custFile);
  await p.waitForTimeout(150);
  const custImported = await p.evaluate(() => { const c=(loadDB().customers||[]).find(x=>x.phone==='5559999'); return !!c && c.name==='Eli' && c.points===12; });

  // ⬆ Restore — upload a 2-record backup and confirm it replaces the data
  const restoreFile = path.join(TMP, 'restore-'+Date.now()+'.json');
  const now = Date.now();
  fs.writeFileSync(restoreFile, JSON.stringify({ app:"customPOS", data:{ seq:2, customers:[], punches:[], received:{}, bookings:[], quotes:[], records:[
    { id:"X1", number:1, status:"CLOSED", ts:now, createdAt:"09:00", lines:[{name:"Widget",price:10,qty:1,category:"retail",path:[],stage:0}], tenders:[{type:"cash",amount:10}] },
    { id:"X2", number:2, status:"CLOSED", ts:now, createdAt:"09:30", lines:[{name:"Widget",price:10,qty:1,category:"retail",path:[],stage:0}], tenders:[{type:"cash",amount:10}] }
  ] } }));
  await p.locator('#restoreFile').setInputFiles(restoreFile);
  await p.waitForTimeout(200);
  const after = await T();
  const restoreOk = /Orders\s*2/.test(after) && /Total collected\s*\$20\.00/.test(after);

  await b.close();
  console.log('\n=== RESULTS ===');
  console.log('JSON backup downloads the whole DB:', backupOk);
  console.log('customers export as CSV:', csvOk);
  console.log('catalog exports as CSV:', catOk);
  console.log('customers import from CSV (merge by phone):', custImported);
  console.log('restoring a backup replaces the data (2 orders):', restoreOk);
  console.log('console errors:', errors.length?errors:'NONE');
  process.exit(errors.length||!backupOk||!csvOk||!catOk||!custImported||!restoreOk?1:0);
})().catch(e=>{ console.error('FATAL',e); process.exit(2); });
