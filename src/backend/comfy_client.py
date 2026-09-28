# -*- coding: utf-8 -*-
"""ComfyUI HTTP 客户端（架构书 §4：模型调用只在这里）"""
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request

from . import config


def _base():
    cfg = config.load()
    return f"http://{cfg['host']}:{cfg['port']}"


def _get(path, timeout=20):
    with urllib.request.urlopen(_base() + path, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def _post_json(path, payload, timeout=60):
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(_base() + path, data=data,
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def is_alive():
    try:
        s = _get("/system_stats", timeout=4)
        return True, s.get("system", {}).get("comfyui_version", "?")
    except Exception as e:
        return False, str(e)


def submit(workflow: dict):
    """提交 API 格式工作流，返回 prompt_id；失败抛 RuntimeError(含节点报错)"""
    try:
        r = _post_json("/prompt", {"prompt": workflow})
        return r["prompt_id"]
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", "replace")
        detail = body
        try:
            j = json.loads(body)
            errs = j.get("node_errors") or {}
            msgs = []
            for nid, info in errs.items():
                for e2 in info.get("errors", []):
                    msgs.append(f"节点{nid}({info.get('class_type')}): {e2.get('message')} / {str(e2.get('details'))[:200]}")
            if msgs:
                detail = " | ".join(msgs)
        except Exception:
            pass
        raise RuntimeError(f"提交被拒 (HTTP {e.code}): {detail[:800]}")


def history(prompt_id):
    try:
        return _get(f"/history/{prompt_id}", timeout=30)
    except Exception:
        return {}


def _queue_prompt_ids():
    """当前引擎队列里的 prompt_id 集合（running + pending）；引擎不可达 → None"""
    try:
        q = _get("/queue", timeout=10)
    except Exception:
        return None
    ids = set()
    for bucket in ("queue_running", "queue_pending"):
        for item in q.get(bucket) or []:
            try:
                ids.add(item[1])
            except Exception:
                pass
    return ids


def wait(prompt_id, on_tick=None, poll=2.0, timeout=900, grace=90):
    """轮询到完成；返回 (status, outputs, error)。on_tick(elapsed) 用于进度回调。

    D12 修复：同时探测 /queue。引擎中途重启时历史会被清空、队列里也没了，此时只轮询
    /history 会傻等到 timeout，把单线程串行队列整条堵死。故：提交后 grace 秒内
    既不在队列也不在历史 → 判定"引擎重启/丢单"立即失败。
    """
    t0 = time.time()
    seen = False          # 是否已在队列或历史里见过这个 prompt
    while True:
        h = history(prompt_id)
        if prompt_id in h:
            entry = h[prompt_id]
            st = entry.get("status", {})
            status = st.get("status_str")
            if status == "error":
                msgs = []
                for m in st.get("messages", []):
                    if isinstance(m, (list, tuple)) and len(m) > 1 and isinstance(m[1], dict):
                        em = m[1].get("exception_message") or m[1].get("message")
                        if em:
                            msgs.append(str(em))
                return "error", [], " | ".join(msgs)[:800] or "执行失败（详见 ComfyUI 控制台）"
            files = []
            for _nid, out in (entry.get("outputs") or {}).items():
                for img in out.get("images", []):
                    sub = (img.get("subfolder") or "").strip("/\\")
                    name = img.get("filename")
                    if not name:
                        continue
                    files.append(f"{sub}/{name}" if sub else name)
            return "done", files, ""
        el = time.time() - t0
        qids = _queue_prompt_ids()
        if qids is None:
            seen = True               # 引擎不可达（可能在重启）→ 不判丢单
        elif prompt_id in qids:
            seen = True
        elif not seen and el > grace:
            return "error", [], ("引擎重启或任务已丢失：该任务既不在引擎队列也不在历史里。"
                                 "请在左下角点“重启”恢复引擎后重新提交。")
        if el > timeout:
            return "error", [], f"超时（>{timeout}s）"
        if on_tick:
            on_tick(el)
        time.sleep(poll)


def upload_input(filename: str, data: bytes) -> str:
    """把参考图写进 ComfyUI 实例的 input/（LoadImage 只读这里，架构书 §3.4-4）"""
    p = config.paths()
    os.makedirs(p["input_dir"], exist_ok=True)
    safe = os.path.basename(filename)
    dst = os.path.join(p["input_dir"], safe)
    with open(dst, "wb") as f:
        f.write(data)
    return safe
