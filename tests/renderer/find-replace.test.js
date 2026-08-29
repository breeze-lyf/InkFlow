'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  findTextMatches,
  replaceTextMatch,
  replaceAllTextMatches,
} = require('../../renderer/js/find-replace');

test('find text matches are case-insensitive by default and preserve source offsets', () => {
  assert.deepEqual(findTextMatches('Alpha alpha ALPHA', 'alpha'), [
    { start: 0, end: 5 },
    { start: 6, end: 11 },
    { start: 12, end: 17 },
  ]);
  assert.deepEqual(findTextMatches('Alpha alpha ALPHA', 'alpha', true), [
    { start: 6, end: 11 },
  ]);
});

test('find text matches handle Chinese text and use non-overlapping occurrences', () => {
  assert.deepEqual(findTextMatches('项目项目项目', '项目'), [
    { start: 0, end: 2 },
    { start: 2, end: 4 },
    { start: 4, end: 6 },
  ]);
  assert.deepEqual(findTextMatches('aaaa', 'aa'), [
    { start: 0, end: 2 },
    { start: 2, end: 4 },
  ]);
  assert.deepEqual(findTextMatches('a.b a-b a.b', 'a.b'), [
    { start: 0, end: 3 },
    { start: 8, end: 11 },
  ]);
  assert.deepEqual(findTextMatches('anything', ''), []);
});

test('single and replace-all operations use the exact match boundaries', () => {
  const source = '# Alpha\nalpha and ALPHA\n';
  const matches = findTextMatches(source, 'alpha');
  assert.equal(replaceTextMatch(source, matches[1], 'Beta'), '# Alpha\nBeta and ALPHA\n');
  assert.equal(replaceAllTextMatches(source, matches, 'Beta'), '# Beta\nBeta and Beta\n');
});
