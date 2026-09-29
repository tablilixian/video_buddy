# REQ-008 — 对话流中文 tool 显示与降噪（方案 v1.0）

> **需求**（资料库需求表行 8，P0，状态：待评审 → 本方案落地后转「开发中/待验收」）：
> agent 对话流需要改造。目前废话显示太多，tools 调用应该更直观，比如中文显示「生成xxx图」「生成xxx分镜视频」。
> 一些其他 tools 调用都可省略不显示。用户需要看到跟项目最相关的生成信息，且**默认用户不懂 agent harness**。
>
> **本地跟踪**：`docs/requirement-tracker.md` REQ-008 条目。
> **效果图**：[`REQ-008-tool-rows-mockup.html`](./REQ-008-tool-rows-mockup.html)（浏览器直接打开）。
> **日期**：2026-09-29 ｜ **状态**：方案定稿，开始执行

---

## 0. 一句话结论

**不动 DSH 任何代码**，走上游官方扩展槽 `tool.call.toolview`（keyed，按工具名整行接管）把对话流工具行
换成「三档中文行」：A 展示级大字 + 动态摘要、B 流程级一行、C 内部级极简灰字（默认点开可展开），
失败行任何档位永不隐藏。

## 1. 架构依据（为什么不改 DSH）

### 1.1 渲染链与扩展点

```
ui-conversation chat 视图
  └─ chat.node（key='tool-call'）→ ui-tool/ToolCallTree.tsx
       └─ renderSlot('tool.call.toolview', owner, {
            entryKey: toolName,                    // ← 按 wire 工具名分发
            fallback: <GenericToolCard/>,          // ← 未注册 key 的回落
          })
```

槽契约：`deepseek-harness/packages/client/ui-tool/src/client/contract/slots.ts` ——
`'tool.call.toolview': { kind: 'keyed'; scope: 'session'; owner: ToolCallOwnerProps }`。
契约注释原文：**key 域开放（任何 wire 工具名）、注册即接管（takeover）、未认领 key 回落通用行、
注册对你自己的工具是增量的**。上游先例：`cordis_define` 刻意不进通用表，由 ui-cordis 自注册 keyed 视图
（`tool-call-model.ts:31-34`）。

### 1.2 为什么这是「不改 DSH」的

- 我们只是**消费**一个公开槽：插件侧 `slots.inject('tool.call.toolview', → slots.register({name, key}, View))`，
  零文件落在 `deepseek-harness/`。
- 注册纪律即红线④：`inject` 等声明就绪后才 register——宿主将来删/改该槽时插件**静默不挂、整体照常启动**，
  不会 Renderer boot failed。宿主侧已有实证：`dsh-plugin-desktop/tests/electron-runtime.spec.ts` 的
  keyed 槽行为断言。
- `tests/host-boundary.test.mjs` 四条红线（样式 `.cs*` / 不赋 `--dsw-*` / inject 包裹 register /
  不深入上游相对 import）是既有棘轮，本方案新增代码全部天然通过其 AST 静态检查。

### 1.3 现状噪音根因（为什么要改）

`deepseek-harness/.../tool-call-model.ts:217-232`：

- DSH 内置工具 → 英文 Figma 字面 title：`Search` / `Read` / `Bash` / `Write` / `Edit` / `Tool call`；
- **canvas-studio 自有 24+2 个工具全部落进 `others` 变体** → 标题恒为 `Tool call`，摘要拼
  `toolName · {参数JSON}`，即 `image_generate · {"prompt":"…"}` 这种「英文名 + JSON」刷屏。

数据侧很富：`block.argsRaw`（入参）、`content`（结果）、`isError/error`（失败）、
`callTime → time`（可算耗时，`ToolResultNode` 自带两个 epoch ms 字段）、`subCalls`（子调用）。

## 2. 能力边界

| 能做 | 手段 |
|---|---|
| 中文标签 + 动态摘要（「生成图像 · 竹林月夜…」） | `tool.call.toolview` keyed 注册，整行替换 |
| 内部工具降噪为极简一行、默认可展开 | 自研行组件（复用已依赖的 `ui-primitives` 的 `DisclosureRow`） |
| 失败行保底（红字错误永不降级） | 组件内读 `block.isError / error` 分支 |
| 耗时徽标 | `(block.time - block.callTime) / 1000` |

| 不能做 | 原因 |
|---|---|
| 改消息气泡 / 输入框 / 消息流插阶段分隔线 | DD-09 明确非目标（h 批已删，`visual-direction-execution-plan.md`） |
| 样式选中宿主 hash 类名 / 赋 `--dsw-*` / 宿主 `data-*` 当选择器 | host-boundary 红线①②，破坏无缝升级 |
| 改工具**执行**或返回给模型的内容 | 影响 agent 决策，属另一需求 |
| catch-all 兜底未登记工具 | keyed 槽无通配 key；靠测试钉住「自有工具全登记」（见 §6 特性） |

## 3. 三档文案表（唯一事实源 = `src/tool-presentation.ts`）

> 产品可直接改这张表（纯数据，改表不改码）。**既有测试契约不可破**：
> `tests/asset-history.test.mjs:168-172` 断言 `video_generate=视频生成`、`compose=成片合成`、
> `cut_audio=音频裁切`、`image_fix=图内文字修复`、未知工具兜底原名。

### A 档 · 展示级（大字中文标题 + 动态摘要 + 状态/耗时）

| 工具 | 中文标题 | 动态摘要规则 |
|---|---|---|
| image_generate | 生成图像 | prompt 前 40 字；filenames 非空追加 `· N 张参考` |
| image_fix | 图内文字修复 | 被修复的引号文本前 30 字 |
| character_generate | 生成角色立绘 | — |
| character_sheet | 生成角色四视图 | — |
| look_card | 生成 Look 卡 | — |
| video_generate | 视频生成 | prompt 前 30 字 · `N s` |
| video_composite | 成片合成 | 参考张数 |
| music_generation | 音乐生成 | caption_prompt 前 30 字 |
| compose_video | 成片合成 | — |
| qc_shot | 镜头质检 | — |
| image2vl | 画面分析 | prompt 前 30 字 |
| video2vl | 视频理解 | mode / prompt 前 30 字 |
| prompt_enhance | 提示词增强 | 原词前 30 字 |
| ask_user_choice | 向你提问 | 问题前 40 字（运行中态醒目） |
| submit_screenplay_for_approval | 提交剧本审批 | —（完成态打勾） |
| submit_storyboard_for_approval | 提交分镜审批 | — |
| submit_keyframes_for_approval | 提交关键帧确认 | — |

### B 档 · 流程级（一行中文，弱化但仍可见）

| 工具 | 中文标题 |
|---|---|
| write_screenplay | 写剧本 |
| write_script | 写文案 |
| list_shots | 读取镜头表 |
| list_references | 读取素材参考 |
| upload_image | 上传素材 |
| extract_last_frame | 抽取末帧 |
| cut_audio | 音频裁切 |
| tts_voiceover | 配音（暂未开放） |
| subtitle_burn | 字幕（暂未开放） |
| *（历史别名）* compose / upload / image2image / txt2image / character | 成片合成 / 上传文件 / 图像生成 / 图像生成 / 角色四视图 |

> 历史别名仅服务 `labelOfTool` 的资产历史展示（`tests/asset-history.test.mjs` 契约），不参与槽注册
> （它们不是当前 wire 工具名，注册了也永远不触发）。

### C 档 · 内部级（极简灰字一行，默认点开详情；错误永不降级）

| 工具 | 中文标题 | 摘要 |
|---|---|---|
| read | 读取文件 | path 的 basename |
| write / edit | 写入文件 / 修改文件 | basename |
| bash / pwsh | 执行命令 | command 前 40 字 |
| grep / glob | 搜索内容 / 匹配文件 | pattern |
| web_search | 搜索网络 | query |
| web_fetch | 打开网页 | url 的 host |
| skill | 加载技能 | skill 名 |
| run_code | 运行代码 | — |
| cordis_run / cordis_stop / cordis_undefine | 运行插件 / 停止插件 / 移除插件 | 插件 id |
| cordis_package_inspect / cordis_runtime_inspect | 检查插件 | 插件 id |

### 排除清单（明确不注册）

- **`cordis_define`** —— ui-cordis 已注册同 key，双注册会抛
  `keyed slot "tool.call.toolview" already has an entry … at priority 0`（宿主 electron-runtime.spec 实证）。

### 通用规则

- **摘要提取**（`summaryOf`）：按 `prompt → command → path → pattern → query → url → name` 取第一个存在的
  字符串字段，trim 后截 40 字 + `…`；`argsRaw` JSON 解析容错（坏 JSON → 空摘要）。
- **状态三态**：running（`!('kind' in block)`）= 扫光动画 + 「进行中」；settled ok = 勾 + 耗时
  `time - callTime`（0.1s 精度）；`isError / error / interrupted` = 红点 + 错误首行，**任何档位不降级**。
- **兜底特性**：keyed 槽没有 catch-all——表外的新工具回落上游英文通用行。测试钉住「自有 24+2 工具全登记」；
  上游宿主升级新增内置工具时靠验收抽查发现（本文档记录该特性）。

## 4. 分步改动清单

| # | 文件 | 动作 |
|---|---|---|
| 1 | `src/tool-presentation.ts` **（新）** | 三档表 `TOOL_PRESENTATION` + `presentationOf` + `summaryOf` + `durationSeconds` + `labelOfTool`（唯一口径；纯模块、不 import fs，Host/Client 共用） |
| 2 | `src/asset-history.ts` | `labelOfTool` 改为从 `tool-presentation.ts` 薄转出（调用点与测试零改动，消灭双口径漂移） |
| 3 | `src/client/ToolCallRow.tsx` **（新）** | 行组件：A/B/C 三档 + running/ok/error 三态 + 耗时徽标 + C 档 `DisclosureRow` 展开（参数/结果）；外壳全 `.csToolRow*` 自有类 |
| 4 | `src/client/index.ts` | 在 slots facade 块内（`inject` 等声明范式，同 hero brand mark 处）对三档表逐 key：`slots.inject('tool.call.toolview', () => slots.register({ name, key }, ToolCallRow))`，dispose 由 `ctx.effect` 回收；facade 的 register options 补 `key?: string` |
| 5 | `src/client/styles.ts` | `.csToolRow*` 样式：仅 `.cs*` 选择器 + `var(--dsw-alias-*)` / `var(--cs-*)` 只读令牌，无色值字面量 |
| 6 | `package.json` | devDependencies 加 `@deepseek-ai/dsh-client-ui-tool@0.1.1-rc.2`（与 dsh-plugin-desktop 同版本、yarn.lock 已有解析；只为拿 `ToolCallOwnerProps`/`ToolCallViewProps` 类型与槽 augmentation，运行时由宿主提供） |
| 7 | `tests/tool-presentation.test.mjs` **（新）** | 见 §5 |
| 8 | 回归 | `corepack yarn build` → `typecheck` → `test:smoke` → `verify:loader`（host-boundary 四红线 AST 天然覆盖新注册/样式） |
| 9 | `docs/STATUS.md` + `docs/requirement-tracker.md` | 新 CV 条目（**写号前 grep 整个 `docs/` 含 STATUS.md 取最大号 +1**）+ REQ-008 状态更新 |
| 10 | `docs/plans/REQ-008-tool-rows-mockup.html` **（新）** | 效果图（改前/改后对比 + 三档图例 + C 档可点开演示） |

## 5. 测试与验收

### 测试（`tests/tool-presentation.test.mjs`，从 `../lib/*.js` 导入，故先 build）

1. **全覆盖对账**：从 `../lib/host-tools.js` 拿 `createStudioTools` 的工具名清单（或内联清单 + 与
   `host-tools.ts` 源码交叉断言），逐个断言 `presentationOf(name)` 存在——**漏登记即红**；
2. placeholder 2 个（tts_voiceover / subtitle_burn）在表内；
3. **排除清单**：`presentationOf('cordis_define') === undefined`（防同 key 双注册抛错回归）；
4. 摘要提取器：`summaryOf('image_generate', '{"prompt":"竹林月夜…"}')` 截断正确；坏 JSON → null；
   `summaryOf('bash', '{"command":"ls -la"}')` 等逐字段路径；
5. 兜底：`presentationOf('unknown_future_tool') === undefined`、`labelOfTool('unknown') === 'unknown'`；
6. 耗时：`durationSeconds({time, callTime})` 精确到 0.1s；缺 `callTime` → null。
7. 既有 `tests/asset-history.test.mjs` 的 labelOfTool 契约 4 条继续通过（薄转出不改语义）。

### 桌面验收（对应需求原文）

1. 生成图 → 对话流显示「**生成图像 · 竹林月夜双人对打…**」，不再出现 `Tool call · image_generate · {json}`；
2. 生成分镜视频 → 「**视频生成 · … · 8s**」，运行中带进行态；
3. read/bash/grep/skill → 极简灰字「读取文件 · storyboard.md」，点开可见参数与结果；失败红字可见；
4. 全程零 DSH 源码改动（`git status deepseek-harness/` 干净），host-boundary 四红线全绿。

## 6. 风险与特性记录

| 项 | 结论 |
|---|---|
| keyed 槽无 catch-all | 表外工具回落上游英文行 → 测试钉自有工具全覆盖；升级宿主时抽查 |
| 同 key 双注册抛错 | 每 key 只注册一次（单表循环单点注册）；`cordis_define` 进排除清单 |
| 槽被宿主删除/改名 | `inject` 语义：声明不在则 callback 不跑，插件静默降级为上游原生行，不影响启动 |
| 类型漂移 | devDep 锁 `0.1.1-rc.2`，与宿主（dsh-plugin-desktop 同版本）同步升级；若 `PropsRuntime` 因 slots 版本差异报错，降级为本地 `ToolCallOwnerProps` 结构类型 + 注释指向源文件 |
| C 档展开的内容长度 | 展开体限高滚动（对齐上游 ToolRow 的 max-height scroll 行为），长 JSON 不撑爆消息流 |

## 7. 竞品参照（设计依据，检索于 2026-09-29）

- **Tool call card / Live step ledger 模式**（setproduct《16 AI agent UI patterns》，覆盖 Cursor /
  Claude Code / Manus / ChatGPT Agent）：人话工具名 + 入参结果截断可展开 + **耗时** + 状态；
  次要步骤折叠为一行；错误不折叠。
- **CopilotKit Tool Rendering**：前端按工具名注册渲染器 + 兜底渲染器——与本方案同构的行业标准做法。
- **Hermes TUI（2026-05）**：工具行默认折叠为紧凑头 `▸ Terminal("…") (0.2s)`，点击展开、新行默认折叠。
- **ChatGPT Deep Research**：不展示原始工具流，聚合为人话步骤摘要。
- **Manus 提示词层**：`tool_use_rules` 明文「不要向用户提及具体工具名」——同向约束（提示词层属 SKILL
  文案范畴，不在本需求代码内）。
