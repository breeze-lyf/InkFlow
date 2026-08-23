'use strict';

const fs = require('fs');
const path = require('path');
const { fileURLToPath } = require('url');
const { escapeHtml, sanitizeExportHtml } = require('./html-sanitizer');

const MAX_WORD_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_EXPORT_HTML_CHARS = 25 * 1024 * 1024;
const MAX_EXPORT_IMAGES = 200;
const MAX_EXPORT_IMAGE_BYTES = 32 * 1024 * 1024;
const MAX_IMAGE_DIMENSION = 16384;
const MAX_IMAGE_PIXELS = 40 * 1024 * 1024;
const WORD_EXPORT_BUDGET = Object.freeze({
  maxHtmlChars: 4 * 1024 * 1024,
  maxTags: 20000,
  maxImages: 32,
  maxImageBytes: 4 * 1024 * 1024,
  maxTotalImageBytes: 8 * 1024 * 1024,
});

function escapeMetadata(metadata) {
  const escaped = Object.create(null);
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return escaped;
  for (const [key, value] of Object.entries(metadata)) {
    escaped[key] = escapeHtml(value);
  }
  return escaped;
}

function detectImageMime(bytes) {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'image/png';
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (bytes.length >= 6 && (bytes.subarray(0, 6).toString('ascii') === 'GIF87a' || bytes.subarray(0, 6).toString('ascii') === 'GIF89a')) {
    return 'image/gif';
  }
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP') {
    return 'image/webp';
  }
  if (bytes.length >= 2 && bytes[0] === 0x42 && bytes[1] === 0x4d) {
    return 'image/bmp';
  }
  return null;
}

function rejectedImageReason(bytes) {
  if (bytes.length >= 4 && bytes.subarray(0, 4).toString('ascii') === 'icns') {
    return 'icns-not-supported';
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0x0a) {
    return 'jxl-not-supported';
  }
  const jxlContainer = Buffer.from([0x00, 0x00, 0x00, 0x0c, 0x4a, 0x58, 0x4c, 0x20, 0x0d, 0x0a, 0x87, 0x0a]);
  if (bytes.length >= jxlContainer.length && bytes.subarray(0, jxlContainer.length).equals(jxlContainer)) {
    return 'jxl-not-supported';
  }
  if (bytes.length >= 12 && bytes.subarray(4, 8).toString('ascii') === 'ftyp') {
    const heifBrands = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1', 'avif', 'avis']);
    for (let offset = 8; offset + 4 <= bytes.length; offset += 4) {
      if (heifBrands.has(bytes.subarray(offset, offset + 4).toString('ascii'))) return 'heif-not-supported';
    }
  }
  return null;
}

function validDimensions(width, height) {
  return Number.isInteger(width) && Number.isInteger(height)
    && width > 0 && height > 0
    && width <= MAX_IMAGE_DIMENSION && height <= MAX_IMAGE_DIMENSION
    && width * height <= MAX_IMAGE_PIXELS;
}

function pngDimensions(bytes) {
  if (bytes.length < 45 || bytes.readUInt32BE(8) !== 13 || bytes.subarray(12, 16).toString('ascii') !== 'IHDR') return null;
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  let offset = 8;
  let sawHeader = false;
  let sawData = false;
  let sawEnd = false;
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const end = offset + 12 + length;
    if (length > bytes.length || end > bytes.length) return null;
    const type = bytes.subarray(offset + 4, offset + 8).toString('ascii');
    if (!sawHeader && type !== 'IHDR') return null;
    if (type === 'IHDR') {
      if (sawHeader || length !== 13) return null;
      sawHeader = true;
    } else if (type === 'IDAT') {
      sawData = true;
    } else if (type === 'IEND') {
      if (length !== 0) return null;
      sawEnd = true;
      break;
    }
    offset = end;
  }
  return sawHeader && sawData && sawEnd ? { width, height } : null;
}

function jpegDimensions(bytes) {
  if (bytes.length < 12 || bytes[0] !== 0xff || bytes[1] !== 0xd8
    || bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9) return null;
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.length) break;
    const marker = bytes[offset++];
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > bytes.length) return null;
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length) return null;
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      if (length < 7) return null;
      return { width: bytes.readUInt16BE(offset + 5), height: bytes.readUInt16BE(offset + 3) };
    }
    offset += length;
  }
  return null;
}

function gifDimensions(bytes) {
  if (bytes.length < 14 || !['GIF87a', 'GIF89a'].includes(bytes.subarray(0, 6).toString('ascii'))
    || bytes[bytes.length - 1] !== 0x3b) return null;
  return { width: bytes.readUInt16LE(6), height: bytes.readUInt16LE(8) };
}

function webpDimensions(bytes) {
  if (bytes.length < 30 || bytes.subarray(0, 4).toString('ascii') !== 'RIFF'
    || bytes.subarray(8, 12).toString('ascii') !== 'WEBP') return null;
  const declared = bytes.readUInt32LE(4) + 8;
  if (declared > bytes.length || declared < 20) return null;
  let offset = 12;
  while (offset + 8 <= declared) {
    const type = bytes.subarray(offset, offset + 4).toString('ascii');
    const size = bytes.readUInt32LE(offset + 4);
    const start = offset + 8;
    const end = start + size;
    if (end > declared) return null;
    if (type === 'VP8X' && size >= 10) {
      return {
        width: 1 + bytes.readUIntLE(start + 4, 3),
        height: 1 + bytes.readUIntLE(start + 7, 3),
      };
    }
    if (type === 'VP8 ' && size >= 10 && bytes[start + 3] === 0x9d && bytes[start + 4] === 0x01 && bytes[start + 5] === 0x2a) {
      return {
        width: bytes.readUInt16LE(start + 6) & 0x3fff,
        height: bytes.readUInt16LE(start + 8) & 0x3fff,
      };
    }
    if (type === 'VP8L' && size >= 5 && bytes[start] === 0x2f) {
      const b1 = bytes[start + 1];
      const b2 = bytes[start + 2];
      const b3 = bytes[start + 3];
      const b4 = bytes[start + 4];
      return {
        width: 1 + b1 + ((b2 & 0x3f) << 8),
        height: 1 + (b2 >> 6) + (b3 << 2) + ((b4 & 0x0f) << 10),
      };
    }
    offset = end + (size % 2);
  }
  return null;
}

function bmpDimensions(bytes) {
  if (bytes.length < 54 || bytes[0] !== 0x42 || bytes[1] !== 0x4d) return null;
  const declared = bytes.readUInt32LE(2);
  const pixelOffset = bytes.readUInt32LE(10);
  const dibSize = bytes.readUInt32LE(14);
  if (declared > bytes.length || declared < 54 || pixelOffset >= bytes.length || dibSize < 40) return null;
  return { width: Math.abs(bytes.readInt32LE(18)), height: Math.abs(bytes.readInt32LE(22)) };
}

function validRasterStructure(bytes, mime) {
  const dimensions = mime === 'image/png' ? pngDimensions(bytes)
    : mime === 'image/jpeg' ? jpegDimensions(bytes)
      : mime === 'image/gif' ? gifDimensions(bytes)
        : mime === 'image/webp' ? webpDimensions(bytes)
          : mime === 'image/bmp' ? bmpDimensions(bytes)
            : null;
  return dimensions && validDimensions(dimensions.width, dimensions.height);
}

function safeRasterData(bytes, remainingImageBytes = Infinity, maxImageBytes = MAX_WORD_IMAGE_BYTES) {
  if (!Buffer.isBuffer(bytes)) bytes = Buffer.from(bytes);
  if (bytes.length > maxImageBytes) return { reason: 'image-too-large' };
  if (bytes.length > remainingImageBytes) return { reason: 'total-image-size-exceeded' };
  const rejectedReason = rejectedImageReason(bytes);
  if (rejectedReason) return { reason: rejectedReason };
  const mime = detectImageMime(bytes);
  if (!mime) return { reason: 'unsupported-image-format' };
  if (!validRasterStructure(bytes, mime)) return { reason: 'invalid-image-data' };
  return { src: `data:${mime};base64,${bytes.toString('base64')}`, byteLength: bytes.length };
}

function decodeRasterDataUrl(src, remainingImageBytes = Infinity, maxImageBytes = MAX_WORD_IMAGE_BYTES) {
  const match = /^data:image\/[^;,\s]+;base64,([\s\S]*)$/i.exec(src);
  if (!match) return { reason: 'invalid-data-url' };
  const encoded = match[1].replace(/[\t\n\r ]+/g, '');
  const maxEncodedLength = Math.ceil(maxImageBytes / 3) * 4 + 4;
  if (encoded.length > maxEncodedLength) return { reason: 'image-too-large' };
  if (!encoded || encoded.length % 4 === 1 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) {
    return { reason: 'invalid-data-url' };
  }
  const padding = encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0;
  const decodedLength = Math.floor(encoded.length * 3 / 4) - padding;
  if (decodedLength > remainingImageBytes) return { reason: 'total-image-size-exceeded' };
  let bytes;
  try {
    bytes = Buffer.from(encoded, 'base64');
  } catch {
    return { reason: 'invalid-data-url' };
  }
  const canonical = bytes.toString('base64').replace(/=+$/, '');
  if (canonical !== encoded.replace(/=+$/, '')) return { reason: 'invalid-data-url' };
  return safeRasterData(bytes, remainingImageBytes, maxImageBytes);
}

function resolveExportImage(src, {
  pathGrants,
  fsImpl = fs,
  remainingImageBytes = Infinity,
  maxImageBytes = MAX_WORD_IMAGE_BYTES,
} = {}) {
  const value = String(src == null ? '' : src).trim();
  if (!value) return { reason: 'missing-image-source' };
  if (remainingImageBytes <= 0) return { reason: 'total-image-size-exceeded' };
  if (/^data:/i.test(value)) return decodeRasterDataUrl(value, remainingImageBytes, maxImageBytes);
  if (/^https?:/i.test(value) || value.startsWith('//')) return { reason: 'remote-image-not-supported' };
  if (!/^file:/i.test(value)) return { reason: 'unsupported-image-source' };

  let file;
  try {
    file = fileURLToPath(value);
  } catch {
    return { reason: 'invalid-file-url' };
  }
  if (!pathGrants || typeof pathGrants.allows !== 'function' || !pathGrants.allows(file, 'asset')) {
    return { reason: 'path-not-granted' };
  }
  let stat;
  try {
    stat = typeof fsImpl.lstatSync === 'function' ? fsImpl.lstatSync(file) : fsImpl.statSync(file);
  } catch {
    return { reason: 'file-unavailable' };
  }
  if (!stat.isFile()) return { reason: 'not-regular-file' };
  if (stat.size > maxImageBytes) return { reason: 'image-too-large' };
  if (stat.size > remainingImageBytes) return { reason: 'total-image-size-exceeded' };
  let bytes;
  try {
    bytes = fsImpl.readFileSync(file);
  } catch {
    return { reason: 'file-unavailable' };
  }
  return safeRasterData(bytes, remainingImageBytes, maxImageBytes);
}

// Handler adapter:
// const safe = prepareExportPayload(payload, { format: 'word', pathGrants });
// Use safe.html in the body and safe.metadata.title in <title>.
function prepareExportPayload(payload = {}, options = {}) {
  const input = payload && typeof payload === 'object' ? payload : {};
  const isWord = options.format === 'word';
  const formatBudget = isWord ? WORD_EXPORT_BUDGET : null;
  const maxHtmlChars = Number.isSafeInteger(options.maxHtmlChars) ? options.maxHtmlChars
    : formatBudget ? formatBudget.maxHtmlChars : MAX_EXPORT_HTML_CHARS;
  const maxTags = Number.isSafeInteger(options.maxTags) ? options.maxTags
    : formatBudget ? formatBudget.maxTags : undefined;
  const maxImages = Number.isSafeInteger(options.maxImages) ? options.maxImages
    : formatBudget ? formatBudget.maxImages : MAX_EXPORT_IMAGES;
  const maxImageBytes = Number.isSafeInteger(options.maxImageBytes) ? options.maxImageBytes
    : formatBudget ? formatBudget.maxImageBytes : MAX_WORD_IMAGE_BYTES;
  const maxTotalImageBytes = Number.isSafeInteger(options.maxTotalImageBytes)
    ? options.maxTotalImageBytes
    : formatBudget ? formatBudget.maxTotalImageBytes : MAX_EXPORT_IMAGE_BYTES;
  const metadata = input.metadata && typeof input.metadata === 'object' && !Array.isArray(input.metadata)
    ? { ...input.metadata }
    : {};
  if (!Object.prototype.hasOwnProperty.call(metadata, 'title') && typeof input.suggestedName === 'string') {
    const name = path.basename(input.suggestedName);
    metadata.title = path.basename(name, path.extname(name));
  }
  const rejectedImages = [];
  const sourceHtml = String(input.html == null ? '' : input.html);
  if (sourceHtml.length > maxHtmlChars) {
    return {
      ...input,
      html: '',
      metadata: escapeMetadata(metadata),
      rejectedImages,
      error: `${isWord ? 'Word 导出' : '导出内容'}${isWord ? '内容' : ''}超过 ${Math.floor(maxHtmlChars / 1024 / 1024)} MB 上限`,
    };
  }
  const imageCache = new Map();
  let imageCount = 0;
  let totalImageBytes = 0;
  let wordBudgetError = '';
  let sanitizedHtml;
  try {
    sanitizedHtml = sanitizeExportHtml(sourceHtml, {
      resolveImage(src) {
        imageCount += 1;
        if (imageCount > maxImages) {
          const resolved = { reason: 'too-many-images' };
          rejectedImages.push({ src, reason: resolved.reason });
          if (isWord && !wordBudgetError) wordBudgetError = `Word 导出图片数量超过安全上限（${maxImages} 张）`;
          return resolved;
        }
        let resolved = imageCache.get(src);
        if (!resolved) {
          resolved = resolveExportImage(src, {
            ...options,
            maxImageBytes,
            remainingImageBytes: Math.max(0, maxTotalImageBytes - totalImageBytes),
          });
          imageCache.set(src, resolved.src ? resolved : { reason: resolved.reason });
        }
        if (resolved.src) {
          const nextTotal = totalImageBytes + (resolved.byteLength || 0);
          if (nextTotal > maxTotalImageBytes) {
            resolved = { reason: 'total-image-size-exceeded' };
            imageCache.set(src, resolved);
          } else {
            totalImageBytes = nextTotal;
          }
        }
        if (isWord && !wordBudgetError && resolved.reason === 'image-too-large') {
          wordBudgetError = `Word 导出单张图片超过 ${Math.floor(maxImageBytes / 1024 / 1024)} MB 上限`;
        }
        if (isWord && !wordBudgetError && resolved.reason === 'total-image-size-exceeded') {
          wordBudgetError = `Word 导出图片总量超过安全上限（${Math.floor(maxTotalImageBytes / 1024 / 1024)} MB）`;
        }
        if (!resolved.src) rejectedImages.push({ src, reason: resolved.reason });
        return resolved;
      },
      maxTags,
      budgetLabel: isWord ? 'Word 导出' : '导出',
    });
  } catch (error) {
    return {
      ...input,
      html: '',
      metadata: escapeMetadata(metadata),
      rejectedImages,
      error: error && error.message ? error.message : '导出内容无效',
    };
  }
  const prepared = {
    ...input,
    html: sanitizedHtml,
    metadata: escapeMetadata(metadata),
    rejectedImages,
  };
  if (wordBudgetError) {
    prepared.html = '';
    prepared.error = wordBudgetError;
    return prepared;
  }
  if (prepared.html.length > maxHtmlChars + Math.ceil(maxTotalImageBytes * 4 / 3) + 4096) {
    prepared.html = '';
    prepared.error = '导出后的文档体积超过安全上限';
  }
  return prepared;
}

module.exports = { decodeRasterDataUrl, prepareExportPayload, resolveExportImage };
