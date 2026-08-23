#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const testRoots = [path.join(root, 'tests'), path.join(__dirname, 'tests')];

function collect(dir, files = []) {
  if (!fs.existsSync(dir)) return files;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collect(full, files);
    else if (/\.test\.(?:c?js|mjs)$/.test(entry.name)) files.push(full);
  }
  return files;
}

const files = [...new Set(testRoots.flatMap((dir) => collect(dir)))].sort();
if (files.length === 0) {
  console.error('[unit] no *.test.js files found under tests/ or scripts/tests/');
  process.exit(1);
}

console.log(`[unit] running ${files.length} test file(s)`);
const result = spawnSync(process.execPath, ['--test', ...files], {
  cwd: root,
  env: process.env,
  stdio: 'inherit',
});

if (result.error) {
  console.error(`[unit] unable to start Node test runner: ${result.error.message}`);
  process.exit(1);
}
if (result.signal) console.error(`[unit] Node test runner terminated by ${result.signal}`);
process.exit(result.status === 0 ? 0 : 1);
