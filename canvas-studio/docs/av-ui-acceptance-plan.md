# UI 验收层设计方案（CV-006 片段排除 + BGM 选择器 / CV-007 时间轴语义）

> 日期 2026-09-11 ｜ 状态：**已落地（CV-006/007，验证链 458/458），待桌面验收（§6）**（拍板结果：BGM 候选仅音频节点 / 时间轴默认仅媒体，均按方案默认执行）
> 定位：音画同步 A 通道（CV-138~143）的**验收支撑层** —— 现在同步结果只能靠听 + 命令行 ffprobe 才能确认，UI 导出路径甚至**恒不带 BGM**。本方案把「选片段、选 BGM、看得见时长与音轨」补到桌面上。
> 上游：[av-sync-test-readiness.md](./av-sync-test-readiness.md) P2-8（CV-006）/ P2-7（CV-007）、[av-sync-acceptance-cases.md](./av-sync-acceptance-cases.md) T9

---

## 0. 一句话

**服务端与 client SDK 早已支持 `clipIds` + `bgmNodeId`（零改动），缺的只是桌面 UI 这最后一公里：排除勾选、BGM 下拉、真实时长与总时长可见。**

## 1. 现状（代码事实）

| # | 事实 | 位置 |
|---|---|---|
| 1 | UI 导出把时间轴里**全部** `kind==='video'` 节点塞进 clipIds，无排除手段 | `StudioFrame.tsx:558` |
| 2 | UI 调 `composeStudioVideo(projectId, clipIds)` **不传 bgmNodeId** → 按钮路径成片多镜恒无声 | `StudioFrame.tsx:565` |
| 3 | client SDK 已支持 `bgmNodeId` 可选参 | `client/api.ts:328-353` |
| 4 | 服务端 `/compose` 路由已解析 `bgmNodeId` | `routes.ts:1113-1128` |
| 5 | 合成结果已回填 `audioComposition` 标签（`环境声+BGM`/`纯BGM`/`无声`/`环境声`） | `StudioFrame.tsx:579/587`、`CanvasNode.tsx:602-608` |
| 6 | 时间轴 = 全部节点 chip 流（含 text 等非媒体），无总时长、无刻度；chip 只显示创建时间 | `CanvasTimeline.tsx:39-40、:119` |
| 7 | 视图持久化已有 `view.timeline?: string[]`（顺序即合成顺序），是排除态的天然落点 | `contracts/canvas.ts:320/331` |
| 8 | 节点 `duration` 自 CV-140 起为 **ffprobe 真值**（角标/时长计算有可信数据源） | `compose.ts:393`、`host-tools.ts:621` |

## 2. 目标 / 非目标

**目标**（验收够用为限）：
1. 合成前可**排除**个别片段（CV-006 chip 勾选态）；
2. 合成前可选 **BGM**（下拉选画布音频节点），选中后走与 agent 相同的 `bgmNodeId` 通路；
3. 时间轴具备**媒体语义**：只看媒体（可切换全部）、显示真实时长角标、显示预计成片总时长（CV-007 最小满足）。

**非目标**（明确不做，防 over-engineering）：
- ❌ 波形包络 / 音频轨图形化绘制（无波形数据源，本地解码属重活；`av-timeline-plan` P2-7 本就排后）；
- ❌ 按真实秒数的比例长条时间线（chip 流形态下刻度尺没有对齐意义）；
- ❌ 客户端硬拦「BGM 短于成片」（服务端 CV-138 守卫已报精确差额，UI 只做**软提示**）；
- ❌ 合成参数面板 / 调色开关等新 UI 面（`colorGrade` 维持 agent 侧传参）。

## 3. CV-006 设计

### 3.1 片段排除勾选

| 项 | 设计 |
|---|---|
| 数据 | `StudioCanvasView` 新增 `composeExcluded?: string[]`（`contracts/canvas.ts:320` 同级；**缺省 = 全部纳入**，老项目零迁移） |
| UI | 时间轴每个 video chip 角落加勾选态（右上小圆点/对勾）；点 chip 本体 = 选中节点（**现状不变**），点勾选区 = 切换纳入/排除；排除态 chip 整体降透明度 |
| 作废联动 | CV-108 已作废（`supersededBy`）片段**不可纳入**：勾选区禁用并标「已作废」（compose 本就只收有效版） |
| 逻辑 | `handleComposeExport`（`StudioFrame.tsx:556`）过滤 `!composeExcluded.includes(id)`；全部排除或有效片段为 0 → 合成按钮禁用 |
| 持久化 | 随 `view` 走既有 `handleViewChange` 通路（与 `timeline` 同一条持久化路径，无新机制） |

### 3.2 BGM 选择器

| 项 | 设计 |
|---|---|
| UI | 时间轴工具栏（`csTimelineToolbar`）加一个下拉：`BGM：不使用（默认）/ <音频节点标题 · 16.02s> …`，枚举画布 `kind==='audio'` 节点，选项文案带**真实时长**（CV-140 真值） |
| 数据 | `StudioCanvasView` 新增 `composeBgmNodeId?: string`；读取时校验节点仍存在且为 audio，失效自动回退「不使用」（防悬空引用） |
| 传参 | `composeStudioVideo(projectId, clipIds, bgmNodeId)` —— **SDK 与路由零改动**，只改调用处一行 |
| 软提示 | 选中 BGM 时，若 `bgm.duration + 0.05 < Σ有效片段真值时长`，下拉旁出 amber 提示「BGM 可能比成片短 ≈X s」（不拦，服务端守卫兜底报精确差额） |
| 结果 | 成片节点 `audioComposition` 标签已有回填通路（现状 #5），零改动 |

## 4. CV-007 设计（最小满足）

| 项 | 设计 |
|---|---|
| 媒体过滤 | chip 流默认**只显 video + audio**（非媒体混排的直接解法）；工具栏加「显示全部」toggle（默认关），回看 text/图片时打开 |
| 时长角标 | video/audio chip 的 `csTimelineTime` 从「创建时间」改为「**真实时长**（如 `5.17s`）+ 创建时间」二行或紧凑并排（取样式成本低者） |
| 预计总时长 | 工具栏显示「预计成片 ≈ Σ 有效纳入片段真值时长」（如 `预计 15.50s`），随排除勾选与排序实时更新 —— 这是用户在合成前唯一的「时长锚点」。**成片节点（`toolName=compose`）不计入**（CV-160：它是产物不是素材，计入会导致时长翻倍） |
| 拖拽排序 | **保留现状**（顺序即合成 clipIds 顺序，P9.1 语义不变） |
| 刻度尺 / 音频轨 | 不做（见非目标） |

## 5. 改动清单

| 文件 | 改动 | 规模 |
|---|---|---|
| `src/contracts/canvas.ts` | `StudioCanvasView` + `composeExcluded?` / `composeBgmNodeId?` | +2 字段 |
| `src/client/StudioFrame.tsx` | `handleComposeExport` 过滤排除项 + 传 `bgmNodeId`；view 读写与失效回退 | ~30 行 |
| `src/client/canvas/CanvasTimeline.tsx` | 勾选区、BGM 下拉、媒体过滤 toggle、时长角标、预计总时长 | ~80 行 |
| `src/compose-selection.ts`（新，根级纯函数） | `resolveComposeSelection(ordered, excluded, bgmNodeId)` → `{ clipIds, bgmNode, estSeconds, warnings }`：过滤、BGM 校验、软提示计算收在一处；按 `style-grid.ts` 先例（根级纯函数 + client 两要件：tsconfig include + `.js` 后缀） | ~60 行 |
| `src/client/styles.ts` | 勾选态 / 下拉 / 提示样式 | 少量 |
| `tsconfig.client.json` | include 追加 `src/compose-selection.ts` | 1 行 |
| `tests/compose-selection.test.mjs`（新） | 排除过滤 / 全排除 / 作废片段剔除 / BGM 失效回退 / 软提示阈值（0.05s 容差边界） | ~8 例 |

**CV-006/007 本身无 Host / 后端 / 工具改动**；`docs/STATUS.md` 两行 + 验收用例 T9 升级为正式用例。

> **CV-160 补丁（2026-09-11，与本批同源 —— 桌面验收时用户发现「时间计算有问题」）**：本批新增的 `compose-selection.isComposableClip` 漏了「非成片」一条，与 Host 权威 `defaultComposeClips`（`kind==='video' && toolName !== 'compose' && isActiveShot`）**分叉** → 成片节点（`kind=video` + `toolName=compose`）被当成「一个视频片段」：预计时长把上一版成片重复计入（真实 15.51s → 显示 30.99s，**正好翻倍**）、导出时还会把它当 clipId 再拼一次（**递归叠加**，CR-001 早在 Host 侧杜绝过）。修法 = **收敛成唯一权威谓词** `shot-versions.isShotClip`（`defaultComposeClips` 与 `isComposableClip` 双双委托，新消费方禁止再内联 `kind === 'video'`）；UI 侧成片 chip 保留可见但不给勾选框、加「成片」角标、工具栏出「成片 N 个不计入」。测试含**口径一致性护栏**（同一节点表下两处集合必须相等）。详见 STATUS **CV-160**。

## 6. 验收

**自动化**：验证链全绿（sync → tsdown → 双端 tsc → verify:loader → `node --test` 只认 `# fail 0`）。

**桌面**（对照 [av-sync-acceptance-cases.md](./av-sync-acceptance-cases.md)）：
1. 排除一个片段再点导出 → 成片不含该片段、血缘只连剩余片段；
2. 下拉选一段 16s BGM 导出 → 成片角标 `· 纯 BGM`（多镜）/ `· 环境声+BGM`（单镜），**与 T3/T4 的 agent 路径产物一致**（同一合成函数，殊途同归）；
3. 选一段短 BGM → 出 amber 软提示；强行导出 → 服务端中文报错原样呈现；
4. 时间轴默认只显媒体、显示真实时长与预计总时长；「显示全部」可切回。

## 7. 两个待拍板点

1. **BGM 候选范围**：下拉只列 `kind==='audio'` 节点（本方案默认），还是也允许选**已生成成片节点**（服务端 `bgmNodeId` 描述写着「视频/音频文件」均可）？倾向：只列音频，少一个歧义来源。
2. **时间轴默认视图**：默认「仅媒体」（本方案默认，语义最贴 CV-007），还是默认「全部」+ toggle 切媒体？倾向：仅媒体——CV-007 的原始诉求就是「非媒体混排」。

## 8. 风险

- `view` 两个字段是**追加可缺省**，老项目无需迁移；唯一注意点是 `composeBgmNodeId` 悬空（已设计失效回退）。
- chip 勾选区与拖拽/点击的命中冲突：勾选区做 `stopPropagation`，不进 chip 的 onClick/onDragStart。
- 时长角标对旧项目里「探测失败回退请求值」的节点如实显示请求值（CV-140 兜底语义，不额外区分）。
