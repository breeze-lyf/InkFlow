'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const bundles = [
  path.join(root, 'node_modules/vditor/dist/index.min.js'),
  path.join(root, 'node_modules/vditor/dist/method.min.js'),
];

test('bundled Vditor parses ECharts options as strict JSON without dynamic code execution', () => {
  for (const bundle of bundles) {
    const source = fs.readFileSync(bundle, 'utf8');
    assert.doesNotMatch(
      source,
      /Function\(['"](?:\\?['"])?use strict[^)]*return \(/,
      `${path.basename(bundle)} still contains the loose Function-based parser`,
    );
    assert.match(source, /JSON\.parse\(/, `${path.basename(bundle)} is missing the strict parser`);
  }
});

test('bundled Mermaid uses strict mode while retaining labels for safe rasterization', () => {
  for (const bundle of bundles) {
    const source = fs.readFileSync(bundle, 'utf8');
    assert.match(source, /securityLevel:"strict"/);
    assert.match(source, /flowchart:\{htmlLabels:!0/);
    assert.doesNotMatch(source, /securityLevel:"loose"/);
  }
});
