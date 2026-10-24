# Skill 系统编排能力升级方案

> **状态**：待拍板（v1.1，2026-10-23）。**本方案未改动任何代码与 skill 内容**，只定义改动内容、判据与顺序。
>
> **评审**：本 v1.1 已并入 [评审意见](./skill-orchestration-upgrade-plan-review-2026-10-23.md) 的全部修订（E1/E2 事实修正 + 运行时消费边界 / 阈值豁免机制 / L3 执行成本 / B2 一次填完）。
>
> **与既有四份文档的关系**（避免重复劳动）：
> - `skill-system-design-review-2026-10-15.md` — 上一轮诊断（D1–D7）。本方案第 1.3 节先划清哪些已闭环，**不重开**。
> - `skill-system-optimization-plan-2026-10-15.md` — 上一轮的优化清单，其中「激活集注入」「渐进披露」「platform.yaml 单一事实源」已落地，本方案视为前置条件。
> - `skill-expansion-spec.md` — 新增 skill 的操作规范。本方案 §4 会修正它三处已悬空的表述。
> - `canvas-studio-skill-regression-matrix.md` — 真机回归矩阵。本方案 §4.5.3 把它升级为度量载体。

---

## 0. 一句话

skill 系统已经是一份**高质量知识库**（22 skill / 19 个门禁测试文件·200 条断言 / 639 KB 分层内容），但编排层仍只有「一份总纲 + 一个硬指令 + 若干张手维护映射表」。本方案不动知识内容，只做三件事：**给分类补第二根轴、把三份平行映射表收敛成字段、把路由质量变成可测的数**。

---

## 1. 诊断

### 1.1 现状盘点（实测）

| 项 | 数值 | 出处 |
|---|---|---|
| skill 总数 | 22 | `skills/` 目录 |
| 角色分布 | decision 5 / knowledge 17 | 各 `platform.yaml` |
| 槽位分布 | orchestration 1 · 6 个能力槽位各 1 · **general 15** | 同上 |
| 有 `references/` 的分册库 | 19 / 22 | `skills/*/references/` |
| 入口体积 | 全部 ≤ 11.2 KB（总纲 11.2 KB 单独管辖） | 实测 |
| 分册总量 | 约 639 KB | 实测 |
| `description` 最长 | 696 字符 / 上限 1024（余量 328） | `collectSkillStats()` |
| skill 相关门禁 | 19 个测试文件、200 条 `test()` | `tests/*skill*.test.mjs` |
| 真机回归覆盖 | 10 条编号用例，其中 2 条素材档 skipped | `canvas-studio-skill-regression-matrix.md:80-106` |

### 1.2 五个结构性缺口

| # | 缺口 | 证据 | 不修的后果 |
|---|---|---|---|
| **G1** | **组合路由无载体**：`slot` 只有「提示词能力」一维，题材维度只能塞 `general` | `skill-catalog.ts:133-142`；15/22 落在 `general` | 模型无法表达「本任务该同时挂哪几个 skill」，只能靠 description 竞争 |
| **G2** | **三份平行映射表**：① `style-presets.md` 11 行「预设→skill」② `skill-progressive-disclosure.test.mjs:50-62` 硬编码 `STYLE_SKILLS` 11 个名 ③ `skill-expansion-spec.md:91-92` 要求「写进总纲的分类对照行」——该段**已不存在**（CV-321b 改写时删除） | 实测 ①② **目前一致（11 = 11，逐名相等）**，但两者靠人维护、彼此无对账；③ 已确认悬空 | 加第 12 个风格 skill 时需同时改 ① 和 ②，漏一处不报错 → 静默漂移；③ 的悬空已使 spec 指引失效 |
| **G3** | **决策型交回无契约**：4 个导演/跑批型 skill「做一半交回总纲」，交回点只在散文里 | `skill-role-consistency.test.mjs:47-49` 用 `DECISION_TYPES` 硬编码白名单 | 新增导演型 skill 忘记声明交回点无人发现；白名单必然腐烂 |
| **G4** | **注入成本不可见**：639 KB 分册按需全量 `read`，无预算、无分层、无「最小必读集」 | 19 个 `SKILL.md` 对分册只做定位式引用（「细则见 references/x.md」），不声明必读顺序与体量 | 单任务读 3–5 个分册 ≈ 20–30 K tokens 固定开销，且无法归因 |
| **G5** | **路由质量零度量**：无命中率、无失败样本、无 A/B | 回归矩阵 `:133` 自认风险，缓解手段是「brief 里人工写『使用 xx skill』」 | 所有后续优化都无法证明有效；这正是上一轮 D1 未闭合的部分 |

### 1.3 已闭环，本方案不重开

| 历史问题 | 现状 | 依据 |
|---|---|---|
| D1（激活集是纯 UI 概念） | 已由 CV-323/332 注入 system prompt，只注入名称+标题+摘要 | `active-skills-prompt.ts:99-110` |
| D3（渐进披露规范与现实相反） | 已拆解，19/22 有分册，断链有门禁 | `skill-progressive-disclosure.test.mjs:132` |
| D4（总纲体积上限三涨） | 已缩至 11.2 KB，细则下沉 `toolchain.md` | 实测 |
| D5（展示元数据双源） | 已收敛到 `platform.yaml`，快照有深相等断言 | `skill-catalog.ts:4-42` |
| D1 的两个残留项 | `invocation.modelInvocable` 仍未消费、上游 scope 分层未用 —— **不阻塞编排**，本方案不处理 | `skill-system-design-review:142-147` |
| 风格 skill 自带审批门 | 已有 11 条立场声明断言 + 自建 HITL 正则门禁 | `skill-progressive-disclosure.test.mjs:195-214` |

---

## 2. 设计原则

本方案的所有取舍都服从四条原则，后续争议可回到这里裁决。

| # | 原则 | 含义 | 反面案例 |
|---|---|---|---|
| **P1** | **新增字段必须消灭一份现有平行事实** | 每个新字段都要能指出「它取代了哪张手维护表」，否则就是造债 | 给 `platform.yaml` 加 `summary2` 而不把 catalog 快照删掉 |
| **P2** | **存量豁免 + 新增强制** | 存量用白名单冻结并只减不增；新条目立即按新规校验 | 一次性改 22 个 `platform.yaml`，一错全退回快照 |
| **P3** | **度量先行** | 无法观测效果的改动不立项。先建口径，再改结构 | 先改槽位，再靠「感觉好点了」验收 |
| **P4** | **fail-closed 的代价必须显式** | `parsePlatformYaml` 任一文件解析失败会**整表退回内嵌快照**（`skill-catalog.ts:312-345`），表现为「改了没生效」 | 加字段时只改 TS 类型，不改解析器与解析器单测 |

---

## 3. 目标架构

### 3.1 三轴模型

| 轴 | 字段 | 语义 | 基数 | 互斥 | 消费者 |
|---|---|---|---|---|---|
| **A 能力轴** | `slot` | 「哪一类提示词/镜头知识」 | 单值 | **是**（一槽一实现） | `toolchain.md` 绑定表、`builtinSlotOwners()` |
| **D 题材轴** | `genre`（新） | 「这是哪类片子」 | 多值 | 否（可叠加） | 组合路由、广场分组、覆盖率统计 |
| **P 流水线标志** | `pipeline`（新） | 「是否有端到端专属流程」 | 布尔 | — | 取代 `style-presets.md` 平行表与 `STYLE_SKILLS` 白名单 |
| **O 编排轴** | `role` + `handoff`（新） | 「谁编排、做完交给谁」 | 单值 | orchestration 唯一 | 交回契约、门禁推导 |

**正交性论证**：`slot` 必须互斥，因为「装配哪一本」必须确定；`genre` 必须可叠加，因为一个任务可以同时是「商业」+「叙事」。把两者塞进一个字段（扩 slot 到 15 个值），会同时失去两个性质——这是 §3.3 的反方案。

### 3.2 数据流

```
skills/<name>/
  ├─ SKILL.md            ──① 注册（目录成员即注册，不变）
  ├─ platform.yaml       ──② 三轴元数据（事实源，解析严格）
  └─ references/         ──④ 按需 read（新增「最小必读集」声明）
        │
        ├─→ SKILL_CATALOG ──→ 广场 UI / 激活集摘要（不变）
        ├─→ slot 绑定表   ──→ 提示词能力装配（不变）
        ├─→ genre/pipeline ─→ 组合路由（新增，B2）
        └─→ handoff       ──→ 子编排交回（新增，B3）
                                   │
                    ⑤ 度量：L1 静态 / L2 离线用例 / L3 真机命中率（新增，B1）
```

### 3.3 反方案：为什么不把 `slot` 扩成多值

| 方式 | 结果 |
|---|---|
| `slot: video-prompt,image-t2i` | 破坏「一槽一实现 ⇒ 平台能确定装配哪一个」的既有硬约束（`skill-platform-meta.test.mjs:143-152`）；`builtinSlotOwners()` 的返回类型 `Record<string,string>` 也要改成数组，波及用户上传提示（`routes.ts:2309`） |
| 新增 15 个题材槽位放 `PLATFORM_SLOTS` | 题材天然可叠加，槽位互斥语义不成立；且 `slot` 一旦出现 15+ 取值，`toolchain.md` 那张「6 行绑定表」会变成 22 行大表，失去「查表即装配」的可读性 |

结论：**加轴，不扩轴**。

---

## 4. 详细设计

### 4.1 `genre` 题材轴（B2）

**取值域（封闭枚举，5 值）**

| 值 | 含义 | 典型 skill |
|---|---|---|
| `commercial` | 商业营销 | `brand-promo-video-generator`、`minimalist-product-ad-generator` |
| `narrative` | 叙事/漫剧/开场 | `3d-animation-short-generator`、`co-op-game-intro-generator`、`bible-story-director` |
| `explainer` | 讲解科普 | `papercraft-stop-motion-explainer`、`paper-collage-explainer-generator`、`code-driven-explainer` |
| `artistic` | 艺术实验 | `handdrawn-live-video-generator`、`oriental-mythic-visual-director`、`music-video-subtitle-generator` |
| `utility` | 内部工具/跑批 | `effect-test-runner` |
| `none` | **不适用（能力型）** | 6 个能力槽位 skill |

**多值语法（受解析器约束）**：`parsePlatformYaml` 只接受扁平标量，**明确拒绝数组与嵌套**（`skill-catalog.ts:172-206`）。故多值写成逗号分隔单行字符串：

```yaml
genre: "artistic,narrative"
```

解析侧 `split(',').map(trim)`，空段判非法。**不得改用 YAML 数组**——那会让整表 fail-closed 退回快照（原则 P4）。

**`none` 的精确约束**（防止 `none` 变成第二个垃圾桶）：

> `genre: none` 仅允许出现于「`slot` 属于 6 个能力槽位之一」的 skill。
> 换言之：挂在 `general` 的 skill 不得用 `none` 逃避分类。

这条约束把「能力型不适用」与「还没想清楚」彻底分开，且机器可判。

**消灭哪份平行事实（P1）**：`skill-expansion-spec.md:91-92` 要求「把 skill 挂进 3a 大类，写进总纲的分类对照行」——该段落已随 CV-321b 删除，spec 指向悬空。`genre` 成为这段分类的**唯一落点**，同步修 spec。

**存量迁移（P2）**：新建 `tests/skill-genre.test.mjs`，内含 `PENDING_GENRE` 白名单。三条断言：

1. 白名单里的 skill 必须**确实缺** `genre`（防名单腐烂）；
2. 不在白名单的 skill 必须有合法 `genre`，且满足 `none` 的约束；
3. `PENDING_GENRE.length` 有数字快照，**只允许减小**。

**执行口径（评审修订）**：`genre` 是纯标量行，语法安全（fail-closed 只由数组/嵌套/重复键触发），枚举写错只会在 N1 当场红，**不存在静默失败路径**；且附录 B 已给出全部 22 个建议值——B2 应**一个 PR 直接填完 22 个 `genre` + N1/N2 门禁同批提交**，白名单直接空态（`PENDING_GENRE = []` 保留机制，供未来新 skill 过渡用）。分批迁移反而拉长周期、扩大白名单腐烂面。`handoff` 涉及编排语义，保留分批。

**运行时消费边界（评审补充，防「改了没生效」）**：B2 阶段 `genre` **不进** `SkillCatalogEntry`、不进 `toCatalogEntry`（`skill-catalog.ts:218`）——合法性仅由 N1 在测试侧校验。原因：`toCatalogEntry` 失败会**整表退回内嵌快照**（`skill-catalog.ts:333-337`），把枚举写错变成「广场静默变形」。运行时消费（广场分组 / 组合路由读字段）另立 CV，届时才把枚举校验进解析器。

### 4.2 `pipeline` 流水线标志（B2）

**为什么不能只用 `genre`**：`genre` 是多值分类，无法回答「用户点了『纸艺定格讲解』这个预设，该加载哪个 skill」——那是 1:1 映射。`pipeline: true` 承载的正是这个既有事实。

**消灭哪份平行事实（P1）**：

| 现有平行事实 | 位置 | 收敛后 |
|---|---|---|
| 预设表 11 行的「完整流程加载 `xxx`」 | `style-presets.md:40-50` | 由 `pipeline: true` 的集合派生 |
| `STYLE_SKILLS` 硬编码 11 名 | `skill-progressive-disclosure.test.mjs:50-62` | 由 `pipeline: true` 集合动态推导 |
| spec 要求写进总纲的分类对照行 | `skill-expansion-spec.md:91-92` | 改指 `genre` 字段 |

**双向对账门禁**（新增，B2）：

```
集合 A = { skill | pipeline: true }
集合 B = style-presets.md 表格里出现的 `完整流程加载 \`x\`` 的 x
断言 A == B（双向，不属于 A\B 或 B\A 都红）
```

这条门禁的价值：今后「加了风格 skill 却忘写预设表」与「写了预设但没标 pipeline」都会被当场抓住，而不是等模型在真机上加载失败。

### 4.3 `handoff` 交回契约（B3）

**语法**（扁平标量，`目标@阶段`）：

```yaml
handoff: "canvas-studio-creation@storyboard"
handoff: "self"
```

| 值 | 含义 |
|---|---|
| `<skill>@<stage>` | 做到 `stage` 就交回指定 skill |
| `self` | 闭环执行，不回交（如 `effect-test-runner`） |

**判据**：

1. `role: decision` 且 `slot != orchestration` ⇒ `handoff` 必填且可解析；
2. `role: knowledge` ⇒ **不得**出现 `handoff`（越权声明编排，与上传契约 §① 同源）；
3. `handoff` 指向的 skill 必须存在（幽灵绑定直接红）；
4. 目标 skill 必须是 `slot: orchestration` 或 `role: decision`（不许把活交给知识型）。

**替换掉的东西**：`skill-role-consistency.test.mjs:47-49` 的 `DECISION_TYPES` 硬编码数组。改为：

```
decision 集合 = { skill | role: decision }（读 platform.yaml）
其中非 orchestration 者必须声明 handoff
```

新增导演型 skill 时忘记声明交回点 → 立即红，无需人工维护名单。

### 4.4 注入预算：最小必读集（B4）

**为什么字段不能放 `platform.yaml`**：注入成本发生在**模型 `read` 的那一刻**，而 `platform.yaml` 的字段不进入模型上下文（`toCatalogEntry` 明确不把 `role`/`slot` 放进 `SkillCatalogEntry`，`skill-catalog.ts:215-217`）。放在那里的 tier 字段对模型零约束。

**设计**：每个知识型 `SKILL.md` 在标题下加一节：

```markdown
## 最小必读集

按序读以下 2 份即可完成本 skill 的主路径，其余分册只在命中对应条件时读：
1. `references/xxx.md`（约 6 KB）— …
2. `references/yyy.md`（约 4 KB）— …
条件读取：`references/zzz.md` 仅当「…」时读。
```

**门禁**（新增）：

- 知识型 skill 必须有该节（decision 型豁免）；
- 节内点名的文件必须存在（复用已有的断链判据）；
- 声明的总字节 ≤ 阈值。

**阈值待测，不拍脑袋**：B4 的第一个产出是 `scripts/measure-skill-readsets.mjs` 的实测表（22 个 skill 的「主路径候选文件 + 字节数」），取 **P90 上取整** 作为阈值。在没有实测前写死「≤ 40 KB」属于凭感觉立法，本方案拒绝这样做。

**超线豁免机制（评审修订，防自产第二份平行表）**：P90 意味着约 2-3 个 skill 天然超线，必须配豁免——豁免名单**复用「白名单只减不增」机制**（同 `PENDING_GENRE` 模式：名单内的必须真超线、长度快照只减），不新造一套手维护表，避免违反 P1。

### 4.5 三级路由度量（B1）

#### 4.5.1 L1 静态：路由语完备性

**载体澄清（评审 E2，必读）**：这里的 `description` 指各 skill **`SKILL.md` frontmatter 的 `description` 字段**——`platform.yaml` **没有** description 字段（只有 `summary`，那是广场展示文案，不进模型路由上下文）。N6 门禁读 `SKILL.md` frontmatter。

判据（每条 `description` 必须同时命中）：

| 断言 | 判据 |
|---|---|
| 正向路由语 | 含「加载」或 `when to use`/`use when` |
| 负向路由语 | 含「不适用」「不适合」或 `Not for`/`don't use` |

负向路由语是防止误加载的**唯一**手段（`minimax-skills.ts:74-84` 已警告截断会砍掉它）。**现状已实测（2026-10-23 评审）**：22 条 description 中负向路由语缺失约 12 条、正向缺失约 10 条——N6 落地首日即大面积红，属预期；补写按 P0/P1 分批。判据词表须先精确化（中文变体多：「别用于 / 非…场景 / 不要 / 无需」，单一正则会漏），采用「词表 + 逐条白名单豁免（只减不增）」。

#### 4.5.2 L2 离线用例（CI 常驻）

新建 `docs/skill-routing-cases.md`（表格式，便于 review）：

| # | brief | 期望加载 | 禁止加载 | 依据 |
|---|---|---|---|---|
| 1 | 「用纸艺定格讲潮汐」 | `papercraft-stop-motion-explainer` + 总纲 | `minimalist-product-ad-generator` | 预设 1:1 |

门禁只断言**用例自身不腐烂**：期望/禁止集里的 skill 必须存在、两集不交、每条 case 至少一个期望。它**不测模型行为**——这一点必须写进文档，禁止用 L2 冒充 L3。

#### 4.5.3 L3 真机命中率

扩 `canvas-studio-skill-regression-matrix.md`：编号用例 10 → 22（每 skill 一条），报告表新增三列：

| 列 | 定义 |
|---|---|
| 期望加载 | 来自 L2 同一份用例，**不另写一份**（防第二事实源） |
| 实际加载 | 从会话转录里抽取 `skill(name=…)` 调用 |
| 判定 | `hit` / `miss`（漏，缺陷） / `noise`（多，观察项） / `wrong`（错，缺陷） |

**口径（防自欺三条）**：

1. 命中率 = `hit / (hit + miss + wrong)`，**不含 skipped**；
2. `noise` 单列，不计入命中率，但连续两轮 > 3 次即立项（说明 description 路由语过宽）；
3. **同一 case 连续两轮均为 `hit` 才计入「稳定命中」**，首轮 `hit` 可能来自 brief 里写明了 skill 名——那是人工兜底，不是路由成功。

第 3 条最容易被忽略，也最容易自欺。

**执行成本修正（评审修订）**：8 条 × 2 轮 = 16 次真机会话，成本被低估。执行口径改为：**首轮全跑**记录原始值并记为基线；**第二轮只复跑首轮 `hit` 的 case** 确认稳定性（`miss/wrong` 修复后自然重跑，不需占「稳定命中」复跑名额）。

---

## 5. 门禁清单

| # | 文件 | 类型 | 判据摘要 |
|---|---|---|---|
| N1 | `tests/skill-genre.test.mjs` | 新增 | `genre` 取值合法；多值可解析；`none` 仅限能力槽位；`PENDING_GENRE` 只减不增 |
| N2 | `tests/skill-pipeline-presets.test.mjs` | 新增 | `pipeline: true` 集合 ⇄ `style-presets.md` 表格双向相等 |
| N3 | `tests/skill-handoff.test.mjs` | 新增 | decision 必填 / knowledge 禁填 / 目标存在且可承接 |
| N4 | `tests/skill-readset.test.mjs` | 新增 | 知识型必有「最小必读集」；点名文件存在；字节 ≤ 实测阈值 |
| N5 | `tests/skill-routing-cases.test.mjs` | 新增 | 用例集非空；skill 名存在；期望∩禁止 = ∅ |
| N6 | `tests/skill-description-routing.test.mjs` | 新增 | 每条 description 有正向 + 负向路由语 |
| M1 | `tests/skill-platform-meta.test.mjs` | 修改 | `PLATFORM_SLOTS` 不变；新增字段的合法性并入同一处 |
| M2 | `tests/skill-role-consistency.test.mjs` | 修改 | 删除 `DECISION_TYPES`，改由 `role` 推导 |
| M3 | `tests/skill-slots.test.mjs` | 修改 | 不变（`EXCLUSIVE_SLOTS` 语义保持），仅补「6 槽位不得出现在 `genre: none` 之外」的交叉断言 |

**为什么都要机器门禁**：本仓已有实证——`skill-tool-refs.test.mjs` 建立前，总纲安全底线第①条指向已下线工具、三处引用已下线审批门，**结构门禁全部无感**。人工 review 在这个体量（22 skill / 639 KB）下不可持续。

---

## 6. 迁移路径

依赖关系：`B1 → B2 → B3`；`B0` 与 `B4` 可并行。

| 批次 | 内容 | 依赖 | 影响文件 | 回滚方式 |
|---|---|---|---|---|
| **B0** | 修 `skill-expansion-spec.md` 三处漂移；补「参数级默认值对账」门禁 | 无 | 1 文档 + 1 测试 | `git revert` |
| **B1** | L1 静态断言 + L2 用例集 + L3 报告三列 | 无 | 3 新文件 + 2 文档 | 删除用例文件即回退 |
| **B2** | `genre` + `pipeline` 两字段 + N1/N2 门禁 + 存量名单（**一个 PR 填完 22 个 genre，见 §4.1 执行口径**） | B1 | `skill-catalog.ts`（2 处）+ 22 个 yaml（一次填完）+ 2 测试 + 1 脚本 | 字段可选 + 白名单，可随时停 |
| **B3** | `handoff` + N3 门禁 + 删 `DECISION_TYPES` | B2 | 5 个 yaml + 1 测试 + 1 测试修改 | 同上 |
| **B4** | 最小必读集 + N4 门禁 | B1 | 22 个 SKILL.md（分批）+ 1 脚本 + 1 测试 | 同上 |

**B0 具体三处**：

1. `skill-expansion-spec.md:75`：「（可选）补 `src/skill-catalog.ts` 加展示元数据」→ 改为「写 `platform.yaml`（CV-324 起必需）+ 同步 `BUNDLED_CATALOG` 快照」。
2. 同文件 §7 检查清单（`:109-121`）补四条：`platform.yaml` 存在、`role`/`slot` 合法、`genre`/`pipeline` 已填、`references` 分层真实。
3. 新增「工具默认值对账」：`toolchain.md` 里的 `默认 Ns` 必须与 `host-tools.ts` 的工具描述同口径。已抽查 `duration` 5s/10s 目前一致（`toolchain.md` ↔ `host-tools.ts:1948/2019`），但无门禁。

---

## 7. 风险登记

| # | 风险 | 触发条件 | 缓解 |
|---|---|---|---|
| R1 | 新增字段格式写歪 → **整表退回内嵌快照**，表现为「改了没生效」 | 用了 YAML 数组 / 嵌套 / 重复键 | 解析器单测先行；`CATALOG_SOURCE` 已在测试中断言路径（`skill-catalog.ts:622-629`） |
| R2 | 白名单腐烂：`PENDING_GENRE` 长期不 shrinking | 没人推进迁移 | 断言「名单里的必须真缺」，且长度快照只减；名单长度进 STATUS 待办 |
| R3 | `pipeline` 与 `style-presets.md` 双向对账先行落地后，历史 11 行有一行写法不统一 | 表格文本格式微调 | 解析复用既有正则风格（`skill-slots.test.mjs:60-64` 的行匹配），失败文案点名具体行 |
| R4 | L3 真机成本高，22 条跑不动 | 时间/预算 | 分层：P0/P1 共 8 条真跑，其余仅 L1+L2；**但不得把 L2 结果写进命中率** |
| R5 | 度量出来的命中率很低，反向要求改 description → 引发大面积内容改动 | B1 首轮报告 | 命中率作为**基线**记录，不设通过线；优化只在 B2 之后按 case 逐个修 |

---

## 8. 验收标准

| 批次 | DoD |
|---|---|
| B0 | `test:smoke` 全绿；spec 三处漂移为零（人工核对一遍 + §7 清单与实际目录逐条对齐） |
| B1 | `test:smoke` 新增 ≥ 4 条 test；产出首轮 L1 补齐清单与 L3 基线报告（含 22 行，允许 skipped） |
| B2 | 22 个 skill 全部有 `genre`（一次 PR 填完，`PENDING_GENRE` 保持空态）；N1/N2 全绿；`STYLE_SKILLS` 常量已删除 |
| B3 | N3 全绿；`DECISION_TYPES` 已删除；4 个 decision 型 handoff 可解析 |
| B4 | 22 个知识型 skill 有最小必读集；阈值由实测 P90 得出并写入测试注释 |

**总体验收（唯一标准）**：L3 报告的 `miss + wrong` 数量相对 B1 基线下降，且 `noise` 未上升。**不达标则不结项**——这正是原则 P3 的意义。

---

## 9. 待拍板项

| # | 决策 | 选项 | 建议 | 理由 | 代价 |
|---|---|---|---|---|---|
| **D1** | 是否加 `genre` + `pipeline` 两根轴 | A 加两根 / B 只加 `genre` / C 不动 | **A** | 只加 `genre` 会留下 `style-presets.md` 平行表（G2 未解），等于多一份债；两根轴各自消灭一份现有表（P1） | `skill-catalog.ts` 2 处 + 22 个 yaml + 2 门禁 |
| **D2** | `genre` 取值域 | 草案 5 值 + `none` | **照草案** | 与既有 11 类预设的分布对齐；不按题材细分（会膨胀成第二个 `general`） | 改枚举要动 1 处常量 |
| **D3** | 是否引入 `handoff` | A 字段+门禁 / B 只加门禁保留白名单 / C 不动 | **A** | B 的 `DECISION_TYPES` 必然腐烂；A 让新增导演型 skill 自动受约束 | 5 个 yaml + 1 测试 |
| **D4** | L3 真跑范围 | A 全 22 条 / B 8 条 + 全量 L1/L2 / C 不跑 | **B** | 全量成本不可控；只做 L1/L2 会自欺（L2 不测模型行为） | 8 条真跑 |
| **D5** | 是否做注入预算 | A 最小必读集（内容侧） / B platform.yaml tier（元数据侧） / C 不做 | **A** | B 的字段对模型不可见，等于没约束 | 22 个 SKILL.md |

---

## 10. 落地前置动作

1. **CV 编号**：`docs/STATUS.md` 当前最大为 **CV-359**，建议本方案按批次占 `CV-360` 起；**写入前须重新 grep 复核**（本仓撞号三次）。
2. **文档登记**：本文件需在 `docs/README.md` 索引加一行；批次落地后各建 `docs/plans/` 细则。
3. **提交纪律**：`skills/**` 与 `src/skill-catalog.ts`、门禁测试**必须同批提交**（`skill-tool-refs` 与 `skill-platform-meta` 的对账特性决定）。
4. **验收口径**：「已完成」门槛按 `canvas-studio/AGENTS.md:40` = 桌面验收，不是测试通过。

---

## 附录 A：`platform.yaml` v2 schema

```yaml
# 展示元数据（CV-324）—— 广场卡片/侧栏/推荐横滚唯一载体
name: "krea2-turbo-writing"      # 必填，须等于目录名
title: "Krea2 生图提示词"
summary: "…"                      # ≤60 字
category: "prompting"             # spec|prompting|marketing|style|audio|other
icon: "quill"                     # compass|quill|megaphone|film|music|puzzle
hue: 240                          # 0-360
featured: true
hidden: true                      # 与 stage 正交（CV-118）
stage: "preview"                  # ga（缺省）|preview

# 治理元数据（CV-324/325）
role: "knowledge"                 # knowledge|decision
slot: "image-t2i"                 # 6 能力槽位|orchestration|general

# v2 新增（本方案）
genre: "none"                     # 多值逗号分隔；none 仅限能力槽位
pipeline: false                   # true = 有端到端专属流程，须在 style-presets.md 有预设行
handoff: "self"                   # 仅 decision；<skill>@<stage> 或 self
```

**解析器约束提醒**：仅扁平标量；禁数组、禁嵌套、禁重复键；字符串含逗号时须整体加引号（`parsePlatformYaml` 会剥离首尾引号，`skill-catalog.ts:162-170`）。

## 附录 B：22 个 skill 迁移建议值

| # | skill | role | 现 slot | genre（建议） | pipeline | handoff |
|---|---|---|---|---|---|---|
| 1 | `canvas-studio-creation` | decision | orchestration | `none` | false | — （编排者本身） |
| 2 | `h3-prompt-writing` | knowledge | video-prompt | `none` | false | — |
| 3 | `krea2-turbo-writing` | knowledge | image-t2i | `none` | false | — |
| 4 | `krea2-edit-writing` | knowledge | image-edit | `none` | false | — |
| 5 | `music-prompt-writing` | knowledge | audio-music | `none` | false | — |
| 6 | `voiceover-writing` | knowledge | audio-voice | `none` | false | — |
| 7 | `cinematic-moves` | knowledge | camera-language | `none` | false | — |
| 8 | `brand-promo-video-generator` | knowledge | general | `commercial` | **true** | — |
| 9 | `minimalist-product-ad-generator` | knowledge | general | `commercial` | **true** | — |
| 10 | `3d-animation-short-generator` | knowledge | general | `narrative` | **true** | — |
| 11 | `co-op-game-intro-generator` | knowledge | general | `narrative` | **true** | — |
| 12 | `direct-street-interview-video` | knowledge | general | `narrative` | **true** | — |
| 13 | `stage-startle-to-truce-encounter` | knowledge | general | `narrative` | **true** | — |
| 14 | `papercraft-stop-motion-explainer` | knowledge | general | `explainer` | **true** | — |
| 15 | `paper-collage-explainer-generator` | knowledge | general | `explainer` | **true** | — |
| 16 | `handdrawn-live-video-generator` | knowledge | general | `artistic` | **true** | — |
| 17 | `music-video-subtitle-generator` | knowledge | general | `artistic` | **true** | — |
| 18 | `oriental-mythic-visual-director` | knowledge | general | `artistic,narrative` | **true** | — |
| 19 | `action-scene-director` | decision | general | `narrative` | false | `canvas-studio-creation@storyboard` |
| 20 | `bible-story-director` | decision | general | `narrative` | false | `canvas-studio-creation@storyboard` |
| 21 | `code-driven-explainer` | decision | general | `explainer` | false | `canvas-studio-creation@composition` |
| 22 | `effect-test-runner` | decision | general | `utility` | false | `self` |

> `pipeline: true` 的集合 = `style-presets.md` 现有 11 行，**逐名相等**（`STYLE_SKILLS` 常量 11 名已实测核对，`oriental-mythic-visual-director` 本就在 11 行内）。目前未漂移；危险在于两者互不校验，加第 12 个风格 skill 时必须人工同步两处。B2 后这份名单从「两处手维护 + 一处悬空」变成「一个字段 + 一条双向门禁」。

> 迁移后 `general` 剩 15 个不变，但**语义变了**：从「没分类」变为「无能力槽位但有题材归属」。`general` 是否改名（`unslotted`）留待 B2 落地后按 `genre: none` 的分布再定——改名是纯语义收益，现在做属于过早优化。
