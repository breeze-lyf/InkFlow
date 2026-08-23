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

test('autosave uses the exact disk baseline and stops when compare-and-swap detects a conflict', async () => {
  const original = {
    tabs: App.tabs,
    active: App.active,
    tabValue: App._tabValue,
    scheduleRecovery: App._scheduleRecovery,
    renderTabs: App._renderTabs,
    updateStatus: App.updateStatus,
  };
  const tab = {
    key: '/notes/doc.md',
    path: '/notes/doc.md',
    name: 'doc.md',
    dirty: true,
    cachedValue: 'local edit\n',
    savedValue: 'saved\n',
    diskValue: 'saved',
  };
  let writeOptions;
  let recoveryScheduled = false;

  global.ink = {
    writeFile: async (path, content, options) => {
      assert.equal(path, tab.path);
      assert.equal(content, tab.cachedValue);
      writeOptions = options;
      return { ok: false, conflict: true, exists: true, diskContent: 'external edit' };
    },
  };
  global.toast = () => {};

  try {
    App.tabs = [tab];
    App.active = 0;
    App._tabValue = () => tab.cachedValue;
    App._scheduleRecovery = () => { recoveryScheduled = true; };
    App._renderTabs = () => {};
    App.updateStatus = () => {};

    await App._autoSave(tab.key);

    assert.deepEqual(writeOptions, { expectedContent: 'saved' });
    assert.deepEqual(tab.conflict, { kind: 'changed', diskContent: 'external edit' });
    assert.equal(tab.dirty, true);
    assert.equal(tab.savedValue, 'saved\n');
    assert.equal(tab.diskValue, 'saved');
    assert.equal(recoveryScheduled, true);
  } finally {
    App.tabs = original.tabs;
    App.active = original.active;
    App._tabValue = original.tabValue;
    App._scheduleRecovery = original.scheduleRecovery;
    App._renderTabs = original.renderTabs;
    App.updateStatus = original.updateStatus;
    delete global.ink;
    delete global.toast;
  }
});

test('a successful autosave keeps edits typed while the write was in flight as unsaved', async () => {
  const original = {
    tabs: App.tabs,
    active: App.active,
    tabValue: App._tabValue,
    scheduleRecovery: App._scheduleRecovery,
    scheduleAutoSave: App._scheduleAutoSave,
    renderTabs: App._renderTabs,
    updateStatus: App.updateStatus,
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
  let recoveryScheduled = false;
  let nextAutosaveScheduled = false;

  global.ink = {
    writeFile: async () => {
      tab.cachedValue = 'newer edit';
      return { ok: true };
    },
    setWindowFile: () => {},
  };
  global.P = { normalize: (value) => value };

  try {
    App.tabs = [tab];
    App.active = 0;
    App._tabValue = () => tab.cachedValue;
    App._scheduleRecovery = () => { recoveryScheduled = true; };
    App._scheduleAutoSave = () => { nextAutosaveScheduled = true; };
    App._renderTabs = () => {};
    App.updateStatus = () => {};

    await App._autoSave(tab.key);

    assert.equal(tab.diskValue, 'first edit');
    assert.equal(tab.savedValue, 'first edit');
    assert.equal(tab.cachedValue, 'newer edit');
    assert.equal(tab.dirty, true);
    assert.equal(recoveryScheduled, true);
    assert.equal(nextAutosaveScheduled, true);
  } finally {
    App.tabs = original.tabs;
    App.active = original.active;
    App._tabValue = original.tabValue;
    App._scheduleRecovery = original.scheduleRecovery;
    App._scheduleAutoSave = original.scheduleAutoSave;
    App._renderTabs = original.renderTabs;
    App.updateStatus = original.updateStatus;
    delete global.ink;
    delete global.P;
  }
});

test('loading a conflict from disk aborts when the user types during the disk read', async () => {
  const original = {
    tabs: App.tabs,
    active: App.active,
    tabValue: App._tabValue,
    waitForTabSave: App._waitForTabSave,
    acceptDiskVersion: App._acceptDiskVersion,
    scheduleRecovery: App._scheduleRecovery,
    renderTabs: App._renderTabs,
    updateStatus: App.updateStatus,
  };
  const read = deferred();
  const conflict = { kind: 'changed', diskContent: 'external edit' };
  const tab = {
    key: '/notes/doc.md',
    path: '/notes/doc.md',
    name: 'doc.md',
    dirty: true,
    cachedValue: 'local edit',
    savedValue: 'saved',
    diskValue: 'saved',
    conflict,
  };
  let liveValue = tab.cachedValue;
  let accepted = false;
  let recoveryScheduled = false;
  const messages = [];

  global.ink = {
    exists: async () => true,
    readFile: () => read.promise,
  };
  global.toast = (message) => messages.push(message);

  try {
    App.tabs = [tab];
    App.active = 0;
    App._tabValue = () => liveValue;
    App._waitForTabSave = async () => {};
    App._acceptDiskVersion = async () => { accepted = true; return true; };
    App._scheduleRecovery = () => { recoveryScheduled = true; };
    App._renderTabs = () => {};
    App.updateStatus = () => {};

    const loading = App._loadConflictDisk();
    await flushPromises();
    liveValue = 'typed after load started';
    read.resolve({ ok: true, content: 'latest disk version' });

    assert.equal(await loading, false);
    assert.equal(accepted, false);
    assert.equal(tab.conflict, conflict);
    assert.equal(tab.cachedValue, liveValue);
    assert.equal(tab.dirty, true);
    assert.equal(recoveryScheduled, true);
    assert.equal(messages.some((message) => message.includes('新的修改')), true);
  } finally {
    App.tabs = original.tabs;
    App.active = original.active;
    App._tabValue = original.tabValue;
    App._waitForTabSave = original.waitForTabSave;
    App._acceptDiskVersion = original.acceptDiskVersion;
    App._scheduleRecovery = original.scheduleRecovery;
    App._renderTabs = original.renderTabs;
    App.updateStatus = original.updateStatus;
    delete global.ink;
    delete global.toast;
  }
});

test('overwriting a conflict does not finalize a stale write after the tab path changes', async () => {
  const original = {
    tabs: App.tabs,
    active: App.active,
    tabValue: App._tabValue,
    finishSuccessfulWrite: App._finishSuccessfulWrite,
    scheduleRecovery: App._scheduleRecovery,
    persistSession: App._persistSession,
  };
  const write = deferred();
  const conflict = { kind: 'changed', diskContent: 'external edit' };
  const tab = {
    key: '/notes/old.md',
    path: '/notes/old.md',
    name: 'old.md',
    dirty: true,
    cachedValue: 'local edit',
    savedValue: 'saved',
    diskValue: 'saved',
    conflict,
  };
  const messages = [];
  let writtenPath;
  let finished = false;
  let recoveryScheduled = false;

  global.P = { normalize: (value) => value };
  global.ink = {
    writeFile: (path) => {
      writtenPath = path;
      return write.promise;
    },
  };
  global.toast = (message) => messages.push(message);

  try {
    App.tabs = [tab];
    App.active = 0;
    App._tabValue = () => tab.cachedValue;
    App._finishSuccessfulWrite = async () => { finished = true; return true; };
    App._scheduleRecovery = () => { recoveryScheduled = true; };
    App._persistSession = () => {};

    const overwriting = App._overwriteConflict();
    await flushPromises();
    assert.equal(writtenPath, '/notes/old.md');

    tab.path = '/notes/new.md';
    tab.key = '/notes/new.md';
    tab.name = 'new.md';
    write.resolve({ ok: true });

    assert.equal(await overwriting, false);
    assert.equal(finished, false);
    assert.equal(tab.conflict, conflict);
    assert.equal(tab.dirty, true);
    assert.equal(recoveryScheduled, true);
    assert.equal(messages.some((message) => message.includes('重试')), true);
    assert.equal(messages.some((message) => message.includes('已按你的选择覆盖')), false);
  } finally {
    App.tabs = original.tabs;
    App.active = original.active;
    App._tabValue = original.tabValue;
    App._finishSuccessfulWrite = original.finishSuccessfulWrite;
    App._scheduleRecovery = original.scheduleRecovery;
    App._persistSession = original.persistSession;
    delete global.P;
    delete global.ink;
    delete global.toast;
  }
});
