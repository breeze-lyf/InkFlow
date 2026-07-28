#!/usr/bin/env python3
# 品牌资产加工：从品牌原图提取水墨标与横标，生成真透明角应用图标
from PIL import Image, ImageDraw, ImageFilter
import math, os

SRC = '/Users/breeze/Dev/markdown/inkflow/assets/brand-source.jpg'
OUT_ICON = '/Users/breeze/Dev/markdown/inkflow/assets/icon.png'
OUT_MARK = '/Users/breeze/Dev/markdown/inkflow/assets/brand-mark.png'
OUT_LOCKUP = '/Users/breeze/Dev/markdown/inkflow/assets/brand-lockup.png'

im = Image.open(SRC).convert('RGB')
W, H = im.size

# 1) 采样背景色（四角平均）
corners = [im.getpixel(p) for p in [(20, 20), (W - 21, 20), (20, H - 21), (W - 21, H - 21)]]
bg = tuple(sum(c[i] for c in corners) // 4 for i in range(3))
print('bg =', bg)

# 2) 计算 alpha：与底色距离 → 0..255（smoothstep 保留水墨柔和边缘）
px = im.load()
alpha = Image.new('L', (W, H), 0)
ap = alpha.load()
T1, T2 = 14.0, 46.0
for y in range(H):
    for x in range(W):
        r, g, b = px[x, y]
        d = math.sqrt((r - bg[0]) ** 2 + (g - bg[1]) ** 2 + (b - bg[2]) ** 2)
        if d <= T1:
            a = 0
        elif d >= T2:
            a = 255
        else:
            t = (d - T1) / (T2 - T1)
            t = t * t * (3 - 2 * t)
            a = int(t * 255)
        if a < 24:
            a = 0
        ap[x, y] = a

cutout = im.convert('RGBA')
cutout.putalpha(alpha)

# 2b) 强内容掩码（用于定位，不受 JPEG 噪声/暗角影响）
strong = Image.new('L', (W, H), 0)
sp = strong.load()
for y in range(H):
    for x in range(W):
        r, g, b = px[x, y]
        d = math.sqrt((r - bg[0]) ** 2 + (g - bg[1]) ** 2 + (b - bg[2]) ** 2)
        sp[x, y] = 255 if d > 70 else 0
# 轻度膨胀，连接笔画内部空洞
strong = strong.filter(ImageFilter.MaxFilter(5))

# 2c) 几何包围盒用更敏感的掩码（d>30），保住浅色飞白笔画
soft = Image.new('L', (W, H), 0)
fp = soft.load()
for y in range(H):
    for x in range(W):
        r, g, b = px[x, y]
        d = math.sqrt((r - bg[0]) ** 2 + (g - bg[1]) ** 2 + (b - bg[2]) ** 2)
        fp[x, y] = 255 if d > 30 else 0
# 开运算去噪点
soft = soft.filter(ImageFilter.MinFilter(3)).filter(ImageFilter.MaxFilter(5))

bbox = soft.getbbox()
print('content bbox =', bbox)

# 3) 分离 水墨标（左侧图形）与 横标（图形+文字）
#    找图形与文字的分界：扫描垂直投影的间隙
col_has = [False] * W
for x in range(W):
    for y in range(bbox[1], bbox[3]):
        if sp[x, y] > 0:
            col_has[x] = True
            break
# 找最长的连续段（图形是一段，文字是一段）
segs = []
start = None
for x in range(W + 1):
    v = col_has[x] if x < W else False
    if v and start is None:
        start = x
    elif not v and start is not None:
        segs.append((start, x))
        start = None
segs = [s for s in segs if s[1] - s[0] > 8]
print('segments:', segs)
mark_x1 = segs[0][0]
# 图形与文字之间有大间隙 → 第一段为图形
mark_x2 = segs[0][1]
pad = 12
mark_box = (max(0, mark_x1 - pad), max(0, bbox[1] - pad), min(W, mark_x2 + pad), min(H, bbox[3] + pad))
mark = cutout.crop(mark_box)
print('mark size =', mark.size)
mark.save(OUT_MARK)

lockup_box = (max(0, bbox[0] - pad), max(0, bbox[1] - pad), min(W, bbox[2] + pad), min(H, bbox[3] + pad))
lockup = cutout.crop(lockup_box)
lockup.save(OUT_LOCKUP)
print('lockup size =', lockup.size)

# 4) 应用图标：宣纸底 squircle + 水墨标居中（真透明四角）
S = 1024
icon = Image.new('RGBA', (S, S), (0, 0, 0, 0))
d = ImageDraw.Draw(icon)
inset, radius = 100, 190
d.rounded_rectangle([inset, inset, S - inset, S - inset], radius=radius, fill=bg + (255,))

# 水墨标缩放到 squircle 内约 58% 宽，光学中心略偏上
inner = S - inset * 2
mw, mh = mark.size
scale = (inner * 0.58) / mw
nw, nh = int(mw * scale), int(mh * scale)
mark_r = mark.resize((nw, nh), Image.LANCZOS)
ox = inset + (inner - nw) // 2
oy = inset + int((inner - nh) * 0.46)
icon.alpha_composite(mark_r, (ox, oy))
icon.save(OUT_ICON)
print('icon saved:', OUT_ICON)
