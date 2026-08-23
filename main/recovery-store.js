const path = require('path');
const { MAX_DOCUMENT_BYTES } = require('./document-files');
const { Store } = require('./store');

const MAX_RECOVERY_DRAFTS = 64;
const MAX_RECOVERY_STORE_BYTES = 96 * 1024 * 1024;
const MAX_RECOVERY_METADATA_BYTES = 64 * 1024;

function boundedLimit(value, fallback) {
  return Number.isSafeInteger(value) && value > 0 ? Math.min(value, fallback) : fallback;
}

function jsonStringByteLength(value, stopAfter = Number.MAX_SAFE_INTEGER) {
  let bytes = 2; // surrounding quotes
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code === 0x22 || code === 0x5c || code === 0x08 || code === 0x09
      || code === 0x0a || code === 0x0c || code === 0x0d) {
      bytes += 2;
    } else if (code <= 0x1f) {
      bytes += 6;
    } else if (code <= 0x7f) {
      bytes += 1;
    } else if (code <= 0x7ff) {
      bytes += 2;
    } else if (code >= 0xd800 && code <= 0xdbff
      && index + 1 < value.length
      && value.charCodeAt(index + 1) >= 0xdc00
      && value.charCodeAt(index + 1) <= 0xdfff) {
      bytes += 4;
      index += 1;
    } else if (code >= 0xd800 && code <= 0xdfff) {
      bytes += 6;
    } else {
      bytes += 3;
    }
    if (bytes > stopAfter) return bytes;
  }
  return bytes;
}

function recoveryJsonUpperBound(drafts, maxBytes) {
  // The fixed allowance covers keys, punctuation, indentation, timestamps and the root wrapper.
  let bytes = 64 + (drafts.length * 512);
  for (const draft of drafts) {
    for (const field of ['key', 'path', 'name', 'content', 'savedValue', 'diskValue']) {
      bytes += jsonStringByteLength(draft[field], Math.max(0, maxBytes - bytes));
      if (bytes > maxBytes) return bytes;
    }
  }
  return bytes;
}

function normalizeDraft(input, now = Date.now) {
  if (!input || typeof input !== 'object' || typeof input.key !== 'string' || input.key.length === 0) {
    return null;
  }
  if (typeof input.content !== 'string') return null;

  const draftPath = typeof input.path === 'string' ? input.path : '';
  const savedValue = typeof input.savedValue === 'string' ? input.savedValue : '';
  return {
    key: input.key,
    path: draftPath,
    name: typeof input.name === 'string' && input.name
      ? input.name
      : (draftPath ? path.basename(draftPath) : '未命名'),
    content: input.content,
    savedValue,
    diskValue: typeof input.diskValue === 'string' ? input.diskValue : savedValue,
    updatedAt: Number.isFinite(input.updatedAt) ? input.updatedAt : now(),
  };
}

class RecoveryStore {
  constructor(file, { store, now = Date.now, maxBytes } = {}) {
    this.maxBytes = boundedLimit(maxBytes, MAX_RECOVERY_STORE_BYTES);
    this.store = store || new Store(file, { drafts: [] }, { maxBytes: this.maxBytes });
    this.now = now;
  }

  get() {
    const drafts = this._drafts().map((draft) => ({ ...draft }));
    return { ok: true, drafts };
  }

  save(input) {
    const draft = normalizeDraft(input, this.now);
    if (!draft) return { ok: false, error: '恢复草稿无效' };
    if (Buffer.byteLength(draft.content, 'utf-8') > MAX_DOCUMENT_BYTES) {
      return { ok: false, error: '恢复草稿内容超过 25 MiB 限制' };
    }
    for (const field of ['savedValue', 'diskValue']) {
      if (Buffer.byteLength(draft[field], 'utf-8') > MAX_DOCUMENT_BYTES) {
        return { ok: false, error: '恢复草稿基线超过 25 MiB 限制' };
      }
    }
    for (const field of ['key', 'path', 'name']) {
      if (Buffer.byteLength(draft[field], 'utf-8') > MAX_RECOVERY_METADATA_BYTES) {
        return { ok: false, error: '恢复草稿元数据过大' };
      }
    }

    const drafts = this._drafts();
    const index = drafts.findIndex((item) => item.key === draft.key);
    if (index >= 0) drafts[index] = draft;
    else {
      if (drafts.length >= MAX_RECOVERY_DRAFTS) {
        return { ok: false, error: `恢复草稿数量超过 ${MAX_RECOVERY_DRAFTS} 份限制` };
      }
      drafts.push(draft);
    }
    if (recoveryJsonUpperBound(drafts, this.maxBytes) > this.maxBytes) {
      return { ok: false, error: '恢复草稿持久化总量超过限制' };
    }
    return this.store.set('drafts', drafts);
  }

  remove(key) {
    if (typeof key !== 'string' || key.length === 0) return { ok: false, error: '恢复草稿标识无效' };
    return this.store.set('drafts', this._drafts().filter((draft) => draft.key !== key));
  }

  clear() {
    return this.store.set('drafts', []);
  }

  _drafts() {
    const value = this.store.get('drafts', []);
    if (!Array.isArray(value)) return [];
    return value.map((draft) => normalizeDraft(draft, this.now)).filter(Boolean);
  }
}

module.exports = {
  MAX_RECOVERY_DRAFTS,
  MAX_RECOVERY_STORE_BYTES,
  RecoveryStore,
};
