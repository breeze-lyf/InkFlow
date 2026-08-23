function assertTrustedIpcSender(event, mainWindow) {
  const trusted = mainWindow
    && typeof mainWindow.isDestroyed === 'function'
    && !mainWindow.isDestroyed()
    && mainWindow.webContents
    && event
    && event.sender === mainWindow.webContents;
  if (!trusted) throw new Error('不受信任的 IPC 来源');
}

module.exports = { assertTrustedIpcSender };
