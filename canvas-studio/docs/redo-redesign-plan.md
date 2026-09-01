# 画布重做能力整改方案（redo-redesign-plan）

> 立项：2026-09-01 · 来源：用户反馈「打回重做功能不大会用」
> 关联：[状态总表](./STATUS.md) · [重做流程分析](./redo-flow-analysis.md) · [CV backlog](./canvas-ux-backlog.md)

---

## 一、问题：为什么「打回重做」不好用

画布上现有 **三条**重做路径，它们互不通知、形态各异：

| 路径 | 入口 | 触发条件 | 结果形态 | AI 是否知情 |
| --- | --- | --- | --- | --- |
| **A. 分镜打回** | 顶部审批条「打回」 | 仅 `awaiting_approval` 状态（AI 刚提交分镜表） | AI 重新提交 → **追加**整套新卡 | ✅ 知道（带意见唤醒） |
| **B. 节点重试 / 改提示词** | 节点右键菜单、失败徽章 | `origin==='agent'` 且节点存了 `generationPrompt` | 原地覆盖该节点，id/位置/血缘保留 | ❌ **不知道** |
| **C. 对话里让 AI 重做** | 聊天框说话 | 无限制 | 追加新节点，旧节点保留 | ✅ 知道 |

**四条设计断层**（这是「不大会用」的根因，不是使用者的错）：

1. **想改的对象没有入口。** 觉得第 3 镜分镜写得不对，右键那张分镜卡没有「重做」——只有重命名/删除。要改只能打回**整份**分镜表，或去对话里说。
2. **审批条是一次性的。** 只在 `awaiting_approval` 时出现，挤在工具栏下面一行，无高亮。点完批准/打回，横条消失，想再改只能等 AI 下次提交。
3. **打回会让画布越来越乱（最坑的一条）。** `buildShotCards` 无脑追加整套新卡（`host-tools.ts:763-764` / `:262`），旧卡原地不动。打回两次 → 画布上三套「分镜 1 · 特写」，且下游关键帧的 `shotRefs` 可能连到旧卡上。
4. **重做没有后悔药，也不通知下游。** 重试成功后主机整体重载画布，撤销栈被覆盖（`updateNode` 不进 history）；换了关键帧，引用它的视频不会有任何「已过时」标记。

**另外**：关键帧阶段只有「确认关键帧」一个按钮，**没有打回**——整体不满意只能逐张右键或去对话说。

---

## 二、目标

1. 打回重做**不产生垃圾**：重新提交的分镜复用旧卡，不堆积、血缘不断。
2. 关键帧阶段**能摇头**：有「打回重出关键帧」入口，带意见唤醒 AI。
3. 状态机**不再错乱**：修掉模式切换误翻状态的 bug。
4. 待处理动作**看得见**：审批条在有待办时高亮 + 角标。
5. （B 批次）重做**有后悔药**、下游**看得见过时**。

---

## 三、A 批次：把「打回重做」做通（推荐先做）

### A1 · 分镜重新提交复用旧卡 → `CV-050`（P1，核心项）

**问题**：`buildShotCards` 每次提交都新建一整套节点，旧卡不清理。

**改法**：新分镜表落卡时，按**镜号**匹配已有分镜卡 → 命中则复用 id 与位置、只更新文案与内容；未命中的新镜号按现有规则新建；多出来的旧卡**保留不动**（不静默删除，避免断链）。

**涉及**：
- `src/host-tools.ts:262`（`buildShotCards`）—— 增加「按镜号匹配已有节点」分支
- `src/host-tools.ts:704`（`submit_storyboard_for_approval`）—— 传入当前画布分镜卡清单
- `src/host-tools.ts:763-764` —— 落卡调用点

**验收**：
1. 正常提交 8 镜 → 画布 8 张卡。
2. 打回 → AI 重新提交 8 镜 → **仍是 8 张卡**，卡片 id 不变，位置不变，文案已更新。
3. 重新提交为 10 镜 → 原 8 张更新 + 新增 2 张，共 10 张。
4. 重新提交为 6 镜 → 6 张更新，原第 7、8 张保留不动（不删）。
5. 关键帧的 `shotRefs` 指向的分镜卡，重提交后**仍指向同一节点**（血缘不断）。

**决策 D4：已拍板（2026-09-01）→ 方案 A「按镜号复用覆盖，多出的旧卡保留不动」**。理由：不静默销毁用户可能还引用的节点，避免下游 `shotRefs` 断链。B（整套替换删多余）与 C（存档到历史分组）不采纳。

---

### A2-1 · 修复模式切换误翻状态 → `CV-052`（P0，必修，10 分钟）

**问题定位**：`src/routes.ts:644-648`。

```ts
const current = normalizeWorkflow((await registry.getProject(body.projectId))?.workflow)
if (current.state === 'executing') patch.state = body.mode === 'auto' ? 'executing' : 'drafting'
if (current.state === 'awaiting_approval' && body.mode === 'auto') patch.state = 'executing'
if (current.state === 'keyframe_review') patch.state = body.mode === 'auto' ? 'executing' : 'drafting'
```

三行判据**只看 `current.state` 与传入的 `body.mode`，从不比对 `current.mode`**。语义上它们是为「用户切换模式」设计的（注释：切回逐步确认时执行中的流程回到澄清态），但只要 POST 到达就会执行——**包括用户点的是当前已激活的那个按钮**。「切换」和「重复确认」被当成同一件事。

**完整行为矩阵**（已逐条按代码推演）：

| 当前 mode | 当前 state | 点击 | state 结果 | 判定 |
| --- | --- | --- | --- | --- |
| confirm | `drafting` | 逐步确认 | 不变 | 安全 |
| confirm | `awaiting_approval` | 逐步确认 | 不变 | 安全（三条判据均不匹配） |
| confirm | `awaiting_approval` | 放手跑 | → `executing` | 设计意图，但**不唤醒 agent**（见 CV-056） |
| confirm | `executing` | **逐步确认** | → `drafting` | ❌ **误翻**：AI 正在跑视频被踢回澄清态 |
| confirm | `executing` | 放手跑 | 不变 | 安全 |
| confirm | `keyframe_review` | **逐步确认** | → `drafting` | ❌ **最严重**：确认条消失 + AI 在睡 = 死局 |
| confirm | `keyframe_review` | 放手跑 | → `executing` | 设计意图，同样不唤醒 agent（CV-056） |
| auto | `executing` | 逐步确认 | → `drafting` | 显式切换，属设计意图，可接受 |
| auto | `keyframe_review` | — | 不可达 | auto 模式下 `submit_keyframes_for_approval` 是空操作（`host-tools.ts:788-791`），不会进该态 |

**为什么 `keyframe_review` 那格是死局**（三件事同时成立）：

1. `state` 翻成 `drafting` 后，`StudioFrame.tsx:714` 的条件渲染 `workflow?.state === 'keyframe_review'` 不成立 → **确认条整个消失**，用户手上再没有放行入口。
2. AI 侧的 `submit_keyframes_for_approval` 返回的文本明确写着「本回合到此结束，等待用户点击确认」（`host-tools.ts:796`）→ **AI 已结束回合在静默等待**，不会自己往下走。
3. 唤醒只发生在 `confirmKeyframes()` 里（`client/index.ts:356-360`），而模式切换走的是 `setWorkflowMode()`（`client/index.ts:361-364`），**没有 wakeAgent** → 没人把 AI 叫醒。

结果：状态条显示「需求沟通中」，确认按钮没了，AI 在睡。用户唯一的出路是**手动在对话框打字**把 AI 叫醒，而且 AI 醒来后调 `video_generate` 还会被闸门拦（`host-tools.ts:190`，`state !== 'executing'`），收到「请先与用户确认需求……再用 submit_storyboard_for_approval 提交分镜表」——流程语义彻底错乱。

**为什么一直没被发现**：`tests/` 下对 `setMode` / `updateWorkflow` **零覆盖**（已核实：`grep -rn "setMode\|updateWorkflow" tests/*.mjs` 无匹配）。`workflow-gate.test.mjs` 只测工具侧拦截，不测工作流路由。

**改法**（两处，缺一不可）：

1. `src/routes.ts:641-648` —— 在拼 `patch` 前先短路：
   ```ts
   if (current.mode === body.mode) {
     // 模式未变化：只回写 mode，绝不碰 state（CV-052）
     project = await registry.updateWorkflow(body.projectId, { mode: body.mode })
   } else { ...现有三条判据... }
   ```
2. `src/client/StudioFrame.tsx:678-692` —— 两个模式按钮加 `disabled={workflow?.mode !== 'auto'}` / `disabled={workflow?.mode === 'auto'}`，当前模式不可点。视觉上也要能看出来（现有 `.csActive` 类已存在，补 disabled 态样式）。

第 2 条是防御层。只改第 1 条也能修好，但按钮仍可点、点了毫无反馈，用户会以为没生效而连点；只改第 2 条则路由仍是裸的，任何直接 POST 都能翻状态。

**涉及**：`src/routes.ts:641-648`、`src/client/StudioFrame.tsx:678-692`

**验收**（桌面手动）：
1. 进入 `keyframe_review`，点「逐步确认」（已激活）→ 按钮无响应（disabled），审批条不消失，state 仍是 `keyframe_review`。
2. `executing` 下点当前模式 → 状态条不变，AI 正在跑的生成不受影响。
3. 切到**不同**模式 → 行为与原来完全一致（`keyframe_review` 切放手跑 → `executing`；`executing` 切逐步确认 → `drafting`）。
4. 补一条单元测试：mock project 处于 `confirm` + `keyframe_review`，POST `setMode` + `mode=confirm`，断言返回 `state === 'keyframe_review'`。

**建议补测**：当前 `tests/` 对工作流路由零覆盖，这一条补上后相当于给整个 setMode 分支上了第一道锁。

**同批可修**：`CV-056`（切模式解除等待后不唤醒 agent）与 CV-052 同源、同文件、同样 10 分钟量级，建议一起做——修完 setMode 分支顺手在「等待类状态 → executing」时补一次 wakeAgent 即可。

> ### ✅ 实施记录（2026-09-01，待用户桌面验收）
>
> CV-052 与 CV-056 已同批落地，实际实现与上述方案有两处小偏差：
>
> 1. 状态决策没有留在 `routes.ts` 内联，而是抽成纯函数 **`resolveSetModePatch(current, mode)`** 放进 `contracts/project.ts`（与 `normalizeWorkflow` 同文件）——符合「纯函数可单测必须放 `src/*.ts`」的工程约定，`routes.ts` 只剩一行调用。
> 2. 单测没有 mock HTTP POST，而是直接测纯函数：**`tests/workflow-mode.test.mjs`，7 用例**——死锁格（confirm+keyframe_review 点当前模式 state 不变）、模式未变化全 state 遍历、真切换各格、normalizeWorkflow 降级回归。全量 test:smoke **153/153 通过**。
>
> 落地清单：`contracts/project.ts`（+`resolveSetModePatch`）、`routes.ts`（调用 + 删内联）、`StudioFrame.tsx`（按钮 `disabled` + title 提示）、`styles.ts`（`:disabled` 样式）、`client/index.ts`（`setWorkflowMode` 补 `before.state` 快照，等待类 → `executing` 时 `wakeAgent('继续')`）。
>
> 验证链：build ✓ / test:smoke 153/153 ✓ / typecheck（Host+Client）✓ / verify:loader ✓。

---

### A2-2 · 关键帧打回 → `CV-051`（P1，新功能）

**问题**：`keyframe_review` 状态下 UI 只有「确认关键帧」一个按钮（`StudioFrame.tsx:717-723`），不接受意见。

**改法**：复用分镜审批条那套意见输入框，新增「打回重出关键帧」按钮。
动作语义 = **状态回 `executing`（放行 `image_generate` 重出图）+ 带意见唤醒 AI**。

**为什么低风险**：`image_generate` 本就不在闸门拦截名单里（`host-tools.ts:191-194` 只拦 `video_generate` / `video_composite` / `storyboard_generate` / `storyboard_split`），打回后重出关键帧不碰闸门。视频类工具仍被 `keyframe_review` 拦着，安全。

**涉及**：
- `src/client/StudioFrame.tsx:717-723` —— 审批条加按钮 + 意见框
- `src/routes.ts:627-629` —— 新增 `reject_keyframes` 动作（对照 `confirm_keyframes`）
- `src/client/index.ts:356-360` —— 复用 wakeAgent，打回时发「请按以下意见重新生成关键帧：…」

**验收**：
1. `keyframe_review` 状态下出现「确认关键帧」+「打回重出」两个按钮。
2. 打回并填意见 → 状态回 `executing`，AI 被唤醒且收到意见原文。
3. 打回后 AI 调 `image_generate` 重出图 → 正常放行（不被拦）。
4. 打回后 AI 调 `video_generate` → **仍被拦**（状态不在 `keyframe_review` 但视频闸门逻辑需复核，见风险 ①）。

---

### A3 · 审批条醒目化 → `CV-053`（P2）

**问题**：审批条挤在工具栏下面一行，无高亮、无角标，用户注意不到。

**改法**：有待处理动作（分镜待审批 / 关键帧待确认 / 待答问题）时，审批条加高亮边框 + 主题色角标 + 未读数；无待办时保持现状。

**涉及**：`src/client/StudioFrame.tsx:699`、`src/client/styles.ts`

**验收**：待办状态下审批条一眼可见；无待办时不过度打扰。

---

### A 批次的软约束兜底（顺手做，不改优先级）

关键帧闸门**能不能出现，全看 AI 记不记得调 `submit_keyframes_for_approval`**——这是这条链路最脆弱的一环（skill 里写了「必须调」，但是软约束）。补两条自救路径：

1. `src/skills/creation-spec.ts:32` —— 措辞从描述升级为硬性指令。
2. `video_generate` 被闸门拦时的报错文案，明确写「若你已出完全部关键帧，请先调 `submit_keyframes_for_approval`」。

---

## 四、B 批次：后悔药与联动（A 验完再定）

### B1 · 单版本回退 → `CV-054`（P1）

节点加一个 `previous?: { url, filename, generationPrompt }` 字段：重做前把当前版本压进去，详情面板给「撤销上次重做」。

比 `optimization-plan.md §3.2` 那套双层版本控制（revisions 数组 cap 5）轻得多，契约升级成本低，能解决 80% 的「还是原来那张好」。

**决策 D5：已拍板（2026-09-01）→ 方案 A「单版本回退」**。`previous` 单字段，不做 revisions 数组（契约升级成本高，且节点级撤销栈本就被 `updateNode` 不进 history 的问题覆盖不到多版本的价值）。

### B2 · 下游过时角标 → `CV-055`（P2）

重做落盘后沿 `sourceIds` 反向 BFS，给下游节点打 `staleAt` 时间戳，节点上显示「上游已更新」。**只做标记，不做自动级联重做**——先让用户看得见，手动逐个重做。

---

## 五、不做的事（明确排除）

| 事项 | 为什么不在这批做 |
| --- | --- |
| 级联重做（一键重做下游全部） | 容易误伤，等 B2 的标记用起来后再看真实需求 |
| 完整版本历史（revisions 数组） | 契约升级成本高，先上单版本回退验证价值 |
| 分镜卡逐张打回（右键单卡重做） | 与「分镜表是整体交付物」的模型语义冲突，先做整表打回 + 节点级重做 |
| 完整双层版本控制 / 多模型适配 / 素材库 | 见 [STATUS.md §5](./STATUS.md#5-已设计但零落地的模块)，纯设计零落地，不进当前排期 |

---

## 六、风险

| # | 风险 | 应对 |
| --- | --- | --- |
| ① | A2-2 打回后 `video_generate` 的拦截判定要复核：打回后状态是 `executing` 而非 `keyframe_review`，需确认此时视频工具是「放行」还是「等再次 submit」。若直接放行，等于打回后视频也能跑 | 实施时明确语义：打回 = 回到「关键帧生产阶段」，视频闸门应保留到下次 `submit` 再挂。需在 A2-2 里一并处理 |
| ② | A1 按镜号匹配依赖分镜卡标题格式（「分镜 N · 景别」）稳定 | 匹配失败回退到「整套追加」的现有行为，不破坏现有流程 |
| ③ | 打回后 AI 可能不重出全部关键帧、只改其中几张 | 可接受；B2 的过时标记能帮用户识别哪些没跟着改 |

---

## 七、实施顺序建议

```
A2-1（10 分钟，纯 bug 修复，先做，把状态机修稳）
  ↓
A1（核心，约 30 行 + 验收）
  ↓
A2-2（新功能，复用审批条组件）
  ↓
A3（纯 UI）
  ↓
桌面回归通过后 → B 批次
```

每一步结束都要跑完整验证链，并**回来更新 STATUS.md**，规则见 [DEV-WORKFLOW.md](./DEV-WORKFLOW.md)。
