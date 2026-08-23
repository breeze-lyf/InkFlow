'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const HTMLtoDOCX = require('html-to-docx');
const JSZip = require('jszip');

const ExportRenderer = require('../renderer/js/export-renderer');

const TINY_PNG_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

test('plans every bundled rich renderer represented in generated HTML', () => {
  const html = [
    '<code class="language-js">const x = 1</code>',
    '<span class="language-math">x^2</span>',
    '<div class="language-mermaid">graph TD;A-->B</div>',
    '<div class="language-smiles">CCO</div>',
    '<div class="language-markmap"># Root</div>',
    '<div class="language-echarts">{}</div>',
    '<div class="language-mindmap" data-code="%7B%7D"></div>',
  ].join('');

  assert.deepEqual(ExportRenderer.rendererPlan(html), [
    'code', 'math', 'mermaid', 'smiles', 'markmap', 'chart', 'mindmap',
  ]);
});

test('rewrites only relative document images to canonical file URLs', () => {
  const fakePath = {
    dirname: () => '/Users/demo/notes',
    resolve: (dir, rel) => `${dir}/${rel}`.replace('/./', '/'),
  };
  const html = [
    '<img src="assets/my image.png">',
    '<img src="https://example.com/a.png">',
    '<img src="data:image/png;base64,AAAA">',
  ].join('');

  const result = ExportRenderer.rewriteLocalImages(html, '/Users/demo/notes/doc.md', fakePath);

  assert.match(result, /src="file:\/\/\/Users\/demo\/notes\/assets\/my%20image\.png"/);
  assert.match(result, /src="https:\/\/example\.com\/a\.png"/);
  assert.match(result, /src="data:image\/png;base64,AAAA"/);
});

test('malformed percent escapes in image names cannot abort export', () => {
  const fakePath = {
    dirname: () => '/tmp',
    resolve: (dir, rel) => `${dir}/${rel}`,
  };

  assert.doesNotThrow(() => ExportRenderer.rewriteLocalImages(
    '<img src="bad%name.png">', '/tmp/doc.md', fakePath,
  ));
});

test('uses a valid local file URL for Windows drive paths', () => {
  const fakePath = {
    dirname: () => 'C:/Notes',
    resolve: (dir, rel) => `${dir}/${rel}`,
  };

  const result = ExportRenderer.rewriteLocalImages(
    '<img src="assets/a.png">', 'C:/Notes/doc.md', fakePath,
  );

  assert.match(result, /src="file:\/\/\/C:\/Notes\/assets\/a\.png"/);
});

test('local image rewriting decodes HTML entities before resolving the filesystem path', () => {
  const fakePath = {
    dirname: () => '/Users/demo/notes',
    resolve: (dir, rel) => `${dir}/${rel}`,
  };

  const result = ExportRenderer.rewriteLocalImages(
    '<img src="assets/a&amp;b.png">', '/Users/demo/notes/doc.md', fakePath,
  );

  assert.match(result, /src="file:\/\/\/Users\/demo\/notes\/assets\/a%26b\.png"/);
  assert.doesNotMatch(result, /%26amp%3B/);
});

test('local SVG query and fragment suffixes are not treated as part of the filename', () => {
  const fakePath = {
    dirname: () => '/Users/demo/notes',
    resolve: (dir, rel) => `${dir}/${rel}`,
  };

  const result = ExportRenderer.rewriteLocalImages([
    '<img src="icons.svg#check">',
    '<img src="diagram.svg?theme=dark">',
  ].join(''), '/Users/demo/notes/doc.md', fakePath);

  assert.match(result, /src="file:\/\/\/Users\/demo\/notes\/icons\.svg#check"/);
  assert.match(result, /src="file:\/\/\/Users\/demo\/notes\/diagram\.svg\?theme=dark"/);
  assert.doesNotMatch(result, /icons\.svg%23|diagram\.svg%3F/);
});

test('file URL paths are decoded exactly once before SVG filesystem access', () => {
  const encodedPath = ExportRenderer.localReferencePath('file:///tmp/a%2520.svg#icon');
  assert.equal(encodedPath, '/tmp/a%2520.svg');
  assert.equal(decodeURIComponent(encodedPath), '/tmp/a%20.svg');
});

test('file URLs and Windows UNC references resolve through the guarded asset path', () => {
  const fakePath = {
    dirname: (value) => value.replace(/[/\\][^/\\]+$/, ''),
    resolve: (dir, rel) => (/^(?:[A-Za-z]:[\\/]|[/\\]{1,2})/.test(rel) ? rel : `${dir}/${rel}`),
  };

  assert.equal(
    ExportRenderer.resolveLocalReferencePath(
      'file:///Users/demo/assets/a%26b.png#preview', '/Users/demo/doc.md', fakePath,
    ),
    '/Users/demo/assets/a&b.png',
  );
  assert.equal(
    ExportRenderer.resolveLocalReferencePath('//server/share/a.png', 'C:/Notes/doc.md', fakePath),
    '//server/share/a.png',
  );
  assert.equal(
    ExportRenderer.resolveLocalReferencePath('//cdn.example.com/a.png', '/Users/demo/doc.md', fakePath),
    '',
  );
});

test('stages Windows and entity-containing local images across the initial sanitizer pass', () => {
  const staged = ExportRenderer.stageLocalImages([
    '<img src="C:/Pics/a.png">',
    '<img src="assets/a&amp;b.png">',
  ].join(''));

  assert.match(staged, /data-ink-fixed="C:\/Pics\/a\.png"/);
  assert.match(staged, /data-ink-fixed="assets\/a&amp;b\.png"/);
  assert.doesNotMatch(staged, /\ssrc=/);
});

test('file URLs encode path delimiters that would otherwise become URL fragments or queries', () => {
  assert.equal(
    ExportRenderer.fileUrl('/Users/demo/A #1?/image 1.png'),
    'file:///Users/demo/A%20%231%3F/image%201.png',
  );
  assert.equal(
    ExportRenderer.fileUrl('C:\\Notes\\A#1?\\image.png'),
    'file:///C:/Notes/A%231%3F/image.png',
  );
});

test('file URLs preserve UNC authority and encode share path segments', () => {
  assert.equal(
    ExportRenderer.fileUrl('\\\\server\\team share\\A#1?.png'),
    'file://server/team%20share/A%231%3F.png',
  );
});

test('SVG raster dimensions stay inside per-image pixel and dimension budgets', () => {
  const size = ExportRenderer.computeRasterSize(12000, 12000);

  assert.equal(size.width <= 8192, true);
  assert.equal(size.height <= 8192, true);
  assert.equal(size.width * size.height <= 8 * 1024 * 1024, true);
  assert.equal(ExportRenderer.computeRasterSize(0, 100), null);
  assert.equal(ExportRenderer.computeRasterSize(Number.POSITIVE_INFINITY, 100), null);
});

test('rendered export layout fails closed before extreme DOM dimensions or node counts reach Chromium', () => {
  assert.throws(
    () => ExportRenderer.validateLayoutBudget({
      scrollWidth: 20000,
      scrollHeight: 100,
      querySelectorAll: () => ({ length: 1 }),
    }),
    /布局宽度超过安全上限/,
  );
  assert.throws(
    () => ExportRenderer.validateLayoutBudget({
      scrollWidth: 820,
      scrollHeight: 100,
      querySelectorAll: () => ({ length: 100001 }),
    }),
    /元素数量超过安全上限/,
  );
});

test('processed canvas charts must freeze to PNG or abort the export', () => {
  const node = {
    classList: { contains: () => false },
    replaceChildren() {},
    style: {},
    dataset: {},
  };
  const holder = { querySelectorAll: () => [node] };
  const documentApi = { createElement: () => ({ style: {} }) };

  assert.throws(
    () => ExportRenderer.freezeCanvasCharts(holder, { getInstanceByDom: () => null }, documentApi),
    /图表 1 静态化失败.*实例不可用/,
  );
  assert.throws(
    () => ExportRenderer.freezeCanvasCharts(holder, {
      getInstanceByDom: () => ({ getDataURL: () => 'data:image/svg+xml;base64,AAAA' }),
    }, documentApi),
    /图表 1 静态化失败.*未生成 PNG\/JPEG/,
  );

  let requested = false;
  const hugeNode = {
    ...node,
    getBoundingClientRect: () => ({ width: 5000, height: 5000 }),
  };
  assert.throws(
    () => ExportRenderer.freezeCanvasCharts(
      { querySelectorAll: () => [hugeNode] },
      {
        getInstanceByDom: () => ({
          getDataURL: () => { requested = true; return 'data:image/png;base64,AAAA'; },
        }),
      },
      documentApi,
    ),
    /图表 1 静态化失败.*尺寸超过安全上限/,
  );
  assert.equal(requested, false);

  const tooMany = Array.from({ length: 65 }, () => node);
  assert.throws(
    () => ExportRenderer.freezeCanvasCharts(
      { querySelectorAll: () => tooMany },
      { getInstanceByDom: () => { throw new Error('must not run'); } },
      documentApi,
    ),
    /图表数量超过安全上限/,
  );

  let rasterCalls = 0;
  const largeCharts = Array.from({ length: 5 }, () => ({
    ...node,
    getBoundingClientRect: () => ({ width: 2000, height: 1000 }),
  }));
  assert.throws(
    () => ExportRenderer.freezeCanvasCharts(
      { querySelectorAll: () => largeCharts },
      {
        getInstanceByDom: () => ({
          getDataURL: () => { rasterCalls += 1; return 'data:image/png;base64,AAAA'; },
        }),
      },
      documentApi,
    ),
    /图表 5 静态化失败.*总像素超过安全上限/,
  );
  assert.equal(rasterCalls, 4);
});

test('Word-compatible rich HTML emits formulas and every static diagram as DOCX drawings', async () => {
  const html = [
    `<div class="language-math" data-math="\\sqrt{x}"><span class="katex-display"><img data-inkflow-static="katex-image" alt="Formula √x" src="${TINY_PNG_DATA_URL}"></span></div>`,
    `<pre><div class="language-markmap"><img data-inkflow-static="svg-image" alt="Map" src="${TINY_PNG_DATA_URL}"></div></pre>`,
    `<pre><code class="language-smiles"><img data-inkflow-static="svg-image" alt="Chem" src="${TINY_PNG_DATA_URL}"></code></pre>`,
  ].join('');

  const prepared = ExportRenderer.prepareWordHtml(html);

  assert.doesNotMatch(prepared, /class="katex"/);
  assert.doesNotMatch(prepared, /<pre\b/);

  const docx = await HTMLtoDOCX(`<!doctype html><html><body>${prepared}</body></html>`);
  const archive = await JSZip.loadAsync(docx);
  const documentXml = await archive.file('word/document.xml').async('string');
  const media = Object.keys(archive.files).filter((name) => name.startsWith('word/media/') && !name.endsWith('/'));
  assert.match(documentXml, /descr="Formula √x"/);
  assert.match(documentXml, /descr="Map"/);
  assert.match(documentXml, /descr="Chem"/);
  assert.equal((documentXml.match(/<w:drawing>/g) || []).length, 3);
  assert.ok(media.length >= 3);
});

test('Word rich-block flattening preserves surrounding document structure', () => {
  const prepared = ExportRenderer.prepareWordHtml([
    '<section><p>Before</p>',
    `<div class="language-markmap"><img data-inkflow-static="svg-image" alt="Map" src="${TINY_PNG_DATA_URL}"></div>`,
    '<p>Middle</p>',
    `<code class="language-smiles"><img data-inkflow-static="svg-image" alt="Chem" src="${TINY_PNG_DATA_URL}"></code>`,
    '<p>After</p></section>',
  ].join(''));

  assert.match(prepared, /^<section>/);
  assert.match(prepared, /<p>Before<\/p><img /);
  assert.match(prepared, /alt="Map"[^>]*><p>Middle<\/p><img /);
  assert.match(prepared, /alt="Chem"[^>]*><p>After<\/p>/);
  assert.match(prepared, /<p>After<\/p><\/section>$/);
});

test('Word preparation rejects an unrasterized KaTeX formula instead of silently degrading it', () => {
  assert.throws(
    () => ExportRenderer.prepareWordHtml('<span class="katex"><span class="katex-html">x</span></span>'),
    /Word 公式静态化失败/,
  );
});

function inlineRasterHarness({ imageMode = 'load' } = {}) {
  let activeImages = 0;
  let maxActiveImages = 0;
  const replacements = [];
  const makeSvg = (label) => {
    const attributes = new Map([['width', '120'], ['height', '60']]);
    return {
      textContent: `${'#mermaid{font-family:sans-serif;}'.repeat(12)}${label}`,
      viewBox: { baseVal: { width: 120, height: 60 } },
      getBoundingClientRect: () => ({ width: 120, height: 60 }),
      getAttribute: (name) => attributes.get(name) || null,
      querySelectorAll: () => [{ textContent: label, getAttribute: () => null }],
      cloneNode: () => ({
        setAttribute: (name, value) => attributes.set(name, value),
        getAttribute: (name) => attributes.get(name) || null,
      }),
      replaceWith: (node) => replacements.push(node),
    };
  };
  const svgs = [makeSvg('A to B'), makeSvg('B to C'), makeSvg('C to D')];
  class FakeImage {
    set src(value) {
      this._src = value;
      if (imageMode === 'timeout') return;
      activeImages += 1;
      maxActiveImages = Math.max(maxActiveImages, activeImages);
      setImmediate(() => {
        activeImages -= 1;
        if (imageMode === 'error') this.onerror(new Error('decode failed'));
        else this.onload();
      });
    }
  }
  const documentApi = {
    createElement(tag) {
      if (tag === 'canvas') {
        return {
          getContext: () => ({ drawImage() {} }),
          toDataURL: () => 'data:image/png;base64,iVBORw0KGgo=',
        };
      }
      return { style: {}, dataset: {} };
    },
  };
  const windowApi = {
    Image: FakeImage,
    XMLSerializer: class { serializeToString() { return '<svg xmlns="http://www.w3.org/2000/svg"/>'; } },
  };
  return {
    holder: { querySelectorAll: () => svgs },
    documentApi,
    windowApi,
    replacements,
    maxActive: () => maxActiveImages,
  };
}

test('inline SVG rasterization is serial and produces bounded PNG replacements', async () => {
  const harness = inlineRasterHarness();

  await ExportRenderer.rasterizeInlineSvgs(
    harness.holder,
    harness.documentApi,
    harness.windowApi,
    { timeoutMs: 100 },
  );

  assert.equal(harness.maxActive(), 1);
  assert.equal(harness.replacements.length, 3);
  assert.equal(harness.replacements.every((image) => image.dataset.inkflowStatic === 'svg-image'), true);
  assert.deepEqual(harness.replacements.map((image) => image.alt), ['A to B', 'B to C', 'C to D']);
});

test('Word SVG rasterization freezes every remaining non-KaTeX SVG and preserves KaTeX layout SVGs', async () => {
  const harness = inlineRasterHarness();
  const candidates = harness.holder.querySelectorAll();
  candidates.forEach((svg) => { svg.closest = () => null; });
  candidates[2].closest = (selector) => (selector.includes('.katex') ? { className: 'katex' } : null);
  let selected = '';
  harness.holder.querySelectorAll = (selector) => {
    selected = selector;
    return candidates;
  };

  await ExportRenderer.rasterizeInlineSvgs(
    harness.holder,
    harness.documentApi,
    harness.windowApi,
    { timeoutMs: 100, rasterizeAllNonKatex: true },
  );

  assert.equal(selected, 'svg');
  assert.equal(harness.replacements.length, 2);
  assert.deepEqual(harness.replacements.map((image) => image.alt), ['A to B', 'B to C']);
});

test('Word formula rasterization freezes the complete KaTeX layout as one PNG drawing', async () => {
  const replacements = [];
  let rasterSource = '';
  let sampledPixels = false;
  const cloneChild = { style: { cssText: '' } };
  const clone = {
    style: { cssText: '' },
    outerHTML: '<span class="katex"><span class="katex-html"><span class="sqrt">x</span></span></span>',
    setAttribute() {},
    querySelectorAll: () => [cloneChild],
  };
  const formulaChild = {};
  const formula = {
    textContent: 'x',
    getBoundingClientRect: () => ({ width: 120, height: 36 }),
    querySelector: (selector) => (selector === '.katex-mathml math' ? { textContent: '√x' } : null),
    querySelectorAll: () => [formulaChild],
    cloneNode: () => clone,
    replaceWith: (node) => replacements.push(node),
  };
  class FakeImage {
    set src(value) {
      rasterSource = value;
      setImmediate(() => this.onload());
    }
  }
  const computedStyle = {
    0: 'display',
    1: 'font-family',
    length: 2,
    getPropertyValue: (name) => (name === 'display' ? 'inline-block' : 'KaTeX_Main, serif'),
    getPropertyPriority: () => '',
  };
  const documentApi = {
    createElement(tag) {
      if (tag === 'canvas') {
        return {
          getContext: () => ({
            drawImage() {},
            getImageData() {
              sampledPixels = true;
              return { data: new Uint8ClampedArray([12, 18, 24, 255]) };
            },
          }),
          toDataURL: () => TINY_PNG_DATA_URL,
        };
      }
      return { style: {}, dataset: {} };
    },
  };
  const windowApi = {
    Image: FakeImage,
    getComputedStyle: () => computedStyle,
    XMLSerializer: class { serializeToString() { return clone.outerHTML; } },
  };

  const result = await ExportRenderer.rasterizeKatexFormulas(
    { querySelectorAll: (selector) => (selector === '.katex' ? [formula] : []) },
    documentApi,
    windowApi,
    { timeoutMs: 100 },
  );

  assert.equal(result.count, 1);
  assert.equal(sampledPixels, true);
  assert.match(decodeURIComponent(rasterSource), /<foreignObject\b/);
  assert.equal(replacements.length, 1);
  assert.equal(replacements[0].dataset.inkflowStatic, 'katex-image');
  assert.equal(replacements[0].alt, '√x');
});

test('inline SVG raster failures and timeouts abort export instead of silently degrading diagrams', async () => {
  const failed = inlineRasterHarness({ imageMode: 'error' });
  await assert.rejects(
    ExportRenderer.rasterizeInlineSvgs(failed.holder, failed.documentApi, failed.windowApi, { timeoutMs: 100 }),
    /图示.*栅格化失败/,
  );

  const stalled = inlineRasterHarness({ imageMode: 'timeout' });
  await assert.rejects(
    ExportRenderer.rasterizeInlineSvgs(stalled.holder, stalled.documentApi, stalled.windowApi, { timeoutMs: 5 }),
    /超时/,
  );
});

test('Windows absolute SVG references are read without query or fragment suffixes before rasterizing', async () => {
  const attributes = new Map([
    ['data-ink-fixed', 'C:/Pics/a.svg#check'],
  ]);
  const target = {
    dataset: {},
    getAttribute: (name) => attributes.get(name) || null,
    removeAttribute: (name) => attributes.delete(name),
    set src(value) { this._src = value; },
  };
  const svgAttributes = new Map([['viewBox', '0 0 120 60']]);
  const svg = {
    tagName: 'svg',
    viewBox: { baseVal: { width: 120, height: 60 } },
    getAttribute: (name) => svgAttributes.get(name) || null,
    cloneNode: () => ({
      setAttribute: (name, value) => svgAttributes.set(name, value),
      getAttribute: (name) => svgAttributes.get(name) || null,
    }),
  };
  class FakeImage {
    set src(value) {
      this._src = value;
      setImmediate(() => this.onload());
    }
  }
  const documentApi = {
    createElement: () => ({
      getContext: () => ({ drawImage() {} }),
      toDataURL: () => 'data:image/png;base64,iVBORw0KGgo=',
    }),
  };
  const windowApi = {
    Image: FakeImage,
    DOMParser: class { parseFromString() { return { documentElement: svg }; } },
    XMLSerializer: class { serializeToString() { return '<svg viewBox="0 0 120 60"/>'; } },
  };
  let requestedPath = '';

  const result = await ExportRenderer.rasterizeLocalSvgImages(
    { querySelectorAll: () => [target] },
    documentApi,
    windowApi,
    {
      documentPath: 'C:/Notes/doc.md',
      pathApi: {
        dirname: () => 'C:/Notes',
        resolve: (_dir, rel) => rel,
      },
      loadSvgAsset: async (file) => {
        requestedPath = file;
        return { ok: true, content: '<svg viewBox="0 0 120 60"/>' };
      },
      timeoutMs: 100,
    },
  );

  assert.equal(requestedPath, 'C:/Pics/a.svg');
  assert.equal(result.count, 1);
  assert.match(target._src, /^data:image\/png;base64,/);
});

test('unfinished rich renderers abort export instead of returning raw source as a success', async () => {
  const pendingNode = {
    textContent: 'flowchart TB; A-->B',
    getAttribute: () => null,
  };
  const holder = {
    className: '',
    style: {},
    innerHTML: '',
    setAttribute() {},
    remove() {},
    querySelectorAll(selector) {
      if (selector.startsWith('.language-mermaid:not(')) return [pendingNode];
      return [];
    },
  };
  const documentApi = {
    body: { appendChild() {} },
    createElement: () => holder,
  };

  await assert.rejects(
    ExportRenderer.renderHtml({
      html: '<div class="language-mermaid">flowchart TB; A--&gt;B</div>',
      documentApi,
      windowApi: {},
      VditorApi: { mermaidRender() {} },
      timeoutMs: 5,
    }),
    /富内容渲染超时/,
  );
});
