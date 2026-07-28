// ============ 侧栏面板：文件树 + 大纲 + 右键菜单 ============
'use strict';

/* ---------- 通用右键菜单 ---------- */
const CtxMenu = {
  el: null,
  init() {
    this.el = $('#ctx-menu');
    document.addEventListener('click', () => this.hide());
    document.addEventListener('contextmenu', (e) => {
      if (!e.target.closest('.tree-row') && !e.target.closest('.tab') && !e.target.closest('.editor-host')) this.hide();
    });
    window.addEventListener('blur', () => this.hide());
  },
  show(x, y, items) {
    this.el.innerHTML = '';
    for (const item of items) {
      if (item === '-') {
        this.el.appendChild(el('div', 'ctx-sep'));
        continue;
      }
      const row = el('div', 'ctx-item' + (item.danger ? ' danger' : ''), item.label);
      row.onclick = () => { this.hide(); item.action(); };
      this.el.appendChild(row);
    }
    this.el.classList.remove('hidden');
    const rect = this.el.getBoundingClientRect();
    const nx = Math.min(x, window.innerWidth - rect.width - 8);
    const ny = Math.min(y, window.innerHeight - rect.height - 8);
    this.el.style.left = nx + 'px';
    this.el.style.top = ny + 'px';
  },
  hide() { this.el.classList.add('hidden'); },
};

/* ---------- 文件树 ---------- */
const FileTree = {
  root: null,
  expanded: new Set(),
  cache: new Map(),
  selected: null,   // 当前选中的条目路径（新建文件/文件夹落在它下面）
  _editing: false,  // 行内命名/重命名进行中（此时外部刷新让路）

  async setRoot(dir) {
    this.root = dir;
    this.expanded = new Set([dir]);
    this.selected = dir;
    this.cache.clear();
    await this.render();
    $('#lib-name').textContent = dir ? P.basename(dir) : '未打开文件夹';
    $('#lib-name').title = dir || '';
  },

  async loadDir(dir) {
    if (this.cache.has(dir)) return this.cache.get(dir);
    const r = await ink.readDir(dir);
    const entries = r.ok ? r.entries : [];
    this.cache.set(dir, entries);
    return entries;
  },

  async render() {
    const box = $('#file-tree');
    box.innerHTML = '';
    $('#tree-empty').classList.toggle('show', !this.root);
    if (!this.root) return;
    const frag = document.createDocumentFragment();
    await this._renderDir(this.root, frag, 0);
    box.appendChild(frag);
    this.markActive();
    this.markSelected();
  },

  markSelected() {
    $$('.tree-row.selected').forEach((r) => r.classList.remove('selected'));
    if (!this.selected) return;
    const row = $(`.tree-row[data-path="${CSS.escape(this.selected)}"]`);
    if (row) row.classList.add('selected');
  },

  select(path) {
    this.selected = path;
    this.markSelected();
  },

  async _renderDir(dir, parentEl, depth) {
    const entries = await this.loadDir(dir);
    for (const entry of entries) {
      const node = el('div', 'tree-node' + (entry.isDir && this.expanded.has(entry.path) ? ' open' : ''));
      const row = el('div', 'tree-row');
      row.style.paddingLeft = (depth * 14 + 8) + 'px';
      row.dataset.path = entry.path;
      row.dataset.isDir = entry.isDir ? '1' : '';

      const caret = el('span', 'tree-caret' + (entry.isDir ? '' : ' leaf'));
      caret.innerHTML = ICONS.caret;
      const ico = el('span', 'tree-ico');
      ico.innerHTML = entry.isDir ? ICONS.folder : ICONS.file;
      const label = el('span', 'tree-label', entry.name);

      row.appendChild(caret);
      row.appendChild(ico);
      row.appendChild(label);
      node.appendChild(row);
      parentEl.appendChild(node);

      row.onclick = (e) => {
        e.stopPropagation();
        this.select(entry.path);
        // 双击文件夹时浏览器会派发两次 click：第二次起忽略，避免"展开又收起=没反应"
        if (entry.isDir) {
          if (e.detail > 1) return;
          this.toggleDir(node, entry, depth);
        } else if (entry.isImage) {
          App.insertImagePath(entry.path);
        } else {
          App.openFile(entry.path);
        }
      };
      row.oncontextmenu = (e) => {
        e.preventDefault();
        e.stopPropagation();
        this._ctxMenu(e.clientX, e.clientY, entry);
      };
      row.ondblclick = (e) => {
        e.stopPropagation();
        e.preventDefault();
        if (!entry.isDir) this._inlineRename(row, entry);
      };

      if (entry.isDir && this.expanded.has(entry.path)) {
        const children = el('div', 'tree-children');
        node.appendChild(children);
        await this._renderDir(entry.path, children, depth + 1);
      }
    }
  },

  async toggleDir(node, entry, depth) {
    if (this.expanded.has(entry.path)) {
      this.expanded.delete(entry.path);
      node.classList.remove('open');
      const ch = $('.tree-children', node);
      if (ch) ch.remove();
    } else {
      this.expanded.add(entry.path);
      node.classList.add('open');
      const children = el('div', 'tree-children');
      node.appendChild(children);
      await this._renderDir(entry.path, children, depth + 1);
    }
  },

  _ctxMenu(x, y, entry) {
    const items = [
      { label: '新建文件', action: () => this._inlineCreate(entry, false) },
      { label: '新建文件夹', action: () => this._inlineCreate(entry, true) },
      '-',
      { label: '重命名', action: () => this._inlineRename(null, entry) },
      { label: '在 Finder 中显示', action: () => ink.reveal(entry.path) },
      '-',
      { label: entry.isDir ? '删除文件夹' : '删除文件', danger: true, action: () => this._delete(entry) },
    ];
    CtxMenu.show(x, y, items);
  },

  _targetDir(entry) {
    // 优先右键目标；否则跟随当前选中项：选中目录→其内，选中文件→其父目录，兜底根目录
    if (entry) return entry.isDir ? entry.path : P.dirname(entry.path);
    const base = this.selected || this.root;
    if (!base || base === this.root) return this.root;
    const row = $(`.tree-row[data-path="${CSS.escape(base)}"]`);
    if (row && row.dataset.isDir === '1') return base;
    return P.dirname(base);
  },

  async _inlineCreate(entry, isDir) {
    const parent = this._targetDir(entry);
    if (!parent) { toast('请先打开文件夹'); return; }
    if (!this.expanded.has(parent)) this.expanded.add(parent);
    await this.render();
    // 在目标目录行后插入输入行
    // 输入行插入到目标目录的子容器内（就地展开，所见即所得）
    const parentRow = $(`.tree-row[data-path="${CSS.escape(parent)}"]`);
    const parentNode = parentRow && parentRow.parentElement;
    let kids = parentNode && $('.tree-children', parentNode);
    if (parentNode && !kids) {
      kids = el('div', 'tree-children');
      parentNode.appendChild(kids);
      parentNode.classList.add('open');
    }
    const node = el('div', 'tree-node');
    const row = el('div', 'tree-row');
    const depth = parentRow ? parseInt(parentRow.style.paddingLeft) / 14 + 1 : 0;
    row.style.paddingLeft = (depth * 14 + 24) + 'px';
    const input = el('input', 'tree-rename-input');
    input.value = isDir ? '未命名文件夹' : '未命名.md';
    input.spellcheck = false;
    row.appendChild(input);
    node.appendChild(row);
    if (kids) kids.prepend(node);
    else $('#file-tree').prepend(node);
    input.focus();
    input.select();
    const done = async (commit) => {
      const name = input.value.trim();
      node.remove();
      if (!commit || !name) { this._editing = false; return; }
      const finalName = isDir || P.extname(name) ? name : name + '.md';
      const r = await ink.create(parent, finalName, isDir);
      if (r.ok) {
        // 关键：让父目录缓存失效，否则 render 用旧数据（表现为"创建了却看不到"）
        this.cache.delete(parent);
        this.expanded.add(parent);
        await this.render();
        this.select(r.path);
        if (!isDir) App.openFile(r.path);
        toast(isDir ? '文件夹已创建' : '文件已创建');
      } else {
        toast(r.error || '创建失败');
      }
      this._editing = false;
    };
    input.onkeydown = (e) => {
      if (e.key === 'Enter') done(true);
      if (e.key === 'Escape') done(false);
      e.stopPropagation();
    };
    input.onblur = () => done(true);
    this._editing = true;
  },

  _inlineRename(row, entry) {
    row = row || $(`.tree-row[data-path="${CSS.escape(entry.path)}"]`);
    if (!row) return;
    const label = $('.tree-label', row);
    const oldName = entry.name;
    const input = el('input', 'tree-rename-input');
    input.value = oldName;
    input.spellcheck = false;
    label.replaceWith(input);
    input.focus();
    const stem = P.stem(oldName);
    input.setSelectionRange(0, stem.length);
    const done = async (commit) => {
      const name = input.value.trim();
      this._editing = false;
      if (!commit || !name || name === oldName) { await this.render(); return; }
      const to = P.join(P.dirname(entry.path), name);
      const r = await ink.rename(entry.path, to);
      this.cache.delete(P.dirname(entry.path));
      if (r.ok) {
        App.onPathRenamed(entry.path, to);
        this.selected = to;
        await this.render();
        toast('已重命名');
      } else {
        toast(r.error || '重命名失败');
        await this.render();
      }
    };
    input.onkeydown = (e) => {
      if (e.key === 'Enter') done(true);
      if (e.key === 'Escape') done(false);
      e.stopPropagation();
    };
    input.onblur = () => done(true);
    this._editing = true;
  },

  async _delete(entry) {
    // 关闭打开的标签
    if (!entry.isDir) App.closeTabByPath(entry.path, true);
    const r = await ink.trash(entry.path);
    if (r.ok) {
      this.cache.delete(P.dirname(entry.path));
      await this.render();
      toast('已移到废纸篓');
    } else {
      toast('删除失败：' + (r.error || ''));
    }
  },

  markActive(path) {
    const p = path !== undefined ? path : (App.activeTab() && App.activeTab().path);
    $$('.tree-row.active').forEach((r) => r.classList.remove('active'));
    if (!p) return;
    const row = $(`.tree-row[data-path="${CSS.escape(p)}"]`);
    if (row) row.classList.add('active');
  },

  async reveal(path) {
    if (!this.root || !path.startsWith(this.root)) return;
    // 展开所有祖先目录
    let dir = P.dirname(path);
    const chain = [];
    while (dir && dir.length >= this.root.length && dir !== this.root) {
      chain.unshift(dir);
      dir = P.dirname(dir);
    }
    chain.forEach((d) => this.expanded.add(d));
    await this.render();
    const row = $(`.tree-row[data-path="${CSS.escape(path)}"]`);
    if (row) row.scrollIntoView({ block: 'center' });
  },

  async refresh() {
    this.cache.clear();
    await this.render();
  },

  // 文件系统外部变化触发的无感刷新（行内编辑期间让路，不打断输入）
  async softRefresh() {
    if (this._editing || !this.root) return;
    this.cache.clear();
    await this.render();
  },

  collapseAll() {
    this.expanded = new Set(this.root ? [this.root] : []);
    this.render();
  },
};

/* ---------- 大纲 ---------- */
const Outline = {
  items: [],

  parse(md) {
    const items = [];
    let inCode = false;
    for (const line of md.split('\n')) {
      if (/^\s*```/.test(line)) { inCode = !inCode; continue; }
      if (inCode) continue;
      const m = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
      if (m) items.push({ level: m[1].length, text: m[2].replace(/[*_`~\[\]]/g, '') });
    }
    return items;
  },

  render() {
    const md = Editor.ready ? Editor.getValue() : '';
    this.items = this.parse(md);
    const box = $('#outline-list');
    box.innerHTML = '';
    $('#outline-empty').classList.toggle('show', this.items.length === 0);
    const minLv = this.items.reduce((a, b) => Math.min(a, b.level), 6);
    this.items.forEach((h, i) => {
      const item = el('div', `outline-item lv${h.level}`, h.text);
      item.style.paddingLeft = (10 + (h.level - minLv) * 14) + 'px';
      item.onclick = () => this.jump(i);
      box.appendChild(item);
    });
    this.trackActive();
  },

  headingEls() {
    const host = Editor.activeHost && Editor.activeHost();
    if (!host) return [];
    const ir = $('.vditor-ir', host);
    return ir ? $$('h1,h2,h3,h4,h5,h6', ir) : [];
  },

  jump(index) {
    const els = this.headingEls();
    const target = els[index];
    if (target) {
      target.scrollIntoView({ block: 'start', behavior: 'smooth' });
      Editor.focus();
    }
  },

  trackActive: throttle(function () {
    const els = this.headingEls();
    if (!els.length) return;
    const host = Editor.activeHost && Editor.activeHost();
    const scroller = host ? ($('.vditor-ir > .vditor-reset', host) || $('.vditor-ir', host)) : null;
    const top = scroller ? scroller.getBoundingClientRect().top : 0;
    let active = 0;
    els.forEach((h, i) => {
      if (h.getBoundingClientRect().top - top < 120) active = i;
    });
    $$('.outline-item').forEach((item, i) => item.classList.toggle('active', i === active));
  }, 120),

  // 每个编辑器实例创建时绑定自己的滚动监听
  bindScroll(host) {
    const scroller = $('.vditor-ir > .vditor-reset', host) || $('.vditor-ir', host);
    if (scroller) scroller.addEventListener('scroll', () => this.trackActive(), { passive: true });
  },
};
