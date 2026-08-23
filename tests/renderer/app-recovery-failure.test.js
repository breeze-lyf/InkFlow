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

test('failed recovery removal keeps the tab recovery key for a later retry', async () => {
  const originalNotify = App._notifyPersistenceError;
  const tab = { key: '/notes/a.md', path: '/notes/a.md', recoveryKey: 'file:/notes/a.md' };
  let notified = false;

  global.ink = { removeRecovery: async () => ({ ok: false, error: 'disk full' }) };
  try {
    App._notifyPersistenceError = () => { notified = true; };

    assert.equal(await App._clearRecovery(tab), false);
    assert.equal(tab.recoveryKey, 'file:/notes/a.md');
    assert.equal(notified, true);
  } finally {
    App._notifyPersistenceError = originalNotify;
    delete global.ink;
  }
});

test('closing is blocked when its recovery record cannot be cleared', async () => {
  const original = {
    tabs: App.tabs,
    active: App.active,
    clearRecovery: App._clearRecovery,
  };
  const tab = {
    key: '/notes/a.md', path: '/notes/a.md', name: 'a.md', dirty: true, recoveryKey: 'file:/notes/a.md',
  };
  let destroyed = false;

  global.Editor = { destroy: () => { destroyed = true; } };
  try {
    App.tabs = [tab];
    App.active = 0;
    App._clearRecovery = async () => false;

    assert.equal(await App.closeTab(0, true), false);
    assert.equal(destroyed, false);
    assert.deepEqual(App.tabs, [tab]);
  } finally {
    App.tabs = original.tabs;
    App.active = original.active;
    App._clearRecovery = original.clearRecovery;
    delete global.Editor;
  }
});

test('quit is blocked when recovery cleanup fails', async () => {
  const original = {
    tabs: App.tabs,
    clearAllRecovery: App._clearAllRecovery,
    persistSession: App._persistSession,
  };
  let confirmed = false;

  global.ink = { confirmClose: () => { confirmed = true; } };
  try {
    App.tabs = [];
    App._clearAllRecovery = async () => false;
    App._persistSession = () => {};

    assert.equal(await App._tryQuit(), false);
    assert.equal(confirmed, false);
  } finally {
    App.tabs = original.tabs;
    App._clearAllRecovery = original.clearAllRecovery;
    App._persistSession = original.persistSession;
    delete global.ink;
  }
});

test('closing a preview does not fabricate a recovery record that can block closing', async () => {
  const original = {
    tabs: App.tabs,
    active: App.active,
    clearRecovery: App._clearRecovery,
    renderTabs: App._renderTabs,
    syncFileWatchers: App._syncFileWatchers,
    persistSession: App._persistSession,
  };
  const tab = { key: 'preview:/notes/image.png', path: '/notes/image.png', kind: 'preview', dirty: false };
  let destroyed = false;

  global.Editor = { destroy: () => { destroyed = true; } };
  try {
    App.tabs = [tab];
    App.active = -1;
    App._clearRecovery = async () => false;
    App._renderTabs = () => {};
    App._syncFileWatchers = async () => true;
    App._persistSession = () => {};

    assert.equal(await App.closeTab(0, true), true);
    assert.equal(destroyed, true);
    assert.equal(tab.recoveryKey, undefined);
  } finally {
    App.tabs = original.tabs;
    App.active = original.active;
    App._clearRecovery = original.clearRecovery;
    App._renderTabs = original.renderTabs;
    App._syncFileWatchers = original.syncFileWatchers;
    App._persistSession = original.persistSession;
    delete global.Editor;
  }
});

test('a new recovery write started during removal keeps its recovery key', async () => {
  const original = {
    tabValue: App._tabValue,
    active: App.active,
    tabs: App.tabs,
  };
  const removal = deferred();
  const save = deferred();
  const tab = {
    key: '/notes/a.md',
    path: '/notes/a.md',
    name: 'a.md',
    cachedValue: 'new edit',
    savedValue: 'saved',
    diskValue: 'saved',
    recoveryKey: 'file:/notes/a.md',
  };
  let removeStarted = false;
  let saveStarted = false;

  global.ink = {
    removeRecovery: () => { removeStarted = true; return removal.promise; },
    saveRecovery: () => { saveStarted = true; return save.promise; },
  };

  try {
    App.tabs = [tab];
    App.active = 0;
    App._tabValue = () => tab.cachedValue;

    const clearing = App._clearRecovery(tab);
    await flushPromises();
    assert.equal(removeStarted, true);

    const writing = App._writeRecovery(tab);
    removal.resolve({ ok: true });
    assert.equal(await clearing, true);
    await flushPromises();

    assert.equal(saveStarted, true);
    assert.equal(tab.recoveryKey, 'file:/notes/a.md');
    save.resolve({ ok: true });
    assert.equal(await writing, true);
    assert.equal(tab.recoveryKey, 'file:/notes/a.md');
  } finally {
    App._tabValue = original.tabValue;
    App.active = original.active;
    App.tabs = original.tabs;
    delete global.ink;
  }
});

test('save and quit aborts when a document is still dirty after its save resolves', async () => {
  const original = {
    tabs: App.tabs,
    confirm: App._confirm,
    save: App.save,
    clearAllRecovery: App._clearAllRecovery,
  };
  const tab = { key: '/notes/a.md', path: '/notes/a.md', name: 'a.md', dirty: true };
  let cleared = false;
  let confirmed = false;
  global.ink = { confirmClose: () => { confirmed = true; } };
  try {
    App.tabs = [tab];
    App._confirm = async () => 'save';
    App.save = async () => true;
    App._clearAllRecovery = async () => { cleared = true; return true; };

    assert.equal(await App._tryQuit(), false);
    assert.equal(cleared, false);
    assert.equal(confirmed, false);
  } finally {
    App.tabs = original.tabs;
    App._confirm = original.confirm;
    App.save = original.save;
    App._clearAllRecovery = original.clearAllRecovery;
    delete global.ink;
  }
});
