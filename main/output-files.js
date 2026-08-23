'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function errorText(error) {
  return error && error.message ? error.message : String(error);
}

function realpath(file, fsImpl) {
  const resolve = fsImpl.realpathSync.native || fsImpl.realpathSync;
  return resolve(file);
}

function targetInfo(requested, fsImpl) {
  try {
    const requestedStat = fsImpl.lstatSync(requested);
    const target = requestedStat.isSymbolicLink() ? realpath(requested, fsImpl) : requested;
    const stat = fsImpl.lstatSync(target);
    if (!stat.isFile()) throw new Error('导出目标不是普通文件');
    return { target, mode: stat.mode & 0o7777 };
  } catch (error) {
    if (error && error.code === 'ENOENT') return { target: requested, mode: 0o600 };
    throw error;
  }
}

function syncDirectory(directory, fsImpl) {
  let fd;
  try {
    fd = fsImpl.openSync(directory, 'r');
    fsImpl.fsyncSync(fd);
  } catch {
    // Windows 和部分网络文件系统不支持目录 fsync；文件已完成强制落盘。
  } finally {
    if (fd !== undefined) {
      try { fsImpl.closeSync(fd); } catch { /* best effort */ }
    }
  }
}

function writeOutputFile(file, content, { fsImpl = fs } = {}) {
  if (typeof file !== 'string' || !path.isAbsolute(file)
    || !(typeof content === 'string' || Buffer.isBuffer(content) || ArrayBuffer.isView(content))) {
    return { ok: false, error: '导出写入参数无效' };
  }
  let info;
  try {
    info = targetInfo(file, fsImpl);
  } catch (error) {
    return { ok: false, error: errorText(error) };
  }
  const directory = path.dirname(info.target);
  const temporary = path.join(
    directory,
    `.${path.basename(info.target)}.inktmp-${process.pid}-${Date.now()}-${crypto.randomBytes(6).toString('hex')}`,
  );
  let fd;
  try {
    fsImpl.mkdirSync(directory, { recursive: true });
    const flags = fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL;
    fd = fsImpl.openSync(temporary, flags, info.mode);
    if (typeof content === 'string') fsImpl.writeFileSync(fd, content, 'utf8');
    else fsImpl.writeFileSync(fd, content);
    if (typeof fsImpl.fchmodSync === 'function') fsImpl.fchmodSync(fd, info.mode);
    fsImpl.fsyncSync(fd);
    fsImpl.closeSync(fd);
    fd = undefined;
    fsImpl.chmodSync(temporary, info.mode);
    fsImpl.renameSync(temporary, info.target);
    syncDirectory(directory, fsImpl);
    return { ok: true };
  } catch (error) {
    if (fd !== undefined) {
      try { fsImpl.closeSync(fd); } catch { /* best effort */ }
    }
    try { fsImpl.unlinkSync(temporary); } catch { /* 临时文件可能尚未创建 */ }
    return { ok: false, error: errorText(error) };
  }
}

module.exports = { writeOutputFile };
