# Canvas Studio 技能系统优化方案

> 制定日期：2026-10-15
> 基线：`dev` @ `8fc99b4905`，**CV 已编到 CV-316（下一号 CV-317）**
> 基线红：`tests/baseline-red.json` 的 `failing` 为 `[]` —— 任何 smoke 红都是真回归
> 验证链（顺序不可变）：`corepack yarn check` = typecheck → build → verify:loader → test:smoke
> 输入材料：本轮三份评审与讨论产物（`skill-system-design-review-2026-10-15.md` / `skill-flow-proposal-2026-10-15.html` / `creation-skill-rewrite-blueprint-2026-10-15.html`）
> 状态：**待审核**。审核通过后按 §2 总览分批执行，每批一个 CV 号。

---

## 0. 三项拍板记录（2026-10-15）

| # | 议题 | 拍板 | 直接后果 |
|---|---|---|---|
| D1 | 用户上传 skill 第一阶段范围 | **只开放知识型槽位** | 决策型候选集始终由平台掌控；不需要候选集治理与冲突裁决两套机制 |
| D2 | 槽位机制落地层级 | **先分册绑定表，后续再升级** | 槽位化可在纯文档批次内完成，不动 `src/`；与宿主侧真槽位是平滑升级关系 |
| D3 | `z-image-prompt-writing` / `qwen-image-edit-writing` | **直接删除** | 全局注册 23 → 21；同时解掉 catalog 内 summary 逐字重复 |

---

## 1. 地基：两条判据

整个方案只有两条判断标准。任何一条改动如果违反它们，就是走错了方向。

### 判据一：分轴 —— 决策型 vs 知识型

| | **知识型** | **决策型** |
|---|---|---|
| 回答什么 | 「这个工具的参数该长什么样」 | 「这一步该做什么、按什么顺序」 |
| 会不会打架 | **不会**（查表，不是决策） | **会**（都在描述"该怎么做"） |
| 谁决定加载 | **流程节点绑定**（不由模型选） | 用户选 / 澄清卡选 / 大类兜底 |
| 缺了会怎样 | **流程断裂** | 无所谓（别的能顶） |
| 现状成员 | `h3-prompt-writing` / `krea2-turbo-writing` / `krea2-edit-writing` / `music-prompt-writing` / `voiceover-writing` / `cinematic-moves` | 11 风格生成器 + `bible-story-director` + `action-scene-director` |

**依据**：这 6 个知识型 skill 恰好就是 `skill-catalog.ts` 里除总纲外的 7 个 `hidden: true` 条目中的 6 个（另一个是总纲）。团队当初用 **UI 可见性** 表达了一个**结构性角色区分** —— 判据早已在实践中被摸到，只是没写进架构。

**本方案的第一步就是把它从 UI 标志变成显式契约。**

### 判据二：单条 —— 这条规则会不会因为「多了一个 skill」而变？

> **会 → 不能写死进总纲（移出去或改成槽位）。不会 → 可以写死。**

这把 6 类内容一分为二：

| 能写死（产品定义，用户改不了） | 不能写死（多一个 skill 就过期） |
|---|---|
| 11 步流程顺序与阶段边界 | `必须先加载 h3-prompt-writing`（总纲:55） |
| 审批语义（门禁拦截 / 提交停手 / 放手跑） | `必须先加载 krea2-turbo-writing`（总纲:54） |
| 工具契约（两类 filename / 16:9 / 同步异步） | 风格预设清单（11 类） |
| 安全底线 4 条 + 用户 skill 安全协议 4 条 | 决策型 skill 的路由规则 |
| 能力边界（无视觉能力 / 附件处理） | 工具手册细节、单步细则 |

**右侧 6 项现在有 5 项就写在骨架里 —— 这是总纲会随 skill 增长而腐烂的根本原因。**

---

## 2. 阶段总览

```
第一阶段 · 让总纲撑得住用户上传      CV-317 ~ CV-320
第二阶段 · 切干净 + 瘦身             CV-321 ~ CV-322
第三阶段 · 系统层治理                CV-323 ~ CV-324
第四阶段 · 放开用户上传（知识型）      CV-325 ~ CV-326
```

| 批次 | CV | 交付物 | 需要宿主改动 | 阶段目标 |
|---|---|---|---|---|
| 1 | **CV-317** | 语义门禁（工具引用对账）+ 修 3 处 stale | 否（纯测试 + 3 行文档） | 止血：已确认缺陷不再复发 |
| 2 | **CV-318** | 删两个死 skill | 否（纯文档 + catalog） | 止血：清掉歧义候选 |
| 3 | **CV-319** | 6 个能力槽位 + 绑定表进 toolchain + 总纲去硬编码 + 槽位门禁 | 否（纯文档 + 测试） | **总纲第一次停止枚举 skill 名** |
| 4 | **CV-320** | 5 个 skill 的角色声明重写 | 否（纯文档） | 锁边界，为批次 5 铺路 |
| 5 | **CV-321** | 11 风格 skill 去重 + 总纲 21.0→8.9 KB + 上限冻结 | 否（纯文档） | 消掉打架的结构性来源 |
| 6 | **CV-322** | 渐进披露门禁 + 5 个违规 skill 拆解 | 否（纯文档 + 测试） | 让规范从清单变成约束 |
| 7 | **CV-323** | 激活集注入 system prompt（候选集收敛） | **是**（改 `routing-prompt.ts` + `routes.ts`） | 降低误选 |
| 8 | **CV-324** | 元数据单源化 + skill 结构契约 | 是（改 `skill-catalog.ts` 与注册层） | 扩展税从 4 处降到 1 处 |
| 9 | **CV-325/326** | 用户上传入口 + frontmatter 契约 + 安全协议落地 | 是 | 开放（仅知识型） |

**关键判断：前 6 批（CV-317~322）全部不需要改宿主源码。** 它们合起来就把总纲改造成「撑得住用户上传」的形态 —— 也就是说**第三阶段（宿主改动）不是开放上传的前置条件**，第一阶段做完就可以开始做上传的 UI 与契约。

---

## 3. 逐批次详案

### 批次 1 · CV-317 止血：语义门禁 + 修 stale

**目标**：把「内容正确性」从人工 review 变成 CI 断言。

**为什么排最前**：现有 5 道 skill 门禁（目录成员即注册 / 引用完整性 / kebab-case+description 长度 / 截断哨兵 / catalog 双向断言）**全是结构门禁**。本轮已确认的两类现存缺陷 —— 引用不存在的工具、审批表述过时 —— 结构门禁一个都抓不到。**先修不建门禁 = 下一个版本还会错。**

#### 改动 1：新增 `tests/skill-tool-refs.test.mjs`（约 60 行）

从 `src/host-tools.ts` 的 `defineTool({name: ...})` 提取真实工具表（实测 21 个），扫 `skills/*/SKILL.md` 与 `references/*.md`，把 snake_case 工具名候选与之对账，未注册即红。

**必须带反向验证**：注入一个不存在的工具名（如 `submit_screenplay`）→ 确认变红 → 还原 → 全绿。沿用 `skill-system-optimization.md:80` A2 已有的负向验证纪律。

**豁免清单**（不是所有 snake_case 都是工具名）：`references/*.md` 路径片段、`storyboard.json` / `package.json` 等已知非工具词表、`sora` 一类第三方产品名。豁免必须显式列出且带理由，不得静默跳过。

#### 改动 2：修 3 处已确认的 stale 引用

| 位置 | 现状 | 改为 |
|---|---|---|
| `skills/canvas-studio-creation/SKILL.md:50` | `① 执行模式与审批门禁（submit_screenplay / submit_keyframes 等待与放行语义）` | 删掉 `submit_screenplay`（REQ-022 已下线，权威记录在 `src/approval-gate.ts:98-99`），只留 `submit_keyframes_for_approval` |
| `SKILL.md:18` 与 `:21` | `三个 submit 工具`（三处口径矛盾，:18 标注「最重要的一条」） | 统一为「唯一保留的 `submit_keyframes_for_approval`」，与同文件 `:17` 的正确表述对齐 |
| `skills/direct-street-interview-video/SKILL.md:36`、`skills/stage-startle-to-truce-encounter/SKILL.md:38` | `总纲的**分镜**/关键帧审批节奏` | 分镜门已下线，改为「覆盖层确认落地 + 关键帧条件门」的实际节奏 |

**为什么第 3 项在本批**：这两句今天就不准确（分镜门已不存在），与 CV-319 无关，属于同一类 stale。

#### 验收

- `corepack yarn check` 全绿，`test:smoke` 新增用例全绿
- **负向验证**：注入幽灵工具名 → 变红；还原 → 全绿（**不接受只写不验**）
- `failing` 仍为 `[]`

#### 回退

纯新增测试 + 3 处文案，revert 提交即可，无迁移负担。

#### 收尾四步

1. `STATUS.md` 状态列终态 + §8 变更记录追加一行（**「已完成」= 桌面验收，不是测试通过**）
2. `canvas-ux-backlog.md` 对应行写清实现方式 + 文末变更记录
3. 涉 BUG 则同步 `docs/tracking.md`
4. `git add` 精确路径，信息带条目号：`fix(canvas-studio): skill 工具引用语义门禁 + 修 3 处 stale（CV-317）`

---

### 批次 2 · CV-318 清理：删两个死 skill

**目标**：`z-image-prompt-writing`、`qwen-image-edit-writing` 退出注册表。

**依据（实测）**：
- 运行时路由早已改指 krea2 系列（`skill-catalog.ts:103-104` CV-192、`:135-136` CV-189 的注释原文：「旧 skill 保留不动」）
- 两者在 `skills/` 内**零引用**、零消费者、零路由
- catalog 内 `krea2-turbo-writing` 与 `z-image-prompt-writing` 的 summary **逐字相同**；`krea2-edit-writing` 与 `qwen-image-edit-writing` 仅差「最多 4 张」一处

#### 改动清单

1. 删 `skills/z-image-prompt-writing/`、`skills/qwen-image-edit-writing/` 整目录
2. 删 `src/skill-catalog.ts` 内两条目
3. 核对既有测试无硬编码引用（**实测 `minimax-skill.test.mjs` 的 `EXPECTED_NAMES` 与 `skills-single-source.test.mjs` 的 `UPSTREAM_META` / `UPSTREAM_REFS` 均不含这两个，预计无需改；须实测确认而非假设）**
4. 核对 `docs/` 内无对两者的活跃引用（有历史引用保留，不动）

#### 验收

- 注册数 23 → 21，catalog 21，**三方仍严格 1:1**
- description 预算 8,818 → 8,518 字符（减 300）
- 广场不再出现 summary 重复的卡片
- `corepack yarn check` 全绿

#### 回退

`git revert` 单个提交即可恢复（内容全部在 git 历史里）。

---

### 批次 3 · CV-319 槽位化：总纲第一次停止枚举 skill 名

**目标**：把判据二右侧的 6 项从骨架里清出去，让总纲对「新增 skill」免疫。

**这是整个方案里最重要的一批** —— 它直接回答「用户上传 skill 以后不用改总纲」。

#### 改动 1：`references/toolchain.md` 新增「能力槽位绑定表」节

```
## 能力槽位绑定表

流程节点只声明需要哪一类知识，不指认具体 skill。绑定关系单点维护于此。

| 槽位 | 何时需要 | 当前实现 | 可否被用户 skill 顶替 |
|---|---|---|---|
| video-prompt     | 写视频 IR 前（第 9 步）    | h3-prompt-writing     | 否（内置优先） |
| image-t2i        | 文生图前（第 1/5/6 步）    | krea2-turbo-writing   | 否（内置优先） |
| image-edit       | 图生图/改图前（第 4 步）  | krea2-edit-writing    | 否（内置优先） |
| audio-music      | BGM 生成前（第 10 步）    | music-prompt-writing  | 否（内置优先） |
| audio-voice      | 配音前（第 8 步）         | voiceover-writing     | 否（内置优先） |
| camera-language  | 分镜规划时（第 2b 步）    | cinematic-moves       | 否（内置优先） |
```

**注意 `music-prompt-writing:18` 已经指向 `toolchain.md §"BGM 时长铁律"`** —— 它本来就是引用分册的正确姿势。本批不改它，且**改完之后它从「绕一圈指回分册」变成「直接就是权威源」**。

#### 改动 2：总纲:52-57 的「提示词写法」节槽位化

```
- **图像**：写 prompt 前必须先加载「文生图写作规范」（image-t2i）与「图生图写作规范」（image-edit）
  两个槽位的当前实现，槽位表见 references/toolchain.md；再读 references/prompt-writing.md 对应小节。
- **视频**：写 prompt 前必须先加载「视频提示词写作规范」槽位（video-prompt）的当前实现，
  槽位表见 references/toolchain.md；再读 references/prompt-writing.md（Ref2VA 读 ref-en.txt 六段式 /
  FL2VA 读 base-en.txt 三段式）。
- **硬约束**（不依赖 skill 也要遵守）：文生图路径禁止传 negativePrompt。
- 槽位当前实现加载失败时不卡流程：按 references/prompt-writing.md §"降级骨架"写，
  并在回复开头说明「未按完整规范执行（skill 加载失败）」。
```

#### 改动 3：降级承诺与现实对齐

总纲:57 承诺「按分册里的降级骨架写」，但全 8 本分册只有 `prompt-writing.md:105` 一条 FL2VA 降级骨架（它自己最后一句承认「降级骨架只覆盖 FL2VA」）。

**本批只做一件事：把承诺改窄到与现实一致**（引用上面的槽位表述）。**补齐降级骨架放在批次 5**，因为那时分册正在重排，一起做更省。

#### 改动 4：新增 `tests/skill-slots.test.mjs`

断言：① 绑定表 6 个槽位齐全；② 每个槽位指向的 skill **真实存在于 `skills/`**（防槽位指向幽灵）；③ 总纲正文**不再出现任何知识型 skill 名**（这是判据二的自动化 —— 防回弹）；④ 总纲正文出现的每个 `references/<file>` 真实存在（复用既有断言）。

**③④ 必须做负向验证**。

#### 验收

- `grep canvas-studio-creation/SKILL.md` 不再出现 `h3-prompt-writing` / `krea2-turbo-writing` / `krea2-edit-writing`
- 负向验证：槽位改名 / 塞入幽灵 skill 名 → 变红 → 还原 → 全绿
- `corepack yarn check` 全绿

#### 回退

纯文档 + 测试，revert 即可。

---

### 批次 4 · CV-320 角色声明重写（5 个 skill）

**目标**：重划 5 个 skill 与总纲的职责边界，为批次 5 的大规模去重锁定边界。

**实测的引用面**（23 个 skill 全量核查）：

| 类别 | 数量 | 说明 |
|---|---|---|
| **零引用** | **14** | 9 个风格生成器 + `h3-prompt-writing` + `cinematic-moves` + `voiceover-writing` +（批次 2 删掉的 2 个）。**与总纲结构性解耦，不受任何影响** |
| **引用分册** | **3** | `music-prompt-writing`→`toolchain.md`；`krea2-turbo-writing` / `krea2-edit-writing`→`prompt-writing.md`。**分册不变 ⇒ 不受影响** |
| **角色声明 / 内容依赖** | **5** | 本批处理对象 |

**并且已实测：11 个风格生成器没有一个引用「总纲第 N 步」「§章节名」「优先原则」「安全底线」** —— 这正是它们能与总纲各自复制工作流长达数月而未在引用层混乱的原因。

#### 逐个改动

| skill | 现状声明 | 改为 |
|---|---|---|
| `bible-story-director:28-30` | 「覆盖总纲 `screenplay.md` 的通用叙事骨架——节拍链形态、旁白口径、压缩策略、考据约束，以本 skill 为准」 | 批次 5 会把剧本细则下沉到 `screenplay.md`，**覆盖范围会变大**。本批先写明新边界：**本 skill 覆盖「圣经题材的叙事内容约束」（考据纪律 + 情节忠实），不覆盖「分节格式与写入契约」** |
| `action-scene-director:17` | 「本 skill 是创作总纲在动作场景的专项扩展」 | 补一句**排他条款**：「本 skill 只覆盖动作场景的四条铁律与资产模式，不改变流程顺序、审批语义与工具契约」 |
| `direct-street-interview-video:36` | 「总纲的分镜/关键帧审批节奏」（批次 1 已修 stale） | 本批补充：「节奏以总纲为准，本 skill 不设自己的审批门」 |
| `stage-startle-to-truce-encounter:38` | 同上 | 同上 |
| `effect-test-runner:37` | 「加载创作规范…随后严格按其…」 | 改为不依赖总纲具体章节号：「加载 `canvas-studio-creation` 后按其标准工作流执行」—— **去掉对章节结构的依赖**，使批次 5 的瘦身不会打断它 |

**`effect-test-runner` 特别说明**：它是内部测试工具（Pilot scope = `3d-animation-short-generator`，见 `src/skills/placeholder-tools.ts:14`），23 个 skill 里**唯一有端到端执行回归的一个**，也是批次 8 结构契约的模板来源。改造它要格外小心，验收需真跑一次。

#### 验收

- 5 个 skill 的声明文本与总纲新结构一致，**无一处引用具体章节号**
- `effect-test-runner` 真机跑一次（`test:smoke:raw` + 桌面抽查），确认仍能驱动全流程
- `corepack yarn check` 全绿

---

### 批次 5 · CV-321 切干净决策型 + 骨架瘦身（同批）

**目标**：一次性消掉 80% 重叠，并把总纲从 21.0 KB 降到约 8.9 KB。

**为什么必须同批**：改风格 skill 必然回来看总纲，而瘦身正好动第 9/10 步的措辞。分两批做，口径要对两次。

**⚠️ 这是工作量最大的一批，建议内部再分 2–3 次提交，但对外仍是一个 CV。**

#### 现状基线（实测，供验收对表）

`SKILL.md` 按节字节：

| 节 | 字节 | 占比 | 行 | B/行 |
|---|---:|---:|---:|---:|
| 标准工作流 | 9,879 | 47.0% | 28 | **353** |
| 核心规则 13 条 | 4,913 | 23.4% | 15 | 328 |
| 执行模式与审批门禁 | 2,308 | 11.0% | 9 | 256 |
| frontmatter | 1,570 | 7.5% | 12 | 131 |
| 需求澄清骨架 | 1,607 | 7.6% | 11 | 146 |
| 提示词写法 | 753 | 3.6% | 6 | 126 |
| **合计** | **21,030** | | | |

**两个关键事实**：
1. 「标准工作流」28 行 9.9 KB = **353 字节/行**（约 110+ 中文字符一句），是全部 8 本分册里最密的 —— 模型能读，**人 review 不了**，而「review 时直接看 diff」是 `skill-expansion-spec.md §4` 的核心工程原则。
2. 「核心规则 13 条」实测**第 38–50 行中只有第 13 条（风格 skill 优先原则）属于创作纪律，前 12 条全是平台契约与能力事实**（两类 filename / 同步异步 / 16:9 / sourceUrls / shotRefs / 无视觉能力 / 附件转存 / 资产库 lib:uuid / 产物 URL / image_fix 分工）。这一节实质是**平台事实清单**，却占骨架 23% 且跟着后端版本走（第 40 行那句「后端 0.5.0 起改异步」就写在里面）。

#### 改动 1：11 个风格 skill 交出工作流

每个风格 skill 保留：风格知识（视觉语言、节奏、构图、该风格的特殊约束）、素材要求（Look tokens 侧重、参考图倾向）。
每个风格 skill 交出：简报→大纲→角色卡→分镜→出图→出片→成片的流程叙述（占现有内容约 80%）。

**留下的一句立场**（各 skill 措辞可微调）：
> 本 skill 只提供风格知识与该风格的特殊约束；流程、审批门禁与工具契约一律以 `canvas-studio-creation` 为准。

#### 改动 2：总纲骨架瘦身

| 现在 | 字节 | 之后 | 字节 |
|---|---:|---|---:|
| 标准工作流（28 行细则） | 9,879 | 11 步 × **每步 ≤2 行 + 分册指针** | 3,000 |
| 核心规则 13 条（12 条平台事实） | 4,913 | **安全协议 5 条**（4 条安全底线 + 1 条用户 skill 声明位） | 1,500 |
| 执行模式与审批门禁 | 2,308 | 审批语义（去 stale，CV-317 已清） | 1,500 |
| frontmatter | 1,570 | 描述改槽位语义 | 1,200 |
| 需求澄清骨架 | 1,607 | 压到 4 行 | 600 |
| 提示词写法 | 753 | 能力槽位加载规则（CV-319 已改） | 600 |
| — | — | 遇错处理（门禁报错 / 槽位加载失败） | 500 |
| **合计** | **21,030** | | **≈8,900（降 58%）** |

**去向明确，不新建分册**：
- 9.9 KB 标准工作流细则 → `shot-format.md`（已讲第 3/9/10 步）+ `consistency.md`
- 4.9 KB 平台事实 → `toolchain.md`（已是工具链手册，只是不含这些语义）
- **分册总量 110.2 KB 基本不变，变的是骨架与分册的分工**

#### 改动 3：上限冻结

`tests/skill-catalog.test.mjs` 的 CV-121 断言当前是 `21 * 1024`。三次上调历史（`fa4c5fe8cb` 15KB → `fda88f5bbf` 20KB → `222976df7b` 21KB）已证明**绝对值上限对内容增长是无效约束**。

改为**双指标**：
- 骨架上限 **10 KB**（冻结，留约 11% 余量）
- **分册覆盖率**新指标：骨架中「细则类内容」占比 < 30%（即路由级内容为主）

双指标的意义：即使有人再加内容，**覆盖率指标会先于绝对值报警**，逼着人下沉而不是上调。

#### 改动 4：补齐降级骨架（CV-319 承诺的兑现）

在 `prompt-writing.md` 补齐三条，总纲的承诺才成立：
- `image-t2i` 降级骨架（九段式最简版）
- `image-edit` 降级骨架（指令式四段式最简版）
- 视频 `Ref2VA` 降级骨架（FL2VA 那条的对应版）

#### 改动 5：消 `look.md` ↔ `consistency.md` 重复

实测两条核心规则在两本分册**逐条重复**：「每回合先 `list_references` 读 `role=style`，不凭记忆复述 tokens」与「Look 在前、角色在后」。

**归属裁定**：`look.md` 保留**采集与落卡**（§9.1、§9.3），`consistency.md` 保留**逐镜注入纪律**（它本就叫 consistency，注入是一致性）。§9.2 改为指针。

#### 验收

- 总纲 ≤ 10,000 B 且分册覆盖率 ≥ 70%
- `grep` 确认总纲无 `must load <skill-name>` 类硬编码
- 桌面抽查（**这是关键，「已完成」= 桌面验收**）：
  - 关键帧门仍能拦住越序出图
  - 第 9 步 Ref2VA 仍强制 `≥3 张`
  - C-16 条数纪律仍生效（一个分镜 = 一条视频）
  - 放手跑模式仍一路放行
  - 选一个风格 skill 走全程，确认风格确实被应用且**没有自己的审批门**
- `corepack yarn check` 全绿

#### 回退

本批是最大的一批，**建议每一步单独 commit**，确保任一步可独立 revert。

---

### 批次 6 · CV-322 渐进披露门禁 + 5 个违规拆解

**目标**：把「渐进披露是规范不是选项」从护栏清单变成会红的断言。

**现状（实测）**：`references/` 为空 **10 / 23（43%）**；其中 **5 个 SKILL.md > 10KB 且 references 为空**：

| skill | SKILL.md | references |
|---|---:|---:|
| `minimalist-product-ad-generator` | 32,312 B | 0 ❌ |
| `papercraft-stop-motion-explainer` | 22,853 B | 0 ❌ |
| `paper-collage-explainer-generator` | 20,720 B | 0 ❌ |
| `music-video-subtitle-generator` | 15,689 B | 0 ❌ |
| `brand-promo-video-generator` | 13,667 B | 0 ❌ |

比文档记录的 2026-09-09 基线（9/16）**没有改善**。

#### 改动

1. 新增 `tests/skill-progressive-disclosure.test.mjs`：`SKILL.md > 10KB` 且 `references/` 为空 → 红。**带负向验证**
2. 一次性拆解上述 5 个：正文只留入口，内容按「环节」拆进 `references/`（这 5 个都是上游 MiniMax-H3 一次性导入的风格生成器，结构天然可拆）
3. 在 `skill-expansion-spec.md §1.3` 把这条规则与新门禁绑定，注明由测试执行

#### 验收

- 门禁生效且 5 个 skill 拆完后全绿
- 负向验证：把任一已拆 skill 的 references 移走 → 变红
- 5 个 skill 各真机加载一次，确认拆解未破坏渐进披露链路
- `corepack yarn check` 全绿

---

### 批次 7 · CV-323 候选集收敛

**⚠️ 本批含一处必须先说清的修正。**

#### 修正：`modelInvocable` 不能用来做激活集 gate

我此前建议「8 个 `hidden` skill 设 `modelInvocable: false`」。核对上游实现后发现**这个建议是错的**：

```
deepseek-harness/packages/skill/tool-skill/src/index.ts:139
  throw new Error(`skill "${args.name}" is not available for model invocation`)
```

`modelInvocable: false` 会让模型**根本无法加载**该 skill（直接抛错），**不是**「不进 catalog 但仍可点名加载」。

**两条推论**：
- ❌ **不能**用它隐藏 5 个知识型 skill —— 批次 3 的槽位绑定需要模型能加载它们
- ❌ **它解决不了激活集 gate** —— `ctx.skills.register` 在插件 apply 时调用一次（`src/index.ts:232`），是**全局静态注册**；而 activeSkills 是**按项目**的。静态注册无法表达动态候选集

它唯一正确的用途：`effect-test-runner`（内部测试工具，模型永远不该自主加载）。

**真正的解法是 scope 分层**（`ScopedLayers` / `scopeChainOf`，`skill/src/index.ts:15-16, 528`），即按项目 scope 注册决策型 skill。但这要改项目/会话生命周期，成本明显更高，**建议推迟到第四阶段**，不阻塞开放上传。

#### 本批采用：激活集注入 system prompt

`src/skills/routing-prompt.ts` 已经注册了一个常驻小节（`SKILL_ROUTING_SECTION_ORDER = 150`），文本在 `:51-62`。`routes.ts:1984` 已经能读到当前项目的 activeSkills。

**改动**：把当前项目的激活集渲染进该小节（条件触发，不渲染 `{{variable}}` —— `renderPrompt` 对变量引用是严格的，未知引用会抛错，见 `routing-prompt.ts:22-23`）。

效果：模型看到的决策型候选 = 用户激活集（典型 3–6 个），而不是全部 13 个。

**诚实的边界**：这是**软提示**，不是硬 gate。它降低误选，不保证正确 —— 应当这样对外表述，不要包装成「解决了激活机制」。

#### 验收

- 桌面验证：项目 A 激活 3 个 → 新会话里模型只在这 3 个 + 大类兜底之间选；切到项目 B（激活集不同）→ 候选随之变化
- `corepack yarn check` 全绿

---

### 批次 8 · CV-324 元数据单源化 + skill 结构契约

**目标**：把扩展税从 4 处降到 1 处，并补上 4.3% 的质量回归缺口。

#### 改动 1：元数据单源化

现在新增一个风格 skill 要动 **4 个地方**（新建目录 / `src/skill-catalog.ts` / `references/style-presets.md` / 总纲分类对照行），其中 3 处是改别人的手维护文件。`skill-system-optimization.md` A1 记录的「11 vs 8 漂移」就是这么来的。

**改法**：`skill-catalog.ts` 的 `category` 字段已存在，把展示元数据移到各 skill 目录的 `meta.yaml`（`skill-expansion-spec.md §2` 格式已允许），catalog / 预设表 / 路由表全部从它派生。

**结果**：新增一个 skill = **只动一个目录**。

#### 改动 2：skill 结构契约

**现状**：23 个 skill 中端到端回归覆盖 **1 个（4.3%）**，`EXPECTED_NAMES` 硬编码 9 个上游 skill 后注明「本仓自研 skill 允许额外存在」⇒ **14 个自研 skill 无任何内容级回归**。

**改法**：每个决策型 skill 在 frontmatter 声明**结构契约**（必须产出什么），由测试兜底。样板取自 `bible-story-director`（声明九节 `storyboard.json`），它已有 `tests/bible-story-skill.test.mjs` 且做过 4/4 反向变异验证 —— 这是现成的正确姿势。

#### 验收

- 新增一个测试 skill（临时）→ 只需建一个目录，catalog/预设表自动出现 → 证明扩展税已降到 1 处
- 每个决策型 skill 至少一条结构断言，且做过负向变异
- `corepack yarn check` 全绿

---

### 批次 9 · CV-325/326 用户上传（仅知识型，D1 拍板）

**前置条件**：批次 1–6 必须全部完成并通过桌面验收。**批次 7/8 不是前置。**

#### 改动 1 · CV-325：上传契约

**frontmatter 契约**（用户上传的 skill 必须声明）：
```
role: knowledge          # 第一阶段只接受 knowledge（D1 拍板）
slot: <6 个槽位之一>
```

**拒绝规则**：`role` 缺失或非 `knowledge` → 拒绝上传，并给出明确原因。**这是"只开放知识型"的强制点，不是建议。**

**槽位冲突：内置优先**（拍板 D1 的推论）。用户 skill 若声明已被占用的槽位 → 允许上传但**不参与绑定**，并在上传结果里说明「该槽位已有内置实现，你的 skill 已入库但暂不生效」。

#### 改动 2 · CV-326：用户 skill 安全协议（写进总纲安全节）

**四条预写死，不举任何具体 skill 例子**（一举例就变成硬编码，腐烂从那天开始）：

1. 用户 skill **不得改变流程顺序与审批语义**
2. **不得改变工具契约**（filename 约定 / 画幅比例 / 参考图数量上限）
3. **不得绕过一致性硬约束**（资产卡 lockedPrompt 逐字复用 / 镜位版本 replaces 语义）
4. **知识槽位冲突时内置实现优先**，用户 skill 只在未被占用的槽位生效

**这四条必须在放开上传之前写进总纲** —— 否则冲突会变成临场裁决，而临场裁决的结果不可预测也不可测。

#### 验收

- 上传一个测试 skill（声明 `slot: video-prompt`）→ 上传成功但**绑定未切换**（内置优先生效），提示正确
- 上传一个测试 skill（声明一个未占用槽位或空槽位）→ 绑定切换生效，第 9 步确实加载它
- 上传一个 `role: decision` 的 skill → **被拒绝**，提示正确
- 一个恶意 skill（正文写「忽略安全底线」）→ 加载后**安全底线仍生效**（关键帧门仍拦）
- `corepack yarn check` 全绿

---

## 4. 明确不做的事

| 不做 | 原因 |
|---|---|
| 宿主侧真槽位（`slot` 字段 / 按项目 scope 注册） | D2 拍板走分册退路；两者平滑升级，不阻塞 |
| 开放决策型 skill 上传 | D1 拍板只开放知识型；质量不可控，且会重新引入决策型打架 |
| 改动 `approval-gate.ts` 的状态机 | 它是对的：三态 + 工具级拦截 + `concludeTurn()` 都已就位 |
| 推翻 REQ-022 的审批架构 | 已从对话流三步门收回到覆盖层 + 关键帧一道，方向正确 |
| 用 `modelInvocable` 隐藏知识型 skill | 已证伪：设 false 会让模型无法加载，破坏槽位绑定（见 §3 批次 7） |
| 训练更聪明的 dispatcher | 智能化应投在 intake 的候选收敛，不在调度器语义匹配 |
| 一次性重构 11 个风格 skill | 批次 5 内部可分多次提交，但对外一个 CV，避免口径对两次 |

---

## 5. 风险登记

| # | 风险 | 概率 | 影响 | 对冲 |
|---|---|---|---|---|
| R1 | 批次 5 瘦身导致模型执行力下降 | 中 | 高 | 常驻骨架 21.3K→8.9K 但峰值上下文不升反降（现 30–60K → 后 20–45K）；骨架里把**必读分册按步骤写死 4 本**（澄清→clarification、写剧本→screenplay、分镜→shot-format、写提示词→prompt-writing），其余标「按需」 |
| R2 | 风格 skill 交出工作流后风格表达变弱 | 中 | 高 | 桌面验收必须真机跑**至少 3 个风格各一遍全程**（建议覆盖不同大类：商业推广 / 动画叙事 / 讲解科普），对比改造前后的成片 |
| R3 | 槽位表本身成为新的单一故障点 | 低 | 中 | 槽位表在 `toolchain.md` 一节而非多处；配 `skill-slots.test.mjs` 对账真实 skill 名 |
| R4 | 用户上传 skill 内容夹带指令注入 | 中 | 高 | 四条安全协议**预写死** + 结构契约校验 + 验收用例「恶意 skill 加载后安全底线仍生效」 |
| R5 | 前 6 批做完仍无法开放上传 | 低 | 高 | 已在 §2 论证：**前 6 批纯文档即可完成，开放上传的前置是它们而不是宿主改动** |
| R6 | 大批次（批次 5）review 面过大 | 高 | 中 | 内部多次 commit、每步可独立 revert；对外单 CV；对齐仓库「一次一号」规矩 |

---

## 6. 验收总表

「已完成」的门槛是**桌面验收**，不是测试通过（`AGENTS.md` §编号规则）。

| 批次 | 自动化验收 | 桌面验收（必做） |
|---|---|---|
| CV-317 | `check` 全绿 + 负向验证 2 类 | — |
| CV-318 | `check` 全绿 + 注册数 21 | 广场无重复卡 |
| CV-319 | `check` 全绿 + 负向验证 2 类 + 骨架无硬编码 skill 名 | 选 h3 走一次第 9 步，确认槽位绑定生效 |
| CV-320 | `check` 全绿 | `effect-test-runner` 真跑一次全流程 |
| CV-321 | `check` 全绿 + 骨架 ≤10KB + 覆盖率 ≥70% | **关键帧门 / Ref2VA ≥3 张 / C-16 条数 / 放手跑 / 3 个风格全程** |
| CV-322 | `check` 全绿 + 负向验证 | 5 个拆解 skill 各加载一次 |
| CV-323 | `check` 全绿 | 两个项目切换，候选集随激活集变化 |
| CV-324 | `check` 全绿 + 新增 skill 单目录实验 | — |
| CV-325/326 | `check` 全绿 | **3 个上传用例：占用槽位 / 空槽位 / role=decision 被拒** + 恶意 skill 安全底线仍生效 |

---

## 7. 复算命令

```bash
cd canvas-studio

# ① 完整验证链（铁律，顺序不可变）
corepack yarn check

# ② 单跑原始测试（test:smoke 是门禁包装，不当编译闸门）
corepack yarn workspace canvas-studio test:smoke:raw

# ③ 骨架分节字节（用于批次 5 对表）
python3 - <<'PY'
import re
md=open('skills/canvas-studio-creation/SKILL.md',encoding='utf-8').read()
inb=False; cur={'n':'frontmatter','b':0,'l':0}
for ln in md.split('\n'):
    if ln.startswith('---') and not inb: inb=not inb; continue
    if re.match(r'^##\s',ln) and inb:
        print(f"{cur['n'][:30]:<32}{cur['b']:>7} B  {cur['l']:>3} 行"); cur={'n':ln.strip(),'b':0,'l':0}; continue
    cur['b']+=len(ln.encode())+1; cur['l']+=1
print(f"{cur['n'][:30]:<32}{cur['b']:>7} B  {cur['l']:>3} 行")
PY

# ④ 引用总纲的 skill 全量清单（批次 4 边界划定依据）
grep -rn "canvas-studio-creation" skills/*/SKILL.md skills/*/references/*.md \
  | grep -v "^skills/canvas-studio-creation/"

# ⑤ 真实工具表（CV-317 语义门禁的对照源）
grep -oE "name: '[a-z_]+'" src/host-tools.ts | sort -u

# ⑥ 骨架体积上限的演进史（批次 5 停棘轮的证据）
git log -L '/CV-121：总纲防回弹/,+16:tests/skill-catalog.test.mjs'
```

---

## 8. 相关文档

| 文档 | 关系 |
|---|---|
| `skill-expansion-spec.md` | 硬约束来源。本方案不改其 §1.1 单一事实源、§1.2 目录即注册，只给 §1.3 渐进披露补上执行它的测试（批次 6） |
| `skill-system-optimization.md` | 既有作战台。本方案是其数据复算后的替代升级，覆盖 B2 去重与 B4/B5；§4 护栏第 1、4 条转成本方案的批次 5、6 |
| `creation-skill-rewrite-blueprint-2026-10-15.html` | 批次 3/5 的设计依据（判据二、槽位机制、before/after） |
| `skill-flow-proposal-2026-10-15.html` | 批次 7 的依据（11 步流程 × 三层叠加、状态机现状） |
| `skill-system-design-review-2026-10-15.md` | 四个失效机制的完整论证（激活机制 / description 上限 / 渐进披露规范 / 防回弹门禁） |
| `../deepseek-harness/packages/skill/skill/src/index.ts` | 上游能力边界（§1 判据一的类型依据） |
