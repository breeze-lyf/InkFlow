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
    const sc = this._scroller(inst.host);
    if (sc) sc.scrollTop = tab.scrollTop || 0;
    requestAnimationFrame(() => {
      try { inst.vditor.focus(); } catch (e) { /* 忽略 */ }
    });
  },

  clearActive() {
    const prev = this._active();
    if (prev) prev.host.classList.add('hidden');
    this.activeKey = null;
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
      const abs = P.resolve(P.dirname(tab.path), decodeURIComponent(src));
      img.dataset.inkFixed = src;
      img.src = `${App.assetUrl}/img?path=${encodeURIComponent(abs)}`;
      img.onerror = () => { img.style.opacity = '0.35'; };
    };
    const scan = (scope) => {
      if (scope.tagName === 'IMG') fix(scope);
      $$('img', scope).forEach(fix);
    };
    new MutationObserver((mutations) => {
      for (const m of mutations) {
        m.addedNodes && m.addedNodes.forEach((n) => {
          if (n.nodeType === 1) scan(n);
        });
        if (m.type === 'attributes' && m.target.tagName === 'IMG') fix(m.target);
      }
    }).observe(inst.host, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] });
  },

  // 链接 / TOC 点击拦截（每个实例宿主各自绑定）
  _bindHostClicks(inst) {
    inst.host.addEventListener('click', (e) => {
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
      toast('请先保存文件，再插入图片');
      return null;
    }
    const dir = P.dirname(tab.path);
    for (const file of files) {
      try {
        const buf = await file.arrayBuffer();
        const r = await ink.saveImageBytes(new Uint8Array(buf), file.name || 'pasted.png', dir);
        if (r.ok) {
          const rel = r.relPath.split('/').map(encodeURIComponent).join('/');
          inst.vditor.insertValue(`![${P.stem(file.name || 'image')}](${rel})\n`, true);
          toast('图片已保存到 assets/');
        } else {
          toast('图片保存失败：' + r.error);
        }
      } catch (e) {
        toast('图片处理失败');
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
