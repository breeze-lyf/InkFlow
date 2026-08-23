// ============ 静态导出渲染：把 Vditor 富内容冻结为可离线保存的 HTML ============
(function initExportRenderer(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ExportRenderer = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  'use strict';

  const RENDERERS = [
    ['code', /(?:<pre\b|class\s*=\s*["'][^"']*\blanguage-(?!math|mermaid|smiles|markmap|echarts|mindmap))/i],
    ['math', /\blanguage-math\b/i],
    ['mermaid', /\blanguage-mermaid\b/i],
    ['smiles', /\blanguage-smiles\b/i],
    ['markmap', /\blanguage-markmap\b/i],
    ['chart', /\blanguage-echarts\b/i],
    ['mindmap', /\blanguage-mindmap\b/i],
  ];
  const SVG_RASTER_LIMITS = Object.freeze({
    maxCount: 64,
    maxPixels: 8 * 1024 * 1024,
    maxTotalPixels: 32 * 1024 * 1024,
    maxDimension: 8192,
    maxWidth: 2400,
    maxScale: 2,
  });
  const LAYOUT_LIMITS = Object.freeze({
    maxElements: 100000,
    maxWidth: 16384,
    maxHeight: 1000000,
  });
  const MAX_CHART_DATA_URL_CHARS = Math.ceil((20 * 1024 * 1024) / 3) * 4 + 128;
  const MAX_TOTAL_CHART_DATA_URL_CHARS = 24 * 1024 * 1024;
  const MAX_KATEX_RASTER_NODES = 5000;
  const MAX_KATEX_RASTER_SOURCE_CHARS = 2 * 1024 * 1024;
  const WORD_STATIC_LANGUAGES = new Set(['mermaid', 'smiles', 'markmap', 'echarts', 'mindmap']);
  const KATEX_RASTER_STYLE_PROPERTIES = Object.freeze([
    'display', 'position', 'box-sizing', 'top', 'right', 'bottom', 'left',
    'width', 'height', 'min-width', 'min-height', 'max-width', 'max-height',
    'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
    'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
    'overflow', 'overflow-x', 'overflow-y', 'clip', 'opacity',
    'font-family', 'font-size', 'font-style', 'font-weight', 'font-variant', 'font-stretch',
    'line-height', 'letter-spacing', 'word-spacing', 'white-space', 'text-align',
    'text-indent', 'text-rendering', 'vertical-align', 'color',
    'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
    'border-top-style', 'border-right-style', 'border-bottom-style', 'border-left-style',
    'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color',
    'border-radius', 'border-collapse', 'table-layout',
    'transform', 'transform-origin', 'z-index',
    'flex', 'flex-basis', 'flex-direction', 'flex-grow', 'flex-shrink', 'flex-wrap',
    'align-content', 'align-items', 'align-self', 'justify-content', 'justify-items', 'justify-self',
    'fill', 'fill-rule', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-linecap',
    'stroke-linejoin', 'stroke-miterlimit', 'stroke-dasharray', 'stroke-dashoffset', 'stroke-opacity',
  ]);

  function rendererPlan(html) {
    const source = String(html == null ? '' : html);
    return RENDERERS.filter(([, pattern]) => pattern.test(source)).map(([name]) => name);
  }

  function validateLayoutBudget(holder, overrides = {}) {
    if (!holder) return;
    const maxElements = Number.isSafeInteger(overrides.maxElements) ? overrides.maxElements : LAYOUT_LIMITS.maxElements;
    const maxWidth = Number.isFinite(overrides.maxWidth) ? overrides.maxWidth : LAYOUT_LIMITS.maxWidth;
    const maxHeight = Number.isFinite(overrides.maxHeight) ? overrides.maxHeight : LAYOUT_LIMITS.maxHeight;
    const elements = holder.querySelectorAll ? holder.querySelectorAll('*').length : 0;
    const width = Number(holder.scrollWidth || 0);
    const height = Number(holder.scrollHeight || 0);
    if (elements > maxElements) throw new Error(`导出元素数量超过安全上限（${maxElements}）`);
    if (!Number.isFinite(width) || width > maxWidth) throw new Error(`导出布局宽度超过安全上限（${maxWidth}px）`);
    if (!Number.isFinite(height) || height > maxHeight) throw new Error(`导出布局高度超过安全上限（${maxHeight}px）`);
  }

  function fileUrl(absolutePath) {
    const normalized = String(absolutePath).replace(/\\/g, '/');
    const encodeSegments = (value) => value.split('/').map((segment) => encodeURIComponent(segment)).join('/');
    if (normalized.startsWith('//')) {
      const [host, ...segments] = normalized.slice(2).split('/');
      return `file://${encodeURIComponent(host)}/${encodeSegments(segments.join('/'))}`;
    }
    if (/^[a-zA-Z]:\//.test(normalized)) {
      const drive = normalized.slice(0, 2);
      return `file:///${drive}/${encodeSegments(normalized.slice(3))}`;
    }
    if (normalized.startsWith('/')) return `file://${encodeSegments(normalized)}`;
    return `file:///${encodeSegments(normalized)}`;
  }

  function transformImages(html, documentApi, transform) {
    const source = String(html == null ? '' : html);
    const browserDocument = documentApi
      || (typeof document !== 'undefined' && document && typeof document.createElement === 'function' ? document : null);
    if (browserDocument) {
      const template = browserDocument.createElement('template');
      template.innerHTML = source;
      Array.from(template.content.querySelectorAll('img')).forEach((image) => transform({
        get: (name) => image.getAttribute(name),
        set: (name, value) => image.setAttribute(name, value),
        remove: (name) => image.removeAttribute(name),
      }));
      return template.innerHTML;
    }
    // Node 单测走同样的实体解码 + DOM 属性路径；sandbox renderer 不会执行 require 分支。
    if (typeof require === 'function') {
      const { parseDocument } = require('htmlparser2');
      const { getElementsByTagName } = require('domutils');
      const serialize = require('dom-serializer').default;
      const parsed = parseDocument(source, { decodeEntities: true });
      getElementsByTagName('img', parsed.children, true).forEach((image) => transform({
        get: (name) => image.attribs && Object.prototype.hasOwnProperty.call(image.attribs, name)
          ? image.attribs[name] : null,
        set: (name, value) => { image.attribs[name] = value; },
        remove: (name) => { delete image.attribs[name]; },
      }));
      return serialize(parsed.children, { encodeEntities: 'utf8' });
    }
    return source;
  }

  function richLanguage(node) {
    const value = node && node.attribs ? node.attribs.class : '';
    const classes = String(value || '').split(/\s+/);
    for (const name of WORD_STATIC_LANGUAGES) {
      if (classes.includes(`language-${name}`)) return name;
    }
    return '';
  }

  function nodeHasClass(node, name) {
    const value = node && node.attribs ? node.attribs.class : '';
    return String(value || '').split(/\s+/).includes(name);
  }

  function staticPngAttributes(attributes) {
    const value = attributes || {};
    return /^data:image\/png;base64,/i.test(String(value.src || ''))
      && ['svg-image', 'image', 'katex-image'].includes(String(value['data-inkflow-static'] || ''));
  }

  function prepareWordHtml(html, documentApi = null) {
    const source = String(html == null ? '' : html);
    const browserDocument = documentApi
      || (typeof document !== 'undefined' && document && typeof document.createElement === 'function' ? document : null);
    if (browserDocument) {
      const template = browserDocument.createElement('template');
      template.innerHTML = source;
      const selector = [...WORD_STATIC_LANGUAGES].map((name) => `.language-${name}`).join(',');
      for (const node of Array.from(template.content.querySelectorAll(selector))) {
        if (!node.isConnected && !template.content.contains(node)) continue;
        const image = node.querySelector('img[data-inkflow-static]');
        if (!image || !staticPngAttributes({
          src: image.getAttribute('src'),
          'data-inkflow-static': image.getAttribute('data-inkflow-static'),
        })) {
          throw new Error(`Word ${String(node.className || '富内容')}静态化失败`);
        }
        const root = typeof node.closest === 'function' ? (node.closest('pre') || node) : node;
        root.replaceWith(image);
      }
      for (const image of Array.from(template.content.querySelectorAll('img[data-inkflow-static="katex-image"]'))) {
        if (!staticPngAttributes({
          src: image.getAttribute('src'),
          'data-inkflow-static': image.getAttribute('data-inkflow-static'),
        })) throw new Error('Word 公式静态化失败');
        const root = image.closest('.language-math') || image.closest('.katex-display') || image;
        if (root !== image) root.replaceWith(image);
      }
      if (template.content.querySelector('.katex')) throw new Error('Word 公式静态化失败');
      return template.innerHTML;
    }
    if (typeof require === 'function') {
      const { parseDocument } = require('htmlparser2');
      const { getElementsByTagName, removeElement, replaceElement } = require('domutils');
      const serialize = require('dom-serializer').default;
      const parsed = parseDocument(source, { decodeEntities: true });
      const allTags = getElementsByTagName('*', parsed.children, true);
      const targets = allTags.filter((node) => richLanguage(node));
      for (const node of targets) {
        if (!node.parent) continue;
        const image = getElementsByTagName('img', node.children || [], true)
          .find((candidate) => staticPngAttributes(candidate.attribs));
        if (!image) throw new Error(`Word language-${richLanguage(node)} 静态化失败`);
        let root = node;
        let ancestor = node.parent;
        while (ancestor && ancestor.type === 'tag') {
          if (ancestor.name === 'pre') {
            root = ancestor;
            break;
          }
          ancestor = ancestor.parent;
        }
        removeElement(image);
        replaceElement(root, image);
      }
      const formulaImages = getElementsByTagName('img', parsed.children, true)
        .filter((image) => image.attribs && image.attribs['data-inkflow-static'] === 'katex-image');
      for (const image of formulaImages) {
        if (!staticPngAttributes(image.attribs)) throw new Error('Word 公式静态化失败');
        let root = image;
        let displayRoot = null;
        let ancestor = image.parent;
        while (ancestor && ancestor.type === 'tag') {
          if (nodeHasClass(ancestor, 'katex-display')) displayRoot = ancestor;
          if (nodeHasClass(ancestor, 'language-math')) {
            root = ancestor;
            break;
          }
          ancestor = ancestor.parent;
        }
        if (root === image && displayRoot) root = displayRoot;
        if (root !== image) {
          removeElement(image);
          replaceElement(root, image);
        }
      }
      if (allTags.some((node) => node.parent && nodeHasClass(node, 'katex'))) {
        throw new Error('Word 公式静态化失败');
      }
      return serialize(parsed.children, { encodeEntities: 'utf8' });
    }
    return source;
  }

  function splitLocalReference(source) {
    const raw = String(source == null ? '' : source).trim();
    const suffixAt = raw.search(/[?#]/);
    return suffixAt < 0
      ? { pathname: raw, suffix: '' }
      : { pathname: raw.slice(0, suffixAt), suffix: raw.slice(suffixAt) };
  }

  function localReferencePath(source) {
    const raw = String(source == null ? '' : source).trim();
    if (!/^file:/i.test(raw)) return splitLocalReference(raw).pathname;
    try {
      const parsed = new URL(raw);
      // 保留 URL 编码，调用方与相对路径一样只做一次 decodeURIComponent。
      let pathname = parsed.pathname;
      if (parsed.host) pathname = `//${parsed.host}${pathname}`;
      else if (/^\/[A-Za-z]:\//.test(pathname)) pathname = pathname.slice(1);
      return pathname;
    } catch {
      return '';
    }
  }

  function isLocalReference(source, documentPath = '') {
    const raw = String(source == null ? '' : source).trim();
    if (!raw || raw.startsWith('#') || /^(?:data|blob|https?):/i.test(raw)) return false;
    if (/^file:/i.test(raw) || /^[A-Za-z]:[\\/]/.test(raw) || /^\\\\/.test(raw) || /^\//.test(raw)) {
      if (raw.startsWith('//') && !/^(?:[A-Za-z]:[\\/]|\\\\|\/\/)/.test(String(documentPath))) return false;
      return true;
    }
    if (/^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.startsWith('//')) return false;
    return true;
  }

  function resolveLocalReferencePath(source, documentPath, pathApi) {
    if (!documentPath || !pathApi || !isLocalReference(source, documentPath)) return '';
    const encoded = localReferencePath(source);
    if (!encoded) return '';
    let decoded = encoded;
    try { decoded = decodeURIComponent(encoded); } catch { /* 保留含孤立 % 的合法文件名 */ }
    return pathApi.resolve(pathApi.dirname(documentPath), decoded);
  }

  function stageLocalImages(html, documentPath = '', documentApi = null) {
    return transformImages(html, documentApi, (image) => {
      const original = image.get('data-ink-fixed') || image.get('src') || '';
      if (!isLocalReference(original, documentPath)) return;
      image.set('data-ink-fixed', original.trim());
      // 初次消毒前不暴露 file:/Windows scheme；富渲染完成后再统一解析。
      image.remove('src');
    });
  }

  function rewriteLocalImages(html, documentPath, pathApi, documentApi = null) {
    if (!documentPath || !pathApi) return String(html == null ? '' : html);
    const dir = pathApi.dirname(documentPath);
    return transformImages(html, documentApi, (image) => {
      const original = image.get('data-ink-fixed') || image.get('src') || '';
      const src = original.trim();
      if (/^file:/i.test(src)) {
        image.set('src', src);
        image.remove('data-ink-fixed');
        return;
      }
      if (!isLocalReference(src, documentPath)) return;
      const { pathname, suffix } = splitLocalReference(src);
      let decoded = pathname;
      try { decoded = decodeURIComponent(pathname); } catch { /* 保留含孤立 % 的合法文件名 */ }
      const absolute = pathApi.resolve(dir, decoded);
      image.set('src', `${fileUrl(absolute)}${suffix}`);
      image.remove('data-ink-fixed');
    });
  }

  function pendingCount(holder, plan) {
    let count = 0;
    if (plan.includes('math')) {
      count += holder.querySelectorAll('.language-math:not([data-math]):not(.vditor-reset--error)').length;
    }
    for (const language of ['mermaid', 'smiles', 'echarts', 'mindmap']) {
      const renderer = language === 'echarts' ? 'chart' : language;
      if (plan.includes(renderer)) {
        count += Array.from(holder.querySelectorAll(`.language-${language}:not([data-processed="true"]):not(.vditor-reset--error)`))
          .filter((node) => {
            const encoded = node.getAttribute('data-code');
            if (encoded) {
              try { return decodeURIComponent(encoded).trim().length > 0; } catch { return true; }
            }
            return node.textContent.trim().length > 0;
          }).length;
      }
    }
    if (plan.includes('markmap')) {
      count += Array.from(holder.querySelectorAll('.language-markmap'))
        .filter((node) => {
          const encoded = node.getAttribute('data-code');
          let source = node.textContent.trim();
          if (encoded) {
            try { source = decodeURIComponent(encoded).trim(); } catch { source = encoded; }
          }
          if (!source) return false;
          const svg = node.querySelector('svg');
          return !svg || !svg.querySelector('g,path,circle,text');
        }).length;
    }
    return count;
  }

  async function waitForRender(holder, plan, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (pendingCount(holder, plan) === 0) return true;
      await new Promise((resolve) => setTimeout(resolve, 80));
    }
    return pendingCount(holder, plan) === 0;
  }

  function freezeCanvasCharts(holder, echartsApi, documentApi) {
    const nodes = Array.from(holder.querySelectorAll(
      '.language-echarts[data-processed="true"], .language-mindmap[data-processed="true"]',
    ));
    if (!nodes.length) return { expected: 0, replaced: 0 };
    if (nodes.length > SVG_RASTER_LIMITS.maxCount) {
      throw new Error(`图表数量超过安全上限（${SVG_RASTER_LIMITS.maxCount}）`);
    }
    if (!echartsApi || typeof echartsApi.getInstanceByDom !== 'function') {
      throw new Error('图表 1 静态化失败：ECharts 实例接口不可用');
    }
    let replaced = 0;
    let totalPixels = 0;
    let totalDataChars = 0;
    nodes.forEach((node, index) => {
      try {
        const chart = echartsApi.getInstanceByDom(node);
        if (!chart || typeof chart.getDataURL !== 'function') throw new Error('图表实例不可用');
        const rect = typeof node.getBoundingClientRect === 'function' ? node.getBoundingClientRect() : null;
        const width = Number((rect && rect.width) || node.clientWidth || 820);
        const height = Number((rect && rect.height) || node.clientHeight || 360);
        if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0
          || width > SVG_RASTER_LIMITS.maxDimension || height > SVG_RASTER_LIMITS.maxDimension
          || width * height > SVG_RASTER_LIMITS.maxPixels) {
          throw new Error('图表尺寸超过安全上限');
        }
        const pixelRatio = Math.min(
          2,
          SVG_RASTER_LIMITS.maxDimension / width,
          SVG_RASTER_LIMITS.maxDimension / height,
          Math.sqrt(SVG_RASTER_LIMITS.maxPixels / (width * height)),
        );
        const outputPixels = Math.max(1, Math.floor(width * pixelRatio))
          * Math.max(1, Math.floor(height * pixelRatio));
        if (totalPixels + outputPixels > SVG_RASTER_LIMITS.maxTotalPixels) {
          throw new Error('图表总像素超过安全上限');
        }
        const source = chart.getDataURL({ pixelRatio, backgroundColor: '#ffffff' });
        if (!/^data:image\/(?:png|jpeg);/i.test(source)) throw new Error('图表未生成 PNG/JPEG');
        if (source.length > MAX_CHART_DATA_URL_CHARS) throw new Error('图表数据超过安全上限');
        if (totalDataChars + source.length > MAX_TOTAL_CHART_DATA_URL_CHARS) {
          throw new Error('图表总数据量超过安全上限');
        }
        const image = documentApi.createElement('img');
        image.src = source;
        image.alt = node.classList.contains('language-mindmap') ? '思维导图' : '数据图表';
        image.style.cssText = 'display:block;max-width:100%;height:auto;margin:0 auto;';
        // ECharts dispose 会清空宿主；先释放，再放回冻结图片。
        try { if (typeof chart.dispose === 'function') chart.dispose(); } catch { /* 释放为 best effort */ }
        node.replaceChildren(image);
        node.style.height = 'auto';
        node.dataset.inkflowStatic = 'image';
        replaced += 1;
        totalPixels += outputPixels;
        totalDataChars += source.length;
      } catch (error) {
        throw new Error(`图表 ${index + 1} 静态化失败：${error && error.message ? error.message : error}`);
      }
    });
    return { expected: nodes.length, replaced, pixels: totalPixels, dataChars: totalDataChars };
  }

  async function settleCanvasCharts(holder, echartsApi, windowApi) {
    if (echartsApi && typeof echartsApi.getInstanceByDom === 'function') {
      holder.querySelectorAll('.language-echarts[data-processed="true"], .language-mindmap[data-processed="true"]')
        .forEach((node) => {
          try {
            const chart = echartsApi.getInstanceByDom(node);
            if (chart && typeof chart.setOption === 'function') {
              chart.setOption({ animation: false }, { notMerge: false, lazyUpdate: false, silent: true });
            }
          } catch { /* 失败时仍保留当前画布 */ }
        });
    }
    const nextFrame = windowApi && typeof windowApi.requestAnimationFrame === 'function'
      ? () => new Promise((resolve) => windowApi.requestAnimationFrame(resolve))
      : () => new Promise((resolve) => setTimeout(resolve, 16));
    await nextFrame();
    await nextFrame();
  }

  function rasterOptions(options = {}) {
    const positive = (name, fallback) => Number.isFinite(options[name]) && options[name] > 0
      ? options[name] : fallback;
    return {
      maxCount: Math.floor(positive('maxCount', SVG_RASTER_LIMITS.maxCount)),
      maxPixels: Math.floor(positive('maxPixels', SVG_RASTER_LIMITS.maxPixels)),
      maxTotalPixels: Math.floor(positive('maxTotalPixels', SVG_RASTER_LIMITS.maxTotalPixels)),
      maxDimension: Math.floor(positive('maxDimension', SVG_RASTER_LIMITS.maxDimension)),
      maxWidth: Math.floor(positive('maxWidth', SVG_RASTER_LIMITS.maxWidth)),
      maxScale: positive('maxScale', SVG_RASTER_LIMITS.maxScale),
      timeoutMs: Math.floor(positive('timeoutMs', 5000)),
    };
  }

  function computeRasterSize(naturalWidth, naturalHeight, options = {}) {
    const limits = rasterOptions(options);
    const width = Number(naturalWidth);
    const height = Number(naturalHeight);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
    const scale = Math.min(
      limits.maxScale,
      limits.maxWidth / width,
      limits.maxDimension / width,
      limits.maxDimension / height,
      Math.sqrt(limits.maxPixels / (width * height)),
    );
    if (!Number.isFinite(scale) || scale <= 0) return null;
    const output = {
      width: Math.max(1, Math.floor(width * scale)),
      height: Math.max(1, Math.floor(height * scale)),
    };
    if (output.width > limits.maxDimension || output.height > limits.maxDimension
      || output.width * output.height > limits.maxPixels) return null;
    return output;
  }

  function svgViewBox(svg) {
    const base = svg && svg.viewBox && svg.viewBox.baseVal;
    if (base && base.width > 0 && base.height > 0) return { width: base.width, height: base.height };
    const raw = svg && typeof svg.getAttribute === 'function' ? svg.getAttribute('viewBox') : '';
    const parts = String(raw || '').trim().split(/[\s,]+/).map(Number);
    return parts.length === 4 && parts.every(Number.isFinite) && parts[2] > 0 && parts[3] > 0
      ? { width: parts[2], height: parts[3] } : null;
  }

  function prepareSvgRaster(svg, windowApi, options = {}, { useLayout = true } = {}) {
    const rect = useLayout && typeof svg.getBoundingClientRect === 'function' ? svg.getBoundingClientRect() : null;
    const viewBox = svgViewBox(svg);
    const attrWidth = Number.parseFloat(svg.getAttribute('width'));
    const attrHeight = Number.parseFloat(svg.getAttribute('height'));
    const naturalWidth = (rect && rect.width > 0 && rect.width) || (viewBox && viewBox.width)
      || (attrWidth > 0 && attrWidth) || 820;
    const naturalHeight = (rect && rect.height > 0 && rect.height) || (viewBox && viewBox.height)
      || (attrHeight > 0 && attrHeight) || 360;
    const size = computeRasterSize(naturalWidth, naturalHeight, options);
    if (!size) throw new Error('图示尺寸超出安全范围');
    const clone = svg.cloneNode(true);
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    if (!clone.getAttribute('viewBox')) clone.setAttribute('viewBox', `0 0 ${naturalWidth} ${naturalHeight}`);
    // 限制 SVG 自身的固有尺寸，避免 Image 解码阶段先按恶意超大宽高分配内存。
    clone.setAttribute('width', String(size.width));
    clone.setAttribute('height', String(size.height));
    const markup = new windowApi.XMLSerializer().serializeToString(clone);
    return { size, source: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}` };
  }

  function loadRasterImage(source, windowApi, timeoutMs) {
    return new Promise((resolve, reject) => {
      const image = new windowApi.Image();
      let settled = false;
      const finish = (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        image.onload = null;
        image.onerror = null;
        if (error) reject(error);
        else resolve(image);
      };
      const timer = setTimeout(() => {
        try { image.src = ''; } catch { /* 终止解码为 best effort */ }
        finish(new Error('图示栅格化超时'));
      }, Math.max(1, timeoutMs));
      image.onload = () => finish();
      image.onerror = () => finish(new Error('图示解码失败'));
      image.src = source;
    });
  }

  function rasterPng(loaded, size, documentApi, { requireVisibleInk = false } = {}) {
    const canvas = documentApi.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('无法创建安全画布');
    context.drawImage(loaded, 0, 0, size.width, size.height);
    if (requireVisibleInk) {
      if (typeof context.getImageData !== 'function') throw new Error('无法验证公式图像');
      const data = context.getImageData(0, 0, size.width, size.height).data;
      let visible = false;
      for (let index = 0; index < data.length; index += 4) {
        if (data[index + 3] > 8 && (data[index] < 248 || data[index + 1] < 248 || data[index + 2] < 248)) {
          visible = true;
          break;
        }
      }
      if (!visible) throw new Error('公式未生成可见内容');
    }
    const png = canvas.toDataURL('image/png');
    if (!/^data:image\/png;base64,/i.test(png)) throw new Error('画布未生成 PNG');
    return png;
  }

  function explicitStyleValue(node, property) {
    const style = node && node.style;
    if (!style) return '';
    if (typeof style.getPropertyValue === 'function') return style.getPropertyValue(property).trim();
    return '';
  }

  function katexComputedCss(node, windowApi) {
    const computed = windowApi.getComputedStyle(node);
    const declarations = [];
    for (const property of KATEX_RASTER_STYLE_PROPERTIES) {
      let value = String(computed && computed.getPropertyValue(property) || '').trim();
      if (!value) continue;
      const explicit = explicitStyleValue(node, property);
      if (property === 'color') value = explicit || '#1f2328';
      if (/^(?:fill|stroke|border-(?:top|right|bottom|left)-color)$/.test(property)) {
        value = explicit || 'currentColor';
      }
      if (/url\s*\(/i.test(value) || /[{};]/.test(value)) continue;
      declarations.push(`${property}:${value}`);
    }
    return declarations.join(';');
  }

  function inlineKatexComputedStyles(source, clone, windowApi) {
    if (!windowApi || typeof windowApi.getComputedStyle !== 'function') {
      throw new Error('当前环境不支持公式版式固化');
    }
    const sourceNodes = [source, ...Array.from(source.querySelectorAll ? source.querySelectorAll('*') : [])];
    const cloneNodes = [clone, ...Array.from(clone.querySelectorAll ? clone.querySelectorAll('*') : [])];
    if (sourceNodes.length !== cloneNodes.length || sourceNodes.length > MAX_KATEX_RASTER_NODES) {
      throw new Error(`公式节点超出安全上限（${MAX_KATEX_RASTER_NODES}）`);
    }
    for (let index = 0; index < sourceNodes.length; index += 1) {
      if (!cloneNodes[index].style) throw new Error('公式版式不可用');
      cloneNodes[index].style.cssText = katexComputedCss(sourceNodes[index], windowApi);
    }
    clone.style.cssText += ';display:inline-block;position:relative;top:0;right:auto;bottom:auto;left:0;color:#1f2328';
  }

  function katexAccessibleText(formula) {
    const compact = (value) => String(value || '').replace(/\s+/g, ' ').trim();
    const aria = formula && typeof formula.getAttribute === 'function' ? formula.getAttribute('aria-label') : '';
    const math = formula && typeof formula.querySelector === 'function'
      ? formula.querySelector('.katex-mathml math') : null;
    return compact(aria || (math && math.textContent) || (formula && formula.textContent) || '公式').slice(0, 240);
  }

  async function rasterizeKatexFormulas(holder, documentApi, windowApi, options = {}) {
    const formulas = Array.from(holder.querySelectorAll('.katex'));
    if (!formulas.length) return { count: 0, pixels: 0 };
    if (!windowApi || typeof windowApi.XMLSerializer !== 'function' || typeof windowApi.Image !== 'function') {
      throw new Error('当前环境不支持公式静态化');
    }
    const limits = rasterOptions(options);
    if (formulas.length > limits.maxCount) throw new Error(`公式数量超过安全上限（${limits.maxCount}）`);
    const deadline = Date.now() + limits.timeoutMs;
    let pixels = 0;
    let count = 0;
    for (const formula of formulas) {
      try {
        const rect = typeof formula.getBoundingClientRect === 'function' ? formula.getBoundingClientRect() : null;
        const width = rect && Number(rect.width);
        const height = rect && Number(rect.height);
        if (!(width > 0) || !(height > 0)) throw new Error('公式尺寸无效');
        const naturalWidth = width + 4;
        const naturalHeight = height + 4;
        const size = computeRasterSize(naturalWidth, naturalHeight, limits);
        if (!size) throw new Error('公式尺寸超出安全范围');
        const imagePixels = size.width * size.height;
        if (pixels + imagePixels > limits.maxTotalPixels) {
          throw new Error(`公式总像素超过安全上限（${limits.maxTotalPixels}）`);
        }
        const clone = formula.cloneNode(true);
        inlineKatexComputedStyles(formula, clone, windowApi);
        clone.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
        const content = new windowApi.XMLSerializer().serializeToString(clone);
        const markup = [
          `<svg xmlns="http://www.w3.org/2000/svg" width="${size.width}" height="${size.height}"`,
          ` viewBox="0 0 ${naturalWidth} ${naturalHeight}">`,
          `<foreignObject x="2" y="2" width="${width}" height="${height}">${content}</foreignObject></svg>`,
        ].join('');
        if (markup.length > MAX_KATEX_RASTER_SOURCE_CHARS) throw new Error('公式静态源超出安全上限');
        const remaining = deadline - Date.now();
        if (remaining <= 0) throw new Error('公式静态化超时');
        const source = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
        const loaded = await loadRasterImage(source, windowApi, remaining);
        const png = rasterPng(loaded, size, documentApi, { requireVisibleInk: true });
        const image = documentApi.createElement('img');
        image.src = png;
        image.alt = katexAccessibleText(formula);
        image.style.cssText = 'display:inline-block;max-width:100%;height:auto;vertical-align:middle;';
        image.dataset.inkflowStatic = 'katex-image';
        formula.replaceWith(image);
        pixels += imagePixels;
        count += 1;
      } catch (error) {
        throw new Error(`公式 ${count + 1} 静态化失败：${error && error.message ? error.message : error}`);
      }
    }
    return { count, pixels };
  }

  function svgAccessibleText(svg) {
    const compact = (value) => String(value || '').replace(/\s+/g, ' ').trim();
    if (svg && typeof svg.querySelectorAll === 'function') {
      const labels = [];
      const seen = new Set();
      const nodes = svg.querySelectorAll('.nodeLabel, .edgeLabel, .label text, text, [aria-label]');
      for (const node of nodes) {
        const text = compact((typeof node.getAttribute === 'function' && node.getAttribute('aria-label')) || node.textContent);
        if (!text || text.length > 160 || seen.has(text)) continue;
        seen.add(text);
        labels.push(text);
        if (labels.join(' · ').length >= 240) break;
      }
      if (labels.length) return labels.join(' · ').slice(0, 240);
    }
    return compact(svg && svg.textContent).slice(0, 240);
  }

  async function rasterizeInlineSvgs(holder, documentApi, windowApi, options = {}) {
    // Word 必须冻结所有剩余的块级 SVG；KaTeX 的根号等行内 SVG
    // 仍必须保留在公式布局中。其他格式只冻结会依赖 foreignObject/style 的富渲染 SVG。
    const selector = options.rasterizeAllNonKatex
      ? 'svg'
      : '.language-mermaid svg, .language-smiles svg, .language-markmap svg';
    const svgs = Array.from(holder.querySelectorAll(selector)).filter((svg) => (
      !options.rasterizeAllNonKatex
      || typeof svg.closest !== 'function'
      || !svg.closest('.katex, .katex-display, .katex-html, .katex-mathml')
    ));
    if (!svgs.length) return { count: 0, pixels: 0 };
    if (!windowApi || typeof windowApi.XMLSerializer !== 'function' || typeof windowApi.Image !== 'function') {
      throw new Error('当前环境不支持图示静态化');
    }
    const limits = rasterOptions(options);
    if (svgs.length > limits.maxCount) throw new Error(`图示数量超过安全上限（${limits.maxCount}）`);
    const deadline = Date.now() + limits.timeoutMs;
    let pixels = 0;
    let count = 0;
    for (const svg of svgs) {
      try {
        const prepared = prepareSvgRaster(svg, windowApi, limits);
        const imagePixels = prepared.size.width * prepared.size.height;
        if (pixels + imagePixels > limits.maxTotalPixels) {
          throw new Error(`图示总像素超过安全上限（${limits.maxTotalPixels}）`);
        }
        const remaining = deadline - Date.now();
        if (remaining <= 0) throw new Error('图示栅格化超时');
        const loaded = await loadRasterImage(prepared.source, windowApi, remaining);
        const png = rasterPng(loaded, prepared.size, documentApi);
        const image = documentApi.createElement('img');
        image.src = png;
        const sourceText = svgAccessibleText(svg);
        image.alt = svg.getAttribute('aria-label') || svg.getAttribute('title') || sourceText || '图示';
        image.style.cssText = 'display:block;max-width:100%;height:auto;margin:0 auto;';
        image.dataset.inkflowStatic = 'svg-image';
        svg.replaceWith(image);
        pixels += imagePixels;
        count += 1;
      } catch (error) {
        throw new Error(`图示 ${count + 1} 栅格化失败：${error && error.message ? error.message : error}`);
      }
    }
    return { count, pixels };
  }

  async function rasterizeLocalSvgImages(holder, documentApi, windowApi, {
    documentPath, pathApi, loadSvgAsset, timeoutMs = 5000, ...rasterOverrides
  } = {}) {
    if (!windowApi || typeof windowApi.Image !== 'function' || !documentPath || !pathApi
      || typeof loadSvgAsset !== 'function') return;
    const images = Array.from(holder.querySelectorAll('img'))
      .filter((image) => /\.svg(?:[?#].*)?$/i.test(image.getAttribute('data-ink-fixed') || image.getAttribute('src') || ''));
    const limits = rasterOptions({ timeoutMs, ...rasterOverrides });
    const deadline = Date.now() + limits.timeoutMs;
    let pixels = 0;
    let count = 0;
    for (const target of images.slice(0, limits.maxCount)) {
      const original = target.getAttribute('data-ink-fixed') || target.getAttribute('src') || '';
      if (!isLocalReference(original, documentPath)) continue;
      try {
        const absolute = resolveLocalReferencePath(original, documentPath, pathApi);
        if (!absolute) continue;
        const result = await loadSvgAsset(absolute);
        if (!result || !result.ok || typeof result.content !== 'string'
          || typeof windowApi.DOMParser !== 'function' || typeof windowApi.XMLSerializer !== 'function') continue;
        const parsed = new windowApi.DOMParser().parseFromString(result.content, 'image/svg+xml');
        const svg = parsed && parsed.documentElement;
        if (!svg || String(svg.tagName || '').toLowerCase() !== 'svg') continue;
        const prepared = prepareSvgRaster(svg, windowApi, limits, { useLayout: false });
        const imagePixels = prepared.size.width * prepared.size.height;
        if (pixels + imagePixels > limits.maxTotalPixels) continue;
        const remaining = deadline - Date.now();
        if (remaining <= 0) continue;
        const loaded = await loadRasterImage(prepared.source, windowApi, remaining);
        const png = rasterPng(loaded, prepared.size, documentApi);
        target.src = png;
        target.removeAttribute('data-ink-fixed');
        target.dataset.inkflowStatic = 'svg-file-image';
        pixels += imagePixels;
        count += 1;
      } catch { /* 转换失败后恢复相对路径，由主进程拒绝并向用户告警 */ }
    }
    return { count, pixels, rejected: images.length - count };
  }

  function runRenderers(holder, plan, VditorApi, options) {
    const { cdn, theme, math, hljs } = options;
    const safeCall = (fn) => {
      try { fn(); } catch { /* 单个扩展失败不影响正文导出 */ }
    };
    if (plan.includes('code')) {
      if (typeof VditorApi.highlightRender === 'function') {
        safeCall(() => VditorApi.highlightRender(hljs, holder, cdn));
      }
    }
    if (plan.includes('math') && typeof VditorApi.mathRender === 'function') {
      safeCall(() => VditorApi.mathRender(holder, { cdn, math }));
    }
    if (plan.includes('mermaid') && typeof VditorApi.mermaidRender === 'function') {
      safeCall(() => VditorApi.mermaidRender(holder, cdn, theme));
    }
    if (plan.includes('smiles') && typeof VditorApi.SMILESRender === 'function') {
      safeCall(() => VditorApi.SMILESRender(holder, cdn, theme));
    }
    if (plan.includes('markmap') && typeof VditorApi.markmapRender === 'function') {
      safeCall(() => VditorApi.markmapRender(holder, cdn));
    }
    if (plan.includes('chart') && typeof VditorApi.chartRender === 'function') {
      safeCall(() => VditorApi.chartRender(holder, cdn, theme));
    }
    if (plan.includes('mindmap') && typeof VditorApi.mindmapRender === 'function') {
      safeCall(() => VditorApi.mindmapRender(holder, cdn, theme));
    }
  }

  async function renderHtml({
    html,
    documentApi,
    windowApi,
    VditorApi,
    sanitizeHtml,
    cdn = '../node_modules/vditor',
    theme = 'classic',
    math = { inlineDigit: true, engine: 'KaTeX', macros: {} },
    hljs = { enable: true, style: 'github', lineNumber: false },
    timeoutMs = 5000,
    rasterizeSvg = false,
    documentPath = '',
    pathApi = null,
    loadSvgAsset = null,
  }) {
    const sanitize = typeof sanitizeHtml === 'function' ? sanitizeHtml : (value) => String(value || '');
    const initial = sanitize(html);
    const plan = rendererPlan(initial);
    if (!documentApi || !documentApi.body) return sanitize(initial);
    if (plan.length > 0 && !VditorApi) return sanitize(initial);

    const holder = documentApi.createElement('div');
    holder.className = 'vditor-reset inkflow-export-render';
    holder.setAttribute('aria-hidden', 'true');
    // ECharts 通过 innerText 取配置；visibility:hidden 会让 innerText 变空，因此仅用屏外定位 + opacity。
    holder.style.cssText = 'position:fixed;left:-100000px;top:0;width:820px;opacity:0;pointer-events:none;';
    holder.innerHTML = initial;
    documentApi.body.appendChild(holder);
    try {
      validateLayoutBudget(holder);
      await rasterizeLocalSvgImages(holder, documentApi, windowApi, {
        documentPath, pathApi, loadSvgAsset, timeoutMs,
      });
      holder.querySelectorAll('img[data-ink-fixed]').forEach((image) => {
        const original = image.getAttribute('data-ink-fixed');
        if (original) image.setAttribute('src', original);
      });
      if (plan.length > 0) {
        runRenderers(holder, plan, VditorApi, { cdn, theme, math, hljs });
        const rendered = await waitForRender(holder, plan, timeoutMs);
        if (!rendered) throw new Error('富内容渲染超时，请稍后重试或检查图表语法');
        validateLayoutBudget(holder);
      }
      await settleCanvasCharts(holder, windowApi && windowApi.echarts, windowApi);
      validateLayoutBudget(holder);
      freezeCanvasCharts(holder, windowApi && windowApi.echarts, documentApi);
      if (rasterizeSvg) {
        await rasterizeKatexFormulas(holder, documentApi, windowApi, { timeoutMs });
      }
      // 富渲染 SVG 在安全清洗后可能丢失 foreignObject/style；统一冻结成 PNG，
      // 既保留视觉结果，也让主进程只接触经过魔数/尺寸门禁的栅格数据。
      await rasterizeInlineSvgs(holder, documentApi, windowApi, {
        timeoutMs,
        rasterizeAllNonKatex: rasterizeSvg,
      });
      const renderedHtml = sanitize(holder.innerHTML);
      return rasterizeSvg ? prepareWordHtml(renderedHtml, documentApi) : renderedHtml;
    } finally {
      holder.remove();
    }
  }

  return {
    rendererPlan,
    validateLayoutBudget,
    freezeCanvasCharts,
    fileUrl,
    splitLocalReference,
    localReferencePath,
    resolveLocalReferencePath,
    stageLocalImages,
    rewriteLocalImages,
    computeRasterSize,
    rasterizeInlineSvgs,
    rasterizeKatexFormulas,
    rasterizeLocalSvgImages,
    prepareWordHtml,
    renderHtml,
  };
}));
