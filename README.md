<div align="center">

<img src="assets/brand-banner.jpg" width="760" alt="墨流 InkFlow">

为写作而生的 Markdown 编辑器 —— Typora 式即时渲染 × 现代工作流

macOS · Windows · Linux · Electron 33 · Vditor IR · MIT License

</div>

---

## 界面预览

| 纸 · 浅色 | 墨 · 深色 |
| --- | --- |
| ![浅色主题](assets/screenshots/smoke-light.png) | ![深色主题](assets/screenshots/smoke-dark.png) |

## 为什么是墨流

Typora 把即时渲染做到了极致，但文件管理、标签页、命令面板一直是短板。墨流在同样「写即所见」的内核之上，补齐整套现代写作工作流：

- **即时渲染**：基于 Vditor IR 模式，Markdown 标记输入即刻排版，无预览切换、无双栏
- **编辑器实例池**：每个标签页持有独立编辑器实例，切换**零重渲染**——光标、滚动位置、撤销历史原样保留
- **块级格式快捷键**：`⌘1`~`⌘6` 秒切标题、`⌘0` 恢复正文，与 Typora 肌肉记忆一致
- **专注 & 打字机**：`⇧⌘F` 淡化非当前段落；`⇧⌘T` 光标行始终居中

## 文档库，就该像 VSCode 一样顺手

- **文件夹即文档库**：无账号、无云锁定，你的文件永远是你的
- **文件树选中态**：点选哪个目录，新建就落在哪个目录；右键与工具栏同一套规则
- **无感同步**：文件系统级监听，外部增删改自动上树，不用手动刷新
- **大纲视图**：实时解析标题、联动滚动位置，点击即跳转
- **快速打开**：`⌘P` 模糊搜索库内全部文档，`⌘⇧P` 命令面板触达一切功能

## 图片，零负担

- 粘贴截图、拖入图片 → 自动保存到文档旁 `assets/`，插入**相对路径**——与 Git、静态站完全兼容
- 文件树里点图片直接插入；拖入 `.md` 文件直接打开
- 相对路径图片在编辑器内正常预览（内置本地资源服务）

## 导出，一次到位

| 格式 | 说明 |
| --- | --- |
| **PDF** | A4 排版，打印级样式；Mermaid 流程图渲染为真图，不是代码 |
| **Word (.docx)** | 图片自动内联，表格不断行 |
| **PNG 长图** | 2x 高清（1640px 宽），全文一图到底 |
| **HTML** | 自包含单文件，内联样式与字体 |

## 纸墨美学

「纸」是暖白宣纸（#faf9f5），「墨」是深青松烟（#1b1e24）——不是换皮，是两种材质。编辑区、侧栏、浮层、导出样式从同一套 CSS 变量令牌派生，支持跟随系统自动切换。页面宽度可选「正常 / 超宽」，滚动条永远贴在窗口右缘。

## 可靠，是底线

- 输入停顿 0.9s 自动落盘，**原子写入**防半截文件
- 未保存更改在关标签、退出时逐层确认
- 重启自动恢复文档库、标签页、侧栏宽度与界面状态
- **22 项自动化功能回归**：编辑、自动保存、导出管线、树交互、格式快捷键全部有断言

## 格式支持

标题（⌘1-6）、表格、任务列表、代码高亮、KaTeX 数学公式、Mermaid 流程图/时序图、ECharts 图表、脚注、高亮标记、上下标、`[toc]` 目录、emoji 提示（输入 `:`）。

## 快捷键

> 下表为 macOS 符号；Windows / Linux 上 `⌘`→`Ctrl`、`⌥`→`Alt`、`⇧`→`Shift`，应用内提示会按平台自动显示。

| 功能 | 快捷键 | 功能 | 快捷键 |
| --- | --- | --- | --- |
| 标题 1~6 级 | `⌘1`~`⌘6` | 正文（取消标题） | `⌘0` |
| 引用 / 无序 / 有序 / 任务 | `⌥⌘Q` `⌥⌘U` `⌥⌘O` `⌥⌘X` | 切换标签 | `⌥1`~`⌥9` |
| 加粗 / 斜体 / 行内代码 / 删除线 | `⌘B` `⌘I` `⌘E` `⇧⌘X` | 专注 / 打字机 | `⇧⌘F` `⇧⌘T` |
| 新建 / 打开 / 保存 | `⌘N` `⌘O` `⌘S` | 快速打开 / 命令面板 | `⌘P` `⇧⌘P` |
| 打开文件夹 | `⇧⌘O` | 侧边栏 / 大纲 | `⇧⌘L` `⇧⌘J` |
| 插入链接 / 图片 / 表格 / 代码块 | `⌘K` `⌥⌘I` `⌥⌘T` `⌥⌘C` | 页面宽度 / 缩放字号 | 右键菜单 `⌘=` `⌘-` |
| 导出 PDF / Word | `⌥⌘P` `⌥⌘W` | 全部快捷键 | `⌘/` |

## 下载与安装

官网（含下载入口）：**[inkflow.yufeng.fun](https://inkflow.yufeng.fun)**

当前发布 **macOS (Apple Silicon)** 版本，从 [Releases](https://github.com/breeze-lyf/InkFlow/releases) 下载 `墨流-x.y.z-arm64.dmg`，拖入「应用程序」即可。Windows / Linux 版本可联系作者打包。

首次启动自动在文档目录创建「墨流示例」库，30 秒看完全部能力。

> 当前为个人构建、未公证：**macOS** 如提示"已损坏"，双击 DMG 内的「解除打开限制.command」一键解除（或终端执行 `xattr -dr com.apple.quarantine "/Applications/墨流 InkFlow.app"`）。
> 设为 Markdown 默认打开：选中任意 .md 文件 → 右键 → 显示简介 → 打开方式 → 墨流 InkFlow → 全部更改。

## 从源码构建

```bash
git clone git@github.com:breeze-lyf/InkFlow.git
cd InkFlow
npm install
npm start            # 开发模式
npm run dist         # 打包 macOS (DMG + ZIP)
npm run dist:win     # 打包 Windows (NSIS 安装包 + ZIP)
npm run dist:linux   # 打包 Linux (AppImage + ZIP)
npm run dist:all     # 一次打包三平台
```

> 跨平台打包无需对应系统：在 Mac 上即可产出 Windows 与 Linux 安装包（electron-builder 交叉构建）。

## 测试

```bash
# 功能回归（22 项断言：编辑/自动保存/导出管线/文件树/快捷键…）
SMOKE=1 SMOKE_FUNC=1 ./node_modules/.bin/electron --no-sandbox .

# 视觉冒烟（自动截图到 assets/screenshots/）
SMOKE=1 SMOKE_SHOTS=light,dark,welcome ./node_modules/.bin/electron --no-sandbox .
```

## 项目结构

```
inkflow/
├── main/          # Electron 主进程：窗口/菜单/IPC/资源服务/导出/fs 监听
├── renderer/      # 界面层：HTML + CSS 变量设计系统 + Vanilla JS
│   └── js/        # app(标签/命令) editor(实例池) panels(树/大纲) overlay exporter
├── samples/       # 内置示例文档（首启复制到系统文档目录/墨流示例）
├── assets/        # 品牌资产（水墨标/横标/图标）与截图
└── scripts/       # 品牌资产加工脚本
```

## 致谢与技术栈

- [Vditor](https://github.com/Vanessa219/vditor)（MIT）— 即时渲染 Markdown 内核（Lute / KaTeX / Mermaid / highlight.js / ECharts）
- [Electron](https://github.com/electron/electron)（MIT）— 桌面应用框架
- [html-to-docx](https://github.com/privateOmega/html-to-docx)（MIT）— Word 导出

第三方许可详见 [THIRD-PARTY-LICENSES.md](THIRD-PARTY-LICENSES.md)。

---

<div align="center">
墨流 InkFlow · MIT License
</div>
