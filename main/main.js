// InkFlow 墨流 —— Electron 主进程
const { app, BrowserWindow, ipcMain, dialog, shell, nativeTheme, session, utilityProcess } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const { Store } = require('./store');
const { RecoveryStore } = require('./recovery-store');
const { PathGrants } = require('./path-grants');
const { assertTrustedIpcSender } = require('./ipc-security');
const { readDocument, writeDocument } = require('./document-files');
const { readDirectory, walkMarkdown } = require('./directory-files');
const { FileWatchRegistry } = require('./file-watch');
const { prepareExportPayload } = require('./export-security');
const { startupFailure } = require('./startup');
const { markdownFilesFromArgv } = require('./open-requests');
const { installRendererNetworkGuard } = require('./network-policy');
const { withTimeout } = require('./async-timeout');
const { readSafeSvgAsset } = require('./svg-assets');
const { readExistingRecent } = require('./recent-files');
const { createExportTemp } = require('./export-temp');
const { writeOutputFile } = require('./output-files');
const { fixedCssLinks, fixedCssText, normalizeExportTheme } = require('./export-styles');
const { convertHtmlToDocx, createUtilityWorkerSpawner } = require('./docx-converter');
const { authorizeDocumentAssets, writableAssetsDirectory } = require('./document-assets');
const { startAssetServer } = require('./server');
const { buildMenu } = require('./menu');
const { createSmokeRunner } = require('./smoke');
const { DISPLAY_NAME, preserveUserDataLocation } = require('./app-identity');

const isSmoke = process.env.SMOKE === '1';
preserveUserDataLocation(app, { isSmoke });
const gotLock = app.requestSingleInstanceLock();
if (!gotLock && !isSmoke) {
  app.quit();
}

let mainWin = null;
let assetServer = null;
let assetUrl = '';
const ephemeralExportFiles = new Set();
let rendererIsReady = false;
let pendingOpenFiles = [];

// 文档库目录监听：外部新增/删除/修改文件时通知渲染端无感刷新
let fsWatcher = null;
let fsWatchTimer = null;
function watchFolder(dir) {
  if (fsWatcher) {
    try { fsWatcher.close(); } catch { /* 忽略 */ }
    fsWatcher = null;
  }
  if (!dir) return;
  try {
    fsWatcher = fs.watch(dir, { recursive: true }, () => {
      clearTimeout(fsWatchTimer);
      fsWatchTimer = setTimeout(() => {
        if (mainWin && !mainWin.isDestroyed()) {
          mainWin.webContents.send('menu:action', { action: 'tree-fs-changed' });
        }
      }, 350);
    });
    fsWatcher.on('error', () => {});
  } catch { /* 目录不可监听时静默降级 */ }
}

const userData = app.getPath('userData');
const settings = new Store(path.join(userData, 'settings.json'), {
  theme: 'system',
  accent: 'indigo',
  fontSize: 16,
  showToolbar: false,
  focusMode: false,
  typewriter: true,
  sidebarVisible: true,
  sidebarWidth: 260,
  sidebarTab: 'files',
  openFolder: '',
  openTabs: [],
  activeTab: '',
});
const recentStore = new Store(path.join(userData, 'recent.json'), { files: [], folders: [] });
const recoveryStore = new RecoveryStore(path.join(userData, 'recovery.json'));
const pathGrants = new PathGrants();
const pendingFileChanges = new Set();
let fileChangeTimer = null;
const fileWatches = new FileWatchRegistry({
  onChange: ({ path: changedPath }) => {
    pendingFileChanges.add(changedPath);
    clearTimeout(fileChangeTimer);
    fileChangeTimer = setTimeout(() => {
      if (mainWin && !mainWin.isDestroyed() && pendingFileChanges.size) {
        mainWin.webContents.send('files:changed', { paths: [...pendingFileChanges] });
      }
      pendingFileChanges.clear();
    }, 80);
  },
});

function grantFile(p, { writable = true } = {}) {
  if (!p) return { ok: false, error: '路径无效' };
  const access = writable ? ['read', 'write', 'asset'] : ['read', 'asset'];
  const result = pathGrants.grant(p, { kind: 'file', access });
  // 单文件文稿只能读取父目录资源，并在自己的 assets/ 内写图片；不会因此
  // 获得父目录其他文件的通用 read/write 能力。
  if (result.ok) authorizeDocumentAssets(pathGrants, result.path, { writable });
  return result;
}

function grantFolder(p, { writable = true } = {}) {
  if (!p) return { ok: false, error: '路径无效' };
  return pathGrants.grant(p, {
    kind: 'directory',
    access: writable ? ['read', 'write', 'asset'] : ['read', 'asset'],
  });
}

function restorePathGrants() {
  grantFolder(path.join(__dirname, '..', 'samples'), { writable: false });
  const folder = settings.get('openFolder', '');
  if (folder) grantFolder(folder);
  for (const file of settings.get('openTabs', []) || []) grantFile(file);
  for (const file of recentStore.get('files', []) || []) grantFile(file);
  for (const folderPath of recentStore.get('folders', []) || []) grantFolder(folderPath);
  const recovery = recoveryStore.get();
  for (const draft of recovery.drafts || []) {
    if (draft.path) grantFile(draft.path);
  }
}

restorePathGrants();
pendingOpenFiles = markdownFilesFromArgv(process.argv);
pendingOpenFiles.forEach((file) => grantFile(file));

function sendOpenFile(file) {
  if (!file) return;
  grantFile(file);
  if (!rendererIsReady || !mainWin || mainWin.isDestroyed()) {
    if (!pendingOpenFiles.includes(file)) pendingOpenFiles.push(file);
    return;
  }
  mainWin.webContents.send('menu:action', { action: 'open-path', payload: file });
}

function flushOpenFiles() {
  if (!rendererIsReady || !mainWin || mainWin.isDestroyed()) return;
  const files = pendingOpenFiles;
  pendingOpenFiles = [];
  files.forEach((file) => sendOpenFile(file));
}

function addRecent(p, type) {
  if (!p) return;
  const key = type === 'folder' ? 'folders' : 'files';
  let list = recentStore.get(key, []);
  list = [p, ...list.filter((x) => x !== p)].slice(0, 12);
  recentStore.set(key, list);
  refreshMenu();
}

function getRecent() {
  return readExistingRecent(recentStore);
}

function refreshMenu() {
  if (!mainWin) return;
  buildMenu(mainWin, {
    getRecent,
    clearRecent: () => recentStore.set({ files: [], folders: [] }),
    getSetting: (k, d) => settings.get(k, d),
  });
}

// 跨平台文档目录：Windows → 文档，Linux → XDG documents（可能回退 home）
function docsDir() {
  try {
    return app.getPath('documents');
  } catch {
    return os.homedir();
  }
}

function appSamplesDir() {
  const copied = path.join(docsDir(), '墨流示例');
  const dir = fs.existsSync(copied) ? copied : path.join(__dirname, '..', 'samples');
  grantFolder(dir, { writable: dir === copied });
  return dir;
}

function waitForRendererReady(timeoutMs = 8000) {
  return new Promise((resolve) => {
    let timer;
    const done = () => {
      clearTimeout(timer);
      ipcMain.removeListener('renderer:ready', listener);
      resolve();
    };
    const listener = (event) => {
      try { assertTrustedIpcSender(event, mainWin); } catch { return; }
      done();
    };
    ipcMain.on('renderer:ready', listener);
    timer = setTimeout(done, timeoutMs);
  });
}

// ---------- 窗口 ----------
function createWindow() {
  const themeMode = settings.get('theme', 'system');
  const dark = themeMode === 'dark' || (themeMode === 'system' && nativeTheme.shouldUseDarkColors);
  const isMac = process.platform === 'darwin';

  const rendererEntry = path.join(__dirname, '..', 'renderer', 'index.html');
  const rendererUrl = pathToFileURL(rendererEntry).href;
  mainWin = new BrowserWindow({
    width: isSmoke ? 1440 : 1240,
    height: isSmoke ? 920 : 820,
    minWidth: 880,
    minHeight: 560,
    title: DISPLAY_NAME,
    // 仅 macOS 使用隐藏式标题栏（红绿灯）；Windows/Linux 用原生标题栏 + 系统菜单
    ...(isMac
      ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 16, y: 14 } }
      : {}),
    backgroundColor: dark ? '#14161a' : '#f7f5f0',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  mainWin.loadFile(rendererEntry);

  mainWin.once('ready-to-show', () => {
    mainWin.show();
  });

  // 外链在浏览器打开，禁止窗口内跳转
  mainWin.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWin.webContents.on('will-navigate', (e, url) => {
    let target = '';
    try {
      const parsed = new URL(url);
      parsed.hash = '';
      target = parsed.href;
    } catch { /* 非法 URL 一律拦截 */ }
    if (target !== rendererUrl) e.preventDefault();
  });

  mainWin.on('close', (e) => {
    // 交给渲染进程确认未保存内容
    if (!mainWin.forceClose) {
      e.preventDefault();
      mainWin.webContents.send('menu:action', { action: 'try-quit' });
    }
  });

  refreshMenu();
}

// ---------- IPC ----------
function registerIPC() {
  const handle = (channel, listener) => {
    ipcMain.handle(channel, (event, ...args) => {
      assertTrustedIpcSender(event, mainWin);
      return listener(event, ...args);
    });
  };
  const on = (channel, listener) => {
    ipcMain.on(channel, (event, ...args) => {
      try {
        assertTrustedIpcSender(event, mainWin);
        return listener(event, ...args);
      } catch (err) {
        // sendSync 调用必须有确定性返回；普通 send 则只忽略不可信消息。
        if (channel === 'path:grant-file-drop') event.returnValue = { ok: false, error: err.message };
        return undefined;
      }
    });
  };

  handle('app:info', () => ({
    version: app.getVersion(),
    platform: process.platform,
    assetUrl,
    sep: path.sep,
    home: os.homedir(),
    samplesDir: appSamplesDir(),
  }));

  on('renderer:ready', () => {
    rendererIsReady = true;
    // 冷启动时被要求打开的文件（Finder 双击 md）：渲染就绪后立即打开
    flushOpenFiles();
    // 首次启动：把示例文档库复制到 ~/Documents/墨流示例 并打开
    if (isSmoke) return;
    if (settings.get('firstRunDone')) return;
    settings.set('firstRunDone', true);
    try {
      const srcDir = path.join(__dirname, '..', 'samples');
      const destDir = path.join(docsDir(), '墨流示例');
      if (!fs.existsSync(destDir)) {
        fs.mkdirSync(destDir, { recursive: true });
        for (const name of fs.readdirSync(srcDir)) {
          const s = path.join(srcDir, name);
          if (fs.statSync(s).isFile()) fs.copyFileSync(s, path.join(destDir, name));
        }
        const assetsDest = path.join(destDir, 'assets');
        fs.mkdirSync(assetsDest, { recursive: true });
        const iconSrc = path.join(__dirname, '..', 'assets', 'icon.png');
        if (fs.existsSync(iconSrc)) fs.copyFileSync(iconSrc, path.join(assetsDest, 'icon.png'));
      }
      grantFolder(destDir);
      setTimeout(() => {
        if (mainWin && !mainWin.isDestroyed()) {
          mainWin.webContents.send('menu:action', { action: 'open-path', payload: destDir });
          setTimeout(() => {
            if (mainWin && !mainWin.isDestroyed()) {
              mainWin.webContents.send('menu:action', { action: 'open-path', payload: path.join(destDir, '功能演示.md') });
            }
          }, 800);
        }
      }, 600);
    } catch (e) {
      // 首启引导失败不影响使用
    }
  });

  handle('settings:get', (e, key) => settings.get(key));
  handle('settings:set', (e, patch) => {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
      return { ok: false, error: '设置内容无效' };
    }
    const sessionPaths = [
      ...(patch.openFolder ? [patch.openFolder] : []),
      ...(Array.isArray(patch.openTabs) ? patch.openTabs : []),
      ...(patch.activeTab ? [patch.activeTab] : []),
    ];
    if (sessionPaths.some((p) => !pathGrants.allows(p, 'read'))) {
      return { ok: false, error: '会话包含未授权路径' };
    }
    const saved = settings.set(patch);
    if (!saved.ok) return saved;
    refreshMenu();
    if (Object.prototype.hasOwnProperty.call(patch, 'openFolder')) {
      watchFolder(patch.openFolder);
    }
    return true;
  });

  handle('recent:get', () => getRecent());
  handle('recent:add', (e, { path: p, type }) => {
    if (!pathGrants.allows(p, 'read')) return { ok: false, error: '路径未授权' };
    addRecent(p, type);
    return true;
  });

  // ---- 对话框 ----
  handle('dialog:open-file', async () => {
    const r = await dialog.showOpenDialog(mainWin, {
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Markdown', extensions: ['md', 'markdown', 'mdown', 'txt'] }],
    });
    if (r.canceled) return [];
    r.filePaths.forEach((p) => grantFile(p));
    return r.filePaths;
  });
  handle('dialog:open-folder', async () => {
    const r = await dialog.showOpenDialog(mainWin, { properties: ['openDirectory'] });
    if (r.canceled) return null;
    grantFolder(r.filePaths[0]);
    return r.filePaths[0];
  });
  handle('dialog:save-as', async (e, { defaultName }) => {
    const r = await dialog.showSaveDialog(mainWin, {
      defaultPath: defaultName || '未命名.md',
      filters: [{ name: 'Markdown', extensions: ['md'] }],
    });
    if (r.canceled) return null;
    grantFile(r.filePath);
    return r.filePath;
  });
  handle('dialog:pick-images', async () => {
    const r = await dialog.showOpenDialog(mainWin, {
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'] }],
    });
    if (r.canceled) return [];
    r.filePaths.forEach((p) => grantFile(p, { writable: false }));
    return r.filePaths;
  });
  handle('dialog:save-export', async (e, { defaultName, ext }) => {
    const r = await dialog.showSaveDialog(mainWin, {
      defaultPath: defaultName,
      filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
    });
    if (r.canceled) return null;
    pathGrants.grant(r.filePath, { kind: 'file', access: ['write'] });
    return r.filePath;
  });

  // 只有 preload 通过 webUtils 从真实 File 对象解析出的路径会走这个同步授权点。
  on('path:grant-file-drop', (e, p) => {
    const result = grantFile(p);
    e.returnValue = result;
  });

  // ---- 崩溃恢复 ----
  handle('recovery:get', () => recoveryStore.get());
  handle('recovery:save', (e, draft) => {
    if (draft && draft.path && !pathGrants.allows(draft.path, 'read')) {
      return { ok: false, error: '恢复草稿包含未授权路径' };
    }
    return recoveryStore.save(draft);
  });
  handle('recovery:remove', (e, key) => recoveryStore.remove(key));
  handle('recovery:clear', () => recoveryStore.clear());

  // ---- 库外单文件监听（监听父目录，可跨原子替换继续工作） ----
  handle('file-watch:set', (e, paths) => {
    if (!Array.isArray(paths) || paths.some((p) => !pathGrants.allows(p, 'read'))) {
      return { ok: false, error: '监听路径未授权' };
    }
    return fileWatches.set(paths);
  });

  // ---- 文件系统 ----
  handle('fs:read-file', (e, p) => {
    if (!pathGrants.allows(p, 'read')) return { ok: false, error: '路径未授权' };
    return readDocument(p);
  });

  handle('fs:write-file', (e, { path: p, content, options }) => {
    if (!pathGrants.allows(p, 'write')) return { ok: false, error: '路径未授权' };
    return writeDocument(p, content, options || {});
  });

  handle('fs:read-dir', async (e, dir, opts) => {
    if (!pathGrants.allows(dir, 'read')) return { ok: false, error: '路径未授权' };
    return readDirectory(dir, {
      sort: (opts && opts.sort) || 'name',
      allows: (p) => pathGrants.allows(p, 'read'),
    });
  });

  handle('fs:create', (e, { parent, name, isDir }) => {
    try {
      const p = path.join(parent, name);
      if (!pathGrants.allows(parent, 'write') || !pathGrants.allows(p, 'write')) {
        return { ok: false, error: '路径未授权' };
      }
      if (fs.existsSync(p)) return { ok: false, error: '同名文件已存在' };
      if (isDir) fs.mkdirSync(p, { recursive: true });
      else fs.writeFileSync(p, '', 'utf-8');
      return { ok: true, path: p };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  handle('fs:rename', (e, { from, to }) => {
    if (!pathGrants.allows(from, 'write') || !pathGrants.allows(to, 'write')) {
      return { ok: false, error: '路径未授权' };
    }
    try {
      if (fs.existsSync(to)) return { ok: false, error: '目标名称已存在' };
      fs.renameSync(from, to);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  handle('fs:delete', async (e, p) => {
    if (!pathGrants.allows(p, 'write')) return { ok: false, error: '路径未授权' };
    try {
      await shell.trashItem(p);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  handle('fs:exists', (e, p) => pathGrants.allows(p, 'read') && fs.existsSync(p));
  handle('fs:stat', (e, p) => {
    if (!pathGrants.allows(p, 'read')) return { ok: false, error: '路径未授权' };
    try {
      const st = fs.statSync(p);
      return { ok: true, isDir: st.isDirectory(), mtime: st.mtimeMs };
    } catch {
      return { ok: false };
    }
  });

  handle('fs:reveal', (e, p) => {
    if (!pathGrants.allows(p, 'read')) return { ok: false, error: '路径未授权' };
    shell.showItemInFolder(p);
    return true;
  });

  handle('fs:copy-image', (e, { src, targetDir }) => {
    if (!pathGrants.allows(src, 'read')) return { ok: false, error: '路径未授权' };
    try {
      const assetsDir = writableAssetsDirectory(pathGrants, targetDir);
      if (!assetsDir) return { ok: false, error: '资源目录未授权' };
      fs.mkdirSync(assetsDir, { recursive: true });
      const ext = path.extname(src) || '.png';
      const base = path.basename(src, ext).replace(/[^\w一-龥-]+/g, '-').slice(0, 40) || 'image';
      let name = `${base}${ext}`;
      let dest = path.join(assetsDir, name);
      let i = 1;
      while (fs.existsSync(dest)) {
        name = `${base}-${i++}${ext}`;
        dest = path.join(assetsDir, name);
      }
      if (!pathGrants.allows(dest, 'write')) return { ok: false, error: '资源路径未授权' };
      fs.copyFileSync(src, dest);
      return { ok: true, relPath: `assets/${name}` };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  handle('fs:save-image-bytes', (e, { bytes, name, targetDir }) => {
    try {
      const assetsDir = writableAssetsDirectory(pathGrants, targetDir);
      if (!assetsDir) return { ok: false, error: '资源目录未授权' };
      fs.mkdirSync(assetsDir, { recursive: true });
      const ext = path.extname(name) || '.png';
      const stamp = new Date();
      const pad = (n) => String(n).padStart(2, '0');
      const base = `${stamp.getFullYear()}${pad(stamp.getMonth() + 1)}${pad(stamp.getDate())}-${pad(stamp.getHours())}${pad(stamp.getMinutes())}${pad(stamp.getSeconds())}`;
      let fileName = `${base}${ext}`;
      let dest = path.join(assetsDir, fileName);
      let i = 1;
      while (fs.existsSync(dest)) {
        fileName = `${base}-${i++}${ext}`;
        dest = path.join(assetsDir, fileName);
      }
      if (!pathGrants.allows(dest, 'write')) return { ok: false, error: '资源路径未授权' };
      fs.writeFileSync(dest, Buffer.from(bytes));
      return { ok: true, relPath: `assets/${fileName}` };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // 列出库内全部 markdown 文件（供快速打开）
  handle('fs:walk-md', async (e, root) => {
    if (!pathGrants.allows(root, 'read')) return [];
    return walkMarkdown(root, { allows: (p) => pathGrants.allows(p, 'read') });
  });

  // ---- 窗口状态 ----
  on('win:set-file', (e, { path: p, edited }) => {
    if (!mainWin) return;
    if (p && !pathGrants.allows(p, 'read')) return;
    if (process.platform === 'darwin') {
      mainWin.setRepresentedFilename(p || '');
      mainWin.setDocumentEdited(!!edited);
    } else {
      // Windows/Linux：原生标题栏显示当前文件名与编辑状态
      const name = p ? path.basename(p) : '未命名';
      mainWin.setTitle(`${name}${edited ? ' •' : ''} — ${DISPLAY_NAME}`);
    }
  });

  on('win:confirm-close', () => {
    if (mainWin) {
      mainWin.forceClose = true;
      app.quit(); // 关键：直接 close() 只关窗口，⌘Q 语义是终止进程
    }
  });

  // ---- 导出 ----
  // showSaveDialog 返回 {canceled, filePath}；测试钩子允许跳过对话框
  async function pickSavePath(opts) {
    if (process.env.INKFLOW_TEST_SAVEPATH) return process.env.INKFLOW_TEST_SAVEPATH;
    const r = await dialog.showSaveDialog(mainWin, opts);
    return r.canceled ? null : r.filePath;
  }

  const exportCsp = "default-src 'none'; img-src data:; style-src 'unsafe-inline' file:; font-src data: file:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
  const appRoot = path.join(__dirname, '..');
  const cleanupExportTemp = (temporary) => {
    if (!temporary) return;
    ephemeralExportFiles.delete(temporary.file);
    const result = temporary.cleanup();
    if (!result.ok) console.error(`[export] 临时文件清理失败 ${temporary.file}: ${result.error}`);
  };

  handle('export:pdf', async (e, payload) => {
    const safe = prepareExportPayload(payload, { format: 'pdf', pathGrants });
    if (safe.error) return { ok: false, error: safe.error };
    const html = safe.html;
    const cssLinks = fixedCssLinks(appRoot, 'light');
    const suggestedName = typeof safe.suggestedName === 'string' ? safe.suggestedName : '未命名.pdf';
    const savePath = await pickSavePath({
      defaultPath: suggestedName,
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });
    if (!savePath) return { ok: false, canceled: true };

    const doc = `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${exportCsp}">
${cssLinks.map((h) => `<link rel="stylesheet" href="${h}">`).join('\n')}
<style>
  @page { size: A4; }
  html { -webkit-print-color-adjust: exact; }
  body { padding: 36px 44px; max-width: none; margin: 0 auto; }
  h1, h2, h3 { page-break-after: avoid; }
  pre, blockquote, table { page-break-inside: avoid; }
  pre { white-space: pre-wrap !important; word-break: break-all; }
  img { max-width: 100% !important; }
</style>
</head><body class="vditor-reset">${html}</body></html>`;
    let temporary;
    let printWin;
    try {
      temporary = createExportTemp(doc);
      ephemeralExportFiles.add(temporary.file);
      printWin = new BrowserWindow({
        show: false,
        webPreferences: { sandbox: true, contextIsolation: true },
      });
      await withTimeout(printWin.loadFile(temporary.file), 15000, 'PDF 页面加载');
      await new Promise((r) => setTimeout(r, 900));
      const pdf = await withTimeout(printWin.webContents.printToPDF({
        pageSize: 'A4',
        printBackground: true,
        margins: { marginType: 'custom', top: 0.55, bottom: 0.55, left: 0.5, right: 0.5 },
      }), 30000, 'PDF 生成');
      const written = writeOutputFile(savePath, pdf);
      if (!written.ok) return written;
      if (!process.env.INKFLOW_TEST_SAVEPATH) shell.showItemInFolder(savePath);
      return { ok: true, path: savePath, rejectedImages: safe.rejectedImages };
    } catch (err) {
      return { ok: false, error: err.message };
    } finally {
      try {
        if (printWin && !printWin.isDestroyed()) printWin.destroy();
      } catch { /* 窗口销毁失败不应阻止私有临时文件清理 */ }
      cleanupExportTemp(temporary);
    }
  });

  handle('export:html', async (e, payload) => {
    const safe = prepareExportPayload(payload, { format: 'html', pathGrants });
    if (safe.error) return { ok: false, error: safe.error };
    const html = safe.html;
    let cssTexts;
    try {
      cssTexts = fixedCssText(appRoot, normalizeExportTheme(safe.theme));
    } catch (error) {
      return { ok: false, error: error.message };
    }
    const suggestedName = typeof safe.suggestedName === 'string' ? safe.suggestedName : '未命名.html';
    const savePath = await pickSavePath({
      defaultPath: suggestedName,
      filters: [{ name: 'HTML', extensions: ['html'] }],
    });
    if (!savePath) return { ok: false, canceled: true };
    const doc = `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${exportCsp}">
<title>${safe.metadata.title || '未命名'}</title>
<style>${cssTexts.join('\n')}</style>
<style>body{padding:48px 24px;max-width:820px;margin:0 auto;}img{max-width:100%!important;}</style>
</head><body class="vditor-reset">${html}</body></html>`;
    try {
      const written = writeOutputFile(savePath, doc);
      if (!written.ok) return written;
      if (!process.env.INKFLOW_TEST_SAVEPATH) shell.showItemInFolder(savePath);
      return { ok: true, path: savePath, rejectedImages: safe.rejectedImages };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  handle('export:word', async (e, payload) => {
    const safe = prepareExportPayload(payload, { format: 'word', pathGrants });
    if (safe.error) return { ok: false, error: safe.error };
    const html = safe.html;
    let cssTexts;
    try {
      cssTexts = fixedCssText(appRoot, 'light', { word: true });
    } catch (error) {
      return { ok: false, error: error.message };
    }
    const suggestedName = typeof safe.suggestedName === 'string' ? safe.suggestedName : '未命名.docx';
    const savePath = await pickSavePath({
      defaultPath: suggestedName,
      filters: [{ name: 'Word 文档', extensions: ['docx'] }],
    });
    if (!savePath) return { ok: false, canceled: true };
    try {
      const doc = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${cssTexts.join('\n')}</style></head><body>${html}</body></html>`;
      const buf = await convertHtmlToDocx(doc, {
        spawnWorker: createUtilityWorkerSpawner(utilityProcess),
      });
      const written = writeOutputFile(savePath, buf);
      if (!written.ok) return written;
      if (!process.env.INKFLOW_TEST_SAVEPATH) shell.showItemInFolder(savePath);
      return { ok: true, path: savePath, rejectedImages: safe.rejectedImages };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  handle('export:image', async (e, payload) => {
    const safe = prepareExportPayload(payload, { format: 'image', pathGrants });
    if (safe.error) return { ok: false, error: safe.error };
    const html = safe.html;
    const cssLinks = fixedCssLinks(appRoot, 'light');
    const suggestedName = typeof safe.suggestedName === 'string' ? safe.suggestedName : '未命名.png';
    const savePath = await pickSavePath({
      defaultPath: suggestedName,
      filters: [{ name: 'PNG 图片', extensions: ['png'] }],
    });
    if (!savePath) return { ok: false, canceled: true };

    const doc = `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${exportCsp}">
${cssLinks.map((h) => `<link rel="stylesheet" href="${h}">`).join('\n')}
<style>
  body { padding: 48px 52px; max-width: 820px; margin: 0 auto; background: #faf9f5; }
  img { max-width: 100% !important; }
</style>
</head><body class="vditor-reset">${html}</body></html>`;
    // 2x 高清长图：窗口宽度 = 栏宽(820) × 缩放(2)，布局视口保持 820 CSS px。
    // 高度同理：逻辑高度必须 = CSS 高 × SCALE（否则视口只有一半 CSS 高，长图被腰斩）
    const SCALE = 2;
    const COL = 820;
    let temporary;
    let shotWin;
    try {
      temporary = createExportTemp(doc);
      ephemeralExportFiles.add(temporary.file);
      shotWin = new BrowserWindow({
        show: false,
        width: COL * SCALE,
        height: 1200,
        webPreferences: { sandbox: true, contextIsolation: true },
      });
      await withTimeout(shotWin.loadFile(temporary.file), 15000, '图片页面加载');
      await shotWin.webContents.setZoomFactor(SCALE);
      await new Promise((r) => setTimeout(r, 1100));
      const cssH = await withTimeout(shotWin.webContents.executeJavaScript(
        '(document.body.scrollHeight || 800) + 20'
      ), 5000, '图片高度测量');
      if (!Number.isFinite(cssH) || cssH <= 0 || cssH > 8000) {
        return { ok: false, error: '文稿过长，PNG 长图高度超过 8000 像素安全上限；请拆分文稿后重试' };
      }
      shotWin.setContentSize(COL * SCALE, Math.max(480, Math.ceil(cssH * SCALE)));
      await new Promise((r) => setTimeout(r, 500));
      const img = await withTimeout(shotWin.webContents.capturePage(), 30000, '图片捕获');
      const written = writeOutputFile(savePath, img.toPNG());
      if (!written.ok) return written;
      if (!process.env.INKFLOW_TEST_SAVEPATH) shell.showItemInFolder(savePath);
      return { ok: true, path: savePath, rejectedImages: safe.rejectedImages };
    } catch (err) {
      return { ok: false, error: err.message };
    } finally {
      try {
        if (shotWin && !shotWin.isDestroyed()) shotWin.destroy();
      } catch { /* 窗口销毁失败不应阻止私有临时文件清理 */ }
      cleanupExportTemp(temporary);
    }
  });

  handle('asset:read-svg', (e, file) => readSafeSvgAsset(file, { pathGrants }));

  handle('theme:get-dark', () => {
    const mode = settings.get('theme', 'system');
    return mode === 'dark' || (mode === 'system' && nativeTheme.shouldUseDarkColors);
  });
}

// ---------- 生命周期 ----------
app.whenReady().then(async () => {
  const r = await startAssetServer({ pathGrants });
  assetServer = r.server;
  assetUrl = r.url;
  installRendererNetworkGuard(session.defaultSession, {
    getAssetUrl: () => assetUrl,
    getAppRoot: () => path.join(__dirname, '..'),
    getEphemeralFiles: () => ephemeralExportFiles,
  });

  registerIPC();
  createWindow();
  watchFolder(settings.get('openFolder', ''));

  nativeTheme.on('updated', () => {
    if (settings.get('theme') === 'system' && mainWin) {
      mainWin.webContents.send('menu:action', { action: 'system-theme-changed' });
    }
  });

  if (isSmoke) {
    const smoke = createSmokeRunner({
      app,
      getMainWindow: () => mainWin,
      projectRoot: path.join(__dirname, '..'),
      waitForRendererReady,
      grantFile,
      grantFolder,
      convertWord: (html) => convertHtmlToDocx(html, {
        spawnWorker: createUtilityWorkerSpawner(utilityProcess),
      }),
    });
    smoke.run().catch((err) => {
      console.error('[smoke] runner failed:', err);
      if (mainWin && !mainWin.isDestroyed()) mainWin.forceClose = true;
      app.exit(1);
    });
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}).catch((err) => startupFailure(err, { app, dialog }));

app.on('second-instance', (event, commandLine, workingDirectory) => {
  markdownFilesFromArgv(commandLine, { cwd: workingDirectory || process.cwd() }).forEach(sendOpenFile);
  if (mainWin) {
    if (mainWin.isMinimized()) mainWin.restore();
    mainWin.focus();
  }
});

// Finder 双击/拖拽 .md 到 Dock：运行中直接开页签，冷启动排队等渲染就绪
app.on('open-file', (e, p) => {
  e.preventDefault();
  sendOpenFile(p);
  if (mainWin && !mainWin.isDestroyed()) {
    if (mainWin.isMinimized()) mainWin.restore();
    mainWin.show();
    mainWin.focus();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
  clearTimeout(fileChangeTimer);
  fileWatches.clear();
});
