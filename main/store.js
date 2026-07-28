// 极简 JSON 持久化存储（原子写入）
const fs = require('fs');
const path = require('path');

class Store {
  constructor(file, defaults = {}) {
    this.file = file;
    this.defaults = defaults;
    this.data = { ...defaults };
    try {
      const raw = fs.readFileSync(file, 'utf-8');
      this.data = { ...defaults, ...JSON.parse(raw) };
    } catch (e) {
      // 首次运行或文件损坏，使用默认值
    }
  }

  get(key, fallback) {
    if (key === undefined) return { ...this.data };
    const v = this.data[key];
    return v === undefined ? fallback : v;
  }

  set(key, value) {
    if (key !== null && typeof key === 'object') {
      this.data = { ...this.data, ...key };
    } else {
      this.data[key] = value;
    }
    this._save();
  }

  _save() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = this.file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf-8');
      fs.renameSync(tmp, this.file);
    } catch (e) {
      // 静默失败，不影响主流程
    }
  }
}

module.exports = { Store };
