# -*- coding: utf-8 -*-
"""ComfyUI 服务守护（架构书 §4 / D2 / D5）"""
import os
import subprocess
import threading
import time

from . import comfy_client, config

_proc = None            # 本应用启动的进程（只停止它，架构书 §7-6）
_lock = threading.Lock()
_log_path = None


def status():
    alive, ver = comfy_client.is_alive()
    return {"alive": alive, "version": ver if alive else "",
            "managed_by_app": _proc is not None and _proc.poll() is None,
            "pid": _proc.pid if (_proc and _proc.poll() is None) else None}


def start(wait_seconds=180):
    """拉起 ComfyUI（清 PYTHONPATH/PYTHONHOME，架构书 §3.4-1）"""
    global _proc, _log_path
    alive, _ = comfy_client.is_alive()
    if alive:
        return {"ok": True, "msg": "服务已在运行"}
    cfg = config.load()
    with _lock:
        if _proc and _proc.poll() is None:
            pass
        else:
            env = dict(os.environ)
            env.pop("PYTHONPATH", None)
            env.pop("PYTHONHOME", None)
            _log_path = os.path.join(config.ROOT, "comfy_service.log")
            log = open(_log_path, "a", encoding="utf-8", errors="replace")
            log.write(f"\n===== app start {time.strftime('%Y-%m-%d %H:%M:%S')} =====\n")
            log.flush()
            args = [cfg["python_exe"], "main.py", "--port", str(cfg["port"]),
                    "--listen", cfg["host"], "--disable-auto-launch",
                    "--output-directory", cfg["output_dir"]] + list(cfg.get("comfy_extra_args") or [])
            _proc = subprocess.Popen(args, cwd=cfg["comfy_dir"], env=env,
                                     stdout=log, stderr=subprocess.STDOUT)
    t0 = time.time()
    while time.time() - t0 < wait_seconds:
        alive, ver = comfy_client.is_alive()
        if alive:
            return {"ok": True, "msg": f"服务已启动（v{ver}，{time.time()-t0:.0f}s）"}
        if _proc and _proc.poll() is not None:
            return {"ok": False, "msg": "ComfyUI 启动即退出，请看 comfy_service.log"}
        time.sleep(2)
    return {"ok": False, "msg": f"启动超时（>{wait_seconds}s）"}


def stop():
    global _proc
    if not _proc or _proc.poll() is not None:
        return {"ok": False, "msg": "没有由本应用启动的服务可停止"}
    _proc.terminate()
    try:
        _proc.wait(timeout=20)
    except subprocess.TimeoutExpired:
        _proc.kill()
    _proc = None
    return {"ok": True, "msg": "已停止服务"}


def restart():
    stop()
    time.sleep(2)
    return start()


def tail_log(lines=120):
    if not _log_path or not os.path.exists(_log_path):
        return ""
    import re
    # 日志里带 ANSI 颜色控制码（\x1b[32m[INFO]\x1b[0m），前端不该看到原始转义序列
    ansi = re.compile(r"\x1b\[[0-9;?]*[ -/]*[@-~]")
    with open(_log_path, encoding="utf-8", errors="replace") as f:
        return ansi.sub("", "".join(f.readlines()[-lines:]))
