const fs = require('fs');
const path = require('path');

function compareKey(value) {
  return process.platform === 'win32' ? value.toLowerCase() : value;
}

class FileWatchRegistry {
  constructor({
    watchFn = fs.watch,
    statSync = fs.statSync,
    debounceMs = 160,
    onChange = () => {},
  } = {}) {
    this.watchFn = watchFn;
    this.statSync = statSync;
    this.debounceMs = debounceMs;
    this.onChange = onChange;
    this.files = new Map();
    this.directories = new Map();
    this.timers = new Map();
  }

  set(paths) {
    if (!Array.isArray(paths) || paths.some((file) => typeof file !== 'string' || !path.isAbsolute(file))) {
      return { ok: false, error: '监听路径无效' };
    }

    const desired = new Map(paths.map((file) => {
      const absolute = path.resolve(file);
      return [compareKey(absolute), absolute];
    }));
    for (const key of this.files.keys()) {
      if (!desired.has(key)) this._remove(key);
    }
    try {
      for (const [key, file] of desired) {
        if (!this.files.has(key)) this._add(key, file);
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err && err.message ? err.message : String(err) };
    }
  }

  clear() {
    return this.set([]);
  }

  _add(key, file) {
    const dir = path.dirname(file);
    const dirKey = compareKey(dir);
    let group = this.directories.get(dirKey);
    if (!group) {
      group = { dir, files: new Set(), watcher: null };
      group.watcher = this.watchFn(dir, (eventType, filename) => this._handle(group, eventType, filename));
      if (group.watcher && typeof group.watcher.on === 'function') {
        group.watcher.on('error', () => this._handle(group, 'error', null));
      }
      this.directories.set(dirKey, group);
    }
    group.files.add(key);
    this.files.set(key, { path: file, dirKey });
  }

  _remove(key) {
    const entry = this.files.get(key);
    if (!entry) return;
    const timer = this.timers.get(key);
    if (timer) clearTimeout(timer);
    this.timers.delete(key);
    this.files.delete(key);

    const group = this.directories.get(entry.dirKey);
    if (!group) return;
    group.files.delete(key);
    if (group.files.size === 0) {
      try { group.watcher.close(); } catch { /* watcher 可能已失效 */ }
      this.directories.delete(entry.dirKey);
    }
  }

  _handle(group, eventType, filename) {
    const name = filename == null ? null : String(filename);
    for (const key of group.files) {
      const entry = this.files.get(key);
      if (!entry || (name !== null && compareKey(path.basename(entry.path)) !== compareKey(name))) continue;
      const existing = this.timers.get(key);
      if (existing) clearTimeout(existing);
      this.timers.set(key, setTimeout(() => {
        this.timers.delete(key);
        let exists = true;
        let mtime = 0;
        try {
          mtime = this.statSync(entry.path).mtimeMs;
        } catch {
          exists = false;
        }
        this.onChange({ path: entry.path, eventType, exists, mtime });
      }, this.debounceMs));
    }
  }
}

module.exports = { FileWatchRegistry };
