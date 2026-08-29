# 下一步工作盘点（2026-08-29）

> 来源：通读 `plan.md` / `docs/canvas-ux-backlog.md` / `docs/hitl-workflow-analysis.md` /
> `docs/plans/canvas-studio-phase2.md §11` / `docs/plans/canvas-studio-optimization-backlog.md`，
> 并与 `src/` 当前代码逐项核对。
> 用途：讨论下一批次开发范围。**本文档只做盘点与排序，不自行开工。**

---

## 一、现状快照

> **2026-08-29 16:10 更新**（批次 0 已实施完毕）

| 项 | 状态 |
| --- | --- |
| 分支 | `dev`；本轮改动**已提交** `6b3091a772`（18 文件：`src/` 6 + `tests/` 1 + `docs/` 2 + `lib/` 构建产物 9），工作区干净 |
| 未推送提交 | **7 个**（历史 6 + 本轮 1）。`origin/dev` 停在 `1afaaf3b02`（workspace 治理）。沙箱无 GitHub 凭据，`git push origin dev` 报 `could not read Username` → **需用户手动推** |
| 冒烟测试 | **100/100 全绿**（93 → +7，新增 `tests/canvas-actions.test.mjs`） |
| 类型检查 | Host + Client **0 错**（`corepack yarn typecheck`） |
| Loader 校验 | `corepack yarn verify:loader` 通过 |
| 主线变化 | 批次 0（CV-037 / CV-018 / CV-035）已实施，见 §四 |

### 1.1 今日新增提交（skill 实测反馈驱动）

| 提交 | 内容 | 涉及位置 |
| --- | --- | --- |
| `824db35533` | skill 工具调用语法写进总纲 + 风格名匹配容错。根因：总纲只说"用 skill 工具加载对应 skill"未给语法，agent 传中文名/缩写触发 dsh `invalid skill name` / `unknown`。补 `skill(name="英文原名")` 语法 + 5 条约束；`question-capture` 加 `styleDemoSkillLoose` 宽松匹配（去空格 + 双向包含） | `creation-spec.ts` L116-125、`question-capture.tsx` L39-52 |
| `47cd86a30a` | 风格题改**两级追问**（3a 四大类 → 3b 该大类下 2 个具体风格，避免一次摆 8 个选项）；skill 加载失败降级（核对 name 后重试一次，两次仍失败按标准工作流继续并说明）；顺带修两级追问文案未转义反引号导致模板字符串截断 | `creation-spec.ts` L41-44、L125 |

**当前澄清第 ③ 步形态**（`creation-spec.ts:41-44`）：
```
① 时长 → ② 画幅 → ③ 风格（两级：3a 大类 → 3b 具体风格）→ ④ 节奏/镜头数 → ⑤ 受众与用途
3b 的 options 必须逐字用 8 个预设名 → 保证 GIF 预览卡片 + skill 路由命中
```

### 1.2 ✅ CV-037 已修复（2026-08-29 16:10）

原状态：window `mousedown` 无条件 `setMenu(null)`（当时的 `StudioFrame.tsx:86-90`，全文无 `menuRef`），菜单项只绑 `onClick` → 14 项全失效。

已实施（详见 §三 3.1 与 §四 批次 0）：菜单容器挂 `menuRef` + `shouldKeepMenuOpen` 纯函数判定，补 Escape 关闭；新增 7 个单测。**待桌面回归 14 个菜单项**（本沙箱无法启桌面）。

---

## 二、⚠️ 文档漂移（本次核对发现，直接影响待办排序）

backlog 里有 3 项状态已与代码不符，**按原样执行会做重复工**。

| 条目 | backlog 状态 | 代码实际 | 结论 |
| --- | --- | --- | --- |
| **CV-039** H3 提示词规范升级 | 待处理 P1（称"声音设计能力完全没启用"） | `src/skills/creation-spec.ts:78-106` **已完整落地**：三字段 `integrated_multimodal_description` / `overall_soundscape` / `non_diegetic_music`（L88）、运镜三要素（类型+幅度+速度，L92）、说话人 ID `(S1)` + `<d>[语言]台词</d>`（L94）、画面文字引号规范（L94）、六段规划法（L98）、Ref2VA 首行对齐指令（L85/L87） | **主体已完成**，仅剩深水区：`<Subject N>/<Audio N>` 标签体系、`retention_analysis`、官方 `references/base-en.txt` 细节 |
| **CV-041** 接入官方 `h3-prompt-writing` skill | 待处理 P2 | 已随 `plan.md §3` 的 9 skill 全量注册落地（`src/skills/minimax-skills.ts`） | **已完成**，从待办移除 |
| **O3** 右键菜单不可用 | `[待复现]` | 根因已被 CV-037 定位并**代码验证成立**（见 §3.1） | 不再是复现问题，可直接修 |

另有两处重叠需合并，避免两个文档各记一份：
- **O4**（关键帧确认点）≡ **HITL 缺口 A**（逐步确认只闸一次）→ 同一议题，合并讨论。
- **O1**（批准后需手打"继续"）≡ **HITL 缺口 B** → 同一议题，合并讨论。

---

## 三、待办清单（去重 + 按优先级重排）

### 3.1 P0 — 必修（功能断裂）

| ID | 问题 | 根因 / 位置 | 修复方案 | 状态 |
| --- | --- | --- | --- | --- |
| **CV-037** | **节点右键菜单全部点击无效** | 已验证：`StudioFrame.tsx:87-89` 用 window `mousedown` 关闭菜单；`CanvasContextMenu.tsx:33-38` 菜单项只绑 `onClick`。点击时 mousedown 先冒泡到 window → `setMenu(null)` 菜单卸载 → mouseup 时按钮已不存在 → click 永不触发 | `CanvasContextMenu` 改 `forwardRef` 挂 `menuRef`；mousedown 命中菜单内部时放行（判定抽为纯函数 `shouldKeepMenuOpen`，可单测）；补 Escape 关闭 | ✅ **已实现**（2026-08-29），**待桌面回归 14 项** |

> 修复后唯一剩下的 P0 是验收动作本身：桌面右键菜单需逐项点一遍。

### 3.2 P1 — 工作流断裂 / 体验硬伤

| ID | 问题 | 位置 | 方案 | 成本 |
| --- | --- | --- | --- | --- |
| **O1 / HITL-B** | 点「批准」后 agent 不苏醒，必须手打「继续」 | `src/client/index.ts` `approveStoryboard` 只 POST approve 不代发消息 | 翻 state 后向当前会话投递唤醒消息（approve→"继续"；reject→"请按反馈重做并提交分镜"）。需桥接上游对话发送能力 | 中（需探 `@deepseek-ai/dsh-client-ui-conversation` 的 send API） |
| **HITL-C** | 设置页「默认执行模式」是死开关（`workflowMode` 从不消费；`projects.create()` 不写 `workflow`） | `host-config.ts` / `projects.ts` / `SettingsModal.tsx` | 二选一：① `create()` 写入 `source().workflowMode` 让开关生效；② 从设置页移除该开关 | **小** |
| **O4 / HITL-A** | 「逐步确认」只闸分镜一刀，之后一路跑完；无关键帧二次门禁 | `host-tools.ts` `runGeneration` GATED_TOOLS | 方案 A（推荐）：视频生成前加第二道闸 + 客户端批准 UI；方案 B：仅 skill 软约束 | 大（需拍板是否真要） |
| **CV-036** | 项目无「已完成」标记 | `projects.ts` / `ProjectList.tsx` | 方案 A（推荐）：手动标记 + 成片信号 toast 提示；方案 B（全自动，不推荐） | 中 |
| **CV-040** | 多段成片音轨断裂（各段 BGM 各生成各的） | `compose.ts`（`buildAmixArgs` 已有半成品）、`host-tools.ts` `compose_video` | 三步：① compose 支持 Master Audio 对齐；② skill 教 agent 先锁全局 BGM；③ 音频节点 `kind=audio` 最小闭环（**当前代码无任何 audio 节点类型**） | 大 |
| **CV-008** | 多选半成品：ctrl 点选可用，但拖拽只动单节点、group 不带 children、无框选 | `CanvasSurface.tsx` Gesture、`project-store.ts` `moveNode` | gesture 支持多 id 集合；group 带动 children；补 marquee | 中 |
| **CV-005** | 血缘连线只能加不能删 | `CanvasEdges.tsx` / `project-store.ts` | ⏸ 已拍板延后（并入"多版素材择优"工作流设计） | — |
| **CV-006 / CV-007** | compose 无法排除片段 / 时间轴语义混乱 | `StudioFrame.tsx` / `CanvasTimeline.tsx` | ⏸ 已拍板延后 | — |

### 3.3 P2 — 体验优化（低风险、可批量）

| ID | 问题 | 位置 | 成本 / 状态 |
| --- | --- | --- | --- |
| CV-035 | 画布网格颜色偏深 | `styles.ts` `csCanvasSurface` | ✅ **已实现**（网格线 `color-mix(... 45%, transparent)`，40px 格距不变） |
| CV-038 | 连线起草线起点偏移（用指针位置而非节点右缘中点）+ 直线与落定后贝塞尔不一致 | `CanvasSurface.tsx` | 小 |
| CV-011 | 参考节点无角色色点角标；托盘空态无引导 | `CanvasNode.tsx` / `StudioFrame.tsx` | 小 |
| CV-015 | 错误/成功提示用 `window.alert`（阻塞式） | `StudioFrame.tsx` 多处 | 小（引入 toast） |
| CV-016 | 右键空白处无菜单 | `CanvasSurface.tsx` | 小 |
| CV-017 | 方向键微调（1px / Shift 10px） | `CanvasSurface.tsx` | 小 |
| CV-018 | 失败节点无就地重试按钮 | `CanvasNode.tsx` | ✅ **已实现**（徽章兼作按钮，`canRetryNode` 判定与 `rerunNode` 前置检查一致） |
| CV-019 | 无「缩放到选中」；双击空白 = fitToContent | `CanvasSurface.tsx` | 小 |
| CV-020 | 资产无下载/另存入口 | `CanvasNode.tsx` / `LayerDetailPanel.tsx` | 小 |
| CV-021 | 删除被引用节点无提示，下游 sourceIds 悬空 | `StudioFrame.tsx` / `project-store.ts` | 小 |

### 3.4 二期残留（`docs/plans/canvas-studio-phase2.md §11`）

| 项 | 状态 |
| --- | --- |
| P9.1 时间轴拖拽重排 + 刷新保留顺序 | 代码完成，**待桌面验收** |
| P9.2/P9.3 合成路由与一键导出 | 代码完成，**待桌面核验** |
| P10 `/health` 探针（Drama 宕机秒级中文报错） | ⬜ 未做 |
| 会话内偶现 `Error: [object Object]`（abort reason 未取 message） | ⬜ 未做 |
| 实时进度条（当前仅首帧占位） | ⬜ 未做 |
| sessionId 持久化 / 明文 API key 迁移 `$DSH_HOME` | ⬜ 未做 |

### 3.5 设置页 Roadmap（`plan.md §2`，本轮未做）

| 项 | 可行性 |
| --- | --- |
| 语言 / 地区（i18n） | ⚠️ 需引入 i18n 体系 |
| 网络 / 代理（访问 Veo/Sora 用） | ⚠️ 需确认桌面是否已有代理服务 |
| 通知（生成完成/失败） | ⚠️ 待查桌面 notification 是否对插件开放 |
| 关于（版本 / 重置设置 / 清空资产） | ✅ 低风险 |

---

## 四、建议批次

### 批次 0 — 实测减负 ✅ 已实施（2026-08-29 16:10）

> 针对"正在做 skill 端到端实测"这条主线，**先给实测清障**再做别的。

| # | 项 | 实现要点 | 状态 |
| --- | --- | --- | --- |
| 1 | **CV-037** 右键菜单修复（P0） | `CanvasContextMenu` 改 `forwardRef` 挂 `menuRef`；`StudioFrame` 的 window `mousedown` 命中菜单内部时放行，改由菜单项 `onClick` 内「先关闭再执行」；新增 window `keydown` 支持 Escape 关闭。判定逻辑抽为纯函数 `shouldKeepMenuOpen(target, menu)` | ✅ 已实现，**待桌面回归 14 项** |
| 2 | **CV-018** 失败节点就地重试 | 错误徽章在可重放时渲染为 `<button>`（文案「生成失败 · 点击重试」），直接重放不加确认弹窗；可见性由纯函数 `canRetryNode`（`toolName` + `generationPrompt` 齐备、非 loading）判定，与 client 侧 `rerunNode` 前置检查一致，杜绝"点了才提示没有参数"；`onRetry` 经 `CanvasSurface` 透传 | ✅ 已实现 |
| 3 | **CV-035** 网格调浅 | `.csCanvasSurface` 网格线改 `color-mix(in srgb, var(--dsw-alias-border-l2) 45%, transparent)`（Electron 43 / Chromium 支持，仍跟随明暗主题）；格距 40px 不变 | ✅ 已实现 |

**新增文件**：`src/canvas-actions.ts`（纯函数，Host tsc 也编译 → 可被 `node --test` 直连）、`tests/canvas-actions.test.mjs`（7 例）。

**验证结果**：`test:smoke` **100/100**；`yarn typecheck`（Host + Client）0 错；`yarn verify:loader` 通过。

**⚠️ 构建注意（沙箱环境）**：`yarn build` 首步 `scripts/clean.mjs` 会 `rmSync('lib')`，本沙箱的批量删除保护（>50 文件）会拦截并中断构建。**在沙箱内改用逐步骤命令**：
```bash
cd canvas-studio
node node_modules/.bin/tsdown
node node_modules/.bin/tsc -p tsconfig.json
node node_modules/.bin/tsc -p tsconfig.client.json --emitDeclarationOnly
```
（用户本机终端直接 `corepack yarn build` 无此问题。）

**验收方法（需重建 + 重启桌面）**：
1. `corepack yarn workspace canvas-studio build && corepack yarn dev`
2. 右键任一节点 → 逐项点：重命名 / 复制 / 引用到对话 / 锁定 / 隐藏 / 置顶 / 置底 / 上移 / 下移 /（分组节点）解组 /（生成中）打断 / 重试 / 修改提示词 / 删除 —— 每项都应真正生效
3. 菜单打开时按 Escape 应关闭；点画布空白处应关闭
4. 造一个失败节点（如断网生成）→ 徽章应为可点的「生成失败 · 点击重试」，点击后节点回到生成中态
5. 上传失败类节点（无 `toolName`）→ 徽章仍是普通不可点文本
6. 画布网格应明显变淡，格距不变

### 批次 1 — 快赢（约半天，全部低风险）

1. **CV-038** 起草线起点 + 贝塞尔
2. **HITL-C** 设置页死开关（建议选方案②移除开关，改动最小）
3. **CV-020** 资产下载入口

> 收益：清掉用户明确抱怨过的项，重建一次即可整体验收。

### 批次 2 — 交互补全（约 1–2 天）

1. **CV-008** 多选拖拽 + group 联动 + 框选
2. **CV-015** toast 替换 alert
3. **CV-016 / CV-017 / CV-019** 右键空白菜单、方向键微调、缩放到选中
4. **CV-011** 参考角标 + 空态引导

### 批次 3 — 工作流硬伤（需先拍板）

1. **O1/HITL-B** 批准后自动继续（体验关键，改动集中在 `client/index.ts`）
2. **O4/HITL-A** 关键帧第二道闸（**需先确认是否真要逐步确认**）
3. **CV-036** 项目完成标记（**需 A/B 拍板**）

### 批次 4 — 音轨 / 可靠性

1. **CV-040** Master Audio 三步走
2. **P10** `/health` 探针 + `[object Object]` 错误渲染 + 实时进度

---

## 五、待拍板决策点

| # | 议题 | 选项 |
| --- | --- | --- |
| 1 | **下一步做什么**（16:10 更新：批次 0 **已实施**） | 桌面回归批次 0 后 → 批次 1 快赢（CV-038 / HITL-C / CV-020）/ 批次 2 交互补全 / 批次 3 工作流硬伤（O1 + CV-036） |
| 2 | **HITL-A 关键帧第二道闸** | A 加硬闸 / B 仅 skill 软约束 / C 维持现状（当前"逐步确认"=只闸分镜） |
| 3 | **CV-036 项目完成标记** | A 手动标记 + 成片 toast / B 全自动（有成片即完成） |
| 4 | **CV-005/CV-006/CV-007** 是否提前解禁 | 维持延后 / 现在做 |
| 5 | **skill 实测覆盖度** | 8 个风格全验 / 只验代表性的 2-3 个（如 3D 动画已过 + 极简产品广告 + MV 字幕） |
| 6 | **6 个未推送提交** | 现在推 / 攒到阶段收尾再推 |

---

## 五·补、skill 实测尚未覆盖的点（`plan.md §3.6` 已知边界）

| 项 | 状态 |
| --- | --- |
| 8 个风格逐个实测 | 仅 `3d-animation` 明确通过（`plan.md §3.5`），其余 7 个未验 |
| 两级追问后 3b 的 GIF 预览是否命中 | 待实测（3b 用逐字预设名，理论应命中；3a 大类是分类名，无 GIF 属预期） |
| 占位工具降级（`music_generation` / `tts_voiceover` / `subtitle_burn`）真实流程里是否顺滑 | 待实测 |
| 原版 skill 的「选项卡门」与 canvas 的 `ask_user_choice` 并存 | 待逐风格验证 |
| 原版「视频模型选项卡」（H3/Seedance 2.0）canvas 无对应模型选择 | 需 agent 降级说明固定走 Drama Backend |
| `references/*.md`（3d-animation 5 个、co-op-game 2 个、h3-prompt-writing 2 个） | 正文零引用，暂未打包 |

---

## 六、变更记录

| 日期 | 变更 |
| --- | --- |
| 2026-08-29 上午 | 初版盘点。核对发现 3 处文档漂移（CV-039 / CV-041 已落地，O3 根因已定位），合并 O1≡HITL-B、O4≡HITL-A |
| 2026-08-29 15:47 | 更新现状：新增 2 个 skill 实测反馈提交（`824db35533` / `47cd86a30a`），未推送累计 6 个；复核确认 CV-037 仍未修；新增**批次 0 实测减负**（CV-037 + CV-018 + CV-035）；补 §五·补 skill 实测未覆盖点 |
| 2026-08-29 16:10 | **批次 0 实施完毕**（用户拍板"开始吧"）：CV-037 右键菜单修复（`menuRef` + `shouldKeepMenuOpen` + Escape）、CV-018 失败徽章就地重试（`canRetryNode`）、CV-035 网格调浅 45%。新增 `src/canvas-actions.ts` + `tests/canvas-actions.test.mjs`（7 例）。测试 93 → **100/100**，typecheck 0 错，verify:loader 通过。同步 `canvas-ux-backlog.md` 三行状态 + 变更记录。**已提交 `6b3091a772`，待桌面回归** |
| 2026-08-29 16:2x | 文档状态同步：本轮改动已提交（未推送累计 7 个，沙箱无 push 凭据） | 工作区干净 |
