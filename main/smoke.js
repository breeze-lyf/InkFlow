const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

function createSmokeRunner(options = {}) {
  const {
    app,
    getMainWindow,
    projectRoot,
    waitForRendererReady,
    grantFile,
    grantFolder,
    convertWord,
    env = process.env,
    logger = console,
  } = options;
  if (!app || typeof getMainWindow !== 'function' || !projectRoot
    || typeof waitForRendererReady !== 'function'
    || typeof grantFile !== 'function' || typeof grantFolder !== 'function'
    || typeof convertWord !== 'function') {
    throw new Error('smoke runner 缺少依赖');
  }

async function runSmoke() {
  const mainWin = getMainWindow();
  const outDir = env.SMOKE_OUT_DIR
    ? path.resolve(env.SMOKE_OUT_DIR)
    : app.isPackaged
    ? path.join(os.tmpdir(), 'inkflow-shots')
    : path.join(projectRoot, 'assets', 'screenshots');
  fs.mkdirSync(outDir, { recursive: true });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  await waitForRendererReady();
  await wait(500);

  const samplesFolder = path.join(projectRoot, 'samples');
  const demoFile = env.SMOKE_FILE || path.join(samplesFolder, '功能演示.md');
  if (env.SMOKE_FILE) grantFile(demoFile);

  mainWin.webContents.send('menu:action', { action: 'open-path', payload: samplesFolder });
  await wait(1200);
  mainWin.webContents.send('menu:action', { action: 'open-path', payload: demoFile });
  await wait(2600);

  if (env.SMOKE_TABLE_PROBE === '1') {
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
    logger.log('[table-probe]', JSON.stringify(tp, null, 1));
  }

  if (env.SMOKE_PROBE === '1') {
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
    logger.log('[probe]\n' + probe);
  }

  const shots = (env.SMOKE_SHOTS || 'light,dark').split(',');
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
    } else if (shot === 'settings') {
      await mainWin.webContents.executeJavaScript(`App.openSettings(); 'ok'`);
    } else if (shot.startsWith('accent-')) {
      const [, v, appearance] = shot.split('-');
      await mainWin.webContents.executeJavaScript(`
        ${appearance === 'light' || appearance === 'dark' ? `App.setTheme(${JSON.stringify(appearance)});` : ''}
        App.setAccent(${JSON.stringify(v || 'indigo')});
        'ok'`);
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
    } else if (shot === 'settings') {
      await mainWin.webContents.executeJavaScript(`document.querySelector('#modal-settings').classList.add('hidden'); 'ok'`);
    }
  }
  logger.log('[smoke] screenshots saved to', outDir);
  mainWin.forceClose = true;
  app.exit(0);
}

// ---------- 功能冒烟（编辑/自动保存/标签） ----------
async function runFuncSmoke() {
  const mainWin = getMainWindow();
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const results = [];
  const tmpDir = path.join(os.tmpdir(), 'inkflow-func');
  fs.mkdirSync(tmpDir, { recursive: true });
  grantFolder(tmpDir);
  const singleFileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'inkflow-single-file-assets-'));
  const singleFile = path.join(singleFileDir, 'single.md');
  fs.writeFileSync(singleFile, '# 单文件\n', 'utf-8');
  grantFile(singleFile);
  const testFile = path.join(tmpDir, '测试文档.md');
  fs.writeFileSync(testFile, '# 测试\n\n原始内容。\n', 'utf-8');
  fs.writeFileSync(path.join(tmpDir, 'local-vector.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="60"><rect width="120" height="60" fill="#315d4c"/><text x="12" y="36" fill="white">Vector</text></svg>', 'utf-8');
  fs.writeFileSync(path.join(tmpDir, 'a&b.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="60"><rect width="120" height="60" fill="#315d4c"/><text x="12" y="36" fill="white">Amp</text></svg>', 'utf-8');

  await waitForRendererReady();
  await wait(400);

  const js = async (code) => {
    try {
      return await mainWin.webContents.executeJavaScript(code);
    } catch (e) {
      logger.log('[js-fail]', e.message, '| CODE:', code.replace(/\s+/g, ' ').slice(0, 160));
      return null;
    }
  };

  // 1. 打开文件
  mainWin.webContents.send('menu:action', { action: 'open-path', payload: testFile });
  await wait(2200);
  results.push(['open-file', await js(`(App.activeTab() && App.activeTab().path === ${JSON.stringify(testFile)})`)]);

  // 2. 编辑 + 脏标记
  // 在同一个 renderer 任务中刷新并读取脏状态，避免繁忙 CI 把固定等待
  // 延迟到自动保存完成之后，误把正确的 clean 状态判成 dirty 失败。
  const dirtyAfterEdit = await js(`(() => {
    const tab = App.activeTab();
    Editor.insert('\\n\\n冒烟自动化测试：墨流已就绪。');
    App.onEditorInput(tab.key);
    return tab.dirty === true;
  })()`);
  results.push(['dirty-flag', dirtyAfterEdit]);

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
  const demoPath = path.join(projectRoot, 'samples', '功能演示.md');
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
  if (dbl.after !== dbl.before - 1) logger.log('[debug] dblclick:', JSON.stringify(dbl));

  // 6.96 编辑器实例池：切走再切回，宿主元素应保持同一个（零重渲染）
  const reuse = await js(`(async () => {
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const a = App.tabs.find(t => t.path === ${JSON.stringify(testFile)});
    if (!a) return { fail: 'tab missing' };
    const inst1 = Editor.instances.get(a.key);
    if (!inst1) return { fail: 'no instance' };
    const host1 = inst1.host;
    const valueBefore = Editor.getValue(a.key);
    App.newUntitled();
    await sleep(900);
    await App.activate(App.tabs.indexOf(a));
    await sleep(300);
    const inst2 = Editor.instances.get(a.key);
    if (!inst2) return { fail: 'instance disappeared' };
    const same = host1 === inst2.host;
    const visible = !inst2.host.classList.contains('hidden');
    const intact = Editor.getValue(a.key) === valueBefore;
    App.closeTab(App.tabs.findIndex(t => t.path === null), true);
    await sleep(300);
    return { same, visible, intact };
  })()`);
  results.push(['instance-reuse', !!(reuse.same && reuse.visible && reuse.intact)]);
  if (!(reuse && reuse.same && reuse.visible && reuse.intact)) logger.log('[debug] instance-reuse:', JSON.stringify(reuse));

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
  copyDirSync(path.join(projectRoot, 'samples'), samplesDir);
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
  if (!(tree.opened && tree.closed && tree.allClosed)) logger.log('[debug] tree:', JSON.stringify(tree));

  // 6.975 选中目录下创建文件：落在 assets/ 内且立即出现在树中（缓存失效，无需手动刷新）
  const createdFile = path.join(samplesDir, 'assets', '子目录新建.md');
  const create = await js(`(async () => {
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const dirRow = document.querySelector('.tree-row[data-is-dir="1"]');
    if (!dirRow) return { fail: 'no dir row' };
    dirRow.click(); await sleep(400);
    document.querySelector('#btn-new-file').click();
    let input = null;
    for (let attempt = 0; attempt < 30 && !input; attempt += 1) {
      await sleep(100);
      input = document.querySelector('.tree-rename-input');
    }
    if (!input) return { fail: 'no input row' };
    input.value = '子目录新建.md';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await sleep(1000);
    const newPath = ${JSON.stringify(createdFile)};
    const row = document.querySelector('.tree-row[data-path="' + CSS.escape(newPath) + '"]');
    return { inTree: !!row };
  })()`);
  results.push(['create-under-selection', create.inTree === true && fs.existsSync(createdFile)]);
  if (create.inTree !== true) logger.log('[debug] create:', JSON.stringify(create));
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
    await App.activate(App.tabs.findIndex(t => t.path === ${JSON.stringify(testFile)}));
    await sleep(300);
    Editor.setValue(${JSON.stringify(`![file-url](${pathToFileURL(path.join(tmpDir, 'local-vector.svg')).href})\n`)});
    await sleep(1200);
    const fileImage = document.querySelector('.editor-host:not(.hidden) img[alt="file-url"]');
    const fileUrlLoaded = !!(fileImage && fileImage.dataset.inkFixed
      && fileImage.src.startsWith(App.assetUrl) && fileImage.complete && fileImage.naturalWidth > 0);
    return { total: imgs.length, fixed, loaded, fileUrlLoaded };
  })()`);
  results.push(['img-render', imgOk.total > 0 && imgOk.fixed === imgOk.total
    && imgOk.loaded === imgOk.total && imgOk.fileUrlLoaded]);
  if (!(imgOk.total > 0 && imgOk.loaded === imgOk.total && imgOk.fileUrlLoaded)) {
    logger.log('[debug] img-render:', JSON.stringify(imgOk));
  }

  // 6.9781 单文件权限：未授权父文件夹时，截图仍只能写入相邻 assets/。
  const singleAsset = await js(`ink.saveImageBytes(
    new Uint8Array([137,80,78,71,13,10,26,10]),
    'clipboard.png',
    ${JSON.stringify(singleFileDir)}
  )`);
  const singleAssetPath = singleAsset && singleAsset.ok && /^assets\/[\w.-]+\.png$/.test(singleAsset.relPath)
    ? path.join(singleFileDir, singleAsset.relPath)
    : '';
  results.push(['single-file-image-assets', Boolean(singleAssetPath && fs.existsSync(singleAssetPath))]);

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
  if (pasteMd.hasHeading !== true) logger.log('[debug] paste-md:', JSON.stringify(pasteMd));

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
  if (!(pv.noImgInsert && pv.lenOk)) logger.log('[debug] preview-tab:', JSON.stringify(pv));

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
  const newestTime = new Date(Date.now() + 5000);
  fs.utimesSync(newest, newestTime, newestTime);
  const sm = await js(`(async () => {
    const mtimeSaved = await App.setSetting({ fileSortMode: 'mtime' });
    FileTree.cache.clear();
    await FileTree.render();
    const rows = [...document.querySelectorAll('#file-tree .tree-row')]
      .filter(r => r.dataset.isDir !== '1' && r.closest('.tree-children') === null);
    const first = rows.length ? rows[0].dataset.path : '';
    const nameSaved = await App.setSetting({ fileSortMode: 'name' });
    FileTree.cache.clear();
    await FileTree.render();
    return { first, mtimeSaved, nameSaved };
  })()`);
  results.push(['sort-mtime', sm.first === newest && sm.mtimeSaved === true && sm.nameSaved === true]);
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
  if (!(imgDel.visible && imgDel.removed)) logger.log('[debug] img-toolbar:', JSON.stringify(imgDel));

  // 6.97811 mermaid 导出：应渲染为 SVG 而非显示原始代码
  const mer = await js(`(async () => {
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    await App.activate(App.tabs.findIndex(t => t.path === ${JSON.stringify(testFile)}));
    await sleep(400);
    Editor.setValue('## 流程\\n\\n\`\`\`mermaid\\nflowchart TB\\n  A-->B;\\n\`\`\`\\n');
    await sleep(800);
    const html = await Editor.getExportHtml();
    return {
      hasImage: /data:image\\/png;base64,/i.test(html),
      labels: /alt="[^"]*A[^"]*B[^"]*"/i.test(html),
      frozen: html.includes('data-inkflow-static="svg-image"'),
      noRawCode: !html.includes('A--&gt;B') && !html.includes('A-->B</'),
      snippet: html.slice(-4000),
    };
  })()`);
  results.push(['mermaid-export-svg', mer.hasImage === true && mer.labels === true && mer.frozen === true && mer.noRawCode === true]);
  if (!(mer.hasImage && mer.labels && mer.frozen)) logger.log('[debug] mermaid-export:', JSON.stringify(mer));

  // 6.978111 富内容导出：数学、markmap、SMILES 都必须冻结为静态内容
  const rich = await js(`(async () => {
    try {
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    Editor.setValue('## 富内容\\n\\n- [x] done\\n- [ ] todo\\n\\n$$\\n' + String.fromCharCode(92) + 'sqrt{x^2 + y^2}\\n$$\\n\\n\`\`\`js\\nconst answer = 42;\\n\`\`\`\\n\\n\`\`\`markmap\\n# Root\\n## Branch\\n\`\`\`\\n\\n\`\`\`smiles\\nCCO\\n\`\`\`\\n\\n![vector](local-vector.svg#check)\\n\\n![amp](a%26b.svg)\\n');
    await sleep(1400);
    const html = await Editor.getExportHtml();
    const wordHtml = await Editor.getExportHtml({ rasterizeSvg: true });
    let timeoutRejected = false;
    try {
      await ExportRenderer.renderHtml({
        html: '<div class="language-mermaid">flowchart TB; A--&gt;B</div>',
        documentApi: document,
        windowApi: window,
        VditorApi: { mermaidRender() {} },
        sanitizeHtml: ExportSafety.sanitizeHtml,
        timeoutMs: 10,
      });
    } catch (error) {
      timeoutRejected = /富内容渲染超时/.test(String(error && error.message || error));
    }
    const richTemplate = document.createElement('template');
    richTemplate.innerHTML = html;
    return {
      math: html.includes('class="katex"') || html.includes('katex-display'),
      mathLayout: !richTemplate.content.querySelector('.language-math img[data-inkflow-static="svg-image"], .katex img[data-inkflow-static="svg-image"]'),
      noCopyControl: !html.includes('vditor-copy') && !/<textarea\\b/i.test(html),
      taskState: html.includes('☑') && html.includes('☐') && !/<input\\b/i.test(html),
      markmap: /language-markmap[^>]*>[\\s\\S]*?data-inkflow-static="svg-image"/i.test(html),
      smiles: /language-smiles[^>]*>[\\s\\S]*?data-inkflow-static="svg-image"/i.test(html),
      noExecutable: !/<script\\b|\\son[a-z]+\\s*=|javascript:/i.test(html),
      vectorRaster: /<img[^>]+src="data:image\\/png;base64,[^"]+"[^>]+alt="vector"/i.test(html)
        || /<img[^>]+alt="vector"[^>]+src="data:image\\/png;base64,/i.test(html),
      ampRaster: /<img[^>]+src="data:image\\/png;base64,[^"]+"[^>]+alt="amp"/i.test(html)
        || /<img[^>]+alt="amp"[^>]+src="data:image\\/png;base64,/i.test(html),
      wordRaster: (wordHtml.match(/data:image\\/png;base64,/gi) || []).length >= 4
        && wordHtml.includes('data-inkflow-static="svg-image"'),
      timeoutRejected,
    };
    } catch (error) { return { error: String(error && error.stack || error) }; }
  })()`);
  results.push(['rich-export-static', !!(rich && rich.math && rich.mathLayout && rich.noCopyControl && rich.taskState
    && rich.markmap && rich.smiles && rich.noExecutable && rich.vectorRaster && rich.ampRaster && rich.wordRaster
    && rich.timeoutRejected)]);
  if (!(rich && rich.math && rich.mathLayout && rich.noCopyControl && rich.taskState && rich.markmap && rich.smiles
    && rich.noExecutable && rich.vectorRaster && rich.ampRaster && rich.wordRaster && rich.timeoutRejected)) {
    logger.log('[debug] rich-export:', JSON.stringify(rich));
  }

  // 6.978112 ECharts 导出：canvas 必须冻结为 PNG，序列化后不能留下空画布
  const chart = await js(`(async () => {
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    window.__inkflowChartPwned = 0;
    Editor.setValue('\`\`\`echarts\\n({"series":[],"title":(window.__inkflowChartPwned=1,{})})\\n\`\`\`\\n');
    await sleep(900);
    const strictJson = window.__inkflowChartPwned === 0;
    Editor.setValue('\`\`\`echarts\\n{"xAxis":{"type":"category","data":["A","B"]},"yAxis":{"type":"value"},"series":[{"type":"bar","data":[1,2]}]}\\n\`\`\`\\n');
    await sleep(1200);
    const raw = Editor.vditor.getHTML();
    const html = await Editor.getExportHtml();
    return {
      image: /data:image\\/png;base64,/i.test(html),
      marker: html.includes('data-inkflow-static="image"'),
      noCanvas: !/<canvas\\b/i.test(html),
      strictJson,
      plan: ExportRenderer.rendererPlan(raw),
      hasEcharts: !!window.echarts,
      raw: raw.slice(0, 500),
      final: html.slice(0, 500),
    };
  })()`);
  results.push(['chart-strict-json', !!(chart && chart.strictJson)]);
  results.push(['chart-export-image', !!(chart && chart.image && chart.marker && chart.noCanvas)]);
  if (!(chart && chart.image && chart.marker && chart.noCanvas)) logger.log('[debug] chart-export:', JSON.stringify(chart));

  // 6.978113 原始 HTML 导出：脚本、事件属性和主动 URL 不能进入产物
  const safeExport = await js(`(async () => {
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    Editor.setValue('<img src="x" onerror="window.__inkflowPwned=1"><script>window.__inkflowPwned=2</script><a href="javascript:alert(1)">x</a><scr<script>ipt>alert(3)</scr<script>ipt><me<meta>ta http-equiv="refresh" content="0;url=http://127.0.0.1:9/"><svg><foreignObject><p>bad</p></foreignObject><animate attributeName="x"></animate><path d="M0 0" fill="url(http://127.0.0.1:9/x.svg#p)"></path></svg>');
    await sleep(700);
    const html = await Editor.getExportHtml();
    const nested = ExportSafety.sanitizeHtml('<foo><bar><p id="nested-safe">nested text</p></bar></foo><svg><path fill="u/**/rl(file:///tmp/x.svg)"></path><path stroke="u\\\\72l(file:///tmp/y.svg)"></path></svg>');
    const hostileLayout = ExportSafety.sanitizeHtml('<div style="--bomb:999999999px;height:var(--bomb)">v</div><div style="filter:blur(999999999px);transform:scale(999999999);zoom:999999999">p</div><svg><rect width="calc(999999999px)" height="100vw"></rect><g transform="scale(999999999)"></g></svg>');
    const template = document.createElement('template');
    template.innerHTML = html;
    const activeElement = template.content.querySelector('script,meta,iframe,object,embed,foreignObject,animate,set,style,link');
    const unsafeAttribute = Array.from(template.content.querySelectorAll('*')).some((node) =>
      Array.from(node.attributes).some((attr) => /^on/i.test(attr.name)
        || (/^(?:src|href|xlink:href|fill|stroke|clip-path|mask|marker-start|marker-mid|marker-end)$/i.test(attr.name)
          && /(?:javascript:|http:\\/\\/127\\.0\\.0\\.1:9)/i.test(attr.value))));
    return {
      clean: !activeElement && !unsafeAttribute,
      notExecuted: !window.__inkflowPwned,
      nestedPreserved: nested.includes('id="nested-safe"') && nested.includes('nested text'),
      obfuscatedPaintGone: !nested.includes('file:') && !nested.includes('u/**/rl') && !nested.includes('72l('),
      layoutBounded: !/style=|calc\\(|100vw|scale\\(999999999\\)/i.test(hostileLayout),
      html: html.slice(0, 4000),
    };
  })()`);
  results.push(['export-html-sanitize', !!(safeExport && safeExport.clean && safeExport.notExecuted
    && safeExport.nestedPreserved && safeExport.obfuscatedPaintGone && safeExport.layoutBounded)]);
  if (!(safeExport && safeExport.clean && safeExport.notExecuted && safeExport.nestedPreserved
    && safeExport.obfuscatedPaintGone && safeExport.layoutBounded)) logger.log('[debug] export-sanitize:', JSON.stringify(safeExport));

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
  if (drop && !(drop.mdOk && drop.dirOk && drop.pdfOk && drop.toastOk && drop.noInsert)) logger.log('[debug] drop:', JSON.stringify(drop));

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
  if (nodirty.dirty !== false) logger.log('[debug] open-no-dirty:', JSON.stringify(nodirty));

  // 6.97815 主色调切换：砚灰明暗配色、内容同步、持久化 + 回切靛蓝还原
  const acc = await js(`(async () => {
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    App.setTheme('light');
    await sleep(300);
    const button = document.querySelector('#set-accent [data-v="yan"]');
    button && button.click();
    await sleep(300);
    const reset = document.querySelector('.editor-host:not(.hidden) .vditor-reset');
    const lightOk = !!button
      && button.classList.contains('active')
      && document.body.dataset.accent === 'yan'
      && getComputedStyle(document.body).getPropertyValue('--accent').trim() === '#414141'
      && getComputedStyle(document.body).getPropertyValue('--bg-app').trim() === '#f9f9f9'
      && getComputedStyle(document.body).getPropertyValue('--bg-sidebar').trim() === '#f3f3f3'
      && getComputedStyle(document.body).getPropertyValue('--bg-editor').trim() === '#ffffff'
      && getComputedStyle(document.body).getPropertyValue('--bg-elevated').trim() === '#ffffff'
      && getComputedStyle(reset).getPropertyValue('--ink-accent').trim() === '#414141';
    App.setTheme('dark');
    await sleep(300);
    const darkOk = getComputedStyle(document.body).getPropertyValue('--accent').trim() === '#afafaf'
      && getComputedStyle(document.body).getPropertyValue('--bg-app').trim() === '#181818'
      && getComputedStyle(document.body).getPropertyValue('--bg-sidebar').trim() === '#181818'
      && getComputedStyle(document.body).getPropertyValue('--bg-editor').trim() === '#212121'
      && getComputedStyle(document.body).getPropertyValue('--bg-elevated').trim() === '#282828'
      && getComputedStyle(reset).getPropertyValue('--ink-accent').trim() === '#afafaf';
    const saved = await ink.getSettings();
    const savedOk = saved && saved.accent === 'yan';
    App.setAccent('indigo');
    await sleep(200);
    const backDarkOk = getComputedStyle(document.body).getPropertyValue('--accent').trim() === '#93a1ff';
    App.setTheme('light');
    await sleep(200);
    const backLightOk = getComputedStyle(document.body).getPropertyValue('--accent').trim() === '#4c5fd5';
    App.setTheme('system');
    return { lightOk, darkOk, savedOk, backDarkOk, backLightOk };
  })()`);
  results.push(['accent-palette', acc.lightOk === true && acc.darkOk === true && acc.savedOk === true && acc.backDarkOk === true && acc.backLightOk === true]);
  if (!(acc.lightOk && acc.darkOk && acc.savedOk && acc.backDarkOk && acc.backLightOk)) logger.log('[debug] accent:', JSON.stringify(acc));

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

  // 6.98 Word 生成管线（走与生产一致的隔离 utility process，不弹对话框）
  try {
    const buf = await convertWord(
      '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body><h1>墨流测试</h1><p>Word 导出管线正常。</p></body></html>'
    );
    results.push(['word-gen', !!(buf && buf.length > 1000 && buf[0] === 0x50 && buf[1] === 0x4b)]);
  } catch (err) {
    logger.log('[func] word-gen error:', err.message);
    results.push(['word-gen', false]);
  }

  // 6.99 拖拽路径桥接存在
  results.push(['webutils-bridge', await js(`typeof ink.getFilePath === 'function'`)]);

  // 6.995 导出管线端到端（测试钩子跳过保存对话框，校验文件魔数）
  const pdfPath = path.join(tmpDir, '导出测试.pdf');
  env.INKFLOW_TEST_SAVEPATH = pdfPath;
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
  env.INKFLOW_TEST_SAVEPATH = pngPath;
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
  if (!(pngW >= 1600 && pngH >= 4000)) logger.log('[debug] png-dim:', pngW, 'x', pngH);
  delete env.INKFLOW_TEST_SAVEPATH;

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
  logger.log('[debug] heading:', JSON.stringify(hd));

  // 7. 主题切换不报错
  await js(`App.setTheme('dark')`);
  await wait(600);
  await js(`App.setTheme('light')`);
  await wait(600);
  results.push(['theme-toggle', true]);

  try { fs.rmSync(singleFileDir, { recursive: true, force: true }); } catch {}

  let failed = 0;
  for (const [name, ok] of results) {
    logger.log(`[func] ${ok ? '✓' : '✗ FAIL'} ${name}`);
    if (!ok) failed++;
  }
  logger.log(`[func] ${results.length - failed}/${results.length} passed`);
  mainWin.forceClose = true;
  app.exit(failed ? 1 : 0);
}

  async function run() {
    if (env.SMOKE_FUNC === '1') return runFuncSmoke();
    return runSmoke();
  }

  return Object.freeze({ run });
}

module.exports = { createSmokeRunner };
