# 项目预置参数 + 剧本阶段 方案

> 状态：**已拍板·待排期**（尚未分配 CV 编号；STATUS.md 当前已编到 CV-098，新条目从 CV-099 起）
> 提出 / 决策：2026-09-06 ｜ 范围：canvas-studio 画布插件
> 关联：需求澄清五要素（总纲 SKILL.md）、CV-023 创意节点、CV-092 新建项目弹窗、P7 工作流门禁

---

## 0. 已拍板的七项决策

| # | 决策项 | 结论 |
| --- | --- | --- |
| 1 | 创建表单收集范围 | **仅画幅 + 目标时长**（砍掉澄清第②时长、第③画幅两问） |
| 2 | 预置值生效方式 | **双写**：生成侧兜底 + system prompt 注入 |
| 3 | 剧本载体 | **新增 `write_screenplay` 工具**，独立「剧本」节点 |
| 4 | 剧本地位 | **新增独立审批门禁**（新 workflow state `script_review`） |
| 5 | 剧本落点 | **后移到「风格确定 + 加载风格 skill 之后」**，对齐上游 outline/spine 步骤 |
| 6 | 第⑤节奏、第⑥受众两问 | **取消**，镜头数由目标时长推导、受众由模型自定并在剧本摘要标注 |
| 7 | 节点命名冲突 | **统一「剧本」**，总纲声明上游「故事大纲/outline」即同一产物，不得另建 |

提问轮次：**6 问 → 3 问**（①形态 + ④a 风格大类 + ④b 具体风格）。

---

## 1. 现状盘点（代码事实）

### 1.1 项目元信息与参数

| 项 | 现状 | 位置 |
| --- | --- | --- |
| 项目记录字段 | `id / name / createdAt / updatedAt / dir / workflow / groupId` | `src/contracts/project.ts:88` |
| 创建入口 | `createProject(name, groupId)` → `POST /projects` → `projects.ts` 的 `create` | `src/client/index.ts:863`、`src/projects.ts` |
| 创建表单 | 弹窗仅「名称」+ 「所属分组」下拉 | `src/client/ProjectList.tsx`（CV-092） |
| 画幅 | 逐次工具参数 `enum['16:9','9:16','1:1']`，缺省回落全局设置 `defaultAspectRatio()`（默认 16:9） | `src/host-tools.ts:434/463/485/577/610/695/720`；`src/generate.ts:897`；`src/host-config.ts:39` |
| 时长 | 逐镜参数：video_generate 默认 5s、video_composite 默认 10s，`clampDuration` 上限 15s | `src/generate.ts:1198/1231/1244` |
| 成片总时长 | **无字段**。只存在于分镜表「时长」列与总纲软提示 | 总纲「成片前自检」 |

### 1.2 创作流程与门禁

| 步骤 | 内容 | 位置 |
| --- | --- | --- |
| 澄清 | 形态 → 时长 → 画幅 → 风格（两级）→ 节奏/镜头数 → 受众，逐项点选 | 总纲 SKILL.md「需求澄清」 |
| 创意 | 第一条真人消息自动落「创意」节点（血缘起点） | `src/client/brief-capture.ts`（CV-023） |
| 分镜 | `submit_storyboard_for_approval` 落逐镜卡 + 审批门禁 | `src/host-tools.ts:751` |
| 关键帧 | `submit_keyframes_for_approval` → `keyframe_review` | `src/host-tools.ts:820+` |
| 文案 | `write_script` 落 `kind='text'`、标题「文案」，内容=广告词/对白/BGM/SFX/字幕 | `src/host-tools.ts:906` |
| 门禁 | `GATED_TOOLS` + `workflow.state ∈ {drafting, awaiting_approval, keyframe_review, executing}` | `src/host-tools.ts:246`、`src/contracts/project.ts:9` |

### 1.3 上游风格 skill 自带「大纲」步骤（剧本顺序的关键依据）

| skill | 大纲类步骤 | 产物要求 |
| --- | --- | --- |
| `3d-animation-short-generator` | **STEP 2 Story Outline and Gates**（STEP 1 简报之后） | 明文要求落画布文本节点 `故事大纲` / `story-outline`，含主角 Want/Need/flaw、8-beat 因果链、情感锚点；末尾带 `Approve story / Revise beats / Revise emotion curve / Return to premise` 选择卡 |
| `minimalist-product-ad-generator` | **STEP 3 Choose a Product Narrative Spine**（STEP 2 简报确认之后） | 叙事主轴决定书；STEP 4 才是 `Motion Language`（节奏） |
| 其余风格 skill | 均为「简报 → 叙事/大纲 → 分镜」顺序 | — |

**三条推论**：
1. 上游本就是「风格/简报 → 大纲 → 节奏 → 分镜」，剧本后移是与上游对齐，不是新发明；
2. 若剧本前置，加载风格 skill 后会被要求再写一份「故事大纲」→ 画布出现两个剧本节点；
3. 上游大纲自带审批选择卡 → `script_review` 门禁可复用其选项词汇，成本被部分抵消。

---

## 2. 需求 1：创建时预置画幅与时长

### 2.1 改动清单

| 层 | 改动 | 位置 |
| --- | --- | --- |
| ① 数据层 | `StudioProject` 增加可选 `plan?: { aspectRatio?: '16:9'\|'9:16'\|'1:1'; targetDuration?: number }`（可选=零迁移；走 `projects.json` 原子写，**不进 canvas.json** 避开 merge-protect） | `src/contracts/project.ts:88`、`src/projects.ts` |
| ② 生成侧 | 兜底优先级：**显式工具参数 > 项目预置 > 全局设置**（保留 agent 覆盖能力） | `src/generate.ts:897`（画幅）、duration clamp 三处（`:1198/:1231/:1244`） |
| ③ agent 侧 | 新增 systemPrompt 小节注入「本项目已锁定：画幅=9:16 / 目标总时长=30s / 单镜上限 10s / 建议镜头数≈3–4」 | 复用 `ctx.systemPrompt.section`（`src/skills/routing-prompt.ts:69`），order 落在工具指引带 100–199 |
| ④ 总纲 | 澄清节加规则：**已由项目预置的要素跳过提问**（第②时长、第③画幅） | `skills/canvas-studio-creation/SKILL.md` |
| ⑤ UI | 创建弹窗加「画幅」三段选择 + 「目标时长」下拉（15/30/60/自定义），均可留空=不锁定 | `src/client/ProjectList.tsx`、`src/client/styles.ts`（复用 `.csField*`） |

### 2.2 衍生收益

1. **镜头数可推导**：`镜头数 ≈ 目标时长 ÷ 单镜 8–10s`（Drama 单段上限 15s，30s 必拆 ≥3 镜）—— 这是取消第⑤节奏问的前提；
2. **成片自检可硬化**：「各片段之和不超过上限」从软提示变成可校验；
3. **剧本体量有依据**：总时长决定剧本节拍数量。

### 2.3 风险与对策

| 风险 | 对策 |
| --- | --- |
| 视频工具不支持 1:1（静默降级 16:9） | 弹窗对 1:1 加提示「视频仅 16:9 / 9:16，方形仅用于图片」 |
| 决策前移后用户随手选、后期想改 | 设置面板加「项目预置」可改；对话 steer 与工具参数优先级更高 |
| 与全局设置 `defaultAspectRatio` 语义重叠 | 明确层级并写进总纲与设置项说明 |

---

## 3. 需求 2：剧本阶段（后移版）

### 3.1 新流程顺序

```
创意节点（CV-023）
  ↓
① 澄清：形态（1 问）+ 风格大类（1 问）+ 具体风格（1 问）   ← 时长/画幅已由项目预置，节奏/受众取消
  ↓
② 加载风格 skill（skill(name=…)），按其 STEP 推进到大纲步骤
  ↓
③ write_screenplay 落「剧本」节点   ← 即上游 STEP 2 故事大纲 / STEP 3 叙事主轴
  ↓
④ submit_screenplay_for_approval → state = script_review（画布确认条）
     批准 → drafting（继续规划分镜；**不能设 executing，否则分镜审批被跳过**）
     驳回 → drafting + 反馈随唤醒消息回传
  ↓
⑤ 分镜规划 → submit_storyboard_for_approval（既有门禁）
  ↓
⑥ 参考预处理 / 定妆锚点 → 逐镜出图 → 关键帧确认 → 视频 → 文案 → 合成
```

### 3.2 剧本内容规范（按风格大类微调）

通用骨架：

```
1. 一句话梗概（logline）
2. 人物：姓名 / 外貌 / 服装 / 性格关键词      → 喂给角色定妆照
3. 场景：地点 / 时间 / 光线 / 关键陈设        → 喂给场景概念图
4. 结构节拍：起承转合或三幕，每节标注时长占比（之和 = 目标总时长）
5. 逐场：场号 / 场景 / 人物 / 动作 / 对白（原语言逐字）
6. 一致性约束：跨镜头必保元素（服装、道具、空间方位）
```

风格差异（写进总纲，避免一刀切）：

| 风格大类 | 剧本额外要求 |
| --- | --- |
| 动画叙事（3D 动画 / 手绘） | 主角 Want/Need/flaw、8-beat 因果链、情感锚点与回报、危机由缺陷加剧 |
| 商业推广（极简产品 / 品牌宣传） | 叙事主轴（发布会式 / 功能触达 / 色彩家族）、英文广告词落点、镜头序列 |
| 讲解科普（纸艺 / 纸拼贴） | 知识点分解顺序、每个知识点的视觉隐喻 |
| MV 字幕 | 歌词分段 + 节拍点标注 |
| 合作游戏开场 | 玩家名 / 游戏标题 / 开场动画节点 |

### 3.3 新工具 `write_screenplay`

- 参数：`screenplay`（markdown 全文）；落 `kind:'text'`、`title:'剧本'`、`toolName:'write_screenplay'`、`origin:'agent'`，`sourceIds=[brief.id]`（血缘挂创意，同 `write_script` 的 CV-025 处理）。
- 位置：`src/host-tools.ts`，紧邻 `write_script`（`:906`）复制其结构，约 40 行。
- **与 `write_script` 分工**：前者=故事/人物/对白/节拍（分镜前）；后者=广告词/BGM/SFX/字幕（成片前，不变）。
- **命名冲突规避**：总纲必须写明「上游 skill 要求的 `故事大纲` / `story-outline` / narrative spine 节点即本工具产物，用 `write_screenplay` 落地一次即可，禁止另建第二个节点」。

### 3.4 独立审批门禁（`script_review`）

**状态机转换表**

| 当前状态 | 触发 | 目标状态 | 说明 |
| --- | --- | --- | --- |
| `drafting` | `submit_screenplay_for_approval`（confirm 模式） | `script_review` | 落确认条，回合结束 |
| 任意 | 同上，auto 模式 | `executing` | 放手跑直接放行（与分镜/关键帧一致） |
| `script_review` | 用户点「批准剧本」 | `drafting` | **不能设 `executing`**——否则 `GATED_TOOLS` 放行、分镜审批被跳过 |
| `script_review` | 用户点「驳回」+ 反馈 | `drafting` | 反馈随唤醒消息回传，模型重写剧本 |
| `script_review` | 切到「放手跑」 | `executing` | 与 `keyframe_review` 同处理 |
| `script_review` | 切到「逐步确认」（已是 confirm） | 只写 mode 不动 state | 沿用 CV-052 短路规则，防自锁 |

**驳回选项复用上游 gate 词汇**：`批准并通过` / `改节拍` / `改情绪曲线` / `重来对白` / `回到前提`。

**改动点（文件级）**

| 文件 | 改动 |
| --- | --- |
| `src/contracts/project.ts` | `StudioWorkflowState` 加 `'script_review'`；`normalizeWorkflow` 白名单纳入；`resolveSetModePatch` 补新状态分支 |
| `src/host-tools.ts` | 新增 `write_screenplay` + `submit_screenplay_for_approval`；`runGeneration` 门禁（`:228-233`）加 `script_review` 分支与专用报错文案 |
| `src/routes.ts` | workflow action 加 `approve_script` / `reject_script`（参考 `:830-838`） |
| `src/client/api.ts` | action 联合类型（`:148`）扩两个值 |
| `src/client/contracts.ts` | 契约加 `approveScreenplay` / `rejectScreenplay`（**漏这里必 TS2339**） |
| `src/client/index.ts` | `applyWorkflowAction`（`:499`）支持新 action；新增两个方法并挂进 inject（`:1069` 附近）；`wasWaiting` 判定（`:547`）纳入 `script_review` 以唤醒 agent |
| `src/client/StudioFrame.tsx` | 状态标签（`:852`）加「剧本待批准」；新增确认条分支，复用 `.csWorkflowApproval` |
| `skills/canvas-studio-creation/SKILL.md` | 新增「剧本阶段」节；澄清节删除第②③⑤⑥问对应内容，声明预置跳过规则与「上游大纲=同一产物」 |
| `tests/` | `workflow-mode.test.mjs` 等补 `script_review` 转换用例 |

### 3.5 风险与对策

| 风险 | 说明 | 对策 |
| --- | --- | --- |
| **交互轮次** | 提问 6→3 省 3 轮，新增剧本审批 +1 轮，净省 2 轮 | auto 模式一律放行；确认条复用既有样式 |
| **误设 `executing`** | 剧本批准后设 executing 会跳过分镜审批 | 严格按转换表回 `drafting`，不新增第二个放行态 |
| **风格 skill 加载失败** | 剧本阶段可能"跟着 skill 一起消失" | 总纲强制：无论 skill 是否加载成功，剧本阶段必须执行 `write_screenplay` |
| **无对应 skill 的风格** | 部分风格没有上游 skill | 同上，总纲提供通用骨架兜底 |
| **驳回到 `drafting` 语义弱** | 模型难区分「剧本被打回」与「初始澄清」 | 反馈随唤醒消息发出；剧本节点标题标「（待修改）」 |

---

## 4. 落地顺序（3 次可独立验收的提交）

1. **P1 数据 + UI**：`plan` 字段 + 创建弹窗 → 验收：项目记录里能看到画幅/时长
2. **P2 生效链路**：生成侧兜底 + systemPrompt 注入 + 总纲改为 3 问 → 验收：不带参数出图即为预置画幅；agent 不再问时长/画幅/节奏/受众
3. **P3 剧本 + 门禁**：`write_screenplay` + `submit_screenplay_for_approval` + `script_review` + 确认条 + 总纲剧本节 → 验收：风格定完后才出现「剧本」节点且只有一个；批准后分镜审批仍生效

---

## 5. 验收方法

| 项 | 步骤 |
| --- | --- |
| 预置生效 | 新建项目选 9:16 / 30s → 只说「做个咖啡广告」→ 出图应为竖构图，全程不问画幅/时长/节奏/受众 |
| 覆盖能力 | agent 显式传 16:9 时应出横构图（工具参数优先级更高） |
| 提问轮次 | 澄清阶段只出现 3 次点选卡片（形态 / 风格大类 / 具体风格） |
| 剧本顺序 | 风格确定后才出现「剧本」节点；加载 3D 动画 skill 时不额外出现「故事大纲」节点 |
| 剧本门禁 | 逐步确认模式下写剧本后停在确认条；批准后能继续出分镜，且**仍会再弹分镜审批** |
| 放手跑 | auto 模式下剧本提交不阻塞，一路跑到成片 |
| 回归 | typecheck（Host+Client）→ build → test:smoke → verify:loader 全绿 |

---

## 6. 待确认细节（开工前补）

- [ ] 目标时长候选项是否定为 15 / 30 / 60 / 自定义（秒）
- [ ] 剧本节点是否需要单独配色（区别于「文案」节点）
- [ ] 两个需求是否合成一个 CV 条目，还是拆 CV-099 / CV-100
