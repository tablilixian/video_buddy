# MiniMax-H3 上游 skill 接入 — 桌面验收步骤

> 试点：`3d-animation-short-generator`（原版 SKILL.cn.md 逐字接入，零改编）
> 前置：已完成 `corepack yarn build`（lib 含 minimax 相关模块）

## 验收前自检（沙箱内已完成）

- [x] HOST_OK + CLIENT_OK（tsc --noEmit 全绿）
- [x] `corepack yarn build` 成功；`lib/skills/minimax-skills.js` / `generated/minimax-skills.js` / `placeholder-tools.js` 均产出
- [x] `test:smoke` 92/92 通过（含零改编验证：content 与 submodule SKILL.cn.md 正文逐字一致）

## 桌面验收步骤

1. **安装**：`dsh plugin --profile <name> add ./canvas-studio`（或重装含本轮构建的包），重启桌面（兼容模式）。
2. **新建项目**：左栏新建 Canvas Studio 项目，进入画布工作台。
3. **触发 3D 动画流程**：对话输入「用 3D 动画风格做一段完整短片」；逐步确认模式下 agent 应先用 `ask_user_choice` 逐项澄清（时长/画幅/风格/节奏/受众，风格一项应给出 3D 动画预设）。
4. **确认 skill 加载**：风格选中 3D 动画后，agent 应通过 skill 工具加载 `3d-animation-short-generator`（对话/工作流中可见原版 STEP 流程描述，如「STEP 0：接收需求与画布规划」「六列标准镜头信息表」）。
5. **观察 STEP 0–5.5**：项目简报 → 故事大纲 → 角色卡（带标注）→ 无人物场景卡 → 六列标准镜头信息表 → 镜头表自检门。产物应逐项落画布节点；每步后走 `ask_user_choice` 选项卡确认。
6. **观察 STEP 6–7**：单文本分镜文档（或可选铅笔分镜）→ 视频模型选项卡（原版给 H3/Seedance 选择，canvas 侧应降级说明固定走 Drama Backend）→ 逐镜视频生成（video_generate / video_composite）。
7. **观察 STEP 8 BGM 步骤**：agent 调 `music_generation` 占位工具 → 应返回中文降级指引（引导用户上传 BGM + compose_video 的 bgmNodeId），**不报错、不卡流程**。
8. **观察 STEP 8–9 收尾**：compose_video 拼接成片 → 最终复盘。

## 预期行为清单

| 环节 | 预期 |
|---|---|
| skill 加载 | 模型经 skill 工具读到 3d-animation-short-generator 原版正文 |
| 内容原版 | 流程描述与 MiniMax 原版一致（简报/大纲/角色卡/场景卡/六列表/自检/分镜/逐镜/拼接+BGM） |
| 选项卡 | 关键节点走 ask_user_choice（映射原版选项卡门） |
| 分镜门禁 | submit_storyboard_for_approval 生效（逐步确认模式） |
| BGM 步骤 | music_generation 占位工具返回降级指引，流程继续 |
| 画面/时长 | 与 canvas 约束一致（16:9/9:16、单段 ≤15s） |

## 判定标准

- **通过**：STEP 0–9 全流程走通；BGM 环节降级可操作；产物按序落画布。
- **部分通过**：流程走通但个别环节（如分镜模式选择、铅笔图）agent 自行简化——记录现象，评估是否需要在总纲加工具映射提示（不改原版内容）。
- **不通过**：agent 反复选错工具、卡在某一步——把失败环节与模型回复贴回，由 Host 侧适配层（占位工具/总纲路由）补丁。

## 实测结论记录

（验收后回填：哪些环节原样跑通 / 哪些降级 / 模型工具路由是否稳定 → 决定是否铺开 8 个风格 skill）
