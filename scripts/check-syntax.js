#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const roots = ['main', path.join('renderer', 'js'), 'scripts', 'tests'];
const extensions = new Set(['.js', '.cjs', '.mjs']);

function collect(dir, files = []) {
  if (!fs.existsSync(dir)) return files;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collect(full, files);
    else if (extensions.has(path.extname(entry.name))) files.push(full);
  }
  return files;
}

const files = [...new Set(roots.flatMap((dir) => collect(path.join(root, dir))))].sort();
const failures = [];

for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], {
    cwd: root,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    failures.push({
      file: path.relative(root, file),
      detail: (result.stderr || result.stdout || 'unknown syntax error').trim(),
    });
  }
}

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(`\n[syntax] ${failure.file}\n${failure.detail}`);
  }
  console.error(`\n[syntax] ${failures.length}/${files.length} file(s) failed`);
  process.exit(1);
}

console.log(`[syntax] ${files.length}/${files.length} JavaScript file(s) passed`);
