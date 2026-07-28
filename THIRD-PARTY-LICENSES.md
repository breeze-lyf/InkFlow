# 第三方开源组件声明

墨流 InkFlow 基于以下优秀的开源项目构建，感谢所有作者与贡献者。

## 运行时组件（随应用分发）

| 组件 | 版本 | 许可证 | 用途 | 主页 |
| --- | --- | --- | --- | --- |
| **Vditor** | 3.11.2 | MIT | Markdown 即时渲染内核（编辑器核心） | https://github.com/Vanessa219/vditor |
| **Electron** | 33.4.11 | MIT | 跨平台桌面应用框架 | https://github.com/electron/electron |
| KaTeX | 0.16.9 | MIT | 数学公式渲染（Vditor 内置） | https://github.com/KaTeX/KaTeX |
| highlight.js | 11.x | BSD-3-Clause | 代码语法高亮（Vditor 内置） | https://github.com/highlightjs/highlight.js |
| Mermaid | 9.x | MIT | 流程图/时序图渲染（Vditor 内置） | https://github.com/mermaid-js/mermaid |
| ECharts | 5.x | Apache-2.0 | 图表渲染（Vditor 内置） | https://github.com/apache/echarts |

## 开发期工具（不随应用分发）

| 组件 | 版本 | 许可证 | 用途 |
| --- | --- | --- | --- |
| electron-builder | 25.1.8 | MIT | 应用打包（.app / .dmg / .zip） |

---

## Vditor 许可证全文

```
MIT License

Copyright (c) 2019-present B3log 开源, b3log.org

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Electron 许可证说明

Electron 采用 MIT 许可证，版权所有 (c) OpenJS Foundation 及贡献者。
完整许可证文本见 `node_modules/electron/LICENSE`。

## 其他内置组件

KaTeX（MIT）、highlight.js（BSD-3-Clause）、Mermaid（MIT）、ECharts（Apache-2.0）
作为 Vditor 的内置依赖随其分发，各自保留原始版权声明与许可证文本，
详见 Vditor 项目仓库及其官方文档。
