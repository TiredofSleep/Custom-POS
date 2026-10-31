/* @facts @module — THE MODULE CONTRACT (docs/V2-MODULAR-IMPORT.md, Part 3): defineModule() checks one module's manifest and registers
   its fact types; assemble() puts a set of modules together and hands the hub ONE judge of who may write what.
   This repo's own file.

   A module names, for each fact type it owns:
     validate   the shape, judged on every fact ever written (law 1: it may only widen after a release)
     admit      optional policy, judged on NEW facts only (the place for anything that may change)
     authority  who may write it:
                  'any'             any enrolled device (a fact about no one in particular)
                  'self'            only the person the fact is about (payload[self], default 'staffId')
                  'self-or:<right>' that person, an owner, or someone holding <right>
                  'needs:<right>'   an owner, or someone holding <right>
                  'owner'           an owner only
                  'hub-only'        only the hub's own stations (opts.trusted) — never a tablet
     pin        true: the hub must also hold a PIN check it made itself for that person on that tablet (a grant), not just the tablet's word
     rule       optional (p, who, staff, e) → null | reason: the module's own extra rule, run after the authority passes — it can only refuse more
   A type an imported aggregate already registered is ADOPTED ({ adopt: true, authority, pin }): the module gives it authority and
   leaves its validator and fold as imported.

   The judge reads the person from the fact's actor (hashed into the fact, so it cannot be swapped after) and their rights from the
   module that provides `staff` (its staff(master, staged) → { byId: Map, isOwner(who), can(who, right) }). A hub with no staff yet
   (a brand-new shop) admits, so its first owner can be written; from the first staff fact on, every rule applies.
   Said plainly, as the origin shop says it: the hub cannot tell who is HOLDING a tablet. A person's name on a fact is what that tablet
   put there. The hub-checked PIN (pin: true) and an instant revoke are the defence for the facts that matter, not a guarantee. */
'use strict';
const registry = require('../core/registry');

const NAME = /^[a-z][a-z0-9-]{0,39}$/;
const TYPE = /^[a-z][a-zA-Z0-9]*\.[a-z][a-zA-Z0-9.]*$/;
const RIGHT = /^[a-z][a-z0-9-]{0,39}$/;
const KINDS = ['any', 'self', 'self-or', 'needs', 'owner', 'hub-only'];

/* @facts @module — an authority string, parsed: {kind, right} — or throws, naming the module and type */
function parseAuthority(a, where) {
  const s = String(a || ''), i = s.indexOf(':'), kind = i < 0 ? s : s.slice(0, i), right = i < 0 ? null : s.slice(i + 1);
  if (KINDS.indexOf(kind) < 0) throw new Error(where + ': authority "' + s + '" is not one of ' + KINDS.join(', ') + ' (with :<right> for self-or and needs)');
  if ((kind === 'self-or' || kind === 'needs') !== !!right) throw new Error(where + ': authority "' + s + '" — self-or and needs take a right (self-or:payroll), the others take none');
  if (right && !RIGHT.test(right)) throw new Error(where + ': the right "' + right + '" is not a short lower-case word');
  return { kind: kind, right: right };
}

/* @facts @module — one module's manifest, checked; its own fact types registered (adopted ones left as imported). Returns it frozen. */
function defineModule(m) {
  if (!m || typeof m !== 'object') throw new Error('defineModule needs a manifest');
  if (!NAME.test(String(m.name || ''))) throw new Error('a module needs a short lower-case name (got ' + JSON.stringify(m.name) + ')');
  const at = 'module ' + m.name;
  if (!(Number.isSafeInteger(m.version) && m.version > 0)) throw new Error(at + ': version is a whole number from 1');
  const requires = Array.isArray(m.requires) ? m.requires.slice() : [];
  requires.forEach(function (r) { if (!NAME.test(String(r))) throw new Error(at + ': requires names a module by its name (got ' + JSON.stringify(r) + ')'); });
  const facts = m.facts || {}, types = Object.keys(facts);
  if (!types.length && !m.provides) throw new Error(at + ': a module owns at least one fact type or provides something');
  const agg = m.aggregate || null;
  if (types.some(function (t) { return !facts[t].adopt; }) && !(agg && NAME.test(String(agg.name || '')) && typeof agg.fold === 'function')) throw new Error(at + ': its own fact types need an aggregate { name, fold }');
  const prefixes = new Set();
  const rules = {};
  types.forEach(function (t) {
    const f = facts[t], where = at + ' · ' + t;
    if (!TYPE.test(t)) throw new Error(where + ': a fact type is prefix.verb (clock.in)');
    prefixes.add(t.split('.')[0]);
    const a = parseAuthority(f.authority, where);
    if (f.pin && (a.kind === 'any' || a.kind === 'hub-only')) throw new Error(where + ': a hub-checked PIN needs a person to check — not with "' + a.kind + '"');
    if (f.rule != null && typeof f.rule !== 'function') throw new Error(where + ': rule is a function (p, who, staff, e) → null | reason, or absent');
    rules[t] = { kind: a.kind, right: a.right, pin: !!f.pin, self: f.self || 'staffId', rule: f.rule || null, module: m.name };
    if (f.adopt) { if (!registry.knows(t)) throw new Error(where + ': adopt names a type nobody registered'); return; }
    if (typeof f.validate !== 'function') throw new Error(where + ': validate(payload) → null | reason is required (law 7: validate at the door)');
    if (f.admit != null && typeof f.admit !== 'function') throw new Error(where + ': admit is a function or absent');
    if (registry.knows(t)) throw new Error(where + ': already registered — a type has one home');
  });
  /* law 6: one aggregate reads only its own prefixes — every own type shares the aggregate, and no prefix is another module's */
  const needsConfig = {};
  Object.keys(m.needsConfig || {}).forEach(function (k) { const d = m.needsConfig[k]; if (d === undefined) throw new Error(at + ': needsConfig.' + k + ' has no default (every setting a module reads ships with a safe default)'); needsConfig[k] = d; });
  if (agg && !registry.aggregate(agg.name)) registry.registerAggregate(agg.name, { fold: agg.fold, inc: agg.inc, doc: agg.doc || (m.name + ' — ' + types.join(', ')) });
  types.forEach(function (t) {
    const f = facts[t]; if (f.adopt) return;
    registry.registerType(t, { aggregate: agg.name, tier: f.tier || 'immediate', effects: [], validate: f.validate, admit: f.admit || null, creates: f.creates || [], doc: f.doc || (m.name + ': ' + t) });
  });
  return Object.freeze({ name: m.name, version: m.version, layer: m.layer || 'operations', requires: requires, rules: rules, prefixes: Array.from(prefixes),
    aggregate: agg ? agg.name : null, views: m.views || {}, needsConfig: needsConfig, provides: m.provides || {}, hubServices: m.hubServices || [] });
}

/* @facts @module @permission — a set of modules, put together: requires closed, every type judged once, ONE staff source; → {rules, pinChecked, judge, config} */
function assemble(mods, opts) {
  opts = opts || {};
  const byName = new Map(), rules = {};
  mods.forEach(function (m) { if (byName.has(m.name)) throw new Error('module ' + m.name + ' is listed twice'); byName.set(m.name, m); });
  mods.forEach(function (m) { m.requires.forEach(function (r) { if (!byName.has(r)) throw new Error('module ' + m.name + ' requires ' + r + ', which is not in this build'); }); });
  mods.forEach(function (m) { Object.keys(m.rules).forEach(function (t) { if (rules[t]) throw new Error(t + ' is claimed by both ' + rules[t].module + ' and ' + m.name); rules[t] = m.rules[t]; }); });
  const staffers = mods.filter(function (m) { return typeof m.provides.staff === 'function'; });
  if (staffers.length > 1) throw new Error('two modules provide staff (' + staffers.map(function (m) { return m.name; }).join(', ') + ') — the hub needs one list of people');
  const needPeople = Object.keys(rules).filter(function (t) { return ['self', 'self-or', 'needs', 'owner'].indexOf(rules[t].kind) >= 0; });
  if (needPeople.length && !staffers.length) throw new Error('these facts name a person, but no module provides staff: ' + needPeople.join(', '));
  const staffOf = staffers.length ? staffers[0].provides.staff : null;
  const firstOk = staffers.length && typeof staffers[0].provides.firstOk === 'function' ? staffers[0].provides.firstOk : null;   /* what a brand-new shop's first fact must be */
  const trusted = opts.trusted || ['hub-services'];
  const grantCheck = typeof opts.grantCheck === 'function' ? opts.grantCheck : null;
  const pinChecked = Object.keys(rules).filter(function (t) { return rules[t].pin; });
  if (pinChecked.length && !grantCheck && !opts.noPins) throw new Error('these facts need a PIN the hub checks, but no grant check was given: ' + pinChecked.join(', '));
  const config = {}; mods.forEach(function (m) { Object.assign(config, m.needsConfig); });

  /* @facts @permission — the verdict on one fact: null (admit) or why it is refused */
  function judge(e, master, staged, bundle) {
    const r = rules[e.type];
    /* a registered type no module in THIS hub claims is refused: a hub runs the rules it was given, it never fails open (stage-2
       review: a hub built from some modules left the others' privileged types unjudged) */
    if (!r) return 'no module in this hub owns a ' + e.type;
    if (r.kind === 'hub-only') return trusted.indexOf(e.station) >= 0 ? null : 'only the hub writes a ' + e.type;
    if (trusted.indexOf(e.station) >= 0) return null;
    if (r.kind === 'any') return null;
    const staff = staffOf(master || [], staged || []);
    /* a brand-new shop: nobody to judge by yet — but its first fact must be what the staff module says a shop starts with (its owner),
       or nobody could ever be made an owner afterwards (stage-2 review) */
    if (!staff.byId.size) return (firstOk && !firstOk(e)) ? 'a new shop starts with its owner (an active owner, written first)' : null;
    const who = e.actor != null ? staff.byId.get(String(e.actor)) : null;
    if (!who) return 'a ' + e.type + ' must name an active person (actor), and ' + (e.actor == null ? 'it names no one' : 'that person is not on staff');
    if (who.active === false) return who.name + ' is not active';
    const p = e.payload || {}, owner = staff.isOwner(who);
    let why = null;
    if (r.kind === 'owner' && !owner) why = 'only an owner may write a ' + e.type;
    else if (r.kind === 'needs' && !owner && !staff.can(who, r.right)) why = who.name + ' does not have "' + r.right + '"';
    else if (r.kind === 'self' && String(p[r.self]) !== String(who.id)) why = who.name + ' may write a ' + e.type + ' only about themselves';
    else if (r.kind === 'self-or' && String(p[r.self]) !== String(who.id) && !owner && !staff.can(who, r.right)) why = who.name + ' may write only their own (another person\'s needs "' + r.right + '")';
    if (why) return why;
    /* the module's own extra rule: it may only refuse more — and a rule that throws refuses THIS fact only (closed, never open; never the
       whole send, which would wedge the tablet resending it) */
    if (r.rule) { try { why = r.rule(p, who, staff, e); } catch (x) { why = 'the ' + r.module + ' module\'s rule failed on this ' + e.type; } if (why) return why; }
    if (r.pin && grantCheck && !grantCheck((bundle && bundle.grants) || [], String(who.id), e.station, e)) return 'a ' + e.type + ' needs a PIN the hub checked for ' + who.name + ' on this tablet';
    return null;
  }
  return { rules: rules, pinChecked: pinChecked, judge: judge, config: config, modules: mods.map(function (m) { return m.name; }) };
}

module.exports = { defineModule: defineModule, assemble: assemble, parseAuthority: parseAuthority };
