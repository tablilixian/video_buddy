# START HERE · 视频模板化开发（Phase 0 + Phase 1）

> 新会话**从这里开始**。本目录是完整交接包，四块工作**互不重叠、可以分头做**。
> 日期：2026-11-10 · 插件：`canvas-studio/` · 包位置：`canvas-studio/docs/plans/2026-11-10-视频模板化/`

---

## 本包是什么

| | |
|---|---|
| **来源** | 对外部开源项目 `motiontemplates/all`（MotionGit 模板合集）的解剖 + 一条 B1+B2 编排的**真机复刻与像素级复核** |
| **本包内容** | ① 实机评估与根因分析 ② 四份可并行执行的任务包 ③ 共享实测基线与本仓代码事实索引 ④ 可运行的原型脚本 |
| **代码改动** | **零**。本包是纯文档 + 原型脚本，**不含任何产品代码改动** |
| **依据来源** | GT = MotionGit `#385712` 模板的官方入口实跑产物（18.000s / 1920×1080@60 / 带声音）；实机 = 用户真机渲染产出 |
| **未领 CV 号** | 计划/调研类文档按 repo 惯例**不占号**（先例：`plans/2026-11-07-渲染性能优化调研与推进计划.md`、`plans/REQ-034-纯代码短片推演-20261016.md`）；**开工取号前先 `git log` + `docs/STATUS.md` §4.1 复核**（当前水位 CV-459） |

> ⚠️ **本包的事实索引带行号**（`src/remotion/manifest.ts:1420` 这类）。**动手前请重读当前文件内容** —— 本仓有并发会话在改 `host-tools.ts` / `canvas-asset-attach.ts` / `tool-presentation.ts` 等，行号可能已漂移；**以文件当前内容为准，本包的行号只作定位线索**。

---

## 1. 目标（一句话）

> **让 LLM 只改「内容」和「少量参数」，就能快速、准确地还原一类视频的效果。**

具体拆成四块：

| 任务包 | 交付 | 消灭的差距 |
|---|---|---|
| [`0A-sfx-event-track.md`](任务包-0A-SFX事件轨.md) | 音效事件轨 + 程序化合成音效库 + 渲染接线 | #1 完全没声音 |
| [`0B-overflow-report.md`](任务包-0B-文本溢出上报.md) | 文本溢出上报通道（把已有的 `overflow` 标志接出来） | 零层拦截的静默裁切 |
| [`1C-furniture-primitives.md`](任务包-1C-装饰构件层.md) | 装饰构件层（括线 / 进度条 / 构件库） | #9 GT 是整帧设计，我们是元素流 |
| [`1-template-library.md`](任务包-1-模板库机制.md) | 模板目录 + 编译器 + `list_templates` + `render_composition(templateId, slots)` | 把「模板」立成一等公民 |

---

## 2. 依赖图与建议顺序

```
        0A (SFX)  ──┐
        0B (溢出) ──┼──→  1 (模板库)  ──→  Phase 2（版式参数化，另有任务包）
        1C (构件) ──┘
```

- **0A / 0B / 1C 三块可并行**（改动面互不重叠）。
- **1（模板库）依赖三者**：模板要带音效事件表（0A）、槽位合同（0B）、装饰构件声明（1C）。
- 建议：**先开三块并行**，1 等前三个的接口稳定后再接。

**接口点（只有这三个）**：
| 接口 | 产出方 | 消费方 |
|---|---|---|
| `manifest.audio.sfx[]` + `sfxStartFrame()` + `sfxVolumeAt()` | 0A | 1（模板的 `audio.json`） |
| `planTextFit()` + `auditTextFit()` + `report.textFit` | 0B | 1（模板的 `slots.json` 校验） |
| `expandFurniture(spec, ctx) → tracks[]` | 1C | 1（模板的 `furniture.json`） |

---

## 3. 读文件的顺序

1. **本文件**（你现在在这）
2. [`视频模板化-基线与代码事实索引.md`](视频模板化-基线与代码事实索引.md) —— **共享数据源**：实测基线、资产路径、本仓代码事实索引、已踩过的坑
3. [`视频模板化-总纲-开发计划.md`](视频模板化-总纲-开发计划.md) —— 总纲：实机评估、根因、目标、架构、四阶段路线、风险
4. 你要做的那个**任务包**
5. （可选）[`配套-motiongit解剖与19项能力矩阵.md`](配套-motiongit解剖与19项能力矩阵.md) —— 外部项目解剖 + 19 项能力对照矩阵 + 三组实测 + **实测推翻的五个判断**（**读完能省你很多冤枉路**）
6. `canvas-studio/AGENTS.md` —— 仓库铁律（下面摘要，但**必须读原文**）

### 📄 交接包文件清单

```
canvas-studio/docs/plans/2026-11-10-视频模板化/
├── INDEX.md                          ← ★ 你在这（新会话入口）
├── 视频模板化-总纲-开发计划.md          ← 总纲（评估 → 根因 → 目标 → 架构 → 四阶段路线 → 风险）
├── 视频模板化-基线与代码事实索引.md      ← 共享基线数据（必读）
├── 任务包-0A-SFX事件轨.md
├── 任务包-0B-文本溢出上报.md
├── 任务包-1C-装饰构件层.md
├── 任务包-1-模板库机制.md
├── 配套-motiongit解剖与19项能力矩阵.md   ← 外部解剖 + 能力矩阵 + 实测推翻的五个判断
├── 原型-manifest-b1b2.json          ← 可直接渲染的 B1+B2 manifest（20 轨，0 error 0 warning）
├── 原型-manifest-spec-b1b2.json     ← spec 层形态（含 limits 容量合同样例）
├── 原型-manifest-b1b2-测试夹具.json   ← 18 轨夹具（槽位合同套件用）
├── 原型-slots-b1b2.json             ← 槽位合同样例
├── 原型-gen.mjs                     ← manifest 生成脚本（每时刻标注 GT 源码出处）
├── 原型-gen-b1b2.mjs                ← 夹具生成脚本
├── 原型-check-fit.mjs               ← 文字适配验算（用仓库真实的 subtitleFitBudget + fitTextPolicy）
├── 原型-slot-validate.mjs           ← 槽位合同校验器（L1 静态层原型）
├── 原型-spec-limits-validate.mjs    ← 容量合同校验器原型（spec 层 limits）
├── 原型-run-cases.mjs               ← 合成套件（8/8）
└── 原型-run-real.mjs                ← 真实四季 spec 套件（7/7）
```

**脚本全部自引用本目录**（`HERE = dirname(fileURLToPath(import.meta.url))`），整包可搬移，不依赖 `/tmp`。直接跑：

```sh
cd canvas-studio/docs/plans/2026-11-10-视频模板化
node 原型-run-cases.mjs   # → 通过 8 / 8
node 原型-run-real.mjs    # → 通过 7 / 7（依赖外部真实项目 spec）
node 原型-check-fit.mjs   # → 有问题的轨：0
```

---

## 4. 环境前置

```sh
# Node 要求：^22.19.0 或 >=24.0.0，Yarn 4.18.0 走 Corepack
node -v && corepack yarn -v

# 初始化（若子模块未初始化）
git submodule update --init --recursive

# 安装
corepack yarn install --immutable
```

### 4.1 开工前基线快照（**先跑一遍，确认环境是干净的**）

在 `canvas-studio/` 目录内：

```sh
corepack yarn typecheck && corepack yarn build && corepack yarn verify:loader && corepack yarn test:smoke
```

> ⚠️ **沙箱内 build 首步 `clean.mjs` 会撞批量删除阈值** ⇒ 改为逐步骤：
> ```sh
> node node_modules/.bin/tsdown && tsc -p tsconfig.json && tsc -p tsconfig.client.json --emitDeclarationOnly
> ```
> （`corepack yarn test` 跑的是 `lib/` 产物，**不能当编译闸门**。）

**跑之前先 `git status`**：本仓库可能有**其它并发会话**的改动（近期动过 `host-tools.ts` / `canvas-asset-attach.ts` / `tool-presentation.ts` / 若干 skill 与 plan 文档）。**不要 reset、不要 checkout、不要提交别人的改动。**

### 4.2 外部资产（**可能已被 `/tmp` 清理**）

`视频模板化-基线与代码事实索引.md` §1 列了全部路径。GT（ground truth）重建步骤见 `视频模板化-基线与代码事实索引.md` §2，约 10 分钟。

- 若 `/tmp/motion_probe_2026/` 还在 ⇒ 直接用。
- 若被清了 ⇒ 按 §2 重建（需要 `python3 -m venv` + `pip install numpy scipy soundfile pyloudnorm jsonschema` + `npm ci` 装 playwright-core）。
- **Chrome、Python 3.11、ffmpeg 7.1.1 本机都有**（`uv` 没有，用 venv 替代）。

---

## 5. 仓库铁律（`canvas-studio/AGENTS.md` 摘要，**原文必读**）

| 约束 | 说明 |
|---|---|
| **验证链顺序不能变** | `typecheck → build → verify:loader → test:smoke` |
| **`test:smoke` 不是编译闸门** | 它跑的是 `lib/` 产物；typecheck/build 必须先过 |
| **可单测的纯函数放 `src/*.ts`** | **不放 `src/client/**`**（Host tsconfig 排除 client，放进去测不到） |
| **client 引用新根级模块** | 须显式追加 `tsconfig.client.json` include |
| **CSR：`<Audio>/<Video>` 只从 `@remotion/media` 导入** | remotion 核心版在 web-renderer 下直接抛错；机检 `tests/csr-writing-guard.test.mjs` |
| **CSR：`background-image: url()` 要配 preload + delayRender 兜底** | 渲染器不等待背景图加载（"本地有图、成片没图"） |
| **CSR：mask 只写 linear-gradient/url** | blend / perspective / backdrop-filter 在 4.0.535 整字段无效，别新写 |
| **收尾四步（强制）** | ① `docs/STATUS.md` 状态列终态 + §8 变更记录追加一行 ② `docs/canvas-ux-backlog.md` 对应行写清怎么实现 + 文末变更记录 ③ 涉 REQ/BUG 时同步 `docs/tracking.md` ④ `git add` **精确路径**（勿 `git add canvas-studio/`），信息带条目号 `feat(canvas-studio): …（CV-xxx）` |
| **CV 编号** | 主线 = 最大号 + 1；**写号前先 grep 整个 `docs/`**（撞号踩过三次） |
| **「已完成」的门槛是桌面验收** | 不是测试通过 |

### 5.1 本次额外要守的

| 约束 | 来源 |
|---|---|
| **不静默截断** —— 装不下必须报错或明确提示 | 本仓既有铁律，0B 直接对着它补 |
| **不新造渲染管线** —— 构件/模板都展开成现有轨道 | 架构原则 |
| **不移植 JS 引擎 / 不让模型写代码** | 架构原则（`recipes.ts` 注释里已写明「为什么不是模板工程」） |
| **`KNOWN_AUDIO_KEYS` / `KNOWN_TRACK_KEYS` 改了要过字段漂移机检** | 契约演进 |
| **老 manifest 必须逐像素不变** | 多处注释反复强调的铁律 |

---

## 6. 验收命令汇总

### 6.1 每块完成后

```sh
# 在 canvas-studio/ 目录内
corepack yarn typecheck
node node_modules/.bin/tsdown && tsc -p tsconfig.json && tsc -p tsconfig.client.json --emitDeclarationOnly
corepack yarn verify:loader
corepack yarn test:smoke
```

### 6.2 关键回归（**每块都要跑**）

```sh
cd /Users/wl/Desktop/job/learn/video_buddy/canvas-studio

# 真实校验器跑交付 manifest
node -e "import('./lib/remotion/manifest.js').then(m=>{const r=m.validateManifest(JSON.parse(require('fs').readFileSync('原型-manifest-b1b2.json','utf8')));console.log(r.ok,r.errors,r.warnings)})"
# 期望：true [] []

# 文字适配验算（用仓库真实函数）
node 原型-check-fit.mjs 原型-manifest-b1b2.json
# 期望：11 条文字轨 0 问题
```

### 6.3 端到端（要起 Electron 桌面应用，**无法纯 node headless**）

- `render_composition` 走隐藏渲染窗口（Electron + Remotion Web 渲染器），未就绪时回退画布页。
- **关掉整个 App 会中断渲染。**
- 调试用 `probe: true`（不落画布节点、不抽帧）；快验用 `spotFrames`（只渲指定帧）。
- **长 manifest 必须走 `manifestPath`**（内联超 ~30KB 会截断，「尾部完整性校验」当场拒收）。

---

## 7. 交付口径

每块做完，除了代码，还要：

1. **补文档**：`skills/code-driven-explainer/references/manifest-contract.md` 是「组装细节的唯一权威」（工具描述里明写「本描述不重复，避免两处漂移」）⇒ 契约改了**必须**同步这里。
2. **收尾四步**（见 §5）。
3. **CV 编号**：写号前先 `grep -r "CV-" canvas-studio/docs/ | grep -o "CV-[0-9]\+" | sort -u | tail -1`。
4. **提交信息**：`feat(canvas-studio): …（CV-xxx）`，`git add` 精确路径。
5. **别提交别人的改动**：本仓库可能有并发会话的未提交内容，提交前 `git status` 逐条核对。

---

## 8. 一句话记住的三个坑

1. **`box.x/y` 是「盒子中心」的百分比**，不是左上角 —— 写成 0,0 只占左上四分之一。
2. **数组 vs 字符串两种语义必须分开判**：数组 = 作者显式分行（校验长度 + 每行字数）；字符串 = 整块（校验总字数 + `\n` 行数）。
3. **`validateManifest` 报 ok ≠ 没溢出** —— 实测存在「报 0 error 0 warning 但文字被裁掉」的组合（`check-fit.mjs` 是最小复现）。

（更多坑见 `视频模板化-基线与代码事实索引.md` §7。）
