const fs = require('fs');
const os = require('os');
const path = require('path');

function errorText(err) {
  return err && err.message ? err.message : String(err);
}

function cleanupPaths(file, directory, fsImpl) {
  let cleanupError;
  try {
    fsImpl.unlinkSync(file);
  } catch (err) {
    if (!err || err.code !== 'ENOENT') cleanupError = err;
  }
  try {
    fsImpl.rmdirSync(directory);
  } catch (err) {
    if ((!err || err.code !== 'ENOENT') && !cleanupError) cleanupError = err;
  }
  return cleanupError ? { ok: false, error: errorText(cleanupError) } : { ok: true };
}

function createExportTemp(content, { rootDir = os.tmpdir(), fsImpl = fs } = {}) {
  if (typeof content !== 'string') throw new TypeError('导出临时内容必须是字符串');
  if (typeof rootDir !== 'string' || !path.isAbsolute(rootDir)) {
    throw new TypeError('导出临时目录必须是绝对路径');
  }

  const directory = fsImpl.mkdtempSync(path.join(rootDir, 'inkflow-export-'));
  const file = path.join(directory, 'document.html');
  let fd;
  try {
    fsImpl.chmodSync(directory, 0o700);
    const flags = fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL;
    fd = fsImpl.openSync(file, flags, 0o600);
    fsImpl.writeFileSync(fd, content, 'utf-8');
    fsImpl.fchmodSync(fd, 0o600);
    fsImpl.fsyncSync(fd);
    fsImpl.closeSync(fd);
    fd = undefined;
    fsImpl.chmodSync(file, 0o600);
  } catch (err) {
    if (fd !== undefined) {
      try { fsImpl.closeSync(fd); } catch { /* 写入异常后尽力释放句柄 */ }
    }
    cleanupPaths(file, directory, fsImpl);
    throw err;
  }

  return {
    file,
    cleanup: () => cleanupPaths(file, directory, fsImpl),
  };
}

module.exports = { createExportTemp };
