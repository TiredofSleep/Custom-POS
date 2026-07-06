const { execSync } = require('child_process');
const path = require('path');
const { chromium } = require('playwright-core');
const EXE = process.env.CHROMIUM_EXE || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const ROOT = path.resolve(__dirname, '..');

(async () => {
  const errors = [];
  // build the self-contained file
  const buildLog = execSync('node build.js', { cwd: ROOT }).toString().trim();
  const url = 'file://' + path.join(ROOT, 'dist', 'custompos.html');

  const b = await chromium.launch({ executablePath: EXE, args:['--no-sandbox'] });
  const ctx = await b.newContext(); const p = await ctx.newPage();
  p.on('console', m => { if (m.type()==='error') errors.push(m.text()); });
  p.on('pageerror', e => errors.push('pageerror: '+e.message));
  await p.goto(url);   // file:// — no server, so fetch('pos.html') would 404; must use the embedded engine

  const engineEmbedded = await p.evaluate(() => typeof window.__ENGINE_SRC__ === 'string' && window.__ENGINE_SRC__.includes('customPOS — engine skeleton'));
  await p.locator('button.trade').filter({ hasText: 'Dry cleaner' }).click();   // Dry cleaner template
  await p.locator('#bizName').fill('Sparkle Cleaners');
  await p.getByRole('button',{name:/Build it for me/}).click();
  await p.waitForFunction(() => window.__build && window.__build.html);
  const build = await p.evaluate(() => ({
    name: window.__build.flow.branding.name,
    assembled: window.__build.html.includes('window.CUSTOMPOS_FLOW') && window.__build.html.includes('customPOS — engine skeleton'),
    md: window.__build.claudeMd.includes('Sparkle Cleaners')
  }));
  await p.waitForTimeout(300);
  const previewBrand = await p.frameLocator('#preview').locator('#bizName').innerText();

  await b.close();
  console.log(buildLog);
  console.log('preview brand:', previewBrand);
  console.log('\n=== RESULTS ===');
  console.log('engine embedded (no server needed):', engineEmbedded);
  console.log('assembles a POS offline (file://):', build.assembled && build.name==='Sparkle Cleaners');
  console.log('CLAUDE.md generated:', build.md);
  console.log('live preview runs offline:', previewBrand==='Sparkle Cleaners');
  console.log('console errors:', errors.length?errors:'NONE');
  process.exit(errors.length || !engineEmbedded || !build.assembled || !build.md || previewBrand!=='Sparkle Cleaners' ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
