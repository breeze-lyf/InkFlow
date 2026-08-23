'use strict';

const fs = require('node:fs');
const path = require('node:path');
const HTMLtoDOCX = require('html-to-docx');

const MAX_INPUT_BYTES = 20 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;

function errorText(error) {
  return error && error.message ? error.message : String(error);
}

function assertJob(job) {
  if (!job || typeof job.inputPath !== 'string' || typeof job.outputPath !== 'string'
    || !path.isAbsolute(job.inputPath) || !path.isAbsolute(job.outputPath)
    || path.dirname(job.inputPath) !== path.dirname(job.outputPath)
    || path.basename(job.inputPath) !== 'document.html'
    || path.basename(job.outputPath) !== 'document.docx') {
    throw new Error('Word 转换任务参数无效');
  }
}

function writePrivateOutput(file, bytes) {
  let fd;
  try {
    const flags = fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL;
    fd = fs.openSync(file, flags, 0o600);
    fs.writeFileSync(fd, bytes);
    fs.fchmodSync(fd, 0o600);
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
  } finally {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch { /* best effort */ }
    }
  }
}

async function convertJob(job) {
  assertJob(job);
  const stat = fs.lstatSync(job.inputPath);
  if (!stat.isFile() || stat.size > MAX_INPUT_BYTES) throw new Error('Word 转换输入文件无效');
  const html = fs.readFileSync(job.inputPath, 'utf8');
  const docx = await HTMLtoDOCX(html, null, {
    table: { row: { cantSplit: true } },
    footer: false,
    pageNumber: false,
  });
  if (!Buffer.isBuffer(docx) || docx.length < 4 || docx.length > MAX_OUTPUT_BYTES
    || docx[0] !== 0x50 || docx[1] !== 0x4b) {
    throw new Error('Word 转换结果无效');
  }
  writePrivateOutput(job.outputPath, docx);
}

function startNodeWorker() {
  process.once('message', async (job) => {
    try {
      await convertJob(job);
      process.send({ ok: true }, () => process.exit(0));
    } catch (error) {
      process.send({ ok: false, error: errorText(error) }, () => process.exit(1));
    }
  });
}

function startElectronWorker() {
  const { parentPort } = process;
  if (!parentPort || typeof parentPort.on !== 'function') return false;
  parentPort.once('message', async (event) => {
    try {
      await convertJob(event && Object.prototype.hasOwnProperty.call(event, 'data') ? event.data : event);
      parentPort.postMessage({ ok: true });
      setImmediate(() => process.exit(0));
    } catch (error) {
      parentPort.postMessage({ ok: false, error: errorText(error) });
      setImmediate(() => process.exit(1));
    }
  });
  return true;
}

if (!startElectronWorker() && typeof process.send === 'function') startNodeWorker();

module.exports = { convertJob };
