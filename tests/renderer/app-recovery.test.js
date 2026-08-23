'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const App = require('../../renderer/js/app');
const DocumentSafety = require('../../renderer/js/document-safety');

test('restores both an untitled draft and saved-file edits that were not flushed', async () => {
  const original = {
    tabs: App.tabs,
    active: App.active,
    untitledSeq: App.untitledSeq,
  };
  const diskTab = {
    key: '/notes/doc.md',
    path: '/notes/doc.md',
    name: 'doc.md',
    dirty: false,
    savedValue: 'saved',
    cachedValue: 'saved',
    diskValue: 'saved',
    normalizeBaseline: true,
  };

  global.DocumentSafety = DocumentSafety;
  global.P = {
    normalize: (value) => value.replace(/\\/g, '/'),
    basename: (value) => value.split('/').pop(),
  };
  global.ink = {
    getRecovery: async () => ({
      ok: true,
      drafts: [
        {
          key: 'file:/notes/doc.md',
          path: '/notes/doc.md',
          name: 'doc.md',
          content: 'local edit\n',
          savedValue: 'saved\n',
          diskValue: 'saved',
          updatedAt: 1,
        },
        {
          key: 'untitled:recovered',
          path: '',
          name: '未命名-3.md',
          content: 'untitled edit',
          savedValue: '',
          diskValue: '',
          updatedAt: 2,
        },
      ],
    }),
    exists: async (path) => path === '/notes/doc.md',
    readFile: async () => ({ ok: true, content: 'saved' }),
    removeRecovery: async () => ({ ok: true }),
  };

  try {
    App.tabs = [diskTab];
    App.active = -1;
    App.untitledSeq = 0;

    const preferredKey = await App._restoreRecoveryDrafts();

    assert.equal(preferredKey, 'untitled:recovered');
    assert.equal(App.tabs.length, 2);
    assert.equal(diskTab.cachedValue, 'local edit\n');
    assert.equal(diskTab.savedValue, 'saved\n');
    assert.equal(diskTab.diskValue, 'saved');
    assert.equal(diskTab.dirty, true);
    assert.equal(diskTab.normalizeBaseline, undefined);
    assert.deepEqual(App.tabs[1], {
      key: 'untitled:recovered',
      path: null,
      name: '未命名-3.md',
      dirty: true,
      savedValue: '',
      cachedValue: 'untitled edit',
      diskValue: '',
      recoveryKey: 'untitled:recovered',
    });
  } finally {
    App.tabs = original.tabs;
    App.active = original.active;
    App.untitledSeq = original.untitledSeq;
    delete global.DocumentSafety;
    delete global.P;
    delete global.ink;
  }
});

test('Windows recovery merges slash and case variants into the existing document tab', async () => {
  const original = { tabs: App.tabs, active: App.active, platform: App.platform };
  const diskTab = {
    key: 'C:\\Notes\\Doc.md', path: 'C:\\Notes\\Doc.md', name: 'Doc.md', dirty: false,
    savedValue: 'saved', cachedValue: 'saved', diskValue: 'saved', normalizeBaseline: true,
  };
  global.DocumentSafety = DocumentSafety;
  global.P = {
    normalize: (value) => value.replace(/\\/g, '/'),
    basename: (value) => value.replace(/\\/g, '/').split('/').pop(),
  };
  global.ink = {
    getRecovery: async () => ({ drafts: [{
      key: 'file:c:/notes/doc.md', path: 'c:/notes/doc.md', name: 'doc.md',
      content: 'recovered edit', savedValue: 'saved', diskValue: 'saved', updatedAt: 1,
    }] }),
    exists: async () => true,
    readFile: async () => ({ ok: true, content: 'saved' }),
    removeRecovery: async () => ({ ok: true }),
  };
  try {
    App.tabs = [diskTab];
    App.active = -1;
    App.platform = 'win32';

    await App._restoreRecoveryDrafts();

    assert.equal(App.tabs.length, 1);
    assert.equal(diskTab.cachedValue, 'recovered edit');
    assert.equal(diskTab.dirty, true);
  } finally {
    App.tabs = original.tabs;
    App.active = original.active;
    App.platform = original.platform;
    delete global.DocumentSafety;
    delete global.P;
    delete global.ink;
  }
});
