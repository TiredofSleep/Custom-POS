#!/usr/bin/env node
/* test-render-live.js — draw every screen against the REAL database. READ-ONLY.
 *
 *   node test-render-live.js                                   (on the droplet: /opt/ozark + live hub-data)
 *   node test-render-live.js Ozark-POS.html path/to/db.json
 *
 * ⚠️ WHY THIS EXISTS, AND IT COST A MORNING. On 2026-08-13 the Hot Springs counter could not use the Detail
 * screen at all: "this screen hit a snag" on every attempt. renderDetail reads `o.lines.length`, and six orders
 * had no `lines` array — built by a repair script that never set it. ALL SEVEN GATES WERE GREEN THE WHOLE TIME.
 * test-render.js draws all 31 screens and passed, because it draws them against SEEDED data where every order is
 * well formed. The fault could only exist in real records, so nothing that tests the code could ever see it.
 *
 * The gates ask "is this code correct?". This asks the question they cannot: **"does this build survive the shop
 * we actually have?"** Same screens, same render map — real customers, real orders, real edge cases that nobody
 * would think to seed: an order with no lines, a customer with no prefs, a business with no contact person, a
 * split naming a bag that no longer exists.
 *
 * ⚠️ It renders each screen for MANY records, not one. Brittany's fault was invisible on 17 of 23 detailable
 * orders — a single sample would have passed and sent everyone home confident.
 *
 * Nothing is written. It never touches the hub API; it reads the database file directly.
 */
'use strict';
const fs = require('fs'), vm = require('vm'), path = require('path');

const APP = process.argv[2] || (fs.existsSync('/opt/ozark/Ozark-POS.html') ? '/opt/ozark/Ozark-POS.html'
                                                                          : path.join(__dirname, 'Ozark-POS.html'));
const DBF = process.argv[3] || '/opt/ozark/hub-data/ozark-db.json';
if (!fs.existsSync(DBF)) {
  console.log('no live database at ' + DBF + ' — this gate only means something where the real data lives.');
  console.log('Run it on the droplet, or pass a snapshot: node test-render-live.js <app.html> <db.json>');
  process.exit(0);                       /* ⚠️ absent data is not a failure — it is "not applicable here" */
}
const html = fs.readFileSync(APP, 'utf8');
const appJs = (html.match(/<script>([\s\S]*)<\/script>/) || [])[1];
if (!appJs) { console.error('no inline <script> in ' + APP); process.exit(1); }

/* ---- a DOM that answers anything without throwing, so a fault is the APP's and never the harness's ---- */
const makeStorage = () => { const s = {}; return { getItem: k => (k in s ? s[k] : null),
  setItem: (k, v) => { s[k] = String(v); }, removeItem: k => { delete s[k]; }, clear: () => { for (const k in s) delete s[k]; } }; };
const fakeEl = () => new Proxy(function(){}, {
  get(t, p){ if (p === 'style') return {};
    if (p === 'classList') return { add(){}, remove(){}, toggle(){}, contains(){ return false; } };
    if (p === 'value' || p === 'textContent' || p === 'innerHTML' || p === 'id') return '';
    if (p === 'children' || p === 'childNodes' || p === 'files') return [];
    if (p === 'checked') return false;
    if (typeof p === 'symbol') return undefined;
    return fakeEl(); }, apply(){ return fakeEl(); }, set(){ return true; } });
const documentStub = new Proxy({}, { get(t, p){
  if (p === 'getElementById' || p === 'querySelector') return () => null;
  if (p === 'querySelectorAll') return () => [];
  if (p === 'createElement') return () => fakeEl();
  if (p === 'body' || p === 'documentElement' || p === 'head') return fakeEl();
  if (p === 'addEventListener' || p === 'removeEventListener') return () => {};
  if (p === 'activeElement') return null;
  if (typeof p === 'symbol') return undefined;
  return () => fakeEl(); } });
const sandbox = { console: { log(){}, warn(){}, error(){}, info(){} }, JSON, Math, Date, parseInt, parseFloat,
  isNaN, isFinite, String, Number, Boolean, Array, Object, RegExp, Error, TypeError, Set, Map, Promise,
  encodeURIComponent, decodeURIComponent, setTimeout: () => 0, clearTimeout: () => {}, setInterval: () => 0,
  clearInterval: () => {}, fetch: () => new Promise(() => {}), localStorage: makeStorage(),
  sessionStorage: makeStorage(), document: documentStub, location: { href: 'http://x/', protocol: 'http:', hostname: 'x' },
  navigator: { userAgent: 'node', onLine: true }, alert: () => {}, confirm: () => true, prompt: () => null,
  indexedDB: { open: () => ({}) }, crypto: { getRandomValues: a => a }, requestAnimationFrame: () => 0,
  matchMedia: () => ({ matches: false, addListener(){}, addEventListener(){} }),
  BroadcastChannel: function(){ return { postMessage(){}, close(){}, onmessage: null }; },
  performance: { now: () => 0 }, btoa: s => s, atob: s => s,
  URL: { createObjectURL: () => '', revokeObjectURL(){} },
  addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => true,
  scrollTo: () => {}, open: () => null };
sandbox.window = sandbox; sandbox.globalThis = sandbox; sandbox.self = sandbox;
vm.createContext(sandbox);
const run = c => vm.runInContext(c, sandbox, { timeout: 30000 });

run(appJs);
const raw = fs.readFileSync(DBF, 'utf8');
sandbox.__LIVE = JSON.parse(raw);                       /* ⚠️ handed over as an OBJECT — building a string and
                                                           eval'ing it would let a $ in the data corrupt the code */
run("DB = (__LIVE && __LIVE.db && __LIVE.db.orders) ? __LIVE.db : __LIVE;");
run("state = { store:1, allStores:true, employeeId:null, params:{}, screen:'home' };");

const counts = run("JSON.stringify({orders:(DB.orders||[]).length, customers:(DB.customers||[]).length})");
const C = JSON.parse(counts);
console.log('══ LIVE RENDER GATE ══  ' + C.orders + ' real orders · ' + C.customers + ' real customers');
console.log('   the question the other gates cannot ask: does this build survive the shop we actually have?\n');

/* the app's OWN render map, so a new screen is covered the day it ships */
const mapSrc = (appJs.match(/const r=\{home:renderHome[\s\S]*?\}\[state\.screen\]/) || [])[0] || '';
const SCREENS = [...new Set((mapSrc.match(/([a-zA-Z]+):render[A-Za-z]+|([a-zA-Z]+):arDash/g) || [])
  .map(s => s.split(':')[0]))];
if (SCREENS.length < 20) { console.error('could not scrape the render map — refusing to pretend this gate ran'); process.exit(1); }

/* the records each screen is opened ON. Sampled broadly on purpose: the 8/13 fault was invisible on 17 of 23
   detectable orders, so one sample per screen would have passed and taught us the build was fine. */
const pick = expr => JSON.parse(run("JSON.stringify(" + expr + ")"));
const detailable = pick("(DB.orders||[]).filter(function(o){return ['Received','Detailed','In Process'].indexOf(o.status)>=0;}).map(function(o){return o.id;})");
const anyOrder   = pick("(DB.orders||[]).slice(-120).map(function(o){return o.id;})");
const withCust   = pick("(DB.customers||[]).slice(-120).map(function(c){return c.id;})");
const routeCust  = pick("(DB.customers||[]).filter(function(c){return c.route;}).map(function(c){return c.id;})");

const PARAMS = {
  detail:   detailable.map(id => ({ orderId: id })),
  order:    anyOrder.map(id => ({ orderId: id })),
  assemble: anyOrder.slice(-40).map(id => ({ orderId: id })),
  pickup:   withCust.map(id => ({ cid: id })),
  routeConfirm: routeCust.map(id => ({ cid: id })),
  routeStop:    routeCust.map(id => ({ cid: id })),
  garment:  pick("(DB.garments||[]).slice(-40).map(function(g){return {hsl:g.hsl};})")
};

let drawn = 0, failed = 0;
const seen = new Set();
SCREENS.forEach(scr => {
  const cases = PARAMS[scr] && PARAMS[scr].length ? PARAMS[scr] : [{}];
  let bad = 0, firstMsg = '', firstWhere = '';
  cases.forEach(p => {
    drawn++;
    try {
      sandbox.__P = p;
      run("state.screen=" + JSON.stringify(scr) + "; state.params=__P;");
      const h = run("(function(){ var r=(" + renderNameFor(scr) + ")(); return typeof r==='string'?r:String(r); })()");
      if (!h || h.length < 20) { bad++; if (!firstMsg) { firstMsg = 'drew only ' + (h ? h.length : 0) + ' characters'; firstWhere = JSON.stringify(p); } }
    } catch (e) {
      bad++;
      if (!firstMsg) { firstMsg = (e && e.message) || String(e); firstWhere = JSON.stringify(p); }
    }
  });
  if (bad) {
    failed++;
    const sig = scr + '|' + firstMsg;
    if (!seen.has(sig)) {
      seen.add(sig);
      console.log('  ✗ ' + scr.padEnd(16) + bad + ' of ' + cases.length + ' real record(s) break this screen');
      console.log('      ' + firstMsg);
      console.log('      first seen with ' + firstWhere);
    }
  }
});

/* ⚠️ Call the screen's function BY NAME, taken from the app's own render map. Going through render() itself
   would be useless here: render() CATCHES, which is precisely the swallow that hid this fault from the hub. */
function renderNameFor(s){
  const hit = (mapSrc.match(new RegExp('\\b' + s + ':([a-zA-Z]+)')) || [])[1];
  return hit || ('render' + s.charAt(0).toUpperCase() + s.slice(1));
}

console.log('');
console.log(failed ? ('══ ' + failed + ' screen(s) fail on real data · ' + drawn + ' draws attempted ══')
                   : ('══ all ' + SCREENS.length + ' screens survive the real shop · ' + drawn + ' draws ══'));
process.exit(failed ? 1 : 0);
