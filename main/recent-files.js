'use strict';

const fs = require('fs');

function storedPaths(store, key) {
  try {
    const value = store.get(key, []);
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function filterByStat(paths, predicate, fsApi) {
  return paths.filter((path) => {
    if (typeof path !== 'string' || !path) return false;
    try {
      return predicate(fsApi.statSync(path));
    } catch {
      // 文件可能在读取 recent.json 后、stat 前被移动或删除；只跳过当前项。
      return false;
    }
  });
}

function readExistingRecent(store, fsApi = fs) {
  return {
    files: filterByStat(storedPaths(store, 'files'), (stat) => stat.isFile(), fsApi),
    folders: filterByStat(storedPaths(store, 'folders'), (stat) => stat.isDirectory(), fsApi),
  };
}

module.exports = { readExistingRecent };
