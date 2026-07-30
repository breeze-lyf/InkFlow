#!/bin/bash
# 墨流 InkFlow · 首次打开修复工具
# 应用未做 Apple 公证，跨设备传输（微信/网盘/AirDrop）后 macOS 会误报"已损坏"。
# 双击本脚本即可解除限制并打开应用。

APP_PATH="/Applications/墨流 InkFlow.app"
[ ! -d "$APP_PATH" ] && APP_PATH="/Applications/墨流.app"
[ ! -d "$APP_PATH" ] && APP_PATH="$(cd "$(dirname "$0")" && pwd)/墨流 InkFlow.app"
[ ! -d "$APP_PATH" ] && APP_PATH="$(cd "$(dirname "$0")" && pwd)/墨流.app"

if [ -d "$APP_PATH" ]; then
  xattr -dr com.apple.quarantine "$APP_PATH" 2>/dev/null
  echo "✅ 限制已解除，正在打开墨流…"
  open "$APP_PATH"
else
  echo "⚠️  没有找到墨流应用"
  echo "请先把「墨流 InkFlow.app」拖入「应用程序」文件夹，再运行本脚本。"
fi
echo ""
read -n 1 -s -r -p "按任意键关闭窗口…"
