# -*- coding: utf-8 -*-
"""配置读写（架构书 §5）"""
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
CONFIG_PATH = os.path.join(ROOT, "config.json")
PRESETS_PATH = os.path.join(ROOT, "presets.json")
WEB_DIR = os.path.join(ROOT, "web")

_DEFAULTS = {
    "comfy_dir": r"E:/Comfy-Desktop/ComfyUI-Installs/comfy-img/ComfyUI",
    "python_exe": r"E:/Comfy-Desktop/ComfyUI-Installs/comfy-img/ComfyUI/.venv/Scripts/python.exe",
    "host": "127.0.0.1",
    "port": 8188,
    "output_dir": r"E:/Comfy-Desktop/ComfyUI-Shared/output",
    "web_port": 8777,
    "autostart_service": True,
    "models": {
        "unet": "qwen-image-2.1-UC-Q4_K_M.gguf",
        "clip": "qwen3vl_8b_heretic-Q4_K_M.gguf",
        "vae": "qwen_image_2.1_vae_bf16.safetensors",
    },
    "defaults": {"width": 896, "height": 1152, "steps": 25, "cfg": 2.5, "negative": ""},
    "comfy_extra_args": [],
}

_cache = None


def load():
    global _cache
    if _cache is not None:
        return _cache
    cfg = json.loads(json.dumps(_DEFAULTS))
    if os.path.exists(CONFIG_PATH):
        try:
            with open(CONFIG_PATH, encoding="utf-8") as f:
                user = json.load(f)
            for k, v in user.items():
                if isinstance(v, dict) and isinstance(cfg.get(k), dict):
                    cfg[k].update(v)
                else:
                    cfg[k] = v
        except Exception as e:  # 配置坏了不能崩，回落默认
            print("[config] 读取失败，使用默认值:", e)
    _cache = cfg
    return cfg


def save(patch: dict):
    cfg = load()
    for k, v in patch.items():
        if isinstance(v, dict) and isinstance(cfg.get(k), dict):
            cfg[k].update(v)
        else:
            cfg[k] = v
    with open(CONFIG_PATH, "w", encoding="utf-8") as f:
        json.dump(cfg, f, ensure_ascii=False, indent=2)
    return cfg


def paths():
    """常用路径（架构书 §3.1）"""
    cfg = load()
    cdir = cfg["comfy_dir"]
    return {
        "comfy_dir": cdir,
        "input_dir": os.path.join(cdir, "input"),
        "output_dir": cfg["output_dir"],
        "models_dir": os.path.join(cdir, "models"),
    }
