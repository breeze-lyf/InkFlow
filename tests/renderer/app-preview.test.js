'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const App = require('../../renderer/js/app');

test('preview filenames are assigned as DOM properties and cannot inject markup', () => {
  const originalAssetUrl = App.assetUrl;
  let assignedHtml;
  const children = [];
  const pane = {
    set innerHTML(value) { assignedHtml = value; },
    replaceChildren(...nodes) { children.splice(0, children.length, ...nodes); },
    appendChild(node) { children.push(node); },
    classList: { remove: () => {} },
  };
  const oldGlobals = { $: global.$, P: global.P, document: global.document };
  global.$ = () => pane;
  global.P = { extname: () => '.png' };
  global.document = {
    createElement: (tagName) => ({ tagName: tagName.toUpperCase() }),
  };

  try {
    App.assetUrl = 'http://127.0.0.1/token';
    App._showPreview({
      path: '/tmp/image.png',
      name: 'x" onerror="window.pwned=1.png',
    });

    assert.equal(assignedHtml, undefined);
    assert.equal(children.length, 1);
    assert.equal(children[0].tagName, 'IMG');
    assert.equal(children[0].alt, 'x" onerror="window.pwned=1.png');
    assert.match(children[0].src, /\/img\?path=/);
  } finally {
    App.assetUrl = originalAssetUrl;
    global.$ = oldGlobals.$;
    global.P = oldGlobals.P;
    global.document = oldGlobals.document;
  }
});
