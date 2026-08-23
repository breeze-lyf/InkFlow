// 极简 JSON 持久化存储（原子写入）
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const MAX_STORE_BYTES = 8 * 1024 * 1024;
const MAX_CONFIGURED_STORE_BYTES = 128 * 1024 * 1024;

function errorText(err) {
  return err && err.message ? err.message : String(err);
}

function bestEffortSyncDirectory(directory, fsImpl) {
  let fd;
  try {
    fd = fsImpl.openSync(directory, 'r');
    fsImpl.fsyncSync(fd);
  } catch {
    // Windows 与部分文件系统不允许目录 fsync；文件本身已经同步并原子替换。
  } finally {
    if (fd !== undefined) {
      try { fsImpl.closeSync(fd); } catch { /* 忽略关闭失败 */ }
    }
  }
}

function validStoreSize(size, maxBytes) {
  return Number.isSafeInteger(size) && size >= 0 && size <= maxBytes;
}

function storeLimitError(message) {
  const error = new Error(message);
  error.code = 'STORE_TOO_LARGE';
  return error;
}

function readUtf8FileBounded(file, maxBytes, fsImpl) {
  const beforeOpen = fsImpl.statSync(file);
  if (!validStoreSize(beforeOpen.size, maxBytes)) throw storeLimitError('存储文件超过读取限制');

  let fd;
  try {
    fd = fsImpl.openSync(file, 'r');
    const opened = typeof fsImpl.fstatSync === 'function' ? fsImpl.fstatSync(fd) : beforeOpen;
    if (!validStoreSize(opened.size, maxBytes)) throw storeLimitError('存储文件超过读取限制');

    const buffer = Buffer.allocUnsafe(opened.size);
    let offset = 0;
    while (offset < buffer.length) {
      const bytesRead = fsImpl.readSync(fd, buffer, offset, buffer.length - offset, offset);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }

    const probe = Buffer.allocUnsafe(1);
    if (fsImpl.readSync(fd, probe, 0, 1, offset) !== 0) {
      throw storeLimitError('存储文件在读取期间超过限制');
    }
    return buffer.subarray(0, offset).toString('utf-8');
  } finally {
    if (fd !== undefined) fsImpl.closeSync(fd);
  }
}

class Store {
  constructor(file, defaults = {}, dependencies = {}) {
    this.file = file;
    this.defaults = defaults;
    this.fs = dependencies && dependencies.fsImpl ? dependencies.fsImpl : fs;
    this.logger = dependencies && dependencies.logger ? dependencies.logger : console;
    const configuredMax = dependencies && dependencies.maxBytes;
    this.maxBytes = Number.isSafeInteger(configuredMax) && configuredMax > 0
      ? Math.min(configuredMax, MAX_CONFIGURED_STORE_BYTES)
      : MAX_STORE_BYTES;
    this.loadBarrier = '';
    this.data = { ...defaults };
    try {
      const raw = readUtf8FileBounded(file, this.maxBytes, this.fs);
      this.data = { ...defaults, ...JSON.parse(raw) };
    } catch (e) {
      // 首次运行或文件损坏，使用默认值
      if (e && e.code === 'STORE_TOO_LARGE') this.loadBarrier = e.message;
    }
  }

  get(key, fallback) {
    if (key === undefined) return { ...this.data };
    const v = this.data[key];
    return v === undefined ? fallback : v;
  }

  set(key, value) {
    const previous = this.data;
    if (key !== null && typeof key === 'object') {
      this.data = { ...this.data, ...key };
    } else {
      this.data = { ...this.data, [key]: value };
    }
    const result = this._save();
    if (!result.ok) this.data = previous;
    return result;
  }

  _save() {
    const fsImpl = this.fs;
    const directory = path.dirname(this.file);
    let tmp;
    let fd;
    try {
      if (this.loadBarrier) throw new Error(this.loadBarrier);
      const serialized = JSON.stringify(this.data, null, 2);
      if (typeof serialized !== 'string' || Buffer.byteLength(serialized, 'utf-8') > this.maxBytes) {
        throw new Error(`存储数据超过 ${this.maxBytes} 字节限制`);
      }
      fsImpl.mkdirSync(directory, { recursive: true });
      tmp = `${this.file}.tmp-${process.pid}-${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
      const flags = fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL;
      fd = fsImpl.openSync(tmp, flags, 0o600);
      fsImpl.writeFileSync(fd, serialized, 'utf-8');
      if (typeof fsImpl.fchmodSync === 'function') fsImpl.fchmodSync(fd, 0o600);
      else fsImpl.chmodSync(tmp, 0o600);
      fsImpl.fsyncSync(fd);
      fsImpl.closeSync(fd);
      fd = undefined;
      fsImpl.chmodSync(tmp, 0o600);
      fsImpl.renameSync(tmp, this.file);
      bestEffortSyncDirectory(directory, fsImpl);
      return { ok: true };
    } catch (e) {
      if (fd !== undefined) {
        try { fsImpl.closeSync(fd); } catch { /* 写入异常后尽力释放句柄 */ }
      }
      if (tmp) {
        try { fsImpl.unlinkSync(tmp); } catch { /* 临时文件可能尚未创建 */ }
      }
      this.logger.error(`[store] 写入失败 ${this.file}:`, errorText(e));
      return { ok: false, error: errorText(e) };
    }
  }
}

module.exports = { MAX_STORE_BYTES, Store };
