// Stage B2 (push only what changed): a station must upload only the records it actually edited, not the whole
// shop on every save (the Ozark 229KB-per-push lesson, generalized). This watches the actual POST bodies a
// device sends: ringing the FIRST order uploads one record; a redundant save with nothing changed uploads
// NOTHING (no request at all); ringing a SECOND order uploads exactly that one record — never both.
// Negative control is intrinsic: against the old whole-DB push, the 2nd order's POST carried 2 records and
// the idle save still fired a request, so "the idle save sends nothing" and "the 2nd push carries 1" are
// claims the pre-fix code cannot satisfy.
const path = require('path'), fs = require('fs'), os = require('os');
const DATA = path.join(os.tmpdir(), 'custompos-push-test-' + process.pid + '.json');
try { fs.unlinkSync(DATA); } catch (e) {}
process.env.DATA = DATA;
const hub = require('../hub.js');
const { chromium } = require('playwright-core');
const EXE = process.env.CHROMIUM_EXE || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

let ok = true;
function assert(name, cond){ console.log((cond?'✓':'✗')+' '+name); if(!cond) ok=false; }

(async () => {
  const errors = [];
  await new Promise(r => hub.server.listen(0, '127.0.0.1', r));
  const port = hub.server.address().port;
  const base = `http://127.0.0.1:${port}`;
  const url = `${base}/pos.html?hub=${base}`;

  const b = await chromium.launch({ executablePath: EXE, args:['--no-sandbox'] });
  const A = await b.newContext(); const pa = await A.newPage();
  pa.on('console', m => { if (m.type()==='error') errors.push('A: '+m.text()); });
  pa.on('pageerror', e => errors.push('A pageerror: '+e.message));

  // record every POST /api/db body: how many records it carried
  const posts = [];
  pa.on('request', req => {
    try { if (new URL(req.url()).pathname==='/api/db' && req.method()==='POST') {
      const body = JSON.parse(req.postData()||'{}');
      posts.push({ n: (body.db && body.db.records ? body.db.records.length : 0),
                   ids: (body.db && body.db.records ? body.db.records.map(r=>r.id) : []) });
    } } catch (e) {}
  });

  await pa.goto(url);
  await pa.getByRole('button',{name:/^Order Counter/}).first().click();
  await pa.getByText('Coffee',{exact:false}).first().click();
  await pa.getByRole('button',{name:/Send order/}).click();
  await pa.waitForFunction(() => SYNC.rev > 0, { timeout: 8000 });   // first push landed + confirmed
  await pa.waitForTimeout(300);
  const afterFirst = posts.length;

  // an IDLE save — nothing changed. Must send no request at all.
  await pa.evaluate(() => SYNC.push());
  await pa.waitForTimeout(500);
  const idleSentNothing = posts.length === afterFirst;

  // ring a SECOND order
  await pa.getByText('Coffee',{exact:false}).first().click();
  await pa.getByRole('button',{name:/Send order/}).click();
  await pa.waitForTimeout(700);

  await b.close();
  await new Promise(r => hub.server.close(r));
  try { fs.unlinkSync(DATA); } catch (e) {}

  const first = posts[0];
  const second = posts[afterFirst];   // the push triggered by the 2nd order (idle sent nothing, so it's next)

  console.log('\nPOST log:', JSON.stringify(posts));
  console.log('\n=== RESULTS ===');
  assert('the first order pushes exactly one record', first && first.n === 1);
  assert('an idle save with nothing changed sends NO request', idleSentNothing);
  assert('the second order pushes exactly one record (not the whole set)', second && second.n === 1);
  assert('the two pushes carried DIFFERENT records (delta, not a resend)',
    first && second && first.ids[0] !== second.ids[0]);
  assert('no console errors', errors.length === 0);
  if (errors.length) console.log('errors:', errors);
  console.log('\n'+(ok?'ALL PASS':'FAIL'));
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
