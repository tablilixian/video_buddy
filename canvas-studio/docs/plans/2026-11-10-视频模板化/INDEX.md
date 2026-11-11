# START HERE · 视频模板化开发（Phase 0 + Phase 1）

> 新会话**从这里开始**。本目录是完整交接包。
> 日期：2026-11-10 · 插件：`canvas-studio/` · 包位置：`canvas-studio/docs/plans/2026-11-10-视频模板化/`

---

## 🚦 无人值守模式（2026-11-10 起生效）

> 项目所有者已授权：**需要决策的自己拍板，不要停下来问；全部完成后一次性汇报。**
>
> 接管会话请按这个顺序读，**不要跳**：
>
> | 顺序 | 文件 | 作用 |
> |---|---|---|
> | 1 | **[`PROGRESS.md`](PROGRESS.md)** | **单一进度事实源** —— 看"下一个待做项" |
> | 2 | [`无人值守推进协议.md`](无人值守推进协议.md) | 验证梯度 V1–V6、真机替代（Electron 探针）、失败预算 3 轮、允许后置清单、上下文预算 |
> | 3 | [`决策日志.md`](决策日志.md) | 上一轮自主拍过什么板（别反转自己） |
> | 4 | [`执行总表.md`](执行总表.md) §3 | 文件抢用矩阵（确认要改的文件没被占） |
> | 5 | 当前任务包 | 实现细节 |
>
> **三条最容易踩的**：① 绝不 kill Electron 进程；② 改完 `src/` 必须先 `npx tsc` 再跑测试（否则测旧码）；③ 每完成一小步立刻更新 `PROGRESS.md`，不要攒到会话末尾。

---

## ⚠️ 答案先看这里：拍板已完成，开工读「执行总表」

> **[`执行总表.md`](执行总表.md) 是开工后的唯一推进依据。**
> 它给出：真实三波顺序（不是"四块并行"）、文件抢用矩阵、逐包可机器判的验收闸门、
> 拍板结论落地点（P-1~P-10 各改哪个文件）、风险登记（含真机两项的检查点）、每日自检清单。
>
> **[`决策-模板需求收口.md`](决策-模板需求收口.md) 是需求与方案的最终依据。** 与本包其它文档冲突时，**以它为准**。
>
> 它定了 10 个拍板项（P-1~P-10）+ 10 个开工卡点（K-1~K-10，每条带解法）+ 阶段顺序 + 验收口径。
> **拍板结论（2026-11-10）**：P-8 = 对话内选择（UI 并入 `REQ-033`）｜P-9 = 五判据全过且恰好 1 个候选才自主选｜P-10 = 3 个整片。
>
> 三条会直接改你手上任务包的结论，先记住：
>
> 1. **模板入口不是 `render_composition(templateId, slots)`**，而是 `scaffold_manifest({templateId, slots, writeTo})` → `render_composition({manifestPath})`。理由：模板产物要能被模型继续编辑，且不新增第三路互斥入参。
> 2. **不写 spec 编译器**（`任务包-1` 的默认路）。模板源文件 = manifest 骨架 + `{{slotId}}` 占位符。理由：`text` 只校验非空字符串（`manifest.ts:1597`），占位符零阻力；省掉最重的一块。
> 3. **四块不是"互不重叠"**：`manifest.ts` 被 0A/0B/1 三处改，`host-tools.ts` 被 0B/1 改。真实并行度 = `0A ∥ 1C`，然后 `0B`，然后 `1`。详见执行总表 §2/§3。
>
> 另有一条**新增的强制判据**（`决策` §12）：`compile()` 只判格式，抓不住"内容被静默丢弃"和"内容不足时编造"。
> 选模板前必须跑 `gateTemplate()` 的五条判据（条目数 / 信息充足度 / 容量 / 素材 / 时长），实测 6/6 + 反向变异可变红。

---

## 本包是什么

| | |
|---|---|
| **来源** | 对外部开源项目 `motiontemplates/all`（MotionGit 模板合集）的解剖 + 一条 B1+B2 编排的**真机复刻与像素级复核** |
| **本包内容** | ① 实机评估与根因分析 ② 四份任务包（**并行度见 §2，不是全部可并行**） ③ 共享实测基线与本仓代码事实索引 ④ 可运行的原型脚本 ⑤ **需求收口与决策（P/K 清单）** |
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
| [`1-template-library.md`](任务包-1-模板库机制.md) | 模板目录 + 槽位合同 + `list_templates` + `scaffold_manifest(templateId, slots)`（**形态见收口文档 P-3，不写编译器**） | 把「模板」立成一等公民 |

---

## 2. 依赖图与建议顺序

```
        0A (SFX)  ──┐
        0B (溢出) ──┼──→  1 (模板库)  ──→  Phase 2（版式参数化，另有任务包）
        1C (构件) ──┘
```

- **真实并行度 = `0A ∥ 1C`**（改动面确实不重叠）。
- **`0B` 与 `1` 必须串行**：两者都改 `host-tools.ts` 与 `report` schema；`manifest.ts` 同时被 0A（音频校验段）和 0B（L1 校验）改。
- **1（模板库）依赖三者**：模板要带音效事件表（0A）、槽位合同（0B）、装饰构件声明（1C）。
- 建议：**第一波只开 `0A ∥ 1C`**；`0B` → `1` 排第二波串行（详见收口文档 §8）。

**接口点（只有这三个）**：
| 接口 | 产出方 | 消费方 |
|---|---|---|
| `manifest.audio.sfx[]` + `sfxStartFrame()` + `sfxVolumeAt()` | 0A | 1（模板的 `audio.json`） |
| `planTextFit()` + `auditTextFit()` + `report.textFit` | 0B | 1（模板的 `slots.json` 校验） |
| `expandFurniture(spec, ctx) → tracks[]` | 1C | 1（模板的 `furniture.json`） |

---

## 3. 读文件的顺序

1. **本文件**（你现在在这）
2. [`执行总表.md`](执行总表.md) —— ★★★ **真要开工就读这个**：三波顺序、文件抢用矩阵、逐包验收闸门、拍板落地点、风险登记、每日自检
3. [`决策-模板需求收口.md`](决策-模板需求收口.md) —— ★★ **需求为什么是现在这样**：需求定义、入口、粒度、组合、10 个拍板项、10 个卡点解法、§12 填参验证
4. [`视频模板化-基线与代码事实索引.md`](视频模板化-基线与代码事实索引.md) —— **共享数据源**：实测基线、资产路径、本仓代码事实索引、已踩过的坑
5. [`视频模板化-总纲-开发计划.md`](视频模板化-总纲-开发计划.md) —— 总纲：实机评估、根因、目标、架构、四阶段路线、风险
6. 你要做的那个**任务包**（**冲突处以执行总表 + 收口文档为准**）
7. （可选）[`配套-motiongit解剖与19项能力矩阵.md`](配套-motiongit解剖与19项能力矩阵.md) —— 外部项目解剖 + 19 项能力对照矩阵 + 三组实测 + **实测推翻的五个判断**（**读完能省你很多冤枉路**）
8. `canvas-studio/AGENTS.md` —— 仓库铁律（下面摘要，但**必须读原文**）

### 📄 交接包文件清单

```
canvas-studio/docs/plans/2026-11-10-视频模板化/
├── INDEX.md                          ← ★ 你在这（新会话入口）
├── 执行总表.md                        ← ★★★ 开工后的唯一推进依据（三波顺序 / 文件抢用 / 验收闸门 / 风险登记）
├── 决策-模板需求收口.md                ← ★★ 需求与方案的最终依据（拍板项 P-1~10 / 卡点 K-1~10 / 验收口径 / §12 填参验证）
├── 视频模板化-总纲-开发计划.md          ← 总纲（评估 → 根因 → 目标 → 架构 → 四阶段路线 → 风险）
├── 视频模板化-基线与代码事实索引.md      ← 共享基线数据（必读）
├── 任务包-0A-SFX事件轨.md
├── 任务包-0B-文本溢出上报.md
├── 任务包-1C-装饰构件层.md
├── 任务包-1-模板库机制.md
├── 配套-motiongit解剖与19项能力矩阵.md   ← 外部解剖 + 能力矩阵 + 实测推翻的五个判断
├── 配套-网站目录整理-100模板与51落地页.md ← ★ 网站全量盘点（哪些在 GitHub 开源）
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
├── 原型-run-real.mjs                ← 真实四季 spec 套件（7/7）
├── 数据-100模板清单.csv               ← 100 个模板全清单（可筛选）
├── 数据-51落地页元数据.json           ← 51 份落地页 template.json 全量
├── 数据-51落地页速览.md               ← 51 个落地页速览表
├── 原型-compile.mjs                 ← ★ 模板编译器原型（编译 + 校验 + 结构比对；七项全过）
├── 原型-compile-core.mjs            ← ★ 编译核心（无副作用，供测试复用，避免逻辑漂移）
├── 原型-audit-text-fit.mjs          ← ★ 文本容量审计器（模块 + CLI；第 2~50 个模板靠它算 maxChars）
├── 原型-audit-selftest.mjs          ← ★ 审计器自测（19 项，覆盖 dataCard/bullets/无 box 分支）
├── 原型-llm-fill-test.mjs           ← ★ LLM 填参验证（6 用例：3 过 / 1 拦 / **2 机器看不见**）
├── 原型-template-fit-gate.mjs       ← ★ 适配度闸门（条目数 + 信息充足度，6/6 + 反向变异）
└── 原型-template-b1b2/              ← ★ P-3 验证产物（manifest.template.json + slots.json + meta.json）
```

**脚本全部自引用本目录**（`HERE = dirname(fileURLToPath(import.meta.url))`），整包可搬移，不依赖 `/tmp`。直接跑：

```sh
cd canvas-studio/docs/plans/2026-11-10-视频模板化
node 原型-run-cases.mjs   # → 通过 8 / 8
node 原型-run-real.mjs    # → 通过 7 / 7（依赖外部真实项目 spec）
node 原型-check-fit.mjs   # → 有问题的轨：0
node 原型-compile.mjs     # → 总判定：通过（P-3 七项验证，退出码 0）
node 原型-audit-text-fit.mjs  # → 违规 0 处；10 槽 maxChars 全一致
node 原型-audit-selftest.mjs  # → 通过 19 / 19
node 原型-llm-fill-test.mjs   # → 3 过 / 1 拦 / 2 缺口（缺口存在=测试有效）
node 原型-template-fit-gate.mjs # → 6/6 + 变异两条都变红
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
