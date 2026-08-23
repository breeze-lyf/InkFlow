'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function fakeClassList(initiallyHidden = true) {
  const values = new Set(initiallyHidden ? ['hidden'] : []);
  return {
    add: (value) => values.add(value),
    remove: (value) => values.delete(value),
    contains: (value) => values.has(value),
  };
}

function loadOverlay() {
  delete require.cache[require.resolve('../../renderer/js/overlay')];
  return require('../../renderer/js/overlay');
}

test('closing quick open invalidates a pending library request', async () => {
  const folderFiles = deferred();
  const recentFiles = deferred();
  const overlayNode = { classList: fakeClassList() };
  const input = { value: '', placeholder: '', focus: () => {} };
  const Overlay = loadOverlay();
  let filtered = 0;

  global.$ = (selector) => (selector === '#overlay' ? overlayNode : input);
  global.App = {
    folder: '/notes',
    activeTab: () => null,
    openFile: () => {},
    openFileDialog: () => {},
    openFolderDialog: () => {},
  };
  global.Editor = { ready: false };
  global.ink = {
    walkMd: () => folderFiles.promise,
    getRecent: () => recentFiles.promise,
  };
  global.QuickOpen = { buildItems: () => [{ title: 'late library result' }] };

  try {
    Overlay._filter = () => { filtered += 1; };
    const opening = Overlay.open('quick');
    Overlay.close();
    folderFiles.resolve([{ path: '/notes/late.md' }]);
    recentFiles.resolve({ files: [] });

    assert.equal(await opening, false);
    assert.equal(Overlay.mode, null);
    assert.equal(filtered, 0);
    assert.deepEqual(Overlay.items, []);
  } finally {
    delete global.$;
    delete global.App;
    delete global.Editor;
    delete global.ink;
    delete global.QuickOpen;
  }
});

test('a late quick-open request cannot replace a newer command palette', async () => {
  const folderFiles = deferred();
  const recentFiles = deferred();
  const overlayNode = { classList: fakeClassList() };
  const input = { value: '', placeholder: '', focus: () => {} };
  const Overlay = loadOverlay();
  const commands = [{ title: 'current command' }];

  global.$ = (selector) => (selector === '#overlay' ? overlayNode : input);
  global.App = {
    folder: '/notes',
    commands: () => commands,
    openFile: () => {},
    openFileDialog: () => {},
    openFolderDialog: () => {},
  };
  global.Editor = { ready: false };
  global.ink = {
    walkMd: () => folderFiles.promise,
    getRecent: () => recentFiles.promise,
  };
  global.QuickOpen = { buildItems: () => [{ title: 'stale file' }] };

  try {
    Overlay._filter = () => {};
    const quick = Overlay.open('quick');
    assert.equal(await Overlay.open('palette'), true);

    folderFiles.resolve([{ path: '/notes/stale.md' }]);
    recentFiles.resolve({ files: [] });

    assert.equal(await quick, false);
    assert.equal(Overlay.mode, 'palette');
    assert.equal(overlayNode.classList.contains('hidden'), false);
    assert.equal(Overlay.items, commands);
  } finally {
    delete global.$;
    delete global.App;
    delete global.Editor;
    delete global.ink;
    delete global.QuickOpen;
  }
});

test('a hidden overlay ignores a pending quick-open result even if its mode did not change', async () => {
  const folderFiles = deferred();
  const recentFiles = deferred();
  const overlayNode = { classList: fakeClassList() };
  const input = { value: '', placeholder: '', focus: () => {} };
  const Overlay = loadOverlay();

  global.$ = (selector) => (selector === '#overlay' ? overlayNode : input);
  global.App = {
    folder: '/notes',
    openFile: () => {},
    openFileDialog: () => {},
    openFolderDialog: () => {},
  };
  global.ink = {
    walkMd: () => folderFiles.promise,
    getRecent: () => recentFiles.promise,
  };
  global.QuickOpen = { buildItems: () => [{ title: 'late file' }] };

  try {
    Overlay._filter = () => {};
    const opening = Overlay.open('quick');
    overlayNode.classList.add('hidden');
    folderFiles.resolve([{ path: '/notes/late.md' }]);
    recentFiles.resolve({ files: [] });

    assert.equal(await opening, false);
    assert.deepEqual(Overlay.items, []);
  } finally {
    delete global.$;
    delete global.App;
    delete global.ink;
    delete global.QuickOpen;
  }
});

test('quick open keeps recent files and commands when the library walk fails', async () => {
  const overlayNode = { classList: fakeClassList() };
  let focused = 0;
  const input = { value: '', placeholder: '', focus: () => { focused += 1; } };
  const Overlay = loadOverlay();
  const oldSetTimeout = global.setTimeout;

  global.$ = (selector) => (selector === '#overlay' ? overlayNode : input);
  global.App = {
    folder: '/notes',
    openFile: () => {},
    openFileDialog: () => {},
    openFolderDialog: () => {},
  };
  global.ink = {
    walkMd: () => { throw new Error('library disappeared'); },
    getRecent: async () => ({ files: ['/recent/a.md'] }),
  };
  global.QuickOpen = require('../../renderer/js/quick-open');
  global.setTimeout = (callback) => { callback(); return 1; };

  try {
    Overlay._filter = () => {};
    assert.equal(await Overlay.open('quick'), true);
    assert.deepEqual(Overlay.items.map((item) => item.title), ['a.md', '打开文件…', '打开文件夹…']);
    assert.equal(focused, 1);
  } finally {
    global.setTimeout = oldSetTimeout;
    delete global.$;
    delete global.App;
    delete global.ink;
    delete global.QuickOpen;
  }
});

test('quick open keeps library files and commands when recent lookup fails', async () => {
  const overlayNode = { classList: fakeClassList() };
  let focused = 0;
  const input = { value: '', placeholder: '', focus: () => { focused += 1; } };
  const Overlay = loadOverlay();
  const oldSetTimeout = global.setTimeout;

  global.$ = (selector) => (selector === '#overlay' ? overlayNode : input);
  global.App = {
    folder: '/notes',
    openFile: () => {},
    openFileDialog: () => {},
    openFolderDialog: () => {},
  };
  global.ink = {
    walkMd: async () => [{ path: '/notes/b.md', name: 'b.md', rel: 'b.md' }],
    getRecent: async () => { throw new Error('recent entry vanished'); },
  };
  global.QuickOpen = require('../../renderer/js/quick-open');
  global.setTimeout = (callback) => { callback(); return 1; };

  try {
    Overlay._filter = () => {};
    assert.equal(await Overlay.open('quick'), true);
    assert.deepEqual(Overlay.items.map((item) => item.title), ['b.md', '打开文件…', '打开文件夹…']);
    assert.equal(focused, 1);
  } finally {
    global.setTimeout = oldSetTimeout;
    delete global.$;
    delete global.App;
    delete global.ink;
    delete global.QuickOpen;
  }
});
