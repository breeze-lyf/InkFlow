'use strict';

const fs = require('fs');
const path = require('path');
const { sanitizeExportHtml } = require('./html-sanitizer');
const { decodeRasterDataUrl } = require('./export-security');

const MAX_SVG_BYTES = 2 * 1024 * 1024;
const MAX_SVG_STYLE_BYTES = 256 * 1024;
const SVG_DRAWABLE = /<(?:path|line|polyline|polygon|circle|ellipse|rect|text|use)\b/i;
const SVG_STYLE_PROPERTIES = new Set([
  'alignment-baseline', 'baseline-shift', 'clip-path', 'clip-rule', 'color',
  'display', 'dominant-baseline', 'fill', 'fill-opacity', 'fill-rule',
  'font-family', 'font-size', 'font-style', 'font-weight', 'letter-spacing',
  'marker-end', 'marker-mid', 'marker-start', 'mask', 'opacity', 'paint-order',
  'shape-rendering', 'stop-color', 'stop-opacity', 'stroke', 'stroke-dasharray',
  'stroke-dashoffset', 'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit',
  'stroke-opacity', 'stroke-width', 'text-anchor', 'text-decoration',
  'text-rendering', 'vector-effect', 'visibility', 'word-spacing',
]);

function safeSvgSelector(selector) {
  const part = String(selector || '').trim();
  if (!part || part.length > 256) return false;
  return part.split(',').every((item) => {
    const compact = item.trim();
    return /^(?:[A-Za-z_][\w-]*)?(?:[.#][A-Za-z_][\w-]*)?$/.test(compact)
      && /[A-Za-z_]/.test(compact);
  });
}

function safeSvgCss(value) {
  const css = String(value == null ? '' : value).trim();
  if (!css || Buffer.byteLength(css, 'utf8') > MAX_SVG_STYLE_BYTES) return '';
  if (/[\\@<>]|\/\*|\*\/|[\u0000-\u001f\u007f]/.test(css)) return '';
  const rule = /([^{}]+)\{([^{}]*)\}/g;
  const output = [];
  let cursor = 0;
  let match;
  while ((match = rule.exec(css))) {
    if (css.slice(cursor, match.index).trim() || !safeSvgSelector(match[1])) return '';
    cursor = rule.lastIndex;
    const declarations = [];
    for (const raw of match[2].split(';')) {
      if (!raw.trim()) continue;
      const separator = raw.indexOf(':');
      if (separator <= 0) return '';
      const property = raw.slice(0, separator).trim().toLowerCase();
      const candidate = raw.slice(separator + 1).trim();
      if (!SVG_STYLE_PROPERTIES.has(property) || !candidate) return '';
      if (/(?:expression|image-set|var|attr|env)\s*\(/i.test(candidate)) return '';
      const urls = candidate.match(/url\([^)]*\)/gi) || [];
      if (urls.some((url) => !/^url\(\s*#[A-Za-z_][\w:.-]*\s*\)$/i.test(url))) return '';
      const withoutLocalIri = candidate.replace(/url\(\s*#[A-Za-z_][\w:.-]*\s*\)/gi, '');
      const functions = withoutLocalIri.match(/[A-Za-z_-]+\s*\(/g) || [];
      if (functions.some((name) => !/^(?:rgb|rgba|hsl|hsla)\s*\($/i.test(name))) return '';
      const numbers = candidate.match(/[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:e[+-]?\d+)?/gi) || [];
      if (numbers.some((number) => !Number.isFinite(Number(number)) || Math.abs(Number(number)) > 4096)) return '';
      if (/[{};]/.test(candidate)) return '';
      declarations.push(`${property}:${candidate}`);
    }
    if (declarations.length) output.push(`${match[1].trim()}{${declarations.join(';')}}`);
  }
  if (!output.length || css.slice(cursor).trim()) return '';
  return output.join('');
}

function readSafeSvgAsset(file, { pathGrants, fsImpl = fs } = {}) {
  if (typeof file !== 'string' || path.extname(file).toLowerCase() !== '.svg'
    || !pathGrants || typeof pathGrants.allows !== 'function' || !pathGrants.allows(file, 'asset')) {
    return { ok: false, error: 'SVG 路径未授权' };
  }
  let stat;
  try { stat = fsImpl.lstatSync(file); } catch { return { ok: false, error: 'SVG 文件不可用' }; }
  if (!stat.isFile() || stat.size > MAX_SVG_BYTES) return { ok: false, error: 'SVG 文件无效或过大' };
  let source;
  try { source = fsImpl.readFileSync(file, 'utf8'); } catch { return { ok: false, error: 'SVG 文件不可用' }; }
  let content;
  try {
    content = sanitizeExportHtml(source, {
      sanitizeSvgStyle: safeSvgCss,
      resolveSvgImage(src) {
        const result = decodeRasterDataUrl(src, MAX_SVG_BYTES);
        return result.src ? { src: result.src } : { src: null };
      },
    });
  } catch (error) {
    return { ok: false, error: error && error.message ? error.message : 'SVG 内容无效' };
  }
  if (!/^\s*<svg(?:\s|>)/i.test(content)) return { ok: false, error: 'SVG 内容无效' };
  const hasEmbeddedImage = /<image\b[^>]*(?:href|xlink:href)="data:image\/(?:png|jpe?g|gif|webp|bmp);base64,/i.test(content);
  if (!SVG_DRAWABLE.test(content) && !hasEmbeddedImage) {
    return { ok: false, error: 'SVG 不含可安全导出的可视内容' };
  }
  return { ok: true, content };
}

module.exports = { MAX_SVG_BYTES, readSafeSvgAsset, safeSvgCss };
