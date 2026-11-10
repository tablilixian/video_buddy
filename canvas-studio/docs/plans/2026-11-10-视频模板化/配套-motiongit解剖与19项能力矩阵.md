# MotionGit 编排复刻 · 方案与实测报告

> 状态：方案已成型，核心机制已实测跑通。本文所有结论均带证据；**有五处初版判断被实测推翻，已在 §7 逐条列出**。
> 日期：2026-11-10 · 范围：外部项目 `motiontemplates/all` 的可用性评估 + 槽位合同层（内容容量合同）落地方案
> 约束：本轮**零代码改动**；原型脚本已随本包入库（`原型-*.mjs`，自引用路径）。

---

## 0. 摘要（一页读完）

1. **外部项目是什么**：`motiontemplates/all` 本身不含任何模板源码，它是图文目录（94 模板 / 108 Demo）。真正的资产在同账号下 53 个仓库：51 个模板落地页 + `all` + `motion-spec`（`.motion` 开放格式规范，候选版 0.1.0-draft.1）。
2. **可及性硬约束**：94 个模板 `openSource=true`，但 **只有 #385712 一个**在 GitHub 免登录带完整源码 + 可下载 `.motion`；其余 93 个须 motiongit.com 账号下载（个人包还需自己的 Key）。**「整包引入」连下载都做不到。**
3. **`.motion` 是什么**：ZIP 格式的自有模板工程 —— 纯 JS+CSS 命令式 DOM 引擎（`window.renderAt(t)`）+ Playwright/headless Chrome 逐帧截图 + ffmpeg 编码；入口 `adapter.py`（Python）。**不是 Remotion。**
4. **什么值得借**：MotionGit 的「编排」= 时间轴变换 + 逐元素入场时序 + 源码级音效绑定 + **槽位容量合同**。前三项我们已能表达；**第四项我们完全没有，而那才是它的护城河**。
5. **Ground truth 已跑通**：用官方 `adapter.py plan → prepare → render` + 官方 `mix.py`，跑出 #385712 的 B1+B2 成片（18.000s / 1920×1080@60 / 1080 帧 / 原生音效混音），并用像素级测量验证了编排规格。
6. **交付物**：一份可直接渲染的 `manifest-b1b2.json`（真实校验器 **0 error 0 warning**）+ 一份 spec 层 `manifest-spec-b1b2.json`（含 `limits` 容量合同）。
7. **建议**：P0 落 `manifest-spec.json` 的 `limits` 层（改动最小、收益直接）；P1 把**已有但从未上报**的文字溢出标志接出来（MotionGit 缩不下就抛错，我们缩不下就静默裁掉）。

---

## 1. 外部项目解剖

### 1.1 仓库构成

| 仓库 | 内容 | 可下载 |
|---|---|---|
| `motiontemplates/all` | 图文目录：`CATALOG.md` / `catalog.json` / `index.html` | — |
| `motiontemplates/<51 个模板号>` | 模板落地页（README / `template.json` / Demo 视频） | 仅 #385712 带 `template/` 源码 + `downloads/*.motion` |
| `motiontemplates/motion-spec` | **`.motion` 开放动画模板格式规范** | 公开 |

### 1.2 模板分类（94 个）

| 分组 | 数量 | 占比 |
|---|---|---|
| `art` 视觉 | 28 | 横屏 |
| `talk` 口播 | 27 | 17 横 + 10 竖 |
| `explainer` 讲解 | 22 | 21 横 + 1 竖 |
| `product` 产品 | 16 | 横屏 |
| `open` 开放 | 1 | 横屏 |

画幅：16:9 × 79、9:16 × 9、4:3 × 3、3:4 × 2、1:1 × 1。帧率：60fps × 51、30fps × 41、24fps × 2。

分类与本仓 `skills/` 的体裁几乎一一对应（口播讲解 / 科普 / 产品 / 品牌 / 数据 / 摄影）。

### 1.3 `.motion` 包内部（以 #385712 实测解压）

```
00-START-HERE.md  CREATION.md  README.md     # 给人和 AI 的制作指南
adapter.py        mix.py                      # Python 入口：plan / prepare / preview / render
render.mjs        chrome.mjs                  # Playwright + 系统 Chrome 逐帧截图 → ffmpeg
motion.json       motion.lock.json            # 模板身份 / 运行 profile / 依赖锁
params.schema.json  content.schema.json       # ★ 可替换内容合同（122KB / 148KB）
core/  main.js lib.js basic.js style.css      # ★ 动效引擎（~2955 行）
      catalog.json  audio-events.json         # ★ 内容单元表 / 音效时间表
      scenes/*.js  data/*.js  fonts/  brand/  # 场景实现 / 数据 / 字体 / 品牌素材
licenses/  integrity.json  asset-manifest.json
```

**许可**：模板代码 MIT；字体 Anton / Geist / NotoSansSC 为 OFL；音效与音乐须逐条核 `licenses/THIRD-PARTY-NOTICES.md`（**94 个模板 = 94 份许可**）。

### 1.4 运行模型

规范（`motion-spec/SPEC.zh.md` §7）定义的参考合同是**帧索引**模型：

```js
window.renderFrame = (frame, inputs) => { /* 按整数帧渲染 */ }
// 宿主按 t = frame × den / num 计算时间
```

样本 #385712 用的是同源的变体 profile `kinetic-user-core/1`：`window.renderAt(t)`（t 为秒），入口 `adapter.py`。

时间轴变换在 `core/user-runtime.js`：

```js
const p = plan.find(p => t >= p.outputStart && t < p.outputEnd)
const u = t - p.outputStart
const extra = p.outputEnd - p.outputStart - (p.sourceEnd - p.sourceStart)   // 延长阅读
const hold  = p.holdAt - p.sourceStart                                        // 冻结点
const s = p.sourceStart + (u < hold ? u : u < hold+extra ? hold : u - extra)
native(s)   // ← 用源时间渲染
```

即：**输出时间轴 = 源时间轴的重排 + 停顿插入**。源 250–258s / 260–270s 被重排到输出 0–8s / 8–18s。

### 1.5 槽位合同（MotionGit 的真正护城河）

三份文件共同构成「模板与内容解耦」：

| 文件 | 作用 |
|---|---|
| `params.schema.json` | 可替换内容的 JSON Schema（每个字段一个 `maxLength`） |
| `content.schema.json` | 469 个文字槽，每个带 `maxChars` / `format` / `required` / `source`（源码行号） |
| `core/catalog.json` | 内容单元表：分组 / 时间窗 / 字段集 / 素材位 |

容量超限的处置（`adapter.py`）：

```python
limits = {'keyword':8, 'heading':10, 'left':8, 'right':8,
          'explanation':42, 'conclusion':48, 'summary':10, 'action':42, 'label':32}
# points: 1–5 条，每条 ≤2 显式行，每行 ≤18 字（zh）
raise ValueError('Basic expression text exceeds capacity: ' + key)
```

渲染期还有两道自适应（`core/basic.js`）：

```js
fit(e, value, maxWidth, maxSize, minSize=42)   // 自动缩字号 118 → 下限 80
fitBody(e, value, w, fs=42)                     // 超 2 行或超宽 → 直接 throw
// throw Error('Text cannot fit this native expression without changing meaning: ' + value)
```

**「不改意思就放不下」——这是本仓「不静默截断」纪律在模板层的同构实现。**

---

## 2. 本仓现状（对照基准）

### 2.1 生产架构（实证自 `VideoOut/new3`）

```
storyboard.json      创意/事实/视觉/旁白/分镜/声音/资产/约束（9 分节）+ bindings
     ↓
manifest-spec.json   声明式规格：title/fps/aspect/filmFrames/theme/captions[]/visuals[]/audio
     ↓  make-spec.mjs 编译
manifest.json        CompositionManifest：id/meta/tracks/audio/global
     ↓  validateManifest → render_composition
成片.mp4
```

并行存在四层合同 / 规格：

| 层 | 文件 | 状态 |
|---|---|---|
| 数据溯源合同 | `fact-spec.json`（sources / constants / conflicts） | 成熟（CV-440） |
| 段边界锁 | `segment-lock.json` | 成熟 |
| 画面规格 | `manifest-spec.json` | 生产在用 |
| 版本快照 | `versions/vN.json` | 成熟 |

**缺的第五层：内容容量合同。**

另有 `manifest` 由**脚本生成**（`gen-v5.mjs` / `make-spec.mjs`，`generatedBy: "gen-v5.mjs"`）这一关键事实 —— manifest 是**产物**，spec 才是**声明层**。

### 2.2 渲染与校验能力

- **校验器**：`src/remotion/manifest.ts` 的 `validateManifest`（9 轨型：video/image/textCard/shape/transition/audioViz/chart/caption/callout）；另有 CV-334「契约外字段告警」机制（新增字段只要未登记就告警，不会静默生效）。
- **文字自适应**：`src/remotion/timing.ts` 的 `fitTextPolicy` —— 真实 `canvas.measureText` 测量，按 0.94×/轮缩字号，下限 `base × 0.55`，超 `maxLines` 置 `overflow`。
- **轨道字段白名单**：`KNOWN_TRACK_KEYS` + `KNOWN_BASE_TRACK_KEYS`，加字段漏登记即被机检抓红。
- **音频**：`src/audio-timeline.ts` 统一音频时间轴（`role: native | bgm | voiceOver | sfx`，绝对 `startSec` + `gain` + `fade` + `duck`）。
- **缓动白名单**：13 档 + `spring`。

---

## 3. 实测 E0：Ground truth 跑通

### 3.1 做法

用官方入口，跑 #385712 的 B1+B2：

```sh
python3 -m venv .venv && .venv/bin/pip install numpy scipy soundfile pyloudnorm jsonschema
npm ci                                   # playwright-core
.venv/bin/python adapter.py plan    --input ../run/user.json --out ../run/plan.json
.venv/bin/python adapter.py prepare --input ../run/user.json --out ../run/instance
.venv/bin/python adapter.py preview --instance ../run/instance --out ../run/preview_t2.png --time 2
# 逐帧渲染 + 编码 + 官方 mix.py 混音
```

### 3.2 两处必要偏差（如实披露）

1. **`uv` 缺失** → 用 Python venv + pip 装 PEP 723 声明的依赖（`numpy/scipy/soundfile/pyloudnorm/jsonschema`）。
2. **官方 `render.mjs` 在本机跑不起来** → 它的 gamma 滤镜串用了 `scale=in_primaries/in_transfer/out_primaries/out_transfer`，这是 **ffmpeg 8.x 才有**的选项；本机（brew 与系统）均为 **7.1.1**，`scale` 滤镜无这些选项，官方 `render` 直接 EPIPE 崩在第 0 帧。
   **处置**：另写一个同逻辑的本地渲染驱动，**只替换编码端的滤镜串**（7.1.1 等价链，输出元数据一致：`color_space=bt709 / color_range=tv`）。
   **模板 `core/` 与 `render.mjs` 一个字节没动** —— `integrity.json` 329 个文件 SHA-256 逐个校验，零不匹配。

### 3.3 结果

| 项 | 值 |
|---|---|
| 时长 / 规格 | 18.000s，1920×1080@60，1080 帧，h264 + AAC 48kHz 立体声 |
| 音轨 | mean −33.1 dB / max −3.7 dB —— 原生音效真混进去了 |
| 时间轴 | B1 → 0–8s，B2 → 8–18s（源 250–258 / 260–270s 重排到连续 0 起） |
| 音效事件 | 7 个，源码级声明：thud@0.58 / write@1.25 / swoosh@7.6 / card×3@0.9,1.06,1.22 / swipe@9.6 |

### 3.4 像素级验证

裁出 B2 三张卡片横带做帧间亮度扫描，实测入场时刻：

| 卡片 | 实测 | 源码规格 | 判定 |
|---|---|---|---|
| 01 | 8.900s | 8.90s | ✅ |
| 02 | 9.067s | 9.06s | ✅ |
| 03 | 9.250s | 9.22s | ✅ |

错峰 0.16s = 9.6 帧被实证确认。

---

## 4. 实测 E1：能力对照矩阵（19 项）

### ✅ 能直接落（已有落点，零新增）

| MotionGit 要素 | 规格 | 本地落点 |
|---|---|---|
| 段序列 + 时长 | B1 8s / B2 10s | `recipes.ts` 段序列 + `durationInFrames` |
| 标签遮罩显入 | mask d=.4 @+0.12 | `textCard anim:'maskReveal'` |
| 逐字入场 | slam d=.28, stag 45ms | `anim:'typewriter'` + `animOptions.wordDelayFrames` |
| 正文上推 | up d=.6 @+1.1 | `anim:'fadeUp'` |
| **SVG 路径生长** | EZ.inout 1.25→2.45s | **`shape:'path'` + `d` + `draw`**（E2 卡，几乎逐字对上） |
| 径向光晕 | canvas glow | `fx:'glow'` + shape circle |
| 卡片错峰入场 | 间隔 0.16s | 多轨错开 `startFrame` |
| 缓动集 | 7 档 | **13 档白名单**（我们更全，仅缺 Quint） |
| **hold 冻结** | 源 256.9 冻结 +12s | `animate` 窗口外保持末段终点（语义等价，`timing.ts:669`） |

### ⚠️ 能落但要降级

| 要素 | 问题 |
|---|---|
| 相机推近 | **非缺失，是能力对等** —— MotionGit 的 `cam(t)` 只有等比 z 缩放（我们 `animate.scale` 同级）；我们多一个 `orbit`（公转）它没有 |
| 音效事件 | `audio-timeline` 有 sfx 段（`startSec`/`gain`/`fade`），但**无 pan**（B2 用 ±0.2 交替声像） |
| 音效来源 | MotionGit 的 thud/write/swoosh 是 **numpy 程序化合成**（`native_audiolib.py`），零授权；我们是**素材路线**（CV-371：12 个 SFX + 授权账本） |
| 材质质感 | 金属字、玻璃卡 —— 我们无材质系统 |

### ❌ 真缺口（机制层，值得借）

| 缺口 | MotionGit 怎么做 | 我们的现状 |
|---|---|---|
| **槽位容量合同** | 每槽 `maxChars` + 超限**抛错** | 无。`manifest-contract.md` 只有 easing 白名单 + duration 缺省 |
| **字号自适应失败上报** | `fit()` 缩不下就 **throw** | **已有自适应但没人看**：`fitTextPolicy` 算出 `overflow` 后，`fitOrKeep` 只用它决定是否保留原文，**全仓无任何上报通道** ⇒ 文字被 `overflow:hidden` 静默裁掉 |
| **槽位↔源码位置绑定** | 469 槽，每槽带 `source: "broll.js:1310"` | 无 |

### 模板私有美术（不可借也不必借）

金属字 / 玻璃卡 / 36 颗火花 / 星空 —— 模板私有代码，不是可复用机制。

---

## 5. 方案：槽位合同层

### 5.1 落点：`manifest-spec.json` 的 `limits` 层

**不是** manifest 层。理由：

1. 真实生产里 manifest 由**脚本生成**（`make-spec.mjs` / `gen-v5.mjs`），脚本才知道上限 —— 合同落 spec 层可以零成本进生成器。
2. 内容写在 spec 里，容量约束就该在 spec 层声明、**编译前**校验；等 manifest 生成完再查已经晚一步（文案已写死）。
3. 我们已有四层合同（fact-spec / segment-lock / manifest-spec / versions），加 `limits` 是补齐第五层，不是另起体系。

### 5.2 合同形态

```jsonc
// manifest-spec.json 新增顶层键
"limits": {
  "defaults": { "maxChars": 24, "maxLines": 2, "overflow": "error" },
  "byVariant": {
    "title":    { "maxChars": 20, "maxLines": 2, "maxCharsPerLine": 12 },
    "bullets":  { "maxCharsPerLine": 16, "maxLines": 3 },
    "dataCard": { "maxChars": 12, "maxLines": 1 },
    "subtitle": { "maxChars": 40, "maxLines": 2 }
  },
  "captions":  { "maxChars": 34, "maxLines": 2, "fontSize": 30, "widthPercent": 92, "overflow": "error" }
}
```

**按 variant 声明，不按字段逐个声明** —— 我们的内容角色由 `textCard.variant` 决定，不是任意命名的字段；按 variant 声明，改版式时只动一处。

### 5.3 两条必须分开的语义

| 文本形态 | 含义 | 校验 |
|---|---|---|
| `text` 是**数组** | 作者**显式分行** | 数组长度 ≤ `maxLines`；每行 ≤ `maxCharsPerLine` |
| `text` 是**字符串** | 一整块，内部 `\n` 是**意外折行** | 总字数 ≤ `maxChars`；`\n` 行数 ≤ `maxLines` |

这正是 MotionGit `basic.points`（数组，每条 ≤2 显式行、每行 ≤18 字）vs `basic.explanation`（字符串，≤42 字、≤2 行）的区别。**初版原型把两者混为一谈，被真实数据当场纠正（见 §7.5）。**

### 5.4 三层校验（对齐 MotionGit 的两段式）

| 层 | 位置 | 做什么 | MotionGit 对应 |
|---|---|---|---|
| **L1 静态** | Node，`make-spec` 之前 | 字数 / 行数 / 数量，纯字符计数 | `adapter.py plan()` 的 `limits` 校验 |
| **L2 折行预检** | 渲染前（浏览器） | `canvas.measureText` 实测折行数 vs 轨高 | `fitBody()`（超 2 行即抛错） |
| **L3 溢出上报** | 渲染报告 | 把**已有**的 `overflow` 标志接出来 | `fit()`（缩不下即抛错） |

L3 的现状见 §7.3：**机制已在，缺的是出口。**

### 5.5 `overflow` 语义

`error`（默认，硬失败）/ `warn`（只告警）—— 与本仓「不静默截断」纪律一致。

---

## 6. 实测：容量合同原型

### 6.1 三组套件

| 套件 | 内容 | 结果 |
|---|---|---|
| **A · 合成 B1+B2** | 把 18s ground truth 反向翻译成我们 DSL 的等价 manifest（20 轨 / 6 槽），8 个正反用例 | **8 / 8** ✅ |
| **B · 真实「四季」spec** | `manifest-spec.json`（35 visuals + 10 captions）真实生产数据，7 个用例 | **7 / 7** ✅ |
| **C · 全库回归** | VideoOut 里 4 个真实 `manifest-spec.json` 全过一遍 | **4 / 4 全绿** ✅ |

套件 A 用例：合规 / 关键词超字数 / 必填槽漏填 / 解释超行数 / 要点超数量 / 要点单行超字数 / 引用不存在的槽 / single 槽被多轨消费。
套件 B 用例：合规 / 标题超字数 / 字幕折行超限 / bullets 单行超字数 / dataCard 标签超字数 / `overflow:warn` 降级 / 未声明 limits 时给提示。

### 6.2 与现有校验器的关系

把 B1+B2 manifest 喂进**真实的** `validateManifest`（`lib/remotion/manifest.js`）→ `ok = true, 0 errors, 0 warnings`。

新增的 `slot` 字段被 CV-334 的「契约外字段告警」机制正确归类 —— 说明**加字段本身只需登记进 `KNOWN_TRACK_KEYS`**，其余校验链零改动。

---

## 7. 实测推翻的五个判断（自我纠正）

### 7.1 「相机 / 逐字是我们缺的」——**错**

MotionGit 的 `cam(t)` 只有 `{x, y, z, r}`（等比缩放 + 平移 + 旋转），没有 `scaleX/Y`、没有透视；我们的 `animate.scale` + `orbit` 同级或更强。
它的 `charsAt` 只有**等间隔**错峰；我们的 `typewriter` 同样是等间隔。
**两边能力对等，MotionGit 并不更强。**

### 7.2 「P1 要加 `fontSize:{max,min}` 自适应」——**错**

`src/remotion/timing.ts:1142` 的 `fitTextPolicy` **早就有**：真实 `canvas.measureText` 测量、按 0.94×/轮缩字号、下限 `base × 0.55`、超 `maxLines` 置 `overflow`。
`TextCard.tsx` 的 `fitOrKeep` 已经在用它。

### 7.3 「真正缺的是自适应能力」——**错，真缺口是「溢出没人看」**

`fitTextPolicy` 算出的 `overflow` 标志，**只在 `fitOrKeep` 内部用来决定是否保留原文**。全仓 grep：无任何渲染报告 / 诊断 / lint 读取它。
结果：**文字缩不下时被 `overflow:hidden` 静默裁掉**。
MotionGit 的对应行为是**抛错**（`'Text cannot fit this native expression without changing meaning'`）。

**本方案自己的 manifest 就撞上了这个坑（实证）**：初稿把 B1 正文盒设为 900×105px，
用仓库**真实**的 `subtitleFitBudget` + `fitTextPolicy` 验算结果是
**24.2px 字号 / 2 行 / maxLines=1 ⇒ `overflow=true` ⇒ 被裁**，
而 `validateManifest` 依然报 `ok = true, 0 errors, 0 warnings` ——
**没有任何一层拦住它**。把盒高改到 140px 后才落回 44px / 2 行 / 0 问题。
验收脚本见 `check-fit.mjs`。

⇒ **P1 修正为：把已有的 `overflow` 标志接出来**，变成渲染报告里的硬错误 / 警告。改动量比原方案小一个数量级，且直接对应「不静默截断」纪律。

### 7.4 「槽位合同加在 manifest 层」——**错**

真实生产里 manifest 由脚本生成，spec 才是声明层。落点改为 `manifest-spec.json` 的 `limits`。

### 7.5 「数组多行 = 超行数」——**错**

全库回归时「spotFra」项目的 `hook-title` / `s6-title` 触发「超行数上限」。查下去是**作者有意的两行标题**（`["四季", "是因为离太阳远近吗？"]`）。
⇒ 补上 §5.3 的数组 / 字符串双语义，修完全绿。**这正是容量合同的价值：把「标题到底允许几行」这种从没写下来过的口径逼出来。**

---

## 8. 交付物与使用方式

### 8.1 文件

| 文件 | 用途 |
|---|---|
| `manifest-b1b2.json` | **可直接渲染**。20 轨 / 1920×1080@60 / 1080 帧 / 18 秒。零素材依赖。真实校验器 0 error 0 warning |
| `check-fit.mjs` | 逐轨验算脚本：用仓库**真实**的 `subtitleFitBudget` + `fitTextPolicy` 算每条文字轨的最终字号与是否溢出。**这是 P1 缺口的最小复现** |
| `manifest-spec-b1b2.json` | spec 层形态：含 `limits` 容量合同 + `content` 槽位内容（草案落点的样例） |
| `gen.mjs` | 生成上述两份的脚本（编排时刻全部标注了 MotionGit 源码出处） |

### 8.2 让 LLM 渲染它

`render_composition` 支持 `manifestPath`（绝对路径），免去内联 JSON 的入参截断风险：

```jsonc
// ① 先快验：只渲指定帧的静帧，不编码成片、不落画布节点
{ "manifestPath": "/abs/path/manifest-b1b2.json", "probe": true,
  "spotCheckFrames": [30, 66, 75, 534, 544, 553] }

// ② 再出整片
{ "manifestPath": "/abs/path/manifest-b1b2.json", "quality": "standard" }
```

建议 spot-check 帧（对应 MotionGit 关键编排时刻）：30 = 标题逐字、66 = 正文上推、75 = 路径生长起点、534 / 544 / 553 = B2 三卡错峰。

**渲染前先自查一次**（避免踩 P1 的坑）：

```sh
node check-fit.mjs manifest-b1b2.json    # 输出每条文字轨的最终字号与溢出判定
```

当前交付版本：**11 条文字轨全部 0 问题**（`b1-body` 44px/2行、`b2-card-*` 44px/1行、`b1-keyword` 84px、`b1-badge` 19px）。

### 8.3 编排对照（manifest 内的时刻全部来自 MotionGit 源码规格）

| 时刻 | MotionGit 规格 | 本 manifest 轨 | startFrame |
|---|---|---|---|
| 0.12s | badge mask 显入 d=.4 | `b1-badge` | 7 |
| 0.50s | keyword slam d=.28 stag 45ms | `b1-keyword` | 30 |
| 1.10s | body up d=.6 | `b1-body` | 66 |
| 1.25s | path 生长 →2.45s easeInOut | `b1-path` | 75 |
| 8.10s | B2 badge | `b2-badge` | 486 |
| 8.35s | B2 heading up d=.3 | `b2-heading` | 501 |
| 8.90 / 9.07 / 9.22s | 三卡错峰 0.16s | `b2-card-1/2/3-*` | 534 / 544 / 553 |

### 8.4 已知版式降级（渲染时会看到）

| MotionGit | 本 manifest | 原因 |
|---|---|---|
| 章节标签 22px 等宽芯片 | `subtitle` 变体（盒内贴底圆角胶囊） | **我们没有 chip 版式** |
| 金属立体字 | Noto Sans SC 700 粗体 | 无材质系统 |
| 玻璃卡（圆角 + 半透明 + 描边） | `shape rect` 实色块 | shape 无圆角/描边字段 |
| 卡片文字随卡片一起滑入 | 底板与左边条滑入，文字淡入 | **`box` 与 `animate.x` 互斥**（textCard 不豁免，shape 豁免） |

最后一条是一个**真实架构限制**：MotionGit 的卡片是「面板 + 文字同属一个 DOM 元素、一起动」，我们是「文字轨 + 形状轨分离」，位置声明互斥导致二者无法联动。⇒ 记为版式能力缺口（候选 P3：新增 `chip` / `topTitle` 版式 + 允许 textCard 的 `box` 与 `animate.x` 共存）。

---

## 9. 落地路线

| 档 | 动作 | 落点 | 代价 | 风险 |
|---|---|---|---|---|
| **P0** | `manifest-spec.json` 加 `limits`；`make-spec.mjs` 编译前跑 L1 校验 | `src/remotion/recipes.ts` 同源 | 小（纯函数 + 生成器一处调用） | 低。缺省不声明 `limits` 即不生效，旧项目零影响 |
| **P1** | 把 `fitTextPolicy` 的 `overflow` 接进渲染报告（硬错误或警告） | `src/remotion/render-report.ts` + `TextCard.tsx` | 中（要动组件侧出口） | 中。需与 `fitOrKeep` 的「老 manifest 逐像素不变」铁律共存。**本方案自身的 manifest 已撞上此坑并实测复现**（§7.3） |
| **P2** | L2 折行预检接进 `render-preview` | `src/client/render-preview.ts` | 中 | 中。浏览器测量需与 CSR 渲染器口径一致 |
| **P3** | 新增 `chip` / `topTitle` 版式；允许 textCard 的 `box` 与 `animate.x` 共存 | `manifest.ts` variant 枚举 + 互斥校验 | 中大 | 大。动互斥规则 = 动位置语义 SSOT |

**建议顺序**：P0 先落（把口径写下来，零渲染层改动）→ P1（MotionGit 的核心护城河，且机制已在）→ P2/P3 视排期。

**边界提醒**：这套合同解决的是**「内容放不下」**。MotionGit 的「模板自带艺术资产」（金属字、玻璃卡、星空）是模板私有代码，不可借也不必借 —— 那是资产问题，不是机制问题。

---

## 10. 复现路径

```sh
# E0 ground truth
cd /tmp/motion_probe_2026/x            # #385712 解压目录
python3 -m venv .venv && .venv/bin/pip install numpy scipy soundfile pyloudnorm jsonschema
npm ci
.venv/bin/python adapter.py plan --input ../run/user.json --out ../run/plan.json
.venv/bin/python adapter.py prepare --input ../run/user.json --out ../run/instance
node /tmp/motion_probe_2026/render-local.mjs --root run/instance --out-dir run/frames_out
ffmpeg -framerate 60 -i frames/%05d.jpg -vf "<7.1.1 兼容 gamma 链>" ... silent.mp4
.venv/bin/python mix.py --instance ../run/instance --silent-video ../run/silent.mp4

# 容量合同原型
cd canvas-studio/docs/plans/2026-11-10-视频模板化
node 原型-run-cases.mjs   # 合成套件 8/8
node 原型-run-real.mjs    # 真实四季 spec 7/7
```
