// 宣传物料出图：单窗口复用，按平台尺寸截 HTML 模板
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'promo');
const JOBS = [
  { file: 'twitter-card.html', out: 'twitter-card-1600x900.png', w: 1600, h: 900 },
  { file: 'xhs-cover.html', out: 'xhs-cover-1080x1440.png', w: 1080, h: 1440 },
  { file: 'xhs-points.html', out: 'xhs-points-1080x1440.png', w: 1080, h: 1440 },
  { file: 'xhs-compare.html', out: 'xhs-compare-1080x1440.png', w: 1080, h: 1440 },
  { file: 'douyin-cover.html', out: 'douyin-cover-1080x1920.png', w: 1080, h: 1920 },
  { file: 'tiktok-cover.html', out: 'tiktok-cover-1080x1920.png', w: 1080, h: 1920 },
];

app.on('window-all-closed', (e) => e && e.preventDefault && e.preventDefault());

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false, width: 1600, height: 900,
    webPreferences: { sandbox: true, contextIsolation: true },
  });
  for (const j of JOBS) {
    win.setContentSize(j.w, j.h);
    try {
      await win.loadFile(path.join(DIR, j.file));
      await new Promise((r) => setTimeout(r, 1400));
      let img = await win.webContents.capturePage();
      const sz = img.getSize();
      if (sz.width !== j.w || sz.height !== j.h) {
        img = img.resize({ width: j.w, height: j.h, quality: 'best' });
      }
      fs.writeFileSync(path.join(DIR, j.out), img.toPNG());
      console.log('[promo]', j.out, img.getSize().width + 'x' + img.getSize().height);
    } catch (e) {
      console.log('[promo-fail]', j.file, e.message);
    }
  }
  win.destroy();
  app.exit(0);
});
