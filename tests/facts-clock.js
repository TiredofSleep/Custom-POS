/* @proof @facts — THE TIME CLOCK IN FACTS MODE, in a real browser (Unit 2.4). Tablets — browser contexts, each with its own storage —
   talk to a real hub on 127.0.0.1 (facts/server.js with the staff and time clock modules, and the repo's hub.js answering the records
   beside it, as `--with-blob` runs it). The flow carries NO PINs, as a several-stations download does:
   - a wrong device name is refused at Connect, and nothing is saved; the right one connects;
   - the team comes on with PINs TYPED on the tablet (a short PIN writes nothing); the owner first, then the rest under a pass the HUB
     checked; no plain PIN reaches the hub; a hire made later is added on another tablet under a manager's hub-checked PIN, and a wrong
     one adds nobody;
   - a clock-in on tablet A is on tablet B; a reload of A punches again at once (never read-only); with the hub unreachable A says how
     many punches are waiting, then sends them; punches land on the Activity log; a staff name full of HTML is shown as text, never run;
   - Disconnect forgets the hub and a reconnect works; a tablet's punches from before it joined the hub are kept;
   - THE GATE: the tip pool, labor cost and every shift time from the shared punches equal what blob mode's own clock functions record
     for the same actions at the same moments (an independent run under a fixed browser clock, not the same punches fed back in);
   - the negative control: blob mode through the same real hub carries a record between two tablets, but NOT a clock-in.
   Zero console errors on every page. Needs Node 22+ (the hub's node:sqlite) and CHROMIUM_EXE. */
'use strict';
const { chromium } = require('playwright-core');
const fs = require('fs'), os = require('os'), path = require('path');
const EXE = process.env.CHROMIUM_EXE || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const URL0 = 'file://' + path.resolve(__dirname, '..', 'pos.html');
const ADMIN = 'test-operator-key-factsclock-1';
const HOSTILE = '<img src=x onerror="window.__pwned=1">Jo';

let fail = 0;
function check(ok, words) { console.log((ok ? '  ✓ ' : '  ✗ ') + words); if (!ok) fail++; }

(async () => {
  const major = Number(process.versions.node.split('.')[0]);
  console.log('\n— the time clock in facts mode (tablets, one hub) —');
  if (major < 22) { check(false, 'Node ' + process.versions.node + ' — the hub needs Node 22+ (node:sqlite); nothing was run'); process.exit(1); }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'custompos-factsclock-'));
  process.env.DATA = path.join(tmp, 'blob.json');   // the records hub keeps its data here (read when hub.js is required)
  const { startHubServer } = require('../facts/server');
  const S = require('../facts/modules/staff'), TCM = require('../facts/modules/timeclock');
  const blobH = require('../hub.js').server.listeners('request')[0];
  const bundle = require('../facts/bundle').build();
  const srv = await startHubServer({ db: path.join(tmp, 'facts.db'), adminKey: ADMIN, modules: [S.STAFF, TCM.TIMECLOCK], grantSecret: 'test-pass-signer-factsclock', notify: function () {}, fallback: function (req, res) { blobH(req, res); } });
  const enroll = async function (station) { const r = await fetch(srv.url + '/v2/admin/enroll', { method: 'POST', headers: { 'content-type': 'application/json', 'x-custompos-admin': ADMIN }, body: JSON.stringify({ station: station }) }); return (await r.json()).token; };
  const tokA = await enroll('clock-a'), tokB = await enroll('clock-b'), tokD = await enroll('clock-d');
  const STAFF = [{ id: 'e1', name: 'Alex', role: 'owner', wage: 20 }, { id: 'e2', name: 'Sam', wage: 15 }];
  const FLOW = { flowId: 'factsclock', label: 'Facts Clock', topology: 'linear', storage: 'facts', factsHub: srv.url,
    branding: { name: 'Facts Clock', brandColor: '#456' }, endpoints: { customer: { persist: false }, payment: { tenders: ['cash'], closeGate: 'balanceLE0', tipPool: true } },
    staff: STAFF, catalog: [{ id: 'c', name: 'Coffee', price: 3, category: 'drink', path: [] }],
    stations: [{ id: 'clock', type: 'timeclock', label: 'Time Clock', view: {} }] };
  /* tablet B was set up after a hire: its flow has a third person (with a name full of HTML) */
  const FLOW_B = Object.assign({}, FLOW, { staff: STAFF.concat([{ id: 'e3', name: HOSTILE, wage: 12 }]) });
  const PINS = { e1: '1234', e2: '5678', e3: '9999' };
  const BLOB = Object.assign({}, FLOW_B, { storage: undefined, factsHub: undefined, flowId: 'blobclock', staff: FLOW_B.staff.map(s => Object.assign({ pin: PINS[s.id] }, s)) });
  const errors = [], offline = [];
  let aOffline = false;
  const b = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
  const tablet = async function (label, flow, o) {
    o = o || {};
    const ctx = await b.newContext(), p = await ctx.newPage();
    p.on('console', m => { if (m.type() !== 'error') return; if (label === 'A' && aOffline && /Failed to load resource/.test(m.text())) offline.push(m.text()); else errors.push(label + ': ' + m.text()); });
    p.on('pageerror', e => errors.push(label + ' pageerror: ' + e.message));
    if (o.clock) await p.clock.install({ time: o.clock });
    if (o.bundle) await p.addInitScript({ content: bundle });
    await p.addInitScript(a => { window.CUSTOMPOS_FLOW = a.f; if (a.hub) window.CUSTOMPOS_HUB = a.hub; }, { f: flow, hub: o.hub || null });
    await p.goto(URL0);
    await p.getByRole('button', { name: /^Time Clock/ }).first().click();
    return p;
  };
  const text = async p => (await p.locator('main').innerText());
  /* headings are styled in capitals (CSS text-transform), and innerText reads them so: match case-insensitively, as tests/timeclock.js does */
  const waitFor = async function (p, re, ms) { const ri = new RegExp(re.source, re.flags.indexOf('i') >= 0 ? re.flags : re.flags + 'i'), t0 = Date.now(); while (Date.now() - t0 < (ms || 15000)) { if (ri.test(await text(p))) return true; await p.waitForTimeout(250); } return false; };
  const until = async function (fn, ms) { const t0 = Date.now(); while (Date.now() - t0 < (ms || 15000)) { if (await fn()) return true; await new Promise(r => setTimeout(r, 250)); } return false; };
  const enterPin = async function (p, pin) { for (const d of pin.split('')) await p.getByRole('button', { name: d, exact: true }).click(); await p.getByRole('button', { name: '✓', exact: true }).click(); };
  const connect = async function (p, name, tok) { await p.fill('#factsStation', name); await p.fill('#factsToken', tok); await p.getByRole('button', { name: 'Connect' }).click(); };
  const hubHas = (type, emp) => srv.hub.facts().some(e => e.type === type && e.payload.empId === emp);
  try {
    /* tablet A: a wrong device name is refused at Connect; the right one connects */
    const A = await tablet('A', FLOW, { bundle: true, hub: srv.url });
    check(await waitFor(A, /Connect this device/), 'A asks to be connected to the hub');
    check((await A.inputValue('#factsHub')) === srv.url, 'the hub address comes from setup');
    await connect(A, 'clock-x', tokA);
    check(await waitFor(A, /did not accept this device/), 'a token given with the wrong device name is refused at Connect');
    check((await A.evaluate(() => localStorage.getItem(factsKey()))) === null, 'and nothing was saved for it');
    await connect(A, 'clock-a', tokA);
    check(await waitFor(A, /Bring your team onto the hub/), 'the right name connects; a brand-new hub: A offers to bring the team on');
    check((await A.evaluate(() => JSON.stringify(localStorage))).indexOf(tokA) < 0, 'the setup token is not in the page\'s storage');
    /* the team, with PINs typed here */
    await A.fill('[data-pin="e1"]', '12'); await A.fill('[data-pin="e2"]', PINS.e2);
    await A.getByRole('button', { name: 'Add my team' }).click(); await A.waitForTimeout(400);
    check(!srv.hub.facts().some(e => e.type === 'staff.set'), 'a PIN shorter than 4 digits writes nobody');
    await A.fill('[data-pin="e1"]', PINS.e1);
    await A.getByRole('button', { name: 'Add my team' }).click();
    check(await waitFor(A, /Enter your PIN/), 'the team is on the hub and the PIN pad shows');
    const staffFacts = srv.hub.facts().filter(e => e.type === 'staff.set');
    check(staffFacts.length === 2 && staffFacts[0].payload.set.role === 'owner' && staffFacts[1].actor === 'e1', 'two staff facts: the owner first, the second written by the owner (under the hub-checked pass)');
    check(Object.values(PINS).every(p => JSON.stringify(srv.hub.facts()).indexOf('"' + p + '"') < 0), 'no plain PIN reached the hub (only hashes)');
    /* A: Alex clocks in */
    await enterPin(A, PINS.e1);
    check(await waitFor(A, /Welcome, Alex/), 'Alex clocks in on A with the PIN typed when the team came on');
    await A.getByRole('button', { name: /Start shift/ }).click();
    check(await until(() => srv.hub.facts().some(e => e.type === 'clock.in' && e.payload.empId === 'e1' && e.actor === 'e1' && !('wage' in e.payload))), 'the clock-in is on the hub, written by Alex, with no pay figure (the wage from setup applies)');
    check(await A.evaluate(() => (loadDB().activity || []).some(a => a.type === 'clock' && /Alex clocked in/.test(a.detail))), 'the clock-in is on the Activity log');
    /* reload A: it is the writer again at once */
    await A.reload(); await A.getByRole('button', { name: /^Time Clock/ }).first().click({ timeout: 1500 }).catch(() => {});
    check(await waitFor(A, /On the clock[\s\S]*Alex[\s\S]*/) && await waitFor(A, /up to date/), 'after a reload A shows Alex on the clock and is up to date (not read-only)');
    await enterPin(A, PINS.e2);
    check(await waitFor(A, /Welcome, Sam/), 'Sam clocks in on the reloaded A');
    await A.getByRole('button', { name: /Start shift/ }).click();
    check(await until(() => hubHas('clock.in', 'e2')), 'and the punch reaches the hub');
    /* the hub unreachable: A keeps the punch and says so, then sends it */
    aOffline = true; await A.context().route(srv.url + '/**', r => r.abort());
    await enterPin(A, PINS.e2); await waitFor(A, /Hi Sam/);
    await A.getByRole('button', { name: 'Clock out' }).click();
    check(await waitFor(A, /Thanks, Sam/), 'Sam clocks out on A while the hub is unreachable');
    await A.getByRole('button', { name: 'Done' }).click();
    check(await waitFor(A, /1 punch waiting to send/), 'A says one punch is waiting to send');
    check(!hubHas('clock.out', 'e2'), 'and the hub does not have it yet');
    await A.context().unroute(srv.url + '/**');
    check(await until(() => hubHas('clock.out', 'e2'), 20000) && await waitFor(A, /up to date/), 'the hub is back: the punch is sent and A is up to date');
    aOffline = false;
    /* tablet B: connect; Alex is on the clock there; B's setup has a hire the hub lacks */
    const B = await tablet('B', FLOW_B, { bundle: true, hub: srv.url });
    await connect(B, 'clock-b', tokB);
    check(await waitFor(B, /On the clock[\s\S]*Alex/), 'B, a different tablet, shows Alex on the clock');
    check(await waitFor(B, /Add 1 person to the hub/), 'B offers to add the hire the hub does not have yet');
    await B.fill('[data-pin="e3"]', PINS.e3); await B.selectOption('#factsApprover', 'e1'); await B.fill('#factsApproverPin', '0000');
    await B.getByRole('button', { name: 'Add them' }).click();
    check(await waitFor(B, /did not accept Alex's PIN/), 'a wrong approving PIN is refused by the hub');
    check(!srv.hub.facts().some(e => e.type === 'staff.set' && e.payload.staffId === 'e3'), 'and nobody was added');
    await B.getByRole('button', { name: 'Try again' }).click();
    await B.fill('[data-pin="e3"]', PINS.e3); await B.selectOption('#factsApprover', 'e1'); await B.fill('#factsApproverPin', PINS.e1);
    await B.getByRole('button', { name: 'Add them' }).click();
    check(await until(() => srv.hub.facts().some(e => e.type === 'staff.set' && e.payload.staffId === 'e3' && e.actor === 'e1')), 'with Alex\'s PIN the hire is on the hub, written by Alex');
    /* the hire's name is HTML: shown as text, never run */
    await waitFor(B, /Enter your PIN/);
    await enterPin(B, PINS.e3);
    check(await waitFor(B, /Welcome, <img src=x/), 'the hire clocks in on B; the welcome shows the name as text');
    await B.getByRole('button', { name: /Start shift/ }).click();
    check(await waitFor(A, /On the clock[\s\S]*<img src=x/), 'A lists the hire on the clock, as text');
    check((await A.evaluate(() => window.__pwned)) === undefined && (await B.evaluate(() => window.__pwned)) === undefined, 'the name\'s HTML ran on neither tablet');
    /* B: Alex takes a break and clocks out; the hire clocks out */
    await enterPin(B, PINS.e1);
    check(await waitFor(B, /Hi Alex/), 'Alex enters the PIN on B and gets the on-shift screen');
    await B.getByRole('button', { name: 'Start break' }).click();
    check(await waitFor(B, /End break/), 'a break starts');
    await B.getByRole('button', { name: /End break/ }).click();
    check(await waitFor(B, /Start break/), 'and ends');
    await B.getByRole('button', { name: 'Clock out' }).click();
    check(await waitFor(B, /Thanks, Alex/), 'Alex clocks out on B');
    await B.getByRole('button', { name: 'Done' }).click();
    await enterPin(B, PINS.e3); await waitFor(B, /Hi /); await B.getByRole('button', { name: 'Clock out' }).click(); await waitFor(B, /Thanks, /); await B.getByRole('button', { name: 'Done' }).click();
    check(await waitFor(A, /Nobody clocked in/) && await waitFor(B, /Nobody clocked in/), 'both tablets see nobody on the clock');
    const pb = await B.evaluate(() => loadDB().punches), alex = pb.find(p => p.staffId === 'e1');
    check(pb.length === 3 && alex && alex.outTs > alex.inTs && alex.breaks.length === 1 && alex.breaks[0].endTs != null && alex.wage === null, 'B\'s punches: three closed shifts; Alex\'s with its break, and no pay figure of its own');
    /* THE GATE: blob mode's own clock functions, run for the same actions at the same moments under a fixed browser clock */
    const acts = [];
    pb.forEach(p => { acts.push([p.inTs, 'in', p.staffId]); p.breaks.forEach(x => { acts.push([x.startTs, 'bs', p.staffId]); acts.push([x.endTs, 'be', p.staffId]); }); acts.push([p.outTs, 'out', p.staffId]); });
    acts.sort((x, y) => x[0] - y[0]);
    const C = await tablet('C', BLOB, { clock: acts[0][0] - 1000 });
    for (const a of acts) {
      await C.clock.setFixedTime(a[0]);
      await C.evaluate(x => { const s = FLOW.staff.find(y => y.id === x[1]); DB = loadDB(); ({ in: clockIn, out: clockOut, bs: startBreak, be: endBreak })[x[0]](s); clockWelcome = null; }, [a[1], a[2]]);
    }
    const shape = ps => ps.map(p => [p.staffId, p.name, p.inTs, p.outTs, p.breaks.map(x => [x.startTs, x.endTs])]).sort((x, y) => x[2] - y[2]);
    const pc = await C.evaluate(() => loadDB().punches);
    check(JSON.stringify(shape(pb)) === JSON.stringify(shape(pc)), 'every shift time from the shared punches equals what blob mode recorded for the same actions');
    const fromFacts = await B.evaluate(() => ({ pool: poolHours(), labor: dayLaborCost() }));
    const fromBlob = await C.evaluate(() => { DB = loadDB(); return { pool: poolHours(), labor: dayLaborCost() }; });
    check(JSON.stringify(fromFacts) === JSON.stringify(fromBlob) && fromFacts.labor > 0, 'the tip pool and labor cost are the same as blob mode\'s own (labor $' + fromFacts.labor.toFixed(4) + ')');
    /* Disconnect, then connect again */
    await B.getByRole('button', { name: 'Disconnect this device' }).click();
    check(await waitFor(B, /Connect this device/) && (await B.evaluate(() => localStorage.getItem(factsKey()))) === null, 'Disconnect: B forgets the hub');
    await connect(B, 'clock-b', tokB);
    check(await waitFor(B, /Enter your PIN/), 'and connects again');
    /* a tablet's punches from before it joined the hub are kept */
    const ctxD = await b.newContext(), D = await ctxD.newPage();
    D.on('console', m => { if (m.type() === 'error') errors.push('D: ' + m.text()); }); D.on('pageerror', e => errors.push('D pageerror: ' + e.message));
    await D.addInitScript(f => { window.CUSTOMPOS_FLOW = f; }, FLOW);
    await D.goto(URL0); await D.getByRole('button', { name: /^Time Clock/ }).first().click();
    await D.evaluate(() => { const db = loadDB(); const t = Date.now() - 86400000; db.punches = [{ staffId: 'old1', name: 'Pat', in: '08:00', inTs: t, out: '12:00', outTs: t + 14400000, breaks: [], wage: 11 }]; persistDB(db); });
    await D.addInitScript({ content: bundle });
    await D.reload(); await D.getByRole('button', { name: /^Time Clock/ }).first().click({ timeout: 1500 }).catch(() => {});
    await connect(D, 'clock-d', tokD);
    check(await waitFor(D, /Enter your PIN/), 'a tablet that ran on its own connects');
    check(await until(async () => { const ps = await D.evaluate(() => loadDB().punches); return ps.some(p => p.staffId === 'old1') && ps.filter(p => p.staffId !== 'old1').length === 3; }), 'and keeps its punches from before, beside the hub\'s three');
    /* the negative control: blob mode through the same real hub carries a record, but not a clock-in */
    const X = await tablet('X', BLOB, { hub: srv.url }), Y = await tablet('Y', BLOB, { hub: srv.url });
    await X.evaluate(() => { DB = loadDB(); DB.seq = (DB.seq || 0) + 1; DB.records.push({ id: 'Rneg', number: DB.seq, lines: [], tenders: [], createdAt: '09:00', ts: Date.now() }); saveDB(DB); });
    check(await until(async () => (await Y.evaluate(() => loadDB().records)).some(r => r.id === 'Rneg')), 'blob mode: a record made on X reaches Y through the hub (the hub is live)');
    await enterPin(X, PINS.e2); await X.getByRole('button', { name: /Start shift/ }).click();
    await Y.waitForTimeout(4000); await Y.reload(); await Y.getByRole('button', { name: /^Time Clock/ }).first().click({ timeout: 1500 }).catch(() => {});
    check(/On the clock[\s\S]*Sam/i.test(await text(X)) && !(/On the clock[\s\S]*Sam/i.test(await text(Y))), 'but Sam\'s clock-in on X is not on Y (the gap facts mode closes)');
    check(offline.length > 0, 'the cut-off requests were really refused while A was offline (' + offline.length + ')');
    check(!errors.length, 'no console errors' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
  } catch (e) { check(false, 'the run broke: ' + (e && e.stack || e)); }
  finally { await b.close(); await srv.close(); try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {} }
  console.log('\n' + (fail ? 'facts clock: ' + fail + ' failed' : 'facts clock: all checks passed'));
  process.exit(fail ? 1 : 0);
})();
