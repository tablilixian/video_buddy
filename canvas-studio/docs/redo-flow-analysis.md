# Canvas Studio「不满意 → 重做」流程分析（2026-09-01）

> 目标：把「用户对产出的剧本/分镜、图片（角色图/关键帧/分镜图）、视频不满意，想要重新制作」的完整流程捋清楚——现状有什么、缺什么、建议怎么补。
> 方法：逐文件代码走查（本文所有 file:line 均已核实）。

> 📌 **R1~R4 的当前状态见 [STATUS.md §6](./STATUS.md#6-历史-id-映射)**：R1 已完成，R2→CV-054、R3→CV-055、R4 与决策点 D3 合并设计。
> 本文的**分析结论（三条重做路径、触发条件、流程链路）仍然权威**，整改方案见
> [redo-redesign-plan.md](./redo-redesign-plan.md)。

---

## 一、结论先行

1. **重做的"骨架"已经齐全**：分镜级打回（reject + 自动唤醒）、关键帧确认闸（keyframe_review）、节点级重试/改提示词（retryOf 原地更新）三条路都已实现并落地。
2. **但"重做体验"有三个真实断层**，按对用户的痛感排序：
   - **G2 节点重做 = 原地覆盖，旧版本直接消失**——重做后又觉得原来好，无路可回；
   - **G3 重做后下游不联动**——换了关键帧，引用它的视频不会标记"已过时"，全靠用户自己记住哪些要重生成；
   - **G1 打回分镜没有反馈载体**——点「打回」只发一句固定文案"请按我的修改意见重新提交分镜"，用户具体不满意什么没有结构化入口。
3. **文档状态滞后**：`canvas-studio-optimization-backlog.md` 仍把 O1（批准自动继续）、O4（关键帧确认闸）标为待开发，实际均已落地（见 §2.4），建议同步更新。

---

## 二、现有能力盘点（已实现）

### 2.1 分镜/剧本级重做（P7 工作流门禁）

| 能力 | 实现 | 位置 |
| --- | --- | --- |
| 状态机 | `drafting → awaiting_approval → keyframe_review → executing` | `src/contracts/project.ts:11` |
| 打回分镜 | approve/reject 路由，reject 把 state 翻回 `drafting` | `src/routes.ts:630-632` |
| 打回后自动唤醒 | reject 后自动向会话发「请按我的修改意见重新提交分镜」 | `src/client/index.ts:347-350` |
| 硬闸门 | confirm 模式下 `storyboard_generate / video_generate / video_composite / storyboard_split` 未放行直接报错（不触达 Drama） | `src/host-tools.ts:190-198, 212` |
| skill 软约束 | 教 agent「未批准别重试、报错不要连续试」 | `src/skills/creation-spec.ts:31,34,176` |

### 2.2 关键帧确认闸（O4 方案 A，已落地）

- agent 出完关键帧 → 置 `keyframe_review`（`src/host-tools.ts:793`）→ 后续 `video_generate` 等被硬拦（`src/host-tools.ts:192-194`）；
- 用户可在画布上对关键帧**二次编辑（右键重试/改提示词）后再确认**——确认前视频生成一直报错等待（`src/client/index.ts:351-355` → `src/routes.ts:627-629`）。

### 2.3 节点级重做（S7）

| 能力 | 实现 | 位置 |
| --- | --- | --- |
| 原地重试 | `retryOf` 参数：保留 id/位置/血缘/编组，重放 `generationPrompt`，不加新边 | `src/generate.ts:900-922` |
| 修改提示词重做 | `steerNode` → `retryStudioNode(node, overrides)`，覆盖 prompt 后重放 | `src/client/index.ts:531`、`src/client/api.ts` |
| 入口 | 右键菜单 + 属性面板；**仅 agent 生成节点**（需 `origin==='agent' && toolName && generationPrompt`） | `src/client/canvas/CanvasContextMenu.tsx:29-30,60-61` |
| 手动重试不经门禁 | 用户手动重试走 `/generate` 路由，不受工作流闸门限制（设计如此） | `src/host-tools.ts:187-189` 注释 |

### 2.4 顺带核实：backlog 中两项已落地

- **O1 批准后自动继续**：`approveStoryboard` → `wakeAgent('继续')`（`src/client/index.ts:343-346`），已实现；
- **O4 关键帧确认点**：`keyframe_review` 状态 + `confirm_keyframes` 动作 + 审批条按钮，已实现（方案 A）。
- 仍未落地的：O2（选项高亮+横幅）、O3（待复现）、以及 HITL 分析里的缺口 C——**设置页「默认执行模式」仍是死开关**（`src/projects.ts` 的 `create()` 不写 `workflow`，`src/index.ts:83` 的 `cfg.workflowMode()` 无人消费）。

---

## 三、「不满意 → 重做」现状走查（按产出类型）

### 3.1 剧本/分镜不满意

```
用户点「打回」→ state: awaiting_approval → drafting
            → 自动发「请按我的修改意见重新提交分镜」→ agent 重做分镜 → 重新提交审批
```

**断层 G1**：固定文案里没有用户的真实意见。用户要么先在对话框手打意见再点打回（顺序反了、容易忘），要么 agent 收到泛泛一句话只能盲改。
**建议**：打回按钮旁加一个可选意见输入框（placeholder：「哪里不满意，例如：第 3 镜节奏太快 / 男主不像」）；有内容则 `wakeAgent('打回意见：' + text)`，无内容保持现行为。改动集中在 `StudioFrame.tsx` 审批条 + `client/index.ts` 的 `rejectStoryboard(projectId, feedback?)`，低风险。

### 3.2 图片（角色图/关键帧/分镜图）不满意

```
右键「重试」（原参数重放）或「修改提示词」（steer 后重放）
→ retryOf 原地更新节点 → 旧图从画布消失（文件还在 assets 目录但无入口）
```

**断层 G2（原地覆盖，无版本历史）**：`generate.ts:909-922` 直接用新产物覆盖节点的 `url/filename/generationPrompt`。undo 快照救不回来——重试成功后客户端从 Host 整体重载画布（单一真相源），store 历史里的旧快照被整体替换。用户"重做之后又觉得原来好"只能让 agent 重新生成一遍（碰运气）。
**建议（版本化，P1）**：节点契约加 `revisions?: Array<{ url, filename, generationPrompt?, createdAt, note? }>`（`src/contracts/canvas.ts` + v3→v4 迁移，`projects.ts normalizeCanvasDocument`）；重试时把旧 `url/filename/prompt` push 进 `revisions` 再覆盖；属性面板/预览浮层加「历史版本」条，可**一键恢复某版**（把该版本的 url/filename 写回主字段，当前版入 revisions——只动节点数据，不重新生成）。重试是原地语义所以改动面可控：只动 `generate.ts` retryOf 分支 + 面板 UI。

**断层 G3（下游 stale 不标记、不联动）**：血缘 `sourceIds` 已完整落盘（`generate.ts:889-898`），但关键帧重做后：
- 引用它的 video 节点内容已过时，画布上**看不出任何差异**；
- 用户必须自己记住"换了男主定妆图 → S1/S3/S5 的视频都要重生成"，再逐个右键或让 agent 重跑。

**建议（P1，和 G2 同批做）**：
1. **stale 标记**：retryOf 落盘后，Host 顺手做一次下游闭包计算（沿 `sourceIds` 反向索引 BFS），给下游节点打 `staleAt: number` 时间戳；`CanvasNode.tsx` 加"已过时"角标（当前已有 loading/error 角标位，复用同一样式槽）。
2. **一键级联重做**：属性面板/右键加「重做下游」——Host 端按拓扑序依次对 stale 的 agent 节点重放 `generationPrompt`（视频节点在 confirm 模式且闸门未开时应提示先确认，或仅对 manual 重试路由放行——沿用现有"手动不经门禁"约定即可，但要给进度提示，因为视频是串行长任务）。
3. **分镜级重做的联动**：reject 重做分镜后，`storyboard_split` 产出的单镜图、及其下游关键帧/视频同理进入 stale。分镜卡节点已有 `shotNodeIds` 反查能力（`generate.ts:894`），闭包计算直接可用。

### 3.3 视频不满意

- **agent 路**：executing 态下用户在对话里说"第 3 镜视频不满意，改成……"→ agent 重调 `video_generate` → **追加新节点**（不带 retryOf）。
- **手动路**：右键重试/改提示词 → **原地覆盖**。

**断层 G5（两条路行为不一致）**：agent 重做产生新节点堆积，手动重做覆盖旧版本；用户对"重做到底留下几份"没有稳定预期。且 agent 追加的新视频节点与旧节点无"替代关系"标记，时间轴里可能同时出现新旧两版，导出成片时容易选错。
**建议**：不必强统一——保留"手动=原地（配合 G2 版本化）、agent=新增"的分工是合理的（agent 版本本就该留档对比）；要补的是**替代标记**：agent 对已有节点的重做若用户意图是"替换"，skill 里教 agent 传 `sourceIds` 带上原节点 + 操作文案注明"重做"；时间轴合成取片段时若同一分镜下有多个候选视频，UI 给出提示（`CanvasTimeline` 已按分镜分组展示，可加"同镜多版本"角标）。

### 3.4 文案（write_script 产物）

文案是 text 节点，"重做"= 让 agent 改写或用户直接编辑。当前 text 节点可否双击编辑需实测确认；若不能，补一个内联编辑即可（低优先级）。

---

## 四、建议的完整重做流程（目标态）

```
不满意发生点              动作                                  系统行为
─────────────────────────────────────────────────────────────────────────
分镜表不满意          →  审批条「打回」+ 意见输入框(G1)      → reject + 定向唤醒 agent 重做
分镜图/单镜不满意     →  右键重试/改提示词                    → 原地重做 + 旧版入 revisions(G2) + 下游标 stale(G3)
角色图/场景图不满意   →  同上                                → 同上
关键帧不满意          →  keyframe_review 态内二次编辑再确认   → 已支持；补 G2/G3 后体验完整
单镜视频不满意        →  手动原地重做 或 对话里说让 agent 做  → 手动=原地+版本；agent=新节点+替代标记(G5)
下游批量过时          →  属性面板「重做下游」一键级联(G3)     → 拓扑序重放，进度可见
重做后反悔            →  版本历史一键恢复(G2)                → 只切节点数据，不重新生成
```

## 五、实施排期建议

| 批次 | 内容 | 改动面 | 风险 |
| --- | --- | --- | --- |
| **R1（✅ 已完成 2026-09-01）** | G1 打回意见输入框 + 顺手把 settings 死开关落地（缺口 C：`create()` 写入 `workflow.mode`） | `StudioFrame.tsx` / `client/index.ts` / `client/contracts.ts` / `styles.ts` / `projects.ts` / `index.ts` / `tests/projects-dir.test.mjs` | 低 |
| **R2（核心）** | G2 节点版本化（契约 v4 + retryOf 入 revisions，cap 5 + 版本恢复 UI） | `contracts/canvas.ts` / `projects.ts` / `generate.ts` / `LayerDetailPanel.tsx` 或预览浮层 | 中（有契约迁移，需按 S1 惯例做 v3→v4） |
| **R3（核心）** | G3 stale 标记 + 「重做下游」级联 | `generate.ts`（落盘后闭包计算）/ `CanvasNode.tsx` 角标 / 面板按钮 | 中（级联重放要处理串行与失败中断） |
| **R4（增强）** | G5 agent 重做替代标记 + 时间轴同镜多版本提示 + skill 补"重做"章节 | `creation-spec.ts` / `CanvasTimeline.tsx` | 低 |

每批次独立提交（feat(canvas-studio): Rn ...），沿用 `git add canvas-studio docs` + 推 `origin/dev` 纪律；R2/R3 各配单测（retryOf 入 revisions / stale 闭包计算，纯函数可直测，参照 `tests/generate.test.mjs` 的 mock registry 模式）。

## 六、待拍板问题（2026-09-01 已拍板：从 R1 开始；G2 版本上限 cap 5）

1. **G2 版本化上限**：✅ cap 5（超出丢最旧；磁盘产物本就不删，只是画布引用截断）。
2. **G3 级联重做范围**：只重做 video，还是 video + 其后再合成节点都重做（建议到 video 为止，video-composite 让用户手动再点合成，避免一次烧太多生成费）？
3. **G1 打回意见**：✅ 可选输入框（已实现）。
4. **手动级联重做与门禁**：confirm 模式下「重做下游」放行视频生成是否绕过闸门（建议绕过——沿用"手动不经门禁"既有约定，但弹确认列出将重新生成的节点数与预计耗时）？
