// 用 Electron 离屏窗口把 SVG 渲染成 1024x1024 PNG
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1024,
    height: 1024,
    show: false,
    backgroundColor: '#00000000',
    transparent: true,
    webPreferences: { sandbox: true },
  });
  const svg = path.join(__dirname, '..', 'assets', 'icon.svg');
  await win.loadFile(svg);
  await new Promise((r) => setTimeout(r, 500));
  const img = await win.webContents.capturePage();
  const out = path.join(__dirname, '..', 'assets', 'icon.png');
  fs.writeFileSync(out, img.toPNG());
  console.log('icon.png written:', out);
  app.exit(0);
});
