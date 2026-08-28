# MiniMax-H3 上游 skill 接入 — 桌面验收步骤

> 状态：3D 动画试点已验收通过（skill-catalog 正常注入）→ 已铺开全部 9 个 skill（h3-prompt-writing + 8 风格，SKILL.cn.md 中文原版逐字接入，零改编）
> 前置：已完成 `corepack yarn build`（lib 含 minimax 相关模块）

## 验收前自检（沙箱内已完成）

- [x] HOST_OK + CLIENT_OK（tsc --noEmit 全绿）
- [x] `corepack yarn build` 成功；9 个 skill 全部生成（lib/skills/generated/minimax-skills.js ~150KB）
- [x] `test:smoke` 92/92 通过（含零改编验证：每个 skill content 与 submodule 源文件正文逐字一致）

## 全量验收步骤

1. **安装**：`dsh plugin --profile <name> add ./canvas-studio`（或重装含本轮构建的包），重启桌面（兼容模式）。
2. **确认 catalog**：上下文注入的 skill-catalog 面板应出现全部 9 个 MiniMax-H3 skill + canvas-studio-creation 总纲。
3. **逐风格抽查**：分别用「极简产品广告」「纸艺定格讲解」「品牌宣传」「MV 字幕」「合作游戏开场」「纸拼贴讲解」「手绘实景融合」「3D 动画」发起制作，观察对应 skill 按需加载 + 原版流程推进。
4. **能力降级抽查**：任一风格走到 BGM/配音/字幕环节，观察 music_generation / tts_voiceover / subtitle_burn 占位工具返回中文降级指引且不卡流程。
5. **S3 风格 GIF 预览**：澄清第③步点「风格」→ 8 张 GIF 预览卡片（2 列网格、懒加载、推荐项带徽标）；点选回流正常；时长/画幅等非风格问题仍是文字按钮。

## 预期行为清单

| 环节 | 预期 |
|---|---|
| skill 加载 | 模型经 skill 工具读到对应原版正文（catalog 描述截断是正常 UI 行为） |
| 内容原版 | 各风格流程与 MiniMax 原版一致 |
| 选项卡 | 关键节点走 ask_user_choice（映射原版选项卡门） |
| 分镜门禁 | submit_storyboard_for_approval 生效（逐步确认模式） |
| BGM/配音/字幕 | 占位工具返回降级指引，流程继续 |
| 画面/时长 | 与 canvas 约束一致（16:9/9:16、单段 ≤15s） |
| 风格 GIF 预览（S3） | 风格问题渲染 GIF 卡片，其余问题文字按钮 |

## 判定标准

- **通过**：全 9 个 skill 出现在 catalog；抽查 2-3 个风格流程走通；占位工具降级可操作。
- **部分通过**：个别风格流程简化——记录现象，评估是否需要在总纲加工具映射提示（不改原版内容）。
- **不通过**：agent 反复选错工具、卡在某一步——把失败环节与模型回复贴回，由 Host 侧适配层补丁。

## 实测结论记录

（验收后回填：各风格哪些环节原样跑通 / 哪些降级 / 模型工具路由是否稳定）
