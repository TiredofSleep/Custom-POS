#!/usr/bin/env node
/* ============================================================================================
   🔐 ENCRYPT THE OFF-SITE BACKUP — and stay able to read it in ten years.

   Owner, 2026-08-13, after the hardening review: the backups are the biggest privacy exposure in the whole
   system. `ozark-db.json` holds 4,925 customers with names, addresses, phones, emails and balances, and it
   sits in plain text on the droplet AND in OneDrive. A breach of either is a notification event.

   ⚠️ THE REAL RISK OF ENCRYPTING BACKUPS IS LOSING THE KEY, not losing the ciphertext. An encrypted backup
   nobody can open is worse than a plaintext one, because it FEELS safe. So three rules shape this file:

     1. ONE PASSPHRASE, kept by a human in a password manager — not a key file that dies with the machine
        it protects. If the droplet burns down, the passphrase is still in the owner's head or his vault.
     2. STANDARD PRIMITIVES ONLY: scrypt for the key, AES-256-GCM for the data. Both are in Node's standard
        library, so a future reader needs no packages, no vendor and no version of this repo.
     3. THE FILE DESCRIBES ITSELF. The header carries a magic string, a version, and the scrypt parameters,
        so somebody holding only the .enc file and the passphrase can recover the plaintext from the format
        note below without ever seeing this program.

   FORMAT (all little-endian where it matters):
       "OZARKENC1"  9 bytes   magic + version
       N, r, p      3 x uint32  scrypt cost parameters
       salt         32 bytes
       iv           12 bytes
       tag          16 bytes  AES-GCM authentication tag
       ciphertext   the rest  AES-256-GCM of the gzipped JSON

   RECOVERY WITHOUT THIS FILE — paste into node, supply the passphrase:
       const c=require('crypto'),z=require('zlib'),b=require('fs').readFileSync('ozark-db.enc');
       const N=b.readUInt32LE(9),r=b.readUInt32LE(13),p=b.readUInt32LE(17);
       const salt=b.subarray(21,53), iv=b.subarray(53,65), tag=b.subarray(65,81), ct=b.subarray(81);
       const k=c.scryptSync(PASSPHRASE,salt,32,{N,r,p,maxmem:512*1024*1024});
       const d=c.createDecipheriv('aes-256-gcm',k,iv); d.setAuthTag(tag);
       console.log(z.gunzipSync(Buffer.concat([d.update(ct),d.final()])).toString());

   usage:
     node backup-crypto.js encrypt <in.json> <out.enc>
     node backup-crypto.js decrypt <in.enc>  <out.json>
     node backup-crypto.js selftest
   The passphrase comes from OZARK_BACKUP_KEY (hub.env) or --pass <value>.
   ============================================================================================ */
'use strict';
const crypto = require('crypto');
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

const MAGIC = 'OZARKENC1';
/* cost parameters: ~100ms on the droplet. High enough that a stolen backup is not brute-forced from a
   weak passphrase, low enough that a weekly verify is not a burden. */
const N = 1 << 15, R = 8, P = 1;
const HDR = MAGIC.length + 12 + 32 + 12 + 16;   /* 9 + 12 + 32 + 12 + 16 = 81 */

function passphrase() {
  const i = process.argv.indexOf('--pass');
  if (i > 0 && process.argv[i + 1]) return process.argv[i + 1];
  if (process.env.OZARK_BACKUP_KEY) return process.env.OZARK_BACKUP_KEY;
  /* hub.env is the same place every other secret lives; read it rather than making a second convention */
  for (const p of ['/opt/ozark/hub.env', path.join(__dirname, 'hub.env')]) {
    try {
      const m = fs.readFileSync(p, 'utf8').match(/^OZARK_BACKUP_KEY=(.*)$/m);
      if (m && m[1].trim()) return m[1].trim();
    } catch (e) {}
  }
  return '';
}

function encrypt(inFile, outFile, pass) {
  const plain = fs.readFileSync(inFile);
  /* ⚠️ gzip BEFORE encrypting. After encryption everything is incompressible noise, so the order is not a
     preference — reversed, the off-site copy would be five times larger for nothing. */
  const gz = zlib.gzipSync(plain, { level: 9 });
  const salt = crypto.randomBytes(32), iv = crypto.randomBytes(12);
  const key = crypto.scryptSync(pass, salt, 32, { N, r: R, p: P, maxmem: 512 * 1024 * 1024 });
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(gz), c.final()]);
  const head = Buffer.alloc(HDR);
  head.write(MAGIC, 0, 'ascii');
  head.writeUInt32LE(N, 9); head.writeUInt32LE(R, 13); head.writeUInt32LE(P, 17);
  salt.copy(head, 21); iv.copy(head, 53); c.getAuthTag().copy(head, 65);
  /* ⚠️ write to a temp name and rename. A backup half-written when the process is killed must never be
     mistaken for a backup. */
  const tmp = outFile + '.part';
  fs.writeFileSync(tmp, Buffer.concat([head, ct]));
  fs.renameSync(tmp, outFile);
  return { plain: plain.length, out: fs.statSync(outFile).size };
}

function decrypt(inFile, outFile, pass) {
  const b = fs.readFileSync(inFile);
  if (b.length < HDR || b.subarray(0, MAGIC.length).toString('ascii') !== MAGIC) {
    throw new Error('not an Ozark encrypted backup (bad magic) — is this the right file?');
  }
  const n = b.readUInt32LE(9), r = b.readUInt32LE(13), p = b.readUInt32LE(17);
  const salt = b.subarray(21, 53), iv = b.subarray(53, 65), tag = b.subarray(65, 81), ct = b.subarray(81);
  const key = crypto.scryptSync(pass, salt, 32, { N: n, r, p, maxmem: 512 * 1024 * 1024 });
  const d = crypto.createDecipheriv('aes-256-gcm', key, iv);
  d.setAuthTag(tag);
  /* ⚠️ GCM's final() THROWS if the ciphertext or the tag has been altered. That is the point: this cannot
     return quietly-wrong plaintext the way an unauthenticated mode could. A wrong passphrase and a corrupted
     file both land here, so the message names both. */
  let gz;
  try { gz = Buffer.concat([d.update(ct), d.final()]); }
  catch (e) { throw new Error('could not decrypt — wrong passphrase, or the file has been altered'); }
  const plain = zlib.gunzipSync(gz);
  if (outFile) fs.writeFileSync(outFile, plain);
  return plain;
}

function selftest() {
  const tmp = path.join(require('os').tmpdir(), 'ozark-crypt-' + Date.now());
  const src = tmp + '.json', enc = tmp + '.enc', out = tmp + '.out.json';
  const sample = JSON.stringify({ db: { customers: [{ id: 'x', first: 'Test', last: 'Person' }] } });
  fs.writeFileSync(src, sample);
  let ok = true;
  const say = (n, good) => { if (!good) ok = false; console.log((good ? '  ✓ ' : '  ✗ ') + n); };
  try {
    encrypt(src, enc, 'correct horse');
    say('encrypts', fs.existsSync(enc));
    say('the ciphertext does not contain the plaintext', fs.readFileSync(enc).indexOf('Test') < 0);
    say('round-trips to the identical bytes', decrypt(enc, out, 'correct horse').toString() === sample);
    let threw = false;
    try { decrypt(enc, null, 'wrong passphrase'); } catch (e) { threw = true; }
    say('⚠️ a WRONG passphrase throws rather than returning junk', threw);
    const b = fs.readFileSync(enc); b[b.length - 1] ^= 0xff; fs.writeFileSync(enc, b);
    threw = false;
    try { decrypt(enc, null, 'correct horse'); } catch (e) { threw = true; }
    say('⚠️ a TAMPERED file throws — GCM authenticates, so a silently-wrong restore is impossible', threw);
  } finally {
    [src, enc, out].forEach(f => { try { fs.unlinkSync(f); } catch (e) {} });
  }
  return ok;
}

const cmd = process.argv[2];
if (cmd === 'selftest') { process.exit(selftest() ? 0 : 1); }
const pass = passphrase();
if (!pass) {
  console.error('REFUSING: no passphrase. Set OZARK_BACKUP_KEY in hub.env, or pass --pass <value>.');
  process.exit(2);
}
try {
  if (cmd === 'encrypt') {
    const r = encrypt(process.argv[3], process.argv[4], pass);
    console.log('encrypted ' + Math.round(r.plain / 1024) + ' KB → ' + Math.round(r.out / 1024) + ' KB  ' + process.argv[4]);
  } else if (cmd === 'decrypt') {
    decrypt(process.argv[3], process.argv[4], pass);
    console.log('decrypted → ' + process.argv[4]);
  } else {
    console.error('usage: backup-crypto.js encrypt|decrypt|selftest');
    process.exit(2);
  }
} catch (e) { console.error('FAILED: ' + e.message); process.exit(1); }
