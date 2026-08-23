const fs = require('fs');
const path = require('path');

const ACCESS = new Set(['read', 'write', 'asset']);

function normalizeForCompare(value) {
  return process.platform === 'win32' ? value.toLowerCase() : value;
}

class PathGrants {
  constructor({ fsImpl = fs, pathImpl = path } = {}) {
    this.fs = fsImpl;
    this.path = pathImpl;
    this.entries = [];
  }

  grant(input, { kind = 'auto', access = ['read'] } = {}) {
    const canonical = this._canonical(input);
    if (!canonical) return { ok: false, error: '路径无效' };

    let resolvedKind = kind;
    if (resolvedKind === 'auto') {
      try {
        resolvedKind = this.fs.statSync(canonical).isDirectory() ? 'directory' : 'file';
      } catch {
        resolvedKind = 'file';
      }
    }
    if (resolvedKind !== 'file' && resolvedKind !== 'directory') {
      return { ok: false, error: '授权类型无效' };
    }

    const allowedAccess = new Set((Array.isArray(access) ? access : [access]).filter((item) => ACCESS.has(item)));
    if (allowedAccess.size === 0) return { ok: false, error: '授权范围无效' };

    const key = normalizeForCompare(canonical);
    const existing = this.entries.find((entry) => entry.key === key && entry.kind === resolvedKind);
    if (existing) {
      for (const item of allowedAccess) existing.access.add(item);
    } else {
      this.entries.push({ path: canonical, key, kind: resolvedKind, access: allowedAccess });
    }
    return { ok: true, path: canonical, kind: resolvedKind };
  }

  allows(input, access = 'read') {
    if (!ACCESS.has(access)) return false;
    const canonical = this._canonical(input);
    if (!canonical) return false;
    const candidate = normalizeForCompare(canonical);
    return this.entries.some((entry) => {
      if (!entry.access.has(access)) return false;
      if (entry.kind === 'file') return candidate === entry.key;
      const relative = this.path.relative(entry.path, canonical);
      return relative === ''
        || (relative !== '..'
          && !relative.startsWith(`..${this.path.sep}`)
          && !this.path.isAbsolute(relative));
    });
  }

  _canonical(input) {
    if (typeof input !== 'string' || input.length === 0 || input.includes('\0') || !this.path.isAbsolute(input)) {
      return null;
    }

    const absolute = this.path.resolve(input);
    let cursor = absolute;
    const missing = [];
    while (true) {
      try {
        const real = this.fs.realpathSync.native
          ? this.fs.realpathSync.native(cursor)
          : this.fs.realpathSync(cursor);
        return this.path.resolve(real, ...missing.reverse());
      } catch {
        try {
          this.fs.lstatSync(cursor);
          // The path itself exists but cannot be resolved. This includes a
          // dangling symlink, which must not be treated as a missing filename
          // inside an otherwise granted directory.
          return null;
        } catch (error) {
          if (error?.code !== 'ENOENT' && error?.code !== 'ENOTDIR') return null;
        }
        const parent = this.path.dirname(cursor);
        if (parent === cursor) return null;
        missing.push(this.path.basename(cursor));
        cursor = parent;
      }
    }
  }
}

module.exports = { PathGrants };
