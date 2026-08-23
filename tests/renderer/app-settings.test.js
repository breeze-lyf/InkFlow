'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const App = require('../../renderer/js/app');

test('a settings persistence failure is surfaced to the user', async () => {
  const originalSettings = App.settings;
  const originalErrorAt = App._settingsErrorAt;
  let message = '';
  global.ink = {
    setSettings: async () => ({ ok: false, error: 'disk full' }),
  };
  global.toast = (value) => { message = value; };

  try {
    App.settings = {};
    App._settingsErrorAt = 0;

    const ok = await App.setSetting({ theme: 'dark' });

    assert.equal(ok, false);
    assert.equal(App.settings.theme, 'dark');
    assert.match(message, /设置保存失败/);
    assert.match(message, /disk full/);
  } finally {
    App.settings = originalSettings;
    App._settingsErrorAt = originalErrorAt;
    delete global.ink;
    delete global.toast;
  }
});
