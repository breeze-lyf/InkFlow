'use strict';

const fs = require('fs');
const path = require('path');
const { fileURLToPath } = require('url');

const MARKDOWN_EXTENSIONS = new Set(['.md', '.markdown', '.mdown', '.mdtxt']);

function markdownFilesFromArgv(argv, { cwd = process.cwd(), fsImpl = fs, pathImpl = path } = {}) {
  const files = [];
  for (const raw of Array.isArray(argv) ? argv : []) {
    if (typeof raw !== 'string' || !raw || raw.startsWith('-')) continue;
    let candidate = raw;
    if (/^file:/i.test(candidate)) {
      try { candidate = fileURLToPath(candidate); } catch { continue; }
    }
    const absolute = pathImpl.isAbsolute(candidate) ? pathImpl.normalize(candidate) : pathImpl.resolve(cwd, candidate);
    if (!MARKDOWN_EXTENSIONS.has(pathImpl.extname(absolute).toLowerCase())) continue;
    try {
      if (!fsImpl.statSync(absolute).isFile()) continue;
    } catch {
      continue;
    }
    if (!files.includes(absolute)) files.push(absolute);
  }
  return files;
}

module.exports = { MARKDOWN_EXTENSIONS, markdownFilesFromArgv };
