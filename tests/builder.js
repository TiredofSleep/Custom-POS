const { chromium } = require('playwright-core');
const http = require('http');
const fs = require('fs');
const path = require('path');
const EXE = process.env.CHROMIUM_EXE || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const ROOT = path.resolve(__dirname, '..');
const TYPES = { '.html':'text/html', '.js':'text/javascript', '.md':'text/markdown', '.json':'application/json' };

function serve() {
  return new Promise(resolve => {
    const s = http.createServer((req, res) => {
      if (req.url === '/favicon.ico') { res.statusCode = 204; return res.end(); }
      const f = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
      fs.readFile(f, (e, buf) => {
        if (e) { res.statusCode = 404; return res.end('not found'); }
        res.setHeader('Content-Type', TYPES[path.extname(f)] || 'text/plain');
        res.end(buf);
      });
    });
    s.listen(0, '127.0.0.1', () => resolve(s));
  });
}

(async () => {
  const errors = [];
  const server = await serve();
  const port = server.address().port;
  const b = await chromium.launch({ executablePath: EXE, args:['--no-sandbox'] });
  const ctx = await b.newContext(); const p = await ctx.newPage();
  p.on('console', m => { if (m.type()==='error') errors.push(m.text()); });
  p.on('pageerror', e => errors.push('pageerror: '+e.message));
  await p.goto(`http://127.0.0.1:${port}/builder.html`);

  // Step 1: pick a trade (filter by blurb text — robust to composed accessible names)
  await p.locator('button.trade').filter({ hasText: 'Made-to-order' }).click();
  // Step 2: name it, then Express build
  await p.locator('#bizName').fill("Joe's Coffee");
  await p.getByRole('button',{name:/Build it for me/}).click();

  // Step 3: artifacts generated
  await p.waitForFunction(() => window.__build && window.__build.html);
  const build = await p.evaluate(() => ({
    name: window.__build.flow.branding.name,
    hasInject: window.__build.html.includes('window.CUSTOMPOS_FLOW'),
    hasEngine: window.__build.html.includes('customPOS — engine skeleton'),
    mdMentions: window.__build.claudeMd.includes("Joe's Coffee"),
    mdIsGuide: window.__build.claudeMd.startsWith('# CLAUDE.md')
  }));
  // download links wired
  const posHref = await p.locator('#dlPos').getAttribute('href');
  const mdHref = await p.locator('#dlMd').getAttribute('href');
  const dlWired = /^blob:/.test(posHref||'') && /^blob:/.test(mdHref||'');
  // the live preview iframe actually runs the assembled POS with the injected name
  await p.waitForTimeout(300);
  const previewBrand = await p.frameLocator('#preview').locator('#bizName').innerText();
  const previewRuns = previewBrand === "Joe's Coffee";

  await b.close(); server.close();
  console.log('build:', JSON.stringify(build), 'preview brand:', previewBrand);
  console.log('\n=== RESULTS ===');
  console.log('config generated with the entered name:', build.name === "Joe's Coffee");
  console.log('download = engine + injected flow:', build.hasInject && build.hasEngine);
  console.log('CLAUDE.md generated for the business:', build.mdMentions && build.mdIsGuide);
  console.log('download links wired (POS + CLAUDE.md):', dlWired);
  console.log('live preview runs the assembled POS:', previewRuns);
  console.log('console errors:', errors.length?errors:'NONE');
  const ok = build.name==="Joe's Coffee" && build.hasInject && build.hasEngine && build.mdMentions && build.mdIsGuide && dlWired && previewRuns && !errors.length;
  process.exit(ok?0:1);
})().catch(e=>{ console.error('FATAL',e); process.exit(2); });
