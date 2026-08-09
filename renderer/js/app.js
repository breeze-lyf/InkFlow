// ============ 墨流 InkFlow · 应用编排 ============
'use strict';

const App = {
  folder: null,
  tabs: [],           // { path|null, name, dirty, savedValue, cachedValue }
  active: -1,
  settings: {},
  assetUrl: '',
  samplesDir: '',
  untitledSeq: 0,
  _autosave: null,

  /* ================= 启动 ================= */
  async boot() {
    const info = await ink.info();
    this.platform = info.platform;
    this.isMac = info.platform === 'darwin';
    document.body.dataset.platform = info.platform;
    this.assetUrl = info.assetUrl;
    this.samplesDir = info.samplesDir;
    this.settings = await ink.getSettings();
    $('#about-ver').textContent = 'v' + info.version;
    $('#set-ver').textContent = '墨流 v' + info.version;

    CtxMenu.init();
    Overlay.init();
    this._applyThemeSetting(this.settings.theme || 'system');
    this._applyFontSize(this.settings.fontSize || 16);
    this._applyPageWidth(this.settings.pageWidth || 'normal');
    document.body.dataset.sidebar = this.settings.sidebarVisible === false ? 'hidden' : 'visible';
    document.body.dataset.focus = this.settings.focusMode ? 'on' : 'off';
    document.body.dataset.toolbar = this.settings.showToolbar ? 'show' : 'hide';
    document.documentElement.style.setProperty('--sidebar-w', (this.settings.sidebarWidth || 260) + 'px');

    await Editor.init();
    Editor.setTypewriter(this.settings.typewriter !== false);

    this._bindUI();
    this._bindMenu();

    // 恢复上次会话
    await this._restoreSession();

    this._localizeKbds();
    this._renderWelcome();
    ink.ready();
  },

  // Windows/Linux：静态界面里的 ⌘⌥⇧ 符号替换为 Ctrl/Alt/Shift 文字
  _localizeKbds() {
    if (this.isMac) return;
    $$('kbd').forEach((k) => { k.textContent = fmtKbd(k.textContent, false); });
    $$('[title]').forEach((n) => {
      const t = n.getAttribute('title');
      if (t && /[⌘⌥⇧]/.test(t)) n.setAttribute('title', fmtKbd(t, false));
    });
  },

  async _restoreSession() {
    const folder = this.settings.openFolder;
    if (folder && await ink.exists(folder)) {
      this.folder = folder;
      await FileTree.setRoot(folder);
      ink.addRecent(folder, 'folder');
    } else {
      await FileTree.setRoot(null);
    }

    // 恢复标签：只登记不逐个激活（编辑器实例懒创建，首屏只渲染活动标签）
    const paths = this.settings.openTabs || [];
    for (const p of paths) {
      if (!(await ink.exists(p))) continue;
      const r = await ink.readFile(p);
      if (!r.ok) continue;
      this.tabs.push({
        key: p,
        path: p,
        name: P.basename(p),
        dirty: false,
        savedValue: r.content,
        cachedValue: r.content,
      });
    }
    const activePath = this.settings.activeTab;
    const idx = this.tabs.findIndex((t) => t.path === activePath);
    if (idx >= 0) await this.activate(idx);
    else if (this.tabs.length) await this.activate(0);
    this._syncWelcome();
  },

  /* ================= 标签页 ================= */
  activeTab() { return this.tabs[this.active] || null; },

  async openFile(path, silent) {
    if (!path) return;
    const exist = this.tabs.findIndex((t) => t.path === path);
    if (exist >= 0) { await this.activate(exist); return; }
    const r = await ink.readFile(path);
    if (!r.ok) { toast('无法打开文件：' + P.basename(path)); return; }
    this.tabs.push({
      key: path,
      path,
      name: P.basename(path),
      dirty: false,
      savedValue: r.content,
      cachedValue: r.content,
    });
    await this.activate(this.tabs.length - 1);
    ink.addRecent(path, 'file');
    if (!silent) this._renderWelcome();
    this._persistSession();
  },

  newUntitled() {
    this.untitledSeq += 1;
    this.tabs.push({
      key: 'untitled:' + this.untitledSeq,
      path: null,
      name: `未命名-${this.untitledSeq}.md`,
      dirty: false,
      savedValue: '',
      cachedValue: '',
    });
    this.activate(this.tabs.length - 1);
    setTimeout(() => Editor.focus(), 60);
  },

  // 预览非 Markdown 文件（图片/PDF 等）：只读页签，不创建编辑器实例
  openPreview(p) {
    const existing = this.tabs.findIndex((t) => t.path === p && t.kind === 'preview');
    if (existing >= 0) { this.activate(existing); return; }
    this.tabs.push({
      key: 'preview:' + p,
      path: p,
      name: P.basename(p),
      kind: 'preview',
      dirty: false,
      savedValue: '',
      cachedValue: '',
    });
    this.activate(this.tabs.length - 1);
  },

  _showPreview(tab) {
    const pane = $('#preview-pane');
    const ext = P.extname(tab.path).toLowerCase();
    const url = `${this.assetUrl}/img?path=${encodeURIComponent(tab.path)}`;
    if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp'].includes(ext)) {
      pane.innerHTML = `<img src="${url}" alt="${tab.name}">`;
    } else if (ext === '.pdf') {
      pane.innerHTML = `<iframe src="${url}" title="${tab.name}"></iframe>`;
    } else {
      pane.innerHTML = `<div class="preview-unsupported">暂不支持预览该格式</div>`;
    }
    pane.classList.remove('hidden');
  },

  _hidePreview() {
    const pane = $('#preview-pane');
    pane.classList.add('hidden');
    pane.innerHTML = '';
  },

  async activate(i) {
    if (i < 0 || i >= this.tabs.length) return;
    this.active = i;
    const tab = this.activeTab();
    if (tab.kind === 'preview') {
      Editor.clearActive();
      this._showPreview(tab);
      this._renderTabs();
      this._syncWelcome();
      this.updateStatus();
      Outline.render();
      FileTree.markActive(tab.path);
      ink.setWindowFile(tab.path, false);
      this._persistSession();
      return;
    }
    this._hidePreview();
    // 实例池：切换只显隐，不重渲染；首次激活懒创建
    await Editor.activate(tab.key, tab);
    const cur = Editor.getValue(tab.key);
    tab.dirty = this._contentDirty(cur === null ? tab.cachedValue : cur, tab.savedValue);

    this._renderTabs();
    this._syncWelcome();
    this.updateStatus();
    Outline.render();
    FileTree.markActive(tab.path);
    ink.setWindowFile(tab.path || '', tab.dirty);
    if (tab.path && this.folder && tab.path.startsWith(this.folder)) {
      FileTree.reveal(tab.path);
    }
    this._persistSession();
  },

  async closeTab(i, force) {
    const tab = this.tabs[i];
    if (!tab) return;
    if (tab.dirty && !force) {
      const choice = await this._confirm({
        title: '关闭标签页',
        msg: `“${tab.name}” 有未保存的更改，关闭前是否保存？`,
        buttons: [
          { label: '取消', value: 'cancel' },
          { label: '不保存', value: 'discard', danger: true },
          { label: '保存', value: 'save', primary: true },
        ],
      });
      if (choice === 'cancel') return;
      if (choice === 'save') {
        const ok = await this.save(i);
        if (!ok) return;
      }
    }
    const wasActive = i === this.active;
    Editor.destroy(tab.key);
    this.tabs.splice(i, 1);
    if (this.active > i) this.active -= 1;
    if (wasActive) {
      if (this.tabs.length) await this.activate(Math.min(this.active, this.tabs.length - 1));
      else {
        this.active = -1;
        Editor.clearActive();
        this._renderTabs();
        this._syncWelcome();
        this.updateStatus();
        Outline.render();
        FileTree.markActive(null);
        ink.setWindowFile('', false);
      }
    } else {
      this._renderTabs();
    }
    this._persistSession();
  },

  closeTabByPath(path, force) {
    const i = this.tabs.findIndex((t) => t.path === path);
    if (i >= 0) this.closeTab(i, force);
  },

  onPathRenamed(from, to) {
    const tab = this.tabs.find((t) => t.path === from);
    if (tab) {
      tab.path = to;
      tab.key = to;
      tab.name = P.basename(to);
      Editor.rekey(from, to);
      this._renderTabs();
      this.updateStatus();
    }
    if (this.folder === from) {
      this.folder = to;
      FileTree.setRoot(to);
    }
    this._persistSession();
  },

  /* ================= 输入 & 保存 ================= */
  // vditor 空文档 getValue() 返回 "\n"：全空白与空串视为等价，避免"新建未动过的标签也提示保存"
  _contentDirty(val, saved) {
    if (val === saved) return false;
    return val.trim() !== '' || (saved || '').trim() !== '';
  },


  onEditorInput(key) {
    const tab = this.tabs.find((t) => t.key === key) || this.activeTab();
    if (!tab) return;
    const val = Editor.getValue(tab.key);
    if (val === null) return;
    tab.cachedValue = val;
    tab.dirty = this._contentDirty(val, tab.savedValue);
    this._renderTabs();
    this.updateStatus();
    ink.setWindowFile(tab.path || '', tab.dirty);
    clearTimeout(this._autosave);
    this._autosave = setTimeout(() => this._autoSave(), 900);
    this._outlineTimer && clearTimeout(this._outlineTimer);
    this._outlineTimer = setTimeout(() => Outline.render(), 500);
  },

  onEditorFocus() {},

  async _autoSave() {
    const tab = this.activeTab();
    if (!tab || !tab.dirty) return;
    if (!tab.path) return; // 未命名文件不自动落盘
    const val = Editor.getValue(tab.key);
    if (val === null) return;
    const r = await ink.writeFile(tab.path, val);
    if (r.ok) {
      tab.savedValue = val;
      tab.cachedValue = val;
      tab.dirty = false;
      this._renderTabs();
      this.updateStatus(true);
      ink.setWindowFile(tab.path, false);
    }
  },

  async save(i) {
    const idx = i === undefined ? this.active : i;
    const tab = this.tabs[idx];
    if (!tab) return false;
    // 实例池：直接从该标签的实例取值（不活跃标签用缓存）
    const live = Editor.getValue(tab.key);
    const val = live === null ? tab.cachedValue : live;

    if (!tab.path) {
      const p = await ink.saveAsDialog(tab.name);
      if (!p) return false;
      const oldKey = tab.key;
      tab.path = p;
      tab.key = p;
      tab.name = P.basename(p);
      Editor.rekey(oldKey, p);
      ink.addRecent(p, 'file');
      FileTree.refresh();
    }
    const r = await ink.writeFile(tab.path, val);
    if (!r.ok) { toast('保存失败：' + (r.error || '')); return false; }
    tab.savedValue = val;
    tab.cachedValue = val;
    tab.dirty = false;
    this._renderTabs();
    this.updateStatus(true);
    ink.setWindowFile(tab.path, false);
    this._persistSession();
    return true;
  },

  async saveAs() {
    const tab = this.activeTab();
    if (!tab) return;
    const p = await ink.saveAsDialog(tab.name);
    if (!p) return;
    const oldKey = tab.key;
    tab.path = p;
    tab.key = p;
    tab.name = P.basename(p);
    Editor.rekey(oldKey, p);
    await this.save();
    ink.addRecent(p, 'file');
    toast('已另存为 ' + P.basename(p));
  },

  /* ================= 文件夹 ================= */
  // 外部拖入的决策入口（原则："打开"优先于"导入"，永远不静默）
  async _handleDropPath(p) {
    const ext = P.extname(p).toLowerCase();
    if (!ext) {
      // 无扩展名：大概率是文件夹 → 打开为文档库
      const r = await ink.readDir(p, {});
      if (r.ok) { await this.openFolder(p); toast('已打开文档库 ' + P.basename(p)); }
      else toast('无法打开 ' + P.basename(p));
    } else if (['.md', '.markdown', '.mdown', '.mdtxt', '.txt'].includes(ext)) {
      await this.openFile(p);
      toast('已打开 ' + P.basename(p));
    } else if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'].includes(ext)) {
      const tab = this.activeTab();
      if (tab && tab.path) {
        const r = await ink.copyImage(p, P.dirname(tab.path));
        if (r.ok) {
          const rel = r.relPath.split('/').map(encodeURIComponent).join('/');
          Editor.insert(`![${P.stem(p)}](${rel})\n`);
        }
      } else {
        toast('请先保存文件，再插入图片');
      }
    } else if (['.pdf', '.bmp'].includes(ext)) {
      this.openPreview(p);
    } else {
      toast('暂不支持的类型：' + ext);
    }
  },

  async openFolderDialog() {
    const dir = await ink.openFolderDialog();
    if (!dir) return;
    await this.openFolder(dir);
  },

  async openFolder(dir) {
    this.folder = dir;
    await FileTree.setRoot(dir);
    ink.addRecent(dir, 'folder');
    this._persistSession();
    this.switchPanel('files');
    if (this.settings.sidebarVisible === false) this.toggleSidebar(true);
    toast('已打开文件夹 ' + P.basename(dir));
  },

  async openPath(p) {
    const st = await ink.stat(p);
    if (!st.ok) { toast('路径不存在'); return; }
    if (st.isDir) await this.openFolder(p);
    else await this.openFile(p);
  },

  /* ================= UI 绑定 ================= */
  _bindUI() {
    // 侧栏切换
    $$('.seg-btn').forEach((b) => {
      b.onclick = () => this.switchPanel(b.dataset.panel);
    });
    $('#btn-new-file').onclick = () => FileTree._inlineCreate(null, false);
    $('#btn-new-folder').onclick = () => FileTree._inlineCreate(null, true);
    $('#btn-refresh').onclick = () => FileTree.refresh();
    $('#btn-collapse').onclick = () => FileTree.toggleCollapse();
    $('#btn-open-folder-empty').onclick = () => this.openFolderDialog();
    $('#btn-sidebar-toggle').onclick = () => this.toggleSidebar();
    this._bindSettings();

    // 欢迎页
    $('#wa-new').onclick = () => this.newUntitled();
    $('#wa-open').onclick = () => this.openFileDialog();
    $('#wa-folder').onclick = () => this.openFolderDialog();
    $('#wa-demo').onclick = (e) => { e.preventDefault(); this.openDemo(); };

    // 状态栏
    $('#st-mode').onclick = () => this.toggleFocus();

    // 侧栏拖拽
    const resizer = $('#sidebar-resizer');
    resizer.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const startX = e.clientX;
      const startW = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--sidebar-w')) || 260;
      const move = (ev) => {
        const w = Math.min(480, Math.max(180, startW + ev.clientX - startX));
        document.documentElement.style.setProperty('--sidebar-w', w + 'px');
      };
      const up = () => {
        document.removeEventListener('mousemove', move);
        document.removeEventListener('mouseup', up);
        const w = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--sidebar-w'));
        this.setSetting({ sidebarWidth: w });
      };
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
    });

    // 快捷键：⌥1..9 切换标签（⌘1..6 留给标题格式，见 vditor 热键与菜单）
    document.addEventListener('keydown', (e) => {
      if (e.altKey && !e.metaKey && !e.ctrlKey && !e.shiftKey && /^Digit[1-9]$/.test(e.code)) {
        const i = parseInt(e.code.slice(5), 10) - 1;
        if (i < this.tabs.length) { e.preventDefault(); this.activate(i); }
      }
      if (e.key === 'Escape' && Overlay.isOpen()) Overlay.close();
    });

    // 拖拽文件进窗口（.md 直接打开；图片插入当前文档）
    // 外部拖入统一在此接管（capture 阶段拦截，防止 vditor 自带的 drop 把文件插进正文）
    window.addEventListener('dragover', (e) => {
      if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) {
        e.preventDefault();
        e.stopPropagation();
      }
    }, true);
    window.addEventListener('drop', async (e) => {
      if (!e.dataTransfer || ![...e.dataTransfer.types].includes('Files')) return;
      e.preventDefault();
      e.stopPropagation();
      const files = Array.from(e.dataTransfer.files || []);
      for (const f of files) {
        const p = ink.getFilePath(f);
        if (p) await this._handleDropPath(p);
      }
    }, true);

    // 模态框关闭
    $$('.modal .modal-mask, .modal [data-close]').forEach((m) => {
      m.addEventListener('click', (e) => e.target.closest('.modal').classList.add('hidden'));
    });

    // 编辑器内右键菜单（页面宽度等）
    $('#editor-hosts').addEventListener('contextmenu', (e) => {
      if (!e.target.closest('.editor-host')) return;
      e.preventDefault();
      e.stopPropagation();
      const w = this.settings.pageWidth || 'normal';
      CtxMenu.show(e.clientX, e.clientY, [
        { label: '加粗', action: () => Editor.command('bold') },
        { label: '斜体', action: () => Editor.command('italic') },
        { label: '行内代码', action: () => Editor.command('inline-code') },
        '-',
        { label: `${w === 'normal' ? '✓ ' : ''}页面宽度：正常`, action: () => this.setPageWidth('normal') },
        { label: `${w === 'wide' ? '✓ ' : ''}页面宽度：超宽`, action: () => this.setPageWidth('wide') },
        '-',
        { label: '导出为 PDF…', action: () => Exporter.exportPdf() },
        { label: '导出为 Word…', action: () => Exporter.exportWord() },
        { label: '导出为图片…', action: () => Exporter.exportImage() },
      ]);
    });
  },

  async openFileDialog() {
    const paths = await ink.openFileDialog();
    for (const p of paths) await this.openFile(p);
  },

  openDemo() {
    this.openFile(P.join(this.samplesDir, '功能演示.md'));
    if (this.settings.sidebarVisible !== false && !this.folder) {
      // 不强制开文件夹，仅打开文件
    }
  },

  // 从文件树插入图片：文档目录内直接用相对路径，外部图片复制进 assets/
  async insertImagePath(p) {
    const tab = this.activeTab();
    if (!tab || !tab.path) { toast('请先保存文件，再插入图片'); return; }
    const dir = P.dirname(tab.path);
    let rel;
    if (p.startsWith(dir + '/')) {
      rel = p.slice(dir.length + 1);
    } else {
      const r = await ink.copyImage(p, dir);
      if (!r.ok) { toast('图片复制失败'); return; }
      rel = r.relPath;
    }
    Editor.insert(`![${P.stem(p)}](${rel.split('/').map(encodeURIComponent).join('/')})\n`);
  },

  switchPanel(name) {
    $$('.seg-btn').forEach((b) => b.classList.toggle('active', b.dataset.panel === name));
    $('#panel-files').classList.toggle('active', name === 'files');
    $('#panel-outline').classList.toggle('active', name === 'outline');
    if (name === 'outline') Outline.render();
    this.setSetting({ sidebarTab: name });
  },

  toggleSidebar(force) {
    const show = force !== undefined ? force : document.body.dataset.sidebar === 'hidden';
    document.body.dataset.sidebar = show ? 'visible' : 'hidden';
    this.setSetting({ sidebarVisible: show });
  },

  toggleFocus(force) {
    const on = force !== undefined ? force : document.body.dataset.focus !== 'on';
    document.body.dataset.focus = on ? 'on' : 'off';
    this.setSetting({ focusMode: on });
    this.updateStatus();
    if (!on) $$('.ink-focus-active').forEach((e) => e.classList.remove('ink-focus-active'));
  },

  toggleTypewriter(force) {
    const on = force !== undefined ? force : !(this.settings.typewriter !== false);
    this.settings.typewriter = on;
    Editor.setTypewriter(on);
    this.setSetting({ typewriter: on });
    toast(on ? '打字机模式已开启' : '打字机模式已关闭');
  },

  toggleToolbar(force) {
    const show = force !== undefined ? force : document.body.dataset.toolbar !== 'show';
    document.body.dataset.toolbar = show ? 'show' : 'hide';
    this.setSetting({ showToolbar: show });
  },

  /* ================= 主题 & 字号 ================= */
  async _applyThemeSetting(mode) {
    let dark;
    if (mode === 'system') dark = await ink.isDark();
    else dark = mode === 'dark';
    document.body.dataset.theme = dark ? 'dark' : 'light';
    if (Editor.ready) Editor.applyTheme(dark);
    this._syncThemeSeg(mode);
  },

  _syncThemeSeg(mode) {
    mode = mode || this.settings.theme || 'system';
    $$('#theme-seg .theme-seg-btn').forEach((b) => b.classList.toggle('active', b.dataset.themeOpt === mode));
    $$('#set-theme button').forEach((b) => b.classList.toggle('active', b.dataset.v === mode));
  },

  setTheme(mode) {
    this.settings.theme = mode;
    this.setSetting({ theme: mode });
    this._applyThemeSetting(mode);
  },

  /* ================= 设置面板 ================= */
  openSettings() {
    const s = this.settings;
    this._syncThemeSeg();
    $$('#set-pagewidth button').forEach((b) => b.classList.toggle('active', b.dataset.v === (s.pageWidth || 'normal')));
    $('#set-fontsize-val').textContent = s.fontSize || 16;
    $('#fs-fill').style.width = (((s.fontSize || 16) - 13) / (24 - 13) * 100) + '%';
    $('#set-focus').checked = !!s.focusMode;
    $('#set-typewriter').checked = s.typewriter !== false;
    $('#set-toolbar').checked = !!s.showToolbar;
    $('#modal-settings').classList.remove('hidden');
  },

  _bindSettings() {
    $('#btn-open-settings').onclick = () => this.openSettings();
    $$('#theme-seg .theme-seg-btn').forEach((b) => {
      b.onclick = () => this.setTheme(b.dataset.themeOpt);
    });
    $$('#set-theme button').forEach((b) => {
      b.onclick = () => this.setTheme(b.dataset.v);
    });
    $$('#set-pagewidth button').forEach((b) => {
      b.onclick = () => { this.setPageWidth(b.dataset.v); this.openSettings(); };
    });
    $('#fs-minus').onclick = () => { this.zoom(-1); this.openSettings(); };
    $('#fs-plus').onclick = () => { this.zoom(1); this.openSettings(); };
    $('#set-focus').onchange = (e) => this.toggleFocus(e.target.checked);
    $('#set-typewriter').onchange = (e) => this.toggleTypewriter(e.target.checked);
    $('#set-toolbar').onchange = (e) => this.toggleToolbar(e.target.checked);
    $('#set-shortcuts-link').onclick = () => {
      $('#modal-settings').classList.add('hidden');
      $('#modal-shortcuts').classList.remove('hidden');
    };
    $('#set-about-link').onclick = () => {
      $('#modal-settings').classList.add('hidden');
      $('#modal-about').classList.remove('hidden');
    };
  },

  systemThemeChanged() {
    if ((this.settings.theme || 'system') === 'system') this._applyThemeSetting('system');
  },

  _applyFontSize(size) {
    document.documentElement.style.setProperty('--editor-font-size', size + 'px');
    this.settings.fontSize = size;
  },

  zoom(delta) {
    let size = this.settings.fontSize || 16;
    size = delta === 0 ? 16 : Math.min(24, Math.max(13, size + delta));
    this._applyFontSize(size);
    this.setSetting({ fontSize: size });
  },

  /* ================= 页面宽度 ================= */
  _applyPageWidth(mode) {
    document.documentElement.style.setProperty('--page-width', mode === 'wide' ? '1120px' : '780px');
    this.settings.pageWidth = mode;
  },

  setPageWidth(mode) {
    this._applyPageWidth(mode);
    this.setSetting({ pageWidth: mode });
    toast(mode === 'wide' ? '已切换为超宽页面' : '已切换为正常页面');
  },

  /* ================= 状态渲染 ================= */
  _renderTabs() {
    const box = $('#tabs');
    box.innerHTML = '';
    this.tabs.forEach((tab, i) => {
      const t = el('div', 'tab' + (i === this.active ? ' active' : '') + (tab.dirty ? ' dirty' : ''));
      t.title = tab.path || tab.name;
      t.appendChild(el('span', 'tab-dirty'));
      t.appendChild(el('span', 'tab-label', tab.name));
      const close = el('button', 'tab-close', '×');
      close.title = '关闭';
      close.onclick = (e) => { e.stopPropagation(); this.closeTab(i); };
      t.appendChild(close);
      t.onclick = () => this.activate(i);
      t.ondblclick = (e) => { e.preventDefault(); this.closeTab(i); }; // 双击关闭
      t.onauxclick = (e) => { if (e.button === 1) this.closeTab(i); }; // 中键关闭
      t.oncontextmenu = (e) => {
        e.preventDefault();
        CtxMenu.show(e.clientX, e.clientY, [
          { label: '关闭', action: () => this.closeTab(i) },
          { label: '关闭其他', action: () => this._closeOthers(i) },
          '-',
          tab.path ? { label: '在 Finder 中显示', action: () => ink.reveal(tab.path) } : { label: '（未保存到磁盘）', action: () => {} },
        ]);
      };
      box.appendChild(t);
    });
  },

  async _closeOthers(keep) {
    for (let i = this.tabs.length - 1; i >= 0; i--) {
      if (i !== keep && !this.tabs[i].dirty) this.tabs.splice(i, 1);
    }
    const tab = this.tabs.find((t, i) => true);
    this.active = 0;
    await this.activate(0);
  },

  updateStatus(saved) {
    const tab = this.activeTab();
    const isPreview = tab && tab.kind === 'preview';
    $('#st-path').textContent = tab ? (tab.path || '未保存') : '';
    $('#st-path').title = tab ? (tab.path || '') : '';
    const save = $('#st-save');
    if (tab) {
      if (isPreview) { save.textContent = '只读预览'; save.className = 'st-item'; }
      else if (tab.dirty) { save.textContent = '● 未保存'; save.className = 'st-item dirty'; }
      else if (saved) { save.textContent = '✓ 已保存'; save.className = 'st-item saved'; }
      else { save.textContent = tab.path ? '已保存' : ''; save.className = 'st-item' + (tab.path ? ' saved' : ''); }
    } else save.textContent = '';

    const s = Editor.ready && tab && !isPreview ? Editor.stats() : { words: 0, minutes: 0 };
    $('#st-words').textContent = tab && !isPreview ? `${formatNumber(s.words)} 字` : '';
    $('#st-time').textContent = tab && !isPreview && s.words > 0 ? `约 ${s.minutes} 分钟` : '';
    $('#st-mode').textContent = document.body.dataset.focus === 'on' ? '专注：开' : '专注：关';
  },

  _syncWelcome() {
    const show = this.tabs.length === 0;
    $('#welcome').classList.toggle('show', show);
    if (show) { this._renderRecent(); this._hidePreview(); }
  },

  async _renderRecent() {
    const recent = await ink.getRecent();
    const box = $('#welcome-recent');
    if (!box) return;
    box.innerHTML = '';
    const all = [
      ...recent.files.slice(0, 5).map((p) => ({ p, type: 'file' })),
      ...recent.folders.slice(0, 2).map((p) => ({ p, type: 'folder' })),
    ];
    if (!all.length) {
      box.appendChild(el('div', 'welcome-recent-empty', '暂无最近文件'));
      return;
    }
    for (const { p, type } of all) {
      const item = el('div', 'welcome-recent-item');
      const ico = el('span', 'ov-ico');
      ico.innerHTML = type === 'folder' ? ICONS.folder : ICONS.file;
      item.appendChild(ico);
      item.appendChild(el('span', 'wri-name', P.basename(p)));
      item.appendChild(el('span', 'wri-path', p));
      item.onclick = () => this.openPath(p);
      box.appendChild(item);
    }
  },

  async _renderWelcome() {
    this._syncWelcome();
  },

  /* ================= 命令列表 ================= */
  commands() {
    return [
      { icon: 'file', title: '新建文件', kbd: '⌘N', run: () => this.newUntitled() },
      { icon: 'file', title: '打开文件…', kbd: '⌘O', run: () => this.openFileDialog() },
      { icon: 'folder', title: '打开文件夹…', kbd: '⇧⌘O', run: () => this.openFolderDialog() },
      { icon: 'cmd', title: '保存', kbd: '⌘S', run: () => this.save() },
      { icon: 'cmd', title: '另存为…', kbd: '⇧⌘S', run: () => this.saveAs() },
      { icon: 'cmd', title: '关闭当前标签页', kbd: '⌘W', run: () => this.closeTab(this.active) },
      { icon: 'search', title: '快速打开文件', kbd: '⌘P', run: () => Overlay.open('quick') },
      { icon: 'cmd', title: '导出为 PDF…', kbd: '⌥⌘P', run: () => Exporter.exportPdf() },
      { icon: 'cmd', title: '导出为 Word…', kbd: '⌥⌘W', run: () => Exporter.exportWord() },
      { icon: 'cmd', title: '导出为图片…', run: () => Exporter.exportImage() },
      { icon: 'cmd', title: '导出为 HTML…', run: () => Exporter.exportHtml() },
      { icon: 'cmd', title: '切换侧边栏', kbd: '⇧⌘L', run: () => this.toggleSidebar() },
      { icon: 'cmd', title: '切换大纲视图', kbd: '⇧⌘J', run: () => { this.toggleSidebar(true); this.switchPanel('outline'); } },
      { icon: 'cmd', title: '显示/隐藏工具栏', run: () => this.toggleToolbar() },
      { icon: 'cmd', title: '专注模式', kbd: '⇧⌘F', run: () => this.toggleFocus() },
      { icon: 'cmd', title: '打字机模式', kbd: '⇧⌘T', run: () => this.toggleTypewriter() },
      { icon: 'cmd', title: '外观：浅色', run: () => this.setTheme('light') },
      { icon: 'cmd', title: '外观：深色', run: () => this.setTheme('dark') },
      { icon: 'cmd', title: '外观：跟随系统', run: () => this.setTheme('system') },
      { icon: 'cmd', title: '页面宽度：正常', run: () => this.setPageWidth('normal') },
      { icon: 'cmd', title: '页面宽度：超宽', run: () => this.setPageWidth('wide') },
      { icon: 'cmd', title: '放大字号', kbd: '⌘=', run: () => this.zoom(1) },
      { icon: 'cmd', title: '缩小字号', kbd: '⌘-', run: () => this.zoom(-1) },
      { icon: 'cmd', title: '重置字号', kbd: '⌥⌘0', run: () => this.zoom(0) },
      { icon: 'cmd', title: '正文', kbd: '⌘0', run: () => Editor.heading(0) },
      { icon: 'cmd', title: '标题 1', kbd: '⌘1', run: () => Editor.heading(1) },
      { icon: 'cmd', title: '标题 2', kbd: '⌘2', run: () => Editor.heading(2) },
      { icon: 'cmd', title: '标题 3', kbd: '⌘3', run: () => Editor.heading(3) },
      { icon: 'cmd', title: '标题 4', kbd: '⌘4', run: () => Editor.heading(4) },
      { icon: 'cmd', title: '标题 5', kbd: '⌘5', run: () => Editor.heading(5) },
      { icon: 'cmd', title: '标题 6', kbd: '⌘6', run: () => Editor.heading(6) },
      { icon: 'cmd', title: '引用', kbd: '⌥⌘Q', run: () => Editor.command('quote') },
      { icon: 'cmd', title: '无序列表', kbd: '⌥⌘U', run: () => Editor.command('list') },
      { icon: 'cmd', title: '有序列表', kbd: '⌥⌘O', run: () => Editor.command('ordered-list') },
      { icon: 'cmd', title: '任务列表', kbd: '⌥⌘X', run: () => Editor.command('check') },
      { icon: 'cmd', title: '插入图片…', kbd: '⌥⌘I', run: () => Editor.insertLocalImages() },
      { icon: 'cmd', title: '插入表格', kbd: '⌥⌘T', run: () => Editor.command('table') },
      { icon: 'cmd', title: '插入代码块', kbd: '⌥⌘C', run: () => Editor.command('code') },
      { icon: 'cmd', title: '插入链接', kbd: '⌘K', run: () => Editor.command('link') },
      { icon: 'cmd', title: '加粗', kbd: '⌘B', run: () => Editor.command('bold') },
      { icon: 'cmd', title: '斜体', kbd: '⌘I', run: () => Editor.command('italic') },
      { icon: 'cmd', title: '删除线', kbd: '⇧⌘X', run: () => Editor.command('strike') },
      { icon: 'cmd', title: '行内代码', kbd: '⌘E', run: () => Editor.command('inline-code') },
      { icon: 'file', title: '打开功能演示文档', run: () => this.openDemo() },
      { icon: 'cmd', title: '键盘快捷键', kbd: '⌘/', run: () => $('#modal-shortcuts').classList.remove('hidden') },
      { icon: 'cmd', title: '打开设置', kbd: '⌘,', run: () => this.openSettings() },
      { icon: 'cmd', title: '关于墨流', run: () => $('#modal-about').classList.remove('hidden') },
    ];
  },

  /* ================= 确认框 ================= */
  _confirm({ title, msg, buttons }) {
    return new Promise((resolve) => {
      const modal = $('#modal-quit');
      $('.modal-title', modal).textContent = title;
      $('#quit-msg').textContent = msg;
      const box = $('.quit-actions', modal);
      box.innerHTML = '';
      buttons.forEach((b) => {
        const btn = el('button', 'btn' + (b.primary ? ' primary' : '') + (b.danger ? ' danger' : ''), b.label);
        btn.onclick = () => { modal.classList.add('hidden'); resolve(b.value); };
        box.appendChild(btn);
      });
      modal.classList.remove('hidden');
    });
  },

  /* ================= 菜单分发 ================= */
  _bindMenu() {
    ink.onMenu(async ({ action, payload }) => {
      switch (action) {
        case 'new-file': this.newUntitled(); break;
        case 'open-file-dialog': this.openFileDialog(); break;
        case 'open-folder-dialog': this.openFolderDialog(); break;
        case 'open-path': this.openPath(payload); break;
        case 'save': this.save(); break;
        case 'save-as': this.saveAs(); break;
        case 'export-pdf': Exporter.exportPdf(); break;
        case 'export-word': Exporter.exportWord(); break;
        case 'export-image': Exporter.exportImage(); break;
        case 'export-html': Exporter.exportHtml(); break;
        case 'close-tab': if (this.active >= 0) this.closeTab(this.active); break;
        case 'close-all-tabs': while (this.tabs.length) await this.closeTab(this.tabs.length - 1, true); break;
        case 'close-overlays': Overlay.close(); $$('.modal').forEach((m) => m.classList.add('hidden')); break;
        case 'format': {
          if (/^h[1-6]$/.test(payload)) Editor.heading(parseInt(payload.slice(1), 10));
          else if (payload === 'paragraph') Editor.heading(0);
          else Editor.command(payload);
          break;
        }
        case 'insert-image': Editor.insertLocalImages(); break;
        case 'quick-open': Overlay.open('quick'); break;
        case 'command-palette': Overlay.open('palette'); break;
        case 'toggle-sidebar': this.toggleSidebar(); break;
        case 'toggle-outline': this.toggleSidebar(true); this.switchPanel('outline'); break;
        case 'toggle-toolbar': this.toggleToolbar(payload); break;
        case 'toggle-focus': this.toggleFocus(payload); break;
        case 'toggle-typewriter': this.toggleTypewriter(payload); break;
        case 'set-theme': this.setTheme(payload); break;
        case 'set-page-width': this.setPageWidth(payload); break;
        case 'system-theme-changed': this.systemThemeChanged(); break;
        case 'zoom': this.zoom(payload); break;
        case 'show-shortcuts': $('#modal-shortcuts').classList.remove('hidden'); break;
        case 'open-demo': this.openDemo(); break;
        case 'open-settings': this.openSettings(); break;
        case 'about': $('#modal-about').classList.remove('hidden'); break;
        case 'recent-changed': this._renderWelcome(); break;
        case 'tree-fs-changed': FileTree.softRefresh(); break;
        case 'try-quit': this._tryQuit(); break;
      }
    });
  },

  async _tryQuit() {
    const dirty = this.tabs.filter((t) => t.dirty);
    if (!dirty.length) {
      this._persistSession();
      ink.confirmClose();
      return;
    }
    const choice = await this._confirm({
      title: '退出墨流',
      msg: `有 ${dirty.length} 个文件包含未保存的更改：${dirty.map((t) => t.name).join('、')}`,
      buttons: [
        { label: '取消', value: 'cancel' },
        { label: '不保存退出', value: 'discard', danger: true },
        { label: '保存并退出', value: 'save', primary: true },
      ],
    });
    if (choice === 'cancel') return;
    if (choice === 'save') {
      for (const tab of dirty) {
        const i = this.tabs.indexOf(tab);
        const ok = await this.save(i);
        if (!ok) return;
      }
    }
    this._persistSession();
    ink.confirmClose();
  },

  /* ================= 工具 ================= */
  setSetting(patch) {
    Object.assign(this.settings, patch);
    ink.setSettings(patch);
  },

  _persistSession() {
    const active = this.activeTab();
    this.setSetting({
      openFolder: this.folder || '',
      // 预览页签是临时视图，不进会话
      openTabs: this.tabs.filter((t) => t.path && t.kind !== 'preview').map((t) => t.path),
      activeTab: (active && active.kind !== 'preview' && active.path) || '',
    });
  },

  handleLinkClick(bom) {
    const href = (bom.getAttribute('href') || '').trim();
    if (!href) return;
    // 页内锚点（[toc] 目录、脚注等）：平滑滚动到对应标题
    if (href.startsWith('#')) {
      this._scrollToAnchor(href);
      return;
    }
    if (/^https?:\/\//i.test(href)) {
      window.open(href);
      return;
    }
    const tab = this.activeTab();
    if (tab && tab.path && /\.(md|markdown|mdown|txt)(#.*)?$/i.test(href)) {
      const abs = P.resolve(P.dirname(tab.path), decodeURIComponent(href.split('#')[0]));
      this.openFile(abs);
    }
  },

  _scrollToAnchor(href) {
    // 归一化：只保留字母与数字，兼容 lute 的 id 生成规则（空格转连字符等）
    const norm = (s) => {
      try { s = decodeURIComponent(s); } catch (e) { /* 保留原样 */ }
      return s.replace(/^#/, '').replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();
    };
    const target = norm(href);
    if (!target) return;
    const host = Editor.activeHost && Editor.activeHost();
    if (!host) return;
    const headings = $$('.vditor-ir h1, .vditor-ir h2, .vditor-ir h3, .vditor-ir h4, .vditor-ir h5, .vditor-ir h6', host);
    const hit = headings.find((h) => {
      const t = norm(h.textContent);
      return t && (t === target || t.includes(target) || target.includes(t));
    });
    if (hit) hit.scrollIntoView({ block: 'start', behavior: 'smooth' });
  },
};

window.addEventListener('DOMContentLoaded', () => App.boot());
