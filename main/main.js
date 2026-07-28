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

// ---------- 窗口 ----------
function createWindow() {
  const themeMode = settings.get('theme', 'system');
  const dark = themeMode === 'dark' || (themeMode === 'system' && nativeTheme.shouldUseDarkColors);

  mainWin = new BrowserWindow({
    width: isSmoke ? 1440 : 1240,
    height: isSmoke ? 920 : 820,
    minWidth: 880,
    minHeight: 560,
    title: '墨流 InkFlow',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 18 },
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
      const docsDir = path.join(os.homedir(), 'Documents', '墨流示例');
      return fs.existsSync(docsDir) ? docsDir : path.join(__dirname, '..', 'samples');
    })(),
  }));

  ipcMain.on('renderer:ready', () => {
    // 首次启动：把示例文档库复制到 ~/Documents/墨流示例 并打开
    if (isSmoke) return;
    if (settings.get('firstRunDone')) return;
    settings.set('firstRunDone', true);
    try {
      const srcDir = path.join(__dirname, '..', 'samples');
      const destDir = path.join(os.homedir(), 'Documents', '墨流示例');
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

  ipcMain.handle('fs:read-dir', (e, dir) => {
    try {
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
          entries.push({ name, path: full, isDir: true });
        } else {
          const ext = path.extname(name).toLowerCase();
          if (MD_EXTS.includes(ext) || IMG_EXTS.includes(ext)) {
            entries.push({ name, path: full, isDir: false, isImage: IMG_EXTS.includes(ext), mtime: st.mtimeMs, size: st.size });
          }
        }
      }
      entries.sort((a, b) => {
        if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
        return a.name.localeCompare(b.name, 'zh-Hans-CN');
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
    mainWin.setRepresentedFilename(p || '');
    mainWin.setDocumentEdited(!!edited);
  });

  ipcMain.on('win:confirm-close', () => {
    if (mainWin) {
      mainWin.forceClose = true;
      mainWin.close();
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

    let shotWin = new BrowserWindow({
      show: false,
      width: 900,
      height: 1200,
      webPreferences: { sandbox: true, contextIsolation: true },
    });
    try {
      await shotWin.loadFile(tmpHtml);
      await shotWin.webContents.setZoomFactor(2); // 2x 输出更清晰
      await new Promise((r) => setTimeout(r, 1100));
      const h = await shotWin.webContents.executeJavaScript(
        'Math.min((document.body.scrollHeight || 800) + 20, 7000)'
      );
      shotWin.setContentSize(900, Math.max(480, Math.ceil(h)));
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

  const js = (code) => mainWin.webContents.executeJavaScript(code);

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
  results.push(['export-html-gen', await js(`Editor.getExportHtml().includes('<h1')`)]);

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
  const samplesDir = path.join(__dirname, '..', 'samples');
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
    return { opened, closed, allClosed };
  })()`);
  results.push(['tree-collapse', !!(tree.opened && tree.closed && tree.allClosed)]);
  if (!(tree.opened && tree.closed && tree.allClosed)) console.log('[debug] tree:', JSON.stringify(tree));

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
  const pngR = await js(`ink.exportImage({ html: '<h1>墨流</h1><p>导出管线</p>', cssLinks: [], suggestedName: 'x.png' })`);
  let pngOk = false;
  try {
    const head = Buffer.alloc(8);
    const fd = fs.openSync(pngPath, 'r');
    fs.readSync(fd, head, 0, 8, 0);
    fs.closeSync(fd);
    pngOk = head[0] === 0x89 && head[1] === 0x50;
  } catch {}
  results.push(['export-image-gen', pngR.ok === true && pngOk]);
  delete process.env.INKFLOW_TEST_SAVEPATH;

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

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
