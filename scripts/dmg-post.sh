#!/bin/bash
# 墨流 DMG 后处理：把「解除打开限制.command」与「安装说明.txt」注入 DMG
# electron-builder 的 dmg.contents 对额外文件静默跳过，只能事后注入
set -e
cd "$(dirname "$0")/.."
DMG=$(ls dist/墨流-*-arm64.dmg 2>/dev/null | sort -V | tail -1)
[ -z "$DMG" ] && echo "未找到 DMG" && exit 1
hdiutil convert "$DMG" -format UDRW -o /tmp/inkflow-rw.dmg >/dev/null
hdiutil attach -readwrite -nobrowse /tmp/inkflow-rw.dmg >/dev/null
cp "resources/解除打开限制.command" "resources/安装说明.txt" "/Volumes/墨流 InkFlow/"
hdiutil detach "/Volumes/墨流 InkFlow" -quiet
hdiutil convert /tmp/inkflow-rw.dmg -format UDZO -imagekey zlib-level=9 -o /tmp/inkflow-final.dmg >/dev/null
mv /tmp/inkflow-final.dmg "$DMG"
echo "已注入辅助文件 → $DMG"
