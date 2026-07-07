#!/usr/bin/env node
/* Runs every tests/*.js in series, prints a summary, exits non-zero on any failure.
   Each test reads CHROMIUM_EXE (falling back to a default path). Usage: node run-tests.js */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const dir = path.join(__dirname, 'tests');
const files = fs.readdirSync(dir).filter(f => f.endsWith('.js')).sort();
let pass = 0; const failed = [];

for (const f of files) {
  const res = spawnSync('node', [path.join(dir, f)], { stdio: 'inherit', env: process.env });
  if (res.status === 0) { pass++; }
  else { failed.push(f); }
}

console.log(`\n=================  ${pass}/${files.length} suites passed  =================`);
if (failed.length) { console.log('FAILED:\n  ' + failed.join('\n  ')); process.exit(1); }
process.exit(0);
