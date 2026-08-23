'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

function loadFileTree() {
  global.throttle = (fn) => fn;
  delete require.cache[require.resolve('../../renderer/js/panels')];
  return require('../../renderer/js/panels').FileTree;
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

test('canceling a dirty-file deletion keeps both the tab and disk file', async () => {
  const FileTree = loadFileTree();
  let trashed = false;
  let closed = false;
  global.App = {
    tabs: [{ path: '/notes/a.md', dirty: true, kind: 'document' }],
    _confirm: async () => 'cancel',
    save: async () => true,
    closeTabByPath: async () => { closed = true; },
  };
  global.ink = { trash: async () => { trashed = true; return { ok: true }; } };
  global.P = { dirname: () => '/notes' };
  global.toast = () => {};

  await FileTree._delete({ path: '/notes/a.md', name: 'a.md', isDir: false });

  assert.equal(trashed, false);
  assert.equal(closed, false);
});

test('trash failure leaves an open dirty tab and its recovery state intact', async () => {
  const FileTree = loadFileTree();
  let closed = false;
  global.App = {
    tabs: [{ path: '/notes/a.md', dirty: true, kind: 'document' }],
    _confirm: async () => 'discard',
    save: async () => true,
    closeTabByPath: async () => { closed = true; },
  };
  global.ink = { trash: async () => ({ ok: false, error: 'busy' }) };
  global.P = { dirname: () => '/notes' };
  global.toast = () => {};

  await FileTree._delete({ path: '/notes/a.md', name: 'a.md', isDir: false });

  assert.equal(closed, false);
  assert.equal(global.App.tabs[0].dirty, true);
});

test('a successful trash closes affected tabs only after the file moved', async () => {
  const FileTree = loadFileTree();
  const order = [];
  global.App = {
    tabs: [{ path: '/notes/a.md', dirty: false, kind: 'document' }],
    _confirm: async () => 'discard',
    save: async () => true,
    closeTabByPath: async (path, force) => { order.push(`close:${path}:${force}`); return true; },
  };
  global.ink = { trash: async () => { order.push('trash'); return { ok: true }; } };
  global.P = { dirname: () => '/notes' };
  global.toast = () => {};
  FileTree.render = async () => {};

  await FileTree._delete({ path: '/notes/a.md', name: 'a.md', isDir: false });

  assert.deepEqual(order, ['trash', 'close:/notes/a.md:true']);
});

test('recovery cleanup failure after trash keeps the tab visible and reports incomplete deletion', async () => {
  const FileTree = loadFileTree();
  const messages = [];
  const tab = { path: '/notes/a.md', dirty: false, kind: 'document' };
  global.App = {
    tabs: [tab],
    _suspendTabWrites: async () => {},
    _resumeTabWrites: (target) => { target.resumed = true; },
    _markExternalConflict: (target, kind) => { target.conflict = { kind }; },
    closeTabByPath: async () => false,
  };
  global.ink = { trash: async () => ({ ok: true }) };
  global.P = { normalize: (value) => value, dirname: () => '/notes' };
  global.toast = (message) => { messages.push(message); };
  FileTree.render = async () => {};

  assert.equal(await FileTree._delete({ path: '/notes/a.md', name: 'a.md', isDir: false }), false);
  assert.deepEqual(global.App.tabs, [tab]);
  assert.equal(tab.resumed, true);
  assert.deepEqual(tab.conflict, { kind: 'deleted' });
  assert.equal(messages.some((message) => message.includes('恢复记录')), true);
});

test('deletion pauses new writes and waits for the current save before moving the file to trash', async () => {
  const FileTree = loadFileTree();
  const saveFinished = deferred();
  const order = [];
  const tab = { path: '/notes/a.md', dirty: false, kind: 'document' };
  global.App = {
    tabs: [tab],
    _suspendTabWrites: async (target) => {
      assert.equal(target, tab);
      order.push('wait-save');
      await saveFinished.promise;
      order.push('save-finished');
    },
    closeTabByPath: async () => { order.push('close'); return true; },
  };
  global.ink = { trash: async () => { order.push('trash'); return { ok: true }; } };
  global.P = { normalize: (value) => value, dirname: () => '/notes' };
  global.toast = () => {};
  FileTree.render = async () => {};

  const deleting = FileTree._delete({ path: '/notes/a.md', name: 'a.md', isDir: false });
  await Promise.resolve();
  assert.deepEqual(order, ['wait-save']);

  saveFinished.resolve();
  assert.equal(await deleting, true);
  assert.deepEqual(order, ['wait-save', 'save-finished', 'trash', 'close']);
});

test('trash failure resumes writes that were suspended for deletion', async () => {
  const FileTree = loadFileTree();
  const tab = { path: '/notes/a.md', dirty: true, kind: 'document' };
  let resumed = false;
  global.App = {
    tabs: [tab],
    _confirm: async () => 'discard',
    _suspendTabWrites: async () => {},
    _resumeTabWrites: (target) => { assert.equal(target, tab); resumed = true; },
  };
  global.ink = { trash: async () => ({ ok: false, error: 'busy' }) };
  global.P = { normalize: (value) => value, dirname: () => '/notes' };
  global.toast = () => {};

  assert.equal(await FileTree._delete({ path: '/notes/a.md', name: 'a.md', isDir: false }), false);
  assert.equal(resumed, true);
});

test('save then delete aborts if the tab is still dirty after save', async () => {
  const FileTree = loadFileTree();
  const tab = { path: '/notes/a.md', dirty: true, kind: 'document' };
  let trashed = false;
  global.App = {
    tabs: [tab],
    _confirm: async () => 'save',
    save: async () => true,
  };
  global.ink = { trash: async () => { trashed = true; return { ok: true }; } };
  global.P = { normalize: (value) => value, dirname: () => '/notes' };
  global.toast = () => {};

  assert.equal(await FileTree._delete({ path: '/notes/a.md', name: 'a.md', isDir: false }), false);
  assert.equal(trashed, false);
});

test('input typed while trash is pending stays open as a recoverable deleted conflict', async () => {
  const FileTree = loadFileTree();
  const trash = deferred();
  const tab = { path: '/notes/a.md', cachedValue: 'confirmed content', dirty: true, kind: 'document' };
  const messages = [];
  let closed = false;
  let resumed = false;
  global.App = {
    tabs: [tab],
    _confirm: async () => 'discard',
    _tabValue: (target) => target.cachedValue,
    _suspendTabWrites: async () => {},
    _resumeTabWrites: () => { resumed = true; },
    _markExternalConflict: (target, kind) => { target.conflict = { kind }; target.dirty = true; },
    closeTabByPath: async () => { closed = true; return true; },
  };
  global.ink = { trash: () => trash.promise };
  global.P = { normalize: (value) => value, dirname: () => '/notes' };
  global.toast = (message) => messages.push(message);
  FileTree.render = async () => {};

  const deleting = FileTree._delete({ path: tab.path, name: 'a.md', isDir: false });
  await new Promise((resolve) => setImmediate(resolve));
  tab.cachedValue = 'typed while trash pending';
  trash.resolve({ ok: true });

  assert.equal(await deleting, false);
  assert.equal(closed, false);
  assert.deepEqual(global.App.tabs, [tab]);
  assert.deepEqual(tab.conflict, { kind: 'deleted' });
  assert.equal(resumed, true);
  assert.equal(messages.some((message) => message.includes('新的修改')), true);
});
