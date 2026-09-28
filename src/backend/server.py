# -*- coding: utf-8 -*-
"""stdlib HTTP 服务：REST API + 静态文件（架构书 §4）"""
import json
import mimetypes
import os
import sys
import threading
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

if __package__ in (None, ""):           # 支持 python server.py 直接跑
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    from backend import comfy_client, config, jobs, presets, service
    from backend.jobs import Job, QUEUE
else:
    from . import comfy_client, config, jobs, presets, service
    from .jobs import Job, QUEUE

MAX_BODY = 64 * 1024 * 1024


def _gallery(limit=240):
    out = config.paths()["output_dir"]
    exts = (".png", ".jpg", ".jpeg", ".webp")
    found = []
    for root, _dirs, files in os.walk(out):
        for fn in files:
            if fn.lower().endswith(exts):
                p = os.path.join(root, fn)
                try:
                    found.append((os.path.getmtime(p), p))
                except OSError:
                    pass
    found.sort(reverse=True)
    return [{"path": p, "name": os.path.basename(p), "mtime": m, "size": os.path.getsize(p)}
            for m, p in found[:limit]]


def _safe_path(p):
    """只允许 output_dir / input_dir 下的文件（架构书 §7-5）"""
    pl = config.paths()
    rp = os.path.realpath(p)
    for base in (pl["output_dir"], pl["input_dir"]):
        if rp == os.path.realpath(base) or rp.startswith(os.path.realpath(base) + os.sep):
            return rp
    return None


class Handler(BaseHTTPRequestHandler):
    server_version = "Qwen21App/0.1"

    # ---------- 工具 ----------
    def _json(self, obj, code=200):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _body(self):
        n = int(self.headers.get("Content-Length") or 0)
        if n <= 0:
            return {}
        if n > MAX_BODY:
            raise ValueError("请求体过大")
        return json.loads(self.rfile.read(n).decode("utf-8"))

    def _file(self, path, download=False):
        if not os.path.isfile(path):
            return self._json({"error": "文件不存在"}, 404)
        ctype = mimetypes.guess_type(path)[0] or "application/octet-stream"
        size = os.path.getsize(path)
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(size))
        self.send_header("Cache-Control", "no-store")
        if download:
            self.send_header("Content-Disposition",
                             f'attachment; filename="{os.path.basename(path)}"')
        self.end_headers()
        with open(path, "rb") as f:
            while True:
                chunk = f.read(256 * 1024)
                if not chunk:
                    break
                self.wfile.write(chunk)

    def log_message(self, fmt, *args):   # 安静点
        if os.environ.get("QWEN21_DEBUG"):
            sys.stderr.write("[%s] %s\n" % (self.log_date_time_string(), fmt % args))

    # ---------- 路由 ----------
    def do_GET(self):
        u = urllib.parse.urlparse(self.path)
        path, q = u.path, urllib.parse.parse_qs(u.query)
        try:
            if path == "/api/status":
                st = service.status()
                st["models"] = config.load()["models"]
                st["queue"] = QUEUE.stats()
                return self._json(st)
            if path == "/api/presets":
                return self._json(presets.load())
            if path == "/api/jobs":
                return self._json({"jobs": QUEUE.list(int(q.get("limit", ["100"])[0])),
                                   "stats": QUEUE.stats()})
            if path == "/api/gallery":
                return self._json({"images": _gallery()})
            if path == "/api/log":
                return self._json({"log": service.tail_log()})
            if path == "/api/image":
                p = q.get("p", [""])[0]
                safe = _safe_path(p)
                if not safe:
                    return self._json({"error": "路径不允许"}, 403)
                return self._file(safe)
            if path.startswith("/api/download"):
                p = q.get("p", [""])[0]
                safe = _safe_path(p)
                if not safe:
                    return self._json({"error": "路径不允许"}, 403)
                return self._file(safe, download=True)
            if path == "/api/config":
                return self._json(config.load())
            return self._static(path)
        except Exception as e:
            return self._json({"error": str(e)[:500]}, 500)

    def do_POST(self):
        path = urllib.parse.urlparse(self.path).path
        try:
            if path == "/api/jobs":
                b = self._body()
                refs = jobs.save_refs(b.get("refs_b64") or [])
                d = config.load()["defaults"]
                job = Job(b.get("kind", "t2i"),
                          prompt=b.get("prompt", ""),
                          negative=b.get("negative", d.get("negative", "")),
                          width=b.get("width", d["width"]),
                          height=b.get("height", d["height"]),
                          steps=b.get("steps", d["steps"]),
                          cfg=b.get("cfg", d["cfg"]),
                          seed=b.get("seed", -1),
                          subject=b.get("subject", ""),
                          refs=refs or b.get("refs") or [])
                # 批量：count 个不同种子
                made = [QUEUE.submit(job)]
                for _ in range(max(0, int(b.get("count", 1)) - 1)):
                    j2 = Job(job.kind, prompt=job.prompt, negative=job.negative, width=job.width,
                             height=job.height, steps=job.steps, cfg=job.cfg, seed=-1,
                             subject=job.subject, refs=job.refs)
                    made.append(QUEUE.submit(j2))
                return self._json({"ok": True, "jobs": [j.to_dict() for j in made]})
            if path.startswith("/api/jobs/") and path.endswith("/cancel"):
                jid = path.split("/")[3]
                return self._json({"ok": QUEUE.cancel(jid)})
            if path == "/api/presets":
                return self._json(presets.save(self._body()))
            if path == "/api/config":
                return self._json(config.save(self._body()))
            if path.startswith("/api/service/"):
                act = path.rsplit("/", 1)[-1]
                if act == "start":
                    return self._json(service.start())
                if act == "stop":
                    return self._json(service.stop())
                if act == "restart":
                    return self._json(service.restart())
            if path == "/api/open_folder":
                b = self._body()
                target = _safe_path(b.get("path") or config.paths()["output_dir"])
                if not target:
                    return self._json({"error": "路径不允许"}, 403)
                import subprocess
                subprocess.Popen(["explorer.exe", os.path.dirname(target)
                                  if os.path.isfile(target) else target])
                return self._json({"ok": True})
            return self._json({"error": "未知接口"}, 404)
        except Exception as e:
            return self._json({"error": str(e)[:500]}, 500)

    # ---------- 静态 ----------
    def _static(self, path):
        if path in ("/", ""):
            path = "/index.html"
        rel = path.lstrip("/")
        full = os.path.join(config.WEB_DIR, rel)
        if not os.path.realpath(full).startswith(os.path.realpath(config.WEB_DIR)):
            return self._json({"error": "非法路径"}, 403)
        if not os.path.isfile(full):
            return self._json({"error": "not found"}, 404)
        return self._file(full)


def main():
    cfg = config.load()
    port = int(os.environ.get("QWEN21_WEB_PORT", cfg["web_port"]))
    if cfg.get("autostart_service"):
        st = service.status()
        if not st["alive"]:
            print("[app] ComfyUI 未运行，尝试拉起…")
            print("[app]", service.start().get("msg"))
    srv = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print(f"[app] Qwen-Image-2.1 应用已启动: http://127.0.0.1:{port}")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
