'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const ExportSafety = require('../renderer/js/export-safety');

test('removes executable elements and inline event handlers from export HTML', () => {
  const html = [
    '<h1 onclick="steal()">Title</h1>',
    '<script>alert(1)</script>',
    '<iframe src="https://example.com"></iframe>',
    '<img src="ok.png" onerror="steal()">',
  ].join('');

  const safe = ExportSafety.sanitizeHtml(html);

  assert.match(safe, /<h1[^>]*>Title<\/h1>/);
  assert.match(safe, /<img[^>]+src="ok\.png"/);
  assert.doesNotMatch(safe, /script|iframe|onclick|onerror/i);
});

test('blocks active and automatic network URLs while preserving links and validated image candidates', () => {
  const safe = ExportSafety.sanitizeHtml([
    '<a href="javascript:alert(1)">bad</a>',
    '<a href="https://example.com">good</a>',
    '<img src="data:image/png;base64,AAAA">',
    '<img src="file:///tmp/example.png">',
    '<img src="https://example.com/tracker.png">',
  ].join(''));

  assert.doesNotMatch(safe, /javascript:/i);
  assert.match(safe, /href="https:\/\/example\.com"/);
  assert.match(safe, /src="data:image\/png;base64,AAAA"/);
  assert.doesNotMatch(safe, /file:|tracker\.png/);
});

test('task checkboxes become inert text without losing checked state', () => {
  const safe = ExportSafety.sanitizeHtml([
    '<ul class="contains-task-list">',
    '<li><input type="checkbox" checked disabled onclick="steal()"> done</li>',
    '<li><input type="checkbox" disabled> todo</li>',
    '<li><input type="text" value="secret"> ignored</li>',
    '</ul>',
  ].join(''));

  assert.match(safe, /☑\s*done/);
  assert.match(safe, /☐\s*todo/);
  assert.doesNotMatch(safe, /<input\b|onclick|secret/i);
});

test('browser-independent sanitizer resists malformed tags and strips active SVG and CSS', () => {
  const safe = ExportSafety.sanitizeHtml([
    '<scr<script>ipt>alert(1)</scr<script>ipt>',
    '<style>@import "file:///tmp/private"</style>',
    '<svg><foreignObject><p>x</p></foreignObject><animate attributeName="x"></animate><path d="M0 0"></path></svg>',
  ].join(''));

  assert.doesNotMatch(safe, /<script\b|<style\b|foreignobject|animate|file:/i);
  assert.match(safe, /<path[^>]+d="M0 0"/);
});

test('browser-independent sanitizer rejects dynamic and unbounded layout values', () => {
  const safe = ExportSafety.sanitizeHtml([
    '<div style="--bomb:999999999px;height:var(--bomb)">x</div>',
    '<div style="height:attr(data-h px)">y</div>',
    '<div style="transform:scale(999999999);zoom:999999999">z</div>',
    '<div style="filter:blur(999999999px);box-shadow:0 0 999999999px red">paint</div>',
    '<div style="letter-spacing:999999999px;text-indent:999999999px;border-width:999999999px">layout</div>',
    '<div style="columns:999999999;perspective:999999999px">columns</div>',
    '<div style="font-size:16384px;line-height:16384">line</div>',
    '<svg><rect width="calc(999999999px)" height="100vw"></rect>',
    '<g transform="scale(999999999)"></g></svg>',
  ].join(''));

  assert.doesNotMatch(safe, /style=|calc\(|100vw|scale\(999999999\)/i);
});

test('escapes document metadata before embedding it in exported markup', () => {
  assert.equal(
    ExportSafety.escapeHtml('a</title><script>alert(1)</script>'),
    'a&lt;/title&gt;&lt;script&gt;alert(1)&lt;/script&gt;',
  );
});
