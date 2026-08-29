# InkFlow 墨流 · 维护交接

> 面向下一位维护者。最后更新：2026-08-29（v1.0.6）

## 1. 当前基线

墨流是本地优先的桌面 Markdown 编辑器：Electron 43、Vditor 3.11.3 IR、Vanilla JavaScript。产品定位是 **Typora 的即时写感 + VSCode 式文档库工作流**。

- 仓库：<https://github.com/breeze-lyf/InkFlow>
- 最新发布：v1.0.6（macOS Apple Silicon，DMG / ZIP，未签名公证）
- 功能冒烟基线：**44/44**
- 正式导出：PDF、Word、PNG 长图、自包含 HTML
- Windows / Linux：有构建配置与 CI，不代表实体机器发布验收已经完成

术语先读 [CONTEXT.md](CONTEXT.md)，完整边界见 [架构概览](docs/architecture/overview.md) 和 [数据安全](docs/data-safety.md)。

## 2. 三分钟上手

```bash
npm ci
npm start

npm test                 # 单元测试 + JavaScript 语法扫描
npm run test:smoke       # 源码 Electron 功能冒烟，严格核对 44/44
npm run verify           # test + 版本一致性 + 源码功能冒烟

npm run pack:mac         # 当前平台 unpacked 应用
npm run test:packaged    # 自动定位 dist/ 当前平台应用，严格核对 44/44
npm run dist             # macOS DMG + ZIP
```

不要手写 `SMOKE=1 electron ...` 作为发布证据。`scripts/run-smoke.js` 会：

- 为每次运行建立独立临时 user-data；
- 清除 `NODE_OPTIONS`、`ELECTRON_RUN_AS_NODE` 和残留测试变量；
- 同时检查进程退出码与 `44/44 passed`；
- 超时终止并删除临时目录；
- 对打包测试支持 `INKFLOW_PACKAGED_EXECUTABLE=/绝对路径` 显式指定程序。

## 3. 架构地图

```text
renderer/                     界面与编辑状态
├── index.html                应用壳、设置与确认弹窗
├── css/                      纸/墨主题、布局、Vditor 内容主题
└── js/
    ├── app.js                页签、会话、CAS 保存、恢复与菜单编排
    ├── document-safety.js    外部修改三方决策规则
    ├── editor.js             每页签一个 Vditor 实例
    ├── find-replace.js       当前文稿查找、替换与浏览器原生高亮
    ├── panels.js             文件树、大纲、右键菜单
    ├── overlay.js            快速打开与命令面板
    ├── exporter.js           导出内容准备
    └── utils.js              路径、DOM 与通用工具

main/                         系统能力与信任边界
├── main.js                   应用生命周期与模块编排
├── preload.js                window.ink 白名单桥
├── menu.js                   原生菜单
├── store.js                  原子 JSON 持久化
├── recovery-store.js         userData/recovery.json 草稿存储
├── document-files.js         文稿 CAS 与原子替换
├── directory-files.js        大目录异步读取与遍历
├── file-watch.js             打开文稿的单文件监听注册表
├── path-grants.js            文件/目录授权边界
├── ipc-security.js           IPC 来源校验
├── network-policy.js         阻断渲染进程任意网络与本地文件请求
├── html-sanitizer.js         基于真实 HTML 解析器的导出净化
├── export-security.js        导出图片验证、预算与 data URL 内联
├── svg-assets.js             授权 SVG 读取与严格净化
├── open-requests.js          Finder/命令行/二次启动打开请求归一化
├── css-assets.js             导出 CSS 白名单
├── server.js                 带启动令牌的本地资源服务
└── menu.js                   原生菜单

scripts/                      单元、语法、冒烟、版本与发布检查
tests/                        独立规则测试
.github/workflows/ci.yml      三平台持续集成
```

核心数据流：`renderer → window.ink → preload 白名单 → IPC → main → 文件系统/导出/资源服务`。渲染进程不得绕过该链路访问 Node 能力。

## 4. 不可破坏的设计约束

### 4.1 编辑器实例池

每个可编辑页签持有一个独立 Vditor 实例，切换页签只切宿主显隐，保留光标、滚动与撤销历史。

- 当前实例选择器必须限定 `.editor-host:not(.hidden)`。
- 关页签调用 `Editor.destroy(key)`。
- 重命名或另存后调用 `Editor.rekey(from, to)`。
- 定时器与恢复记录必须按页签键隔离，不能用一个全局计时器管理所有文稿。

### 4.2 文件与恢复

- `savedValue` 是编辑器规范化基线；`diskValue` 是精确磁盘原文和 CAS 基线。不能用前者代替后者做覆盖检查。
- 恢复草稿按页签以 600ms leading + trailing 节流写入 `userData/recovery.json`，字段为 `key/path/name/content/savedValue/diskValue/updatedAt`。
- 保存失败必须保持脏状态并给出用户可见提示。
- 恢复草稿只用于异常退出保护；成功保存或明确放弃后清理。
- 外部修改采用磁盘、当前内容、保存基线三方比较；双方都变化或磁盘删除时暂停自动保存，并提供载入磁盘版、当前内容另存为、明确覆盖三种动作。
- 设置、最近项目与恢复数据位于 Electron `userData`，不写进文档库。

### 4.3 路径授权与资源服务

- preload 只暴露业务化窄接口，不暴露 `ipcRenderer` 或通用文件 API。
- 主窗口与导出窗口保持 `sandbox: true`、`contextIsolation: true`、`nodeIntegration: false`。
- 主进程对每个文件动作重新验证类型、路径和授权范围，不能信任 renderer 参数。
- 路径能力默认拒绝；系统对话框、Finder `open-file`、有效 session/recent/recovery、真实 `File` 拖放和内置 samples 是授权来源。
- 路径规范化必须保留 realpath / 最近存在祖先逻辑，阻断 `..` 与符号链接逃逸；文件动作继续区分 `read/write/asset`。
- 文档库 watcher 负责树刷新；单文件 watcher 覆盖所有可编辑页签（包括文档库外文件）并在原子替换后重挂，预览页签不注册。
- 资源服务只监听回环地址，URL 带每次启动随机 256-bit 令牌，只允许 `GET` / `HEAD` 和白名单媒体类型，不开放 `CORS *`，保留 `nosniff` / `no-referrer`。
- CSS 读取只能命中应用内允许的内容主题，不能成为任意路径读取入口。

### 4.4 文件树与大目录

- 文件写操作后使父目录缓存失效，否则会出现“创建成功但树上看不到”。
- `fs.watch` 事件需要防抖并让路于行内重命名。
- 大目录遍历不得在主进程使用无上限同步深搜；保留异步、可让出事件循环的路径。
- 双击会派生两次 click，文件夹展开与图片插入都要保留重复事件守卫。

### 4.5 导出

- 导出样式来自产品内容主题，不能复制出另一套长期漂移的主题。
- 相对图片先解析为授权本地资源，再按目标格式内联或加载。
- 导出 HTML 在进入主进程前移除脚本、主动嵌入、内联事件与危险 URL，并转义文稿元数据。
- 修改复杂渲染时至少覆盖 Mermaid、ECharts、Markmap、KaTeX、表格和长文分页/长图高度。
- 开发环境通过不等于 asar 通过；核心导出变化必须复跑打包应用冒烟。

## 5. 工程门禁

| 命令 | 作用 |
| --- | --- |
| `npm test` | 单元测试与全部项目 JavaScript 语法扫描 |
| `npm run test:unit` | Node 内置 test runner；自动发现 `tests/` 与 `scripts/tests/` |
| `npm run test:syntax` | 用当前 Node 对 main、renderer、scripts、tests 执行 `--check` |
| `npm run test:smoke` | 源码功能冒烟，必须恰好 `44/44` |
| `npm run test:packaged` | 当前平台 unpacked 应用功能冒烟 |
| `npm run version:check` | package、README、HANDOFF、site、docs 公开版本一致性 |
| `npm run artifacts:check` | macOS DMG / ZIP 包络、大小、版本和更新元数据 |
| `npm run verify` | `test` + `version:check` + `test:smoke` |
| `npm run release:check` | 干净工作树、版本、标签与产物的发布前总检 |

CI 使用 Node 22 与 `npm ci`：

- macOS：unit、syntax、version、源码 44 项 smoke、mac unpacked build；
- Windows：unit、syntax、version、Windows unpacked build；
- Linux：unit、syntax、version、Linux unpacked build。

CI 构建结果只证明依赖可安装、测试可运行、目标包可生成，不得写成 Windows / Linux 实体机器验收。

## 6. 发布流程

完整逐项清单见 [docs/release-checklist.md](docs/release-checklist.md)。最短路径：

```bash
# 如需升版；只同步本地文件，不打标签、不上传
npm run release:sync -- 1.2.3  # 将示例版本替换为目标版本
npm install --package-lock-only --ignore-scripts

npm ci
npm run verify
npm run dist

# 标签创建并提交后，在干净工作树执行
npm run release:check
```

`release:sync` 的 `package.json` 是版本源，会同步 README、HANDOFF、`site/index.html` 与 `docs/index.html`。它故意不发布，也不代替锁文件审查。

## 7. 已知坑

1. Electron 32+ 移除了 `File.path`；拖放路径必须经 preload 中的 `webUtils.getPathForFile`。
2. `showSaveDialog` 返回 `{ canceled, filePath }`，不是字符串。
3. asar 内复制不要依赖未经验证的 `fs.cpSync` 行为；示例复制需要打包后回归。
4. Vditor 空文稿可能返回换行符；脏判断要使用统一内容比较规则。
5. 查找当前编辑器时，全局 `.vditor-ir` 会命中隐藏实例。
6. `executeJavaScript` 中的异常会让冒烟流程挂起；测试运行器有超时，但根因仍需修复。
7. iCloud 可能驱逐 Documents 内的媒体；“图片消失”先确认文件是否仍在本地。
8. `package-lock.json` 的依赖树是 CI 安装依据；升级依赖必须同步并审查锁文件。

## 8. 仍需外部条件的发布门

- [ ] Apple 开发者账号、证书与公证服务：完成签名、公证后才能移除 `xattr` 指引。
- [ ] Windows / Linux 实体机器：完成安装、文件关联、快捷键、路径、导出和卸载验收后，才能标记对应平台正式发布。

除此之外，发现产品或工程缺口应作为正常缺陷进入测试与修复，不在此长期堆“也许以后做”的愿望清单。

## 9. 本地数据位置

- 首启示例：系统“文档”目录下的 `墨流示例`
- 设置与最近项目：Electron `userData`
- 恢复草稿：Electron `userData/recovery.json`
- 功能冒烟：系统临时目录；运行结束自动清理

改了架构、数据安全、测试数量、发布命令或公开版本时，必须在同一变更中同步本文件。
