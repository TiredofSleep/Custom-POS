'use strict';
/* ============================================================================
 * EVENT — the only unit of change in the whole system.
 * @fact — the one shape of a change: minted once, hashed over its wire form, validated at every door, never edited
 * ----------------------------------------------------------------------------
 * An event is the code version of a person clicking through the system: one
 * intent, recorded once, immutable forever. Local or merged it has the same
 * shape — replaying the log IS replaying the clicks.
 *
 * THE HUB IS THE AUTHORITY (2026-09-22). A station mints an event offline with
 * a UNIQUE ID in its own namespace and a content hash; the hub decides whether
 * it is admitted (the device's access token names the station), gives it a
 * position, and refuses a second fact under a held id. The id is the
 * idempotency key: a retry, a re-offer, a restored backup can never make a fact
 * twice. (Before 9/22 every event was signed by a per-station key and chained
 * by a per-station receipt number, so every tablet defended itself against a
 * cloned copy of itself — six adversary rounds, never dry. That layer is gone;
 * the story is in git and ARCHITECTURE-V2.md.)
 *
 * ⚠️ THE HASH IS OVER THE WIRE FORM, NEVER THE LIVE OBJECT (round 1): a payload
 * with an `undefined` member hashed one way in memory and another after JSON.
 * makeEvent FREEZES the fact through a JSON round-trip first, so this identity
 * always holds:  hashOf(e) === hashOf(JSON.parse(JSON.stringify(e)))
 *
 * ⚠️ STAMPS ARE BOUNDED (round 2): a counter of 2^53 froze every clock that
 * observed it (c+1 rounded back to c). No stamp a real clock could not issue is
 * ever accepted or observed.
 *
 * Shape:
 *   id/type/aggregate/key/payload   the fact (payload JSON-frozen)
 *   hlc       {t,c,id} — the ONE total order (hlc.js)
 *   basedOn   last event this writer had seen for (aggregate,key)
 *   station   who made it   actor   the person   at   wall-clock ms of the moment
 *   hash      sha-256 over all of the above, in wire form
 *   pos/epoch where the hub put it, and which hub — not the fact, unhashed
 * ========================================================================== */
const crypto = require('crypto');

/* ⚠️ AN EVENT ID IS MINTED IN ITS ISSUER'S NAMESPACE (round 3): "<station>/<...>". "/" is not a legal character in a
   station id, so no station can mint into another's namespace; the hub refuses a second fact under a held id. */
let __n = 0;
/* @fact @sync — mints the id a fact keeps forever, inside its own station's namespace; that id is the retry key, so a re-offer or a restored backup can never make the fact twice */
function newId(stationId) {
  __n += 1;
  return String(stationId || 'anon') + '/' + Date.now().toString(36) + '-' + __n.toString(36) + '-' + crypto.randomBytes(6).toString('hex');
}

/* The wire form of a value — exactly what JSON carries. Throws for what JSON cannot (BigInt, cycles). */
/* @fact — a value exactly as JSON carries it; throws for what cannot travel (a BigInt, a cycle), so a fact never hashes one way in memory and another on the wire */
function wire(v) { return (v === undefined) ? undefined : JSON.parse(JSON.stringify(v)); }

/* @fact — the one byte-for-byte form a fact is hashed in (keys sorted): the fast road when it can, the JSON round trip when it declines; every station and the hub must get the same bytes */
function canonical(v) { const x = canonFast(v, 0); return x === undefined ? stable(wire(v)) : x; }
const KEYQ = new Map();   /* a key's JSON and its colon, kept (keys repeat on every fact: orderId, custId, t, c, id …) */
/* @fact @proof — the canonical form in ONE pass for plain wire data, byte for byte what stable(wire(v)) gives (batch `perf`,
   audit E59: the JSON round trip and the arrays of pieces were half of every hash — at boot, on every fact taken in, at
   the hub). Anything the round trip would change — undefined, a function, NaN or Infinity, a Date or anything with toJSON,
   a Map, a class, an array with a hole, a cycle or nesting past 100 — answers undefined, and the slow road runs instead. */
function canonFast(v, depth) {
  if (v === null) return 'null';
  const t = typeof v;
  if (t === 'string' || t === 'boolean') return JSON.stringify(v);
  if (t === 'number') return isFinite(v) ? JSON.stringify(v) : undefined;
  if (t !== 'object' || depth > 100 || typeof v.toJSON === 'function') return undefined;
  const proto = Object.getPrototypeOf(v);
  if (proto === Array.prototype) {
    let s = '[';
    for (let i = 0; i < v.length; i++) { if (!(i in v)) return undefined; const x = canonFast(v[i], depth + 1); if (x === undefined) return undefined; s += (i ? ',' : '') + x; }
    return s + ']';
  }
  if (proto !== Object.prototype && proto !== null) return undefined;
  const ks = Object.keys(v).sort(); let s = '{';
  for (let i = 0; i < ks.length; i++) {
    const x = canonFast(v[ks[i]], depth + 1); if (x === undefined) return undefined;
    let q = KEYQ.get(ks[i]); if (q === undefined) { q = JSON.stringify(ks[i]) + ':'; if (KEYQ.size < 5000) KEYQ.set(ks[i], q); }
    s += (i ? ',' : '') + q + x;
  }
  return s + '}';
}
/* @fact — the slow road to the canonical form: keys sorted at every level over wire data; what the fast road must equal byte for byte */
function stable(v) {
  if (v === null || v === undefined) return 'null';
  if (typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
  return '{' + Object.keys(v).sort().map(function (k) { return JSON.stringify(k) + ':' + stable(v[k]); }).join(',') + '}';
}

const HASHED = ['id', 'type', 'aggregate', 'key', 'payload', 'hlc', 'basedOn', 'station', 'actor', 'at'];
/* @fact — sha-256 over exactly the hashed fields (id through at); the hub's pos and epoch are never hashed, so filing a fact never changes its hash */
function hashOf(e) {
  const body = {};
  HASHED.forEach(function (k) { body[k] = (e[k] === undefined ? null : e[k]); });
  return crypto.createHash('sha256').update(canonical(body), 'utf8').digest('hex');
}

const MAX_C = 4294967296;      // 2^32 same-ms events — no clock issues more
const MAX_T = 1e14;            // ~ year 5138 in ms — no shop clock is later
/* @fact @clock — refuses a stamp no real clock could issue (t past MAX_T, a counter past 2^32, no station id), because one absurd stamp would freeze every clock that saw it */
function validStamp(h) {
  return !!h && typeof h === 'object' && Number.isFinite(h.t) && h.t > 0 && h.t < MAX_T &&
    Number.isInteger(h.c) && h.c >= 0 && h.c <= MAX_C && typeof h.id === 'string' && h.id.length > 0;
}

/* Why an object is not a well-formed event, or null. One judgement, used at every door. */
/* @fact — the ONE judgement of a well-formed event, used at every door: why it is not one (an id outside its station's namespace, a stamp from another station, a bad hash), or null */
function shapeError(e) {
  if (!e || typeof e !== 'object' || Array.isArray(e)) return 'not an object';
  if (typeof e.id !== 'string' || !e.id || e.id === '__proto__' || e.id === 'constructor' || e.id === 'prototype') return 'id must be a plain non-empty string';
  if (typeof e.type !== 'string' || !e.type) return 'type must be a non-empty string';
  if (typeof e.aggregate !== 'string' || !e.aggregate) return 'aggregate must be a non-empty string';
  if (typeof e.key !== 'string') return 'key must be a string';
  if (typeof e.station !== 'string' || !e.station) return 'station must be a non-empty string';
  if (e.station.indexOf('/') >= 0) return 'station id may not contain "/" (the id namespace separator)';
  if (e.id.indexOf(e.station + '/') !== 0 || e.id.length <= e.station.length + 1) return 'id must be minted in the issuer\'s namespace ("' + e.station + '/…")';
  if (!validStamp(e.hlc)) return 'hlc stamp is malformed or out of range';
  if (e.hlc.id !== e.station) return 'hlc stamp was issued by a different station than the event claims';
  if (!Number.isFinite(e.at)) return 'at must be a finite number';
  if (typeof e.hash !== 'string' || !/^[0-9a-f]{64}$/.test(e.hash)) return 'hash is not a sha-256';
  if (e.payload === null || typeof e.payload !== 'object' || Array.isArray(e.payload)) return 'payload must be a plain object';
  return null;
}

/* makeEvent(fields) — validate BEFORE minting anything; a rejected event costs the station nothing. */
/* @fact — mints a fact: everything is checked BEFORE an id is spent, the payload frozen through JSON, then hashed; a refused event costs the station nothing */
function makeEvent(fields) {
  if (!fields || !fields.type) throw new Error('event: type is required (the path to a home)');
  if (!fields.aggregate) throw new Error('event: aggregate is required');
  if (!validStamp(fields.hlc)) throw new Error('event: hlc stamp is malformed or out of range');
  if (!fields.station || typeof fields.station !== 'string') throw new Error('event: an event must name the station that made it');
  if (fields.hlc.id !== fields.station) throw new Error('event: the stamp must be issued by the station that made the event');
  let payload;
  try { payload = wire(fields.payload == null ? {} : fields.payload); }
  catch (err) { throw new Error('event: payload is not transmissible (' + ((err && err.message) || err) + ')'); }
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('event: payload must be a plain object');
  const at = (fields.at == null ? Date.now() : Number(fields.at));
  if (!Number.isFinite(at)) throw new Error('event: at must be a finite time');
  const e = {
    id: (fields.id != null ? String(fields.id) : newId(fields.station)),
    type: String(fields.type), aggregate: String(fields.aggregate), key: String(fields.key), payload: payload,
    hlc: { t: fields.hlc.t, c: fields.hlc.c, id: fields.hlc.id },
    basedOn: (fields.basedOn == null ? null : String(fields.basedOn)),
    station: fields.station, actor: (fields.actor == null ? null : String(fields.actor)), at: at,
    hash: null, pos: null, epoch: null
  };
  e.hash = hashOf(e);
  const bad = shapeError(e); if (bad) throw new Error('event: ' + bad);
  return e;
}

/* Well-formed and its content intact. (Whether its station may write is the hub's to judge, by the device's access.) */
/* @fact @sync — well-formed and its content untouched since it was hashed; whether its station may write is the hub's call, not this one's */
function verify(e) { return shapeError(e) === null && e.hash === hashOf(e); }

module.exports = { makeEvent: makeEvent, newId: newId, hashOf: hashOf, verify: verify, shapeError: shapeError,
  validStamp: validStamp, canonical: canonical, wire: wire, HASHED: HASHED, MAX_C: MAX_C, MAX_T: MAX_T };
