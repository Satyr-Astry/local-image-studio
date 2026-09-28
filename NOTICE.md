# NOTICE · 上游组件与许可以及必要署名

本仓库自有代码按 **MIT** 授权（见 `LICENSE`）。以下是随本项目一起分发/引用的上游组件，
各自的许可全文放在 `licenses/` 目录；**再分发本项目的产物时请一并保留 `licenses/` 目录。**

## 一、模型（Qwen-Image-2.1 及社区量化/消融部件）

| 文件 | 许可 | 来源 |
|---|---|---|
| `qwen-image-2.1-UC-Q4_K_M.gguf` / `-UC-Q4_0.gguf` | **Qwen Research License** | HF `abenzerps/Qwen-Image-2.1-Uncensored-GGUF`（量化自 `Qwen/Qwen-Image-2.1`） |
| `qwen3vl_8b_heretic-Q4_K_M.gguf` / `mmproj-…f16.gguf` | **Qwen Research License**（GGUF 元数据 `general.license.name = qwen-research`） | HF `pottokao/Qwen-Image-2.1-Text-Encoder-Heretic-GGUF` |
| `qwen_image_2.1_vae_bf16.safetensors` | **Qwen Research License** | HF `abenzerps/Qwen-Image-2.1-Uncensored-GGUF` |

**协议要点**（全文见 `licenses/Qwen-Research-License.txt`）：
- §1.i / §2.a：仅可用于**非商业用途**（研究或评估）；
- §2.b：商用须另行取得许可 → `model-business@notice.qwencloud.com`；
- §3.a / §3.c：再分发须随附许可全文，并在 NOTICE 中保留以下**署名原文**（不得改写）：
  > Qwen is licensed under the Qwen RESEARCH LICENSE AGREEMENT,
  > Copyright (c) 2026 Hangzhou Tongyi Laboratory Technology Co., Ltd.
  > All Rights Reserved.
- §3.b：被修改过的文件须显著标注改动；
- §4.c：不得以 "Qwen" 作为产品/衍生作品的主要名称（描述性使用允许）；
- §4.d 赔偿条款；§8.b 争议由杭州法院专属管辖。

本项目**未修改**上述模型权重与 ComfyUI 源码，只做了打包与调度。

## 二、软件组件

| 组件 | 版本 | 许可 | 许可全文 |
|---|---|---|---|
| ComfyUI | 0.37.4 | **GPL-3.0** | `licenses/ComfyUI-GPL-3.0.txt` |
| ComfyUI-GGUF（`comfyui-gguf`） | — | **Apache-2.0** | `licenses/ComfyUI-GGUF-Apache-2.0.txt` |
| Electron | 40.10.2 | **MIT** | `licenses/Electron-MIT.txt` |
| Chromium（Electron 内置） | 随 Electron | BSD-3 及众多第三方 | Electron 发行包内 `LICENSES.chromium.html` |
| Python（嵌入式运行时） | 3.13.12 | **PSF** | `licenses/Python-PSF.txt` |
| PyTorch | 2.10.0+cu130 | **BSD-3-Clause**（+ 第三方） | `licenses/PyTorch-BSD-3-Clause.txt`、`licenses/PyTorch-NOTICE.txt` |
| NVIDIA CUDA / cuDNN 运行库 | 13.x / 9.x | NVIDIA CUDA Toolkit EULA（允许随应用再分发运行库） | 随 PyTorch 发行包 |
| 其余 Python 依赖（207 个发行包） | — | 各自许可 | 各包的 `*.dist-info/` 内 |

**GPL-3.0 说明**：本项目以 **HTTP（127.0.0.1）+ 子进程**方式调用 ComfyUI，未与 ComfyUI 源码合并，
两者构成聚合（mere aggregation）；ComfyUI 部分仍受 GPL-3.0 约束，其源代码可从
<https://github.com/comfyanonymous/ComfyUI> 获取。再分发时若包含 ComfyUI，须同时保留其许可全文。

## 三、内容与使用

本应用是本地推理前端，不内置任何内容过滤；**使用者须自行确保生成内容合法**，
不得用于侵犯他人权利、违法或涉及未成年人的用途。作者不对使用者的生成内容承担责任。
