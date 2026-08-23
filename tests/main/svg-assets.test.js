'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { PathGrants } = require('../../main/path-grants');
const { readSafeSvgAsset } = require('../../main/svg-assets');

test('SVG export loader requires an asset grant and strips scripts, external IRIs, and foreign content', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'inkflow-svg-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'diagram.svg');
  fs.writeFileSync(file, '<svg width="20" height="10"><script>alert(1)</script><foreignObject><p>x</p></foreignObject><path d="M0 0" fill="url(http://127.0.0.1/x)"/><text x="1" y="8">Safe</text></svg>');
  const pathGrants = new PathGrants();
  assert.equal(readSafeSvgAsset(file, { pathGrants }).ok, false);
  pathGrants.grant(dir, { kind: 'directory', access: ['asset'] });

  const result = readSafeSvgAsset(file, { pathGrants });
  assert.equal(result.ok, true);
  assert.match(result.content, /<svg[^>]+width="20"/);
  assert.match(result.content, />Safe<\/text>/);
  assert.doesNotMatch(result.content, /script|foreignObject|127\.0\.0\.1/i);
});

test('SVG export loader preserves bounded class styles used by design-tool SVGs', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'inkflow-svg-style-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'styled.svg');
  fs.writeFileSync(file, [
    '<svg width="20" height="10">',
    '<style>.brand{fill:#315d4c;stroke:rgb(255,255,255);stroke-width:2}</style>',
    '<rect class="brand" width="20" height="10"/>',
    '</svg>',
  ].join(''));
  const pathGrants = new PathGrants();
  pathGrants.grant(dir, { kind: 'directory', access: ['asset'] });

  const result = readSafeSvgAsset(file, { pathGrants });
  assert.equal(result.ok, true);
  assert.match(result.content, /<style>\.brand\{fill:#315d4c;stroke:rgb\(255,255,255\);stroke-width:2\}<\/style>/);
  assert.match(result.content, /<rect[^>]+class="brand"/);
});

test('SVG export loader preserves validated embedded raster images and rejects empty sanitized artwork', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'inkflow-svg-image-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const pathGrants = new PathGrants();
  pathGrants.grant(dir, { kind: 'directory', access: ['asset'] });
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
  const embedded = path.join(dir, 'embedded.svg');
  fs.writeFileSync(embedded, `<svg width="20" height="10"><image width="1" height="1" href="data:image/png;base64,${png}"/></svg>`);

  const kept = readSafeSvgAsset(embedded, { pathGrants });
  assert.equal(kept.ok, true);
  assert.match(kept.content, /<image[^>]+href="data:image\/png;base64,/);

  const remoteOnly = path.join(dir, 'remote-only.svg');
  fs.writeFileSync(remoteOnly, '<svg width="20" height="10"><image width="20" height="10" href="https://example.com/pixel.png"/></svg>');
  const rejected = readSafeSvgAsset(remoteOnly, { pathGrants });
  assert.equal(rejected.ok, false);
  assert.match(rejected.error, /可视内容/);
});
