const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { createExportTemp } = require('../../main/export-temp');

function tempRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'inkflow-export-temp-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test('export HTML exists only in a private temporary directory until cleanup', (t) => {
  const rootDir = tempRoot(t);
  const temporary = createExportTemp('<p>private draft</p>', { rootDir });
  const directory = path.dirname(temporary.file);

  assert.equal(path.dirname(directory), rootDir);
  assert.equal(fs.readFileSync(temporary.file, 'utf-8'), '<p>private draft</p>');
  if (process.platform !== 'win32') {
    assert.equal(fs.statSync(directory).mode & 0o777, 0o700);
    assert.equal(fs.statSync(temporary.file).mode & 0o777, 0o600);
  }

  assert.deepEqual(temporary.cleanup(), { ok: true });
  assert.equal(fs.existsSync(temporary.file), false);
  assert.equal(fs.existsSync(directory), false);
  assert.deepEqual(temporary.cleanup(), { ok: true });
});

test('export temp creation fails closed and leaves no artifact when file sync fails', (t) => {
  const rootDir = tempRoot(t);
  const fsImpl = Object.create(fs);
  fsImpl.fsyncSync = () => {
    const err = new Error('injected fsync failure');
    err.code = 'EIO';
    throw err;
  };

  assert.throws(
    () => createExportTemp('<p>must not survive</p>', { rootDir, fsImpl }),
    /injected fsync failure/
  );
  assert.deepEqual(fs.readdirSync(rootDir), []);
});

test('concurrent export temporaries use distinct private paths', (t) => {
  const rootDir = tempRoot(t);
  const first = createExportTemp('first', { rootDir });
  const second = createExportTemp('second', { rootDir });
  t.after(() => first.cleanup());
  t.after(() => second.cleanup());

  assert.notEqual(first.file, second.file);
  assert.notEqual(path.dirname(first.file), path.dirname(second.file));
  assert.equal(fs.readFileSync(first.file, 'utf-8'), 'first');
  assert.equal(fs.readFileSync(second.file, 'utf-8'), 'second');
});

test('cleanup never recursively removes an unexpected neighboring file', (t) => {
  const rootDir = tempRoot(t);
  const temporary = createExportTemp('draft', { rootDir });
  const neighbor = path.join(path.dirname(temporary.file), 'unexpected.txt');
  fs.writeFileSync(neighbor, 'keep me', 'utf-8');

  const result = temporary.cleanup();

  assert.equal(result.ok, false);
  assert.equal(fs.existsSync(temporary.file), false);
  assert.equal(fs.readFileSync(neighbor, 'utf-8'), 'keep me');
});
