'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { startupFailure } = require('../../main/startup');

test('asset-server startup rejection is reported and terminates with a controlled nonzero exit', () => {
  const calls = [];
  const error = Object.assign(new Error('listen EACCES'), { code: 'EACCES' });
  startupFailure(error, {
    app: { exit: (code) => calls.push(['exit', code]) },
    dialog: { showErrorBox: (title, body) => calls.push(['dialog', title, body]) },
    logger: { error: (...args) => calls.push(['log', ...args]) },
  });

  assert.equal(calls[0][0], 'log');
  assert.deepEqual(calls[1], ['dialog', '墨流启动失败', '本地资源服务无法启动：listen EACCES']);
  assert.deepEqual(calls[2], ['exit', 1]);
});
