'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const App = require('../../renderer/js/app');

test('moving a tab preserves the active document and persists the new order', () => {
  const original = {
    tabs: App.tabs,
    active: App.active,
    render: App._renderTabs,
    persist: App._persistSession,
  };
  const first = { key: 'a', path: '/a.md' };
  const second = { key: 'b', path: '/b.md' };
  const third = { key: 'c', path: '/c.md' };
  let persisted = false;

  try {
    App.tabs = [first, second, third];
    App.active = 0;
    App._renderTabs = () => {};
    App._persistSession = () => { persisted = true; };

    App.moveTab(0, 2);

    assert.deepEqual(App.tabs, [second, third, first]);
    assert.equal(App.active, 2);
    assert.equal(persisted, true);
  } finally {
    App.tabs = original.tabs;
    App.active = original.active;
    App._renderTabs = original.render;
    App._persistSession = original.persist;
  }
});

test('closeTab reports cancellation and closeTabByPath treats an absent tab as already closed', async () => {
  const original = {
    tabs: App.tabs,
    confirm: App._confirm,
    scheduleAutoSave: App._scheduleAutoSave,
  };
  try {
    App.tabs = [{ key: 'dirty', path: '/dirty.md', name: 'dirty.md', dirty: true }];
    App._confirm = async () => 'cancel';
    App._scheduleAutoSave = () => {};

    assert.equal(await App.closeTab(0), false);
    assert.equal(App.tabs.length, 1);
    assert.equal(await App.closeTabByPath('/not-open.md'), true);
  } finally {
    App.tabs = original.tabs;
    App._confirm = original.confirm;
    App._scheduleAutoSave = original.scheduleAutoSave;
  }
});

test('close others uses the normal close path in reverse order and reactivates the kept tab object', async () => {
  const original = {
    tabs: App.tabs,
    active: App.active,
    closeTab: App.closeTab,
    activate: App.activate,
  };
  const first = { key: 'first' };
  const kept = { key: 'kept' };
  const third = { key: 'third' };
  const fourth = { key: 'fourth' };
  const closed = [];
  let activated = -1;

  try {
    App.tabs = [first, kept, third, fourth];
    App.active = 3;
    App.closeTab = async (index) => {
      closed.push(App.tabs[index]);
      App.tabs.splice(index, 1);
      return true;
    };
    App.activate = async (index) => {
      activated = index;
      App.active = index;
    };

    assert.equal(await App._closeOthers(1), true);
    assert.deepEqual(closed, [fourth, third, first]);
    assert.deepEqual(App.tabs, [kept]);
    assert.equal(activated, 0);
  } finally {
    App.tabs = original.tabs;
    App.active = original.active;
    App.closeTab = original.closeTab;
    App.activate = original.activate;
  }
});

test('canceling close others stops further closes and still locates the kept tab by identity', async () => {
  const original = {
    tabs: App.tabs,
    active: App.active,
    closeTab: App.closeTab,
    activate: App.activate,
  };
  const first = { key: 'first' };
  const kept = { key: 'kept' };
  const third = { key: 'third' };
  const attempted = [];
  let activated = -1;

  try {
    App.tabs = [first, kept, third];
    App.active = 2;
    App.closeTab = async (index) => {
      const tab = App.tabs[index];
      attempted.push(tab);
      if (tab === first) return false;
      App.tabs.splice(index, 1);
      return true;
    };
    App.activate = async (index) => { activated = index; };

    assert.equal(await App._closeOthers(1), false);
    assert.deepEqual(attempted, [third, first]);
    assert.deepEqual(App.tabs, [first, kept]);
    assert.equal(activated, 1);
  } finally {
    App.tabs = original.tabs;
    App.active = original.active;
    App.closeTab = original.closeTab;
    App.activate = original.activate;
  }
});

test('close all uses the normal dirty-aware close path and stops at the first cancellation', async () => {
  const original = { tabs: App.tabs, closeTab: App.closeTab };
  const first = { key: 'first' };
  const second = { key: 'second', dirty: true };
  const third = { key: 'third' };
  const attempted = [];
  try {
    App.tabs = [first, second, third];
    App.closeTab = async (index) => {
      const tab = App.tabs[index];
      attempted.push(tab);
      if (tab === second) return false;
      App.tabs.splice(index, 1);
      return true;
    };

    assert.equal(await App._closeAllTabs(), false);
    assert.deepEqual(attempted, [third, second]);
    assert.deepEqual(App.tabs, [first, second]);
  } finally {
    App.tabs = original.tabs;
    App.closeTab = original.closeTab;
  }
});

test('the close prompt pauses a scheduled autosave and restores it when closing is canceled', async () => {
  const original = {
    tabs: App.tabs,
    active: App.active,
    autosaveTimers: App._autosaveTimers,
    confirm: App._confirm,
    scheduleAutoSave: App._scheduleAutoSave,
  };
  const tab = { key: 'dirty', path: '/dirty.md', name: 'dirty.md', dirty: true };
  const timer = setTimeout(() => {}, 10000);
  let rescheduled = false;

  try {
    App.tabs = [tab];
    App.active = 0;
    App._autosaveTimers = new Map([[tab.key, timer]]);
    App._confirm = async () => 'cancel';
    App._scheduleAutoSave = (target) => { assert.equal(target, tab); rescheduled = true; };

    assert.equal(await App.closeTab(0), false);
    assert.equal(App._autosaveTimers.has(tab.key), false);
    assert.equal(rescheduled, true);
  } finally {
    clearTimeout(timer);
    App.tabs = original.tabs;
    App.active = original.active;
    App._autosaveTimers = original.autosaveTimers;
    App._confirm = original.confirm;
    App._scheduleAutoSave = original.scheduleAutoSave;
  }
});

test('close after Save stays open when input during the write leaves the tab dirty', async () => {
  const original = {
    tabs: App.tabs,
    active: App.active,
    confirm: App._confirm,
    save: App.save,
    scheduleAutoSave: App._scheduleAutoSave,
  };
  const tab = { key: 'dirty', path: '/dirty.md', name: 'dirty.md', dirty: true };
  let destroyed = false;
  global.Editor = { destroy: () => { destroyed = true; } };
  try {
    App.tabs = [tab];
    App.active = 0;
    App._confirm = async () => 'save';
    App.save = async () => true;
    App._scheduleAutoSave = () => {};

    assert.equal(await App.closeTab(0), false);
    assert.equal(destroyed, false);
    assert.deepEqual(App.tabs, [tab]);
  } finally {
    App.tabs = original.tabs;
    App.active = original.active;
    App._confirm = original.confirm;
    App.save = original.save;
    App._scheduleAutoSave = original.scheduleAutoSave;
    delete global.Editor;
  }
});

test('discard close is canceled when input changes while an in-flight save is settling', async () => {
  const original = {
    tabs: App.tabs,
    active: App.active,
    confirm: App._confirm,
    waitForTabSave: App._waitForTabSave,
    tabValue: App._tabValue,
    scheduleRecovery: App._scheduleRecovery,
    scheduleAutoSave: App._scheduleAutoSave,
    renderTabs: App._renderTabs,
    updateStatus: App.updateStatus,
    syncFileWatchers: App._syncFileWatchers,
    persistSession: App._persistSession,
  };
  let finishWait;
  const waiting = new Promise((resolve) => { finishWait = resolve; });
  const tab = {
    key: 'dirty', path: '/dirty.md', name: 'dirty.md',
    dirty: true, cachedValue: 'confirmed content', savedValue: 'disk content',
  };
  const neighbor = { key: 'other', path: '/other.md', dirty: false };
  let live = tab.cachedValue;
  let recoveryScheduled = false;
  let autoSaveScheduled = false;
  const messages = [];
  global.toast = (message) => messages.push(message);
  global.Editor = { destroy: () => {} };

  try {
    App.tabs = [tab, neighbor];
    App.active = 1;
    App._confirm = async () => 'discard';
    App._waitForTabSave = () => waiting;
    App._tabValue = () => live;
    App._scheduleRecovery = () => { recoveryScheduled = true; };
    App._scheduleAutoSave = () => { autoSaveScheduled = true; };
    App._renderTabs = () => {};
    App.updateStatus = () => {};
    App._syncFileWatchers = async () => {};
    App._persistSession = () => {};

    const closing = App.closeTab(0);
    await new Promise((resolve) => setImmediate(resolve));
    live = 'typed while save pending';
    finishWait();

    assert.equal(await closing, false);
    assert.deepEqual(App.tabs, [tab, neighbor]);
    assert.equal(tab.cachedValue, live);
    assert.equal(tab.dirty, true);
    assert.equal(recoveryScheduled, true);
    assert.equal(autoSaveScheduled, true);
    assert.equal(messages.some((message) => message.includes('新的修改')), true);
  } finally {
    App.tabs = original.tabs;
    App.active = original.active;
    App._confirm = original.confirm;
    App._waitForTabSave = original.waitForTabSave;
    App._tabValue = original.tabValue;
    App._scheduleRecovery = original.scheduleRecovery;
    App._scheduleAutoSave = original.scheduleAutoSave;
    App._renderTabs = original.renderTabs;
    App.updateStatus = original.updateStatus;
    App._syncFileWatchers = original.syncFileWatchers;
    App._persistSession = original.persistSession;
    delete global.Editor;
    delete global.toast;
  }
});
