#!/usr/bin/env node
/*
  customPOS — backup: an encrypted, self-describing, tamper-evident snapshot of a POS database.
  ============================================================================================
  Generalized from the Ozark backup discipline. A backup is only worth having if it PROVES itself on the way
  back in — a silently-corrupt or truncated snapshot that "restores" to garbage is worse than no backup. So the
  format authenticates itself: gzip → AES-256-GCM (authenticated encryption), key derived from a passphrase by
  scrypt, with a self-describing header carrying the KDF parameters and the salt/iv/tag. A wrong passphrase or a
  single flipped byte fails the GCM authentication and THROWS — decrypt never hands back a plausible-but-wrong DB.

  The header names its own KDF params, so a future cost change can still open today's backups. Layout:
    "CPBK1" (5 bytes) · headerLen (uint32 BE) · header JSON · ciphertext

  API:  encrypt(dbObject, passphrase) -> Buffer     decrypt(buffer, passphrase) -> dbObject
  CLI:  node backup.js encrypt <db.json> <out.cpbk>   (passphrase in CUSTOMPOS_BACKUP_PASS)
        node backup.js decrypt <in.cpbk> <out.json>
*/
'use strict';
const crypto = require('crypto');
const zlib = require('zlib');
const MAGIC = 'CPBK1';
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

function encrypt(obj, passphrase){
  if (!passphrase) throw new Error('a passphrase is required');
  const plain = zlib.gzipSync(Buffer.from(JSON.stringify(obj), 'utf8'));
  const salt = crypto.randomBytes(16), iv = crypto.randomBytes(12);
  const key = crypto.scryptSync(passphrase, salt, 32, SCRYPT);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plain), cipher.final()]);
  const header = Buffer.from(JSON.stringify({
    magic: MAGIC, v: 1, kdf: 'scrypt', N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p,
    salt: salt.toString('base64'), iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'),
    createdAt: new Date().toISOString(),
  }), 'utf8');
  const hlen = Buffer.alloc(4); hlen.writeUInt32BE(header.length, 0);
  return Buffer.concat([Buffer.from(MAGIC, 'utf8'), hlen, header, ct]);
}

function decrypt(buf, passphrase){
  if (!Buffer.isBuffer(buf)) buf = Buffer.from(buf);
  if (buf.length < 9 || buf.slice(0, 5).toString('utf8') !== MAGIC) throw new Error('not a customPOS backup');
  const hlen = buf.readUInt32BE(5);
  let header; try { header = JSON.parse(buf.slice(9, 9 + hlen).toString('utf8')); } catch (e){ throw new Error('backup header is corrupt'); }
  const ct = buf.slice(9 + hlen);
  const key = crypto.scryptSync(passphrase, Buffer.from(header.salt, 'base64'), 32, { N: header.N, r: header.r, p: header.p, maxmem: SCRYPT.maxmem });
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(header.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(header.tag, 'base64'));
  const plain = Buffer.concat([decipher.update(ct), decipher.final()]);   // GCM: throws on wrong passphrase OR tamper
  return JSON.parse(zlib.gunzipSync(plain).toString('utf8'));
}

// read a backup's header without the passphrase (backup-verify uses this for age/metadata)
function readHeader(buf){
  if (!Buffer.isBuffer(buf)) buf = Buffer.from(buf);
  if (buf.length < 9 || buf.slice(0, 5).toString('utf8') !== MAGIC) throw new Error('not a customPOS backup');
  return JSON.parse(buf.slice(9, 9 + buf.readUInt32BE(5)).toString('utf8'));
}

module.exports = { encrypt, decrypt, readHeader, MAGIC };

if (require.main === module){
  const fs = require('fs');
  const [op, inp, outp] = process.argv.slice(2);
  const pass = process.env.CUSTOMPOS_BACKUP_PASS;
  try {
    if (op === 'encrypt'){ if(!pass) throw new Error('set CUSTOMPOS_BACKUP_PASS'); fs.writeFileSync(outp, encrypt(JSON.parse(fs.readFileSync(inp,'utf8')), pass)); console.error('wrote '+outp); }
    else if (op === 'decrypt'){ if(!pass) throw new Error('set CUSTOMPOS_BACKUP_PASS'); fs.writeFileSync(outp, JSON.stringify(decrypt(fs.readFileSync(inp), pass))); console.error('wrote '+outp); }
    else { console.error('usage: node backup.js encrypt|decrypt <in> <out>  (CUSTOMPOS_BACKUP_PASS)'); process.exit(2); }
  } catch (e){ console.error('FAILED:', e.message); process.exit(1); }
}
