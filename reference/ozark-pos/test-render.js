#!/usr/bin/env node
/* test-render.js — THE RENDER GATE. Actually draws every screen and reads what comes out.
 *
 *   node test-render.js Ozark-POS.html
 *
 * Owner, 2026-08-08: "build the render test gate."
 *
 * WHY THIS EXISTS. On 2026-08-08 a collapse brace closed after a `const` that was used below it, so
 * renderRoute threw "log is not defined" and the route board was blank. `check-app-js.js` passed (the file
 * parses fine), `test-money.js` passed (no test rendered that screen), `check-dead-buttons.js` passed (no
 * handler was missing) — and it shipped. Every existing gate reads the SOURCE. None of them ever drew a
 * screen. This one does.
 *
 * The screen list is scraped from the app's own render map, so a screen added tomorrow is covered without
 * anyone remembering to add it here. If the scrape ever breaks, the count assertion below fails loudly
 * rather than quietly testing nothing — an empty test suite that reports success is worse than no suite.
 *
 * Each screen is drawn against THREE data states, because crashes hide in the empty ones:
 *   1. a bare shop      — no customers, no orders (first-run, and the state after a reset)
 *   2. a working shop   — customers, orders in every status, money owed, a drawer, notes and flags
 *   3. every disclosure open — the collapsed sections from 8/08 must render when expanded too
 *
 * and checked for the things that are always bugs:
 *   • a throw
 *   • empty output
 *   • the literal text "undefined" / "null" / "NaN" / "[object Object]" reaching a human
 *   • an onclick calling a function that does not exist
 *   • unbalanced <div>s (a missing close tag swallows the rest of the screen)
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const file = process.argv[2] || path.join(__dirname, 'Ozark-POS.html');
const html = fs.readFileSync(file, 'utf8');
const m = html.match(/<script>([\s\S]*)<\/script>/);
if (!m) { console.error('no inline <script> found in ' + file); process.exit(1); }
const appJs = m[1];

/* ---------- the same DOM-less sandbox the money harness uses ---------- */
const makeStorage = () => { const s = {}; return {
  getItem: k => (k in s ? s[k] : null), setItem: (k, v) => { s[k] = String(v); },
  removeItem: k => { delete s[k]; }, clear: () => { Object.keys(s).forEach(k => delete s[k]); },
  key: i => Object.keys(s)[i] || null, get length(){ return Object.keys(s).length; } }; };
const fakeEl = () => new Proxy(function(){}, {
  get(t, k){
    if (k === 'style') return new Proxy({}, { get: () => '', set: () => true });
    if (k === 'classList') return { add(){}, remove(){}, toggle(){}, contains: () => false };
    if (k === 'value' || k === 'innerHTML' || k === 'textContent' || k === 'innerText' || k === 'id' || k === 'className') return '';
    if (k === 'children' || k === 'childNodes' || k === 'options' || k === 'files' || k === 'rows') return [];
    if (k === 'checked' || k === 'disabled' || k === 'selected') return false;
    if (k === 'length') return 0;
    if (k === Symbol.toPrimitive || k === 'toString') return () => '';
    return fakeEl();
  },
  set(){ return true; }, apply(){ return fakeEl(); },
});
const documentStub = new Proxy({}, {
  get(t, k){
    if (k === 'getElementById') return () => null;
    if (k === 'createElement' || k === 'createTextNode') return () => fakeEl();
    if (k === 'querySelector') return () => null;
    if (k === 'querySelectorAll' || k === 'getElementsByTagName' || k === 'getElementsByClassName') return () => [];
    if (k === 'addEventListener' || k === 'removeEventListener') return () => {};
    if (k === 'body' || k === 'head' || k === 'documentElement' || k === 'activeElement') return fakeEl();
    if (k === 'title') return '';
    if (k === 'cookie') return '';
    return fakeEl();
  },
  set(){ return true; },
});
const sandbox = {
  console, JSON, Math, Date, Promise, Object, Array, String, Number, Boolean, RegExp, Error, TypeError,
  parseInt, parseFloat, isNaN, isFinite, encodeURIComponent, decodeURIComponent, URL, Map, Set, Symbol,
  Proxy, Reflect, Buffer, escape, unescape,
  document: documentStub, localStorage: makeStorage(), sessionStorage: makeStorage(),
  location: { protocol: 'file:', origin: 'null', href: 'file:///harness', search: '', hostname: '' },
  navigator: { userAgent: 'test-harness', clipboard: { writeText: () => Promise.resolve() } },
  indexedDB: { open: () => fakeEl(), deleteDatabase: () => fakeEl() },
  fetch: () => Promise.reject(new Error('no network in harness')),
  setInterval: () => 0, clearInterval: () => {}, setTimeout: () => 0, clearTimeout: () => {},
  alert: () => {}, confirm: () => true, prompt: () => null,
  print: () => {}, matchMedia: () => ({ matches: false, addListener: () => {}, addEventListener: () => {} }),
  Image: function(){ return fakeEl(); }, Audio: function(){ return fakeEl(); },
  MutationObserver: function(){ return { observe(){}, disconnect(){} }; },
  /* a real browser always provides this; leaving it undefined made renderAssemble throw in the harness
     for a reason that could never happen on a shop PC — a gate that cries wolf gets ignored. */
  speechSynthesis: { getVoices: () => [], speak(){}, cancel(){}, addEventListener(){} },
  SpeechSynthesisUtterance: function(){ return { }; },
  requestAnimationFrame: () => 0, addEventListener: () => {}, removeEventListener: () => {},
  screen: { width: 1280, height: 800 }, history: { pushState(){}, replaceState(){} },
  performance: { now: () => Date.now() },
  scrollTo: () => {}, scrollBy: () => {}, getSelection: () => ({ removeAllRanges(){} }), focus: () => {}, blur: () => {},
};
sandbox.window = sandbox; sandbox.self = sandbox; sandbox.globalThis = sandbox;
sandbox.__APPSRC = appJs;
vm.createContext(sandbox);
try { new vm.Script(appJs, { filename: file }).runInContext(sandbox, { timeout: 30000 }); }
catch (e) {
  console.error('App script failed to LOAD:\n' + (e.stack || e).toString().split('\n').slice(0, 8).join('\n'));
  process.exit(1);
}
const run = code => vm.runInContext(code, sandbox, { timeout: 15000 });

let pass = 0, fail = 0;
const bad = [];
function check(name, ok, detail){
  if (ok) { pass++; return; }
  fail++; bad.push('  ✗ ' + name + (detail ? '\n        ' + detail : ''));
}

/* ---------- 1. the screen list, scraped from the app's own render map ---------- */
const mapSrc = (appJs.match(/const r=\{home:renderHome[\s\S]*?\}\[state\.screen\]/) || [])[0] || '';
const SCREENS = [...new Set((mapSrc.match(/([a-zA-Z]+):render[A-Za-z]+|([a-zA-Z]+):arDash/g) || [])
  .map(s => s.split(':')[0]))];
console.log('══ RENDER GATE ══  ' + SCREENS.length + ' screens scraped from the app\'s own render map\n');
if (SCREENS.length < 25) {
  console.error('❌ Only ' + SCREENS.length + ' screens found — the scrape broke, so this gate is testing almost' +
    ' nothing. Fix the regex against render()\'s map before trusting a pass.');
  process.exit(1);
}

/* params each screen needs to draw something real */
const PARAMS = {
  pickup: { customerId: 'C1' }, order: { orderId: 'O_READY' }, detail: { orderId: 'O_DETAIL' },
  quickform: { cid: 'C1' }, garment: { hsl: '20042465' }, routeStop: { cid: 'C_ROUTE' },
  routeConfirm: { cid: 'C_ROUTE' }, arcollect: { cid: 'C_ACCT' }, msglog: { cid: 'C1' },
  driver: { route: 'Hot Springs Route' }, route: { route: 'Hot Springs Route' },
  admin: { tab: 'reports' }, search: { q: '' }, quote: {},
};

/* ---------- 2. the three data states ---------- */
/* the app seeds a fresh device itself (prices, employees, settings, checklists) — use ITS seed, not a
   hand-built stub, so the gate draws against the same shape a real first-run device has. In the harness the
   IndexedDB callbacks never fire, so DB is still null at this point. */
run("DB = seed(); state = { store:1, allStores:false, employeeId:null, params:{}, screen:'home' };");
check("the app's own seed produced a usable DB", run('!!(DB && DB.settings && DB.prices && DB.employees)'), 'seed() returned nothing usable');

const SEED_EMPTY = `
  /* assign rather than truncate: seed() predates some collections (that is exactly the 8/05 bug where an old
     build had no DB.collections), and the loadDB migration that adds them never runs in the harness. */
  ['customers','orders','payments','ledger','collections','activity','routeLog','garments','batches',
   'voidRequests','refundRequests','timeclock','timeAcks','timeOff','smsLog','inventoryLog','hslLog',
   'supplies','prices','upcharges'].forEach(function(k){ if(!Array.isArray(DB[k])) DB[k]=[]; });
  ['customers','orders','payments','ledger','collections','activity','routeLog','garments','batches',
   'voidRequests'].forEach(function(k){ DB[k].length=0; });
  DB.drawers={}; DB.checklistDone={}; window.__disc={};
  state.employeeId=(DB.employees[0]||{}).id; state.store=1; state.allStores=false; state.params={};
`;
const SEED_FULL = SEED_EMPTY + `
  DB.customers.push({id:'C1',first:'Jesse',last:'Sheriff',phone:'8705550021',mainStore:1,balance:0,prefs:{starch:'Light'},
    reminder:'Always call before pressing his suits',
    cards:[{id:'k1',token:'TK',brand:'Visa',last4:'4242',exp:'03/28',default:true}]});
  DB.customers.push({id:'C_ACCT',first:'National Park',last:'Medical',phone:'5015550030',mainStore:2,isAccount:true,
    billMonthly:true,balance:346.03,prefs:{},cards:[],email:'ap@example.com'});
  DB.customers.push({id:'C_ROUTE',first:'Dana',last:'Stop',phone:'5015550031',mainStore:2,route:'Hot Springs Route',
    stop:2,address:'1 Main St, Hot Springs',needsPickup:true,routeNotes:'Gate code 4412',prefs:{},cards:[]});
  DB.customers.push({id:'C_CREDIT',first:'Owed',last:'Money',phone:'5015550000',mainStore:1,balance:-37.93,prefs:{},cards:[]});
  function _ln(n,tag,flag){ var a=[]; for(var j=0;j<n;j++){ var l={item:'Pants',desc:'Pants - Pants',price:7,
    assembled:true,hsl:tag+j,priceId:(DB.prices[0]||{}).id,upcharges:[]};
    if(flag&&j===1) l.issue={note:'Third button is cracked',by:'MG',ts:1}; a.push(l); } return a; }
  var _sts=['Received','Quick','Detailed','In Process','Assembled','Racked','Ready','PickedUp','Void','Split'];
  _sts.forEach(function(st,i){
    DB.orders.push({id:'O_'+st.replace(/ /g,''),number:'1-08-0'+((i%9)+1)+'-26-01'+i,customerId:['C1','C_ACCT','C_ROUTE'][i%3],
      storeId:(i%2)+1,status:st,rackLoc:(st==='Ready'||st==='Racked')?'#6'+i:'',promise:'2026-08-1'+(i%9),
      paymentStatus:i%3?'unpaid':'paid',payMethod:i%3?'':'Card',pieceCount:4,createdAt:Date.now()-i*86400000,
      splits:[{number:'b1',lineIdx:[0,1],rackLoc:'#6'+i},{number:'b2',lineIdx:[2,3],rackLoc:''}],
      orderUpcharges:i===2?[{name:'Rush',amt:5,basis:'flat'}]:[],
      asmReminders:i===1?[{id:'ar1',text:'Match with the grey jacket',by:'MG',at:1,done:false}]:[],
      lines:_ln(4,'200'+i, i===1)});
  });
  DB.orders.push({id:'O_READY',number:'1-08-08-26-0999',customerId:'C1',storeId:1,status:'Ready',rackLoc:'#77',
    promise:'2026-08-12',paymentStatus:'unpaid',pieceCount:4,createdAt:Date.now(),
    splits:[{number:'b1',lineIdx:[0,1],rackLoc:'#77'}],orderUpcharges:[],asmReminders:[],lines:_ln(4,'999',true)});
  DB.orders.push({id:'O_DETAIL',number:'1-08-08-26-0998',customerId:'C1',storeId:1,status:'Detailed',rackLoc:'',
    promise:'2026-08-12',paymentStatus:'unpaid',pieceCount:2,createdAt:Date.now(),
    splits:[],orderUpcharges:[],asmReminders:[],lines:_ln(2,'998')});
  DB.garments.push({hsl:'20042465',desc:'Blouse',color:'Navy',brand:'Van Heusen',custId:'C1',ts:Date.now()});
  DB.payments.push({id:'p1',orderId:'O_PickedUp',customerId:'C1',amount:30.66,method:'Card',date:Date.now(),ref:'R1'});
  DB.ledger.push({id:'l1',customerId:'C_ACCT',orderId:'O_Racked',type:'charge',amount:75.60,date:Date.now(),note:'Account'});
  DB.collections.push({id:'col1',ts:Date.now(),customerId:'C1',customerName:'Jesse Sheriff',phone:'8705550021',
    orderId:'O_PickedUp',orderNumber:'1-08-08-26-0100',pieces:4,amount:26.85,reason:'deferred',
    detail:'Driver chose collect later',status:'open'});
  DB.routeLog.push({id:'rl1',ts:Date.now(),type:'delivery',custId:'C_ROUTE',orderId:'O_Ready',by:'Dana'});
  DB.activity.push({ts:Date.now(),emp:'MG',ws:'Counter',store:1,type:'Quick Receive',detail:'1-08-08-26-0999 · 4 pieces'});
  DB.drawers[homeStore()+'|d1']={status:'open',open:{by:'M',at:Date.now(),total:200,counts:{}}};
`;

/* ---------- 3. what is always a bug in rendered output ---------- */
const LEAKS = [
  ['undefined', /(^|[>\s:"'(])undefined([<\s:"')]|$)/],
  ['null',      /(^|[>\s:"'(])null([<\s:"')]|$)/],
  ['NaN',       /(^|[>\s:"'($])NaN([<\s:"')]|$)/],
  ['[object Object]', /\[object Object\]/],
];
/* the app defines these as globals; an onclick naming anything else is a dead control */
function handlersIn(html){
  const out = new Set();
  (html.match(/on(?:click|change|input|keydown|submit)="([^"]*)"/g) || []).forEach(a => {
    /* only BARE calls — `document.getElementById(` and `event.stopPropagation(` are method calls on an
       object, not globals this gate should demand exist. */
    const body = a.replace(/^on[a-z]+="/, '').replace(/"$/, '');
    (body.match(/(^|[^.\w$])([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(/g) || []).forEach(f => {
      const name = f.replace(/\s*\($/, '').replace(/^[^a-zA-Z_$]+/, '');
      if (name) out.add(name);
    });
  });
  return [...out];
}
const JS_BUILTINS = new Set(['if','for','while','return','function','typeof','new','event','this','try','catch',
  'switch','delete','void','in','of','do','else','String','Number','Boolean','Array','Object','JSON','Math','Date',
  'parseInt','parseFloat','isNaN','alert','confirm','prompt','setTimeout','encodeURIComponent','decodeURIComponent']);

function drawAll(label, seed, openAll){
  run(seed);
  if (openAll) run("window.__disc=new Proxy({},{get:function(){return true;},set:function(){return true;}});");
  SCREENS.forEach(s => {
    let html = '';
    try {
      run("state.screen=" + JSON.stringify(s) + "; state.params=" + JSON.stringify(PARAMS[s] || {}) + ";");
      html = run("(function(){ var r=(" + renderNameFor(s) + ")(); return typeof r==='string'?r:String(r); })()");
    } catch (e) {
      check(label + ' · ' + s + ' renders without throwing', false, String(e && e.message || e).slice(0, 140));
      return;
    }
    check(label + ' · ' + s + ' renders without throwing', true);
    check(label + ' · ' + s + ' produces output', html.length > 20, 'got ' + html.length + ' chars');

    LEAKS.forEach(([name, rx]) => {
      const hit = rx.exec(html);
      check(label + ' · ' + s + ' shows no raw "' + name + '"', !hit,
        hit ? '…' + html.slice(Math.max(0, hit.index - 55), hit.index + 45).replace(/\s+/g, ' ') + '…' : '');
    });

    const missing = handlersIn(html).filter(f => !JS_BUILTINS.has(f) && run('typeof ' + f) !== 'function');
    check(label + ' · ' + s + ' has no dead controls', missing.length === 0, missing.join(', '));

    const opens = (html.match(/<div\b/g) || []).length, closes = (html.match(/<\/div>/g) || []).length;
    check(label + ' · ' + s + ' closes every <div>', opens === closes, opens + ' open vs ' + closes + ' close');
  });
}
function renderNameFor(s){
  const hit = (mapSrc.match(new RegExp('\\b' + s + ':([a-zA-Z]+)')) || [])[1];
  return hit || ('render' + s.charAt(0).toUpperCase() + s.slice(1));
}

drawAll('bare shop', SEED_EMPTY, false);
drawAll('working shop', SEED_FULL, false);
drawAll('everything expanded', SEED_FULL, true);

if (bad.length) { console.error(bad.slice(0, 40).join('\n')); if (bad.length > 40) console.error('  … and ' + (bad.length - 40) + ' more'); }
console.log('\n' + pass + ' passed, ' + fail + ' failed   (' + SCREENS.length + ' screens × 3 data states)');
process.exit(fail ? 1 : 0);
