# -*- coding: utf-8 -*-
"""预设管理（架构书 F9）：人物锁定词 / 画风 / 尺寸"""
import json
import os

from . import config

_DEFAULT = {
    # v0.3：默认预设必须**通用**，不得包含任何开发者/分发者的私人角色（架构书 §12.2）
    "characters": [
        {"name": "（空白）", "text": ""},
        {"name": "示例：成年女性肖像",
         "text": ("24-year-old adult woman, East Asian facial features, almond-shaped eyes, "
                  "natural skin texture, shoulder-length black hair, slim build")},
        {"name": "示例：成年男性肖像",
         "text": ("28-year-old adult man, short black hair, defined jawline, light stubble, "
                  "natural skin texture, athletic build")},
    ],
    "styles": [
        {"name": "真人写实",
         "pre": "Photorealistic candid photograph, shot on 35mm film, ",
         "post": (", natural lighting, real human skin texture with pores and imperfections, "
                  "shallow depth of field, film grain, documentary photography, 8k raw photo")},
        {"name": "漫画同人本",
         "pre": "Japanese manga style illustration, 2D anime artwork, colorful adult doujinshi comic art, ",
         "post": (", bold black ink outlines, thick clean linework, cel shading, flat color fills, "
                  "no gradients, screentone shading, expressive anime face, Japanese comic panel")},
        {"name": "无（纯提示词）", "pre": "", "post": ""},
    ],
    "sizes": [
        {"name": "竖版 896×1152", "w": 896, "h": 1152},
        {"name": "方形 1024×1024", "w": 1024, "h": 1024},
        {"name": "横版 1152×896", "w": 1152, "h": 896},
        {"name": "大竖版 1024×1280", "w": 1024, "h": 1280},
        {"name": "2K 方形 2048×2048（实验）", "w": 2048, "h": 2048},
    ],
}


def load():
    if not os.path.exists(config.PRESETS_PATH):
        save(_DEFAULT)
        return _DEFAULT
    try:
        with open(config.PRESETS_PATH, encoding="utf-8") as f:
            data = json.load(f)
        for k, v in _DEFAULT.items():
            data.setdefault(k, v)
        return data
    except Exception:
        return _DEFAULT


def save(data):
    with open(config.PRESETS_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    return data
