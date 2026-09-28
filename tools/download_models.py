#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""下载 Local Image Studio 所需的 5 个模型文件（走 hf-mirror 镜像，含字节校验）。

用法:
    python tools/download_models.py --dir "E:/ComfyUI/models"          # 全下（含低显存备用模型）
    python tools/download_models.py --dir "E:/ComfyUI/models" --no-spare   # 不下 4.15G 备用模型
    python tools/download_models.py --dir "E:/ComfyUI/models" --check      # 只校验现有文件

许可提醒: 这些模型均为 **Qwen Research License（仅限非商用）**，
         详见 ../licenses/Qwen-Research-License.txt 与 ../licenses/NOTICE.txt
"""
import argparse
import os
import shutil
import subprocess
import sys

MIRROR = "https://hf-mirror.com"   # HF 直连在部分网络不可达；镜像内容一致
HF = "https://huggingface.co"

# (仓库, 仓库内路径, 本地目标目录, 文件名, 精确字节数, 是否低显存备用)
FILES = [
    ("abenzerps/Qwen-Image-2.1-Uncensored-GGUF", "qwen-image-2.1-UC-Q4_K_M.gguf",
     "diffusion_models", "qwen-image-2.1-UC-Q4_K_M.gguf", 4604558112, False),
    ("abenzerps/Qwen-Image-2.1-Uncensored-GGUF", "qwen-image-2.1-UC-Q4_0.gguf",
     "diffusion_models", "qwen-image-2.1-UC-Q4_0.gguf", 4151573280, True),
    ("pottokao/Qwen-Image-2.1-Text-Encoder-Heretic-GGUF", "qwen3vl_8b_heretic-Q4_K_M.gguf",
     "text_encoders", "qwen3vl_8b_heretic-Q4_K_M.gguf", 5027785376, False),
    ("pottokao/Qwen-Image-2.1-Text-Encoder-Heretic-GGUF", "mmproj-qwen3vl_8b_heretic-f16.gguf",
     "text_encoders", "mmproj-qwen3vl_8b_heretic-f16.gguf", 1159030464, False),
    ("abenzerps/Qwen-Image-2.1-Uncensored-GGUF", "vae/qwen_image_2.1_vae_bf16.safetensors",
     "vae", "qwen_image_2.1_vae_bf16.safetensors", 675509688, False),
]


def url_for(repo, path, mirror=True):
    base = MIRROR if mirror else HF
    return f"{base}/{repo}/resolve/main/{path}"


def have_aria2():
    return shutil.which("aria2c") is not None


def download(url, dest):
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    if have_aria2():
        # aria2 多线程明显快于单线程 curl（实测同网络约 18x）
        cmd = ["aria2c", "-x", "16", "-s", "16", "-k", "8M", "--continue=true",
               "--auto-file-renaming=false", "--allow-overwrite=true",
               "-d", os.path.dirname(dest), "-o", os.path.basename(dest), url]
    elif shutil.which("curl"):
        cmd = ["curl", "-L", "-C", "-", "--retry", "3", "-o", dest, url]
    else:
        import urllib.request
        print("      （无 aria2c/curl，改用 urllib 单线程）")
        urllib.request.urlretrieve(url, dest)
        return True
    try:
        return subprocess.call(cmd) == 0
    except Exception as e:                                     # noqa: BLE001
        print(f"      下载器失败: {e}")
        return False


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", required=True, help="ComfyUI 的 models 目录")
    ap.add_argument("--no-spare", action="store_true", help="不下载低显存备用模型（省 4.15G）")
    ap.add_argument("--check", action="store_true", help="只校验，不下载")
    ap.add_argument("--no-mirror", action="store_true", help="用 huggingface.co 直连（不用镜像）")
    a = ap.parse_args()

    root = os.path.abspath(a.dir)
    ok = bad = skipped = 0
    for repo, path, sub, name, size, spare in FILES:
        if spare and a.no_spare:
            print(f"[跳过] {name}（--no-spare）")
            skipped += 1
            continue
        dest = os.path.join(root, sub, name)
        exists = os.path.isfile(dest)
        cur = os.path.getsize(dest) if exists else -1
        if exists and cur == size:
            print(f"[已就绪] {name}  ({size:,} 字节)")
            ok += 1
            continue
        print(f"[{'大小不符 %d/%d' % (cur, size) if exists else '缺失'}] {name}")
        if a.check:
            bad += 1
            continue
        url = url_for(repo, path, mirror=not a.no_mirror)
        print(f"      下载: {url}")
        download(url, dest)
        if os.path.isfile(dest) and os.path.getsize(dest) == size:
            print(f"      ✅ 完成 ({size:,} 字节)")
            ok += 1
        else:
            print(f"      ❌ 失败/大小不符（期望 {size:,}）")
            bad += 1

    print(f"\n汇总: 就绪 {ok} · 失败 {bad} · 跳过 {skipped}")
    print("模型许可: Qwen Research License —— 仅限非商用（研究/评估）")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
