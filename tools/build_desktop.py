# -*- coding: utf-8 -*-
"""把 Electron 运行时组装成绿色包内的桌面外壳"""
import os, shutil, zipfile

Z = r"C:\Users\Administrator\AppData\Local\electron\Cache\f8e28233e6e3c550d71d9c11516cd2922e2e6aae5f2ce70cc7f7c5ff23d6148d\electron-v40.10.2-win32-x64.zip"
D = r"E:\测试搬运\AI绘画_Qwen21\desktop"
SRC = r"E:\Qwen21App\desktop"
EXE_OUT = "Qwen-Image-2.1.exe"

assert os.path.exists(Z), "找不到 electron zip: " + Z
if os.path.exists(D):
    shutil.rmtree(D)
os.makedirs(D)

with zipfile.ZipFile(Z) as z:
    z.extractall(D)

# 若压缩包内还套了一层同名目录 → 上提
entries = os.listdir(D)
if len(entries) == 1 and os.path.isdir(os.path.join(D, entries[0])):
    inner = os.path.join(D, entries[0])
    for f in os.listdir(inner):
        shutil.move(os.path.join(inner, f), D)
    os.rmdir(inner)

# 删掉 Electron 自带示例应用（技能规则 3）
da = os.path.join(D, "resources", "default_app.asar")
if os.path.exists(da):
    os.remove(da)
    print("  已删 default_app.asar")

appdir = os.path.join(D, "resources", "app")
os.makedirs(appdir, exist_ok=True)
for f in ("main.js", "package.json"):
    shutil.copy(os.path.join(SRC, f), appdir)
    print("  已放入 resources/app/" + f)

# ---- 图标 ----
from PIL import Image, ImageDraw, ImageFont

S = 256
img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
d = ImageDraw.Draw(img)
for y in range(S):
    t = y / S
    r = int(0x1b + (0x5b - 0x1b) * t)
    g = int(0x1e + (0x9d - 0x1e) * t)
    b = int(0x24 + (0xff - 0x24) * t)
    d.line([(0, y), (S, y)], fill=(r, g, b, 255))
mask = Image.new("L", (S, S), 0)
ImageDraw.Draw(mask).rounded_rectangle([0, 0, S - 1, S - 1], radius=56, fill=255)
img.putalpha(mask)

font = None
for fp in (r"C:\Windows\Fonts\msyhbd.ttc", r"C:\Windows\Fonts\arialbd.ttf"):
    if os.path.exists(fp):
        font = ImageFont.truetype(fp, 110)
        break
if font:
    txt = "Q21"
    bb = d.textbbox((0, 0), txt, font=font)
    d.text(((S - (bb[2] - bb[0])) / 2 - bb[0], (S - (bb[3] - bb[1])) / 2 - bb[1] - 6),
           txt, font=font, fill=(255, 255, 255, 255))
ico = os.path.join(appdir, "icon.ico")
img.save(ico, sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
print(f"  图标已生成: {os.path.getsize(ico)} 字节, 字体={'有' if font else '无(纯色块)'}")

# ---- exe 改名 ----
src_exe = os.path.join(D, "electron.exe")
if os.path.exists(src_exe):
    os.rename(src_exe, os.path.join(D, EXE_OUT))
    print("  electron.exe → " + EXE_OUT)
else:
    print("  ⚠ 没找到 electron.exe！")

# ---- 根目录启动器 ----
bat = r"E:\测试搬运\AI绘画_Qwen21\启动桌面版.bat"
with open(bat, "w", encoding="gbk") as f:
    f.write('@echo off\r\n'
            'cd /d "%~dp0"\r\n'
            'start "" "%~dp0desktop\\' + EXE_OUT + '"\r\n')
print("  根目录启动器: " + bat)

print("\n桌面外壳结构:")
for f in sorted(os.listdir(D)):
    p = os.path.join(D, f)
    tag = "DIR " if os.path.isdir(p) else "FILE"
    print(f"  {tag} {f}")
