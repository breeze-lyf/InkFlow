'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { Store } = require('../../main/store');

test('Store falls back to defaults when the file is absent or malformed', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'inkflow-store-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'settings.json');

  const fresh = new Store(file, { theme: 'system', fontSize: 16 });
  assert.deepEqual(fresh.get(), { theme: 'system', fontSize: 16 });

  fs.writeFileSync(file, '{not json', 'utf8');
  const malformed = new Store(file, { theme: 'light' });
  assert.equal(malformed.get('theme'), 'light');
});

test('Store merges values and replaces the file atomically', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'inkflow-store-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'nested', 'settings.json');
  const store = new Store(file, { theme: 'system', fontSize: 16 });

  store.set('theme', 'dark');
  store.set({ fontSize: 18, sidebarVisible: false });

  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), {
    theme: 'dark',
    fontSize: 18,
    sidebarVisible: false,
  });
  assert.equal(fs.existsSync(`${file}.tmp`), false);
});
