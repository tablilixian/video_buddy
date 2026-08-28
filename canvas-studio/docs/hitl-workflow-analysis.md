# Canvas Studio 流程编排工作流控制分析（HITL：逐步确认 / 放手跑 + 确认继续 / 打回重做）

> 分析日期：2026-08-28
> 方法：逐文件代码审计 + 端到端闸门测试（`tests/workflow-gate.test.mjs`，9/9 通过）

## 一、结论先行

1. **控制体系真实存在且后端自洽**——是「硬控制」不是「提示词忽悠」。闸门的事实源、拦截点、翻转动作三者闭环，测试证明 confirm/auto 双模式、awaiting→executing 放行、reject 重关、放手跑覆盖、点选回流全部按设计工作。
2. **控制权归属清晰**：人（客户端按钮）是唯一能把闸门从 `awaiting_approval` 翻到 `executing` 的角色；Host 硬闸门系统强制；agent 提示词只是软约束。
3. **但有 3 个真实缺口**，按严重度：
   - **A（概念对齐）**：「逐步确认」只硬闸**一次**（分镜阶段），批准后下游整条管线**自主跑完**，没有逐镜/逐步二次确认。
   - **B（体验脆弱）**：批准后 agent **不会自动苏醒**，必须用户在对话里手打「继续」；打回同理。
   - **C（死开关）**：设置页「默认执行模式（confirm/auto）」**从不被闸门消费**，纯装饰。

---

## 二、控制权到底在谁手里（代码链路）

```
真相源：StudioProject.workflow = { mode, state, pendingQuestion }
        └─ 持久化在 $DSH_HOME/canvas-studio/projects.json（Host 进程内单例 registry）
             定义：src/contracts/project.ts  StudioWorkflow / normalizeWorkflow
             读写：src/projects.ts  ProjectRegistry.getProject / updateWorkflow / answerPendingQuestion

硬闸门：src/host-tools.ts  runGeneration()  L174-179
        GATED_TOOLS = {storyboard_generate, video_generate, video_composite, storyboard_split}
        if (GATED_TOOLS.has(tool) && mode==='confirm' && state!=='executing') throw ...  ← 连 Drama 都不碰

状态翻转（谁能动 state）：
  人类批准  → StudioFrame 点击「批准并开始制作」
            → client/index.ts approveStoryboard → POST /workflow {action:'approve'}
            → src/routes.ts → registry.updateWorkflow({state:'executing'})
  人类打回  → 同上 reject → {state:'drafting'}
  人类切模式 → setWorkflowMode → POST /workflow {action:'setMode', mode}
            → routes.ts 联动：awaiting_approval+auto→executing；executing+confirm→drafting
  Agent 自己 → submit_storyboard_for_approval 工具：confirm 模式置 awaiting_approval 并结束回合；
            auto 模式直接置 executing（无需等待）

软约束（非强制）：src/skills/creation-spec.ts
        用自然语言教 agent「先澄清→submit→等批准→未批准别重试→image_generate 概念图不受限」。
        agent 不守也不会被系统拦（只有 GATED_TOOLS 的硬闸兜底）。

点选澄清：ask_user_choice 工具写 pendingQuestion，并轮询（每 1.5s，最长 10min）
        直到客户端 answerStudioQuestion 写入 answer 才回传模型（阻塞式，但 agent 必须主动调才会阻塞）。
```

**结论**：`人 = 最终裁决者（唯一能开闸的角色）` + `Host 硬闸（系统强制）` + `agent 提示词（软约束）`。Agent 无法自己把 `awaiting_approval` 翻成 `executing`——这是 HITL 的核心保证。

---

## 三、能否正常工作 —— 测试实证

新增 `tests/workflow-gate.test.mjs`，用与现有测试一致的「假 registry + stubFetch（打桩 Drama）」模式，复刻真实单进程内「route 与 tool 共用同一 registry 实例」的语义。9 个用例全绿（`node --test tests/workflow-gate.test.mjs`）：

| # | 用例 | 验证点 | 结果 |
|---|---|---|---|
| 1 | confirm+drafting，受控 `video_generate` | 被硬拦截，**fetch 调用数=0**（证明闸门在触达 Drama 前生效） | ✅ |
| 2 | confirm+drafting，非受控 `image_generate` | 不被闸门拦（概念图可用），正常落盘节点 | ✅ |
| 3 | confirm 下 `submit_storyboard_for_approval` | state→`awaiting_approval`、落分镜卡、提示回合结束 | ✅ |
| 4 | `awaiting_approval` 下受控工具 | 仍被拦截（≠executing） | ✅ |
| 5 | approve→`executing` 后受控 `storyboard_generate` | **真实放行并落盘节点**（端到端） | ✅ |
| 6 | reject→`drafting` 后受控工具 | 重新被拦截（打回生效） | ✅ |
| 7 | awaiting+切 auto 模式 | state→`executing`，闸门解除 | ✅ |
| 8 | auto 模式 + submit | 直接 `executing`，无需批准 | ✅ |
| 9 | `ask_user_choice` + 回答 | pendingQuestion 写入、answer 记录，供工具轮询回传 | ✅ |

后端状态机自洽：`routes.ts` 的 approve/reject/setMode/answer 全部正确委托 `updateWorkflow`/`answerPendingQuestion`，无悬空分支。

---

## 四、真实缺口与风险（按严重度）

### A【概念对齐，最重要】「逐步确认」不是逐步确认
- 一旦 `approve` 把 state 翻成 `executing`，它**一直保持 executing**。此后 `storyboard_generate` / 每个 `video_generate` / `video_composite` / `compose_video` **全部自由执行，无任何二次人工门禁**。
- 即设计上「逐步确认 = 批准分镜表这一刀，之后放手跑」。若用户的预期是「每生成一步都问我确认」，当前**不实现**。`host-config.ts` 的 `hitlKeyframe` 字段虽然存在，但完全 reserved，没有逐关键帧审批。
- 这是设计取舍不是 bug，但必须与用户预期对齐，否则验收时会觉得「说好的逐步确认呢」。

### B【体验脆弱】批准后 agent 不自动苏醒
- `client/index.ts` 的 `approveStoryboard` 只调 `postStudioWorkflowAction('approve')` 并写回 store，**不代发任何聊天消息**（已审计确认）。
- 因此：点「批准」后，agent 仍在 idle，必须用户在对话里**手打「继续」**才会开启新一轮 agent 调用，闸门此时才放行。打回同理——`reject` 只把 state 翻回 `drafting`，也无消息唤醒 agent 重做。
- UI 虽然写了提示语（`StudioFrame.tsx` L559「批准后在对话中发送『继续』恢复流程」），但**依赖人记住发继续**，断点明显。
- **建议修复**：批准/打回按钮在翻完 state 后，顺带向当前会话投递一条消息（「继续」/「请按反馈重做分镜」），驱动 agent 自动恢复。

### C【死开关】设置页「默认执行模式」不生效
- `host-config.ts` 的 `workflowMode` 与 `index.ts` 的 `cfg.workflowMode()` **从不被 `runGeneration` 消费**——闸门读的是 `getProject(projectId)?.workflow`（`projects.ts`）。
- 而 `projects.create()` **根本不写 `workflow` 字段**，新项目恒为默认 `{mode:'confirm', state:'drafting'}`。
- 真正常效的模式切换在**画布顶部**「逐步确认 / 放手跑」按钮（`setMode`）。设置页那个开关是 `plan.md §1.7` 已诚实标注的 reserved 项——但用户如果在设置页切了「放手跑」却没生效，会困惑。
- **建议修复（二选一）**：① 项目创建时把 `source().workflowMode` 写进 `workflow.mode`，让设置页开关真正生效；② 从设置页 UI 移除该开关，避免误导（只保留画布顶部的模式切换）。

### D【边缘】setMode 中途切回 confirm 会卡住在跑流水线
- `routes.ts`：`executing + setMode('confirm')` → `state` 被置 `drafting`（闸门重开）。若用户在生成跑到一半切回「逐步确认」，已发起的调用不受影响，但**后续 gated 调用会立即抛错**。属边缘场景，提示即可。

---

## 五、最小修复建议（若要补 B / C）

- **B（优先级高，体验关键）**：在 `approveStoryboard` / `rejectStoryboard` 里，翻完 state 后向会话投递一条唤醒消息（approve→「继续」；reject→「请按反馈重做并提交分镜」）。改动集中在 `src/client/index.ts`。
- **C（优先级中，去误导）**：`src/projects.ts` 的 `create()` 增加 `workflow: { mode: source().workflowMode, state: 'drafting' }`（需把 settings source 注入 registry 构造），或 `src/client/SettingsModal.tsx` 的 WorkflowSection 隐藏 `workflowMode` 开关。
- **A（优先级看需求）**：若需真正的逐镜 HITL，需在 `runGeneration` 增加按阶段（如每 N 个镜头 / 每个 video_generate）的 `awaiting_approval` 复位逻辑 + 对应客户端「逐镜批准」UI，工作量较大，建议先与用户确认是否需要。

---

## 六、测试运行方式

```bash
cd canvas-studio
node --test tests/workflow-gate.test.mjs   # 单跑本组
# 或一并跑全部冒烟：
corepack yarn workspace canvas-studio test:smoke
```
