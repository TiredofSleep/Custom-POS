'use strict';
/* @facts @proof — THE HUB AS A SHOP STARTS IT: the documented command, run as its own process (stage-2 review: every other test built the
   hub in-process WITH modules, so none noticed the command ran with no rules at all). This repo's own file.
   - it runs the staff and time clock modules: a PIN pass is issued, a break lands, a clerk's correction is refused;
   - a station name the judge trusts is never enrolled to a device;
   - with --with-blob it serves only its records and the app's files — not its data folder — and a malformed request is a 400, never a
     dead hub; and it refuses to start with its data inside the folder it serves.
   node facts/test/cli.test.js */
const H = require('./harness');
const fs = require('fs'), os = require('os'), path = require('path'), net = require('net'), cp = require('child_process'), http = require('http');
const { makeStation } = require('../core/station');
const { httpHub, attach } = require('../sync/http');
const S = require('../modules/staff');
require('../modules/timeclock');   /* the station side knows the time clock's facts too (a tablet's bundle carries them) */

const KEY = 'test-operator-key-cli-000001', SERVER = path.join(__dirname, '..', 'server.js');
/* @proof — a free port on 127.0.0.1 */
function freePort() { return new Promise(function (ok) { const s = net.createServer(); s.listen(0, '127.0.0.1', function () { const p = s.address().port; s.close(function () { ok(p); }); }); }); }
/* @proof — the hub started as the docs say, as its own process; resolves when it says it is listening (or rejects with what it said) */
function startCli(args, env) {
  return new Promise(function (ok, no) {
    const ch = cp.spawn(process.execPath, [SERVER].concat(args), { env: Object.assign({}, process.env, env || {}), stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '', done = false;
    const fin = function (f, v) { if (!done) { done = true; f(v); } };
    ch.stdout.on('data', function (d) { out += d; if (/facts hub on (http:\/\/[^\s]+)/.test(out)) fin(ok, { ch: ch, url: RegExp.$1 }); });
    ch.stderr.on('data', function (d) { err += d; });
    ch.on('exit', function (code) { fin(no, new Error('exited ' + code + ': ' + err.trim())); });
    setTimeout(function () { fin(no, new Error('no start in 10 s: ' + out + err)); }, 10000);
  });
}
async function post(base, p, body, headers) { const r = await fetch(base + p, { method: 'POST', headers: Object.assign({ 'content-type': 'application/json' }, headers || {}), body: JSON.stringify(body) }); return { status: r.status, json: await r.json() }; }
async function settle(T) { for (let i = 0; i < 300 && T.inFlight; i++) await new Promise(function (r) { setTimeout(r, 10); }); }
function jstore() { const lines = []; let access = null; return { load: function () { return JSON.parse(JSON.stringify(lines)); }, append: function (row) { lines.push(JSON.parse(JSON.stringify(row))); }, loadAccess: function () { return access; }, saveAccess: function (a) { access = a; } }; }
/* @proof — a raw GET (fetch would normalise a malformed escape away) */
function rawGet(port, p) { return new Promise(function (ok) { const r = http.request({ host: '127.0.0.1', port: port, path: p, method: 'GET' }, function (res) { res.resume(); res.on('end', function () { ok(res.statusCode); }); }); r.on('error', function () { ok('error'); }); r.end(); }); }

H.section('cli · the hub started the way the docs say (node facts/server.js …)');

H.testAsync('the documented command runs the modules, refuses a reserved name, serves only its allow-list, survives a malformed request', async function () {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'custompos-cli-')), port = await freePort();
  const hub = await startCli(['--db', path.join(dir, 'facts.db'), '--port', String(port), '--with-blob'], { CUSTOMPOS_ADMIN_KEY: KEY, DATA: path.join(dir, 'blob.json') });
  try {
    const tok = (await post(hub.url, '/v2/admin/enroll', { station: 'tab' }, { 'x-custompos-admin': KEY })).json.token;
    H.eq((await post(hub.url, '/v2/admin/enroll', { station: 'hub-services' }, { 'x-custompos-admin': KEY })).status, 400, 'a name the judge trusts is never enrolled to a device');
    const wrong = await post(hub.url, '/v2/receive', { station: 'tab2', token: tok, events: [] });
    H.ok(wrong.json.refused && /different device name/.test(wrong.json.refused), 'a send under a name its token was not enrolled as is refused whole (how Connect catches a mistyped name)');
    H.ok(!(await post(hub.url, '/v2/receive', { station: 'tab', token: tok, events: [] })).json.refused, 'and under its own name it is not');
    const T = makeStation({ id: 'tab', persist: jstore() }); T.setAccess(tok); const remote = httpHub(hub.url); attach(T, remote);
    T.passes = []; T.setTransport(function (b) { b.grants = T.passes; return remote.receive(b); });
    const put = async function (type, key, p, actor) { const e = T.record(type, key, p, { actor: actor }); await settle(T); return { ok: !!T.log.get(e.id).pos, id: e.id }; };
    H.ok((await put('staff.set', 'own', { staffId: 'own', set: { name: 'Ola', role: 'owner', pin: S.pinRecord('1111') } }, null)).ok, 'the owner is written first');
    const pin = await post(hub.url, '/v2/pin', { token: tok, staffId: 'own', pin: '1111' });
    H.ok(pin.status === 200 && pin.json.grant, 'a PIN pass is issued: the staff module runs (it answered 404 before the fix)');
    T.passes = [pin.json.grant];
    H.ok((await put('staff.set', 'clk', { staffId: 'clk', set: { name: 'Cam', pin: S.pinRecord('3333') } }, 'own')).ok, 'the owner adds a clerk under the pass');
    T.passes = [];
    const inn = await put('clock.in', 'clk', { empId: 'clk', at: Date.now() - 3600000 }, 'clk');
    H.ok(inn.ok && (await put('break.start', 'clk', { empId: 'clk', shiftId: inn.id, at: Date.now() - 1800000 }, 'clk')).ok, 'a clock-in and a break land: the time clock module runs');
    H.ok(!(await put('clock.edit', 'clk', { empId: 'clk', shiftId: inn.id, in: Date.now() - 7200000 }, 'clk')).ok, 'a clerk\'s correction is refused: the rules are on');
    /* the allow-list: records and the app's files only */
    H.eq((await fetch(hub.url + '/pos.html')).status, 200, 'the app itself is served');
    H.eq((await fetch(hub.url + '/api/db')).status, 200, 'and the shared records');
    H.eq((await fetch(hub.url + '/package.json')).status, 404, 'but not the folder\'s other files');
    H.eq((await fetch(hub.url + '/facts/modules/pingrant.js')).status, 404, 'nor the hub\'s own code');
    H.ok([400, 404].indexOf(await rawGet(port, '/%E0%A4%A')) >= 0, 'a malformed escape is refused');
    H.eq((await (await fetch(hub.url + '/v2/health')).json()).ok, true, 'and the hub is still alive after it');
  } finally { hub.ch.kill(); await new Promise(function (r) { hub.ch.on('exit', r); setTimeout(r, 2000); }); fs.rmSync(dir, { recursive: true, force: true }); }
});

H.testAsync('with --with-blob the hub refuses to keep its data inside the folder it serves (where its database and PIN-pass key would be one GET away)', async function () {
  const port = await freePort(), inside = path.join(__dirname, '..', '..', 'hub-data-cli-test', 'facts.db');
  let msg = '';
  try { const h = await startCli(['--db', inside, '--port', String(port), '--with-blob'], { CUSTOMPOS_ADMIN_KEY: KEY }); h.ch.kill(); } catch (e) { msg = String(e.message); }
  H.ok(/must live outside it/.test(msg), 'refused: ' + msg.slice(0, 160));
  H.ok(!fs.existsSync(inside), 'and it made no database there');
  /* the negative control: the same data place WITHOUT --with-blob (it serves no files) starts */
  const port2 = await freePort(), dir = fs.mkdtempSync(path.join(os.tmpdir(), 'custompos-cli2-'));
  const h2 = await startCli(['--db', path.join(dir, 'facts.db'), '--port', String(port2)], { CUSTOMPOS_ADMIN_KEY: KEY });
  try { H.eq((await (await fetch(h2.url + '/v2/health')).json()).ok, true, 'a hub that serves no files may keep its data anywhere'); H.eq((await fetch(h2.url + '/pos.html')).status, 404, 'and it serves no files'); }
  finally { h2.ch.kill(); await new Promise(function (r) { h2.ch.on('exit', r); setTimeout(r, 2000); }); fs.rmSync(dir, { recursive: true, force: true }); try { fs.rmSync(path.dirname(inside), { recursive: true, force: true }); } catch (e) {} }
});

H.done();
