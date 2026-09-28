# Local Image Studio · 本地绘图工作台

> 把 **Qwen-Image-2.1**（7B DiT + Qwen3-VL 文本编码器）包装成**绿色免安装桌面应用**：
> 文生图 / 图像编辑 / 抠图透明 / 批量队列 / 画廊 / 预设管理。
> 一个文件夹拷到新电脑双击即用，**完全离线**（不需要装 Python、不需要装 ComfyUI、不需要联网）。
>
> **EN**: A portable Windows desktop app (Electron shell + local HTTP backend + bundled ComfyUI engine)
> wrapping **Qwen-Image-2.1** (GGUF) for text-to-image, image editing and background removal — offline, zero-install.

---

## ⚠️ 许可提醒（请先读）

| 层 | 许可 | 说明 |
|---|---|---|
| **模型** Qwen-Image-2.1 及其量化/消融部件 | **Qwen Research License** | **仅限非商业用途**（研究 / 评估）。商用须另行取得 Alibaba 许可：`model-business@notice.qwencloud.com` |
| **应用本体**（本仓库代码） | MIT | 见 `LICENSE` |
| **上游组件** | ComfyUI = GPL-3.0 · ComfyUI-GGUF = Apache-2.0 · Electron = MIT · Python = PSF · PyTorch = BSD-3 | 见 `licenses/`（含 Qwen 协议要求的署名 NOTICE） |

模型协议还要求：产品**不得以 "Qwen" 作为主要名称**（描述性提及允许，如「内置 Qwen-Image-2.1 引擎」）；
再分发时必须随包附带 `licenses/` 目录（许可全文 + 署名）。

---

## 主要成果（本机实测，RTX 4070 Ti 12GB）

| 项目 | 结果 |
|---|---|
| 文生图 | 1152×896 / 25 步 / cfg 2.5 → **94.7 s**，产物 1.39 MB |
| 图像编辑（换装 / 换场景） | 68 s 级；换场景像素差异 73.98%，换装局部 4.46%→7.76% |
| 抠图 / 透明背景 | 输出 RGBA，透明像素占比 **59.8%** |
| 引擎冷启动 | ComfyUI v0.37.4 就绪 **14 s**；应用端到端 **18.4 s**（带五段式真进度条） |
| 桌面外壳 | Electron 40.10.2，331 MB，原生窗口（无地址栏），关窗 1 s 内连引擎一起清干净 |
| 显存策略 | ≥12 GB 全速；11.5~12 GB 自动降配；<10 GB 加 `--lowvram` + 切 Q4_0 模型 |
| 绿色包体积 | **21 GB**（运行时 5.4 G + 引擎/模型 15 G） |

**Green bundle**: runtime 5.4 G (embedded CPython 3.13.12 + torch 2.10.0+cu130) + ComfyUI & models 15 G
(Q4_K_M 4.3 G + spare Q4_0 3.9 G + text encoder 4.7 G + mmproj 1.1 G + VAE 645 M) ≈ 21 G total.

---

## 硬件与环境

| | |
|---|---|
| 系统 | Windows 10 / 11 **64 位** |
| 显卡 | **NVIDIA 独显（必需，CUDA）** · RTX 4070 Ti 12 GB 实测 |
| 显存 | ≥12 GB 全速 · 8~12 GB 自动降配（更慢） |
| 内存 / 磁盘 | 16 GB 建议 · 包 21 GB + 出图留 30 GB |
| 运行库 | 免安装（Python 3.13.12 + torch 2.10.0+cu130 全在包内） |

---

## 快速开始

### 方式 A：用发布的绿色包（最省事，需要 21 GB）

1. 从本仓库 **Releases** 下载完整绿色包（分卷 zip）并全部解压到同一目录
2. 双击 `启动桌面版.bat` → 出现进度条 → 约 20 秒进界面
3. 关窗即退出（后台引擎一并关闭）

### 方式 B：只用应用层 + 自备引擎（轻量，推荐给已装 ComfyUI 的人）

```bash
# 1) 拿到应用层（本仓库的 Release: app-layer-v0.1.0.zip）
# 2) 下模型（走 hf-mirror 镜像，含字节校验）
python tools/download_models.py --dir "E:/ComfyUI/models"
# 3) 装引擎节点
git clone https://github.com/comfyanonymous/ComfyUI
git clone https://github.com/leejet/ComfyUI-GGUF  ComfyUI/custom_nodes/ComfyUI-GGUF
# 4) 起引擎，再起应用（应用只连本机 127.0.0.1）
python ComfyUI/main.py --listen 127.0.0.1 --port 8188
python src/backend/server.py     # 应用后端 → http://127.0.0.1:8777
```

### 方式 C：从这个仓库直接跑

```bash
python src/backend/server.py        # 后端 + 网页界面（浏览器开 127.0.0.1:8777）
python tools/build_desktop.py       # 组装 Electron 桌面外壳（用本机缓存的 electron zip，不联网）
```

---

## 目录结构

```
├─ web/            前端（原生 vanilla，无构建步骤）：index.html / style.css / app.js
├─ src/backend/    应用后端（标准库 http.server）：config / comfy_client / workflows / jobs / service / presets / server
├─ desktop/        Electron 外壳：main.js（拉起后端 + 原生窗口 + 启动进度）
├─ tools/          build_desktop.py（组装外壳）· download_models.py（下模型）· probe_app.py（接口自检）
├─ docs/           总架构书.md（设计决策 / 缺陷表 D1~D15 / 变更日志）
└─ licenses/       上游许可全文 + NOTICE（含 Qwen 协议要求的署名原文）+ 组件清单
```

**架构一句话**：Electron 外壳只做「拉起后端 + 开窗口」，业务全在一个本机 HTTP 后端里；后端再调度包内/本机的
ComfyUI 引擎（GGUF 节点链：`UnetLoaderGGUF → CLIPLoaderGGUF → TextEncodeQwenImage21 → KSampler → VAEDecode → SaveImage`）。
用子进程 + HTTP 集成，与 GPL-3.0 的 ComfyUI 构成聚合，应用层保持 MIT。

---

## 已知局限（诚实段）

- **非商用**：模型许可是研究/评估用途，本应用不能用于商业产品（要商用先拿 Alibaba 许可）。
- **只支持 NVIDIA**：CUDA 必需，A 卡/核显跑不了。
- **串行执行**：12 GB 显存不并发，多任务排队一张张来。
- **首次启动慢**：要拉起引擎并加载模型，约 20~60 s（之后 15~20 s）。
- **分辨率甜点**：896×1152 / 25 步；原生支持更高分辨率，但 12 GB 下会明显变慢。
- **图像编辑依赖参考图**：编辑/抠图必须先给参考图，纯文字改不了。
- 目前只在 Windows 上验证过；Linux/macOS 未测（理论上可移植，但包内运行时是 win-x64）。

---

## 许可（三层）

1. **本仓库代码**：MIT（`LICENSE`）
2. **上游组件**：ComfyUI(GPL-3.0) / ComfyUI-GGUF(Apache-2.0) / Electron(MIT) / Chromium(BSD-3 等) /
   Python(PSF) / PyTorch(BSD-3 + NVIDIA CUDA 运行库) —— 全文与清单见 `licenses/`
3. **模型**：Qwen Research License（**非商用**）—— 全文见 `licenses/Qwen-Research-License.txt`，
   署名要求见 `licenses/NOTICE.txt`（原文照录，不得改写）

> Built with Qwen.
