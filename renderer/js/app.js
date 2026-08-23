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
  _autosaveTimers: new Map(),
  _recoveryTimers: new Map(),
  _fsScanPromise: null,
  _fsScanQueued: false,
  _settingsErrorAt: 0,
  _maxDocumentBytes: 25 * 1024 * 1024,
  _fileWatchUnsubscribe: null,
  _activationEpoch: 0,
  _openingPaths: new Map(),

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
    this._applyAccent();
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
    this._bindFileWatchEvents();

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
      if (this.tabs.some((tab) => this._samePath(tab.path, p))) continue;
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
        diskValue: r.content,
        normalizeBaseline: true,
      });
    }
    const recoveredKey = await this._restoreRecoveryDrafts();
    const activePath = this.settings.activeTab;
    let idx = recoveredKey ? this.tabs.findIndex((t) => t.key === recoveredKey) : -1;
    if (idx < 0) idx = this.tabs.findIndex((t) => this._samePath(t.path, activePath));
    if (idx >= 0) await this.activate(idx);
    else if (this.tabs.length) await this.activate(0);
    if (recoveredKey) toast('已恢复上次未完成的文稿');
    await this._syncFileWatchers();
    this._syncWelcome();
  },

  async _restoreRecoveryDrafts() {
    if (typeof ink.getRecovery !== 'function') return null;
    let response;
    try {
      response = await ink.getRecovery();
    } catch (e) {
      toast('无法读取文稿恢复记录');
      return null;
    }
    if (response && response.ok === false) {
      toast('无法读取文稿恢复记录：' + (response.error || '未知错误'));
      return null;
    }
    const drafts = Array.isArray(response)
      ? response
      : ((response && (response.drafts || response.items)) || []);
    let preferred = null;

    for (const draft of drafts) {
      if (!draft || typeof draft.content !== 'string') continue;
      const path = draft.path ? P.normalize(draft.path) : null;
      const key = String(draft.key || (path ? `file:${path}` : `untitled:${Date.now()}`));
      const savedValue = typeof draft.savedValue === 'string' ? draft.savedValue : '';
      const diskValue = typeof draft.diskValue === 'string' ? draft.diskValue : savedValue;
      let tab = path ? this.tabs.find((t) => this._samePath(t.path, path) && t.kind !== 'preview') : null;
      let diskContent = null;
      let exists = false;

      if (path) {
        exists = await ink.exists(path);
        if (exists) {
          const result = await ink.readFile(path);
          if (!result.ok) continue;
          diskContent = result.content;
        }
      }

      const decision = path
        ? DocumentSafety.decide({
          diskContent,
          diskBaseline: diskValue,
          liveContent: draft.content,
          savedContent: savedValue,
          exists,
        })
        : { action: 'restore-untitled', dirty: this._contentDirty(draft.content, '') };

      // 已经落盘或磁盘变更而恢复内容未变：清理过期恢复记录。
      if (decision.action === 'accept-disk' || !decision.dirty) {
        await this._removeRecoveryKey(key);
        continue;
      }

      if (!tab) {
        if (!path) {
          const m = /^\u672a\u547d\u540d-(\d+)\.md$/.exec(draft.name || '');
          if (m) this.untitledSeq = Math.max(this.untitledSeq, Number(m[1]));
        }
        tab = {
          key: path || key,
          path,
          name: draft.name || (path ? P.basename(path) : `未命名-${++this.untitledSeq}.md`),
          dirty: true,
          savedValue: path ? savedValue : '',
          cachedValue: draft.content,
          diskValue: path ? diskValue : '',
          recoveryKey: key,
        };
        this.tabs.push(tab);
      } else {
        tab.cachedValue = draft.content;
        tab.savedValue = savedValue;
        tab.diskValue = diskValue;
        tab.dirty = true;
        tab.recoveryKey = key;
        delete tab.normalizeBaseline;
      }

      if (decision.action === 'conflict') {
        tab.conflict = { kind: 'changed', diskContent };
      } else if (decision.action === 'deleted') {
        tab.conflict = { kind: 'deleted', diskContent: null };
      }

      const score = (draft.active ? 2 : 1) * 1e15 + Number(draft.updatedAt || 0);
      if (!preferred || score > preferred.score) preferred = { key: tab.key, score };
    }
    return preferred && preferred.key;
  },

  /* ================= 标签页 ================= */
  activeTab() { return this.tabs[this.active] || null; },

  _pathKey(path) {
    if (!path) return '';
    const normalized = typeof P !== 'undefined' && P && typeof P.normalize === 'function'
      ? P.normalize(String(path)) : String(path).replace(/\\/g, '/');
    return this.platform === 'win32' ? normalized.toLowerCase() : normalized;
  },

  _samePath(left, right) {
    return !!left && !!right && this._pathKey(left) === this._pathKey(right);
  },

  _pathWithin(path, directory) {
    const child = this._pathKey(path);
    const rawParent = this._pathKey(directory);
    const parent = rawParent.length > 1 ? rawParent.replace(/\/$/, '') : rawParent;
    return !!child && !!parent && (child === parent || child.startsWith(parent + '/'));
  },

  async openFile(path, silent) {
    if (!path) return;
    const exist = this.tabs.findIndex((t) => this._samePath(t.path, path));
    if (exist >= 0) {
      await this.activate(exist);
      await this._syncFileWatchers();
      return;
    }
    const pathKey = this._pathKey(path);
    const pending = this._openingPaths.get(pathKey);
    if (pending) return pending;

    const opening = (async () => {
      const r = await ink.readFile(path);
      if (!r.ok) { toast('无法打开文件：' + P.basename(path)); return; }

      // 读盘期间另一个入口可能已经打开了同一文件；禁止生成相同 key 的两个标签。
      const openedWhileReading = this.tabs.findIndex((t) => this._samePath(t.path, path));
      if (openedWhileReading >= 0) {
        await this.activate(openedWhileReading);
        await this._syncFileWatchers();
        return;
      }

      this.tabs.push({
        key: path,
        path,
        name: P.basename(path),
        dirty: false,
        savedValue: r.content,
        cachedValue: r.content,
        diskValue: r.content,
      });
      await this.activate(this.tabs.length - 1);
      // vditor 打开时会规范化内容（补行尾换行等），以规范化后的值为脏检查基线，
      // 否则"只是打开看了一眼"也会被误判为有未保存更改
      const t = this.activeTab();
      if (t && this._samePath(t.path, path)) {
        const normalized = Editor.getValue(t.key);
        if (normalized !== null) {
          t.savedValue = normalized;
          t.cachedValue = normalized;
          t.dirty = false;
          this._renderTabs();
        }
      }
      ink.addRecent(path, 'file');
      if (!silent) this._renderWelcome();
      await this._syncFileWatchers();
      this._persistSession();
    })();
    this._openingPaths.set(pathKey, opening);
    try {
      return await opening;
    } finally {
      if (this._openingPaths.get(pathKey) === opening) this._openingPaths.delete(pathKey);
    }
  },

  newUntitled() {
    this.untitledSeq += 1;
    const key = `untitled:${Date.now().toString(36)}-${this.untitledSeq}`;
    this.tabs.push({
      key,
      path: null,
      name: `未命名-${this.untitledSeq}.md`,
      dirty: false,
      savedValue: '',
      cachedValue: '',
      diskValue: '',
    });
    this.activate(this.tabs.length - 1);
    setTimeout(() => Editor.focus(), 60);
  },

  // 预览非 Markdown 文件（图片/PDF 等）：只读页签，不创建编辑器实例
  openPreview(p) {
    const existing = this.tabs.findIndex((t) => this._samePath(t.path, p) && t.kind === 'preview');
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
    let content;
    if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp'].includes(ext)) {
      content = document.createElement('img');
      content.src = url;
      content.alt = tab.name;
    } else if (ext === '.pdf') {
      content = document.createElement('iframe');
      content.src = url;
      content.title = tab.name;
    } else {
      content = document.createElement('div');
      content.className = 'preview-unsupported';
      content.textContent = '暂不支持预览该格式';
    }
    pane.replaceChildren(content);
    pane.classList.remove('hidden');
  },

  _hidePreview() {
    const pane = $('#preview-pane');
    pane.classList.add('hidden');
    pane.innerHTML = '';
  },

  async activate(i) {
    if (i < 0 || i >= this.tabs.length) return false;
    const activationEpoch = ++this._activationEpoch;
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
      return true;
    }
    this._hidePreview();
    // 实例池：切换只显隐，不重渲染；首次激活懒创建
    const editorActivated = await Editor.activate(tab.key, tab);
    if (editorActivated === false || activationEpoch !== this._activationEpoch || this.activeTab() !== tab) {
      return false;
    }
    const cur = Editor.getValue(tab.key);
    if (tab.normalizeBaseline && !tab.conflict && cur !== null) {
      tab.savedValue = cur;
      tab.cachedValue = cur;
      tab.dirty = false;
      delete tab.normalizeBaseline;
    } else {
      tab.dirty = tab.conflict ? true : this._contentDirty(cur === null ? tab.cachedValue : cur, tab.savedValue);
    }

    this._renderTabs();
    this._syncWelcome();
    this.updateStatus();
    Outline.render();
    FileTree.markActive(tab.path);
    ink.setWindowFile(tab.path || '', tab.dirty);
    if (tab.path && this.folder && this._pathWithin(tab.path, this.folder)) {
      FileTree.reveal(tab.path);
    }
    this._persistSession();
    return true;
  },

  async closeTab(i, force) {
    const tab = this.tabs[i];
    if (!tab) return false;
    let discardConfirmed = force === true;
    let discardIntent = null;
    const autosaveTimer = this._autosaveTimers.get(tab.key);
    if (autosaveTimer) clearTimeout(autosaveTimer);
    this._autosaveTimers.delete(tab.key);
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
      if (choice === 'cancel') {
        this._scheduleAutoSave(tab);
        return false;
      }
      if (choice === 'discard') {
        discardConfirmed = true;
        discardIntent = {
          value: this._tabValue(tab),
          pathKey: this._pathKey(tab.path),
          conflict: tab.conflict,
        };
      }
      if (choice === 'save') {
        const ok = await this.save(i);
        if (!ok || !this.tabs.includes(tab) || tab.dirty || tab.conflict) {
          this._scheduleAutoSave(tab);
          return false;
        }
      }
    }
    await this._waitForTabSave(tab);
    if (!this.tabs.includes(tab)) return true;
    if (discardIntent) {
      const current = this._tabValue(tab);
      const staleDiscard = current !== discardIntent.value
        || this._pathKey(tab.path) !== discardIntent.pathKey
        || tab.conflict !== discardIntent.conflict;
      if (staleDiscard) {
        tab.cachedValue = current;
        tab.dirty = tab.conflict ? true : this._contentDirty(current, tab.savedValue);
        if (tab.dirty) {
          this._scheduleRecovery(tab);
          this._scheduleAutoSave(tab);
        }
        this._renderTabs();
        if (tab === this.activeTab()) {
          this.updateStatus();
          ink.setWindowFile(tab.path || '', tab.dirty);
        }
        toast('关闭已取消：确认后文稿出现了新的修改');
        return false;
      }
    }
    if (!discardConfirmed && (tab.dirty || tab.conflict)) {
      this._scheduleAutoSave(tab);
      return false;
    }
    const closingValue = tab.kind === 'preview' ? null : this._tabValue(tab);
    if (tab.kind !== 'preview' && tab.recoveryKey && !(await this._clearRecovery(tab))) return false;
    if (tab.kind !== 'preview') {
      const current = this._tabValue(tab);
      if (current !== closingValue || (!discardConfirmed && (tab.dirty || tab.conflict))) {
        tab.cachedValue = current;
        tab.dirty = tab.conflict ? true : this._contentDirty(current, tab.savedValue);
        if (tab.dirty) {
          this._scheduleRecovery(tab);
          this._scheduleAutoSave(tab);
        }
        return false;
      }
    }
    i = this.tabs.indexOf(tab);
    if (i < 0) return true;
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
    await this._syncFileWatchers();
    this._persistSession();
    return true;
  },

  closeTabByPath(path, force) {
    const i = this.tabs.findIndex((t) => this._samePath(t.path, path));
    if (i >= 0) return this.closeTab(i, force);
    return Promise.resolve(true);
  },

  async onPathRenamed(from, to) {
    const source = P.normalize(from);
    const target = P.normalize(to);
    const affected = this.tabs.filter((tab) => tab.path
      && this._pathWithin(tab.path, source));
    for (const tab of affected) {
      const oldKey = tab.key;
      const oldPath = P.normalize(tab.path);
      const previousRecoveryKey = tab.recoveryKey;
      const nextPath = target + oldPath.slice(source.length);
      const nextKey = tab.kind === 'preview' ? `preview:${nextPath}` : nextPath;
      const autosaveTimer = this._autosaveTimers.get(oldKey);
      if (autosaveTimer) clearTimeout(autosaveTimer);
      this._autosaveTimers.delete(oldKey);
      tab.path = nextPath;
      tab.key = nextKey;
      tab.name = P.basename(nextPath);
      Editor.rekey(oldKey, nextKey);
      if (previousRecoveryKey) {
        await this._clearRecovery(tab, previousRecoveryKey);
        if (tab.dirty) this._scheduleRecovery(tab);
      }
      this._scheduleAutoSave(tab);
    }
    if (affected.length) {
      this._renderTabs();
      this.updateStatus();
    }
    if (this._samePath(this.folder, source)) {
      this.folder = target;
      FileTree.setRoot(target);
    }
    await this._syncFileWatchers();
    this._persistSession();
  },

  /* ================= 输入 & 保存 ================= */
  // vditor 空文档 getValue() 返回 "\n"：全空白与空串视为等价，避免"新建未动过的标签也提示保存"
  _contentDirty(val, saved) {
    if (val === saved) return false;
    return val.trim() !== '' || (saved || '').trim() !== '';
  },

  _utf8ByteLength(value) {
    if (typeof TextEncoder === 'function') return new TextEncoder().encode(String(value)).byteLength;
    // Chromium and supported Node releases always expose TextEncoder. Keep a
    // conservative fallback so an unusual host cannot bypass the byte limit.
    return String(value).length * 3;
  },

  _exceedsDocumentLimit(value) {
    const text = String(value);
    // A UTF-16 code unit expands to at most three UTF-8 bytes. Most edits can
    // therefore skip allocating a full encoded copy until the document is large.
    if (text.length <= Math.floor(this._maxDocumentBytes / 3)) return false;
    return this._utf8ByteLength(text) > this._maxDocumentBytes;
  },

  _tabValue(tab) {
    const live = typeof Editor !== 'undefined' && Editor && typeof Editor.getValue === 'function'
      ? Editor.getValue(tab.key) : null;
    return live === null ? tab.cachedValue : live;
  },

  _enqueueTabSave(tab, operation) {
    if (!tab || typeof operation !== 'function') return Promise.resolve(false);
    if (tab._writesSuspended) return Promise.resolve(false);
    const previous = tab._saveTail || Promise.resolve();
    const task = previous.then(() => operation());
    const tail = task.then(() => undefined, () => undefined);
    tab._saveTail = tail;
    tail.then(() => {
      if (tab._saveTail === tail) delete tab._saveTail;
    });
    return task;
  },

  _waitForTabSave(tab) {
    return tab && tab._saveTail ? tab._saveTail : Promise.resolve();
  },

  _suspendTabWrites(tab) {
    if (!tab) return Promise.resolve();
    tab._writesSuspended = true;
    const autosaveTimer = this._autosaveTimers.get(tab.key);
    if (autosaveTimer) clearTimeout(autosaveTimer);
    this._autosaveTimers.delete(tab.key);
    return this._waitForTabSave(tab);
  },

  _resumeTabWrites(tab) {
    if (!tab) return;
    delete tab._writesSuspended;
    if (this.tabs.includes(tab)) this._scheduleAutoSave(tab);
  },

  _recoveryKey(tab) {
    if (tab.recoveryKey) return tab.recoveryKey;
    tab.recoveryKey = tab.path ? `file:${P.normalize(tab.path)}` : tab.key;
    return tab.recoveryKey;
  },

  _notifyPersistenceError(subject, error) {
    const now = Date.now();
    if (now - this._settingsErrorAt < 4000) return;
    this._settingsErrorAt = now;
    toast(`${subject}失败：${error || '请检查磁盘空间与文件权限'}`, 4200);
  },

  _scheduleRecovery(tab) {
    if (!tab || tab.kind === 'preview' || typeof ink.saveRecovery !== 'function') return;
    const key = this._recoveryKey(tab);
    const now = Date.now();
    const elapsed = now - (tab._lastRecoveryAt || 0);
    const run = () => {
      this._recoveryTimers.delete(key);
      tab._lastRecoveryAt = Date.now();
      this._writeRecovery(tab);
    };
    if (elapsed >= 600) run();
    else {
      clearTimeout(this._recoveryTimers.get(key));
      this._recoveryTimers.set(key, setTimeout(run, 600 - elapsed));
    }
  },

  _scheduleAutoSave(tab, delay = 900) {
    if (!tab) return;
    const prior = this._autosaveTimers.get(tab.key);
    if (prior) clearTimeout(prior);
    this._autosaveTimers.delete(tab.key);
    if (tab._writesSuspended || !tab.dirty || tab.conflict || !tab.path) return;
    this._autosaveTimers.set(tab.key, setTimeout(() => {
      this._autosaveTimers.delete(tab.key);
      this._autoSave(tab.key);
    }, delay));
  },

  _writeRecovery(tab) {
    if (!tab || typeof ink.saveRecovery !== 'function') return Promise.resolve(true);
    const content = this._tabValue(tab);
    tab.cachedValue = content;
    const draft = {
      key: this._recoveryKey(tab),
      path: tab.path || null,
      name: tab.name,
      content,
      savedValue: tab.savedValue,
      diskValue: typeof tab.diskValue === 'string' ? tab.diskValue : tab.savedValue,
      active: tab === this.activeTab(),
      updatedAt: Date.now(),
    };
    const previous = tab._recoveryWrite || Promise.resolve();
    tab._recoveryWrite = previous.then(async () => {
      const result = await ink.saveRecovery(draft);
      if (result === false || (result && result.ok === false)) {
        this._notifyPersistenceError('文稿恢复记录写入', result && result.error);
        return false;
      }
      return true;
    }).catch((error) => {
      this._notifyPersistenceError('文稿恢复记录写入', error && error.message);
      return false;
    });
    return tab._recoveryWrite;
  },

  async _removeRecoveryKey(key) {
    if (!key || typeof ink.removeRecovery !== 'function') return true;
    try {
      const result = await ink.removeRecovery(key);
      if (result === false || (result && result.ok === false)) {
        this._notifyPersistenceError('文稿恢复记录清理', result && result.error);
        return false;
      }
      return true;
    } catch (error) {
      this._notifyPersistenceError('文稿恢复记录清理', error && error.message);
      return false;
    }
  },

  async _clearRecovery(tab, keyOverride) {
    if (!tab) return true;
    const key = keyOverride || this._recoveryKey(tab);
    const timer = this._recoveryTimers.get(key);
    if (timer) clearTimeout(timer);
    this._recoveryTimers.delete(key);
    const previous = tab._recoveryWrite || Promise.resolve();
    const removal = previous.then(() => this._removeRecoveryKey(key));
    tab._recoveryWrite = removal;
    const ok = await removal;
    if (ok && tab._recoveryWrite === removal && (!keyOverride || tab.recoveryKey === key)) {
      delete tab.recoveryKey;
    }
    return ok;
  },

  async _clearAllRecovery() {
    for (const timer of this._recoveryTimers.values()) clearTimeout(timer);
    this._recoveryTimers.clear();
    await Promise.all(this.tabs.map((tab) => tab._recoveryWrite || Promise.resolve()));
    if (typeof ink.clearRecovery !== 'function') return true;
    try {
      const result = await ink.clearRecovery();
      if (result === false || (result && result.ok === false)) {
        this._notifyPersistenceError('文稿恢复记录清理', result && result.error);
        return false;
      }
      this.tabs.forEach((tab) => { delete tab.recoveryKey; });
      return true;
    } catch (error) {
      this._notifyPersistenceError('文稿恢复记录清理', error && error.message);
      return false;
    }
  },

  async _finishSuccessfulWrite(tab, writtenValue, { clearConflict = false, previousRecoveryKey = null } = {}) {
    tab.diskValue = writtenValue;
    tab.savedValue = writtenValue;
    if (clearConflict) delete tab.conflict;
    const nextRecoveryKey = tab.path ? `file:${P.normalize(tab.path)}` : tab.key;
    const current = this._tabValue(tab);
    tab.cachedValue = current;
    tab.dirty = tab.conflict ? true : this._contentDirty(current, writtenValue);
    let recoveryOk = true;
    if (tab.dirty) {
      if (previousRecoveryKey && previousRecoveryKey !== nextRecoveryKey) {
        recoveryOk = await this._clearRecovery(tab, previousRecoveryKey);
      }
      this._scheduleRecovery(tab);
      this._scheduleAutoSave(tab);
    } else {
      const recoveryKeys = [...new Set([previousRecoveryKey, tab.recoveryKey].filter(Boolean))];
      for (const recoveryKey of recoveryKeys) {
        if (!(await this._clearRecovery(tab, recoveryKey))) recoveryOk = false;
      }
    }
    this._renderTabs();
    if (tab === this.activeTab()) {
      this.updateStatus(!tab.dirty);
      ink.setWindowFile(tab.path || '', tab.dirty);
    }
    return recoveryOk;
  },


  onEditorInput(key) {
    const tab = this.tabs.find((t) => t.key === key) || this.activeTab();
    if (!tab) return;
    const val = Editor.getValue(tab.key);
    if (val === null) return;
    if (this._exceedsDocumentLimit(val)) {
      const fallback = typeof tab.cachedValue === 'string' ? tab.cachedValue : '';
      if (!tab._sizeLimitRollback && typeof Editor.setValue === 'function') {
        tab._sizeLimitRollback = true;
        try { Editor.setValue(fallback); } finally { delete tab._sizeLimitRollback; }
      }
      const now = Date.now();
      if (!tab._sizeLimitNoticeAt || now - tab._sizeLimitNoticeAt >= 4000) {
        tab._sizeLimitNoticeAt = now;
        toast('文稿已达到 25 MB 上限，最后一次输入未保留', 4200);
      }
      return;
    }
    tab.cachedValue = val;
    tab.dirty = tab.conflict ? true : this._contentDirty(val, tab.savedValue);
    this._renderTabs();
    this.updateStatus();
    ink.setWindowFile(tab.path || '', tab.dirty);
    if (tab.dirty) {
      this._scheduleRecovery(tab);
      this._scheduleAutoSave(tab);
    } else {
      this._scheduleAutoSave(tab);
      this._clearRecovery(tab);
    }
    this._outlineTimer && clearTimeout(this._outlineTimer);
    this._outlineTimer = setTimeout(() => Outline.render(), 500);
  },

  onEditorFocus() {},

  async _autoSave(key) {
    const tab = key ? this.tabs.find((item) => item.key === key) : this.activeTab();
    if (!tab) return false;
    return this._enqueueTabSave(tab, async () => {
      if (!this.tabs.includes(tab) || !tab.dirty) return true;
      if (tab.conflict || !tab.path) return false; // 未命名文件不自动落盘
      const val = this._tabValue(tab);
      const targetPath = tab.path;
      let r;
      try {
        r = await ink.writeFile(targetPath, val, { expectedContent: tab.diskValue });
      } catch (error) {
        toast('自动保存失败：' + ((error && error.message) || '请检查文件权限'), 4200);
        return false;
      }
      if (!this.tabs.includes(tab) || tab.path !== targetPath) return false;
      if (r && r.ok) {
        return (await this._finishSuccessfulWrite(tab, val)) !== false;
      }
      if (r && r.conflict) {
        this._markExternalConflict(tab, r.exists === false ? 'deleted' : 'changed', r.diskContent);
      } else {
        toast('自动保存失败：' + ((r && r.error) || '请检查文件权限'), 4200);
      }
      return false;
    });
  },

  async save(i) {
    const idx = i === undefined ? this.active : i;
    const tab = this.tabs[idx];
    if (!tab) return false;
    return this._enqueueTabSave(tab, async () => {
      if (!this.tabs.includes(tab)) return false;
      if (tab.conflict) {
        await this.activate(this.tabs.indexOf(tab));
        toast('磁盘版本已变更，请先在警示条中选择处理方式', 3600);
        return false;
      }
      // 实例池：直接从该标签的实例取值（不活跃标签用缓存）
      const val = this._tabValue(tab);
      const previousRecoveryKey = this._recoveryKey(tab);
      const hadPath = !!tab.path;
      let targetPath = tab.path;
      if (!tab.path) {
        const p = await ink.saveAsDialog(tab.name);
        if (!p || !this.tabs.includes(tab)) return false;
        const alreadyOpen = this.tabs.find((item) => item !== tab && item.kind !== 'preview'
          && this._samePath(item.path, p));
        if (alreadyOpen) {
          await this.activate(this.tabs.indexOf(alreadyOpen));
          toast('该文稿已在另一个页签中打开');
          return false;
        }
        targetPath = p;
      }
      let r;
      try {
        r = await ink.writeFile(targetPath, val, hadPath ? { expectedContent: tab.diskValue } : undefined);
      } catch (error) {
        toast('保存失败：' + ((error && error.message) || '请检查文件权限'));
        return false;
      }
      if (r && r.conflict) {
        this._markExternalConflict(tab, r.exists === false ? 'deleted' : 'changed', r.diskContent);
        return false;
      }
      if (!r || !r.ok) { toast('保存失败：' + ((r && r.error) || '')); return false; }
      if (!this.tabs.includes(tab)) return false;
      if (!hadPath) {
        const oldKey = tab.key;
        tab.path = targetPath;
        tab.key = targetPath;
        tab.name = P.basename(targetPath);
        Editor.rekey(oldKey, targetPath);
        ink.addRecent(targetPath, 'file');
        FileTree.refresh();
      }
      const recoveryOk = await this._finishSuccessfulWrite(tab, val, { previousRecoveryKey });
      await this._syncFileWatchers();
      this._persistSession();
      return recoveryOk !== false && !tab.dirty && !tab.conflict;
    });
  },

  async saveAs() {
    const tab = this.activeTab();
    if (!tab || tab.kind === 'preview') return false;
    return this._enqueueTabSave(tab, async () => {
      if (!this.tabs.includes(tab)) return false;
      const p = await ink.saveAsDialog(tab.name);
      if (!p || !this.tabs.includes(tab)) return false;
      const alreadyOpen = this.tabs.find((item) => item !== tab && item.kind !== 'preview'
        && this._samePath(item.path, p));
      if (alreadyOpen) {
        await this.activate(this.tabs.indexOf(alreadyOpen));
        toast('该文稿已在另一个页签中打开');
        return false;
      }
      const val = this._tabValue(tab);
      const oldKey = tab.key;
      const oldRecoveryKey = this._recoveryKey(tab);
      let r;
      try {
        r = await ink.writeFile(p, val);
      } catch (error) {
        toast('另存为失败：' + ((error && error.message) || '请检查文件权限'));
        return false;
      }
      if (!r || !r.ok) { toast('另存为失败：' + ((r && r.error) || '')); return false; }
      const oldAutosaveTimer = this._autosaveTimers.get(oldKey);
      if (oldAutosaveTimer) clearTimeout(oldAutosaveTimer);
      this._autosaveTimers.delete(oldKey);
      tab.path = p;
      tab.key = p;
      tab.name = P.basename(p);
      Editor.rekey(oldKey, p);
      const recoveryOk = await this._finishSuccessfulWrite(tab, val, {
        clearConflict: true,
        previousRecoveryKey: oldRecoveryKey,
      });
      ink.addRecent(p, 'file');
      FileTree.refresh();
      await this._syncFileWatchers();
      this._persistSession();
      if (recoveryOk !== false) toast('已另存为 ' + P.basename(p));
      return recoveryOk !== false && !tab.dirty && !tab.conflict;
    });
  },

  /* ================= 外部文件变更保护 ================= */
  _bindFileWatchEvents() {
    if (this._fileWatchUnsubscribe) this._fileWatchUnsubscribe();
    this._fileWatchUnsubscribe = null;
    if (typeof ink.onFilesChanged !== 'function') return;
    this._fileWatchUnsubscribe = ink.onFilesChanged(() => {
      this.scanExternalChanges().catch((error) => {
        this._notifyPersistenceError('外部文件变更检查', error && error.message);
      });
    });
  },

  async _syncFileWatchers() {
    if (typeof ink.watchFiles !== 'function') return true;
    const paths = [...new Set(this.tabs
      .filter((tab) => tab.path && tab.kind !== 'preview')
      .map((tab) => tab.path))];
    try {
      const result = await ink.watchFiles(paths);
      if (result === false || (result && result.ok === false)) {
        this._notifyPersistenceError('单文件变更监听', result && result.error);
        return false;
      }
      return true;
    } catch (error) {
      this._notifyPersistenceError('单文件变更监听', error && error.message);
      return false;
    }
  },

  scanExternalChanges() {
    if (this._fsScanPromise) {
      this._fsScanQueued = true;
      return this._fsScanPromise;
    }
    this._fsScanPromise = (async () => {
      do {
        this._fsScanQueued = false;
        await this._scanOpenDocumentsOnce();
      } while (this._fsScanQueued);
    })().finally(() => { this._fsScanPromise = null; });
    return this._fsScanPromise;
  },

  async _scanOpenDocumentsOnce() {
    const open = this.tabs.filter((tab) => tab.path && tab.kind !== 'preview');
    await Promise.all(open.map(async (tab) => {
      const watchedPath = tab.path;
      // 自身原子保存也会触发 watcher；先等该页签写队列落定，再用更新后的磁盘基线比较。
      await this._waitForTabSave(tab);
      if (!this.tabs.includes(tab) || tab.path !== watchedPath) return;
      const scanSaveTail = tab._saveTail;
      const scanDiskBaseline = tab.diskValue;
      let exists;
      try {
        exists = await ink.exists(watchedPath);
      } catch (e) {
        return;
      }
      let diskContent = null;
      if (exists) {
        const result = await ink.readFile(watchedPath);
        if (!result.ok) return;
        diskContent = result.content;
      }
      // 读盘期间页签可能已关闭或 rekey，旧请求不得污染新状态。
      if (!this.tabs.includes(tab) || tab.path !== watchedPath) return;
      if (tab._saveTail !== scanSaveTail || tab.diskValue !== scanDiskBaseline) {
        this._fsScanQueued = true;
        return;
      }
      const liveContent = this._tabValue(tab);
      const decision = DocumentSafety.decide({
        diskContent,
        diskBaseline: typeof tab.diskValue === 'string' ? tab.diskValue : tab.savedValue,
        liveContent,
        savedContent: tab.savedValue,
        exists,
      });

      if (decision.action === 'unchanged') {
        if (tab.conflict) {
          delete tab.conflict;
          tab.dirty = this._contentDirty(liveContent, tab.savedValue);
          if (tab.dirty && tab.path) {
            this._scheduleRecovery(tab);
            this._scheduleAutoSave(tab);
          }
        }
        return;
      }
      if (decision.action === 'accept-disk') {
        await this._acceptDiskVersion(tab, diskContent);
        return;
      }

      this._markExternalConflict(tab, decision.action === 'deleted' ? 'deleted' : 'changed', diskContent, false);
    }));
    this._renderTabs();
    this.updateStatus();
  },

  _markExternalConflict(tab, kind, diskContent, render = true) {
    if (!tab) return;
    const firstNotice = !tab.conflict || tab.conflict.kind !== kind;
    tab.conflict = { kind, diskContent: diskContent == null ? null : diskContent };
    tab.dirty = true;
    const autosaveTimer = this._autosaveTimers.get(tab.key);
    if (autosaveTimer) clearTimeout(autosaveTimer);
    this._autosaveTimers.delete(tab.key);
    this._scheduleRecovery(tab);
    if (render) {
      this._renderTabs();
      this.updateStatus();
    }
    if (firstNotice) {
      toast(kind === 'deleted'
        ? `“${tab.name}” 已被外部删除，已保留当前内容`
        : `“${tab.name}” 已在外部修改，自动保存已暂停`, 4200);
    }
  },

  async _acceptDiskVersion(tab, diskContent) {
    const current = this._tabValue(tab);
    tab.diskValue = diskContent;
    tab.savedValue = diskContent;
    tab.cachedValue = diskContent;
    tab.dirty = false;
    delete tab.conflict;
    if (current !== diskContent && Editor.has(tab.key)) {
      if (tab === this.activeTab()) {
        Editor.setValue(diskContent);
        const normalized = Editor.getValue(tab.key);
        if (normalized !== null) {
          tab.savedValue = normalized;
          tab.cachedValue = normalized;
        }
      } else {
        Editor.destroy(tab.key);
        tab.normalizeBaseline = true;
      }
    } else if (!Editor.has(tab.key)) {
      tab.normalizeBaseline = true;
    }
    const recoveryOk = await this._clearRecovery(tab);
    if (tab === this.activeTab()) {
      this.updateStatus();
      Outline.render();
      ink.setWindowFile(tab.path, false);
    }
    return recoveryOk;
  },

  async _loadConflictDisk() {
    const tab = this.activeTab();
    if (!tab) return false;
    const targetPath = tab.path;
    const conflictIntent = tab.conflict;
    const localValue = this._tabValue(tab);
    const abortIfStale = () => {
      const currentValue = this.tabs.includes(tab) ? this._tabValue(tab) : localValue;
      const stale = !this.tabs.includes(tab)
        || this.activeTab() !== tab
        || !this._samePath(tab.path, targetPath)
        || tab.conflict !== conflictIntent
        || currentValue !== localValue;
      if (!stale) return false;
      if (this.tabs.includes(tab) && currentValue !== localValue) {
        tab.cachedValue = currentValue;
        tab.dirty = tab.conflict ? true : this._contentDirty(currentValue, tab.savedValue);
        if (tab.dirty) this._scheduleRecovery(tab);
        this._renderTabs();
        if (this.activeTab() === tab) this.updateStatus();
        toast('载入已取消：文稿出现了新的修改');
      }
      return true;
    };
    await this._waitForTabSave(tab);
    if (abortIfStale() || !tab.conflict || tab.conflict.kind === 'deleted') return false;
    const exists = await ink.exists(targetPath);
    if (abortIfStale()) return false;
    if (!exists) {
      tab.conflict = { kind: 'deleted', diskContent: null };
      this._renderTabs();
      this.updateStatus();
      return false;
    }
    const result = await ink.readFile(targetPath);
    if (abortIfStale()) return false;
    if (!result.ok) {
      toast('载入磁盘版失败：' + (result.error || ''));
      return false;
    }
    if (abortIfStale()) return false;
    const recoveryOk = await this._acceptDiskVersion(tab, result.content);
    this._renderTabs();
    if (recoveryOk) toast('已载入磁盘版，本地未保存更改已丢弃');
    return recoveryOk;
  },

  async _overwriteConflict() {
    const tab = this.activeTab();
    if (!tab) return false;
    return this._enqueueTabSave(tab, async () => {
      if (!this.tabs.includes(tab) || !tab.conflict || !tab.path) return false;
      const targetPath = tab.path;
      const conflictIntent = tab.conflict;
      const value = this._tabValue(tab);
      let result;
      try {
        result = await ink.writeFile(targetPath, value, { force: true });
      } catch (error) {
        toast('覆盖保存失败：' + ((error && error.message) || '请检查文件权限'));
        return false;
      }
      const stale = !this.tabs.includes(tab)
        || !this._samePath(tab.path, targetPath)
        || tab.conflict !== conflictIntent;
      if (stale) {
        if (this.tabs.includes(tab)) {
          tab.cachedValue = this._tabValue(tab);
          tab.dirty = true;
          this._scheduleRecovery(tab);
        }
        toast('覆盖结果未应用：文稿路径或冲突状态已变化，请重试');
        return false;
      }
      if (!result || !result.ok) {
        toast('覆盖保存失败：' + ((result && result.error) || ''));
        return false;
      }
      const recoveryOk = await this._finishSuccessfulWrite(tab, value, { clearConflict: true });
      this._persistSession();
      if (recoveryOk !== false) toast('已按你的选择覆盖磁盘版本');
      return recoveryOk !== false;
    });
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
    $('#conflict-load-disk').onclick = () => this._loadConflictDisk();
    $('#conflict-save-as').onclick = () => this.saveAs();
    $('#conflict-overwrite').onclick = () => this._overwriteConflict();

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

  /* ---- 主色调（经典靛蓝 / 印章朱 / 黛蓝 / 茶褐） ---- */
  setAccent(v) {
    this.settings.accent = v;
    this.setSetting({ accent: v });
    this._applyAccent();
  },

  _applyAccent() {
    const v = this.settings.accent || 'indigo';
    document.body.dataset.accent = v;
    $$('#set-accent button').forEach((b) => b.classList.toggle('active', b.dataset.v === v));
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
    $$('#set-accent button').forEach((b) => {
      b.onclick = () => this.setAccent(b.dataset.v);
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
  moveTab(from, to) {
    if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || from >= this.tabs.length) return false;
    const target = Math.max(0, Math.min(this.tabs.length - 1, to));
    if (from === target) return false;
    const activeTab = this.activeTab();
    const [moved] = this.tabs.splice(from, 1);
    this.tabs.splice(target, 0, moved);
    this.active = activeTab ? this.tabs.indexOf(activeTab) : -1;
    this._renderTabs();
    this._persistSession();
    return true;
  },

  _focusTab(index) {
    setTimeout(() => {
      const node = $('#tabs').children[index];
      if (node) node.focus();
    }, 0);
  },

  _clearTabDropMarkers() {
    $$('#tabs .tab').forEach((node) => node.classList.remove('dragging', 'drop-before', 'drop-after'));
  },

  _renderTabs() {
    const box = $('#tabs');
    box.innerHTML = '';
    this.tabs.forEach((tab, i) => {
      const t = el('div', 'tab' + (i === this.active ? ' active' : '') + (tab.dirty ? ' dirty' : '') + (tab.conflict ? ' conflict' : ''));
      t.title = (tab.path || tab.name) + (tab.conflict ? '\n外部变更待处理' : '');
      t.dataset.index = String(i);
      t.draggable = true;
      t.setAttribute('role', 'tab');
      t.setAttribute('aria-selected', i === this.active ? 'true' : 'false');
      t.setAttribute('aria-label', `${tab.name}${tab.dirty ? '，未保存' : ''}${tab.conflict ? '，外部变更待处理' : ''}`);
      t.tabIndex = i === this.active ? 0 : -1;
      t.appendChild(el('span', 'tab-dirty'));
      t.appendChild(el('span', 'tab-label', tab.name));
      const close = el('button', 'tab-close', '×');
      close.title = '关闭';
      close.setAttribute('aria-label', `关闭 ${tab.name}`);
      close.onclick = (e) => { e.stopPropagation(); this.closeTab(i); };
      t.appendChild(close);
      t.onclick = () => this.activate(i);
      t.ondblclick = (e) => {
        if (e.target.closest('.tab-close')) return;
        e.preventDefault();
        this.closeTab(i);
      }; // 双击关闭
      t.onauxclick = (e) => { if (e.button === 1) this.closeTab(i); }; // 中键关闭
      t.ondragstart = (e) => {
        this._dragTabIndex = i;
        if (e.dataTransfer) {
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('application/x-inkflow-tab', String(i));
          e.dataTransfer.setData('text/plain', tab.name);
        }
        requestAnimationFrame(() => t.classList.add('dragging'));
      };
      t.ondragover = (e) => {
        if (!Number.isInteger(this._dragTabIndex)) return;
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
        this._clearTabDropMarkers();
        const rect = t.getBoundingClientRect();
        t.classList.add(e.clientX < rect.left + rect.width / 2 ? 'drop-before' : 'drop-after');
      };
      t.ondrop = (e) => {
        if (!Number.isInteger(this._dragTabIndex)) return;
        e.preventDefault();
        e.stopPropagation();
        const from = this._dragTabIndex;
        const rect = t.getBoundingClientRect();
        let to = i + (e.clientX >= rect.left + rect.width / 2 ? 1 : 0);
        if (from < to) to -= 1;
        this._dragTabIndex = null;
        this._clearTabDropMarkers();
        const moved = this.tabs[from];
        if (this.moveTab(from, to)) this._focusTab(this.tabs.indexOf(moved));
      };
      t.ondragend = () => {
        this._dragTabIndex = null;
        this._clearTabDropMarkers();
      };
      t.onkeydown = (e) => {
        const direction = e.key === 'ArrowLeft' ? -1 : (e.key === 'ArrowRight' ? 1 : 0);
        if (direction && e.altKey && e.shiftKey && !e.metaKey && !e.ctrlKey) {
          e.preventDefault();
          const to = Math.max(0, Math.min(this.tabs.length - 1, i + direction));
          const moved = this.tabs[i];
          if (this.moveTab(i, to)) this._focusTab(this.tabs.indexOf(moved));
          return;
        }
        if (e.altKey || e.shiftKey || e.metaKey || e.ctrlKey) return;
        let next = -1;
        if (direction) next = (i + direction + this.tabs.length) % this.tabs.length;
        else if (e.key === 'Home') next = 0;
        else if (e.key === 'End') next = this.tabs.length - 1;
        if (next >= 0) {
          e.preventDefault();
          this.activate(next).then(() => this._focusTab(next));
        }
      };
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
    const keptTab = this.tabs[keep];
    if (!keptTab) return false;
    let completed = true;
    for (let i = this.tabs.length - 1; i >= 0; i--) {
      if (this.tabs[i] === keptTab) continue;
      if (!(await this.closeTab(i))) {
        completed = false;
        break;
      }
    }
    const keptIndex = this.tabs.indexOf(keptTab);
    if (keptIndex >= 0) await this.activate(keptIndex);
    return completed;
  },

  async _closeAllTabs() {
    while (this.tabs.length) {
      if (!(await this.closeTab(this.tabs.length - 1))) return false;
    }
    return true;
  },

  updateStatus(saved) {
    const tab = this.activeTab();
    const isPreview = tab && tab.kind === 'preview';
    $('#st-path').textContent = tab ? (tab.path || '未保存') : '';
    $('#st-path').title = tab ? (tab.path || '') : '';
    const save = $('#st-save');
    if (tab) {
      if (isPreview) { save.textContent = '只读预览'; save.className = 'st-item'; }
      else if (tab.conflict && tab.conflict.kind === 'deleted') { save.textContent = '⚠ 磁盘文件已删除'; save.className = 'st-item dirty'; }
      else if (tab.conflict) { save.textContent = '⚠ 外部修改冲突'; save.className = 'st-item dirty'; }
      else if (tab.dirty) { save.textContent = '● 未保存'; save.className = 'st-item dirty'; }
      else if (saved) { save.textContent = '✓ 已保存'; save.className = 'st-item saved'; }
      else { save.textContent = tab.path ? '已保存' : ''; save.className = 'st-item' + (tab.path ? ' saved' : ''); }
    } else save.textContent = '';

    const s = Editor.ready && tab && !isPreview ? Editor.stats() : { words: 0, minutes: 0 };
    $('#st-words').textContent = tab && !isPreview ? `${formatNumber(s.words)} 字` : '';
    $('#st-time').textContent = tab && !isPreview && s.words > 0 ? `约 ${s.minutes} 分钟` : '';
    $('#st-mode').textContent = document.body.dataset.focus === 'on' ? '专注：开' : '专注：关';
    this._renderConflictBar();
  },

  _renderConflictBar() {
    const bar = $('#file-conflict-bar');
    if (!bar) return;
    const tab = this.activeTab();
    const conflict = tab && tab.kind !== 'preview' && tab.conflict;
    bar.classList.toggle('hidden', !conflict);
    if (!conflict) return;
    const deleted = conflict.kind === 'deleted';
    $('#file-conflict-message').textContent = deleted
      ? `“${tab.name}” 已被外部删除。当前内容仍安全保留，自动保存已暂停。`
      : `“${tab.name}” 的磁盘版已变更。为避免覆盖他人修改，自动保存已暂停。`;
    $('#conflict-load-disk').hidden = deleted;
    $('#conflict-overwrite').textContent = deleted ? '重新写回原位置' : '明确覆盖磁盘版';
  },

  _syncWelcome() {
    const show = this.tabs.length === 0;
    $('#welcome').classList.toggle('show', show);
    if (show) { this._renderRecent(); this._hidePreview(); }
  },

  async _renderRecent() {
    let recent = { files: [], folders: [] };
    try {
      const value = await ink.getRecent();
      recent = {
        files: value && Array.isArray(value.files) ? value.files : [],
        folders: value && Array.isArray(value.folders) ? value.folders : [],
      };
    } catch {
      // 最近记录失效不应阻断欢迎页；主进程也会逐项过滤读盘竞态。
    }
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
      item.appendChild(el('span', 'wri-name', P.basename(p.replace(/\/$/, ''))));
      // 路径只显示所在目录（文件名上行已有）：home 缩写为 ~，CSS 负责从左侧截断
      const pretty = P.dirname(p.replace(/\/$/, '')).replace(/^\/Users\/[^/]+/, '~');
      item.appendChild(el('span', 'wri-path', pretty));
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
        case 'close-all-tabs': await this._closeAllTabs(); break;
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
        case 'tree-fs-changed': await Promise.all([FileTree.softRefresh(), this.scanExternalChanges()]); break;
        case 'try-quit': this._tryQuit(); break;
      }
    });
  },

  async _tryQuit() {
    if (this._quitInProgress) return false;
    this._quitInProgress = true;
    try {
      await Promise.all(this.tabs.map((tab) => this._waitForTabSave(tab)));
      const dirty = this.tabs.filter((t) => t.dirty || t.conflict);
      let discardConfirmed = false;
      if (dirty.length) {
        const choice = await this._confirm({
          title: '退出墨流',
          msg: `有 ${dirty.length} 个文件包含未保存的更改：${dirty.map((t) => t.name).join('、')}`,
          buttons: [
            { label: '取消', value: 'cancel' },
            { label: '不保存退出', value: 'discard', danger: true },
            { label: '保存并退出', value: 'save', primary: true },
          ],
        });
        if (choice === 'cancel') return false;
        discardConfirmed = choice === 'discard';
        if (choice === 'save') {
          for (const tab of dirty) {
            const i = this.tabs.indexOf(tab);
            const ok = i >= 0 && await this.save(i);
            if (!ok || !this.tabs.includes(tab) || tab.dirty || tab.conflict) return false;
          }
        }
      }

      // 清 recovery 会让出事件循环；记录内容，防止用户在此期间输入的新字被旧退出意图吞掉。
      const finalSnapshot = this.tabs.map((tab) => ({ tab, value: tab.kind === 'preview' ? null : this._tabValue(tab) }));
      if (!(await this._clearAllRecovery())) return false;
      const changed = finalSnapshot.length !== this.tabs.length || finalSnapshot.some(({ tab, value }) => (
        !this.tabs.includes(tab) || (tab.kind !== 'preview' && this._tabValue(tab) !== value)
      ));
      const unexpectedlyDirty = !discardConfirmed && this.tabs.some((tab) => tab.dirty || tab.conflict);
      if (changed || unexpectedlyDirty) {
        for (const tab of this.tabs) {
          if (tab.kind === 'preview') continue;
          const current = this._tabValue(tab);
          tab.cachedValue = current;
          tab.dirty = tab.conflict ? true : this._contentDirty(current, tab.savedValue);
          if (tab.dirty) this._scheduleRecovery(tab);
        }
        return false;
      }
      this._persistSession();
      ink.confirmClose();
      return true;
    } finally {
      this._quitInProgress = false;
    }
  },

  /* ================= 工具 ================= */
  setSetting(patch) {
    Object.assign(this.settings, patch);
    let request;
    try {
      request = ink.setSettings(patch);
    } catch (error) {
      this._notifyPersistenceError('设置保存', error && error.message);
      return Promise.resolve(false);
    }
    return Promise.resolve(request).then((result) => {
      if (result === false || (result && result.ok === false)) {
        this._notifyPersistenceError('设置保存', result && result.error);
        return false;
      }
      return true;
    }).catch((error) => {
      this._notifyPersistenceError('设置保存', error && error.message);
      return false;
    });
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

if (typeof module === 'object' && module.exports) module.exports = App;
if (typeof window !== 'undefined') window.addEventListener('DOMContentLoaded', () => App.boot());
