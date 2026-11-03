'use strict';
/* =====================================================================================================================
 * §995 · 11/1 — THE STAFF RULES, READY TO SHARE: core/staff.js without the shop's prices, and its abilities from a list a business writes
 * Owner, 11/1: "we are trying to build a modular system so nobody has to spend the money to do this work again... copy, paste,
 * customize". Rollout step 2 (Custom-POS docs/V2-MODULAR-IMPORT.md Part 3b): core/staff.js no longer loads the shop's price rules (the
 * discount and void rules moved, unchanged, to core/discountvoid.js, and §38 proves them there against v1's own code). WHICH
 * abilities exist is core/abilities.js, the business's own file, plus what a module adds with staff.addAbility().
 * The laws come first and hold for ANY business's core/abilities.js (review 11/1: no fixed key a business might also use), so the
 * exporter ships them as they are (up to the marker "THE SHOP'S OWN"). After it, the shop's own checks: its file is v1's list word for
 * word, the discount and void rules' new home, and core/staff.js's own text asking for nothing else.
 * ===================================================================================================================== */
const H = require('../harness');
const staff995 = require('../../core/staff');
const abil995 = require('../../core/abilities');
const registry995 = require('../../core/registry');
const staffAgg995 = require('../../aggregates/staff');   /* employee.set's check, the one the hub runs */

/* @proof — the loaded copy of a file this proof file loaded, found by what it hands out */
function loadedAs995(x) { const m = module.children.filter(function (c) { return c.exports === x; })[0]; if (!m) throw new Error('loadedAs995: not loaded by this file'); return m; }
/* @proof — a loaded file's name from where the tree starts (core/staff.js), the same on any computer */
function name995(m) { const f = String(m.id).split(String.fromCharCode(92)).join('/'), hit = /(?:^|\/)((?:core|aggregates|station|hub|sync|store)\/[^\/]+\.js)$/.exec(f); return hit ? hit[1] : f; }
/* @proof — every file a loaded file brought with it when it first loaded, and theirs, by name */
function brought995(x) {
  const seen = {}, walk = function (m) { (m.children || []).forEach(function (c) { const n = name995(c); if (!seen[n]) { seen[n] = true; walk(c); } }); };
  walk(loadedAs995(x)); return Object.keys(seen);
}
/* @proof — a key no business's list holds yet: the base, or the base with a number (so the laws hold for ANY core/abilities.js) */
function fresh995(base) { let k = base, n = 0; while (staff995.ABILITY_KEYS.indexOf(k) >= 0) k = base + '_' + (++n); return k; }
/* @proof — the hub's own check on a person's change (employee.set): its refusal, or null when admitted */
function empSet995(perms) { return registry995.typeDef('employee.set').validate({ empId: 'e995', set: { perms: perms } }); }
/* @proof — the three lists as text, to see that nothing moved */
function lists995(s) { return JSON.stringify([s.ABILITIES, s.ABILITY_KEYS, s.ROLE_PERMS]); }
/* @proof — how long each list is now, to put them back after a proof that adds to them */
function marks995() { return { n: staff995.ABILITIES.length, owner: staff995.ROLE_PERMS.owner.length, manager: staff995.ROLE_PERMS.manager.length, staff: staff995.ROLE_PERMS.staff.length }; }
/* @proof — the shared lists put back as they were (addAbility only ever pushes) */
function trim995(m) { staff995.ABILITIES.length = m.n; staff995.ABILITY_KEYS.length = m.n; ['owner', 'manager', 'staff'].forEach(function (r) { staff995.ROLE_PERMS[r].length = m[r]; }); }
/* @proof — none of a set of lists is the file's own object (a module adding to them must never write into the business's file) */
function ownLists995(s, file) { return s.ABILITIES !== file.ABILITIES && s.ROLE_PERMS !== file.ROLE_PERMS && ['owner', 'manager', 'staff'].every(function (r) { return !file.ROLE_PERMS || s.ROLE_PERMS[r] !== file.ROLE_PERMS[r]; }); }
/* @proof — what abilitiesFrom says about a list: the refusal's words, or '' */
function said995(list) { try { staff995.abilitiesFrom(list); return ''; } catch (e) { return e.message; } }

H.section('995 · 11/1 — THE STAFF RULES, READY TO SHARE: core/staff.js brings none of the shop\'s prices, and which abilities exist is core/abilities.js, a business\'s own file, plus what its modules add with staff.addAbility()');

H.test('core/staff.js brings one file with it, core/abilities.js, and nothing of the shop\'s prices or anything else — negative control: the same walk over the staff fold (aggregates/staff.js) sees core/staff.js and the registry it loads', function () {
  H.eq(JSON.stringify(brought995(staff995)), '["core/abilities.js"]', 'core/staff.js loads core/abilities.js and nothing else');
  const fold = brought995(staffAgg995);
  H.ok(fold.indexOf('core/staff.js') >= 0 && fold.indexOf('core/registry.js') >= 0, 'negative control: the walk sees what a file loads: ' + fold.join(' '));
});

H.test('the lists core/staff.js holds ARE the business\'s file: its abilities with their words, in its order, and each role\'s defaults in its order (exactly abilitiesFrom() of it), in lists of its own; the hub admits a person\'s ability on that list — negative control: one not on it is refused by name', function () {
  H.eq(JSON.stringify(staff995.ABILITIES), JSON.stringify(abil995.ABILITIES), 'the abilities, the file\'s words, the file\'s order');
  H.eq(JSON.stringify(staff995.ABILITY_KEYS), JSON.stringify(abil995.ABILITIES.map(function (a) { return a[0]; })), 'the keys follow it');
  ['owner', 'manager', 'staff'].forEach(function (r) { H.eq(JSON.stringify(staff995.ROLE_PERMS[r]), JSON.stringify(abil995.ROLE_PERMS[r] || []), r + '\'s defaults, the file\'s order'); });
  H.eq(lists995(staff995.abilitiesFrom(abil995)), lists995(staff995), 'exactly what abilitiesFrom() makes of the file');
  H.ok(ownLists995(staff995, abil995), 'core/staff.js keeps lists of its own, role lists too (a module adding to them never writes into the business\'s file)');
  const first = abil995.ABILITIES[0][0], none = fresh995('not_an_ability'), p = {}, q = {}; p[first] = true; q[none] = true;
  H.eq(empSet995(p), null, 'admitted: an ability on the list (' + first + ')');
  H.eq(empSet995(q), 'perms: "' + none + '" is not an ability', 'negative control: refused, by name');
});

H.test('a module\'s own ability: staff.addAbility(key, words, roles) puts it at the end of the Admin list, gives it to the owner and the roles named, can() answers by it, and the hub admits it on a person — negative control: the same person\'s fact was refused before it was added', function () {
  const m = marks995(), before = lists995(staff995), K = fresh995('proof_auction'), p = {}; p[K] = true;
  H.eq(empSet995(p), 'perms: "' + K + '" is not an ability', 'negative control: refused while no module has added it');
  try {
    staff995.addAbility(K, 'Run the auction block', ['manager']);
    H.eq(JSON.stringify(staff995.ABILITIES[m.n]), JSON.stringify([K, 'Run the auction block']), 'at the end of the Admin list, with its words');
    H.eq(staff995.ABILITY_KEYS[m.n], K, 'and among the keys');
    H.ok(staff995.ROLE_PERMS.owner.indexOf(K) >= 0 && staff995.ROLE_PERMS.manager.indexOf(K) >= 0 && staff995.ROLE_PERMS.staff.indexOf(K) < 0, 'the owner and the manager role have it; staff does not');
    H.ok(abil995.ROLE_PERMS.manager.indexOf(K) < 0 && abil995.ABILITIES.every(function (a) { return a[0] !== K; }), 'the business\'s file is untouched');
    H.eq(staff995.can({ role: 'manager' }, K), true, 'a manager may');
    H.eq(staff995.can({ role: 'staff' }, K), false, 'staff may not');
    const pp = {}; pp[K] = true;
    H.eq(staff995.can({ role: 'staff', perms: pp }, K), true, 'unless the owner gave this one person it');
    H.eq(empSet995(p), null, 'the hub now admits it on a person');
  } finally { trim995(m); }
  H.eq(lists995(staff995), before, 'the shared lists are back as they were for the rest of the suite');
});

H.test('addAbility refuses a key that is not a short name, one every object already has (constructor: can() would read it off any person and say yes), a key already on the list, a role the shop does not have, and an ability without its words, each by name, and a refusal adds nothing — negative controls: a good key in the same call is added; can() on "constructor" says yes for a person with no rights at all', function () {
  const before = lists995(staff995), taken = staff995.ABILITY_KEYS[0];
  H.eq(staff995.can({ role: 'staff', perms: {} }, 'constructor'), true, 'negative control: why the name is refused — can() reads "constructor" off any person\'s perms');
  [[' void', 'x', [], /is not an ability key/], ['9lives', 'x', [], /is not an ability key/], ['a'.repeat(33), 'x', [], /is not an ability key/], ['__proto__', 'x', [], /is not an ability key/],
    ['constructor', 'x', [], /a name every object already has/], ['toString', 'x', [], /a name every object already has/], ['hasOwnProperty', 'x', [], /a name every object already has/],
    [taken, 'x', [], /is already an ability/], [fresh995('tips'), 'x', ['cashier'], /"cashier" is not a role/], [fresh995('no_words'), '', [], /needs its words/], [fresh995('no_words'), null, [], /needs its words/]].forEach(function (c) {
    let said = ''; try { staff995.addAbility(c[0], c[1], c[2]); } catch (e) { said = e.message; }
    H.ok(c[3].test(said) && /^staff\.addAbility: /.test(said), 'refused, saying who asked: ' + JSON.stringify(c[0]) + ' — ' + said);
    H.eq(lists995(staff995), before, 'and nothing was added');
  });
  const m = marks995(), K = fresh995('tips_out');
  try { staff995.addAbility(K, 'Pay out tips', ['staff']); H.eq(staff995.ABILITY_KEYS[m.n], K, 'negative control: a good key is added'); }
  finally { trim995(m); }
  H.eq(lists995(staff995), before, 'put back');
});

H.test('copy, paste, customize: another business\'s own core/abilities.js (a cafe: no rack, a comp) becomes its lists through the same abilitiesFrom() the start uses, in its order, in lists of its own, and can() answers by them; whatever its file gets wrong — a role default naming no ability, a role that is not one, a key every object has, an ability without its words, a 41st ability — stops it, naming the file — negative controls: 40 abilities are taken; the shared lists still answer by this business\'s own file, ability by ability and role by role', function () {
  const cafe = { ABILITIES: [['admin', 'Open the Admin area'], ['drawer', 'Cash drawer in/out'], ['void', 'Void orders'], ['comp', 'Comp a meal'], ['reports', 'View reports']],
    ROLE_PERMS: { owner: ['admin', 'drawer', 'void', 'comp', 'reports'], manager: ['admin', 'drawer', 'void', 'comp'], staff: ['drawer'] } };
  const before = lists995(staff995), s = staff995.abilitiesFrom(cafe);
  H.ok(ownLists995(s, cafe) && s.ABILITIES !== staff995.ABILITIES, 'lists of its own, role lists too');
  H.eq(JSON.stringify(s.ABILITY_KEYS), '["admin","drawer","void","comp","reports"]', 'its abilities, in its order');
  H.eq(JSON.stringify(s.ROLE_PERMS), JSON.stringify(cafe.ROLE_PERMS), 'its role defaults');
  H.eq(staff995.can({ role: 'staff' }, 'unrack', s.ROLE_PERMS), false, 'nobody on staff un-racks: the cafe has no rack');
  H.eq(staff995.can({ role: 'manager' }, 'comp', s.ROLE_PERMS), true, 'a manager comps a meal');
  H.eq(staff995.can({ role: 'staff' }, 'drawer', s.ROLE_PERMS), true, 'staff work the drawer');
  H.eq(staff995.can({ role: 'owner' }, 'anything', s.ROLE_PERMS), true, 'the owner may do everything, as in every shop');
  const A = [['admin', 'Open the Admin area']], many = function (n) { const l = []; for (let i = 0; i < n; i++) l.push(['a' + i, 'Ability ' + i]); return { ABILITIES: l }; };
  [[{ ABILITIES: A, ROLE_PERMS: { staff: ['unrack'] } }, /^core\/abilities\.js: ROLE_PERMS\.staff names "unrack", which is not in its ABILITIES/],
    [{ ABILITIES: A, ROLE_PERMS: { managers: ['admin'] } }, /^core\/abilities\.js: ROLE_PERMS names "managers", which is not a role/],
    [{ ABILITIES: [['constructor', 'Build things']] }, /^core\/abilities\.js: "constructor" is a name every object already has/],
    [{ ABILITIES: [['drawer']] }, /^core\/abilities\.js: "drawer" needs its words/],
    [{ ABILITIES: ['admin'] }, /^core\/abilities\.js: ABILITIES\[0\] is \[key, words\]/],
    [many(41), /^core\/abilities\.js: "a40" would be ability 41 — at most 40/]].forEach(function (c) {
    const w = said995(c[0]); H.ok(c[1].test(w), 'stopped, naming the file: ' + w);
  });
  H.eq(said995(many(40)), '', 'negative control: 40 abilities are taken');
  H.eq(lists995(staff995), before, 'the shared lists did not move');
  const wrong = [];
  ['manager', 'staff'].forEach(function (r) { staff995.ABILITY_KEYS.forEach(function (k) { if (staff995.can({ role: r }, k) !== ((abil995.ROLE_PERMS[r] || []).indexOf(k) >= 0)) wrong.push(r + ':' + k); }); });
  H.eq(wrong.join(' '), '', 'negative control: the shared lists answer by this business\'s own file');
});

/* @proof — a staff fact as a tablet makes it: its stamp t (ms) and the station that stamped it */
function f995(type, payload, t, station, actor) { const st = station || 'tab-995'; return { id: st + '/' + type + '-' + t + '-' + JSON.stringify(payload).length, type: type, aggregate: 'staff', key: payload.empId || 'roles', station: st, actor: actor || null, at: t, payload: payload, hlc: { t: t, c: 0, id: st } }; }
/* @proof — an employee.set at stamp t */
function set995(empId, set, t, station, actor) { return f995('employee.set', { empId: empId, set: set }, t, station, actor); }

H.test('11/2 (a Custom POS skeptic, round 2): the staff fold counts each time a person is switched back on (reactivated) — the PIN pass names it, so a pass from before a switch-off never works again — negative controls: a person never switched off has none; on while already on, or "active" left as it was, counts nothing', function () {
  const T = 1800000000000, PIN = staff995.pinRecordSync('4821');
  const base = [set995('e1', { name: 'Ann', role: 'staff', pin: PIN }, T)];
  H.eq(staffAgg995.fold(base).byId.get('e1').reactivated, undefined, 'never switched off: no count');
  const once = base.concat([set995('e1', { active: false }, T + 1000), set995('e1', { active: true }, T + 2000)]);
  H.eq(staffAgg995.fold(once).byId.get('e1').reactivated, 1, 'off, then on: 1');
  const twice = once.concat([set995('e1', { active: false }, T + 3000), set995('e1', { active: true }, T + 4000)]);
  H.eq(staffAgg995.fold(twice).byId.get('e1').reactivated, 2, 'off and on again: 2');
  const idle = base.concat([set995('e1', { active: true }, T + 1000), set995('e1', { active: null, lang: 'es' }, T + 2000)]);
  H.eq(staffAgg995.fold(idle).byId.get('e1').reactivated, undefined, 'negative control: on while on, and "active" left as it was, count nothing');
  H.eq(staffAgg995.fold(once.slice().reverse()).byId.get('e1').reactivated, 1, 'the count is the one order\'s, whatever order the facts came in');
});

H.test('11/2 (round 2): outranked() names what a staff change will NOT decide because a change dated later already does — a PIN, on/off, role or permissions of the same person, or the role lists — each with the change that decides it; the fold agrees — negative controls: the same change dated after takes; a later change to another field or another person outranks nothing; null leaves a field as it was', function () {
  const T = 1800000000000, OLD = staff995.pinRecordSync('1111'), NEW = staff995.pinRecordSync('2468');
  const ahead = set995('m1', { pin: OLD }, T + 240000, 'tab-fast', 'm1');   /* a re-set of the same PIN, dated 4 minutes ahead */
  const facts = [set995('m1', { name: 'Mo', role: 'manager', pin: OLD }, T), ahead];
  const owner = set995('m1', { pin: NEW, active: false }, T + 60000, 'tab-office', 'o1');
  const lost = staffAgg995.outranked(facts, owner);
  H.eq(lost.map(function (l) { return l.field; }).join(), 'pin', 'the owner\'s PIN change is outranked by the change dated ahead (on/off is not: nothing later decides it)');
  H.ok(lost[0].by === ahead, 'and it names that change');
  H.eq(staffAgg995.fold(facts.concat([owner])).byId.get('m1').pin.hash, OLD.hash, 'the fold agrees: the old PIN is still in force');
  H.eq(staffAgg995.outranked(facts, set995('m1', { pin: NEW }, T + 300000, 'tab-office', 'o1')).length, 0, 'negative control: the same change dated after it takes');
  H.eq(staffAgg995.outranked(facts.concat([set995('m1', { lang: 'es' }, T + 400000), set995('x9', { pin: OLD }, T + 400000)]), set995('m1', { role: 'staff' }, T + 60000)).length, 0, 'negative control: a later change to another field, or to another person, outranks nothing');
  H.eq(staffAgg995.outranked(facts, set995('m1', { pin: NEW, role: null }, T + 60000)).map(function (l) { return l.field; }).join(), 'pin', 'a field left as it was (null) is not counted');
  const roles = function (t, st, l) { return f995('staff.roles', { rolePerms: { staff: l || ['clock'] } }, t, st); };
  H.eq(staffAgg995.outranked([roles(T + 240000, 'tab-fast', ['clock', 'rack'])], roles(T + 60000)).map(function (l) { return l.field; }).join(), 'rolePerms', 'the role lists the same');
  H.eq(staffAgg995.outranked([roles(T, 'tab-fast')], roles(T + 60000)).length, 0, 'negative control: role lists dated after take');
});

H.test('11/2 (round-2 skeptic): outranked() covers on/off, role and permissions as it does the PIN — a switch-off, a demotion or a permission taken away, outranked by a change dated later, is named — and a later change to the very SAME value outranks nothing (what was asked for is in force, whatever order the keys came in) — negative controls: dated after, each takes; a later different value is named', function () {
  const T = 1800000000000, PIN = staff995.pinRecordSync('1111');
  const base = [set995('m1', { name: 'Mo', role: 'manager', perms: { employees: true, payroll: false }, pin: PIN }, T)];
  const ahead = base.concat([set995('m1', { active: true, role: 'manager', perms: { employees: true } }, T + 240000, 'tab-fast', 'm1')]);
  const owner = function (set, t) { return set995('m1', set, t == null ? T + 60000 : t, 'tab-office', 'o1'); };
  const names = function (facts, e) { return staffAgg995.outranked(facts, e).map(function (l) { return l.field; }).join(); };
  H.eq(names(ahead, owner({ active: false })), 'active', 'a switch-off outranked');
  H.eq(names(ahead, owner({ role: 'staff' })), 'role', 'a demotion outranked');
  H.eq(names(ahead, owner({ perms: { employees: false } })), 'perms', 'a permission taken away outranked');
  H.eq(names(ahead, owner({ active: false, role: 'staff', perms: {} }, T + 300000)), '', 'negative control: dated after, all three take');
  /* the same value, later: nothing lost */
  const twice = base.concat([set995('m1', { active: false }, T + 240000, 'tab-2', 'x1'), set995('m1', { perms: { payroll: false, employees: true } }, T + 240000, 'tab-3', 'x2')]);
  H.eq(names(twice, owner({ active: false, perms: { employees: true, payroll: false } })), '', 'two people switching the same person off, or setting the same permissions in another key order: nothing is outranked');
  H.eq(names(twice, owner({ active: true, perms: { employees: false, payroll: false } })), 'active,perms', 'negative control: a later DIFFERENT value is named');
  H.eq(staffAgg995.outranked([f995('staff.roles', { rolePerms: { staff: ['clock', 'rack'] } }, T + 240000, 'tab-2')], f995('staff.roles', { rolePerms: { staff: ['clock', 'rack'] } }, T + 60000)).length, 0, 'the same role lists later: nothing lost');
});

H.test('11/2 evening: outrankedAlert() is the hub\'s word on an outranked staff change, here in the shared file so a business built from it tells it the same way — it names the person, what did not take, and EVERY tablet whose later change decides it, with who made it — negative controls: a change nothing outranks, and one outranked only by the SAME tablet (made after it: the newer decision), tell nothing', function () {
  const T = 1800000000000, PIN = staff995.pinRecordSync('1111'), NEW = staff995.pinRecordSync('2468');
  const base = [set995('m1', { name: 'Mo', role: 'manager', pin: PIN }, T, 'tab-office', 'o1'), set995('o1', { name: 'Olive', role: 'owner' }, T, 'tab-office', 'o1')];
  const staff = staffAgg995.fold(base);
  const facts = base.concat([set995('m1', { pin: PIN }, T + 240000, 'tab-fast', 'm1'), set995('m1', { active: true }, T + 200000, 'tab-2', 'o1')]);
  const owner = set995('m1', { pin: NEW, active: false }, T + 60000, 'tab-office', 'o1');
  const a = staffAgg995.outrankedAlert(facts, owner, staff);
  H.ok(a && a.kind === 'staff-outranked' && a.key === 'staff-outranked:' + owner.id && a.station === 'tab-office', 'an alert of its own kind, one per fact, from the tablet that sent it');
  H.ok(a.note.indexOf('Olive\'s change to Mo\'s PIN, on/off (tablet tab-office) did not take') >= 0, 'who, whose, what: ' + a.note.slice(0, 120));
  H.ok(a.note.indexOf('PIN from tablet tab-fast (by Mo)') >= 0 && a.note.indexOf('on/off from tablet tab-2 (by Olive)') >= 0 && a.note.indexOf('revoke tablets tab-fast and tab-2') >= 0, 'both tablets named, each with what it decides and who made it, and both to revoke');
  H.eq(staffAgg995.outrankedAlert(facts, set995('m1', { pin: NEW }, T + 300000, 'tab-office', 'o1'), staff), null, 'negative control: dated after everything, it takes: nothing told');
  const same = base.concat([set995('m1', { pin: PIN }, T + 240000, 'tab-office', 'o1')]);
  H.eq(staffAgg995.outranked(same, owner).length, 1, 'negative control: outranked() does see the later change from the same tablet');
  H.eq(staffAgg995.outrankedAlert(same, owner, staff), null, 'and the alert drops it: that tablet made it after (its stamps only go forward)');
  H.ok(staffAgg995.outrankedAlert([f995('staff.roles', { rolePerms: { staff: ['clock', 'rack'] } }, T + 240000, 'tab-2', 'o1')], f995('staff.roles', { rolePerms: { staff: ['clock'] } }, T + 60000, 'tab-office', 'o1'), staff).note.indexOf('change to the shop\'s role lists') >= 0, 'the role lists are told as the shop\'s');
});

H.test('11/2 evening (skeptic): outrankedAlert() tells each outranking tablet by what the hub saw — a change already on the hub when this one was made, or one dated more than a minute past its arrival, is a clock set fast (revoke it); one that reached the hub after this change was made is the newer decision and this one was delivered late (no revoke) — negative controls: with no arrival time known, the clock wording as before; a mix names each its own way', function () {
  const T = 1800000000000, PIN = staff995.pinRecordSync('1111');
  const base = [set995('m1', { name: 'Mo', role: 'manager', pin: PIN }, T, 'tab-office', 'o1'), set995('o1', { name: 'Olive', role: 'owner' }, T, 'tab-office', 'o1')];
  const staff = staffAgg995.fold(base);
  const arrived = function (f, at) { f.hubAt = at; return f; };
  /* late: made at T+5m on an offline tablet; the office's later change reached the hub at T+60m, before this one */
  const later = arrived(set995('m1', { pin: staff995.pinRecordSync('2468') }, T + 3600000, 'tab-office', 'o1'), T + 3600000);
  const late = set995('m1', { pin: staff995.pinRecordSync('1357') }, T + 300000, 'tab-back', 'o1');
  const a = staffAgg995.outrankedAlert(base.concat([later]), late, staff);
  H.ok(a && /did not take: it was made before, and reached the hub after, a change made later — PIN from tablet tab-office \(by Olive\)/.test(a.note) && /Make it again only if the earlier change is the one you want/.test(a.note) && !/revoke/.test(a.note), 'late: the older change, no revoke — ' + (a && a.note));
  /* a clock set fast: the later-dated change arrived at T, before this one was made at T+1m */
  const fast = arrived(set995('m1', { pin: PIN }, T + 240000, 'tab-fast', 'm1'), T);
  const own = set995('m1', { pin: staff995.pinRecordSync('9753') }, T + 60000, 'tab-office', 'o1');
  H.ok(/a change dated later is already on the hub — PIN from tablet tab-fast \(by Mo\)/.test(staffAgg995.outrankedAlert(base.concat([fast]), own, staff).note) && /revoke tablet tab-fast/.test(staffAgg995.outrankedAlert(base.concat([fast]), own, staff).note), 'fast: revoke it');
  /* dated more than a minute past its own arrival, even if it arrived after this change was made: still a clock set fast */
  const sneak = arrived(set995('m1', { pin: PIN }, T + 600000, 'tab-sneak', 'm1'), T + 400000);
  H.ok(/revoke tablet tab-sneak/.test(staffAgg995.outrankedAlert(base.concat([sneak]), late, staff).note), 'a stamp 3 minutes past its own arrival: revoke it, however late this change came');
  /* only 30 seconds past its arrival, but already on the hub when this change was made (10 s later): its stamp still ran ahead — revoke */
  const first = arrived(set995('m1', { pin: PIN }, T + 30000, 'tab-near', 'm1'), T);
  H.ok(/a change dated later is already on the hub — PIN from tablet tab-near/.test(staffAgg995.outrankedAlert(base.concat([first]), set995('m1', { pin: staff995.pinRecordSync('9753') }, T + 10000, 'tab-office', 'o1'), staff).note), 'on the hub before this change was made: the clock wording, whatever its stamp');
  const drift = arrived(set995('m1', { pin: PIN }, T + 430000, 'tab-drift', 'm1'), T + 400000);
  H.ok(!/revoke/.test(staffAgg995.outrankedAlert(base.concat([drift]), late, staff).note), 'negative control: 30 seconds past its arrival is honest drift — no revoke');
  /* no arrival known (a fact as the proofs above build it): the clock wording, as before */
  H.ok(/revoke tablet tab-fast/.test(staffAgg995.outrankedAlert(base.concat([set995('m1', { pin: PIN }, T + 240000, 'tab-fast', 'm1')]), own, staff).note), 'negative control: no arrival time: revoke, as before');
  /* a mix: the PIN outranked by a late-honest tablet, on/off by a fast one */
  const fastOff = arrived(set995('m1', { active: true }, T + 3700000, 'tab-fast', 'm1'), T);
  const both = set995('m1', { pin: staff995.pinRecordSync('1357'), active: false }, T + 300000, 'tab-back', 'o1');
  const m = staffAgg995.outrankedAlert(base.concat([later, fastOff]), both, staff).note;
  H.ok(/reached the hub after, a change made later — PIN from tablet tab-office/.test(m) && /a change dated later was already on the hub when it was made — on\/off from tablet tab-fast/.test(m) && /revoke tablet tab-fast \(Admin/.test(m) && !/revoke tablets?[^.]*tab-office/.test(m), 'a mix: each tablet its own way, and only the fast one to revoke — ' + m);
});

/* ── exported by the v2 exporter: the staff laws end here; the shop's own proof (its list is v1's) follows in the private suite. */
H.done();
