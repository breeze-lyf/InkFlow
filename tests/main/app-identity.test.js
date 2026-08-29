const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const pkg = require('../../package.json');
const {
  DISPLAY_NAME,
  LEGACY_USER_DATA_DIR,
  preserveUserDataLocation,
} = require('../../main/app-identity');

const ROOT = path.resolve(__dirname, '../..');

test('packaging surfaces use the exact InkFlow 墨流 application name', () => {
  assert.equal(DISPLAY_NAME, 'InkFlow 墨流');
  assert.equal(pkg.productName, DISPLAY_NAME);
  assert.equal(pkg.build.productName, DISPLAY_NAME);
  assert.equal(pkg.build.mac.extendInfo.CFBundleDisplayName, DISPLAY_NAME);
  assert.equal(pkg.build.dmg.title, DISPLAY_NAME);
  assert.equal(pkg.build.nsis.shortcutName, DISPLAY_NAME);
});

test('renaming the application preserves the existing user data location', () => {
  assert.equal(LEGACY_USER_DATA_DIR, '墨流 InkFlow');
  const calls = [];
  const electronApp = {
    getPath(name) {
      assert.equal(name, 'appData');
      return '/Users/example/Library/Application Support';
    },
    setPath(name, value) {
      calls.push([name, value]);
    },
  };

  assert.equal(
    preserveUserDataLocation(electronApp, { pathImpl: path.posix }),
    '/Users/example/Library/Application Support/墨流 InkFlow'
  );
  assert.deepEqual(calls, [
    ['userData', '/Users/example/Library/Application Support/墨流 InkFlow'],
    ['sessionData', '/Users/example/Library/Application Support/墨流 InkFlow'],
  ]);
});

test('smoke runs retain their isolated command-line user data directory', () => {
  let touched = false;
  const electronApp = {
    getPath() { touched = true; },
    setPath() { touched = true; },
  };

  assert.equal(preserveUserDataLocation(electronApp, { isSmoke: true }), null);
  assert.equal(touched, false);
});

test('macOS installation helpers target the renamed application bundle', () => {
  const unblock = fs.readFileSync(path.join(ROOT, 'resources/解除打开限制.command'), 'utf8');
  const install = fs.readFileSync(path.join(ROOT, 'resources/安装说明.txt'), 'utf8');

  for (const content of [unblock, install]) {
    assert.match(content, /InkFlow 墨流\.app/);
    assert.doesNotMatch(content, /(?:Applications\/|「)墨流\.app/);
  }
});
