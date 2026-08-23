'use strict';

const path = require('path');
const { fileURLToPath } = require('url');

function isAllowedRendererNetworkUrl(rawUrl, assetUrl) {
  let candidate;
  let asset;
  try {
    candidate = new URL(rawUrl);
    asset = new URL(assetUrl);
  } catch {
    return false;
  }
  if (candidate.protocol !== 'http:' || candidate.origin !== asset.origin) return false;
  const base = asset.pathname.replace(/\/$/, '');
  return candidate.pathname === `${base}/img`;
}

function isAllowedRendererFileUrl(rawUrl, { appRoot, ephemeralFiles = [] } = {}) {
  let file;
  try { file = path.resolve(fileURLToPath(rawUrl)); } catch { return false; }
  const root = appRoot ? path.resolve(appRoot) : '';
  if (root && (file === root || file.startsWith(`${root}${path.sep}`))) return true;
  return [...ephemeralFiles].some((allowed) => path.resolve(allowed) === file);
}

function installRendererNetworkGuard(session, options = {}) {
  if (!session || !session.webRequest || typeof session.webRequest.onBeforeRequest !== 'function') {
    throw new Error('Electron session webRequest is unavailable');
  }
  session.webRequest.onBeforeRequest(
    { urls: ['http://*/*', 'https://*/*', 'file://*/*'] },
    (details, callback) => {
      if (/^file:/i.test(details.url)) {
        const appRoot = typeof options.getAppRoot === 'function' ? options.getAppRoot() : '';
        const ephemeralFiles = typeof options.getEphemeralFiles === 'function' ? options.getEphemeralFiles() : [];
        callback({ cancel: !isAllowedRendererFileUrl(details.url, { appRoot, ephemeralFiles }) });
        return;
      }
      const currentAssetUrl = typeof options.getAssetUrl === 'function' ? options.getAssetUrl() : '';
      callback({ cancel: !isAllowedRendererNetworkUrl(details.url, currentAssetUrl) });
    },
  );
}

module.exports = { installRendererNetworkGuard, isAllowedRendererFileUrl, isAllowedRendererNetworkUrl };
