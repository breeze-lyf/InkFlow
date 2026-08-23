const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;

function errorText(err) {
  return err && err.message ? err.message : String(err);
}

function assertDocumentByteLimit(stat) {
  if (!Number.isSafeInteger(stat.size) || stat.size < 0 || stat.size > MAX_DOCUMENT_BYTES) {
    throw new Error('document-too-large');
  }
}

function assertReadableDocumentStat(stat) {
  if (!stat || typeof stat.isFile !== 'function' || !stat.isFile()) {
    throw new Error('文档目标不是普通文件');
  }
  assertDocumentByteLimit(stat);
}

function readBoundedUtf8(file, fsImpl) {
  const content = fsImpl.readFileSync(file, 'utf-8');
  if (Buffer.byteLength(content, 'utf-8') > MAX_DOCUMENT_BYTES) {
    throw new Error('document-too-large');
  }
  return content;
}

function readDocument(file, { fsImpl = fs } = {}) {
  if (typeof file !== 'string' || !path.isAbsolute(file)) {
    return { ok: false, error: '文档读取参数无效' };
  }
  try {
    const requestedStat = fsImpl.lstatSync(file);
    const stat = requestedStat.isSymbolicLink() ? fsImpl.statSync(file) : requestedStat;
    assertReadableDocumentStat(stat);
    return { ok: true, content: readBoundedUtf8(file, fsImpl) };
  } catch (err) {
    return { ok: false, error: errorText(err) };
  }
}

function realpath(file, fsImpl) {
  const realpathSync = fsImpl.realpathSync.native || fsImpl.realpathSync;
  return realpathSync(file);
}

function sameStatSnapshot(before, after) {
  if (!before || !after) return false;
  return ['dev', 'ino', 'mode', 'nlink', 'size', 'mtimeMs', 'ctimeMs']
    .every((key) => before[key] === after[key]);
}

function conflict(exists, diskContent = '') {
  return { ok: false, conflict: true, exists, diskContent };
}

function inspectTarget(file, fsImpl) {
  let stat;
  try {
    stat = fsImpl.lstatSync(file);
  } catch (err) {
    if (err && err.code === 'ENOENT') return { exists: false, stat: undefined, diskContent: '' };
    throw err;
  }
  if (!stat.isFile()) return { exists: true, stat, diskContent: '' };
  assertDocumentByteLimit(stat);

  try {
    return { exists: true, stat, diskContent: readBoundedUtf8(file, fsImpl) };
  } catch (err) {
    if (err && err.code === 'ENOENT') return { exists: false, stat: undefined, diskContent: '' };
    throw err;
  }
}

function resolveWriteTarget(file, fsImpl) {
  let requestedStat;
  try {
    requestedStat = fsImpl.lstatSync(file);
  } catch (err) {
    if (err && err.code === 'ENOENT') return { requested: file, target: file, exists: false };
    throw err;
  }

  let target = file;
  if (requestedStat.isSymbolicLink()) {
    target = realpath(file, fsImpl);
  }
  const targetStat = fsImpl.lstatSync(target);
  assertReadableDocumentStat(targetStat);
  return {
    requested: file,
    requestedStat,
    target,
    targetStat,
    exists: true,
    diskContent: readBoundedUtf8(target, fsImpl),
  };
}

function recheckSnapshot(snapshot, fsImpl) {
  if (!snapshot.exists) {
    const current = inspectTarget(snapshot.target, fsImpl);
    return current.exists ? conflict(true, current.diskContent) : null;
  }

  if (snapshot.requestedStat.isSymbolicLink()) {
    let requestedStat;
    try {
      requestedStat = fsImpl.lstatSync(snapshot.requested);
    } catch (err) {
      if (err && err.code === 'ENOENT') return conflict(false);
      throw err;
    }
    if (!requestedStat.isSymbolicLink() || !sameStatSnapshot(snapshot.requestedStat, requestedStat)) {
      return conflict(true);
    }
    let currentTarget;
    try {
      currentTarget = realpath(snapshot.requested, fsImpl);
    } catch (err) {
      if (err && err.code === 'ENOENT') return conflict(false);
      throw err;
    }
    if (path.resolve(currentTarget) !== path.resolve(snapshot.target)) return conflict(true);
  }

  const current = inspectTarget(snapshot.target, fsImpl);
  if (!current.exists) return conflict(false);
  if (!current.stat.isFile()
    || !sameStatSnapshot(snapshot.targetStat, current.stat)
    || current.diskContent !== snapshot.diskContent) {
    return conflict(true, current.diskContent);
  }
  return null;
}

function fsyncFile(file, fsImpl) {
  if (typeof fsImpl.openSync !== 'function' || typeof fsImpl.fsyncSync !== 'function'
    || typeof fsImpl.closeSync !== 'function') return;
  let fd;
  let failure;
  try {
    fd = fsImpl.openSync(file, 'r');
    fsImpl.fsyncSync(fd);
  } catch (err) {
    failure = err;
  } finally {
    if (fd !== undefined) {
      try { fsImpl.closeSync(fd); } catch (err) { if (!failure) failure = err; }
    }
  }
  if (failure) throw failure;
}

function bestEffortDirectoryFsync(directory, fsImpl) {
  try {
    fsyncFile(directory, fsImpl);
  } catch {
    // Windows 以及部分网络文件系统不支持打开/同步目录；文件本身已经完成强制落盘。
  }
}

function writeDocument(file, content, options = {}, fsImpl = fs) {
  if (typeof file !== 'string' || !path.isAbsolute(file) || typeof content !== 'string') {
    return { ok: false, error: '文档写入参数无效' };
  }
  if (Buffer.byteLength(content, 'utf-8') > MAX_DOCUMENT_BYTES) {
    return { ok: false, error: 'document-too-large' };
  }

  const hasExpected = Object.prototype.hasOwnProperty.call(options || {}, 'expectedContent');
  if (hasExpected && typeof options.expectedContent !== 'string') {
    return { ok: false, error: 'expectedContent 必须是字符串' };
  }
  if (hasExpected && Buffer.byteLength(options.expectedContent, 'utf-8') > MAX_DOCUMENT_BYTES) {
    return { ok: false, error: 'document-too-large' };
  }

  let snapshot;
  try {
    snapshot = resolveWriteTarget(file, fsImpl);
  } catch (err) {
    return { ok: false, error: errorText(err) };
  }

  if (hasExpected && options.force !== true) {
    if (!snapshot.exists) return { ok: false, conflict: true, exists: false, diskContent: '' };
    if (snapshot.diskContent !== options.expectedContent) {
      return { ok: false, conflict: true, exists: true, diskContent: snapshot.diskContent };
    }
  }

  const target = snapshot.target;
  const tmp = `${target}.inktmp-${process.pid}-${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
  let fd;
  try {
    fsImpl.mkdirSync(path.dirname(target), { recursive: true });
    const targetMode = snapshot.exists ? snapshot.targetStat.mode & 0o7777 : undefined;
    const flags = fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL;
    fd = fsImpl.openSync(tmp, flags, targetMode === undefined ? 0o666 : targetMode);
    fsImpl.writeFileSync(fd, content, 'utf-8');
    const temporaryMode = targetMode === undefined && typeof fsImpl.fstatSync === 'function'
      ? fsImpl.fstatSync(fd).mode & 0o7777
      : targetMode;
    if (temporaryMode !== undefined) {
      if (typeof fsImpl.fchmodSync === 'function') fsImpl.fchmodSync(fd, temporaryMode);
      else if (typeof fsImpl.chmodSync === 'function') fsImpl.chmodSync(tmp, temporaryMode);
    }
    fsImpl.fsyncSync(fd);
    const writtenFd = fd;
    try {
      fsImpl.closeSync(writtenFd);
    } finally {
      fd = undefined;
    }
    const currentConflict = recheckSnapshot(snapshot, fsImpl);
    if (currentConflict) {
      try { fsImpl.unlinkSync(tmp); } catch { /* 临时文件可能已被外部清理 */ }
      return currentConflict;
    }
    fsImpl.renameSync(tmp, target);
    bestEffortDirectoryFsync(path.dirname(target), fsImpl);
    return { ok: true };
  } catch (err) {
    if (fd !== undefined) {
      try { fsImpl.closeSync(fd); } catch { /* 保留原始写入或同步错误 */ }
    }
    try { fsImpl.unlinkSync(tmp); } catch { /* 临时文件可能尚未创建 */ }
    return { ok: false, error: errorText(err) };
  }
}

module.exports = { MAX_DOCUMENT_BYTES, readDocument, writeDocument };
