'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { assertSemver, checkVersions, replaceExactly, syncVersions } = require('../lib/version-tools');

test('release versions use explicit semantic versions', () => {
  assert.equal(assertSemver('1.0.3'), '1.0.3');
  assert.equal(assertSemver('2.0.0-rc.1'), '2.0.0-rc.1');
  assert.throws(() => assertSemver('v1.0.3'), /invalid release version/);
  assert.throws(() => assertSemver('1.0'), /invalid release version/);
});

test('version replacement refuses missing or duplicate markers', () => {
  const pattern = /Current: v([^\s]+)/g;
  assert.equal(replaceExactly('Current: v1.0.2', pattern, 'Current: v1.0.3', 'README'), 'Current: v1.0.3');
  assert.throws(() => replaceExactly('none', pattern, 'x', 'README'), /found 0/);
  assert.throws(() => replaceExactly('Current: v1 Current: v2', pattern, 'x', 'README'), /found 2/);
});

test('release sync updates every public version surface without publishing', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'inkflow-version-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'site'));
  fs.mkdirSync(path.join(root, 'docs'));
  fs.writeFileSync(path.join(root, 'package.json'), '{"version":"1.0.2"}\n');
  fs.writeFileSync(path.join(root, 'README.md'), '当前发布 **v1.0.2**\n');
  fs.writeFileSync(path.join(root, 'HANDOFF.md'), '> 最后更新：2026-01-01（v1.0.2）\n- 最新发布：v1.0.2（macOS）\n');
  const html = '<span class="eyebrow">v1.0.2 · macOS</span>\n<span class="rel-tag">v1.0.2 更新</span>\n';
  fs.writeFileSync(path.join(root, 'site', 'index.html'), html);
  fs.writeFileSync(path.join(root, 'docs', 'index.html'), html);

  assert.equal(syncVersions(root, '1.0.3'), '1.0.3');
  assert.equal(checkVersions(root).version, '1.0.3');
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'package.json'))).version, '1.0.3');
  assert.match(fs.readFileSync(path.join(root, 'site', 'index.html'), 'utf8'), /v1\.0\.3/);
});
