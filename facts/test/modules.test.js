'use strict';
/* @facts @proof — THE MODULE CONTRACT (facts/modules/define.js): a manifest that breaks a law is refused when it is defined; a set of
   modules that does not close is refused when it is assembled; and the one judge the hub gets admits and refuses by authority, by
   right and by a hub-checked PIN — over a real hub, with the negative control that the same facts land on a hub with no judge.
   This repo's own file.   node facts/test/modules.test.js */
const H = require('./harness');
const registry = require('../core/registry');
const { makeHub } = require('../hub/hub');
const { makeStation } = require('../core/station');
const { defineModule, assemble, parseAuthority } = require('../modules/define');

let T = 1789000000000;
const now = function () { return T; };
const ok = function () { return null; };
/* @proof — the message a throwing call gave, or '' */
function thrown(fn) { try { fn(); } catch (e) { return String(e.message); } return ''; }

/* a test staff module: tstaff.set {staffId, name, role, rights[], active} folded to a list; it provides `staff` */
function staffFold(evs) { const byId = new Map(); evs.forEach(function (e) { if (e.type !== 'tstaff.set') return; const p = e.payload, was = byId.get(p.staffId) || { id: p.staffId, rights: [] }; byId.set(p.staffId, Object.assign({}, was, p, { id: p.staffId })); }); return { byId: byId }; }
const STAFF = defineModule({ name: 'tstaff', version: 1, aggregate: { name: 'tstaff', fold: staffFold },
  facts: { 'tstaff.set': { authority: 'needs:employees', validate: function (p) { return typeof p.staffId === 'string' && p.staffId ? null : 'staffId'; } } },
  provides: { staff: function (master, staged) { const s = staffFold(master.concat(staged).filter(function (e) { return e.aggregate === 'tstaff'; }));
    return { byId: s.byId, isOwner: function (w) { return w.role === 'owner'; }, can: function (w, r) { return (w.rights || []).indexOf(r) >= 0; } }; } } });
const SHIFT = defineModule({ name: 'tshift', version: 1, requires: ['tstaff'], aggregate: { name: 'tshift', fold: function (evs) { return { n: evs.length }; } },
  facts: {
    'tshift.in': { authority: 'self-or:payroll', validate: ok },
    'tshift.edit': { authority: 'needs:payroll', pin: true, validate: ok },
    'tshift.note': { authority: 'any', validate: ok },
    'tshift.auto': { authority: 'hub-only', validate: ok },
    'tshift.boss': { authority: 'owner', validate: ok }
  }, needsConfig: { 'tshift.autoCloseAfterHrs': 0 } });

H.section('modules · defineModule and assemble (facts/modules/define.js)');

H.test('a manifest that breaks a law is refused when it is defined, and says which law', function () {
  H.ok(/short lower-case name/.test(thrown(function () { defineModule({ name: 'Bad Name', version: 1, facts: {} }); })));
  H.ok(/version is a whole number/.test(thrown(function () { defineModule({ name: 'm1', version: 0, facts: { 'm1.x': { authority: 'any', validate: ok } }, aggregate: { name: 'm1', fold: ok } }); })));
  H.ok(/is not one of/.test(thrown(function () { parseAuthority('anyone', 'x'); })), 'an unknown authority');
  H.ok(/take a right/.test(thrown(function () { parseAuthority('needs', 'x'); })), 'needs without a right');
  H.ok(/take a right/.test(thrown(function () { parseAuthority('owner:payroll', 'x'); })), 'a right where none belongs');
  H.ok(/a hub-checked PIN needs a person/.test(thrown(function () { defineModule({ name: 'm2', version: 1, aggregate: { name: 'm2', fold: ok }, facts: { 'm2.x': { authority: 'any', pin: true, validate: ok } } }); })));
  H.ok(/validate\(payload\)/.test(thrown(function () { defineModule({ name: 'm3', version: 1, aggregate: { name: 'm3', fold: ok }, facts: { 'm3.x': { authority: 'any' } } }); })), 'no validator');
  H.ok(/already registered/.test(thrown(function () { defineModule({ name: 'm4', version: 1, aggregate: { name: 'm4', fold: ok }, facts: { 'tshift.in': { authority: 'any', validate: ok } } }); })), 'a type has one home');
  H.ok(/adopt names a type nobody registered/.test(thrown(function () { defineModule({ name: 'm5', version: 1, facts: { 'nobody.x': { adopt: true, authority: 'any' } } }); })));
  H.ok(/has no default/.test(thrown(function () { defineModule({ name: 'm6', version: 1, aggregate: { name: 'm6', fold: ok }, facts: { 'm6.x': { authority: 'any', validate: ok } }, needsConfig: { 'm6.limit': undefined } }); })));
  H.ok(/need an aggregate/.test(thrown(function () { defineModule({ name: 'm7', version: 1, facts: { 'm7.x': { authority: 'any', validate: ok } } }); })));
  /* the negative control: a manifest that keeps every law is defined, and its type is registered with the hub's registry */
  H.ok(registry.knows('tshift.edit') && registry.typeDef('tshift.edit').aggregate === 'tshift', 'a good module registers its types');
  H.ok(!registry.knows('m3.x'), 'a refused module registered nothing');
});

H.test('an imported aggregate\'s type is ADOPTED: the module gives it authority and leaves its validator as imported', function () {
  require('../aggregates/timeclock');
  const before = registry.typeDef('clock.edit').validate;
  const TC = defineModule({ name: 'tclock', version: 1, requires: ['tstaff'], facts: { 'clock.edit': { adopt: true, authority: 'needs:payroll', pin: true } } });
  H.eq(registry.typeDef('clock.edit').validate, before, 'the imported validator is untouched');
  H.eq(TC.rules['clock.edit'].right, 'payroll');
});

H.test('a set of modules that does not close is refused when it is assembled', function () {
  H.ok(/requires tstaff, which is not in this build/.test(thrown(function () { assemble([SHIFT], { grantCheck: ok }); })));
  H.ok(/listed twice/.test(thrown(function () { assemble([STAFF, STAFF, SHIFT], { grantCheck: ok }); })));
  const OTHER = defineModule({ name: 'tother', version: 1, provides: { staff: STAFF.provides.staff } });
  H.ok(/two modules provide staff/.test(thrown(function () { assemble([STAFF, OTHER, SHIFT], { grantCheck: ok }); })));
  const LONE = defineModule({ name: 'tlone', version: 1, aggregate: { name: 'tlone', fold: ok }, facts: { 'tlone.x': { authority: 'self', validate: ok } } });
  H.ok(/no module provides staff/.test(thrown(function () { assemble([LONE]); })), 'a fact that names a person needs a staff source');
  H.ok(/no grant check was given/.test(thrown(function () { assemble([STAFF, SHIFT]); })), 'a PIN-checked fact needs a grant check');
  const A = assemble([STAFF, SHIFT], { grantCheck: ok });
  H.eq(A.pinChecked.join(','), 'tshift.edit'); H.eq(A.config['tshift.autoCloseAfterHrs'], 0, 'each setting arrives with its default');
});

H.test('over a real hub: the judge admits and refuses by authority, by right and by a hub-checked PIN; a hub with no judge admits them all', function () {
  let grants = [];
  const grantCheck = function (gs, staffId, station) { return gs.some(function (g) { return g.staffId === staffId && g.station === station && g.until > Date.now(); }); };
  const A = assemble([STAFF, SHIFT], { grantCheck: grantCheck });
  const run = function (judge) {
    const hub = makeHub({ authority: judge ? A.judge : null }), out = {};   /* the hub on the real clock: it refuses a fact dated ahead of it */
    const st = function (id) { const s = makeStation({ id: id, now: now }); s.setAccess(hub.enroll(id, { by: 'proof' })); s.setTransport(function (b) { b.grants = grants; return hub.receive(b); }); return s; };
    const tab = st('tab'), svc = st('hub-services');
    const put = function (S, label, type, key, p, actor) { const e = S.record(type, key, p, { actor: actor }); out[label] = !!(S.log.get(e.id).pos); };
    put(tab, 'first owner (empty shop)', 'tstaff.set', 'own', { staffId: 'own', name: 'Ola', role: 'owner' }, null);
    put(tab, 'owner adds a clerk', 'tstaff.set', 'clk', { staffId: 'clk', name: 'Cam', role: 'staff', rights: [] }, 'own');
    put(tab, 'owner adds a manager', 'tstaff.set', 'mgr', { staffId: 'mgr', name: 'Mo', role: 'staff', rights: ['payroll', 'employees'] }, 'own');
    put(tab, 'owner adds an inactive one', 'tstaff.set', 'old', { staffId: 'old', name: 'Ode', role: 'staff', rights: ['payroll'], active: false }, 'own');
    put(tab, 'clerk adds staff', 'tstaff.set', 'x1', { staffId: 'x1', name: 'Xi' }, 'clk');
    put(tab, 'clerk clocks self in', 'tshift.in', 'clk', { staffId: 'clk' }, 'clk');
    put(tab, 'clerk clocks another in', 'tshift.in', 'mgr', { staffId: 'mgr' }, 'clk');
    put(tab, 'manager clocks another in', 'tshift.in', 'clk', { staffId: 'clk' }, 'mgr');
    put(tab, 'no actor', 'tshift.in', 'clk', { staffId: 'clk' }, null);
    put(tab, 'actor not on staff', 'tshift.in', 'zz', { staffId: 'zz' }, 'zz');
    put(tab, 'inactive actor', 'tshift.in', 'old', { staffId: 'old' }, 'old');
    put(tab, 'manager edits, no PIN grant', 'tshift.edit', 'clk', { staffId: 'clk' }, 'mgr');
    grants = [{ staffId: 'mgr', station: 'tab', until: Date.now() + 60000 }];
    put(tab, 'manager edits, with a grant', 'tshift.edit', 'clk', { staffId: 'clk' }, 'mgr');
    grants = [{ staffId: 'clk', station: 'tab', until: Date.now() + 60000 }];
    put(tab, 'clerk edits, with a grant', 'tshift.edit', 'clk', { staffId: 'clk' }, 'clk');
    grants = [{ staffId: 'mgr', station: 'elsewhere', until: Date.now() + 60000 }];
    put(tab, 'a grant for another tablet', 'tshift.edit', 'clk', { staffId: 'clk' }, 'mgr');
    grants = [{ staffId: 'mgr', station: 'tab', until: Date.now() - 1 }];
    put(tab, 'an expired grant', 'tshift.edit', 'clk', { staffId: 'clk' }, 'mgr');
    grants = [];
    put(tab, 'anyone writes a note', 'tshift.note', 'n1', {}, null);
    put(tab, 'a tablet writes a hub-only fact', 'tshift.auto', 'a1', {}, 'own');
    put(svc, 'the hub writes a hub-only fact', 'tshift.auto', 'a2', {}, null);
    put(tab, 'manager writes an owner fact', 'tshift.boss', 'b1', {}, 'mgr');
    put(tab, 'owner writes an owner fact', 'tshift.boss', 'b2', {}, 'own');
    return out;
  };
  const judged = run(true), open = run(false);
  const ADMIT = ['first owner (empty shop)', 'owner adds a clerk', 'owner adds a manager', 'owner adds an inactive one', 'clerk clocks self in', 'manager clocks another in',
    'manager edits, with a grant', 'anyone writes a note', 'the hub writes a hub-only fact', 'owner writes an owner fact'];
  const REFUSE = ['clerk adds staff', 'clerk clocks another in', 'no actor', 'actor not on staff', 'inactive actor', 'manager edits, no PIN grant', 'clerk edits, with a grant',
    'a grant for another tablet', 'an expired grant', 'a tablet writes a hub-only fact', 'manager writes an owner fact'];
  ADMIT.forEach(function (k) { H.ok(judged[k] === true, 'admitted: ' + k); });
  REFUSE.forEach(function (k) { H.ok(judged[k] === false, 'refused: ' + k); });
  /* the negative control: with no judge, every one of the refused facts lands — the refusals are the judge's, not the wire's */
  REFUSE.forEach(function (k) { H.ok(open[k] === true, 'a hub with no judge admits: ' + k); });
});

H.done();
