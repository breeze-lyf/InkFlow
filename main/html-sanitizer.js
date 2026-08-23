'use strict';

const { Parser } = require('htmlparser2');

const HTML_TAGS = new Set([
  'a', 'abbr', 'b', 'bdi', 'bdo', 'blockquote', 'br', 'caption', 'cite', 'code',
  'col', 'colgroup', 'dd', 'del', 'details', 'dfn', 'div', 'dl', 'dt', 'em',
  'figcaption', 'figure', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'i', 'img',
  'ins', 'kbd', 'li', 'mark', 'ol', 'p', 'pre', 'q', 'rp', 'rt', 'ruby', 's',
  'samp', 'section', 'small', 'span', 'strong', 'sub', 'summary', 'sup', 'table',
  'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'u', 'ul', 'var', 'wbr',
]);
const SVG_TAGS = new Set([
  'svg', 'g', 'defs', 'desc', 'title', 'path', 'line', 'polyline', 'polygon',
  'circle', 'ellipse', 'rect', 'text', 'tspan', 'clipPath', 'mask', 'marker',
  'linearGradient', 'radialGradient', 'stop', 'pattern', 'symbol', 'use',
]);
const MATH_TAGS = new Set([
  'math', 'semantics', 'annotation', 'mrow', 'mi', 'mn', 'mo', 'mtext', 'mspace',
  'ms', 'mfrac', 'msqrt', 'mroot', 'mstyle', 'merror', 'mpadded', 'mphantom',
  'mfenced', 'menclose', 'msub', 'msup', 'msubsup', 'munder', 'mover',
  'munderover', 'mmultiscripts', 'mprescripts', 'none', 'mtable', 'mtr', 'mtd',
]);
const ALLOWED_TAGS = new Set([...HTML_TAGS, ...SVG_TAGS, ...MATH_TAGS].map((tag) => tag.toLowerCase()));
const DROP_CONTENT_TAGS = new Set([
  'script', 'style', 'iframe', 'object', 'embed', 'form', 'template', 'noscript',
  'foreignobject', 'animate', 'animatemotion', 'animatetransform', 'set', 'video',
  'audio', 'source', 'track', 'portal', 'frameset', 'frame',
]);
const VOID_TAGS = new Set(['br', 'col', 'hr', 'img', 'wbr']);
const GLOBAL_ATTRIBUTES = new Set([
  'alt', 'class', 'colspan', 'datetime', 'dir', 'height', 'id', 'lang', 'open',
  'rel', 'reversed', 'role', 'rowspan', 'scope', 'span', 'start', 'style', 'target',
  'title', 'type', 'value', 'width', 'wrap',
]);
const SVG_ATTRIBUTES = new Set([
  'alignment-baseline', 'baseline-shift', 'clip-path', 'clip-rule', 'color', 'cx',
  'cy', 'd', 'dominant-baseline', 'dx', 'dy', 'fill', 'fill-opacity', 'fill-rule',
  'font-family', 'font-size', 'font-style', 'font-weight', 'fx', 'fy',
  'gradienttransform', 'gradientunits', 'marker-end', 'marker-mid', 'marker-start',
  'markerheight', 'markerunits', 'markerwidth', 'mask', 'offset', 'opacity',
  'orient', 'overflow', 'pathlength', 'patterncontentunits', 'patterntransform',
  'patternunits', 'points', 'preserveaspectratio', 'r', 'refx', 'refy', 'rx', 'ry',
  'shape-rendering', 'spreadmethod', 'stop-color', 'stop-opacity', 'stroke',
  'stroke-dasharray', 'stroke-dashoffset', 'stroke-linecap', 'stroke-linejoin',
  'stroke-miterlimit', 'stroke-opacity', 'stroke-width', 'text-anchor',
  'text-decoration', 'text-rendering', 'transform', 'vector-effect', 'viewbox',
  'visibility', 'x', 'x1', 'x2', 'xmlns', 'xmlns:xlink', 'y', 'y1', 'y2',
]);
const MATH_ATTRIBUTES = new Set([
  'accent', 'accentunder', 'columnalign', 'columnspacing', 'columnspan', 'displaystyle',
  'encoding', 'fence', 'form', 'frame', 'framespacing', 'linethickness', 'mathbackground',
  'mathcolor', 'mathsize', 'mathvariant', 'maxsize', 'minsize', 'movablelimits',
  'notation', 'rowalign', 'rowspacing', 'rowspan', 'scriptlevel', 'separator',
  'stretchy', 'symmetric', 'voffset',
]);
const ATTRIBUTE_CASE = new Map([
  ['viewbox', 'viewBox'], ['preserveaspectratio', 'preserveAspectRatio'],
  ['gradienttransform', 'gradientTransform'], ['gradientunits', 'gradientUnits'],
  ['markerheight', 'markerHeight'], ['markerunits', 'markerUnits'],
  ['markerwidth', 'markerWidth'], ['patterncontentunits', 'patternContentUnits'],
  ['patterntransform', 'patternTransform'], ['patternunits', 'patternUnits'],
  ['refx', 'refX'], ['refy', 'refY'], ['spreadmethod', 'spreadMethod'],
]);
const IRI_ATTRIBUTES = new Set(['clip-path', 'mask', 'marker-end', 'marker-mid', 'marker-start']);
const MAX_HTML_TAGS = 100000;
const MAX_HTML_DEPTH = 2048;

function safeLocalIri(value) {
  const raw = String(value == null ? '' : value).trim();
  return /^url\(\s*#[A-Za-z_][\w:.-]*\s*\)$/i.test(raw) ? raw : '';
}

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function safeStyle(value) {
  const css = String(value == null ? '' : value).trim();
  if (!css) return '';
  if (/[\\@]|\/\*|\*\/|[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(css)) return '';
  if (/(?:url|image-set|expression)\s*\(|(?:-moz-binding|behavior)\s*:/i.test(css)) return '';
  for (const declaration of css.split(';')) {
    const separator = declaration.indexOf(':');
    if (separator < 0) continue;
    const property = declaration.slice(0, separator).trim().toLowerCase();
    const candidate = declaration.slice(separator + 1).trim();
    if (!property || property.startsWith('--')) return '';
    if (/(?:var|attr|env)\s*\(/i.test(candidate)) return '';
    const allNumbers = candidate.match(/[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:e[+-]?\d+)?/gi) || [];
    if (allNumbers.some((number) => !Number.isFinite(Number(number)) || Math.abs(Number(number)) > 4096)) return '';
    if (/^(?:width|height|min-width|min-height|max-width|max-height|font-size|line-height|padding(?:-(?:top|right|bottom|left))?|margin(?:-(?:top|right|bottom|left))?|top|right|bottom|left)$/.test(property)
      && !safeLayoutValue(property, candidate)) return '';
    if (property === 'transform' && !safeTransform(candidate)) return '';
    if (property === 'zoom' && !safeZoom(candidate)) return '';
  }
  return css;
}

function safeLengthToken(token, { allowAuto = false, allowUnitless = false } = {}) {
  const raw = String(token || '').trim().toLowerCase();
  if (allowAuto && /^(?:auto|none|normal|initial|inherit|unset)$/.test(raw)) return true;
  const match = /^([+-]?(?:\d+(?:\.\d+)?|\.\d+))(px|%|em|rem|pt|pc|cm|mm|in)?$/.exec(raw);
  if (!match) return false;
  const number = Number(match[1]);
  const unit = match[2] || '';
  if (!Number.isFinite(number) || (!allowUnitless && !unit && number !== 0)) return false;
  if (unit === '%' && Math.abs(number) > 100) return false;
  if ((unit === 'em' || unit === 'rem') && Math.abs(number) > 64) return false;
  const pixels = unit === '%' ? Math.abs(number) * 16.384
    : unit === 'em' || unit === 'rem' ? Math.abs(number) * 16
      : unit === 'pt' ? Math.abs(number) * (4 / 3)
        : unit === 'pc' ? Math.abs(number) * 16
          : unit === 'cm' ? Math.abs(number) * (96 / 2.54)
            : unit === 'mm' ? Math.abs(number) * (96 / 25.4)
              : unit === 'in' ? Math.abs(number) * 96
                : Math.abs(number);
  return pixels <= 16384;
}

function safeLayoutValue(property, value) {
  if (!value || /(?:calc|min|max|clamp|var|attr|env)\s*\(/i.test(value)) return false;
  const tokens = value.split(/\s+/).filter(Boolean);
  if (!tokens.length || tokens.length > 4) return false;
  const isSpacing = /^(?:padding|margin)(?:-|$)/.test(property);
  const allowAuto = /^(?:width|height|min-width|min-height|max-width|max-height|margin|top|right|bottom|left)/.test(property);
  const allowUnitless = property === 'line-height';
  if (property === 'line-height' && tokens.some((token) => /^[-+]?\d/.test(token)
    && !/[A-Za-z%]/.test(token) && Math.abs(Number(token)) > 10)) return false;
  return tokens.every((token) => safeLengthToken(token, {
    allowAuto: allowAuto || (isSpacing && property.startsWith('margin')),
    allowUnitless,
  }));
}

function safeTransform(value) {
  const raw = String(value == null ? '' : value).trim();
  if (raw.toLowerCase() === 'none') return raw;
  if (!raw || /[\\]|\/\*|\*\/|(?:calc|min|max|clamp|var|attr|env)\s*\(/i.test(raw)) return '';
  const functions = /([A-Za-z]+)\(([^()]*)\)/g;
  let cursor = 0;
  let matched = false;
  let match;
  while ((match = functions.exec(raw))) {
    if (raw.slice(cursor, match.index).trim()) return '';
    cursor = functions.lastIndex;
    matched = true;
    const name = match[1].toLowerCase();
    if (!['matrix', 'translate', 'translatex', 'translatey', 'scale', 'scalex', 'scaley', 'rotate', 'skewx', 'skewy'].includes(name)) return '';
    const args = match[2].trim().split(/[\s,]+/).filter(Boolean);
    if (!args.length || args.some((arg) => !/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:px|%|deg|rad|turn)?$/i.test(arg))) return '';
    const numbers = args.map(Number.parseFloat);
    if (numbers.some((number) => !Number.isFinite(number))) return '';
    if (/^scale/.test(name) && numbers.some((number) => Math.abs(number) > 16)) return '';
    if (name === 'matrix' && (numbers.length !== 6
      || numbers.slice(0, 4).some((number) => Math.abs(number) > 16)
      || numbers.slice(4).some((number) => Math.abs(number) > 20000))) return '';
    if (/^translate/.test(name) && numbers.some((number) => Math.abs(number) > 20000)) return '';
    if (/^(?:rotate|skew)/.test(name) && numbers.some((number) => Math.abs(number) > 36000)) return '';
  }
  return matched && !raw.slice(cursor).trim() ? raw : '';
}

function safeZoom(value) {
  const match = /^([+]?(?:\d+(?:\.\d+)?|\.\d+))(%)?$/.exec(String(value || '').trim());
  if (!match) return '';
  const zoom = Number(match[1]) / (match[2] ? 100 : 1);
  return Number.isFinite(zoom) && zoom >= 0.1 && zoom <= 8 ? String(value).trim() : '';
}

function safePaint(value) {
  const raw = String(value == null ? '' : value).trim();
  if (!raw || /[\\]|\/\*|\*\/|[\u0000-\u001f\u007f]/.test(raw)) return '';
  if (/[()]/.test(raw)) return safeLocalIri(raw);
  return raw;
}

function safeDimension(value) {
  const raw = String(value == null ? '' : value).trim();
  const match = /^(\d+(?:\.\d+)?)(?:px|%)?$/i.exec(raw);
  if (!match) return '';
  const number = Number(match[1]);
  const limit = raw.endsWith('%') ? 1000 : 16384;
  return Number.isFinite(number) && number <= limit ? raw : '';
}

function safeLinkUrl(value) {
  const raw = String(value == null ? '' : value).trim();
  if (!raw) return '';
  const compact = raw.replace(/[\u0000-\u0020\u007f]+/g, '');
  if (/^(?:https?:|mailto:|tel:|#)/i.test(compact)) return raw;
  if (/^[a-z][a-z0-9+.-]*:/i.test(compact) || compact.startsWith('//')) return '';
  return raw;
}

function allowedAttribute(name) {
  return GLOBAL_ATTRIBUTES.has(name)
    || SVG_ATTRIBUTES.has(name)
    || MATH_ATTRIBUTES.has(name)
    || name === 'href'
    || name === 'src'
    || name === 'xlink:href'
    || name.startsWith('aria-')
    || name.startsWith('data-');
}

function sanitizeAttributes(tag, attributes, options) {
  const safe = Object.create(null);
  for (const [rawName, rawValue] of Object.entries(attributes || {})) {
    const name = rawName.toLowerCase();
    if (!allowedAttribute(name) || name.startsWith('on') || name === 'srcdoc') continue;
    let value = String(rawValue == null ? '' : rawValue);
    if (name === 'style') {
      value = safeStyle(value);
      if (!value) continue;
    }
    if (name === 'width' || name === 'height') {
      value = safeDimension(value);
      if (!value) continue;
    }
    if (IRI_ATTRIBUTES.has(name)) {
      value = safeLocalIri(value);
      if (!value) continue;
    }
    if (name === 'fill' || name === 'stroke') {
      value = safePaint(value);
      if (!value) continue;
    }
    if (name === 'transform') {
      value = safeTransform(value);
      if (!value) continue;
    }
    if (name === 'href' || name === 'xlink:href') {
      if (tag === 'image' && typeof options.resolveSvgImage === 'function') {
        const result = options.resolveSvgImage(value);
        value = result && typeof result.src === 'string' ? result.src : '';
        if (!value) continue;
      } else if (tag === 'use') {
        if (!/^#[A-Za-z_][\w:.-]*$/.test(value.trim())) continue;
      } else {
        value = safeLinkUrl(value);
        if (!value) continue;
      }
    }
    if (name === 'src') {
      if (tag !== 'img' || typeof options.resolveImage !== 'function') continue;
      const result = options.resolveImage(value);
      value = result && typeof result.src === 'string' ? result.src : '';
      if (!value) continue;
    }
    safe[ATTRIBUTE_CASE.get(name) || name] = value;
  }
  if (tag === 'a' && safe.target === '_blank') safe.rel = 'noopener noreferrer';
  return safe;
}

function serializeAttributes(attributes) {
  return Object.entries(attributes)
    .map(([name, value]) => ` ${name}="${escapeHtml(value)}"`)
    .join('');
}

function sanitizeExportHtml(html, options = {}) {
  const maxTags = Number.isSafeInteger(options.maxTags) && options.maxTags > 0
    ? Math.min(options.maxTags, MAX_HTML_TAGS) : MAX_HTML_TAGS;
  const budgetLabel = typeof options.budgetLabel === 'string' && options.budgetLabel.trim()
    ? options.budgetLabel.trim() : '导出';
  let output = '';
  let blockedDepth = 0;
  let svgDepth = 0;
  let tagCount = 0;
  const stack = [];
  const parser = new Parser({
    onopentag(rawName, attributes) {
      tagCount += 1;
      if (tagCount > maxTags) throw new Error(`${budgetLabel}元素数量超过安全上限（${maxTags}）`);
      if (stack.length >= MAX_HTML_DEPTH) throw new Error(`导出 HTML 嵌套层级超过安全上限（${MAX_HTML_DEPTH}）`);
      const name = String(rawName).toLowerCase();
      const svgStyle = blockedDepth === 0 && svgDepth > 0 && name === 'style'
        && typeof options.sanitizeSvgStyle === 'function';
      if (svgStyle) {
        stack.push({ name, blocked: false, emitted: false, svgStyle: true, text: '' });
        return;
      }
      if (blockedDepth > 0 || DROP_CONTENT_TAGS.has(name)) {
        stack.push({ name, blocked: true, emitted: false });
        blockedDepth += 1;
        return;
      }
      if (name === 'input') {
        const type = String(attributes.type || '').trim().toLowerCase();
        if (type === 'checkbox') {
          output += Object.prototype.hasOwnProperty.call(attributes, 'checked') ? '☑' : '☐';
        }
        stack.push({ name, blocked: false, emitted: false });
        return;
      }
      const svgImage = name === 'image' && typeof options.resolveSvgImage === 'function';
      if (!ALLOWED_TAGS.has(name) && !svgImage) {
        stack.push({ name, blocked: false, emitted: false });
        return;
      }
      const canonicalTag = [...SVG_TAGS, ...MATH_TAGS].find((tag) => tag.toLowerCase() === name) || name;
      const safeAttributes = sanitizeAttributes(name, attributes, options);
      output += `<${canonicalTag}${serializeAttributes(safeAttributes)}>`;
      stack.push({ name, canonicalTag, blocked: false, emitted: true });
      if (canonicalTag === 'svg') svgDepth += 1;
    },
    ontext(text) {
      const current = stack[stack.length - 1];
      if (blockedDepth === 0 && current && current.svgStyle) current.text += text;
      else if (blockedDepth === 0) output += escapeHtml(text);
    },
    onclosetag(rawName) {
      const name = String(rawName).toLowerCase();
      let entry = stack.pop();
      if (!entry) return;
      // htmlparser2 emits balanced close events, including implicit closes. A defensive
      // search keeps malformed markup from closing an unrelated allowed element.
      if (entry.name !== name) {
        const index = stack.map((item) => item.name).lastIndexOf(name);
        if (index >= 0) {
          stack.push(entry);
          entry = stack.splice(index, 1)[0];
        }
      }
      if (entry.blocked) {
        blockedDepth = Math.max(0, blockedDepth - 1);
        return;
      }
      if (entry.svgStyle) {
        const css = options.sanitizeSvgStyle(entry.text);
        if (css) output += `<style>${escapeHtml(css)}</style>`;
        return;
      }
      if (entry.emitted && entry.canonicalTag === 'svg') svgDepth = Math.max(0, svgDepth - 1);
      if (blockedDepth === 0 && entry.emitted && !VOID_TAGS.has(entry.name)) {
        output += `</${entry.canonicalTag}>`;
      }
    },
  }, {
    decodeEntities: true,
    lowerCaseTags: true,
    lowerCaseAttributeNames: true,
    recognizeSelfClosing: true,
  });
  parser.end(String(html == null ? '' : html));
  return output;
}

module.exports = { MAX_HTML_DEPTH, MAX_HTML_TAGS, escapeHtml, safeStyle, sanitizeExportHtml };
