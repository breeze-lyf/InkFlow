'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { readExistingRecent } = require('../../main/recent-files');

test('recent lookup tolerates a file disappearing between listing and stat', () => {
  const store = {
    get(key) {
      return key === 'files'
        ? ['/notes/kept.md', '/notes/vanished.md', '/notes/folder']
        : ['/notes/folder', '/notes/vanished-folder', '/notes/kept.md'];
    },
  };
  const fsApi = {
    statSync(path) {
      if (path.includes('vanished')) {
        const error = new Error('gone');
        error.code = 'ENOENT';
        throw error;
      }
      return {
        isFile: () => path.endsWith('.md'),
        isDirectory: () => path.endsWith('/folder'),
      };
    },
  };

  assert.deepEqual(readExistingRecent(store, fsApi), {
    files: ['/notes/kept.md'],
    folders: ['/notes/folder'],
  });
});
