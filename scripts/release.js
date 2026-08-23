#!/usr/bin/env node
'use strict';

const path = require('path');
const { spawnSync } = require('child_process');
const { checkVersions, syncVersions } = require('./lib/version-tools');
const { inspectArtifacts } = require('./check-artifacts');

const root = path.resolve(__dirname, '..');
const [command, maybeVersion, ...rest] = process.argv.slice(2);
const allowDirty = process.argv.includes('--allow-dirty');

function assertCleanWorktree() {
  if (allowDirty) return;
  const result = spawnSync('git', ['status', '--porcelain=v1', '--untracked-files=all'], {
    cwd: root,
    encoding: 'utf8',
  });
  if (result.status !== 0) throw new Error((result.stderr || 'unable to inspect Git worktree').trim());
  if (result.stdout.trim()) {
    throw new Error('Git worktree is not clean. Commit or stash changes before a release check.');
  }
}

function assertTag(version) {
  const result = spawnSync('git', ['rev-parse', '--verify', '--quiet', `refs/tags/v${version}`], {
    cwd: root,
    stdio: 'ignore',
  });
  if (result.status !== 0) throw new Error(`release tag v${version} is missing`);
}

try {
  if (command === 'sync') {
    assertCleanWorktree();
    const requested = maybeVersion && !maybeVersion.startsWith('--') ? maybeVersion : undefined;
    const version = syncVersions(root, requested);
    console.log(`[release] synchronized package/site/docs surfaces to v${version}`);
    console.log('[release] no tag, upload, signing, notarization, or publishing action was performed');
  } else if (command === 'check') {
    assertCleanWorktree();
    const { version } = checkVersions(root);
    assertTag(version);
    const platformArg = process.argv.indexOf('--platform');
    const platform = platformArg >= 0 ? process.argv[platformArg + 1] : 'mac';
    const distArg = process.argv.indexOf('--dist');
    const dist = distArg >= 0 ? process.argv[distArg + 1] : undefined;
    inspectArtifacts(root, platform, dist);
    console.log(`[release] v${version} metadata, Git state, tag, and ${platform} artifacts passed`);
    console.log('[release] signing/notarization and physical-machine acceptance remain separate human gates');
  } else {
    console.error('Usage: node scripts/release.js sync [version] [--allow-dirty] | check [--platform mac] [--dist path] [--allow-dirty]');
    process.exit(2);
  }
} catch (error) {
  console.error(`[release] failed\n${error.message}`);
  process.exit(1);
}
