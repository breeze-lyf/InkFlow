#!/usr/bin/env node
'use strict';

const { spawnSync } = require('child_process');

const tasks = process.argv.slice(2);
if (tasks.length === 0) {
  console.error('Usage: node scripts/run-npm-tasks.js <task> [task...]');
  process.exit(2);
}

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
for (const task of tasks) {
  console.log(`\n[task] npm run ${task}`);
  const result = spawnSync(npm, ['run', task], {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit',
  });
  if (result.error) {
    console.error(`[task] unable to start ${task}: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status || 1);
}
