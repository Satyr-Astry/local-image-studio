# -*- coding: utf-8 -*-
"""工作流图构造器（架构书 §4：图只在这里拼）

必须遵守的两个已实测坑：
 1. 参考图键必须扁平： "images.image_1"（嵌套字典会被静默忽略）
 2. vae 必须接进 TextEncodeQwenImage21，否则不生成 ref_latents
"""
from . import config


def _loaders(m):
    return {
        "1": {"class_type": "UnetLoaderGGUF", "inputs": {"unet_name": m["unet"]}},
        "2": {"class_type": "CLIPLoaderGGUF",
              "inputs": {"clip_name": m["clip"], "type": "qwen_image"}},
        "3": {"class_type": "VAELoader", "inputs": {"vae_name": m["vae"]}},
    }


def _tail(seed, steps, cfg_scale, prefix, width=None, height=None, latent=None):
    """latent=None 时用 EmptyLatentImage，否则用 TextEncodeQwenImage21 的 latent 输出"""
    g = {
        "6": {"class_type": "KSampler",
              "inputs": {"model": ["1", 0], "positive": ["4", 0], "negative": ["4", 1],
                         "latent_image": latent or ["5", 0], "seed": seed, "steps": steps,
                         "cfg": cfg_scale, "sampler_name": "euler", "scheduler": "simple",
                         "denoise": 1.0}},
        "7": {"class_type": "VAEDecode", "inputs": {"samples": ["6", 0], "vae": ["3", 0]}},
        "8": {"class_type": "SaveImage",
              "inputs": {"images": ["7", 0], "filename_prefix": prefix}},
    }
    if latent is None:
        g["5"] = {"class_type": "EmptyLatentImage",
                  "inputs": {"width": width, "height": height, "batch_size": 1}}
    return g


def build_t2i(prompt, negative, width, height, steps, cfg_scale, seed, prefix="qwen21_app/t2i"):
    m = config.load()["models"]
    wf = _loaders(m)
    wf.update(_tail(seed, steps, cfg_scale, prefix, width, height))
    wf["4"] = {"class_type": "TextEncodeQwenImage21",
               "inputs": {"clip": ["2", 0], "prompt": prompt, "negative_prompt": negative,
                          "resolution": 1024}}
    return wf


def _ref_inputs(refs):
    """refs: 已上传到 input/ 的文件名列表 → 扁平键 images.image_N"""
    d = {}
    for i, name in enumerate(refs[:10], start=1):
        d[f"images.image_{i}"] = [f"r{i}", 0]
    return d


def _ref_loaders(refs):
    return {f"r{i}": {"class_type": "LoadImage", "inputs": {"image": name, "upload": "image"}}
            for i, name in enumerate(refs[:10], start=1)}


def build_edit(refs, prompt, negative, steps, seed, cfg_scale=1.0, prefix="qwen21_app/edit"):
    """参考图改图/抠图：尺寸随第一张参考图（latent 用节点输出）"""
    m = config.load()["models"]
    wf = _loaders(m)
    wf.update(_ref_loaders(refs))
    wf.update(_tail(seed, steps, cfg_scale, prefix, latent=["4", 2]))
    # 微调：节点4 的 latent 输出是 slot 2
    wf["6"]["inputs"]["latent_image"] = ["4", 2]
    wf["4"] = {"class_type": "TextEncodeQwenImage21",
               "inputs": {"clip": ["2", 0], "vae": ["3", 0], "prompt": prompt,
                          "negative_prompt": negative, "resolution": 1024,
                          **_ref_inputs(refs)}}
    return wf


def build_cutout(refs, subject_desc="", steps=25, seed=31337, prefix="qwen21_app/cutout"):
    base = ("Remove the background completely and keep ONLY the subject on a fully transparent "
            "background with a real alpha channel. Keep the subject's face, hair, body and pose "
            "exactly identical. No background, no floor, no wall, no props.")
    if subject_desc.strip():
        base = base.replace("the subject", f"the {subject_desc.strip()}", 1)
    return build_edit(refs, base, "", steps, seed, cfg_scale=1.0, prefix=prefix)
