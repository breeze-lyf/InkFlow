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
    this.assetUrl = info.assetUrl;
    this.samplesDir = info.samplesDir;
    this.settings = await ink.getSettings();
    $('#about-ver').textContent = 'v' + info.version;

    CtxMenu.init();
    Overlay.init();
    this._applyThemeSetting(this.settings.theme || 'system');
    this._applyFontSize(this.settings.fontSize || 16);
    document.body.dataset.sidebar = this.settings.sidebarVisible === false ? 'hidden' : 'visible';
    document.body.dataset.focus = this.settings.focusMode ? 'on' : 'off';
    document.body.dataset.toolbar = this.settings.showToolbar ? 'show' : 'hide';
    document.documentElement.style.setProperty('--sidebar-w', (this.settings.sidebarWidth || 260) + 'px');

    await Editor.init();
    Editor.setTypewriter(this.settings.typewriter !== false);
    Outline.bindScroll();

    this._bindUI();
    this._bindMenu();

    // 恢复上次会话
    await this._restoreSession();

    this._renderWelcome();
    ink.ready();
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

    const paths = this.settings.openTabs || [];
    for (const p of paths) {
      if (await ink.exists(p)) await this.openFile(p, true);
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
      path: null,
      name: `未命名-${this.untitledSeq}.md`,
      dirty: false,
      savedValue: '',
      cachedValue: '',
    });
    this.activate(this.tabs.length - 1);
    setTimeout(() => Editor.focus(), 60);
  },

  async activate(i) {
    if (i < 0 || i >= this.tabs.length) return;
    // 暂存当前内容
    const prev = this.activeTab();
    if (prev && Editor.ready) prev.cachedValue = Editor.getValue();

    this.active = i;
    const tab = this.activeTab();
    Editor.setValue(tab.cachedValue);
    tab.dirty = tab.cachedValue !== tab.savedValue;

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
    this.tabs.splice(i, 1);
    if (this.active > i) this.active -= 1;
    if (wasActive) {
      if (this.tabs.length) await this.activate(Math.min(this.active, this.tabs.length - 1));
      else {
        this.active = -1;
        Editor.setValue('');
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
      tab.name = P.basename(to);
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
  onEditorInput() {
    const tab = this.activeTab();
    if (!tab) return;
    const val = Editor.getValue();
    tab.dirty = val !== tab.savedValue;
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
    const val = Editor.getValue();
    const r = await ink.writeFile(tab.path, val);
    if (r.ok) {
      tab.savedValue = val;
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
    let val;
    if (idx === this.active) val = Editor.getValue();
    else val = tab.cachedValue;

    if (!tab.path) {
      const p = await ink.saveAsDialog(tab.name);
      if (!p) return false;
      tab.path = p;
      tab.name = P.basename(p);
      ink.addRecent(p, 'file');
      FileTree.refresh();
    }
    const r = await ink.writeFile(tab.path, val);
    if (!r.ok) { toast('保存失败：' + (r.error || '')); return false; }
    tab.savedValue = val;
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
    tab.path = p;
    tab.name = P.basename(p);
    await this.save();
    ink.addRecent(p, 'file');
    toast('已另存为 ' + P.basename(p));
  },

  /* ================= 文件夹 ================= */
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
    $('#btn-collapse').onclick = () => FileTree.collapseAll();
    $('#btn-open-folder-empty').onclick = () => this.openFolderDialog();

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

    // 快捷键：⌘1..9 切换标签
    document.addEventListener('keydown', (e) => {
      if (e.metaKey && !e.shiftKey && /^[1-9]$/.test(e.key)) {
        const i = parseInt(e.key) - 1;
        if (i < this.tabs.length) { e.preventDefault(); this.activate(i); }
      }
      if (e.key === 'Escape' && Overlay.isOpen()) Overlay.close();
    });

    // 拖拽文件进窗口
    window.addEventListener('dragover', (e) => e.preventDefault());
    window.addEventListener('drop', async (e) => {
      e.preventDefault();
      const files = Array.from(e.dataTransfer.files || []);
      for (const f of files) {
        const p = f.path;
        if (!p) continue;
        const ext = P.extname(p).toLowerCase();
        if (['.md', '.markdown', '.mdown', '.txt'].includes(ext)) {
          await this.openFile(p);
        } else if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'].includes(ext)) {
          const tab = this.activeTab();
          if (tab && tab.path) {
            const r = await ink.copyImage(p, P.dirname(tab.path));
            if (r.ok) {
              const rel = r.relPath.split('/').map(encodeURIComponent).join('/');
              Editor.insert(`![${P.stem(p)}](${rel})\n`);
            }
          }
        }
      }
    });

    // 模态框关闭
    $$('.modal .modal-mask, .modal [data-close]').forEach((m) => {
      m.addEventListener('click', (e) => e.target.closest('.modal').classList.add('hidden'));
    });

    // 编辑器内链接点击拦截（capture 阶段，覆盖 vditor 默认行为）
    $('#vditor').addEventListener('click', (e) => {
      // [toc] 目录项：span[data-target-id] → 滚动到对应标题
      const tocSpan = e.target.closest('[data-target-id]');
      if (tocSpan) {
        e.preventDefault();
        e.stopPropagation();
        const id = tocSpan.getAttribute('data-target-id');
        const target = document.getElementById(id) || $(`.vditor-ir [id="${CSS.escape(id)}"]`);
        if (target) {
          target.scrollIntoView({ block: 'start', behavior: 'smooth' });
        } else {
          this._scrollToAnchor('#' + (tocSpan.textContent || ''));
        }
        return;
      }
      const a = e.target.closest('a');
      if (!a) return;
      e.preventDefault();
      e.stopPropagation();
      this.handleLinkClick(a);
    }, true);
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
  },

  setTheme(mode) {
    this.settings.theme = mode;
    this.setSetting({ theme: mode });
    this._applyThemeSetting(mode);
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
      t.onauxclick = (e) => { if (e.button === 1) this.closeTab(i); };
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
    $('#st-path').textContent = tab ? (tab.path || '未保存') : '';
    $('#st-path').title = tab ? (tab.path || '') : '';
    const save = $('#st-save');
    if (tab) {
      if (tab.dirty) { save.textContent = '● 未保存'; save.className = 'st-item dirty'; }
      else if (saved) { save.textContent = '✓ 已保存'; save.className = 'st-item saved'; }
      else { save.textContent = tab.path ? '已保存' : ''; save.className = 'st-item' + (tab.path ? ' saved' : ''); }
    } else save.textContent = '';

    const s = Editor.ready && tab ? Editor.stats() : { words: 0, minutes: 0 };
    $('#st-words').textContent = tab ? `${formatNumber(s.words)} 字` : '';
    $('#st-time').textContent = tab && s.words > 0 ? `约 ${s.minutes} 分钟` : '';
    $('#st-mode').textContent = document.body.dataset.focus === 'on' ? '专注：开' : '专注：关';
  },

  _syncWelcome() {
    const show = this.tabs.length === 0;
    $('#welcome').classList.toggle('show', show);
    if (show) this._renderRecent();
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
      { icon: 'cmd', title: '导出为 HTML…', run: () => Exporter.exportHtml() },
      { icon: 'cmd', title: '切换侧边栏', kbd: '⇧⌘L', run: () => this.toggleSidebar() },
      { icon: 'cmd', title: '切换大纲视图', kbd: '⇧⌘J', run: () => { this.toggleSidebar(true); this.switchPanel('outline'); } },
      { icon: 'cmd', title: '显示/隐藏工具栏', run: () => this.toggleToolbar() },
      { icon: 'cmd', title: '专注模式', kbd: '⇧⌘F', run: () => this.toggleFocus() },
      { icon: 'cmd', title: '打字机模式', kbd: '⇧⌘T', run: () => this.toggleTypewriter() },
      { icon: 'cmd', title: '外观：浅色', run: () => this.setTheme('light') },
      { icon: 'cmd', title: '外观：深色', run: () => this.setTheme('dark') },
      { icon: 'cmd', title: '外观：跟随系统', run: () => this.setTheme('system') },
      { icon: 'cmd', title: '放大字号', kbd: '⌘=', run: () => this.zoom(1) },
      { icon: 'cmd', title: '缩小字号', kbd: '⌘-', run: () => this.zoom(-1) },
      { icon: 'cmd', title: '重置字号', kbd: '⌘0', run: () => this.zoom(0) },
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
        case 'export-html': Exporter.exportHtml(); break;
        case 'close-tab': if (this.active >= 0) this.closeTab(this.active); break;
        case 'close-all-tabs': while (this.tabs.length) await this.closeTab(this.tabs.length - 1, true); break;
        case 'close-overlays': Overlay.close(); $$('.modal').forEach((m) => m.classList.add('hidden')); break;
        case 'format': Editor.command(payload); break;
        case 'insert-image': Editor.insertLocalImages(); break;
        case 'quick-open': Overlay.open('quick'); break;
        case 'command-palette': Overlay.open('palette'); break;
        case 'toggle-sidebar': this.toggleSidebar(); break;
        case 'toggle-outline': this.toggleSidebar(true); this.switchPanel('outline'); break;
        case 'toggle-toolbar': this.toggleToolbar(payload); break;
        case 'toggle-focus': this.toggleFocus(payload); break;
        case 'toggle-typewriter': this.toggleTypewriter(payload); break;
        case 'set-theme': this.setTheme(payload); break;
        case 'system-theme-changed': this.systemThemeChanged(); break;
        case 'zoom': this.zoom(payload); break;
        case 'show-shortcuts': $('#modal-shortcuts').classList.remove('hidden'); break;
        case 'open-demo': this.openDemo(); break;
        case 'open-settings': Overlay.open('palette'); break;
        case 'about': $('#modal-about').classList.remove('hidden'); break;
        case 'recent-changed': this._renderWelcome(); break;
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
    this.setSetting({
      openFolder: this.folder || '',
      openTabs: this.tabs.filter((t) => t.path).map((t) => t.path),
      activeTab: (this.activeTab() && this.activeTab().path) || '',
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
    const headings = $$('.vditor-ir h1, .vditor-ir h2, .vditor-ir h3, .vditor-ir h4, .vditor-ir h5, .vditor-ir h6');
    const hit = headings.find((h) => {
      const t = norm(h.textContent);
      return t && (t === target || t.includes(target) || target.includes(t));
    });
    if (hit) hit.scrollIntoView({ block: 'start', behavior: 'smooth' });
  },
};

window.addEventListener('DOMContentLoaded', () => App.boot());
