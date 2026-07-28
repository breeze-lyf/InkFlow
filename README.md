# 墨流 InkFlow

> 纸上得来终觉浅，落笔此处墨自流。

一款为 macOS 打造的优雅 Markdown 编辑器：**即时渲染**（写即所见）、文档库管理、命令面板、专注写作，纸墨双色质感主题。

![图标](assets/icon.png)

## 快速开始

**直接使用（推荐）**

- 打开 `dist/mac-arm64/墨流.app` 即可使用（本机构建，未签名，双击直接打开；若移动到其他 Mac，首次请右键 → 打开）
- 或挂载 `dist/墨流-1.0.0-arm64.dmg`，把「墨流」拖进 Applications
- 首次启动会自动在 `~/Documents/墨流示例` 创建示例文档库并打开演示文档

**从源码运行**

```bash
npm install
npm start          # 开发模式启动
npm run pack       # 打包 .app 到 dist/mac-arm64
npm run dist       # 构建 DMG + ZIP 发行包
```

## 亮点特性

| 特性 | 说明 |
| --- | --- |
| 即时渲染 | 基于 Vditor IR 模式，输入标记即刻呈现排版，无预览切换 |
| 文档库 | 侧栏文件树（新建/重命名/删除/拖拽打开），大纲实时联动滚动位置 |
| 快速打开 | `⌘P` 模糊搜索库内文档，`⌘⇧P` 命令面板触达所有功能 |
| 专注 & 打字机 | `⇧⌘F` 淡化非当前段落；`⇧⌘T` 光标行始终居中 |
| 图片零负担 | 粘贴截图、拖入图片自动保存到文档旁 `assets/` 并插入相对路径 |
| 导出 | 一键导出 PDF（A4 排版）与自包含 HTML（内联样式与字体） |
| 双主题 | 「纸」浅色 / 「墨」深色 / 跟随系统，编辑区与应用界面同步切换 |
| 自动保存 | 输入停顿 0.9s 自动落盘，原子写入防损坏，关闭前脏文件确认 |
| 会话恢复 | 重启自动恢复文档库、标签页与界面状态 |
| 原生细节 | 中文原生菜单、红绿灯融入侧栏、窗口代理图标与编辑态圆点 |

格式支持：标题、表格、任务列表、代码高亮、KaTeX 数学公式、Mermaid 流程图、脚注、高亮标记、上下标、emoji 提示（输入 `:`）、`[toc]` 目录。

## 常用快捷键

| 功能 | 快捷键 | 功能 | 快捷键 |
| --- | --- | --- | --- |
| 新建 / 打开 / 保存 | `⌘N` `⌘O` `⌘S` | 快速打开 / 命令面板 | `⌘P` `⇧⌘P` |
| 打开文件夹 | `⇧⌘O` | 侧边栏 / 大纲 | `⇧⌘L` `⇧⌘J` |
| 加粗 / 斜体 / 行内代码 | `⌘B` `⌘I` `⌘E` | 专注 / 打字机 | `⇧⌘F` `⇧⌘T` |
| 插入链接 / 图片 / 表格 | `⌘K` `⌥⌘I` `⌥⌘T` | 缩放字号 | `⌘=` `⌘-` `⌘0` |
| 导出 PDF | `⌥⌘P` | 全部快捷键 | `⌘/` |

## 界面预览

| 浅色 · 纸 | 深色 · 墨 |
| --- | --- |
| ![light](assets/screenshots/smoke-light.png) | ![dark](assets/screenshots/smoke-dark.png) |

## 技术栈

- **Electron 33** — 跨平台桌面壳（主进程原生菜单 / 文件服务 / PDF 导出）
- **Vditor 3**（MIT）— 即时渲染 Markdown 内核（Lute 引擎、KaTeX、Mermaid、highlight.js）
- 无框架 Vanilla JS 渲染层，CSS 变量设计系统

```
inkflow/
├── main/          # Electron 主进程（窗口/菜单/IPC/资源服务/导出）
├── renderer/      # 界面（HTML/CSS/JS，含内容主题 inkflow-light/dark）
├── samples/       # 内置示例文档（首启复制到 ~/Documents/墨流示例）
├── assets/        # 图标与截图
├── scripts/       # 图标渲染脚本
└── dist/          # 打包产物（.app / .dmg / .zip）
```

## 测试

```bash
SMOKE=1 SMOKE_FUNC=1 ./node_modules/.bin/electron .     # 功能冒烟（9 项断言）
SMOKE=1 ./node_modules/.bin/electron .                  # 视觉冒烟（自动截图）
```

当前状态：功能冒烟 **9/9 通过**（打开/编辑/自动保存/统计/标签/导出生成/主题切换）。

---

墨流 InkFlow · MIT License · 基于开源项目 [Vditor](https://github.com/Vanessa219/vditor) 构建
