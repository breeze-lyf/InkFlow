// ============ 导出（PDF / HTML） ============
'use strict';

const Exporter = {
  _base() {
    // file:///…/renderer/index.html → file:///…
    return location.href.replace(/\/renderer\/index\.html.*$/, '');
  },

  _katexCssHref() {
    return `${this._base()}/node_modules/vditor/dist/js/katex/katex.min.css`;
  },

  async exportPdf() {
    const tab = App.activeTab();
    if (!tab) { toast('没有可导出的文档'); return; }
    const html = Editor.getExportHtml();
    const dark = false; // PDF 始终使用浅色，便于打印
    const cssLinks = [
      `${this._base()}/renderer/css/content/inkflow-light.css`,
      `${this._base()}/node_modules/vditor/dist/js/highlight.js/styles/github.min.css`,
      this._katexCssHref(),
    ];
    toast('正在生成 PDF…', 30000);
    const r = await ink.exportPdf({ html, cssLinks, suggestedName: P.stem(tab.name) + '.pdf' });
    $('#toast').innerHTML = '';
    if (r.ok) toast('PDF 已导出');
    else if (!r.canceled) toast('导出失败：' + (r.error || ''));
  },

  async exportHtml() {
    const tab = App.activeTab();
    if (!tab) { toast('没有可导出的文档'); return; }
    const html = Editor.getExportHtml();
    const dark = document.body.dataset.theme === 'dark';

    const cssTexts = [];
    // 内容主题
    const themeCss = await ink.readCss(`renderer/css/content/inkflow-${dark ? 'dark' : 'light'}.css`);
    if (themeCss.ok) cssTexts.push(themeCss.content);
    // 代码高亮
    const hljsCss = await ink.readCss(`node_modules/vditor/dist/js/highlight.js/styles/${dark ? 'atom-one-dark' : 'github'}.min.css`);
    if (hljsCss.ok) cssTexts.push(hljsCss.content);
    // KaTeX（字体引用重写为 file:// 绝对路径）
    const katexCss = await ink.readCss('node_modules/vditor/dist/js/katex/katex.min.css');
    if (katexCss.ok) {
      const fontBase = `${this._base()}/node_modules/vditor/dist/js/katex/`;
      cssTexts.push(katexCss.content.replace(/url\((['"]?)fonts\//g, `url($1${fontBase}fonts/`));
    }
    cssTexts.push(`body{background:${dark ? '#1b1e24' : '#faf9f5'};color:${dark ? '#dcd9d0' : '#2b2925'};font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","PingFang SC",sans-serif;line-height:1.8;}`);

    toast('正在生成 HTML…', 30000);
    const r = await ink.exportHtml({ html, cssTexts, suggestedName: P.stem(tab.name) + '.html' });
    $('#toast').innerHTML = '';
    if (r.ok) toast('HTML 已导出');
    else if (!r.canceled) toast('导出失败：' + (r.error || ''));
  },
};
