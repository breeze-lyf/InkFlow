// ============ 命令面板 & 快速打开 ============
'use strict';

const Overlay = {
  mode: null,        // 'palette' | 'quick'
  items: [],
  filtered: [],
  selected: 0,
  _fileCache: null,
  _requestSeq: 0,

  init() {
    $('#overlay-mask').addEventListener('click', () => this.close());
    $('#overlay-input').addEventListener('input', () => this._filter());
    $('#overlay-input').addEventListener('keydown', (e) => this._keydown(e));
  },

  async open(mode) {
    const requestSeq = ++this._requestSeq;
    this.mode = mode;
    const overlay = $('#overlay');
    const input = $('#overlay-input');
    overlay.classList.remove('hidden');
    input.value = '';
    input.placeholder = mode === 'palette'
      ? '输入命令…'
      : (App.folder ? '输入文件名快速跳转…' : '搜索最近文件，或打开新文件…');

    if (mode === 'quick') {
      const [folderFiles, recent] = await Promise.all([
        App.folder
          ? Promise.resolve().then(() => ink.walkMd(App.folder)).catch(() => [])
          : Promise.resolve([]),
        Promise.resolve().then(() => ink.getRecent()).catch(() => []),
      ]);
      if (!this._isCurrentRequest(requestSeq, mode, overlay)) return false;
      this._fileCache = folderFiles;
      this.items = QuickOpen.buildItems({
        folderFiles,
        recentFiles: recent && Array.isArray(recent.files) ? recent.files : [],
        openFile: (path) => App.openFile(path),
        openFileDialog: () => App.openFileDialog(),
        openFolderDialog: () => App.openFolderDialog(),
      });
    } else {
      this.items = App.commands();
    }
    if (!this._isCurrentRequest(requestSeq, mode, overlay)) return false;
    this._filter();
    setTimeout(() => {
      if (this._isCurrentRequest(requestSeq, mode, overlay)) input.focus();
    }, 30);
    return true;
  },

  close() {
    this._requestSeq += 1;
    $('#overlay').classList.add('hidden');
    this.mode = null;
    Editor.ready && App.activeTab() && Editor.focus();
  },

  isOpen() { return this.mode !== null; },

  _isCurrentRequest(requestSeq, mode, overlay) {
    return requestSeq === this._requestSeq
      && this.mode === mode
      && !overlay.classList.contains('hidden');
  },

  _filter() {
    const q = $('#overlay-input').value.trim();
    if (!q) {
      this.filtered = this.items.map((it) => ({ it, score: 0, ranges: [] }));
    } else {
      this.filtered = [];
      for (const it of this.items) {
        const target = it.type === 'file' ? it.title + ' ' + it.sub : it.title + ' ' + (it.key || '');
        const m = fuzzyMatch(q, target);
        if (m) this.filtered.push({ it, score: m.score, ranges: m.ranges });
      }
      this.filtered.sort((a, b) => b.score - a.score);
    }
    this.filtered = this.filtered.slice(0, 60);
    this.selected = 0;
    this._render();
  },

  _render() {
    const box = $('#overlay-list');
    box.innerHTML = '';
    if (!this.filtered.length) {
      box.appendChild(el('div', 'ov-empty', '没有匹配结果'));
      return;
    }
    const q = $('#overlay-input').value.trim();
    this.filtered.forEach(({ it }, i) => {
      const row = el('div', 'ov-item' + (i === this.selected ? ' selected' : ''));
      const ico = el('span', 'ov-ico');
      ico.innerHTML = ICONS[it.icon] || ICONS.cmd;
      const main = el('div', 'ov-main');
      const title = el('div', 'ov-title');
      const target = it.type === 'file' && q ? it.title + ' ' + it.sub : it.title;
      if (q) {
        const m = fuzzyMatch(q, it.type === 'file' ? it.title : target);
        title.innerHTML = highlightRanges(it.title, m ? m.ranges : []);
      } else {
        title.textContent = it.title;
      }
      main.appendChild(title);
      if (it.sub) main.appendChild(el('div', 'ov-sub', it.sub));
      row.appendChild(ico);
      row.appendChild(main);
      if (it.kbd) {
        const k = el('span', 'ov-kbd');
        k.innerHTML = `<kbd>${fmtKbd(it.kbd, App.isMac)}</kbd>`;
        row.appendChild(k);
      }
      row.onclick = () => this._run(i);
      row.onmousemove = () => {
        if (this.selected !== i) {
          this.selected = i;
          $$('.ov-item', box).forEach((r, j) => r.classList.toggle('selected', j === i));
        }
      };
      box.appendChild(row);
    });
  },

  _keydown(e) {
    if (e.key === 'ArrowDown' || (e.ctrlKey && e.key === 'n')) {
      e.preventDefault();
      this.selected = Math.min(this.selected + 1, this.filtered.length - 1);
      this._render();
      this._scrollSelected();
    } else if (e.key === 'ArrowUp' || (e.ctrlKey && e.key === 'p')) {
      e.preventDefault();
      this.selected = Math.max(this.selected - 1, 0);
      this._render();
      this._scrollSelected();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      this._run(this.selected);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      this.close();
    }
  },

  _scrollSelected() {
    const row = $$('.ov-item')[this.selected];
    if (row) row.scrollIntoView({ block: 'nearest' });
  },

  _run(i) {
    const f = this.filtered[i];
    if (!f) return;
    this.close();
    setTimeout(() => f.it.run(), 10);
  },
};

if (typeof module === 'object' && module.exports) module.exports = Overlay;
