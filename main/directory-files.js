const fs = require('fs');
const path = require('path');

const MD_EXTS = new Set(['.md', '.markdown', '.mdown', '.mdtxt', '.text', '.txt']);
const IMG_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp']);
const PREVIEW_EXTS = new Set(['.pdf']);

async function mapWithConcurrency(values, limit, mapper) {
  const results = new Array(values.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, values.length) }, async () => {
    while (next < values.length) {
      const index = next++;
      results[index] = await mapper(values[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

async function readDirectory(dir, { sort = 'name', allows = () => true, fsPromises = fs.promises } = {}) {
  try {
    const names = await fsPromises.readdir(dir);
    // 限制并发 stat，避免超大目录一次性向 libuv 队列灌入数千个任务。
    const entries = (await mapWithConcurrency(names, 32, async (name) => {
      if (name.startsWith('.') || name === 'node_modules') return null;
      const full = path.join(dir, name);
      if (!allows(full)) return null;
      let stat;
      try {
        stat = await fsPromises.stat(full);
      } catch {
        return null;
      }
      if (stat.isDirectory()) {
        return { name, path: full, isDir: true, mtime: stat.mtimeMs };
      }
      const ext = path.extname(name).toLowerCase();
      if (!MD_EXTS.has(ext) && !IMG_EXTS.has(ext) && !PREVIEW_EXTS.has(ext)) return null;
      return {
        name,
        path: full,
        isDir: false,
        isImage: IMG_EXTS.has(ext),
        isPreview: PREVIEW_EXTS.has(ext),
        mtime: stat.mtimeMs,
        size: stat.size,
      };
    })).filter(Boolean);

    entries.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      if (sort === 'mtime') return (b.mtime || 0) - (a.mtime || 0);
      return a.name.localeCompare(b.name, 'zh-Hans-CN', { numeric: true });
    });
    return { ok: true, entries };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function walkMarkdown(root, {
  allows = () => true,
  fsPromises = fs.promises,
  maxDepth = 8,
  maxFiles = 2000,
  maxEntries = 10000,
} = {}) {
  const out = [];
  let visitedEntries = 0;

  const walk = async (dir, depth) => {
    if (depth > maxDepth || out.length >= maxFiles || visitedEntries >= maxEntries) return;
    let names;
    try {
      names = await fsPromises.readdir(dir);
    } catch {
      return;
    }

    for (const name of names) {
      if (out.length >= maxFiles || visitedEntries >= maxEntries) break;
      if (name.startsWith('.') || name === 'node_modules') continue;
      visitedEntries += 1;
      const full = path.join(dir, name);
      if (!allows(full)) continue;
      let stat;
      try {
        stat = await fsPromises.stat(full);
      } catch {
        continue;
      }
      if (stat.isDirectory()) {
        await walk(full, depth + 1);
      } else if (MD_EXTS.has(path.extname(name).toLowerCase())) {
        out.push({ name, path: full, rel: path.relative(root, full), mtime: stat.mtimeMs });
      }
    }
  };

  await walk(root, 0);
  out.sort((a, b) => b.mtime - a.mtime);
  return out;
}

module.exports = { readDirectory, walkMarkdown };
