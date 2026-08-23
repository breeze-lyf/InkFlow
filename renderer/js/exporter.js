// ============ 导出（PDF / HTML / Word / 图片） ============
'use strict';

const Exporter = {
  _editableTab() {
    const tab = App.activeTab();
    if (!tab || tab.kind === 'preview' || !Editor.vditor) {
      toast('当前页签不是可导出的 Markdown 文稿');
      return null;
    }
    return tab;
  },

  _showSuccess(label, result) {
    const rejected = result && Array.isArray(result.rejectedImages) ? result.rejectedImages.length : 0;
    toast(rejected ? `${label}已导出，${rejected} 张不安全、过大或不支持的图片未嵌入` : `${label}已导出`);
  },

  async _runExport(label, work) {
    toast(`正在生成 ${label}…`, 30000);
    try {
      const result = await work();
      const box = $('#toast');
      if (box) box.replaceChildren();
      if (result && result.ok) this._showSuccess(label, result);
      else if (!result || !result.canceled) toast('导出失败：' + ((result && result.error) || '未知错误'));
      return result || { ok: false, error: '未知错误' };
    } catch (error) {
      const box = $('#toast');
      if (box) box.replaceChildren();
      const message = error && error.message ? error.message : String(error);
      toast('导出失败：' + message);
      return { ok: false, error: message };
    }
  },

  async exportPdf() {
    const tab = this._editableTab();
    if (!tab) return;
    return this._runExport('PDF', async () => {
      const html = await Editor.getExportHtml();
      return ink.exportPdf({ html, theme: 'light', suggestedName: P.stem(tab.name) + '.pdf' });
    });
  },

  async exportWord() {
    const tab = this._editableTab();
    if (!tab) return;
    return this._runExport('Word 文档', async () => {
      const html = await Editor.getExportHtml({ rasterizeSvg: true });
      return ink.exportWord({ html, theme: 'light', suggestedName: P.stem(tab.name) + '.docx' });
    });
  },

  async exportImage() {
    const tab = this._editableTab();
    if (!tab) return;
    return this._runExport('图片', async () => {
      const html = await Editor.getExportHtml();
      return ink.exportImage({ html, theme: 'light', suggestedName: P.stem(tab.name) + '.png' });
    });
  },

  async exportHtml() {
    const tab = this._editableTab();
    if (!tab) return;
    return this._runExport('HTML', async () => {
      const html = await Editor.getExportHtml();
      const dark = document.body.dataset.theme === 'dark';
      return ink.exportHtml({
        html,
        theme: dark ? 'dark' : 'light',
        suggestedName: P.stem(tab.name) + '.html',
      });
    });
  },
};

if (typeof module === 'object' && module.exports) module.exports = Exporter;
