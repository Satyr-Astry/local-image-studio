# -*- coding: utf-8 -*-
"""绿色包 v0.3 回归验证：UI 瘦身 / 预设通用化 / 预设增改删 / 三功能出图 / D12"""
import base64, json, os, sys, time, urllib.request
from PIL import Image

APP = "http://127.0.0.1:8777"
B = "E:/测试搬运/AI绘画_Qwen21"
ok_all = True


def note(tag, ok, extra=""):
    global ok_all
    ok_all = ok_all and ok
    print(("[PASS] " if ok else "[FAIL] ") + tag + ("  " + extra if extra else ""), flush=True)


def post(p, b):
    r = urllib.request.Request(APP + p, data=json.dumps(b).encode(),
                               headers={"Content-Type": "application/json"})
    return json.loads(urllib.request.urlopen(r, timeout=180).read())


def get(p):
    return json.loads(urllib.request.urlopen(APP + p, timeout=60).read())


def wait_job(jid, limit=420):
    t0 = time.time()
    while time.time() - t0 < limit:
        j = [x for x in get("/api/jobs?limit=30")["jobs"] if x["id"] == jid][0]
        if j["status"] in ("done", "error", "canceled"):
            return j
        time.sleep(4)
    return j


# --- 等引擎 ---
for i in range(60):
    try:
        urllib.request.urlopen("http://127.0.0.1:8188/system_stats", timeout=4).read()
        print(f"引擎就绪（{i*5}s）", flush=True)
        break
    except Exception:
        time.sleep(5)

st = get("/api/status")
note("引擎在线 + 由应用托管", st["alive"] and st["managed_by_app"],
     f"version={st.get('version')} alive={st['alive']} managed={st['managed_by_app']}")

# --- 1) UI 瘦身：不该再有结果预览面板 ---
html = urllib.request.urlopen(APP + "/", timeout=20).read().decode("utf-8")
gone = [x for x in ("最新结果", "编辑结果", "透明 PNG 结果", "col-view", "genResult") if x in html]
note("结果预览面板已删除", not gone, ("残留=" + str(gone)) if gone else "")
has_new = all(x in html for x in ("charAdd", "charEdit", "charDel", "styleAdd", "presetExport", "presetImport"))
note("预设 CRUD + 导入导出 UI 存在", has_new)
js = urllib.request.urlopen(APP + "/app.js", timeout=20).read().decode("utf-8")
note("前端已无 showIn/LAST_SEEN_DONE 冗余", ("showIn(" not in js and "LAST_SEEN_DONE." not in js))

# --- 2) 预设必须通用（不含私货） ---
pr = get("/api/presets")
names = [c["name"] for c in pr["characters"]]
bad = [n for n in names if "a serene mountain lake at sunrise, photorealistic" in n or "常用" in n]
note("默认人物预设通用、无私货", not bad, f"角色={names}")
note("画风/尺寸预设完整", len(pr["styles"]) >= 3 and len(pr["sizes"]) >= 4,
     f"画风={len(pr['styles'])} 尺寸={len(pr['sizes'])}")

# --- 3) 预设增改删（模拟界面操作：整表 POST） ---
pr2 = json.loads(json.dumps(pr))
pr2["characters"].append({"name": "验证：测试角色", "text": "a 30-year-old adult test subject, neutral expression"})
post("/api/presets", pr2)
after = get("/api/presets")
added = any(c["name"] == "验证：测试角色" for c in after["characters"])
on_disk = os.path.exists(os.path.join(B, "app", "presets.json"))
note("预设新增并持久化到包内", added and on_disk, f"落盘={on_disk}")

pr3 = json.loads(json.dumps(after))
pr3["characters"] = [c for c in pr3["characters"] if c["name"] != "验证：测试角色"]
post("/api/presets", pr3)
final = get("/api/presets")
note("预设删除生效", not any(c["name"] == "验证：测试角色" for c in final["characters"]))

# --- 4) 三功能真出图 ---
r = post("/api/jobs", {"kind": "t2i", "prompt": "24-year-old adult woman portrait, short black hair, neutral background, photorealistic",
                       "negative": "", "width": 896, "height": 1152, "steps": 25, "cfg": 2.5, "seed": 4242, "count": 1})
j = wait_job(r["jobs"][0]["id"])
t2i_path = j["outputs"][0] if j["outputs"] else None
note("F1 文生图", j["status"] == "done" and t2i_path, f"{j['status']} {j['elapsed']}s")
note("产物落在包内 output/", bool(t2i_path) and t2i_path.replace("\\", "/").startswith(B + "/output"), str(t2i_path))

if t2i_path and os.path.exists(t2i_path):
    b64 = "data:image/png;base64," + base64.b64encode(open(t2i_path, "rb").read()).decode()
    r = post("/api/jobs", {"kind": "edit", "prompt": "change her jacket to a red jacket, keep face and background identical",
                           "negative": "", "refs_b64": [b64], "steps": 25, "cfg": 2.5, "seed": 4243, "count": 1})
    je = wait_job(r["jobs"][0]["id"])
    note("F2 图像编辑（D12 修复后不再卡死）", je["status"] == "done",
         f"{je['status']} {je['elapsed']}s err={je.get('error','')[:120]}")
    if je["outputs"]:
        im = Image.open(je["outputs"][0])
        note("编辑输出尺寸跟参考图（896×1152）", im.size == (896, 1152), str(im.size))

    r = post("/api/jobs", {"kind": "cutout", "prompt": "", "subject": "woman",
                           "refs_b64": [b64], "steps": 25, "cfg": 1.0, "seed": 4244, "count": 1})
    jc = wait_job(r["jobs"][0]["id"])
    note("F3 抠图/透明", jc["status"] == "done", f"{jc['status']} {jc['elapsed']}s err={jc.get('error','')[:120]}")
    if jc["outputs"]:
        im = Image.open(jc["outputs"][0])
        a = im.getchannel("A") if im.mode == "RGBA" else None
        tr = (sum(1 for p in a.getdata() if p < 16) / len(a.getdata()) * 100) if a else 0
        note("抠图输出为 RGBA 且带透明区", im.mode == "RGBA" and tr > 5, f"mode={im.mode} 透明={tr:.1f}%")

# --- 5) 死接口应已删除 ---
import urllib.error
try:
    urllib.request.urlopen(APP + "/api/jobs/abcdef", timeout=10)
    note("死接口 /api/jobs/{id} 已删除", False, "仍可访问")
except urllib.error.HTTPError as e:
    note("死接口 /api/jobs/{id} 已删除", e.code in (404, 403), f"HTTP {e.code}")
except Exception as e:
    note("死接口 /api/jobs/{id} 已删除", False, str(e))

print("\n===== 总结论: " + ("全部通过 ✅" if ok_all else "有失败项 ❌") + " =====")
print("包内 output 文件:", sorted(os.listdir(os.path.join(B, "output"))))
