# 技能系统升级与修复方案（skill-system-upgrade）

> 立项：2026-09-04 · 来源：对 canvas-studio 技能系统的系统性评审
> 关联：[skill-expansion-spec](../skill-expansion-spec.md) · [STATUS 总表](../STATUS.md) · [api.md §MiniMax-H3 上游 skill 注册与调用](../api.md)

## 评审修订记录（2026-09-04 · 代码复核）

本文档初稿基于代码走查，已逐条复核源码并修正事实。修订要点（详见各条目「复核修正」小节）：

| 条目 | 修订结论 |
| --- | --- |
| **SK-04** | **事实基础错误、严重性低估**：点名的 minimalist 实测仅 428 字符未被截断；真正在被截断的是**另外 7 个**。且非「未来风险」而是**既成故障**。优先级 **P1 → P0** |
| **SK-05** | 核心论据**被代码证伪**：三个占位工具的 description 首句已标注「占位工具」，模型可区分。方案 **b（改名）建议取消** |
| **SK-02** | token 估算**高估约 2 倍**（把 UTF-8 字节数当 token 基数）。主论据应从「省 token」改为「消除规则冲突」 |
| **SK-08** | **新增**：路由可观测日志（与 SK-04 同处代码，成本近零） |

复核方法：用 `minimax-skills.ts` 的真实 `parseFrontmatter`（含 `|`/`>` 块折叠）复算全部 13 个 skill 的 description 长度；体积按「中文字符 1 token + ASCII 0.3 token」估算。

---

## 0. 背景与现状结论

技能系统由五层机制组成：注册（目录成员即注册）、内容来源（pinned minimax-h3 submodule 逐字节同步 + skills-local 覆盖）、渐进披露（SKILL.md 入口 + references/ 按需读）、路由（canvas-studio-creation 总纲 description 软约束）、边界适配（占位工具承接 BGM/TTS/字幕缺口）。

**评审结论**：骨架设计合理且克制，工程纪律好；真正短板在「路由可靠性」与「一致性治理」。本方案把修复项编号为 **SK-x**（Skill System），按 P0→P3 排批次。

| 批次 | 条目 | 主题 |
| --- | --- | --- |
| B1（必修） | SK-01, SK-02, **SK-04**, **SK-08** | 路由强制化 · 总纲瘦身去重 · description 截断守卫（**已确认在故障中**）· 路由可观测 |
| B2（重要） | SK-03, SK-05 | skills/ 移出 git · 占位工具边界显式化（**仅 a+c，b 已否决**） |
| B3（可选） | SK-06, SK-07 | frontmatter 解析器加固 · effect-test-runner 自动化补强 |

批次变更说明：SK-04 经复核确认为**当前正在发生的静默故障**（7/13 skill 的 description 被截掉 94–414 字符），且修复仅为一个常量 + 一行 warn，故 B1 内优先级提到 P0；SK-08 与其共用同一处代码，顺带并入 B1。

---

## 1. SK-01【P0】把「总纲先行加载」从 markdown 祈使句下沉为机制

> **✅ 已落地（CV-098，2026-09-04，commit 见 STATUS.md §8）**：采用方案 A。实现为独立模块 `src/skills/routing-prompt.ts`（`SKILL_ROUTING_SECTION_NAME='canvas-studio:skill-routing'` / `ORDER=150` / `registerSkillRoutingPrompt(ctx)`），`src/index.ts` inject 增加 `'systemPrompt'`。与初稿方案的差异见下方「实施记录」。

### 问题
`canvas-studio-creation/SKILL.md` 的 description 写着「最高优先级，第一个动作必须调用 skill(name=canvas-studio-creation)」——这是**软约束**。小模型（qwen3.8-27b-mtp）对长 description 里的指令服从率不稳定；effect-test-runner 已经在记录「规范获取方式：skill 工具加载 / 直接 read / 未获取」，说明团队已观测到路由失效，但当前解法是**观测而非强制**。

### 方案
Host 侧在 canvas-studio 项目会话中注入一条不可绕过的路由指令（二选一，推荐 A）：

- **A. system prompt 追加**：`src/skills/minimax-skills.ts` 注册时向 `ctx` 的 system-prompt 服务贡献一段固定文案（约 3–5 行），内容为「本工作区所有创作任务的第一个动作是 skill(name=canvas-studio-creation)；未加载前不得调用 ask_user_choice / image_generate / video_*」。
  - 依赖确认：检查 `@deepseek-ai/dsh-system-prompt` 是否已在 canvas-studio 的 inject 列表（当前 index.ts inject = webServer/tools/skills/settings，需补声明）。
- **B. 首条消息注入**：客户端在绑定项目的会话发出第一条 prompt 前，经 conversation.send 前置一条系统提示——实现更重、且可被用户刷新打断，不推荐。

### 实施记录（与初稿方案的差异）
- 指令放**独立模块**而非 `minimax-skills.ts`——后者职责是上游 skill 注册，路由指令是独立的 system prompt 贡献，分开便于单测与复用。
- 服务键坐实：`dsh-system-prompt/lib/index.js` 构造函数 `super(ctx, "systemPrompt")`；上游 tool-fs / tool-web / tool-terminal 均以同款 inject 先例，服务在宿主上下文必然在位。
- 文案为**条件触发式**（见验收标准 3 改写），约 330 中文字符 ≈ 400 token——超出初稿「<150 token」预算，但它是静态前缀、命中 DeepSeek context caching 后边际成本极低，且换取的是每轮可见的硬指令。
- 文本禁用 `{{variable}}`（`renderPrompt` 对未知变量严格抛错）。

### 验收标准
1. effect-test-runner T6/T8 跑 3 轮，「canvas-studio-creation 未获取」计数为 0；
2. `tests/skill-routing-prompt.test.mjs`（新增 6 用例）：硬指令三要素在位 / 条件式三断言 / 无 `{{` 引用 / **总纲 skill 名存在哨兵**（总纲改名测试先红）/ 注册行为（unique name、order 落在 100–199、text 原样透传、不得声明 complete、disposer 透传）/ lib 产物防漏 build；
3. ~~非 canvas-studio 项目会话不受影响（注入条件 = 会话 cwd 命中项目目录）~~ **改写**：canvas-studio 经 bundle patch 顶层插入（cordis.patch.yml）属**全局插件**，其 system prompt 小节会注入所有会话，按 cwd 条件注入不可达。改为**条件触发式措辞**：指令开头声明「仅当请求涉及生成图片/视频、分镜、AI 短片/漫剧时适用 + 其它请求请完全忽略 + 不改变你的身份」，非创作会话自动跳过。桌面验收增补：开一个非创作会话（如「帮我写个周报」）确认模型不受干扰。

### 风险与回退
- system prompt 注入若被上游 loader 忽略 → 降级为 B 方案 + SK-07 观测兜底；
- ~~文案必须短（<150 token）~~ → 实际 ~400 token，作为静态前缀享缓存价；若实测发现非创作会话被干扰，再收紧条件措辞或改写为按 scope 注册。

---

## 2. SK-02【P0】总纲瘦身：入口 ≤8KB，冲突规则单一权威

### 问题
`canvas-studio-creation/SKILL.md` 正文一次性全量注入，与本仓库自己的 spec §3「SKILL.md 保持精简入口、细节放 references/」自相矛盾。且总纲与 8 个风格 skill **双写规则**：提问顺序、时长选项、画幅约束两边都规定，模型行为取决于恰好加载了哪个。

**冲突已实证（非概率性风险）**：`minimalist-product-ad-generator` 的 Start Gate 明写 **「The start gate must confirm all of the following in one pass」**（一次性问完，含 Target duration），与总纲第 1 条「一次只调一次 ask_user_choice，只问一个要素」**直接对立**——这不是措辞分歧，是流程范式冲突。

> 该冲突很可能就是 CV-094 复盘会话中「把时长与画幅合并成一问」的真正诱因：模型并非自由发挥，而是被风格 skill 的一次性提问指令带跑。这一点把本条目从「优化」升格为「纠错」。

**补充事实**：`minimalist-product-ad-generator` 正文 31.5KB，**比总纲 29.7KB 更大**，且属上游不可改编。因此「瘦身总纲」并不能消除最大上下文占用者，真正压住它的只能是「单一权威声明」——这进一步抬高了 SK-01 + SK-02 组合的必要性。

### 复核修正（token 估算，初稿高估约 2 倍）
初稿称正文「30KB（约 1.5–2 万 token）」，不成立：

| 口径 | 数值 | 说明 |
| --- | --- | --- |
| `wc -c`（UTF-8 字节） | 29.7 KB | 中文 3 字节/字，**不能**当 token 基数 |
| 字符数 | 15,487（中文 7,359 + ASCII 8,128） | 真实内容量 |
| 粗估 token | **≈ 9.8K** | 中文 1 token/字 + ASCII 0.3 |

参照：`minimalist` 32,052 字符 ≈ 9.7K token（几乎纯 ASCII）、`papercraft` 22,845 字符 ≈ 6.9K token。

**结论**：瘦身的 token 收益应从「省 1 万+」下修为「省约 5–6K」。**本条目主论据相应改为「消除规则冲突 + 恢复渐进披露」，不再以省 token 为主要理由**——冲突治理价值不受此修正影响。（另注：skill 正文位于会话前缀，若服务端 prefix caching 生效，省 token 的边际收益还会进一步趋近于零，见 STATUS.md 缓存相关条目。）

### 方案
1. **拆分**（skills-local/canvas-studio-creation/SKILL.md → 入口 + references/）：
   - 留在入口（目标 ≤8KB）：执行模式与审批门禁、核心规则（filename/@ref/sourceUrls/shotRefs/无视觉禁令）、工具链总表；
   - 移入 `references/clarify-protocol.md`：需求澄清五要素完整模板、两级追问选项文案、风格分类对照表；
   - 移入 `references/workflow-steps.md`：单镜简化流程、逐镜生成细则、成片合成步骤。
2. **单一权威声明**（写入口文首）：「凡与风格 skill 正文冲突的提问顺序/参数规则，以本规范为准。」并在 SK-01 注入文案中引用该句。
3. **不改上游 skill 一个字节**（零改编原则不变），协调全部走总纲 + Host 注入。

### 验收标准
1. **体积**（口径统一为字符数，非字节）：`wc -m skills/canvas-studio-creation/SKILL.md` ≤ 8,000 字符（≈ ≤5.5K token）；`references/` ≥2 个文件，且入口正文含其相对路径引用（模型能据此 `read`）；
2. **防拆漏**：guardrail 的「无视觉禁令」等关键词断言改为**遍历入口 + references/** 任一命中即过；
3. **冲突压制（本条目核心验收）**：入口文首含单一权威声明「凡与风格 skill 正文冲突的提问顺序/参数规则，以本规范为准」，`tests/skill-guardrail.test.mjs` 新增断言该句存在于 `skills/` 与 `skills-local/` 两份副本；
4. **路由不丢**：effect-test-runner T6 单镜端到端回归通过；
5. **行为验证（决定性）**：新会话输入「做一个极简产品广告」→ 加载总纲与 `minimalist-product-ad-generator` 后，提问须严格逐项单问（①形态 → ②时长 → ③画幅 → ④风格两级），**不得**出现「一次性合并提问」。若仍出现合并提问，说明单一权威声明未压住上游 one-pass 指令，须回头加强 SK-01 注入文案。

---

## 3. SK-04【P0】description 截断守卫：正在发生的静默路由故障

> **状态：✅ 已落地（2026-09-04 · CV-097）**
> 实测截断 **7/13 → 0/13**。实现见 `src/skills/minimax-skills.ts`：`DESCRIPTION_LIMIT = 1024` 具名常量、纯函数 `truncateDescription()`、`collectSkillStats()` 与注册汇总日志。本条目与 SK-08 第 1 项合并为一次改动。

### 问题
`minimax-skills.ts:86` 对 description 硬截 `slice(0, 500)`，无日志、无告警、不可观测。

### 复核修正（初稿点名对象错误 + 性质判断错误）

初稿称「minimalist 描述已接近该长度……上游一升级就静默被砍」。实测两点均不成立：

| 初稿论断 | 实测结果 |
| --- | --- |
| minimalist 描述接近 500 上限 | **仅 428 字符，未被截断**（属最安全的一档） |
| 截断是「上游升级后的未来风险」 | **当前既成故障：13 个 skill 中 7 个正在被截断** |
| 截断代码在 `minimax-skills.ts:95` | 实际在 **第 86 行** |

用真实 `parseFrontmatter`（含 `|`/`>` 块折叠）复算的完整实测数据：

| skill | 原始长度 | 被砍掉 | 占比 |
| --- | --- | --- | --- |
| papercraft-stop-motion-explainer | 914 | **−414** | 45% |
| brand-promo-video-generator | 800 | −300 | 38% |
| paper-collage-explainer-generator | 773 | −273 | 35% |
| co-op-game-intro-generator | 733 | −233 | 32% |
| music-video-subtitle-generator | 703 | −203 | 29% |
| handdrawn-live-video-generator | 685 | −185 | 27% |
| 3d-animation-short-generator | 594 | −94 | 16% |
| minimalist-product-ad-generator | 428 | 0 | — |
| h3-prompt-writing | 317 | 0 | — |
| canvas-studio-creation | 243 | 0 | — |
| qwen-image-edit-writing | 202 | 0 | — |
| z-image-prompt-writing | 174 | 0 | — |
| effect-test-runner | 120 | 0 | — |

**为什么这是 P0 而非 P1**：description 是模型在 catalog 中选择 skill 的**唯一依据**，而被砍掉的恰恰是排在最末的负向路由语（如 "Not for KOC talking-head ads…" 这类能力边界限定）。当前 7/13 的 skill 正带着残缺的路由说明运行，模型误加载概率上升，且**全链路零日志**。修复成本仅为一个常量 + 一行 warn。

### 方案
1. 截断前检查：原文超限时 `console.warn('[canvas-studio] skill <name> description truncated: dropped N chars')`；
2. 上限升至 **1024**（按实测 max 914 + 100 buffer 取齐）。**注：初稿提的 800 不足——papercraft 914 仍会被砍**；
3. 上限定义为具名常量 `DESCRIPTION_LIMIT` 并注释取值依据（实测 max + buffer），避免后人随手改回；
4. 把截断逻辑抽为纯函数 `truncateDescription(raw, limit)` 导出供单测。

### 验收标准
1. `tests/minimax-skill.test.mjs` 追加用例：
   - ① 超长 description → warn 被调用且产物 ≤ limit；
   - ② 未超长 → **不**产生 warn（防告警泛滥）；
   - ③ `truncateDescription` 边界：恰好等于 limit 时不截断、不告警。
2. **长度快照哨兵**：新增断言固化「当前 13 个 skill 的 description 长度分布」（7 个 >500 且 ≤1024、6 个 ≤500）。上游 submodule 同步后若长度越界，该断言先红，把「静默截断」变成「显式失败」。
3. build 日志中**无** truncation warn（升限后当前 13 个 skill 均应不触发）。
4. 手工验证：桌面重启后，技能面板中 `papercraft-stop-motion-explainer` 的 description 完整可见（能读到结尾的负向限定语）。

---

## 4. SK-03【P1】skills/ 移出 git：构建期生成，消除双副本心智负担

### 问题
`skills/`（sync 产物）与 `skills-local/`（手写源）并存且 **skills/ 进了 git**（测试直接读它）。改 skill 必须记得跑 sync 才生效；「改了没效果」类故障的根因就是这里。guardrail 测试的双副本一致性断言是补丁而非根治。

### 方案
1. `.gitignore` 增加 `canvas-studio/skills/`（保留 `skills-local/`）；
2. `sync-minimax-skills.mjs` 已是幂等（先 rm 再拷），保持「build 第一步」不变——**build 时必然重新同步**，运行时读到的永远是最新产物；
3. 测试调整：所有直读 `skills/<name>/SKILL.md` 的测试改为「若 skills/ 不存在则先 spawn sync 脚本」（或统一在 test setup 里跑一次 sync）；guardrail 双副本断言保留（仍然有效，且此时只可能因忘 build 而红——语义更清晰）;
4. `package.json files` 已含 `skills/**`，发布物不受影响。

### 验收标准
1. `git status` 干净时删除 skills/ → `yarn workspace canvas-studio check` 全绿（证明产物可重建）；
2. e2e / effect-test-runner 流程不回归。

---

## 5. SK-05【P2】占位工具边界显式化：让「降级」可识别

### 问题
降级路径质量 = 文案质量（如 subtitle_burn 建议「由视频模型渲染画面文字」，是把能力缺口转嫁成画质风险且未提示风险）；三个工具的返回值缺少统一的降级标记，用户侧与日志侧不易识别。

### 复核修正（核心论据被证伪，方案 b 建议否决）

初稿称「三个占位工具**命名与真 API 无异，模型无法区分**」。实测不成立——`src/skills/placeholder-tools.ts`（**注：初稿路径误写为 `src/placeholder-tools.ts`，漏了 `skills/` 层级**）中，三个工具的 description **首句均已显式标注占位身份**：

- `music_generation`（:36）→ 「占位工具（canvas-studio 当前无音乐生成能力）：……注意：上游 skill 中出现的 `music-2.6` 即本占位工具（music_generation），不是独立工具。」
- `tts_voiceover`（:60）→ 「占位工具（canvas-studio 当前无语音合成/TTS 能力）：……」
- `subtitle_burn`（:83）→ 「占位工具（canvas-studio 当前无硬字幕烧录能力）：……」

工具 description 是模型决策调用的首要依据，故**模型能够区分**，该论断不成立。据此修正子方案取舍：

| 子方案 | 复核结论 |
| --- | --- |
| a. 返回值统一前缀 | ✅ **保留**。当前返回值（:53/:76/:99）确无统一标记，仅以「canvas-studio 无 X 能力」开头，统一格式仍有意义 |
| b. 改名 `unavailable_*` | ❌ **建议取消**。其全部价值建立在「模型无法区分」这一已被证伪的前提上；代价却实在：上游 skill 逐字引用 `music_generation` / `music-2.6`，改名会破坏零改编链路，还须在总纲维护别名映射并跑通 minimalist 全链路回归。**收益≈0、风险显著** |
| c. 降级质量护栏 | ✅ **保留且属实**：`subtitle_burn` 替代路径第 2 条（:99）确实建议「由视频模型生成画面文字」，且**没有任何画质风险提示** |

关于初稿担心的「未来真接 BGM/TTS 后端时同名升级会静默改变所有 skill 行为」：因 description 已标注占位身份，届时改动必然同步修改 description，不属于静默变更；且那本就是一次显式升级动作，风险可控，无需靠改名预防。

### 方案（a + c）
- **a. 返回值统一前缀标记**：三个占位工具返回文本首行固定为 `⚠️ [降级] canvas-studio 当前无 X 能力——`，并在总纲「占位工具」段落同步该标记词；
- **c. 降级质量护栏**：`subtitle_burn` 替代路径第 2 条追加「注意：视频模型生成的画面文字可能不稳定，交付前请人工检查关键帧」。

### 验收标准
1. 三个占位工具返回值首行均含 `⚠️ [降级]`；`tests/skill-guardrail.test.mjs` 断言该标记在 lib 产物中出现 **3 次**（每个工具恰好 1 次，防漏改其一）；
2. `subtitle_burn` 返回值含画质风险提示（断言关键词「人工检查关键帧」存在）；
3. **回归断言**：三个工具的 description 仍以「占位工具」开头（防止后续重构误删占位声明，这也是 b 方案被否决后留下的唯一边界标识）；
4. 人工验证：触发一次 `music_generation`，对话/画布中可见 `⚠️ [降级]` 前缀。

---

## 6. SK-06【P3】frontmatter 解析器加固 + 元数据信息源收敛

### 问题
`parseFrontmatter` 只认顶层 `key: value` 与 `|/>` 折行；上游已有嵌套结构（minimalist 的 `metadata:` → `trigger-words:`），当前没事只因只读 name/description。另：同一 skill 的描述实际有**三份信息源**——frontmatter description / SKILL.cn.md / src/skill-catalog.ts，漂移靠人肉 + catalog 测试兜底。

### 方案
1. **短期（本批次）**：parseFrontmatter 注释中显式声明「仅支持顶层标量字段；嵌套结构不解析、未来需要时引入 yaml 依赖」；name/description 读取处加类型守卫（已部分存在，补 description 缺失时的回退日志）;
2. **中期**：SKILL.cn.md 与 catalog.ts 的 summary 建立「以 frontmatter description 前 60 字为准」的生成规则（catalog 测试断言 prefix match），消除三源漂移。

### 验收标准
- skill-catalog.test.mjs 新增断言：每个 entry.summary 与 SKILL.md description 前缀一致（允许人工覆盖白名单）。

---

## 7. SK-07【P3】effect-test-runner 自动化补强

### 问题
T6/T8 等用例要求「用户预先按 `效果验证-R<轮次>-<用例号>` 命名建项目 + 切 auto 模式」，agent 不能创建项目（架构限制）——自动化程度名不副实。

### 方案
1. Host 侧新增路由 `POST /canvas-studio/projects`（若已有则复用）供测试驱动脚本直接建项目（仅本地 same-origin，与 active-skills 同安全模型）；skill 正文「前置检查」第 1 条改为「可请用户授权后由测试脚本创建」;
2. 把 SK-01 的注入文案命中情况纳入报告「规范获取方式」列——让路由可靠性成为每轮 R00X 的固定观测项。

### 验收标准
- T6 在无人工建项目的前提下跑通（除后端不可达外）；
- 若新增路由：确认仅本地 same-origin 可达，并与 active-skills 走同一安全模型（代码复核，非人工）。

---

## 8. SK-08【P1】路由可观测：让「用了哪个 skill」可见

> **状态：🟡 部分落地（2026-09-04 · CV-097）**
> 第 1 项（启动汇总日志）已随 SK-04 一并实现，实测输出 `[canvas-studio] skills registered: 13 total, 0 description truncated`。
> **第 2 项（加载时 info 日志）未实施**，原因见文末「实施情况」。

### 问题
当前有三个基本问题无法回答：这一轮模型**加载了哪个 skill**？该 skill 的 description **是否被截断**（即选择依据是否残缺）？**有没有**加载总纲？

- 会话轨迹中 skill 加载混在普通 tool call 里，不显眼；
- 客户端未订阅 skill-invocation 事件做专门渲染；
- 截断与否全链路无日志（见 SK-04）。

后果是路由故障只能靠人工翻 session jsonl 事后复盘——CV-094 正是这样才发现的，无法在运行时观测，也无法量化「路由正确率」。

### 方案
1. **启动汇总日志**：`registerMinimaxSkills` 注册完成后输出一行汇总——已注册数量、各 skill 的 description 长度、**被截断清单及丢弃字符数**（与 SK-04 的 warn 共用同一处代码，成本近零）；
2. **加载时 info 日志**：skill 被 `skill(name)` 加载时打 `console.info('[canvas-studio] skill loaded: <name> (desc <n> chars)')`，便于事后从日志还原路由路径；
3. **（可选·客户端）** 订阅 skill-invocation 事件，在对话流渲染「📄 已加载技能：<中文标题>」条目。**前置**：需先确认 client/renderer 侧可订阅该事件；若不可行则只做 1+2（Host 日志已足以支撑排查）。

### 验收标准
1. 桌面启动日志含一行 skill 注册汇总：13 个 skill 的名称 + description 长度 + 截断标记；
2. 一次完整创作会话结束后，日志中可按时间顺序还原出「先加载 canvas-studio-creation → 再加载风格 skill」的路径；
3. **量化基线**：连续 3 轮 T6 用例，从日志统计「总纲作为首个 skill 被加载」的比例——该数字即 SK-01 的验收基线（修复前应先测一次作为对照）；
4. 若实施第 3 项：对话流中可见「已加载技能」条目；否则在本文档注明「仅 Host 日志、未做 UI 渲染」及原因。

### 实施情况（2026-09-04 · CV-097）

| 子项 | 状态 | 说明 |
| --- | --- | --- |
| 1. 启动汇总日志 | ✅ **已实现** | `registerMinimaxSkills` 末尾输出 `[canvas-studio] skills registered: <N> total, <M> description truncated`，有截断时附 `name -dropped` 明细 |
| 2. 加载时 info 日志 | ❌ **未实施** | 经查 `@deepseek-ai/dsh-skill/lib/types/index.d.ts`，`Context.Events` 只暴露 `skills/change`（注册变更失效通知），**没有任何 skill 加载事件**；`SkillRegistry.load` 是服务内部方法，要埋点须包装上游服务对象，风险与复杂度超出本轮范围 |
| 3. 客户端 UI 条目 | ❌ 未实施 | 依赖第 2 项的事件源；且需先确认 client/renderer 可否订阅 |

**第 2 项的后续选项（若要做）**：
- **方案一**：Cordis 层包装 `ctx.skills.load`（monkey patch）加日志后委托原方法 —— 侵入上游服务，harness 升级可能失效；
- **方案二**：改从会话轨迹侧观测（确认 harness 是否已有 skill-invocation 类事件可订阅）—— 比 patch 上游干净，**建议优先调研这条**；
- **方案三**：接受现状 —— 启动汇总已能回答「哪些 skill 的路由语残缺」，而「本轮加载了哪个 skill」仍可从 session jsonl 的 tool call 还原，只是不够实时。

**对 SK-01 的影响（重要）**：原计划用 SK-08 的「总纲首加载比例」作为 SK-01 的量化验收基线。第 2 项未落地 ⇒ **该基线无法自动统计**，SK-01 验收需退回人工方式（跑 3 轮、从 session jsonl 或对话面板人工确认首个加载的 skill）。若希望自动化，建议先做方案二。

---

## 9. 实施顺序与工作量估算

| 序 | 条目 | 改动面 | 估时 |
| --- | --- | --- | --- |
| 1 | ✅ **SK-04 + SK-08**（合并）截断守卫 + 路由可观测 — **已完成（CV-097）** | `src/skills/minimax-skills.ts` + `tests/minimax-skill.test.mjs` | ~~0.5d~~ 已完成（SK-08 第 2 项遗留，见 §8 实施情况） |
| 2 | ✅ **SK-01** system prompt 注入 — **已完成（CV-098）** | `src/skills/routing-prompt.ts`（新增）+ `src/index.ts`（inject 补 `systemPrompt`）+ `tests/skill-routing-prompt.test.mjs`（新增 6 用例） | ~~0.5d~~ 已完成（API 调研实际 0.25d：`section({name,order,text})` 契约清晰） |
| 3 | SK-02 总纲拆分 | `skills-local/canvas-studio-creation/` + sync 脚本（references 拷贝已支持）+ guardrail 断言调整 | 1d |
| 4 | SK-05a+c 占位标记 | `src/skills/placeholder-tools.ts` + 测试 | **0.25d**（b 已否决，工作量减半） |
| 5 | SK-03 skills/ 出 git | `.gitignore` + 测试 setup + CI 验证 | 0.5d |
| 6 | SK-06 / SK-07 | 视 B1–B2 验收结果排期 | 各 0.5–1d |

**依赖关系**：
- ⚠️ ~~**SK-08 必须先于 SK-01**~~ **该依赖已失效**：SK-08 第 2 项（加载时日志）未落地，无法自动产出「总纲首加载比例」基线，**SK-01 须改用人工验收**（跑 3 轮、从 session jsonl 人工确认首个加载的 skill）。若后续补做 §8 的方案二，本依赖重新生效；
- SK-04 与 SK-08 共用 `minimax-skills.ts` 同一处代码 —— **已合并为一次改动完成（CV-097）**；
- SK-02 的「单一权威声明」引用 SK-01 注入文案 → **SK-01 已完成（CV-098）**，SK-02 可开工；
- 其余相互独立，可并行。

**排期理由**：SK-04 经复核确认为**既成故障**而非未来风险，修复成本仅一个常量 + 一行 warn，应排最前；它与 SK-08 同处一个文件，合并 0.5d 即可同时交付「修好 7 个 skill 的路由语截断」与「获得 SK-01 的验收基线」两项收益，是本方案性价比最高的一步。

---

## 10. 完成定义（DoD）

**前置（本轮已完成）**：文档内全部事实论断已逐条代码复核，修正见「评审修订记录」。

- [x] `yarn workspace canvas-studio check` + `test:smoke`（含新增用例）全绿 —— **204/204**（CV-097 +3、CV-098 +6，较初稿基线 195）；
- [x] **SK-04**：13 个 skill 的 description 无一被截断 —— 实测 **7/13 → 0/13**，启动日志无 truncation warn；长度快照断言就位（含「上限对最长者保留 ≥100 余量」）；
- [ ] **SK-08**：启动汇总日志 ✅ 已就绪；❌ **「总纲首加载比例」基线未产出**（第 2 项未实施，见 §8 实施情况）；
- [ ] **SK-01**：effect-test-runner 跑 3 轮，「canvas-studio-creation 未获取」计数为 0；非创作会话不受影响（**验收标准 3 已改写为条件触发式措辞验证**——canvas-studio 是全局插件，见 §1 验收标准 3）；代码侧 6 用例已绿（CV-098），桌面人工验收待做；
- [ ] **SK-02**：入口 ≤8,000 字符、`references/` ≥2 文件、单一权威声明就位；人工抽检确认无「一次性合并提问」；
- [ ] **SK-05**：三个占位工具返回值首行含 `⚠️ [降级]`，且 description 的占位声明未被误删；
- [ ] **SK-03**：删除 `skills/` 后 `check` 仍全绿（产物可重建）；
- [ ] STATUS.md 追加 SK-01~SK-08 条目并随验收状态流转；
- [ ] skill-expansion-spec.md §1 增补：「路由强制机制见 docs/plans/skill-system-upgrade.md SK-01，新增总纲级规则时不得再依赖 description 祈使句」。

---

## 附录 A：复核方法与可复现命令

本文所有实测数字均可用以下命令复核（在 `canvas-studio/` 下执行）：

```bash
# 1. 各 skill 体积（字节 / 字符两种口径，勿混用）
wc -c skills/*/SKILL.md | sort -rn          # UTF-8 字节
wc -m skills/*/SKILL.md | sort -rn          # 字符数（token 估算基数）

# 2. description 真实长度（必须复用 minimax-skills.ts 的 parseFrontmatter，
#    因为它支持 |/> 块折叠，用简单正则会量错——本方案初稿即栽在此处）
node -e '
const fs=require("fs");
function parseFrontmatter(md){
  const m=/^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(md); if(!m) return {};
  const lines=m[1].split(/\r?\n/); const meta={}; let i=0;
  while(i<lines.length){
    const kv=/^([a-zA-Z0-9_-]+):\s*(.*)$/.exec(lines[i]||"");
    if(!kv){i++;continue}
    let v=(kv[2]||"").trim(); i++;
    if(v==="|"||v===">"){const p=[];while(i<lines.length&&/^\s+\S/.test(lines[i]||"")){p.push(lines[i].trim());i++}v=p.join(" ")}
    meta[kv[1]]=v;
  }
  return meta;
}
for(const d of fs.readdirSync("skills").sort()){
  const p="skills/"+d+"/SKILL.md"; if(!fs.existsSync(p))continue;
  const meta=parseFrontmatter(fs.readFileSync(p,"utf8"));
  const raw=String(meta.description||meta.name||d);
  console.log(String(raw.length).padStart(5), raw.length>500?"截断":"  ok", d);
}'

# 3. token 粗估（中文 1 token/字 + ASCII 0.3）
node -e '
const md=require("fs").readFileSync("skills/canvas-studio-creation/SKILL.md","utf8");
let cjk=0,ascii=0;
for(const ch of md) /[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/.test(ch)?cjk++:ascii++;
console.log("字符",md.length,"| 中文",cjk,"ASCII",ascii,"| 粗估token",Math.round(cjk+ascii*0.3));'

# 4. 占位工具边界声明（验证 SK-05 复核结论）
sed -n '36p;60p;83p' src/skills/placeholder-tools.ts | cut -c1-80
```

## 附录 B：复核中发现但本方案未纳入的事项

| 事项 | 说明 | 建议 |
| --- | --- | --- |
| `trigger-words` 路由语料被浪费 | `minimalist-product-ad-generator` 的 `metadata.trigger-words` 含 8 个中英文触发词（含「极简产品广告」「产品广告片」），是上游专为路由准备的语料；当前解析器跳过、catalog 也不用。用户说中文时，模型只能靠英文 name + 被截断的 description 匹配 | 可在 SK-06 顺带解析并注入 catalog。**但仅 1/13 skill 有该字段**，收益有限，列为可选 |
| 服务端 prefix caching 未生效 | 会话缓存命中长期为 0（模型端点侧问题，非桌面端）。若修复，SK-02 省 token 的收益将进一步趋近于零 | 已记录于 STATUS.md，不属本方案范围；但它从侧面支持「SK-02 主论据应为冲突治理而非省 token」 |
