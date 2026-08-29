// ============ InkFlow 墨流 · 文稿安全决策 ============
'use strict';

(function expose(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DocumentSafety = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createDocumentSafety() {
  function decide({ diskContent, diskBaseline, liveContent, savedContent, exists = true }) {
    const baseline = typeof diskBaseline === 'string' ? diskBaseline : savedContent;
    const dirty = liveContent !== savedContent;
    if (!exists) return { action: 'deleted', dirty };
    if (diskContent === baseline) return { action: 'unchanged', dirty };
    if (!dirty || liveContent === diskContent) return { action: 'accept-disk', dirty };
    return { action: 'conflict', dirty };
  }

  return Object.freeze({ decide });
}));
