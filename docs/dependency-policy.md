# 依赖升级政策

墨流依赖少，但 Electron、Vditor 和导出库都处在高影响路径。升级按“小步、可回退、证据完整”执行。

## 节奏

- 安全修复：确认影响后优先升级，单独提交，不与产品功能混改。
- Electron / Vditor 大版本：一次只升一个核心依赖，先读官方迁移说明，再完成全量回归。
- 普通小版本：按月集中检查；没有明确收益时不为“版本新”而升级。
- 锁文件必须随依赖变更提交，CI 一律使用 `npm ci` 验证可重复安装。

## 升级门禁

1. 记录升级前后版本、动机、官方变更和已知破坏项。
2. 运行 `npm test`、`npm run version:check`、`npm run test:smoke`。
3. 生成当前平台 unpacked 应用并运行 `npm run test:packaged`。
4. 重点复核拖放路径、文件选择、自动保存/恢复、四种导出、离线图表和主题样式。
5. Windows / Linux 在各自 CI runner 完成本平台构建；发布前仍需实体机器验收。
6. 依赖审计结果按“可利用路径 + 运行时是否打包”判断，不因数量直接做高风险大升级。

## 当前锁定基线

- Electron `43.4.1`、electron-builder `26.15.3`、Vditor `3.11.3`、html-to-docx `1.8.0`、htmlparser2 `12.0.0` 均使用精确版本；Node.js 最低版本为 `22.12.0`。
- `postinstall` 会对 Vditor 的 Mermaid 与 ECharts 初始化做确定性安全补丁并校验签名：Mermaid 保持 `securityLevel: strict`，ECharts 配置只能来自 JSON；补丁签名不匹配时安装直接失败，不能静默跳过。
- `npm audit --omit=dev` 当前仍会报告 html-to-docx 传递依赖 image-size 的 ICNS、JXL、HEIF 无限循环公告；上游尚无安全升级版本。墨流在进入 Word 转换器前只接受经过结构、尺寸和总量预算验证的 PNG/JPEG/GIF/WebP/BMP，明确拒绝这三类格式，因此公告中的解析器不可从应用导出入口到达。该项是有边界的残余风险，不允许用降级 html-to-docx 的 `npm audit fix --force` 假装修复。

## 明确禁止

- 不使用宽泛版本范围或忽略锁文件来“修 CI”。
- 不把 Electron、Vditor、构建器和产品功能塞进同一个不可审查提交。
- 不通过关闭安全检查、sandbox 或证书校验来绕过升级问题。
- 不把 `npm audit fix --force` 当成无人复核的自动修复方案。
