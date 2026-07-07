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

  await p.locator('button.trade').filter({ hasText: 'Ring up items' }).click();   // Retail
  await p.locator('#bizName').fill('Stamp Shop');
  await p.getByRole('button',{name:/Build it for me/}).click();
  await p.waitForFunction(() => window.__build && window.__build.html);

  const r = await p.evaluate(() => {
    const { html, claudeMd, build } = window.__build;
    return {
      hasVersion: /^\d+\.\d+/.test(build.version),
      bannerInHtml: html.includes('<!-- customPOS · Stamp Shop · engine v'+build.version),
      buildObjInHtml: html.includes('window.CUSTOMPOS_BUILD') && html.includes('"business":"Stamp Shop"'),
      mdStamped: claudeMd.includes('Engine **v'+build.version+'**') && claudeMd.includes('built **'+build.builtAt+'**')
    };
  });
  // the assembled POS shows its version on the setup screen
  await p.waitForTimeout(300);
  const foot = await p.frameLocator('#preview').locator('main').innerText();
  const footerShown = /customPOS engine v\d+\.\d+/.test(foot) && /your software, your data/.test(foot);

  await b.close(); server.close();
  console.log('result:', JSON.stringify(r), 'footer?', footerShown);
  console.log('\n=== RESULTS ===');
  console.log('engine version detected:', r.hasVersion);
  console.log('download carries a build banner comment:', r.bannerInHtml);
  console.log('download embeds CUSTOMPOS_BUILD metadata:', r.buildObjInHtml);
  console.log('CLAUDE.md is stamped with version + date:', r.mdStamped);
  console.log('running POS shows its version on setup:', footerShown);
  console.log('console errors:', errors.length?errors:'NONE');
  const ok = r.hasVersion && r.bannerInHtml && r.buildObjInHtml && r.mdStamped && footerShown && !errors.length;
  process.exit(ok?0:1);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
