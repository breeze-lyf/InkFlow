'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const App = require('../../renderer/js/app');

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function host() {
  const classes = new Set(['hidden']);
  return {
    classList: {
      add: (name) => classes.add(name),
      remove: (name) => classes.delete(name),
      contains: (name) => classes.has(name),
    },
  };
}

test('Editor keeps a late-created editor hidden after a newer activation wins', async () => {
  delete require.cache[require.resolve('../../renderer/js/editor')];
  const Editor = require('../../renderer/js/editor');
  const original = {
    instances: Editor.instances,
    activeKey: Editor.activeKey,
    activationEpoch: Editor._activationEpoch,
    create: Editor._create,
    hideImgToolbar: Editor._hideImgToolbar,
    scroller: Editor._scroller,
    rescanImages: Editor._rescanImages,
  };
  const pending = { a: deferred(), b: deferred() };
  const focusCount = { a: 0, b: 0 };
  const instances = {};
  const oldAnimationFrame = global.requestAnimationFrame;

  try {
    Editor.instances = new Map();
    Editor.activeKey = null;
    Editor._activationEpoch = 0;
    Editor._hideImgToolbar = () => {};
    Editor._scroller = () => null;
    Editor._rescanImages = () => {};
    Editor._create = (key, tab) => {
      const inst = {
        key,
        tab,
        host: host(),
        ready: false,
        vditor: { focus: () => { focusCount[key] += 1; } },
      };
      instances[key] = inst;
      Editor.instances.set(key, inst);
      return pending[key].promise.then(() => {
        inst.ready = true;
        return inst;
      });
    };
    global.requestAnimationFrame = (callback) => callback();

    const first = Editor.activate('a', { key: 'a' });
    const second = Editor.activate('b', { key: 'b' });
    pending.b.resolve();
    assert.equal(await second, true);
    pending.a.resolve();
    assert.equal(await first, false);

    assert.equal(Editor.activeKey, 'b');
    assert.equal(instances.a.host.classList.contains('hidden'), true);
    assert.equal(instances.b.host.classList.contains('hidden'), false);
    assert.deepEqual(focusCount, { a: 0, b: 1 });
  } finally {
    Editor.instances = original.instances;
    Editor.activeKey = original.activeKey;
    Editor._activationEpoch = original.activationEpoch;
    Editor._create = original.create;
    Editor._hideImgToolbar = original.hideImgToolbar;
    Editor._scroller = original.scroller;
    Editor._rescanImages = original.rescanImages;
    global.requestAnimationFrame = oldAnimationFrame;
  }
});

test('App ignores late activation completion and does not restore stale window state', async () => {
  const original = {
    tabs: App.tabs,
    active: App.active,
    hidePreview: App._hidePreview,
    renderTabs: App._renderTabs,
    syncWelcome: App._syncWelcome,
    updateStatus: App.updateStatus,
    persistSession: App._persistSession,
  };
  const firstReady = deferred();
  const secondReady = deferred();
  const first = {
    key: 'a', path: '/notes/a.md', name: 'a.md', savedValue: 'a', cachedValue: 'a', dirty: false,
  };
  const second = {
    key: 'b', path: '/notes/b.md', name: 'b.md', savedValue: 'b', cachedValue: 'b', dirty: false,
  };
  const windowStates = [];

  global.Editor = {
    activate: (key) => (key === 'a' ? firstReady.promise : secondReady.promise),
    getValue: (key) => key,
  };
  global.Outline = { render: () => {} };
  global.FileTree = { markActive: () => {}, reveal: () => {} };
  global.ink = { setWindowFile: (path) => windowStates.push(path) };

  try {
    App.tabs = [first, second];
    App.active = -1;
    App._activationEpoch = 0;
    App._hidePreview = () => {};
    App._renderTabs = () => {};
    App._syncWelcome = () => {};
    App.updateStatus = () => {};
    App._persistSession = () => {};

    const activateFirst = App.activate(0);
    const activateSecond = App.activate(1);
    secondReady.resolve(true);
    assert.equal(await activateSecond, true);
    firstReady.resolve(true);
    assert.equal(await activateFirst, false);

    assert.equal(App.active, 1);
    assert.deepEqual(windowStates, ['/notes/b.md']);
  } finally {
    App.tabs = original.tabs;
    App.active = original.active;
    App._hidePreview = original.hidePreview;
    App._renderTabs = original.renderTabs;
    App._syncWelcome = original.syncWelcome;
    App.updateStatus = original.updateStatus;
    App._persistSession = original.persistSession;
    delete global.Editor;
    delete global.Outline;
    delete global.FileTree;
    delete global.ink;
  }
});

test('concurrent opens of the same path share one read and create only one tab', async () => {
  const original = {
    tabs: App.tabs,
    active: App.active,
    openingPaths: App._openingPaths,
    activate: App.activate,
    syncFileWatchers: App._syncFileWatchers,
    persistSession: App._persistSession,
    renderWelcome: App._renderWelcome,
    renderTabs: App._renderTabs,
  };
  const read = deferred();
  let reads = 0;

  global.P = {
    basename: (value) => value.replace(/\\/g, '/').split('/').pop(),
    normalize: (value) => value.replace(/\\/g, '/'),
  };
  global.Editor = { getValue: () => 'disk content' };
  global.ink = {
    readFile: () => { reads += 1; return read.promise; },
    addRecent: () => {},
  };
  global.toast = () => {};

  try {
    App.tabs = [];
    App.active = -1;
    App._openingPaths = new Map();
    App.activate = async (index) => { App.active = index; return true; };
    App._syncFileWatchers = async () => true;
    App._persistSession = () => {};
    App._renderWelcome = () => {};
    App._renderTabs = () => {};

    const first = App.openFile('/notes/shared.md');
    const second = App.openFile('/notes/shared.md');
    assert.equal(reads, 1);
    read.resolve({ ok: true, content: 'disk content' });
    await Promise.all([first, second]);

    assert.equal(reads, 1);
    assert.equal(App.tabs.length, 1);
    assert.equal(App.tabs[0].key, '/notes/shared.md');
    assert.equal(App._openingPaths.size, 0);
  } finally {
    App.tabs = original.tabs;
    App.active = original.active;
    App._openingPaths = original.openingPaths;
    App.activate = original.activate;
    App._syncFileWatchers = original.syncFileWatchers;
    App._persistSession = original.persistSession;
    App._renderWelcome = original.renderWelcome;
    App._renderTabs = original.renderTabs;
    delete global.P;
    delete global.Editor;
    delete global.ink;
    delete global.toast;
  }
});
