#!/usr/bin/env node
/*
  Build the SELF-CONTAINED builder: dist/custompos.html
  =====================================================
  Embeds the engine (pos.html) into the builder (builder.html) so the whole thing is ONE file that
  works with no server — open it anywhere, or host it as customPOS.com. The builder normally fetches
  pos.html; here we inline it as window.__ENGINE_SRC__ (UTF-8-safe base64) so no network is needed.

  Run:  node build.js   ->   dist/custompos.html
*/
'use strict';
const fs = require('fs');
const path = require('path');
const root = __dirname;

const engine  = fs.readFileSync(path.join(root, 'pos.html'), 'utf8');
const builder = fs.readFileSync(path.join(root, 'builder.html'), 'utf8');

const b64 = Buffer.from(engine, 'utf8').toString('base64');
// UTF-8-safe decode at runtime (pos.html has emoji/accents); base64 avoids any </script> breakage
const inject = '<script>window.__ENGINE_SRC__ = new TextDecoder().decode(Uint8Array.from(atob("'
  + b64 + '"), c=>c.charCodeAt(0)));<\/script>\n';

const out = builder.replace('<script>', inject + '<script>');   // prepend before the builder's own script
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
const dest = path.join(root, 'dist', 'custompos.html');
fs.writeFileSync(dest, out);
console.log('wrote ' + path.relative(root, dest) + ' (' + out.length + ' bytes, engine ' + engine.length + ' inlined)');
