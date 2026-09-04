// Stage B3 (per-collection mirror + self-heal): a station must survive a torn/corrupt localStorage write
// without opening on an EMPTY shop — the single worst failure in the Ozark history (a fresh shell that
// full-pulls looks wiped; a corrupt blob that reads as {} looks the same and is worse). Each save mirrors
// every collection under its own key; loadDB rebuilds from the mirror when the main blob is unparseable.
// Negative control is intrinsic: the old loadDB's catch returned an empty shop for a corrupt blob — the
// "loadDB heals a corrupt blob from the mirror" assertion is exactly what the pre-fix code cannot do.
const path = require('path');
const { chromium } = require('playwright-core');
const url = 'file://' + path.resolve(__dirname, '..', 'pos.html');
const EXE = process.env.CHROMIUM_EXE || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const FLOW = { flowId:'demo', label:'Counter', topology:'linear', branding:{name:'Café',brandColor:'#555'},
  endpoints:{ customer:{persist:false}, payment:{tenders:['cash'],closeGate:'balanceLE0'} },
  catalog:[{id:'c',name:'Coffee',price:3,category:'goods',path:[]}],
  stations:[{id:'reg',type:'central',label:'Order Counter',view:{money:true}}] };

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

  // ring an order so there's a shop to persist
  await p.getByRole('button',{name:/^Order Counter/}).first().click();
  await p.getByText('Coffee',{exact:false}).first().click();
  await p.getByRole('button',{name:/Send order/}).click();
  await p.waitForTimeout(200);

  const DK = await p.evaluate(() => dkey());

  // (1) the mirror exists and matches the live records
  const mirrorMatches = await p.evaluate(() => {
    const m = JSON.parse(localStorage.getItem(mirrorPrefix()+'records'));
    return Array.isArray(m) && m.length === (DB.records||[]).length && m[0].id === DB.records[0].id;
  });

  // (2) containment: editing ONE collection leaves another collection's mirror key byte-identical
  const punchesBefore = await p.evaluate(() => localStorage.getItem(mirrorPrefix()+'punches'));
  const recBefore     = await p.evaluate(() => localStorage.getItem(mirrorPrefix()+'records'));
  await p.getByText('Coffee',{exact:false}).first().click();
  await p.getByRole('button',{name:/Send order/}).click();
  await p.waitForTimeout(200);
  const punchesAfter = await p.evaluate(() => localStorage.getItem(mirrorPrefix()+'punches'));
  const recAfter     = await p.evaluate(() => localStorage.getItem(mirrorPrefix()+'records'));
  const contained = (punchesAfter === punchesBefore) && (recAfter !== recBefore);

  // (3) SELF-HEAL: corrupt the main blob, then loadDB must rebuild the shop from the mirror (not empty)
  const healed = await p.evaluate(() => {
    localStorage.setItem(dkey(), '{ this is not valid json');
    const d = loadDB();
    return Array.isArray(d.records) && d.records.length === 2;   // both orders recovered from the mirror
  });

  // (4) a mirror corruption is harmless while the blob is good, and the next save re-writes it valid
  const mirrorCorruptSafe = await p.evaluate(() => {
    // restore a good blob first (persist re-writes both), then corrupt only the records mirror
    persistDB(loadDB());
    localStorage.setItem(mirrorPrefix()+'records', '{bad');
    const d = loadDB();                         // blob is good -> read ignores the broken mirror
    const readOk = Array.isArray(d.records) && d.records.length === 2;
    persistDB(d);                               // save self-heals the mirror
    let reparsed = false; try { JSON.parse(localStorage.getItem(mirrorPrefix()+'records')); reparsed = true; } catch(e){}
    return readOk && reparsed;
  });

  await b.close();
  console.log('\nDKEY:', DK);
  console.log('\n=== RESULTS ===');
  assert('a save mirrors records under its own key, matching the live DB', mirrorMatches);
  assert('editing one collection leaves an unrelated collection\'s mirror untouched', contained);
  assert('loadDB HEALS a corrupt main blob from the mirror (never an empty shop)', healed);
  assert('a corrupt mirror is harmless while the blob is good, and a save re-heals it', mirrorCorruptSafe);
  assert('no console errors', errors.length === 0);
  if (errors.length) console.log('errors:', errors);
  console.log('\n'+(ok?'ALL PASS':'FAIL'));
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
