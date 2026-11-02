/* the facts engine for a browser — built by facts/bundle.js; do not edit, rebuild */
(function (G) {
"use strict";
var __mods = {}, __cache = {};
function __def(k, table, fn) { __mods[k] = { table: table, fn: fn }; }
function __load(k) { if (__cache[k]) return __cache[k].exports; var m = __mods[k]; if (!m) throw new Error("not in the bundle: " + k); var mod = { exports: {} }; __cache[k] = mod;
  m.fn(mod, mod.exports, function (spec) { var t = m.table[spec]; if (!t) throw new Error(k + ": require(\"" + spec + "\") is not in the bundle"); return __load(t); }); return mod.exports; }
__def("station/crypto-shim.js", {}, function (module, exports, require) {
'use strict';
/* ============================================================================
 * The two things v2's core asks of Node's `crypto`, for a browser (2026-09-23):
 *   createHash('sha256').update(text, 'utf8').digest('hex')   — MUST equal Node's byte for byte: the hub verifies every
 *                                                                fact's hash, so a different hash is a refused fact
 *   randomBytes(n).toString('hex')                            — from crypto.getRandomValues
 * A plain synchronous SHA-256 (FIPS 180-4), because the station's record() is synchronous. Proven equal to Node's in
 * the suite (§31) over ASCII, accents, emoji and long text.
 * ========================================================================== */
const K = [0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2];
const TE = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;   /* one encoder, kept: it holds no state (batch perf) */
function utf8(str) {
  if (TE) return TE.encode(str);
  const out = []; for (let i = 0; i < str.length; i++) {
    let c = str.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) { const d = str.charCodeAt(i + 1); if (d >= 0xdc00 && d <= 0xdfff) { c = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00); i++; } }
    if (c < 0x80) out.push(c); else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return Uint8Array.from(out);
}
/* FIPS 180-4 on 32-bit integer arrays (batch `perf`, 9/25, audit E59): the same digest byte for byte (proof 465 holds it to
   Node's own over every length to 1,100 bytes and a year of facts), about 3.5 times faster than the first shim — every fact a
   tablet loads at boot, takes in or makes is hashed here. */
const K32 = Int32Array.from(K), W32 = new Int32Array(64), HEX2 = [];
for (let i = 0; i < 256; i++) HEX2.push((i < 16 ? '0' : '') + i.toString(16));
function sha256hex(bytes) {
  const l = bytes.length, bitLenHi = Math.floor(l / 0x20000000), bitLenLo = (l * 8) >>> 0;
  const n = ((l + 9 + 63) >> 6) << 6, m = new Uint8Array(n); m.set(bytes); m[l] = 0x80;
  m[n - 8] = (bitLenHi >>> 24) & 255; m[n - 7] = (bitLenHi >>> 16) & 255; m[n - 6] = (bitLenHi >>> 8) & 255; m[n - 5] = bitLenHi & 255;
  m[n - 4] = (bitLenLo >>> 24) & 255; m[n - 3] = (bitLenLo >>> 16) & 255; m[n - 2] = (bitLenLo >>> 8) & 255; m[n - 1] = bitLenLo & 255;
  const W = W32;
  let h0 = 0x6a09e667 | 0, h1 = 0xbb67ae85 | 0, h2 = 0x3c6ef372 | 0, h3 = 0xa54ff53a | 0, h4 = 0x510e527f | 0, h5 = 0x9b05688c | 0, h6 = 0x1f83d9ab | 0, h7 = 0x5be0cd19 | 0;
  for (let off = 0; off < n; off += 64) {
    for (let t = 0; t < 16; t++) { const j = off + (t << 2); W[t] = (m[j] << 24) | (m[j + 1] << 16) | (m[j + 2] << 8) | m[j + 3]; }
    for (let t = 16; t < 64; t++) {
      const x = W[t - 15], y = W[t - 2];
      const s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3), s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
      W[t] = (W[t - 16] + s0 + W[t - 7] + s1) | 0;
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
    for (let t = 0; t < 64; t++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7)), ch = (e & f) ^ (~e & g), t1 = (h + S1 + ch + K32[t] + W[t]) | 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10)), mj = (a & b) ^ (a & c) ^ (b & c), t2 = (S0 + mj) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0; h4 = (h4 + e) | 0; h5 = (h5 + f) | 0; h6 = (h6 + g) | 0; h7 = (h7 + h) | 0;
  }
  let s = ''; const H = [h0, h1, h2, h3, h4, h5, h6, h7];
  for (let i = 0; i < 8; i++) { const x = H[i]; s += HEX2[(x >>> 24) & 255] + HEX2[(x >>> 16) & 255] + HEX2[(x >>> 8) & 255] + HEX2[x & 255]; }
  return s;
}
function createHash(alg) {
  if (String(alg).toLowerCase() !== 'sha256') throw new Error('crypto-shim: only sha256');
  let text = '';
  const h = { update: function (s) { text += String(s); return h; }, digest: function (enc) { if (enc !== 'hex') throw new Error('crypto-shim: hex only'); return sha256hex(utf8(text)); } };
  return h;
}
function randomBytes(n) {
  const b = new Uint8Array(n);
  const g = (typeof globalThis !== 'undefined' && globalThis.crypto && globalThis.crypto.getRandomValues) ? globalThis.crypto : null;
  if (!g) throw new Error('crypto-shim: no crypto.getRandomValues in this browser');
  g.getRandomValues(b);
  return { toString: function (enc) { if (enc !== 'hex') throw new Error('crypto-shim: hex only'); return Array.from(b).map(function (x) { return ('0' + x.toString(16)).slice(-2); }).join(''); } };
}
module.exports = { createHash: createHash, randomBytes: randomBytes, sha256hex: sha256hex, utf8: utf8 };

});
__def("core/hlc.js", {}, function (module, exports, require) {
'use strict';
/* ============================================================================
 * HLC — Hybrid Logical Clock. The ONE order every station applies events in.
 * @clock @fact — the one order every station applies facts in; a peer's stamp is believed only if a real clock could have issued it
 * ----------------------------------------------------------------------------
 * A structured stamp {t, c, id} compared only by compare(): no packed floats,
 * no scale to confuse (the old system's two-clocks bug). compareEvents() falls
 * through to (station, sseq, id), so no two distinct events can ever tie and
 * arrival order can never leak into a fold (round 1).
 *
 * Bounded and self-healing (rounds 2 and 3): a peer's stamp is absorbed only if
 * a real clock could have issued it (finite t below MAX_T, integer 0..MAX_C)
 * AND it is not more than MAX_DRIFT ahead of this station's own wall — a peer
 * whose clock says 2090 orders its own events late, but it cannot drag every
 * station's clock to the ceiling where the next stamp would be out of range.
 * A counter that cannot advance rolls the millisecond instead of repeating; a
 * wall clock that is broken from boot still issues a valid, increasing stamp.
 * ========================================================================== */
const MAX_C = 4294967296, MAX_T = 1e14;
const MAX_DRIFT_MS = 24 * 3600 * 1000;                            // a day ahead of my wall is the most I will believe of a peer
/* @clock — a stamp a real clock could have issued (finite t below MAX_T, a whole counter 0..MAX_C); anything else is ignored, never observed */
function sane(stamp) { return !!stamp && Number.isFinite(stamp.t) && stamp.t > 0 && stamp.t < MAX_T && Number.isInteger(stamp.c) && stamp.c >= 0 && stamp.c <= MAX_C; }

/* @clock @station — one station's clock: every stamp strictly after the last, a peer's stamp absorbed only if sane and at most a day ahead of the wall, a broken wall still ticking */
function makeClock(stationId, opts) {
  if (stationId == null || String(stationId) === '') throw new Error('hlc: a clock must know its station');
  const id = String(stationId);
  opts = opts || {};
  const wall = opts.now || Date.now;
  const maxDrift = (opts.maxDriftMs > 0) ? opts.maxDriftMs : MAX_DRIFT_MS;
  let t = 0, c = 0;
  /* @clock — the wall time, or null when the wall is broken (throws, NaN, zero, past MAX_T), so a bad wall clock never becomes a stamp */
  function wallOk() { let w; try { w = wall(); } catch (e) { w = NaN; } return (Number.isFinite(w) && w > 0 && w < MAX_T) ? w : null; }
  return {
    now() {
      const w = wallOk();
      if (w != null && w > t) { t = w; c = 0; }
      else if (t === 0) { t = 1; c = 0; }                             // a broken wall from boot: start at the floor, count from there
      else if (c + 1 === c || c >= MAX_C) { t = t + 1; c = 0; }      // the counter cannot advance → roll the ms: strictly increasing, always
      else { c += 1; }
      return { t: t, c: c, id: id };
    },
    observe(stamp) {
      if (!sane(stamp)) return;
      const w = wallOk();
      if (w != null && stamp.t > w + maxDrift) return;               // a stamp from a clock too far ahead of mine is ordered, not obeyed
      if (stamp.t > t) { t = stamp.t; c = stamp.c; }
      else if (stamp.t === t && stamp.c > c) { c = stamp.c; }
    },
    /* my OWN history is not a peer's claim: seed the clock from it with no drift cap (a wall a year behind my last stamp is
       the wall's fault; issuing stamps before my own history would file today under last year) */
    adopt(stamp) { if (!sane(stamp)) return; if (stamp.t > t) { t = stamp.t; c = stamp.c; } else if (stamp.t === t && stamp.c > c) { c = stamp.c; } },
    peek() { return { t: t, c: c, id: id }; },
    /* how far ahead of my wall my logical time has drifted (0 when the wall is broken or I am behind it) */
    drift() { const w = wallOk(); return (w == null) ? 0 : Math.max(0, t - w); },
    id: id
  };
}

/* @clock — the ONE order of two stamps: time, then counter, then station id; nothing else may order stamps */
function compare(a, b) {
  if (a.t !== b.t) return a.t < b.t ? -1 : 1;
  if (a.c !== b.c) return a.c < b.c ? -1 : 1;
  const ai = String(a.id), bi = String(b.id);
  return ai < bi ? -1 : (ai > bi ? 1 : 0);
}
/* Order two EVENTS; tolerant of a malformed stamp (sorts earliest) so a bad row can never crash a fold. */
/* @clock @fold — orders two facts with no tie ever (stamp, station, sseq, id), a malformed stamp sorting first, so arrival order never leaks into a fold and a bad row never crashes one */
function compareEvents(a, b) {
  const ah = a && a.hlc, bh = b && b.hlc;
  if (!ah || !bh) return (!ah && !bh) ? 0 : (!ah ? -1 : 1);
  const s = compare(ah, bh); if (s) return s;
  const as = String(a.station), bs = String(b.station);
  if (as !== bs) return as < bs ? -1 : 1;
  if (a.sseq !== b.sseq) return (a.sseq || 0) < (b.sseq || 0) ? -1 : 1;
  const ai = String(a.id), bi = String(b.id);
  return ai < bi ? -1 : (ai > bi ? 1 : 0);
}
/* @clock — stamp a is strictly later than b: the whole question a latest-wins fold asks */
function newer(a, b) { return compare(a, b) > 0; }

module.exports = { makeClock: makeClock, compare: compare, compareEvents: compareEvents, newer: newer, sane: sane, MAX_DRIFT_MS: MAX_DRIFT_MS, MAX_C: MAX_C, MAX_T: MAX_T };

});
__def("core/event.js", {"crypto":"station/crypto-shim.js"}, function (module, exports, require) {
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

});
__def("core/registry.js", {"crypto":"station/crypto-shim.js"}, function (module, exports, require) {
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

});
__def("core/incfold.js", {"./hlc":"core/hlc.js"}, function (module, exports, require) {
'use strict';
/* ============================================================================
 * INCFOLD — a fold kept up to date one fact at a time, so a tap costs the same in year five as on day one (2026-09-26)
 * @fold @fact — each aggregate's fold split into init / step / view; the running state kept; a late fact replayed from a checkpoint
 * ----------------------------------------------------------------------------
 * Owner, 9/26: "i want it to always be about the same, i never want sticky or data overhead to be available as an issue."
 * Measured before (tools/perf-scale.js, this PC): every new fact re-folded ALL history — 0.24 s at a year of the shop, 1.5 s
 * at five, and more on a counter PC or a phone.
 *
 * THE CONTRACT an aggregate signs — registry.registerAggregate(AGG, { fold, inc: { … } }):
 *   inc.accepts(e)   the facts its fold reads (default: its own aggregate's, e.aggregate === AGG)
 *   inc.order        'hlc' — the fold sorts them by hlc.compareEvents (the default); 'arrival' — it reads them in log order
 *   inc.init()       a fresh state: plain data only (objects, arrays, Maps, Sets, numbers, strings, booleans, null) — no
 *                    functions, no class instances — so structuredClone copies it whole (the checkpoints)
 *   inc.step(s, e)   one fact into the state; it reads nothing but s and e (never the list of facts, never the clock)
 *   inc.view(s)      what fold() returns, worked out from the state. It may be called any number of times between steps and
 *                    never changes anything a later step reads (it may write derived fields idempotently: the same state, the
 *                    same writes). Its records may be the state's own objects: a caller reads them, never keeps them past the
 *                    next fact, never changes them.
 *   and the aggregate's fold(events) returns foldVia(inc, events, AGG): the full fold IS init + every step + view, so the
 *   incremental answer and the full answer are one code path and cannot drift apart.
 *
 * THE ENGINE (makeInc): facts arrive in any order, in any batches. A batch that sorts after everything held is one step
 * per fact. A fact that sorts earlier — a peer's fact arriving late, a tablet back from a day offline — is put in its place
 * and the state rebuilt from the newest checkpoint at or before it: a copy of the state kept every `every` facts (the
 * newest `keep` of them). Earlier than every kept checkpoint: rebuilt from the start — a whole fold, as before: rare, and
 * still right. The view is worked out once per change and handed to everyone until the next.
 * 9/26, after the five builders measured it (the copy is the cost — 1.1 s of money's state at five years):
 *   · a checkpoint the same feed would push out is never copied: loading five years makes the last `keep` copies, not 98;
 *   · a late fact TAKES the checkpoint it restores (no copy on the tap path) and its place is filled later: synchronously
 *     once `every` facts have passed (the hub), or — lazy: true, the tablet — when the screen is idle (maintain()), with a
 *     synchronous copy only if idle never comes for 4 × every facts;
 *   · the copy keeps each object's null prototype (structuredClone drops it, so a replayed state read an id like
 *     'constructor' differently from a fresh fold) and every shared reference.
 * ========================================================================== */
const hlc = require('./hlc');

const CHECKPOINT_EVERY = 1000, KEEP = 6;

/* @fold — a copy of a state for a checkpoint: Maps, Sets, arrays and plain objects, each object's prototype (null or Object's)
   kept, a shared object copied once and shared again (an order in both a list and a bay's set stays one order) */
function cloneState(s) {
  const seen = new Map();
  const c = function (x) {
    if (x === null || typeof x !== 'object') return x;
    const had = seen.get(x); if (had !== undefined) return had;
    let out;
    if (Array.isArray(x)) { out = new Array(x.length); seen.set(x, out); for (let i = 0; i < x.length; i++) out[i] = c(x[i]); return out; }
    if (x instanceof Map) { out = new Map(); seen.set(x, out); x.forEach(function (v, k) { out.set(c(k), c(v)); }); return out; }
    if (x instanceof Set) { out = new Set(); seen.set(x, out); x.forEach(function (v) { out.add(c(v)); }); return out; }
    if (x instanceof Date) { out = new Date(x.getTime()); seen.set(x, out); return out; }
    out = Object.getPrototypeOf(x) === null ? Object.create(null) : {}; seen.set(x, out);
    const ks = Object.keys(x); for (let i = 0; i < ks.length; i++) out[ks[i]] = c(x[ks[i]]);
    return out;
  };
  return c(s);
}
/* @fold @fact — the facts an aggregate's fold reads: its own declaration, else its own aggregate's */
function acceptsOf(inc, agg) { return typeof inc.accepts === 'function' ? inc.accepts : function (e) { return !!e && e.aggregate === agg; }; }
/* @fold — the full fold through the contract: the accepted facts in the fold's order, init, every step, view (an aggregate's fold() returns this) */
function foldVia(inc, events, agg) {
  const acc = acceptsOf(inc, agg), list = (events || []).filter(function (e) { return acc(e); });
  const sorted = inc.order === 'arrival' ? list : list.slice().sort(hlc.compareEvents);
  const s = inc.init();
  for (let i = 0; i < sorted.length; i++) inc.step(s, sorted[i]);
  return inc.view(s);
}
/* @fold — the first place in a sorted list where a fact sorting after e sits (binary search on hlc.compareEvents) */
function placeOf(list, e) {
  let lo = 0, hi = list.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (hlc.compareEvents(list[mid], e) <= 0) lo = mid + 1; else hi = mid; }
  return lo;
}
/* @fold @fact — one aggregate's fold kept up to date: feed(facts) takes new facts in any order, view() answers what fold() would
   over every fact fed so far. o: {every, keep (checkpoint spacing and how many are kept), lazy (true: never copy on the tap
   path — maintain() makes the checkpoints when the screen is idle; a late fact with none left rebuilds from the start, which
   is what every fact cost before)} */
function makeInc(inc, agg, o) {
  o = o || {};
  const every = Math.max(1, o.every || CHECKPOINT_EVERY), keep = Math.max(1, o.keep || KEEP), lazy = !!o.lazy, acc = acceptsOf(inc, agg), byHlc = inc.order !== 'arrival';
  let facts = [], state = inc.init(), cps = [], memo = null, lastCp = 0;
  const seen = new Set();
  const stats = { steps: 0, appended: 0, replays: 0, rebuilds: 0, checkpoints: 0 };
  /* @fold — a copy of the live state as the newest checkpoint (the oldest beyond `keep` let go) */
  function snap(n) { cps.push({ n: n, s: cloneState(state) }); lastCp = n; stats.checkpoints++; while (cps.length > keep) cps.shift(); }
  /* @fold — after stepping to `count` of `finalLen`: a checkpoint only when one is due AND this same feed would not push it out
     again (loading five years copies the last `keep`, never the 98 before them); never on a lazy tablet's tap path */
  function maybeSnap(count, finalLen) {
    if (lazy || count - lastCp < every) return;
    if (finalLen - count >= every * keep) return;
    snap(count);
  }
  /* @fold — one fact stepped onto the end */
  function append(e, finalLen) { facts.push(e); inc.step(state, e); stats.steps++; stats.appended++; maybeSnap(facts.length, finalLen); }
  /* @fold — the state rebuilt for facts[from..]: the newest checkpoint at or before `from` is TAKEN as the live state (no copy on
     this path; its place is filled later), else the state starts again from nothing */
  function replayFrom(from) {
    let ci = -1; for (let i = cps.length - 1; i >= 0; i--) if (cps[i].n <= from) { ci = i; break; }
    let start = 0;
    if (ci >= 0) { const c = cps[ci]; state = c.s; start = c.n; cps = cps.slice(0, ci); stats.replays++; }
    else { state = inc.init(); cps = []; stats.rebuilds++; }
    lastCp = cps.length ? cps[cps.length - 1].n : 0;
    const finalLen = facts.length;
    for (let i = start; i < finalLen; i++) { inc.step(state, facts[i]); stats.steps++; maybeSnap(i + 1, finalLen); }
  }
  /* @fold @fact — new facts in: those this fold reads, once each by id; one step each when they come after everything held, else put in place and replayed */
  function feed(list) {
    const mine = [];
    for (let i = 0; i < (list || []).length; i++) { const e = list[i]; if (acc(e) && !seen.has(e.id)) { seen.add(e.id); mine.push(e); } }
    if (!mine.length) return 0;
    memo = null;
    const finalLen = facts.length + mine.length;
    if (!byHlc) { mine.forEach(function (e) { append(e, finalLen); }); return mine.length; }
    mine.sort(hlc.compareEvents);
    const last = facts[facts.length - 1];
    if (!last || hlc.compareEvents(last, mine[0]) <= 0) { mine.forEach(function (e) { append(e, finalLen); }); return mine.length; }
    const from = placeOf(facts, mine[0]), tail = facts.slice(from), merged = [];
    let a = 0, b = 0;
    while (a < tail.length || b < mine.length) { if (b >= mine.length || (a < tail.length && hlc.compareEvents(tail[a], mine[b]) <= 0)) merged.push(tail[a++]); else merged.push(mine[b++]); }
    facts = facts.slice(0, from).concat(merged);
    replayFrom(from);
    return mine.length;
  }
  /* @fold — the idle moment's work (the tablet calls it when the screen is quiet): a checkpoint of the live state when none is
     kept, or when `every` facts have passed since the newest. Returns whether it copied. */
  function maintain() { if (!facts.length || (cps.length && facts.length - lastCp < every)) return false; snap(facts.length); return true; }
  /* @fold — what fold() would answer over every fact fed so far; worked out once per change */
  function view() { if (!memo) memo = { v: inc.view(state) }; return memo.v; }
  /* @fold — start again with nothing held (the log it followed was replaced) */
  function reset() { facts = []; state = inc.init(); cps = []; memo = null; lastCp = 0; seen.clear(); }
  /* @fold — how many checkpoints are held right now (10/18, tools/tablet-mem.js: what a follower's memory is, counted — never more than `keep`) */
  function held() { return cps.length; }
  return { feed: feed, view: view, reset: reset, maintain: maintain, held: held, size: function () { return facts.length; }, stats: stats };
}
/* @fold @fact — a log followed one fact at a time: each call feeds only what the log gained since the last (a replaced log starts
   over). log: {size(), since(n)} (core/log.js) or anything with all(); returns the fold's answer now. The function carries
   maintain() (the idle moment's checkpoint), held() (the checkpoints it holds now) and stats. */
function follower(inc, agg, o) {
  const m = makeInc(inc, agg, o); let followed = null, n = 0;
  const f = function (log) {
    if (log !== followed) { m.reset(); followed = log; n = 0; }
    const size = log ? (typeof log.size === 'function' ? log.size() : log.all().length) : 0;
    if (size < n) { m.reset(); n = 0; }
    if (size > n) { m.feed(typeof log.since === 'function' ? log.since(n) : log.all().slice(n)); n = size; }
    return m.view();
  };
  f.maintain = m.maintain; f.stats = m.stats; f.held = m.held;
  return f;
}

module.exports = { foldVia: foldVia, makeInc: makeInc, follower: follower, placeOf: placeOf, cloneState: cloneState, CHECKPOINT_EVERY: CHECKPOINT_EVERY, KEEP: KEEP };

});
__def("core/log.js", {"./event":"core/event.js","./hlc":"core/hlc.js"}, function (module, exports, require) {
'use strict';
/* ============================================================================
 * LOG — a station's append-only record. "ALWAYS FORWARD."
 * @fact @storage @sync — a station's append-only record of facts: nothing edited or removed, a refused write waits in order, a torn row quarantined
 * ----------------------------------------------------------------------------
 * Nothing here is ever edited or removed. Two persistence shapes behind one API:
 *   snapshot  persist.load() / persist.save(events)  — the whole array (small stations, tests)
 *   journal   persist.load() / persist.append(row)   — one line per fact ({ev}), one per echo ({ack}),
 *             one per re-offer ({unack}), one per adoption ({adopt}); a 20k-event station never rewrites
 * A refused write is never thrown at the operator: the log is DIRTY, the row waits in a pending queue in
 * order, and the next successful write or flush() drains it — never re-appending the log.
 *
 * Every row is verified at load (shape + hash + signature); a torn or unknown row is quarantined and
 * counted, an unreadable store is reported as UNREADABLE (the station halts). Marks are applied in journal
 * order so the LAST word wins.
 *
 * A journal also carries CURSOR MARKS ({mark: {cursor, epoch}}, 2026-09-23 — step 2 of the wire): where this station
 * had read the hub up to, written AFTER the facts that pull brought in. Journal writes go strictly in order, so a
 * mark on disk means every fact before it is on disk too; a log restored from an older backup brings back its own,
 * older mark. A reboot therefore resumes from the mark instead of re-reading the whole hub, and can never skip a fact.
 * The snapshot shape keeps no mark (a small store simply re-reads).
 *
 * Two kinds of metadata ride beside the witness marks, unhashed, never the fact:
 *   adopted   this copy took the fact back from the hub (a write it never saw land): its texts are listed for an
 *             operator and never fired blind; the mark survives a reboot
 *   everPos   the position a fact once held before it was re-offered — round 5: "ever witnessed" survives
 *             a re-offer, so an operator's seed never re-texts what went out
 * ========================================================================== */
const ev = require('./event');
const hlc = require('./hlc');

/* @fact @storage — one station's log over its storage (whole-array snapshot or line-per-row journal): every row verified at load, nothing ever edited, a failed write left dirty and retried in order */
function makeLog(persist) {
  const journal = !!(persist && typeof persist.append === 'function');
  let events = [];
  let quarantined = 0;
  const byId = new Map();
  const pending = [];                                            // journal rows not yet on disk, in order
  let sortedCache = null;                                        // extended on append in order, dropped when a fact sorts earlier (keepSorted)
  let mineCache = null;                                          /* one station's own facts in its clock's order, kept as facts arrive */
  const api = { persistError: null, dirty: false, quarantined: 0, journal: journal, writes: 0, unreadable: false };

  /* @fact — takes a fact in once by its id; a second copy of a held id is refused (false), never a duplicate */
  function adopt(e) { if (byId.has(e.id)) return false; events.push(e); byId.set(e.id, e); keepSorted(e); return true; }
  /* @fact @fold — a fact that sorts after everything already in order joins the kept orders at their end (the order a full sort
     gives: the sort is stable); one that sorts earlier — a peer's fact arriving late — means a fresh sort next time. A tablet no
     longer re-sorts all history after every fact (audit E15, batch `perf`). */
  function keepSorted(e) {
    if (sortedCache) { const last = sortedCache[sortedCache.length - 1]; if (!last || hlc.compareEvents(last, e) <= 0) sortedCache.push(e); else sortedCache = null; }
    if (mineCache && e.station === mineCache.id) { const l = mineCache.list, m = l[l.length - 1]; if (!m || hlc.compareEvents(m, e) <= 0) l.push(e); else mineCache = null; }
  }
  /* @fact — a stored fact is loaded only if well-formed and its hash still matches; anything else is quarantined */
  function goodEvent(e) { return !!e && typeof e === 'object' && ev.shapeError(e) === null && ev.verify(e); }
  /* @fact @sync — a hub echo row is believed only whole: an id, a hash, a positive whole position, an epoch string or none */
  function goodAck(a) { return !!a && typeof a === 'object' && typeof a.id === 'string' && typeof a.hash === 'string' && Number.isInteger(a.pos) && a.pos > 0 && (a.epoch == null || typeof a.epoch === 'string'); }
  /* @fact @sync — a re-offer row needs the fact's id and nothing more */
  function goodUnack(u) { return !!u && typeof u === 'object' && typeof u.id === 'string'; }
  /* @fact @sync — an adoption row (this copy took its own fact back from the hub) needs the fact's id */
  function goodAdopt(a) { return !!a && typeof a === 'object' && typeof a.id === 'string'; }
  /* @fact @sync — a cursor mark is trusted only whole (a cursor of 0 or more, an epoch string or none); a torn mark means re-reading the hub, never skipping a fact */
  function goodMark(m) { return !!m && typeof m === 'object' && Number.isInteger(m.cursor) && m.cursor >= 0 && (m.epoch == null || typeof m.epoch === 'string'); }
  let lastMark = null;                                           // the latest cursor mark, in journal order
  (function load() {
    let raw;
    try { raw = (persist && typeof persist.load === 'function') ? persist.load() : []; }
    catch (err) { quarantined = -1; api.quarantined = -1; api.unreadable = true; return; }
    if (raw == null) raw = [];
    if (!Array.isArray(raw)) { quarantined = -1; api.quarantined = -1; api.unreadable = true; return; }
    const marks = [];
    raw.forEach(function (row) {
      if (journal && row && typeof row === 'object') {
        const kinds = ['ev', 'ack', 'unack', 'adopt', 'mark'].filter(function (k) { return row[k] !== undefined; });
        if (kinds.length !== 1) { quarantined++; return; }                          // a row is one thing; {ev, ack} together is damage
        if (kinds[0] === 'mark') { if (goodMark(row.mark)) lastMark = { cursor: row.mark.cursor, epoch: row.mark.epoch == null ? null : row.mark.epoch }; else quarantined++; return; }   // a torn mark is never trusted
        if (kinds[0] === 'ack') { if (goodAck(row.ack)) marks.push(row); else quarantined++; return; }
        if (kinds[0] === 'unack') { if (goodUnack(row.unack)) marks.push(row); else quarantined++; return; }
        if (kinds[0] === 'adopt') { if (goodAdopt(row.adopt)) marks.push(row); else quarantined++; return; }
        if (goodEvent(row.ev)) { if (!adopt(row.ev)) quarantined++; } else quarantined++;
        return;
      }
      if (goodEvent(row)) { if (!adopt(row)) quarantined++; } else quarantined++;
    });
    marks.forEach(function (m) {                                  // in journal order, so the LAST word wins
      if (m.ack) { const e = byId.get(m.ack.id); if (e && m.ack.hash === e.hash) { e.pos = m.ack.pos; e.epoch = (m.ack.epoch == null ? null : m.ack.epoch); } else quarantined++; }
      else if (m.unack) { const e = byId.get(m.unack.id); if (e) { if (e.pos != null) e.everPos = e.pos; if (Number.isInteger(m.unack.everPos)) e.everPos = m.unack.everPos; e.pos = null; e.epoch = null; } else quarantined++; }
      else { const e = byId.get(m.adopt.id); if (e) e.adopted = true; else quarantined++; }
    });
    api.quarantined = quarantined;
  })();

  /* ---- writing ---- */
  /* @fact @storage — writes the pending journal rows in order and stops at the first failure: the log goes dirty, nothing is lost or written twice */
  function drain() {                                             // journal: everything pending, in order; stop at the first failure
    while (pending.length) {
      try { persist.append(pending[0]); pending.shift(); api.writes++; }
      catch (err) { api.persistError = String((err && err.message) || err); api.dirty = true; return false; }
    }
    api.persistError = null; api.dirty = false; return true;
  }
  /* @fact @storage — queues one journal row behind any still waiting, then drains, so rows reach the disk strictly in order */
  function journalRow(row) { pending.push(row); return drain(); }
  /* @fact @storage — rewrites the whole snapshot; a failure marks the log dirty instead of being thrown at the operator */
  function snapshotSave() {
    if (!(persist && typeof persist.save === 'function')) return true;
    try { persist.save(events); api.writes++; api.persistError = null; api.dirty = false; return true; }
    catch (err) { api.persistError = String((err && err.message) || err); api.dirty = true; return false; }
  }
  /* @fact @sync — the journal row that records where the hub filed a fact (id, hash, position, epoch) */
  function ackRow(e) { return { ack: { id: e.id, hash: e.hash, pos: e.pos, epoch: e.epoch } }; }

  /* @fact @station — one station's own facts in its clock's order: kept as they arrive (keepSorted), sorted afresh only after one
     arrived out of order; each caller gets its own list (audit E15, batch `perf`: a sort of all history on every commit) */
  function mine(stationId) {
    if (mineCache && mineCache.id === stationId) return mineCache.list.slice();
    const list = events.filter(function (e) { return e.station === stationId; }).sort(hlc.compareEvents);   // one station's own clock orders its own facts
    mineCache = { id: stationId, list: list }; return list.slice();
  }
  /* @fact @station — one station's latest fact in its own clock's order, or null */
  function lastOf(stationId) { const m = mine(stationId); return m.length ? m[m.length - 1] : null; }

  api.append = function (e) {
    if (byId.has(e.id)) return byId.get(e.id);
    adopt(e);
    if (!persist) return e;
    if (journal) journalRow({ ev: e }); else snapshotSave();
    return e;
  };
  /* this copy took a fact of its own back from the hub: durable metadata, so a reboot still knows */
  api.markAdopted = function (id) {
    const e = byId.get(id); if (!e || e.adopted) return false;
    e.adopted = true;
    if (persist) { if (journal) journalRow({ adopt: { id: e.id } }); else snapshotSave(); }
    return true;
  };
  api.has = function (id) { return byId.has(id); };
  api.get = function (id) { return byId.get(id) || null; };
  api.all = function () { return events.slice(); };
  api.from = function (i) { return events.slice(i); };   /* the facts taken in since the log held i of them, in the order they came (batch perf) */
  api.sorted =function () { if (!sortedCache) sortedCache = events.slice().sort(hlc.compareEvents); return sortedCache.slice(); };
  api.mine = mine;
  api.lastOf = lastOf;
  /* Everything the current witness has not echoed — own facts unwitnessed, and anything (own or carried)
     witnessed only by an older hub. */
  api.outbox = function (epoch) {
    return events.filter(function (e) { return e.pos == null || (epoch != null && e.epoch !== epoch); });
  };
  api.ack = function (id, hash, pos, epoch) {
    const e = byId.get(id);
    if (!e) return { ok: false, reason: 'unknown event' };
    if (hash !== e.hash) return { ok: false, reason: 'hash mismatch: the hub does not hold what I wrote' };
    if (!(Number.isInteger(pos) && pos > 0)) return { ok: false, reason: 'malformed position' };
    const was = (e.pos == null || (epoch != null && e.epoch !== epoch));
    if (was) { e.pos = pos; e.epoch = (epoch == null ? null : epoch); if (persist) { if (journal) journalRow(ackRow(e)); else snapshotSave(); } }
    return { ok: true, newlyWitnessed: was };
  };
  /* The witness turned out not to hold it (or a new witness took over): owed again, and the journal says so — but
     "it was witnessed once" is kept (everPos), so an effect that already fired is never re-fired by a seed. */
  api.reoffer = function (id) {
    const e = byId.get(id);
    if (!e || e.pos == null) return false;
    e.everPos = e.pos; e.pos = null; e.epoch = null;
    if (persist) { if (journal) journalRow({ unack: { id: e.id, everPos: e.everPos } }); else snapshotSave(); }
    return true;
  };
  api.everWitnessed = function (e) { return !!e && (e.pos != null || Number.isInteger(e.everPos)); };
  /* where this station has read the hub up to — journal only, queued BEHIND the facts that pull brought in */
  api.markCursor = function (cursor, epoch) {
    if (!(persist && journal) || !Number.isInteger(cursor) || cursor < 0) return false;
    const m = { cursor: cursor, epoch: (epoch == null ? null : String(epoch)) };
    if (lastMark && lastMark.cursor === m.cursor && lastMark.epoch === m.epoch) return true;   // nothing moved: no row
    lastMark = m; journalRow({ mark: m }); return true;
  };
  api.lastMark = function () { return lastMark ? { cursor: lastMark.cursor, epoch: lastMark.epoch } : null; };
  api.flush = function () { if (!persist) return true; return journal ? drain() : snapshotSave(); };
  api.pending = function () { return pending.length; };
  api.size = function () { return events.length; };
  /* @fact @fold — the facts taken in after the first n, in the order they came (core/incfold.js follows the log with this: a new fact costs its own step, never a copy of all history) */
  api.since = function (n) { return events.slice(Math.max(0, n | 0)); };
  return api;
}

module.exports = { makeLog: makeLog };

});
__def("core/station.js", {"./hlc":"core/hlc.js","./event":"core/event.js","./registry":"core/registry.js","./log":"core/log.js"}, function (module, exports, require) {
'use strict';
/* ============================================================================
 * STATION — records offline, proposes to the hub. "Every station watching itself."
 * @station @fact @sync @storage — a tablet's own recording engine: facts saved offline, sent to the hub on tile finished, texts owed by the log, one window per station
 * ----------------------------------------------------------------------------
 * A station has an id, its own clock, its own append-only log, and it RECORDS
 * OFFLINE: no network between a tap and a saved fact. The HUB IS THE AUTHORITY
 * (2026-09-22): it admits a fact only from a device enrolled as that station
 * (the device's access token), orders it, and refuses a second fact under a
 * held id. The station never judges forks or keys any more — the id of every
 * fact is its idempotency key, and the hub's answer is final.
 *
 * THE COMMIT POINT IS "TILE FINISHED": commit() sends what the hub has not
 * echoed — this station's own facts, oldest first, in chunks a wire can carry.
 * A failed commit is logged and still owed. The transport may be synchronous
 * (tests) or return a Promise (HTTPS); overlapping commits are serialized — one
 * in flight, one queued — and an answer that never comes is given up on.
 *
 * A NEW HUB IS A NEW WITNESS: when the epoch changes, everything of mine is owed
 * again. A fact of mine the hub had witnessed and then LOST (a restored backup
 * under the same identity) is re-offered and the hub is told.
 *
 * A FACT OF MINE THAT COMES BACK FROM THE HUB and is not in my log (a disk that
 * lost a write, a restored backup, a clone of this tablet) is TAKEN BACK — never
 * a halt. Its texts never fire blind: they are marked done AND listed for an
 * operator, durably, BEFORE the fact lands.
 *
 * EFFECTS ARE OWED BY THE LOG, AND MADE DURABLE BEFORE THEY FIRE: the attempt is
 * written first; a hook that throws — or returns a Promise that rejects — is
 * remembered on disk and listed after a reboot; an operator's retryEffects()
 * writes "retrying" before it fires each once more. Any text a DEPLOY added to
 * facts already witnessed is held for the operator, never fired at the whole
 * history. An unreadable effects store is HELD and never overwritten until an
 * operator resolves it. The hook is handed a copy, never the log's row.
 *
 * ONE WINDOW PER STATION: a lease, renewed on the MONOTONIC clock while the
 * window works, honouring the TTL the service granted. close() flushes, then
 * releases and is a writer no more. A lapsed lease is never silently re-taken:
 * the window re-reads the store (reclaim) before it writes again; a crashed
 * window's reload reclaims by itself one full TTL after it was last refused.
 * A halted, closed or read-only window is INERT.
 * ========================================================================== */
const hlc = require('./hlc');
const ev = require('./event');
const registry = require('./registry');
const makeLog = require('./log').makeLog;

const DEFAULT_TILE_TIMEOUTS = { rack: 15 * 60 * 1000, assembly: 15 * 60 * 1000 };   // owner: 15 minutes, only if inactive; Detail/Quick/Pickup never kick
const FAILURE_CAP = 500;
const LEASE_MS = 30000;
const COMMIT_TIMEOUT_MS = 30000;
const REFUSED_STREAK = 3;                                        // the same fact refused this many commits in a row is a problem selfCheck names
const MAX_BUNDLE = 200;                                          // facts per push: a weekend's backlog goes out in chunks any wire can carry
const CLOCK_GUARD_MS = 5 * 60 * 1000;                            /* E35: v1's CLOCK_SKEW_MS — a tablet more than 5 minutes off the hub's clock records nothing */
const REGISTRY_ROW = '__effects_registry__';

/* the host's monotonic clock, BOUND (performance.now unbound throws "Illegal invocation" in browsers and Node alike) */
/* @clock @station — the device's monotonic clock (never set back by hand), bound so it can be called; none when the host has none */
function hostMono() {
  try { if (typeof performance !== 'undefined' && performance && typeof performance.now === 'function') { const p = performance; const v = p.now(); if (Number.isFinite(v)) return function () { return p.now(); }; } } catch (e) {}
  return null;
}
/* @fact @sync — a fact without this copy's private marks (adopted, everPos), as it goes on the wire */
function strip(e) { if (!e || (e.adopted === undefined && e.everPos === undefined)) return e; const c = Object.assign({}, e); delete c.adopted; delete c.everPos; return c; }

/* @station @fact @sync — builds a station: its id, clock and append-only log, recording offline and proposing to the hub, which is the authority; refuses an id with a slash */
function makeStation(opts) {
  if (opts.id == null || String(opts.id) === '') throw new Error('a station must know itself: id is required');
  const id = String(opts.id);
  if (id.indexOf('/') >= 0) throw new Error('a station id may not contain "/" — it is the event-id namespace separator');
  const name = opts.name || id;
  const persist = opts.persist || null;
  const nowMs = opts.now || Date.now;
  /* @station @invariant — a timing option in milliseconds, the default when unset; refuses anything that is not a positive number */
  function validMs(v, dflt, what) { if (v == null) return dflt; if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) throw new Error('station ' + id + ': ' + what + ' must be a positive number of milliseconds'); return v; }
  const leaseMs = validMs(opts.leaseMs, LEASE_MS, 'leaseMs');
  const commitTimeoutMs = validMs(opts.commitTimeoutMs, COMMIT_TIMEOUT_MS, 'commitTimeoutMs');
  const failures = [];
  /* @station @error — remembers a failure with its time for the health line, keeping the newest 500 */
  function noteFailure(f) { failures.push(Object.assign({ ts: nowMs() }, f)); if (failures.length > FAILURE_CAP) failures.splice(0, failures.length - FAILURE_CAP); }
  /* @error — an error's message as words, never empty */
  function failMsg(err) { return String((err && err.message) || err) || '(no message)'; }

  /* ---- the monotonic clock: probed once; a reading that throws or is not a number counts as "no time passed" ---- */
  let monoSrc = null, monoLast = 0, monoNoted = false;
  (function pickMono() {
    /* a caller that injects a wall clock without a monotonic one wants its timers on THAT clock (tests, simulations);
       a caller that injects neither gets the host's monotonic clock — never the wall */
    const candidates = opts.mono ? [opts.mono, hostMono(), nowMs] : (opts.now ? [nowMs] : [hostMono(), nowMs]);
    for (let i = 0; i < candidates.length; i++) {
      const fn = candidates[i]; if (typeof fn !== 'function') continue;
      try { const v = fn(); if (Number.isFinite(v)) { monoSrc = fn; monoLast = v; if (i > 0 && opts.mono) noteFailure({ kind: 'clock', error: 'the monotonic clock given at construction throws or returns a non-number — replaced by ' + (i === 1 ? 'the host clock' : 'the wall clock') }); return; } } catch (e) {}
    }
    monoSrc = nowMs;
  })();
  /* @clock @station — the monotonic clock's time, never going backwards; a reading that fails counts as no time passed (and is noted once) */
  function mono() {
    let v; try { v = monoSrc(); } catch (e) { v = NaN; }
    if (!Number.isFinite(v)) { if (!monoNoted) { monoNoted = true; noteFailure({ kind: 'clock', error: 'the monotonic clock returned a non-number — treated as no time passed' }); } return monoLast; }
    if (v > monoLast) monoLast = v;                                // never backwards
    return monoLast;
  }

  let readOnly = false, halted = null, haltKind = null;          // halted = the reason this window is not a writer
  /* @station @error — makes this window read-only for good, keeping the first reason it stopped writing */
  function halt(kind, why) { readOnly = true; if (!halted) { halted = why; haltKind = kind; } noteFailure({ kind: 'halted', what: kind, error: why }); }
  /* @station @error — makes this window read-only with a new reason, replacing the old one */
  function rehalt(kind, why) { readOnly = true; halted = why; haltKind = kind; noteFailure({ kind: 'halted', what: kind, error: why }); }

  /* ---- access: the token the hub issued this device. Losing it never stops recording — only sending, until an operator
          enrolls the device again. A store whose access names another station is not this station's store. ---- */
  const hasAccessStore = !!(persist && typeof persist.loadAccess === 'function' && typeof persist.saveAccess === 'function');
  let access = null, accessDirty = false, accessRefused = null;
  /* @station @identity @storage — reads this device's access token from its store; a store that fails to read still records, it just cannot send */
  function loadAccessNow() {
    if (!hasAccessStore) return { ok: true, value: access };
    try { const a = persist.loadAccess(); return { ok: true, value: (a && typeof a === 'object' && typeof a.token === 'string') ? { station: (a.station == null ? id : String(a.station)), token: a.token } : null }; }
    catch (e) { noteFailure({ kind: 'persist', what: 'access-load', error: failMsg(e) + ' — this station records normally and cannot send until the access store reads or an operator enrolls it again' }); return { ok: false }; }
  }
  (function () { const r = loadAccessNow(); if (r.ok) access = r.value; })();
  if (access && access.station !== id) halt('store', 'this store belongs to station "' + access.station + '", not "' + id + '" — a store is owned by one station; open it as that station, or give this one a fresh store');
  /* @station @identity @storage — saves this device's access token; a failed save is noted and retried */
  function saveAccessNow() { if (!hasAccessStore || readOnly) return true; try { persist.saveAccess(access); accessDirty = false; return true; } catch (e) { accessDirty = true; noteFailure({ kind: 'persist', what: 'access-save', error: failMsg(e) + ' — will retry' }); return false; } }

  /* ---- one window per station: take the lease, renew it on the monotonic clock, honour the TTL the service GRANTED ---- */
  const nonce = id + '-' + Math.random().toString(36).slice(2, 10);
  let leaseAt = -Infinity, leaseRefusedAt = null, leaseGrant = leaseMs;
  const hasLease = !!(persist && typeof persist.lease === 'function');
  /* @station @storage — by my own clock, do I still hold this station's one-window lease */
  function leaseFresh() { return !hasLease || mono() - leaseAt < leaseGrant; }   // by my own record, do I still hold it?
  /* @station @storage — asks for this station's one-window lease; too short a grant counts as refused, and a service failing at boot fails closed */
  function takeLease() {
    if (!hasLease) return true;
    try {
      const l = persist.lease(nonce, leaseMs);
      if (l && l.ok) {
        const granted = (l.ttlMs != null) ? Number(l.ttlMs) : leaseMs;   // a service may grant LESS than asked: renew against what it granted
        if (!(Number.isFinite(granted) && granted > 0) || granted < leaseMs / 3) { leaseRefusedAt = mono(); noteFailure({ kind: 'lease', error: 'the lease service granted ' + granted + ' ms of the ' + leaseMs + ' asked — too little to work under; treated as refused' }); return false; }
        leaseGrant = Math.min(leaseMs, granted); leaseAt = mono(); leaseRefusedAt = null; return true;
      }
      leaseRefusedAt = mono(); noteFailure({ kind: 'lease', error: 'another window holds this station', holder: l && l.holder }); return false;
    } catch (e) {
      const still = leaseFresh() && leaseAt !== -Infinity;         // a service that throws once mid-day: I still hold it by my own record → retry next time; at boot: fail CLOSED
      noteFailure({ kind: 'lease', error: 'lease service failed (' + failMsg(e) + ')' + (still ? ' — still within my lease by my own clock; will retry' : ' — failing CLOSED') });
      return still;
    }
  }
  /* @station @storage — keeps the lease on every write; a lapsed one re-reads the store first, and a lease another window took makes this one read-only */
  function renewLease() {                                       // called on EVERY write path; cheap when recent
    if (readOnly || !hasLease) return !readOnly;
    const age = mono() - leaseAt;
    if (age < leaseGrant / 3) return true;
    if (age >= leaseGrant) {                                     // provably lapsed (the tab slept): another window may have written — re-read before writing
      if (sameLease()) return true;
      readOnly = true; haltKind = 'lease'; halted = 'my lease lapsed (' + Math.round(age) + ' ms without renewal) — re-reading the store before writing again';
      if (station.reclaim()) { noteFailure({ kind: 'lease', note: 'my lease had lapsed; the store was re-read and the lease re-taken; continuing' }); return true; }
      rehalt('lease', 'lease lost — another window took this station while mine had lapsed; this one is now read-only'); return false;
    }
    if (takeLease()) return true;
    rehalt('lease', 'lease lost — another window took this station; this one is now read-only'); return false;
  }
  if (!halted && !takeLease()) halt('lease', 'another window holds ' + id + ' — opened read-only');
  /* @station @storage — a lapsed lease THIS window takes back when the store says nobody else held it meanwhile (the same
     generation): the log in memory is what is on disk, so it goes on without re-reading and re-hashing every fact — the route
     phone back from Maps, a counter PC woken from sleep (audit E71, batch `perf`). Anything else re-reads, as before. */
  function sameLease() {
    if (!hasLease) return false;
    try {
      const l = persist.lease(nonce, leaseMs); if (!(l && l.ok && l.same === true)) return false;
      const granted = (l.ttlMs != null) ? Number(l.ttlMs) : leaseMs; if (!(Number.isFinite(granted) && granted > 0) || granted < leaseMs / 3) return false;
      leaseGrant = Math.min(leaseMs, granted); leaseAt = mono(); leaseRefusedAt = null;
      noteFailure({ kind: 'lease', note: 'my lease had lapsed and nobody else held it — taken back without re-reading the store' }); return true;
    } catch (e) { return false; }
  }

  const clock = hlc.makeClock(id, { now: opts.now, maxDriftMs: opts.clockGuardMs > 0 ? opts.clockGuardMs : undefined });   /* E35 skeptic: with the clock guard on, a peer's stamp more than 5 minutes past my wall is ordered, never obeyed — a fact the hub took before the rule cannot drag this tablet's stamps where the hub refuses them */
  let log = makeLog(persist);
  if (log.unreadable) halt('log', 'my log could not be read — boot read-only rather than start over');
  /* @fact @station — this station's own facts in the log */
  function mine() { return log.mine(id); }
  let cursor = 0, hubEpoch = null, lastCommit = null;
  /* ⚠️ A FACT THIS COPY CANNOT APPLY YET IS NEVER STEPPED PAST (2026-09-23). Found with the live shadow feed: a page bundled
     before customer.created learned its `src` note refused thousands of customers, read on past them, and said "All good" — they
     were gone from that tablet for good. Now each such fact (an unknown type, or a payload this copy's validator refuses:
     the hub has code this copy lacks) is remembered by position; the pull still reads on so everything else stays current,
     but the SAVED cursor mark stays before the first one, so the next boot — the reload that brings the update — reads
     them again. The health line names them until then. */
  const unapplied = new Map();                                         // hub position → { id, type }
  /* @sync @fact — the cursor mark to save: never past a fact from the hub this copy could not apply yet, so the next boot reads it again */
  function markAt(c) { let lo = c; unapplied.forEach(function (_, pos) { if (pos - 1 < lo) lo = pos - 1; }); return Math.max(0, lo); }
  /* where I had read the hub up to comes back WITH my log (its cursor mark, written behind the facts it covers): a reboot
     resumes there instead of re-reading the whole hub, and a log restored from an older backup brings its own older mark */
  /* @sync @storage — where I had read the hub up to, restored from the mark saved with my log */
  function restoreMark(orZero) { const m = log.lastMark ? log.lastMark() : null; if (m && typeof m.epoch === 'string') { hubEpoch = m.epoch; cursor = m.cursor; } else if (orZero) cursor = 0; }
  restoreMark(false);
  const refusedStreak = new Map();                                // id -> consecutive commits the hub refused it
  const attempted = new Set();                                    // ids sent at least once and not yet echoed (the backlog)
  let transportStreak = 0;                                        // consecutive commits that never reached the hub while facts were owed

  /* ---- effects: the done-set, the attempts in flight, the attempts that FAILED, the rows kept aside — all durable ----
     a row is a key string (done), { k, id, effect, ts, attempting? | retrying? | failed? } (attempted), or the registry row;
     anything else is junk: the store is HELD until an operator resolves it, and never overwritten until then */
  const hasEffectsStore = !!(persist && typeof persist.loadEffects === 'function' && typeof persist.saveEffects === 'function');
  let effectsDone = new Set(), effectsUnknown = false, effectsDirty = false, effectsFailed = [], storedDigest = null;
  const attempting = new Map();                                   // k -> row currently between the durable mark and the hook's return
  const orphanFailed = new Map();                                 // k -> a failed/attempting row whose fact I do not hold (yet): kept aside, re-listed when it arrives
  const regDigest = registry.effectsDigest();
  /* @storage — one row of the effects store as {k}: a bare key, or a row with a key; anything else is junk */
  function effectRow(k) { return (typeof k === 'string' && k) ? { k: k } : (k && typeof k === 'object' && typeof k.k === 'string' && k.k) ? k : null; }
  /* @invariant @sms — does a failed or in-flight text row name a fact of mine that really owes that text */
  function effectRowValid(r) {                                    // a failed/attempting row must name a fact of MINE with that effect
    const e = log.get(r.id); if (!e || e.station !== id) return false;
    const def = registry.typeDef(e.type); if (!def || def.effects.indexOf(r.effect) < 0) return false;
    return r.k === e.id + '|' + r.effect;
  }
  /* @sms @storage @error — reads which texts were done, in flight or failed from disk; an unreadable store holds EVERY text until an operator resolves it */
  function loadEffects() {
    effectsDone = new Set(); effectsFailed = []; effectsUnknown = false; attempting.clear(); orphanFailed.clear(); storedDigest = null;
    try {
      const raw = hasEffectsStore ? persist.loadEffects() : [];
      if (raw == null) return;
      if (!Array.isArray(raw)) { effectsUnknown = true; noteFailure({ kind: 'persist', what: 'effects-load', error: 'effects store unreadable — all effects HELD until resolved' }); return; }
      let junk = 0, dups = 0; const seen = new Set();
      raw.forEach(function (k) {
        const r = effectRow(k); if (!r) { junk++; return; }
        if (r.k === REGISTRY_ROW) { storedDigest = (typeof r.digest === 'string') ? r.digest : null; return; }
        if (seen.has(r.k)) { dups++; return; } seen.add(r.k); effectsDone.add(r.k);
        const failed = ('failed' in r) ? (String(r.failed) || '(no message)') : (r.attempting || r.retrying) ? 'attempted — outcome unknown (the window crashed or the disk refused after the attempt); an operator decides' : null;
        if (failed == null) return;
        const row = { k: r.k, id: r.id, effect: r.effect, error: failed, ts: Number(r.ts) || 0 };
        if (effectRowValid(row)) effectsFailed.push(row); else orphanFailed.set(r.k, row);   // kept aside: its done-mark stays (nothing fires blind), listed the moment its fact arrives
      });
      if (dups) noteFailure({ kind: 'persist', what: 'effects-load', error: dups + ' duplicate effect row(s) ignored' });
      if (orphanFailed.size) noteFailure({ kind: 'persist', what: 'effects-load', error: orphanFailed.size + ' failed-effect row(s) name facts I do not hold — kept aside, never fired, listed when the fact arrives' });
      if (junk) { effectsUnknown = true; noteFailure({ kind: 'persist', what: 'effects-load', error: junk + ' unreadable effect row(s) — all effects HELD until resolved; ' + effectsFailed.length + ' intact failed row(s) carried through' }); }
    } catch (e) { effectsUnknown = true; noteFailure({ kind: 'persist', what: 'effects-load', error: failMsg(e) + ' — all effects HELD until resolved' }); }
  }
  loadEffects();
  if (persist && !hasEffectsStore && opts.onEffect) noteFailure({ kind: 'persist', what: 'effects-store', error: 'this persist has no effects store: done-marks live in memory only — a reboot cannot know what was texted; give persist.loadEffects()/saveEffects()' });
  const versionByKey = Object.create(null);
  let transport = null, effectHook = opts.onEffect || null;
  const tileTimeouts = Object.assign({}, opts.tileTimeouts || {});
  let tile = null, inFlight = false, inFlightSince = 0, generation = 0, queued = false;

  /* @fact — the record a fact is about: its aggregate and key */
  function keyOf(e) { return e.aggregate + '|' + e.key; }
  let versionsOf = null, versionsN = -1, versionsExact = false;   /* the log and size versionByKey was last brought up to; exact = it is each key's newest fact in the log */
  /* @station @fold — each key's newest fact (what a record is basedOn), rebuilt only when the log holds something new: an idle
     sync tick rebuilt it over all history every 5 seconds (audit E15, batch `perf`). While the map is exact, the facts that
     arrived since are compared into it one by one (the newest in the one order wins, as a rebuild's last write does) —
     a pull no longer sorts all history; anything else (a boot, a reclaim, a record that is not its key's newest) rebuilds whole. */
  function rebuildVersions() {
    if (versionsOf === log && versionsN === log.size()) return;
    if (versionsOf === log && versionsExact && versionsN >= 0 && versionsN < log.size()) {
      log.from(versionsN).forEach(function (e) { const k = keyOf(e), h = versionByKey[k], he = h ? log.get(h) : null; if (!he || hlc.compareEvents(he, e) < 0) versionByKey[k] = e.id; });
      versionsN = log.size(); return;
    }
    Object.keys(versionByKey).forEach(function (k) { delete versionByKey[k]; }); log.sorted().forEach(function (e) { versionByKey[keyOf(e)] = e.id; }); versionsOf = log; versionsN = log.size(); versionsExact = true;
  }
  /* @station @fold — a record's own fact becomes its key's newest (what the next record there is basedOn, as before); if a fact
     already held sorts after it, the map is no longer the log's own newest and the next pull rebuilds it whole, as it always did */
  function noteVersion(e) { const k = keyOf(e), h = versionByKey[k], he = h ? log.get(h) : null; if (he && hlc.compareEvents(he, e) > 0) versionsExact = false; versionByKey[k] = e.id; }
  /* @sms @storage — the effects store's rows to write: done keys, failed and in-flight rows, and the registry's digest */
  function effectRows() {
    const by = Object.create(null);
    effectsFailed.forEach(function (f) { by[f.k] = { k: f.k, id: f.id, effect: f.effect, failed: f.error, ts: f.ts }; });
    orphanFailed.forEach(function (f, k) { if (!by[k]) by[k] = { k: f.k, id: f.id, effect: f.effect, failed: f.error, ts: f.ts }; });
    attempting.forEach(function (row, k) { if (!by[k]) by[k] = row; });
    const rows = Array.from(effectsDone).map(function (k) { return by[k] || k; });
    rows.push({ k: REGISTRY_ROW, digest: regDigest });
    return rows;
  }
  /* the effects store is written only by a live writer, and NEVER over a held (unreadable) store except by the operator's resolve */
  /* @sms @storage — writes the effects store; never from a read-only window, and never over an unreadable one except when an operator resolves it */
  function saveEffects(resolving) {
    if (readOnly) return false;
    if (effectsUnknown && !resolving) { effectsDirty = true; return false; }
    if (!hasEffectsStore) return true;
    try { persist.saveEffects(effectRows()); effectsDirty = false; return true; }
    catch (e) { effectsDirty = true; noteFailure({ kind: 'persist', what: 'effects', error: failMsg(e) }); return false; }
  }
  /* @storage @error — flushes the log and any effects or access store owed to disk, noting a save that failed */
  function checkPersist() {
    if (readOnly) return;
    if (log.dirty) log.flush();
    if (log.persistError) { noteFailure({ kind: 'persist', what: 'log', error: log.persistError }); log.persistError = null; }
    if (effectsDirty) saveEffects();
    if (accessDirty) saveAccessNow();
  }
  /* @sync @fact — has the hub I last read witnessed this fact (a position under its identity) */
  function witnessed(e) { return e.pos != null && hubEpoch != null && e.epoch === hubEpoch; }
  /* @sms @fact — the side-effects (texts) this fact's type owes */
  function effectsOf(e) { const def = registry.typeDef(e.type); return (def && def.effects) ? def.effects : []; }
  /* a text whose sending this copy cannot know about (an adopted fact; a text a deploy added to history): never blind —
     marked done AND listed, so an operator's retryEffects() is the only way it fires. Returns whether anything changed. */
  /* @sms @error — marks a fact's texts done AND lists them for an operator, so a text this copy cannot account for never fires blind */
  function holdEffectsOf(e, why) {
    let changed = false;
    effectsOf(e).forEach(function (fx) { const k = e.id + '|' + fx; if (effectsDone.has(k)) { const o = orphanFailed.get(k); if (o) { orphanFailed.delete(k); effectsFailed.push(o); changed = true; } return; } effectsDone.add(k); effectsFailed.push({ k: k, id: e.id, effect: fx, error: why, ts: nowMs() }); changed = true; });
    if (changed) effectsDirty = true;
    return changed;
  }
  /* @sms @storage — failed-text rows kept aside because their fact had not arrived: listed for the operator once it has */
  function relistOrphans() {
    let n = 0; orphanFailed.forEach(function (row, k) { if (effectRowValid(row)) { orphanFailed.delete(k); effectsFailed.push(row); n++; } });
    if (n) effectsDirty = true; return n;
  }
  /* a DEPLOY that added a side-effect to a type: the facts already witnessed did not owe that text when they were made — hold
     every such key for the operator instead of texting the whole history on the first routine pull */
  /* @sms @deploy — after an update added texts to a type, holds those texts on facts already witnessed for an operator, instead of texting all of history */
  function reconcileRegistry() {
    if (effectsUnknown) return;
    if (storedDigest === regDigest) return;
    if (storedDigest == null && !mine().some(function (e) { return log.everWitnessed(e); })) { storedDigest = regDigest; if (hasEffectsStore) effectsDirty = true; return; }
    let held = 0;
    mine().forEach(function (e) { if (!log.everWitnessed(e)) return; if (holdEffectsOf(e, 'the app was updated: this text did not exist when this fact was witnessed — an operator decides (retryEffects)')) held++; });
    storedDigest = regDigest; if (hasEffectsStore || held) effectsDirty = true;
    if (held) noteFailure({ kind: 'effects', note: 'the registry of side-effects changed (an update): ' + held + ' already-witnessed fact(s) have new texts — HELD and listed for an operator, never fired blind' });
  }
  reconcileRegistry();
  let lostOwed = 0;                                                // facts of mine re-offered because the hub lost them under the same identity
  /* @sync @fact — the id of the fact I hold at my cursor under the identity I last read (null when I hold none there): the hub
     compares it with its own, so a store that went back in time and then grew past my cursor again is caught (E6, skeptic 9/25) */
  let atMemo = null;
  /* @sync @fact — the id of my fact at the hub position my cursor is on, remembered, for the hub's check that its store did not go back in time */
  function atCursor() {
    if (!(cursor > 0) || hubEpoch == null) return null;
    if (atMemo && atMemo.c === cursor && atMemo.ep === hubEpoch) { const m = log.get(atMemo.id); if (m && m.pos === cursor && m.epoch === hubEpoch) return atMemo.id; }
    const all = log.all(); let found = null;
    for (let i = all.length - 1; i >= 0; i--) { if (all[i].pos === cursor && all[i].epoch === hubEpoch) { found = all[i].id; break; } }
    atMemo = found ? { c: cursor, ep: hubEpoch, id: found } : null; return found;
  }
  /* ---- THIS TABLET'S CLOCK AGAINST THE HUB'S (E35, batch `sync` 9/25). Opt-in (the station page turns it on): the hub's time rides
     on every answer; the station keeps it on its own MONOTONIC clock, so a wall clock set right by hand is judged right at once ---- */
  const clockGuardMs = (opts.clockGuardMs > 0) ? opts.clockGuardMs : null;
  let hubClock = null;                                             // { hub: the hub's ms, mono: my monotonic ms when it answered }
  /* @sync @clock — the hub's time from an answer (only with the guard on; anything that is not a time is ignored) */
  function noteHubClock(ms) { if (!clockGuardMs || typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) return; hubClock = { hub: ms, mono: mono() }; }
  /* @sync @clock — how far my wall clock is from the hub's now (+ fast, - slow), or null before the hub has answered */
  function clockSkew() { if (!hubClock) return null; return Math.round(nowMs() - (hubClock.hub + (mono() - hubClock.mono))); }
  /* @sync @clock @station — the words when my clock is more than the guard off (or my next stamp is: stampAheadWords), or null: nothing is recorded under a wrong clock */
  function clockWrongWords() { const s = clockSkew(); if (s == null) return null; if (Math.abs(s) <= clockGuardMs) return stampAheadWords(); const a = Math.abs(s);
    const far = a >= 86400000 ? (a / 86400000).toFixed(1) + ' days' : a >= 3600000 ? (a / 3600000).toFixed(1) + ' hours' : Math.round(a / 60000) + ' minutes';
    return 'this tablet\'s clock is ' + far + (s > 0 ? ' FAST' : ' SLOW') + ' against the hub — set its date and time (Settings → Date & time → automatic); nothing is recorded until it is right, so no money or hours land on the wrong day'; }
  /* @sync @clock @station — E35 skeptic (9/25): my wall clock is right, but my NEXT STAMP is not — this tablet recorded earlier under
     a clock that ran ahead (offline, before the hub answered), and its own history seeds its clock (hlc adopt), so everything it
     records now carries that future time and the hub takes none of it (5 minutes, hub.js aheadOf) until the hub's clock gets
     there. Say so and record nothing, rather than take cash no other tablet will see for hours; what it holds sends by itself. */
  function stampAheadWords() {
    const a = Math.round(clock.peek().t - (hubClock.hub + (mono() - hubClock.mono))); if (!(a > clockGuardMs)) return null;
    const far = a >= 86400000 ? (a / 86400000).toFixed(1) + ' days' : a >= 3600000 ? (a / 3600000).toFixed(1) + ' hours' : Math.round(a / 60000) + ' minutes';
    return 'this tablet recorded earlier under a clock ' + far + ' FAST, and anything it records now would be dated then too — the hub takes nothing dated ahead of it, so nothing is recorded here for about ' + far + ' (use another tablet; what this one holds is kept and sends by itself then)'; }
  /* @sync @station — THE REFUSED GO LAST (E67, batch `sync` 9/25): a fact the hub refused (a validator tightened ahead of this
     tablet's build, a clock that ran ahead) moves behind every fact it has not refused, oldest first within each — so 200 of them
     can never fill a bundle and hold back the cash recorded after. They are still offered, every time, never dropped. */
  function refusedLast(own) { if (!refusedStreak.size) return own; return own.filter(function (e) { return !refusedStreak.has(e.id); }).concat(own.filter(function (e) { return refusedStreak.has(e.id); })); }
  /* @sync @fact — what I owe the hub, oldest first; the bundle also says which identity I last read and how far, so a hub whose
     store went back in time learns it before it hands out a position a second time (E6) */
  function outbox(limit) {
    const own = refusedLast(log.outbox(hubEpoch).filter(function (e) { return e.station === id; }));   // E67: what the hub keeps refusing goes to the back
    const events = own.slice(0, limit || Infinity).map(strip);
    const bundle = { station: id, token: access ? access.token : null, events: events, more: own.length > events.length };
    if (hubEpoch != null) bundle.known = { epoch: hubEpoch, cursor: cursor, at: atCursor() };
    if (clockGuardMs) bundle.sentAt = nowMs();                                     // E35: my clock, for the hub to judge
    if (lostOwed) bundle.lost = lostOwed;
    return bundle;
  }

  /* EFFECTS — durable intent first, then the side-effect. At most once. Never from a read-only window. */
  /* @sms @error — records how a text attempt ended: failed (listed for the operator) or done, then saves the effects store if still the writer */
  function settleEffect(k, e, fx, msg, retry) {
    attempting.delete(k);
    if (msg != null) { const f = retry ? effectsFailed.find(function (x) { return x.k === k; }) : null; if (f) { f.error = msg; f.ts = nowMs(); } else effectsFailed.push({ k: k, id: e.id, effect: fx, error: msg, ts: nowMs() }); noteFailure({ kind: 'effect', id: e.id, effect: fx, error: msg }); }
    else if (retry) effectsFailed = effectsFailed.filter(function (x) { return x.k !== k; });
    if (readOnly || !leaseFresh()) { noteFailure({ kind: 'lease', error: 'the lease lapsed while a text was in flight — its outcome is left on disk as unknown for the next writer to list' }); return; }
    saveEffects();                                                                 // best effort: a row that survives is listed at the next boot as outcome unknown
  }
  /* @sms — sends one text through the hook, the done-mark already on disk; a throw or rejection is recorded as failed */
  function fire(k, e, fx, retry) {                                 // the hook may be synchronous or return a Promise; either way the mark came first
    let out;
    try { out = effectHook(fx, ev.wire(strip(e))); } catch (err) { settleEffect(k, e, fx, failMsg(err), retry); return false; }
    if (out && typeof out.then === 'function') { Promise.resolve(out).then(function () { settleEffect(k, e, fx, null, retry); }, function (err) { settleEffect(k, e, fx, failMsg(err), retry); }); return true; }
    settleEffect(k, e, fx, null, retry); return true;
  }
  /* @sms @fact — fires each text owed by my witnessed facts at most once, the mark written to disk first; nothing from a read-only window or a held store */
  function runEffects() {
    if (readOnly || !effectHook || effectsUnknown) return 0;
    if (effectsDirty && !saveEffects()) return 0;                                  // the disk still refuses: hold everything
    let n = 0;
    mine().forEach(function (e) {
      if (!witnessed(e)) return;
      effectsOf(e).forEach(function (fx) {
        const k = e.id + '|' + fx;
        if (effectsDone.has(k)) return;
        effectsDone.add(k); attempting.set(k, { k: k, id: e.id, effect: fx, ts: nowMs(), attempting: true });
        if (!saveEffects()) { effectsDone.delete(k); attempting.delete(k); return; }   // not durable → held, not fired
        if (fire(k, e, fx, false)) n++;
      });
    });
    return n;
  }
  /* @sync @hub — takes a new hub identity: the cursor starts over, and on a change everything of mine is owed to the new witness */
  function setEpoch(ep) {
    if (ep == null || typeof ep !== 'string' || ep === hubEpoch) return false;
    const changed = hubEpoch != null; hubEpoch = ep; cursor = 0; unapplied.clear();   // no mark here: an older identity's mark is harmless (the hub answers a foreign epoch from zero), and the next pull writes the new one
    if (changed) noteFailure({ kind: 'epoch', note: 'the hub changed identity — everything of mine is owed to the new witness', epoch: ep });
    return changed;
  }
  /* ⚠️ THE HUB'S ANSWER IS UNTRUSTED INPUT: validate the shape; never throw. A refusal of the whole bundle (no access, a
     revoked device, a hub that cannot read its store) is not a witness: it teaches no epoch and acks nothing. */
  /* @sync @fact @invariant — applies the hub's answer (untrusted: its shape checked, never thrown on): acks, refusals, its clock and identity, then the owed texts */
  function applyAcks(res, bundle, reason, backlog, gen) {
    const owedNow = bundle.events.length;
    if (!res || typeof res !== 'object') return failCommit(reason, owedNow, backlog, 'malformed hub response: not an object');
    if (typeof res.refused === 'string' && res.refused) { transportStreak = 0; accessRefused = res.refused; return failCommit(reason, owedNow, backlog, 'the hub refused the bundle: ' + res.refused, { hubRefused: res.refused, refused: owedNow, acked: 0 }); }
    if (typeof res.epoch !== 'string' || !res.epoch) return failCommit(reason, owedNow, backlog, 'malformed hub response: no epoch (which witness is this?)');
    if (gen != null && gen !== generation && res.epoch !== hubEpoch) return failCommit(reason, owedNow, backlog, 'a late answer from an abandoned commit named a different witness (' + res.epoch + ') — ignored');
    if (readOnly) return failCommit(reason, owedNow, backlog, 'read-only window: an answer is not applied');
    if (!renewLease()) return failCommit(reason, owedNow, backlog, 'the lease was lost while the answer was in flight — nothing applied; what the other window holds is on disk, the rest is still owed');
    transportStreak = 0; accessRefused = null;
    noteHubClock(res.now);                                                         // E35: the hub's time on its answer
    setEpoch(res.epoch);
    let acked = 0, refused = 0;
    (Array.isArray(res.eventAcks) ? res.eventAcks : []).forEach(function (a) {
      if (!a || typeof a !== 'object' || typeof a.id !== 'string') { refused++; noteFailure({ kind: 'echo-refused', reason: 'malformed ack' }); return; }
      if (a.ok) {
        const r = log.ack(a.id, a.hash, a.pos, (typeof a.epoch === 'string' ? a.epoch : hubEpoch));
        if (r.ok) { acked++; attempted.delete(a.id); refusedStreak.delete(a.id); } else { refused++; noteFailure({ kind: 'echo-refused', id: a.id, reason: r.reason }); }
      } else {
        refused++; noteFailure({ kind: 'hub-refused', id: a.id, reason: a.reason });
        if (!/retry|storage/.test(a.reason || '')) refusedStreak.set(a.id, (refusedStreak.get(a.id) || 0) + 1);
      }
    });
    if (acked && lostOwed) lostOwed = 0;
    checkPersist();
    const effects = runEffects();
    const out = { ok: true, reason: reason, sent: bundle.events.length, backlog: backlog, acked: acked, refused: refused, effects: effects };
    if (bundle.more) out.more = true;
    if (halted) out.halted = halted;
    lastCommit = out; return out;
  }
  /* @sync @error — a commit that did not land: noted and returned, everything it carried still owed */
  function failCommit(reason, owed, backlog, msg, extra) { noteFailure({ kind: 'commit', reason: reason, error: msg, held: owed }); const out = Object.assign({ ok: false, reason: reason, held: owed, backlog: backlog, error: msg }, extra || {}); lastCommit = out; return out; }

  /* COMMIT — "tile finished, sent." Sync or async transport; one in flight, one queued; a hung answer is abandoned; a big
     backlog goes out in chunks, oldest first, looping while echoes land. */
  /* @sync @fact — tile finished, sent: my unsent facts go to the hub oldest first in chunks of 200, one commit in flight and one queued, a hung one abandoned */
  function commit(reason) {
    if (readOnly) { const out = { ok: false, reason: reason, readOnly: true, error: halted || 'read-only window' }; lastCommit = out; return out; }
    renewLease(); if (readOnly) { const out = { ok: false, reason: reason, readOnly: true, error: halted }; lastCommit = out; return out; }
    if (inFlight) {
      if (mono() - inFlightSince < commitTimeoutMs) { queued = true; const out = { ok: false, reason: reason, deferred: true, error: 'a commit is already in flight; queued' }; lastCommit = out; return out; }
      inFlight = false; queued = false; generation++; noteFailure({ kind: 'commit', reason: reason, error: 'the previous commit never answered in ' + commitTimeoutMs + ' ms — abandoned; everything it carried is still owed' });
    }
    const bundle = outbox(MAX_BUNDLE);
    const backlog = bundle.events.filter(function (e) { return attempted.has(e.id); }).length;
    bundle.events.forEach(function (e) { attempted.add(e.id); });
    const owed = bundle.events.length;
    if (!owed) { const out = { ok: true, reason: reason, sent: 0, backlog: 0, acked: 0, refused: 0, effects: runEffects(), nothingOwed: true }; lastCommit = out; return out; }
    if (!transport) { transportStreak++; return failCommit(reason, owed, backlog, 'no hub connection'); }
    let res;
    try { res = transport(bundle); } catch (err) { transportStreak++; return failCommit(reason, owed, backlog, failMsg(err)); }
    if (res && typeof res.then === 'function') {
      let p; try { p = Promise.resolve(res); } catch (err) { return failCommit(reason, owed, backlog, 'transport returned a broken thenable'); }   // a thenable that is not a Promise becomes one
      const gen = ++generation; inFlight = true; inFlightSince = mono();
      const safeApply = function (r) { try { return applyAcks(r, bundle, reason, backlog, gen); } catch (err) { return failCommit(reason, owed, backlog, 'while applying the hub answer: ' + failMsg(err)); } };
      return p.then(safeApply, function (err) { transportStreak++; return failCommit(reason, owed, backlog, failMsg(err)); })
        .then(function (out) { if (gen === generation) { inFlight = false; if (queued || (out && out.ok && out.more && out.acked > 0)) { const why = (out && out.more) ? 'next-chunk' : 'queued'; queued = false; commit(why); } } return out; });
    }
    let out; try { out = applyAcks(res, bundle, reason, backlog, null); } catch (err) { return failCommit(reason, owed, backlog, 'while applying the hub answer: ' + failMsg(err)); }
    let chunks = 0;
    while (out && out.ok && out.more && out.acked > 0 && chunks < 10000) { chunks++; const next = commit(reason); if (!next || next.deferred || next.readOnly) break; out = Object.assign({}, next, { acked: out.acked + (next.acked || 0), sent: out.sent + (next.sent || 0), refused: out.refused + (next.refused || 0), chunks: chunks }); }
    lastCommit = out; return out;
  }
  /* an outcome that may be a Promise (HTTPS): hand the caller the tile AND the pending answer, never a bare {tile} */
  /* @sync @station — a commit's outcome with the tile name, or the tile plus the pending answer when it is still in flight */
  function withTile(tname, out) { if (out && typeof out.then === 'function') return { tile: tname, pending: out }; return Object.assign({ tile: tname }, out); }
  let auditAt = 0;   /* where the rolling audit (selfCheck { rehash: N }) goes on from, in the log's own order */
  /* @station @audit — the next n facts of the rolling audit, wrapping to the start: every fact is reached once per lap (audit E27) */
  function auditSlice(all, n) {
    if (n >= all.length) { auditAt = 0; return all; }
    if (auditAt >= all.length) auditAt = 0;
    const out = all.slice(auditAt, auditAt + n); if (out.length < n) out.push.apply(out, all.slice(0, n - out.length));
    auditAt = (auditAt + n) % all.length; return out;
  }

  /* my OWN history seeds my clock unconditionally (a wall clock a year behind my last stamp is the wall's fault, not my log's);
     a peer's stamp is observed under the drift cap */
  /* @clock @fact — seeds my clock from the log: my own stamps adopted as they are, other stations' under the drift cap */
  function seedClock() { log.all().forEach(function (e) { if (e.station === id) clock.adopt(e.hlc); else clock.observe(e.hlc); }); }
  seedClock();
  rebuildVersions();
  if (log.quarantined > 0) noteFailure({ kind: 'persist', what: 'load', error: log.quarantined + ' garbage row(s) quarantined at boot' });

  const station = {
    id: id, name: name, clock: clock,
    get log() { return log; },
    get cursor() { return cursor; }, set cursor(v) { cursor = v; if (!readOnly) log.markCursor(markAt(cursor), hubEpoch); },   // the mark rides behind the facts just pulled — and never past one this copy could not apply
    atCursor: atCursor,
    get epoch() { return hubEpoch; }, get readOnly() { return readOnly; }, get halted() { return halted; }, get haltKind() { return haltKind; },
    get access() { return access ? { station: access.station, enrolled: true } : null },
    get accessToken() { return access ? access.token : null; },
    get accessRefused() { return accessRefused; },
    get failures() { return failures.slice(); }, get effectsFailed() { return effectsFailed.slice(); },
    get effectsUnknown() { return effectsUnknown; },
    get tile() { return tile ? Object.assign({}, tile) : null; },
    get lastCommit() { return lastCommit; }, get inFlight() { return inFlight; },
    setTransport(fn) { transport = fn || null; },
    /* an OPERATOR's enrollment hands this device its access token (production: pasted once, like today's hub key) */
    setAccess(token) {
      if (typeof token !== 'string' || !token) return false;
      if (halted && haltKind === 'store') return false;
      access = { station: id, token: token }; accessRefused = null; saveAccessNow(); return true;
    },
    /* A key the hub NEVER issued (a setup code typed in the operator box) is dropped — only while this device
       holds nothing of its own still to send, so no record is ever stranded — and the device is back at its connect screen */
    dropUnissuedAccess() {
      if (!access) return false; if (log.outbox(hubEpoch).some(function (e) { return e.station === id; })) return false;
      access = null; accessRefused = null; saveAccessNow(); return true;
    },
    onEffect(fn) { effectHook = fn || null; },
    setEpoch: setEpoch,
    noteHubClock: noteHubClock,
    get refusedOwed() { return refusedStreak.size ? log.outbox(hubEpoch).filter(function (e) { return e.station === id && refusedStreak.has(e.id); }).length : 0; },   /* E67: facts of mine the hub refuses, still owed */
    get clockSkew() { return clockSkew(); }, get clockWrong() { return clockGuardMs ? clockWrongWords() : null; },
    mine: mine,

    /* RECORD — the offline moment. Validate, THEN mint, append. */
    record(type, key, payload, meta) {
      if (readOnly) throw new Error('station ' + id + ' is read-only: ' + (halted || 'another window holds it'));
      if (!renewLease()) throw new Error('station ' + id + ' is read-only: ' + halted);
      if (!registry.knows(type)) throw new Error('unknown event type "' + type + '" — register it; every delta needs a home');
      const def = registry.typeDef(type); meta = meta || {};
      if (def.validate) { const bad = def.validate(payload || {}); if (bad) throw new Error('invalid ' + type + ': ' + bad); }
      if (def.admit) { const no = def.admit(payload || {}, function (dotted, v) { return registry.heldIn(log.all(), type, dotted, v); } /* 10/18: an id this tablet's history already holds is a reference (THE ID RULE, core/registry.js) — read only when an id breaks the rule */); if (no) throw new Error('invalid ' + type + ': ' + no); }   /* 10/1: a rule for new facts (never applied to a fact taken from the hub — history keeps what it was) */
      if (clockGuardMs) { const cw = clockWrongWords(); if (cw) throw new Error('⏰ ' + cw); }   // E35: never a fact under a clock the hub says is wrong
      const e = ev.makeEvent({ type: type, aggregate: def.aggregate, key: key, payload: payload, hlc: clock.now(),
        basedOn: versionByKey[def.aggregate + '|' + String(key)] || null, station: id, actor: meta.actor, at: meta.at });
      log.append(e); checkPersist();
      noteVersion(e);   /* versionByKey[key] = e.id, and whether the map is still each key's newest (batch perf) */
      if (tile && (meta.actor != null || meta.touch)) { tile.lastTouch = nowMs(); tile.touchedMono = mono(); }   // a person's act resets the idle clock; a system fact does not
      if (!tile && def.tier === 'immediate' && !meta.defer) commit('event:' + type);
      return e;
    },
    commit: commit,
    openTile(tname) {
      const t = (tileTimeouts[tname] !== undefined) ? tileTimeouts[tname] : (DEFAULT_TILE_TIMEOUTS[tname] !== undefined ? DEFAULT_TILE_TIMEOUTS[tname] : null);
      tile = { name: tname, openedAt: nowMs(), lastTouch: nowMs(), touchedMono: mono(), timeoutMs: (t > 0 ? t : null) }; return station.tile;
    },
    touch() { if (tile) { tile.lastTouch = nowMs(); tile.touchedMono = mono(); } renewLease(); },
    closeTile(why) { const t = tile; tile = null; const tname = t ? t.name : null; return withTile(tname, commit((why || 'home') + (t ? ':' + t.name : ''))); },
    tick() {
      /* a window that crashed never released its lease: the reload boots read-only, and takes the station back by itself once
         a FULL TTL of its own (monotonic) time has passed since it was last refused — a live writer that keeps renewing is
         never taken over, and a wall-clock jump cannot fake the wait */
      if (readOnly && haltKind === 'lease') {
        if (leaseRefusedAt != null && mono() - leaseRefusedAt < leaseGrant) return null;
        return station.reclaim() ? { reclaimed: true } : null;
      }
      renewLease(); if (readOnly) return null;
      checkPersist();                                                                // the heartbeat retries a refused write; nothing waits in memory for a tap
      if (inFlight && mono() - inFlightSince >= commitTimeoutMs) commit('tick');   // give up on a hung answer even with no tile open
      if (!tile || !(tile.timeoutMs > 0)) return null; const idle = mono() - tile.touchedMono; if (idle < tile.timeoutMs) return null; return Object.assign({ timedOut: true, idleMs: idle }, station.closeTile('idle-timeout'));
    },
    /* an OPERATOR retries the effects whose hook failed (a gateway 503) or whose outcome is unknown: "retrying" is written
       before each fires; success drops it from the list. A retry is a human's decision, never something a reboot does. */
    retryEffects() {
      if (readOnly || !effectHook || effectsUnknown) return 0;
      if (!renewLease()) return 0;
      if (effectsDirty && !saveEffects()) return 0;
      let n = 0; const list = effectsFailed.slice();
      for (let i = 0; i < list.length; i++) {
        const f = list[i]; const e = log.get(f.id);
        if (!e || !effectRowValid(f)) { effectsFailed = effectsFailed.filter(function (x) { return x.k !== f.k; }); noteFailure({ kind: 'effect', id: f.id, error: 'retry refused: the row names no fact of mine with that effect — dropped' }); continue; }
        if (e.pos == null) continue;                                                 // a fact currently owed again is not retried until it is witnessed
        const row = effectsFailed.find(function (x) { return x.k === f.k; }); if (!row) continue;
        const was = row.error; row.error = 'retrying'; row.ts = nowMs();
        if (!saveEffects()) { row.error = was; return n; }                           // the retry mark must land before the hook fires
        if (fire(f.k, e, f.effect, true)) n++;
      }
      saveEffects(); return n;
    },
    /* the window is closing: flush what it can, give the lease back so a reload is the same station — and be a writer no more */
    close() {
      if (!readOnly) { checkPersist(); const lost = (log.dirty ? 1 : 0) + (log.pending ? log.pending() : 0); if (lost) noteFailure({ kind: 'persist', what: 'close', error: 'CLOSED WITH ' + lost + ' WRITE(S) THE DISK STILL REFUSES — a fact may die with this window' }); }
      try { if (persist && typeof persist.release === 'function') persist.release(nonce); } catch (e) {}
      rehalt('closed', 'this window was closed');
    },
    /* a read-only window whose ONLY problem was the lease may become the writer once the lease is free: it re-reads the
       access store and the log first (the other window may have written), MERGES what it held and never flushed, and only
       then drops read-only */
    reclaim() {
      if (!readOnly || haltKind !== 'lease') return false;
      if (!takeLease()) return false;
      const a = loadAccessNow();
      if (a.ok && a.value && a.value.station !== id) { rehalt('store', 'this store belongs to station "' + a.value.station + '", not "' + id + '"'); return false; }
      if (a.ok) { if (a.value) access = a.value; else if (access) accessDirty = true; }
      const unflushed = log.all(), prevFailed = effectsFailed.slice(), prevDone = new Set(effectsDone), prevAttempting = new Map(attempting);
      const fresh = makeLog(persist);
      if (fresh.unreadable) { noteFailure({ kind: 'persist', what: 'load', error: 'reclaim: my log could not be read; staying read-only' }); return false; }
      log = fresh; restoreMark(true);   // the store's own mark; none → re-read from zero, which is always safe
      let merged = 0; unflushed.forEach(function (e) { if (!log.has(e.id)) { log.append(e); merged++; } else if (e.adopted && !log.get(e.id).adopted) log.markAdopted(e.id); });   // what I held and the disk never got
      if (hasEffectsStore) {
        loadEffects();
        if (!effectsUnknown && effectsDone.size === 0 && prevDone.size) { prevDone.forEach(function (k) { effectsDone.add(k); }); noteFailure({ kind: 'persist', what: 'effects-load', error: 'reclaim: the effects store came back empty — my done-marks were carried forward' }); effectsDirty = true; }
        prevFailed.forEach(function (f) { if (effectsDone.has(f.k)) return; if (!effectRowValid(f)) return; effectsDone.add(f.k); effectsFailed.push(f); effectsDirty = true; });   // a row the store already knows was resolved by the other window
        prevAttempting.forEach(function (row, k) { if (effectsDone.has(k)) return; effectsDone.add(k); effectsFailed.push({ k: k, id: row.id, effect: row.effect, error: 'attempted before a lease lapse — outcome unknown; an operator decides', ts: row.ts }); effectsDirty = true; });
      }
      rebuildVersions(); seedClock();
      readOnly = false; halted = null; haltKind = null;
      reconcileRegistry();
      noteFailure({ kind: 'lease', note: 'reclaimed the station; state re-read from the store' + (merged ? '; ' + merged + ' unflushed row(s) merged back' : '') });
      checkPersist();
      return true;
    },
    /* @sync @station — E86 (batch `sync` 9/25): the highest position the hub has given a fact of mine, read as a pull goes out; a fact
       witnessed after it (a commit whose small answer overtook the pull's big one) is never taken for one the hub lost */
    witnessMark() { let m = 0; mine().forEach(function (e) { if (witnessed(e) && e.pos > m) m = e.pos; }); return m; },
    /* INGEST — facts from the hub, the authority. Clone, check shape and hash. A fact of MINE I do not hold is taken back
       (its texts held for an operator BEFORE it lands); a fact of mine the hub had witnessed at a position it now gives to
       another fact was LOST by the hub — mine is owed again. A different fact under an id I hold is refused, never applied.
       E86: mark (witnessMark() when the pull went out) — a fact of mine witnessed after that is newer than the answer, never lost. */
    ingest(events, head, mark) {
      let added = 0, refused = 0, acked = 0, adopted = 0, lost = 0, holdAt = null;
      if (readOnly || !renewLease()) return { added: 0, refused: 0, acked: 0, adopted: 0, readOnly: true };
      const mineAt = new Map(); if (events && events.length) mine().forEach(function (e) { if (witnessed(e)) mineAt.set(e.pos, e); });   /* an empty pull (an idle tick) reads nothing from it (batch perf) */
      (events || []).forEach(function (raw) {
        if (readOnly) { refused++; return; }
        let e; try { e = ev.wire(raw); } catch (err) { refused++; noteFailure({ kind: 'ingest-refused', reason: 'not transmissible' }); return; }
        if (e && typeof e === 'object') { delete e.adopted; delete e.everPos; }        // another copy's metadata is not mine
        const shape = ev.shapeError(e);
        if (shape || !ev.verify(e)) { refused++; noteFailure({ kind: 'ingest-refused', id: e && e.id, reason: shape || 'content does not match its hash' }); return; }
        const def = registry.typeDef(e.type);
        if (!def || def.aggregate !== e.aggregate || (def.validate && def.validate(e.payload))) {
          refused++; if (Number.isInteger(e.pos) && e.epoch === hubEpoch) unapplied.set(e.pos, { id: e.id, type: e.type });   // read again after the update, never skipped
          noteFailure({ kind: 'ingest-refused', id: e.id, reason: 'not a registered event of that aggregate, or an invalid payload — this station needs the update the hub has' }); return; }
        if (unapplied.size && Number.isInteger(e.pos)) unapplied.delete(e.pos);
        const had = (e.pos != null && e.epoch === hubEpoch) ? mineAt.get(e.pos) : null;
        if (had && had.id !== e.id && log.reoffer(had.id)) { lost++; mineAt.delete(e.pos); }   // the hub gave my witnessed position to another fact: it lost mine
        clock.observe(e.hlc);
        if (!log.has(e.id)) {
          if (e.station === id) {
            /* a write of mine that never reached (or left) my disk — its texts are HELD, durably, BEFORE the fact lands */
            const heldNow = holdEffectsOf(e, 'taken back from the hub: this copy never saw the text go out — it fired before the write was lost, or never; an operator decides (retryEffects)');
            if (heldNow && !saveEffects()) { effectsOf(e).forEach(function (fx) { const k = e.id + '|' + fx; effectsDone.delete(k); effectsFailed = effectsFailed.filter(function (x) { return x.k !== k; }); }); refused++; if (e.pos != null && (holdAt == null || e.pos < holdAt)) holdAt = e.pos; noteFailure({ kind: 'adopt-deferred', id: e.id, reason: effectsUnknown ? 'the effects store is HELD (unreadable) — the fact stays on the hub until an operator resolves it' : 'the effects store refused the hold-mark — the fact stays on the hub until the disk returns' }); return; }
            log.append(e); log.markAdopted(e.id); adopted++; clock.adopt(e.hlc); relistOrphans();
            noteFailure({ kind: 'adopted', id: e.id, note: 'a fact recorded as this station was on the hub but not in my log (a lost write, a restored backup, or another copy of this tablet) — taken back; its texts are listed for an operator' });
          } else { log.append(e); added++; }
          if (e.pos != null && e.epoch != null) log.ack(e.id, e.hash, e.pos, e.epoch);
          return;
        }
        if (log.get(e.id).hash !== e.hash) { refused++; noteFailure({ kind: 'ingest-refused', id: e.id, reason: 'the hub holds a different fact under an id I hold — kept mine, refused theirs; an operator must look' }); return; }
        if (e.pos != null && e.epoch != null) { const r = log.ack(e.id, e.hash, e.pos, e.epoch); if (r.ok && r.newlyWitnessed) acked++; }
      });
      /* a QUIET restore: the hub's whole record ends before a position it had given a fact of mine — it lost that fact */
      if (Number.isInteger(head) && head >= 0 && !readOnly) mine().forEach(function (e) { if (witnessed(e) && e.pos > head && !(Number.isInteger(mark) && e.pos > mark) && log.reoffer(e.id)) lost++; });   /* E86: only what was witnessed before the pull went out */
      if (lost) { lostOwed += lost; noteFailure({ kind: 'reoffer', note: lost + ' fact(s) of mine the hub had witnessed are gone from it (its store went back in time) — owed again, and the hub is told' }); }
      checkPersist(); rebuildVersions(); runEffects();
      return { added: added, refused: refused, acked: acked, adopted: adopted, lost: lost, holdAt: holdAt, readOnly: readOnly || undefined };
    },
    project(aggregate) { const agg = registry.aggregate(aggregate); if (!agg) throw new Error('unknown aggregate "' + aggregate + '"'); return agg.fold(log.sorted().filter(function (e) { return e.aggregate === aggregate; })); },
    outbox: function () { return outbox(); }, noteFailure: noteFailure,
    /* An operator resolves an unreadable effects store. 'seed' = every effect of mine that was EVER witnessed (pos set under any
       hub, or re-offered since) is treated as done — they fired before, or nothing can know; 'clear' = fire them all. Anything
       else is refused: the store stays held, because a typo must never text every customer in the log. Failed rows stay listed. */
    resolveEffects(how) {
      if (!effectsUnknown || readOnly) return false;
      if (how !== 'seed' && how !== 'clear') return false;
      if (!renewLease()) return false;
      if (how === 'seed') { mine().forEach(function (e) { if (!log.everWitnessed(e)) return; effectsOf(e).forEach(function (fx) { effectsDone.add(e.id + '|' + fx); }); }); }
      effectsUnknown = false; const ok = saveEffects(true); if (!ok) effectsUnknown = true; else reconcileRegistry(); return ok;
    },
    /* @station @audit — the whole audit with no argument (every fact re-hashed, as before); { rehash: N } — the Home screen's
       health line — re-checks N facts a call on a rolling window, so all history is re-hashed every few hours of Home without a
       draw ever re-hashing all of it (audit E27, batch `perf`: 1.7 s of every 5 s at 31k facts); { rehash: false } checks the
       shape of every fact and hashes none. Everything that is not per-fact is checked every call. */
    selfCheck(opts) {
      const all = log.all(), problems = [], ids = new Set(), o = opts || {}, rehash = o.rehash !== false;
      const span = (Number.isInteger(o.rehash) && o.rehash >= 0) ? auditSlice(all, o.rehash) : all;
      if (halted) problems.push('HALTED: ' + halted);
      span.forEach(function (e) {
        if (ids.has(e.id)) problems.push('duplicate event id in my log: ' + e.id); ids.add(e.id);
        if (!registry.knows(e.type)) problems.push('event of unknown type in my log: ' + e.type);
        const shape = ev.shapeError(e);
        if (shape) problems.push('malformed event in my log (' + shape + '): ' + (e && e.id));
        else if (rehash && !ev.verify(e)) problems.push('content does not match its hash (tampered or corrupted): ' + e.id);
      });
      if (!access) problems.push('this device has no hub access — an operator enrolls it; facts are kept and sent after');
      if (accessRefused) problems.push('the hub refused this device: ' + accessRefused);
      if (log.dirty || (log.pending && log.pending() > 0)) problems.push('my log has writes the disk has not taken yet');
      if (accessDirty) problems.push('the access store refused a write');
      if (effectsUnknown) problems.push('effects store unreadable — texts HELD until an operator resolves it');
      if (effectsDirty) problems.push('the effects store refused a write — texts held');
      if (effectsFailed.length) problems.push(effectsFailed.length + ' text(s) failed or outcome unknown — an operator decides (retryEffects)');
      if (orphanFailed.size) problems.push(orphanFailed.size + ' failed text row(s) name facts I do not hold yet');
      refusedStreak.forEach(function (n, fid) { if (n >= REFUSED_STREAK) problems.push('the hub refused ' + fid + ' ' + n + ' times in a row'); });
      if (transportStreak >= REFUSED_STREAK && log.outbox(hubEpoch).some(function (e) { return e.station === id; })) problems.push(transportStreak + ' commits in a row never reached the hub while facts are owed');
      if (log.quarantined > 0) problems.push(log.quarantined + ' garbage row(s) quarantined from my log');
      if (unapplied.size) problems.push(unapplied.size + ' fact(s) from the hub this copy cannot apply yet — it needs the update (reload the page); they are read again after it, never skipped');
      const cwNow = clockGuardMs ? clockWrongWords() : null; if (cwNow) problems.push('⏰ ' + cwNow);
      const own = mine();
      return { ok: problems.length === 0, problems: problems, events: all.length, audited: span.length, mine: own.length, unwitnessed: own.filter(function (e) { return !witnessed(e); }).length,
        failures: failures.length, effectsFailed: effectsFailed.length, effectsUnknown: effectsUnknown, effectsDirty: effectsDirty, orphanEffects: orphanFailed.size,
        persistDirty: !!log.dirty, pending: log.pending ? log.pending() : 0, quarantined: log.quarantined, readOnly: readOnly, halted: halted, haltKind: haltKind, cursor: cursor, epoch: hubEpoch, enrolled: !!access, tileOpen: tile ? tile.name : null, unapplied: unapplied.size };
    }
  };
  return station;
}

module.exports = { makeStation: makeStation, DEFAULT_TILE_TIMEOUTS: DEFAULT_TILE_TIMEOUTS, LEASE_MS: LEASE_MS, COMMIT_TIMEOUT_MS: COMMIT_TIMEOUT_MS, REFUSED_STREAK: REFUSED_STREAK, MAX_BUNDLE: MAX_BUNDLE, CLOCK_GUARD_MS: CLOCK_GUARD_MS };

});
__def("sync/sync.js", {}, function (module, exports, require) {
'use strict';
/* ============================================================================
 * SYNC — replicate the LOG. The hub decides; stations never wait on it.
 * @sync @hub @fact — a station's log replicated through the hub: commit what I owe, pull what I lack in order, re-offer what a new or forgetful hub lost; a failure loses nothing
 *   attach(station, hub)   wire commit to the hub (production: an HTTPS POST carrying the device's access token).
 *                          In-process, attach also stands in for the OPERATOR'S SETUP: a station whose id no device
 *                          holds at THIS hub (a first boot, a brand-new hub) is enrolled. It never takes an id another device holds —
 *                          a replacement tablet is an explicit hub.enroll(), exactly as in the shop.
 *   pull(station, hub)     everything after my cursor, in order, in chunks; a hub under another epoch sends from
 *                          zero. Facts of mine the hub had and I lost are taken back by ingest; facts of mine the
 *                          hub lost are owed again and it is told on the next commit.
 *   home(station, hub)     the "back to Home" cycle: commit → pull → (a new or forgetful hub) commit again.
 *   pullAsync / homeAsync  the same, against a hub that answers with a Promise (sync/http.js — the wire). One
 *                          function applies every answer (applyAnswer), so the two can never drift apart.
 * Every step is caught: a failure is logged and nothing is lost. A read-only window pulls nothing.
 * ========================================================================== */
/* @sync @hub @station — wires a station's commits to an in-process hub, and enrols a first-boot station there as the operator would; never takes an id another device holds */
function attach(station, hub, opts) {
  if (!(opts && opts.enroll === false) && !station.readOnly && typeof hub.enrolled === 'function' && !hub.enrolled(station.id)) {
    const t = hub.enroll(station.id, { by: 'setup' }); if (t) station.setAccess(t);
  }
  station.setTransport(function (bundle) { return hub.receive(bundle); });
  return station;
}
/* @sync @station — cuts a station off its hub: its commits have nowhere to go until it is attached again */
function detach(station) { station.setTransport(null); return station; }

/* @sync — a pull's tally at zero: added, refused, acked, adopted, lost, epoch changed, chunks */
function newPullOut() { return { ok: true, added: 0, refused: 0, acked: 0, adopted: 0, lost: 0, epochChanged: false, chunks: 0 }; }
/* @sync @fact — one answer from the hub, applied: 'more' to ask again, 'stop' when done (or refused, or deferred). A record that
   ends before my cursor under the SAME identity (a hub that went back in time and did not say so) is read again from zero,
   so every position is checked against what I hold and nothing new is skipped (E6). */
function applyAnswer(station, r, out, mark) {   /* mark: E86 — station.witnessMark() when the pull went out */
  if (!r || typeof r !== 'object' || (typeof r.refused !== 'string' && (typeof r.epoch !== 'string' || !Array.isArray(r.events)))) { out.ok = false; out.error = 'malformed hub answer'; station.noteFailure({ kind: 'pull', error: out.error }); return 'stop'; }
  if (r.refused) { out.ok = false; out.error = r.refused; station.noteFailure({ kind: 'pull', error: r.refused }); return 'stop'; }
  if (typeof r.now === 'number' && typeof station.noteHubClock === 'function') station.noteHubClock(r.now);   // E35: the hub's time on its answer
  if (r.epoch !== station.epoch) out.epochChanged = station.setEpoch(r.epoch) || out.epochChanged;   // the hub answered from zero
  else if (!out.rewound && Number.isInteger(r.head) && r.head < station.cursor && !station.readOnly) { out.rewound = true; station.noteFailure({ kind: 'reoffer', note: 'the hub\'s record ends at ' + r.head + ', before where I had read (' + station.cursor + ') under the same identity — it went back in time; reading it again from the start' }); station.cursor = 0; return 'more'; }
  const res = station.ingest(r.events, r.head, mark);
  out.added += res.added; out.refused += res.refused; out.acked += res.acked; out.adopted += res.adopted || 0; out.lost += res.lost || 0; out.chunks++;
  if (station.readOnly) { out.readOnly = true; return 'stop'; }
  if (res.holdAt != null) { station.cursor = Math.max(station.cursor, res.holdAt - 1); out.deferred = true; return 'stop'; }   // a fact of mine I could not take back yet: never step past it
  if (r.events.length) station.cursor = Math.max(station.cursor, r.events[r.events.length - 1].pos);
  return (!r.more || !r.events.length) ? 'stop' : 'more';
}
/* @sync @error — a pull that threw: noted on the station and on the tally; the facts stay owed, nothing is lost */
function pullFailed(station, out, err) { const msg = String((err && err.message) || err); station.noteFailure({ kind: 'pull', error: msg }); out.ok = false; out.error = msg; }
/* @sync — the id of the fact the station holds at its cursor, for the hub's rewind check (E6); a station without it says nothing */
function atOf(station) { return typeof station.atCursor === 'function' ? station.atCursor() : undefined; }

/* @sync @hub — everything after my cursor from an in-process hub, chunk by chunk, through the one answer-applier; a read-only window pulls nothing */
function pull(station, hub) {
  const out = newPullOut();
  if (station.readOnly) { out.ok = false; out.readOnly = true; return out; }
  try {
    for (let guard = 0; guard < 100000; guard++) {
      if (applyAnswer(station, hub.pull(station.accessToken, station.cursor, station.epoch, undefined, atOf(station)), out) === 'stop') break;
    }
  } catch (err) { pullFailed(station, out, err); }
  return out;
}
/* @sync @hub — the same pull against a hub that answers with a Promise (the wire); stops if the window went read-only while an answer was on its way */
async function pullAsync(station, hub) {
  const out = newPullOut();
  if (station.readOnly) { out.ok = false; out.readOnly = true; return out; }
  try {
    for (let guard = 0; guard < 100000; guard++) {
      const mark = typeof station.witnessMark === 'function' ? station.witnessMark() : undefined;   /* E86: a commit's answer may overtake this one */
      const r = await hub.pull(station.accessToken, station.cursor, station.epoch, undefined, atOf(station));
      if (station.readOnly) { out.readOnly = true; return out; }       // the window went inert while the answer was on its way
      if (applyAnswer(station, r, out, mark) === 'stop') break;
    }
  } catch (err) { pullFailed(station, out, err); }
  return out;
}

/* @sync @hub — the back-to-Home cycle: commit, pull, and commit again at once when the hub is new or lost my facts */
function home(station, hub, reason) {
  const c1 = station.commit(reason || 'home');
  const p = pull(station, hub);
  const c2 = (p.lost > 0 || p.epochChanged) ? station.commit('re-offer') : null;   // a new witness, or one that lost my facts: what is owed goes at once
  return { commit: c1, pull: p, reoffer: c2 };
}
/* @sync @hub — the back-to-Home cycle over the wire: commit, pull, and re-offer at once when the hub is new or lost my facts */
async function homeAsync(station, hub, reason) {
  const c1 = await station.commit(reason || 'home');
  const p = await pullAsync(station, hub);
  const c2 = (p.lost > 0 || p.epochChanged) ? await station.commit('re-offer') : null;
  return { commit: c1, pull: p, reoffer: c2 };
}

module.exports = { attach: attach, detach: detach, pull: pull, home: home, pullAsync: pullAsync, homeAsync: homeAsync };

});
__def("sync/http.js", {}, function (module, exports, require) {
'use strict';
/* ============================================================================
 * THE WIRE — a station talks to the v2 hub over HTTP(S) (2026-09-23, step 2 of ARCHITECTURE-V2's "Next").
 * @sync @hub — a station talks to the hub over HTTP(S): the device token rides in the body and a header, never the URL, and a network failure loses nothing
 * ----------------------------------------------------------------------------
 * httpHub(base) answers like an in-process hub, with Promises: receive(bundle) and pull(token, cursor, epoch, limit).
 * The device token rides in the BODY, never the URL (a URL is logged by every proxy on the way). In production
 * a TLS proxy sits in front with HTTPS; hub/server.js itself listens on 127.0.0.1.
 *   attach(station, remote)   commit goes over the wire. Enrolment is an OPERATOR step (hub/server.js /v2/admin/enroll):
 *                             the station must already hold its access token (station.setAccess), as in the shop.
 *   sync.pullAsync / sync.homeAsync do the rest with the same rules as the in-process pull.
 * A network failure is a thrown/rejected call: the station logs it and keeps the facts owed. Nothing is lost.
 * ========================================================================== */
/* @sync @hub — a station's wire to the hub over fetch; the device key rides in a header as well as the body (E31) */
function httpHub(base, opts) {
  opts = opts || {};
  const root = String(base || '').replace(/\/+$/, '');
  const timeoutMs = Number(opts.timeoutMs) || 30000;
  const doFetch = opts.fetch || (typeof fetch === 'function' ? fetch : null);
  if (!doFetch) throw new Error('httpHub needs fetch (Node 18+ or a browser)');
  /* E68 (batch `sync` 9/25): a pull may take longer than a commit, and asks for as many facts as the signal carries (pace) */
  const pullTimeoutMs = Number(opts.pullTimeoutMs) || timeoutMs, adaptive = opts.adaptive !== false;   /* the station page asks for 45 s (station/app.js) */
  const pace = { limit: Number(opts.pullLimit) || (adaptive ? 250 : 0), min: 25, max: 1000 };
  /* @sync @hub — one call to the hub; the device key rides in the x-custompos-token header too, so the hub's front door knows the
     sender before it reads a byte of the body (E31, 9/25); waitMs: a pull's own longer wait (E68) — merge 9/25 */
  function call(method, path, body, key, waitMs) {
    const tms = waitMs || timeoutMs;
    const ac = new AbortController(); const t = setTimeout(function () { ac.abort(); }, tms);
    const init = { method: method, headers: { 'content-type': 'application/json', accept: 'application/json' }, signal: ac.signal };
    if (typeof key === 'string' && key) init.headers['x-custompos-token'] = key;
    if (body !== undefined) init.body = JSON.stringify(body);
    return Promise.resolve().then(function () { return doFetch(root + path, init); })
      .then(function (r) { return r.text().then(function (txt) {
        let j = null; try { j = JSON.parse(txt); } catch (e) {}
        if (!j || typeof j !== 'object' || Array.isArray(j)) throw new Error('the hub answered HTTP ' + r.status + ' with no hub answer');
        if (typeof opts.onAnswer === 'function') { try { opts.onAnswer(j, path); } catch (e) {} }   /* opts.onAnswer: the page reads the build and the owner's reload request off every answer (E70 / S26) */
        return j; }); })
      .then(function (j) { clearTimeout(t); return j; }, function (err) { clearTimeout(t); throw (err && err.name === 'AbortError') ? new Error('the hub did not answer in ' + tms + ' ms') : err; });
  }
  /* @sync @hub — E68: the weak-signal pace. A pull that timed out asks for half as many facts next time (never under 25); a FULL page
     that came back in under a quarter of the wait asks for twice as many (never over the hub's 1000). Each answer is applied and
     its cursor kept before the next is asked for, so a phone in a weak area always moves forward. */
  function paced(lim, took, j, err) {
    if (!adaptive || !lim) return;
    if (err) { if (/did not answer/.test(String(err.message))) pace.limit = Math.max(pace.min, Math.floor(lim / 2)); return; }
    if (j && Array.isArray(j.events) && j.events.length >= lim && took < pullTimeoutMs / 4) pace.limit = Math.min(pace.max, lim * 2);
  }
  return {
    base: root,
    receive: function (bundle) { return call('POST', '/v2/receive', bundle, bundle && bundle.token); },
    pull: function (token, cursor, epoch, limit, at) { const lim = limit || pace.limit || undefined, body = { token: token, cursor: cursor, epoch: epoch, limit: lim, at: at }; if (typeof opts.info === 'function') { try { body.info = opts.info(); } catch (e) {} }   /* opts.info: what the page says of itself on each pull (its clock — E35); at: the fact held at the cursor (E6) */
      const t0 = Date.now(); return call('POST', '/v2/pull', body, token, pullTimeoutMs).then(function (j) { if (!limit) paced(lim, Date.now() - t0, j, null); return j; }, function (err) { if (!limit) paced(lim, Date.now() - t0, null, err); throw err; }); },
    get pullLimit() { return pace.limit; },
    health: function () { return call('GET', '/v2/health'); }
  };
}
/* @sync @hub @station — a station's commits go over the wire; enrolment stays the operator's step, so the station must already hold its access token */
function attach(station, remote) { station.setTransport(function (bundle) { return remote.receive(bundle); }); return station; }

module.exports = { httpHub: httpHub, attach: attach };

});
__def("store/browser.js", {}, function (module, exports, require) {
'use strict';
/* ============================================================================
 * THE BROWSER STORE — a tablet's journal in IndexedDB, behind the station's SYNCHRONOUS persist interface
 * @storage @sync @station — a tablet's journal in IndexedDB behind the station's synchronous store: one ordered write queue, a tab lease that fails closed, nothing written out of order
 * ----------------------------------------------------------------------------
 * (2026-09-23, step 2 of the wire: "the station log on disk — browser: IndexedDB with the same rows".)
 * The station asks its store for load / append (the journal), loadAccess / saveAccess, loadEffects / saveEffects,
 * and lease / release — all synchronous. IndexedDB is asynchronous. So:
 *   · openBrowserStore() reads everything ONCE, before the station is made, into an in-memory mirror; the station's
 *     synchronous calls are answered from the mirror.
 *   · Every write joins ONE queue, written to IndexedDB in order, in batched transactions. A refused write (a full
 *     disk, a quota) is retried in order with backoff, and while the store is behind, append/save THROW — so the
 *     log keeps the next rows in its own pending queue (never re-appended), the station's selfCheck says
 *     persistDirty, and nothing is ever written out of order. A row accepted before the failure is written first.
 *   · The tab lease lives in localStorage (synchronous, shared by every tab of the origin) with a GENERATION that
 *     rises whenever a different tab takes it. A tab that re-takes its lease after another tab held it knows its
 *     mirror may be stale: load() refuses, the station's reclaim fails closed, and the tab says "reload this page".
 *     It never writes over the other tab's work.
 *   · A write that was queued but not yet on disk when the page died is the same case as any lost write: the hub
 *     holds what was committed, and the next pull takes it back (texts held for an operator, never fired blind).
 *   · (batch `perf`, 9/25) The writing tab's station takes the journal's rows as IndexedDB gave them and the mirror is let
 *     go, so history is held once, not twice (E84). The cursor mark is one row in meta, overwritten in the same ordered
 *     queue, not a journal row per pull (E87). A lease this tab takes back with nobody else having held it says so
 *     (same), and the station goes on without re-reading (E71).
 * ========================================================================== */
/* @storage — a deep copy through JSON, so nothing the station holds shares an object with the store; undefined stays undefined */
function clone(v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }

/* @storage @station — opens this tablet's IndexedDB and reads it all once, before the station is made; with no IndexedDB, no station id, or a store that cannot be opened or read, it refuses and replaces nothing */
function openBrowserStore(stationId, opts) {
  opts = opts || {};
  const idb = opts.indexedDB || (typeof indexedDB !== 'undefined' ? indexedDB : null);
  const ls = opts.localStorage !== undefined ? opts.localStorage : (typeof localStorage !== 'undefined' ? localStorage : null);
  if (!idb) return Promise.reject(new Error('this browser has no IndexedDB, so this tablet cannot keep its log here'));
  if (typeof stationId !== 'string' || !stationId) return Promise.reject(new Error('openBrowserStore: a station id is required'));
  const name = (opts.prefix || 'custompos-') + stationId;

  return new Promise(function (ok, no) {
    const rq = idb.open(name, 1);
    rq.onupgradeneeded = function () { const d = rq.result;
      if (!d.objectStoreNames.contains('journal')) d.createObjectStore('journal', { autoIncrement: true });
      if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta'); };
    rq.onsuccess = function () { ok(rq.result); };
    rq.onerror = function () { no(new Error('this tablet\'s store could not be opened (' + ((rq.error && rq.error.message) || 'unknown') + ') — nothing was replaced')); };
    rq.onblocked = function () { no(new Error('this tablet\'s store is held by an older copy of the page — close other tabs and reload')); };
  }).then(function (db) {
    const read = function (store, how) { return new Promise(function (ok, no) {
      let tx; try { tx = db.transaction([store], 'readonly'); } catch (e) { no(e); return; }
      const r = how(tx.objectStore(store)); r.onsuccess = function () { ok(r.result); }; r.onerror = function () { no(r.error || new Error('read failed')); }; }); };
    return Promise.all([read('journal', function (s) { return s.getAll(); }), read('meta', function (s) { return s.get('access'); }), read('meta', function (s) { return s.get('effects'); }), read('meta', function (s) { return s.get('mark'); })])
      .then(function (got) { return makeStore(db, got[0] || [], got[1] == null ? null : got[1], got[2] == null ? [] : got[2], got[3] == null ? null : got[3]); },
            function (e) { try { db.close(); } catch (_) {} throw new Error('this tablet\'s store could not be read (' + ((e && e.message) || e) + ') — nothing was replaced'); });
  });

  /* @storage @sync — the synchronous store over what was read: every write joins one ordered, batched queue retried with backoff; a write is refused while the store is behind or closed, and a tab whose lease another tab took is told to reload */
  function makeStore(db, rows, access, effects, mark) {
    const mirror = rows.slice(), meta = { access: access, effects: effects, mark: mark };
    let handedOut = false, appended = false, rowCount = mirror.length;   /* the mirror is let go once the writing tab's station has it (audit E84) */
    const queue = [], waiters = [];
    let flushing = false, lastError = null, writes = 0, timer = null, backoff = 0, closed = false, stale = false, heldGen = null, inflight = 0;
    const leaseKey = 'custompos-lease:' + stationId;

    function settle() { if (queue.length || flushing) return; while (waiters.length) waiters.shift()(); }
    function schedule(ms) { if (timer || closed) return; timer = setTimeout(function () { timer = null; flush(); }, ms || 0); }
    function flush() {
      if (closed || flushing) return;
      if (!queue.length) { settle(); return; }
      flushing = true; const batch = queue.slice(0, 500); let done = false; inflight = batch.length;
      const failed = function (e) { if (done) return; done = true; flushing = false; inflight = 0; lastError = String((e && (e.name ? e.name + ': ' : '') + (e.message || '')) || e || 'the write was refused');
        backoff = Math.min(backoff ? backoff * 2 : 250, 5000); schedule(backoff); };
      let tx;
      try {
        tx = db.transaction(['journal', 'meta'], 'readwrite');
        const j = tx.objectStore('journal'), m = tx.objectStore('meta');
        batch.forEach(function (op) { if (op.row !== undefined) j.add(op.row); else m.put(op.value, op.key); });
      } catch (e) { failed(e); return; }
      tx.oncomplete = function () { if (done) return; done = true; flushing = false; inflight = 0; queue.splice(0, batch.length); writes += batch.length; lastError = null; backoff = 0;
        if (queue.length) schedule(0); else settle(); };
      tx.onerror = function () { failed(tx.error); };
      tx.onabort = function () { failed(tx.error); };
    }
    /* @storage @sync — the cursor mark is ONE row in meta, overwritten, in the same ordered queue as the facts (so it still lands only
       after the facts it covers): a pull that moves the cursor no longer adds a journal row forever (audit E87, batch `perf`) */
    function markRow(m) { const c = clone(m); accept({ key: 'mark', value: c }); meta.mark = c; }
    /* @storage @station — E88 (batch `sync` 9/25): the page is going away. Every row still queued (past the batch already being
       written) goes to IndexedDB in one last transaction, started BEFORE db.close() — IndexedDB finishes a transaction already
       begun, so a tap a few milliseconds before the page hid is kept. A disk that refuses it refuses it: the station has said so. */
    function lastFlush() {
      const rest = queue.slice(flushing ? inflight : 0); if (!rest.length) return 0;
      try {
        const tx = db.transaction(['journal', 'meta'], 'readwrite'), j = tx.objectStore('journal'), m = tx.objectStore('meta');
        rest.forEach(function (op) { if (op.row !== undefined) j.add(op.row); else m.put(op.value, op.key); });
        tx.oncomplete = function () { writes += rest.length; };
      } catch (e) { return 0; }
      return rest.length;
    }
    function accept(op) {
      if (closed) throw new Error('this tablet\'s store is closed');
      if (lastError) throw new Error('this tablet\'s store is behind (' + lastError + ') — the row waits, in order');
      queue.push(op); schedule(0);
    }

    const persist = {
      /* @storage — the journal, read into the page. The WRITING tab's station takes the rows IndexedDB just handed this page, as they
         are (nothing else holds them), and the store lets them go: one copy of history in memory, not three — the rows, a mirror
         of them and a clone (audit E84/E59, batch `perf`). A read-only tab keeps its mirror for the day it takes the station over. */
      load: function () {
        if (stale) throw new Error('another tab wrote to this tablet while this one slept — reload this page');
        if (handedOut) throw new Error('the journal of this tablet was already read into the page — reload this page to read it again');
        const writer = heldGen != null, out = (writer && !appended) ? mirror.splice(0, mirror.length) : clone(mirror);
        if (meta.mark) out.push({ mark: clone(meta.mark) });   /* the newest cursor mark (kept in meta, one row) reads last, so it is the last word */
        if (writer) { handedOut = true; mirror.length = 0; }
        return out;
      },
      append: function (row) { if (row && row.mark !== undefined && Object.keys(row).length === 1) { markRow(row.mark); return; } const c = clone(row); accept({ row: c }); rowCount++; appended = true; if (!handedOut) mirror.push(c); },
      loadAccess: function () { return clone(meta.access); },
      saveAccess: function (a) { const c = clone(a == null ? null : a); accept({ key: 'access', value: c }); meta.access = c; },
      loadEffects: function () { return clone(meta.effects); },
      saveEffects: function (list) { const c = clone(list || []); accept({ key: 'effects', value: c }); meta.effects = c; },
      /* the whole picture, for the screen and for tests */
      health: function () { return { pending: queue.length + (flushing ? 0 : 0), lastError: lastError, writes: writes, stale: stale, rows: rowCount, mirror: mirror.length }; },
      whenWritten: function () { return new Promise(function (r) { if (!queue.length && !flushing) r(); else { waiters.push(r); schedule(0); } }); },
      close: function () { if (!closed) lastFlush(); closed = true; if (timer) { clearTimeout(timer); timer = null; } try { db.close(); } catch (e) {} }   /* E88: the queue first, then the close */
    };
    if (ls) {
      const readLease = function () { try { const v = JSON.parse(ls.getItem(leaseKey) || 'null'); return (v && typeof v === 'object') ? v : null; } catch (e) { return null; } };
      persist.lease = function (nonce, ms) {
        const now = Date.now(), cur = readLease();
        if (cur && cur.nonce && cur.nonce !== nonce && Number(cur.until) > now) return { ok: false, holder: String(cur.nonce).slice(0, 8), until: cur.until };
        const gen = cur ? (cur.nonce === nonce ? (Number(cur.gen) || 1) : (Number(cur.gen) || 0) + 1) : 1, same = !!(cur && cur.nonce === nonce && heldGen != null && gen === heldGen);   /* same: nobody else held it since I last did (audit E71) */
        ls.setItem(leaseKey, JSON.stringify({ nonce: nonce, until: now + ms, gen: gen }));
        const back = readLease();
        if (!back || back.nonce !== nonce) return { ok: false, holder: back && String(back.nonce).slice(0, 8) };   // another tab wrote in the same instant
        if (heldGen != null && gen !== heldGen) stale = true;       // someone else held it since my mirror was current
        heldGen = gen; return { ok: true, ttlMs: ms, same: same };
      };
      persist.release = function (nonce) {
        const cur = readLease(); if (cur && cur.nonce === nonce) ls.setItem(leaseKey, JSON.stringify({ nonce: '', until: 0, gen: Number(cur.gen) || 1 }));
      };
    }
    return persist;
  }
}

if (typeof module !== 'undefined' && module.exports) module.exports = { openBrowserStore: openBrowserStore };
else if (typeof window !== 'undefined') window.openBrowserStore = openBrowserStore;   // a plain <script> in the browser

});
__def("aggregates/timeclock.js", {"../core/registry":"core/registry.js","../core/hlc":"core/hlc.js","../core/incfold":"core/incfold.js"}, function (module, exports, require) {
'use strict';
/* ============================================================================
 * TIMECLOCK — the first aggregate. "Log it all and punch it all in, in order."
 * @timeclock @payroll @fact — every punch is a fact every station applies in the one order; a human punch outranks the autoclose guess, and what a person must see is shown, never guessed away
 * ----------------------------------------------------------------------------
 * No winner, no loser: every punch is a fact; every station applies every fact
 * in the one order; the shift you see is the honest result of ALL of them.
 * Kind decides authority, never survival: a human punch outranks the system's
 * autoclose guess regardless of order, and the guess stays on the record.
 *
 * A CLOSE NAMES ITS SHIFT (round 1). Resolution: by the in it names — whether
 * that in opened the shift or joined it as an extra tap (round 3: a double
 * clock-in across two devices used to orphan the real punch-out) → the
 * employee's OPEN shift → for a HUMAN punch, one guarded fallback → else an
 * ORPHAN, visible, attached on a later pass. Never guessed onto a shift a human
 * already closed.
 *
 * A CLOSE CANNOT PRECEDE THE IN IT CLOSES (round 2): every unnamed attachment
 * requires at >= shift.in. A close naming another employee's shift is an orphan.
 *
 * A SECOND IN IS AN EXTRA TAP BY EVIDENCE, NOT BY POSITION (round 4): before a
 * clock-in that arrives while a shift is open is demoted to an extra tap, every
 * close that fits the OPEN shift and happened before the new in — an orphan seen
 * earlier, or a close still AHEAD in the order (a day-ahead tablet, a rebooted
 * clock) — is applied first. Only if the shift is still open afterwards is the
 * new in a tap. A skewed clock can no longer swallow a whole day.
 *
 * TIES BETWEEN EQUAL-RANK CLOSES ARE BROKEN IN THE ONE ORDER (round 4): the
 * later stamp is the current value, never the push order of a repair pass.
 *
 * A TAP WINDOW (round 5): an in that happened within ten minutes BEFORE the open shift
 * began is a second tap on it (devices disagree by seconds), never an earlier shift;
 * the guarded punch fallback finds the latest AUTOCLOSED shift the punch fits by
 * evidence, never the last shift in the array.
 *
 * WHAT A PERSON MUST SEE (round 4): an orphaned human punch that stays an orphan
 * (kind 'orphan', once the day has moved on), two shifts of one person that
 * OVERLAP (invalid), a shift longer than 16 hours or a second clock-in 12+
 * hours after the first (kind 'suspect'), and an edit that leaves out-before-in
 * (invalid). detectConflicts() hands them all to the hub, which alerts once.
 *
 * DISPUTES ARE BETWEEN HUMANS AT THE CLOCK: two real punches with different
 * times. A manager's edit is authority, not a dispute — it resolves one.
 * ========================================================================== */
const registry = require('../core/registry');
const hlc = require('../core/hlc');
const incfold = require('../core/incfold');

const AGG = 'timeclock';
const HOUR = 3600000;
const LONG_SHIFT_MS = 16 * HOUR, LATE_TAP_MS = 12 * HOUR, ORPHAN_GRACE_MS = 6 * HOUR, TAP_WINDOW_MS = 10 * 60000;   // an in within ten minutes BEFORE the open shift began is a second tap on it (device skew), never an earlier shift
const vEmp = function (p) { return (p && typeof p.empId === 'string' && p.empId && p.empId !== '__proto__') ? null : 'empId must be a non-empty string'; };
const realTime = function (x) { return Number.isFinite(x) && x > 0 && x < 1e14; };
const vAt = function (p) { return realTime(p && p.at) ? null : 'at must be a real time'; };
const vShift = function (p) { return (p.shiftId == null || (typeof p.shiftId === 'string' && p.shiftId)) ? null : 'shiftId must be a string'; };
registry.registerType('clock.in',        { aggregate: AGG, tier: 'immediate', doc: 'A person starts a shift. payload {empId, at}. key = empId.',
  validate: function (p) { return vEmp(p) || vAt(p); } });
registry.registerType('clock.out',       { aggregate: AGG, tier: 'immediate', doc: 'A REAL punch out. payload {empId, at, shiftId?}. A human fact: outranks an autoclose regardless of order.',
  validate: function (p) { return vEmp(p) || vAt(p) || vShift(p); } });
registry.registerType('clock.autoclose', { aggregate: AGG, tier: 'immediate', doc: 'The system closed a shift it believed forgotten. payload {empId, at, reason?, shiftId?}. A guess: stays on record, never outranks a punch.',
  validate: function (p) { return vEmp(p) || vAt(p) || vShift(p); } });
registry.registerType('clock.edit',      { aggregate: AGG, tier: 'immediate', doc: 'A manager corrected a shift. payload {empId, shiftId, in?, out?}. Authority: resolves, never disputes. Must name its shift. Times are real times.',
  validate: function (p) { return vEmp(p) || ((typeof p.shiftId === 'string' && p.shiftId) ? null : 'an edit must name its shift') || ((p.in == null || realTime(p.in)) ? null : 'in must be a real time') || ((p.out == null || realTime(p.out)) ? null : 'out must be a real time'); } });

/* plan C4 (v1 delClock / addClock): a shift VOIDED stays on the record, marked, and never pays; a shift a manager ADDS
   for time the clock missed is its own closed shift. Both are payroll edits (a fresh PIN) and owe the employee a
   sign-off (the punches aggregate). */
registry.registerType('clock.void',      { aggregate: AGG, tier: 'immediate', doc: 'A manager voided a shift: it stays on the record, marked, and never pays. payload {empId, shiftId, reason?}.',
  validate: function (p) { return vEmp(p) || ((typeof p.shiftId === 'string' && p.shiftId) ? null : 'a void must name its shift'); } });
registry.registerType('clock.manual',    { aggregate: AGG, tier: 'immediate', doc: 'A manager added a shift the clock missed. payload {empId, in, out}. A closed shift of its own.',
  validate: function (p) { return vEmp(p) || ((realTime(p.in) && realTime(p.out) && p.out > p.in) ? null : 'in and out are real times, out after in'); } });

const RANK = { autoclose: 1, punch: 2, edit: 3 };
const CLOCK_TYPES = ['clock.in', 'clock.out', 'clock.autoclose', 'clock.edit', 'clock.void', 'clock.manual'], CLOCK_TYPE_SET = new Set(CLOCK_TYPES);

/* ----------------------------------------------------------------------------
 * 9/26 (core/incfold.js): the fold as init / step / view, kept up to date one fact at a time — fold() below is exactly these.
 * Everything the fold decides is ONE EMPLOYEE's business (a close naming another person's shift is an orphan), so the state
 * is kept per employee: their facts in the one order, their shifts and the working state the punches read, and their share
 * of the answer. Two decisions of the old loop read AHEAD in the order — a second in is an extra tap only if no close still
 * ahead fits the open shift before it (round 4), and an in whose stamp ran ahead rewinds the start unless some close NAMES it
 * (round 6). A fact stepped at the end has nothing ahead; so each such decision is written down (the demotions, the rewound
 * ins), and a later close that would have changed one replays that one employee from their own first fact — exactly what the
 * whole fold would have done. The old passes after the loop (voids, orphans tried again, overlaps, long shifts, late taps) are
 * each one employee's too: worked out after every fact for the shifts that changed and their neighbours by start, on copies
 * wherever the answer differs from the working shift, so the answer is ready and view() only lays it out. An employee's facts
 * are kept as plain columns (never the fact objects), so a checkpoint's copy of them is cheap.
 * ========================================================================== */
/* @timeclock @fold — is this fact a close: a punch out, the system's autoclose, a manager's edit */
function isClose(e) { return e.type === 'clock.edit' || e.type === 'clock.out' || e.type === 'clock.autoclose'; }
/* @timeclock @fold — when a close says its shift ended: an edit's out, anything else's at */
function closeTime(e) { const p = e.payload || {}; return e.type === 'clock.edit' ? p.out : p.at; }
/* @timeclock @fold — a shift's current close: the highest rank; among equals, the LATER stamp in the one order (never push order) */
function effective(s) { let best = null; s.closes.forEach(function (c) { if (!best || c.rank > best.rank || (c.rank === best.rank && hlc.compare(c.hlc, best.hlc) > 0)) best = c; }); return best; }
/* @timeclock @fold — two shifts by when they began (a stable sort keeps the order they were made among equals) */
function byStart(x, y) { return x.in - y.in; }
/* @timeclock @fold — two places in an employee's order by start: when the shift began, then the fact that made it */
function byKey(a, b) { return (a[0] - b[0]) || (a[1] - b[1]); }
/* @timeclock @fold — where a place sits (or would sit) in an employee's order by start (binary search) */
function keyAt(list, en) { let lo = 0, hi = list.length; while (lo < hi) { const m = (lo + hi) >> 1; if (byKey(list[m], en) < 0) lo = m + 1; else hi = m; } return lo; }
/* @timeclock @fold — where the shift made by fact number q sits in the shop's list (binary search: the list is in the order made) */
function placeOf(s, q) { const l = s.seqs; let lo = 0, hi = l.length; while (lo < hi) { const m = (lo + hi) >> 1; if (l[m] < q) lo = m + 1; else hi = m; } return lo; }
/* @timeclock @fold — which of two moments an open shift changed hands came later: the loop (by fact), the voids, the orphan passes (by pass, then fact) */
function byWhen(a, b) { return (a[0] - b[0]) || (a[1] - b[1]) || (a[2] - b[2]); }
/* @timeclock @fold — does a shift (open: never ended) run past the moment the next one began? */
function runsPast(prev, nextIn) { return (prev.out == null ? Infinity : prev.out) > nextIn; }
/* @timeclock @fold — a shift (by the fact that made it) in or out of one of the answer's lists: disputed, invalid, suspect */
function flag(set, q, on) { if (on) set.add(q); else set.delete(q); }

/* @timeclock @fold — one employee's share of the fold: their facts in the one order as plain columns (kept so they alone can be
   replayed), their shifts and what the punches read (the open shift and since which fact, each in's shift, the closes fitting
   nothing yet, the voids, the demotions and rewound starts a later close could overturn, the shifts the system closed), and their
   share of the answer (the order by start, the voids by shift, the copies the orphan passes made, the orphans still left) */
function empState(emp) {
  return { emp: emp, fx: { q: [], id: [], ty: [], at: [], sid: [], pin: [], pout: [], rs: [], st: [], ac: [], ht: [], hc: [], hi: [] }, closeAt: [],
    shifts: [], openBy: [], open: null, openAt: 0, byIn: new Map(), seqOf: new Map(), orphans: [], voids: [], ahead: [], inflated: [], ac: new Set(),
    order: [], okey: new Map(), voidOf: new Map(), ovIds: [], left: [] };
}
/* @timeclock @fold @fact — a fact kept in its employee's columns: what the fold reads of it and nothing else (its stamp as three numbers when it is the usual {t, c, id}); returns its place */
function keepFact(X, e, q) {
  const f = X.fx, p = e.payload || {}, h = e.hlc, plain = !!h && typeof h === 'object' && Object.keys(h).join() === 't,c,id';
  f.q.push(q); f.id.push(e.id); f.ty.push(CLOCK_TYPES.indexOf(e.type)); f.at.push(p.at); f.sid.push(p.shiftId); f.pin.push(p.in); f.pout.push(p.out); f.rs.push(p.reason);
  f.st.push(e.station); f.ac.push(e.actor); f.ht.push(plain ? h.t : null); f.hc.push(plain ? h.c : null); f.hi.push(plain ? h.id : h);
  return f.id.length - 1;
}
/* @timeclock @fold @fact — a kept fact as the fold's rules read it (for a replay and the closes waiting on a shift): id, type, payload, stamp, station, actor */
function factOf(X, k) {
  const f = X.fx;
  return { id: f.id[k], type: CLOCK_TYPES[f.ty[k]], key: X.emp, payload: { empId: X.emp, at: f.at[k], shiftId: f.sid[k], in: f.pin[k], out: f.pout[k], reason: f.rs[k] },
    hlc: f.ht[k] === null ? f.hi[k] : { t: f.ht[k], c: f.hc[k], id: f.hi[k] }, station: f.st[k], actor: f.ac[k] };
}
/* @timeclock @fold — an employee's shifts that are open now, in the order they were made (a shift never reopens, so the list is pruned as it is read): a clock-out costs that person's open shifts, never every shift ever (audit E58, batch `perf`) */
function openOf(X) { const l = X.openBy; let w = 0; for (let r = 0; r < l.length; r++) if (l[r].status === 'open') l[w++] = l[r]; l.length = w; return l; }
/* @timeclock @fold — a new shift, filed under its employee with the fact that made it, and (outside a replay) at the end of the shop's list */
function fileShift(s, X, sh, cx) {
  X.shifts.push(sh); if (sh.status === 'open') X.openBy.push(sh); X.byIn.set(sh.id, sh); X.seqOf.set(sh.id, cx.seq); cx.touched.add(sh.id);
  if (!cx.replay) { s.all.push(sh); s.seqs.push(cx.seq); }
}
/* @timeclock @fold — a shift after a close: its current close decides out and status; the open shift closed hands over to the latest still open; disputed and out-before-in marked */
function settle(X, sh, cx) {
  const eff = effective(sh);
  if (eff) { sh.out = eff.at; sh.closedBy = eff.kind; sh.status = 'closed'; if (X.open === sh) { X.open = null; const rest = openOf(X).filter(function (x) { return x.status === 'open'; }); if (rest.length) { rest.sort(byStart); X.open = rest[rest.length - 1]; X.openAt = cx.seq; } } }
  if (eff && eff.rank === RANK.autoclose) X.ac.add(sh); else X.ac.delete(sh);
  const punches = sh.closes.filter(function (c) { return c.rank === RANK.punch; });
  const edited = sh.closes.some(function (c) { return c.rank === RANK.edit; });
  sh.disputed = !edited && new Set(punches.map(function (c) { return c.at; })).size > 1;
  sh.invalid = (sh.out != null && sh.out < sh.in) ? 'out before in' : null;
  cx.touched.add(sh.id);
}
/* @timeclock @fold — the shifts the system closed that a punch at `at` fits (in <= at < the guess), in the order they were made: read from the employee's autoclosed shifts, never every shift (ov: the orphan passes' copies stand in for their shifts) */
function guessedFits(X, at, ov) {
  const ids = []; X.ac.forEach(function (r) { ids.push(r.id); });
  if (ov) ov.forEach(function (c, id) { if (!X.ac.has(X.byIn.get(id))) ids.push(id); });
  const out = [];
  ids.forEach(function (id) { const sh = (ov && ov.get(id)) || X.byIn.get(id); if (sh.status !== 'closed' || at < sh.in) return; const eff = effective(sh); if (eff && eff.rank === RANK.autoclose && at < eff.at) out.push(sh); });
  return out.sort(function (a, b) { return X.seqOf.get(a.id) - X.seqOf.get(b.id); });
}
/* @timeclock @fold — which shift a close belongs to: the in it names (the opener OR an extra tap), else the latest open shift that began before it (a close cannot precede the in it closes), else for a HUMAN punch the latest shift the system closed that it fits — by evidence, never by array position */
function target(X, p, rank, at) {
  if (p.shiftId) return X.byIn.get(p.shiftId) || null;
  if (!Number.isFinite(at)) return null;
  const cands = openOf(X).filter(function (s) { return s.status === 'open' && at >= s.in; });
  if (cands.length) { cands.sort(byStart); return cands[cands.length - 1]; }
  if (rank >= RANK.punch) { const fits = guessedFits(X, at, null); if (fits.length) { fits.sort(byStart); return fits[fits.length - 1]; } }
  return null;
}
/* @timeclock @fold — a close put on its shift (an edit on the shift it names, a punch or an autoclose on its target); false when it fits no shift yet */
function applyClose(X, e, cx) {
  const p = e.payload || {};
  if (e.type === 'clock.edit') {
    const sh = p.shiftId ? X.byIn.get(p.shiftId) : null;
    if (!sh) return false;
    sh.edits.push({ id: e.id, in: p.in, out: p.out, station: e.station, actor: e.actor });
    if (p.in != null) sh.in = p.in;
    if (p.out != null) sh.closes.push({ id: e.id, kind: 'edit', rank: RANK.edit, at: p.out, station: e.station, hlc: e.hlc });
    settle(X, sh, cx); if (cx.applied) cx.applied.add(e.id); return true;
  }
  const kind = (e.type === 'clock.out' ? 'punch' : 'autoclose');
  const sh = target(X, p, RANK[kind], p.at);
  if (!sh) return false;
  sh.closes.push({ id: e.id, kind: kind, rank: RANK[kind], at: p.at, station: e.station, hlc: e.hlc, reason: p.reason || null });
  settle(X, sh, cx); if (cx.applied) cx.applied.add(e.id); return true;
}
/* @timeclock @fold — does this close fit the employee's OPEN shift, and did it happen no later than `before`? */
function fitsOpen(X, e, before) {
  const p = e.payload || {}; if (!X.open) return false;
  const at = closeTime(e); if (!Number.isFinite(at) || at > before) return false;
  if (p.shiftId) return X.byIn.get(p.shiftId) === X.open;
  return e.type !== 'clock.edit' && at >= X.open.in;
}
/* @timeclock @fold — before a second in is demoted to an extra tap, the open shift gets every close already seen that fits it (an orphan)... */
function attachOrphansTo(X, before, cx) {
  if (!X.orphans.length || !X.open) return;
  const keep = [];
  X.orphans.forEach(function (k) { const e = factOf(X, k); if (X.open && fitsOpen(X, e, before) && applyClose(X, e, cx)) return; keep.push(k); });
  X.orphans = keep;
}
/* @timeclock @fold — ...and every close still AHEAD in the order that fits it (a tablet a day ahead, a counter whose clock reset): applied now, skipped later. Only a replay has closes ahead; a fact stepped at the end has none */
function closeAhead(X, before, from, cx) {
  const l = X.closeAt; let lo = 0, hi = l.length; while (lo < hi) { const m = (lo + hi) >> 1; if (l[m] < from) lo = m + 1; else hi = m; }
  for (let i = lo; i < l.length; i++) { if (!X.open) break; if (cx.applied && cx.applied.has(X.fx.id[l[i]])) continue; const e = factOf(X, l[i]); if (!isClose(e)) continue; if (fitsOpen(X, e, before)) applyClose(X, e, cx); }
}
/* @timeclock @fold — one of the employee's facts (e, kept at k) through the fold's rules (the old loop's body): an in opens a shift or, only by evidence, is an extra tap (a demotion and a rewound start written down, for a later close that may overturn them); a manual shift is added whole; a void waits for the answer; a close finds its shift or waits as an orphan */
function processAt(s, X, k, e, cx) {
  cx.seq = X.fx.q[k];
  if (cx.applied && cx.applied.has(e.id)) return;
  const p = e.payload || {}, emp = X.emp;
  if (e.type === 'clock.in') {
    const behind = !!(X.open && Number.isFinite(p.at) && p.at < X.open.in - TAP_WINDOW_MS);    /* its wall says it happened well BEFORE the open shift began */
    /* round 6: a stamp that ran AHEAD of its own wall by at least that gap is why it sorted after — a fleet-mate's fast clock (a
       DST-stuck tablet) inflated the recorder's clock. Had the stamp been honest this tap would have opened the shift, so it is a
       second tap that REWINDS the start, never an earlier shift — unless some out NAMES this in (then it is a shift of its own, however
       its stamp sorted); an honest stamp that far behind is an earlier shift arriving late */
    const inflated = behind && !s.named.has(e.id) && e.hlc && Number.isFinite(e.hlc.t) && (e.hlc.t - p.at) >= (X.open.in - p.at);
    if (inflated) { X.inflated.push(e.id); s.inflOwner.set(e.id, emp); }
    const earlier = behind && !inflated;
    if (X.open && !earlier) { attachOrphansTo(X, p.at, cx); closeAhead(X, p.at, k + 1, cx); if (X.open) X.ahead.push({ before: p.at, open: X.open, openIn: X.open.in }); }
    if (X.open && !earlier) { const o = X.open; o.extraIns.push({ id: e.id, at: p.at, station: e.station, rewound: inflated || undefined }); X.byIn.set(e.id, o); if (inflated) { o.inWas = o.in; o.in = p.at; } cx.touched.add(o.id); return; }
    const sh = { id: e.id, empId: emp, in: p.at, out: null, closedBy: null, status: 'open', closes: [], extraIns: [], edits: [], disputed: false, invalid: null, suspect: null };
    fileShift(s, X, sh, cx); if (!earlier) { X.open = sh; X.openAt = cx.seq; } return;
  }
  if (e.type === 'clock.manual') {                               /* a shift the clock missed, added whole */
    const sh = { id: e.id, empId: emp, in: p.in, out: p.out, closedBy: 'edit', status: 'closed', closes: [{ id: e.id, kind: 'edit', rank: RANK.edit, at: p.out, station: e.station, hlc: e.hlc }], extraIns: [], edits: [], disputed: false, invalid: null, suspect: null, manual: true };
    fileShift(s, X, sh, cx); return;
  }
  if (e.type === 'clock.void') { X.voids.push(k); return; }
  if (isClose(e) && !applyClose(X, e, cx)) X.orphans.push(k);
}
/* @timeclock @fold — would this close, had it been known then, have been applied AHEAD at an earlier in of this employee (it fits
   the shift that in was demoted onto and happened no later than it)? Then that in decided wrong. Read from the demotions written
   down, never the facts */
function reopens(X, e) {
  const p = e.payload || {}, at = closeTime(e);
  if (!Number.isFinite(at)) return false;
  for (let i = 0; i < X.ahead.length; i++) { const r = X.ahead[i];
    if (at > r.before) continue;
    if (p.shiftId) { if (X.byIn.get(p.shiftId) === r.open) return true; continue; }
    if (e.type !== 'clock.edit' && at >= r.openIn) return true;
  }
  return false;
}
/* @timeclock @fold — one employee folded again from their own first fact, because a later close overturned what an earlier in
   decided: their shifts rebuilt, put back in the shop's list where each was made, their answer worked out again. Costs that
   employee's history, and only when a demotion or a rewound start is overturned (a skewed clock, a manager's edit before a tap) */
function replayEmp(s, X) {
  X.seqOf.forEach(function (q) { s.disputed.delete(q); s.invalid.delete(q); s.suspect.delete(q); });
  X.left.forEach(function (k) { s.orph.delete(X.fx.q[k]); }); s.openOut.delete(X.emp);
  X.inflated.forEach(function (id) { s.inflOwner.delete(id); });
  const fresh = empState(X.emp); fresh.fx = X.fx; fresh.closeAt = X.closeAt; Object.assign(X, fresh);
  const cx = { seq: 0, applied: new Set(), touched: new Set(), replay: true };
  for (let k = 0; k < X.fx.id.length; k++) processAt(s, X, k, factOf(X, k), cx);
  /* the shop's list: everyone else's shifts as they stand, this employee's merged back in by the fact that made each */
  const mine = X.shifts, all = [], seqs = []; let j = 0;
  s.all.forEach(function (d, i) { if (d.empId === X.emp) return; const q = s.seqs[i]; while (j < mine.length && X.seqOf.get(mine[j].id) < q) { all.push(mine[j]); seqs.push(X.seqOf.get(mine[j++].id)); } all.push(d); seqs.push(q); });
  while (j < mine.length) { all.push(mine[j]); seqs.push(X.seqOf.get(mine[j++].id)); }
  s.all = all; s.seqs = seqs;
  answer(s, X, null, true);
}
/* @timeclock @fold — a copy of a working shift for the orphan passes (its closes and edits its own), one per shift per answer */
function ovOwn(ov, raw) { let c = ov.get(raw.id); if (!c) { c = Object.assign({}, raw); c.closes = raw.closes.slice(); c.edits = raw.edits.slice(); ov.set(raw.id, c); } return c; }
/* @timeclock @fold — the shift a close belongs to in the orphan passes, read through their copies (target's rules exactly) */
function ovTarget(X, ov, p, rank, at) {
  if (p.shiftId) { const r = X.byIn.get(p.shiftId); return r ? (ov.get(r.id) || r) : null; }
  if (!Number.isFinite(at)) return null;
  const cands = X.openBy.map(function (r) { return ov.get(r.id) || r; }).filter(function (sh) { return sh.status === 'open' && at >= sh.in; });
  if (cands.length) { cands.sort(byStart); return cands[cands.length - 1]; }
  if (rank >= RANK.punch) { const fits = guessedFits(X, at, ov); if (fits.length) { fits.sort(byStart); return fits[fits.length - 1]; } }
  return null;
}
/* @timeclock @fold — a copy settled as settle() settles a working shift; the open shift (o.open) hands over, and o.t says when */
function ovSettle(X, ov, sh, o, when) {
  const eff = effective(sh);
  if (eff) { sh.out = eff.at; sh.closedBy = eff.kind; sh.status = 'closed'; if (o.open === sh.id) { o.open = null; o.t = null; const rest = X.openBy.map(function (r) { return ov.get(r.id) || r; }).filter(function (x) { return x.status === 'open'; }); if (rest.length) { rest.sort(byStart); o.open = rest[rest.length - 1].id; o.t = when; } } }
  const punches = sh.closes.filter(function (c) { return c.rank === RANK.punch; });
  const edited = sh.closes.some(function (c) { return c.rank === RANK.edit; });
  sh.disputed = !edited && new Set(punches.map(function (c) { return c.at; })).size > 1;
  sh.invalid = (sh.out != null && sh.out < sh.in) ? 'out before in' : null;
}
/* @timeclock @fold — a close tried again in the orphan passes (an out that sorted before its in attaches now), on copies: an edit on the shift it names, a punch or an autoclose on its target */
function ovApply(X, ov, e, o, when) {
  const p = e.payload || {};
  if (e.type === 'clock.edit') {
    const r = p.shiftId ? X.byIn.get(p.shiftId) : null; if (!r) return false;
    const sh = ovOwn(ov, r);
    sh.edits.push({ id: e.id, in: p.in, out: p.out, station: e.station, actor: e.actor });
    if (p.in != null) sh.in = p.in;
    if (p.out != null) sh.closes.push({ id: e.id, kind: 'edit', rank: RANK.edit, at: p.out, station: e.station, hlc: e.hlc });
    ovSettle(X, ov, sh, o, when); return true;
  }
  const kind = (e.type === 'clock.out' ? 'punch' : 'autoclose');
  const tg = ovTarget(X, ov, p, RANK[kind], p.at); if (!tg) return false;
  const sh = ovOwn(ov, X.byIn.get(tg.id));
  sh.closes.push({ id: e.id, kind: kind, rank: RANK[kind], at: p.at, station: e.station, hlc: e.hlc, reason: p.reason || null });
  ovSettle(X, ov, sh, o, when); return true;
}
/* @timeclock @fold — the employee's share of the answer after a fact (the old passes after the loop, for one person): the voids
   applied (a voided open shift hands over to the latest one still open and not voided), the closes fitting nothing tried again
   on copies (up to three passes), then every shift that changed — and its neighbours in the order by start — worked out again:
   overlaps, long shifts and late taps marked, on a copy whenever the answer differs from the working shift. Costs what changed
   (`full`, after a replay: the employee's every shift) */
function answer(s, X, touched, full) {
  const f = X.fx, voidOf = new Map();                           /* the voids: the last one naming a shift is the one it keeps */
  X.voids.forEach(function (k) { const t = X.byIn.get(f.sid[k]); if (t) voidOf.set(t.id, k); });
  const redo = new Set(full ? X.seqOf.keys() : touched);
  if (!full) { voidOf.forEach(function (k, id) { if (X.voidOf.get(id) !== k) redo.add(id); }); X.voidOf.forEach(function (k, id) { if (!voidOf.has(id)) redo.add(id); }); }
  X.voidOf = voidOf;
  /* who is on the clock once the voids are applied: a voided open shift is nobody's open shift (v1 openClock skips it) */
  const o = { open: X.open ? X.open.id : null, t: X.open ? [0, 0, X.openAt] : null };
  if (X.open && voidOf.has(X.open.id)) {
    let cur = X.open; const gone = new Set();
    for (let i = 0; i < X.voids.length; i++) { const k = X.voids[i], T = X.byIn.get(f.sid[k]); if (!T) continue; gone.add(T);
      if (cur !== T) continue;
      const rest = X.openBy.filter(function (x) { return x.status === 'open' && !gone.has(x); });
      if (!rest.length) { cur = null; o.t = null; break; }
      rest.sort(byStart); cur = rest[rest.length - 1]; o.t = [1, 0, f.q[k]]; }
    o.open = cur ? cur.id : null;
  }
  /* the closes that fit nothing, tried again (an out that sorted before its in attaches now), on copies of the shifts they reach */
  const ov = new Map(); let left = X.orphans;
  if (X.orphans.length) {
    let rem = X.orphans.slice();
    for (let pass = 0; pass < 3 && rem.length; pass++) {
      const still = []; rem.forEach(function (k) { if (!ovApply(X, ov, factOf(X, k), o, [2, pass, f.q[k]])) still.push(k); });
      if (still.length === rem.length) { rem = still; break; } rem = still;
    }
    left = rem;
  }
  if (!full) X.ovIds.forEach(function (id) { redo.add(id); });
  ov.forEach(function (c, id) { redo.add(id); }); X.ovIds = Array.from(ov.keys());
  /* the order by start (a voided shift overlaps nothing): each shift that changed moved to its place; it and its neighbours, old and new, marked again */
  const base = function (id) { return ov.get(id) || X.byIn.get(id); }, marks = new Set(redo);
  if (full) {
    X.order = []; X.okey = new Map();
    X.seqOf.forEach(function (q, id) { if (voidOf.has(id)) return; const en = [base(id).in, q, id]; X.order.push(en); X.okey.set(id, en); });
    X.order.sort(byKey);
  } else {
    redo.forEach(function (id) {
      const was = X.okey.get(id), now = voidOf.has(id) ? null : base(id).in;
      if (was && now !== null && was[0] === now) return;
      if (was) { const j = keyAt(X.order, was); if (X.order[j - 1]) marks.add(X.order[j - 1][2]); if (X.order[j + 1]) marks.add(X.order[j + 1][2]); X.order.splice(j, 1); X.okey.delete(id); }
      if (now !== null) { const en = [now, X.seqOf.get(id), id]; X.order.splice(keyAt(X.order, en), 0, en); X.okey.set(id, en); }
    });
    redo.forEach(function (id) { const en = X.okey.get(id); if (!en) return; const j = keyAt(X.order, en); if (X.order[j - 1]) marks.add(X.order[j - 1][2]); if (X.order[j + 1]) marks.add(X.order[j + 1][2]); });
  }
  marks.forEach(function (id) {
    const raw = X.byIn.get(id), b = ov.get(id) || raw, vk = voidOf.get(id), q = X.seqOf.get(id);
    let invalid = b.invalid;
    if (vk === undefined) { const en = X.okey.get(id), j = keyAt(X.order, en), pv = X.order[j - 1], nx = X.order[j + 1];
      if (!invalid && pv && runsPast(base(pv[2]), en[0])) invalid = 'overlaps shift ' + pv[2];
      if (!invalid && nx && runsPast(b, nx[0])) invalid = 'overlaps shift ' + nx[2]; }
    let suspect = null;
    if (b.out != null && b.out - b.in > LONG_SHIFT_MS) suspect = 'longer than 16 hours';
    else if (b.extraIns.some(function (t) { return Number.isFinite(t.at) && t.at - b.in > LATE_TAP_MS; })) suspect = 'a second clock-in 12+ hours after the first';
    let d = raw;
    if (vk !== undefined || b !== raw || invalid !== raw.invalid || suspect !== null) {
      d = b !== raw ? b : Object.assign({}, raw); d.invalid = invalid; d.suspect = suspect;
      if (vk !== undefined) { d.voided = true; d.voidedBy = f.ac[vk] || null; d.voidReason = f.rs[vk] || null; }
    }
    s.all[placeOf(s, q)] = d;
    flag(s.disputed, q, d.disputed); flag(s.invalid, q, d.invalid); flag(s.suspect, q, d.suspect);
  });
  if (o.open !== null) s.openOut.set(X.emp, { q: X.seqOf.get(o.open), t: o.t }); else s.openOut.delete(X.emp);
  X.left.forEach(function (k) { s.orph.delete(f.q[k]); });
  left.forEach(function (k) { const edit = CLOCK_TYPES[f.ty[k]] === 'clock.edit'; s.orph.set(f.q[k], { id: f.id[k], type: CLOCK_TYPES[f.ty[k]], empId: X.emp, at: edit ? f.pout[k] : f.at[k], shiftId: f.sid[k] || null, station: f.st[k] }); });
  X.left = left.slice();
}
const INC = {
  /* @timeclock @fold — the clock facts: every punch, autoclose, edit, void and manual shift (the old fold read them from whatever it was given) */
  accepts: function (e) { return !!e && CLOCK_TYPE_SET.has(e.type); },
  /* @timeclock @fold — no punch yet: nobody's facts, no shift, nobody on the clock */
  init: function () { return { n: 0, named: new Set(), inflOwner: new Map(), emps: new Map(), all: [], seqs: [], openOut: new Map(), disputed: new Set(), invalid: new Set(), suspect: new Set(), orph: new Map() }; },
  /* @timeclock @fold — one fact: kept under its employee; a close that names a rewound in, or overturns a demotion, replays that
     employee (rare, and only them); anything else goes through the fold's rules once and the employee's answer is brought up to date */
  step: function (s, e) {
    const p = e.payload || {}, emp = p.empId || e.key, seq = s.n++;
    let X = s.emps.get(emp); if (!X) { X = empState(emp); s.emps.set(emp, X); }
    const k = keepFact(X, e, seq); if (isClose(e)) X.closeAt.push(k);
    const again = [];
    if (isClose(e) && typeof p.shiftId === 'string' && !s.named.has(p.shiftId)) { s.named.add(p.shiftId); if (s.inflOwner.has(p.shiftId)) again.push(s.inflOwner.get(p.shiftId)); }   /* an in some out NAMES is a shift of its own, whatever its stamp did */
    if (isClose(e) && again.indexOf(emp) < 0 && reopens(X, e)) again.push(emp);
    again.forEach(function (w) { replayEmp(s, s.emps.get(w)); });
    if (again.indexOf(emp) >= 0) return;
    const cx = { seq: seq, applied: null, touched: new Set(), replay: false };
    processAt(s, X, k, e, cx); answer(s, X, cx.touched, false);
  },
  /* @timeclock @fold — the answer as fold() has always given it: every shift in the order made, who is open (in the order the old
     fold's map gained them), the disputes, invalid and suspect shifts, the orphans — laid out from what the steps keep ready */
  view: function (s) {
    const open = Object.create(null);
    Array.from(s.openOut.entries()).sort(function (a, b) { return byWhen(a[1].t, b[1].t); }).forEach(function (en) { open[en[0]] = s.all[placeOf(s, en[1].q)]; });
    const inOrder = function (qs) { return Array.from(qs).sort(function (a, b) { return a - b; }).map(function (q) { return s.all[placeOf(s, q)]; }); };
    const disputes = inOrder(s.disputed).map(function (sh) { return { shiftId: sh.id, empId: sh.empId, closes: sh.closes.filter(function (c) { return c.rank === RANK.punch; }), effective: { id: effective(sh).id, at: sh.out } }; });
    const invalid = inOrder(s.invalid).map(function (sh) { return { kind: 'invalid', shiftId: sh.id, empId: sh.empId, why: sh.invalid, in: sh.in, out: sh.out, closes: [] }; });
    const suspect = inOrder(s.suspect).map(function (sh) { return { kind: 'suspect', shiftId: sh.id, empId: sh.empId, why: sh.suspect, in: sh.in, out: sh.out, closes: [] }; });
    const orphans = Array.from(s.orph.keys()).sort(function (a, b) { return a - b; }).map(function (q) { return Object.assign({}, s.orph.get(q)); });
    return { shifts: s.all, open: open, disputes: disputes, invalid: invalid, suspect: suspect, orphans: orphans };
  }
};
/* @timeclock @fold — the shifts from every punch in the one order: a close finds the shift it names or the open one it fits, a second in is an extra tap only by evidence, a close that fits nothing stays an orphan; voids kept and never paid; overlaps, 16-hour shifts and late taps marked */
function fold(events) { return incfold.foldVia(INC, events, AGG); }
/* @timeclock — the id of the shift an employee has open now, or null when they are off the clock */
function openShiftId(projection, emp) { const s = projection && projection.open && projection.open[emp]; return s ? s.id : null; }
/* what the hub alerts on: disputes, invalid shifts, suspect shifts, and HUMAN orphans the day has moved past (a punch that
   arrived before its in attaches within minutes; one still orphaned six shop-hours later is a person's lost time) */
/* @timeclock @fold — what the hub alerts on: two human punches that disagree, an invalid or suspect shift, a human punch still fitting no shift six hours on */
function detectConflicts(events) {
  const sorted = events.slice().sort(hlc.compareEvents);
  const f = fold(sorted);
  let newest = 0; sorted.forEach(function (e) { const at = e.payload && e.payload.at; if (Number.isFinite(at) && at > newest) newest = at; });
  const orphans = f.orphans.filter(function (o) { return o.type !== 'clock.autoclose' && Number.isFinite(o.at) && newest - o.at >= ORPHAN_GRACE_MS; })
    .map(function (o) { return { kind: 'orphan', eventId: o.id, shiftId: o.shiftId, empId: o.empId, type: o.type, at: o.at, station: o.station, why: 'a human punch that fits no shift', closes: [] }; });
  return f.disputes.concat(f.invalid, f.suspect, orphans);
}

registry.registerAggregate(AGG, { fold: fold, inc: INC, detectConflicts: detectConflicts,
  doc: 'Punches are facts; a shift is an IN and every close ever applied to it. A close names its in (opener or extra tap) and can never precede the in it closes; a second in is an extra tap only if nothing closes the open shift before it (closes ahead in the order are applied first); an unplaceable close is an orphan. A human punch outranks an autoclose regardless of order; equal ranks are broken by the one order. Two human punches with different times = disputed (both kept, later current, hub alerts); a manager edit resolves; out-before-in and overlapping shifts are invalid; 16h+ shifts and 12h-late taps are suspect; a human orphan the day moved past is alerted.' });

module.exports = { fold: fold, detectConflicts: detectConflicts, openShiftId: openShiftId, AGG: AGG, RANK: RANK, LONG_SHIFT_MS: LONG_SHIFT_MS, LATE_TAP_MS: LATE_TAP_MS, ORPHAN_GRACE_MS: ORPHAN_GRACE_MS, TAP_WINDOW_MS: TAP_WINDOW_MS };

});
__def("core/abilities.js", {}, function (module, exports, require) {
'use strict';
/* ============================================================================
 * THE SHOP'S ABILITIES — what a person here can be allowed to do, and what each role may do before the owner changes it
 * @permission @employee @owner — the shop's own list (v1 verbatim); core/staff.js is the same for every business, and this file is the part a business writes for itself
 * ----------------------------------------------------------------------------
 * Owner, 11/1: "we are trying to build a modular system so nobody has to spend the money to do this work again... copy,
 * paste, customize". core/staff.js (roles, PINs, can()) is shared as it is. This file is the shop's, a cleaner's: the
 * twelve abilities v1's Admin lists, in v1's order, and v1's built-in role defaults (v1 ABILITIES / ROLE_PERMS, verbatim).
 * Another business keeps core/staff.js as it is and writes its own copy of this file (start from this one). "unrack" is a
 * cleaner's ability; a restaurant leaves it out. staff.abilitiesFrom(list) checks a list the way the start does.
 *
 *   · ABILITIES: [key, the words on the Admin screen], in the order the screen lists them.
 *   · ROLE_PERMS: what owner, manager and staff may do until the shop changes a role (Admin → Roles). The owner may do
 *     everything whatever this says (staff.can); the owner's list here only fills that role's boxes on the screen.
 *   · At most 40 abilities, each with its words. A wrong key, a missing word, a role that is not owner, manager or staff,
 *     or a default naming no ability stops the start and names this file (staff.abilitiesFrom).
 *   · ONCE ANY FACT NAMES AN ABILITY, ITS KEY STAYS. Change its words freely, but never delete or rename the key: every
 *     tablet set up later checks the shop's old facts by this list, and would refuse a person's old change that names a key
 *     no longer here (with whatever else that change said, such as making them inactive). A new shop with no history may
 *     write the list any way it likes.
 *   · A module that brings its own action adds it when it loads: staff.addAbility(key, words, roles), called from the
 *     module's aggregates/ file, which the hub loads too. An ability only the tablet knows makes the hub refuse every role
 *     list and every person's change that names it.
 * ========================================================================== */
module.exports = {
  ABILITIES: [['admin', 'Open the Admin area'], ['drawer', 'Cash drawer in/out'], ['void', 'Void orders'], ['unrack', 'Un-rack ready orders (send back to production)'], ['adjust', 'Discounts & manual adjustments'], ['reports', 'View reports'], ['customers', 'Edit customers'], ['payroll', 'Edit PAYROLL (time entries & pay rates) — official record, logged'], ['employees', 'Manage employees'], ['prices', 'Edit prices & upcharges'], ['settings', 'Change settings & tax'], ['reset', 'Reset data']],
  ROLE_PERMS: { owner: ['admin', 'drawer', 'void', 'unrack', 'adjust', 'reports', 'customers', 'employees', 'payroll', 'prices', 'settings', 'reset'], manager: ['admin', 'drawer', 'void', 'unrack', 'adjust', 'reports', 'customers'], staff: ['unrack'] }
};

});
__def("core/staff.js", {"./abilities":"core/abilities.js","crypto":"station/crypto-shim.js"}, function (module, exports, require) {
'use strict';
/* ============================================================================
 * STAFF — who works here, what each may do, and the PIN that proves it is them (2026-09-23, plan A3).
 * @employee @permission @owner — roles and abilities, PINs as salted hashes, a tablet's wrong-PIN lock, and the list of facts the hub PIN-checks; the same for every business
 * ----------------------------------------------------------------------------
 * Carried over rule for rule from v1's own code (rolePerms, can, isOwner, empByPin, saveEmployee) and proven against
 * verbatim copies of those functions in the suite (§38).
 *
 *   · The owner can do everything. Anyone else: their own per-person override first, then the shop's role list, then
 *     the built-in defaults.
 *   · A PIN is at least 4 digits, unique, and a disabled employee's PIN never works. v1 trims what was typed.
 *   · WHICH abilities there are is the business's own: core/abilities.js (the shop's is v1's twelve). A module adds
 *     its own with addAbility(). Since 11/1 nothing of the shop's prices is in this file: discounts and voids are
 *     core/discountvoid.js. That is what lets Custom POS share this file as it is (V2-MODULAR-IMPORT.md Part 3b, step 2).
 *
 * PINS ARE KEPT ONLY AS SALTED HASHES (PBKDF2-SHA256, a random salt per person). ⚠️ Be honest about what that buys:
 * a 4-digit PIN has 10,000 possibilities, so no hash makes it secret from someone holding the whole log. What it
 * does is keep PINs out of sight — nobody reading the log, a backup, a feed report or a screen sees one — and v1
 * kept them in plain text on every station. The real guard is where the log lives: the shop's tablets and the hub.
 * ========================================================================== */
const ROLES = ['owner', 'manager', 'staff'];

/* ---------------- the abilities: the business's own list (core/abilities.js), then what its modules add ----------------
   ABILITIES ([key, words], in the Admin screen's order), ABILITY_KEYS and ROLE_PERMS (each role's defaults) are made
   once from the business's file and only ever added to, never replaced, so every reader that took them at load sees the
   same lists. abilitiesFrom() is the one way a list becomes them (a builder can check a business's file with it too). */
/* review 11/1: at most 40 — the staff fold refuses a role list longer than that (aggregates/staff.js), and the owner's defaults hold
   every ability, so a 41st would leave Admin → Roles unable to save; it stops the start instead */
const MAX_ABILITIES = 40;
/* @permission — one ability onto a set of lists: a short key (a letter, then letters, digits or _) and its words, never twice; `where` names who asked */
function addOne(into, key, label, where) {
  key = String(key == null ? '' : key);
  if (!/^[a-z][A-Za-z0-9_]{0,31}$/.test(key)) throw new Error(where + ': "' + key + '" is not an ability key (a letter, then letters, digits or _)');
  if (key in {}) throw new Error(where + ': "' + key + '" is a name every object already has (can() would read it off any person)');
  if (into.ABILITY_KEYS.indexOf(key) >= 0) throw new Error(where + ': "' + key + '" is already an ability');
  if (typeof label !== 'string' || !label.trim()) throw new Error(where + ': "' + key + '" needs its words (what the Admin screen shows)');
  if (into.ABILITY_KEYS.length >= MAX_ABILITIES) throw new Error(where + ': "' + key + '" would be ability ' + (MAX_ABILITIES + 1) + ' — at most ' + MAX_ABILITIES + ' (a role\'s list holds no more)');
  into.ABILITIES.push([key, label]); into.ABILITY_KEYS.push(key);
}
/* @permission @employee — a business's list as this file holds it: its abilities in its order, then each role's defaults in its order; anything the file gets wrong (a key, its words, a role, a default naming no ability) stops the start, naming the file */
function abilitiesFrom(shop) {
  const at = 'core/abilities.js', out = { ABILITIES: [], ABILITY_KEYS: [], ROLE_PERMS: { owner: [], manager: [], staff: [] } }, rp = (shop && shop.ROLE_PERMS) || {};
  ((shop && shop.ABILITIES) || []).forEach(function (a, i) { if (!Array.isArray(a)) throw new Error(at + ': ABILITIES[' + i + '] is [key, words]'); addOne(out, a[0], a[1], at); });
  Object.keys(rp).forEach(function (r) { if (ROLES.indexOf(r) < 0) throw new Error(at + ': ROLE_PERMS names "' + r + '", which is not a role (' + ROLES.join(', ') + ')'); });
  ROLES.forEach(function (r) {
    (rp[r] || []).forEach(function (k) {
      if (out.ABILITY_KEYS.indexOf(k) < 0) throw new Error(at + ': ROLE_PERMS.' + r + ' names "' + k + '", which is not in its ABILITIES');
      if (out.ROLE_PERMS[r].indexOf(k) < 0) out.ROLE_PERMS[r].push(k);
    });
  });
  return out;
}
const START = abilitiesFrom(require('./abilities'));
const ABILITIES = START.ABILITIES, ABILITY_KEYS = START.ABILITY_KEYS, ROLE_PERMS = START.ROLE_PERMS;
/* @permission @employee @owner — a module's new ability: its key, the words the Admin screen shows, and the roles that have it until the shop changes them (the owner always).
   ⚠️ Call it where the HUB loads it too — from the module's aggregates/ file, which the hub and the tablets both load — never only from
   a core/ kit the tablet alone has. The hub judges every person's change and every role list by its own list (review 11/1): an
   ability only the tablet knows makes the hub refuse the whole save that names it — a role list, or a person's change (even making
   them inactive) — while the tablet that recorded it has already applied it. */
function addAbility(key, label, roles) {
  (roles || []).forEach(function (r) { if (ROLES.indexOf(r) < 0) throw new Error('staff.addAbility: "' + r + '" is not a role (' + ROLES.join(', ') + ')'); });
  addOne(START, key, label, 'staff.addAbility');
  ['owner'].concat(roles || []).forEach(function (r) { if (ROLE_PERMS[r].indexOf(key) < 0) ROLE_PERMS[r].push(key); });
}

/* v1 rolePerms: the shop's own list for the role, else the built-in default */
/* @permission @employee — v1 rolePerms: what a role may do — the shop's own list for it, else v1's built-in default */
function rolePerms(roles, role) { return (roles && roles[role]) || ROLE_PERMS[role] || []; }
/* v1 can(): the owner always; a per-person override when there is one; else the role */
/* @permission @employee @owner — v1 can(): may this person do this — the owner always, then their own override, then their role */
function can(emp, a, roles) {
  const r = emp ? emp.role : null; if (!r) return false; if (r === 'owner') return true;
  if (emp.perms && emp.perms[a] !== undefined) return !!emp.perms[a];
  return rolePerms(roles, r).indexOf(a) >= 0;
}
/* @permission @owner — v1 isOwner: is this person an owner (the role, never a per-person override) */
function isOwner(emp) { return !!emp && emp.role === 'owner'; }

/* ---------------- PINs ---------------- */
const PIN_ITER = 20000;   /* the cost of every PIN hash made before 9/25 — a record without `iter` was made at this */
/* E65 (9/25): a PIN hash made today costs PIN_ITER_NOW rounds (5× the old — about 25 ms on a desktop, a few times that on a
   tablet; a PIN box checks the candidates at once, so a wrong PIN still answers in well under a second). The record carries
   its own cost ({salt, hash, iter}), so an old hash keeps working and is made again at today's cost on its owner's next good
   PIN (station/app.js pinRehash). ⚠️ Said plainly: no cost makes a 4-digit PIN secret from someone holding the log (10,000
   tries); it multiplies their work by 5. Two more digits multiply it by 100 — an owner decision. */
const PIN_ITER_NOW = 100000;
const PIN_ITER_MAX = 1000000;   /* the most a record may ask for (aggregates/staff.js): a PIN box must never be made to hang */
/* @employee @permission — E65: the rounds a PIN record was made with (an old record, or a nonsense one, is the old cost) */
function pinIter(rec) { const n = rec && rec.iter; return (Number.isInteger(n) && n >= PIN_ITER && n <= PIN_ITER_MAX) ? n : PIN_ITER; }
/* @employee @permission — E65: a PIN hash made at less than today's cost, to be made again on that person's next good PIN */
function pinStale(rec) { return !!(rec && rec.salt && rec.hash) && pinIter(rec) < PIN_ITER_NOW; }
/* @employee @input — a PIN as typed, trimmed (v1 empByPin / saveEmployee trim what was TYPED, never what is stored) */
function pinText(pin) { return String(pin == null ? '' : pin).trim(); }           // v1 empByPin / saveEmployee trim what was TYPED
/* @employee @permission — v1 saveEmployee's rule: a PIN is at least 4 digits, digits only */
function pinValid(pin) { return /^[0-9]{4,}$/.test(pin); }                          // v1 saveEmployee: at least 4 digits
/* @employee — hex text to bytes (a PIN record's salt, for the browser's PBKDF2) */
function hexBytes(h) { const b = new Uint8Array(h.length / 2); for (let i = 0; i < b.length; i++) b[i] = parseInt(h.substr(i * 2, 2), 16); return b; }
/* @employee — bytes to hex text (a PIN hash as the record keeps it) */
function toHex(buf) { return Array.prototype.map.call(new Uint8Array(buf), function (x) { return ('0' + x.toString(16)).slice(-2); }).join(''); }
/* the hash of a PIN exactly as it is held (v1 compares the stored PIN exactly; only what is typed is trimmed).
   In Node (the feed, the tests) — the same bytes as the browser's: */
/* @employee @permission — a PIN's hash at the record's own cost (E65: iter; none is the old 20,000); costs one PBKDF2 */
function pinHashSync(pin, salt, iter) { return require('crypto').pbkdf2Sync(String(pin == null ? '' : pin), Buffer.from(salt, 'hex'), iter || PIN_ITER, 32, 'sha256').toString('hex'); }   /* iter: the record's own cost (pinIter) — none is the old cost */
/* anywhere: the browser's own PBKDF2 (a station), else Node's */
/* @employee @permission — the same hash on a tablet (the browser's own PBKDF2), at the record's own cost (E65) */
async function pinHash(pin, salt, iter) {
  const sub = typeof globalThis !== 'undefined' && globalThis.crypto && globalThis.crypto.subtle;
  if (!sub) return pinHashSync(pin, salt, iter);
  const key = await sub.importKey('raw', new TextEncoder().encode(String(pin == null ? '' : pin)), 'PBKDF2', false, ['deriveBits']);
  return toHex(await sub.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: hexBytes(salt), iterations: iter || PIN_ITER }, key, 256));
}
/* @employee @permission — 16 random bytes for a new PIN record's salt (the browser's crypto, else Node's) */
function newSalt() {
  const b = new Uint8Array(16);
  if (typeof globalThis !== 'undefined' && globalThis.crypto && globalThis.crypto.getRandomValues) globalThis.crypto.getRandomValues(b);
  else { const r = require('crypto').randomBytes(16); for (let i = 0; i < 16; i++) b[i] = r[i]; }
  return toHex(b);
}
/* what the log keeps for a PIN: never the PIN */
/* @employee @permission — a new PIN record {salt, hash, iter} at today's cost (E65); never the PIN */
async function pinRecord(pin, salt) { salt = salt || newSalt(); return { salt: salt, hash: await pinHash(pin, salt, PIN_ITER_NOW), iter: PIN_ITER_NOW }; }   /* E65: today's cost, written down */
/* @employee @permission — the same record, in Node (the feed, the proofs) */
function pinRecordSync(pin, salt) { salt = salt || newSalt(); return { salt: salt, hash: pinHashSync(pin, salt, PIN_ITER_NOW), iter: PIN_ITER_NOW }; }
/* @employee @permission — does this person have a PIN on file (a salted hash, never the PIN) */
function hasPin(e) { return !!(e && e.pin && e.pin.salt && e.pin.hash); }
/* v1 empByPin: the FIRST active employee (optionally owners only) whose PIN it is; nothing for an empty PIN */
/* @employee @permission — who a typed PIN may belong to: active people with a PIN on file (owners only when asked), in v1's order */
function pinCandidates(employees, opts) { opts = opts || {}; return (employees || []).filter(function (x) { return hasPin(x) && x.active !== false && (!opts.ownerOnly || x.role === 'owner'); }); }
/* @employee @permission — v1 empByPin: who this PIN is, each record checked at its own cost, all at once (E65); v1's first match wins */
async function empByPin(pin, employees, opts) {
  pin = pinText(pin); if (!pin) return null;
  const list = pinCandidates(employees, opts);
  const got = await Promise.all(list.map(function (x) { return pinHash(pin, x.pin.salt, pinIter(x.pin)); }));   /* E65: all at once (the browser's crypto runs them side by side); still v1's FIRST match in list order */
  for (let i = 0; i < list.length; i++) if (got[i] === list[i].pin.hash) return list[i];
  return null;
}
/* @employee @permission — the same, in Node (the proofs against v1's own empByPin) */
function empByPinSync(pin, employees, opts, hashFn) {
  pin = pinText(pin); if (!pin) return null; hashFn = hashFn || pinHashSync;
  const list = pinCandidates(employees, opts);
  for (let i = 0; i < list.length; i++) if (hashFn(pin, list[i].pin.salt, pinIter(list[i].pin)) === list[i].pin.hash) return list[i];
  return null;
}
/* is this PIN already someone else's? (v1 saveEmployee refuses it — against EVERY employee, active or not) */
/* @employee @permission — v1 saveEmployee's taken-PIN check, each record at its own cost (E65) */
async function pinTaken(pin, employees, exceptId) {
  pin = pinText(pin);
  const list = (employees || []).filter(function (x) { return hasPin(x) && x.id !== exceptId; });
  for (let i = 0; i < list.length; i++) if (await pinHash(pin, list[i].pin.salt, pinIter(list[i].pin)) === list[i].pin.hash) return list[i];
  return null;
}

/* ---------------- E65 (9/25 — v2's own guard; v1 has no limit): a tablet's wrong-PIN lock ----------------
   FREE wrong PINs on one tablet, then each further wrong PIN locks every PIN box on that tablet for LOCK_MS, doubling each
   time up to MAX_MS. The count starts again only after QUIET_MS with no wrong PIN — a good PIN does NOT clear it, or anyone
   who knows their own PIN could reset the lock between guesses at the owner's. A mistyped PIN or two is never locked.
   QUIET_MS is 15 minutes (skeptic, 9/25; the builder had an hour): with an hour, a shared counter tablet whose staff mistype a
   PIN every half hour or so — an ordinary day — kept one count all day and locked the time clock and every approval for 15
   minutes at a time by afternoon. With 15 minutes only a burst locks; a guesser at the counter still waits weeks for 10,000. */
const PIN_GUARD = { FREE: 5, LOCK_MS: 30000, MAX_MS: 15 * 60000, QUIET_MS: 15 * 60000 };
/* @permission @employee — E65: how long this tablet's PIN boxes stay locked, in ms (0: open). g = the tablet's guard, or nothing. */
function pinLockLeft(g, now) { return (g && g.until > now) ? g.until - now : 0; }
/* @permission @employee — E65: a wrong PIN on this tablet: the guard after it ({n, at, until, lockMs}). Costs nothing to keep. */
function pinGuardWrong(g, now) {
  const n = ((g && g.at && now - g.at < PIN_GUARD.QUIET_MS) ? (Number(g.n) || 0) : 0) + 1;
  const lockMs = n >= PIN_GUARD.FREE ? Math.min(PIN_GUARD.MAX_MS, PIN_GUARD.LOCK_MS * Math.pow(2, n - PIN_GUARD.FREE)) : 0;
  return { n: n, at: now, until: lockMs ? now + lockMs : 0, lockMs: lockMs };
}

/* v1 saveEmployee's refusals, in v1's order. change = {name, role, pin?, active}; pinTakenBy = who already has the
   PIN (from pinTaken), or null. Returns the words v1 shows, or null when the save may go ahead. */
/* @employee @permission @owner — v1 saveEmployee's refusals: a name, a 4-digit PIN nobody else has, and never the shop's last active owner removed */
function employeeSaveCheck(employees, id, change, pinTakenBy) {
  const name = String(change.name || '').trim();
  if (!name) return 'Enter a name';
  if (change.pin != null && !pinValid(pinText(change.pin))) return 'PIN must be at least 4 digits';
  if (change.pin != null && pinTakenBy) return 'That PIN is already used by someone else';
  const e = id ? (employees || []).filter(function (x) { return x.id === id; })[0] : null;
  if (e && e.role === 'owner') {                                    // never leave the shop with no active owner
    const others = (employees || []).filter(function (x) { return x.id !== id && x.role === 'owner' && x.active !== false; }).length;
    if (others === 0 && (change.role !== 'owner' || change.active === false)) return 'You can\'t remove the last active owner';
  }
  return null;
}

/* @permission @hub @employee — THE PIN DOUBLE CHECK (E30; owner 9/25: "YES! PIN double check"): the privileged facts the HUB admits
   only with a PIN it checked itself (hub/pingrant.js) — people, roles, store credit given or taken, payroll edits. A clock-in or
   clock-out is not among them: nobody is kept off the clock by the internet. The station sends its grants for these; the hub asks.
   Owner 9/26 ("build the refund rule"): money given back and debt taken off are privileged too — the owner's approval of a refund,
   a refund, a payment voided or reversed, a correction to what a customer owes (hub/authority.js refundRule / adjustRule). Every
   tablet door that writes one is behind a PIN — the PIN box at the button (refunds, approvals, reversals) or the PIN that opened
   the screen (the owner's write-off and account credit). A grant that has ended holds the change on the tablet until that
   person's next PIN sends it, as for the other privileged facts. */
const PIN_CHECKED = ['employee.set', 'staff.roles', 'credit.issued', 'credit.removed', 'clock.manual', 'clock.edit', 'clock.void',
  'order.refundDecided', 'payment.refunded', 'payment.voided', 'charge.adjusted'];
PIN_CHECKED.push('card.removed');   /* owner 10/18 ("Server checks PIN on risky actions"): a saved card taken off file — the 🗑 asks a manager's PIN, and the hub erases the token of every card a fact says was removed */

module.exports = {
  PIN_CHECKED: PIN_CHECKED,
  ROLE_PERMS: ROLE_PERMS, ABILITIES: ABILITIES, ABILITY_KEYS: ABILITY_KEYS, ROLES: ROLES, addAbility: addAbility, abilitiesFrom: abilitiesFrom, PIN_ITER: PIN_ITER,
  PIN_ITER_NOW: PIN_ITER_NOW, PIN_ITER_MAX: PIN_ITER_MAX, pinIter: pinIter, pinStale: pinStale, PIN_GUARD: PIN_GUARD, pinLockLeft: pinLockLeft, pinGuardWrong: pinGuardWrong,   /* E65 */
  rolePerms: rolePerms, can: can, isOwner: isOwner,
  pinText: pinText, pinValid: pinValid, pinHash: pinHash, pinHashSync: pinHashSync, newSalt: newSalt, pinRecord: pinRecord, pinRecordSync: pinRecordSync, hasPin: hasPin,
  empByPin: empByPin, empByPinSync: empByPinSync, pinTaken: pinTaken, employeeSaveCheck: employeeSaveCheck
};

});
__def("aggregates/staff.js", {"../core/registry":"core/registry.js","../core/hlc":"core/hlc.js","../core/incfold":"core/incfold.js","../core/staff":"core/staff.js"}, function (module, exports, require) {
'use strict';
/* ============================================================================
 * STAFF — the employees and what each role may do (2026-09-23 night, plan A3; v1 DB.employees, settings.rolePerms)
 * @employee @permission @owner @fact — who works here and what each role may do: field by field, latest wins, never deleted; a PIN only as a salted hash, and never a shop without an owner
 * ----------------------------------------------------------------------------
 * The rules are core/staff.js; these facts record who works here.
 *   · employee.set changes the fields it names; latest wins per field. Never deleted: a person who leaves is made
 *     inactive, and their PIN stops working (v1: "Disabling an employee blocks their PIN (kept for history)").
 *   · A PIN IS NEVER IN A FACT. Only {salt, hash} is accepted, and a field this validator does not know is refused —
 *     so a plain PIN cannot ride in under another name.
 *   · The shop's role lists (v1 Admin → Role permissions) are one fact, set whole.
 *   · The shop is never left with no active owner: the station refuses it (v1 saveEmployee); the fold says so if
 *     facts from two stations ever cross that line.
 * ========================================================================== */
const registry = require('../core/registry');
const hlc = require('../core/hlc');
const incfold = require('../core/incfold');
const rules = require('../core/staff');

const AGG = 'staff';
const FIELDS = ['name', 'role', 'active', 'perms', 'pin', 'rate', 'dept', 'vacAnnual', 'vacUsed', 'lang', 'printSlip'];   /* printSlip: v1 setPrintSlip — a time slip at every clock-out */   // pay fields (plan C4): v1 saveEmployee's rate, department, annual vacation, the vacation used per pay period, and the language of their screens
/* @employee @fact — a staff fact's required text: non-empty and no longer than max (64 unless told) */
function isStr(v, max) { return typeof v === 'string' && v.length > 0 && v.length <= (max || 64); }
/* @employee @permission @fact — a person's own permissions: only abilities the rules know, each true or false */
function permsErr(p) {
  if (!p || typeof p !== 'object' || Array.isArray(p)) return 'perms is {ability: true|false}';
  const ks = Object.keys(p); for (let i = 0; i < ks.length; i++) { if (rules.ABILITY_KEYS.indexOf(ks[i]) < 0) return 'perms: "' + ks[i] + '" is not an ability'; if (typeof p[ks[i]] !== 'boolean') return 'perms: ' + ks[i] + ' is true or false'; }
  return null;
}
/* @employee @permission @fact — a PIN as the log keeps it: {salt, hash}, or (E65, 9/25 — widened, never tightened) {salt, hash,
   iter} with the rounds it was made at, from the old cost up to PIN_ITER_MAX so no record can make a PIN box hang; never a PIN */
function pinErr(p) {
  if (p === null) return null;                                      // no PIN: this person cannot sign in
  const ks = (p && typeof p === 'object') ? Object.keys(p).sort().join(',') : '';
  if (ks !== 'hash,salt' && ks !== 'hash,iter,salt') return 'pin is {salt, hash} — never the PIN itself';
  if (!/^[0-9a-f]{32}$/.test(p.salt) || !/^[0-9a-f]{64}$/.test(p.hash)) return 'pin is a 16-byte salt and a SHA-256 hash, in hex';
  if ('iter' in p && !(Number.isInteger(p.iter) && p.iter >= rules.PIN_ITER && p.iter <= rules.PIN_ITER_MAX)) return 'pin.iter is the rounds it was hashed with, ' + rules.PIN_ITER + ' to ' + rules.PIN_ITER_MAX;
  return null;
}
registry.registerType('employee.set', { creates: ['empId'], aggregate: AGG, tier: 'immediate',
  doc: 'An employee added or changed, field by field. payload {empId, set: {name?, role? (owner|manager|staff), active?, perms? {ability: bool}, pin? {salt, hash, iter?} | null}, src?}. A PIN is only ever a salted hash.',
  validate: function (p) {
    if (!isStr(p.empId, 64) || p.empId === '__proto__') return 'empId names the employee';
    if (p.src != null && !isStr(p.src, 120)) return 'src is a short note';
    const s = p.set; if (!s || typeof s !== 'object' || Array.isArray(s)) return 'set lists what changed';
    const ks = Object.keys(s); if (!ks.length) return 'set lists what changed';
    for (let i = 0; i < ks.length; i++) if (FIELDS.indexOf(ks[i]) < 0) return 'set: "' + ks[i] + '" is not an employee field';
    if (s.name != null && !isStr(String(s.name).trim() ? s.name : '', 80)) return 'name is 1..80 characters';
    if (s.role != null && rules.ROLES.indexOf(s.role) < 0) return 'role is owner, manager or staff';
    if (s.active != null && typeof s.active !== 'boolean') return 'active is true or false';
    if (s.perms != null) { const b = permsErr(s.perms); if (b) return b; }
    if (s.rate != null && !(typeof s.rate === 'number' && s.rate >= 0 && s.rate <= 1000)) return 'rate is dollars an hour';
    if (s.dept != null && !(typeof s.dept === 'string' && s.dept.length <= 60)) return 'dept is a short name';
    if (s.vacAnnual != null && !(typeof s.vacAnnual === 'number' && s.vacAnnual >= 0 && s.vacAnnual <= 2000)) return 'vacAnnual is hours a year';
    if (s.vacUsed != null && !(typeof s.vacUsed === 'object' && !Array.isArray(s.vacUsed) && Object.keys(s.vacUsed).length <= 400 && Object.keys(s.vacUsed).every(function (k) { return /^[0-9]{10,15}$/.test(k) && typeof s.vacUsed[k] === 'number' && s.vacUsed[k] >= 0 && s.vacUsed[k] <= 1000; }))) return 'vacUsed is {pay period start (ms): hours}';
    if (s.lang != null && !(typeof s.lang === 'string' && s.lang.length <= 5)) return 'lang is a language code';
    if (s.printSlip != null && typeof s.printSlip !== 'boolean') return 'printSlip is true or false';
    if ('pin' in s) { const b = pinErr(s.pin); if (b) return b; }
    return null; } });
registry.registerType('staff.roles', { aggregate: AGG, tier: 'immediate',
  doc: 'What each role may do (the shop\'s own lists, over v1\'s defaults), set whole. payload {rolePerms: {owner?, manager?, staff?: [ability]}, src?}.',
  validate: function (p) {
    const r = p.rolePerms; if (!r || typeof r !== 'object' || Array.isArray(r)) return 'rolePerms is {role: [abilities]}';
    const ks = Object.keys(r);
    for (let i = 0; i < ks.length; i++) {
      if (rules.ROLES.indexOf(ks[i]) < 0) return 'rolePerms: "' + ks[i] + '" is not a role';
      if (!Array.isArray(r[ks[i]]) || r[ks[i]].length > 40 || !r[ks[i]].every(function (a) { return rules.ABILITY_KEYS.indexOf(a) >= 0; })) return 'rolePerms.' + ks[i] + ' lists abilities';
    }
    if (p.src != null && !isStr(p.src, 120)) return 'src is a short note';
    return null; } });

/* v1 empByPin 8/22 + denyMsg: a wrong PIN at a gate, and a person refused something their role does not allow, are
   written down — "a silent refusal reads as a broken button, and an unlogged one hides somebody quietly testing where
   the edges are". Never the PIN that was typed. */
registry.registerType('staff.refused', { aggregate: AGG, tier: 'immediate',
  doc: 'A gate said no: a PIN nobody has (or a disabled one), or a person without the right. payload {gate, why: pin|not-allowed, empId?}. Never the PIN typed.',
  validate: function (p) { if (!isStr(p.gate, 120)) return 'gate names what was asked for'; if (p.why !== 'pin' && p.why !== 'not-allowed') return 'why is pin or not-allowed'; if (p.empId != null && !isStr(p.empId, 64)) return 'empId names the person'; return null; } });
/* @audit @permission @log — v1 doLogin (8ce455c, owner 9/10: "activity log is supposed to catch every time someone clicks a tile
   and has a successful pin entry"): a tile opened with a good PIN is written down — the person is the fact's actor, the tablet
   its station, the screen here. Never the PIN typed. Nothing folds it but the Activity log (batch counterhome, S36). */
registry.registerType('staff.signedIn', { aggregate: AGG, tier: 'immediate',
  doc: 'Someone opened a screen with a good PIN (v1 logEvent \'Signed in\'). payload {gate: the screen, in its own words}; the actor is the person. Never the PIN typed.',
  validate: function (p) { if (!isStr(p.gate, 120)) return 'gate names the screen that was opened'; if (Object.keys(p).some(function (k) { return k !== 'gate'; })) return 'a sign-in carries only the screen'; return null; } });

/* 9/26 (core/incfold.js): the fold as init / step / view, kept up to date one fact at a time — fold() below is exactly these */
const INC = {
  /* @employee @permission @fold — nobody on staff, the default role lists, no refusal yet */
  init: function () { return { byId: new Map(), employees: [], rolePerms: null, refused: [] }; },
  /* @employee @permission @fold — one fact: the role lists set whole, a refusal written down, or a person changed field by field (a cleared PIN stays cleared) */
  step: function (s, e) {
    const p = e.payload || {};
    if (e.type === 'staff.roles') { s.rolePerms = JSON.parse(JSON.stringify(p.rolePerms)); return; }
    if (e.type === 'staff.refused') { s.refused.push({ gate: p.gate, why: p.why, empId: p.empId || null, station: e.station, at: e.at }); return; }
    if (e.type !== 'employee.set') return;
    let x = s.byId.get(p.empId);
    if (!x) { x = { id: p.empId, name: '', role: 'staff', active: true, perms: {}, pin: null, rate: 0, dept: '', vacAnnual: 0, vacUsed: {}, lang: '', since: e.at }; s.byId.set(p.empId, x); s.employees.push(x); }
    FIELDS.forEach(function (k) { if (k in p.set) x[k] = p.set[k] == null ? (k === 'pin' ? null : x[k]) : JSON.parse(JSON.stringify(p.set[k])); });
    x.changedAt = e.at;
  },
  /* @employee @permission @owner @fold — the people in the order first seen, the role lists, the refusals; a note (fresh each time) when no active owner is left */
  view: function (s) {
    const employees = s.employees, notes = [];
    if (employees.length && !employees.some(function (x) { return x.role === 'owner' && x.active !== false; })) notes.push({ kind: 'no-owner', why: 'no active owner is left — nobody can approve a discount or a void' });
    return { employees: employees, byId: s.byId, rolePerms: s.rolePerms, refused: s.refused, notes: notes };
  }
};
/* @employee @permission @fold — each person field by field (latest wins; a cleared PIN stays cleared), the role lists, the refused PINs; a note when no active owner is left */
function fold(events) { return incfold.foldVia(INC, events, AGG); }
/* @employee — one person by id from the staff fold, or null */
function emp(staff, id) { return (staff && staff.byId && staff.byId.get(id)) || null; }
registry.registerAggregate(AGG, { fold: fold, inc: INC, detectConflicts: function (events) { return fold(events).notes; }, describe: function (d) { return { kind: 'staff-note', note: String((d && d.why) || 'a staff question') }; },
  doc: 'Who works here and what each may do. Field by field, latest wins; never deleted (made inactive); a PIN only as a salted hash.' });
module.exports = { fold: fold, emp: emp, AGG: AGG, FIELDS: FIELDS };

});
__def("station/record.js", {}, function (module, exports, require) {
'use strict';
/* ============================================================================
 * RECORD — the tablet's one door for a fact, and the one way a kit's save reaches it (moved out of station/app.js 2026-10-31)
 * @fact @employee @station — a fact recorded under the person who authorised it, a refusal said and never thrown; a kit's facts recorded, then sent
 * ----------------------------------------------------------------------------
 * Moved here from station/app.js (owner 10/31: "the point is for all the systems to grow stronger together... and to be sure that
 * what i am sharing with people is functional because i use it daily"). The page's rec() is put() with the page's own default
 * actor (the person working the screen) and its toast; every kit's onSave is one saver(), where the page used to write the same
 * three steps out by hand at each kit (record each fact under the right person, then sync), 24 times.
 * ========================================================================== */

/* @fact @employee — records one fact on station S under actor (none: no actor on it); a refused fact goes to refused(why) and the answer is false, never a throw */
function put(S, type, key, payload, actor, refused) {
  try { S.record(type, key, payload, actor ? { actor: actor } : undefined); return true; } catch (e) { if (refused) refused(e.message); return false; }
}
/* @fact @sync @employee — a kit's onSave: who() names the person once per save, every fact goes through rec under them, then sync().
   o (each optional, each one kit's own need, named so the differences show): before(facts) runs first; stop: after a refused fact the
   rest are not recorded; then(facts) runs after the facts and before the sync; after(facts) runs after the sync; ok: the answer is
   whether every fact was recorded (a kit that raises an alarm on false asks for it) — without ok there is no answer, as before */
function saver(rec, sync, who, o) {
  o = o || {};
  return function (facts) {
    var w = who(), ok = true;
    if (o.before) o.before(facts);
    facts.forEach(function (f) { if (o.stop && !ok) return; if (!rec(f.type, f.key, f.payload, w)) ok = false; });
    if (o.then) o.then(facts);
    sync();
    if (o.after) o.after(facts);
    if (o.ok) return ok;
  };
}

module.exports = { put: put, saver: saver };

});
__def("station/views.js", {}, function (module, exports, require) {
'use strict';
/* ============================================================================
 * VIEWS — what every screen reads, folded from the tablet's facts once per new fact (moved out of station/app.js 2026-10-31)
 * @fold @render @station — each aggregate's answer over the whole log, worked out once per new fact through its follower; the screen check; fresh top-level lists
 * ----------------------------------------------------------------------------
 * Moved here from station/app.js word for word (owner 10/31: "the point is for all the systems to grow stronger together...
 * and to be sure that what i am sharing with people is functional because i use it daily"): the code Custom POS shares is the
 * code this shop runs. What the shop folds stays on its page (views(), viewsAll()); how a fold is kept, reused and checked is here.
 * The page hands in what this file used to reach for:
 *   V2           the modules by name (V2[name].fold, V2[name].AGG), with V2.incfold and V2.registry when followers are wanted
 *   log()        the tablet's log now (null before a station is open)
 *   follow       the followers' setting (the tablet keeps two checkpoints: station/app.js TABLET_FOLLOW)
 *   checkOn()    whether the screen check is on (the page's localStorage custompos-freeze-views = 1)
 *   say(why)     where a difference the screen check found is said (the console and the tablet's error log)
 *   setTimeout / clearTimeout   the page's timers, or null: without them the idle moment's work never starts by itself
 * ========================================================================== */

/* @fold @render — the folds a page reads, kept one fact at a time and reused until a fact arrives, with the screen check, over what the page hands in */
function make(o) {
  var V2 = o.V2, logOf = o.log, follow = o.follow, checkOn = o.checkOn || function () { return false; }, say = o.say || function () {},
    later = o.setTimeout || null, cancel = o.clearTimeout || null;
  var logFoldMemo = {}, follows = {}, checkMisses = [], checkNew = [];
  /* @render @fold — a page's views made once per new fact: build() runs when the log grew (or was replaced) since the last answer;
     each call gets a fresh wrapper and fresh top-level lists, so a caller that sorts or reassigns them changes nobody else's; what is
     inside is READ-ONLY (a followed fold's records are its live state) */
  function memo(build) {
    var m = { log: null, n: -1, v: null };
    return function () {
      var lg = logOf(), n = lg ? lg.size() : 0;
      if (!m.v || m.log !== lg || m.n !== n) { m = { log: lg, n: n, v: build() }; checkSay(); }
      return freshTop(m.v);
    };
  }
  /* @render @fold — one aggregate's answer over this tablet's whole log (V2[name]: 'till', 'inbox', 'textLog', 'punches' …), for
     every screen, tick and kit that used to fold all history itself: its follower's answer, or a whole fold once per new fact */
  function logFold(name) { var o = foldOnce(name); checkSay(); return freshTop(o); }
  /* @fold — one aggregate's answer over the whole log, worked out once per new fact: through its follower when the aggregate
     carries inc, else folded whole; the screen check looks it over (memoCheck) */
  function foldOnce(name) {
    var lg = logOf(), n = lg ? lg.size() : 0, k = logFoldMemo[name];
    if (!k || k.log !== lg || k.n !== n) { var fw = followerOf(name); k = logFoldMemo[name] = { log: lg, n: n, out: memoCheck(name, fw ? fw(lg) : V2[name].fold(lg ? lg.all() : []), !!fw) }; if (fw) followMaintSoon(); }
    return k.out;
  }
  var followMaintTimer = null;
  /* @fold @render — the idle moment's work for the followers (core/incfold.js maintain; lazy: no copy of a fold's state ever lands
     on a tap): 2.5 s after the last new fact, one aggregate's checkpoint per quiet moment, until none is due */
  function followMaintSoon() {
    if (typeof later !== 'function') return;
    if (followMaintTimer && cancel) cancel(followMaintTimer);
    followMaintTimer = later(function () { followMaintTimer = null;
      var ks = Object.keys(follows); for (var i = 0; i < ks.length; i++) { var f = follows[ks[i]]; if (f && typeof f.maintain === 'function' && f.maintain()) { followMaintSoon(); return; } } }, 2500);
    if (followMaintTimer && followMaintTimer.unref) followMaintTimer.unref();
  }
  /* @fold — the follower of one aggregate's fold over this tablet's log (core/incfold.js follower: fed only what the log gained
     since the last call; a replaced log, or a shorter one, starts it over), made on first use; null while the aggregate has no inc */
  function followerOf(name) {
    if (!Object.prototype.hasOwnProperty.call(follows, name)) { var m = V2[name], def = (m && m.AGG && V2.incfold && V2.registry) ? V2.registry.aggregate(m.AGG) : null; follows[name] = (def && def.inc) ? V2.incfold.follower(def.inc, m.AGG, follow) : null; }
    return follows[name];
  }
  /* @render @proof — the SCREEN CHECK (localStorage custompos-freeze-views = 1, for whoever clicks through every screen before the
     switch). A whole fold's answer is deep-frozen, so a screen that writes into what the next screen reads throws and names
     itself in the error log. A FOLLOWED fold's answer is its live state and is never frozen (the next step would throw):
     it is compared with a fresh whole fold instead — a difference is named, aggregate and all, in the error log (checkSay) —
     and the screens are handed that whole fold, deep-frozen. Off, nothing is frozen, nothing compared, nothing costs. */
  function memoCheck(name, o, followed) {
    if (!checkOn()) return o;
    if (followed) { var lg = logOf(), full = V2[name].fold(lg ? lg.all() : []), a = canonOf(o), b = canonOf(full);
      if (a !== b) { var at = 0; while (at < a.length && a[at] === b[at]) at++;
        var why = 'screen check: the ' + name + ' fold (' + V2[name].AGG + '), followed one fact at a time, differs from its whole fold at ' + (lg ? lg.size() : 0) + ' facts — char ' + at + ': followed …' + a.slice(Math.max(0, at - 40), at + 60) + ' | whole …' + b.slice(Math.max(0, at - 40), at + 60);
        checkMisses.push({ name: name, agg: V2[name].AGG, n: lg ? lg.size() : 0, why: why }); if (checkMisses.length > 50) checkMisses.shift(); checkNew.push(why); }
      o = full; }
    (function freeze(x) { if (!x || typeof x !== 'object' || Object.isFrozen(x)) return; Object.freeze(x); var t = Object.prototype.toString.call(x); if (t === '[object Map]' || t === '[object Set]') x.forEach(function (y) { freeze(y); }); else Object.keys(x).forEach(function (k) { freeze(x[k]); }); })(o);
    return o;
  }
  /* @proof @error — the screen check's differences said once each, after the memo holds the answer (the page's say: the console,
     and the tablet's error log, 🩹 Errors) */
  function checkSay() { if (!checkNew.length) return; var said = checkNew.splice(0); said.forEach(function (w) { say(w); }); }
  return { memo: memo, logFold: logFold, foldOnce: foldOnce, followerOf: followerOf, checkSay: checkSay, follows: follows, misses: checkMisses };
}
/* @proof — a fold's answer as one text for the screen check: Maps and Sets with their order (from any window), undefined kept apart */
function canonOf(v) { return JSON.stringify(v, function (k, x) { var t = Object.prototype.toString.call(x); if (t === '[object Map]') return { __map: Array.from(x.entries()) }; if (t === '[object Set]') return { __set: Array.from(x.values()) }; return x === undefined ? '__undefined' : x; }); }
/* @render — a fold's answer with its own top-level lists (what is inside them is shared, and read-only) */
function freshTop(o) { if (Array.isArray(o)) return o.slice(); if (!o || typeof o !== 'object') return o; var c = {}; Object.keys(o).forEach(function (k) { c[k] = Array.isArray(o[k]) ? o[k].slice() : o[k]; }); return c; }

module.exports = { make: make, canonOf: canonOf, freshTop: freshTop };

});
__def("modules/define.js", {"../core/registry":"core/registry.js"}, function (module, exports, require) {
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
     pin        true: the hub must also hold a PIN check it made itself for that person on that tablet (a grant), not just the tablet's word.
                The grants ride with a send as the origin shop's do: bundle.grants = { personId: grant }, and opts.grantCheck is
                facts/hub/pingrant.js verify(grant, station, person, at) → null | why (imported, the shop's own file)
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
    /* the PIN the hub checked: the send's grant for this person, judged as the origin shop's hub judges it (hub/authority.js) — signed by
       this hub, for this tablet and this person, for a fact done before it ended, and sent within its grace */
    if (r.pin && grantCheck) {
      const gs = (bundle && bundle.grants && typeof bundle.grants === 'object' && !Array.isArray(bundle.grants)) ? bundle.grants : {}, id = String(who.id);
      const bad = grantCheck(Object.prototype.hasOwnProperty.call(gs, id) ? gs[id] : null, e.station, id, e.at);
      if (bad) return 'a ' + e.type + ' needs ' + who.name + '\'s PIN checked by the hub (' + bad + ') — ' + who.name + ' enters it again on this tablet';
    }
    return null;
  }
  return { rules: rules, pinChecked: pinChecked, judge: judge, config: config, modules: mods.map(function (m) { return m.name; }) };
}

module.exports = { defineModule: defineModule, assemble: assemble, parseAuthority: parseAuthority };

});
__def("modules/staff.js", {"./define":"modules/define.js","../core/staff":"core/staff.js","../aggregates/staff":"aggregates/staff.js"}, function (module, exports, require) {
/* @facts @module @permission — THE STAFF MODULE: who works here, what each may do and the PIN that proves it is them — the origin shop's
   own staff files (imported, unedited) given this repo's module shape, so the hub judges every person-naming fact by ONE list of people.
   This repo's own file, and a thin one (docs/V2-MODULAR-IMPORT.md Part 3b, rollout step 4). What is the shop's, imported:
     facts/aggregates/staff.js   the facts and their fold: employee.set (field by field, latest wins, never deleted; a PIN only as a salted
                                 hash), staff.roles (what each role may do, set whole), staff.refused, staff.signedIn
     facts/core/staff.js         the rules: roles, can() (the owner always, then the person's own override, then the role's list), PINs
                                 (PBKDF2-SHA256, the same bytes in a browser and in Node), PIN_CHECKED (the facts the hub PIN-checks)
     facts/core/abilities.js     THE BUSINESS'S OWN FILE (yours): the abilities a person may be given and each role's defaults — the first
                                 import brings the origin shop's list as a working start; edit it, no later import writes over it
     facts/hub/pingrant.js       the PIN the hub checks: a signed 30-minute pass for one person on one tablet
   What this file adds is the shop's hub rules in this repo's module shape (the shop keeps them in its own hub/authority.js):
     employee.set   that person (their own PIN, time slip and language only), an owner, or someone holding "employees" — and only an
                    owner makes or changes an owner; the shop always keeps an active owner
     staff.roles    an owner, or someone holding "employees"
     both           with a PIN the hub checked (core/staff.js PIN_CHECKED), as at the shop
     staff.refused, staff.signedIn   any enrolled tablet (the shop's hub admits them from any tablet: they record a gate, never a change)
   A brand-new shop with nobody on staff admits its first fact only if it is its owner (define.js asks firstOk). */
'use strict';
const { defineModule } = require('./define');
const S = require('../core/staff');
const AGG = require('../aggregates/staff');   /* registers employee.set, staff.roles, staff.refused, staff.signedIn */

const SELF_FIELDS = ['pin', 'printSlip', 'lang'];   /* the shop's own list (hub/authority.js): what a person may change about themselves */

/* @facts @permission @employee @owner — employee.set, after self-or:employees passed: owners, a person's own few fields, and never the last active owner */
function employeeRule(p, who, staff) {
  const s = (p.set && typeof p.set === 'object') ? p.set : {}, ks = Object.keys(s), target = staff.byId.get(p.empId) || null;
  if ((s.role === 'owner' || (target && target.role === 'owner')) && !S.isOwner(who)) return 'only an owner makes or changes an owner';
  if (String(p.empId) === String(who.id) && !staff.can(who, 'employees') && ks.some(function (k) { return SELF_FIELDS.indexOf(k) < 0; })) return who.name + ' may change only their own PIN, time slip and language';
  /* the shop always keeps an active owner: its tablets refuse it (core/staff.js employeeSaveCheck) and its fold says so after the fact; here
     the hub refuses it too (stage-2 review: without this nobody could ever make an owner again). A null role or active leaves the field
     as it was (the shop's fold), so only a real other role, or active false, counts */
  if (target && target.role === 'owner' && target.active !== false && ((s.role != null && s.role !== 'owner') || s.active === false)) {
    const others = staff.employees.filter(function (x) { return x.id !== target.id && x.role === 'owner' && x.active !== false; }).length;
    if (!others) return 'the shop must keep an active owner — make someone else an owner first';
  }
  return null;
}
/* @facts @employee — what a brand-new shop's first fact must be: its owner, active (define.js asks before anyone is on staff) */
function firstOk(e) { const s = e && e.type === 'employee.set' && e.payload && e.payload.set; return !!(s && s.role === 'owner' && s.active !== false); }

/* the hub reads the list often (every person-naming fact): the staff facts already read are kept, and only new ones are added */
const memo = { seen: 0, facts: [], first: null, view: null, n: -1 };
/* @facts @fold @permission — the staff list as the hub judges by it: the shop's fold of its facts so far, with this send's own laid on top */
function staffNow(master, staged) {
  if (master.length < memo.seen || (master.length && memo.first !== master[0])) { memo.seen = 0; memo.facts = []; memo.n = -1; memo.first = master[0] || null; }
  for (; memo.seen < master.length; memo.seen++) { const m = master[memo.seen]; if (m.aggregate === AGG.AGG) memo.facts.push(m); }
  const mine = (staged || []).filter(function (x) { return x.aggregate === AGG.AGG; });
  let view;
  if (mine.length) view = AGG.fold(memo.facts.concat(mine));
  else { if (memo.n !== memo.facts.length) { memo.view = AGG.fold(memo.facts); memo.n = memo.facts.length; } view = memo.view; }
  return { byId: view.byId, employees: view.employees, rolePerms: view.rolePerms, isOwner: S.isOwner, can: function (who, right) { return S.can(who, right, view.rolePerms); } };
}

/* the shop's list of facts its hub PIN-checks decides which of these need a pass, so the two can never disagree */
const pinned = function (t) { return S.PIN_CHECKED.indexOf(t) >= 0; };
const STAFF = defineModule({
  name: 'staff', version: 2, layer: 'core',
  facts: {
    'employee.set': { adopt: true, authority: 'self-or:employees', self: 'empId', pin: pinned('employee.set'), rule: employeeRule },
    'staff.roles': { adopt: true, authority: 'needs:employees', pin: pinned('staff.roles') },
    'staff.refused': { adopt: true, authority: 'any' },
    'staff.signedIn': { adopt: true, authority: 'any' }
  },
  views: { list: function (facts) { return AGG.fold(facts); } },
  provides: { staff: staffNow, firstOk: firstOk }
});

/* @facts @permission — may this person do this, by a staff fold's role lists (the owner always, then their own override, then the role) */
function can(who, right, view) { return S.can(who, right, view && view.rolePerms); }

module.exports = { STAFF: STAFF, fold: AGG.fold, can: can, isOwner: S.isOwner, rules: S, employeeRule: employeeRule,
  pinRecord: S.pinRecord, pinRecordSync: S.pinRecordSync, empByPin: S.empByPin, pinValid: S.pinValid, pinText: S.pinText, ABILITIES: S.ABILITIES };

});
__def("modules/timeclock.js", {"./define":"modules/define.js","../aggregates/timeclock":"aggregates/timeclock.js"}, function (module, exports, require) {
/* @facts @module @timeclock — THE TIME CLOCK MODULE: clock-ins and clock-outs every station shares, breaks, and the corrections a
   manager makes, as facts (docs/V2-MODULAR-IMPORT.md, Part 3's worked example). This repo's own file.
   What comes from the engine: the clock.* types and their fold (facts/aggregates/timeclock.js, imported) — which clock-out closes which
   shift, orphans kept visible, a real punch always outranking an automatic close, both sides of a genuine dispute kept. This module
   ADOPTS those types and gives each its authority:
     clock.in, clock.out            the person themselves, an owner, or someone with "payroll" — and NO PIN check by the hub: nobody is
                                    ever kept off the clock because the internet is down
     clock.edit, clock.void, clock.manual   "payroll" (or an owner) AND a PIN the hub checked (facts/modules/pingrant.js)
     clock.autoclose                the hub only
   What Custom POS adds: unpaid breaks (break.start / break.end, the same authority as a punch), the wage carried on clock.in as
   DB.punches carries it today (a shift with none written reads null, so the person's wage applies), and a COMPAT PROJECTION: punches(facts, staff) rebuilds DB.punches' exact shape from the facts, so the
   existing tip-pool, labor-cost and report code reads shared punches without being rewritten first. */
'use strict';
const { defineModule } = require('./define');
const TC = require('../aggregates/timeclock');

const isMs = function (v) { return typeof v === 'number' && Number.isFinite(v) && v > 0; };
/* @facts @timeclock — why a break fact is malformed, or null */
function vBreak(p) { if (typeof p.empId !== 'string' || !p.empId) return 'empId names the person'; if (typeof p.shiftId !== 'string' || !p.shiftId) return 'a break names its shift'; return isMs(p.at) ? null : 'at is a real time'; }
/* @facts @fold @timeclock — breaks by shift: { byShift: { shiftId: [{start, end|null}] } }; an end closes that shift's open break */
function foldBreaks(evs) {
  /* stage-2 review: a plain {} let a fact naming shift "constructor" break every device's fold for good (facts are forever); a map with no
     prototype cannot be poisoned. The facts go in the order they were made (their hybrid clock), not by the time a tablet wrote in them,
     and an end written a moment before its start (a skewed tablet) closes the break at its start instead of leaving it open forever. */
  const byShift = Object.create(null), at = function (e) { return e.hlc ? [e.hlc.t || 0, e.hlc.c || 0] : [e.payload.at, 0]; };
  evs.slice().sort(function (a, b) { const x = at(a), y = at(b); return (x[0] - y[0]) || (x[1] - y[1]) || String(a.id).localeCompare(String(b.id)); }).forEach(function (e) {
    const p = e.payload, list = byShift[p.shiftId] = byShift[p.shiftId] || [];
    if (e.type === 'break.start') { if (!list.some(function (b) { return b.end == null; })) list.push({ start: p.at, end: null }); }
    else if (e.type === 'break.end') { const open = list.filter(function (b) { return b.end == null; })[0]; if (open) open.end = Math.max(p.at, open.start); }
  });
  return { byShift: byShift };
}
/* a shift id a break may name: an event id (station/…), as every clock-in's is — judged on NEW facts only (law 1) */
const SHIFT_ID = /^[A-Za-z0-9_.:-]{1,64}\/[A-Za-z0-9_.:-]{1,128}$/;
/* @facts @timeclock — a new break must name a real-looking shift id */
function admitBreak(p) { return SHIFT_ID.test(String(p.shiftId)) ? null : 'a break names its shift by the clock-in\'s id'; }
/* @facts @timeclock @payroll — a wage on a clock-in is a pay figure: only an owner or someone with "payroll" writes one (stage-2 review: a
   clerk could set their own rate on every shift; the app now sends none, and the person's wage from setup applies) */
function wageRule(p, who, staff) { return p.wage != null && !staff.isOwner(who) && !staff.can(who, 'payroll') ? 'only an owner or someone with "payroll" writes a wage' : null; }

/* @facts @timeclock — local HH:MM, as the clock station shows the wall clock */
function hm(ms) { return new Date(ms).toTimeString().slice(0, 5); }
/* @facts @timeclock @payroll — DB.punches' exact shape from the facts: [{staffId, name, in, inTs, out, outTs, breaks:[{start,startTs,end,endTs}], wage}].
   staff: { byId } (the staff module's list) for names; a voided shift never pays, so it is left out, as DB.punches never held one.
   ids (optional, rollout step 5): a Map this fills with each punch → its shift's id (the clock-in fact's), for the clock kit's adapter
   (pos.html clockKitFor), which names the shift a clock-out or a break belongs to; the punch itself keeps DB.punches' exact shape. */
function punches(facts, staff, ids) {
  const clock = facts.filter(function (e) { return /^clock\./.test(e.type); }), brk = foldBreaks(facts.filter(function (e) { return /^break\./.test(e.type); }));
  const view = TC.fold(clock), src = new Map(); clock.forEach(function (e) { if (e.type === 'clock.in' || e.type === 'clock.manual') src.set(e.id, e); });
  const byId = (staff && staff.byId) || new Map();
  return (view.shifts || []).filter(function (s) { return s.status !== 'void' && !s.voided; }).map(function (s) {
    /* the wage written at punch time; none written is null (not 0), so pos.html falls back to the person's wage as DB.punches always did — a 0 would cost the shift nothing (10/31: the history fixture caught a manual shift costed at $0) */
    const who = byId.get(String(s.empId)), from = src.get(s.id), wage = from && typeof from.payload.wage === 'number' ? from.payload.wage : null;
    const out = s.out != null ? s.out : null;
    /* a break ends no later than its shift: a closed shift with a break never ended would count as on break until NOW, and pos.html's
       paid time (clocked minus breaks, floored at 0) would fall to nothing (stage-2 review) */
    const cap = function (t) { return out != null ? Math.min(t, out) : t; };
    const row = { staffId: s.empId, name: who ? who.name : String(s.empId), in: hm(s.in), inTs: s.in, out: out != null ? hm(out) : null, outTs: out,
      breaks: (brk.byShift[s.id] || []).map(function (b) { const st = cap(b.start), en = b.end != null ? cap(b.end) : (out != null ? out : null); return { start: hm(st), startTs: st, end: en != null ? hm(en) : null, endTs: en }; }), wage: wage };
    if (ids) ids.set(row, s.id);
    return row;
  }).sort(function (a, b) { return a.inTs - b.inTs; });
}
/* @facts @timeclock — the open shift of a person (its id is the clock.in fact's), or null */
function openShift(facts, empId) { return TC.openShiftId(TC.fold(facts.filter(function (e) { return /^clock\./.test(e.type); })), empId); }

const PUNCH = { authority: 'self-or:payroll', self: 'empId' };
const FIX = { authority: 'needs:payroll', self: 'empId', pin: true };
const TIMECLOCK = defineModule({
  name: 'timeclock', version: 1, layer: 'operations', requires: ['staff'],
  aggregate: { name: 'breaks', fold: foldBreaks, doc: 'unpaid breaks inside a shift (Custom POS\'s; the engine\'s clock has none)' },
  facts: {
    'clock.in': Object.assign({ adopt: true, rule: wageRule }, PUNCH), 'clock.out': Object.assign({ adopt: true }, PUNCH),
    'clock.edit': Object.assign({ adopt: true }, FIX), 'clock.void': Object.assign({ adopt: true }, FIX), 'clock.manual': Object.assign({ adopt: true }, FIX),
    'clock.autoclose': { adopt: true, authority: 'hub-only' },
    'break.start': Object.assign({ validate: vBreak, admit: admitBreak, doc: 'A break starts inside a shift. payload {empId, shiftId, at}' }, PUNCH),
    'break.end': Object.assign({ validate: vBreak, admit: admitBreak, doc: 'The open break of a shift ends. payload {empId, shiftId, at}' }, PUNCH)
  },
  views: { shifts: function (facts) { return TC.fold(facts.filter(function (e) { return /^clock\./.test(e.type); })); }, breaks: foldBreaks, punches: punches },
  needsConfig: { 'labor.mealAfterHrs': 5, 'labor.mealMins': 30, 'labor.restEveryHrs': 4, 'labor.restMins': 10, 'timeclock.autoCloseAfterHrs': 0 }
});

module.exports = { TIMECLOCK: TIMECLOCK, punches: punches, openShift: openShift, foldBreaks: foldBreaks };

});
G.CustomPOSFacts = { station: __load("core/station.js"), sync: __load("sync/sync.js"), http: __load("sync/http.js"), browserStore: __load("store/browser.js"), registry: __load("core/registry.js"), event: __load("core/event.js"), hlc: __load("core/hlc.js"), incfold: __load("core/incfold.js"), log: __load("core/log.js"), timeclock: __load("aggregates/timeclock.js"), modules: __load("modules/define.js"), staff: __load("modules/staff.js"), clock: __load("modules/timeclock.js"), record: __load("station/record.js"), views: __load("station/views.js") };
})(typeof globalThis !== "undefined" ? globalThis : this);
