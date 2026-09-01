# MiniMax-H3 上游 skill 接入 — 桌面验收步骤

> 状态：3D 动画试点验收通过 → 全量 9 skill 接入验收通过 → **2026-09-01 体系重构（目录化 + resourceBase 渐进披露）待回归验收**
> 接入方式：`scripts/sync-minimax-skills.mjs` 从 submodule 逐字节复制 skill 目录到 `canvas-studio/skills/<name>/`（SKILL.md 英文入口 + references/ 细则 + SKILL.cn.md 中文对照），注册时设 `resourceBase` 指向目录，模型按需读取 references。零改编。
> 前置：已完成 `corepack yarn build`（skills/ 已同步、lib 含 minimax 相关模块）

## 验收前自检（沙箱内已完成）

- [x] HOST_OK + CLIENT_OK（tsc --noEmit 全绿）
- [x] `corepack yarn build` 成功；9 个 skill 目录复制到 `skills/`（不再生成 lib/skills/generated/，该生成物已删除）
- [x] `test:smoke` 154/154 通过（含逐字节 verbatim 验证：skills/ 与 submodule 的 SKILL.md、references/ 完全一致；resourceBase 指向存在目录；正文引用的 references 文件真实存在）

## 全量验收步骤

1. **安装**：重启桌面（兼容模式；dev link 安装时 lib 与 skills/ 变更重启即生效）。也可 `dsh plugin --profile <name> add ./canvas-studio` 重装。
2. **确认 catalog**：上下文注入的 skill-catalog 面板应出现全部 9 个 MiniMax-H3 skill + canvas-studio-creation 总纲。⚠️ catalog 描述现为英文（取自各 SKILL.md frontmatter），中文对照看 `skills/<name>/SKILL.cn.md`；描述截断是正常 UI 行为。
3. **渐进披露抽查（本轮重构核心）**：新建会话，发送
   > 加载 3d-animation-short-generator skill，然后读取它的 references/shot-table-spec.md，把六列表头原样贴给我。
   预期：skill 工具返回**精简英文正文**（非中文长文）；read 工具成功读取 `skills/3d-animation-short-generator/references/shot-table-spec.md`；回复含六列表头（`Shot ID & Duration | Continuity Handoff | Reference Anchors (Spatial + Identity) | Hook Type | Shot Description (Per-Second Directives) | Audio & Dialogue Track`）。
4. **缺口修复抽查**：发送
   > 加载 co-op-game-intro-generator skill，读取 references/h3-video-prompt-template.md，列出它的段落标题。
   预期：能列出 Priority order / Reference roles / Global style baseline / Palette system / Character identity and style lock / Fixed timeline framework 等（该模板在旧内联方案下缺失）。
5. **逐风格抽查**：分别用「极简产品广告」「纸艺定格讲解」「品牌宣传」「MV 字幕」「合作游戏开场」「纸拼贴讲解」「手绘实景融合」「3D 动画」发起制作，观察对应 skill 按需加载 + 原版流程推进。
6. **能力降级抽查**：任一风格走到 BGM/配音/字幕环节，观察 music_generation / tts_voiceover / subtitle_burn 占位工具返回中文降级指引且不卡流程。
7. **S3 风格 GIF 预览**：澄清第③步点「风格」→ 8 张 GIF 预览卡片（2 列网格、懒加载、推荐项带徽标）；点选回流正常；时长/画幅等非风格问题仍是文字按钮。

## 预期行为清单

| 环节 | 预期 |
|---|---|
| skill 加载 | skill 工具返回英文精简入口 + `<skill_resources>` 资源目录提示；**不再**一次性注入中文长文 |
| references 读取 | 模型在对应 STEP 用 read 工具读 `references/<file>` 成功（如 STEP 5 读 shot-table-spec.md） |
| 内容原版 | 各风格流程与 MiniMax 原版一致（英文正文，字节级同步） |
| 选项卡 | 关键节点走 ask_user_choice（映射原版选项卡门） |
| 分镜门禁 | submit_storyboard_for_approval 生效（逐步确认模式） |
| BGM/配音/字幕 | 占位工具返回降级指引，流程继续 |
| 画面/时长 | 与 canvas 约束一致（16:9/9:16、单段 ≤15s） |
| 风格 GIF 预览（S3） | 风格问题渲染 GIF 卡片，其余问题文字按钮 |

## 判定标准

- **通过**：全 9 个 skill 出现在 catalog；渐进披露抽查与缺口修复抽查通过；抽查 2-3 个风格流程走通；占位工具降级可操作。
- **部分通过**：个别风格流程简化——记录现象，评估是否需要在总纲加工具映射提示（不改原版内容）。
- **不通过**：skill 加载失败 / read 报 FS_NOT_FOUND / catalog 缺 skill / agent 反复选错工具——把失败环节、模型回复与工具报错贴回，由 Host 侧适配层处理。

## 实测结论记录

（验收后回填：各风格哪些环节原样跑通 / 哪些降级 / references 按需读取是否稳定 / 模型工具路由是否稳定）
