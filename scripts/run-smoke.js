#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const root = path.resolve(__dirname, '..');
const argv = process.argv.slice(2);
const packaged = argv.includes('--packaged');
const source = argv.includes('--source') || !packaged;
const expectArg = argv.find((arg) => arg.startsWith('--expect='));
const expectIndex = argv.indexOf('--expect');
const expected = Number(expectArg ? expectArg.slice('--expect='.length) : argv[expectIndex + 1] || 43);
const timeoutMs = Number(process.env.INKFLOW_SMOKE_TIMEOUT_MS || 180000);

if (!Number.isInteger(expected) || expected <= 0 || (source && packaged)) {
  console.error('Usage: node scripts/run-smoke.js (--source|--packaged) [--expect 44]');
  process.exit(2);
}

function packagedCandidates() {
  const configured = process.env.INKFLOW_PACKAGED_EXECUTABLE;
  if (configured) return [path.resolve(configured)];

  const dist = path.join(root, 'dist');
  const productName = require(path.join(root, 'package.json')).build.productName;
  const candidates = [];

  function walk(dir, depth = 0) {
    if (depth > 7 || !fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full, depth + 1);
      else if (entry.isFile()) {
        const normalized = full.split(path.sep).join('/');
        const isMac = normalized.includes('.app/Contents/MacOS/') && entry.name === productName;
        const isWin = entry.name.toLowerCase() === `${productName}.exe`.toLowerCase()
          && normalized.toLowerCase().includes('win');
        const isLinux = entry.name === productName && normalized.toLowerCase().includes('linux');
        if (isMac || isWin || isLinux) candidates.push(full);
      }
    }
  }

  walk(dist);
  const platformToken = process.platform === 'darwin' ? '.app/Contents/MacOS/' : process.platform === 'win32' ? 'win' : 'linux';
  const archToken = process.arch === 'arm64' ? 'arm64' : process.arch === 'ia32' ? 'ia32' : 'x64';
  return candidates.sort((a, b) => {
    const score = (value) => (value.includes(platformToken) ? 4 : 0) + (value.includes(archToken) ? 2 : 0);
    return score(b) - score(a) || a.localeCompare(b);
  });
}

let executable;
let childArgs;
if (source) {
  executable = require('electron');
  childArgs = ['--no-sandbox', '--disable-gpu'];
} else {
  const candidates = packagedCandidates();
  executable = candidates[0];
  if (!executable || !fs.existsSync(executable)) {
    console.error('[smoke] packaged executable not found. Run the matching pack task or set INKFLOW_PACKAGED_EXECUTABLE.');
    process.exit(1);
  }
  childArgs = ['--no-sandbox', '--disable-gpu'];
}

const userData = fs.mkdtempSync(path.join(os.tmpdir(), `inkflow-${source ? 'source' : 'packaged'}-`));
childArgs.push(`--user-data-dir=${userData}`);
if (source) childArgs.push(root);

const env = { ...process.env, SMOKE: '1', SMOKE_FUNC: '1' };
for (const key of Object.keys(env)) {
  const normalized = key.toUpperCase();
  if (normalized === 'NODE_OPTIONS' || normalized === 'ELECTRON_RUN_AS_NODE') delete env[key];
  if (normalized.startsWith('SMOKE_') && normalized !== 'SMOKE_FUNC') delete env[key];
  if (normalized === 'INKFLOW_TEST_SAVEPATH') delete env[key];
}

console.log(`[smoke] mode=${source ? 'source' : 'packaged'} expected=${expected} userData=${userData}`);
console.log(`[smoke] executable=${executable}`);

function cleanupUserData() {
  try {
    fs.rmSync(userData, { recursive: true, force: true, maxRetries: 3, retryDelay: 150 });
  } catch (error) {
    console.warn(`[smoke] unable to remove isolated user-data: ${error.message}`);
  }
}

const child = spawn(executable, childArgs, {
  cwd: root,
  env,
  stdio: ['ignore', 'pipe', 'pipe'],
});

let output = '';
let timedOut = false;
const append = (chunk, stream) => {
  const text = chunk.toString();
  output += text;
  stream.write(text);
};
child.stdout.on('data', (chunk) => append(chunk, process.stdout));
child.stderr.on('data', (chunk) => append(chunk, process.stderr));

const timeout = setTimeout(() => {
  timedOut = true;
  console.error(`[smoke] timed out after ${timeoutMs}ms`);
  child.kill('SIGTERM');
  setTimeout(() => child.kill('SIGKILL'), 5000).unref();
}, timeoutMs);

child.on('error', (error) => {
  clearTimeout(timeout);
  cleanupUserData();
  console.error(`[smoke] failed to start: ${error.message}`);
  process.exit(1);
});

child.on('close', (code, signal) => {
  clearTimeout(timeout);
  cleanupUserData();

  const matches = [...output.matchAll(/\[func\]\s+(\d+)\/(\d+)\s+passed/g)];
  const summary = matches.at(-1);
  const passed = summary ? Number(summary[1]) : 0;
  const total = summary ? Number(summary[2]) : 0;
  const ok = !timedOut && code === 0 && passed === expected && total === expected;

  if (!ok) {
    console.error(`[smoke] failed: exit=${code} signal=${signal || 'none'} summary=${passed}/${total} expected=${expected}/${expected}`);
    process.exit(1);
  }
  console.log(`[smoke] verified ${passed}/${total} passed; isolated user-data removed`);
});
