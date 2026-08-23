'use strict';

function startupFailure(error, { app, dialog, logger = console } = {}) {
  const message = error && error.message ? error.message : String(error || '未知错误');
  if (logger && typeof logger.error === 'function') logger.error('[startup] failed:', error);
  if (dialog && typeof dialog.showErrorBox === 'function') {
    try { dialog.showErrorBox('墨流启动失败', `本地资源服务无法启动：${message}`); } catch { /* 正在退出 */ }
  }
  if (app && typeof app.exit === 'function') app.exit(1);
}

module.exports = { startupFailure };
