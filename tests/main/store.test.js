const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { MAX_STORE_BYTES, Store } = require('../../main/store');

test('Store falls back safely without reading or parsing an existing file over its byte limit', (t) => {
  assert.equal(Number.isSafeInteger(MAX_STORE_BYTES), true);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'inkflow-store-oversized-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'settings.json');
  fs.writeFileSync(file, '');
  fs.truncateSync(file, MAX_STORE_BYTES + 1);

  let unboundedReadAttempted = false;
  const fsImpl = Object.create(fs);
  fsImpl.readFileSync = () => {
    unboundedReadAttempted = true;
    throw new Error('unbounded read must not be attempted');
  };

  const store = new Store(file, { theme: 'system' }, { fsImpl, logger: { error() {} } });

  assert.equal(store.get('theme'), 'system');
  assert.equal(unboundedReadAttempted, false);
  const result = store.set('theme', 'dark');
  assert.equal(result.ok, false);
  assert.match(result.error, /读取|过大|限制/);
  assert.equal(fs.statSync(file).size, MAX_STORE_BYTES + 1);
});

test('Store rejects an encoded JSON value over its configured persistence limit and preserves the durable value', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'inkflow-store-write-limit-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'settings.json');
  const store = new Store(file, { note: 'default' }, {
    maxBytes: 256,
    logger: { error() {} },
  });
  assert.deepEqual(store.set('note', 'durable'), { ok: true });
  const durableBytes = fs.readFileSync(file);

  const result = store.set('note', 'x'.repeat(300));

  assert.equal(result.ok, false);
  assert.match(result.error, /超过|限制/);
  assert.equal(store.get('note'), 'durable');
  assert.deepEqual(fs.readFileSync(file), durableBytes);
});

test('Store.set returns a failure and logs when its atomic write cannot complete', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'inkflow-store-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const blocker = path.join(dir, 'not-a-directory');
  fs.writeFileSync(blocker, 'x');

  const messages = [];
  const oldError = console.error;
  console.error = (...args) => messages.push(args.join(' '));
  t.after(() => { console.error = oldError; });

  const store = new Store(path.join(blocker, 'settings.json'), { theme: 'system' });
  const result = store.set('theme', 'dark');

  assert.equal(result.ok, false);
  assert.match(result.error, /directory|ENOTDIR|EEXIST/i);
  assert.equal(messages.some((message) => message.includes('settings.json')), true);
  assert.equal(store.get('theme'), 'system');
});

test('Store.set reports success only after the value is durable', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'inkflow-store-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'settings.json');
  const store = new Store(file, { theme: 'system' });

  assert.deepEqual(store.set('theme', 'dark'), { ok: true });
  assert.equal(new Store(file).get('theme'), 'dark');
});

test('Store persists settings with private permissions and leaves no temporary artifact', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'inkflow-store-private-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'settings.json');
  const store = new Store(file, { theme: 'system' });

  assert.deepEqual(store.set('theme', 'dark'), { ok: true });
  if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.deepEqual(fs.readdirSync(dir), ['settings.json']);
});

test('Store does not replace existing settings when syncing the new file fails', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'inkflow-store-sync-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'settings.json');
  const original = '{\n  "theme": "light"\n}';
  fs.writeFileSync(file, original, 'utf-8');

  const fsImpl = Object.create(fs);
  fsImpl.fsyncSync = () => {
    const err = new Error('injected file fsync failure');
    err.code = 'EIO';
    throw err;
  };
  const messages = [];
  const store = new Store(file, { theme: 'system' }, {
    fsImpl,
    logger: { error: (...args) => messages.push(args.join(' ')) },
  });

  const result = store.set('theme', 'dark');

  assert.equal(result.ok, false);
  assert.match(result.error, /injected file fsync failure/);
  assert.equal(fs.readFileSync(file, 'utf-8'), original);
  assert.equal(store.get('theme'), 'light');
  assert.equal(messages.length, 1);
  assert.deepEqual(fs.readdirSync(dir), ['settings.json']);
});

test('Store uses a private temporary file before the atomic replacement', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'inkflow-store-temp-mode-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'settings.json');
  let temporaryMode;
  const fsImpl = Object.create(fs);
  fsImpl.renameSync = (from, to) => {
    temporaryMode = fs.statSync(from).mode & 0o777;
    return fs.renameSync(from, to);
  };
  const store = new Store(file, {}, { fsImpl, logger: { error() {} } });

  assert.deepEqual(store.set('theme', 'dark'), { ok: true });
  if (process.platform !== 'win32') assert.equal(temporaryMode, 0o600);
});

test('Store treats directory fsync as best-effort after the durable rename', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'inkflow-store-dir-sync-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'settings.json');
  const directoryFd = Symbol('directory fd');
  let directorySyncAttempted = false;
  const fsImpl = Object.create(fs);
  fsImpl.openSync = (target, ...args) => (target === dir ? directoryFd : fs.openSync(target, ...args));
  fsImpl.fsyncSync = (fd) => {
    if (fd === directoryFd) {
      directorySyncAttempted = true;
      const err = new Error('directory fsync unsupported');
      err.code = 'EINVAL';
      throw err;
    }
    return fs.fsyncSync(fd);
  };
  fsImpl.closeSync = (fd) => (fd === directoryFd ? undefined : fs.closeSync(fd));
  const store = new Store(file, {}, { fsImpl, logger: { error() {} } });

  assert.deepEqual(store.set('theme', 'dark'), { ok: true });
  assert.equal(directorySyncAttempted, true);
  assert.equal(new Store(file).get('theme'), 'dark');
});

test('Store cannot report failure after rename has committed the new value', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'inkflow-store-commit-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'settings.json');
  fs.writeFileSync(file, '{"theme":"light"}', { encoding: 'utf-8', mode: 0o600 });
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
  const store = new Store(file, {}, { fsImpl, logger: { error() {} } });

  assert.deepEqual(store.set('theme', 'dark'), { ok: true });
  assert.equal(store.get('theme'), 'dark');
  assert.equal(new Store(file).get('theme'), 'dark');
  if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o777, 0o600);
});
