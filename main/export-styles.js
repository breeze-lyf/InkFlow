'use strict';

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { readExportCss } = require('./css-assets');

const MAX_FIXED_CSS_BYTES = 4 * 1024 * 1024;
const MAX_KATEX_FONT_BYTES = 64 * 1024;
const MAX_TOTAL_KATEX_FONT_BYTES = 512 * 1024;
const KATEX_WOFF2_FILES = Object.freeze([
  'KaTeX_AMS-Regular.woff2',
  'KaTeX_Caligraphic-Bold.woff2',
  'KaTeX_Caligraphic-Regular.woff2',
  'KaTeX_Fraktur-Bold.woff2',
  'KaTeX_Fraktur-Regular.woff2',
  'KaTeX_Main-Bold.woff2',
  'KaTeX_Main-BoldItalic.woff2',
  'KaTeX_Main-Italic.woff2',
  'KaTeX_Main-Regular.woff2',
  'KaTeX_Math-BoldItalic.woff2',
  'KaTeX_Math-Italic.woff2',
  'KaTeX_SansSerif-Bold.woff2',
  'KaTeX_SansSerif-Italic.woff2',
  'KaTeX_SansSerif-Regular.woff2',
  'KaTeX_Script-Regular.woff2',
  'KaTeX_Size1-Regular.woff2',
  'KaTeX_Size2-Regular.woff2',
  'KaTeX_Size3-Regular.woff2',
  'KaTeX_Size4-Regular.woff2',
  'KaTeX_Typewriter-Regular.woff2',
]);
const KATEX_WOFF2_SET = new Set(KATEX_WOFF2_FILES);

function inlineKatexFonts(cssText, appRoot) {
  const fontsRoot = path.join(appRoot, 'node_modules/vditor/dist/js/katex/fonts');
  const encodedFonts = new Map();
  let totalFontBytes = 0;
  let css = String(cssText || '').replace(
    /url\(\s*(['"]?)fonts\/([A-Za-z0-9_-]+\.woff2)\1\s*\)\s*format\(\s*(['"]?)woff2\3\s*\)/gi,
    (match, _urlQuote, fileName) => {
      if (!KATEX_WOFF2_SET.has(fileName)) throw new Error(`KaTeX 字体不在允许列表：${fileName}`);
      if (!encodedFonts.has(fileName)) {
        const file = path.join(fontsRoot, fileName);
        let content;
        try {
          const stat = fs.statSync(file);
          if (!stat.isFile() || stat.size <= 4 || stat.size > MAX_KATEX_FONT_BYTES) {
            throw new Error('字体尺寸无效');
          }
          content = fs.readFileSync(file);
        } catch (error) {
          throw new Error(`KaTeX 字体不可用：${fileName}（${error.message}）`);
        }
        if (content.subarray(0, 4).toString('ascii') !== 'wOF2') {
          throw new Error(`KaTeX 字体格式无效：${fileName}`);
        }
        totalFontBytes += content.length;
        if (totalFontBytes > MAX_TOTAL_KATEX_FONT_BYTES) throw new Error('KaTeX 字体超过安全上限');
        encodedFonts.set(fileName, content.toString('base64'));
      }
      return `url("data:font/woff2;base64,${encodedFonts.get(fileName)}") format("woff2")`;
    },
  );
  // WOFF2 是唯一允许内联的字体格式；移除 KaTeX 自带的旧格式回退。
  css = css.replace(
    /,\s*url\(\s*(['"]?)fonts\/[A-Za-z0-9_-]+\.(?:woff|ttf)\1\s*\)\s*format\(\s*(['"]?)(?:woff|truetype)\2\s*\)/gi,
    '',
  );
  const urls = [...css.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi)].map((match) => match[2]);
  if (urls.some((value) => !/^data:font\/woff2;base64,[A-Za-z0-9+/]+=*$/.test(value))) {
    throw new Error('KaTeX 样式包含未内联资源');
  }
  return css;
}

function normalizeExportTheme(value) {
  return value === 'dark' ? 'dark' : 'light';
}

function fixedCssPaths(theme, { word = false } = {}) {
  const selected = normalizeExportTheme(theme);
  if (word) return ['renderer/css/content/inkflow-light.css'];
  return [
    `renderer/css/content/inkflow-${selected}.css`,
    `node_modules/vditor/dist/js/highlight.js/styles/${selected === 'dark' ? 'atom-one-dark' : 'github'}.min.css`,
    'node_modules/vditor/dist/js/katex/katex.min.css',
  ];
}

function fixedCssLinks(appRoot, theme) {
  return fixedCssPaths(theme).map((relative) => pathToFileURL(path.join(appRoot, ...relative.split('/'))).href);
}

function fixedCssText(appRoot, theme, options = {}) {
  const chunks = [];
  let totalBytes = 0;
  for (const relative of fixedCssPaths(theme, options)) {
    const result = readExportCss(appRoot, relative);
    if (!result.ok) throw new Error(`导出样式不可用：${relative}`);
    let css = String(result.content || '');
    if (/<\/?style\b/i.test(css)) throw new Error(`导出样式内容无效：${relative}`);
    if (relative.endsWith('/katex.min.css')) {
      css = inlineKatexFonts(css, appRoot);
    }
    totalBytes += Buffer.byteLength(css, 'utf8');
    if (totalBytes > MAX_FIXED_CSS_BYTES) throw new Error('导出样式超过安全上限');
    chunks.push(css);
  }
  const selected = normalizeExportTheme(theme);
  if (!options.word) {
    chunks.push(`body{background:${selected === 'dark' ? '#1b1e24' : '#faf9f5'};color:${selected === 'dark' ? '#dcd9d0' : '#2b2925'};font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","PingFang SC",sans-serif;line-height:1.8;}`);
  }
  return chunks;
}

module.exports = {
  MAX_FIXED_CSS_BYTES,
  MAX_KATEX_FONT_BYTES,
  MAX_TOTAL_KATEX_FONT_BYTES,
  fixedCssLinks,
  fixedCssPaths,
  fixedCssText,
  normalizeExportTheme,
};
