/* live-money.js — ask the APP what a live order is worth. READ-ONLY.

   ⚠️ WHY THIS EXISTS. On 2026-08-12, while the driver was on the road, I answered three money questions by
   re-implementing the order total in a throwaway script. My copy multiplied line price by quantity and added
   ORDER-level upcharges — and silently ignored PER-LINE upcharges (`line.ups`, e.g. "Decorated" $1.50,
   "Line Dry" $1.00). Consequences, all real:
     · told the owner Bruno Hollins' two delivered orders were worth $51.47 when the app had correctly
       billed $56.39;
     · computed the English order at $35.04 when it is $43.80, and wrote that number into `creditApplied`,
       which left $8.76 OPEN — so the driver's checkout would have charged the card of the very customer the
       owner had just promised was fully covered, after an accidental double charge. The owner caught it.
   This is the third time this project has been bitten by a private copy of the money math: the 8/10 repair
   script carried its own pre-tax `orderTotal`, and MON-10 summed payments without asking what a payment
   MEANT. The rule the file exists to enforce:

       ⛔ NEVER compute what an order is worth outside Ozark-POS.html.
          Load the app and call its own computeTotals — the same function the counter and the route use.

   It shares ONE sandbox with test-money.js (the first 92 lines are its proven fake DOM) rather than carrying
   a second copy, because two sandboxes drift exactly the way two copies of the math did.

   USAGE (on the droplet, where the app and the database both live):
       node /opt/ozark/live-money.js                                  # every live order that is Ready/Racked
       node /opt/ozark/live-money.js 3-08-10-26-0014 3-08-10-26-0003  # specific order numbers
       node /opt/ozark/live-money.js --cust "english"                 # every order for a customer
   Locally, point it at the files:
       node live-money.js --app Ozark-POS.html --db path/to/ozark-db.json 3-08-10-26-0014
*/
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');

function arg(name, dflt){ const i = process.argv.indexOf(name); return (i > 0 && process.argv[i+1]) ? process.argv[i+1] : dflt; }
const APP  = arg('--app', fs.existsSync('/opt/ozark/Ozark-POS.html') ? '/opt/ozark/Ozark-POS.html' : 'Ozark-POS.html');
const DBF  = arg('--db',  fs.existsSync('/opt/ozark/hub-data/ozark-db.json') ? '/opt/ozark/hub-data/ozark-db.json' : 'hub-data/ozark-db.json');
const HARN = arg('--harness', path.join(path.dirname(APP), 'test-money.js'));
const CUST = arg('--cust', '');
const NUMS = process.argv.slice(2).filter(a => /^\d-\d\d-\d\d-\d\d-\d+$/.test(a));

for (const f of [APP, DBF, HARN]) {
  if (!fs.existsSync(f)) { console.error('missing: ' + f + (f === HARN ? '  (live-money.js borrows test-money.js\'s sandbox on purpose — deploy them together)' : '')); process.exit(1); }
}

/* ---------- borrow the harness's proven sandbox: its first 92 lines load the app into `sandbox` ---------- */
/* ⚠️ FIND THE END OF THE BOOTSTRAP, DO NOT COUNT LINES TO IT. This was a hard-coded 92, and when the harness
   grew its fake IndexedDB (Phase 3, 2026-08-12) the app load moved to line 99 — so this tool refused to run
   and STAYED refusing, silently, until somebody needed it on 8/14. The guard was right to stop rather than
   execute a half-loaded sandbox; the brittleness was counting lines in a file that is edited constantly.
   ⚠️ And note what the breakage cost: this is the file that exists to stop anyone re-implementing the money
   math in a throwaway script. A dead guard-rail is worse than none, because it is still cited as a reason
   the risk is handled. Anchor on the text that ends the bootstrap and it cannot drift again. */
const harnLines = fs.readFileSync(HARN, 'utf8').split('\n');
const bootEnd = harnLines.findIndex(l => l.indexOf('App script failed to LOAD') >= 0);
if (bootEnd < 0) {
  console.error('test-money.js\'s bootstrap no longer contains the app-load line this tool anchors on.');
  console.error('Re-anchor it here rather than pasting a second copy of the fake DOM.');
  process.exit(1);
}
const boot = harnLines.slice(0, bootEnd + 1).join('\n');
const bootFn = new Function('process', 'require', 'module', '__filename', '__dirname', boot + '\nreturn { sandbox, vm, appJs };');
const ctx = bootFn(Object.assign(Object.create(process), { argv: [process.argv[0], 'live-money', APP] }), require, module, __filename, __dirname);
const sandbox = ctx.sandbox;

/* ---------- feed it the live records (DB starts null: loadDB's IndexedDB callback never fires) ---------- */
const RAW = JSON.parse(fs.readFileSync(DBF, 'utf8'));
const LIVE = RAW.db || RAW;
sandbox.__LIVE = {
  settings: LIVE.settings, prices: LIVE.prices || [], upcharges: LIVE.upcharges || [],
  orders: LIVE.orders || [], customers: LIVE.customers || [], payments: LIVE.payments || [],
  ledger: LIVE.ledger || [], collections: LIVE.collections || [],
};
sandbox.__WANT = NUMS;
sandbox.__CUST = CUST.toLowerCase();

const NL = String.fromCharCode(10);
const out = vm.runInContext(`(function(){
  var L=window.__LIVE, want=window.__WANT||[], who=window.__CUST||'';
  var money=function(n){ return '$'+(Math.round((+n||0)*100)/100).toFixed(2); };
  var r2=function(n){ return Math.round((+n||0)*100)/100; };
  DB = { settings:L.settings, prices:L.prices, upcharges:L.upcharges, orders:L.orders, customers:L.customers,
         payments:L.payments, ledger:L.ledger, collections:L.collections, garments:[], activity:[],
         batches:[], employees:[], timeclock:[], _tomb:[] };
  var name=function(c){ return c ? (((c.first||'')+' '+(c.last||'')).trim() || (c.business||'') || '(no name)') : '(no customer)'; };
  var sel=DB.orders.filter(function(o){
    if(want.length) return want.indexOf(o.number)>=0;
    if(who){ var c=DB.customers.filter(function(x){return x.id===o.customerId;})[0];
             return name(c).toLowerCase().indexOf(who)>=0; }
    return ['Ready','Racked'].indexOf(o.status)>=0;      /* default: everything still waiting to go out */
  }).sort(function(a,b){ return a.number>b.number?1:-1; });
  var lines=[], rows=[], sumOpen=0;
  lines.push('tax by store: '+(L.settings.stores||[]).map(function(s){return s.id+'='+((+s.tax||0)*100).toFixed(2)+'%';}).join('   '));
  lines.push('orders examined: '+sel.length+'   (totals from the app'+String.fromCharCode(39)+'s own computeTotals)');
  lines.push('');
  sel.forEach(function(o){
    var c=DB.customers.filter(function(x){return x.id===o.customerId;})[0];
    var t=computeTotals(o);
    var paid=(typeof orderPaidTotal==='function')?orderPaidTotal(o):0;
    var cred=r2(o.creditApplied||0);
    var open=r2(Math.max(0, t.total-cred-paid));
    sumOpen+=open;
    lines.push(o.number+'   '+name(c)+'   ['+o.status+', '+(o.pieceCount||0)+' pcs]');
    lines.push('    sub '+money(t.sub)+'  + tax '+money(t.tax)+'  = TOTAL '+money(t.total)+
               '     paid '+money(paid)+'   credit '+money(cred));
    lines.push('    OPEN '+money(open)+(open>0.004?'   <- this is what a checkout would charge or bill':'   <- nothing to charge'));
    rows.push({num:o.number, who:name(c), status:o.status, total:r2(t.total), paid:r2(paid), credit:cred, open:open});
  });
  lines.push('');
  lines.push('TOTAL STILL OPEN ACROSS THESE ORDERS: '+money(sumOpen));
  return { text: lines.join(String.fromCharCode(10)), rows: rows };
})()`, sandbox, { timeout: 30000 });

console.log(out.text);
if (process.argv.indexOf('--json') > 0) console.log(NL + JSON.stringify(out.rows, null, 2));
