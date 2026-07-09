// Boots EVERY builder template through the engine and asserts zero console errors — the guarantee that a
// non-technical owner who picks any starter template gets a valid, working POS.
const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');
const url = 'file://' + path.resolve(__dirname, '..', 'pos.html');
const EXE = process.env.CHROMIUM_EXE || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

function extractTemplates() {
  const b = fs.readFileSync(path.resolve(__dirname, '..', 'builder.html'), 'utf8');
  const start = b.indexOf('const TEMPLATES');
  const objStart = b.indexOf('{', start);
  let depth = 0, end = -1;
  for (let i = objStart; i < b.length; i++) { const ch = b[i]; if (ch === '{') depth++; else if (ch === '}') { depth--; if (depth === 0) { end = i; break; } } }
  // eslint-disable-next-line no-eval
  return eval('(' + b.slice(objStart, end + 1) + ')');
}

(async () => {
  const TEMPLATES = extractTemplates();
  const keys = Object.keys(TEMPLATES);
  const b = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
  const results = {};
  let anyFail = false;
  for (const k of keys) {
    const errors = [];
    const ctx = await b.newContext(); const p = await ctx.newPage();
    p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    p.on('pageerror', e => errors.push('pageerror: ' + e.message));
    const flow = TEMPLATES[k];
    await p.addInitScript(f => { window.CUSTOMPOS_FLOW = f; }, flow);
    await p.goto(url);
    await p.waitForTimeout(150);
    // best-effort ring at the first money station
    let rang = false;
    try {
      const ring = (flow.stations || []).find(s => ['central', 'intake'].includes(s.type)) || (flow.stations || [])[0];
      if (ring && ring.label) { const esc = ring.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); const btn = p.getByRole('button', { name: new RegExp('^' + esc) }); if (await btn.count()) await btn.first().click({ timeout: 4000 }).catch(() => {}); }
      const item = (flow.catalog || [])[0];
      if (item && item.name) { const it = p.getByText(item.name, { exact: false }); if (await it.count()) { await it.first().click({ timeout: 4000 }).catch(() => {}); rang = true; } }
    } catch (e) {}
    await ctx.close();
    const ok = errors.length === 0;
    results[k] = { ok, rang, errors: errors.slice(0, 2) };
    if (!ok) anyFail = true;
  }
  await b.close();
  console.log('\n=== TEMPLATE BOOT CHECK (' + keys.length + ' templates) ===');
  for (const k of keys) { const r = results[k]; console.log((r.ok ? '  ok ' : 'FAIL ') + k.padEnd(14) + (r.rang ? ' · rang' : '') + (r.ok ? '' : '  ' + JSON.stringify(r.errors))); }
  console.log(anyFail ? '\nSOME TEMPLATES FAILED' : '\nALL TEMPLATES BOOT CLEAN');
  process.exit(anyFail ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
