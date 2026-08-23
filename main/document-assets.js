'use strict';

const path = require('node:path');

function authorizeDocumentAssets(pathGrants, documentPath, { writable = true } = {}) {
  if (!pathGrants || typeof pathGrants.grant !== 'function'
    || typeof documentPath !== 'string' || !path.isAbsolute(documentPath)) {
    return { ok: false, error: '文稿资源路径无效' };
  }
  const parent = path.dirname(documentPath);
  const readable = pathGrants.grant(parent, { kind: 'directory', access: ['asset'] });
  if (!readable.ok || !writable) return readable;
  // 单文件模式只允许创建和更新该文稿相邻的 assets/；父目录中的其他
  // 文件仍不获得通用 write/read 能力。
  return pathGrants.grant(path.join(parent, 'assets'), {
    kind: 'directory',
    access: ['write', 'asset'],
  });
}

function writableAssetsDirectory(pathGrants, targetDir) {
  if (!pathGrants || typeof pathGrants.allows !== 'function'
    || typeof targetDir !== 'string' || !path.isAbsolute(targetDir)) return null;
  const assetsDir = path.resolve(targetDir, 'assets');
  return pathGrants.allows(assetsDir, 'write') ? assetsDir : null;
}

module.exports = { authorizeDocumentAssets, writableAssetsDirectory };
