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
