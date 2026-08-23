#!/bin/bash
# 墨流 DMG 后处理：把「解除打开限制.command」与「安装说明.txt」注入 DMG
# electron-builder 的 dmg.contents 对额外文件静默跳过，只能事后注入
set -e
cd "$(dirname "$0")/.."
VERSION=$(node -p "require('./package.json').version")
DMG="dist/墨流-${VERSION}-arm64.dmg"
[ ! -f "$DMG" ] && echo "未找到当前版本 DMG：$DMG" && exit 1
WORK_DIR=$(mktemp -d "${TMPDIR:-/tmp}/inkflow-dmg.XXXXXX")
trap 'rm -rf "$WORK_DIR"' EXIT
RW_DMG="$WORK_DIR/inkflow-rw.dmg"
FINAL_DMG="$WORK_DIR/inkflow-final.dmg"
hdiutil convert "$DMG" -format UDRW -o "$RW_DMG" >/dev/null
hdiutil attach -readwrite -nobrowse "$RW_DMG" >/dev/null
cp "resources/解除打开限制.command" "resources/安装说明.txt" \
  "LICENSE" "THIRD-PARTY-LICENSES.md" "/Volumes/墨流 InkFlow/"
hdiutil detach "/Volumes/墨流 InkFlow" -quiet
hdiutil convert "$RW_DMG" -format UDZO -imagekey zlib-level=9 -o "$FINAL_DMG" >/dev/null
mv "$FINAL_DMG" "$DMG"
echo "已注入辅助文件 → $DMG"
