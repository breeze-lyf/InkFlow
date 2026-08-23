const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { PassThrough } = require('node:stream');
const test = require('node:test');

const { PathGrants } = require('../../main/path-grants');
const { startAssetServer } = require('../../main/server');

function withTempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'inkflow-assets-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

test('asset URLs require an unguessable token and a granted media path', async (t) => {
  const dir = withTempDir(t);
  const allowed = path.join(dir, 'allowed.png');
  const denied = path.join(dir, 'denied.png');
  fs.writeFileSync(allowed, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  fs.writeFileSync(denied, Buffer.from([0x89, 0x50, 0x4e, 0x47]));

  const grants = new PathGrants();
  grants.grant(allowed, { kind: 'file', access: ['asset'] });
  const token = 'a'.repeat(64);
  const { server, url } = await startAssetServer({ pathGrants: grants, token });
  t.after(() => new Promise((resolve) => server.close(resolve)));

  assert.equal(url.endsWith(`/${token}`), true);

  const ok = await fetch(`${url}/img?path=${encodeURIComponent(allowed)}`);
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get('access-control-allow-origin'), null);
  assert.equal(ok.headers.get('referrer-policy'), 'no-referrer');

  const forbidden = await fetch(`${url}/img?path=${encodeURIComponent(denied)}`);
  assert.equal(forbidden.status, 404);

  const noToken = await fetch(`${url.replace(`/${token}`, '')}/img?path=${encodeURIComponent(allowed)}`);
  assert.equal(noToken.status, 404);
});

test('each asset-server session receives a fresh 256-bit URL token', async (t) => {
  const grants = new PathGrants();
  const first = await startAssetServer({ pathGrants: grants });
  const second = await startAssetServer({ pathGrants: grants });
  t.after(() => new Promise((resolve) => first.server.close(resolve)));
  t.after(() => new Promise((resolve) => second.server.close(resolve)));

  const firstToken = new URL(first.url).pathname.slice(1);
  const secondToken = new URL(second.url).pathname.slice(1);
  assert.match(firstToken, /^[a-f0-9]{64}$/);
  assert.match(secondToken, /^[a-f0-9]{64}$/);
  assert.notEqual(firstToken, secondToken);
});

test('a file disappearing before its stream opens returns a controlled response', async (t) => {
  const dir = withTempDir(t);
  const allowed = path.join(dir, 'allowed.png');
  fs.writeFileSync(allowed, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  const grants = new PathGrants();
  grants.grant(allowed, { kind: 'file', access: ['asset'] });

  const fsImpl = Object.create(fs);
  fsImpl.createReadStream = () => {
    const stream = new PassThrough();
    process.nextTick(() => {
      const err = new Error('file disappeared');
      err.code = 'ENOENT';
      stream.emit('error', err);
    });
    return stream;
  };

  const { server, url } = await startAssetServer({ pathGrants: grants, fsImpl });
  t.after(() => closeServer(server));
  const response = await fetch(`${url}/img?path=${encodeURIComponent(allowed)}`);

  assert.equal(response.status, 404);
  assert.equal(await response.text(), 'not found');
});

test('a permission loss before the asset stream opens is handled without an unhandled error', async (t) => {
  const dir = withTempDir(t);
  const allowed = path.join(dir, 'allowed.png');
  fs.writeFileSync(allowed, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  const grants = new PathGrants();
  grants.grant(allowed, { kind: 'file', access: ['asset'] });

  const fsImpl = Object.create(fs);
  fsImpl.createReadStream = () => {
    const stream = new PassThrough();
    process.nextTick(() => {
      const err = new Error('permission revoked');
      err.code = 'EACCES';
      stream.emit('error', err);
    });
    return stream;
  };

  const { server, url } = await startAssetServer({ pathGrants: grants, fsImpl });
  t.after(() => closeServer(server));
  const response = await fetch(`${url}/img?path=${encodeURIComponent(allowed)}`);

  assert.equal(response.status, 404);
  assert.equal(await response.text(), 'not found');
});

test('listen failures reject and do not leave a second server running', async (t) => {
  const blocker = net.createServer();
  await new Promise((resolve, reject) => {
    blocker.once('error', reject);
    blocker.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => (blocker.listening ? closeServer(blocker) : undefined));
  const port = blocker.address().port;

  let unexpected;
  let listenError;
  try {
    unexpected = await startAssetServer({ pathGrants: new PathGrants(), port });
  } catch (err) {
    listenError = err;
  }
  if (unexpected) await closeServer(unexpected.server);

  assert.equal(unexpected, undefined);
  assert.equal(listenError && listenError.code, 'EADDRINUSE');
});
