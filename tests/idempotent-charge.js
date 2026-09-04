// Stage E3 (idempotency on the money path): a double-tapped Pay button or a retried request must never charge
// twice. The guard asks the APPEND-ONLY tender ledger (never a boolean flag — a flag gets rolled back by a
// merge and double-charges anyway): a card tender already carrying this idempotency key means it's a retry, so
// return without charging again. Two sends with one key = one charge; the record is the source of truth.
const { chromium } = require('playwright-core');
const path = require('path');
const url = 'file://' + path.resolve(__dirname, '..', 'pos.html');
const EXE = process.env.CHROMIUM_EXE || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const FLOW = {
  flowId:'cardshop', label:'Card Shop', topology:'linear',
  branding:{ name:'Card Shop', brandColor:'#1f6feb' },
  endpoints:{ customer:{persist:false}, payment:{ tenders:['cash','card'], closeGate:'balanceLE0' } },
  catalog:[ {id:'w', name:'Widget', price:10, category:'goods', path:[]} ],
  stations:[ {id:'reg', type:'central', label:'Register', view:{money:true}} ],
};

let ok = true;
function assert(name, cond){ console.log((cond?'✓':'✗')+' '+name); if(!cond) ok=false; }

(async () => {
  const errors = [];
  const b = await chromium.launch({ executablePath: EXE, args:['--no-sandbox'] });
  const p = await (await b.newContext()).newPage();
  p.on('console', m => { if (m.type()==='error') errors.push(m.text()); });
  p.on('pageerror', e => errors.push('pageerror: '+e.message));
  await p.addInitScript(f => { window.CUSTOMPOS_FLOW = f; }, FLOW);
  await p.goto(url);

  // ring an order so there's a real record with a real balance
  await p.getByRole('button',{name:/^Register/}).first().click();
  await p.getByText('Widget',{exact:false}).first().click();
  await p.getByRole('button',{name:/Send order/}).click();
  await p.waitForTimeout(150);

  // drive the idempotency guard directly on the live record
  const res = await p.evaluate(() => {
    const r = DB.records[0];
    const a = chargeCardOnce(r, 10, 'KEY-1');            // first charge
    const b = chargeCardOnce(r, 10, 'KEY-1');            // SAME key -> retry, must not charge again
    const cardCountAfterSame = (r.tenders||[]).filter(t=>t.type==='card' && !t.refund).length;
    const c = chargeCardOnce(r, 10, 'KEY-2');            // a genuinely different charge -> allowed
    const cardCountAfterNew = (r.tenders||[]).filter(t=>t.type==='card' && !t.refund).length;
    return { aOk:a.status==='approved' && !a.dedup, bDedup:!!b.dedup, cardCountAfterSame, cardCountAfterNew,
             sameTender: a.tender && b.tender && a.tender === b.tender };
  });
  assert('the first charge is approved and records a card tender', res.aOk && res.cardCountAfterSame >= 1);
  assert('a second send with the SAME key does not charge again (one card tender)', res.bDedup && res.cardCountAfterSame === 1);
  assert('the dedup returns the SAME ledger tender (the record is the source of truth)', res.sameTender);
  assert('a genuinely different charge (new key) is still allowed', res.cardCountAfterNew === 2);

  // the UI-generated charge carries an idempotency key onto the tender (the button wires it through)
  const uiIdem = await p.evaluate(() => {
    const r = DB.records[0]; r.tenders = [];                       // clear and pay once via the same helper the button uses
    const key = r.id+':card:'+Math.round(10*100)+':'+cardTenders(r).length;
    chargeCardOnce(r, 10, key);
    const t = (r.tenders||[]).find(x=>x.type==='card');
    return t && typeof t.idem === 'string' && t.idem.length > 0;
  });
  assert('a card tender carries its idempotency key', uiIdem);

  await b.close();
  console.log('\n=== RESULTS ===');
  assert('no console or page errors', errors.length === 0);
  if (errors.length) console.log('errors:', errors);
  console.log('\n'+(ok?'ALL PASS':'FAIL'));
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
