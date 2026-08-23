'use strict';

const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_HEAP_MB = 256;
const MAX_DOCX_INPUT_BYTES = 20 * 1024 * 1024;
const MAX_DOCX_OUTPUT_BYTES = 64 * 1024 * 1024;

function errorText(error) {
  return error && error.message ? error.message : String(error);
}

function writePrivateFile(file, content, fsImpl) {
  let fd;
  try {
    const flags = fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL;
    fd = fsImpl.openSync(file, flags, 0o600);
    fsImpl.writeFileSync(fd, content, 'utf8');
    if (typeof fsImpl.fchmodSync === 'function') fsImpl.fchmodSync(fd, 0o600);
    fsImpl.fsyncSync(fd);
    fsImpl.closeSync(fd);
    fd = undefined;
  } finally {
    if (fd !== undefined) {
      try { fsImpl.closeSync(fd); } catch { /* best effort */ }
    }
  }
}

function createPrivateJob(html, { rootDir, fsImpl }) {
  const directory = fsImpl.mkdtempSync(path.join(rootDir, 'inkflow-docx-'));
  const inputPath = path.join(directory, 'document.html');
  const outputPath = path.join(directory, 'document.docx');
  try {
    if (typeof fsImpl.chmodSync === 'function') fsImpl.chmodSync(directory, 0o700);
    writePrivateFile(inputPath, html, fsImpl);
    return { directory, inputPath, outputPath };
  } catch (error) {
    try { fsImpl.rmSync(directory, { recursive: true, force: true }); } catch { /* best effort */ }
    throw error;
  }
}

function createNodeWorkerSpawner({ childProcessImpl = childProcess } = {}) {
  return (workerPath, { heapMb = DEFAULT_HEAP_MB } = {}) => childProcessImpl.fork(workerPath, [], {
    execArgv: [`--max-old-space-size=${heapMb}`],
    serialization: 'json',
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
  });
}

function createUtilityWorkerSpawner(utilityProcessImpl) {
  if (!utilityProcessImpl || typeof utilityProcessImpl.fork !== 'function') {
    throw new TypeError('Electron utilityProcess 不可用');
  }
  return (workerPath, { heapMb = DEFAULT_HEAP_MB } = {}) => {
    const worker = utilityProcessImpl.fork(workerPath, [], {
      execArgv: [`--max-old-space-size=${heapMb}`],
      serviceName: 'InkFlow Word Converter',
      stdio: 'ignore',
    });
    // Electron does not queue postMessage calls made before UtilityProcess emits
    // `spawn`; the converter waits for that lifecycle boundary before dispatching.
    worker.inkflowWaitForSpawn = true;
    return worker;
  };
}

function sendToWorker(worker, message) {
  if (worker && typeof worker.postMessage === 'function') worker.postMessage(message);
  else if (worker && typeof worker.send === 'function') worker.send(message);
  else throw new Error('Word 转换进程无法接收任务');
}

function terminateWorker(worker) {
  if (!worker) return;
  try {
    if (typeof worker.kill === 'function') worker.kill();
    else if (typeof worker.terminate === 'function') worker.terminate();
  } catch { /* best effort */ }
}

function readDocxOutput(outputPath, fsImpl) {
  const stat = fsImpl.lstatSync(outputPath);
  if (!stat.isFile()) throw new Error('Word 转换结果不是普通文件');
  if (stat.size < 4 || stat.size > MAX_DOCX_OUTPUT_BYTES) throw new Error('Word 转换结果体积异常');
  const output = fsImpl.readFileSync(outputPath);
  if (!Buffer.isBuffer(output) || output[0] !== 0x50 || output[1] !== 0x4b) {
    throw new Error('Word 转换结果格式无效');
  }
  return output;
}

async function convertHtmlToDocx(html, options = {}) {
  if (typeof html !== 'string') throw new TypeError('Word 导出内容必须是字符串');
  if (Buffer.byteLength(html, 'utf8') > MAX_DOCX_INPUT_BYTES) {
    throw new Error('Word 导出内容超过转换进程输入上限');
  }
  const fsImpl = options.fsImpl || fs;
  const rootDir = options.rootDir || os.tmpdir();
  if (typeof rootDir !== 'string' || !path.isAbsolute(rootDir)) throw new TypeError('Word 临时目录必须是绝对路径');
  const timeoutMs = Number.isSafeInteger(options.timeoutMs) && options.timeoutMs > 0
    ? options.timeoutMs : DEFAULT_TIMEOUT_MS;
  const heapMb = Number.isSafeInteger(options.heapMb) && options.heapMb >= 128 && options.heapMb <= 512
    ? options.heapMb : DEFAULT_HEAP_MB;
  const workerPath = options.workerPath || path.join(__dirname, 'docx-worker.js');
  const spawnWorker = options.spawnWorker || (() => {
    throw new Error('Word 转换进程未配置');
  });
  const job = createPrivateJob(html, { rootDir, fsImpl });
  let worker;
  try {
    worker = spawnWorker(workerPath, { heapMb });
    const output = await new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) reject(error);
        else resolve(value);
      };
      const timer = setTimeout(() => finish(new Error('Word 导出超时，请重试')), timeoutMs);
      worker.once('message', (message) => {
        if (!message || message.ok !== true) {
          finish(new Error(message && message.error ? message.error : 'Word 转换失败'));
          return;
        }
        try {
          finish(null, readDocxOutput(job.outputPath, fsImpl));
        } catch (error) {
          finish(error);
        }
      });
      worker.once('error', (...args) => finish(new Error(`Word 转换进程异常：${args.map(errorText).join(' ')}`)));
      worker.once('exit', (code) => {
        if (!settled) finish(new Error(`Word 转换进程提前退出（${code == null ? 'unknown' : code}）`));
      });
      const dispatch = () => {
        try {
          sendToWorker(worker, { inputPath: job.inputPath, outputPath: job.outputPath });
        } catch (error) {
          finish(error);
        }
      };
      if (worker.inkflowWaitForSpawn) worker.once('spawn', dispatch);
      else dispatch();
    });
    return output;
  } finally {
    terminateWorker(worker);
    try { fsImpl.rmSync(job.directory, { recursive: true, force: true }); } catch { /* best effort */ }
  }
}

module.exports = {
  MAX_DOCX_INPUT_BYTES,
  convertHtmlToDocx,
  createNodeWorkerSpawner,
  createUtilityWorkerSpawner,
};
