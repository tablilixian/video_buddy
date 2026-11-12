# video-shotcraft 借鉴落地计划（VS 系列，2026-11-12）

> **依据**：`docs/2026-11-12-remotion技术路线与开源对标.md`（路线定性）+
> `docs/2026-11-12-video-shotcraft-dsh-借鉴评估.md`（资产盘点）+ 仓库源码核实。
> **无 CV 号**（未取号，按铁律不预领；验收通过后再按三层登记）。
> **编号用 `VS-xx`**（video-shotcraft；`CV`/`RP`/`O` 号段均不复用，与 RP 系列同先例）。
> **定位**：不是「抄一个开源项目」，而是**把 152 张镜头卡里能跨路线复用的部分，
> 按我们已有的三种资产形态（知识分册 / 能力原语 / 结构模板）各归其位**。
> **一句话原则**：**手法与参数可以学，代码只挑纯函数级的，表达一律不复刻。**

---

## 0. 一页结论

对方是 Route A（agent 写 Remotion TSX + `remotion render` 起 headless Chrome），
我们是 Route B（agent 写 JSON manifest + WebCodecs 客户端渲染）。路线不可迁移，
但**它的配方卡是跨路线资产**——那 152 张卡里最值钱的是「参数表 + 已知坑」，不是 TSX。

因此分四条轨道推进，**按成本从低到高、每批独立可验收**：

| 轨道 | 做什么 | 条目 | 成本 | 风险 |
|---|---|---|---|---|
| **A 知识层** | 卡片的数值与直觉 → skill 分册 | VS-01~05 | 1–2 天 | 零（纯文本） |
| **B 能力层** | 纯函数级动效 → 新 `preset` / 新字段 | VS-06~08 | 2–3 天 | 低（只增不改） |
| **C 结构层** | 段序列 → `assets/templates/` | VS-09 | 3–5 天 | 中（需拍板模板粒度） |
| **合规留痕** | Apache-2.0 溯源写进 NOTICE | VS-10 | 0.5 天 | 零（**必须最先做**） |
| **D 缺口立项** | 多关键帧相机 / 截图采集链 | VS-11~12 | 另立项 | 高（新能力） |

**不做**：整包 vendor（会把我们绑进第二套渲染路线 + 两跳溯源 + 别人的品牌模板）。

---

## 1. 分流判定：一张卡该进哪条轨道

每次拿一张卡，先回答「**要表达它，我们缺的是什么**」，四个答案对应四个落点：

| 缺的是 | 落点 | 形态 | 例 |
|---|---|---|---|
| **数值与直觉**（时序、缓动、幅度、坑） | skill 分册 | 文本 | `blur-slide`（我们已有 `wordStagger`） |
| **一个新的运动函数**（算法本身我们没有） | `TextAnimPreset` / `fx` / 新字段 | 代码（纯函数） | `split-flap-title`（翻牌） |
| **一段新的时间轴结构**（动效是已有能力的排列组合） | `assets/templates/<family>/<id>/` | JSON 模板 | 发牌飞入 + 滚动 + 搜索的三段序列 |
| **CSR 不支持的东西** | **不借** | — | 24 个 `zIndex` demo、11 个 `mixBlendMode`/`backdropFilter` demo |

> ⚠️ 分流判据的实操写法：打开卡片的「动效核心」段。**如果它全部能用现有的
> `animate` / `orbit` / `draw` / `reveal` / `fx` / `anim` 字段拼出来 ⇒ 轨道 A 或 C；
> 如果里面出现了我们没有的函数（翻牌矩阵、随机乱码、逐位滚轮）⇒ 轨道 B。**

---

## 2. 批 A · 知识层（零代码，先做）

### VS-01 建立「卡片分流索引」

| 项 | 内容 |
|---|---|
| 改什么 | 新建 `skills/code-driven-explainer/references/shot-recipes.md`：把 152 张卡按 **10 类 × 我们的能力映射**列成表（卡名 / 一句话 / 我们能不能做 / 走哪条轨道 / 对应分册锚点） |
| 落点 | 新分册；`SKILL.md` 只在「需要动效范式时」加一行指针（入口 ≤12KB 硬闸，只许等量置换） |
| 验收判据 | 表里 152 行齐全；每行「走哪条轨道」有值；`skill-tool-refs` / skill 门禁全绿 |
| 成本 | 0.5 天 |

### VS-02 文字 reveal 参数册（25 张卡里挑 12 张）

| 项 | 内容 |
|---|---|
| 改什么 | 新建 `references/text-reveal.md`：按「**参数表 + 已知坑**」的原始密度收录，不压缩成一句话。优先级：`blur-slide`、`type-entrance-moves`、`flying-words`、`split-flap-title`、`vertical-word-roll-blur-cycle`、`scramble`、`glitch-cycle`、`gradient-word-sweep`、`outline-word-fill`、`marker-underline-title`、`brace-expand`、`text-column-converge` |
| 为什么是这 12 张 | 前 3 张我们**已经能做**（`anim: wordStagger` + `animOptions`），写清参数映射即可立刻见效；中间 5 张是「轨道 B」的候选清单；后 4 张是低成本增强 |
| 落点 | 新分册 + `animation-and-assets.md` 加一行指针（不重复内容，避免两处漂移） |
| 验收判据 | 每张卡都写出**我们这边的等价写法或"暂不支持"**；中文断词口径写明（我们 `splitTextUnits` 是 CJK 逐字 / 拉丁逐词，比它 demo 的 `split(' ')` 更好，直接沿用并注明） |
| 成本 | 0.5 天 |

### VS-03 运镜关键帧表（camera 10 张）

| 项 | 内容 |
|---|---|
| 改什么 | `references/animation-and-assets.md` 追加「运镜关键帧」段：把 `basic-3d-scene` / `overhead-camera-moves` / `steep-tilt-glide` / `crash-zoom-punch` / `depth-layer-moves` 的关键帧**改写成我们的 `animate[]`（from/to + 多段）** 形式，附数值 |
| 为什么 | 我们有真 3D（`rotateX/rotateY/z/perspective`，能力基准 #12 实证）+ `orbit`，能力够但**模型不会自己算关键帧**——这是最直接的收益点 |
| 验收判据 | 每条运镜给出可直接粘的 `animate` 片段；`manifest-contract-doc.test.mjs` 若断言到该文件需同步 |
| 成本 | 0.5 天 |

### VS-04 节奏卡点口径对齐（rhythm 11 张）

| 项 | 内容 |
|---|---|
| 改什么 | `skills/canvas-studio-creation/references/audio-first.md` 补「`beatF(n)` → 我们的帧号」换算段：先用 `analyze_beats` 拿真实 BPM/相位，再按拍号写 `startFrame`；并把它的「稀疏重音钉真实瞬态而非网格插值」纪律并进 |
| 为什么 | 我们已有 `analyze_beats` / `snap_cuts_to_beats`（CV-380），但 skill 里没有「怎么把拍号写进 manifest」的范式 |
| 验收判据 | 给同一段 BGM，模型能产出「按拍起切」的 manifest；`snap_cuts_to_beats` 返回的偏移被真正用上（不易离线断言，列为真机观测项） |
| 成本 | 0.5 天 |

### VS-05 审美准则并入观感体检（Q1~Q9 + 已知坑）

| 项 | 内容 |
|---|---|
| 改什么 | 从 `references/aesthetic-rules.md` 与各卡「已知坑」提炼 **5 条可机检规则**，作为 `motion-lint` 的新 ML 条目（**只 warning，不拒收**）。候选：① 关键信息落定后必须有 ≥8f 静置；② 同片重复同一手法（同一种入场出现 ≥3 次）告警；③ 批量元素逐个发光（装饰性 glint 群发）；④ 单镜时长 <15f（读不完）；⑤ 主副字重倒挂 |
| 落点 | `src/remotion/motion-lint.ts`（新规则）+ `tests/remotion-motion-lint.test.mjs`（表测） |
| 验收判据 | 每条规则有正例/反例各 1；**反向变异**：删掉判据必须变红；全量 smoke 不新增红 |
| 成本 | 1 天（含反向变异） |

---

## 3. 批 B · 能力层（小改，只增不改）

### VS-06 `animOptions` 暴露 `unitDurationInFrames`（几乎白捡）

| 项 | 内容 |
|---|---|
| 现状 | `TextCard.tsx:37` 把入场窗写死 `12`（typewriter 为 6），而 `textUnitProgress` **已经支持** `unitDurationInFrames` 参数 |
| 改什么 | `TextAnimOptions` 新增可选 `unitDurationInFrames`；`TextCard` 缺省仍取 12/6；`manifest.ts` 的 `KNOWN_TEXT_ANIM_OPTIONS_KEYS` 同步；`gen:manifest-fields` 重生成 |
| 为什么值得 | `blur-slide` 的入场窗是 20f，我们写死 12f ⇒ 复刻会"太快太脆"。这是**一行改动换一整类卡的还原度** |
| 验收判据 | 老 manifest（不写该字段）**逐像素不变**（渲染同帧对比）；写 `unitDurationInFrames:20` 时入场窗确实 20f |
| 成本 | 半天 |
| ⚠️ 行数棘轮 | `manifest.ts` 已登记 **2578 = 当前值**（只准减不准增）。该字段类型若落在 `manifest.ts` 必须先净减等量行，或按先例外提到 `manifest-transform.ts`（该文件无棘轮） |

### VS-07 试点一个新 preset：`splitFlap`（翻牌）

| 项 | 内容 |
|---|---|
| 改什么 | `TextAnimPreset` 扩 `'splitFlap'`；实现放在**纯函数层**（`timing.ts` 或外提新文件 `text-presets.ts`），组件只贴样式；`splitTextUnits` 保持逐字 |
| 为什么挑它 | 参数空间小（`rotateX` 0→90→0 + 上下两半 `clipPath`）、纯 CSS 可做、CSR 白名单内（`clipPath` + `rotateX` 都有实证），且是它 25 张卡里辨识度最高的一张 |
| 验收判据 | 新增 `tests/text-anim-presets.test.mjs`（逐帧断言 `splitFlap` 的进度与角度）；`csr-writing-guard` 全绿；把它与 `blur-slide` 各渲一张静帧，与对方 gallery 视频**只比手法不比像素** |
| 成本 | 1 天 |
| ⚠️ 纪律 | **只增不改**：老 4 个 preset 的公式一字不动（它们决定历史 manifest 的逐像素结果） |

### VS-08 preset 能力的三道闸同步

| 项 | 内容 |
|---|---|
| 改什么 | ① `tests/csr-writing-guard.test.mjs` 扩：新 preset 不得出现 `mix-blend-mode` / `perspective()` / `backdrop-filter` / `z-index`；② `scripts/gen-manifest-fields.mjs --check` 进 `yarn check`（已在）；③ `manifest-contract-doc.test.mjs` 若断言 preset 列表需同步 |
| 验收判据 | 反向变异三处：给新 preset 写一句 `z-index` → 必须红；删 preset 白名单项 → 必须红；改文档不改代码 → 必须红 |
| 成本 | 半天 |

---

## 4. 批 C · 结构层与合规留痕（需拍板）

### VS-09 把「段序列型」卡片做成模板

我们已有完整模板体系（`assets/templates/<family>/<id>/` 六件套 + `list_templates` +
`scaffold_manifest({templateId, slots})`），现有 4 个整片模板。**这是比"塞文档"更强的吸收方式**：
模型不用理解 20 个字段，只填 `slots`。

| 候选段序列 | 为什么 | 模板粒度 |
|---|---|---|
| `deck-deal-flyin` + 滚动 + `type-and-filter`（发牌→浏览→搜索） | 产品演示最常见的一段，动效全是已有能力排列 | **单段**（片长 8–12s） |
| `spotlight-hero-card`（聚光主角卡三拍：推近→悬浮→归位） | 它的 Ink Press 模板靠这个立骨架 | **单段** |
| `ai-stream-response`（摘要先落 → 证据行汇入 → 完成态） | 与我们的 AI 产品定位同源 | **单段** |
| `type-rhythm-sync` + `beat-cut-moves`（卡点快切） | 可直接消费 VS-04 的拍号范式 | **整片**（15–20s） |

> **拍板点 D1（必须回答）**：现有模板体系是「**整片模板**」（`meta.durationInFrames` 固化、
> `durationRange` 校验、`itemCapacity` 驱动段数）。要做单段卡片就得引入「**片段模板**」这一新概念
> （`family: 'shot'` + 不参与整片编译 + 由 agent 手工拼进 manifest）。
> 成本差一个量级：整片模板 1–2 天/个，片段模板需要先改 `template-gate.ts` / `slot-contract.ts`（3–5 天/一次性）。

| 验收判据 | `list_templates` 能列出新模板；`scaffold_manifest({templateId, dryRun:true})` 给出槽位合同；真渲一版成片；`template-gate` 全绿 |
|---|---|
| 成本 | 拍板后再估 |

### VS-10 授权留痕（与代码同批提交，不许后补）

| 项 | 内容 |
|---|---|
| 改什么 | ① `dsh-plugin-desktop/THIRD_PARTY_NOTICES.md` 增 `video-shotcraft (Apache-2.0, Copyright 2026 Wei Yihao)` 与上游 `Vincentwei1021/video-shotcraft` 两跳；② 每个新分册页脚写「手法参考自 …，独立改写，未使用其代码与美术资产」；③ 若真的移植了某段代码，文件头写来源 |
| 为什么 | 对方自己的 `references/shots/ATTRIBUTION.md` 就写明「卡片手法研究自多位 x.com 作者与商业片，**未获复刻许可**，靠独立重写立足」——我们二次借鉴必须守住同一条线 |
| 验收判据 | `THIRD_PARTY_NOTICES.md` 有条目；分册页脚齐全；**不新增任何对方的美术/音频/截图进仓库** |
| 成本 | 0.5 天 |

---

## 5. 批 D · 缺口立项（不在本计划内执行，另立）

这两条是评估时暴露的**真实能力缺口**，不是"借鉴"而是"补课"，各需独立方案：

| 编号 | 缺口 | 为什么必须单独立项 |
|---|---|---|
| VS-11 | **多关键帧 2.5D 相机**（对应对方 `PageCam.tsx`） | 我们现在 `animate` 只有 from→to 两关键帧；整页截图 + 关键帧 `{frame,cx,cy,zoom,rotX/Y/Z,persp}` 插值是「真实产品页特写」这一整类镜头的地基。要动 `timing.ts` 的求值模型（多段同维度插值有先例，但相机需要"布局级放大"避免文字糊，涉 `zoom` vs `transform:scale` 的取舍） |
| VS-12 | **真实截图采集链**（对应对方 pipeline 阶段 4） | 我们只有下游消费（`layout_table` / `inspect_image`），**没有上游采集**：起 dev server → 无头浏览器全页 2x 截图 → 元素级抠图 → `layout.json`。没有它，`video`/`image` 轨的素材只能靠模型生图，「复刻真实页面」这条路走不通 |

> 建议顺序：**VS-12 先于 VS-11**。没有真实截图，多关键帧相机没有素材可拍。

---

## 6. 全局纪律（每批都必须过）

| 纪律 | 具体内容 | 为什么 |
|---|---|---|
| **只增不改** | 老 4 个 preset、老 13 档缓动、老字段缺省值**一字不动**；新能力默认不启用 | 它们决定历史 manifest 的逐像素结果 |
| **行数棘轮** | `src/remotion/manifest.ts` 2578 / `src/remotion/timing.ts` 1514 均已顶格（只准减不准增）⇒ 新类型按 `manifest-transform.ts` 先例外提 | `tests/file-size-guard.test.mjs` 只准减 |
| **契约生成物同步** | 新增字段必须让 `node scripts/gen-manifest-fields.mjs --check` 绿 | 否则 `manifest-fields.generated.md` 与源码漂移，模型读到的就是错的 |
| **CSR 白名单** | 新代码禁 `z-index` / `mix-blend-mode` / `backdrop-filter` / `perspective()`；`<Video>`/`<Audio>` 只从 `@remotion/media` 进 | `tests/csr-writing-guard.test.mjs`（能力基准 #05/#06/#08/#09 像素实证） |
| **反向变异** | 每个新守卫/新 lint 规则，删掉判据必须能变红，并且**只红对应那一条** | 本仓既有惯例，防"假守卫" |
| **验证链四步** | `corepack yarn typecheck && corepack yarn build && corepack yarn verify:loader && corepack yarn test:smoke`（包内跑到 `yarn check`） | `canvas-studio/AGENTS.md` 铁律 |
| **真机验收** | 新 preset / 新模板必须**桌面渲一版**看过再算完成；"测试绿"不等于"好看" | 本仓状态词汇：`已完成` = 桌面验收通过 |

---

## 7. 不做什么（明确划界）

| 不做 | 原因 |
|---|---|
| 整包 vendor 对方仓库 | 绑进第二套渲染路线 + 两跳溯源 + 别人的品牌模板 |
| 抄 `template/`（Ink Press 36.2s 工程） | TSX 工程 + 纸墨风格强绑定 + 真实截图素材，抄进来等于维护双引擎 |
| 移植 24 个用 `zIndex` 的 demo | CSR 不支持 `z-index`，移植 = 重写 |
| 移植 11 个用 `mixBlendMode`/`backdropFilter` 的 demo | 4.0.535 下整字段无效，搬了也是错的 |
| 引入 `assets/audio/` 的 Mixkit SFX | 与我们 `remotion/sfx` 路由是两套；音频统一走 `audio` 轨 |
| 一次铺 6 个新 preset | 先做 1 个（`splitFlap`）验证接线成本，再决定是否铺开 |

---

## 8. 拍板点

| # | 问题 | 选项 | 建议 |
|---|---|---|---|
| **D1** | 模板粒度：要不要引入「**片段模板**」？ | A 只做整片模板｜B 引入片段模板（改 gate/slots，3–5 天一次性）｜C 不做模板，全部走文档 | **B**。对方的资产本来就是"镜头"级，整片模板装不下；一次性成本换长期复用 |
| **D2** | 新 preset 铺几张？ | A 只做 `blur-slide` 参数（不写代码）｜B `blur-slide` + `splitFlap`｜C 一次 6 张 | **B**。1 张证明接线、1 张证明能扩 |
| **D3** | 卡片文本怎么收录？ | A 节选翻译原文｜B 改写成本仓口径 + 标注来源｜C 只做索引不搬内容 | **B**。A 有版权与风格双重风险，C 等于白干 |
| **D4** | VS-11/VS-12 立不立项？ | A 都立｜B 只立 VS-12（截图链）｜C 都不立 | **B**。先补素材上游，相机才有东西可拍 |

---

## 9. 排期建议

```
第 1 天   VS-10 授权留痕（先做，后面所有搬运都在它保护下）+ VS-01 分流索引
第 2 天   VS-02 文字 reveal 参数册 + VS-03 运镜关键帧表
第 3 天   VS-06 unitDurationInFrames（半天）+ VS-07 splitFlap 试点（半天起）
第 4 天   VS-07 收尾 + VS-08 三道闸
第 5 天   VS-05 观感体检 5 条规则（含反向变异）
第 6 天   VS-04 节奏口径 + 全量验证链 + 桌面验收
—— 之后：D1 拍板 → VS-09 模板化；D4 拍板 → VS-12/VS-11 立项
```

**判定这批成功的三条硬指标**：

1. 给一段中文文案 + 一个 BGM，模型能**不经提示**写出带 `wordStagger`（且入场窗正确）与按拍起切的 manifest；
2. `splitFlap` 与 `blur-slide` 各渲一版，桌面看过认可（主观判据，本仓惯例：验收是人看的）；
3. 全量 smoke **0 新增红**，且 `remotion` 相关单测覆盖到新 preset 的逐帧数值。
