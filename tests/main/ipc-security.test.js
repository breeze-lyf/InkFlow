const assert = require('node:assert/strict');
const test = require('node:test');

const { assertTrustedIpcSender } = require('../../main/ipc-security');

test('IPC calls are accepted only from the current main window webContents', () => {
  const trustedContents = { id: 7 };
  const mainWindow = { isDestroyed: () => false, webContents: trustedContents };

  assert.doesNotThrow(() => assertTrustedIpcSender({ sender: trustedContents }, mainWindow));
  assert.throws(
    () => assertTrustedIpcSender({ sender: { id: 7 } }, mainWindow),
    /不受信任的 IPC 来源/
  );
  assert.throws(
    () => assertTrustedIpcSender({ sender: trustedContents }, { ...mainWindow, isDestroyed: () => true }),
    /不受信任的 IPC 来源/
  );
});
