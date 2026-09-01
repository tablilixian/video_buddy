# Canvas Studio 优化列表（ backlog ）

> 本文件跟踪 Canvas Studio 插件的**待整理优化项**。已完成项单独记「已落地清单」，避免与待办混淆。
> 关联文档：[验收反馈与修复记录](./canvas-studio-acceptance-feedback.md)
> 分支：`dev`；最近提交：`d9107b7a53`（F1-F6 修复 + 视频调度工作流增强）

状态图例：`[待开发]` 方案明确可动手 / `[方案待定]` 需用户拍板方向 / `[待复现]` 需用户提供复现信息 / `[独立排期]` 建议单独成 PR 的大改动 / `[已完成]` 已落地并验证。

---

## 一、本轮讨论的 5 个优化点（2026-08-26）

### O1. 点「批准并开始制作」后仍需手动输入「继续」

- **现状根因**：`StudioFrame.tsx` 的批准按钮只调 `approveStoryboard` 把工作流状态置为 `executing`（`routes.ts` 的 `approve` 动作）；模型在 `submit_storyboard_for_approval` 那一步已**主动结束回合**等待用户，状态变化后无人再唤醒它，因此必须在对话框发「继续」才能恢复。
- **建议方案**：批准按钮在请求成功后，自动代发一条「继续」用户消息（复用聊天框同一套对话发送 API），点击即开跑；按钮提示文案同步改为「已自动继续」。需加一个小桥接暴露上游对话发送能力（`@deepseek-ai/dsh-client-ui-conversation` 的 send）。
- **状态**：`[待开发]`（机制已摸清，改动量小）

### O2. ask_user_choice 选项不明显、无选中效果

- **现状根因**：`question-capture.tsx` 的选项有渲染（按钮 + 选后「已选择：X」），但样式弱——普通 `<button>`，选中后仅禁用 + 一行小灰字，**无高亮态**；问题卡片混在对话流里易被忽略。
- **建议方案**：
  1. 选项改为「可选卡片」：hover/选中态有背景色 + 边框 + ✓，选中项高亮锁定；
  2. 在 StudioFrame 顶部「审批条」旁把当前待答问题**镜像成横幅**，画布区也能看见。
- **涉及文件**：`question-capture.tsx` + `styles.ts`（纯 CSS/JSX，低风险）。
- **状态**：`[待开发]`

### O3. 图片图层右键菜单功能似乎都不可用

- **核查结论**：菜单**已全部接线**，非未开发。`CanvasContextMenu.tsx` 每项均绑定真实回调（`StudioFrame.tsx:526-545`）：重命名/复制/引用到对话/锁定/隐藏/层级/删除/重试/修改提示词/打断/解组。
- **可能造成「看起来不可用」的点**：
  - `重试`/`修改提示词` 仅对 **agent 生成节点**显示（`origin==='agent' && toolName` 且 `hasPrompt`，见 `CanvasContextMenu.tsx:29-30,60-61`）。右击自己上传的图（manual 来源、无 toolName）这两项本就被隐藏，其余项应可用。
  - 若手动上传图连「引用到对话」都没反应，可能是运行时报错。
- **待办**：等用户给**具体节点类型 + 哪个菜单项 + 控制台报错**后再定位；很可能属预期行为而非 bug。
- **状态**：`[待复现]`

### O4. 逐步确认 / 放手跑 区别，以及「关键帧后停下来让用户确认」

- **两种模式现状**（门禁见 `host-tools.ts:143-165`）：
  - **逐步确认（confirm）**：只有**分镜表**一道审批闸；批准后一路自动跑完（出图→出视频→合成），中间不再停。
  - **放手跑（auto）**：无任何闸，端到端跑完。
- **缺口**：两种模式都**不支持「跑到关键帧后自动停」**；唯一自动暂停点在「生成分镜图之前」。当前想中途确认只能手动打断（随时发消息，agent 会响应）。
- **建议方案**：
  - **(A) 加第二道审批闸**（推荐）：在「关键帧/定妆图生成完、视频生成前」插一道 `确认分镜图` 门禁（skill 让模型此时停下 + host 对 `video_generate` 加 gate），用户点批准才继续。
  - (B) 不新增闸，靠 skill 软约束模型出完关键帧后主动发问等确认（模型可能不老实停）。
- **状态**：`[方案待定]`（建议 A，待用户确认）

### O5. 桌面插件 / dsh 版本如何升级

- **两个版本面**（勿混）：
  - `dsh-plugin-desktop` 是自有包（当前 `2.0.1`），不发布；升级 = 改其源码/版本号或依赖集。
   - **DSH 框架版本** = 一堆 `@deepseek-ai/dsh-*` 依赖固定某 rc(见 `dsh-plugin-desktop/package.json` ~90 处 + `canvas-studio/package.json` 几处 + 根 `package.json` 的 `resolutions` 里打 patch 的同版本);`deepseek-harness` 子模块当前钉 `dsh-v0.1.1-rc.2`(见 `git submodule status`)。即「dsh 版本」以各自 `package.json` 为准。
- **升级步骤**：
  1. 框架依赖：`dsh-plugin-desktop` 与 `canvas-studio` 所有 `0.1.0-rc.7` → 目标 rc；根 `package.json` 的 `resolutions` 里被 patch 的包（cordis、dsh-llm-deepseek、dsh-sandbox-windows-acl、dsh-client-ui-directory-picker-browse、dsh-client-ui-workspace）同步改版本；然后 `corepack yarn install`（不能用 `--immutable`）。
  2. patch 风险：`cordis.patch.yml` 与 `patches/*.patch` 钉 rc.7，新版本若 API 变动需 rebase，否则构建/运行会挂。
  3. 子模块：`git submodule update --remote deepseek-harness`（或 checkout 新 commit），**单独提交 pin**，不混桌面行为改动（见 AGENTS.md）。
  4. 重跑 `corepack yarn check` 全套门禁。
- **状态**：`[独立排期]`（跨 ~90 依赖 + 多补丁的宽改动，建议单独 PR、先升一个点试 patch rebase）

---

## 二、已落地清单（不在待办，仅供参考）

- **验收反馈 F1-F6**：成片自动定位、分辨率展示、自动布局分列、引用浮层/插入对话、六段规划法、连线加粗 —— 全绿验证，详见验收反馈文档。
- **视频调度工作流增强（G1-G4 + 根因修复）**：
  - 新增模型工具 `compose_video`（拼接已有片段，禁重新生成）、`write_script`（文案节点）；
  - 节点 `script` 字段 + 详情「文案」展示 + UI 合成关联文案节点；
  - `creation-spec` 技能接入 **8 类 H3 风格预设**（极简产品广告 / 3D 动画 / 纸艺定格讲解 / 品牌宣传 / MV 字幕 / 合作游戏开场 / 纸拼贴讲解 / 手绘实景融合），改写参考图预处理、多关键帧、成片拼接、禁止读图工作流；
  - 继续用自有蒸馏版 H3 提示词引擎（未 vendor 官方参考文档）。
- **提交**：`d9107b7a53` → `origin/dev`。

---

## 三、后续整理待办（占位，持续补充）

- [x] ~~O1 自动继续：实现批准按钮代发「继续」~~（✅ 已落地：`client/index.ts` `wakeAgent`，approve→「继续」、reject→修改意见、confirmKeyframes→「继续」）
- [ ] O2 选项高亮 + 画布区待答横幅
- [ ] O3 收集复现信息并定位右键菜单问题
- [x] ~~O4 关键帧确认点~~（✅ 已落地方案 A：`keyframe_review` 状态 + `confirm_keyframes` 动作 + 审批条按钮，`host-tools.ts:191-198,793`）
- [ ] O5 版本升级单独排期（先 rc.7→目标 rc 试 patch rebase）
- [x] ~~缺口 C：设置页「默认执行模式」死开关~~（✅ R1 落地 2026-09-01：`ProjectRegistry` 构造器接收 live provider，`create()` 写入 `workflow.mode`；新项目按设置初始化，历史项目不受影响。测试 3 用例进 `projects-dir.test.mjs`，全链 146/146 绿）
- [x] ~~R1（重做流程 G1）：驳回意见输入框~~（✅ 2026-09-01：审批条意见框，随驳回消息定向转述 agent（"分镜已驳回，请按以下意见修改后重新提交：…"）；留空保持原行为。分析全文见 `redo-flow-analysis.md`，后续 R2 版本化 / R3 stale 级联 / R4 替代标记待排期）
- [ ] （待补充）字幕烧录 / TTS 旁白 / 自动配乐 等 8 风格承诺但当前工具链不支持的能力，评估是否做二期
