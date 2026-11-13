# OpenChatCut 借鉴方案（2026-11-13 · 有据可依的吸收计划）

> **前置阅读**：速览版 `docs/2026-11-13-openchatcut-技术路线对标.md`（生态位分析 + 六项借鉴 + 三条不追）。
> **本文职责**：把"借鉴"落成**可执行方案**——模板参考清单（优先）、吸收项的逐项论证、
> 时间/工作量/顺序评估、**最小可优化线路（MVP）与完整优化线路**。
> **总约束（流程完整性红线）**：①生成路线不变（不引编辑器时间线）；②DSL 数据面不变
> （不引 agent 写 JSX/代码资产）；③零打包纪律（GL shader 库 / ai-sdk 全家桶 / onnx 不进仓）。
> **全部吸收物只落在四类载体**：文档（工作流知识）/ JSON（风格配方、模板合同字段）/
> spec 字段（证据分级）/ 纯函数（渲染调优）——不触碰路线本身。

---

## 一、双方模板资产盘点（优先部分）

### 1.1 OpenChatCut 的"模板"分四类（与"模板"一词对应的实体）

| # | 资产 | 形态 | 位置 | 证据 |
| --- | --- | --- | --- | --- |
| A | **成片工作流技能** ×10 | "过程模板"：怎么把一类 brief 做成一支片子的编排知识（起点分类 / 前置门槛 / plan 格式 / QA 清单 / 反面清单） | `src/agent/skills/{explainer-video, ecommerce-product-montage, product-ad-video-script, beat-sync-montage, news-rough-cut, livestream-to-clips, long-video-to-shorts, multi-clips-to-reels, batch-montage-variants, ai-cinematic-short-film}` | `explainer-video/SKILL.md`（78 行正文，16 步工作流 + 14 条反面规则） |
| B | **MG 参数化模板**（插件包） | JSX 代码资产 + `props/propSchema`（key/type/defaultValue/min/max/step）可编辑属性；插件包带校验/大小限制/GLSL 试编译 | `src/library/pluginTemplateCatalog.ts`（InstalledPack → 编辑器 Tpl 映射）、`src/plugins/{types,validate,install}.ts` | `pluginTemplateCatalog.ts:37-77`（schemaFromMgItem） |
| C | **Design Style 风格配方** | JSON 配方文件（format/version/name/style/scenarios/thumbnailUrl），可导入导出 + 预设目录 + "风格对齐闸" | `src/persist/designStyleTransfer.ts` + `create-motion-graphics/SKILL.md:43-47` | 配方格式头 40 行 |
| D | **GL 特效插件包** | 102 个 frag shader + 插件包格式 | `src/gl/fx/` | 目录清点 |

### 1.2 我们的模板资产现状

| 层 | 资产 | 数量 | 形态 |
| --- | --- | --- | --- |
| 片子级 | 静态模板（骨架 + slots 合同） | 10 | `assets/templates/*/manifest.template.json` + meta/slots/furniture/audio/README |
| 段落级 | 可执行卡（生成器函数） | 56 | `recipe-cards*.ts` 注册表（10 旧 + 46 SSR 消化批） |
| 片型级 | recipe（段序列 + 权重 + 素材需求） | 4 | `recipes.ts`（explainer-cards / product-walkthrough / story-arc / product-promo-60s） |
| 知识层 | shotcraft 手法库 | 152 条 | `shotcraft-catalog.md`（7 字段映射） |
| 契约层 | content-spec schema | 1 | `content-spec.ts`（sections/captions/sfx + validate） |

### 1.3 对照结论：我们缺什么

**关键缺口：片子级"过程模板"。** 我们的两个"片型层"都偏薄——
- `recipes.ts` 的 4 条 recipe 只有**段序列 + 权重 + 一句 note**，没有：起点分类（用户给的是话题还是成稿？）、前置门槛（动画参考读了吗？风格对齐了吗？）、narration-visual sync QA、plan 格式；
- 模板的 slots 合同只有 `maxChars/maxLines`，没有数值约束（min/max/step）；
- 口播模板的段落时长没有"编排依据"——对照它的 sales-spine 五段预算（Hook 0–3s / Pain 3–8s / Demo 8–18s / Proof 18–24s / CTA ≥3s 可读），**我们 vo-spot-30s 的 CTA 段只有 78 帧 = 2.6s，低于 3s 可读线**（实测：`s7-cta` 342→420，含 promo 354 起，主 CTA 可读时长不足）。

而 OpenChatCut 的 A 类资产（成片工作流技能）正好是这一层的成熟形态——**且与我们的路线完全兼容**：它教"怎么编排"，最终产物仍是我们已有的 spec → 卡 → manifest 链路。

---

## 二、可参考模板清单（逐项：是什么 / 借鉴什么 / 怎么落 / 工作量）

### M-1 `explainer-video` 工作流 → 我们的 **recipe 工作流化** ★ 最高价值

- **它是什么**：科普片全流程编排——6 个工作标签（`explainer_start` 起点分类 / `source_structure` / `narration_mode` / `visual_mode` / `timing_source` / `visual_direction_source`）、3 道门（动画参考门 / 视觉方向门 / 语音门）、16 步工作流、Narration-Visual Sync QA（口播与画面的时长/密度/切点同步检查）、compact plan 格式、14 条反面规则（含"**不要把完整口播句放屏幕上**"——与我们字幕纪律同源）。
- **我们缺的**：recipe 是静态段序列；spec 没有"起点分类"；没有 sync QA；模型面对"只有话题没有稿子"的 brief 时没有编排依据。
- **怎么落（不破坏流程）**：
  1. 新文档 `skills/code-driven-explainer/references/recipe-workflows.md`：把它的 6 标签 / 3 门 / sync QA / plan 格式**翻译成我们的 spec 口径**（起点分类 → spec 的 `meta.briefType`；narration_mode → 我们的 sfx/caption/voiceOver 现状；sync QA → 对照 planFromSpec 的时间轴真值）；
  2. `content-spec.ts` 的 spec 增可选字段 `briefType?: 'topic_only' | 'script_or_outline' | 'voiceover_or_transcript'`（只作编排指引，不影响校验）；
  3. 现有 4 条 recipe 各补一段"工作流注记"（起点→段的映射建议）。
- **依据**：`explainer-video/SKILL.md` 全文；与我们字幕纪律的同源证据（双方独立得出"别把口播句上屏"）。
- **工作量**：文档 0.5 天 + spec 字段 0.5 天 = **1 天**。风险：低（纯增量字段，缺省不写 = 老行为）。

### M-2 `sales-spine` 五段带货骨架 → **vo-ad 模板段位校准 + 新卡标注** ★ 直接修真问题

- **它是什么**：带货短片的论证骨架——五段各有"职责 / 时间预算 / 什么内容能落位"（Hook 开环或展示结果 0–3s；Pain 让观众"感到而非听说" 3–8s；Demo 证明钩子 8–18s；Proof 作为**节奏打断**而非堆砌 18–24s；CTA 价格/优惠/动作各占可读拍，**CTA ≥3s**）；反面清单："Spine over polish""Hook is a moment, not a card（logo 开场 = 放弃滑动）""Proof interrupts, it does not pile"。
- **我们缺的**：`vo-spot-30s` 的段落是凭直觉排的——对照后发现 **CTA 主可读时长 2.6s < 3s**（`s7-cta` 从 342 帧起，但 `s7-promo` 354 帧才起，二者挤在同一尾段）；卖点段(168–312)与 CTA 段之间缺 Proof 位。
- **怎么落**：
  1. `vo-spot-30s` 段位微调：CTA 提前到 330 帧（主 CTA 可读 90 帧 = 3s），卖点 3 与 CTA 之间留 18 帧 Proof 提示位（或模板 README 标注"Proof 由用户素材段承担"）；
  2. `product-promo-60s` recipe 的段注记补 sales-spine 映射（hook→open、hero→demo、metrics→proof、outro→CTA）；
  3. 新增 P 类卡时（如 `P4`）可直接按 Proof 位设计。
- **依据**：`ecommerce-product-montage/references/sales-spine.md`（五段预算表 + Hook/Demo/Proof 三节细则）。
- **工作量**：**0.5 天**（模板 JSON 数字 + README + 测试节拍断言更新）。风险：低。

### M-3 `ad-script-framework` 证据分级 → **content-spec 证据字段扩展** ★ 契约级借鉴

- **它是什么**：product fact sheet——产品事实逐项记录**来源**，且每条工作陈述打 5 级标签：`Verified`（有引用）/ `Observed`（素材里可见）/ `User-claimed`（用户口径）/ `Assumption`（规划用，不得当事实出现在成片）/ `Unknown`（缺证据，宁可省略或发问）。
- **我们缺的**：B-4 溯源机制（`dataSource`/`data-provenance.ts`）只有 `'observed' | 'inline'` 两个豁免值；口播模板的促销数字（"立减 300"）没有任何机制拦"编造报价"。
- **怎么落**：
  1. `data-provenance.ts` 的豁免词表扩展 5 级口径（verified/observed/user_claimed/assumption/unknown——**只扩枚举与文案，不动触发逻辑**）；
  2. content-spec 的 sections 可选 `claims?: {text, level}` 字段（assumption 级文案进成片时出 warning）；
  3. skill 文档注明分级用法。
- **依据**：`product-ad-video-script/references/ad-script-framework.md`（fact sheet 表 + 5 级标签 + "never present as fact" 规则）。
- **工作量**：枚举扩展 0.5 天 + spec 字段 0.5 天 + 文档 0.5 天 = **1.5 天**。风险：低（B-4 触发口径不动，纯追加）。

### M-4 MG 模板的 propSchema → **模板 slots 合同数值约束**

- **它是什么**：MG 模板每个可编辑属性带 `propSchema {key,type,default,min,max,step,label}`；插件包有 schema 校验 + 大小上限 + 试编译；无 schema 时从 props 缺省值**反推**（数字→number / #hex→color / 其他→text）。
- **我们缺的**：slots 合同只有字符数约束；数字/颜色型槽位（如 gauge 模板的 `needle1` 角度 0–270）靠校验器手写，无统一 schema 形态。
- **怎么落**：slots 合同增可选 `min/max/step/type: 'number'|'color'`（type 已有 string/string[]/number 三型，补约束字段）；`template-compile` 校验消费；不迁移既有模板（增量可选）。
- **依据**：`pluginTemplateCatalog.ts:37-64`（inferPropSchema 的类型反推 + min/max/step 透传）。
- **工作量**：**1 天**（类型 + 校验 + 两个模板示例）。风险：低。

### M-5 Design Style 配方 → **theme 配方文件化**（观察项）

- **它是什么**：风格 = JSON 配方（name/style/scenarios/thumbnailUrl）可导入导出；"风格对齐闸"强制先选 preset 再创作，批量生产必须先有"代表性样张"确认。
- **我们缺的**：theme（cold-tech/warm-ember/ink-press）是代码内常量，不可导入导出；"风格对齐"靠 recipe 的 theme 字段字符串。
- **怎么落**（观察项，暂不执行）：theme 导出为 JSON 配方（name/颜色族/字体族/颗粒/暗角/scenarios）+ 导入入口。等真机出现"想带一套风格走"的真实需求再做。
- **工作量**（若做）：**1.5 天**。

### M-6 GL 特效插件包 → **不吸收，记录格式思想**

102 个 frag shader + 插件包（校验/上限/试编译）——GL 路线不追（红线③），但"**效果包 = 资产 + schema + 上限 + 试编译**"的包格式思想，若未来做预生成资产包（RQ-16 深化）可复用。零工作量，记录。

---

## 三、工程借鉴项（非模板，来自对标速览，此处纳入统一排期）

| # | 项 | 内容摘要 | 工作量 | 依据 |
| --- | --- | --- | --- | --- |
| E-1 | **渲染并发双预算 + 真机实测 + RENDER-TUNING.md** | `resolveRenderConcurrency`（CPU 80% + 内存 1.25GiB/tab 折算 + env 覆盖）移植 render-host；真机照它的文档范式做 worker 数实测（4/8/auto 三档对比） | 移植 0.5 天 + 实测 0.5 天 = **1 天** | `remotion/performance.mjs`（双预算函数全文）、`MACOS-RENDER-TUNING.md`（13→4 worker 快 26–28% 实测表） |
| E-2 | 取证路径选择表 | verification 分册补"按验证对象选最便宜取证路径"（结构→validate/报告；观感→pixel-audit；素材→ffprobe contact-sheet） | **0.5 天** | `skills/verification/SKILL.md`（L0/L1/L2 + view_timeline_frames vs view_asset_frames 分工） |
| E-3 | 三条剪辑手艺规则进 patterns | 密度弧（verse/chorus 不同密度）/ 锚点优先（3–6 个必踩重拍）/ 风格闸（generic adjectives ≠ named style） | **0.5 天** | `beat-sync-montage/SKILL.md`、`create-motion-graphics/SKILL.md:43-47` |
| E-4 | 原子提案语义（backlog） | 一轮多工具操作 = 一个提案 = 一个 undo 步 | 中（approval-gate 深改） | `editing-workflow.md`（begin/review/applied 全流程） |
| E-5 | 渐进式技能暴露（观察项） | load_skill + tools/list_changed | 中 | `SKILL.md:20-26` |

---

## 四、不破坏流程完整性的论证（为什么这些吸收是安全的）

| 红线 | 吸收项触碰检查 |
| --- | --- |
| ①生成路线（不引编辑器） | M-1~M-5 全部落在 spec/模板/文档，不引入时间线/会话编辑面；E-4 只是"审批语义"，不做编辑器 |
| ②DSL 数据面（不引代码资产） | 不吸收 MG 的 JSX 代码资产与 GL 插件；M-4 只借鉴它的 **schema 形态**（min/max/step 是数据） |
| ③零打包 | 六项零新依赖：M-1~M-5 是文档+JSON+既有字段扩展；E-1 是纯函数 |
| ④确定性纪律 | 无吸收项引入随机/时钟 |
| ⑤老 manifest 逐像素 | M-1/M-3/M-4 全是**可选增量字段**（缺省不写 = 老行为）；M-2 是模板数字（模板本身是新的） |

---

## 五、顺序评估与两条线路

### 5.1 依赖关系

```
M-2(vo-spine 校准) ──独立──→ 可立即做
E-2(取证表) / E-3(手艺规则) ──纯文档──→ 可立即做
M-1(recipe 工作流化) ──依赖──→ 无（先文档后字段）
M-3(证据分级) ──依赖──→ B-4 既有机制（在）
M-4(slots 数值约束) ──独立
E-1(渲染调优) ──依赖──→ 真机环境（用户配合半天）
E-4/E-5 ──依赖──→ approval-gate / 工具面压力（远期）
```

### 5.2 最小可优化线路（MVP · 约 **2 个工作日**，纯文档 + 零风险字段）

| 步 | 内容 | 产出 | 时间 |
| --- | --- | --- | --- |
| 1 | M-2：vo-spot 段位校准 + promo recipe 补 spine 映射 | 模板 JSON + 测试更新 | 0.5 天 |
| 2 | E-2：取证路径选择表进 verification 分册 | 文档 | 0.5 天 |
| 3 | E-3：三条手艺规则进 explainer-patterns（标来源） | 文档 | 0.5 天 |
| 4 | M-1 前半：`recipe-workflows.md` 工作流文档（6 标签/3 门/sync QA/plan 格式的 DSL 译本） | 文档 | 0.5 天 |

MVP 交付后：模型编排能力立即可用（文档即生效），零代码风险，老 manifest/老模板零影响。

### 5.3 完整优化线路（MVP + 深化 · 约 **6–7 个工作日**）

| 步 | 内容 | 依赖 | 时间 | 优先级 |
| --- | --- | --- | --- | --- |
| MVP 四步 | 见上 | — | 2 天 | P0/P1 |
| 5 | M-1 后半：content-spec 加 `briefType` 字段 + recipe 注记消费 | MVP 步 4 | 0.5 天 | P1 |
| 6 | M-3：证据分级（data-provenance 5 级 + spec `claims` 字段 + warning） | MVP | 1.5 天 | P1 |
| 7 | M-4：slots 数值约束（min/max/step）+ 两个模板示例 | — | 1 天 | P2 |
| 8 | E-1：渲染并发双预算移植 + 真机实测 + `RENDER-TUNING.md` | **真机配合** | 1 天 | **P0**（与文档线并行，等真机窗口） |
| 9 | M-5 风格配方 / E-4 原子提案 / E-5 技能暴露 | 真实需求出现 | 各 1.5 天 | 观察项，不排期 |

### 5.4 明确不做

- MG 的 JSX 代码资产路线、GL 插件包、编辑器时间线、ai-sdk/onnx 依赖面（红线①②③）；
- 上游 32 个工作流技能中与生成路线无关的：transcription / multicam / livestream-to-clips / long-video-to-shorts（它们是剪辑器工作流，依赖真实时间线）；
- `Design Style` 的"视觉卡片选择集 UI"（我们是宿主工具面，没有自由 UI 载体；用文档 + spec 字段替代）。

---

## 六、汇总表（一页看全）

| 项 | 层 | 价值 | 工作量 | 线路 | 红线检查 |
| --- | --- | --- | --- | --- | --- |
| M-2 vo-spine 校准 | 模板 | 修真问题（CTA <3s） | 0.5d | MVP | ✅ 模板数字 |
| E-2 取证选择表 | 文档 | 复用高 | 0.5d | MVP | ✅ |
| E-3 手艺规则 | 文档 | 补编排层空白 | 0.5d | MVP | ✅ 标来源 |
| M-1 工作流化 | 文档+字段 | 补片型层最大缺口 | 1d | MVP(文档)+完整(字段) | ✅ 可选字段 |
| M-3 证据分级 | 契约 | 防编造促销/声明 | 1.5d | 完整 | ✅ B-4 追加 |
| M-4 slots 约束 | 契约 | schema 形态对齐 | 1d | 完整 | ✅ 可选 |
| E-1 渲染调优 | 工程 | **最高 ROI** | 1d+真机 | 完整 | ✅ 纯函数 |
| M-5 风格配方 | 观察 | 待真实需求 | 1.5d | 不排期 | ✅ |
| E-4 原子提案 | 观察 | agent 改片体验 | 中 | 不排期 | ⚠️ 仅语义借鉴 |
| E-5 技能暴露 | 观察 | 上下文管理 | 中 | 不排期 | ✅ |

**MVP = 2 天（纯文档 + 一个模板校准）；完整 = MVP + 4.5 天 ≈ 6.5 天；观察项 3 项不排期。**

---

## 七、证据索引（本文全部论断的出处）

| 论断 | 出处（OpenChatCut 仓库内路径） |
| --- | --- |
| 6 工作标签 / 3 门 / 16 步 / 14 反面规则 | `src/agent/skills/explainer-video/SKILL.md`（全文 78 行） |
| "别把完整口播句上屏" | 同上 Rules 节（与我们字幕纪律同源，双方独立得出） |
| sales-spine 五段预算 + CTA ≥3s | `src/agent/skills/ecommerce-product-montage/references/sales-spine.md` |
| Hook is a moment, not a card | 同上 Rules 节 |
| 5 级证据标注 + fact sheet | `src/agent/skills/product-ad-video-script/references/ad-script-framework.md` |
| propSchema min/max/step + 类型反推 | `src/library/pluginTemplateCatalog.ts:11-64` |
| 风格配方 JSON 格式 | `src/persist/designStyleTransfer.ts:1-40` |
| 风格对齐闸（generic adjectives ≠ named style） | `src/agent/skills/create-motion-graphics/SKILL.md:43-47` |
| 双预算并发算法 | `remotion/performance.mjs:1-50` |
| M4 Max 实测表（13→4 worker 快 26–28%） | `MACOS-RENDER-TUNING.md` |
| Windows 解码器静默挂死 + 平台切换 | `remotion/video-decoder.mjs:1-40`（引 Remotion issue #10701/#11020/#11393） |
| L0/L1/L2 验收 + 取证分工 | `src/agent/skills/verification/SKILL.md` |
| 密度弧/锚点/看片 QA | `src/agent/skills/beat-sync-montage/SKILL.md` |
| 编辑会话原子提案 | `skills/openchatcut/references/editing-workflow.md` |
| MG 路线 = agent 写 JSX | `src/agent/skills/create-motion-graphics/SKILL.md`（direct-authoring 全文） |
