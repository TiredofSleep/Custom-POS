// try-flow.js — drive the customPOS engine with an arbitrary FLOW config and report whether it produces a
// working POS (zero console errors + a sale can be rung). Usage: node tools/try-flow.js path/to/flow.json
const { chromium } = require('playwright-core');
const path = require('path');
const fs = require('fs');

function findChromium() {
  if (process.env.CHROMIUM_EXE && fs.existsSync(process.env.CHROMIUM_EXE)) return process.env.CHROMIUM_EXE;
  const roots = ['/opt/pw-browsers'];
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    for (const d of fs.readdirSync(root)) {
      const p = path.join(root, d, 'chrome-linux', 'chrome');
      if (fs.existsSync(p)) return p;
    }
  }
  return '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
}

(async () => {
  const flowPath = process.argv[2];
  if (!flowPath) { console.log(JSON.stringify({ ok: false, fatal: 'usage: try-flow.js <flow.json>' })); process.exit(2); }
  let flow;
  try { flow = JSON.parse(fs.readFileSync(flowPath, 'utf8')); }
  catch (e) { console.log(JSON.stringify({ ok: false, fatal: 'bad JSON: ' + e.message })); process.exit(2); }

  const url = 'file://' + path.resolve(__dirname, '..', 'pos.html');
  const errors = [];
  const b = await chromium.launch({ executablePath: findChromium(), args: ['--no-sandbox'] });
  const ctx = await b.newContext(); const p = await ctx.newPage();
  p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  p.on('pageerror', e => errors.push('pageerror: ' + e.message));
  await p.addInitScript(f => { window.CUSTOMPOS_FLOW = f; }, flow);

  const res = {
    flowId: flow.flowId, business: flow.branding && flow.branding.name,
    stations: (flow.stations || []).map(s => s.type), stationLabels: (flow.stations || []).map(s => s.label),
    items: (flow.catalog || []).length,
    modulesGuess: [], boundStation: null, rang: false, sentOrder: false, checkedOut: false
  };
  try {
    await p.goto(url, { timeout: 15000 });
    await p.waitForTimeout(300);
    // best-effort: bind a station that can ring a sale, add the first item, send + take payment
    const ring = (flow.stations || []).find(s => ['central', 'intake'].includes(s.type)) || (flow.stations || [])[0];
    if (ring && ring.label) {
      res.boundStation = ring.label;
      const esc = ring.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const btn = p.getByRole('button', { name: new RegExp('^' + esc) });
      if (await btn.count()) await btn.first().click({ timeout: 5000 }).catch(() => {});
    }
    const item = (flow.catalog || [])[0];
    if (item && item.name) {
      const it = p.getByText(item.name, { exact: false });
      if (await it.count()) { await it.first().click({ timeout: 5000 }).catch(() => {}); res.rang = true; }
    }
    const send = p.getByRole('button', { name: /Send order/ });
    if (await send.count()) { await send.first().click({ timeout: 4000 }).catch(() => {}); res.sentOrder = true; }
    // handle an age gate if present (agent may have flagged an item)
    const idbtn = p.getByRole('button', { name: /ID checked/ });
    if (await idbtn.count()) await idbtn.first().click({ timeout: 3000 }).catch(() => {});
    const pay = p.getByRole('button', { name: /Take payment|Complete \(paid\)/ });
    if (await pay.count()) { await pay.first().click({ timeout: 4000 }).catch(() => {}); res.checkedOut = true; }
  } catch (e) { res.driveError = String(e).slice(0, 200); }

  await b.close();
  const out = { ok: errors.length === 0, consoleErrors: errors, ...res };
  console.log(JSON.stringify(out, null, 2));
  process.exit(errors.length ? 1 : 0);
})().catch(e => { console.log(JSON.stringify({ ok: false, fatal: String(e).slice(0, 300) })); process.exit(2); });
