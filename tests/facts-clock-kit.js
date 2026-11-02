/* @proof @facts @timeclock — THE TIME CLOCK AS A KIT (rollout step 5, docs/V2-MODULAR-IMPORT.md Part 3b §4), in a real browser against a real
   hub. The punch code is one kit, written against a DB in the old shape; on a hub its adapter turns what the kit changed into facts.
   - THE KIT DOES NOT KNOW WHICH MODE IT RUNS IN: neither the kit nor the clock screen names the facts mode; only the host's few functions do.
   - A shift left open on a device before it joined the hub ends at that person's next clock-out (skeptic finding 1.1: it stayed open
     forever). It is history on that device: closing it writes no fact; the person's next clock-in is a fact on the hub.
   - A punch the device refuses never shows a Welcome: the kit stops at a save that answers false, and the refusal is said. The negative
     control: with the door working again the same PIN clocks in and says Welcome.
   - Skeptic 11/1 (step 6): a manager brought on from the team card holds payroll and employees, and approves a later hire; a shift from
     before the hub ends when that person's shift on the hub begins, so the clock-out closes the hub's shift (the shop's order); a staff
     name from the hub is text on the Office's Activity log, never run.
   Zero console errors. Needs Node 22+ (the hub's node:sqlite) and CHROMIUM_EXE. */
'use strict';
const { chromium } = require('playwright-core');
const fs = require('fs'), os = require('os'), path = require('path');
const EXE = process.env.CHROMIUM_EXE || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const URL0 = 'file://' + path.resolve(__dirname, '..', 'pos.html');
const ADMIN = 'test-operator-key-clockkit-01';
const HOSTILE = '<img src=x onerror="window.__pwned=1">Nia';

let fail = 0;
function check(ok, words) { console.log((ok ? '  ✓ ' : '  ✗ ') + words); if (!ok) fail++; }

(async () => {
  console.log('\n— the time clock as a kit (a device, one hub) —');
  if (Number(process.versions.node.split('.')[0]) < 22) { check(false, 'Node ' + process.versions.node + ' — the hub needs Node 22+ (node:sqlite); nothing was run'); process.exit(1); }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'custompos-clockkit-'));
  process.env.DATA = path.join(tmp, 'blob.json');
  const { startHubServer } = require('../facts/server');
  const S = require('../facts/modules/staff'), TCM = require('../facts/modules/timeclock');
  const blobH = require('../hub.js').server.listeners('request')[0];
  const bundle = require('../facts/bundle').build();
  const srv = await startHubServer({ db: path.join(tmp, 'facts.db'), adminKey: ADMIN, modules: [S.STAFF, TCM.TIMECLOCK], grantSecret: 'test-pass-signer-clockkit', notify: function () {}, fallback: function (req, res) { blobH(req, res); } });
  const enroll = async function (station) { const r = await fetch(srv.url + '/v2/admin/enroll', { method: 'POST', headers: { 'content-type': 'application/json', 'x-custompos-admin': ADMIN }, body: JSON.stringify({ station: station }) }); return (await r.json()).token; };
  const tokA = await enroll('kit-a'), tokD = await enroll('kit-d'), tokE = await enroll('kit-e');
  const STAFF = [{ id: 'e1', name: 'Alex', role: 'owner', wage: 20 }, { id: 'e2', name: 'Sam', wage: 15 }, { id: 'e3', name: 'Mo', role: 'manager', wage: 18 }];
  const FLOW = { flowId: 'clockkit', label: 'Clock Kit', topology: 'linear', storage: 'facts', factsHub: srv.url,
    branding: { name: 'Clock Kit', brandColor: '#456' }, endpoints: { customer: { persist: false }, payment: { tenders: ['cash'], closeGate: 'balanceLE0', tipPool: true } },
    staff: STAFF, catalog: [{ id: 'c', name: 'Coffee', price: 3, category: 'drink', path: [] }],
    stations: [{ id: 'clock', type: 'timeclock', label: 'Time Clock', view: {} }] };
  const PINS = { e1: '1234', e2: '5678', e3: '2468', e4: '1357' };
  /* tablet E was set up after a hire (a name full of HTML), and has the Office */
  const FLOW_E = Object.assign({}, FLOW, { staff: STAFF.concat([{ id: 'e4', name: HOSTILE, wage: 12 }]), stations: FLOW.stations.concat([{ id: 'office', type: 'report', label: 'Office', view: { money: true } }]) });
  const errors = [];
  const b = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
  const page = async function (label) { const ctx = await b.newContext(), p = await ctx.newPage(); p.on('console', m => { if (m.type() === 'error') errors.push(label + ': ' + m.text()); }); p.on('pageerror', e => errors.push(label + ' pageerror: ' + e.message)); return p; };
  const text = async p => (await p.locator('main').innerText());
  const waitFor = async function (p, re, ms) { const ri = new RegExp(re.source, re.flags.indexOf('i') >= 0 ? re.flags : re.flags + 'i'), t0 = Date.now(); while (Date.now() - t0 < (ms || 15000)) { if (ri.test(await text(p))) return true; await p.waitForTimeout(150); } return false; };
  const until = async function (fn, ms) { const t0 = Date.now(); while (Date.now() - t0 < (ms || 15000)) { if (await fn()) return true; await new Promise(r => setTimeout(r, 250)); } return false; };
  const enterPin = async function (p, pin) { for (const d of pin.split('')) await p.getByRole('button', { name: d, exact: true }).click(); await p.getByRole('button', { name: '✓', exact: true }).click(); };
  const connect = async function (p, name, tok) { await p.fill('#factsStation', name); await p.fill('#factsToken', tok); await p.getByRole('button', { name: 'Connect' }).click(); };
  const clockFacts = emp => srv.hub.facts().filter(e => /^clock\./.test(e.type) && e.payload.empId === emp);
  try {
    /* tablet A brings the team onto the hub */
    const A = await page('A');
    await A.addInitScript({ content: bundle }); await A.addInitScript(f => { window.CUSTOMPOS_FLOW = f; }, FLOW);
    await A.goto(URL0); await A.getByRole('button', { name: /^Time Clock/ }).first().click();
    await connect(A, 'kit-a', tokA);
    check(await waitFor(A, /Bring your team onto the hub/), 'A connects to a brand-new hub');
    await A.fill('[data-pin="e1"]', PINS.e1); await A.fill('[data-pin="e2"]', PINS.e2); await A.fill('[data-pin="e3"]', PINS.e3);
    await A.getByRole('button', { name: 'Add my team' }).click();
    check(await waitFor(A, /Enter your PIN/), 'the team is on the hub');
    await until(() => srv.hub.facts().some(e => e.type === 'employee.set' && e.payload.empId === 'e3'));   /* the pad shows once the owner is on; the rest follow */
    const moSet = srv.hub.facts().filter(e => e.type === 'employee.set' && e.payload.empId === 'e3')[0];
    check(!!moSet && moSet.payload.set.role === 'manager' && moSet.payload.set.perms && moSet.payload.set.perms.payroll === true && moSet.payload.set.perms.employees === true, 'the manager comes on holding payroll and employees as their own (the business\'s default manager list has neither)');

    /* THE KIT DOES NOT KNOW WHICH MODE IT RUNS IN */
    const src = await A.evaluate(() => ({ kit: clockKit.toString(), screen: renderTimeclock.toString(), wrappers: [clockIn, clockOut, startBreak, endBreak].map(f => f.toString()).join('\n') }));
    check(src.kit.indexOf('FACTS') < 0 && src.kit.indexOf('CustomPOSFacts') < 0, 'the kit names neither the facts mode nor the engine');
    check(src.screen.indexOf('FACTS') < 0, 'nor does the clock screen: it asks the host for people (clockStaff) and draws the host\'s gate and status');
    check(src.wrappers.indexOf('FACTS') < 0, 'and the four punches go to whichever kit the host hands over (clockNow)');

    /* device D ran on its own first: Sam's shift is open on it when it joins the hub */
    const D = await page('D');
    await D.addInitScript(f => { window.CUSTOMPOS_FLOW = f; }, FLOW);
    await D.goto(URL0); await D.getByRole('button', { name: /^Time Clock/ }).first().click();
    const t0 = await D.evaluate(() => { const db = loadDB(), t = Date.now() - 2 * 3600000; db.punches = [{ staffId: 'e2', name: 'Sam', in: '07:00', inTs: t, out: null, outTs: null, breaks: [], wage: 15 }]; persistDB(db); return t; });
    await D.addInitScript({ content: bundle });
    await D.reload(); await D.getByRole('button', { name: /^Time Clock/ }).first().click({ timeout: 1500 }).catch(() => {});
    await connect(D, 'kit-d', tokD);
    check(await waitFor(D, /Enter your PIN/), 'D, which ran on its own, connects');
    check(await waitFor(D, /On the clock[\s\S]*Sam/), 'Sam\'s shift from before the hub is on D\'s clock, still open');
    await enterPin(D, PINS.e2);
    check(await waitFor(D, /Hi Sam/), 'Sam\'s PIN on D opens that shift');
    await D.getByRole('button', { name: 'Clock out' }).click();
    check(await waitFor(D, /Thanks, Sam/), 'and Sam clocks out of it (finding 1.1: it used to stay open forever)');
    const hist = await D.evaluate(() => loadDB().punchesBeforeFacts);
    check(hist.length === 1 && hist[0].inTs === t0 && typeof hist[0].outTs === 'number' && hist[0].outTs > t0, 'the shift from before the hub is closed, on this device, at its own start');
    check(clockFacts('e2').length === 0, 'closing it wrote no fact: it is this device\'s history');
    await D.getByRole('button', { name: 'Done' }).click();
    check(await waitFor(D, /Nobody clocked in/), 'nobody is on the clock now');
    await enterPin(D, PINS.e2);
    check(await waitFor(D, /Welcome, Sam/), 'Sam\'s next PIN clocks in');
    check(await until(() => clockFacts('e2').some(e => e.type === 'clock.in' && e.station === 'kit-d' && e.actor === 'e2')), 'and that clock-in is a fact on the hub, written by Sam on D');
    await D.getByRole('button', { name: 'Start shift' }).click();
    check(await waitFor(A, /On the clock[\s\S]*Sam/, 20000), 'and tablet A sees Sam on the clock');

    /* a punch the device refuses never shows a Welcome */
    await D.evaluate(() => { window.__realRecord = FACTS.st.record; FACTS.st.record = function () { throw new Error('refused for the proof'); }; });
    await enterPin(D, PINS.e1);
    check(await waitFor(D, /refused for the proof/), 'Alex\'s clock-in refused by the device: the refusal is said');
    check(!/Welcome, Alex/i.test(await text(D)), 'and there is no Welcome for a punch that was not recorded');
    check(!clockFacts('e1').length, 'nothing reached the hub');
    await D.evaluate(() => { FACTS.st.record = window.__realRecord; FACTS.error = null; render(); });
    check(await waitFor(D, /Enter your PIN/), 'the negative control: with the door working again');
    await enterPin(D, PINS.e1);
    check(await waitFor(D, /Welcome, Alex/), 'the same PIN clocks Alex in and says Welcome');
    check(await until(() => clockFacts('e1').some(e => e.type === 'clock.in')), 'and the clock-in is on the hub');
    /* a refused clock-out, from the on-shift screen, is said too (that screen used to stay up and hide it) */
    await D.getByRole('button', { name: 'Start shift' }).click();
    await enterPin(D, PINS.e2); check(await waitFor(D, /Hi Sam/), 'Sam opens the on-shift screen');
    await D.evaluate(() => { FACTS.st.record = function () { throw new Error('refused again for the proof'); }; });
    await D.getByRole('button', { name: 'Clock out' }).click();
    check(await waitFor(D, /refused again for the proof/), 'a refused clock-out is said, not hidden behind the on-shift screen');
    check(!/Thanks, Sam/i.test(await text(D)) && !clockFacts('e2').some(e => e.type === 'clock.out'), 'with no Thanks and no clock-out on the hub');
    await D.evaluate(() => { FACTS.st.record = window.__realRecord; FACTS.error = null; render(); });
    /* device E ran on its own with Alex's shift open; Alex is on the clock on the hub too (clocked in on D above) */
    const ctxE = await b.newContext(), E = await ctxE.newPage();
    E.on('console', m => { if (m.type() === 'error') errors.push('E: ' + m.text()); }); E.on('pageerror', e => errors.push('E pageerror: ' + e.message));
    await E.addInitScript(f => { window.CUSTOMPOS_FLOW = f; }, FLOW_E);
    await E.goto(URL0); await E.getByRole('button', { name: /^Time Clock/ }).first().click();
    await E.evaluate(() => { const db = loadDB(), t = Date.now() - 3 * 3600000; db.punches = [{ staffId: 'e1', name: 'Alex', in: '06:00', inTs: t, out: null, outTs: null, breaks: [{ start: '07:00', startTs: t + 3600000, end: null, endTs: null }], wage: 20 }]; persistDB(db); });
    await E.addInitScript({ content: bundle });
    await E.reload(); await E.getByRole('button', { name: /^Time Clock/ }).first().click({ timeout: 1500 }).catch(() => {});
    await connect(E, 'kit-e', tokE);
    const alexIn = clockFacts('e1').filter(e => e.type === 'clock.in').map(e => e.payload.at).sort((x, y) => x - y)[0];
    check(await until(async () => { const h = await E.evaluate(() => (loadDB().punchesBeforeFacts || [])[0]); return h && h.outTs === alexIn; }), 'E\'s shift from before the hub ends when Alex\'s shift on the hub began (the hub\'s open shift comes first)');
    const eh = await E.evaluate(() => ({ h: loadDB().punchesBeforeFacts[0], open: loadDB().punches.filter(p => p.staffId === 'e1' && !p.out).length, act: (loadDB().activity || []).map(a => a.detail).join(' | ') }));
    check(eh.open === 1 && eh.h.breaks[0].endTs === alexIn, 'Alex has one open shift on E, the hub\'s, and the old shift\'s open break ended with it');
    check(/shift from before the hub was closed at/.test(eh.act), 'and E\'s Activity log says so');
    /* the hire comes on under the MANAGER's PIN (parity-8: the approver list reads can(employees)) */
    check(await waitFor(E, /Add 1 person to the hub/), 'E offers to add the hire the hub does not have');
    check((await E.$$eval('#factsApprover option', os => os.map(o => o.value))).indexOf('e3') >= 0, 'the manager is among those who may approve it');
    await E.fill('[data-pin="e4"]', PINS.e4); await E.selectOption('#factsApprover', 'e3'); await E.fill('#factsApproverPin', PINS.e3);
    await E.getByRole('button', { name: 'Add them' }).click();
    check(await until(() => srv.hub.facts().some(e => e.type === 'employee.set' && e.payload.empId === 'e4' && e.actor === 'e3')), 'and Mo\'s PIN puts the hire on the hub, written by Mo');
    /* Alex clocks out on E: the hub's shift closes */
    check(await waitFor(E, /Enter your PIN/), 'E\'s PIN pad is back');
    await enterPin(E, PINS.e1); check(await waitFor(E, /Hi Alex/), 'Alex opens his shift on E');
    await E.getByRole('button', { name: 'Clock out' }).click();
    check(await waitFor(E, /Thanks, Alex/), 'Alex clocks out on E');
    check(await until(() => clockFacts('e1').some(e => e.type === 'clock.out' && e.station === 'kit-e')), 'and the clock-out is the HUB shift\'s, a fact from E (it used to close only the old shift on E)');
    await E.getByRole('button', { name: 'Done' }).click();
    /* the hire, whose name is full of HTML, clocks in on E; the Office's Activity log draws it as text */
    await enterPin(E, PINS.e4); check(await waitFor(E, /Welcome, <img/), 'the hire clocks in; the welcome shows the name as text');
    await E.getByRole('button', { name: 'Start shift' }).click();
    const O = await ctxE.newPage(); O.on('pageerror', e => errors.push('O pageerror: ' + e.message));
    await O.addInitScript(f => { window.CUSTOMPOS_FLOW = f; }, FLOW_E); await O.addInitScript({ content: bundle });
    await O.goto(URL0); await O.evaluate(() => bindStation('office'));   /* this device is bound to its Time Clock; the Office opens the way the app binds a station */
    check(await waitFor(O, /<img src=x onerror="window.__pwned=1">Nia clocked in/), 'the Office\'s Activity log shows the hire\'s name as text');
    check(await O.evaluate(() => window.__pwned === undefined) && await E.evaluate(() => window.__pwned === undefined), 'and it ran nowhere (it used to run on the Office)');
    check(!errors.length, 'no console errors' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
  } catch (e) { check(false, 'the run broke: ' + (e && e.stack || e)); }
  finally { await b.close(); await srv.close(); try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {} }
  console.log('\n' + (fail ? 'clock kit: ' + fail + ' failed' : 'clock kit: all checks passed'));
  process.exit(fail ? 1 : 0);
})();
