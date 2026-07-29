// ============ 编辑器实例池：每个标签一个 Vditor 实例，切换零重渲染 ============
'use strict';

const Editor = {
  instances: new Map(), // key -> { key, host, vditor, tab, ready }
  activeKey: null,

  get ready() {
    const a = this._active();
    return !!(a && a.ready);
  },
  get vditor() {
    const a = this._active();
    return a && a.vditor;
  },

  _active() {
    return this.activeKey != null ? this.instances.get(this.activeKey) : null;
  },

  activeHost() {
    const a = this._active();
    return a && a.host;
  },

  init() {
    this._setupFocusTracking();
    return Promise.resolve();
  },

  /* ---------- 实例生命周期 ---------- */

  // 切换到某标签的编辑器（不存在则懒创建；已存在则瞬间显隐，零重渲染）
  async activate(key, tab) {
    const prev = this._active();
    if (prev && prev.key === key) {
      prev.tab = tab;
      return;
    }
    if (prev) {
      const sc = this._scroller(prev.host);
      if (sc) prev.tab.scrollTop = sc.scrollTop;
      prev.host.classList.add('hidden');
    }
    this.activeKey = key;
    let inst = this.instances.get(key);
    if (!inst) inst = await this._create(key, tab);
    inst.tab = tab;
    inst.host.classList.remove('hidden');
    this._hideImgToolbar();
    const sc = this._scroller(inst.host);
    if (sc) sc.scrollTop = tab.scrollTop || 0;
    this._rescanImages(inst); // 切回时复扫图片：加载失败的自愈
    requestAnimationFrame(() => {
      try { inst.vditor.focus(); } catch (e) { /* 忽略 */ }
    });
  },

  clearActive() {
    const prev = this._active();
    if (prev) prev.host.classList.add('hidden');
    this.activeKey = null;
    this._hideImgToolbar();
  },

  destroy(key) {
    const inst = this.instances.get(key);
    if (!inst) return;
    try { inst.vditor.destroy(); } catch (e) { /* 忽略 */ }
    inst.host.remove();
    this.instances.delete(key);
    if (this.activeKey === key) this.activeKey = null;
  },

  rekey(from, to) {
    const inst = this.instances.get(from);
    if (!inst) return;
    this.instances.delete(from);
    inst.key = to;
    inst.host.dataset.key = to;
    this.instances.set(to, inst);
    if (this.activeKey === from) this.activeKey = to;
  },

  has(key) {
    return this.instances.has(key);
  },

  _scroller(host) {
    return $('.vditor-ir > .vditor-reset', host) || $('.vditor-ir', host);
  },

  _create(key, tab) {
    return new Promise((resolve) => {
      const host = el('div', 'editor-host ink-editor hidden');
      host.dataset.key = key;
      $('#editor-hosts').appendChild(host);
      const inst = { key, host, vditor: null, tab, ready: false };
      this.instances.set(key, inst);
      const dark = document.body.dataset.theme === 'dark';
      inst.vditor = new Vditor(host, this._options(dark, inst, resolve));
    });
  },

  _options(dark, inst, onReady) {
    return {
      height: '100%',
      mode: 'ir',
      cdn: '../node_modules/vditor',
      cache: { enable: false },
      theme: dark ? 'dark' : 'classic',
      icon: 'material',
      lang: 'zh_CN',
      typewriterMode: App.settings.typewriter !== false,
      tab: '    ',
      placeholder: '',
      undoDelay: 200,

      toolbar: [
        'headings', 'bold', 'italic', 'strike', 'inline-code', '|',
        'quote', 'list', 'ordered-list', 'check', 'code', 'table', '|',
        'link', 'image', 'math', 'mermaid', '|',
        'undo', 'redo', 'fullscreen',
      ],
      toolbarConfig: { pin: true, hide: false },

      preview: {
        delay: 300,
        theme: {
          current: dark ? 'inkflow-dark' : 'inkflow-light',
          path: './css/content',
        },
        hljs: {
          enable: true,
          style: dark ? 'atom-one-dark' : 'github',
          lineNumber: false,
        },
        markdown: {
          autoSpace: true,
          fixTermTypo: true,
          toc: true,
          mark: true,
          footnotes: true,
          sanitize: false,
          listStyle: true,
          paragraphBeginningSpace: true,
          gfmAutoLink: true,
        },
        math: { inlineDigit: true, engine: 'KaTeX', macros: {} },
        actions: [],
      },

      hint: {
        emojiPath: '../node_modules/vditor/dist/images/emoji',
        emoji: {
          '+1': '👍', '-1': '👎', heart: '❤️', smile: '😄', tada: '🎉',
          rocket: '🚀', fire: '🔥', star: '⭐', check: '✅', x: '❌',
          warning: '⚠️', tip: '💡', bug: '🐛', note: '📝', sparkles: '✨',
        },
      },

      upload: {
        accept: 'image/*',
        max: 20 * 1024 * 1024,
        multiple: false,
        handler: (files) => this._handleUpload(inst, files),
      },

      link: {
        isOpen: false,
        click: (bom) => App.handleLinkClick(bom),
      },

      after: () => {
        inst.ready = true;
        this._setupImgObserver(inst);
        this._bindHostClicks(inst);
        const sc = this._scroller(inst.host);
        if (sc) sc.addEventListener('scroll', () => this._hideImgToolbar(), { passive: true });
        Outline.bindScroll(inst.host);
        if (inst.tab.cachedValue) inst.vditor.setValue(inst.tab.cachedValue, true);
        onReady(inst);
      },

      input: () => App.onEditorInput(inst.key),
      focus: () => App.onEditorFocus(),
      blur: () => {},
      select: () => App.updateFormatState && App.updateFormatState(),
    };
  },

  _setupImgObserver(inst) {
    const fix = (img) => {
      const src = img.getAttribute('src');
      if (!src || src.startsWith('http') || src.startsWith('data:') || src.startsWith('file:') || src.startsWith('//')) return;
      if (img.dataset.inkFixed === src) return;
      const tab = inst.tab;
      if (!tab || !tab.path) return;
      let rel;
      try { rel = decodeURIComponent(src); } catch { rel = src; } // 文件名含 % 容错
      const abs = P.resolve(P.dirname(tab.path), rel);
      img.dataset.inkFixed = src;
      img.style.opacity = '';
      img.src = `${App.assetUrl}/img?path=${encodeURIComponent(abs)}`;
      img.onerror = () => {
        // 加载失败（服务未就绪/文件后到/云端驱逐）：1.2s 后带时间戳重试一次
        img.onerror = null;
        setTimeout(() => {
          if (!img.isConnected) return;
          img.src = `${App.assetUrl}/img?path=${encodeURIComponent(abs)}&t=${Date.now()}`;
          img.onerror = () => { img.style.opacity = '0.35'; };
        }, 1200);
      };
    };
    const scan = (scope) => {
      if (scope.tagName === 'IMG') fix(scope);
      $$('img', scope).forEach(fix);
    };
    inst._imgFix = fix;
    new MutationObserver((mutations) => {
      for (const m of mutations) {
        m.addedNodes && m.addedNodes.forEach((n) => {
          if (n.nodeType === 1) scan(n);
        });
        if (m.type === 'attributes' && m.target.tagName === 'IMG') fix(m.target);
      }
    }).observe(inst.host, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] });
  },

  // 激活时复扫图片：曾加载失败的重新修正（自愈）
  _rescanImages(inst) {
    $$('img', inst.host).forEach((img) => {
      const orig = img.dataset.inkFixed;
      if (!orig) {
        if (inst._imgFix) inst._imgFix(img);
        return;
      }
      if (img.complete && img.naturalWidth > 0) { img.style.opacity = ''; return; }
      delete img.dataset.inkFixed;
      img.setAttribute('src', orig); // 还原相对路径，交给观察器重新修正
    });
  },

  // 链接 / TOC 点击拦截（每个实例宿主各自绑定）
  _bindHostClicks(inst) {
    inst.host.addEventListener('click', (e) => {
      // 点击图片 → 弹出操作条（删除/预览），不再只能靠退格键
      if (e.target.tagName === 'IMG' && inst.host.contains(e.target)) {
        e.preventDefault();
        e.stopPropagation();
        this._showImgToolbar(inst, e.target);
        return;
      }
      this._hideImgToolbar();
      const tocSpan = e.target.closest('[data-target-id]');
      if (tocSpan) {
        e.preventDefault();
        e.stopPropagation();
        const id = tocSpan.getAttribute('data-target-id');
        const target = document.getElementById(id) || $(`.vditor-ir [id="${CSS.escape(id)}"]`, inst.host);
        if (target) {
          target.scrollIntoView({ block: 'start', behavior: 'smooth' });
        } else {
          App._scrollToAnchor('#' + (tocSpan.textContent || ''));
        }
        return;
      }
      const a = e.target.closest('a');
      if (!a) return;
      e.preventDefault();
      e.stopPropagation();
      App.handleLinkClick(a);
    }, true);
  },

  /* ---- 图片操作条 ---- */
  _bindImgToolbarOnce() {
    const tb = $('#img-toolbar');
    if (!tb || tb._bound) return;
    tb._bound = true;
    tb.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-act]');
      if (!btn || !tb._ctx) return;
      const { inst, img } = tb._ctx;
      const act = btn.dataset.act;
      if (act === 'close') { this._hideImgToolbar(); return; }
      if (act === 'preview') {
        const rel = img.dataset.inkFixed || img.getAttribute('src') || '';
        const tab = inst.tab;
        if (tab && tab.path && !rel.startsWith('http')) {
          let relPath = rel;
          try { relPath = decodeURIComponent(rel); } catch { /* 容错 */ }
          App.openPreview(P.resolve(P.dirname(tab.path), relPath));
        }
        this._hideImgToolbar();
        return;
      }
      if (act === 'del') {
        // 移除整张图片的 IR 节点，并触发同步保存
        const node = img.closest('span[data-type="img"]') || img.closest('.vditor-ir__node') || img;
        node.remove();
        this._hideImgToolbar();
        const ir = $('.vditor-ir', inst.host);
        if (ir) ir.dispatchEvent(new InputEvent('input', { bubbles: true }));
        App.onEditorInput(inst.key);
        this.focus();
      }
    });
    // Esc 关闭
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this._hideImgToolbar();
    });
  },

  _showImgToolbar(inst, img) {
    const tb = $('#img-toolbar');
    const area = $('#editor-area');
    if (!tb || !area) return;
    this._bindImgToolbarOnce();
    tb.classList.remove('hidden');
    const a = area.getBoundingClientRect();
    const r = img.getBoundingClientRect();
    let x = r.left - a.left + r.width / 2 - tb.offsetWidth / 2;
    x = Math.max(8, Math.min(x, a.width - tb.offsetWidth - 8));
    let y = r.top - a.top - tb.offsetHeight - 8;
    if (y < 8) y = r.bottom - a.top + 8; // 顶部没地方就放图下
    tb.style.left = x + 'px';
    tb.style.top = y + 'px';
    tb._ctx = { inst, img };
  },

  _hideImgToolbar() {
    const tb = $('#img-toolbar');
    if (tb) { tb.classList.add('hidden'); tb._ctx = null; }
  },

  _setupFocusTracking() {
    document.addEventListener('selectionchange', debounce(() => {
      if (document.body.dataset.focus !== 'on') return;
      const host = this.activeHost();
      if (!host) return;
      const sel = window.getSelection();
      const container = $('.vditor-ir > .vditor-reset', host);
      if (!sel.rangeCount || !container) return;
      let node = sel.anchorNode;
      if (!node || !container.contains(node)) return;
      if (node.nodeType === 3) node = node.parentElement;
      while (node && node.parentElement !== container) node = node.parentElement;
      if (!node) return;
      $$('.ink-focus-active', container).forEach((e) => e.classList.remove('ink-focus-active'));
      node.classList.add('ink-focus-active');
    }, 60));
  },

  async _handleUpload(inst, files) {
    const tab = inst.tab;
    if (!tab || !tab.path) {
      toast('请先保存文件，再粘贴内容');
      return null;
    }
    const dir = P.dirname(tab.path);
    const TEXT_EXTS = ['.md', '.markdown', '.mdown', '.txt'];
    for (const file of files) {
      const name = file.name || 'pasted.png';
      const ext = P.extname(name).toLowerCase();
      try {
        if (TEXT_EXTS.includes(ext)) {
          // 文本类文件：直接插入内容（不再被当成图片）
          let content = '';
          const fp = typeof ink.getFilePath === 'function' ? ink.getFilePath(file) : '';
          if (fp) {
            const r = await ink.readFile(fp);
            if (r.ok) content = r.content;
          }
          if (!content) content = await file.text();
          if (content.trim()) {
            inst.vditor.insertValue(content + '\n', true);
            toast('已插入文件内容');
          } else {
            toast('文件内容为空');
          }
        } else if (/\.(png|jpe?g|gif|webp|svg|bmp)$/i.test(name) || !ext) {
          // 图片（或剪贴板无名截图）：落盘 assets/ 并插入相对路径
          const buf = await file.arrayBuffer();
          const r = await ink.saveImageBytes(new Uint8Array(buf), name, dir);
          if (r.ok) {
            const rel = r.relPath.split('/').map(encodeURIComponent).join('/');
            inst.vditor.insertValue(`![${P.stem(name)}](${rel})\n`, true);
            toast('图片已保存到 assets/');
          } else {
            toast('图片保存失败：' + r.error);
          }
        } else {
          // 其他文件：复制进 assets/ 并插入链接
          const fp = typeof ink.getFilePath === 'function' ? ink.getFilePath(file) : '';
          if (!fp) { toast('该文件类型暂不支持粘贴'); continue; }
          const r = await ink.copyImage(fp, dir);
          if (r.ok) {
            const rel = r.relPath.split('/').map(encodeURIComponent).join('/');
            inst.vditor.insertValue(`[${name}](${rel})\n`, true);
            toast('文件已存入 assets/ 并插入链接');
          } else {
            toast('文件复制失败：' + r.error);
          }
        }
      } catch (e) {
        toast('粘贴内容处理失败');
      }
    }
    return null;
  },

  // 插入本地图片（菜单：插入图片）
  async insertLocalImages() {
    const tab = App.activeTab();
    if (!tab || !tab.path) {
      toast('请先保存文件，再插入图片');
      return;
    }
    const paths = await ink.pickImages();
    if (!paths.length) return;
    const dir = P.dirname(tab.path);
    for (const src of paths) {
      const r = await ink.copyImage(src, dir);
      if (r.ok) {
        const rel = r.relPath.split('/').map(encodeURIComponent).join('/');
        this.vditor.insertValue(`![${P.stem(src)}](${rel})\n`, true);
      }
    }
    toast(`已插入 ${paths.length} 张图片`);
  },

  applyTheme(dark) {
    for (const inst of this.instances.values()) {
      if (!inst.vditor) continue;
      inst.vditor.setTheme(
        dark ? 'dark' : 'classic',
        dark ? 'inkflow-dark' : 'inkflow-light',
        dark ? 'atom-one-dark' : 'github',
        './css/content',
      );
    }
  },

  setTypewriter(on) {
    for (const inst of this.instances.values()) {
      if (inst.vditor && inst.vditor.vditor) {
        inst.vditor.vditor.options.typewriterMode = on;
      }
    }
  },

  /* ---------- 读写与命令（默认作用于当前实例） ---------- */

  getValue(key) {
    if (key !== undefined) {
      const inst = this.instances.get(key);
      if (inst && inst.ready) return inst.vditor.getValue();
      return null;
    }
    return this.ready ? this.vditor.getValue() : '';
  },

  setValue(md) {
    if (!this.vditor) return;
    this.vditor.setValue(md, true);
    const sc = this._scroller(this.activeHost());
    if (sc) sc.scrollTop = 0;
  },

  focus() {
    if (this.vditor) this.vditor.focus();
  },

  insert(md) {
    if (!this.vditor) return;
    this.vditor.insertValue(md, true);
    this.vditor.focus();
  },

  // 块级格式：标题级别（1-6）与正文（0）。
  // 应用标题走 vditor 内置热键（⌥⌘N）；切回正文走工具栏标题按钮（当前级别再点一次即降级）
  heading(level) {
    const host = this.activeHost();
    if (!this.vditor || !host) return false;
    const pre = this._scroller(host);
    if (!pre) return false;
    pre.focus();

    if (level >= 1 && level <= 6) {
      // vditor 热键判定按平台区分修饰键（mac: metaKey，其他: ctrlKey）
      const isMac = !App.platform || App.platform === 'darwin';
      pre.dispatchEvent(new KeyboardEvent('keydown', {
        key: String(level),
        code: 'Digit' + level,
        altKey: true,
        metaKey: isMac,
        ctrlKey: !isMac,
        bubbles: true,
        cancelable: true,
      }));
      return true;
    }
    if (level === 0) {
      const block = this._currentBlock(pre);
      if (!block || !/^H[1-6]$/.test(block.tagName || '')) return true; // 已是正文
      const cur = parseInt(block.tagName.slice(1), 10);
      // 先把 range 重置到块首，让 vditor 保存新鲜选区，再点按钮降级
      const range = document.createRange();
      range.selectNodeContents(block);
      range.collapse(true);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      const elements = this.vditor.vditor.toolbar && this.vditor.vditor.toolbar.elements;
      const headings = elements && elements.headings;
      const btn = (headings && headings.querySelector(`button[data-tag="h${cur}"]`))
        || host.querySelector(`button[data-tag="h${cur}"]`);
      if (!btn) return false;
      btn.click();
      return true;
    }
    return false;
  },

  // 当前光标所在的顶层块元素
  _currentBlock(pre) {
    const sel = window.getSelection();
    if (!sel.rangeCount) return null;
    let node = sel.anchorNode;
    if (!node || !pre.contains(node)) return null;
    if (node.nodeType === 3) node = node.parentElement;
    while (node && node.parentElement !== pre) node = node.parentElement;
    return node || null;
  },

  // 当前光标所在块的标题级别（0 = 非标题）
  _currentBlockHeading(pre) {
    const block = this._currentBlock(pre);
    if (!block) return 0;
    const m = /^H([1-6])$/.exec(block.tagName || '');
    return m ? parseInt(m[1], 10) : 0;
  },

  // 触发工具栏命令（加粗/斜体等）
  command(name) {
    const elements = this.vditor && this.vditor.vditor.toolbar && this.vditor.vditor.toolbar.elements;
    const item = elements && elements[name];
    if (!item) return false;
    const btn = item.querySelector('button') || item;
    btn.click();
    return true;
  },

  // 获取导出用 HTML（图片路径替换为 file:// 绝对路径）
  getExportHtml() {
    const tab = App.activeTab();
    let html = this.vditor.getHTML();
    if (tab && tab.path) {
      const dir = P.dirname(tab.path);
      html = html.replace(/(<img[^>]+src=")([^"]+)(")/g, (m, pre, src, post) => {
        if (/^(https?|data|file):/i.test(src)) return m;
        const abs = P.resolve(dir, decodeURIComponent(src));
        return `${pre}file://${encodeURI(abs)}${post}`;
      });
    }
    return html;
  },

  stats() {
    const md = this.getValue();
    const words = countWords(md);
    const chars = md.replace(/\s/g, '').length;
    const minutes = Math.max(1, Math.round(words / 350));
    return { words, chars, minutes };
  },
};
