'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const { markdownFilesFromArgv } = require('../../main/open-requests');

test('startup and second-instance argv extract existing Markdown files across relative and file URLs', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'inkflow-open-argv-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const first = path.join(dir, 'one.md');
  const second = path.join(dir, 'two.markdown');
  const ignored = path.join(dir, 'image.png');
  fs.writeFileSync(first, '# one');
  fs.writeFileSync(second, '# two');
  fs.writeFileSync(ignored, 'x');

  assert.deepEqual(markdownFilesFromArgv([
    '/Applications/InkFlow', '--flag', 'one.md', pathToFileURL(second).href,
    ignored, 'missing.md', first,
  ], { cwd: dir }), [first, second]);
});
