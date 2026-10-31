/* @proof @facts — THE BUILDER'S "SEVERAL COMPUTERS" (Stage 2): a download built for several stations carries the v2 engine and opens
   its time clock on the shared hub; a download for one computer carries none of it (the negative control).
   - the guided interview's last step, Several computers, asks for the hub's address;
   - the built file holds the engine bundle (facts.bundle.js, served beside the builder), storage:"facts", the hub's address for the
     time clock, and the same address for the records (window.CUSTOMPOS_HUB) — one hub answers both;
   - opened, that file's Time Clock asks to connect this device, with the hub address already filled in;
   - it carries NO PINs (each is typed on a device when the team joins the hub; the hub serves this file to its network), and a staff
     name holding a closing script tag cannot end the setup's script early (stage-2 review);
   - a hub address that is not an http(s) address is refused before anything is built;
   - Just one computer: no bundle, no storage setting, no hub address, its PINs as always; its Time Clock is the PIN pad as always.
   Zero console errors. Needs CHROMIUM_EXE. */
'use strict';
const { chromium } = require('playwright-core');
const http = require('http'), fs = require('fs'), os = require('os'), path = require('path');
const EXE = process.env.CHROMIUM_EXE || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const ROOT = path.resolve(__dirname, '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.md': 'text/markdown', '.json': 'application/json' };

let fail = 0;
function check(ok, words) { console.log((ok ? '  ✓ ' : '  ✗ ') + words); if (!ok) fail++; }
function serve() {
  return new Promise(resolve => {
    const s = http.createServer((req, res) => {
      if (req.url === '/favicon.ico') { res.statusCode = 204; return res.end(); }
      if (req.url.split('?')[0] === '/api/db') { req.resume(); res.setHeader('Content-Type', 'application/json'); res.setHeader('Access-Control-Allow-Origin', '*'); return res.end(JSON.stringify({ db: { records: [], seq: 0, customers: [] }, rev: 0 })); }   /* the built file's records sync answers, so no request fails */
      const f = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
      if (f.indexOf(ROOT) !== 0) { res.statusCode = 403; return res.end(); }
      fs.readFile(f, (e, buf) => { if (e) { res.statusCode = 404; return res.end('not found'); } res.setHeader('Content-Type', TYPES[path.extname(f)] || 'text/plain'); res.end(buf); });
    });
    s.listen(0, '127.0.0.1', () => resolve(s));
  });
}

(async () => {
  console.log('\n— the builder: several computers → the shared time clock —');
  const errors = [], server = await serve(), port = server.address().port, tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'custompos-bf-'));
  const HUB = 'http://127.0.0.1:' + port, NASTY = 'Alex</' + 'script><script>window.__x=1</' + 'script>';   /* the hub address the owner types: here, this test's own server (it answers /api/db) */
  const b = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
  const page = async function (label) { const p = await (await b.newContext()).newPage(); p.on('console', m => { if (m.type() === 'error') errors.push(label + ': ' + m.text()); }); p.on('pageerror', e => errors.push(label + ' pageerror: ' + e.message)); return p; };
  /* build through the guided interview's own functions: a café with a team (so it has staff and a time clock), then the last step */
  const build = async function (deploy, hub) {
    const p = await page('builder-' + deploy);
    await p.goto('http://127.0.0.1:' + port + '/builder.html');
    await p.getByRole('button', { name: /Guided setup/ }).click();
    await p.locator('button.trade').filter({ hasText: 'Made-to-order' }).click();
    /* a team and a time clock (the interview's people step gives a café both), then the last step */
    await p.evaluate(function (nasty) { cfg.staff = [{ id: 'e1', name: nasty, pin: '1234', role: 'owner' }, { id: 'e2', name: 'Sam', pin: '5678' }]; if (!cfg.stations.some(function (s) { return s.type === 'timeclock'; })) cfg.stations.push({ id: 'clock', type: 'timeclock', label: 'Time Clock', view: {} }); gstep = 6; render(); }, NASTY);
    const askText = async () => (await p.locator('#app').innerText());
    check(/how will you run it/i.test(await askText()), deploy + ': the last step asks how it will run');
    await p.locator('button.trade').filter({ hasText: deploy === 'several' ? 'Several computers' : 'Just one computer' }).click();
    if (deploy === 'several') { check(await p.locator('#guideHub').count() === 1, 'several: it asks for the hub\'s address'); await p.fill('#guideHub', hub); }
    else check(await p.locator('#guideHub').count() === 0, 'one computer: it asks for no hub');
    await p.getByRole('button', { name: /Build my POS/ }).click();
    await p.waitForFunction(() => window.__build && window.__build.html, null, { timeout: 15000 });
    return p.evaluate(() => ({ html: window.__build.html, flow: window.__build.flow }));
  };
  const open = async function (label, html) {
    const f = path.join(tmp, label + '.html'); fs.writeFileSync(f, html);
    const p = await page(label); await p.goto('file://' + f);
    const clock = p.getByRole('button', { name: /^Time Clock/ }).first();
    if (await clock.count()) await clock.click();
    return p;
  };
  try {
    const several = await build('several', HUB);
    check(several.flow.storage === 'facts' && several.flow.factsHub === HUB, 'several: the setup says storage "facts" with the hub\'s address');
    check(several.html.indexOf('globalThis.CustomPOSFacts = {') >= 0 || several.html.indexOf('G.CustomPOSFacts = {') >= 0, 'several: the download carries the v2 engine bundle');
    check(several.html.indexOf('window.CUSTOMPOS_HUB = "' + HUB + '"') >= 0, 'several: the records point at the same hub (one hub answers both)');
    const flowIn = function (html) { const m = /window[.]CUSTOMPOS_FLOW = (.*?); window[.]CUSTOMPOS_BUILD/.exec(html); return m ? JSON.parse(m[1]) : null; };
    const sf = flowIn(several.html);
    check(sf && sf.staff.length === 2 && sf.staff.every(p => !('pin' in p)) && several.html.indexOf('"1234"') < 0 && several.html.indexOf('"5678"') < 0, 'several: the download carries no PINs');
    check(several.flow.staff[0].pin === '1234', "and the builder's own setup still has them (only the file leaves them out)");
    const S = await open('several', several.html);
    check(await S.evaluate(n => window.__x === undefined && FLOW.staff[0].name === n, NASTY), 'several: a staff name holding a closing script tag stays a name (it did not end the script)');
    const st = await S.evaluate(() => ({ on: typeof FACTS === 'object' && FACTS.on, bundle: typeof globalThis.CustomPOSFacts === 'object' }));
    check(st.on && st.bundle, 'several: opened, the file runs the time clock on the v2 engine');
    const hasClock = (several.flow.stations || []).some(s => s.type === 'timeclock');
    if (hasClock) { await S.waitForTimeout(500); check(/connect this device/i.test(await S.locator('main').innerText()) && (await S.inputValue('#factsHub')) === HUB, 'several: its Time Clock asks to connect this device, the hub address filled in'); }
    else check(false, 'the guided café with a team has a Time Clock station to open');
    /* the negative control: one computer */
    const one = await build('one');
    check(one.flow.storage === undefined && one.flow.factsHub === undefined, 'one computer: no storage setting and no hub');
    check(one.html.indexOf('CustomPOSFacts = {') < 0 && one.html.indexOf('window.CUSTOMPOS_HUB = "') < 0, 'one computer: no engine bundle and no hub address in the file');
    check((flowIn(one.html) || { staff: [] }).staff.some(p => p.pin === '1234'), 'one computer: its PINs are in the file as always (the PIN pad compares them on the device)');
    const O = await open('one', one.html);
    check(await O.evaluate(() => typeof FACTS === 'object' && FACTS.on === false), 'one computer: the time clock stays on this device (facts mode off)');
    /* a hub address that is not an http(s) address: refused before anything is built */
    const bad = await page('builder-bad');
    await bad.goto('http://127.0.0.1:' + port + '/builder.html');
    await bad.getByRole('button', { name: /Guided setup/ }).click();
    await bad.locator('button.trade').filter({ hasText: 'Made-to-order' }).click();
    await bad.evaluate(function () { gstep = 6; render(); });
    await bad.locator('button.trade').filter({ hasText: 'Several computers' }).click();
    await bad.fill('#guideHub', 'javascript:alert(1)//"><b>');
    await bad.getByRole('button', { name: /Build my POS/ }).click(); await bad.waitForTimeout(800);
    check(await bad.evaluate(() => !window.__build && /should look like https/.test((document.getElementById('bToast') || {}).textContent || '')), 'a hub address that is not http(s) is refused, and nothing is built');
    check(!errors.length, 'no console errors' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
  } catch (e) { check(false, 'the run broke: ' + (e && e.stack || e)); }
  finally { await b.close(); server.close(); fs.rmSync(tmp, { recursive: true, force: true }); }
  console.log('\n' + (fail ? 'builder facts: ' + fail + ' failed' : 'builder facts: all checks passed'));
  process.exit(fail ? 1 : 0);
})();
