/* Qwen-Image-2.1 应用前端 —— 无构建，纯 vanilla
   v0.3：① 三个功能页不再有结果预览面板（结果只在队列/画廊看）
         ② 预设可在界面内直接增改删（弹窗）+ 导入/导出
         ③ 删掉 showIn / LAST_SEEN_DONE / checker 等冗余逻辑 */
const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);
let PRESETS = { characters: [], styles: [], sizes: [] };
let CONFIG = {};
const KINDS = { t2i: "文生图", edit: "编辑", cutout: "抠图" };
const STATUS_CN = { pending: "排队中", running: "运行中", done: "完成", error: "失败", canceled: "已取消" };

/* ---------------- 工具 ---------------- */
const imgUrl = (p) => "/api/image?p=" + encodeURIComponent(p);
async function api(path, opt) {
  const r = await fetch(path, opt);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || ("HTTP " + r.status));
  return j;
}
const post = (p, body) => api(p, {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {})
});
function fillSelect(el, items, keep) {
  const cur = keep ? el.value : null;
  el.innerHTML = "";
  (items || []).forEach((it, i) => {
    const o = document.createElement("option");
    o.value = i;
    o.textContent = it.name || ("#" + i);
    el.appendChild(o);
  });
  if (cur !== null && cur !== "" && +cur < (items || []).length) el.value = cur;
}

/* ---------------- 导航 ---------------- */
function go(page) {
  $$(".navbtn").forEach(b => b.classList.toggle("active", b.dataset.page === page));
  $$(".page").forEach(s => s.classList.toggle("hidden", s.id !== "page-" + page));
  if (page === "gallery") loadGallery();
  if (page === "settings") loadSettings();
}
$$(".navbtn").forEach(b => b.onclick = () => go(b.dataset.page));

/* ---------------- 服务状态 ---------------- */
async function pollStatus() {
  try {
    const s = await api("/api/status");
    $("#svcDot").className = "dot" + (s.alive ? " on" : "");
    // 引擎已在线时，「启动」按钮置灰（避免语义矛盾：在线还显示"启动"）
    ["#sbStart", "#svcStart"].forEach((sel) => { const b = $(sel); if (b) b.disabled = !!s.alive; });
    $("#svcTxt").innerHTML = s.alive
      ? `ComfyUI 在线 v${s.version}<br>排队 ${s.queue.pending} / 运行 ${s.queue.running}`
      : "ComfyUI 离线<br>点「启动」拉起";
  } catch (e) {
    $("#svcDot").className = "dot";
    $("#svcTxt").textContent = "后端无响应：" + e.message;
  }
}
async function svcAct(act) {
  $("#svcTxt").textContent = "处理中…";
  try {
    const r = await post("/api/service/" + act, {});
    $("#svcTxt").textContent = r.msg || (r.ok ? "OK" : "失败");
  } catch (e) { $("#svcTxt").textContent = "失败：" + e.message; }
  pollStatus();
}

/* ---------------- 提示词合成 ---------------- */
function compose() {
  const ch = PRESETS.characters[+$("#genChar").value] || { text: "" };
  const st = PRESETS.styles[+$("#genStyle").value] || { pre: "", post: "" };
  const body = $("#genPrompt").value.trim();
  const parts = [st.pre || "", ch.text || "", body].filter(Boolean).join(", ");
  const prompt = (parts + (st.post || "")).trim();
  $("#genPreview").textContent = prompt || "（空）";
  return prompt;
}
$("#genChar").onchange = compose;
$("#genStyle").onchange = compose;
$("#genPrompt").addEventListener("input", compose);

/* ---------------- 生成 ---------------- */
$("#genGo").onclick = async () => {
  const sz = PRESETS.sizes[+$("#genSize").value] || { w: 896, h: 1152 };
  const prompt = compose();
  if (!prompt) return alert("请先填画面描述");
  $("#genGo").disabled = true; $("#genGo").textContent = "已提交…";
  try {
    await post("/api/jobs", {
      kind: "t2i", prompt, negative: $("#genNeg").value,
      width: sz.w, height: sz.h, steps: +$("#genSteps").value, cfg: +$("#genCfg").value,
      seed: +$("#genSeed").value, count: +$("#genCount").value
    });
    go("queue");
  } catch (e) { alert("提交失败：" + e.message); }
  $("#genGo").disabled = false; $("#genGo").textContent = "开始生成";
};

/* ---------------- 参考图（编辑 / 抠图） ---------------- */
const refBuf = { edit: [], cut: [] };
function bindRefs(inputSel, thumbSel, key, max) {
  const inp = $(inputSel), box = $(thumbSel);
  inp.onchange = async () => {
    const files = Array.from(inp.files || []).slice(0, max);
    refBuf[key] = [];
    box.innerHTML = "";
    for (const f of files) {
      const url = await new Promise(res => {
        const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(f);
      });
      refBuf[key].push(url);
      const im = document.createElement("img"); im.src = url; box.appendChild(im);
    }
  };
}
bindRefs("#editFiles", "#editThumbs", "edit", 10);
bindRefs("#cutFiles", "#cutThumbs", "cut", 1);

$("#editGo").onclick = async () => {
  if (!refBuf.edit.length) return alert("请先选参考图");
  $("#editGo").disabled = true;
  try {
    await post("/api/jobs", {
      kind: "edit", prompt: $("#editPrompt").value, negative: "",
      steps: +$("#editSteps").value, seed: +$("#editSeed").value,
      refs_b64: refBuf.edit, count: 1
    });
    go("queue");
  } catch (e) { alert("提交失败：" + e.message); }
  $("#editGo").disabled = false;
};

$("#cutGo").onclick = async () => {
  if (!refBuf.cut.length) return alert("请先选原图");
  $("#cutGo").disabled = true;
  try {
    await post("/api/jobs", {
      kind: "cutout", prompt: "", subject: $("#cutSubject").value,
      steps: +$("#cutSteps").value, seed: +$("#cutSeed").value,
      refs_b64: refBuf.cut, count: 1
    });
    go("queue");
  } catch (e) { alert("提交失败：" + e.message); }
  $("#cutGo").disabled = false;
};

/* ---------------- 队列 ---------------- */
async function pollJobs() {
  let d;
  try { d = await api("/api/jobs?limit=40"); } catch (e) { return; }
  $("#qStat").textContent =
    `待 ${d.stats.pending} · 运行 ${d.stats.running} · 完成 ${d.stats.done} · 失败 ${d.stats.error}`;
  $("#jobList").innerHTML = d.jobs.map(j => {
    const thumb = j.outputs && j.outputs.length
      ? `<img class="thumb" src="${imgUrl(j.outputs[j.outputs.length - 1])}">`
      : `<div class="thumb"></div>`;
    const pct = Math.round((j.progress || 0) * 100);
    return `<div class="job">
      ${thumb}
      <div class="meta">
        <div class="jline"><span class="tag ${j.status}">${STATUS_CN[j.status] || j.status}</span>
          <b>${KINDS[j.kind] || j.kind}</b>
          <span class="stat">#${j.id} · ${j.elapsed || 0}s · seed ${j.seed}${j.status === "running" ? " · " + pct + "%" : ""}</span></div>
        <div class="p">${(j.prompt || j.subject || "").slice(0, 160)}</div>
        ${j.status === "running" ? `<div class="bar"><i style="width:${pct}%"></i></div>` : ""}
        ${j.error ? `<div class="p" style="color:var(--err)">${j.error.slice(0, 300)}</div>` : ""}
      </div>
      <div class="jbtn">
        ${j.outputs && j.outputs.length ? `<button class="mini" onclick="openBig('${j.outputs[j.outputs.length - 1]}')">查看</button>` : ""}
        ${j.status === "pending" || j.status === "running"
          ? `<button class="mini" onclick="cancelJob('${j.id}')">取消</button>` : ""}
      </div></div>`;
  }).join("") || `
    <div class="empty">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>
      <b>队列为空</b>
      <span>提交任务后，出图进度、耗时和结果都会显示在这里</span>
      <button class="mini big" onclick="go('gen')">去生成一张</button>
    </div>`;
}
async function cancelJob(id) { await post(`/api/jobs/${id}/cancel`, {}); pollJobs(); }

/* ---------------- 画廊 / 大图 ---------------- */
async function loadGallery() {
  const d = await api("/api/gallery");
  $("#gallery").innerHTML = d.images.map(im => `
    <div class="cell" onclick="openBig('${im.path.replace(/\\/g, "\\\\")}')">
      <img loading="lazy" src="${imgUrl(im.path)}">
      <div class="nm">${im.name}</div>
    </div>`).join("") || `
    <div class="empty" style="grid-column:1/-1">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="3" y="4" width="18" height="16" rx="3"/><path d="M3 15l5-4 4 3 3-2 6 5"/></svg>
      <b>还没有输出</b>
      <span>生成的图会自动收进画廊，点开可以看大图、下载或打开所在目录</span>
      <button class="mini big" onclick="go('gen')">去生成一张</button>
    </div>`;
}
function openBig(p) {
  let m = $("#modal");
  if (!m) {
    m = document.createElement("div"); m.id = "modal";
    m.innerHTML = `<img id="modalImg"><div class="bar2">
      <button class="mini" onclick="dl()">下载</button>
      <button class="mini" onclick="openFolder()">打开目录</button>
      <button class="mini" onclick="document.getElementById('modal').style.display='none'">关闭</button>
    </div>`;
    document.body.appendChild(m);
    m.onclick = e => { if (e.target === m) m.style.display = "none"; };
  }
  m.dataset.path = p;
  $("#modalImg").src = imgUrl(p);
  m.style.display = "flex";
}
function dl() {
  const p = $("#modal").dataset.path;
  location.href = "/api/download?p=" + encodeURIComponent(p);
}
async function openFolder() {
  const p = ($("#modal") && $("#modal").dataset.path) || "";
  await post("/api/open_folder", { path: p });
}

/* ---------------- 设置 ---------------- */
async function loadSettings() {
  CONFIG = await api("/api/config");
  $("#cfgHost").value = CONFIG.host; $("#cfgPort").value = CONFIG.port;
  $("#cfgDir").value = CONFIG.comfy_dir; $("#cfgPy").value = CONFIG.python_exe;
  $("#cfgOut").value = CONFIG.output_dir;
  $("#cfgUnet").value = CONFIG.models.unet; $("#cfgClip").value = CONFIG.models.clip;
  $("#cfgVae").value = CONFIG.models.vae;
  try { $("#svcLog").textContent = (await api("/api/log")).log || "（无日志）"; } catch (e) {}
}
$("#cfgSave").onclick = async () => {
  await post("/api/config", {
    host: $("#cfgHost").value, port: +$("#cfgPort").value, comfy_dir: $("#cfgDir").value,
    python_exe: $("#cfgPy").value, output_dir: $("#cfgOut").value,
    models: { unet: $("#cfgUnet").value, clip: $("#cfgClip").value, vae: $("#cfgVae").value }
  });
  alert("已保存（部分设置需重启应用生效）");
};

/* ---------------- 预设 CRUD（v0.3） ---------------- */
let pCtx = { kind: "characters", index: -1 };
const PICK = { characters: "#genChar", styles: "#genStyle" };

function openPreset(kind, index = -1) {
  pCtx = { kind, index };
  const pair = kind === "styles";
  const it = index >= 0 ? (PRESETS[kind][index] || {}) : {};
  $("#pTitle").textContent = (index >= 0 ? "编辑" : "新增") + (pair ? "画风预设" : "人物预设");
  $("#pName").value = it.name || "";
  $("#pText").value = it.text || "";
  $("#pPre").value = it.pre || "";
  $("#pPost").value = it.post || "";
  $("#pSingle").style.display = pair ? "none" : "block";
  $("#pPair").style.display = pair ? "block" : "none";
  $("#pmask").style.display = "grid";        // 用 grid（place-items 双轴居中）；flex 下 justify-items 无效（D14）
  $("#pName").focus();
}
function closePreset() { $("#pmask").style.display = "none"; }

async function savePreset() {
  const { kind, index } = pCtx;
  const pair = kind === "styles";
  const name = $("#pName").value.trim();
  if (!name) return alert("请填写名称");
  const item = pair
    ? { name, pre: $("#pPre").value, post: $("#pPost").value }
    : { name, text: $("#pText").value.trim() };
  const arr = PRESETS[kind] = PRESETS[kind] || [];
  if (index >= 0) arr[index] = item; else arr.push(item);
  try {
    await post("/api/presets", PRESETS);
    closePreset();
    initSelects();
    const sel = $(PICK[kind]);
    sel.value = index >= 0 ? index : arr.length - 1;
    renderCombos();
    compose();
  } catch (e) { alert("保存失败：" + e.message); }
}

async function deletePreset(kind, index) {
  const arr = PRESETS[kind] || [];
  if (!arr.length) return;
  const i = Number.isInteger(index) ? index : +$(PICK[kind]).value;
  const cur = arr[i] || {};
  if (!confirm(`确定删除${kind === "styles" ? "画风" : "人物"}预设「${cur.name || ""}」？`)) return;
  arr.splice(i, 1);
  if (!arr.length) {
    arr.push(kind === "styles" ? { name: "无（纯提示词）", pre: "", post: "" }
                               : { name: "（空白）", text: "" });
  }
  try {
    await post("/api/presets", PRESETS);
    initSelects();
    renderCombos();
    compose();
  } catch (e) { alert("删除失败：" + e.message); }
}

/* ---- 预设组合框：在列表里直接 选 / 改 / 删 / 新增（v0.5.4，替代原来的 ＋/编辑/删除 三按钮）---- */
const COMBOS = {
  characters: { combo: "#charCombo", field: "#charField", list: "#charList", label: "#charLabel", sel: "#genChar" },
  styles: { combo: "#styleCombo", field: "#styleField", list: "#styleList", label: "#styleLabel", sel: "#genStyle" },
};
function comboIndex(kind) { return Math.max(0, +$(COMBOS[kind].sel).value || 0); }
function closeCombos() { Object.values(COMBOS).forEach((c) => $(c.combo).classList.remove("open")); }

function renderCombos() {
  Object.keys(COMBOS).forEach((kind) => {
    const c = COMBOS[kind], arr = PRESETS[kind] || [];
    const i = Math.min(comboIndex(kind), Math.max(0, arr.length - 1));
    const cur = arr[i] || {};
    $(c.label).textContent = cur.name || "（未选择）";
    $(c.list).innerHTML = arr.map((it, idx) => {
      // 「（空白）」是占位项，不给编辑/删除入口
      const isBlank = !it.name || /^（空白）$/.test(it.name);
      const ops = isBlank ? "" : `
        <span class="ops">
          <button class="combo-op" data-act="edit" title="编辑这个预设">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><path d="M4 20h4l10-10-4-4L4 16v4z"/><path d="M14 6l4 4"/></svg>
          </button>
          <button class="combo-op del" data-act="del" title="删除这个预设">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><path d="M6 6l12 12M18 6L6 18"/></svg>
          </button>
        </span>`;
      return `
      <div class="combo-item${idx === i ? " on" : ""}" data-kind="${kind}" data-i="${idx}">
        <span class="nm">${it.name || "#" + idx}</span>${ops}
      </div>`;
    }).join("") + `
      <div class="combo-add">
        <button data-act="add" data-kind="${kind}">＋ 新增${kind === "styles" ? "画风" : "人物"}预设…</button>
      </div>`;
  });
}

Object.keys(COMBOS).forEach((kind) => {
  const c = COMBOS[kind];
  $(c.field).onclick = (e) => {
    e.stopPropagation();
    const isOpen = $(c.combo).classList.contains("open");
    closeCombos();
    if (!isOpen) $(c.combo).classList.add("open");
  };
  $(c.list).addEventListener("click", async (e) => {
    const op = e.target.closest("[data-act]");
    const item = e.target.closest(".combo-item");
    const idx = item ? +item.dataset.i : -1;
    if (!op) {                       // 点行 = 选用这个预设
      if (idx >= 0) { $(c.sel).value = idx; closeCombos(); renderCombos(); compose(); }
      return;
    }
    if (op.dataset.act === "edit") { closeCombos(); openPreset(kind, idx); }
    else if (op.dataset.act === "del") { closeCombos(); await deletePreset(kind, idx); }
    else if (op.dataset.act === "add") { closeCombos(); openPreset(kind, -1); }
  });
});
document.addEventListener("click", closeCombos);
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeCombos(); });

$("#pOk").onclick = savePreset;
$("#pCancel").onclick = closePreset;
$("#pmask").onclick = e => { if (e.target.id === "pmask") closePreset(); };

/* 预设导入 / 导出 */
$("#presetExport").onclick = () => {
  const blob = new Blob([JSON.stringify(PRESETS, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "qwen21_presets.json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
};
$("#presetImportBtn").onclick = () => $("#presetImport").click();
$("#presetImport").onchange = async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    if (!data || (!Array.isArray(data.characters) && !Array.isArray(data.styles))) {
      throw new Error("文件格式不对（需要含 characters 或 styles 数组）");
    }
    PRESETS = {
      characters: data.characters || [],
      styles: data.styles || [],
      sizes: PRESETS.sizes
    };
    await post("/api/presets", PRESETS);
    initSelects();
    alert("预设已导入");
  } catch (err) { alert("导入失败：" + err.message); }
  e.target.value = "";
};

/* ---------------- 启动 ---------------- */
function initSelects() {
  fillSelect($("#genChar"), PRESETS.characters, true);
  fillSelect($("#genStyle"), PRESETS.styles, true);
  fillSelect($("#genSize"), PRESETS.sizes, true);
  const d = CONFIG.defaults || {};
  if (!$("#genNeg").value) $("#genNeg").value = d.negative || "";
  if (d.steps) $("#genSteps").value = d.steps;
  if (d.cfg) $("#genCfg").value = d.cfg;
  renderCombos();
  compose();
}
(async function main() {
  PRESETS = await api("/api/presets");
  CONFIG = await api("/api/config");
  initSelects();
  pollStatus(); pollJobs();
  setInterval(pollStatus, 5000);
  setInterval(pollJobs, 2000);
})();
