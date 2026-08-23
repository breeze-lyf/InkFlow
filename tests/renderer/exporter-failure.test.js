'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Exporter = require('../../renderer/js/exporter');

test('export preparation failures are surfaced and do not escape as unhandled rejections', async () => {
  const messages = [];
  const toastBox = { replaceChildren() {} };
  global.toast = (message) => messages.push(message);
  global.$ = () => toastBox;
  try {
    const result = await Exporter._runExport('PDF', async () => {
      throw new Error('图示 1 栅格化失败');
    });

    assert.equal(result.ok, false);
    assert.match(result.error, /图示 1 栅格化失败/);
    assert.equal(messages.some((message) => /导出失败：图示 1 栅格化失败/.test(message)), true);
  } finally {
    delete global.toast;
    delete global.$;
  }
});
