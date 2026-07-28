# 墨流 InkFlow · 交接文档（HANDOFF）

> 写给下一位开发者（或三个月后失忆的自己）。
> 读完这份文档 + 跑一遍测试，你就拥有了维护本项目的全部上下文。
> 最后更新：2026-07-28（v1.0.0 发布后）

---

## 1. 这是什么

macOS 桌面 Markdown 编辑器。Electron 33 + Vditor 3.10（IR 即时渲染）+ Vanilla JS。
定位：**Typora 的写感 + VSCode 的工作流**（文档库/多标签/命令面板）。

- 仓库：<https://github.com/breeze-lyf/InkFlow>（Public）
- 最新发布：v1.0.0（DMG/ZIP，Apple Silicon，未公证）
- 测试基线：**功能回归 27/27**（每次改动后必须保持全绿）

## 2. 三分钟上手

```bash
npm install                 # 只装 vditor + html-to-docx + electron-builder
npm start                   # 开发启动（需本地 Electron，见下）
npm run dist                # 打包 DMG + ZIP → dist/

# 测试（核心工作流，每次改完必跑）
SMOKE=1 SMOKE_FUNC=1 ./node_modules/.bin/electron --no-sandbox --disable-gpu \
  --user-data-dir=/tmp/inkflow-dev-data .          # 功能回归 27 项
SMOKE=1 SMOKE_SHOTS=light,dark ./node_modules/.bin/electron --no-sandbox \
  --disable-gpu --user-data-dir=/tmp/inkflow-dev-data .   # 视觉冒烟截图

# 打包产物也要验（asar 环境与开发环境行为不同！）
SMOKE=1 SMOKE_FUNC=1 env -u NODE_OPTIONS -u ELECTRON_RUN_AS_NODE \
  "dist/mac-arm64/墨流.app/Contents/MacOS/墨流" --no-sandbox --disable-gpu \
  --user-data-dir=/tmp/inkflow-pack-data
```

**环境注意**：本机 shell 的 cwd 会漂移，所有命令前加 `cd /Users/breeze/Dev/markdown/inkflow`；
`env -u NODE_OPTIONS` 必须带上，否则 Electron 会以 Node 模式静默退出。

## 3. 架构地图

```
main/                  Electron 主进程
├── main.js            窗口/IPC/冒烟测试编排/runFuncSmoke(27 断言)/fs 监听
├── preload.js         contextBridge 桥（ink.* API）
├── menu.js            原生中文菜单（视图菜单 radio 读 settings）
├── store.js           JSON 持久化（settings/recent，原子写）
└── server.js          本地资源服务（/img?path= 喂图片，仅媒体扩展名）

renderer/
├── index.html         全部 DOM（侧栏/页栏/编辑区/欢迎页/弹窗）
├── css/themes.css     纸/墨设计令牌（全部视觉从这里派生）
├── css/app.css        应用壳样式
├── css/vditor-custom.css  编辑器深度定制（前缀 .ink-editor）
└── js/
   ├── app.js          编排中心：标签/设置/命令/快捷键/菜单分发/会话
   ├── editor.js       编辑器实例池（核心！见 §4.1）
   ├── panels.js       文件树（选中态/缓存/无感刷新）+ 大纲 + 右键菜单
   ├── overlay.js      快速打开/命令面板
   ├── exporter.js     PDF/Word/PNG/HTML 导出（渲染端部分）
   └── utils.js        el/$/$$/toast/防抖节流/P(路径)/countWords
```

**数据流**：渲染进程不碰 fs —— 一切经 `ink.*`（preload 白名单 API）→ IPC → 主进程。

## 4. 核心设计决策（改之前先理解为什么）

### 4.1 编辑器实例池（editor.js）
每个标签页持有独立 Vditor 实例，懒创建；切换 = 显隐宿主 div，**零重渲染**（光标/滚动/撤销历史全保留）。
- 宿主结构：`#editor-hosts > .editor-host.ink-editor[data-key]`；活跃宿主 = 无 `.hidden`
- 选择器规则：查当前编辑器一律 `.editor-host:not(.hidden) ...`，全局 `.vditor-ir` 会命中隐藏实例
- 每实例独立绑定：图片观察器 / 链接拦截 / 大纲滚动 / input 回调（携带实例 key）
- 关标签必须 `Editor.destroy(key)`；重命名/另存必须 `Editor.rekey()`

### 4.2 滚动容器与页面宽度（vditor-custom.css）
滚动容器 `.vditor-ir > .vditor-reset`（vditor 内部 PRE）保持**全宽**（滚动条贴窗口右缘），
文本列用 `padding: max(28px, calc((100% - var(--page-width))/2))` 居中。
`--page-width` 正常 780 / 超宽 1120，切宽度只改 CSS 变量。
**禁区**：`.vditor-ir` 底部不加 padding（会挤掉 PRE 滚动容器高度，血泪教训）。

### 4.3 主题系统
CSS 变量令牌（themes.css）：`body[data-theme]` 切换 → 应用壳 + vditor `setTheme` + 内容主题
（inkflow-light/dark.css，导出也复用）。全部 UI 只引用变量，不写死颜色。

### 4.4 文件树（panels.js）
- `FileTree.cache`（目录缓存）：**任何写操作后必须 `cache.delete(父目录)`**，否则"创建了却看不到"
- `FileTree.selected`：新建文件落在选中目录（文件则取父目录）
- 双击守卫：双击派生两次 click，`e.detail > 1` 分支忽略（文件夹防"展开又收起"，图片防"插两份"）
- `softRefresh()`：fs.watch 触发；`_editing`（行内命名中）时让路

### 4.5 设置与菜单
所有设置持久化到 `settings.json`（主进程 Store，原子写）。菜单 radio/checkbox 的勾选态在
`buildMenu` 时从 settings 读 —— `settings:set` IPC 会 `refreshMenu()` 自动同步。

### 4.6 快捷键分配原则
`⌘1..6` 标题 / `⌘0` 正文（Typora 肌肉记忆）；标签切换用 `⌥1..9`（用 `e.code` 判断，
`⌥` 会产生特殊字符导致 `e.key` 不可靠）；格式类快捷键注册在原生菜单（⌘ 组合由菜单捕获）。

## 5. 测试体系（本项目的护城河）

| 模式 | 用途 |
|---|---|
| `SMOKE=1` | 启动演示文档 + 截图（`SMOKE_SHOTS=light,dark,welcome,wide,sidebar-off,outline,scroll-N`） |
| `SMOKE_FUNC=1` | runFuncSmoke：27 项断言（编辑/自动保存/导出/树/快捷键/实例池…） |
| `SMOKE_PROBE=1` | 布局探针：打印关键元素 getBoundingClientRect（视觉验证用） |

**测试钩子**：`INKFLOW_TEST_SAVEPATH=/tmp/x.pdf` 跳过保存对话框（导出管线可无头端到端验证）。
**写文件的树测试在 samples 临时副本上跑**（`tmpDir/samples`），防仓库污染 + asar 只读。

## 6. 发布流程（已踩平的坑都标了）

```bash
npm run dist                                  # 1. 打包
git tag -a v1.x.x -m "说明" && git push origin v1.x.x   # 2. 标签
gh release create v1.x.x dist/InkFlow-*.dmg dist/InkFlow-*-mac.zip --notes-file notes.md
```

- **资产文件名必须 ASCII**（中文名经 GitHub 上传会被剥成乱码，教训 v1.0.0）
- gh 的 GraphQL 端点在本网络常 TLS 超时 → 用 `gh api`（REST）+ 重试循环；系统代理 `127.0.0.1:7897`
- 未公证提示已写进 README 与 Release notes（`xattr -dr com.apple.quarantine`）

## 7. 血泪坑清单（别再踩）

1. **Electron ≥32 移除了 `File.path`** → 拖放必须 `webUtils.getPathForFile`（preload 桥接）
2. **`showSaveDialog` 返回 `{canceled, filePath}`**，不是字符串（旧教程是字符串，全踩过）
3. **`fs.cpSync` 不被 asar 补丁覆盖** → asar 内复制用手工递归 `readdirSync + copyFileSync`
4. **electron-builder 自动收集全部 dependencies** → `files` 白名单失效，要 `!排除`（vditor 引擎裁剪靠这个）
5. **vditor 空文档 `getValue()` 返回 `'\n'`** → 脏判断用 `_contentDirty`（全空白≡空串）
6. **vditor 标题热键是"设置"不是"切换"**；工具栏按钮连续点会因内部 range 书签失效而无效 →
   ⌘0 切正文：先 range 重置到块首再点按钮（editor.js `heading()`）
7. **`executeJavaScript` 里重复 `const` 声明 = SyntaxError** → UnhandledPromiseRejection → 进程挂起不退
8. **render() 重建 DOM 后旧引用全部失效**（测试断言要重新 query）
9. **`img.onerror` 一次定死 = "图片突然不显示"** → 现在 1.2s 重试 + 激活时 `_rescanImages` 自愈
10. **iCloud 会驱逐 `~/Documents` 里的图片文件** → 用户报"图片消失"先查云朵图标

## 8. 已知待办 / 可以做

- [ ] 页签拖拽排序（`#tabs` 加 HTML5 DnD）
- [ ] 环境控制条主题按钮与系统外观实时联动（边缘场景：设置面板改主题后 seg 高亮不刷新）
- [ ] markmap（思维导图）按需恢复（从打包排除清单去掉即可，0.8MB）
- [ ] 用户真实 Mac 实机验证（本机全部测试通过，但无人点过真按钮）
- [ ] v2.0 远期：Tauri 评估（10-20MB 体积诱惑 vs 主进程重写成本）
- [ ] Apple 开发者账号后：签名 + 公证（`notarytool`），去掉 xattr 指引

## 9. 用户环境速记

- 用户文档库：`~/Documents/墨流示例`（首启从 `samples/` 复制）
- 设置：`~/Library/Application Support/墨流/settings.json`（userData）
- 用户偏好：中文交流、深度技术解释、先给方案再动手、视觉验收要求高
- 本机网络：GitHub SSH 通，API 走代理 `127.0.0.1:7897`（env 里旧端口 65314 已失效）

---

*此文档随代码演进。改了架构、流程、约定，请同步更新它。*
