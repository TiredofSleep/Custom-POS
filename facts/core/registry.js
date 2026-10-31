'use strict';
/* ============================================================================
 * REGISTRY — the indexed spine. "Labeled and indexed so well that each delta
 * is a path to a home."
 * @fact @fold @docs — every fact type with the one aggregate that folds it, its tier and its side effects; an unregistered type is refused
 * ----------------------------------------------------------------------------
 * Every event type is registered with the one aggregate that folds it, its TIER,
 * its side-EFFECTS, an optional payload VALIDATE, and a human description. An
 * unregistered type is refused; an invalid payload is refused before a receipt
 * number is spent. docs/EVENT-CATALOG.md is generated from this.
 *
 *   tier 'immediate' — a completed operation on the money/clothes path: sent
 *                      the moment it finishes.
 *   tier 'trail'     — activity detail: same hash and chain, rides the next commit.
 *   effects          — side-effects ('sms') that fire ONCE, at commit, after witness.
 *   validate(payload) → null | reason
 * ========================================================================== */
const TYPES = new Map();
const AGGREGATES = new Map();

/* THE ID RULE (10/18, enterprise batch 1 — security): an id a NEW fact CREATES (a customer, an order, a bag, an employee, a price, a
   card, a reminder …) is letters, digits and _ . : - only, 1 to 64 of them. About 281 of v1's inline handlers paste an id raw into
   onclick="f('…')": an id holding a quote would be code on every screen that draws it, on every tablet. Every id the shop mints
   today fits (uid(): 'c-…', 'o-…', 'e-…'; v1's uid() 7 letters and digits; 'rt_AB1234_1x', 'emp_abcd1234_0_wxyzq', 'cd…-…', 'h…',
   'ph_…', order numbers '3-01-02-26-0001-01'). It is judged through admit, on NEW facts only: the shop's history is never re-judged,
   and a fact that only NAMES an id (an edit, a payment, a reference) is not judged by it. A type lists the ids it creates in
   def.creates — dotted paths into its payload ('bag.orderId'); an absent one is skipped (validate says whether it is required).
   A type that both creates and re-sets a record (employee.set, pricebook.item.set, punch.ack signed …) re-sets one the shop already
   holds under the same id: the caller's known(path, id) says so (the hub's facts, the tablet's log), and an id already in the shop's
   history is a reference, never judged as new — an old record whose id predates the rule can still be edited. */
const ID_RULE = /^[A-Za-z0-9_.:-]{1,64}$/;
/* @fact @permission — why an id a new fact creates is refused, or null: letters, digits and _ . : - only, 1 to 64 of them */
function idRefusal(what, v) { if (Number.isSafeInteger(v) && v >= 0) return null; /* a whole number (a store 1) is digits */ return (typeof v === 'string' && ID_RULE.test(v)) ? null : what + ' may hold only letters, digits and _ . : - (1 to 64 of them) — a new record\'s id never carries a quote, a space or a bracket'; }
/* @fact — one dotted path's value inside a payload ('bag.orderId'), or undefined */
function atPath(p, dotted) { return String(dotted).split('.').reduce(function (o, k) { return (o != null && typeof o === 'object') ? o[k] : undefined; }, p); }
/* @fact @permission — a type's admit with the id rule in front: each id it creates judged first (unless known(path, id) says a fact of
   this type already holds it — the shop's history), then the type's own new-facts rule */
function withIdRule(creates, own) {
  if (!creates.length) return own;
  return function (p, known) {
    for (let i = 0; i < creates.length; i++) { const v = atPath(p, creates[i]); if (v == null) continue; const no = idRefusal(creates[i], v); if (no && !(typeof known === 'function' && known(creates[i], v))) return no; }
    return own ? own(p, known) : null;
  };
}
/* @fact @fold — whether any fact in a list is of this type and holds this id at that path (the id rule's "known" over a log or a hub's facts) */
function heldIn(list, type, dotted, v) { for (let i = (list ? list.length : 0) - 1; i >= 0; i--) { const x = list[i]; if (x && x.type === type && atPath(x.payload, dotted) === v) return true; } return false; }

/* @fact — a fact type joins the spine once, with its one aggregate, tier, side effects and validator; a second registration, no aggregate or an unknown tier stops the start */
function registerType(type, def) {
  if (TYPES.has(type)) throw new Error('registry: type already registered: ' + type);
  if (!def || !def.aggregate) throw new Error('registry: type ' + type + ' needs an aggregate');
  const tier = def.tier || 'trail';
  if (tier !== 'immediate' && tier !== 'trail') throw new Error('registry: tier must be immediate|trail: ' + type);
  const creates = Array.isArray(def.creates) ? def.creates.slice() : [];   /* 10/18: the ids a new fact of this type creates (THE ID RULE above) */
  TYPES.set(type, { type: type, aggregate: def.aggregate, tier: tier, effects: (def.effects || []).slice(), validate: (typeof def.validate === 'function' ? def.validate : null), admit: withIdRule(creates, typeof def.admit === 'function' ? def.admit : null), creates: creates, doc: def.doc || '' });   /* admit (10/1): a rule for NEW facts only — validate is judged on every fact ever, so it may only widen (hub.js); a rule the shop's own history breaks lives here */
}
/* @fact @fold — an aggregate joins once, with the fold that turns its facts into state and how it words its own alerts; no fold, no aggregate */
function registerAggregate(name, def) {
  if (AGGREGATES.has(name)) throw new Error('registry: aggregate already registered: ' + name);
  if (typeof def.fold !== 'function') throw new Error('registry: aggregate ' + name + ' needs a fold()');
  const inc = def.inc || null;   /* 9/26 (core/incfold.js): the fold split into init / step / view, so it is kept up to date one fact at a time */
  if (inc && (typeof inc.init !== 'function' || typeof inc.step !== 'function' || typeof inc.view !== 'function')) throw new Error('registry: aggregate ' + name + '\'s inc needs init(), step(s, e) and view(s)');
  AGGREGATES.set(name, { name: name, fold: def.fold, inc: inc, detectConflicts: def.detectConflicts || function () { return []; }, describe: (typeof def.describe === 'function' ? def.describe : null), doc: def.doc || '' });   // describe(conflict) → {kind, note}: each aggregate words its own alerts
}
/* @fact — is this a registered fact type; an unknown one is refused everywhere */
function knows(type) { return TYPES.has(type); }
/* @fact — one fact type's aggregate, tier, side effects and validator */
function typeDef(type) { return TYPES.get(type); }
/* @fold — one aggregate's fold, its conflict check and how it words an alert */
function aggregate(name) { return AGGREGATES.get(name); }
/* @fact @docs — every registered fact type, for the catalog and the effects digest */
function allTypes() { return Array.from(TYPES.values()); }
/* @fold @docs — every aggregate, for the catalog */
function allAggregates() { return Array.from(AGGREGATES.values()); }
/* a digest of what the registry OWES as side-effects (type -> effects), so a station can tell that a deploy changed it:
   an effect that came into existence after a fact was witnessed is never fired blind over the whole history (round 5) */
/* @fact @sync — a short hash of which fact types owe side effects, so a station can tell a deploy changed them; a new effect is never fired blind over old history */
function effectsDigest() {
  const crypto = require('crypto');
  const body = allTypes().filter(function (t) { return t.effects.length; }).map(function (t) { return t.type + ':' + t.effects.slice().sort().join(','); }).sort().join('|');
  return crypto.createHash('sha256').update(body, 'utf8').digest('hex').slice(0, 24);
}

/* @fact @docs — docs/EVENT-CATALOG.md from the registry itself; a type not listed there is refused */
function catalogMarkdown() {
  const lines = ['# Event Catalog', '', 'Generated from `core/registry.js` — every registered event type, its home, its tier, its side-effects, and whether its payload is validated. If it is not here, the system refuses it.', ''];
  allAggregates().forEach(function (agg) {
    lines.push('## ' + agg.name, '', agg.doc, '', '| type | tier | effects | validated | what it means |', '|---|---|---|---|---|');
    allTypes().filter(function (t) { return t.aggregate === agg.name; }).forEach(function (t) {
      lines.push('| `' + t.type + '` | ' + t.tier + ' | ' + (t.effects.length ? t.effects.join(', ') : '—') + ' | ' + (t.validate ? 'yes' : '—') + ' | ' + t.doc + ' |');
    });
    lines.push('');
  });
  return lines.join('\n');
}

module.exports = { registerType: registerType, registerAggregate: registerAggregate, knows: knows, typeDef: typeDef, aggregate: aggregate, allTypes: allTypes, allAggregates: allAggregates, catalogMarkdown: catalogMarkdown, effectsDigest: effectsDigest, ID_RULE: ID_RULE, idRefusal: idRefusal, atPath: atPath, heldIn: heldIn };
