'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { writeOutputFile } = require('../../main/output-files');

function outputPath(t, content = Buffer.from('old bytes')) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'inkflow-output-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'export.bin');
  fs.writeFileSync(file, content, { mode: 0o640 });
  fs.chmodSync(file, 0o640);
  return file;
}

test('export outputs replace an existing file atomically and preserve its mode', (t) => {
  const file = outputPath(t);

  assert.deepEqual(writeOutputFile(file, Buffer.from('new bytes')), { ok: true });
  assert.equal(fs.readFileSync(file, 'utf8'), 'new bytes');
  if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o777, 0o640);
  assert.deepEqual(fs.readdirSync(path.dirname(file)), ['export.bin']);
});

test('export output fsync failure preserves the previous artifact and removes the temp', (t) => {
  const file = outputPath(t);
  const fsImpl = Object.create(fs);
  fsImpl.fsyncSync = () => {
    const error = new Error('injected output fsync failure');
    error.code = 'EIO';
    throw error;
  };

  const result = writeOutputFile(file, Buffer.from('new bytes'), { fsImpl });

  assert.equal(result.ok, false);
  assert.match(result.error, /injected output fsync failure/);
  assert.equal(fs.readFileSync(file, 'utf8'), 'old bytes');
  assert.deepEqual(fs.readdirSync(path.dirname(file)), ['export.bin']);
});

test('exporting through a symlink keeps the symlink intact', {
  skip: process.platform === 'win32' ? 'Windows CI symlinks require elevation' : false,
}, (t) => {
  const target = outputPath(t);
  const link = path.join(path.dirname(target), 'chosen.bin');
  fs.symlinkSync(target, link);

  assert.deepEqual(writeOutputFile(link, 'replacement'), { ok: true });
  assert.equal(fs.lstatSync(link).isSymbolicLink(), true);
  assert.equal(fs.readFileSync(target, 'utf8'), 'replacement');
});

test('an output cannot report failure after rename has committed the artifact', (t) => {
  const file = outputPath(t);
  let committed = false;
  const fsImpl = Object.create(fs);
  fsImpl.renameSync = (from, to) => {
    const result = fs.renameSync(from, to);
    committed = true;
    return result;
  };
  fsImpl.chmodSync = (target, mode) => {
    if (committed && target === file) throw new Error('injected post-rename chmod failure');
    return fs.chmodSync(target, mode);
  };

  assert.deepEqual(writeOutputFile(file, Buffer.from('committed bytes'), { fsImpl }), { ok: true });
  assert.equal(fs.readFileSync(file, 'utf8'), 'committed bytes');
  if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o777, 0o640);
  assert.deepEqual(fs.readdirSync(path.dirname(file)), ['export.bin']);
});
