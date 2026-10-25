# shotcraft 吸收 · 开发任务书（2026-10-25）

> 面向直接开发：只写**剩余工作**，每条任务给精确文件路径、步骤与可判定验收。
> 背景与论证见 [集成评估-汇总版](2026-10-25-video-shotcraft集成评估-汇总版.md)；
> 学习方案与决策 D14–D18 见 [shotcraft吸收方案](2026-10-25-shotcraft吸收方案.md)。
> 前置调研：[调研与适配评估](2026-10-25-video-shotcraft调研与适配评估.md)。

---

## 0. 已落地盘点（勿重复开发）

| 项 | 状态 | 落点 |
|---|---|---|
| S0 门槛（能力对照） | ✅ | [方案验证报告-镜头卡与主题预设](2026-10-25-方案验证报告-镜头卡与主题预设.md) |
| S1 镜头卡 ×14（A1–A5/B1–B2/C1–C2/D1–D2/E1–E3） | ✅ | [skills/code-driven-explainer/references/shot-cards.md](../../skills/code-driven-explainer/references/shot-cards.md)；取证 [scripts/render-forensics/cards.mjs](../../scripts/render-forensics/cards.mjs) 14/14 通过 |
| S2 主题预设 | ✅ | [src/remotion/themes.ts](../../src/remotion/themes.ts)（品牌识别度 + 主题即时切换） |
| 片型配方（整片骨架层） | ✅ | [src/remotion/recipes.ts](../../src/remotion/recipes.ts) + [tests/render-recipes.test.mjs](../../tests/render-recipes.test.mjs) |
| 素材就绪门禁（§07 pending 阻断落地） | ✅ | CV-369 |
| 逐点取色 + 分组坐标（会话5 B 类缺口） | ✅ | CV-368 |
| **SKILL.md 挂载 shot-cards / recipes 引导** | ❌ | 全文 grep 无引用（本任务书 R1） |
| **每卡渲染成本标注** | ❌ | 卡头无成本行（R2） |
| **第二批词汇卡（shotcraft 124 卡对照扩充）** | ❌ | R3 |
| **SFX 声音品类（S3）** | ❌ | R4 |
| **卡点建议器（S4，可选）** | ❌ | R5，排最后（D17） |

**范围外（单列，不混账）**：运行时线（claim-stall 语义、每帧成本 profile、errors.md 修正）由会话6诊断 P0 负责；shotcraft 吸收不解决渲染问题。

---

## R1 · SKILL.md 挂载镜头卡与配方引导（0.25 天，最先做）

**为什么最先**：卡片库已存在但模型不知道——不挂载等于没做（S1 验收本就含此条，因 SKILL.md 体积约束被搁置）。

**涉及文件**
- [skills/code-driven-explainer/SKILL.md](../../skills/code-driven-explainer/SKILL.md)（现 11,822 字节）

**步骤**
1. 全文找 200–400 字节可压缩段（冗余示例/重复表述），为新增腾空间；
2. 在"动手排轨前"的位置加一段 ≤3 行的强制引导：
   `排轨前必读 references/shot-cards.md 挑卡填参（每卡片段实测可渲）；整片结构优先 src/remotion/recipes.ts 的片型配方，不要从空 tracks 开始。`
3. 同步检查 [references/manifest-contract.md](../../skills/code-driven-explainer/references/manifest-contract.md) 无与 shot-cards 冲突的表述。

**验收**
- `grep -n 'shot-cards' SKILL.md` 命中 ≥1；SKILL.md 总体积 ≤ 12,000 字节；
- 新会话实测：agent 首轮排轨引用了卡片/配方（人工抽验一次即可）。

---

## R2 · 现有 14 卡补「每帧成本」标注（0.25 天）

**背景**：我们 CSR 每帧实测 7.9–19s（会话6），高成本卡吸收了渲不动；卡头必须有成本提示让 agent 选卡时避坑。

**涉及文件**：[shot-cards.md](../../skills/code-driven-explainer/references/shot-cards.md)

**步骤**
1. 每张卡"观感"行后追加一行：`**成本**：低（位移/透明度类）｜中（叠加 ≤3 层）｜高（逐帧重栅格化/大图多副本）`；
2. 评级依据取证脚本同场渲染的 msPerFrame 数据（`scripts/render-forensics/out/` 已有 14 卡实测），**不拍脑袋**；
3. 文件头加一行总则：`高成本卡只允许单镜头短时长使用，不得成片连排`。

**验收**：14 张卡全部有成本行；`grep -c '^\*\*成本\*\*' shot-cards.md` = 14；高成本卡（若有）标注了限用条件。

---

## R3 · 第二批词汇卡（1 天，依赖 R2 的成本数据）

**目标**：从 shotcraft 124 卡（10 类，见[汇总版勘误](2026-10-25-video-shotcraft集成评估-汇总版.md)）里挑 **8–12 张**我们白名单能组合的低成本镜头，补齐 A–E 类之外的空白（数据强调进阶 / 图表动效 / 收尾序列 / 高亮扫过）。

**步骤**
1. `git clone --depth 1 https://github.com/Vincentwei1021/video-shotcraft /tmp/shotcraft`（不进仓库）；
2. 按 D18 门槛筛卡：**manifest 现有字段可组合 + 至少 2 个场景会用到 + 每帧成本不高于中**；manifest 拼不出的记入"能力缺口清单"（进 backlog，不硬造卡）；
3. 每张新卡按 shot-cards.md 既有 5 段 schema 书写，追加到对应类别；
4. **全部（14+N）重跑取证**：`node scripts/render-forensics/cards.mjs`，判定「非黑 >50% 且相邻帧 MAE ≥0.5」，一张不过整批不收。

**验收**
- 取证输出 14+N/14+N 通过；shot-cards.md 头部计数同步更新；
- 素材需求索引表补齐新卡行（需要素材的卡同步登记 §07 约定）；
- 能力缺口清单单独成节，注明"待扩 manifest 字段，勿做成伪卡"。

**红线**：不 vendor 任何 TSX/代码；只借"镜头语义"，实现必须用我们白名单字段。

---

## R4 · SFX 声音品类（0.5 天，可与 R3 并行）

**涉及文件**
- 新增 `assets/audio/sfx/`（10–20 个，whoosh / click / riser / impact 各 3–5）
- 新增 `assets/audio/sfx/ATTRIBUTION.md`（逐条：来源 / 许可 / 取用日期）
- [shot-cards.md](../../skills/code-driven-explainer/references/shot-cards.md)（卡片加 `sfx` 建议字段）

**步骤**
1. 从 `/tmp/shotcraft/assets/audio/` 挑选；**绕开 ATTRIBUTION 里约 6 个不可溯源项**（标注"商用前须确认"的一律不取）；
2. 逐条登记 ATTRIBUTION（我们自己的账本，不引用它的文件路径）；总增量 **< 2MB**；
3. 卡片只加**建议字段** `sfx: "whoosh-short"`，不接渲染链（混音属另一条线）；manifest-contract 同步注明"该字段渲染忽略"。

**验收**：每个音频文件在 ATTRIBUTION 有对应行；`du -sh assets/audio/sfx` < 2MB；含 sfx 字段的 manifest 过 `validateManifest` 且不改变渲染结果。

**红线**：talkcraft（姊妹库）license=NOASSERTION，**任何资产不得取自它**。

---

## R5 · 卡点建议器（可选，1 天，D17 = 最后做）

**步骤**
1. 新增 `scripts/beat-suggest.mjs`：输入 BGM → 输出 `cutFrames[]` 建议 JSON（离线工具，不进渲染链、不加 manifest 字段）；
2. 输出落在 `scripts/render-forensics/out/` 同级临时目录，由 agent 排轨时参考；
3. 验证有收益（人工对比 2 支片子）后再立项 manifest 字段，**本任务不含**。

**验收**：给定一首 BGM 能产出节拍点列表；全量 smoke 不受影响（纯脚本不进 src）。

---

## 验证链（铁律，任何 src/ 改动后）

```sh
cd canvas-studio
corepack yarn typecheck && corepack yarn build && corepack yarn verify:loader && corepack yarn test:smoke
```

- 卡片/配方相关改动额外跑 `node scripts/render-forensics/cards.mjs`；
- `test:smoke` 跑 lib/ 产物，不能当编译闸门；沙箱内 build 逐步骤（见 [AGENTS.md](../../AGENTS.md)）。

## 红线汇总

1. 不 vendor shotcraft 任何代码/TSX；只借镜头语义与卡片形式。
2. 每张卡必须实测渲染通过（取证脚本），禁止"看起来对"的卡。
3. 每张卡必须带每帧成本标注；高成本卡限用。
4. 音频逐条授权可查；不可溯源与 NOASSERTION 来源（talkcraft）一律不取。
5. 建议字段（sfx）不接渲染链；能力缺口记录进 backlog，不做成伪卡。

## 建议顺序

```
R1 挂载(0.25d) → R2 成本标注(0.25d) → R3 扩卡(1d) ─┬→ R4 SFX(0.5d) → R5 卡点(可选)
                                                    （R4 可与 R3 并行）
```
总计约 2–3 天。R1/R2 是纯文档小改，可一个提交收口；R3/R4 各自独立成提交。
