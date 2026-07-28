// 本地资源服务：让 file:// 页面里的相对图片可以被渲染
// GET /img?path=<绝对路径>  → 返回图片（仅限常见媒体扩展名）
const http = require('http');
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

function startAssetServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      try {
        const u = new URL(req.url, 'http://127.0.0.1');
        if (u.pathname !== '/img') {
          res.writeHead(404);
          return res.end('not found');
        }
        const p = u.searchParams.get('path');
        if (!p) {
          res.writeHead(400);
          return res.end('bad request');
        }
        const abs = decodeURIComponent(p);
        const ext = path.extname(abs).toLowerCase();
        const mime = MIME[ext];
        if (!mime || !fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
          res.writeHead(404);
          return res.end('not found');
        }
        res.writeHead(200, {
          'Content-Type': mime,
          'Cache-Control': 'no-cache',
          'Access-Control-Allow-Origin': '*',
        });
        fs.createReadStream(abs).pipe(res);
      } catch (e) {
        res.writeHead(500);
        res.end('error');
      }
    });
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      resolve({ server, url: `http://127.0.0.1:${port}` });
    });
  });
}

module.exports = { startAssetServer };
