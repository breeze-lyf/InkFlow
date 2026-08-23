'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const App = require('../../renderer/js/app');

test('file watcher sync includes every unique editable path and excludes previews', async () => {
  const originalTabs = App.tabs;
  let watched;
  global.ink = {
    watchFiles: async (paths) => {
      watched = paths;
      return { ok: true };
    },
  };

  try {
    App.tabs = [
      { key: 'a', path: '/outside/a.md' },
      { key: 'a-duplicate', path: '/outside/a.md' },
      { key: 'preview', path: '/outside/image.png', kind: 'preview' },
      { key: 'untitled', path: null },
      { key: 'b', path: '/library/b.md' },
    ];

    const ok = await App._syncFileWatchers();

    assert.equal(ok, true);
    assert.deepEqual(watched, ['/outside/a.md', '/library/b.md']);
  } finally {
    App.tabs = originalTabs;
    delete global.ink;
  }
});

test('single-file watcher notifications reuse the external-change scanner', async () => {
  const originalScan = App.scanExternalChanges;
  const originalUnsubscribe = App._fileWatchUnsubscribe;
  let listener;
  let scans = 0;
  global.ink = {
    onFilesChanged: (callback) => {
      listener = callback;
      return () => {};
    },
  };

  try {
    App.scanExternalChanges = async () => { scans += 1; };
    App._fileWatchUnsubscribe = null;
    App._bindFileWatchEvents();
    await listener({ paths: ['/outside/a.md'] });

    assert.equal(scans, 1);
  } finally {
    App.scanExternalChanges = originalScan;
    App._fileWatchUnsubscribe = originalUnsubscribe;
    delete global.ink;
  }
});

test('renaming an open document rekeys its watcher to the new path', async () => {
  const original = {
    tabs: App.tabs,
    active: App.active,
    folder: App.folder,
    renderTabs: App._renderTabs,
    updateStatus: App.updateStatus,
    persistSession: App._persistSession,
  };
  const tab = {
    key: '/outside/old.md',
    path: '/outside/old.md',
    name: 'old.md',
    dirty: false,
  };
  let watched;

  global.P = {
    normalize: (value) => (value ? value.replace(/\\/g, '/') : value),
    basename: (value) => value.split('/').pop(),
  };
  global.Editor = { rekey: () => {} };
  global.FileTree = { setRoot: () => {} };
  global.ink = {
    watchFiles: async (paths) => {
      watched = paths;
      return { ok: true };
    },
  };

  try {
    App.tabs = [tab];
    App.active = 0;
    App.folder = null;
    App._renderTabs = () => {};
    App.updateStatus = () => {};
    App._persistSession = () => {};

    await App.onPathRenamed('/outside/old.md', '/outside/new.md');

    assert.equal(tab.key, '/outside/new.md');
    assert.equal(tab.path, '/outside/new.md');
    assert.equal(tab.name, 'new.md');
    assert.deepEqual(watched, ['/outside/new.md']);
  } finally {
    App.tabs = original.tabs;
    App.active = original.active;
    App.folder = original.folder;
    App._renderTabs = original.renderTabs;
    App.updateStatus = original.updateStatus;
    App._persistSession = original.persistSession;
    delete global.P;
    delete global.Editor;
    delete global.FileTree;
    delete global.ink;
  }
});
