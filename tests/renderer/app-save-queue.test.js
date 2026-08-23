'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const App = require('../../renderer/js/app');

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

async function flushPromises() {
  await new Promise((resolve) => setImmediate(resolve));
}

test('same-document autosaves are serialized and the later write uses the completed disk baseline', async () => {
  const original = {
    tabs: App.tabs,
    active: App.active,
    tabValue: App._tabValue,
    finishSuccessfulWrite: App._finishSuccessfulWrite,
  };
  const tab = {
    key: '/notes/doc.md',
    path: '/notes/doc.md',
    name: 'doc.md',
    dirty: true,
    cachedValue: 'first edit',
    savedValue: 'saved',
    diskValue: 'saved',
  };
  const writes = [];

  global.ink = {
    writeFile(path, content, options) {
      const pending = deferred();
      writes.push({ path, content, options, pending });
      return pending.promise;
    },
  };

  try {
    App.tabs = [tab];
    App.active = 0;
    App._tabValue = () => tab.cachedValue;
    App._finishSuccessfulWrite = async (target, content) => {
      target.diskValue = content;
      target.savedValue = content;
      target.dirty = target.cachedValue !== content;
    };

    const first = App._autoSave(tab.key);
    await flushPromises();
    assert.equal(writes.length, 1);

    tab.cachedValue = 'second edit';
    tab.dirty = true;
    const second = App._autoSave(tab.key);
    await flushPromises();

    assert.equal(writes.length, 1, 'the second write must wait for the first write');
    writes[0].pending.resolve({ ok: true });
    await flushPromises();

    assert.equal(writes.length, 2);
    assert.equal(writes[1].content, 'second edit');
    assert.deepEqual(writes[1].options, { expectedContent: 'first edit' });

    writes[1].pending.resolve({ ok: true });
    assert.deepEqual(await Promise.all([first, second]), [true, true]);
  } finally {
    App.tabs = original.tabs;
    App.active = original.active;
    App._tabValue = original.tabValue;
    App._finishSuccessfulWrite = original.finishSuccessfulWrite;
    delete global.ink;
  }
});

test('force-closing a tab waits for an in-flight save before destroying it', async () => {
  const original = {
    tabs: App.tabs,
    active: App.active,
    tabValue: App._tabValue,
    finishSuccessfulWrite: App._finishSuccessfulWrite,
    clearRecovery: App._clearRecovery,
    renderTabs: App._renderTabs,
    syncWelcome: App._syncWelcome,
    updateStatus: App.updateStatus,
    syncFileWatchers: App._syncFileWatchers,
    persistSession: App._persistSession,
  };
  const write = deferred();
  const tab = {
    key: '/notes/doc.md',
    path: '/notes/doc.md',
    name: 'doc.md',
    dirty: true,
    cachedValue: 'local edit',
    savedValue: 'saved',
    diskValue: 'saved',
  };
  let destroyed = false;

  global.ink = {
    writeFile: () => write.promise,
    setWindowFile: () => {},
  };
  global.Editor = {
    destroy: () => { destroyed = true; },
    clearActive: () => {},
  };
  global.Outline = { render: () => {} };
  global.FileTree = { markActive: () => {} };

  try {
    App.tabs = [tab];
    App.active = 0;
    App._tabValue = () => tab.cachedValue;
    App._finishSuccessfulWrite = async () => {};
    App._clearRecovery = async () => true;
    App._renderTabs = () => {};
    App._syncWelcome = () => {};
    App.updateStatus = () => {};
    App._syncFileWatchers = async () => true;
    App._persistSession = () => {};

    const saving = App._autoSave(tab.key);
    await flushPromises();
    const closing = App.closeTab(0, true);
    await flushPromises();

    assert.equal(destroyed, false);
    assert.equal(App.tabs.includes(tab), true);

    write.resolve({ ok: true });
    assert.equal(await saving, true);
    assert.equal(await closing, true);
    assert.equal(destroyed, true);
    assert.equal(App.tabs.includes(tab), false);
  } finally {
    App.tabs = original.tabs;
    App.active = original.active;
    App._tabValue = original.tabValue;
    App._finishSuccessfulWrite = original.finishSuccessfulWrite;
    App._clearRecovery = original.clearRecovery;
    App._renderTabs = original.renderTabs;
    App._syncWelcome = original.syncWelcome;
    App.updateStatus = original.updateStatus;
    App._syncFileWatchers = original.syncFileWatchers;
    App._persistSession = original.persistSession;
    delete global.ink;
    delete global.Editor;
    delete global.Outline;
    delete global.FileTree;
  }
});

test('manual save does not report completion when its recovery cleanup fails', async () => {
  const original = {
    tabs: App.tabs,
    active: App.active,
    tabValue: App._tabValue,
    finishSuccessfulWrite: App._finishSuccessfulWrite,
    syncFileWatchers: App._syncFileWatchers,
    persistSession: App._persistSession,
  };
  const tab = {
    key: '/notes/doc.md',
    path: '/notes/doc.md',
    name: 'doc.md',
    dirty: true,
    cachedValue: 'local edit',
    savedValue: 'saved',
    diskValue: 'saved',
    recoveryKey: 'file:/notes/doc.md',
  };

  global.ink = { writeFile: async () => ({ ok: true }) };
  global.P = { normalize: (value) => value };

  try {
    App.tabs = [tab];
    App.active = 0;
    App._tabValue = () => tab.cachedValue;
    App._finishSuccessfulWrite = async () => false;
    App._syncFileWatchers = async () => true;
    App._persistSession = () => {};

    assert.equal(await App.save(0), false);
  } finally {
    App.tabs = original.tabs;
    App.active = original.active;
    App._tabValue = original.tabValue;
    App._finishSuccessfulWrite = original.finishSuccessfulWrite;
    App._syncFileWatchers = original.syncFileWatchers;
    App._persistSession = original.persistSession;
    delete global.ink;
    delete global.P;
  }
});

test('manual save reports incomplete when newer edits remain after the disk write', async () => {
  const original = {
    tabs: App.tabs,
    active: App.active,
    tabValue: App._tabValue,
    finishSuccessfulWrite: App._finishSuccessfulWrite,
    syncFileWatchers: App._syncFileWatchers,
    persistSession: App._persistSession,
  };
  const tab = {
    key: '/notes/doc.md', path: '/notes/doc.md', name: 'doc.md', dirty: true,
    cachedValue: 'first edit', savedValue: 'saved', diskValue: 'saved',
  };
  global.ink = { writeFile: async () => ({ ok: true }) };
  global.P = { normalize: (value) => value };
  try {
    App.tabs = [tab];
    App.active = 0;
    App._tabValue = () => tab.cachedValue;
    App._finishSuccessfulWrite = async () => {
      tab.savedValue = 'first edit';
      tab.cachedValue = 'typed during save';
      tab.dirty = true;
      return true;
    };
    App._syncFileWatchers = async () => true;
    App._persistSession = () => {};

    assert.equal(await App.save(0), false);
    assert.equal(tab.dirty, true);
  } finally {
    App.tabs = original.tabs;
    App.active = original.active;
    App._tabValue = original.tabValue;
    App._finishSuccessfulWrite = original.finishSuccessfulWrite;
    App._syncFileWatchers = original.syncFileWatchers;
    App._persistSession = original.persistSession;
    delete global.ink;
    delete global.P;
  }
});

test('external-change scans wait for an in-flight write before comparing disk baselines', async () => {
  const original = {
    tabs: App.tabs,
    active: App.active,
    tabValue: App._tabValue,
    renderTabs: App._renderTabs,
    updateStatus: App.updateStatus,
    acceptDiskVersion: App._acceptDiskVersion,
  };
  const saving = deferred();
  const tab = {
    key: '/notes/doc.md',
    path: '/notes/doc.md',
    name: 'doc.md',
    dirty: true,
    cachedValue: 'newer edit',
    savedValue: 'saved',
    diskValue: 'saved',
    _saveTail: saving.promise,
  };
  let diskRead = false;

  global.DocumentSafety = require('../../renderer/js/document-safety');
  global.ink = {
    exists: async () => { diskRead = true; return true; },
    readFile: async () => ({ ok: true, content: 'first edit' }),
  };
  global.toast = () => {};

  try {
    App.tabs = [tab];
    App.active = 0;
    App._tabValue = () => tab.cachedValue;
    App._renderTabs = () => {};
    App.updateStatus = () => {};

    const scanning = App._scanOpenDocumentsOnce();
    await flushPromises();
    assert.equal(diskRead, false);

    tab.savedValue = 'first edit';
    tab.diskValue = 'first edit';
    saving.resolve();
    await scanning;

    assert.equal(diskRead, true);
    assert.equal(tab.conflict, undefined);
    assert.equal(tab.dirty, true);
  } finally {
    App.tabs = original.tabs;
    App.active = original.active;
    App._tabValue = original.tabValue;
    App._renderTabs = original.renderTabs;
    App.updateStatus = original.updateStatus;
    delete global.DocumentSafety;
    delete global.ink;
    delete global.toast;
  }
});

test('a first-save write failure leaves the untitled tab identity untouched', async () => {
  const original = {
    tabs: App.tabs,
    active: App.active,
    tabValue: App._tabValue,
    enqueue: App._enqueueTabSave,
  };
  const tab = { key: 'untitled:1', path: null, name: '未命名.md', dirty: true, cachedValue: '# draft' };
  let rekeyed = false;
  global.P = { basename: (value) => value.split('/').pop(), normalize: (value) => value };
  global.Editor = { rekey: () => { rekeyed = true; } };
  global.FileTree = { refresh: () => {} };
  global.toast = () => {};
  global.ink = {
    saveAsDialog: async () => '/notes/new.md',
    writeFile: async () => ({ ok: false, error: 'disk full' }),
  };
  try {
    App.tabs = [tab];
    App.active = 0;
    App._tabValue = () => tab.cachedValue;
    App._enqueueTabSave = (target, work) => work();

    assert.equal(await App.save(0), false);
    assert.deepEqual({ key: tab.key, path: tab.path, name: tab.name }, {
      key: 'untitled:1', path: null, name: '未命名.md',
    });
    assert.equal(rekeyed, false);
  } finally {
    App.tabs = original.tabs;
    App.active = original.active;
    App._tabValue = original.tabValue;
    App._enqueueTabSave = original.enqueue;
    delete global.P;
    delete global.Editor;
    delete global.FileTree;
    delete global.toast;
    delete global.ink;
  }
});

test('an external scan discards a stale read when a save completes during that read', async () => {
  const original = {
    tabs: App.tabs,
    active: App.active,
    tabValue: App._tabValue,
    renderTabs: App._renderTabs,
    updateStatus: App.updateStatus,
  };
  const read = deferred();
  const tab = {
    key: '/notes/doc.md', path: '/notes/doc.md', name: 'doc.md',
    dirty: false, cachedValue: 'new saved', savedValue: 'old', diskValue: 'old',
  };
  let accepted = false;
  global.DocumentSafety = require('../../renderer/js/document-safety');
  global.ink = {
    exists: async () => true,
    readFile: async () => read.promise,
  };
  try {
    App.tabs = [tab];
    App.active = 0;
    App._tabValue = () => tab.cachedValue;
    App._renderTabs = () => {};
    App.updateStatus = () => {};
    App._acceptDiskVersion = async () => { accepted = true; };
    App._fsScanQueued = false;
    const scanning = App._scanOpenDocumentsOnce();
    await flushPromises();
    tab.diskValue = 'new saved';
    tab.savedValue = 'new saved';
    read.resolve({ ok: true, content: 'old' });
    await scanning;
    assert.equal(accepted, false);
    assert.equal(App._fsScanQueued, true);
  } finally {
    App.tabs = original.tabs;
    App.active = original.active;
    App._tabValue = original.tabValue;
    App._renderTabs = original.renderTabs;
    App.updateStatus = original.updateStatus;
    App._acceptDiskVersion = original.acceptDiskVersion;
    delete global.DocumentSafety;
    delete global.ink;
  }
});
