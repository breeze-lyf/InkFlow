'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const App = require('../../renderer/js/app');

test('editor input that exceeds the document byte limit is rolled back before save and recovery', () => {
  const original = {
    tabs: App.tabs,
    active: App.active,
    maxDocumentBytes: App._maxDocumentBytes,
    renderTabs: App._renderTabs,
    updateStatus: App.updateStatus,
    scheduleRecovery: App._scheduleRecovery,
    scheduleAutoSave: App._scheduleAutoSave,
  };
  const tab = {
    key: 'untitled:1',
    path: null,
    name: '未命名',
    cachedValue: 'safe',
    savedValue: '',
    dirty: true,
  };
  const messages = [];
  let restored = null;
  let recoveryScheduled = false;

  global.Editor = {
    getValue: () => '中文中文',
    setValue: (value) => { restored = value; },
  };
  global.ink = { setWindowFile: () => {} };
  global.toast = (message) => messages.push(message);

  try {
    App.tabs = [tab];
    App.active = 0;
    App._maxDocumentBytes = 8;
    App._renderTabs = () => {};
    App.updateStatus = () => {};
    App._scheduleRecovery = () => { recoveryScheduled = true; };
    App._scheduleAutoSave = () => {};

    App.onEditorInput(tab.key);

    assert.equal(restored, 'safe');
    assert.equal(tab.cachedValue, 'safe');
    assert.equal(tab.dirty, true);
    assert.equal(recoveryScheduled, false);
    assert.equal(messages.some((message) => message.includes('25 MB')), true);
  } finally {
    App.tabs = original.tabs;
    App.active = original.active;
    App._maxDocumentBytes = original.maxDocumentBytes;
    App._renderTabs = original.renderTabs;
    App.updateStatus = original.updateStatus;
    App._scheduleRecovery = original.scheduleRecovery;
    App._scheduleAutoSave = original.scheduleAutoSave;
    delete global.Editor;
    delete global.ink;
    delete global.toast;
  }
});
