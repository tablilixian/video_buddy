# Canvas Studio Skill 系统设计评审

> 评审日期：2026-10-15
> 评审对象：`canvas-studio` skill 体系（`skills/` + `src/skills/` + `src/skill-catalog.ts` + 10 个测试门禁）
> 基线：`dev` @ `8fc99b4905`（feat(canvas-studio): P1 登录闭环 —— Supabase Google PKCE 登录）
> 方法：全量静态核查 + 实测统计。所有结论均附文件行号或可复算的实测值，**无推测项**。
>
> 本文是**只读评审产物**：未改动任何源码，未登记 CV 编号，未提交。

---

## 0. 结论先行

**这是一个"文档纪律驱动 + CI 兜底"的 skill 系统，工程成熟度高于多数团队；但它存在一个结构性判断错误——把 skill 系统当「内容工程」治理，没当「检索问题」治理。**

| 维度 | 评价 | 依据 |
|---|---|---|
| 可维护性 | ★★★★★ | 单一事实源 + 5 道防回弹守卫 + 负向验证意识 |
| 内容正确性 | ★★★★☆ | 引用完整性有硬门禁；13% 体积规范无门禁 |
| **可路由性** | **★★☆☆☆** | **无任何度量、无任何结构收敛手段** |
| 能力边界诚实度 | ★★★★☆ | 占位工具诚实降级 + 逐个转正 |

所有工程投入都在"skill 写得对不对"（体积、引用完整性、命名、溯源），**没有一笔在"模型能不能在 23 个候选里选对"**。

更尖锐的判断：系统里有**四个「看起来在管，实际已经不管」的机制**——断言的形式还在，约束的意图已经丢了。这是当前最大的风险来源。

---

## 1. 设计原则（6 条）

按「证据强度」排序，而非声明顺序。

| # | 原则 | 出处 | 证据强度 |
|---|---|---|---|
| P1 | **单一事实源**：`skills/` 手工维护、随包发布、写入即生效 | `docs/skill-expansion-spec.md` §1.1 | ★★★★★ |
| P2 | **目录成员即注册**：有 `SKILL.md` 即注册，零代码改动 | §1.2 / `src/skills/minimax-skills.ts:30-35` | ★★★★★ |
| P3 | **一切约束编译成测试** | 10 个测试文件 / 61 个 test / 1,232 行 | ★★★★★ |
| P4 | **内容所有权**：一次性导入后本仓拥有，可直接改正文 | §1.4 | ★★★★☆ |
| P5 | **能力边界诚实**：占位工具返回可操作降级路径而非报错 | `src/skills/placeholder-tools.ts:53` | ★★★★☆ |
| P6 | **渐进披露**：SKILL.md 精简入口 + `references/` 按需 read | §1.3 | ★★☆☆☆ **规范存在，现实相反** |

补充两条非文档化的隐含原则：

- **P7 路由靠双保险**：catalog `description`（软）+ system prompt 硬指令（`src/skills/routing-prompt.ts:51-62`）。
- **P8 冲突时特化优先**：风格 skill > 总纲，但安全底线例外（CV-121 方案 Z + 优先级反转）。

---

## 2. 优点（有证据）

### 2.1 单一事实源是一次真正的架构纠错，且防住了回弹

**历史结构（已废弃）**：双源——pinned 上游 submodule 逐字节同步 + `skills-local/` 覆盖合并，`skills/` 是二者并集产物。这套结构必然产生"我到底该改哪个目录"的漂移。

**现状**：`docs/skill-expansion-spec.md:6` 记录 2026-09-17 整合——上游 submodule、`skills-local/`、`scripts/sync-minimax-skills.mjs` 全部移除，`skills/` 升为唯一手写源。

**防回弹**（`tests/skills-single-source.test.mjs`，6 个 test / 173 行）五道守卫：

1. `skills-local/` 目录与 sync 脚本不得重建（:94）
2. `build` 首步必须是 `clean` 而非 skill 同步（:107）
3. 源码/脚本/配置/根启动脚本不得出现上游 submodule 名（:115）
4. 上游独有的 8 件署名 `meta.yaml` 在位且带 `author-en`（:129）
5. 上游独有、被正文引用的 5 件 `references/` 在位（:144）
6. 启动脚本的存在性判据须指向真实路径（:153）

**特别值得称道的细节**：守卫 #3 在扫描前先 `stripComments`（:86-92），注释里写旧路径不算违规，但"只删注释"也不算真修好——它防的是**自我欺骗式的修复**。这种考虑通常出现在做过一次真实回退的团队里。

### 2.2 约定优于配置是真的零成本

`MINIMAX_SKILL_NAMES` 仅靠 `readdirSync` + `existsSync(SKILL.md)` 推导（`minimax-skills.ts:30-35`），23 个 skill 全部由 `registerMinimaxSkills` 一个函数注册（:165-173）。**新增一个 skill 不改一行注册代码。**

实测验证：`skills/` 23 个目录 = `MINIMAX_SKILL_NAMES` 23 个 = `SKILL_CATALOG` 23 条，**三者严格 1:1**，且 `frontmatter.name` 与目录名零偏差。

### 2.3 渐进披露在总纲上是成功的

```
SKILL.md 全体积     249,174 B
references 全体积   509,448 B   （2.04 倍）
```

总纲做成了 21KB 路由级骨架 + 8 个分册（`skill-catalog.test.mjs:121-124` 断言 8 件分册存在且 >200 字节）。若不分册，全部内容将常驻上下文。**这是正确的结构选择。**

### 2.4 门禁有负向验证意识（多数团队没有）

`docs/skill-system-optimization.md:80` A2 条目明确记录：

> **负向验证已做**：往 catalog 注入假条目 → 测试变红；还原 → 8/8 绿（断言确实有效，非空转）

写测试和验证测试有效是两件事。这个仓库明确区分了它们。

### 2.5 诚实边界的建模很克制

`subtitle_burn` 不假装成功（`placeholder-tools.ts:50-55`），返回三条可执行替代路径，并在工具 `description` 里写明"CV-213 默认不开字幕，无用户显式要求时调用本工具即被认为违反自动字幕禁令"（:37）。

占位工具随能力补齐**逐个转正**并从注册表移除：`music_generation`（CV-125）、`tts_voiceover`（CV-271），从 3 个收敛到 1 个（:10-12）。这是"占位是负债，转正是目标"的正确姿态。

### 2.6 CV-118 把 `hidden` 拆成「可见性 × 生命周期」两个正交维度

原 `hidden?: boolean` 一个字段混了两种意图（技术类永久隐藏 / 试跑期临时隐藏）。现拆为 `hidden` + `stage: 'ga' | 'preview'`（`skill-catalog.ts:62-75`），并有组合合法性断言（`skill-catalog.test.mjs:61-71`）。

**小而正确的模型改进**——当前 2 个 skill 处于 `preview`：`bible-story-director`、`oriental-mythic-visual-director`。

---

## 3. 缺点（实测）

### 🔴 D1 激活机制是纯 UI 概念，对模型零作用 —— 最严重

**实测链路**：

| 环节 | 代码位置 | 是否影响模型 |
|---|---|---|
| 全部 23 个 skill 注册 | `src/index.ts:232` → `minimax-skills.ts:165-173` | ✅ 进入模型 catalog |
| activeSkills 写入 | `src/routes.ts:2011-2020`（POST，幂等整表替换） | ❌ 仅写 `skills.json` |
| activeSkills 读取 | `src/routes.ts:1984` | ❌ 仅供 UI |
| activeSkills 渲染 | `src/client/StudioFrame.tsx:2530` → `ActiveSkillChips` | ❌ 仅渲染 chips |
| activeSkills 上限 | `MAX_ACTIVE_SKILLS = 12`（`routes.ts:261`） | ❌ 与注册无关 |

**后果**：用户"装载"的 5 个和没装载的 18 个，在模型 catalog 里**完全等价**。UI 给出了"我在管理技能集合"的心理暗示，实际什么都没管。

**而上游 `dsh-skill` 已提供完整解法，canvas-studio 一处未用**：

```ts
// deepseek-harness/packages/skill/skill/src/index.ts:48-53, 56-62, 96-101
interface SkillInvocationPolicy {
  readonly modelInvocable: boolean   // ← 「是否进模型可见 catalog」
  readonly userInvocable: boolean
}
interface SkillSummary {
  readonly description: string
  readonly whenToUse?: string        // ← 独立于 description 的额外路由指引
}
type SkillRegistration = Omit<SkillDefinition, 'invocation' | 'provider'> & {
  readonly invocation?: SkillInvocationPolicy
  readonly provider?: string
}
// 另有 ScopedLayers / scopeChainOf / ScopeKey 分层注册（:15-16, :327-347）
```

实测 `minimax-skills.ts:166-172` 注册只传了 `{ name, description, source, content, resourceBase }`：

| 上游字段 | 是否使用 | 后果 |
|---|---|---|
| `invocation.modelInvocable` | ❌ | 8 个 `hidden: true` 技术类 skill 仍占每轮路由额度 |
| `whenToUse` | ❌ | 负向路由语被迫挤进有长度上限的 `description`（见 D2） |
| `metadata` | ❌ | 催生手写展示表（见 D5） |
| scope 分层 | ❌ | 无法按项目/会话收敛 catalog |

这 8 个仍在模型视野内的技术类 skill：`canvas-studio-creation`、`h3-prompt-writing`、`krea2-turbo-writing`、`krea2-edit-writing`、`z-image-prompt-writing`、`qwen-image-edit-writing`、`music-prompt-writing`、`voiceover-writing`。

**其中最不该由模型自主选择的是 `canvas-studio-creation`**——它是「必须第一个加载」的创作总纲，应由 system prompt 或作用域强制，而非放进候选池让模型挑。

### 🟡 D2 description 单字段承载全部路由语义，而上游本有专门字段

`whenToUse` 是上游为「额外路由指引」预留的**独立字段**（`index.ts:62`），**不受 description 长度上限约束**。canvas-studio 没用，全部路由信息压进有上限的 `description`。

**实测后果**：

```
最长 description  papercraft-stop-motion-explainer  914 字符
DESCRIPTION_LIMIT                                  1024  (minimax-skills.ts:84)
测试断言   DESCRIPTION_LIMIT >= max + 100   (minimax-skill.test.mjs:152-156)
→ 实际余量：1024 - 1014 = 10 个字符
```

**任何人给任一 skill 的 description 加 11 个字，smoke 就红。** 这把"内容质量"和"基础设施阈值"焊死在同一个数字上——而这个数字本可以不存在。

`minimax-skills.ts:74-83` 的注释坦承了这个设计的脆弱性：

> **不要随手调小**——description 是模型在 catalog 中选择 skill 的唯一依据，截断会静默砍掉排在最末的负向路由语……且改动前后都无日志，故障极难发现。

SK-08（:174-180）已补上启动期汇总日志，让截断从"静默"变为"可见"——这是正确的补救，但**补救的是可观测性，不是结构性缺陷**。

### 🟡 D3 渐进披露写成了规范，现实是少数派

**规则原文**（`docs/skill-system-optimization.md:176`，§4 护栏第 4 条）：

> 渐进披露是规范不是选项：新增 skill 若 SKILL.md > 10KB，应拆 `references/`，与 h3-prompt-writing 对齐。

**实测**：

```
references/ 为空的 skill：  10 / 23  （43%）
```

比文档记录的基线更差——`skill-system-optimization.md:33` 记录的 2026-09-09 基线是 `9/16（56%）`。**新增 14 个 skill 后，比例几乎没动。**

**违反该规则的具体对象（SKILL.md > 10KB 且 references/ 为空）**：

| skill | SKILL.md | references |
|---|---|---|
| `minimalist-product-ad-generator` | 32,312 B | 0 ❌ |
| `papercraft-stop-motion-explainer` | 22,853 B | 0 ❌ |
| `paper-collage-explainer-generator` | 20,720 B | 0 ❌ |
| `music-video-subtitle-generator` | 15,689 B | 0 ❌ |
| `brand-promo-video-generator` | 13,667 B | 0 ❌ |

这 5 个每次 `skill(name=)` 全量入上下文。**关键是：这条规则没有任何测试执行它**——它躺在护栏清单里，违反它的 skill 一直在增长。

对照：`skill-system-optimization.md:145`（C 组）当初已明确下调过"渐进披露扎实"的评价，理由正是"基于 3 个 skill 的选择性取样"。**结论正确，但对应的整改措施只做了总纲一个（CV-121 拆分），没有变成门禁，于是其余 5 个原地不动。**

### 🟡 D4 防回弹门禁本身正在回弹

**git 硬证据**——`tests/skill-catalog.test.mjs` CV-121 断言的体积上限三次上调：

| commit | 内容 | 上限变更 |
|---|---|---|
| `fa4c5fe8cb` | feat(skills): CV-121 总纲拆分 references + 风格 skill 优先原则 | 引入 `15 * 1024` |
| `fda88f5bbf` | feat(canvas-studio): Drama 0.5.0 异步视频任务接入（CV-237~240） | `15 KB` → **`20 * 1024`** |
| `222976df7b` | feat(canvas-studio): REQ-022 拍摄定稿 UX（CV-299） | `20 KB` → **`21 * 1024`** |

第二次上调时删掉了所有解释，只留断言；第三次上调时补回注释（`skill-catalog.test.mjs:110-111`）：

> 21KB：REQ-022 创意先行批后略超原 20KB 上限（用户确认后续自行优化 skill 体积）；上限只拦「失控膨胀」，不拦几千字节的正常增补。

**当前状态**：

```
skills/canvas-studio-creation/SKILL.md   21,323 B
测试上限  21 * 1024                     21,504 B
→ 剩余余量                                181 B   （0.8%）
```

**判断**：一条每被内容顶穿一次就上调一档的上限，已经从"防回弹门禁"退化为"记录当前值的快照"。第三次上调时的措辞（"用户确认后续自行优化"）本身就是**承认门禁失效但选择不修复**的记录。181 字节的余量意味着总纲再加一行字就会第四次上调。

### 🟡 D5 展示元数据双源，且它的理由已经过期

`src/skill-catalog.ts:5-8` 文件头给出的理由：

> 之所以不走 SKILL.md frontmatter 扩展，是因为上游 skill 严禁改编（skill-expansion-spec.md 第 1 条）——不能往 H3 原版 SKILL.md 里塞 category / icon / 中文标题。

**但这个约束在 2026-09-17 就已撤销**：

- `skill-expansion-spec.md:10`：MiniMax-H3 bundle 是"**2026-08-15 一次性零改编导入**……此后由本仓库拥有并适配——这是**导入，不是持续跟随**"
- `skill-expansion-spec.md:13`：**"当 skill 正文写了与本产品冲突的流程时，直接改 `skills/` 下的正文即可……本仓库对其内容有完整所有权，这不叫「改编上游」"**
- `skill-expansion-spec.md:24`：目录格式已明确允许可选 `meta.yaml`（展示元数据：版本/标签/摘要/署名）
- 上游 `SkillRegistration` 也接受 `metadata`（`index.ts:82, 92`）

**理由过期后，手写表留下了直接产物**——实测 catalog 内逐字重复的 summary：

```ts
{ name: 'krea2-turbo-writing',  summary: '文生图九段式结构、无负向提示词的正向改写规则、打光与文字渲染词表。' }
{ name: 'z-image-prompt-writing', summary: '文生图九段式结构、无负向提示词的正向改写规则、打光与文字渲染词表。' }  // 逐字相同
```

`krea2-edit-writing` 与 `qwen-image-edit-writing` 亦高度相似（仅"最多 4 张"一处差异）。

而运行时路由早已改指 krea2 系列——`skill-catalog.ts:103-104` 写明：

> CV-192：txt2image 后端已切 Krea2 Turbo……新增文生图规范并把运行时路由从 z-image-prompt-writing 改指本条；**旧 skill 保留不动**。

**"保留不动"的代价**：无活跃消费者的旧 skill 仍在注册、仍占 description 预算（8,818 字符总预算的一部分）、仍向模型投喂歧义候选、仍在广场制造两张一模一样的卡。CV-189 的 `qwen-image-edit-writing` 同理。

### 🟡 D6 与总纲的职责重叠是设计选择，但代价被低估

`skill-system-optimization.md:107`（B2）记录的实测：

> 每个风格 skill 都重写完整工作流（简报→大纲→角色/场景卡→分镜→视频→成片），与总纲重复约 80%，真正风格化的仅 20%。改动主流程需同步改 **9 个文件**。

**落地选择是务实的**（同文件 :109）：方案 Z + 优先级反转——不做文件改写，只在总纲加一条"风格 skill 优先原则"，安全底线（审批门禁 / 一致性硬约束 / 工具参数硬限制）明示不参与。

**但代价被低估了三点**：

1. **一致性从结构期转移到运行期**。改主流程不再有编译期/结构期的天然检查，全靠模型遵守优先级规则。
2. **例外条款只有 prompt 一处声明，零测试守护**。"安全底线不参与优先级反转"是整套安全模型的支点，却没有任何断言检查它没被后续改动侵蚀。
3. **方案 X（薄壳化）被推入 backlog 的触发条件是定性的**（"若实践下来仍有平行工作流漂移"），没有度量。

### 🟡 D7 没有 skill 级的质量回归

`minimax-skill.test.mjs:26-37` 的 `EXPECTED_NAMES` 硬编码 9 个上游 skill，注释明写"**本仓自研 skill 允许额外存在**"。

**后果：14 个自研 skill 只有"能注册"和"在 catalog 里"两项检查，没有任何内容级回归。**

唯一的端到端探针 `effect-test-runner`，其覆盖范围在 `placeholder-tools.ts:14` 写死：

> Pilot scope is driven by `3d-animation-short-generator`

**23 个 skill 里只有 1 个有真实执行回归（4.3%）。**

自动门禁能发现"skill 没注册 / 引用断链 / catalog 不一致"，但发现不了"skill 加载了、跑通了、产出不合规"——而后者才是 skill 系统真正的产出质量。

---

## 4. 四个「看起来在管，实际已经不管」的机制

这是本文的核心判断。它们的共同特征是：**断言的形式在，约束的意图丢了。**

| # | 机制 | 看起来在管什么 | 实际状态 | 证据 |
|---|---|---|---|---|
| 1 | **激活机制** | 用户装载的 skill 进入模型视野 | 纯 UI 概念，注册不受影响 | `routes.ts:2011` ↔ `minimax-skills.ts:165`；上游 `modelInvocable` 未用 |
| 2 | **description 上限** | 保护负向路由语不被截断 | 上限追着内容走，只剩 10 字符余量 | `minimax-skill.test.mjs:152` vs 实测 914/1024 |
| 3 | **渐进披露规范** | >10KB 必拆 `references/` | 只在文档，无门禁；5 个违规 | `skill-system-optimization.md:176`；实测 10/23 refs=0 |
| 4 | **防回弹门禁** | 总纲体积不失控 | 上限三涨，内容 21,323 B，余量 181 B | `fa4c5fe`→`fda88f`→`222976d` |

对照一个**真正在管**的机制（2.1 的单一事实源守卫）：它有迁移史、有 6 个 test、有"剥注释扫描"这种针对自我欺骗的设计、有反直觉的职责边界。它不会在内容增长时自动退让。

---

## 5. 判断与理由

### 5.1 判断

**这个系统做对了「可维护性」，没做「可路由性」。**

### 5.2 理由

**理由一：它自己的代码注释承认了结构性缺口。**

`src/skills/routing-prompt.ts:9-11` 写得非常坦率：

> catalog 摘要只是「技能广告位」，模型是否优先读它取决于自身策略；
> description 有长度上限（见 DESCRIPTION_LIMIT），硬指令会挤占本该用于「路由匹配」的负向路由语。

SK-01 把软性祈使句升级为 system prompt 常驻硬指令（`routing-prompt.ts:69-74`），这本身是务实的正确补救。

**但为什么需要它？** 因为 catalog 本身不提供任何收敛能力——23 条 description、8,818 字符、零优先级信息、零可见性控制。团队只能靠提示词纪律，去补结构能力的缺失。

**理由二：所有产出物都是内容侧的，没有一个产品侧的。**

仓库现有的 skill 文档全部是内容工程口径：`skill-expansion-spec.md`（怎么加 skill）、`skill-features-inventory.md`（功能点验收到哪一步）、`skill-regression-matrix.md`（人工回归矩阵）、`effect-tests/`（1 个 skill 的效果测试）。

**没有任何一份材料度量"模型选对 skill 的概率"。** 没有路由准确率、没有误加载率、没有负向路由语生效的观测。

**理由三：`canvas-studio-creation` 的加载靠硬指令而非机制。**

`routing-prompt.ts:51-62` 用 6 行硬文本要求"第一个动作必须是 `skill(name='canvas-studio-creation')`"，并要求模型自查"若你已提问或调用过工具，立即停止"。这条规则的背景是 CV-094 的一次真实复盘——模型自行追问三轮才加载总纲（:6-8）。

**这是用提示词修补架构的正确补救，但它证明了一个事实：架构本身不保证总纲被加载。** 一个"最高优先级、先行加载"的规范，需要靠祈使句 + 自查 + 失败降级三层话术才压得住。

### 5.3 与「做对了什么」的关系

必须说清楚：这**不是**一个做得差的系统。

- 单一事实源的纠错 + 5 道防回弹守卫（含反自我欺骗的注释剥离），是很多团队两年都走不到的位置；
- 负向验证意识（注入假条目证明断言有效）超出绝大多数团队的实践水平；
- `stage` / `hidden` 正交化、占位工具逐个转正、`stripComments` 防假修复，都是**有经验的人才会做的设计**。

**问题不是执行不力，是议题选择。** 团队选择了治理"内容质量"并做到了优秀，却跳过了"检索质量"——而后者才是 skill 系统区别于"一组 markdown 文档"的本质。

---

## 6. 建议（按投入产出排序）

> 均为**填已存在的洞**，非新建机制。

### P0 — 接上 `invocation.modelInvocable`（唯一治本项）

**依据**：`index.ts:48-53` 接口已就位，`SkillRegistration.invocation` 已就位。

- 8 个 `hidden: true` 的技术类 skill 设 `modelInvocable: false`
- `canvas-studio-creation` 改为由 system prompt 直接加载，或置于独立作用域
- 用户的 activeSkills 变成真正的 gate（配合上游 scope 分层 `ScopedLayers`）

**收益**：模型 catalog 从 23 条降到按需（典型 3–6 条），8,818 字符路由预算大幅压缩，路由准确率与准确率同时改善。

**成本**：`minimax-skills.ts:166-172` 传参 + 读取 `skill-catalog.ts` 的 `hidden` 字段；约 20 行。

### P1 — 用 `whenToUse` 承接负向路由语

**依据**：`index.ts:62` 字段已存在且无长度上限。

- `description` 压回 ~200 字符（说"这是什么"）
- 负向路由语（"Not for KOC talking-head ads…"）移入 `whenToUse`（说"什么时候别用"）

**收益**：`DESCRIPTION_LIMIT` 与内容彻底解耦，10 字符的雷解除；路由信息容量不再与截断风险赛跑。

### P2 — 把 ">10KB 必拆 references/" 写成测试

**收益**：会立刻点出 5 个违规 skill（32KB / 23KB / 21KB / 16KB / 14KB），强制处置。写进护栏清单等于没写——这一点已被 D3 证明。

### P3 — CV-121 体积上限冻结，或换指标

**建议**：不要再上调 21KB。改为**双指标**——(a) 骨架绝对上限冻结；(b) 新增"分册覆盖率"要求（SKILL.md 中细则类内容占比 < X%）。

**理由**：三次上调已经证明绝对值上限对内容增长是无效约束。

### P4 — 清理无活跃消费者的重复 skill

**对象**：`z-image-prompt-writing`、`qwen-image-edit-writing`（运行时路由已改指 krea2 系列，见 `skill-catalog.ts:103-104, 135-136`）。

**理由**：零活跃消费者的 skill 是纯负债——占 description 预算、向模型投歧义候选、占 catalog 卡片、触发重复 summary 审计负担。

### P5 — 给「安全底线不参与优先级反转」加测试守护

**理由**：这是 D6 中整套安全模型的唯一支点，目前仅有 prompt 一处声明，无任何断言检查它未被侵蚀。

### P6 — 建 skill 质量回归（长期）

**建议**：把 `effect-test-runner` 从 1 个 skill 扩到覆盖所有 `preview` 与主力风格 skill，或建"skill 契约测试"——每个 skill 声明其必须产出的结构（如 `bible-story-director` 声明九节 `storyboard.json`），由结构断言兜底。

---

## 7. 附录：实测数据（可复算）

### 7.1 逐 skill 统计

| skill | description 字符 | SKILL.md B | 行 | references | catalog |
|---|---:|---:|---:|---:|---|
| `papercraft-stop-motion-explainer` | 914 | 22,853 | 471 | 0 ❌ | hidden |
| `brand-promo-video-generator` | 800 | 13,667 | 189 | 0 ❌ | style |
| `paper-collage-explainer-generator` | 773 | 20,720 | 273 | 0 ❌ | style |
| `co-op-game-intro-generator` | 733 | 8,974 | 56 | 2 | style |
| `music-video-subtitle-generator` | 703 | 15,689 | 209 | 0 ❌ | audio |
| `handdrawn-live-video-generator` | 685 | 8,490 | 87 | 0 ❌ | style |
| `3d-animation-short-generator` | 594 | 14,803 | 247 | 5 | style |
| `bible-story-director` | 489 | 9,060 | 104 | 5 | style·preview |
| `minimalist-product-ad-generator` | 428 | 32,312 | 397 | 0 ❌ | marketing |
| `h3-prompt-writing` | 352 | 7,586 | 113 | 9 | hidden |
| `oriental-mythic-visual-director` | 321 | 6,587 | 86 | 1 | style·preview |
| `canvas-studio-creation` | 271 | 21,323 | 86 | 8 | hidden |
| `voiceover-writing` | 266 | 6,087 | 85 | 1 | hidden |
| `music-prompt-writing` | 257 | 10,106 | 135 | 2 | hidden |
| `krea2-turbo-writing` | 188 | 7,574 | 88 | 0 | hidden |
| `action-scene-director` | 184 | 7,695 | 114 | 3 | style |
| `krea2-edit-writing` | 168 | 6,967 | 80 | 0 | hidden |
| `qwen-image-edit-writing` | 165 | 5,842 | 93 | 0 | hidden |
| `z-image-prompt-writing` | 140 | 4,891 | 79 | 0 | hidden |
| `effect-test-runner` | 120 | 8,008 | 66 | 1 | other |
| `stage-startle-to-truce-encounter` | 101 | 3,414 | 48 | 8 | style |
| `direct-street-interview-video` | 93 | 3,102 | 46 | 6 | style |
| `cinematic-moves` | 73 | 3,424 | 59 | 3 | prompting |

### 7.2 聚合指标

| 指标 | 实测值 | 出处 |
|---|---:|---|
| `skills/` 目录数 = 注册数 = catalog 条目数 | 23 = 23 = 23 | 三方严格 1:1 |
| `frontmatter.name` 与目录名偏差 | 0 | 全量核对 |
| description 字符总量 | 8,818 | 折叠标量展开后 |
| 最长 description | 914（`papercraft`） | |
| `DESCRIPTION_LIMIT` | 1,024 | `minimax-skills.ts:84` |
| 截断余量（测试要求 max+100） | **10 字符** | |
| `references/` 为空的 skill | 10 / 23（43%） | |
| >10KB 且无 references（违规） | 5 | |
| `SKILL.md` 总体积 | 249,174 B | |
| `references/` 总体积 | 509,448 B | |
| 总纲 `SKILL.md` / 测试上限 / 剩余 | 21,323 / 21,504 / **181 B** | |
| `hidden: true` 条目 | 8 | |
| `stage: 'preview'` 条目 | 2 | |
| `MAX_ACTIVE_SKILLS` | 12 | `routes.ts:261` |
| skill 测试门禁 | 10 文件 / 61 test / 1,232 行 | |
| 有端到端效果回归的 skill | 1 / 23（4.3%） | `placeholder-tools.ts:14` |
| 上游已就位但未用的字段 | `invocation` / `whenToUse` / `metadata` / scope | `index.ts:48-62, 96-101` |

### 7.3 复算方法

```bash
cd canvas-studio
# 引用完整性门禁（现行）
corepack yarn workspace canvas-studio test:smoke
# 总纲体积与分册
sed -n '102,130p' tests/skill-catalog.test.mjs
# 上游能力
sed -n '44,101p' ../deepseek-harness/packages/skill/skill/src/index.ts
# 体积上限演进
git log -L '/CV-121：总纲防回弹/,+16:tests/skill-catalog.test.mjs'
```

---

## 8. 相关文档

| 文档 | 关系 |
|---|---|
| `docs/skill-expansion-spec.md` | 硬约束来源（§1 设计原则）。本文对其 §1.3「渐进披露」的**执行现状**提出 D3 |
| `docs/skill-system-optimization.md` | 既有作战台。本文是其数据源的复算 + 议题选择层面的判断 |
| `docs/skill-features-inventory.md` | 功能点验收状态。本文不重复 |
| `docs/minimax-skills-acceptance.md` | 桌面回归验收方法 |
| `docs/canvas-studio-tools.md` | 工具侧契约（占位工具降级路径的上游） |
| `../deepseek-harness/packages/skill/skill/src/index.ts` | 上游 skill 注册表能力边界（D1/P0/P1 的依据） |
