// ============ 当前文稿查找与替换 ============
'use strict';

function findTextMatches(text, query, matchCase = false) {
  const source = String(text || '');
  const needle = String(query || '');
  if (!needle) return [];
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(escaped, matchCase ? 'gu' : 'giu');
  const matches = [];
  let match;
  while ((match = pattern.exec(source)) !== null) {
    matches.push({ start: match.index, end: match.index + match[0].length });
  }
  return matches;
}

function replaceTextMatch(text, match, replacement) {
  if (!match) return String(text || '');
  const source = String(text || '');
  return source.slice(0, match.start) + String(replacement || '') + source.slice(match.end);
}

function replaceAllTextMatches(text, matches, replacement) {
  const source = String(text || '');
  const value = String(replacement || '');
  if (!matches.length) return source;
  let cursor = 0;
  let result = '';
  for (const match of matches) {
    result += source.slice(cursor, match.start) + value;
    cursor = match.end;
  }
  return result + source.slice(cursor);
}

const FindReplace = {
  current: -1,
  matches: [],
  matchCase: false,
  tabKey: null,
  initialized: false,

  init() {
    if (this.initialized) return;
    this.initialized = true;
    this.bar = $('#find-replace');
    this.findInput = $('#find-input');
    this.replaceInput = $('#replace-input');
    this.count = $('#find-count');
    this.caseButton = $('#find-case');
    this.replaceRow = $('#replace-row');

    this.findInput.addEventListener('input', () => {
      this.current = 0;
      this.refresh();
    });
    this.replaceInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        if (event.shiftKey) this.replaceAll();
        else this.replaceCurrent();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        this.close();
      }
    });
    this.findInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        if (event.shiftKey) this.previous();
        else this.next();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        this.close();
      }
    });
    $('#find-prev').onclick = () => this.previous();
    $('#find-next').onclick = () => this.next();
    $('#find-toggle-replace').onclick = () => this.toggleReplace();
    $('#find-close').onclick = () => this.close();
    $('#replace-one').onclick = () => this.replaceCurrent();
    $('#replace-all').onclick = () => this.replaceAll();
    this.caseButton.onclick = () => {
      this.matchCase = !this.matchCase;
      this.caseButton.classList.toggle('active', this.matchCase);
      this.caseButton.setAttribute('aria-pressed', this.matchCase ? 'true' : 'false');
      this.current = 0;
      this.refresh();
    };
  },

  isOpen() {
    return !!(this.bar && !this.bar.classList.contains('hidden'));
  },

  _editableTab() {
    const tab = App.activeTab();
    return tab && tab.kind !== 'preview' && Editor.ready ? tab : null;
  },

  open(showReplace = false) {
    const tab = this._editableTab();
    if (!tab) {
      toast('请先打开一个可编辑的 Markdown 文稿');
      return false;
    }
    const selected = typeof Editor.getSelectedText === 'function' ? Editor.getSelectedText() : '';
    if (!this.isOpen() && selected && selected.length <= 200 && !/[\r\n]/.test(selected)) {
      this.findInput.value = selected;
    }
    this.bar.classList.remove('hidden');
    this.bar.setAttribute('aria-hidden', 'false');
    this._setReplaceVisible(showReplace || !this.replaceRow.classList.contains('hidden'));
    this.tabKey = tab.key;
    this.current = 0;
    this.refresh();
    this.findInput.focus();
    this.findInput.select();
    return true;
  },

  close() {
    if (!this.bar) return;
    this.bar.classList.add('hidden');
    this.bar.setAttribute('aria-hidden', 'true');
    this._clearBrowserSelection();
    Editor.focus();
  },

  toggleReplace(force) {
    const visible = force === undefined ? this.replaceRow.classList.contains('hidden') : !!force;
    this._setReplaceVisible(visible);
  },

  _setReplaceVisible(visible) {
    this.replaceRow.classList.toggle('hidden', !visible);
    this.bar.classList.toggle('replace-visible', visible);
    $('#find-toggle-replace').classList.toggle('active', visible);
    $('#find-toggle-replace').setAttribute('aria-expanded', visible ? 'true' : 'false');
    if (visible && document.activeElement === this.findInput) this.replaceInput.focus();
  },

  sync() {
    if (!this.isOpen()) return;
    const tab = this._editableTab();
    if (!tab) {
      this.matches = [];
      this.current = -1;
      this._renderState();
      return;
    }
    if (this.tabKey !== tab.key) {
      this.tabKey = tab.key;
      this.current = 0;
    }
    this.refresh();
  },

  refresh() {
    const tab = this._editableTab();
    const query = this.findInput.value;
    const source = tab ? Editor.getValue(tab.key) : '';
    this.matches = findTextMatches(source, query, this.matchCase);
    if (!this.matches.length) this.current = -1;
    else if (this.current < 0 || this.current >= this.matches.length) this.current = 0;
    this._renderState();
    this._highlightCurrent();
  },

  _renderState() {
    const total = this.matches.length;
    this.count.textContent = total ? `${this.current + 1} / ${total}` : '0 / 0';
    this.count.classList.toggle('empty', !total && !!this.findInput.value);
    for (const id of ['find-prev', 'find-next', 'replace-one', 'replace-all']) {
      const button = $('#' + id);
      button.disabled = total === 0;
    }
  },

  next() {
    if (!this.matches.length) return;
    this.current = (this.current + 1) % this.matches.length;
    this._renderState();
    this._highlightCurrent();
  },

  previous() {
    if (!this.matches.length) return;
    this.current = (this.current - 1 + this.matches.length) % this.matches.length;
    this._renderState();
    this._highlightCurrent();
  },

  replaceCurrent() {
    const tab = this._editableTab();
    if (!tab || !this.matches.length || this.current < 0) return false;
    const source = Editor.getValue(tab.key);
    const match = this.matches[this.current];
    const replacement = this.replaceInput.value;
    const nextSource = replaceTextMatch(source, match, replacement);
    Editor.replaceValue(nextSource);
    App.onEditorInput(tab.key);

    const nextMatches = findTextMatches(nextSource, this.findInput.value, this.matchCase);
    const nextOffset = match.start + replacement.length;
    const nextIndex = nextMatches.findIndex((item) => item.start >= nextOffset);
    this.current = nextIndex >= 0 ? nextIndex : (nextMatches.length ? 0 : -1);
    this.matches = nextMatches;
    this._renderState();
    requestAnimationFrame(() => this._highlightCurrent());
    return true;
  },

  replaceAll() {
    const tab = this._editableTab();
    if (!tab || !this.matches.length) return 0;
    const count = this.matches.length;
    const source = Editor.getValue(tab.key);
    const nextSource = replaceAllTextMatches(source, this.matches, this.replaceInput.value);
    Editor.replaceValue(nextSource);
    App.onEditorInput(tab.key);
    this.current = -1;
    this.matches = findTextMatches(nextSource, this.findInput.value, this.matchCase);
    if (this.matches.length) this.current = 0;
    this._renderState();
    requestAnimationFrame(() => this._highlightCurrent());
    toast(`已替换 ${count} 处`);
    return count;
  },

  _highlightCurrent() {
    if (!this.matches.length || this.current < 0 || typeof window.find !== 'function') return;
    const host = Editor.activeHost();
    const root = host && ($('.vditor-ir > .vditor-reset', host) || $('.vditor-ir', host));
    if (!root) return;
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(root);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    let found = false;
    for (let index = 0; index <= this.current; index += 1) {
      found = window.find(this.findInput.value, this.matchCase, false, false, false, true, false);
      if (!found) break;
    }
    if (!found || !host.contains(selection.anchorNode)) {
      this._clearBrowserSelection();
      return;
    }
    const anchor = selection.anchorNode && (selection.anchorNode.nodeType === 1
      ? selection.anchorNode : selection.anchorNode.parentElement);
    if (anchor && anchor.scrollIntoView) anchor.scrollIntoView({ block: 'center' });
  },

  _clearBrowserSelection() {
    const selection = window.getSelection && window.getSelection();
    if (selection) selection.removeAllRanges();
  },
};

if (typeof module === 'object' && module.exports) {
  module.exports = { findTextMatches, replaceTextMatch, replaceAllTextMatches };
}
