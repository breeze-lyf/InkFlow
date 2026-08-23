'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  MAX_FIXED_CSS_BYTES,
  fixedCssLinks,
  fixedCssPaths,
  fixedCssText,
  normalizeExportTheme,
} = require('../../main/export-styles');

function fixtureRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'inkflow-export-css-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const files = {
    'renderer/css/content/inkflow-light.css': '.light{color:#111}',
    'renderer/css/content/inkflow-dark.css': '.dark{color:#eee}',
    'node_modules/vditor/dist/js/highlight.js/styles/github.min.css': '.hl{color:#111}',
    'node_modules/vditor/dist/js/highlight.js/styles/atom-one-dark.min.css': '.hl{color:#eee}',
    'node_modules/vditor/dist/js/katex/katex.min.css': [
      '@font-face{font-family:KaTeX_Main;src:',
      'url(fonts/KaTeX_Main-Regular.woff2) format("woff2"),',
      'url(fonts/KaTeX_Main-Regular.woff) format("woff"),',
      'url(fonts/KaTeX_Main-Regular.ttf) format("truetype")}',
    ].join(''),
    'node_modules/vditor/dist/js/katex/fonts/KaTeX_Main-Regular.woff2': Buffer.from('wOF2fixture-katex-font'),
  };
  for (const [relative, content] of Object.entries(files)) {
    const file = path.join(root, ...relative.split('/'));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }
  return root;
}

test('export themes select only packaged allowlisted styles', (t) => {
  const root = fixtureRoot(t);
  assert.equal(normalizeExportTheme('</style><script>'), 'light');
  assert.deepEqual(fixedCssPaths('dark'), [
    'renderer/css/content/inkflow-dark.css',
    'node_modules/vditor/dist/js/highlight.js/styles/atom-one-dark.min.css',
    'node_modules/vditor/dist/js/katex/katex.min.css',
  ]);
  assert.equal(fixedCssLinks(root, 'light').every((href) => href.startsWith('file:')), true);
});

test('inline HTML CSS embeds only the fixed KaTeX woff2 font and contains no filesystem URL', (t) => {
  const root = fixtureRoot(t);
  const css = fixedCssText(root, 'dark').join('\n');
  const encoded = Buffer.from('wOF2fixture-katex-font').toString('base64');

  assert.match(css, /\.dark\{color:#eee\}/);
  assert.match(css, /atom|\.hl\{color:#eee\}/);
  assert.match(css, new RegExp(`url\\(["']?data:font/woff2;base64,${encoded}["']?\\)`));
  assert.doesNotMatch(css, /file:|app\.asar|url\(["']?fonts\//i);
  assert.doesNotMatch(css, /KaTeX_Main-Regular\.(?:woff|ttf)/);
  assert.doesNotMatch(css, /<script|<\/style/i);
  assert.ok(Buffer.byteLength(css, 'utf8') < MAX_FIXED_CSS_BYTES);
});

test('repository HTML and Word CSS contain no app-root font URL after inlining', () => {
  const root = path.resolve(__dirname, '../..');
  const htmlCss = fixedCssText(root, 'light').join('\n');
  const wordCss = fixedCssText(root, 'light', { word: true }).join('\n');

  assert.equal((htmlCss.match(/data:font\/woff2;base64,/g) || []).length, 20);
  assert.doesNotMatch(htmlCss, /file:|app\.asar|url\(["']?fonts\//i);
  assert.doesNotMatch(wordCss, /file:|app\.asar|url\(/i);
  assert.ok(Buffer.byteLength(htmlCss, 'utf8') < MAX_FIXED_CSS_BYTES);
});
