// 预加载脚本：安全桥接主进程能力
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ink', {
  info: () => ipcRenderer.invoke('app:info'),
  ready: () => ipcRenderer.send('renderer:ready'),

  // 设置 / 最近
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  getRecent: () => ipcRenderer.invoke('recent:get'),
  addRecent: (p, type) => ipcRenderer.invoke('recent:add', { path: p, type }),

  // 对话框
  openFileDialog: () => ipcRenderer.invoke('dialog:open-file'),
  openFolderDialog: () => ipcRenderer.invoke('dialog:open-folder'),
  saveAsDialog: (defaultName) => ipcRenderer.invoke('dialog:save-as', { defaultName }),
  pickImages: () => ipcRenderer.invoke('dialog:pick-images'),
  saveExportDialog: (defaultName, ext) => ipcRenderer.invoke('dialog:save-export', { defaultName, ext }),

  // 文件
  readFile: (p) => ipcRenderer.invoke('fs:read-file', p),
  writeFile: (p, content) => ipcRenderer.invoke('fs:write-file', { path: p, content }),
  readDir: (p) => ipcRenderer.invoke('fs:read-dir', p),
  create: (parent, name, isDir) => ipcRenderer.invoke('fs:create', { parent, name, isDir }),
  rename: (from, to) => ipcRenderer.invoke('fs:rename', { from, to }),
  trash: (p) => ipcRenderer.invoke('fs:delete', p),
  exists: (p) => ipcRenderer.invoke('fs:exists', p),
  stat: (p) => ipcRenderer.invoke('fs:stat', p),
  reveal: (p) => ipcRenderer.invoke('fs:reveal', p),
  copyImage: (src, targetDir) => ipcRenderer.invoke('fs:copy-image', { src, targetDir }),
  saveImageBytes: (bytes, name, targetDir) => ipcRenderer.invoke('fs:save-image-bytes', { bytes, name, targetDir }),
  walkMd: (root) => ipcRenderer.invoke('fs:walk-md', root),

  // 窗口
  setWindowFile: (p, edited) => ipcRenderer.send('win:set-file', { path: p, edited }),
  confirmClose: () => ipcRenderer.send('win:confirm-close'),

  // 导出
  exportPdf: (payload) => ipcRenderer.invoke('export:pdf', payload),
  exportHtml: (payload) => ipcRenderer.invoke('export:html', payload),
  readCss: (rel) => ipcRenderer.invoke('css:read', rel),
  isDark: () => ipcRenderer.invoke('theme:get-dark'),

  // 菜单事件
  onMenu: (cb) => {
    const listener = (e, data) => cb(data);
    ipcRenderer.on('menu:action', listener);
    return () => ipcRenderer.removeListener('menu:action', listener);
  },
});
