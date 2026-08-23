#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { packageVersion } = require('./lib/version-tools');

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function hasZipEndRecord(file) {
  const size = fs.statSync(file).size;
  const length = Math.min(size, 65557);
  const fd = fs.openSync(file, 'r');
  const tail = Buffer.alloc(length);
  fs.readSync(fd, tail, 0, length, size - length);
  fs.closeSync(fd);
  return tail.includes(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
}

function validateFile(file) {
  const stat = fs.statSync(file);
  if (!stat.isFile() || stat.size < 1024 * 1024) throw new Error(`${path.basename(file)} is missing or implausibly small`);

  const fd = fs.openSync(file, 'r');
  const head = Buffer.alloc(4);
  fs.readSync(fd, head, 0, 4, 0);
  fs.closeSync(fd);

  const ext = path.extname(file).toLowerCase();
  if (ext === '.zip' && (head[0] !== 0x50 || head[1] !== 0x4b || !hasZipEndRecord(file))) {
    throw new Error(`${path.basename(file)} does not have a valid ZIP envelope`);
  }
  if (ext === '.dmg') {
    const trailer = Buffer.alloc(512);
    const dmgFd = fs.openSync(file, 'r');
    fs.readSync(dmgFd, trailer, 0, 512, stat.size - 512);
    fs.closeSync(dmgFd);
    if (trailer.subarray(0, 4).toString('ascii') !== 'koly') throw new Error(`${path.basename(file)} has no DMG koly trailer`);
  }
  if (ext === '.appimage' && head.subarray(1, 4).toString('ascii') !== 'ELF') {
    throw new Error(`${path.basename(file)} is not an ELF AppImage`);
  }
  if (ext === '.exe' && head.subarray(0, 2).toString('ascii') !== 'MZ') {
    throw new Error(`${path.basename(file)} is not a PE executable`);
  }
  return stat.size;
}

function artifactPatterns(platform, version) {
  const v = escapeRegExp(version);
  if (platform === 'mac') return [new RegExp(`-${v}[^/]*\\.dmg$`, 'i'), new RegExp(`-${v}[^/]*-mac\\.zip$`, 'i')];
  if (platform === 'win') return [new RegExp(`-Setup-${v}[^/]*\\.exe$`, 'i'), new RegExp(`-${v}[^/]*win[^/]*\\.zip$`, 'i')];
  if (platform === 'linux') return [new RegExp(`-${v}[^/]*\\.AppImage$`, 'i'), new RegExp(`-${v}[^/]*linux[^/]*\\.zip$`, 'i')];
  throw new Error(`unsupported platform: ${platform}`);
}

function inspectArtifacts(root, platform = 'mac', distOverride) {
  const version = packageVersion(root);
  const dist = distOverride ? path.resolve(distOverride) : path.join(root, 'dist');
  if (!fs.existsSync(dist)) throw new Error(`artifact directory not found: ${dist}`);
  const names = fs.readdirSync(dist).filter((name) => !name.endsWith('.blockmap'));
  const files = [];

  for (const pattern of artifactPatterns(platform, version)) {
    const matches = names.filter((name) => pattern.test(name));
    if (matches.length !== 1) throw new Error(`${platform} ${pattern}: expected one artifact, found ${matches.length}`);
    const file = path.join(dist, matches[0]);
    files.push({ file, size: validateFile(file) });
  }

  if (platform === 'mac') {
    const updateMetadata = path.join(dist, 'latest-mac.yml');
    if (!fs.existsSync(updateMetadata)) throw new Error('latest-mac.yml is missing');
    const text = fs.readFileSync(updateMetadata, 'utf8');
    if (!new RegExp(`^version:\\s*${escapeRegExp(version)}\\s*$`, 'm').test(text)) {
      throw new Error(`latest-mac.yml does not declare version ${version}`);
    }
  }

  return { version, platform, files };
}

function parseArgs(argv) {
  const platformIndex = argv.indexOf('--platform');
  const distIndex = argv.indexOf('--dist');
  return {
    platform: platformIndex >= 0 ? argv[platformIndex + 1] : 'mac',
    dist: distIndex >= 0 ? argv[distIndex + 1] : undefined,
  };
}

if (require.main === module) {
  try {
    const root = path.resolve(__dirname, '..');
    const args = parseArgs(process.argv.slice(2));
    const platforms = args.platform === 'all' ? ['mac', 'win', 'linux'] : [args.platform];
    for (const platform of platforms) {
      const result = inspectArtifacts(root, platform, args.dist);
      for (const artifact of result.files) {
        console.log(`[artifact] ${path.basename(artifact.file)} (${(artifact.size / 1024 / 1024).toFixed(1)} MiB)`);
      }
      console.log(`[artifact] ${platform} v${result.version} passed`);
    }
  } catch (error) {
    console.error(`[artifact] failed\n${error.message}`);
    process.exit(1);
  }
}

module.exports = { artifactPatterns, inspectArtifacts, validateFile };
