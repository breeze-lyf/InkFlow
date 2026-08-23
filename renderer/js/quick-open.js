// ============ 快速打开数据源：文档库 + 最近文件 + 始终可用的打开命令 ============
(function initQuickOpen(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.QuickOpen = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  'use strict';

  function basename(value) {
    return String(value || '').replace(/\\/g, '/').split('/').pop() || String(value || '');
  }

  function buildItems({
    folderFiles = [],
    recentFiles = [],
    openFile,
    openFileDialog,
    openFolderDialog,
  }) {
    const items = [];
    const seen = new Set();
    const addFile = (file, recent) => {
      const path = typeof file === 'string' ? file : file.path;
      if (!path || seen.has(path)) return;
      seen.add(path);
      const name = typeof file === 'string' ? basename(path) : (file.name || basename(path));
      const rel = typeof file === 'string' ? path : (file.rel || path);
      items.push({
        type: 'file',
        icon: 'file',
        title: name,
        sub: recent ? `最近打开 · ${rel}` : rel,
        key: `${name} ${rel}`,
        path,
        run: () => openFile(path),
      });
    };

    folderFiles.forEach((file) => addFile(file, false));
    recentFiles.forEach((file) => addFile(file, true));
    items.push({
      type: 'cmd', icon: 'file', title: '打开文件…', sub: '从磁盘选择 Markdown 文档', key: '打开文件 open file',
      run: openFileDialog,
    });
    items.push({
      type: 'cmd', icon: 'folder', title: '打开文件夹…', sub: '切换文档库', key: '打开文件夹 open folder',
      run: openFolderDialog,
    });
    return items;
  }

  return { buildItems };
}));
