// ============ 编辑器封装（Vditor IR 即时渲染模式） ============
'use strict';

const Editor = {
  vditor: null,
  ready: false,
  _afterResolve: null,

  init() {
    return new Promise((resolve) => {
      this._afterResolve = resolve;
      const dark = document.body.dataset.theme === 'dark';

      this.vditor = new Vditor($('#vditor'), {
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
          handler: (files) => this._handleUpload(files),
        },

        link: {
          isOpen: false,
          click: (bom) => App.handleLinkClick(bom),
        },

        after: () => {
          this.ready = true;
          this._setupImgObserver();
          this._setupFocusTracking();
          this._afterResolve();
        },

        input: () => App.onEditorInput(),
        focus: () => App.onEditorFocus(),
        blur: () => {},
        select: () => App.updateFormatState && App.updateFormatState(),
      });
    });
  },

  _setupImgObserver() {
    const root = this.vditor.vditor.element;
    const fix = (img) => {
      const src = img.getAttribute('src');
      if (!src || src.startsWith('http') || src.startsWith('data:') || src.startsWith('file:') || src.startsWith('//')) return;
      if (img.dataset.inkFixed === src) return;
      const tab = App.activeTab();
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
    }).observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] });
  },

  _setupFocusTracking() {
    document.addEventListener('selectionchange', debounce(() => {
      if (document.body.dataset.focus !== 'on') return;
      const sel = window.getSelection();
      const container = $('.vditor-ir > .vditor-reset', this.vditor.vditor.element);
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

  async _handleUpload(files) {
    const tab = App.activeTab();
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
          this.vditor.insertValue(`![${P.stem(file.name || 'image')}](${rel})\n`, true);
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
    if (!this.vditor) return;
    this.vditor.setTheme(
      dark ? 'dark' : 'classic',
      dark ? 'inkflow-dark' : 'inkflow-light',
      dark ? 'atom-one-dark' : 'github',
      './css/content',
    );
  },

  setTypewriter(on) {
    if (this.vditor && this.vditor.vditor) {
      this.vditor.vditor.options.typewriterMode = on;
    }
  },

  getValue() {
    return this.ready ? this.vditor.getValue() : '';
  },

  setValue(md) {
    this.vditor.setValue(md, true);
    const scroller = $('.vditor-ir > .vditor-reset', this.vditor.vditor.element) || $('.vditor-ir', this.vditor.vditor.element);
    if (scroller) scroller.scrollTop = 0;
  },

  focus() {
    this.vditor.focus();
  },

  insert(md) {
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
