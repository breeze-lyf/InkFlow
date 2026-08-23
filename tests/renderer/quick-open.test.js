'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const QuickOpen = require('../../renderer/js/quick-open');

test('quick open remains useful without a document library by listing recent files', () => {
  const opened = [];
  const items = QuickOpen.buildItems({
    folderFiles: [],
    recentFiles: ['/notes/alpha.md', '/notes/beta.md'],
    openFile: (path) => opened.push(path),
    openFileDialog: () => {},
    openFolderDialog: () => {},
  });

  assert.deepEqual(items.filter((item) => item.type === 'file').map((item) => item.path), [
    '/notes/alpha.md', '/notes/beta.md',
  ]);
  items[0].run();
  assert.deepEqual(opened, ['/notes/alpha.md']);
  assert.equal(items.some((item) => item.title === '打开文件…'), true);
  assert.equal(items.some((item) => item.title === '打开文件夹…'), true);
});

test('library results take precedence and duplicate recent paths are removed', () => {
  const items = QuickOpen.buildItems({
    folderFiles: [
      { name: 'alpha.md', path: '/notes/alpha.md', rel: 'alpha.md' },
      { name: 'gamma.md', path: '/notes/gamma.md', rel: 'work/gamma.md' },
    ],
    recentFiles: ['/notes/alpha.md', '/other/beta.md'],
    openFile: () => {},
    openFileDialog: () => {},
    openFolderDialog: () => {},
  });

  const files = items.filter((item) => item.type === 'file');
  assert.deepEqual(files.map((item) => item.path), [
    '/notes/alpha.md', '/notes/gamma.md', '/other/beta.md',
  ]);
  assert.equal(files[0].sub, 'alpha.md');
  assert.match(files[2].sub, /^最近打开/);
});
