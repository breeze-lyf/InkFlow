const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { PathGrants } = require('../../main/path-grants');

function withTempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'inkflow-path-grants-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('a selected folder grants its descendants, but not sibling paths', (t) => {
  const root = withTempDir(t);
  const selected = path.join(root, 'selected');
  const sibling = path.join(root, 'private.md');
  fs.mkdirSync(selected);
  fs.writeFileSync(path.join(selected, 'note.md'), '# note');
  fs.writeFileSync(sibling, 'private');

  const grants = new PathGrants();
  assert.equal(grants.allows(path.join(selected, 'note.md'), 'read'), false);

  const granted = grants.grant(selected, { kind: 'directory', access: ['read', 'write', 'asset'] });
  assert.equal(granted.ok, true);
  assert.equal(grants.allows(path.join(selected, 'note.md'), 'read'), true);
  assert.equal(grants.allows(path.join(selected, 'new.md'), 'write'), true);
  assert.equal(grants.allows(sibling, 'read'), false);
});

test('a symlink inside a selected folder cannot escape the granted boundary', (t) => {
  const root = withTempDir(t);
  const selected = path.join(root, 'selected');
  const outside = path.join(root, 'outside');
  fs.mkdirSync(selected);
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, 'secret.md'), 'secret');

  const grants = new PathGrants();
  grants.grant(selected, { kind: 'directory', access: ['read', 'write', 'asset'] });
  fs.symlinkSync(outside, path.join(selected, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');

  assert.equal(grants.allows(path.join(selected, 'escape', 'secret.md'), 'read'), false);
  assert.equal(grants.allows(path.join(selected, 'escape', 'new.md'), 'write'), false);
});

test('a dangling file symlink cannot create a write target outside a granted folder', (t) => {
  const root = withTempDir(t);
  const selected = path.join(root, 'selected');
  const outside = path.join(root, 'outside');
  const outsideFile = path.join(outside, 'created.md');
  const danglingLink = path.join(selected, 'draft.md');
  fs.mkdirSync(selected);
  fs.mkdirSync(outside);
  fs.symlinkSync(outsideFile, danglingLink, 'file');

  const grants = new PathGrants();
  grants.grant(selected, { kind: 'directory', access: ['write'] });

  const guardedWrite = (target, content) => {
    if (!grants.allows(target, 'write')) return false;
    fs.writeFileSync(target, content);
    return true;
  };

  assert.equal(guardedWrite(danglingLink, '# escaped'), false);
  assert.equal(fs.existsSync(outsideFile), false);
});

test('a dangling directory symlink and its future descendants stay outside a write grant', (t) => {
  const root = withTempDir(t);
  const selected = path.join(root, 'selected');
  const missingOutsideDirectory = path.join(root, 'outside', 'future');
  const danglingDirectory = path.join(selected, 'escape');
  const writeTarget = path.join(danglingDirectory, 'nested', 'created.md');
  fs.mkdirSync(selected);
  fs.mkdirSync(path.dirname(missingOutsideDirectory));
  fs.symlinkSync(missingOutsideDirectory, danglingDirectory, process.platform === 'win32' ? 'junction' : 'dir');

  const grants = new PathGrants();
  grants.grant(selected, { kind: 'directory', access: ['write'] });

  assert.equal(grants.allows(danglingDirectory, 'write'), false);
  assert.equal(grants.allows(writeTarget, 'write'), false);
  assert.equal(fs.existsSync(missingOutsideDirectory), false);
});

test('canonicalization errors other than a missing path fail closed', () => {
  const deniedPath = '/selected/blocked.md';
  const realpathSync = (input) => {
    if (input === deniedPath) {
      const error = new Error('permission denied');
      error.code = 'EACCES';
      throw error;
    }
    return input;
  };
  const lstatSync = () => {
    const error = new Error('permission denied');
    error.code = 'EACCES';
    throw error;
  };
  const grants = new PathGrants({ fsImpl: { realpathSync, lstatSync }, pathImpl: path.posix });

  grants.grant('/selected', { kind: 'directory', access: ['write'] });
  assert.equal(grants.allows(deniedPath, 'write'), false);
});

test('granting a POSIX filesystem root includes descendants', (t) => {
  const root = withTempDir(t);
  const note = path.join(root, 'note.md');
  fs.writeFileSync(note, '# note');

  const grants = new PathGrants();
  const filesystemRoot = path.parse(root).root;
  assert.equal(grants.grant(filesystemRoot, { kind: 'directory', access: ['read'] }).ok, true);
  assert.equal(grants.allows(note, 'read'), true);
});

test('Windows drive and UNC roots include descendants without granting siblings', () => {
  const realpathSync = (input) => input;
  const grants = new PathGrants({ fsImpl: { realpathSync }, pathImpl: path.win32 });

  assert.equal(grants.grant('D:\\', { kind: 'directory', access: ['read'] }).ok, true);
  assert.equal(grants.allows('D:\\notes\\doc.md', 'read'), true);
  assert.equal(grants.allows('E:\\notes\\doc.md', 'read'), false);

  assert.equal(grants.grant('\\\\server\\share\\', { kind: 'directory', access: ['asset'] }).ok, true);
  assert.equal(grants.allows('\\\\server\\share\\images\\figure.png', 'asset'), true);
  assert.equal(grants.allows('\\\\server\\other\\figure.png', 'asset'), false);
});
