# -*- coding: utf-8 -*-
"""任务队列（架构书 §5：Job 字段 + 串行执行）"""
import base64
import os
import queue
import random
import threading
import time
import uuid

from . import comfy_client, config, workflows


class Job:
    def __init__(self, kind, **kw):
        self.id = uuid.uuid4().hex[:12]
        self.kind = kind                      # t2i / edit / cutout
        self.prompt = kw.get("prompt", "")
        self.negative = kw.get("negative", "")
        self.width = int(kw.get("width") or 896)
        self.height = int(kw.get("height") or 1152)
        self.steps = int(kw.get("steps") or 25)
        self.cfg = float(kw.get("cfg") or 2.5)
        self.seed = int(kw.get("seed", -1))
        self.refs = kw.get("refs", [])        # 已落盘的 input/ 文件名
        self.subject = kw.get("subject", "")  # 抠图主体描述
        self.status = "pending"               # pending/running/done/error/canceled
        self.progress = 0.0
        self.elapsed = 0.0
        self.outputs = []
        self.error = ""
        self.created = time.time()
        self.prompt_id = None
        self.cancel_requested = False

    def to_dict(self):
        return {
            "id": self.id, "kind": self.kind, "prompt": self.prompt,
            "negative": self.negative, "width": self.width, "height": self.height,
            "steps": self.steps, "cfg": self.cfg, "seed": self.seed,
            "refs": self.refs, "status": self.status, "progress": round(self.progress, 3),
            "elapsed": round(self.elapsed, 1), "outputs": self.outputs,
            "error": self.error, "created": self.created,
        }


class JobQueue:
    """单工作线程串行执行（架构书 §7-1：不并发）"""

    def __init__(self):
        self._q = queue.Queue()
        self._jobs = {}          # id -> Job
        self._order = []         # 最新在前
        self._lock = threading.Lock()
        self._current = None
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()

    # ---------- 对外 ----------
    def submit(self, job: Job):
        with self._lock:
            self._jobs[job.id] = job
            self._order.insert(0, job.id)
            if len(self._order) > 500:
                drop = self._order[500:]
                self._order = self._order[:500]
                for j in drop:
                    self._jobs.pop(j, None)
        self._q.put(job.id)
        return job

    def list(self, limit=100):
        with self._lock:
            return [self._jobs[i].to_dict() for i in self._order[:limit] if i in self._jobs]

    def cancel(self, jid):
        with self._lock:
            j = self._jobs.get(jid)
        if not j:
            return False
        if j.status == "pending":
            j.status = "canceled"
            return True
        if j.status == "running":
            j.cancel_requested = True
            if j.prompt_id:
                try:
                    comfy_client._post_json("/interrupt", {})
                except Exception:
                    pass
            return True
        return False

    def stats(self):
        with self._lock:
            jobs = list(self._jobs.values())
        return {
            "pending": sum(1 for j in jobs if j.status == "pending"),
            "running": sum(1 for j in jobs if j.status == "running"),
            "done": sum(1 for j in jobs if j.status == "done"),
            "error": sum(1 for j in jobs if j.status == "error"),
            "current": self._current,
        }

    # ---------- 内部 ----------
    def _run(self):
        while True:
            jid = self._q.get()
            with self._lock:
                job = self._jobs.get(jid)
            if not job or job.status == "canceled":
                continue
            self._current = job.id
            job.status = "running"
            job.error = ""
            try:
                self._execute(job)
            except Exception as e:
                job.status = "error"
                job.error = str(e)[:800]
            finally:
                job.progress = 1.0 if job.status == "done" else job.progress
                self._current = None

    def _execute(self, job: Job):
        cfg = config.load()
        seed = job.seed
        if seed is None or int(seed) < 0:
            seed = random.randint(1, 2 ** 31 - 1)
        if job.kind == "t2i":
            wf = workflows.build_t2i(job.prompt, job.negative, job.width, job.height,
                                     job.steps, job.cfg, seed)
        elif job.kind == "cutout":
            wf = workflows.build_cutout(job.refs, job.subject, job.steps, seed)
        else:  # edit
            if not job.refs:
                raise RuntimeError("编辑任务缺少参考图")
            wf = workflows.build_edit(job.refs, job.prompt, job.negative, job.steps, seed,
                                      cfg_scale=1.0)
        pid = comfy_client.submit(wf)
        job.prompt_id = pid

        def tick(el):
            job.elapsed = el
            # 粗进度：以 3s/步 + 加载 ~20s 估算（实测 cfg2.5 25步 ≈75s）
            est = 20 + job.steps * 2.2
            job.progress = min(0.97, el / est)

        status, files, err = comfy_client.wait(pid, on_tick=tick)
        if job.cancel_requested and status != "done":
            job.status = "canceled"
            return
        if status != "done":
            job.status = "error"
            job.error = err
            return
        out_dir = cfg["output_dir"]
        job.outputs = [os.path.normpath(os.path.join(out_dir, f)).replace("\\", "/") for f in files]
        job.status = "done"
        job.seed = seed


QUEUE = JobQueue()


def save_refs(refs_b64):
    """前端传来的 data URL / base64 列表 → 写入 ComfyUI input/，返回文件名列表"""
    names = []
    for i, item in enumerate(refs_b64 or [], start=1):
        if not item:
            continue
        data = item.split(",", 1)[1] if item.startswith("data:") else item
        raw = base64.b64decode(data)
        name = f"app_ref_{int(time.time())}_{i}.png"
        names.append(comfy_client.upload_input(name, raw))
    return names
