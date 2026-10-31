/* @proof @facts — THE TIME CLOCK IN FACTS MODE, in a real browser (Unit 2.4). Two tablets — two browser contexts, each with its own
   storage — talk to a real hub (facts/server.js with the staff and time clock modules) on 127.0.0.1:
   - each tablet is connected with its own device name and setup token; the first brings the team on (the owner first, then the
     rest under a PIN the HUB checked); no plain PIN ever reaches the hub;
   - a clock-in on tablet A is on tablet B; B takes a break and clocks out; A sees the shift closed with its break;
   - the tip pool and labor cost read the shared punches (the compat projection) and give the SAME numbers as blob mode given the
     same punches (the Stage 2 gate in docs/V2-MODULAR-IMPORT.md);
   - the negative control: in blob mode two tablets do NOT share a clock-in (the gap facts mode closes).
   Zero console errors on every page. Needs Node 22+ (the hub's node:sqlite) and CHROMIUM_EXE. */
'use strict';
const { chromium } = require('playwright-core');
const fs = require('fs'), os = require('os'), path = require('path');
const EXE = process.env.CHROMIUM_EXE || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const URL0 = 'file://' + path.resolve(__dirname, '..', 'pos.html');
const ADMIN = 'test-operator-key-factsclock-1';

let fail = 0;
function check(ok, words) { console.log((ok ? '  ✓ ' : '  ✗ ') + words); if (!ok) fail++; }

(async () => {
  const major = Number(process.versions.node.split('.')[0]);
  console.log('\n— the time clock in facts mode (two tablets, one hub) —');
  if (major < 22) { check(false, 'Node ' + process.versions.node + ' — the hub needs Node 22+ (node:sqlite); nothing was run'); process.exit(1); }
  const { startHubServer } = require('../facts/server');
  const S = require('../facts/modules/staff'), TCM = require('../facts/modules/timeclock');
  const bundle = require('../facts/bundle').build();
  const db = path.join(os.tmpdir(), 'custompos-factsclock-' + process.pid + '-' + Date.now() + '.db');
  const srv = await startHubServer({ db: db, adminKey: ADMIN, modules: [S.STAFF, TCM.TIMECLOCK], grantSecret: 'test-pass-signer-factsclock', notify: function () {} });
  const enroll = async function (station) { const r = await fetch(srv.url + '/v2/admin/enroll', { method: 'POST', headers: { 'content-type': 'application/json', 'x-custompos-admin': ADMIN }, body: JSON.stringify({ station: station }) }); return (await r.json()).token; };
  const tokA = await enroll('clock-a'), tokB = await enroll('clock-b');
  const FLOW = { flowId: 'factsclock', label: 'Facts Clock', topology: 'linear', storage: 'facts', factsHub: srv.url,
    branding: { name: 'Facts Clock', brandColor: '#456' }, endpoints: { customer: { persist: false }, payment: { tenders: ['cash'], closeGate: 'balanceLE0', tipPool: true } },
    staff: [{ id: 'e1', name: 'Alex', pin: '1234', role: 'owner', wage: 20 }, { id: 'e2', name: 'Sam', pin: '5678', wage: 15 }],
    catalog: [{ id: 'c', name: 'Coffee', price: 3, category: 'drink', path: [] }],
    stations: [{ id: 'clock', type: 'timeclock', label: 'Time Clock', view: {} }] };
  const errors = [];
  const b = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
  const tablet = async function (label, flow, withBundle) {
    const ctx = await b.newContext(), p = await ctx.newPage();
    p.on('console', m => { if (m.type() === 'error') errors.push(label + ': ' + m.text()); });
    p.on('pageerror', e => errors.push(label + ' pageerror: ' + e.message));
    if (withBundle) await p.addInitScript({ content: bundle });
    await p.addInitScript(f => { window.CUSTOMPOS_FLOW = f; }, flow);
    await p.goto(URL0);
    await p.getByRole('button', { name: /^Time Clock/ }).first().click();
    return p;
  };
  const text = async p => (await p.locator('main').innerText());
  /* headings are styled in capitals (CSS text-transform), and innerText reads them so: match case-insensitively, as tests/timeclock.js does */
  const waitFor = async function (p, re, ms) { const ri = new RegExp(re.source, re.flags.indexOf('i') >= 0 ? re.flags : re.flags + 'i'), t0 = Date.now(); while (Date.now() - t0 < (ms || 15000)) { if (ri.test(await text(p))) return true; await p.waitForTimeout(250); } return false; };
  const enterPin = async function (p, pin) { for (const d of pin.split('')) await p.getByRole('button', { name: d, exact: true }).click(); await p.getByRole('button', { name: '✓', exact: true }).click(); };
  const connect = async function (p, name, tok) { await p.fill('#factsStation', name); await p.fill('#factsToken', tok); await p.getByRole('button', { name: 'Connect' }).click(); };
  try {
    /* tablet A: connect, bring the team on */
    const A = await tablet('A', FLOW, true);
    check(await waitFor(A, /Connect this device/), 'A asks to be connected to the hub');
    check((await A.inputValue('#factsHub')) === srv.url, 'the hub address comes from setup');
    await connect(A, 'clock-a', tokA);
    check(await waitFor(A, /Bring your team onto the hub/), 'a brand-new hub: A offers to bring the team on');
    await A.getByRole('button', { name: 'Add my team' }).click();
    check(await waitFor(A, /Enter your PIN/), 'the team is on the hub and the PIN pad shows');
    const facts = srv.hub.facts(), staffFacts = facts.filter(e => e.type === 'staff.set');
    check(staffFacts.length === 2 && staffFacts[0].payload.set.role === 'owner' && staffFacts[1].actor === 'e1', 'two staff facts: the owner first, the second written by the owner (under the hub-checked pass)');
    check(JSON.stringify(facts).indexOf('"1234"') < 0 && JSON.stringify(facts).indexOf('"5678"') < 0, 'no plain PIN reached the hub (only hashes)');
    /* A: Alex clocks in */
    await enterPin(A, '1234');
    check(await waitFor(A, /Welcome, Alex/), 'Alex clocks in on A');
    await A.getByRole('button', { name: /Start shift/ }).click();
    check(srv.hub.facts().some(e => e.type === 'clock.in' && e.payload.empId === 'e1' && e.actor === 'e1' && e.payload.wage === 20), 'the clock-in is on the hub, written by Alex, with the wage at punch time');
    /* tablet B: connect; Alex is on the clock there */
    const B = await tablet('B', FLOW, true);
    await connect(B, 'clock-b', tokB);
    check(await waitFor(B, /On the clock[\s\S]*Alex/), 'B, a different tablet, shows Alex on the clock');
    /* B: Alex takes a break and clocks out */
    await enterPin(B, '1234');
    check(await waitFor(B, /Hi Alex/), 'Alex enters the PIN on B and gets the on-shift screen');
    await B.getByRole('button', { name: 'Start break' }).click();
    check(await waitFor(B, /End break/), 'a break starts');
    await B.getByRole('button', { name: /End break/ }).click();
    check(await waitFor(B, /Start break/), 'and ends');
    await B.getByRole('button', { name: 'Clock out' }).click();
    check(await waitFor(B, /Thanks, Alex/), 'Alex clocks out on B');
    await B.getByRole('button', { name: 'Done' }).click();
    /* A: sees the shift closed, with its break */
    check(await waitFor(A, /Nobody clocked in/), 'A sees nobody on the clock');
    const pa = await A.evaluate(() => loadDB().punches);
    check(pa.length === 1 && pa[0].staffId === 'e1' && pa[0].outTs > pa[0].inTs && pa[0].breaks.length === 1 && pa[0].breaks[0].endTs != null && pa[0].wage === 20, 'A\'s punches: one closed shift with its break and wage');
    /* the Stage 2 gate: tip pool and labor cost from the projection equal blob mode's, given the same punches */
    const fromFacts = await A.evaluate(() => ({ pool: poolHours(), labor: dayLaborCost() }));
    const BLOB = Object.assign({}, FLOW, { storage: undefined, factsHub: undefined, flowId: 'blobclock' });
    const C = await tablet('C', BLOB, false);
    const fromBlob = await C.evaluate(pun => { const db = loadDB(); db.punches = pun; persistDB(db); DB = loadDB(); return { pool: poolHours(), labor: dayLaborCost() }; }, pa);
    check(JSON.stringify(fromFacts) === JSON.stringify(fromBlob) && fromFacts.labor > 0, 'the tip pool and labor cost are the same from the shared punches as from blob mode (labor $' + fromFacts.labor.toFixed(4) + ')');
    /* the negative control: blob mode — two tablets, a clock-in on one is NOT on the other */
    const X = await tablet('X', BLOB, false), Y = await tablet('Y', BLOB, false);
    await enterPin(X, '5678'); await X.getByRole('button', { name: /Start shift/ }).click();
    await Y.reload(); await Y.getByRole('button', { name: /^Time Clock/ }).first().click().catch(() => {});
    check(/Sam/.test(await text(X)) && !(/On the clock[\s\S]*Sam/.test(await text(Y))), 'blob mode: Sam\'s clock-in on X is not on Y (the gap facts mode closes)');
    check(!errors.length, 'no console errors' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
  } catch (e) { check(false, 'the run broke: ' + (e && e.stack || e)); }
  finally { await b.close(); await srv.close(); ['', '-journal', '-wal', '-shm'].forEach(s => { try { fs.unlinkSync(db + s); } catch (e) {} }); }
  console.log('\n' + (fail ? 'facts clock: ' + fail + ' failed' : 'facts clock: all checks passed'));
  process.exit(fail ? 1 : 0);
})();
