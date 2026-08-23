'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const pkg = require('../package.json');

test('packaged app includes every offline renderer loaded dynamically by Vditor', () => {
  const files = new Set(pkg.build.files);
  const required = [
    'node_modules/vditor/dist/js/katex/**',
    'node_modules/vditor/dist/js/mermaid/**',
    'node_modules/vditor/dist/js/highlight.js/**',
    'node_modules/vditor/dist/js/echarts/**',
    'node_modules/vditor/dist/js/markmap/**',
    'node_modules/vditor/dist/js/smiles-drawer/**',
  ];

  assert.deepEqual(required.filter((entry) => !files.has(entry)), []);
});
