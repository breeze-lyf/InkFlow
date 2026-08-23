const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { MAX_DOCUMENT_BYTES } = require('../../main/document-files');
const {
  MAX_RECOVERY_DRAFTS,
  MAX_RECOVERY_STORE_BYTES,
  RecoveryStore,
} = require('../../main/recovery-store');

function createRecovery(t, options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'inkflow-recovery-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return new RecoveryStore(path.join(dir, 'recovery.json'), options);
}

test('a recovery draft can be saved and read back through the recovery interface', (t) => {
  const recovery = createRecovery(t);
  const draft = {
    key: 'untitled:1',
    path: '',
    name: '未命名',
    content: '# 尚未保存',
    savedValue: '',
    updatedAt: 1234,
  };

  assert.deepEqual(recovery.save(draft), { ok: true });
  assert.deepEqual(recovery.get(), { ok: true, drafts: [{ ...draft, diskValue: '' }] });
});

test('recovery keeps the exact disk comparison baseline separate from the editor baseline', (t) => {
  const recovery = createRecovery(t);
  const draft = {
    key: '/tmp/note.md',
    path: '/tmp/note.md',
    name: 'note.md',
    content: '# edited',
    savedValue: '# normalized',
    diskValue: '# bytes on disk',
    updatedAt: 5678,
  };

  assert.deepEqual(recovery.save(draft), { ok: true });
  assert.deepEqual(recovery.get(), { ok: true, drafts: [draft] });
});

test('recovery upserts, removes, and clears drafts durably', (t) => {
  const recovery = createRecovery(t);
  recovery.save({ key: 'a', content: 'one', savedValue: '' });
  recovery.save({ key: 'b', content: 'two', savedValue: '' });
  recovery.save({ key: 'a', content: 'updated', savedValue: '' });
  assert.deepEqual(recovery.get().drafts.map((draft) => [draft.key, draft.content]), [
    ['a', 'updated'],
    ['b', 'two'],
  ]);

  assert.deepEqual(recovery.remove('a'), { ok: true });
  assert.deepEqual(recovery.get().drafts.map((draft) => draft.key), ['b']);
  assert.deepEqual(recovery.clear(), { ok: true });
  assert.deepEqual(recovery.get(), { ok: true, drafts: [] });
});

test('recovery rejects a draft whose UTF-8 content exceeds the document limit without losing the existing recovery copy', (t) => {
  const recovery = createRecovery(t);
  const original = { key: 'only-copy', content: '# unsaved work', savedValue: '' };
  assert.deepEqual(recovery.save(original), { ok: true });
  const oversizedUtf8 = '你'.repeat(Math.floor(MAX_DOCUMENT_BYTES / 3) + 1);
  assert.equal(oversizedUtf8.length < MAX_DOCUMENT_BYTES, true);
  assert.equal(Buffer.byteLength(oversizedUtf8, 'utf-8') > MAX_DOCUMENT_BYTES, true);

  const result = recovery.save({
    key: 'too-large',
    content: oversizedUtf8,
    savedValue: '',
  });

  assert.equal(result.ok, false);
  assert.match(result.error, /25 MiB|过大|限制/);
  assert.deepEqual(recovery.get().drafts.map((draft) => draft.key), ['only-copy']);
});

test('recovery refuses a new draft after the draft-count limit and keeps every existing recovery copy', (t) => {
  const recovery = createRecovery(t);
  for (let index = 0; index < MAX_RECOVERY_DRAFTS; index += 1) {
    assert.deepEqual(recovery.save({ key: `draft:${index}`, content: `${index}`, savedValue: '' }), { ok: true });
  }

  const result = recovery.save({ key: 'one-too-many', content: 'keep me too', savedValue: '' });

  assert.equal(result.ok, false);
  assert.match(result.error, /数量|份|限制/);
  const drafts = recovery.get().drafts;
  assert.equal(drafts.length, MAX_RECOVERY_DRAFTS);
  assert.equal(drafts.some((draft) => draft.key === 'one-too-many'), false);
  assert.equal(drafts.some((draft) => draft.key === 'draft:0'), true);
});

test('recovery rejects an aggregate JSON payload over its persistence budget without evicting prior drafts', (t) => {
  assert.equal(Number.isSafeInteger(MAX_RECOVERY_STORE_BYTES), true);
  const recovery = createRecovery(t, { maxBytes: 1_500 });
  assert.deepEqual(recovery.save({ key: 'first', content: 'a'.repeat(400), savedValue: '' }), { ok: true });

  const result = recovery.save({ key: 'second', content: 'b'.repeat(400), savedValue: '' });

  assert.equal(result.ok, false);
  assert.match(result.error, /总量|持久化|限制/);
  assert.deepEqual(recovery.get().drafts.map((draft) => draft.key), ['first']);
});
