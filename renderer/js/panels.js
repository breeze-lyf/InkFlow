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
    const active = App.activeTab && App.activeTab();
    if (active && active.path && this._pathWithinRoot(active.path)) await this.reveal(active.path);
  },

  _samePath(left, right) {
    if (!left || !right) return false;
    if (typeof App._samePath === 'function') return App._samePath(left, right);
    const normalize = (value) => P.normalize ? P.normalize(value) : String(value).replace(/\\/g, '/');
    return normalize(left) === normalize(right);
  },

  _pathWithinRoot(path) {
    if (!this.root || !path) return false;
    if (typeof App._pathWithin === 'function') return App._pathWithin(path, this.root);
    const normalize = (value) => (P.normalize ? P.normalize(value) : String(value).replace(/\\/g, '/')).replace(/\/+$/, '');
    const root = normalize(this.root);
    const target = normalize(path);
    return target === root || target.startsWith(root + '/');
  },

  _rowForPath(path) {
    if (!path) return null;
    return $$('.tree-row[data-path]').find((row) => this._samePath(row.dataset.path, path)) || null;
  },

  async loadDir(dir) {
    if (this.cache.has(dir)) return this.cache.get(dir);
    const r = await ink.readDir(dir, { sort: App.settings.fileSortMode || 'name' });
    const entries = r.ok ? r.entries : [];
    this.cache.set(dir, entries);
    return entries;
  },

  async render() {
    const box = $('#file-tree');
    box.innerHTML = '';
    $('#tree-empty').classList.toggle('show', !this.root);
    if (!this.root) return;
    // 空白区域作为"移到根目录"的投放点 + 右键菜单（只绑一次）
    if (!box._dropBound) {
      box._dropBound = true;
      box.oncontextmenu = (e) => {
        if (e.target.closest('.tree-row')) return; // 行上的右键走行菜单
        e.preventDefault();
        this._blankCtxMenu(e.clientX, e.clientY);
      };
      box.ondragover = (e) => {
        if (!e.dataTransfer.types.includes('text/inkflow-path')) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        box.classList.add('drop-root');
      };
      box.ondragleave = (e) => { if (e.target === box) box.classList.remove('drop-root'); };
      box.ondrop = (e) => {
        e.preventDefault();
        box.classList.remove('drop-root');
        const src = e.dataTransfer.getData('text/inkflow-path');
        if (src && this.root) this._moveTo(src, this.root);
      };
    }
    const frag = document.createDocumentFragment();
    await this._renderDir(this.root, frag, 0);
    box.appendChild(frag);
    this.markActive();
    this.markSelected();
    this._syncCollapseIcon();
  },

  // 把文件/文件夹移动到目标目录（拖拽移动的核心）
  async _moveTo(src, destDir) {
    if (!src || !destDir || src === destDir) return;
    if (P.dirname(src) === destDir) return; // 已在该目录
    if (destDir === src || destDir.startsWith(src + '/')) { toast('不能移动到自身内部'); return; }
    const dest = P.join(destDir, P.basename(src));
    const r = await ink.rename(src, dest);
    if (!r.ok) { toast(r.error || '移动失败'); return; }
    this.cache.delete(P.dirname(src));
    this.cache.delete(destDir);
    this.expanded.add(destDir);
    await App.onPathRenamed(src, dest);
    this.selected = dest;
    await this.render();
    const row = $(`.tree-row[data-path="${CSS.escape(dest)}"]`);
    if (row) row.scrollIntoView({ block: 'nearest' });
    const isDir = $(`.tree-row[data-path="${CSS.escape(dest)}"]`)?.dataset.isDir === '1';
    if (!isDir) App.openFile(dest);
    toast('已移动');
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

      // 拖拽移动：拖到文件夹上 = 移入该目录
      row.draggable = true;
      row.ondragstart = (e) => {
        e.stopPropagation();
        e.dataTransfer.setData('text/inkflow-path', entry.path);
        e.dataTransfer.effectAllowed = 'move';
      };
      if (entry.isDir) {
        row.ondragover = (e) => {
          if (!e.dataTransfer.types.includes('text/inkflow-path')) return;
          e.preventDefault();
          e.stopPropagation();
          e.dataTransfer.dropEffect = 'move';
          row.classList.add('drop-target');
        };
        row.ondragleave = () => row.classList.remove('drop-target');
        row.ondrop = (e) => {
          e.preventDefault();
          e.stopPropagation();
          row.classList.remove('drop-target');
          const src = e.dataTransfer.getData('text/inkflow-path');
          if (src) this._moveTo(src, entry.path);
        };
      }

      row.onclick = (e) => {
        e.stopPropagation();
        this.select(entry.path);
        // 双击会派发两次 click：第二次起忽略。
        // 文件夹防"展开又收起"；图片防"插入两份"；文件打开本身幂等
        if (entry.isDir) {
          if (e.detail > 1) return;
          this.toggleDir(node, entry, depth);
        } else if (entry.isImage || entry.isPreview) {
          // 图片/PDF 等：右侧只读页签预览（不再自动插入到文档）
          if (e.detail === 1) App.openPreview(entry.path);
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
        // 图片双击容易误触，不进入重命名（重命名走右键菜单）
        if (!entry.isDir && !entry.isImage) this._inlineRename(row, entry);
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
    this.markActive();
    this._syncCollapseIcon();
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

  // 空白区域右键：新建 + 排序方式
  _blankCtxMenu(x, y) {
    const mode = App.settings.fileSortMode || 'name';
    CtxMenu.show(x, y, [
      { label: '新建文件', action: () => this._inlineCreate(null, false) },
      { label: '新建文件夹', action: () => this._inlineCreate(null, true) },
      '-',
      { label: (mode === 'name' ? '✓ ' : '　') + '按名称排序', action: () => this._setSortMode('name') },
      { label: (mode === 'mtime' ? '✓ ' : '　') + '按修改时间排序', action: () => this._setSortMode('mtime') },
    ]);
  },

  _setSortMode(mode) {
    App.settings.fileSortMode = mode;
    App.setSetting({ fileSortMode: mode });
    this.cache.clear();
    this.render();
    toast(mode === 'mtime' ? '已按修改时间排序' : '已按名称排序');
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
        await App.onPathRenamed(entry.path, to);
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
    const target = typeof App._pathKey === 'function'
      ? App._pathKey(entry.path)
      : (P.normalize ? P.normalize(entry.path) : entry.path);
    const affected = App.tabs.filter((tab) => {
      if (!tab.path) return false;
      const tabPath = typeof App._pathKey === 'function'
        ? App._pathKey(tab.path)
        : (P.normalize ? P.normalize(tab.path) : tab.path);
      return tabPath === target || (entry.isDir && tabPath.startsWith(target + '/'));
    });
    const dirty = affected.filter((tab) => tab.dirty && tab.kind !== 'preview');
    let dirtyChoice = 'none';
    if (dirty.length) {
      const choice = await App._confirm({
        title: entry.isDir ? '删除文件夹' : '删除文件',
        msg: entry.isDir
          ? `该文件夹中有 ${dirty.length} 个打开的文稿尚未保存，是否先保存再移到废纸篓？`
          : `“${entry.name}”有未保存的更改，是否先保存再移到废纸篓？`,
        buttons: [
          { label: '取消', value: 'cancel' },
          { label: '不保存并删除', value: 'discard', danger: true },
          { label: dirty.length > 1 ? '全部保存后删除' : '保存后删除', value: 'save', primary: true },
        ],
      });
      if (choice === 'cancel') return false;
      dirtyChoice = choice;
      if (choice === 'save') {
        for (const tab of dirty) {
          const index = App.tabs.indexOf(tab);
          if (index >= 0 && !(await App.save(index))) return false;
          if (!App.tabs.includes(tab) || tab.dirty || tab.conflict) return false;
        }
      }
    }

    const valueOf = (tab) => typeof App._tabValue === 'function' ? App._tabValue(tab) : tab.cachedValue;
    const deleteSnapshot = new Map(affected.map((tab) => [tab, valueOf(tab)]));

    // 先冻结并等完在途写入，避免自动保存把刚移走的文件重新创建出来。
    if (typeof App._suspendTabWrites === 'function') {
      for (const tab of affected) await App._suspendTabWrites(tab);
    }
    const changedAfterConfirm = affected.some((tab) => !App.tabs.includes(tab)
      || valueOf(tab) !== deleteSnapshot.get(tab));
    const saveDidNotFinish = dirtyChoice === 'save' && affected.some((tab) => tab.dirty || tab.conflict);
    if (changedAfterConfirm || saveDidNotFinish) {
      if (typeof App._resumeTabWrites === 'function') affected.forEach((tab) => App._resumeTabWrites(tab));
      toast('删除已取消：确认后文稿又有新的修改');
      return false;
    }

    // 先移入废纸篓，成功后才强制关闭页签并清 recovery；失败时编辑现场完整保留。
    const r = await ink.trash(entry.path);
    if (r.ok) {
      const changedDuringTrash = affected.some((tab) => !App.tabs.includes(tab)
        || valueOf(tab) !== deleteSnapshot.get(tab));
      if (changedDuringTrash) {
        for (const tab of affected) {
          if (!App.tabs.includes(tab)) continue;
          tab.cachedValue = valueOf(tab);
          if (typeof App._markExternalConflict === 'function') App._markExternalConflict(tab, 'deleted', null);
          if (typeof App._resumeTabWrites === 'function') App._resumeTabWrites(tab);
        }
        this.cache.delete(P.dirname(entry.path));
        await this.render();
        toast('文件已移到废纸篓，但删除期间出现了新的修改；新内容已保留在页签中');
        return false;
      }
      let tabsClosed = true;
      for (const tab of affected) {
        if (!(await App.closeTabByPath(tab.path, true))) tabsClosed = false;
      }
      this.cache.delete(P.dirname(entry.path));
      await this.render();
      if (!tabsClosed) {
        for (const tab of affected) {
          if (!App.tabs.includes(tab)) continue;
          if (typeof App._markExternalConflict === 'function') App._markExternalConflict(tab, 'deleted', null);
          if (typeof App._resumeTabWrites === 'function') App._resumeTabWrites(tab);
        }
        toast('文件已移到废纸篓，但恢复记录清理失败；相关页签已保留');
        return false;
      }
      toast('已移到废纸篓');
      return true;
    } else {
      if (typeof App._resumeTabWrites === 'function') {
        affected.forEach((tab) => App._resumeTabWrites(tab));
      }
      toast('删除失败：' + (r.error || ''));
      return false;
    }
  },

  markActive(path) {
    const p = path !== undefined ? path : (App.activeTab() && App.activeTab().path);
    $$('.tree-row.active').forEach((row) => {
      row.classList.remove('active');
      row.removeAttribute('aria-current');
    });
    if (!p) return;
    const row = this._rowForPath(p);
    if (row) {
      row.classList.add('active');
      row.setAttribute('aria-current', 'page');
    }
  },

  async reveal(path) {
    if (!this._pathWithinRoot(path)) return false;
    // 展开所有祖先目录
    let dir = P.dirname(path);
    const chain = [];
    while (dir && dir.length >= this.root.length && dir !== this.root) {
      chain.unshift(dir);
      dir = P.dirname(dir);
    }
    chain.forEach((d) => this.expanded.add(d));
    await this.render();
    const row = this._rowForPath(path);
    if (row) row.scrollIntoView({ block: 'center' });
    return !!row;
  },

  async refresh() {
    this.cache.clear();
    await this.render();
  },

  // 文件系统外部变化触发的无感刷新（行内编辑期间让路，不打断输入）
  // 自动保存每几秒就会触发 watcher —— 只有条目真的变了才重建 DOM，否则零打扰
  async softRefresh() {
    if (this._editing || !this.root) return;
    const key = (e) => `${e.path}|${e.isDir ? 1 : 0}`;
    let changed = false;
    for (const [dir, oldEntries] of [...this.cache]) {
      const r = await ink.readDir(dir, { sort: App.settings.fileSortMode || 'name' });
      const fresh = r.ok ? r.entries : [];
      const same = fresh.length === oldEntries.length
        && fresh.every((e, i) => key(e) === key(oldEntries[i]));
      if (!same) {
        this.cache.set(dir, fresh);
        changed = true;
      }
    }
    if (changed) await this.render();
  },

  collapseAll() {
    this.expanded = new Set(this.root ? [this.root] : []);
    this.render();
  },

  // 折叠/展开双态切换（按钮行为随当前状态取反）
  async toggleCollapse() {
    const hasOpen = [...this.expanded].some((p) => p !== this.root);
    if (hasOpen) this.collapseAll();
    else await this.expandAll();
  },

  // 全部展开（渐进加载，大库也不至于一次打满）
  async expandAll() {
    if (!this.root) return;
    const walk = async (dir) => {
      this.expanded.add(dir);
      const entries = this.cache.get(dir) || await this.loadDir(dir);
      for (const e of entries) {
        if (e.isDir) await walk(e.path);
      }
    };
    await walk(this.root);
    await this.render();
  },

  // 折叠/展开按钮双态图标同步
  _syncCollapseIcon() {
    const btn = $('#btn-collapse');
    if (!btn) return;
    const hasOpen = [...this.expanded].some((p) => p !== this.root);
    btn.innerHTML = hasOpen ? ICONS.collapseAll : ICONS.expandAll;
    btn.title = hasOpen ? '全部折叠' : '全部展开';
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

if (typeof module === 'object' && module.exports) module.exports = { FileTree, Outline, CtxMenu };
