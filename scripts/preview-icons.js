// 渲染 Logo 候选对比图：大图 + Dock 小图模拟（扁平系列 5 款）
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1560,
    height: 560,
    show: false,
    backgroundColor: '#eceef2',
    webPreferences: { sandbox: true },
  });
  const dir = path.join(__dirname, '..', 'assets', 'candidates');
  const cell = (id, label, sub) => `
    <div class="cell">
      <img class="big" src="${dir}/icon-${id}.svg">
      <div class="label">${label}</div>
      <div class="sub">${sub}</div>
    </div>`;
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    body { margin: 0; background: #eceef2; font-family: -apple-system, "PingFang SC", sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; }
    .row { display: flex; gap: 34px; align-items: center; }
    .cell { display: flex; flex-direction: column; align-items: center; gap: 10px; }
    .cell img.big { width: 250px; height: 250px; border-radius: 56px; box-shadow: 0 14px 36px rgba(20,20,40,.14); }
    .label { font-size: 19px; font-weight: 700; color: #2b2b2e; }
    .sub { font-size: 13px; color: #8a8a8e; margin-top: -6px; }
  </style></head><body>
    <div class="row">
      ${cell('a', 'A · 叠影双滴', '半透明交叠层次')}
      ${cell('b', 'B · 色阶墨滴', '三段色带切分')}
      ${cell('c', 'C · 层浪剪纸', '三层浪 + 白滴')}
      ${cell('d', 'D · 错位描边', '贴纸式错位环')}
      ${cell('e', 'E · 同心色层', '紫调三段同心')}
    </div>
  </body></html>`;
  const tmp = path.join(require('os').tmpdir(), 'inkflow-icon-preview.html');
  fs.writeFileSync(tmp, html);
  await win.loadFile(tmp);
  await new Promise((r) => setTimeout(r, 700));
  const img = await win.webContents.capturePage();
  const out = path.join(__dirname, '..', 'assets', 'logo-candidates.png');
  fs.writeFileSync(out, img.toPNG());
  console.log('candidates written:', out);
  app.exit(0);
});
