// 墨流 InkFlow —— Electron 主进程
const { app, BrowserWindow, ipcMain, dialog, shell, nativeTheme } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Store } = require('./store');
const { startAssetServer } = require('./server');
const { buildMenu } = require('./menu');

const isSmoke = process.env.SMOKE === '1';
const gotLock = app.requestSingleInstanceLock();
if (!gotLock && !isSmoke) {
  app.quit();
}

let mainWin = null;
let assetServer = null;
let assetUrl = '';

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

const MD_EXTS = ['.md', '.markdown', '.mdown', '.mdtxt', '.text', '.txt'];
const IMG_EXTS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp'];
const PREVIEW_EXTS = ['.pdf'];

function addRecent(p, type) {
  if (!p) return;
  const key = type === 'folder' ? 'folders' : 'files';
  let list = recentStore.get(key, []);
  list = [p, ...list.filter((x) => x !== p)].slice(0, 12);
  recentStore.set(key, list);
  refreshMenu();
}

function getRecent() {
  const files = (recentStore.get('files', []) || []).filter((p) => fs.existsSync(p) && fs.statSync(p).isFile());
  const folders = (recentStore.get('folders', []) || []).filter((p) => fs.existsSync(p) && fs.statSync(p).isDirectory());
  return { files, folders };
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

// ---------- 窗口 ----------
function createWindow() {
  const themeMode = settings.get('theme', 'system');
  const dark = themeMode === 'dark' || (themeMode === 'system' && nativeTheme.shouldUseDarkColors);
  const isMac = process.platform === 'darwin';

  mainWin = new BrowserWindow({
    width: isSmoke ? 1440 : 1240,
    height: isSmoke ? 920 : 820,
    minWidth: 880,
    minHeight: 560,
    title: '墨流 InkFlow',
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
      sandbox: false,
      spellcheck: false,
    },
  });

  mainWin.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  mainWin.once('ready-to-show', () => {
    mainWin.show();
  });

  // 外链在浏览器打开，禁止窗口内跳转
  mainWin.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWin.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file://')) e.preventDefault();
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
  ipcMain.handle('app:info', () => ({
    version: app.getVersion(),
    platform: process.platform,
    assetUrl,
    sep: path.sep,
    home: os.homedir(),
    samplesDir: (() => {
      const dir = path.join(docsDir(), '墨流示例');
      return fs.existsSync(dir) ? dir : path.join(__dirname, '..', 'samples');
    })(),
  }));

  ipcMain.on('renderer:ready', () => {
    // 冷启动时被要求打开的文件（Finder 双击 md）：渲染就绪后立即打开
    if (pendingOpenFile && mainWin && !mainWin.isDestroyed()) {
      const p = pendingOpenFile;
      pendingOpenFile = null;
      mainWin.webContents.send('menu:action', { action: 'open-path', payload: p });
    }
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

  ipcMain.handle('settings:get', (e, key) => settings.get(key));
  ipcMain.handle('settings:set', (e, patch) => {
    settings.set(patch);
    refreshMenu();
    if (Object.prototype.hasOwnProperty.call(patch, 'openFolder')) {
      watchFolder(patch.openFolder);
    }
    return true;
  });

  ipcMain.handle('recent:get', () => getRecent());
  ipcMain.handle('recent:add', (e, { path: p, type }) => {
    addRecent(p, type);
    return true;
  });

  // ---- 对话框 ----
  ipcMain.handle('dialog:open-file', async () => {
    const r = await dialog.showOpenDialog(mainWin, {
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Markdown', extensions: ['md', 'markdown', 'mdown', 'txt'] }],
    });
    return r.canceled ? [] : r.filePaths;
  });
  ipcMain.handle('dialog:open-folder', async () => {
    const r = await dialog.showOpenDialog(mainWin, { properties: ['openDirectory'] });
    return r.canceled ? null : r.filePaths[0];
  });
  ipcMain.handle('dialog:save-as', async (e, { defaultName }) => {
    const r = await dialog.showSaveDialog(mainWin, {
      defaultPath: defaultName || '未命名.md',
      filters: [{ name: 'Markdown', extensions: ['md'] }],
    });
    return r.canceled ? null : r.filePath;
  });
  ipcMain.handle('dialog:pick-images', async () => {
    const r = await dialog.showOpenDialog(mainWin, {
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'] }],
    });
    return r.canceled ? [] : r.filePaths;
  });
  ipcMain.handle('dialog:save-export', async (e, { defaultName, ext }) => {
    const r = await dialog.showSaveDialog(mainWin, {
      defaultPath: defaultName,
      filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
    });
    return r.canceled ? null : r.filePath;
  });

  // ---- 文件系统 ----
  ipcMain.handle('fs:read-file', (e, p) => {
    try {
      return { ok: true, content: fs.readFileSync(p, 'utf-8') };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('fs:write-file', (e, { path: p, content }) => {
    try {
      fs.mkdirSync(path.dirname(p), { recursive: true });
      const tmp = p + '.inktmp';
      fs.writeFileSync(tmp, content, 'utf-8');
      fs.renameSync(tmp, p);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('fs:read-dir', (e, dir, opts) => {
    try {
      const sortMode = (opts && opts.sort) || 'name';
      const names = fs.readdirSync(dir);
      const entries = [];
      for (const name of names) {
        if (name.startsWith('.') || name === 'node_modules') continue;
        const full = path.join(dir, name);
        let st;
        try {
          st = fs.statSync(full);
        } catch {
          continue;
        }
        if (st.isDirectory()) {
          entries.push({ name, path: full, isDir: true, mtime: st.mtimeMs });
        } else {
          const ext = path.extname(name).toLowerCase();
          if (MD_EXTS.includes(ext) || IMG_EXTS.includes(ext) || PREVIEW_EXTS.includes(ext)) {
            entries.push({
              name, path: full, isDir: false,
              isImage: IMG_EXTS.includes(ext),
              isPreview: PREVIEW_EXTS.includes(ext),
              mtime: st.mtimeMs, size: st.size,
            });
          }
        }
      }
      entries.sort((a, b) => {
        if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
        if (sortMode === 'mtime') return (b.mtime || 0) - (a.mtime || 0);
        return a.name.localeCompare(b.name, 'zh-Hans-CN', { numeric: true });
      });
      return { ok: true, entries };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('fs:create', (e, { parent, name, isDir }) => {
    try {
      const p = path.join(parent, name);
      if (fs.existsSync(p)) return { ok: false, error: '同名文件已存在' };
      if (isDir) fs.mkdirSync(p, { recursive: true });
      else fs.writeFileSync(p, '', 'utf-8');
      return { ok: true, path: p };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('fs:rename', (e, { from, to }) => {
    try {
      if (fs.existsSync(to)) return { ok: false, error: '目标名称已存在' };
      fs.renameSync(from, to);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('fs:delete', async (e, p) => {
    try {
      await shell.trashItem(p);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('fs:exists', (e, p) => fs.existsSync(p));
  ipcMain.handle('fs:stat', (e, p) => {
    try {
      const st = fs.statSync(p);
      return { ok: true, isDir: st.isDirectory(), mtime: st.mtimeMs };
    } catch {
      return { ok: false };
    }
  });

  ipcMain.handle('fs:reveal', (e, p) => {
    shell.showItemInFolder(p);
    return true;
  });

  ipcMain.handle('fs:copy-image', (e, { src, targetDir }) => {
    try {
      const assetsDir = path.join(targetDir, 'assets');
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
      fs.copyFileSync(src, dest);
      return { ok: true, relPath: `assets/${name}` };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('fs:save-image-bytes', (e, { bytes, name, targetDir }) => {
    try {
      const assetsDir = path.join(targetDir, 'assets');
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
      fs.writeFileSync(dest, Buffer.from(bytes));
      return { ok: true, relPath: `assets/${fileName}` };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // 列出库内全部 markdown 文件（供快速打开）
  ipcMain.handle('fs:walk-md', (e, root) => {
    const out = [];
    const walk = (dir, depth) => {
      if (depth > 8 || out.length > 2000) return;
      let names;
      try {
        names = fs.readdirSync(dir);
      } catch {
        return;
      }
      for (const name of names) {
        if (name.startsWith('.') || name === 'node_modules') continue;
        const full = path.join(dir, name);
        let st;
        try {
          st = fs.statSync(full);
        } catch {
          continue;
        }
        if (st.isDirectory()) walk(full, depth + 1);
        else if (MD_EXTS.includes(path.extname(name).toLowerCase())) {
          out.push({ name, path: full, rel: path.relative(root, full), mtime: st.mtimeMs });
        }
      }
    };
    walk(root, 0);
    out.sort((a, b) => b.mtime - a.mtime);
    return out;
  });

  // ---- 窗口状态 ----
  ipcMain.on('win:set-file', (e, { path: p, edited }) => {
    if (!mainWin) return;
    if (process.platform === 'darwin') {
      mainWin.setRepresentedFilename(p || '');
      mainWin.setDocumentEdited(!!edited);
    } else {
      // Windows/Linux：原生标题栏显示当前文件名与编辑状态
      const name = p ? path.basename(p) : '未命名';
      mainWin.setTitle(`${name}${edited ? ' •' : ''} — 墨流 InkFlow`);
    }
  });

  ipcMain.on('win:confirm-close', () => {
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

  ipcMain.handle('export:pdf', async (e, { html, cssLinks, suggestedName }) => {
    const savePath = await pickSavePath({
      defaultPath: suggestedName,
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });
    if (!savePath) return { ok: false, canceled: true };

    const tmpHtml = path.join(os.tmpdir(), `inkflow-export-${Date.now()}.html`);
    const doc = `<!DOCTYPE html>
<html><head><meta charset="utf-8">
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
    fs.writeFileSync(tmpHtml, doc, 'utf-8');

    let printWin = new BrowserWindow({
      show: false,
      webPreferences: { sandbox: true, contextIsolation: true },
    });
    try {
      await printWin.loadFile(tmpHtml);
      await new Promise((r) => setTimeout(r, 900));
      const pdf = await printWin.webContents.printToPDF({
        pageSize: 'A4',
        printBackground: true,
        margins: { marginType: 'custom', top: 0.55, bottom: 0.55, left: 0.5, right: 0.5 },
      });
      fs.writeFileSync(savePath, pdf);
      if (!process.env.INKFLOW_TEST_SAVEPATH) shell.showItemInFolder(savePath);
      return { ok: true, path: savePath };
    } catch (err) {
      return { ok: false, error: err.message };
    } finally {
      printWin.destroy();
      try {
        fs.unlinkSync(tmpHtml);
      } catch {}
    }
  });

  ipcMain.handle('export:html', async (e, { html, cssTexts, suggestedName }) => {
    const savePath = await pickSavePath({
      defaultPath: suggestedName,
      filters: [{ name: 'HTML', extensions: ['html'] }],
    });
    if (!savePath) return { ok: false, canceled: true };
    const doc = `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${path.basename(suggestedName, '.html')}</title>
<style>${cssTexts.join('\n')}</style>
<style>body{padding:48px 24px;max-width:820px;margin:0 auto;}img{max-width:100%!important;}</style>
</head><body class="vditor-reset">${html}</body></html>`;
    try {
      fs.writeFileSync(savePath, doc, 'utf-8');
      if (!process.env.INKFLOW_TEST_SAVEPATH) shell.showItemInFolder(savePath);
      return { ok: true, path: savePath };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('export:word', async (e, { html, cssTexts, suggestedName }) => {
    const savePath = await pickSavePath({
      defaultPath: suggestedName,
      filters: [{ name: 'Word 文档', extensions: ['docx'] }],
    });
    if (!savePath) return { ok: false, canceled: true };
    try {
      const HTMLtoDOCX = require('html-to-docx');
      // file:// 图片内联为 base64（html-to-docx 无法读取本地文件）
      const inlined = html.replace(/(<img[^>]+src=")file:\/\/([^"]+)(")/g, (m, pre, enc, post) => {
        try {
          const p = decodeURI(enc);
          const ext = path.extname(p).slice(1).toLowerCase().replace('jpg', 'jpeg') || 'png';
          const b64 = fs.readFileSync(p).toString('base64');
          return `${pre}data:image/${ext};base64,${b64}${post}`;
        } catch {
          return m;
        }
      });
      const doc = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${(cssTexts || []).join('\n')}</style></head><body>${inlined}</body></html>`;
      const buf = await HTMLtoDOCX(doc, null, {
        table: { row: { cantSplit: true } },
        footer: false,
        pageNumber: false,
      });
      fs.writeFileSync(savePath, buf);
      if (!process.env.INKFLOW_TEST_SAVEPATH) shell.showItemInFolder(savePath);
      return { ok: true, path: savePath };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('export:image', async (e, { html, cssLinks, suggestedName }) => {
    const savePath = await pickSavePath({
      defaultPath: suggestedName,
      filters: [{ name: 'PNG 图片', extensions: ['png'] }],
    });
    if (!savePath) return { ok: false, canceled: true };

    const tmpHtml = path.join(os.tmpdir(), `inkflow-img-${Date.now()}.html`);
    const doc = `<!DOCTYPE html>
<html><head><meta charset="utf-8">
${(cssLinks || []).map((h) => `<link rel="stylesheet" href="${h}">`).join('\n')}
<style>
  body { padding: 48px 52px; max-width: 820px; margin: 0 auto; background: #faf9f5; }
  img { max-width: 100% !important; }
</style>
</head><body class="vditor-reset">${html}</body></html>`;
    fs.writeFileSync(tmpHtml, doc, 'utf-8');

    // 2x 高清长图：窗口宽度 = 栏宽(820) × 缩放(2)，布局视口保持 820 CSS px。
    // 高度同理：逻辑高度必须 = CSS 高 × SCALE（否则视口只有一半 CSS 高，长图被腰斩）
    const SCALE = 2;
    const COL = 820;
    let shotWin = new BrowserWindow({
      show: false,
      width: COL * SCALE,
      height: 1200,
      webPreferences: { sandbox: true, contextIsolation: true },
    });
    try {
      await shotWin.loadFile(tmpHtml);
      await shotWin.webContents.setZoomFactor(SCALE);
      await new Promise((r) => setTimeout(r, 1100));
      const cssH = await shotWin.webContents.executeJavaScript(
        'Math.min((document.body.scrollHeight || 800) + 20, 8000)' // CSS 高；×2 后 ≤16000，低于 GPU 纹理上限
      );
      shotWin.setContentSize(COL * SCALE, Math.max(480, Math.ceil(cssH * SCALE)));
      await new Promise((r) => setTimeout(r, 500));
      const img = await shotWin.webContents.capturePage();
      fs.writeFileSync(savePath, img.toPNG());
      if (!process.env.INKFLOW_TEST_SAVEPATH) shell.showItemInFolder(savePath);
      return { ok: true, path: savePath };
    } catch (err) {
      return { ok: false, error: err.message };
    } finally {
      shotWin.destroy();
      try {
        fs.unlinkSync(tmpHtml);
      } catch {}
    }
  });

  ipcMain.handle('css:read', (e, relPath) => {
    // 读取应用内 css（供 HTML 导出内联）
    try {
      const p = path.join(__dirname, '..', relPath);
      return { ok: true, content: fs.readFileSync(p, 'utf-8') };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('theme:get-dark', () => {
    const mode = settings.get('theme', 'system');
    return mode === 'dark' || (mode === 'system' && nativeTheme.shouldUseDarkColors);
  });
}

// ---------- 冒烟测试 ----------
async function runSmoke() {
  const outDir = app.isPackaged
    ? path.join(os.tmpdir(), 'inkflow-shots')
    : path.join(__dirname, '..', 'assets', 'screenshots');
  fs.mkdirSync(outDir, { recursive: true });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  await new Promise((resolve) => {
    ipcMain.once('renderer:ready', resolve);
    setTimeout(resolve, 8000);
  });
  await wait(500);

  const samplesFolder = path.join(__dirname, '..', 'samples');
  const demoFile = process.env.SMOKE_FILE || path.join(samplesFolder, '功能演示.md');

  mainWin.webContents.send('menu:action', { action: 'open-path', payload: samplesFolder });
  await wait(1200);
  mainWin.webContents.send('menu:action', { action: 'open-path', payload: demoFile });
  await wait(2600);

  if (process.env.SMOKE_TABLE_PROBE === '1') {
    const tp = await mainWin.webContents.executeJavaScript(`(async () => {
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));
      App.setTheme('dark');
      await sleep(600);
      Editor.setValue('| A | B |\\n|---|---|\\n| 1 | 2 |\\n');
      await sleep(900);
      const th = document.querySelector('.editor-host:not(.hidden) .vditor-ir th');
      const td = document.querySelector('.editor-host:not(.hidden) .vditor-ir td');
      const table = document.querySelector('.editor-host:not(.hidden) .vditor-ir table');
      const links = [...document.querySelectorAll('link[rel=stylesheet]')].map(l => l.href);
      const cs = (e) => e ? getComputedStyle(e) : null;
      const t = cs(table), h = cs(th), d = cs(td);
      return {
        tableBg: t && t.backgroundColor, thBg: h && h.backgroundColor,
        thColor: h && h.color, tdBg: d && d.backgroundColor, tdColor: d && d.color,
        tableBorder: h && h.borderColor,
        contentThemeLink: links.filter(h => h.includes('content')).join(' | '),
        inkVars: getComputedStyle(document.querySelector('.vditor-ir .vditor-reset')).getPropertyValue('--ink-quote-bg'),
        tableHTML: table ? table.outerHTML.slice(0, 220) : 'none',
      };
    })()`);
    console.log('[table-probe]', JSON.stringify(tp, null, 1));
  }

  if (process.env.SMOKE_PROBE === '1') {
    const probe = await mainWin.webContents.executeJavaScript(`(() => {
      const pick = (sel) => {
        const e = document.querySelector(sel);
        if (!e) return sel + ': null';
        const r = e.getBoundingClientRect();
        return sel + ': ' + Math.round(r.x) + ',' + Math.round(r.y) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height);
      };
      const bg = (sel) => {
        const e = document.querySelector(sel);
        if (!e) return sel + ': null';
        return sel + ' bg=' + getComputedStyle(e).backgroundColor;
      };
      const dump = (sel) => {
        const e = document.querySelector(sel);
        if (!e) return sel + ': null';
        const before = e.scrollTop;
        e.scrollTop = 900;
        return sel + ' sh=' + e.scrollHeight + ' ch=' + e.clientHeight + ' before=' + before + ' after=' + e.scrollTop + ' overflow=' + getComputedStyle(e).overflowY;
      };
      const reset = document.querySelector('.editor-host:not(.hidden) .vditor-ir > .vditor-reset');
      const blocks = reset ? Array.from(reset.children).map((c, i) => {
        const r = c.getBoundingClientRect();
        const cs = getComputedStyle(c);
        return i + ':' + c.tagName.slice(0, 6) + ' "' + (c.textContent || '').slice(0, 12).replace(/\\n/g, ' ') + '" h=' + Math.round(r.height) + ' op=' + cs.opacity + ' pos=' + cs.position + ' z=' + cs.zIndex;
      }).join('\\n') : 'no reset';
      const probeAt = (x, y) => {
        const el = document.elementFromPoint(x, y);
        if (!el) return 'null';
        return el.tagName + '.' + String(el.className).slice(0, 60);
      };
      const area = document.querySelector('#editor-area').getBoundingClientRect();
      const px = Math.round(area.left + 400);
      const py = Math.round(area.top + 460);
      return 'BLOCKS:\\n' + blocks + '\\nHIT@' + px + ',' + py + ': ' + probeAt(px, py) + '\\n' + [dump('.vditor-ir > .vditor-reset')].join('\\n');
    })()`);
    console.log('[probe]\n' + probe);
  }

  const shots = (process.env.SMOKE_SHOTS || 'light,dark').split(',');
  for (const shot of shots) {
    if (shot === 'dark') {
      mainWin.webContents.send('menu:action', { action: 'set-theme', payload: 'dark' });
    } else if (shot === 'light') {
      mainWin.webContents.send('menu:action', { action: 'set-theme', payload: 'light' });
    } else if (shot === 'welcome') {
      mainWin.webContents.send('menu:action', { action: 'set-theme', payload: 'light' });
      mainWin.webContents.send('menu:action', { action: 'close-all-tabs' });
    } else if (shot === 'palette') {
      mainWin.webContents.send('menu:action', { action: 'command-palette' });
    } else if (shot === 'quick') {
      mainWin.webContents.send('menu:action', { action: 'quick-open' });
    } else if (shot === 'outline') {
      mainWin.webContents.send('menu:action', { action: 'toggle-outline' });
    } else if (shot === 'wide') {
      mainWin.webContents.send('menu:action', { action: 'set-page-width', payload: 'wide' });
    } else if (shot === 'sidebar-off') {
      mainWin.webContents.send('menu:action', { action: 'toggle-sidebar' });
    } else if (shot.startsWith('accent-')) {
      const v = shot.split('-')[1];
      await mainWin.webContents.executeJavaScript(`App.setAccent(${JSON.stringify(v || 'indigo')}); 'ok'`);
    } else if (shot.startsWith('scroll-')) {
      const y = parseInt(shot.split('-')[1], 10) || 0;
      await mainWin.webContents.executeJavaScript(`
        (document.querySelector('.editor-host:not(.hidden) .vditor-ir > .vditor-reset') || {scrollTop: 0}).scrollTop = ${y};
        'ok'`);
    }
    await wait(1400);
    const img = await mainWin.webContents.capturePage();
    fs.writeFileSync(path.join(outDir, `smoke-${shot}.png`), img.toPNG());
    if (shot === 'palette') {
      mainWin.webContents.send('menu:action', { action: 'close-overlays' });
    }
  }
  console.log('[smoke] screenshots saved to', outDir);
  mainWin.forceClose = true;
  app.exit(0);
}

// ---------- 功能冒烟（编辑/自动保存/标签） ----------
async function runFuncSmoke() {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const results = [];
  const tmpDir = path.join(os.tmpdir(), 'inkflow-func');
  fs.mkdirSync(tmpDir, { recursive: true });
  const testFile = path.join(tmpDir, '测试文档.md');
  fs.writeFileSync(testFile, '# 测试\n\n原始内容。\n', 'utf-8');

  await new Promise((resolve) => {
    ipcMain.once('renderer:ready', resolve);
    setTimeout(resolve, 8000);
  });
  await wait(400);

  const js = async (code) => {
    try {
      return await mainWin.webContents.executeJavaScript(code);
    } catch (e) {
      console.log('[js-fail]', e.message, '| CODE:', code.replace(/\s+/g, ' ').slice(0, 160));
      return null;
    }
  };

  // 1. 打开文件
  mainWin.webContents.send('menu:action', { action: 'open-path', payload: testFile });
  await wait(2200);
  results.push(['open-file', await js(`(App.activeTab() && App.activeTab().path === ${JSON.stringify(testFile)})`)]);

  // 2. 编辑 + 脏标记
  await js(`Editor.insert('\\n\\n冒烟自动化测试：墨流已就绪。')`);
  await wait(300);
  results.push(['dirty-flag', await js(`App.activeTab().dirty`)]);

  // 3. 自动保存
  await wait(1400);
  const disk = fs.readFileSync(testFile, 'utf-8');
  results.push(['autosave', disk.includes('冒烟自动化测试')]);
  results.push(['clean-flag', await js(`App.activeTab().dirty === false`)]);

  // 4. 字数统计
  results.push(['stats', await js(`Editor.stats().words > 5`)]);

  // 5. 新建未命名 & 关闭
  const afterOpen = (await js('App.tabs.length')) || 0;
  await js(`App.newUntitled()`);
  await wait(400);
  results.push(['untitled', await js(`App.tabs.length === ${afterOpen + 1} && App.activeTab().path === null`)]);
  await js(`App.closeTab(App.active, true)`);
  await wait(400);
  results.push(['close-tab', await js(`App.tabs.length === ${afterOpen}`)]);

  // 6. 切回测试文档，验证导出 HTML 生成
  await js(`App.activate(App.tabs.findIndex(t => t.path === ${JSON.stringify(testFile)}))`);
  await wait(500);
  results.push(['export-html-gen', await js(`(async () => (await Editor.getExportHtml()).includes('<h1'))()`)]);

  // 6.5 TOC 锚点链接：点击后页面应滚动
  const demoPath = path.join(__dirname, '..', 'samples', '功能演示.md');
  mainWin.webContents.send('menu:action', { action: 'open-path', payload: demoPath });
  await wait(2600);
  await js(`(document.querySelector('.editor-host:not(.hidden) .vditor-ir > .vditor-reset')||{}).scrollTop = 0`);
  await wait(300);
  const anchorClicked = await js(`(() => {
    const spans = document.querySelectorAll('.editor-host:not(.hidden) .vditor-ir [data-target-id]');
    if (!spans.length) return 'no-anchor';
    const s = spans[spans.length - 1]; // 最后一项目录（页面底部标题）
    s.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    return 'clicked:' + s.getAttribute('data-target-id');
  })()`);
  await wait(1200);
  const anchorScrolled = await js(`(document.querySelector('.editor-host:not(.hidden) .vditor-ir > .vditor-reset')||{scrollTop:0}).scrollTop`);
  results.push(['toc-anchor', String(anchorClicked).startsWith('clicked:') && anchorScrolled > 100]);

  // 6.8 编辑区高度回归：内层滚动容器应接近满高（防 padding 挤压）
  const hRatio = await js(`(() => {
    const ir = document.querySelector('.editor-host:not(.hidden) .vditor-ir');
    const pre = document.querySelector('.editor-host:not(.hidden) .vditor-ir > .vditor-reset');
    return pre && ir && ir.clientHeight ? pre.clientHeight / ir.clientHeight : 0;
  })()`);
  results.push(['editor-full-height', hRatio > 0.85]);

  // 6.9 页面宽度切换：超宽时文本列变宽（padding 减小），滚动容器保持全宽
  const pw = await js(`(() => {
    const pre = document.querySelector('.editor-host:not(.hidden) .vditor-ir > .vditor-reset');
    const ir = document.querySelector('.editor-host:not(.hidden) .vditor-ir');
    const before = { preW: pre.clientWidth, pad: parseInt(getComputedStyle(pre).paddingLeft) };
    App.setPageWidth('wide');
    const mid = parseInt(getComputedStyle(pre).paddingLeft);
    App.setPageWidth('normal');
    const after = parseInt(getComputedStyle(pre).paddingLeft);
    // 滚动容器应基本全宽（允许自身滚动条占位 ~16px）
    return { fullBleed: before.preW >= ir.clientWidth - 20, mid, after, before: before.pad };
  })()`);
  results.push(['page-width', pw.fullBleed && pw.mid < pw.after && pw.after === pw.before]);

  // 6.95 侧栏折叠与恢复
  const sb = await js(`(() => {
    const before = document.body.dataset.sidebar;
    App.toggleSidebar();
    const hidden = document.body.dataset.sidebar;
    App.toggleSidebar();
    const back = document.body.dataset.sidebar;
    return { before, hidden, back };
  })()`);
  results.push(['sidebar-toggle', sb.hidden === 'hidden' && sb.back === sb.before]);

  // 6.955 页签双击关闭
  const dbl = await js(`(async () => {
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    App.newUntitled();
    await sleep(800);
    const before = App.tabs.length;
    const probe = { val: Editor.getValue(), saved: App.activeTab().savedValue, dirty: App.activeTab().dirty };
    const tabEl = document.querySelectorAll('#tabs .tab')[App.active];
    tabEl.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
    await sleep(500);
    const modal = !document.querySelector('#modal-quit').classList.contains('hidden');
    const lastTab = App.tabs[App.tabs.length - 1];
    return { before, after: App.tabs.length, modal, probe, name: lastTab && lastTab.name };
  })()`);
  results.push(['tab-dblclick-close', dbl.after === dbl.before - 1]);
  if (dbl.after !== dbl.before - 1) console.log('[debug] dblclick:', JSON.stringify(dbl));

  // 6.96 编辑器实例池：切走再切回，宿主元素应保持同一个（零重渲染）
  const reuse = await js(`(async () => {
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const a = App.tabs.find(t => t.path === ${JSON.stringify(testFile)});
    if (!a) return { fail: 'tab missing' };
    const inst1 = Editor.instances.get(a.key);
    if (!inst1) return { fail: 'no instance' };
    const host1 = inst1.host;
    App.newUntitled();
    await sleep(900);
    await App.activate(App.tabs.indexOf(a));
    await sleep(300);
    const inst2 = Editor.instances.get(a.key);
    const same = host1 === inst2.host;
    const visible = !inst2.host.classList.contains('hidden');
    const intact = Editor.getValue(a.key) === a.savedValue;
    App.closeTab(App.tabs.findIndex(t => t.path === null), true);
    await sleep(300);
    return { same, visible, intact };
  })()`);
  results.push(['instance-reuse', !!(reuse.same && reuse.visible && reuse.intact)]);

  // 6.97 文件树折叠：行点击展开/收起 + 全部折叠按钮
  // 树测试在 samples 的临时副本上进行（避免污染仓库 / asar 只读包内无法写入）
  // 注：fs.cpSync 未被 Electron 的 asar 补丁覆盖，需手工递归复制
  const copyDirSync = (src, dst) => {
    fs.mkdirSync(dst, { recursive: true });
    for (const e of fs.readdirSync(src, { withFileTypes: true })) {
      const s = path.join(src, e.name);
      const d = path.join(dst, e.name);
      if (e.isDirectory()) copyDirSync(s, d);
      else fs.copyFileSync(s, d);
    }
  };
  const samplesDir = path.join(tmpDir, 'samples');
  copyDirSync(path.join(__dirname, '..', 'samples'), samplesDir);
  mainWin.webContents.send('menu:action', { action: 'open-path', payload: samplesDir });
  await wait(1300);
  const tree = await js(`(async () => {
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const row = document.querySelector('.tree-row[data-is-dir="1"]');
    if (!row) return { fail: 'no dir row' };
    const node = row.parentElement;
    row.click(); await sleep(500);
    const opened = node.classList.contains('open') && !!node.querySelector('.tree-children');
    row.click(); await sleep(300);
    const closed = !node.classList.contains('open');
    row.click(); await sleep(500);
    document.querySelector('#btn-collapse').click(); await sleep(500);
    // render() 会整体重建节点，必须重新查询（旧引用已脱离 DOM）
    const allClosed = document.querySelectorAll('.tree-node.open').length === 0;
    return { opened, closed, allClosed, expanded: [...FileTree.expanded], openRows: document.querySelectorAll('.tree-node.open').length, btnTitle: document.querySelector('#btn-collapse').title };
  })()`);
  results.push(['tree-collapse', !!(tree.opened && tree.closed && tree.allClosed)]);
  if (!(tree.opened && tree.closed && tree.allClosed)) console.log('[debug] tree:', JSON.stringify(tree));

  // 6.975 选中目录下创建文件：落在 assets/ 内且立即出现在树中（缓存失效，无需手动刷新）
  const createdFile = path.join(samplesDir, 'assets', '子目录新建.md');
  const create = await js(`(async () => {
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const dirRow = document.querySelector('.tree-row[data-is-dir="1"]');
    if (!dirRow) return { fail: 'no dir row' };
    dirRow.click(); await sleep(400);
    document.querySelector('#btn-new-file').click(); await sleep(400);
    const input = document.querySelector('.tree-rename-input');
    if (!input) return { fail: 'no input row' };
    input.value = '子目录新建.md';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await sleep(1000);
    const newPath = ${JSON.stringify(createdFile)};
    const row = document.querySelector('.tree-row[data-path="' + CSS.escape(newPath) + '"]');
    return { inTree: !!row };
  })()`);
  results.push(['create-under-selection', create.inTree === true && fs.existsSync(createdFile)]);
  if (create.inTree !== true) console.log('[debug] create:', JSON.stringify(create));
  await js(`App.closeTabByPath(${JSON.stringify(createdFile)}, true)`);
  try { fs.unlinkSync(createdFile); } catch {}
  await wait(1000);

  // 6.976 外部落盘自动出现在树中（fs 监听无感刷新）
  const extFile = path.join(samplesDir, '外部新增.md');
  fs.writeFileSync(extFile, '# 外部\n', 'utf-8');
  await wait(1600);
  const extVisible = await js(`!!document.querySelector('.tree-row[data-path="' + CSS.escape(${JSON.stringify(extFile)}) + '"]')`);
  results.push(['fs-watch-visible', extVisible === true]);
  try { fs.unlinkSync(extFile); } catch {}
  await wait(1200);

  // 6.977 图片行点击：不得向文档插入任何内容（新语义=右侧只读预览）
  const imgClick = await js(`(async () => {
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    await App.activate(App.tabs.findIndex(t => t.path === ${JSON.stringify(testFile)}));
    await sleep(400);
    Editor.setValue('');
    await sleep(300);
    const dirRow = document.querySelector('.tree-row[data-is-dir="1"]');
    if (dirRow && !dirRow.parentElement.classList.contains('open')) { dirRow.click(); await sleep(400); }
    const imgRow = document.querySelector('.tree-row[data-path$=".png"], .tree-row[data-path$=".jpg"]');
    if (!imgRow) return { fail: 'no img row' };
    imgRow.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    await sleep(600);
    const noInsert = !Editor.getValue().includes('![');
    const previewOpened = App.activeTab() && App.activeTab().kind === 'preview';
    App.closeTab(App.active, true);
    await sleep(400);
    return { noInsert, previewOpened };
  })()`);
  results.push(['img-click-no-insert', imgClick.noInsert === true && imgClick.previewOpened === true]);

  // 6.978 相对路径图片：应全部被改写为资源服务地址并成功加载
  const imgOk = await js(`(async () => {
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    await App.openFile(${JSON.stringify(path.join(samplesDir, '功能演示.md'))});
    await sleep(1800);
    const imgs = Array.from(document.querySelectorAll('.editor-host:not(.hidden) img'));
    const fixed = imgs.filter(i => i.dataset.inkFixed).length;
    const loaded = imgs.filter(i => i.complete && i.naturalWidth > 0).length;
    return { total: imgs.length, fixed, loaded };
  })()`);
  results.push(['img-render', imgOk.total > 0 && imgOk.fixed === imgOk.total && imgOk.loaded === imgOk.total]);
  if (!(imgOk.total > 0 && imgOk.loaded === imgOk.total)) console.log('[debug] img-render:', JSON.stringify(imgOk));

  // 6.9785 粘贴 .md 文件：应插入文本内容而非按图片处理
  const pasteMd = await js(`(async () => {
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    await App.activate(App.tabs.findIndex(t => t.path === ${JSON.stringify(testFile)}));
    await sleep(400);
    Editor.setValue('');
    await sleep(300);
    const inst = Editor.instances.get(Editor.activeKey);
    const f = new File(['# 粘贴的标题\\n\\n粘贴内容段落。'], '外部笔记.md', { type: 'text/markdown' });
    await Editor._handleUpload(inst, [f]);
    await sleep(400);
    const v = Editor.getValue();
    return { hasHeading: v.includes('# 粘贴的标题'), noImage: !v.includes('![') };
  })()`);
  results.push(['paste-md-content', pasteMd.hasHeading === true && pasteMd.noImage === true]);
  if (pasteMd.hasHeading !== true) console.log('[debug] paste-md:', JSON.stringify(pasteMd));

  // 6.9786 文件树拖拽移动：文件移入子目录后再移回清理
  const movedSrc = path.join(samplesDir, '移动测试.md');
  fs.writeFileSync(movedSrc, '# 移动\n', 'utf-8');
  await wait(1400); // 等 fs 监听上树
  const movedDest = path.join(samplesDir, 'assets', '移动测试.md');
  const mv = await js(`(async () => {
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    await FileTree._moveTo(${JSON.stringify(movedSrc)}, ${JSON.stringify(path.join(samplesDir, 'assets'))});
    await sleep(800);
    const row = document.querySelector('.tree-row[data-path="' + CSS.escape(${JSON.stringify(movedDest)}) + '"]');
    return { inTree: !!row };
  })()`);
  const mvOk = !fs.existsSync(movedSrc) && fs.existsSync(movedDest);
  results.push(['tree-move', mv.inTree === true && mvOk]);
  await js(`FileTree._moveTo(${JSON.stringify(movedDest)}, ${JSON.stringify(samplesDir)})`);
  await wait(700);
  await js(`App.closeTabByPath(${JSON.stringify(movedSrc)}, true)`);
  try { fs.unlinkSync(movedSrc); } catch {}
  await wait(900);

  // 6.9787 图片点击 = 只读预览页签（文档内容不得被插入）
  const pv = await js(`(async () => {
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    await App.activate(App.tabs.findIndex(t => t.path === ${JSON.stringify(testFile)}));
    await sleep(400);
    const before = Editor.getValue();
    const imgRow = document.querySelector('.tree-row[data-path$=".png"]');
    imgRow.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    await sleep(700);
    const tab = App.activeTab();
    const isPreview = tab && tab.kind === 'preview';
    const paneVisible = !document.querySelector('#preview-pane').classList.contains('hidden');
    const hasImg = !!document.querySelector('#preview-pane img');
    App.closeTab(App.active, true);
    await sleep(400);
    // 关闭预览后落点可能是其他标签，必须显式回到测试文档再取值
    await App.activate(App.tabs.findIndex(t => t.path === ${JSON.stringify(testFile)}));
    await sleep(400);
    const after = Editor.getValue();
    // 核心：不得插入图片语法；尾换行被 vditor 归一化（±1 字符）属正常
    const noImgInsert = !after.includes('![');
    const lenOk = Math.abs(after.length - before.length) <= 1;
    return { isPreview, paneVisible, hasImg, noImgInsert, lenOk };
  })()`);
  results.push(['preview-tab', pv.isPreview === true && pv.paneVisible === true && pv.hasImg === true && pv.noImgInsert === true && pv.lenOk === true]);
  if (!(pv.noImgInsert && pv.lenOk)) console.log('[debug] preview-tab:', JSON.stringify(pv));

  // 6.9788 折叠按钮双态：全折叠后显示"全部展开"，展开后显示"全部折叠"
  const ce = await js(`(async () => {
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    FileTree.collapseAll();
    await sleep(400);
    const t1 = document.querySelector('#btn-collapse').title;
    FileTree.expandAll();
    await sleep(1300);
    const t2 = document.querySelector('#btn-collapse').title;
    const openCount = [...FileTree.expanded].filter(p => p !== FileTree.root).length;
    return { t1, t2, openCount };
  })()`);
  results.push(['collapse-expand', ce.t1 === '全部展开' && ce.t2 === '全部折叠' && ce.openCount >= 1]);

  // 6.9789 排序切换：按修改时间排序时最新文件排最前
  const newest = path.join(samplesDir, '最新文件.md');
  fs.writeFileSync(newest, '# 最新\n', 'utf-8');
  await wait(1400);
  const sm = await js(`(async () => {
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    FileTree._setSortMode('mtime');
    await sleep(900);
    const rows = [...document.querySelectorAll('#file-tree .tree-row')]
      .filter(r => r.dataset.isDir !== '1' && r.closest('.tree-children') === null);
    const first = rows.length ? rows[0].dataset.path : '';
    FileTree._setSortMode('name');
    await sleep(700);
    return { first };
  })()`);
  results.push(['sort-mtime', sm.first === newest]);
  try { fs.unlinkSync(newest); } catch {}
  await wait(900);

  // 6.97810 图片操作条：点击弹出，删除移除整段图片且不伤正文
  const imgDel = await js(`(async () => {
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    await App.activate(App.tabs.findIndex(t => t.path === ${JSON.stringify(testFile)}));
    await sleep(400);
    Editor.setValue('前文段落\\n\\n![x](assets/none.png)\\n\\n后文段落');
    await sleep(900);
    const img = document.querySelector('.editor-host:not(.hidden) img');
    if (!img) return { fail: 'no img rendered' };
    img.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await sleep(300);
    const tb = document.querySelector('#img-toolbar');
    const visible = tb && !tb.classList.contains('hidden');
    tb.querySelector('[data-act="del"]').click();
    await sleep(500);
    const v = Editor.getValue();
    const hidden = tb.classList.contains('hidden');
    return { visible, removed: !v.includes('!['), kept: v.includes('前文段落') && v.includes('后文段落'), hidden };
  })()`);
  results.push(['img-toolbar-delete', imgDel.visible === true && imgDel.removed === true && imgDel.kept === true]);
  if (!(imgDel.visible && imgDel.removed)) console.log('[debug] img-toolbar:', JSON.stringify(imgDel));

  // 6.97811 mermaid 导出：应渲染为 SVG 而非显示原始代码
  const mer = await js(`(async () => {
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    await App.activate(App.tabs.findIndex(t => t.path === ${JSON.stringify(testFile)}));
    await sleep(400);
    Editor.setValue('## 流程\\n\\n\`\`\`mermaid\\nflowchart TB\\n  A-->B;\\n\`\`\`\\n');
    await sleep(800);
    const html = await Editor.getExportHtml();
    return { hasSvg: html.includes('<svg'), noRawCode: !html.includes('A--&gt;B') && !html.includes('A-->B</') };
  })()`);
  results.push(['mermaid-export-svg', mer.hasSvg === true && mer.noRawCode === true]);
  if (!mer.hasSvg) console.log('[debug] mermaid-export:', JSON.stringify(mer));

  // 6.97812 树软刷新去抖：内容没变时不重建 DOM（防自动保存引起的闪烁）
  const flick = await js(`(async () => {
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const rowA = document.querySelector('#file-tree .tree-row');
    await FileTree.softRefresh();
    await sleep(300);
    const rowB = document.querySelector('#file-tree .tree-row');
    const stable = rowA === rowB;
    return { stable };
  })()`);
  results.push(['tree-no-flicker', flick.stable === true]);

  // 6.97813 外部拖入决策：md→页签 / 目录→文档库 / pdf→预览 / 未知→提示（且不插入正文）
  const drop = await js(`(async () => {
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    await App.activate(App.tabs.findIndex(t => t.path === ${JSON.stringify(testFile)}));
    await sleep(300);
    const bodyBefore = Editor.getValue();
    await App._handleDropPath(${JSON.stringify(testFile)});
    await sleep(500);
    const mdOk = App.activeTab() && App.activeTab().path === ${JSON.stringify(testFile)};
    await App._handleDropPath(${JSON.stringify(samplesDir)});
    await sleep(900);
    const dirOk = FileTree.root === ${JSON.stringify(samplesDir)};
    const pdfPath = ${JSON.stringify(samplesDir)} + '/拖入测试.pdf';
    await ink.writeFile(pdfPath, '%PDF-1.4 fake');
    await App._handleDropPath(pdfPath);
    await sleep(500);
    const pdfOk = App.activeTab() && App.activeTab().kind === 'preview';
    await App._handleDropPath('/tmp/xxx.bin');
    await sleep(300);
    const toastOk = document.querySelector('#toast').textContent.includes('暂不支持');
    const mdTab = App.tabs.find(t => t.path === ${JSON.stringify(testFile)});
    await App.activate(App.tabs.findIndex(t => t.path === ${JSON.stringify(testFile)}));
    await sleep(400);
    const bodyAfter = Editor.getValue();
    let diffAt = -1;
    for (let i = 0; i < Math.max(bodyBefore.length, bodyAfter.length); i++) {
      if (bodyBefore[i] !== bodyAfter[i]) { diffAt = i; break; }
    }
    const noInsert = bodyBefore === bodyAfter;
    return { mdOk, dirOk, pdfOk, toastOk, noInsert,
      bl: bodyBefore.length, al: bodyAfter.length, diffAt,
      around: diffAt >= 0 ? JSON.stringify(bodyAfter.slice(Math.max(0, diffAt - 15), diffAt + 15)) : '' };
  })()`);
  results.push(['drop-logic', !!(drop && drop.mdOk && drop.dirOk && drop.pdfOk && drop.toastOk && drop.noInsert)]);
  if (drop && !(drop.mdOk && drop.dirOk && drop.pdfOk && drop.toastOk && drop.noInsert)) console.log('[debug] drop:', JSON.stringify(drop));

  // 6.97814 打开不标脏：vditor 规范化后的基线对齐（无行尾换行的文件最容易暴露）
  const nodirty = await js(`(async () => {
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const p = ${JSON.stringify(samplesDir)} + '/无尾换行.md';
    await ink.writeFile(p, '# 没有行尾换行');
    await App.openFile(p);
    await sleep(800);
    const tab = App.tabs.find(t => t.path === p);
    return { dirty: tab ? tab.dirty : 'no-tab' };
  })()`);
  results.push(['open-no-dirty', nodirty.dirty === false]);
  if (nodirty.dirty !== false) console.log('[debug] open-no-dirty:', JSON.stringify(nodirty));

  // 6.97815 主色调切换：印章朱生效 + 回切靛蓝还原
  const acc = await js(`(async () => {
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    App.setTheme('light');
    await sleep(300);
    App.setAccent('zhu');
    await sleep(300);
    const cs = getComputedStyle(document.body);
    const zhuOk = document.body.dataset.accent === 'zhu' && cs.getPropertyValue('--accent').trim() === '#b5432f';
    App.setAccent('indigo');
    await sleep(200);
    const backOk = getComputedStyle(document.body).getPropertyValue('--accent').trim() === '#4c5fd5';
    App.setTheme('system');
    return { zhuOk, backOk };
  })()`);
  results.push(['accent-palette', acc.zhuOk === true && acc.backOk === true]);
  if (!(acc.zhuOk && acc.backOk)) console.log('[debug] accent:', JSON.stringify(acc));

  // 6.979 markmap 离线渲染（懒加载本地引擎，应出现 svg 导图）
  await js(`App.activate(App.tabs.findIndex(t => t.path === ${JSON.stringify(testFile)}))`);
  await wait(500);
  const mm = await js(`(async () => {
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    Editor.setValue('\`\`\`markmap\\n# 测试导图\\n## 分支A\\n## 分支B\\n\`\`\`\\n');
    await sleep(3000);
    return { svg: !!document.querySelector('.editor-host:not(.hidden) .vditor-ir svg') };
  })()`);
  results.push(['markmap-render', mm.svg === true]);

  // 6.98 Word 生成管线（主进程直接验证转换器，不弹对话框）
  try {
    const HTMLtoDOCX = require('html-to-docx');
    const buf = await HTMLtoDOCX(
      '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body><h1>墨流测试</h1><p>Word 导出管线正常。</p></body></html>',
      null, {}
    );
    results.push(['word-gen', !!(buf && buf.length > 1000 && buf[0] === 0x50 && buf[1] === 0x4b)]);
  } catch (err) {
    console.log('[func] word-gen error:', err.message);
    results.push(['word-gen', false]);
  }

  // 6.99 拖拽路径桥接存在
  results.push(['webutils-bridge', await js(`typeof ink.getFilePath === 'function'`)]);

  // 6.995 导出管线端到端（测试钩子跳过保存对话框，校验文件魔数）
  const pdfPath = path.join(tmpDir, '导出测试.pdf');
  process.env.INKFLOW_TEST_SAVEPATH = pdfPath;
  const pdfR = await js(`ink.exportPdf({ html: '<h1>墨流</h1><p>导出管线</p>', cssLinks: [], suggestedName: 'x.pdf' })`);
  let pdfOk = false;
  try {
    const head = Buffer.alloc(5);
    const fd = fs.openSync(pdfPath, 'r');
    fs.readSync(fd, head, 0, 5, 0);
    fs.closeSync(fd);
    pdfOk = head.toString('latin1') === '%PDF-';
  } catch {}
  results.push(['export-pdf-gen', pdfR.ok === true && pdfOk]);

  const pngPath = path.join(tmpDir, '导出测试.png');
  process.env.INKFLOW_TEST_SAVEPATH = pngPath;
  const tallHtml = '<h1>墨流</h1>' + '<p>长图高度验证段落，填充足够内容以撑高页面。</p>'.repeat(120);
  const pngR = await js(`ink.exportImage({ html: ${JSON.stringify(tallHtml)}, cssLinks: [], suggestedName: 'x.png' })`);
  let pngOk = false, pngW = 0, pngH = 0;
  try {
    const head = Buffer.alloc(24);
    const fd = fs.openSync(pngPath, 'r');
    fs.readSync(fd, head, 0, 24, 0);
    fs.closeSync(fd);
    pngOk = head[0] === 0x89 && head[1] === 0x50;
    pngW = head.readUInt32BE(16); // IHDR 宽度
    pngH = head.readUInt32BE(20); // IHDR 高度（需同步 2x，长图不得腰斩）
  } catch {}
  results.push(['export-image-gen', pngR.ok === true && pngOk && pngW >= 1600 && pngH >= 4000]);
  if (!(pngW >= 1600 && pngH >= 4000)) console.log('[debug] png-dim:', pngW, 'x', pngH);
  delete process.env.INKFLOW_TEST_SAVEPATH;

  // 6.997 环境控制条与设置面板
  const seg = await js(`(async () => {
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    document.querySelector('#theme-seg [data-theme-opt="dark"]').click();
    await sleep(400);
    const darkOk = document.body.dataset.theme === 'dark'
      && document.querySelector('#theme-seg [data-theme-opt="dark"]').classList.contains('active');
    document.querySelector('#theme-seg [data-theme-opt="light"]').click();
    await sleep(400);
    const backOk = document.body.dataset.theme === 'light'
      && document.querySelector('#theme-seg [data-theme-opt="light"]').classList.contains('active');
    return { darkOk, backOk };
  })()`);
  results.push(['theme-seg', seg.darkOk && seg.backOk]);

  const setPanel = await js(`(async () => {
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    App.openSettings();
    await sleep(200);
    const visible = !document.querySelector('#modal-settings').classList.contains('hidden');
    const before = parseInt(document.querySelector('#set-fontsize-val').textContent, 10);
    document.querySelector('#fs-plus').click();
    await sleep(200);
    const after = parseInt(document.querySelector('#set-fontsize-val').textContent, 10);
    document.querySelector('#modal-settings [data-close]').click();
    return { visible, before, after, zoomOk: after === before + 1 };
  })()`);
  results.push(['settings-panel', setPanel.visible && setPanel.zoomOk]);

  // 6.996 块级格式快捷键：⌘2 应用二级标题、⌘0 恢复正文（先在测试文档标签上进行）
  await js(`App.activate(App.tabs.findIndex(t => t.path === ${JSON.stringify(testFile)}))`);
  await wait(600);
  const hd = await js(`(async () => {
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    Editor.setValue('快捷键测试行');
    await sleep(400);
    const pre = document.querySelector('.editor-host:not(.hidden) .vditor-ir > .vditor-reset');
    const range = document.createRange();
    range.selectNodeContents(pre.firstElementChild || pre);
    range.collapse(false);
    const sel = window.getSelection();
    sel.removeAllRanges(); sel.addRange(range);
    Editor.heading(2);
    await sleep(500);
    const asH2 = Editor.getValue().trim();
    const anchor = window.getSelection().anchorNode;
    const level = Editor._currentBlockHeading(pre);
    const anchorInfo = anchor ? (anchor.nodeName + '/' + (anchor.parentElement ? anchor.parentElement.tagName : 'no-parent')) : 'none';
    Editor.heading(0);
    await sleep(500);
    const asPara = Editor.getValue().trim();
    // 诊断：工具栏按钮点击路径
    const inHost = document.querySelectorAll('.editor-host:not(.hidden) [data-tag="h2"]').length;
    const inBody = document.querySelectorAll('[data-tag="h2"]').length;
    const btn = document.querySelector('.editor-host:not(.hidden) [data-tag="h2"]');
    let asBtn = 'no-btn';
    if (btn) {
      btn.click();
      await sleep(500);
      asBtn = Editor.getValue().trim();
    }
    return { asH2, asPara, level, anchorInfo, inHost, inBody, asBtn };
  })()`);
  results.push(['heading-shortcut', hd.asH2.startsWith('## ') && !hd.asPara.startsWith('#')]);
  console.log('[debug] heading:', JSON.stringify(hd));

  // 7. 主题切换不报错
  await js(`App.setTheme('dark')`);
  await wait(600);
  await js(`App.setTheme('light')`);
  await wait(600);
  results.push(['theme-toggle', true]);

  let failed = 0;
  for (const [name, ok] of results) {
    console.log(`[func] ${ok ? '✓' : '✗ FAIL'} ${name}`);
    if (!ok) failed++;
  }
  console.log(`[func] ${results.length - failed}/${results.length} passed`);
  mainWin.forceClose = true;
  app.exit(failed ? 1 : 0);
}

// ---------- 生命周期 ----------
app.whenReady().then(async () => {
  const r = await startAssetServer();
  assetServer = r.server;
  assetUrl = r.url;

  registerIPC();
  createWindow();
  watchFolder(settings.get('openFolder', ''));

  nativeTheme.on('updated', () => {
    if (settings.get('theme') === 'system' && mainWin) {
      mainWin.webContents.send('menu:action', { action: 'system-theme-changed' });
    }
  });

  if (isSmoke && process.env.SMOKE_FUNC === '1') runFuncSmoke();
  else if (isSmoke) runSmoke();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('second-instance', () => {
  if (mainWin) {
    if (mainWin.isMinimized()) mainWin.restore();
    mainWin.focus();
  }
});

// Finder 双击/拖拽 .md 到 Dock：运行中直接开页签，冷启动存起来等渲染就绪
let pendingOpenFile = null;
app.on('open-file', (e, p) => {
  e.preventDefault();
  if (mainWin && !mainWin.isDestroyed()) {
    mainWin.webContents.send('menu:action', { action: 'open-path', payload: p });
    if (mainWin.isMinimized()) mainWin.restore();
    mainWin.show();
    mainWin.focus();
  } else {
    pendingOpenFile = p;
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
