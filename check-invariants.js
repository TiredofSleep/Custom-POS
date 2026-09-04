#!/usr/bin/env node
/*
  customPOS — check-invariants: read-only, machine-checked rules over a POS database.
  =================================================================================
  Generalized from the Ozark `check-invariants` gate. It answers one question a screen never can: is the DATA
  itself sound? It reads a db.json (or an /api/db response) and reports every record that violates a structural
  rule, then EXITS WITH THE COUNT so it can gate a deploy or a backup-verify.

  Two lessons from the reference are baked in:
   • It checks the INPUTS to the money math (a line with a non-numeric price, a tender with a non-numeric
     amount) but never RE-DERIVES a total — money math lives only in the app (the live-money lesson). A private
     re-implementation of totals here would be a fourth copy that drifts.
   • It does NOT flag a phone shared by two customer records. In Ozark that is CORRECT — a person and their
     organisation share a number (the Sheriff, the preacher, the Chamber). A checker that cried wolf on it would
     train people to overrule the checker. Duplicate *order* ids/numbers, by contrast, are a real fault.

  Run:  node check-invariants.js [path/to/db.json]     (defaults to ./hub-data/db.json)
        exit code = number of violations (0 = clean), capped at 255.
*/
'use strict';
const ORDER_STATUS = new Set(['INPROGRESS','READY','PAID','CLOSED','REFUNDED']);

function checkInvariants(db){
  db = db || {};
  if (db.db && !db.records) db = db.db;                 // unwrap an {rev, db:{...}} / {db, rev} envelope
  const problems = [];
  const add = (rule, id, detail) => problems.push({ rule, id, detail });   // count and list built in ONE pass
  const records = Array.isArray(db.records) ? db.records : [];

  const idSeen = new Set(), numSeen = new Set();
  records.forEach(r => {
    if (!r || typeof r !== 'object') { add('bad-record', '?', 'not an object'); return; }
    // duplicate order id / number — a real fault (shadows silently at merge time)
    if (idSeen.has(r.id)) add('duplicate-id', r.id, 'record id appears more than once'); else idSeen.add(r.id);

    if (r.deleted) { if (r.id == null) add('tombstone-no-id', '?', 'a delete with no id cannot propagate'); return; }

    if (r.number != null) { if (numSeen.has(r.number)) add('duplicate-order-number', r.id, 'order #'+r.number+' used twice'); else numSeen.add(r.number); }
    if (!ORDER_STATUS.has(r.status)) add('unknown-status', r.id, 'status='+JSON.stringify(r.status)+' (an order in limbo)');

    (Array.isArray(r.lines) ? r.lines : []).forEach((l, i) => {
      if (!(Number.isFinite(l.qty)   && l.qty   >= 0)) add('bad-line-qty',   r.id, 'line '+i+' qty='+JSON.stringify(l&&l.qty));
      if (!(Number.isFinite(l.price) && l.price >= 0)) add('bad-line-price', r.id, 'line '+i+' price='+JSON.stringify(l&&l.price));
    });
    (Array.isArray(r.tenders) ? r.tenders : []).forEach((t, i) => {
      if (!Number.isFinite(t && t.amount)) add('bad-tender-amount', r.id, 'tender '+i+' amount='+JSON.stringify(t&&t.amount));
    });
  });

  return { ok: problems.length === 0, count: problems.length, problems };
}

module.exports = { checkInvariants };

if (require.main === module){
  const fs = require('fs'), path = require('path');
  const file = process.argv[2] || path.join(__dirname, 'hub-data', 'db.json');
  let db; try { db = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e){ console.error('cannot read '+file+': '+e.message); process.exit(255); }
  const res = checkInvariants(db);
  if (res.ok) console.log('invariants OK: '+ (db.records||db.db&&db.db.records||[]).length +' records checked, 0 violations');
  else { console.log(res.count+' violation(s):'); res.problems.forEach(p => console.log('  ['+p.rule+'] '+p.id+' — '+p.detail)); }
  process.exit(Math.min(res.count, 255));
}
