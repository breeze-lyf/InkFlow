#!/usr/bin/env node
'use strict';

const path = require('path');
const { checkVersions } = require('./lib/version-tools');

try {
  const result = checkVersions(path.resolve(__dirname, '..'));
  console.log(`[version] v${result.version}; ${result.surfaces} version marker(s) consistent`);
} catch (error) {
  console.error(`[version] failed\n${error.message}`);
  process.exit(1);
}
