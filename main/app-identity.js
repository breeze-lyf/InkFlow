'use strict';

const path = require('path');

const DISPLAY_NAME = 'InkFlow 墨流';
// Keep the existing profile location stable across the visible product rename.
const LEGACY_USER_DATA_DIR = '墨流 InkFlow';

function preserveUserDataLocation(app, { isSmoke = false, pathImpl = path } = {}) {
  // Smoke runs pass an isolated --user-data-dir; never redirect them to real data.
  if (isSmoke) return null;
  const stablePath = pathImpl.join(app.getPath('appData'), LEGACY_USER_DATA_DIR);
  app.setPath('userData', stablePath);
  app.setPath('sessionData', stablePath);
  return stablePath;
}

module.exports = {
  DISPLAY_NAME,
  LEGACY_USER_DATA_DIR,
  preserveUserDataLocation,
};
