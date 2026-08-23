'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { sanitizeExportHtml } = require('../../main/html-sanitizer');

test('parser allowlist cannot turn malformed nested tag names into executable markup', () => {
  const safe = sanitizeExportHtml('<scr<script>ipt>alert(1)</scr<script>ipt><p>ok</p>');

  assert.doesNotMatch(safe, /<script\b/i);
  assert.match(safe, /&gt;alert\(1\)/);
  assert.match(safe, /<p>ok<\/p>/);
});

test('strict allowlist removes active HTML, SVG animation, foreign content, and CSS URLs', () => {
  const safe = sanitizeExportHtml([
    '<link rel="stylesheet" href="file:///tmp/private.css">',
    '<style>body{background:url(file:///tmp/private)}</style>',
    '<svg viewBox="0 0 10 10">',
    '<foreignObject><iframe src="https://example.com"></iframe></foreignObject>',
    '<animate attributeName="x" from="0" to="1"></animate>',
    '<path d="M0 0L1 1" onclick="steal()" style="fill:red"></path>',
    '<path d="M0 0" fill="url(http://127.0.0.1/p.svg#x)" clip-path="url(file:///tmp/private.svg#x)"></path>',
    '<path d="M1 1" fill="url(#safeGradient)" marker-end="url(#arrow)"></path>',
    '<path d="M2 2" style="fill:u/**/rl(file:///tmp/private.png)"></path>',
    '<path d="M3 3" fill="u/**/rl(file:///tmp/paint.svg)"></path>',
    '<path d="M4 4" stroke="u\\72l(file:///tmp/escaped.svg)"></path>',
    '<rect width="999999999" height="999999999" style="height:1000000000px"></rect>',
    '</svg>',
  ].join(''));

  assert.doesNotMatch(safe, /link|style>|foreignobject|iframe|animate|onclick|file:/i);
  assert.match(safe, /<svg[^>]+viewBox="0 0 10 10"/);
  assert.match(safe, /<path[^>]+d="M0 0L1 1"[^>]+style="fill:red"/);
  assert.doesNotMatch(safe, /127\.0\.0\.1|private\.svg/);
  assert.doesNotMatch(safe, /private\.png|paint\.svg|escaped\.svg|u\/\*\*\/rl|1000000000|999999999/);
  assert.match(safe, /fill="url\(#safeGradient\)"/);
  assert.match(safe, /marker-end="url\(#arrow\)"/);
});

test('layout dimensions and transforms fail closed on dynamic or extreme CSS', () => {
  const safe = sanitizeExportHtml([
    '<div id="vars" style="--bomb:999999999px;height:var(--bomb)">vars</div>',
    '<div id="attr" style="height:attr(data-h px)" data-h="999999999">attr</div>',
    '<div id="env" style="width:env(safe-area-inset-left)">env</div>',
    '<div id="scale" style="transform:scale(999999999)">scale</div>',
    '<div id="zoom" style="zoom:999999999">zoom</div>',
    '<div id="filter" style="filter:blur(999999999px)">filter</div>',
    '<div id="shadow" style="box-shadow:0 0 999999999px red">shadow</div>',
    '<div id="tracking" style="letter-spacing:999999999px;text-indent:999999999px">tracking</div>',
    '<div id="border" style="border-width:999999999px;columns:999999999;perspective:999999999px">border</div>',
    '<div id="line" style="font-size:16384px;line-height:16384">line</div>',
    '<div id="ok" style="width:820px;transform:scale(1.25);zoom:1.1;color:#123">ok</div>',
    '<svg>',
    '<rect id="calc" width="calc(999999999px)" height="100vw"></rect>',
    '<rect id="scientific" width="1e999px" height="-999999999"></rect>',
    '<g id="svg-scale" transform="scale(999999999)"></g>',
    '<rect id="valid" width="120" height="60" transform="translate(10 20) scale(2)"></rect>',
    '</svg>',
  ].join(''));

  for (const id of ['vars', 'attr', 'env', 'scale', 'zoom', 'filter', 'shadow', 'tracking', 'border', 'line']) {
    assert.doesNotMatch(safe, new RegExp(`id="${id}"[^>]+style=`));
  }
  assert.match(safe, /id="ok"[^>]+style="[^"]*width:820px[^"]*scale\(1\.25\)/);
  assert.doesNotMatch(safe, /(?:\bwidth|\bheight|\btransform)="[^"]*(?:calc\(|100vw|1e999|-999999999|999999999|scale\(999999999\))/i);
  assert.match(safe, /id="valid"[^>]+width="120"[^>]+height="60"[^>]+transform="translate\(10 20\) scale\(2\)"/);
});

test('images are delegated to the caller while ordinary web links remain inert navigation', () => {
  const rejected = [];
  const safe = sanitizeExportHtml([
    '<a href="https://example.com" target="_blank">site</a>',
    '<img src="https://example.com/tracker.png" alt="remote">',
    '<img src="file:///tmp/granted.png" alt="local">',
  ].join(''), {
    resolveImage(src) {
      if (src.startsWith('file:')) return { src: 'data:image/png;base64,iVBORw0KGgo=' };
      rejected.push(src);
      return { src: null };
    },
  });

  assert.match(safe, /href="https:\/\/example\.com"/);
  assert.match(safe, /rel="noopener noreferrer"/);
  assert.doesNotMatch(safe, /tracker|file:/);
  assert.match(safe, /data:image\/png;base64,iVBORw0KGgo=/);
  assert.deepEqual(rejected, ['https://example.com/tracker.png']);
});

test('parser rejects pathological nesting before sanitizer work becomes quadratic', () => {
  const deep = '<div>'.repeat(20000) + 'x' + '</div>'.repeat(20000);
  assert.throws(() => sanitizeExportHtml(deep), /嵌套层级超过安全上限/);
});
