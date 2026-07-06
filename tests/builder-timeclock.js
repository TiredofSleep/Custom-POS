const { chromium } = require('playwright-core');
const http = require('http'), fs = require('fs'), path = require('path');
const EXE = process.env.CHROMIUM_EXE || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const ROOT = path.resolve(__dirname, '..');
const TYPES = { '.html':'text/html', '.js':'text/javascript' };
function serve(){ return new Promise(r=>{ const s=http.createServer((rq,rs)=>{ if(rq.url==='/favicon.ico'){rs.statusCode=204;return rs.end();} const f=path.join(ROOT,rq.url.split('?')[0]); fs.readFile(f,(e,b)=>{ if(e){rs.statusCode=404;return rs.end('nf');} rs.setHeader('Content-Type',TYPES[path.extname(f)]||'text/plain'); rs.end(b); }); }); s.listen(0,'127.0.0.1',()=>r(s)); }); }

(async () => {
  const errors = [];
  const server = await serve(); const port = server.address().port;
  const b = await chromium.launch({ executablePath: EXE, args:['--no-sandbox'] });
  const ctx = await b.newContext(); const p = await ctx.newPage();
  p.on('console', m => { if (m.type()==='error') errors.push(m.text()); });
  p.on('pageerror', e => errors.push('pageerror: '+e.message));
  await p.goto(`http://127.0.0.1:${port}/builder.html`);

  await p.locator('button.trade').filter({ hasText: 'Made-to-order' }).click();   // Café
  const staffPanel = p.locator('.panel').filter({ hasText: 'Staff & time clock' });

  // add a staff person: name + PIN
  await staffPanel.getByRole('button',{name:'+ Add person'}).click();
  await staffPanel.locator('.row2 input.nm').first().fill('Jordan');
  await staffPanel.locator('.row2 input.sm').first().fill('4321');
  // clock-in welcome message + specials
  await p.getByPlaceholder(/friendly note/).fill('You make the place.');
  await p.getByPlaceholder(/Half-price muffins/).fill('Soup of the day\nPie is back');

  // add a workstation and set its role to Time Clock
  await p.getByRole('button',{name:'+ Add workstation'}).click();
  await p.locator('.chip').filter({ hasText: /^New station/ }).click();
  await p.locator('.ed select').selectOption('timeclock');
  await p.locator('#stationName').fill('Time Clock');

  await p.getByRole('button',{name:/Build & download my POS/}).click();
  await p.waitForFunction(() => window.__build && window.__build.html);

  const r = await p.evaluate(() => {
    const f = window.__build.flow;
    const jordan = (f.staff||[]).find(s=>s.name==='Jordan');
    const clockStation = f.stations.find(s=>s.type==='timeclock');
    return {
      staffAdded: !!jordan && jordan.pin==='4321',
      welcomeMsg: f.welcome && f.welcome.message==='You make the place.',
      welcomeSpecials: f.welcome && (f.welcome.specials||[]).includes('Soup of the day') && (f.welcome.specials||[]).includes('Pie is back'),
      timeclockStation: !!clockStation,
      htmlHasStaff: window.__build.html.includes('"Jordan"'),
      mdMentionsClock: /time clock/i.test(window.__build.claudeMd)
    };
  });
  await p.waitForTimeout(300);
  const preview = await p.frameLocator('#preview').locator('#bizName').innerText();

  await b.close(); server.close();
  console.log('result:', JSON.stringify(r), 'preview:', preview);
  console.log('\n=== RESULTS ===');
  console.log('staff person added with PIN:', r.staffAdded);
  console.log('clock-in welcome message set:', r.welcomeMsg);
  console.log('daily specials set (one per line):', r.welcomeSpecials);
  console.log('Time Clock station configured:', r.timeclockStation);
  console.log('staff baked into the downloaded POS:', r.htmlHasStaff);
  console.log('built config runs a live preview:', preview.length>0);
  console.log('console errors:', errors.length?errors:'NONE');
  const ok = r.staffAdded && r.welcomeMsg && r.welcomeSpecials && r.timeclockStation && r.htmlHasStaff && preview.length>0 && !errors.length;
  process.exit(ok?0:1);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
