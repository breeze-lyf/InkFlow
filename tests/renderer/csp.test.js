'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('renderer CSP blocks eval, plugins, forms, and untrusted navigation primitives', () => {
  const html = fs.readFileSync(path.resolve(__dirname, '../../renderer/index.html'), 'utf8');
  const match = html.match(/<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]+)"/i);
  assert.ok(match, 'renderer is missing a Content-Security-Policy');
  const policy = match[1];
  assert.match(policy, /script-src\s+'self'/);
  assert.doesNotMatch(policy, /unsafe-eval/);
  assert.match(policy, /object-src\s+'none'/);
  assert.match(policy, /base-uri\s+'none'/);
  assert.match(policy, /form-action\s+'none'/);
});
