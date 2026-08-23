# 架构概览

墨流是本地优先的 Electron 桌面应用，没有账号、云端数据库或业务后端。

```text
renderer：Vanilla JS + Vditor IR
        │  window.ink 白名单 API
preload：参数最小化的桥接层
        │  IPC invoke / send
main：窗口、文件、设置、恢复、导出、资源服务
        ├── utility process：有界 Word 转换
        │
本地文件系统 + 回环地址资源服务
```

## 边界与职责

- `renderer/` 负责页签、编辑器实例、文件树、大纲、交互状态和导出内容准备，不直接使用 Node 文件系统 API。
- `main/preload.js` 是唯一渲染桥；新增能力必须先定义窄接口，再在主进程验证参数与路径权限。
- `main/` 负责系统对话框、文件操作、持久化、窗口生命周期、导出生成和资源服务。
- `samples/` 只作为首启示例源；测试中的写操作必须发生在临时副本，不得污染仓库样例。
- `scripts/` 与 `tests/` 组成工程门禁；功能冒烟覆盖真实 Electron 路径，单元测试覆盖可独立验证的规则与存储。

## 关键状态

- 每个可编辑页签持有独立 Vditor 实例；页签切换只切显隐，以保留光标、滚动和撤销历史。
- 正式内容以文稿文件为准；恢复草稿只用于异常退出保护，不能替代明确保存。
- 设置、最近项目和恢复草稿写入 Electron `userData`，不写进用户的文档库。
- 文档库是文件树遍历和大部分文件授权的根边界；所有打开的可编辑文稿还会注册单文件 watcher，因此文档库外经用户选择打开的文稿也能收到外部修改通知。用户通过系统对话框或拖放显式扩展授权。
- 主窗口与导出窗口启用 `sandbox: true`、`contextIsolation: true`、`nodeIntegration: false`；IPC 还会校验消息必须来自当前主窗口的 `webContents`。
- 主窗口导航只允许自身的 `renderer/index.html`；外部链接交给系统浏览器，其他导航一律拦截。

## 改动约束

1. 渲染层不得引入任意路径读取或通用 IPC 调用。
2. 文件写入必须返回可见结果；失败不能只记日志或静默吞掉。
3. 外部修改、恢复草稿与自动保存共同改动时，必须补冲突决策单元测试和功能冒烟。
4. 导出改动至少验证文本、图片、表格，以及 Mermaid、ECharts、Markmap、KaTeX 中受影响的复杂内容。
5. 修改版本或发布页面后运行 `npm run version:check`；修改核心工作流后运行 `npm run verify`。

统一术语见仓库根目录的 [CONTEXT.md](../../CONTEXT.md)，安全与恢复细节见 [数据安全](../data-safety.md)。
