# Skill 系统优化作战台

> 创建日期：2026-09-09 · 基线：`dev` @ `4e5a75cca7`
> 定位：**唯一用于讨论「skill 系统怎么改」的工作文档**。对着这份文档打磨，逐条销项。

---

## 0. 文档分工（先说清楚，避免第 9 份 skill 文档变成新的漂移源）

| 文档 | 职责 | 是否在本文档讨论范围内 |
|---|---|---|
| **本文件** `skill-system-optimization.md` | **问题清单 + 行动清单**（改什么、怎么改、改到什么程度算完） | — |
| `STATUS.md` | 单一事实来源：CV 编号、每条的状态列 | 条目正式立项后登记到这里 |
| `skill-features-inventory.md` | 功能点 × 验收状态（验收到哪一步了） | 只引用，不重复 |
| `skill-system-analysis.md` | 架构全景 + H3 能力评估 + 设计评分 | **输入源**，本文件吸收其矛盾与优先级 |
| `skill-expansion-spec.md` | 扩充规范（零改编 / 目录格式） | 硬约束来源，不在此改 |
| `h3-context-ir-integration-plan.md` | H3 集成方案（已完成） | 归档性文档 |
| `t8-skill-repo-analysis.md` / `image-skill-research.md` / `lobby-skill-marketplace-plan.md` | 各次调研的原始素材 | 需要时回溯 |
| `canvas-studio-optimization-backlog.md` | 画布整体 backlog（非 skill 专项） | 交叉项互相指路 |

**规则**：本文件的行动项一旦开工，先在 STATUS.md 领 CV 号；完成后在本文件销项，不在本文件记录状态历史（状态只属于 STATUS.md）。

---

## 1. 基线快照（2026-09-09 实测，非估计值）

| 指标 | 实测 | 出处 |
|---|---|---|
| 已注册 skill | 16 | `skills/` 目录 = `MINIMAX_SKILL_NAMES` |
| catalog 条目 | 16 | `src/skill-catalog.ts` |
| hidden 条目 | 5（总纲 + h3/z-image/qwen + oriental-mythic） | 同上 |
| style 分类 | 8（含 hidden 的 oriental-mythic，广场可见 7） | 同上 |
| **references 为 0 的 skill** | **9 / 16（56%）** | 实测 `skills/*/references/` |
| 总纲体积 | 49,008 字节 / 289 行，**references = 0** | `skills-local/canvas-studio-creation/SKILL.md` |
| 风格预设 | **11 类** | 总纲 `SKILL.md:157` |
| `STYLE_DEMO_MAP` | **8 对** | `src/client/question-capture.tsx:22` |
| catalog `demo:` 字段 | **8 条** | `src/skill-catalog.ts` |
| GIF 资产 | **8 个** | `assets/style-demos/` |
| 校验器被工具链引用 | **0 处**（仅自身定义 + 测试 + CLI） | grep `validateH3Ir` in `src/` |

---

## 2. 问题清单

### A 组：2026-09-09 实测新发现

#### A1 🔴 风格映射四处漂移：11 vs 8 — ✅ CV-116 已落地·待验收

CV-109 把总纲风格预设从 8 类扩到 11 类，但**下游三处全部停在 8**：

| 层 | 位置 | 现状 | 应有 |
|---|---|---|---|
| 上游（唯一真相） | `skills-local/canvas-studio-creation/SKILL.md:157` | 11 类 | 11 |
| UI 映射 | `src/client/question-capture.tsx:22` `STYLE_DEMO_MAP` | **8 对** | 11 |
| 卡片预览位 | `src/skill-catalog.ts` `demo:` | **8 条** | 11（或显式降级） |
| GIF 资产 | `assets/style-demos/` | **8 个** | 11（或显式降级） |

新增 3 类（东方神话视觉导演 / 街采跟拍 / 惊吓遭遇战）**在澄清选项与技能卡里均无 GIF 预览**，静默回退静态渐变。

> **关联**：高度疑似 **CV-071「详情弹窗没有展示 gif 图」的根因之一**。此前只按"弹窗层缺 `<img>` 渲染"定性，未发现资产与映射本身缺失。验收 CV-071 前先确认点的是不是这 3 个新风格。
>
> 另：`plan.md:278` 仍写着 `STYLE_DEMO_MAP` "与 creation-spec 风格预设表一一对应，单点维护"——**该单点已失效**（且 `creation-spec.ts` 文件本身已不存在）。

**编号**：CV-116（2026-09-09 已落地，待桌面验收）

> **实现时发现的更严重问题**：`question-capture.tsx:168` 在 GIF 网格里对未命中 MAP 的选项直接 `return null` —— 缺 GIF 只是不好看，**未命中是选项被整个吞掉，用户根本选不到该风格**。所以修复核心不是补 GIF，而是：命中不到 GIF 时渲染降级占位卡，绝不丢卡片。

**修法（已按此实现）**：
- （A）**已做**：从 T8 仓库 `catalog/community-skills/<name>/preview.gif` 取回街采 / 惊吓两个（与现有 8 个同源同字节），catalog 补 `demo` 字段，MAP 补到 11 对
- （B）**已做**：oriental-mythic 在 T8 无素材 → 渲染「预览制作中」降级占位卡（新增 `csStyleDemoFallback`，16/9 同尺寸防布局跳动）
- 附带收益：GIF 存在性改由 catalog `demo` 字段单点判定（此前 UI 直接拼 `<skill>.gif`），消除第四处硬编码

#### A2 🟡 catalog 一致性测试只兜单向 — ✅ CV-117 已落地·待验收

`tests/skill-catalog.test.mjs:46` 只断言「`skills/` 每个 skill 都能取到条目」。**无反向断言** → 删除/改名 skill 后，catalog 残留幽灵条目**不会红**。

`src/skill-catalog.ts` 文件头已自认这是"诚实边界"（展示层 vs 真实注册两份东西），且因上游严禁改编 SKILL.md 而无法走 frontmatter —— 手写表在当前约束下是可行解，不必推翻，补上反向即可。

**编号**：CV-117（2026-09-09 已落地，待桌面验收）· **成本**：约 5 行
**负向验证已做**：往 catalog 注入假条目 → 测试变红；还原 → 8/8 绿（断言确实有效，非空转）

#### A3 🟡 `hidden` 布尔混杂两种语义 — ✅ CV-118 已落地·待验收

`hidden?: boolean` 一个字段承载了两种不同意图：
- **技术类不该曝光**（总纲 / h3 / z-image / qwen）：永久隐藏，属分类维度
- **未就绪试跑**（oriental-mythic）：临时状态，属生命周期维度

缺显式生命周期状态（`draft` / `preview` / `ga` / `deprecated`）。

**编号**：CV-118（2026-09-09 已落地，待桌面验收）· **成本**：小
**实现**：新增 `stage?: 'ga' | 'preview'` —— 都不写 = 普通广场技能；只 `hidden` 无 stage = 技术类永久隐藏（分类维度）；`hidden` + `preview` = 试跑期（生命周期，就绪后删两字段即上线）。oriental-mythic 已标 preview。测试断言三组合合法性

> 注：此前判断"两个新风格 skill 是 hidden"有误 —— 实测 `direct-street-interview-video` / `stage-startle-to-truce-encounter` **无 hidden 标记，广场可见**。

---

### B 组：吸收自 `skill-system-analysis.md`（已逐条核实）

#### B1 🔴→✅ 校验器未接入工具执行链 —— **已落地（CV-119，2026-09-09）**

`validateH3Ir` 此前在 `src/` 下**仅出现在自身定义**，`video_generate` / `video_composite` 的 execute 里没有预检，IR 写错直接 POST 后端。

**落地方式**：`looksLikeH3Ir`（命中 ≥2 个 IR 标记才认定，纯文本透传不误拦）+ `assertH3IrPrompt`（ERROR 抛错取消生成、WARN 不阻断，报错带规则名 + h3-prompt-writing 指引），接入两工具 execute 前置；模式映射 无图=T2VA / 单图=I2VA / 2 图=FL2VA / ≥3 图=Ref2VA；时长用 clampDuration 有效值。测试 8 用例 + 实跑会话 4 段真实 IR 回归，smoke 352/352。详见 STATUS.md CV-119。

#### B2 🟠 风格 skill 与总纲职责重叠（≈80/20）

每个风格 skill 都重写完整工作流（简报→大纲→角色/场景卡→分镜→视频→成片），与总纲重复约 80%，真正风格化的仅 20%。改动主流程需同步改 **9 个文件**。

**与 B3 (CV-120) 的衔接约束**（B3 落在 h3-prompt-writing 自身文件上，与 B2 无文件交集、无返工风险，但有 3 条前置）：
1. 去重改写风格 skill 时**保留「叠用 h3-prompt-writing」指令**（街采/惊变已有此写法），保证 风格 skill → 总纲 → h3 → 速查表 的机制钩子链不断；
2. 拆总纲时机制→风格对应关系**只以 creative-mechanisms.md 速查表为唯一权威**，新抽出的 references 只引用不复制——否则复刻 A1 四处映射漂移；
3. 拆出的 references 若涉及机制/风格映射章节，一律指向速查表路径（该文件在 B2 中不移动，路径稳定）。

#### B3 ✅ creative-mechanisms 30 机制沉睡（CV-120，2026-09-09 落地·待验收）

`h3-prompt-writing/references/creative-mechanisms.md` 收录 30 个 T8 官方机制，现状仅街采、惊变 2 个 skill 有「机制衔接」节引用，其余 9 个风格 skill 0 引用；h3 SKILL.md 渐进披露清单列了但无触发指引。

**选定方案（单点索引，不逐 skill 加节）**：① creative-mechanisms.md 末尾加「风格技能 × 机制速查表」（co-op-game→ensemble-dyad；music-video→continuous-emotion-escalation；oriental-mythic→extraordinary-visitor；papercraft/paper-collage→bounded-day-loop 等）；② h3 SKILL.md 五步 Workflow 第 1 步加钩子「激活风格技能时先查速查表」。放弃「9 个 skill 逐个加机制衔接节」——机制匹配稀疏会凑数，且 B2 去重重写时要逐个迁移这 9 处，单点索引正好为 B2 减负。

**落地记录（2026-09-09）**：两处源文件改完（速查表 11 个风格技能全覆盖，含街采/惊变「已自带衔接节」标注；钩子嵌 Workflow 第 1 步判定模式之前）→ sync-minimax-skills 同步，源/产物 diff 一致，test:smoke 352/352 ✓。速查表表头已声明「唯一权威 + 未列入=无强匹配不硬套」，与下方 B2 约束第 2 条呼应。

#### B4 🟡 H3 模式（5）与工具能力（3）不对齐

```
H3 IR 模式:      T2VA   I2VA   L2VA   FL2VA   Ref2VA
VideoCapability: T2V           FL2V（I/L/FL 合并）  Ref2V
```
- I2VA / L2VA / FL2VA 全部落到 first-last-frame，首帧/尾帧语义不分
- L2VA 无独立工具入口
- drama 后端 T2VA 与 FL2VA 走同一端点

#### B5 🟡 占位工具的"诚实" vs 用户预期

`music_generation` / `tts_voiceover` / `subtitle_burn` 三个占位工具返回可操作降级路径（设计上诚实），但用户对"一站式成片"有落差：MV 字幕不烧进画面、BGM 需自备。
**属实**，但是产品预期问题而非缺陷 —— 建议归入 O 系列 backlog，不在 skill 系统内解决。

---

### C 组：对 `skill-system-analysis.md` 的核对与修正

| 原文档表述 | 实测 | 处置 |
|---|---|---|
| §二.2「渐进披露做得扎实」（可维护性 ★★★★★） | **16 个 skill 中 9 个 references = 0（56%）**，含总纲、brand-promo、minimalist-product、handdrawn-live、papercraft、paper-collage、music-video-subtitle、z-image、qwen | **下调**。该结论基于 3 个 skill 的选择性取样（h3 / 3d-animation / 总纲），且被取样的总纲恰恰是 0。渐进披露是**少数派实践**，不是已建立的规范 |
| 同表已记录总纲「references 数量 0，无子文件」 | 属实（49KB 纯单体） | 原文档只当现象记录，未升级为问题 → 本文件 A/B2 组收编 |
| 「h3-prompt-writing 8 个 references」 | 实际 9 个文件（7 `.md` + 2 `.txt`） | 微调，不影响结论 |
| 「9 个 H3 风格 skill」 | catalog style 分类 8 条（含 hidden 的 oriental-mythic，广场可见 7） | 微调 |
| §三 矛盾 5「校验器未接入」 | **已实测确认属实**（grep 仅自身定义） | 采纳为 B1，提为 🔴 |
| §四 评分表 | 架构与结论可靠，可继续作为设计参考 | 保留引用，不复制 |

---

## 3. 行动清单（按「无后端依赖优先」排序）

| 序 | 行动项 | 建议编号 | 依赖 | 成本 | 验收方式 |
|---|---|---|---|---|---|
| 1 | ~~**A1** 风格映射漂移~~ | **CV-116** | — | — | ✅ 已落地·待验收：澄清卡片里 11 类风格全部可见，缺 GIF 的显示「预览制作中」 |
| 2 | ~~**A2** catalog 反向断言~~ | **CV-117** | — | — | ✅ 已落地·待验收：负向验证已做（注入假条目 → 变红） |
| 3 | ~~**B1** 校验器接入 `video_generate` / `video_composite` 预检~~ | **CV-119** | — | — | ✅ 已落地·待验收：故意传错格式 IR，工具当场抛错而非打到后端；纯文本 prompt 不受影响 |
| 4 | ~~**A3** hidden 拆生命周期语义~~ | **CV-118** | — | — | ✅ 已落地·待验收：oriental-mythic 标 preview，三组合断言生效 |
| 5 | **B3** creative-mechanisms 按风格打通 | CV-120 | 无 | 中 | 每个风格 skill 引用具体机制条目 |
| 6 | **B2 + 总纲拆分**：总纲抽 references + 风格 skill 去重 | CV-121 | 5 之后做 | **高** | 主流程只改总纲一处；总纲 SKILL.md 降到 <10KB |
| 7 | **B4** L2VA 独立入口 | CV-122 | 需后端确认 | 中 | fal/drama 是否支持尾帧锚定 |
| 8 | **B5** 占位工具预期管理 | 归入 O 系列 | 产品决策 | — | 不在本文件跟踪 |

> 编号规则：`CV-112` / `CV-113` 已被「详情弹窗 GIF」「我的 Skill 视图」拟立项占用。**CV-116 / CV-117 / CV-118 / CV-119 已于 2026-09-09 正式登记到 STATUS.md**（对应 A1 / A2 / A3 / B1 落地）；下一个可用号为 **CV-120**（B3 顺延占位不变）。

---

## 4. 打磨时的护栏（防止再漂移）

1. **风格预设改一处，四处要同步**：总纲预设表 → `STYLE_DEMO_MAP` → catalog `demo:` → `assets/style-demos/`。建议加一条测试断言「总纲预设数 == MAP 条目数」，从根上杜绝 A1 重演。
2. **catalog 双向断言**（A2）：新增防漏补、删除防幽灵。
3. **文档只增不漂移**：新文档必须在 §0 表格登记职责；被取代的旧文档（如 `plan.md`）加归档头指向 `STATUS.md`。
4. **渐进披露是规范不是选项**：新增 skill 若 SKILL.md > 10KB，应拆 `references/`，与 h3-prompt-writing 对齐。

---

## 5. 待办

- [x] ~~确认 A1 走 A 案（补 GIF）还是 B 案（显式降级）~~ → 两个都做了：T8 有素材的补齐，没有的（oriental-mythic）走降级
- [ ] **A 组桌面验收**：重启后走一次澄清，确认 11 类风格全部可见、街采/惊吓出 GIF、东方神话显示「预览制作中」
- [ ] 确认 B2 风格 skill 去重的决心（收益大但重写 8 个文件，且触及零改编边界——风格 skill 多为社区技能，改写需评估）
- [ ] `plan.md` 加归档头（已过时：引用已不存在的 `src/skills/creation-spec.ts`）
- [ ] 新 GIF 体积偏大（4.9MB / 4.0MB，现有最大 2.2MB）：hover 懒加载首次会卡，视验收体验决定是否压缩
