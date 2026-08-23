const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { MAX_DOCUMENT_BYTES, readDocument, writeDocument } = require('../../main/document-files');

function createFile(t, content = 'disk version') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'inkflow-doc-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'note.md');
  fs.writeFileSync(file, content, 'utf-8');
  return file;
}

test('opening an oversized document fails before its contents are read', () => {
  const file = path.resolve(os.tmpdir(), 'oversized-document.md');
  let reads = 0;
  const fsImpl = Object.create(fs);
  fsImpl.lstatSync = () => ({
    isFile: () => true,
    isSymbolicLink: () => false,
    size: MAX_DOCUMENT_BYTES + 1,
  });
  fsImpl.readFileSync = () => {
    reads += 1;
    throw new Error('oversized content must not be read');
  };

  assert.deepEqual(readDocument(file, { fsImpl }), { ok: false, error: 'document-too-large' });
  assert.equal(reads, 0);
});

test('compare-and-swap rejects an oversized disk baseline before reading it', (t) => {
  const file = createFile(t);
  let reads = 0;
  const fsImpl = Object.create(fs);
  fsImpl.lstatSync = (target) => {
    const stat = fs.lstatSync(target);
    return {
      ...stat,
      size: MAX_DOCUMENT_BYTES + 1,
      isFile: () => stat.isFile(),
      isSymbolicLink: () => stat.isSymbolicLink(),
    };
  };
  fsImpl.readFileSync = () => {
    reads += 1;
    throw new Error('oversized baseline must not be read');
  };

  assert.deepEqual(writeDocument(file, 'editor version', { expectedContent: 'disk version' }, fsImpl), {
    ok: false,
    error: 'document-too-large',
  });
  assert.equal(reads, 0);
  assert.equal(fs.readFileSync(file, 'utf-8'), 'disk version');
});

test('saving rejects oversized editor and expected content before filesystem access', () => {
  const file = path.resolve(os.tmpdir(), 'oversized-save.md');
  const oversized = 'x'.repeat(MAX_DOCUMENT_BYTES + 1);
  let stats = 0;
  const fsImpl = Object.create(fs);
  fsImpl.lstatSync = () => {
    stats += 1;
    throw new Error('filesystem must not be reached');
  };

  assert.deepEqual(writeDocument(file, oversized, {}, fsImpl), {
    ok: false,
    error: 'document-too-large',
  });
  assert.deepEqual(writeDocument(file, 'small', { expectedContent: oversized }, fsImpl), {
    ok: false,
    error: 'document-too-large',
  });
  assert.equal(stats, 0);
});

test('compare-and-swap rejects a baseline that grows beyond the limit after stat', (t) => {
  const file = createFile(t);
  const oversized = 'x'.repeat(MAX_DOCUMENT_BYTES + 1);
  let reads = 0;
  const fsImpl = Object.create(fs);
  fsImpl.readFileSync = () => {
    reads += 1;
    return oversized;
  };

  assert.deepEqual(writeDocument(file, 'editor version', { expectedContent: 'disk version' }, fsImpl), {
    ok: false,
    error: 'document-too-large',
  });
  assert.equal(reads, 1);
  assert.equal(fs.readFileSync(file, 'utf-8'), 'disk version');
});

test('pre-rename recheck never returns an oversized disk version as conflict data', (t) => {
  const file = createFile(t);
  const oversized = 'x'.repeat(MAX_DOCUMENT_BYTES + 1);
  let reads = 0;
  const fsImpl = Object.create(fs);
  fsImpl.readFileSync = (target, ...args) => {
    reads += 1;
    if (reads === 1) return fs.readFileSync(target, ...args);
    return oversized;
  };

  assert.deepEqual(writeDocument(file, 'editor version', { expectedContent: 'disk version' }, fsImpl), {
    ok: false,
    error: 'document-too-large',
  });
  assert.equal(reads, 2);
  assert.equal(fs.readFileSync(file, 'utf-8'), 'disk version');
  assert.deepEqual(fs.readdirSync(path.dirname(file)).filter((name) => name.includes('.inktmp-')), []);
});

test('a stale editor save reports the disk version without overwriting it', (t) => {
  const file = createFile(t);

  const result = writeDocument(file, 'editor version', { expectedContent: 'older version' });

  assert.deepEqual(result, {
    ok: false,
    conflict: true,
    exists: true,
    diskContent: 'disk version',
  });
  assert.equal(fs.readFileSync(file, 'utf-8'), 'disk version');
});

test('a save succeeds when the expected disk content still matches', (t) => {
  const file = createFile(t);
  assert.deepEqual(writeDocument(file, 'editor version', { expectedContent: 'disk version' }), { ok: true });
  assert.equal(fs.readFileSync(file, 'utf-8'), 'editor version');
});

test('a missing expected file conflicts unless the user explicitly forces an overwrite', (t) => {
  const file = createFile(t);
  fs.unlinkSync(file);

  assert.deepEqual(writeDocument(file, 'recovered', { expectedContent: 'old' }), {
    ok: false,
    conflict: true,
    exists: false,
    diskContent: '',
  });
  assert.equal(fs.existsSync(file), false);
  assert.deepEqual(writeDocument(file, 'recovered', { expectedContent: 'old', force: true }), { ok: true });
  assert.equal(fs.readFileSync(file, 'utf-8'), 'recovered');
});

test('saving through a symlink preserves the link and the target mode', {
  skip: process.platform === 'win32' ? 'Windows CI cannot create file symlinks without elevation' : false,
}, (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'inkflow-doc-link-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const target = path.join(dir, 'target.md');
  const link = path.join(dir, 'link.md');
  fs.writeFileSync(target, 'before', { encoding: 'utf-8', mode: 0o640 });
  fs.chmodSync(target, 0o640);
  fs.symlinkSync(target, link, 'file');

  assert.deepEqual(writeDocument(link, 'after', { expectedContent: 'before' }), { ok: true });
  assert.equal(fs.lstatSync(link).isSymbolicLink(), true);
  assert.equal(fs.readFileSync(target, 'utf-8'), 'after');
  assert.equal(fs.statSync(target).mode & 0o777, 0o640);
});

test('a save rechecks the disk baseline immediately before rename', (t) => {
  const file = createFile(t);
  let injected = false;
  const fsImpl = Object.create(fs);
  fsImpl.writeFileSync = (destination, ...args) => {
    const result = fs.writeFileSync(destination, ...args);
    const wroteTemporary = typeof destination === 'number'
      || (destination !== file && destination.includes('.inktmp-'));
    if (!injected && wroteTemporary) {
      injected = true;
      fs.writeFileSync(file, 'external version', 'utf-8');
    }
    return result;
  };

  assert.deepEqual(writeDocument(file, 'editor version', { expectedContent: 'disk version' }, fsImpl), {
    ok: false,
    conflict: true,
    exists: true,
    diskContent: 'external version',
  });
  assert.equal(fs.readFileSync(file, 'utf-8'), 'external version');
  assert.deepEqual(fs.readdirSync(path.dirname(file)).filter((name) => name.includes('.inktmp-')), []);
});

test('a save detects replacement of the original file even when its content is unchanged', (t) => {
  const file = createFile(t);
  const replacement = `${file}.replacement`;
  fs.writeFileSync(replacement, 'disk version', 'utf-8');
  let injected = false;
  const fsImpl = Object.create(fs);
  fsImpl.writeFileSync = (destination, ...args) => {
    const result = fs.writeFileSync(destination, ...args);
    const wroteTemporary = typeof destination === 'number'
      || (destination !== file && destination.includes('.inktmp-'));
    if (!injected && wroteTemporary) {
      injected = true;
      fs.renameSync(replacement, file);
    }
    return result;
  };

  assert.deepEqual(writeDocument(file, 'editor version', { expectedContent: 'disk version' }, fsImpl), {
    ok: false,
    conflict: true,
    exists: true,
    diskContent: 'disk version',
  });
  assert.equal(fs.readFileSync(file, 'utf-8'), 'disk version');
});

test('a successful atomic save attempts to sync both the file and its directory', (t) => {
  const file = createFile(t);
  const opened = [];
  const fsImpl = Object.create(fs);
  fsImpl.openSync = (destination, ...args) => {
    opened.push(destination);
    return fs.openSync(destination, ...args);
  };

  assert.deepEqual(writeDocument(file, 'editor version', { expectedContent: 'disk version' }, fsImpl), { ok: true });
  assert.equal(opened.some((destination) => destination.includes('.inktmp-')), true);
  assert.equal(opened.includes(path.dirname(file)), true);
});

test('saving succeeds when fsync requires a write-capable file descriptor', (t) => {
  const file = createFile(t);
  const descriptors = new Map();
  const operations = [];
  const fsImpl = Object.create(fs);
  fsImpl.openSync = (destination, flags, ...args) => {
    const fd = fs.openSync(destination, flags, ...args);
    const writable = typeof flags === 'number'
      ? (flags & (fs.constants.O_WRONLY | fs.constants.O_RDWR)) !== 0
      : flags.includes('w') || flags.includes('a') || flags.includes('+');
    const temporary = typeof destination === 'string' && destination.includes('.inktmp-');
    descriptors.set(fd, { temporary, writable });
    if (temporary) operations.push(writable ? 'open:writable' : 'open:read-only');
    return fd;
  };
  fsImpl.writeFileSync = (destination, ...args) => {
    if (typeof destination === 'number' && descriptors.get(destination)?.temporary) {
      operations.push('write');
    }
    return fs.writeFileSync(destination, ...args);
  };
  fsImpl.fchmodSync = (fd, ...args) => {
    if (descriptors.get(fd)?.temporary) operations.push('fchmod');
    return fs.fchmodSync(fd, ...args);
  };
  fsImpl.fsyncSync = (fd) => {
    const descriptor = descriptors.get(fd);
    if (descriptor?.temporary) operations.push('fsync');
    if (descriptor && !descriptor.writable) {
      const error = new Error('operation not permitted for a read-only descriptor');
      error.code = 'EPERM';
      throw error;
    }
    return fs.fsyncSync(fd);
  };
  fsImpl.closeSync = (fd) => {
    if (descriptors.get(fd)?.temporary) operations.push('close');
    try {
      return fs.closeSync(fd);
    } finally {
      descriptors.delete(fd);
    }
  };
  fsImpl.renameSync = (source, destination) => {
    if (source.includes('.inktmp-')) operations.push('rename');
    return fs.renameSync(source, destination);
  };

  assert.deepEqual(writeDocument(file, 'editor version', { expectedContent: 'disk version' }, fsImpl), { ok: true });
  assert.equal(fs.readFileSync(file, 'utf-8'), 'editor version');
  assert.deepEqual(operations, ['open:writable', 'write', 'fchmod', 'fsync', 'close', 'rename']);
});

test('a file fsync failure aborts the save and keeps both disk content and recovery semantics intact', (t) => {
  const file = createFile(t);
  const fsImpl = Object.create(fs);
  let syncCalls = 0;
  fsImpl.fsyncSync = (fd) => {
    syncCalls += 1;
    if (syncCalls === 1) {
      const error = new Error('storage I/O failure');
      error.code = 'EIO';
      throw error;
    }
    return fs.fsyncSync(fd);
  };

  const result = writeDocument(file, 'editor version', { expectedContent: 'disk version' }, fsImpl);

  assert.equal(result.ok, false);
  assert.match(result.error, /storage I\/O failure/);
  assert.equal(fs.readFileSync(file, 'utf-8'), 'disk version');
  assert.deepEqual(fs.readdirSync(path.dirname(file)).filter((name) => name.includes('.inktmp-')), []);
});
