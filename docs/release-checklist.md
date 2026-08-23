# 发布检查清单

以下脚本只检查或准备本地内容，不会创建标签、上传 Release、签名、公证或发布。

## 1. 准备版本

- [ ] 从干净工作树开始。
- [ ] 如需升版，运行 `npm run release:sync -- 1.2.3`（将示例版本替换为目标版本），同步 `package.json`、README、HANDOFF、`site/` 与 `docs/` 的公开版本。
- [ ] 若 `package.json` 版本变化，运行 `npm install --package-lock-only --ignore-scripts`，审查并提交锁文件变化。
- [ ] 更新发布说明，确认没有把“CI 构建”写成“实体机器验收”。
- [ ] 运行 `npm run version:check`。

## 2. 工程验证

- [ ] `npm ci`
- [ ] `npm test`
- [ ] `npm run test:smoke`，结果必须为 `44/44 passed`。
- [ ] `npm run pack:mac` 后运行 `npm run test:packaged`。
- [ ] 在 CI 中确认 macOS、Windows、Linux 的 unit、syntax 和本平台 pack 全绿。
- [ ] 复核四种导出中的图片、表格、Mermaid、ECharts、Markmap 与 KaTeX。

## 3. 产物与元数据

- [ ] 运行 `npm run dist` 生成 DMG + ZIP。
- [ ] 创建与版本一致的本地 `vX.Y.Z` 标签后，保持工作树干净。
- [ ] 运行 `npm run artifacts:check` 检查文件版本、大小、ZIP 尾记录、DMG 尾记录与 `latest-mac.yml`。
- [ ] 检查打包应用与 DMG 根目录均包含项目 `LICENSE` 与 `THIRD-PARTY-LICENSES.md`。
- [ ] 运行 `npm run release:check`，统一检查版本面、Git 状态、标签与 macOS 产物。
- [ ] 在 DMG 中确认应用、安装说明和解除限制脚本齐全。

## 4. 人工发布门

- [ ] Apple 签名与公证；未完成时必须保留“未公证”提示和解除限制说明。
- [ ] macOS Apple Silicon 实机安装、首次启动、打开/保存、拖放和导出验收。
- [ ] 若发布 Windows / Linux，必须在对应实体机器完成安装、文件关联、快捷键、路径和卸载验收。
- [ ] 上传后从 Release 页面重新下载，复核文件大小与基础结构。
