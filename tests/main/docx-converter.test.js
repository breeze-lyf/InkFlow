'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { EventEmitter } = require('node:events');
const {
  convertHtmlToDocx,
  createNodeWorkerSpawner,
  createUtilityWorkerSpawner,
} = require('../../main/docx-converter');

test('a small Word document is converted in an isolated worker and leaves no private temporary files', async (t) => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'inkflow-docx-test-'));
  t.after(() => fs.rmSync(rootDir, { recursive: true, force: true }));

  const docx = await convertHtmlToDocx(
    '<!doctype html><html><body><h1>墨流</h1><p>隔离转换正常。</p></body></html>',
    { rootDir, spawnWorker: createNodeWorkerSpawner() },
  );

  assert.ok(Buffer.isBuffer(docx));
  assert.equal(docx.subarray(0, 2).toString('ascii'), 'PK');
  assert.ok(docx.length > 1000);
  assert.deepEqual(fs.readdirSync(rootDir), []);
});

test('a stalled Word worker is terminated at the deadline and its private job directory is removed', async (t) => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'inkflow-docx-timeout-'));
  t.after(() => fs.rmSync(rootDir, { recursive: true, force: true }));
  const worker = new EventEmitter();
  worker.postMessage = () => {};
  worker.kill = () => { worker.killed = true; return true; };

  await assert.rejects(
    convertHtmlToDocx('<p>never finishes</p>', {
      rootDir,
      timeoutMs: 15,
      spawnWorker: () => worker,
    }),
    /Word 导出超时，请重试/,
  );

  assert.equal(worker.killed, true);
  assert.deepEqual(fs.readdirSync(rootDir), []);
});

test('a failed Word worker returns its clear error and still removes the private job directory', async (t) => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'inkflow-docx-failure-'));
  t.after(() => fs.rmSync(rootDir, { recursive: true, force: true }));
  const worker = new EventEmitter();
  worker.postMessage = () => setImmediate(() => worker.emit('message', { ok: false, error: '文档结构无法转换' }));
  worker.kill = () => { worker.killed = true; return true; };

  await assert.rejects(
    convertHtmlToDocx('<p>invalid conversion</p>', { rootDir, spawnWorker: () => worker }),
    /文档结构无法转换/,
  );

  assert.equal(worker.killed, true);
  assert.deepEqual(fs.readdirSync(rootDir), []);
});

test('the Electron utility process is launched with a bounded Node heap and no inherited output', () => {
  const child = new EventEmitter();
  const calls = [];
  const spawnWorker = createUtilityWorkerSpawner({
    fork(workerPath, args, options) {
      calls.push({ workerPath, args, options });
      return child;
    },
  });

  assert.equal(spawnWorker('/app/main/docx-worker.js', { heapMb: 256 }), child);
  assert.deepEqual(calls, [{
    workerPath: '/app/main/docx-worker.js',
    args: [],
    options: {
      execArgv: ['--max-old-space-size=256'],
      serviceName: 'InkFlow Word Converter',
      stdio: 'ignore',
    },
  }]);
});

test('a Word task is posted only after the Electron utility process has spawned', async (t) => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'inkflow-docx-spawn-'));
  t.after(() => fs.rmSync(rootDir, { recursive: true, force: true }));
  const child = new EventEmitter();
  let posted = false;
  child.postMessage = ({ outputPath }) => {
    posted = true;
    fs.writeFileSync(outputPath, Buffer.from('PK\x03\x04'));
    setImmediate(() => child.emit('message', { ok: true }));
  };
  child.kill = () => true;
  const spawnWorker = createUtilityWorkerSpawner({ fork: () => child });

  const conversion = convertHtmlToDocx('<p>spawn boundary</p>', { rootDir, spawnWorker });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(posted, false);
  child.emit('spawn');

  const docx = await conversion;
  assert.equal(posted, true);
  assert.equal(docx.subarray(0, 2).toString('ascii'), 'PK');
  assert.deepEqual(fs.readdirSync(rootDir), []);
});
