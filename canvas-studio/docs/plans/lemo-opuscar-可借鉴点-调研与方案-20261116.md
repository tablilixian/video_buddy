# lemo-opuscar 可借鉴点：调研与我们该怎么改（2026-11-16）

> **状态**：调研 + 方案讨论稿，**未立项**（立项时按 `docs/STATUS.md` §4.1 取号，候选 REQ-041，取号前需 `git log` 复核）。
> **触发**：用户读到公众号文章《霸榜 GitHub 的 1.4 万星 Skill…》→ 要求「摸准、整理成文档」，并就「模板」与「长视频」两件事先讨论。
> **口径**：本文所有关于 lemo-opuscar 的结论都来自其公开仓库原文（`DIRECTOR.md` / `TECHNIQUE.md` / `styles/README.md` / `styles/dataviz/STYLE.md` + `DEMO.md`），
> 所有关于我们的结论都在**本仓库当前代码**里核实过（带 `file:line`）。未核实的猜测一律标注「待核」。

---

## §0 TL;DR

| # | 他们的做法 | 我们的现状 | 结论 |
|---|---|---|---|
| 1 | `readcheck.mjs`：字幕停够不够人读，公式化 | 只有「太稀」下限（2.5 字/秒），**没有「太快读不完」上限** | **P0 借鉴**：加可读性上限闸 |
| 2 | `DIRECTOR.md`：导演手册（故事/声音/节奏/镜头/表演/自检） | 只有规格文档（卡目录/能力/几何），没有创作判断层 | **P0 借鉴**：写 `director.md` |
| 3 | `STYLE.md` + `DEMO.md` + `engine.js` + `timeline.js` 的**风格包** | 58 张卡（部件）+ style-grid 映射（无参考片、无引擎、无差异要求） | **P1 改造**：做「参数化风格包」，**不做 99 套引擎**（§4） |
| 4 | treatment 先写，再看 demo；**六个方面至少四处必须不同** | 无 | **P1 借鉴**：行为闸，落 SKILL 纪律 + 工具描述 |
| 5 | 单一 `timeline.js`（BPM + beat + 秒）驱动画面/音乐/字幕/校验，`cuecheck` 0 ms | 单一时间源是 `planStages` 6.5 s 均分；**无音乐网格、无 cue** | **P1 借鉴**（部分）：节拍层是「好看」的来源，但成本高；先做「每屏时长可解释」 |
| 6 | 音频是上游：旁白定稿 → TTS → ASR 回读 → 按真实时长排镜头 | 时长先拍死；`audio.voiceOver` 已支持多句（O-10），但无 ASR 核对 | **P1 借鉴**：ASR 回读 + 音频驱动时长 |
| 7 | 事实来源 `FACTS.md`（每条事实带 URL 与原文） | 无 | **P1 借鉴**：spec 加来源字段或 write_note 约定 |
| 8 | 地图合规硬红线（不画国界 / 中国按标准图 / 台湾港澳不作为国家列示） | 无地图卡 | **P2 记档**：做地图卡时直接照抄这条规则形状 |
| 9 | 99 套风格 = 99 套引擎（作者用 Opus 5.5 堆出来的资产） | — | **不抄**：我们做「1 套卡引擎 + N 组参数」（§4.3） |
| 10 | 默认 30–60 s，>2–3 分钟明确告警成本翻倍 | `MAX_STAGES = 40`（≈4.3 分钟）硬顶，超了直接 throw | **改造**：不是把上限调大，而是加 chapter 层（§5） |

---

## §1 他们的架构事实（可验证）

### 1.1 一个「风格包」里装什么

```
styles/<slug>/
  STYLE.md        # 风格规格：essence / materials / colour logic / type / motion / camera grammar / sound palette / native moves / pitfalls / engine / variation space
  DEMO.md         # 我们的 demo：story & structure / shots / score structure / palette & props / end card / build notes / engine reference
  style.json      # 单一元数据源 → styleboard/build.py 生成索引，索引文件头写着 "do not edit by hand"
  poster.jpg      # 海报（交付前把 contact sheet 贴在它旁边做最后对照）
  demo/
    timeline.js   # 单一时间源：BPM 网格、year→beat 映射、图表几何
    engine.js     # 风格引擎：drawPaper / applyCam / pencilStroke / inkShape / handText / dataDot / morphMark / drawPencil / caption
    film.js       # 这部片的故事：注释、机位路径、铅笔动作、图层、落版、事件
    music/score.py
    mix.py        # ambience + foley + 旁白 + ducking
    tools/        # words.py / subs.py / cuecheck.py / final_asr.py
    data/         # 数据集原件 + 抽取脚本产物
```

三个可迁移的结构，比内容本身更值钱：

1. **`style.json` 是唯一元数据源，索引由脚本生成**，手改索引被明确禁止。这正是我们 R11 刚立的规矩（三个生成器 + 漂移闸），他们已经跑成熟了 —— **印证方向，不需要学新东西**。
2. **`STYLE.md` 与 `DEMO.md` 分工**：前者是**规格**（长什么样、允许怎么动），后者是**参考片**（我们这一支是怎么做的、每个数字为什么这么定）。我们的 references 全是前者，**没有后者**。
3. **`engine.js` / `film.js` 分工**：引擎与故事分离。所以我们能「换内容复用引擎」，他们能靠 `--q 'content=alt.json'` 重出另一版。我们的对应物是「卡（引擎）」与「spec（故事）」，**这一层我们已经对了**。

### 1.2 文档分工（三份，缺一不可）

| 文件 | 回答什么 | 我们有没有 |
|---|---|---|
| `DIRECTOR.md` | 怎么导演：故事、声音、节奏、镜头、表演、自检、交付物、版权红线、地图红线 | ❌ |
| `TECHNIQUE.md` | 怎么构建：逐帧渲染、配音、配乐、混音、字幕、评审循环、3D/角色 | 部分（渲染链有实现，但无「怎么做」文档） |
| `styles/<slug>/STYLE.md` | 这个风格长什么样、听感怎样、有哪些 native moves | 部分（style-presets，但只有配色/映射） |

`DIRECTOR.md` 里几条**可直接搬**的硬规则（原文搬到我们语境）：

- **前 3 秒必须有钩子**，不要先做 logo 揭示。
- **一个主题、一个目标、一次转折**；结尾回扣开头。
- **一个 native move**：这个媒介才能做的那一刻（放在情绪峰值）。
- 节奏：**快慢要交替**，全片匀速＝失败；「快」是靠**每屏字更少**实现的，不是靠**没读完就切**。
- 字幕停留：**≥ max(1.8 s, 语音长度 + 0.6 s)**；中文停留 ≈ `字数 ÷ 4.5 + 1.5` s，英文 ≈ `字母数 ÷ 15 + 1.5` s；标题卡 ≥ 4 s。
- 声音三层（环境 / 拟音 / 音乐），**至少两处真静默**，静默后的第一个声音最重要。
- 镜头：**至少四种不同运动**；主体在关键时刻占画面高度 ≥ 1/3。
- **一处只修一轮**：第一轮把评审 + 自检发现的全修掉，再确认一次。

### 1.3 流水线（一颗时间源喂四条线）

```
timeline（单一真源）
 ├─► 画面：网页 render(t) → 无头 Chrome 逐帧 JPEG → video.mp4
 ├─► 旁白：逐句 TTS → 语音转文字核对（ASR）→ 词级时间戳
 ├─► 音乐：同一 timeline 生成乐谱（采样 + 合成）→ stems
 ├─► 声音：按事件时间程序化生成拟音
 └─► 字幕：.srt + 烧进画面
混音（duck / 压缩 / 平衡）→ ffmpeg 两遍 loudnorm −14 LUFS → film.mp4
```

硬约束（值得抄的是**约束的形式**，不只是内容）：

- **确定性**：禁 `Date.now()`、禁无种子随机、帧间不传状态 ⇒ 任意帧可独立渲染、可乱序、可多 worker。**我们 remotion 已同构**（禁 CSS transition/animation、插值纯函数），这条是共识，不必改。
- **画面是时间的函数**：`window.DUR` / `render(t)` / `READY` / `EV` / `TEXTS(t)`。我们对应 `manifest` + `durationInFrames`。
- **JPEG 截图 + 每 worker 一个浏览器 + 颗粒交给 ffmpeg**：颗粒画在页面里会让每帧都不可压缩。
- **实测吞吐**：1200 帧 ≈ 30 s（2 workers）；一支 50 s 片 `build.sh` 全量重建 ≈ 2 分钟。**这个数字我们要自己测**（§5.4）。

### 1.4 质量闸（可量化的部分）

| 闸 | 做什么 | 关键数字 |
|---|---|---|
| `readcheck.mjs` | 每段屏上文字停留够不够读 | 或 `TEXTS(t)` 里标 `pass:true`（路过不算读） |
| `cuecheck.py` | 每个视觉 hit 与音乐 cue 对位 | 107 个 cue，最大偏差 0.03 ms |
| `asr_check.py` | 旁白逐句转写回对稿 | 中文短句偶有近音，人工听后把模型听到的写进 `asr` 字段 |
| 评审循环 | contact sheet ×2 遍、0.2 s 关键动作条、整片带声看一遍 | — |
| `ffmpeg blackdetect` / `ebur128` | 空帧、响度 | −14 LUFS |
| 交付前对照 | contact sheet 与 `poster.jpg` 并排 | — |
| **≥4/6 差异** | 与 demo 比：结构、开场、标志镜头、机位路径、配乐形状、结尾 | 至少四处不同 |

---

## §2 我们的现状（本轮核实，带位置）

| 能力 | 现状 | 位置 |
|---|---|---|
| 结构校验 | `validateManifest`：schema 全量 errors，一次列全 | `src/remotion/manifest.ts:1827` |
| 离线体检 | `manifest-audit.ts` 三件套（schema + `lintMotion` + `auditTextFit`），只读；唯一工具入口 `validate_manifest` | `src/manifest-audit.ts:65`、`src/host-tools.ts:4968` |
| 编排体检 | `lintMotion`：只 warn、上限 12 条、`meta.lint:'off'` 可关；ML-16 阈值 25%（同屏元素 ≤1 的帧占比） | `src/remotion/motion-lint.ts:41`、`:44` |
| 密度体检 | `density-audit.ts`：**只有下限** `DENSITY_CHARS_PER_SEC_FLOOR = 2.5`（1 秒 2 字＝太稀） | `src/remotion/density-audit.ts` |
| 文字容量 | `text-fit-audit.ts`：渲前在 client prepare 阶段做，结果进 `report.textFit`，**只报不拦**（D-19） | `src/remotion/text-fit-audit.ts`、`src/client/remotion-render.ts` |
| 时间源 | `planStages`：`TARGET_STAGE_SEC = 6.5` / `MIN 4` / `MAX 10` / `MIN_STAGES 2` / **`MAX_STAGES 40`**；超 400 s 直接 `throw` | `src/remotion/stage-plan.ts:27-35`、`:158` |
| 时长输入 | `meta.durationSec` ∈ (0, 3600]；`sections[].durationSec` 或 `weight` 二选一；`autoStages` 时 sections 只带内容 | `src/remotion/content-spec.ts:329`、`:364`、`:113` |
| 旁白 | `audio.voiceOver` **数组已支持多句**，与单轨 `voiceOverUrl` 互斥（O-10） | `src/remotion/manifest.ts:2492` |
| 字幕 | `CaptionTrack` 存在 | `src/remotion/manifest.ts:910` |
| 渲染 | CSR：`render-job.ts` 内存 Map → `/remotion/pending` 轮询 → `/remotion/commit`，宿主 ffmpeg 复核 | 见 PROJECT-NOTES「CSR 渲染链路」 |
| 卡目录/能力/几何 | 三份生成文档 + 漂移闸（R11 刚落地） | `references/*.generated.md`、`tests/*-drift.test.mjs` |

**结论**：我们缺的不是「校验」，是**「看起来会不会好看」这一层**。具体三个洞：

1. **只有「太稀」没有「太快」** —— 2.5 字/秒是下限，没有上限。所以「一屏 40 字挤 1.2 秒」这种必然读不完的片，**任何闸都不响**。
2. **只有「部件」没有「风格」** —— 58 张卡能拼出合法画面，但「这套配色+这套卡+这个节奏」作为一个整体没有任何地方被固化，每次都在重新发明。
3. **长片被硬顶 40 屏 / 400 秒** —— 想讲 3 分钟以上的东西，`autoStages` 直接 throw，只能关掉它自己排，而「自己排」没有任何一致性保障。

---

## §3 值得借鉴的六条（按性价比排序）

> 每条给：他们怎么做 → 我们落在哪 → 验收判据。成本估：S（半天内）/ M（1–2 天）/ L（3 天以上）。

### P0-1 `readability-audit`：把「读不完」变成可判定 · **S**

- **他们**：`readcheck.mjs` + `TEXTS(t)`，公式 `中文 字数÷4.5+1.5 s`，并配「字幕停 ≥ max(1.8 s, 语音+0.6 s)」。
- **我们**：新建 `src/remotion/readability-audit.ts`（纯函数，与 `density-audit.ts` 同构），输入 manifest + fps，输出每条文字轨的 `cps`（字/秒）与停留时长；
  **上限**建议中文 `cps ≤ 9`（≈4.5 字/0.5 s 的舒适区上沿，需标定），**下限**复用现有 2.5；标题卡 ≥ 4 s。
- **落点**：并进 `manifest-audit.ts` 的体检三件套 → 第四件；`scaffold_manifest` / `validate_manifest` 回执里直接出现「第 3 屏结论条 14 字只停 1.1 s，建议 ≥ 3.1 s 或砍到 8 字」。
- **判据**：拿真机那条「40 字 1.2 秒」的片跑，必须红；把停留加长后必须绿。**反向变异**：把阈值改成 99 必须不响（证明判据真的在用）。
- **不做**：不拒收（沿用 D-19：只报不拦，避免误杀有意设计）。

### P0-2 `director.md`：补一层创作判断 · **S**

- **他们**：`DIRECTOR.md` 13 节，全部是可判断的句子，不是感想。
- **我们**：`skills/code-driven-explainer/references/director.md`，内容按我们题材裁（图文卡片 / 数据 / 竖屏）：
  钩子 3 秒、每屏一义、结论不成段、快靠少字不靠抢读、镜号与运动至少四种、至少两处静默、结尾回扣。
  **每条必须带一句「怎么检验」**，否则就是感想。
- **判据**：拿 R11 的变体 A 六屏对照，至少能指出 2 处「违反」并给出改法；如果一条都指不出来，说明写的是废话，重写。

### P1-3 参数化风格包（见 §4）· **M–L**

### P1-4 treatment + 「≥4/6 差异」闸（见 §4.4）· **S**

### P1-5 音频驱动时长 + ASR 回读 · **M**

- **他们**：旁白定稿 → TTS → whisper 回读逐句核对 → 词级时间戳 → 排镜头。换声后时长从 62.9 s 变 76.7 s，字幕全乱（坑 03），所以他们把「音频时长」当上游。
- **我们**：`meta.durationSec` 是先拍死的；`audio.voiceOver` 已支持多句（O-10）。
- **改法分两步**：① 先做**核对**（TTS 后 ASR 回读，逐句比字，不一致就报），风险低、见效快；② 再做**驱动**（TTS 真实时长回写 `sections[].durationSec`，重排屏表）。
  第 ② 步会动到「时长是用户输入」的语义，需要单独设计，**不建议与本轮混做**。
- **判据**：故意让 TTS 念错一个数字（如把「2859」念成「二八五九」），核对必须红。

### P1-6 事实来源（`FACTS.md` 的轻量版）· **S**

- **他们**：说事实的片子必须留 `FACTS.md`，每条事实带 URL 与原文引用。
- **我们**：不新增文件类型（会与我们「不落垃圾文件」的习惯冲突），改成 **spec 的 `sections[].source` 可选字段**（字符串），校验只查「非空」；
  回执里统计「有来源的屏 / 总屏数」。数据类题材 < 50% 时给 warning。
- **判据**：给一个 6 屏数据片全部不写 source，warning 必须出现。

### P2-7 地图合规红线 · **S（但等有地图卡再做）**

他们 `DIRECTOR.md` §13 把地图写成硬红线：不画国界、中国按标准图（台湾/海南/南海诸岛与钓鱼岛赤尾屿、藏南与阿克赛钦按我国标准）、台湾港澳不作为国家列示、数据字段清洗后再上图。
我们要做地图卡时**直接照抄这条规则的形状**（写成 reference 的一节 + 校验项），不要临场发挥。

---

## §4 「模板」：他们怎么做的，我们该做什么

### 4.1 他们的模板不是一个文件夹，是「四条腿」

| 腿 | 内容 | 为什么必须有 |
|---|---|---|
| 规格 | `STYLE.md`（材料、色彩逻辑、字体、运动质量、镜头语法、声音调色板、native moves、坑） | 没有规格，agent 每次自由发挥＝每次都不一样 |
| 参考片 | `DEMO.md` + 成片 + 静帧 + poster | 没有参考片，「好看」无法被对齐，只能靠形容词 |
| 引擎 | `engine.js`（这个风格的画笔与相机） | 引擎与故事分离，才可能「换内容复用」 |
| 时间源 | `timeline.js`（BPM、beat、几何） | 没有时间源，画面/音乐/字幕永远对不上 |

**关键一条**：`DEMO.md` 开头就写「One example among many. Don't reuse its story, arc, shots, props or timings.」——
模板的用法是**当基线**，不是**当答案**。

### 4.2 他们的索引是生成的，不是维护的

`styles/README.md` 文件头：`<!-- generated by styleboard/build.py from styles/*/style.json; do not edit by hand -->`。
99 个风格 × 15 分类 × 中英双语 × 曾用名，全部从 `style.json` 生成。
**这条我们已经在做**（`gen-card-catalog.mjs` / `gen-spec-capability.mjs` / `gen-spec-geometry.mjs` + `--check` 漂移闸），
所以「做模板」的正确姿势是**先定 `style.json` 的字段，再让索引/画廊/回执从它生成**，而不是手写 5 份文档。

### 4.3 我们不做 99 套引擎，做「1 套卡引擎 + N 组参数」

**为什么不做**：他们的 99 个风格 ≈ 99 支独立引擎，是作者用 Opus 5.5 在几个月里堆出来的资产；
我们照抄等于要写 99 套画笔。ROI 极低，而且我们的差异优势本来就在「58 张可组合的卡」。

**我们该做的三层**（对齐他们四条腿，但最小化）：

```
L1 风格包（参数，不是代码）：skills/code-driven-explainer/styles/<slug>.md
   前端字段（style.json 单一源）：
     palette / type / motion（缓动与节奏档） / cards（推荐卡组合） / grade（色温颗粒） / sound（音乐情绪）
   ← 生成 → styles-catalog.generated.md（索引）+ 回执里的「本片风格 = X，卡组合 = …」
L2 卡包（已有 58 卡）：不动，继续当部件层
L3 模板片（template spec）：每个风格配一条 30–40 s 的 spec + 成片静帧 + poster
   ← 必须真渲过，没渲过的模板只是文案
```

**先做几个**：3–5 个，按我们真实题材选（数据解说 / 科普图卡 / 产品发布 / 情绪独白 / 纪实拼贴）。
每个的成本 = 一条真片 + 3 张静帧 + 一份 200 字规格。**不达标就别挂上去**，否则又是「假信息」。

**与现有 style-grid 的关系**：现在 `style-presets.md → style-grid.ts → catalog demo: → assets/style-demos/` 四处映射，
改一个风格要四处同改（R11 记忆里已列为脆弱点）。风格包上线时**顺手把它收成单一源 + 生成**，一次解决。

### 4.4 treatment 前置 + 「≥4/6 差异」

- **treatment 前置**：agent 必须先写 `TREATMENT`（三个候选结构 → 选一 → 一句 logline → 逐镜目的 → 逐秒节拍 → 声音表），**再看模板片**。
  落点：`canvas-studio-creation/SKILL.md` 的流程第一步（与「意图卡是第一个动作」并列，不冲突）。
- **≥4/6 差异**：与模板片比「结构 / 开场 / 标志镜头 / 机位或运动路径 / 音乐形状 / 结尾」，至少四处不同。
  落点：`scaffold_manifest` 的工具描述（模型每步都看得到）+ 一条 lint（模板片 id 与差异声明一起进 manifest 的 `meta.template`，缺声明就 warning）。
- **判据**：拿模板片原样复刻，必须被打回；改四处后必须放行。

---

## §5 「长视频」：他们其实没做长视频（这一点很关键）

### 5.1 他们的真实口径

- `DIRECTOR.md` 默认 **30–60 s**；原文：「Beyond two or three minutes multiplies time and token cost: tell the user.」
- 唯一超过 3 分钟的成片是《OPUSCAR 98》（6:31）—— 但它是 **98 支短片按主题拼成的蒙太奇**，不是一条连续长叙事。
- 也就是说：**他们的长片能力 = 「多段同语法拼装 + 一条时间源贯穿」，不是「把单片拉长」。**

### 5.2 我们现在的硬顶

`planStages`：`MAX_STAGES = 40`、`MAX_STAGE_SEC = 10` ⇒ 400 s 以上 `throw`，
注释写得很清楚：「40 屏 ≈ 4.3 分钟全 6.5s 屏，再长就该拆需求而不是拆屏」。
这条判断**本身是对的**，问题在于我们**没有「拆」的机制** —— 只有「关掉 autoStages 自己排」，等于把一致性交给模型。

### 5.3 我们的长视频方案：加一层 chapter，而不是调大上限

```
spec.meta.durationSec（唯一外部输入，≤3600）
  └─ chapters[]（新增，可选；不写就是单章，零回归）
       ├─ id / title / durationSec（章预算）
       ├─ recipe：本章统一版式常量（cell 布局 + 卡组合）← 跨章一致性的锚
       └─ sections[]（每章 ≤40 屏，仍由 planStages 或显式时长排）
```

四条规则：

1. **一片多章，章内仍受 `MAX_STAGES 40` 约束** —— 上限不调大，长片靠「多章」而不是「多屏」。
2. **`recipe` 是章级常量**：同一部片的版式如果想一致，各章 `recipe` 必须相等（校验器直接比）；想变就显式写 `recipeOverride` 并给理由，避免「越写越飘」。
3. **渲染按章分段**：每章一个 render job，可续渲、可并行、进度按章显示。3.5 分钟 = 5 章 × 42 s，用户能看到进度而不是干等。
4. **音频按章切**：`audio.voiceOver` 已支持多句（O-10），章节边界就是 bgm 的 duck/交叉点，不需要新机制。

**验收判据**：3 分半 36 屏（R11 文档 §3.3 的「输入 B」）能一次出片；中途失败能只重渲失败的那一章。

### 5.4 动手前必须先测的一个数字

他们的吞吐：**1200 帧 ≈ 30 s（2 workers）**、50 s 片全量重建 ≈ 2 分钟。
我们的 CSR 是浏览器内渲染 + `/remotion/commit` + 宿主 ffmpeg 复核，**没有公开的每百帧耗时**。
**先测**：同一 manifest（1080p / 30 fps / 40 屏）分别渲 10 s 与 40 s，量「每百帧耗时」与内存峰值。
如果 3.5 分钟片要 20 分钟以上，那 chapter 分段渲染不是优化项而是**必需项**（否则用户等不下去）。

---

## §6 落地清单（建议分三批）

| 批次 | 内容 | 成本 | 前置 |
|---|---|---|---|
| **第 1 批（可当轮做）** | P0-1 `readability-audit`（含反向变异）+ P0-2 `director.md` | S+S | 无 |
| **第 2 批** | P1-4 treatment + 4/6 差异闸；P1-6 `source` 字段；渲染吞吐实测 | S+S+S | 第 1 批的 lint 框架 |
| **第 3 批** | §4.3 风格包（先 3 个）+ §5.3 chapter 层 | M+L | 吞吐实测结果；风格包要先定 `style.json` 字段 |

---

## §7 明确不做 & 理由

1. **不做 99 套风格引擎**：那是资产不是方法；我们做参数化（§4.3）。
2. **不抄「一页连续变形」的 morph 叙事**：`timing.ts` 有纯函数插值，理论上能做，但跨形态 morph 是独立工程量级，先记档。
3. **不把 `MAX_STAGES` 调大**：那会把「拆需求」变成「堆屏」，一致性只会更差。
4. **不引入 beat/BPM 时间源（本轮）**：`cuecheck` 的收益在音乐驱动的片子里最大，我们多数题材没有原创配乐；等有配乐需求再上。
5. **不做 `GRAIN` / 3D / 角色骨骼**：与我们的图文卡片路线无关。

---

## §8 证据索引

| 来源 | 用到的内容 |
|---|---|
| `github.com/lemomo-ai/lemo-opuscar` · `DIRECTOR.md` | 13 节导演方法；30–60 s 默认；字幕停留公式；≥4/6 差异；交付物清单；版权与地图红线 |
| 同上 · `TECHNIQUE.md` | 流水线图；`render(t)` / `DUR` / `READY` / `EV` / `TEXTS`；确定性约束；JPEG+多 worker；`readcheck.mjs`；ASR 核对；混音 −14 LUFS；评审循环 |
| 同上 · `styles/README.md` | 文件头 `generated by styleboard/build.py … do not edit by hand`；99 风格 / 15 分类；✦ 标记（需用户自备出图工具） |
| 同上 · `styles/dataviz/STYLE.md` | 风格规格的 11 节结构；「Don't reuse its story…」；native moves 菜单；坑清单 |
| 同上 · `styles/dataviz/DEMO.md` | 参考片怎么记录：故事结构 / 镜头表 / 配乐结构 / 色板 / 落版 / build notes；1200 帧 ≈30 s；cuecheck 107 cues ≤0.03 ms；90 BPM 与 24 fps 的整除关系 |
| 公众号文章（MagicX，2026-11-10） | 第三方复现经验：无 Claude 也能走完流程；换声导致时长爆掉；字幕读不完是最高频返工；brag（20.8k★）反而有 8 秒空镜 |

---

## §9 待用户拍板的三件事

1. **第 1 批是否立刻做**（readability-audit + director.md，约 1 天）？
2. **模板的粒度**：按 §4.3 做 3–5 个参数化风格包，还是先只做 1 个（数据解说）试水？
3. **长视频的形态**：chapter 层（§5.3）是否符合你的预期？特别是「章内仍 40 屏封顶、章间靠 recipe 保证一致」这条。
