#!/usr/bin/env node
/* audit-integrity.js — read-only health check of the LIVE business. Changes nothing, ever.
 *
 *   ssh -i ~/.ssh/ozark_hub root@142.93.2.141 "node /opt/ozark/audit-integrity.js"
 *
 * Checks: every balance reconciles - orphaned/double payments - impossible order states -
 * duplicate order numbers - what is actually owed and how much is chargeable - money that is
 * owed but has no follow-up record - unusable saved cards - which station runs which app build -
 * whether the _t last-write-wins field is still degenerate.
 * Written 2026-08-05 after the week of sync incidents. Run it any time; it only reads.
 */
const fs = require('fs');
const raw = JSON.parse(fs.readFileSync('/opt/ozark/hub-data/ozark-db.json', 'utf8'));
const db = raw.db;
const nm = c => c ? ((c.first || '') + ' ' + (c.last || '')).trim() : '(unknown)';
const cust = id => (db.customers || []).find(c => c.id === id);
const d = t => new Date(t || 0).toISOString().slice(0, 16).replace('T', ' ');
const m = n => '$' + (+(n || 0)).toFixed(2);
const O = db.orders || [], C = db.customers || [], P = db.payments || [], L = db.ledger || [];
let problems = 0;
const bad = s => { console.log('   ❌ ' + s); problems++; };
const ok = s => console.log('   ✅ ' + s);

console.log('══ OZARK POS — LIVE INTEGRITY AUDIT ══   rev ' + raw.__meta.rev + '   ' + d(raw.__meta.savedAt) + '\n');
console.log('scale: ' + C.length + ' customers · ' + O.length + ' orders · ' + P.length + ' payments · ' + L.length + ' ledger lines · ' + ((db.collections || []).length) + ' open collections\n');

console.log('── 1. MONEY: does every customer\'s balance reconcile? ──');
let drift = 0, driftTot = 0;
C.forEach(c => {
  if (c.charges === undefined) return;
  const calc = (+(c.charges || 0)) - (+(c.payments || 0)) - (+(c.credits || 0));
  if (Math.abs(calc - (+(c.balance || 0))) > 0.005) { drift++; driftTot += Math.abs(calc - (+(c.balance || 0)));
    if (drift <= 8) bad(nm(c) + ': balance ' + m(c.balance) + ' but charges-payments-credits = ' + m(calc)); }
});
drift ? bad(drift + ' customers do not reconcile, ' + m(driftTot) + ' total drift') : ok('all ' + C.length + ' customers reconcile exactly');

console.log('\n── 2. MONEY: is any payment orphaned or double-applied? ──');
const payByOrder = {};
P.forEach(p => { if (p.orderId) (payByOrder[p.orderId] = payByOrder[p.orderId] || []).push(p); });
const orphan = P.filter(p => p.orderId && !O.find(o => o.id === p.orderId));
orphan.length ? bad(orphan.length + ' payments point at an order that no longer exists: ' + orphan.map(p => m(p.amount)).join(' ')) : ok('no orphaned payments');
const dupRef = {};
P.forEach(p => { const k = (p.auth || '') + '|' + (p.txn || p.ref || ''); if (k !== '|') (dupRef[k] = dupRef[k] || []).push(p); });
const dups = Object.keys(dupRef).filter(k => dupRef[k].length > 1);
if (dups.length) {
  console.log('   ⓘ ' + dups.length + ' auth/txn codes appear on more than one payment row (normal for a split pickup — flagging for eyes only):');
  dups.slice(0, 6).forEach(k => console.log('      auth ' + k.split('|')[0] + ' → ' + dupRef[k].map(p => m(p.amount)).join(' + ') + ' = ' + m(dupRef[k].reduce((t, p) => t + (+p.amount || 0), 0))));
} else ok('no repeated auth codes');

console.log('\n── 3. ORDERS: any impossible state? ──');
const RANK = { 'Received':1,'Quick':1,'Detailed':2,'In Process':2,'Assembled':3,'Racked':4,'Ready':5,'PickedUp':6,'Split':6,'Void':7 };
const noStatus = O.filter(o => !RANK[o.status]);
noStatus.length ? bad(noStatus.length + ' orders have an unrecognised status: ' + [...new Set(noStatus.map(o => o.status))].join(', ')) : ok('every order has a known status');
const paidNotDone = O.filter(o => o.paymentStatus === 'paid' && ['Received','Detailed','In Process'].indexOf(o.status) >= 0);
paidNotDone.length ? bad(paidNotDone.length + ' orders are PAID but sitting back in production (double-charge risk): ' + paidNotDone.map(o => o.number).join(' ')) : ok('no paid order is sitting back in production');
const delivNotDone = O.filter(o => o.deliveredAt && ['Received','Detailed','In Process','Assembled'].indexOf(o.status) >= 0);
delivNotDone.length ? bad(delivNotDone.length + ' orders are marked DELIVERED but still show as unfinished: ' + delivNotDone.map(o => o.number).join(' ')) : ok('no delivered order is stuck unfinished');
const hollow = O.filter(o => !(o.lines || []).length && ['Detailed','Assembled','Racked','Ready'].indexOf(o.status) >= 0);
hollow.length ? console.log('   ⓘ ' + hollow.length + ' orders have 0 pieces but a production status (dissolved parents — expected): ' + hollow.slice(0,6).map(o=>o.number).join(' ')) : ok('no hollow production orders');

console.log('\n── 4. ORDERS: duplicate order numbers? (the genOrderNumber race) ──');
const byNum = {};
O.forEach(o => (byNum[o.number] = byNum[o.number] || []).push(o));
const dupNum = Object.keys(byNum).filter(k => byNum[k].length > 1);
dupNum.length ? bad(dupNum.length + ' DUPLICATE order numbers — a scan resolves to the wrong customer: ' + dupNum.join(' ')) : ok('all ' + O.length + ' order numbers are unique');

console.log('\n── 5. WHAT IS ACTUALLY OWED RIGHT NOW ──');
const owing = C.filter(c => (+(c.balance || 0)) > 0.005).sort((a, b) => (+b.balance) - (+a.balance));
const totalOwed = owing.reduce((t, c) => t + (+c.balance || 0), 0);
console.log('   ' + owing.length + ' customers owe money · TOTAL OUTSTANDING ' + m(totalOwed));
owing.slice(0, 12).forEach(c => {
  const del = O.filter(o => o.customerId === c.id && o.deliveredAt).length;
  const card = (c.cards || []).length ? 'card on file' : 'NO card';
  console.log('      ' + m(c.balance).padStart(10) + '  ' + nm(c).padEnd(28) + card.padEnd(13) + del + ' delivered order(s)');
});
if (owing.length > 12) console.log('      … and ' + (owing.length - 12) + ' more');
const owedWithCard = owing.filter(c => (c.cards || []).length).reduce((t, c) => t + (+c.balance || 0), 0);
console.log('   → ' + m(owedWithCard) + ' of that is on customers WITH a card on file (chargeable today)');
console.log('   → ' + m(totalOwed - owedWithCard) + ' has no card on file');

console.log('\n── 6. IS ANY OF IT INVISIBLE? (delivered, unpaid, no follow-up record) ──');
const col = db.collections || [];
const invisible = [];
O.filter(o => o.deliveredAt && o.paymentStatus !== 'paid' && o.status !== 'Void').forEach(o => {
  const c = cust(o.customerId) || {};
  if ((+(c.balance || 0)) <= 0.005) return;
  const tracked = col.some(x => JSON.stringify(x).indexOf(o.number) >= 0 || (x.custId || x.customerId) === o.customerId);
  if (!tracked) invisible.push({ o, c });
});
if (invisible.length) {
  console.log('   ⚠ ' + invisible.length + ' delivered-and-unpaid orders are NOT on the needs-collection list.');
  console.log('     They ARE on the customer balance (so the money is tracked), but nothing prompts staff to chase them.');
  const seen = {};
  invisible.forEach(({ o, c }) => { if (seen[c.id]) return; seen[c.id] = 1;
    console.log('      ' + m(c.balance).padStart(10) + '  ' + nm(c).padEnd(28) + o.number + '  delivered ' + d(o.deliveredAt).slice(0, 10)); });
} else ok('every delivered-unpaid order is on the needs-collection list');

console.log('\n── 7. CARDS ──');
let cards = 0, noExp = 0, unver = 0;
C.forEach(c => (c.cards || []).forEach(k => { cards++;
  if (!String(k.exp == null ? '' : k.exp).replace(/\D/g, '')) { noExp++; bad(nm(c) + ' card ····' + k.last4 + ' has NO expiry — cannot be charged'); }
  if (k.unverified) unver++; }));
ok(cards + ' saved cards · ' + noExp + ' unusable (no expiry) · ' + unver + ' unverified');

console.log('\n── 8. SYNC HEALTH: which stations are on which app build? ──');
// Read the build the hub is ACTUALLY serving — the same sha1 the hub computes in appRev(). NEVER hardcode
// it: a stale constant here reports healthy stations as out of date, which is precisely the kind of lying
// alert this whole day was spent removing.
let APPREV = '(unknown)';
try { APPREV = require('crypto').createHash('sha1')
  .update(fs.readFileSync('/opt/ozark/Ozark-POS.html')).digest('hex').slice(0, 12); } catch (e) {}
console.log('   hub is serving: ' + APPREV);
(db.devices || []).sort((a, b) => (b.at || 0) - (a.at || 0)).forEach(dv => {
  const mins = Math.round((Date.now() - (dv.at || dv.lastSeen || 0)) / 60000);
  const cur = dv.appRev === APPREV;
  const seen = mins < 20 ? 'ACTIVE' : (mins < 1440 ? mins + 'm ago' : Math.round(mins / 1440) + 'd ago');
  const flag = (mins < 20 && !cur) ? '  ⚠ ACTIVE ON AN OLD BUILD' : '';
  console.log('   ' + (cur ? '✅' : '  ') + ' ' + String(dv.name || dv.id).padEnd(24) + String(dv.appRev || '(never reported)').padEnd(18) + seen + flag);
});

console.log('\n── 9. THE _t COLLAPSE (is last-write-wins still degenerate?) ──');
const T = {}; let tot = 0;
Object.keys(db).forEach(k => { if (!Array.isArray(db[k])) return; db[k].forEach(r => { if (r && r._t) { T[r._t] = (T[r._t] || 0) + 1; tot++; } }); });
const top = Object.entries(T).sort((a, b) => b[1] - a[1])[0] || ['0', 0];
const pct = tot ? Math.round(top[1] / tot * 100) : 0;
console.log('   ' + tot + ' stamped records · ' + Object.keys(T).length + ' distinct stamps · biggest shared bucket ' + top[1] + ' (' + pct + '%)');
// hybrid-clock stamps are ms×1000 (~1e15); anything around 1e12 is a legacy raw Date.now() from before the fix
let hlc = 0, legacy = 0;
Object.keys(T).forEach(k => { (+k >= 1e14) ? (hlc += T[k]) : (legacy += T[k]); });
console.log('   hybrid-clock stamps: ' + hlc + '    legacy (pre-fix) stamps: ' + legacy);
if (legacy) console.log('   ⓘ the legacy ones are HISTORY, not a live fault. They carry the old mass-stamp, but any record\n' +
  '     touched from now on gets a unique hybrid-clock stamp that outranks every one of them. Orders are\n' +
  '     protected regardless by the one-way law, on both the app and the hub, whatever _t says.');
else ok('every stamped record is on the hybrid clock');

console.log('\n══ RESULT: ' + (problems ? problems + ' problem(s) found above' : 'no integrity problems found') + ' ══');
