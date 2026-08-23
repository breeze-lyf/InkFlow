// Export HTML safety helpers shared by the renderer and Node tests.
(function initExportSafety(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ExportSafety = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  'use strict';

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
    'circle', 'ellipse', 'rect', 'text', 'tspan', 'clippath', 'mask', 'marker',
    'lineargradient', 'radialgradient', 'stop', 'pattern', 'symbol', 'use',
  ]);
  const MATH_TAGS = new Set([
    'math', 'semantics', 'annotation', 'mrow', 'mi', 'mn', 'mo', 'mtext', 'mspace',
    'ms', 'mfrac', 'msqrt', 'mroot', 'mstyle', 'merror', 'mpadded', 'mphantom',
    'mfenced', 'menclose', 'msub', 'msup', 'msubsup', 'munder', 'mover',
    'munderover', 'mmultiscripts', 'mprescripts', 'none', 'mtable', 'mtr', 'mtd',
  ]);
  const ALLOWED_TAGS = new Set([...HTML_TAGS, ...SVG_TAGS, ...MATH_TAGS]);
  const DROP_CONTENT_TAGS = new Set([
    'script', 'style', 'iframe', 'object', 'embed', 'form', 'template', 'noscript',
    'foreignobject', 'animate', 'animatemotion', 'animatetransform', 'set', 'video',
    'audio', 'source', 'track', 'portal', 'frameset', 'frame', 'link', 'meta', 'base',
  ]);
  const GLOBAL_ATTRIBUTES = new Set([
    'alt', 'class', 'colspan', 'datetime', 'dir', 'height', 'id', 'lang', 'open',
    'rel', 'reversed', 'role', 'rowspan', 'scope', 'span', 'start', 'style', 'target',
    'title', 'type', 'value', 'width', 'wrap',
  ]);
  const PRESENTATION_ATTRIBUTES = new Set([
    'accent', 'accentunder', 'alignment-baseline', 'baseline-shift', 'clip-path',
    'clip-rule', 'color', 'columnalign', 'columnspacing', 'columnspan', 'cx', 'cy',
    'd', 'displaystyle', 'dominant-baseline', 'dx', 'dy', 'encoding', 'fence',
    'fill', 'fill-opacity', 'fill-rule', 'font-family', 'font-size', 'font-style',
    'font-weight', 'form', 'frame', 'framespacing', 'fx', 'fy', 'gradienttransform',
    'gradientunits', 'linethickness', 'marker-end', 'marker-mid', 'marker-start',
    'markerheight', 'markerunits', 'markerwidth', 'mask', 'mathbackground',
    'mathcolor', 'mathsize', 'mathvariant', 'maxsize', 'minsize', 'movablelimits',
    'notation', 'offset', 'opacity', 'orient', 'overflow', 'pathlength',
    'patterncontentunits', 'patterntransform', 'patternunits', 'points',
    'preserveaspectratio', 'r', 'refx', 'refy', 'rowalign', 'rowspacing', 'rx', 'ry',
    'scriptlevel', 'separator', 'shape-rendering', 'spreadmethod', 'stop-color',
    'stop-opacity', 'stroke', 'stroke-dasharray', 'stroke-dashoffset',
    'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit', 'stroke-opacity',
    'stroke-width', 'stretchy', 'symmetric', 'text-anchor', 'text-decoration',
    'text-rendering', 'transform', 'vector-effect', 'viewbox', 'visibility',
    'voffset', 'x', 'x1', 'x2', 'xmlns', 'xmlns:xlink', 'y', 'y1', 'y2',
  ]);
  const IRI_ATTRIBUTES = new Set(['clip-path', 'mask', 'marker-end', 'marker-mid', 'marker-start']);

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

  function isSafeUrl(value, kind = 'link', options = {}) {
    const raw = String(value == null ? '' : value).trim();
    if (!raw) return true;
    const compact = raw.replace(/[\u0000-\u0020\u007f]+/g, '');
    if (kind === 'image') {
      if (/^data:image\/(?:png|jpe?g|gif|webp|bmp);base64,/i.test(compact)) return true;
      if (/^file:/i.test(compact)) return options.allowFileImages === true;
      return !/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(compact);
    }
    if (/^(?:https?:|mailto:|tel:|#)/i.test(compact)) return true;
    return !/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(compact);
  }

  function allowedAttribute(name) {
    return GLOBAL_ATTRIBUTES.has(name)
      || PRESENTATION_ATTRIBUTES.has(name)
      || name === 'href'
      || name === 'src'
      || name === 'xlink:href'
      || name.startsWith('aria-')
      || name.startsWith('data-');
  }

  function safeLocalIri(value) {
    const raw = String(value == null ? '' : value).trim();
    return /^url\(\s*#[A-Za-z_][\w:.-]*\s*\)$/i.test(raw) ? raw : '';
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

  function sanitizeElement(node, options) {
    const tag = String(node.localName || node.tagName || '').toLowerCase();
    if (tag === 'input') {
      const type = String(node.getAttribute('type') || '').trim().toLowerCase();
      if (type === 'checkbox') {
        const marker = node.ownerDocument.createTextNode(node.hasAttribute('checked') ? '☑' : '☐');
        node.replaceWith(marker);
      } else {
        node.remove();
      }
      return;
    }
    if (DROP_CONTENT_TAGS.has(tag)) {
      node.remove();
      return;
    }
    if (!ALLOWED_TAGS.has(tag)) {
      const children = Array.from(node.childNodes || []);
      children.forEach((child) => sanitizeNode(child, options));
      node.replaceWith(...Array.from(node.childNodes || []));
      return;
    }

    Array.from(node.attributes || []).forEach((attr) => {
      const name = attr.name.toLowerCase();
      if (!allowedAttribute(name) || name.startsWith('on') || name === 'srcdoc') {
        node.removeAttribute(attr.name);
        return;
      }
      if (name === 'style' && !safeStyle(attr.value)) {
        node.removeAttribute(attr.name);
        return;
      }
      if ((name === 'width' || name === 'height') && !safeDimension(attr.value)) {
        node.removeAttribute(attr.name);
        return;
      }
      if (IRI_ATTRIBUTES.has(name) && !safeLocalIri(attr.value)) {
        node.removeAttribute(attr.name);
        return;
      }
      if ((name === 'fill' || name === 'stroke') && !safePaint(attr.value)) {
        node.removeAttribute(attr.name);
        return;
      }
      if (name === 'transform' && !safeTransform(attr.value)) {
        node.removeAttribute(attr.name);
        return;
      }
      if (name === 'src' && (tag !== 'img' || !isSafeUrl(attr.value, 'image', options))) {
        node.removeAttribute(attr.name);
        return;
      }
      if (name === 'href' || name === 'xlink:href') {
        const safe = tag === 'use'
          ? /^#[A-Za-z_][\w:.-]*$/.test(attr.value.trim())
          : isSafeUrl(attr.value, 'link', options);
        if (!safe) node.removeAttribute(attr.name);
      }
    });
    if (tag === 'a' && node.getAttribute('target') === '_blank') {
      node.setAttribute('rel', 'noopener noreferrer');
    }
    Array.from(node.childNodes || []).forEach((child) => sanitizeNode(child, options));
  }

  function sanitizeNode(node, options) {
    if (!node) return;
    if (node.nodeType === 1) sanitizeElement(node, options);
    else if (node.nodeType === 8) node.remove();
  }

  function sanitizeFragment(fragment, options = {}) {
    if (!fragment || !fragment.childNodes) return fragment;
    Array.from(fragment.childNodes).forEach((node) => sanitizeNode(node, options));
    return fragment;
  }

  function nodeSanitize(html, options) {
    // Node tests and the main process use the same real parser. No regex fallback is
    // allowed here: malformed markup must never be able to manufacture a new tag.
    const { sanitizeExportHtml } = require('../../main/html-sanitizer');
    return sanitizeExportHtml(html, {
      resolveImage(src) {
        return isSafeUrl(src, 'image', options) ? { src } : { src: null };
      },
    });
  }

  function sanitizeHtml(html, options = {}) {
    if (typeof document === 'undefined' || typeof document.createElement !== 'function') {
      return nodeSanitize(html, options);
    }
    const template = document.createElement('template');
    template.innerHTML = String(html == null ? '' : html);
    sanitizeFragment(template.content, options);
    return template.innerHTML;
  }

  return { escapeHtml, isSafeUrl, sanitizeFragment, sanitizeHtml };
}));
