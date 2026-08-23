'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { artifactPatterns } = require('../check-artifacts');

test('artifact matching is platform-specific and excludes stale versions', () => {
  const [dmg, macZip] = artifactPatterns('mac', '1.0.3');
  assert.match('墨流-1.0.3-arm64.dmg', dmg);
  assert.match('墨流-1.0.3-arm64-mac.zip', macZip);
  assert.doesNotMatch('墨流-1.0.2-arm64.dmg', dmg);

  const [setup, winZip] = artifactPatterns('win', '1.0.3');
  assert.match('墨流-Setup-1.0.3-x64.exe', setup);
  assert.match('墨流-1.0.3-x64-win.zip', winZip);
  assert.doesNotMatch('墨流-1.0.3-arm64-mac.zip', winZip);

  const [appImage, linuxZip] = artifactPatterns('linux', '1.0.3');
  assert.match('墨流-1.0.3-x86_64.AppImage', appImage);
  assert.match('墨流-1.0.3-x64-linux.zip', linuxZip);
});
