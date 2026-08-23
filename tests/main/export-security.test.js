'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');
const { prepareExportPayload } = require('../../main/export-security');
const { PathGrants } = require('../../main/path-grants');

const MAX_WORD_IMAGE_BYTES = 4 * 1024 * 1024;
const PROJECT_ROOT = path.resolve(__dirname, '../..');
const VALID_PNG = fs.readFileSync(path.join(PROJECT_ROOT, 'assets/icon.png'));
const VALID_JPEG = fs.readFileSync(path.join(PROJECT_ROOT, 'assets/brand-banner.jpg'));
const VALID_GIF = fs.readFileSync(path.join(PROJECT_ROOT, 'node_modules/vditor/dist/images/emoji/huaji.gif'));
const VALID_WEBP = Buffer.from('UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA', 'base64');
const TINY_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');

function validBmp() {
  const bytes = Buffer.alloc(58);
  bytes.write('BM');
  bytes.writeUInt32LE(bytes.length, 2);
  bytes.writeUInt32LE(54, 10);
  bytes.writeUInt32LE(40, 14);
  bytes.writeInt32LE(1, 18);
  bytes.writeInt32LE(1, 22);
  bytes.writeUInt16LE(1, 26);
  bytes.writeUInt16LE(24, 28);
  bytes.writeUInt32LE(4, 34);
  bytes[54] = 0xff;
  return bytes;
}

test('export payload escapes HTML metadata and sanitizes renderer HTML again', () => {
  const result = prepareExportPayload({
    html: '<h1 onclick="steal()">正文</h1><script>alert(1)</script>',
    metadata: {
      title: '方案</title><script>alert(2)</script>',
      author: 'A&B',
    },
    suggestedName: '方案.docx',
  });

  assert.equal(result.metadata.title, '方案&lt;/title&gt;&lt;script&gt;alert(2)&lt;/script&gt;');
  assert.equal(result.metadata.author, 'A&amp;B');
  assert.doesNotMatch(result.html, /onclick|<script/i);
  assert.match(result.html, /<h1>正文<\/h1>/);
  assert.equal(result.suggestedName, '方案.docx');
});

test('export payload derives an escaped document title from suggestedName for direct handler use', () => {
  const result = prepareExportPayload({
    html: '<p>正文</p>',
    suggestedName: '报告"><script>x.html',
  });

  assert.equal(result.metadata.title, '报告&quot;&gt;&lt;script&gt;x');
});

test('the main export boundary preserves task state as inert text for every format', () => {
  const source = '<ul><li><input type="checkbox" checked disabled> done</li><li><input type="checkbox" disabled> todo</li></ul>';
  for (const format of ['html', 'pdf', 'word', 'image']) {
    const result = prepareExportPayload({ html: source }, { format });
    assert.equal(result.error, undefined);
    assert.match(result.html, /☑\s*done/, format);
    assert.match(result.html, /☐\s*todo/, format);
    assert.doesNotMatch(result.html, /<input\b/, format);
  }
});

test('Word export inlines a granted image from its PNG magic, not its extension', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'inkflow-export-security-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'image.not-an-image');
  const bytes = VALID_PNG;
  fs.writeFileSync(file, bytes);
  const pathGrants = new PathGrants();
  pathGrants.grant(file, { kind: 'file', access: ['asset'] });

  const result = prepareExportPayload(
    { html: `<p><img src="${pathToFileURL(file).href}" alt="图"></p>` },
    { format: 'word', pathGrants },
  );

  assert.ok(result.html.includes(`src="data:image/png;base64,${bytes.toString('base64')}"`));
  assert.deepEqual(result.rejectedImages, []);
});

test('Word export recognizes every supported image type by magic bytes', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'inkflow-export-magic-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const fixtures = [
    ['png', VALID_PNG, 'image/png'],
    ['jpeg', VALID_JPEG, 'image/jpeg'],
    ['gif', VALID_GIF, 'image/gif'],
    ['webp', VALID_WEBP, 'image/webp'],
    ['bmp', validBmp(), 'image/bmp'],
  ];
  const pathGrants = new PathGrants();
  const tags = fixtures.map(([name, bytes]) => {
    const file = path.join(dir, `${name}.bin`);
    fs.writeFileSync(file, bytes);
    pathGrants.grant(file, { kind: 'file', access: ['asset'] });
    return `<img src="${pathToFileURL(file).href}">`;
  });

  const result = prepareExportPayload({ html: tags.join('') }, { format: 'word', pathGrants });

  fixtures.forEach(([, bytes, mime]) => {
    assert.ok(result.html.includes(`data:${mime};base64,${bytes.toString('base64')}`));
  });
  assert.deepEqual(result.rejectedImages, []);
});

test('Word export explicitly rejects ICNS, JXL, HEIF, and unknown bytes without aborting later images', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'inkflow-export-rejected-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const fixtures = [
    ['icon.png', Buffer.from('icnsfixture'), 'icns-not-supported'],
    ['photo.jpg', Buffer.from([0xff, 0x0a, 0x01, 0x02]), 'jxl-not-supported'],
    ['container.gif', Buffer.from([0x00, 0x00, 0x00, 0x0c, 0x4a, 0x58, 0x4c, 0x20, 0x0d, 0x0a, 0x87, 0x0a]), 'jxl-not-supported'],
    ['phone.webp', Buffer.concat([Buffer.from([0x00, 0x00, 0x00, 0x18]), Buffer.from('ftypheic'), Buffer.alloc(8)]), 'heif-not-supported'],
    ['unknown.bmp', Buffer.from('not an image'), 'unsupported-image-format'],
  ];
  const valid = VALID_JPEG;
  const pathGrants = new PathGrants();
  const tags = fixtures.map(([name, bytes]) => {
    const file = path.join(dir, name);
    fs.writeFileSync(file, bytes);
    pathGrants.grant(file, { kind: 'file', access: ['asset'] });
    return `<img src="${pathToFileURL(file).href}" alt="${name}">`;
  });
  const validFile = path.join(dir, 'valid.bin');
  fs.writeFileSync(validFile, valid);
  pathGrants.grant(validFile, { kind: 'file', access: ['asset'] });
  tags.push(`<img src="${pathToFileURL(validFile).href}" alt="valid">`);

  const result = prepareExportPayload({ html: tags.join('') }, { format: 'word', pathGrants });

  assert.deepEqual(result.rejectedImages.map((item) => item.reason), fixtures.map((item) => item[2]));
  fixtures.forEach(([name]) => assert.doesNotMatch(result.html, new RegExp(`src="[^"]*${name}`)));
  assert.ok(result.html.includes(`data:image/jpeg;base64,${valid.toString('base64')}`));
});

test('Word export requires asset permission, a regular file, and a 4 MB size ceiling', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'inkflow-export-gates-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const readOnly = path.join(dir, 'read-only.png');
  const tooLarge = path.join(dir, 'too-large.png');
  fs.writeFileSync(readOnly, signature);
  fs.writeFileSync(tooLarge, signature);
  fs.truncateSync(tooLarge, MAX_WORD_IMAGE_BYTES + 1);

  const pathGrants = new PathGrants();
  pathGrants.grant(readOnly, { kind: 'file', access: ['read'] });
  pathGrants.grant(dir, { kind: 'file', access: ['asset'] });
  pathGrants.grant(tooLarge, { kind: 'file', access: ['asset'] });

  const html = [readOnly, dir, tooLarge]
    .map((file) => `<img src="${pathToFileURL(file).href}">`)
    .join('');
  const result = prepareExportPayload({ html }, { format: 'word', pathGrants });

  assert.deepEqual(result.rejectedImages.map((item) => item.reason), [
    'path-not-granted',
    'not-regular-file',
    'image-too-large',
  ]);
  assert.doesNotMatch(result.html, /file:/i);
  assert.doesNotMatch(result.html, /data:image/i);
});

test('Word export also removes an unquoted file URL when it is not authorized', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'inkflow-export-unquoted-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'private.png');
  fs.writeFileSync(file, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));

  const result = prepareExportPayload(
    { html: `<img src=${pathToFileURL(file).href} alt="private">` },
    { format: 'word', pathGrants: new PathGrants() },
  );

  assert.doesNotMatch(result.html, /file:/i);
  assert.equal(result.rejectedImages[0].reason, 'path-not-granted');
});

test('Word export cannot bypass file authorization with an HTML-encoded file scheme', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'inkflow-export-entity-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'private.png');
  fs.writeFileSync(file, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const encodedUrl = pathToFileURL(file).href.replace(':', '&#x3a;');

  const result = prepareExportPayload(
    { html: `<img src="${encodedUrl}" alt="private">` },
    { format: 'word', pathGrants: new PathGrants() },
  );

  assert.doesNotMatch(result.html, /file(?:&#x3a;|:)/i);
  assert.equal(result.rejectedImages[0].reason, 'path-not-granted');
});

test('Word export checks every src attribute when malformed HTML contains duplicates', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'inkflow-export-duplicate-src-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'private.png');
  fs.writeFileSync(file, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));

  const result = prepareExportPayload(
    { html: `<img src="data:image/png;base64,AAAA" src="${pathToFileURL(file).href}">` },
    { format: 'word', pathGrants: new PathGrants() },
  );

  assert.doesNotMatch(result.html, /data:image\/png;base64,AAAA/);
  assert.doesNotMatch(result.html, /file:/i);
  assert.deepEqual(result.rejectedImages.map((item) => item.reason), ['unsupported-image-format']);
});

test('all export formats inline granted local images and remove ungranted file URLs', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'inkflow-export-all-formats-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const allowed = path.join(dir, 'allowed.png');
  const privateFile = path.join(dir, 'private.png');
  const bytes = VALID_PNG;
  fs.writeFileSync(allowed, bytes);
  fs.writeFileSync(privateFile, bytes);
  const pathGrants = new PathGrants();
  pathGrants.grant(allowed, { kind: 'file', access: ['asset'] });

  for (const format of ['pdf', 'html', 'word', 'image']) {
    const result = prepareExportPayload({
      html: `<img src="${pathToFileURL(allowed).href}"><img src="${pathToFileURL(privateFile).href}">`,
    }, { format, pathGrants });
    assert.match(result.html, /data:image\/png;base64,/);
    assert.doesNotMatch(result.html, /file:/i);
    assert.equal(result.rejectedImages.at(-1).reason, 'path-not-granted');
  }
});

test('remote images are stripped before Word conversion and data images require real bounded raster bytes', () => {
  const png = VALID_PNG;
  const result = prepareExportPayload({
    html: [
      '<img src="https://169.254.169.254/latest/meta-data/">',
      '<img src="data:image/jpeg;base64,AAAA">',
      `<img src="data:image/jpeg;base64,${png.toString('base64')}">`,
    ].join(''),
  }, { format: 'word', pathGrants: new PathGrants() });

  assert.doesNotMatch(result.html, /https?:|base64,AAAA/);
  assert.ok(result.html.includes(`data:image/png;base64,${png.toString('base64')}`));
  assert.deepEqual(result.rejectedImages.map((item) => item.reason), [
    'remote-image-not-supported',
    'unsupported-image-format',
  ]);
});

test('magic-only and excessive-dimension images are rejected before the DOCX library sees them', () => {
  const signatureOnly = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from('fixture'),
  ]);
  const oversized = Buffer.from(VALID_PNG);
  oversized.writeUInt32BE(20000, 16);
  const result = prepareExportPayload({
    html: [signatureOnly, oversized]
      .map((bytes) => `<img src="data:image/png;base64,${bytes.toString('base64')}">`)
      .join(''),
  }, { format: 'word', pathGrants: new PathGrants() });

  assert.doesNotMatch(result.html, /<img[^>]+src=/i);
  assert.deepEqual(result.rejectedImages.map((item) => item.reason), [
    'invalid-image-data',
    'invalid-image-data',
  ]);
});

test('a sanitized valid raster completes a real DOCX conversion while a bad neighbor is omitted', async () => {
  const HTMLtoDOCX = require('html-to-docx');
  const bad = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from('broken'),
  ]);
  const result = prepareExportPayload({
    html: `<p>before</p><img src="data:image/png;base64,${bad.toString('base64')}">`
      + `<img src="data:image/png;base64,${VALID_PNG.toString('base64')}"><p>after</p>`,
  }, { format: 'word', pathGrants: new PathGrants() });

  const docx = await HTMLtoDOCX(`<!doctype html><html><body>${result.html}</body></html>`);
  assert.ok(Buffer.isBuffer(docx));
  assert.equal(docx.subarray(0, 2).toString('ascii'), 'PK');
  assert.equal(result.rejectedImages.length, 1);
  assert.equal(result.rejectedImages[0].reason, 'invalid-image-data');
});

test('main sanitizer stays safe for mutation-XSS-shaped tag input', () => {
  const result = prepareExportPayload({
    html: '<scr<script>ipt>alert(1)</scr<script>ipt><svg><set attributeName="x"></set></svg>',
  });

  assert.doesNotMatch(result.html, /<script\b|<set\b/i);
  assert.match(result.html, /&gt;alert\(1\)/);
});

test('export budgets cap image count, aggregate decoded bytes, and source HTML before conversion', () => {
  const image = `<img src="data:image/png;base64,${TINY_PNG.toString('base64')}">`;
  const tooMany = prepareExportPayload({ html: image.repeat(3) }, {
    maxImages: 2,
    maxTotalImageBytes: 1024,
  });
  assert.equal((tooMany.html.match(/data:image\/png/g) || []).length, 2);
  assert.equal(tooMany.rejectedImages.at(-1).reason, 'too-many-images');

  const tooLarge = prepareExportPayload({ html: image.repeat(2) }, {
    maxImages: 10,
    maxTotalImageBytes: TINY_PNG.length,
  });
  assert.equal((tooLarge.html.match(/data:image\/png/g) || []).length, 1);
  assert.equal(tooLarge.rejectedImages.at(-1).reason, 'total-image-size-exceeded');

  const htmlLimit = prepareExportPayload({ html: '<p>too long</p>' }, { maxHtmlChars: 5 });
  assert.equal(htmlLimit.html, '');
  assert.match(htmlLimit.error, /导出内容超过/);
});

test('Word conversion has lower format-specific HTML, element, image-count, and decoded-image budgets', () => {
  const tooMuchHtml = prepareExportPayload({ html: 'x'.repeat(4 * 1024 * 1024 + 1) }, { format: 'word' });
  assert.equal(tooMuchHtml.html, '');
  assert.match(tooMuchHtml.error, /Word 导出内容超过 4 MB 上限/);

  const tooManyElements = prepareExportPayload({ html: '<span>x</span>'.repeat(20001) }, { format: 'word' });
  assert.equal(tooManyElements.html, '');
  assert.match(tooManyElements.error, /Word 导出元素数量超过安全上限（20000）/);

  const image = `<img src="data:image/png;base64,${TINY_PNG.toString('base64')}">`;
  const tooManyImages = prepareExportPayload({ html: image.repeat(33) }, { format: 'word' });
  assert.equal(tooManyImages.html, '');
  assert.match(tooManyImages.error, /Word 导出图片数量超过安全上限（32 张）/);

  const largePng = path.join(PROJECT_ROOT, 'assets/screenshots/smoke-light.png');
  const pathGrants = new PathGrants();
  pathGrants.grant(largePng, { kind: 'file', access: ['asset'] });
  const fileImage = `<img src="${pathToFileURL(largePng).href}">`;
  const tooManyImageBytes = prepareExportPayload({ html: fileImage.repeat(14) }, { format: 'word', pathGrants });
  assert.equal(tooManyImageBytes.html, '');
  assert.match(tooManyImageBytes.error, /Word 导出图片总量超过安全上限（8 MB）/);
});

test('aggregate image budget rejects a new file source before filesystem work once the budget is exhausted', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'inkflow-export-aggregate-budget-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const first = path.join(dir, 'first.png');
  const second = path.join(dir, 'second.png');
  fs.writeFileSync(first, TINY_PNG);
  fs.writeFileSync(second, TINY_PNG);

  const pathGrants = new PathGrants();
  pathGrants.grant(first, { kind: 'file', access: ['asset'] });
  pathGrants.grant(second, { kind: 'file', access: ['asset'] });

  const statted = [];
  const read = [];
  const fsImpl = Object.create(fs);
  fsImpl.lstatSync = (file) => {
    statted.push(file);
    return fs.lstatSync(file);
  };
  fsImpl.readFileSync = (file) => {
    read.push(file);
    if (file === second) throw new Error('the exhausted budget must reject before reading or encoding');
    return fs.readFileSync(file);
  };

  const result = prepareExportPayload({
    html: `<img src="${pathToFileURL(first).href}"><img src="${pathToFileURL(second).href}">`,
  }, {
    pathGrants,
    fsImpl,
    maxTotalImageBytes: TINY_PNG.length,
  });

  assert.equal((result.html.match(/data:image\/png/g) || []).length, 1);
  assert.deepEqual(result.rejectedImages, [
    { src: pathToFileURL(second).href, reason: 'total-image-size-exceeded' },
  ]);
  assert.deepEqual(statted, [first]);
  assert.deepEqual(read, [first]);
});

test('repeated file images are read once even though each rendered occurrence counts toward the budget', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'inkflow-export-cache-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'image.png');
  fs.writeFileSync(file, TINY_PNG);
  const pathGrants = new PathGrants();
  pathGrants.grant(file, { kind: 'file', access: ['asset'] });
  let reads = 0;
  const fsImpl = Object.create(fs);
  fsImpl.readFileSync = (...args) => { reads += 1; return fs.readFileSync(...args); };
  const tag = `<img src="${pathToFileURL(file).href}">`;

  const result = prepareExportPayload({ html: tag.repeat(3) }, {
    pathGrants,
    fsImpl,
    maxTotalImageBytes: TINY_PNG.length * 3,
  });

  assert.equal(reads, 1);
  assert.equal((result.html.match(/data:image\/png/g) || []).length, 3);
});
