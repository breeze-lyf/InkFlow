// 本地资源服务：让 file:// 页面里的相对图片可以被渲染
// GET /img?path=<绝对路径>  → 返回图片（仅限常见媒体扩展名）
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.avif': 'image/avif',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.pdf': 'application/pdf',
};

function respond(res, status, body) {
  if (res.destroyed || res.writableEnded) return;
  if (res.headersSent) {
    res.destroy();
    return;
  }
  res.writeHead(status);
  res.end(body);
}

function isUnavailableFileError(err) {
  return err && ['EACCES', 'ENOENT', 'ENOTDIR', 'EPERM'].includes(err.code);
}

function streamAsset(req, res, file, mime, fsImpl) {
  let stream;
  try {
    stream = fsImpl.createReadStream(file);
  } catch (err) {
    respond(res, isUnavailableFileError(err) ? 404 : 500, isUnavailableFileError(err) ? 'not found' : 'error');
    return;
  }

  stream.once('error', (err) => {
    if (!stream.destroyed) stream.destroy();
    if (res.headersSent) {
      res.destroy();
      return;
    }
    respond(res, isUnavailableFileError(err) ? 404 : 500, isUnavailableFileError(err) ? 'not found' : 'error');
  });
  stream.once('open', () => {
    if (res.destroyed || res.writableEnded) {
      stream.destroy();
      return;
    }
    res.writeHead(200, {
      'Content-Type': mime,
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    });
    if (req.method === 'HEAD') {
      stream.destroy();
      res.end();
      return;
    }
    res.once('close', () => {
      if (!res.writableFinished) stream.destroy();
    });
    stream.pipe(res);
  });
}

function startAssetServer({
  pathGrants,
  token = crypto.randomBytes(32).toString('hex'),
  fsImpl = fs,
  port = 0,
} = {}) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      try {
        const u = new URL(req.url, 'http://127.0.0.1');
        if ((req.method !== 'GET' && req.method !== 'HEAD') || u.pathname !== `/${token}/img`) {
          return respond(res, 404, 'not found');
        }
        const p = u.searchParams.get('path');
        if (!p) {
          return respond(res, 400, 'bad request');
        }
        const abs = p;
        const ext = path.extname(abs).toLowerCase();
        const mime = MIME[ext];
        if (!mime || !pathGrants || !pathGrants.allows(abs, 'asset')) {
          return respond(res, 404, 'not found');
        }
        let stat;
        try {
          stat = fsImpl.statSync(abs);
        } catch (err) {
          if (isUnavailableFileError(err)) return respond(res, 404, 'not found');
          throw err;
        }
        if (!stat.isFile()) return respond(res, 404, 'not found');
        return streamAsset(req, res, abs, mime, fsImpl);
      } catch (e) {
        return respond(res, 500, 'error');
      }
    });

    let listening = false;
    server.on('error', (err) => {
      if (listening) {
        console.error('[asset-server] server error:', err && err.message ? err.message : err);
        return;
      }
      try { server.close(); } catch { /* listen 失败时可能尚无可关闭句柄 */ }
      reject(err);
    });
    try {
      server.listen(port, '127.0.0.1', () => {
        listening = true;
        const address = server.address();
        if (!address || typeof address === 'string') {
          try { server.close(); } catch { /* 忽略关闭失败 */ }
          reject(new Error('本地资源服务未获得 TCP 端口'));
          return;
        }
        resolve({ server, url: `http://127.0.0.1:${address.port}/${token}` });
      });
    } catch (err) {
      try { server.close(); } catch { /* listen 参数错误时可能尚未启动 */ }
      reject(err);
    }
  });
}

module.exports = { startAssetServer };
