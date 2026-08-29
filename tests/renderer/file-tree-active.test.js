'use strict';

const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

function loadFileTree() {
  global.throttle = (fn) => fn;
  delete require.cache[require.resolve('../../renderer/js/panels')];
  return require('../../renderer/js/panels').FileTree;
}

function fakeRow(filePath, active = false) {
  const classes = new Set(active ? ['active'] : []);
  const attributes = new Map(active ? [['aria-current', 'page']] : []);
  return {
    dataset: { path: filePath },
    classList: {
      add: (name) => classes.add(name),
      remove: (name) => classes.delete(name),
      contains: (name) => classes.has(name),
    },
    setAttribute: (name, value) => attributes.set(name, value),
    removeAttribute: (name) => attributes.delete(name),
    getAttribute: (name) => attributes.get(name),
  };
}

test('markActive moves the current-page marker to the opened file', () => {
  const FileTree = loadFileTree();
  const oldRow = fakeRow('/notes/old.md', true);
  const currentRow = fakeRow('/notes/current.md');
  const rows = [oldRow, currentRow];
  global.App = {
    activeTab: () => ({ path: '/notes/current.md' }),
    _samePath: (left, right) => left === right,
  };
  global.P = { normalize: (value) => value };
  global.$$ = (selector) => selector === '.tree-row.active'
    ? rows.filter((row) => row.classList.contains('active'))
    : rows;

  try {
    FileTree.markActive();
    assert.equal(oldRow.classList.contains('active'), false);
    assert.equal(oldRow.getAttribute('aria-current'), undefined);
    assert.equal(currentRow.classList.contains('active'), true);
    assert.equal(currentRow.getAttribute('aria-current'), 'page');
  } finally {
    delete global.App;
    delete global.P;
    delete global.$$;
  }
});

test('reveal expands every parent of the active file without accepting sibling prefixes', async () => {
  const FileTree = loadFileTree();
  const row = fakeRow('/notes/work/2026/plan.md');
  let renders = 0;
  let scrolled = 0;
  row.scrollIntoView = () => { scrolled += 1; };
  global.App = {
    _pathWithin: (child, parent) => child === parent || child.startsWith(parent + '/'),
    _samePath: (left, right) => left === right,
  };
  global.P = {
    normalize: (value) => value,
    dirname: path.posix.dirname,
  };
  global.$$ = () => [];

  const original = {
    root: FileTree.root,
    expanded: FileTree.expanded,
    render: FileTree.render,
    rowForPath: FileTree._rowForPath,
  };
  try {
    FileTree.root = '/notes';
    FileTree.expanded = new Set(['/notes']);
    FileTree.render = async () => { renders += 1; };
    FileTree._rowForPath = (filePath) => filePath === row.dataset.path ? row : null;

    assert.equal(await FileTree.reveal('/notes-old/plan.md'), false);
    assert.equal(renders, 0);
    assert.equal(await FileTree.reveal(row.dataset.path), true);
    assert.deepEqual([...FileTree.expanded], ['/notes', '/notes/work', '/notes/work/2026']);
    assert.equal(renders, 1);
    assert.equal(scrolled, 1);
  } finally {
    FileTree.root = original.root;
    FileTree.expanded = original.expanded;
    FileTree.render = original.render;
    FileTree._rowForPath = original.rowForPath;
    delete global.App;
    delete global.P;
    delete global.$$;
  }
});
