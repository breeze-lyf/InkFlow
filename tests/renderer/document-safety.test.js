'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const DocumentSafety = require('../../renderer/js/document-safety');

test('keeps editing when the disk still matches the saved baseline', () => {
  const result = DocumentSafety.decide({
    diskContent: 'saved',
    liveContent: 'local edit',
    savedContent: 'saved',
    exists: true,
  });

  assert.deepEqual(result, { action: 'unchanged', dirty: true });
});

test('accepts a changed disk version when there are no local edits', () => {
  const result = DocumentSafety.decide({
    diskContent: 'external edit',
    liveContent: 'saved',
    savedContent: 'saved',
    exists: true,
  });

  assert.deepEqual(result, { action: 'accept-disk', dirty: false });
});

test('accepts a changed disk version when local and disk content converged', () => {
  const result = DocumentSafety.decide({
    diskContent: 'same edit',
    liveContent: 'same edit',
    savedContent: 'saved',
    exists: true,
  });

  assert.deepEqual(result, { action: 'accept-disk', dirty: true });
});

test('reports a conflict when disk and local content diverged from the baseline', () => {
  const result = DocumentSafety.decide({
    diskContent: 'external edit',
    liveContent: 'local edit',
    savedContent: 'saved',
    exists: true,
  });

  assert.deepEqual(result, { action: 'conflict', dirty: true });
});

test('reports deletion and preserves whether local recovery is needed', () => {
  assert.deepEqual(DocumentSafety.decide({
    liveContent: 'local edit',
    savedContent: 'saved',
    exists: false,
  }), { action: 'deleted', dirty: true });

  assert.deepEqual(DocumentSafety.decide({
    liveContent: 'saved',
    savedContent: 'saved',
    exists: false,
  }), { action: 'deleted', dirty: false });
});

test('uses the exact disk baseline separately from editor-normalized saved content', () => {
  const result = DocumentSafety.decide({
    diskContent: 'saved without newline',
    diskBaseline: 'saved without newline',
    liveContent: 'local edit\n',
    savedContent: 'saved without newline\n',
    exists: true,
  });

  assert.deepEqual(result, { action: 'unchanged', dirty: true });
});
