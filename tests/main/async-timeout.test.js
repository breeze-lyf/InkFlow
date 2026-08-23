'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { withTimeout } = require('../../main/async-timeout');

test('withTimeout returns completed work and rejects stalled conversions with a clear error', async () => {
  assert.equal(await withTimeout(Promise.resolve('ok'), 50, '导出'), 'ok');
  await assert.rejects(withTimeout(new Promise(() => {}), 10, 'Word 导出'), /Word 导出超时，请重试/);
});
