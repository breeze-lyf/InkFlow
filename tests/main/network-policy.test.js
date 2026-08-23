'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { pathToFileURL } = require('node:url');
const { installRendererNetworkGuard, isAllowedRendererFileUrl, isAllowedRendererNetworkUrl } = require('../../main/network-policy');

test('renderer only reaches the tokenized local asset endpoint, never arbitrary public or private HTTP', () => {
  const asset = 'http://127.0.0.1:43123/0123456789abcdef';
  assert.equal(isAllowedRendererNetworkUrl(`${asset}/img?path=%2Ftmp%2Fa.png`, asset), true);
  assert.equal(isAllowedRendererNetworkUrl('http://127.0.0.1:43123/img?path=/tmp/a.png', asset), false);
  assert.equal(isAllowedRendererNetworkUrl('http://127.0.0.1:9999/private', asset), false);
  assert.equal(isAllowedRendererNetworkUrl('http://169.254.169.254/latest/meta-data/', asset), false);
  assert.equal(isAllowedRendererNetworkUrl('https://example.com/tracker.png', asset), false);
});

test('session guard cancels a remote image request and permits the current asset URL', () => {
  let listener;
  installRendererNetworkGuard({
    webRequest: {
      onBeforeRequest(filter, callback) {
        assert.deepEqual(filter, { urls: ['http://*/*', 'https://*/*', 'file://*/*'] });
        listener = callback;
      },
    },
  }, {
    getAssetUrl: () => 'http://127.0.0.1:43123/token',
    getAppRoot: () => '/Applications/InkFlow.app/Contents/Resources/app.asar',
    getEphemeralFiles: () => ['/tmp/inkflow-export-1.html'],
  });
  const invoke = (url) => new Promise((resolve) => listener({ url }, resolve));

  return Promise.all([
    invoke('https://example.com/a.png').then((result) => assert.deepEqual(result, { cancel: true })),
    invoke('http://127.0.0.1:43123/token/img?path=x').then((result) => assert.deepEqual(result, { cancel: false })),
    invoke(pathToFileURL('/Users/demo/private.png').href).then((result) => assert.deepEqual(result, { cancel: true })),
    invoke(pathToFileURL('/tmp/inkflow-export-1.html').href).then((result) => assert.deepEqual(result, { cancel: false })),
  ]);
});

test('file policy permits packaged assets and exact export temporaries but denies arbitrary local files', () => {
  const options = {
    appRoot: '/Applications/InkFlow.app/Contents/Resources/app.asar',
    ephemeralFiles: ['/tmp/inkflow-export-1.html'],
  };
  assert.equal(isAllowedRendererFileUrl(
    pathToFileURL('/Applications/InkFlow.app/Contents/Resources/app.asar/renderer/index.html').href,
    options,
  ), true);
  assert.equal(isAllowedRendererFileUrl(pathToFileURL('/tmp/inkflow-export-1.html').href, options), true);
  assert.equal(isAllowedRendererFileUrl(pathToFileURL('/Users/demo/private.png').href, options), false);
});
