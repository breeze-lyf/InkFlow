// ============ 命令面板 & 快速打开 ============
'use strict';

const Overlay = {
  mode: null,        // 'palette' | 'quick'
  items: [],
  filtered: [],
  selected: 0,
  _fileCache: null,

  init() {
    $('#overlay-mask').addEventListener('click', () => this.close());
    $('#overlay-input').addEventListener('input', () => this._filter());
    $('#overlay-input').addEventListener('keydown', (e) => this._keydown(e));
  },

  async open(mode) {
    this.mode = mode;
    const overlay = $('#overlay');
    const input = $('#overlay-input');
    overlay.classList.remove('hidden');
    input.value = '';
    input.placeholder = mode === 'palette' ? '输入命令…' : (App.folder ? '输入文件名快速跳转…' : fmtKbd('尚未打开文件夹（⌘⇧O）', App.isMac));

    if (mode === 'quick') {
      this._fileCache = App.folder ? await ink.walkMd(App.folder) : [];
      this.items = this._fileCache.map((f) => ({
        type: 'file',
        icon: 'file',
        title: f.name,
        sub: f.rel,
        key: f.rel,
        run: () => App.openFile(f.path),
      }));
      // 追加命令入口
      this.items.push({
        type: 'cmd', icon: 'folder', title: '打开文件夹…', sub: '切换文档库', key: '打开文件夹 open folder',
        run: () => App.openFolderDialog(),
      });
    } else {
      this.items = App.commands();
    }
    this._filter();
    setTimeout(() => input.focus(), 30);
  },

  close() {
    $('#overlay').classList.add('hidden');
    this.mode = null;
    Editor.ready && App.activeTab() && Editor.focus();
  },

  isOpen() { return this.mode !== null; },

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
      box.appendChild(el('div', 'ov-empty', this.mode === 'quick' && !App.folder ? '先打开一个文件夹' : '没有匹配结果'));
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
