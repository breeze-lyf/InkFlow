const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { readDirectory, walkMarkdown } = require('../../main/directory-files');

function withTempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'inkflow-dir-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('directory reads preserve filtering and deterministic sort behavior asynchronously', async (t) => {
  const dir = withTempDir(t);
  fs.mkdirSync(path.join(dir, '资料'));
  fs.writeFileSync(path.join(dir, '10.md'), '10');
  fs.writeFileSync(path.join(dir, '2.md'), '2');
  fs.writeFileSync(path.join(dir, '.hidden.md'), 'hidden');
  fs.writeFileSync(path.join(dir, 'skip.exe'), 'skip');

  const result = await readDirectory(dir, { allows: () => true });

  assert.equal(result.ok, true);
  assert.deepEqual(result.entries.map((entry) => entry.name), ['资料', '2.md', '10.md']);
  assert.equal(result.entries[0].isDir, true);
  assert.equal(result.entries[1].isDir, false);
});

test('markdown walking has hard file-count and depth boundaries', async (t) => {
  const large = withTempDir(t);
  for (let i = 0; i < 2050; i++) {
    fs.writeFileSync(path.join(large, `${String(i).padStart(4, '0')}.md`), String(i));
  }
  const limited = await walkMarkdown(large, { allows: () => true });
  assert.equal(limited.length, 2000);

  const deep = withTempDir(t);
  let cursor = deep;
  for (let level = 1; level <= 9; level++) {
    cursor = path.join(cursor, `level-${level}`);
    fs.mkdirSync(cursor);
    fs.writeFileSync(path.join(cursor, `level-${level}.md`), String(level));
  }
  const walked = await walkMarkdown(deep, { allows: () => true });
  const names = walked.map((entry) => entry.name);
  assert.equal(names.includes('level-8.md'), true);
  assert.equal(names.includes('level-9.md'), false);
});

test('markdown walking also caps visited entries when a tree contains many directories', async (t) => {
  const root = withTempDir(t);
  for (let i = 0; i < 40; i++) {
    const dir = path.join(root, `dir-${String(i).padStart(2, '0')}`);
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, `${i}.md`), String(i));
  }

  const walked = await walkMarkdown(root, {
    allows: () => true,
    maxFiles: 2000,
    maxEntries: 12,
  });

  assert.ok(walked.length > 0);
  assert.ok(walked.length <= 6, `visited-entry cap leaked through: ${walked.length}`);
});
