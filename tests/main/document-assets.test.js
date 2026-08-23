'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { PathGrants } = require('../../main/path-grants');
const {
  authorizeDocumentAssets,
  writableAssetsDirectory,
} = require('../../main/document-assets');

test('a writable single document grants only its adjacent assets directory for image writes', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'inkflow-document-assets-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const documentPath = path.join(root, 'note.md');
  fs.writeFileSync(documentPath, '# note');
  const grants = new PathGrants();
  grants.grant(documentPath, { kind: 'file', access: ['read', 'write', 'asset'] });

  assert.equal(authorizeDocumentAssets(grants, documentPath, { writable: true }).ok, true);

  const assetsDir = path.join(root, 'assets');
  assert.equal(grants.allows(root, 'write'), false);
  assert.equal(grants.allows(assetsDir, 'write'), true);
  assert.equal(grants.allows(path.join(assetsDir, 'pasted.png'), 'write'), true);
  assert.equal(grants.allows(path.join(root, 'unrelated.txt'), 'write'), false);
  assert.equal(writableAssetsDirectory(grants, root), assetsDir);
  assert.equal(writableAssetsDirectory(grants, path.join(root, 'other')), null);
});

test('a read-only document never gains adjacent asset write permission', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'inkflow-document-assets-readonly-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const documentPath = path.join(root, 'image-source.md');
  fs.writeFileSync(documentPath, '# source');
  const grants = new PathGrants();

  assert.equal(authorizeDocumentAssets(grants, documentPath, { writable: false }).ok, true);
  assert.equal(grants.allows(root, 'asset'), true);
  assert.equal(grants.allows(path.join(root, 'assets'), 'write'), false);
});
