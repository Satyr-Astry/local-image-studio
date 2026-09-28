/* Local Image Studio 桌面版外壳（Electron）
 * 便携设计：ROOT 由 exe 位置推导（整包可改名/搬盘）；userData 落在 <ROOT>\data\desktop，不污染目标机。
 * 后端按需拉起：先探测 8777，已有后端就直接连（绝不重复拉起，避免幽灵双实例分流请求）。
 */
'use strict';
const { app, BrowserWindow, Menu, dialog, shell, screen } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');

const DESKTOP_DIR = path.dirname(process.execPath);
const ROOT = path.resolve(DESKTOP_DIR, '..');
const SMOKE = process.argv.includes('--smoke');
const CLOSETEST = process.argv.includes('--closetest');
const AUDIT = process.argv.includes('--uiaudit');       // 逐页截图做视觉审计
const SPLASHSHOT = process.argv.includes('--splashshot'); // 采集启动进度条截图后退出（自检用）
const PORT = 8777;
const APP_URL = `http://127.0.0.1:${PORT}`;
const READY_TIMEOUT_MS = 240000;
const RESP_WIDTHS = [900, 1280, 1920];   // 自适应自检用的三档宽度

app.setPath('userData', path.join(ROOT, 'data', 'desktop'));
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');

let win = null, splash = null, child = null, ownBackend = false, failed = false;
app.isQuitting = false;

function log(s) {
  const line = `[${new Date().toISOString().slice(11, 19)}] ${s}`;
  process.stdout.write(line + '\n');
  try {
    const dir = path.join(ROOT, 'data');
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, 'desktop.log'), line + '\n');
  } catch (e) { /* 日志失败不影响运行 */ }
}

/* ---------------- 后端探测 / 拉起 ---------------- */
function pingAsync() {
  return new Promise((resolve) => {
    const req = http.get(APP_URL + '/api/status', { timeout: 2500 }, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

function startBackend() {
  const py = path.join(ROOT, 'runtime', 'python.exe');
  const boot = path.join(ROOT, 'app', 'bootstrap.py');
  if (!fs.existsSync(py)) throw new Error('缺少运行时：' + py);
  if (!fs.existsSync(boot)) throw new Error('缺少启动脚本：' + boot);
  const env = Object.assign({}, process.env, {
    QWEN21_NO_BROWSER: '1',
    PYTHONUNBUFFERED: '1',       // 否则 stdout 块缓冲，启动阶段日志要攒 8KB 才吐（进度条卡住）
    PYTHONIOENCODING: 'utf-8'    // 否则中文按 GBK 输出 → 日志乱码 + 进度条阶段匹配全失败（.bat 启动时必现）
  });
  delete env.PYTHONPATH;
  delete env.PYTHONHOME;
  log('拉起包内后端：' + py);
  child = spawn(py, [boot], { cwd: ROOT, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  ownBackend = true;
  child.stdout.on('data', (d) => {
    const text = String(d);
    log('[py] ' + text.trim());
    // 用后端日志推进真实启动阶段（架构书 §14.1 启动进度反馈）
    if (text.includes('[自检]')) { SP.parsed = true; spSet('① 检测显卡与运行环境', 14, text.trim(), 22); }
    if (text.includes('尝试拉起')) { SP.parsed = true; spSet('② 启动 AI 引擎（ComfyUI）', 26, '正在加载模型，首次约 20~60 秒', 64); }
    if (text.includes('服务已启动')) { SP.parsed = true; spSet('③ AI 引擎就绪', 74, text.trim(), 80); }
    if (text.includes('应用已启动')) { SP.parsed = true; spSet('④ 启动本地服务', 88, '', 94); }
  });
  child.stderr.on('data', (d) => log('[py!] ' + String(d).trim()));
  child.on('exit', (code) => {
    log('后端进程退出 code=' + code);
    const wasOwn = ownBackend;
    child = null;
    ownBackend = false;
    if (wasOwn && !failed && !app.isQuitting) {
      fail('本地后端意外退出（code ' + code + '）。详情见包内 data\\desktop.log');
    }
  });
}

function stopBackend() {
  if (!child || !ownBackend) return;
  log('关闭自己拉起的后端（进程树）');
  try {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
  } catch (e) { /* ignore */ }
  child = null;
  ownBackend = false;
}

function writeSmoke(obj) {
  if (!SMOKE) return;
  try {
    fs.writeFileSync(path.join(ROOT, 'smoke-result.json'),
      JSON.stringify(Object.assign({ ts: Date.now() }, obj), null, 1));
  } catch (e) { /* ignore */ }
}

function fail(msg) {
  if (failed) return;
  failed = true;
  log('FAIL: ' + msg);
  if (splash && !splash.isDestroyed()) { try { splash.destroy(); } catch (e) { /* ignore */ } splash = null; }
  try { dialog.showErrorBox('Local Image Studio 启动失败', msg); } catch (e) { /* headless */ }
  stopBackend();
  writeSmoke({ ok: false, error: msg });
  app.exit(1);
}

/* ---------------- 界面 ---------------- */
/* ---------- 启动进度（真实阶段，不是假动画）---------- */
const SP = { stage: '正在初始化…', note: '首次启动需 20~60 秒（要加载 AI 引擎）', pct: 5, cap: 66, t0: Date.now(), parsed: false };

function spRender() {
  if (!splash || splash.isDestroyed()) return;
  const elapsed = Math.round((Date.now() - SP.t0) / 1000);
  const js = `(() => {
    const s = document.getElementById('stage'), f = document.getElementById('fill'),
          p = document.getElementById('pct'), n = document.getElementById('note'), e = document.getElementById('el');
    if (s) s.textContent = ${JSON.stringify(SP.stage)};
    if (f) f.style.width = ${JSON.stringify(Math.round(SP.pct) + '%')};
    if (p) p.textContent = ${JSON.stringify(Math.round(SP.pct) + '%')};
    if (n) n.textContent = ${JSON.stringify(SP.note)};
    if (e) e.textContent = ${JSON.stringify('已用 ' + elapsed + 's')};
  })()`;
  splash.webContents.executeJavaScript(js).catch(() => { /* 窗口可能正在关闭 */ });
}

function spSet(stage, pct, note, cap) {
  if (stage) SP.stage = stage;
  if (pct != null) SP.pct = Math.max(SP.pct, pct);
  if (note != null) SP.note = note;
  if (cap != null) SP.cap = cap;
  spRender();
}

function makeSplash() {
  splash = new BrowserWindow({
    width: 480, height: 268, frame: false, resizable: false, center: true,
    alwaysOnTop: true, skipTaskbar: true, backgroundColor: '#0b0d13'
  });
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{height:100vh;color:#eef1f6;font:14px/1.6 'Microsoft YaHei UI','Segoe UI',sans-serif;
    background:radial-gradient(620px 420px at 18% -12%,rgba(124,92,255,.22),transparent 60%),
               radial-gradient(520px 320px at 100% 0%,rgba(34,211,238,.16),transparent 55%),#0b0d13;
    display:flex;flex-direction:column;justify-content:center;padding:24px 26px}
  .row{display:flex;align-items:center;gap:12px}
  .mark{width:38px;height:38px;border-radius:12px;display:grid;place-items:center;font-weight:800;font-size:14px;
    background:linear-gradient(140deg,#7c5cff,#22d3ee);box-shadow:0 8px 22px rgba(124,92,255,.35)}
  .name{font-size:16px;font-weight:700}
  .sub{font-size:11.5px;color:#78839a;margin-top:1px}
  .stage{margin-top:18px;font-size:13px;color:#cdd5e4}
  .bar{margin-top:9px;height:6px;border-radius:4px;background:rgba(255,255,255,.08);overflow:hidden}
  .bar>i{display:block;height:100%;width:5%;border-radius:4px;
    background:linear-gradient(90deg,#7c5cff,#22d3ee);transition:width .45s ease}
  .meta{margin-top:7px;display:flex;justify-content:space-between;font-size:11.5px;color:#78839a}
  .note{margin-top:7px;font-size:11.5px;color:#6b7488;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  </style></head><body>
  <div class="row"><div class="mark">Q</div>
    <div><div class="name">Local Image Studio</div><div class="sub">本地绘画工作台 · 正在启动（内置 Qwen-Image-2.1 引擎）</div></div></div>
  <div class="stage" id="stage">正在初始化…</div>
  <div class="bar"><i id="fill"></i></div>
  <div class="meta"><span id="pct">5%</span><span id="el">已用 0s</span></div>
  <div class="note" id="note">首次启动需 20~60 秒（要加载 AI 引擎）</div>
  </body></html>`;
  splash.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  // 进度条：在阶段上限内随时间平滑推进（阶段由后端日志推进，见 startBackend）
  const tick = setInterval(() => {
    if (!splash || splash.isDestroyed()) { clearInterval(tick); return; }
    if (SP.pct < SP.cap) SP.pct = Math.min(SP.cap, SP.pct + 1.1);
    // 兜底：若 6 秒后仍没解析到后端日志（比如日志措辞变了），按时间推进到引擎阶段
    if (!SP.parsed && Date.now() - SP.t0 > 6000 && SP.stage === '正在初始化…') {
      spSet('② 启动 AI 引擎（ComfyUI）', 26, '正在加载模型，首次约 20~60 秒', 64);
    }
    spRender();
  }, 600);
  SP.t0 = Date.now();
  setTimeout(spRender, 150);
  if (SPLASHSHOT) {                                   // 采集启动画面截图（自检取证）
    setTimeout(async () => {
      try { fs.writeFileSync(path.join(ROOT, 'splash-1.png'), (await splash.webContents.capturePage()).toPNG()); } catch (e) { /* ignore */ }
    }, 4000);
    setTimeout(async () => {
      try { fs.writeFileSync(path.join(ROOT, 'splash-2.png'), (await splash.webContents.capturePage()).toPNG());
            log('SPLASH 截图已保存');
      } catch (e) { /* ignore */ }
    }, 12000);
    setTimeout(() => { stopBackend(); app.exit(0); }, 15000);
  }
}

function createWindow() {
  // 默认用"舒适窗口"（不强制最大化）——最大化会让内容显得被大片空白包围；
  // 只有屏幕本身太矮（工作区 <820px）时才最大化，保证主按钮仍在首屏
  const wa = screen.getPrimaryDisplay().workAreaSize;
  const target = {
    width: Math.min(1440, Math.max(1024, wa.width - 140)),
    height: Math.min(920, Math.max(680, wa.height - 140))
  };
  win = new BrowserWindow({
    width: target.width, height: target.height,
    minWidth: 720, minHeight: 600,
    title: 'Local Image Studio', backgroundColor: '#14161a',
    autoHideMenuBar: true, show: false,
    icon: path.join(DESKTOP_DIR, 'resources', 'app', 'icon.ico')
  });
  if (wa.height < 820) win.maximize();      // 屏幕太矮才最大化
  if (splash) { splash.destroy(); splash = null; }
  Menu.setApplicationMenu(null);
  win.setMenuBarVisibility(false);

  win.once('ready-to-show', () => {
    win.show();
    log('窗口已显示');
    if (SMOKE) setTimeout(runSmoke, 2000);
    if (CLOSETEST) setTimeout(closeTest, 5000);
    if (AUDIT) setTimeout(runAudit, 2000);
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(APP_URL)) { shell.openExternal(url); return { action: 'deny' }; }
    return { action: 'allow' };
  });
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    const k = String(input.key || '').toLowerCase();
    if (k === 'f5' || (input.control && k === 'r')) { win.webContents.reload(); e.preventDefault(); }
    else if (k === 'f11') { win.setFullScreen(!win.isFullScreen()); e.preventDefault(); }
    else if (k === 'f12') { win.webContents.toggleDevTools(); e.preventDefault(); }
  });
  win.webContents.on('did-fail-load', (_e, code, desc) => {
    fail(`界面载入失败（${code} ${desc}）`);
  });
  win.on('closed', () => { win = null; });
  win.loadURL(APP_URL);
}

/* ---------------- 自检（--smoke） ---------------- */
/* 自适应探针：多种宽度下记录卡片列数 / 主按钮可见性 / 横向溢出 / 侧栏宽度 */
async function probeWidths() {
  const wa = screen.getPrimaryDisplay().workAreaSize;
  const out = [];
  for (const w of RESP_WIDTHS) {
    const useW = Math.min(w, wa.width - 20);
    const useH = Math.min(940, wa.height - 60);
    try { win.unmaximize(); } catch (e) { /* ignore */ }
    win.setBounds({ width: useW, height: useH });
    await new Promise((r) => setTimeout(r, 800));
    const m = await win.webContents.executeJavaScript(`(() => {
      const page = document.querySelector('.page:not(.hidden)');
      const cards = page ? Array.from(page.querySelectorAll(':scope > .card')) : [];
      const tops = cards.map((c) => Math.round(c.getBoundingClientRect().top));
      const perRow = tops.length ? tops.filter((t) => t === tops[0]).length : 0;
      const go = document.querySelector('#genGo');
      const nav = document.querySelector('#nav');
      const hs = cards.map((c) => Math.round(c.getBoundingClientRect().height));
      const bs = cards.map((c) => Math.round(c.getBoundingClientRect().bottom));
      return {
        winW: innerWidth, winH: innerHeight, cards: cards.length, perRow,
        heights: hs, bottoms: bs,
        bottomAligned: bs.length > 1 && new Set(bs).size === 1,
        equalHeight: hs.length > 1 && new Set(hs).size === 1,
        gridAlign: getComputedStyle(page).alignItems,
        goVisible: go ? go.getBoundingClientRect().bottom <= innerHeight + 1 : false,
        overflowX: document.documentElement.scrollWidth > innerWidth + 2,
        sidebarW: nav ? Math.round(nav.getBoundingClientRect().width) : 0,
        pageH: document.documentElement.scrollHeight
      };
    })()`);
    out.push(m);
  }
  return out;
}

async function runSmoke() {
  try {
    const dom = await win.webContents.executeJavaScript(`(() => {
      const q = (s) => !!document.querySelector(s);
      const sel = document.querySelector('#genChar');
      return {
        title: document.title,
        hasCharSelect: q('#genChar'),
        hasPresetButtons: q('#charCombo') && q('#styleCombo') && q('#charField') && q('#presetImportBtn'),
        hasOldResultPane: q('#genResult') || q('#editResult') || q('#cutResult'),
        navCount: document.querySelectorAll('.navbtn').length,
        presetOptions: sel ? sel.options.length : 0,
        menuBarVisible: false,
        goVisible: (function () { const g = document.querySelector('#genGo'); if (!g) return false; return g.getBoundingClientRect().bottom <= innerHeight + 1; })(),
        pageHeight: document.documentElement.scrollHeight, viewHeight: innerHeight,
        bodyText: (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 160)
      };
    })()`);
    dom.menuBarVisible = win.isMenuBarVisible();
    dom.appMenuIsNull = Menu.getApplicationMenu() === null;

    // 预设下拉检查（v0.5.4：每行都有删除入口、底部有新增行、能展开）
    const combo = await win.webContents.executeJavaScript(`(async () => {
      const list = document.querySelector('#charList');
      const isOpen = () => (list ? getComputedStyle(list).display !== 'none' : false);
      let open = false;
      for (let attempt = 0; attempt < 3 && !open; attempt++) {   // 重试，消除"点得太早"的时序抖动
        const f = document.querySelector('#charField');
        if (f) f.click();
        await new Promise((r) => setTimeout(r, 320));
        open = isOpen();
      }
      const items = list ? list.querySelectorAll('.combo-item').length : 0;
      const del = list ? list.querySelectorAll('.combo-op.del').length : 0;
      const addRows = list ? list.querySelectorAll('.combo-add button').length : 0;
      const comboEl = document.querySelector('#charCombo');
      return { open, items, del, addRows,
               cls: comboEl ? comboEl.className : null,
               disp: list ? getComputedStyle(list).display : null,
               hasField: !!document.querySelector('#charField'),
               onclickAttached: !!(document.querySelector('#charField') || {}).onclick };
    })()`);

    // D14 回归：从下拉底部「＋ 新增」打开弹窗，量弹窗中心是否与视口中心重合（偏差 ≤3px）
    const dialog = await win.webContents.executeJavaScript(`(async () => {
      const add = document.querySelector('#charList .combo-add button');
      if (add) add.click();
      await new Promise((r) => setTimeout(r, 300));
      const mask = document.querySelector('#pmask');
      const dlg = document.querySelector('#pdialog');
      const r = dlg.getBoundingClientRect();
      const dx = Math.abs((r.left + r.width / 2) - innerWidth / 2);
      const dy = Math.abs((r.top + r.height / 2) - innerHeight / 2);
      const res = {
        display: getComputedStyle(mask).display,
        dx: Math.round(dx), dy: Math.round(dy),
        dialogW: Math.round(r.width), viewW: innerWidth, viewH: innerHeight,
        centered: dx <= 3 && dy <= 3
      };
      const cancel = document.querySelector('#pCancel');
      if (cancel) cancel.click();
      return res;
    })()`);

    const responsive = await probeWidths();

    // 弹窗打开状态截图（用于校验弹窗居中）
    await win.webContents.executeJavaScript(`(() => { const a = document.querySelector('#charAdd'); if (a) a.click(); })()`);
    await new Promise((r) => setTimeout(r, 350));
    const shotDlg = await win.webContents.capturePage();
    fs.writeFileSync(path.join(ROOT, 'smoke-shot-dialog.png'), shotDlg.toPNG());
    await win.webContents.executeJavaScript(`(() => { const c = document.querySelector('#pCancel'); if (c) c.click(); })()`);

    const shot = await win.webContents.capturePage();
    const png = path.join(ROOT, 'smoke-shot.png');
    fs.writeFileSync(png, shot.toPNG());

    const presets = await new Promise((resolve) => {
      http.get(APP_URL + '/api/presets', { timeout: 8000 }, (res) => {
        let b = '';
        res.on('data', (c) => b += c);
        res.on('end', () => { try { resolve(JSON.parse(b)); } catch (e) { resolve({}); } });
      }).on('error', () => resolve({}));
    });
    const names = (presets.characters || []).map((c) => c.name);
    // 分发包不得夹带私人预设：这里只做通用判定（名字里不该出现「常用/私有/我的」这类个人标记）
    const noPrivate = !names.some((n) => /常用|私有|我的/.test(n));
    // 自适应验收：宽屏一行 ≥2 张卡片、任何宽度都不横向溢出、主按钮始终可见、窄屏侧栏折叠
    const widest = responsive[responsive.length - 1] || {};
    const narrow = responsive[0] || {};
    const respOk = (widest.perRow || 0) >= 2 && responsive.every((r) => !r.overflowX)
      && responsive.every((r) => r.goVisible) && (narrow.sidebarW || 999) <= 90;
    const comboOk = !!combo.open && combo.items >= 1 && combo.del >= 1 && combo.del <= combo.items
      && combo.addRows === 1;   // 「（空白）」占位项可以没有删除入口，故只要求 ≥1 且不超过行数
    const ok = !!dom.hasCharSelect && !!dom.hasPresetButtons && !dom.hasOldResultPane
      && dom.navCount === 6 && !dom.menuBarVisible && names.length > 0 && noPrivate && respOk
      && !!dialog.centered && comboOk;

    writeSmoke({ ok, dom, dialog, combo, responsive, presets: names, screenshot: png, window: { w: win.getBounds().width, h: win.getBounds().height } });
    log('SMOKE ' + (ok ? 'PASS' : 'FAIL') + ' → smoke-result.json');
    setTimeout(() => { stopBackend(); app.exit(ok ? 0 : 2); }, 400);
  } catch (e) {
    writeSmoke({ ok: false, error: String(e) });
    log('SMOKE 异常: ' + e);
    stopBackend();
    app.exit(3);
  }
}

/* 逐页截图（视觉审计用）：--uiaudit */
async function runAudit() {
  const pages = ['gen', 'edit', 'cutout', 'queue', 'gallery', 'settings'];
  const shots = [];
  const metrics = [];
  try {
    // 按"默认舒适窗口"测量（不最大化）——这才是作者实际看到的样子
    const wa = screen.getPrimaryDisplay().workAreaSize;
    try { win.unmaximize(); } catch (e) { /* ignore */ }
    win.setBounds({ width: Math.min(1440, Math.max(1024, wa.width - 140)),
                    height: Math.min(920, Math.max(680, wa.height - 140)) });
    await new Promise((r) => setTimeout(r, 700));
    for (const p of pages) {
      await win.webContents.executeJavaScript(
        `(() => { const b = document.querySelector('.navbtn[data-page="${p}"]'); if (b) b.click(); })()`);
      await new Promise((r) => setTimeout(r, 800));
      const m = await win.webContents.executeJavaScript(`(() => {
        const page = document.querySelector('.page:not(.hidden)');
        const kids = page ? Array.from(page.children) : [];
        let maxR = 0, maxB = 0;
        kids.forEach((k) => {
          const r = k.getBoundingClientRect();
          if (r.width > 0 && r.height > 0) { maxR = Math.max(maxR, r.right); maxB = Math.max(maxB, r.bottom); }
        });
        const cards = page ? Array.from(page.querySelectorAll(':scope > .card')) : [];
        return {
          page: page ? page.id.replace('page-', '') : null,
          winW: innerWidth, winH: innerHeight,
          scrollH: document.documentElement.scrollHeight,
          contentRight: Math.round(maxR), contentBottom: Math.round(maxB),
          rightBlank: Math.round(innerWidth - maxR),
          bottomBlank: Math.round(Math.max(0, innerHeight - maxB)),
          cardCount: cards.length,
          cardW: cards.map((c) => Math.round(c.getBoundingClientRect().width))
        };
      })()`);
      metrics.push(m);
      const img = await win.webContents.capturePage();
      const f = path.join(ROOT, 'audit-' + p + '.png');
      fs.writeFileSync(f, img.toPNG());
      shots.push(f);
      if (p === 'edit') {   // 单独截一张「文件输入框」局部图（D15 取证：按钮不该是白色）
        const rect = await win.webContents.executeJavaScript(
          `(() => { const r = document.querySelector('#editFiles').getBoundingClientRect();
                    return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) }; })()`);
        const crop = await win.webContents.capturePage({
          x: rect.x, y: rect.y + 1, width: Math.min(360, rect.width), height: Math.max(8, rect.height - 2)
        });
        const cf = path.join(ROOT, 'audit-fileinput.png');
        fs.writeFileSync(cf, crop.toPNG());
        shots.push(cf);
      }
    }
    await win.webContents.executeJavaScript(
      `(() => { const b = document.querySelector('.navbtn[data-page="gen"]'); if (b) b.click(); })()`);
    await new Promise((r) => setTimeout(r, 400));
    await win.webContents.executeJavaScript(
      `(() => { const f = document.querySelector('#charField'); if (f) f.click(); })()`);
    await new Promise((r) => setTimeout(r, 600));
    const comboShot = await win.webContents.capturePage();
    const comboFile = path.join(ROOT, 'audit-combo.png');
    fs.writeFileSync(comboFile, comboShot.toPNG());
    shots.push(comboFile);
    await win.webContents.executeJavaScript(
      `(() => { const a = document.querySelector('#charList .combo-add button'); if (a) a.click(); })()`);
    await new Promise((r) => setTimeout(r, 800));
    const d = await win.webContents.capturePage();
    const df = path.join(ROOT, 'audit-dialog.png');
    fs.writeFileSync(df, d.toPNG());
    shots.push(df);
    fs.writeFileSync(path.join(ROOT, 'audit-result.json'),
      JSON.stringify({ shots, metrics, viewport: { w: win.getBounds().width, h: win.getBounds().height } }, null, 1));
    log('AUDIT done: ' + shots.length + ' 张截图');
  } catch (e) {
    log('AUDIT 异常: ' + e);
  }
  setTimeout(() => { stopBackend(); app.exit(0); }, 400);
}

/* 关窗验收：确认关闭窗口会连带杀掉自己拉起的后端（技能规则 9 的做法） */
async function closeTest() {
  const aliveBefore = await pingAsync();
  log('CLOSETEST: 关闭前后端在线=' + aliveBefore);
  win.close();
  const t0 = Date.now();
  let dead = false;
  while (Date.now() - t0 < 20000) {
    if (!(await pingAsync())) { dead = true; break; }
    await new Promise((r) => setTimeout(r, 500));
  }
  const res = {
    ts: Date.now(), backendAliveBefore: aliveBefore, backendDeadAfterClose: dead,
    waitedSeconds: Math.round((Date.now() - t0) / 1000)
  };
  try { fs.writeFileSync(path.join(ROOT, 'close-result.json'), JSON.stringify(res, null, 1)); } catch (e) { /* ignore */ }
  log('CLOSETEST ' + (aliveBefore && dead ? 'PASS' : 'FAIL'));
  setTimeout(() => { stopBackend(); app.exit(0); }, 300);
}

/* ---------------- 主流程 ---------------- */
async function boot() {
  if (!app.requestSingleInstanceLock()) { log('已有实例在运行，退出'); app.exit(0); return; }

  const already = await pingAsync();
  if (already) {
    log('检测到已有后端在运行 → 直接连接（不重复拉起）');
    if (!SMOKE) { makeSplash(); spSet('已检测到运行中的服务，正在连接…', 70, '', 96); }
  } else {
    if (!SMOKE) makeSplash();     // 先出启动画面，再拉起后端（这样早期日志也能推进进度）
    try { startBackend(); } catch (e) { fail(String(e.message || e)); return; }
  }

  const t0 = Date.now();
  let ready = false;
  while (Date.now() - t0 < READY_TIMEOUT_MS) {
    if (await pingAsync()) { ready = true; break; }
    await new Promise((r) => setTimeout(r, 700));
  }
  if (ready) spSet('⑤ 界面加载中…', 96, '马上就好', 100);
  if (!ready) {
    fail('本地服务在 ' + Math.round(READY_TIMEOUT_MS / 1000) + ' 秒内没有就绪。\n'
      + '请检查：显卡驱动是否正常、显存是否被其它程序占满。\n详情见包内 data\\desktop.log');
    return;
  }
  log('后端就绪，用时 ' + ((Date.now() - t0) / 1000).toFixed(1) + 's');
  createWindow();
}

app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.on('window-all-closed', () => { stopBackend(); if (!CLOSETEST) app.quit(); });
app.on('before-quit', () => { app.isQuitting = true; stopBackend(); });
process.on('unhandledRejection', (e) => log('unhandledRejection: ' + e));

app.whenReady().then(boot);
