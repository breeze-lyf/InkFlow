const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const path = require('node:path');
const test = require('node:test');

const { FileWatchRegistry } = require('../../main/file-watch');

test('file watching survives atomic replacement and only reports subscribed files', async () => {
  const watchedDirectories = [];
  const callbacks = [];
  const watchFn = (dir, callback) => {
    const watcher = new EventEmitter();
    watcher.close = () => {};
    watchedDirectories.push(dir);
    callbacks.push(callback);
    return watcher;
  };
  const changes = [];
  const registry = new FileWatchRegistry({
    watchFn,
    statSync: () => ({ mtimeMs: 42 }),
    debounceMs: 0,
    onChange: (change) => changes.push(change),
  });
  const file = path.resolve('/tmp/inkflow-watch/note.md');

  assert.deepEqual(registry.set([file]), { ok: true });
  assert.deepEqual(watchedDirectories, [path.dirname(file)]);

  callbacks[0]('change', 'other.md');
  callbacks[0]('rename', 'note.md');
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.deepEqual(changes, [{ path: file, eventType: 'rename', exists: true, mtime: 42 }]);

  assert.deepEqual(registry.set([]), { ok: true });
  callbacks[0]('change', 'note.md');
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(changes.length, 1);
});
