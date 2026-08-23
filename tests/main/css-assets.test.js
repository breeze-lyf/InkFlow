const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { readExportCss } = require('../../main/css-assets');

test('export CSS reader only exposes the styles needed by the export pipeline', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'inkflow-css-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const allowed = path.join(root, 'renderer/css/content/inkflow-light.css');
  fs.mkdirSync(path.dirname(allowed), { recursive: true });
  fs.writeFileSync(allowed, 'body { color: black; }');
  fs.writeFileSync(path.join(root, 'secret.txt'), 'secret');

  assert.deepEqual(
    readExportCss(root, 'renderer/css/content/inkflow-light.css'),
    { ok: true, content: 'body { color: black; }' }
  );

  const traversal = readExportCss(root, 'renderer/css/content/../../../../secret.txt');
  assert.equal(traversal.ok, false);
  const unrelated = readExportCss(root, 'renderer/css/themes.css');
  assert.equal(unrelated.ok, false);
});
