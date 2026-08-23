'use strict';

const fs = require('fs');
const path = require('path');

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

const surfaces = [
  {
    file: 'README.md',
    pattern: /当前发布 \*\*v([^*]+)\*\*/g,
    replacement: (version) => `当前发布 **v${version}**`,
  },
  {
    file: 'HANDOFF.md',
    pattern: /最新发布：v([^（\s]+)(?=（)/g,
    replacement: (version) => `最新发布：v${version}`,
  },
  {
    file: 'HANDOFF.md',
    pattern: /最后更新：\d{4}-\d{2}-\d{2}（v([^）]+)）/g,
    replacement: (version, date) => `最后更新：${date}（v${version}）`,
  },
  {
    file: 'site/index.html',
    pattern: /<span class="eyebrow">v([^\s<]+)(?= ·)/g,
    replacement: (version) => `<span class="eyebrow">v${version}`,
  },
  {
    file: 'site/index.html',
    pattern: /<span class="rel-tag">v([^\s<]+)(?= 更新)/g,
    replacement: (version) => `<span class="rel-tag">v${version}`,
  },
  {
    file: 'docs/index.html',
    pattern: /<span class="eyebrow">v([^\s<]+)(?= ·)/g,
    replacement: (version) => `<span class="eyebrow">v${version}`,
  },
  {
    file: 'docs/index.html',
    pattern: /<span class="rel-tag">v([^\s<]+)(?= 更新)/g,
    replacement: (version) => `<span class="rel-tag">v${version}`,
  },
];

function assertSemver(version) {
  if (!SEMVER.test(version)) throw new Error(`invalid release version: ${version}`);
  return version;
}

function matchesFor(text, pattern) {
  pattern.lastIndex = 0;
  return [...text.matchAll(pattern)];
}

function replaceExactly(text, pattern, replacement, label) {
  const matches = matchesFor(text, pattern);
  if (matches.length !== 1) throw new Error(`${label}: expected one version marker, found ${matches.length}`);
  pattern.lastIndex = 0;
  return text.replace(pattern, replacement);
}

function packageVersion(root) {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  return assertSemver(pkg.version);
}

function checkVersions(root) {
  const version = packageVersion(root);
  const errors = [];

  for (const surface of surfaces) {
    const file = path.join(root, surface.file);
    if (!fs.existsSync(file)) {
      errors.push(`${surface.file}: missing`);
      continue;
    }
    const matches = matchesFor(fs.readFileSync(file, 'utf8'), surface.pattern);
    if (matches.length !== 1) errors.push(`${surface.file}: expected one marker, found ${matches.length}`);
    else if (matches[0][1] !== version) errors.push(`${surface.file}: v${matches[0][1]} != package v${version}`);
  }

  const site = fs.readFileSync(path.join(root, 'site/index.html'), 'utf8');
  const docs = fs.readFileSync(path.join(root, 'docs/index.html'), 'utf8');
  if (site !== docs) errors.push('site/index.html and docs/index.html differ');

  if (errors.length > 0) throw new Error(errors.join('\n'));
  return { version, surfaces: surfaces.length };
}

function syncVersions(root, requestedVersion) {
  const pkgPath = path.join(root, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  const version = assertSemver(requestedVersion || pkg.version);
  const date = new Date().toISOString().slice(0, 10);

  if (pkg.version !== version) {
    pkg.version = version;
    fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
  }

  for (const surface of surfaces) {
    const file = path.join(root, surface.file);
    const original = fs.readFileSync(file, 'utf8');
    const updated = replaceExactly(
      original,
      surface.pattern,
      surface.replacement(version, date),
      surface.file,
    );
    if (updated !== original) fs.writeFileSync(file, updated);
  }

  checkVersions(root);
  return version;
}

module.exports = {
  SEMVER,
  assertSemver,
  checkVersions,
  packageVersion,
  replaceExactly,
  syncVersions,
};
