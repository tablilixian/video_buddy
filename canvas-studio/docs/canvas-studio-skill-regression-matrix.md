# Canvas Studio Skill 放手跑回归矩阵

> 定位：由一个驱动 Agent 无人值守地依次跑完项目接入的全部 skill —— 自动新建项目、自动提供创意、自动应答确认门，全部使用真实 API。跑完后用户直接在画布上人工验收产出质量。
>
> 与 [canvas-studio-e2e-testing.md](./canvas-studio-e2e-testing.md) 的关系：那份方案面向传统 Playwright 断言式 E2E；本矩阵是它的**替代演进** —— 用"agent 驱动 + 轻校验 + 人工终验"覆盖完整用户旅程与 skill 可用性回归，规避 LLM 非确定性输出导致的脆弱断言。

## 1. 核心机制（为什么可行）

| 机制 | 位置 | 对自动化的意义 |
|------|------|--------------|
| **放手跑模式（auto）** | [contracts/project.ts](../../canvas-studio/src/contracts/project.ts) `StudioWorkflowMode = 'confirm' \| 'auto'` | 切到 auto 后：需求澄清跳过（agent 自行假设五要素）、分镜审批放行、关键帧确认空操作。**创作流程可完全无人值守** |
| 工作流模式切换路由 | [routes.ts](../../canvas-studio/src/routes.ts) `POST /canvas-studio/workflow` `{projectId, mode:'auto'}` | 程序化切换；若项目处于 `awaiting_approval` 会自动恢复为 `executing` |
| 画布顶部模式开关 | 工作流条「逐步确认 / 放手跑」，按项目持久化 | UI 备选切换方式 |
| MiniMax skill 选项卡纪律 | 各 skill 正文（如 3d-animation STEP 0） | 「用户说『继续』时按选了推荐项处理」—— 驱动 agent 只需回"继续" |
| 稳定 DOM 选择器 | `csFrame` / `csCanvasSurface` / `[data-node-id]` / `csNodeLoading` / `csNodeError` / `csConversation` | CDP 连接后可读画布与对话状态 |
| 磁盘留档 | 项目目录 `canvas.json` | 可绕过 UI 直接校验节点产出 |

## 2. 运行架构

```
驱动 Agent（无人值守循环）
│
├── 连接方式：Electron 以 --remote-debugging-port=9222 启动，
│   驱动 Agent 经 CDP 操控窗口（DOM 快照 + 点击 + 输入）
│
├── 每个 skill 一轮：
│   1. 新建项目（命名 `<skill-name>-regression-<MMDD>`）
│   2. 创作类项目：切"放手跑"（工作流条按钮或 workflow 路由）
│   3. 发送矩阵中预填好的 brief（点名 skill、堵住反问空间）
│   4. 进入「观察-应答」循环（见 §4）
│   5. 完成 → 截图 + 拷贝 canvas.json 留档 → 下一轮
│
└── 全部轮次结束 → 生成汇总报告（见 §6）
    → 用户人工在画布上验收各项目产出质量
```

**环境约定**：使用真实 desktop profile（凭据、模型配置现成可用）；回归产生的项目留在真实项目列表中，由用户验收后手动清理。

## 3. 前置条件

- [ ] `corepack yarn build` 完成（canvas-studio 产物在 `canvas-studio/lib/`）
- [ ] canvas-studio 已通过 `canvas-studio/scripts/dev-install.mjs` 装入 desktop profile
- [ ] 桌面应用以调试端口启动：`electron dsh-plugin-desktop/lib/main.js --remote-debugging-port=9222`
- [ ] 驱动 Agent 能连上 CDP 并读到 `.csFrame`
- [ ] Drama 后端（`http://117.50.108.73:8082`）与编排 LLM 可用

## 4. 观察-应答循环（驱动 Agent 的核心逻辑）

```
每轮最长 = 矩阵中该 skill 的 timeout

loop:
  state = 读对话区最后消息 + 画布节点状态 + 项目 workflow 状态

  if 出现选项卡 / 确认弹窗 / 提问:
      回复「继续」（选项卡点推荐项）
  elif 存在节点 .csNodeLoading 或 workflow.state == 'executing' 且对话仍在推进:
      sleep 15s
  elif 节点出现 .csNodeError:
      右键重试 1 次；仍失败 → 标记 failed，跳出本轮
  elif 对话结束（无待办、无生成中）且产出节点数 ≥ 预期最小值:
      标记 passed，跳出本轮
  elif 超过 timeout:
      标记 timeout，跳出本轮
```

**通用纪律**：
- 失败重试最多 1 次/轮；任何单轮失败**不阻塞**后续轮次
- skill 要求上传素材而矩阵未提供 → 标记 `skipped (asset-required)`
- 触发占位工具（music_generation / tts_voiceover / subtitle_burn，见 [placeholder-tools.ts](../../canvas-studio/src/skills/placeholder-tools.ts)）得到占位结果 → **不计为失败**，在报告中标注 `placeholder`

## 5. 测试矩阵

### P0 试点档（先跑，验证链路，成本可忽略）

| # | Skill | Brief（开场原文） | 预期产出 | 门控处理 | 超时 |
|---|-------|------------------|---------|---------|------|
| 1 | `h3-prompt-writing` | 「使用 h3-prompt-writing skill：把下面的创意改写成 H3 T2VA 提示词（15 秒）：雨夜城市天台，穿风衣的侦探俯瞰霓虹街道，转身走入雨中。」 | 对话返回结构化 prompt（含 `integrated_multimodal_description` / `overall_soundscape` / `non_diegetic_music`）；**无媒体节点** | 无门 | 10min |
| 2 | `handdrawn-live-video-generator` | 「使用 handdrawn-live-video-generator skill：清晨的厨房水槽，手绘发光小机器人从水龙头里诞生。15 秒 16:9。先给我 prompt，我确认后直接用 H3 生成。」 | 1 个视频节点（15s 16:9） | prompt 确认门 → 回「确认，用 H3 生成」 | 30min |
| 3 | `creation-spec`（创作 skill） | 先切**放手跑**，再发：「创作一个 15 秒 9:16 短视频：城市少年在屋顶喂猫，猫突然开口说话。直接开始。」 | 创意便签 + 分镜卡（逐镜拆卡）+ 关键帧节点（血缘连分镜卡）+ 视频节点；workflow 最终自然结束 | auto 模式下全部门自动放行 | 60min |

### P1 标准档（无素材依赖，每轮 1-3 次视频生成）

| # | Skill | Brief | 预期产出 | 门控处理 | 超时 |
|---|-------|-------|---------|---------|------|
| 4 | `co-op-game-intro-generator` | 「使用 co-op-game-intro-generator skill：PLAYER1=阿岚，PLAYER2=Kuro，游戏名=星轨双影，风格=赛博霓虹，无角色参考图，16:9。」 | 首图节点 + 最终开场视频节点 | 风格弹窗已预答；首图确认 → 「确认，生成视频」 | 45min |
| 5 | `paper-collage-explainer-generator` | 「使用 paper-collage-explainer-generator skill：用半色调纸拼贴动画讲解『光合作用如何把光变成食物』，30 秒 16:9，直接开始。」 | 拼贴静帧图节点（含视频则一并验收） | 选项卡 → 「继续」 | 45min |
| 6 | `papercraft-stop-motion-explainer` | 「使用 papercraft-stop-motion-explainer skill：用纸艺定格动画讲解『潮汐是怎么形成的』，30 秒 16:9，直接开始。」 | 纸艺静帧/定格视频节点 | 选项卡 → 「继续」 | 45min |
| 7 | `music-video-subtitle-generator` | 「使用 music-video-subtitle-generator skill：为一首 30 秒的夏日轻快旋律做 MV 字幕视频，16:9。」 | MV 视频节点；若触发 BGM/字幕占位工具，产出为占位结果 | 选项卡 → 「继续」 | 45min |

> 注：#5-#7 的 brief 为首轮草稿，**首轮试跑后按 skill 实际反问校准**并回填本表。

### P2 全量档（重流程，手动触发）

| # | Skill | Brief | 预期产出 | 门控处理 | 超时 |
|---|-------|-------|---------|---------|------|
| 8 | `3d-animation-short-generator` | 「使用 3d-animation-short-generator skill：一句话创意『一只想学会飞的企鹅』，16:9，30-60 秒，无对白，全程按推荐项处理。」 | 简报/大纲文本节点 + 角色卡 + 场景卡 + 镜头表 + 分镜 + 逐镜视频片段 + 拼接正片（节点数 10+） | 全程选项卡 → 「继续」 | 120min |

### 素材档（暂缓，待测试素材包就绪后开放）

| # | Skill | 所需素材 | 状态 |
|---|-------|---------|------|
| 9 | `minimalist-product-ad-generator` | 一张产品图 | ⏸ skipped (asset-required) |
| 10 | `brand-promo-video-generator` | LOGO、产品图、官网链接等品牌素材 | ⏸ skipped (asset-required) |

## 6. 报告与留档

每次运行产出 `reports/skill-regression/<YYYY-MM-DD>/`：

```
reports/skill-regression/2026-08-31/
├── report.md            # 汇总报告
├── screenshots/         # 每轮关键步骤截图（开场/生成中/完成）
└── canvas/              # 每项目 canvas.json 快照副本
```

`report.md` 每轮一行：

| skill | 项目名 | 状态 | 耗时 | 节点数(类型) | 备注 |
|-------|-------|------|------|-------------|------|
| h3-prompt-writing | h3-prompt-writing-regression-0831 | passed | 3m12s | 0 | 纯文本输出 |
| handdrawn-live-video-generator | handdrawn-regression-0831 | passed | 12m40s | 1(video) | — |
| minimalist-product-ad-generator | — | skipped | — | — | asset-required |

状态取值：`passed` / `failed` / `timeout` / `skipped (asset-required)` / `passed-with-placeholder`

## 7. 风险与缓解

| 风险 | 缓解 |
|------|------|
| 编排 LLM 不点名加载 skill，走了普通创作流程 | brief 显式写「使用 <skill-name> skill」；报告校验对话中是否出现 skill 特征产物（如 3d-animation 的「项目简报」节点） |
| 单 skill 死循环追问 | 循环内计数：连续 2 次应答后状态无变化 → 标记 failed 跳出 |
| 真实 profile 数据污染 | 项目名带 `-regression-` 后缀便于筛选清理；验收后手动删除项目（同时会移除绑定 workspace） |
| 长时间无人值守中断 | 每轮独立留档，中断后按报告从下一个 skill 续跑；应用崩溃则终止整批并出部分报告 |
| API 成本 | P0/P1 为日常回归档；P2 与素材档仅在版本发布前手动触发 |

## 8. 后续演进

1. 首轮 P0 试跑 → 校准 P1 brief → 回填本表
2. 测试素材包（产品图/LOGO）准备后开放素材档
3. 稳定后可与 e2e-testing.md 的 Playwright 层合并：确定性交互（拖拽/snap/快捷键）走 Playwright，旅程类回归走本矩阵
4. 可选：接入定时任务做夜间回归（当前为手动触发）
