const fs = require('fs');
const path = require('path');

const ALLOWED_EXPORT_CSS = new Set([
  'renderer/css/content/inkflow-light.css',
  'renderer/css/content/inkflow-dark.css',
  'node_modules/vditor/dist/js/highlight.js/styles/atom-one-dark.min.css',
  'node_modules/vditor/dist/js/highlight.js/styles/github.min.css',
  'node_modules/vditor/dist/js/katex/katex.min.css',
]);

function readExportCss(appRoot, relativePath, fsImpl = fs) {
  if (typeof relativePath !== 'string' || !ALLOWED_EXPORT_CSS.has(relativePath)) {
    return { ok: false, error: '不允许读取该样式' };
  }

  try {
    const file = path.join(appRoot, ...relativePath.split('/'));
    return { ok: true, content: fsImpl.readFileSync(file, 'utf-8') };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

module.exports = { readExportCss };
