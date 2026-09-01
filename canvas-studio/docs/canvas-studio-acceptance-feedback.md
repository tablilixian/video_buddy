# Canvas Studio 验收反馈跟踪与修复方案（2026-08-26）

> 来源：P9.2/P9.3 完整链路跑通后的首轮桌面验收反馈（6 项）。
> 目的：把散点反馈整理为可跟踪、可修复的清单，并给出每项的具体修复方案（代码级）。
> 关联权威文档：`docs/plans/canvas-studio-handoff.md`（机制/环境）、`docs/plans/canvas-studio-phase2.md`（P7–P11 设计）。
> 状态约定：⬜ 待修 / 🟨 修复中 / ✅ 已修（每项修复后回写本表并同步 handoff/phase2）。
>
> 📌 **历史归档。F1~F8 的当前状态见 [STATUS.md §6](./STATUS.md#6-历史-id-映射)。**
> 新条目一律用 CV 编号，不再新增 F 系列。文档索引见 [README.md](./README.md)。

## 0. 跟踪总表

| ID | 问题 | 类型 | 优先级 | 状态 |
| --- | --- | --- | --- | --- |
| F1 | 导出成片未直接显示在画布（需手动去找/点） | 缺陷 | 高 | ✅ 2026-08-26 |
| F2 | 详情面板缺图片/视频分辨率信息 | 增强 | 中 | ✅ 2026-08-26 |
| F3 | 提示词需按 MiniMax H3 规范优化，支持 BGM/对白与多语言 | 增强 | 高 | ✅ 2026-08-26 |
| F4 | 整理布局应按血缘左源右目标分列，体现工作流推进 | 增强 | 中 | ✅ 2026-08-26 |
| F5 | 参考图交互重构：独立托盘 + 画布右键「引用到对话」+ 光标处插入 | 重构 | 高 | ✅ 2026-08-26 |
| F6 | 图层连线太细，需加粗 | 增强 | 低 | ✅ 2026-08-26 |
| F7 | `upload_image` 上传 canvas 资产必 403（`fetch` 本地 webServer 的 loopback 请求被拒）；agent 需自起临时 HTTP 服务器绕行 | 缺陷 | 高 | ✅ 2026-08-27 |
| F8 | 生成类工具回传 Drama `filename` 时触发 harness 输出 schema 校验失败（`additionalProperties: false` 未声明 `filename`），`image_generate` 等全部报错 | 缺陷 | 高 | ✅ 2026-08-27 |

## 3. 实现记录（2026-08-26）

全部 6 项已落地并通过验证（typecheck / tsdown / tsc / test:smoke 73/73 / verify:loader 均绿）。改动要点：

- **F6** `CanvasEdges.tsx`：线宽 2→3.5、高亮 3→5；箭头 marker `markerWidth/Height` 6→9。
- **F1** `StudioFrame.tsx` `handleComposeExport`：合成前预生成节点 id，回写后 `setFocusNodeId` + 触发 `fitToContent`（复用既有 `fitPendingRef` 机制），成片自动居中可见。
- **F2** `contracts/canvas.ts` 加 `mediaWidth/mediaHeight`；`generate.ts` 落真实产物分辨率；`compose.ts` 探测并回传成片分辨率；`api.ts`/`routes.ts` 透传 `width/height`；`addComposedVideo` 写入；`LayerDetailPanel` 新增「分辨率」行（缺省显示「未知」）。
- **F4** `canvas-view.ts` `computeArrangeLayout` 重写为按 `bloodline depth` 分列（源 depth0 在最左，目标层向右），同列按 `createdAt` 纵向堆叠；新增单测断言「源在左/目标在右、同列同 x」。
- **F5** `ReferenceTray` 移出左栏、改为画布内浮层 `.csReferenceFloat`（新增 CSS）；`CanvasContextMenu` 新增「引用到对话」；`StudioFrame` 实现 `insertReferenceToChat`：优先把 `@ref[标题]` 插入对话输入框光标处（`textarea`/input/`contenteditable` 三种适配器 + React 原生 value setter 技巧），失败回退复制+提示。
- **F3** `skills/creation-spec.ts` 视频提示词规范补充：六段规划法、镜头时间戳语法 `MM:SS.mmm–MM:SS.mmm`、多语言（对白 `[Language]` 跟随用户语言）、背景音乐（`non_diegetic_music:` 驱动 BGM）与对白逐字保留规则。

> 注：F1/F5 的「自动聚焦」「光标插入对话」依赖运行态画布与上游 InputBar DOM，单测无法覆盖；已在桌面客户端由人工验收路径确认编译/类型正确，建议启动客户端实测一次。

## 4. 实现记录（2026-08-27，F7/F8）

- **F7** `generate.ts` `readSourceBytes`：新增 `parseCanvasAsset`，识别 `/canvas-studio/assets/<projectId>/<file>`（带或不带 `http://127.0.0.1:<port>` 前缀）直接经 `registry.assetsDir(projectId)` 读盘上传，不再 `fetch` 本地 webServer（其 loopback 请求返回 403，浏览器同源才正常）；`upload_image` 工具（`host-tools.ts`）把 `registry` 透传给 `uploadImage`。
- **F8** `host-tools.ts` `resultSchema`：补齐 `filename`（可选 string，注明供下游链式引用）；`renderResult` 增加 `Drama 文件名` 输出。修复前 `image_generate` 等回传 Drama 文件名时因 `additionalProperties: false` 被 harness 拒绝（`"value.filename" is not a declared property`），导致全部生成调用失败。


---

## F1 导出成片未直接显示在画布

### 现象
点「合成导出成片」成功后，成片 video 节点已回写画布（`addComposedVideo` 落盘），但用户感知「没有直接出现在画布上，需要自己点导出视频去找它」。

### 根因假设
`project-store.ts` 的 `addComposedVideo` 把节点按 `LAYOUT` 网格（基于已有节点数）定位到较远坐标，并 `selectedNodeId = node.id`；但画布视口没有自动滚动/适配到该节点，节点多时落在可视区外，用户看不到。现有 `focusNodeId` 居中逻辑仅对时间轴点击等场景触发，合成回写未复用。

### 验收标准
合成成功后，成片节点自动进入可视区中心（或至少完整可见），无需手动平移/缩放去找。

### 关联文件
- `src/client/project-store.ts` `addComposedVideo`（落盘 + 选中）
- `src/client/StudioFrame.tsx` `handleComposeExport`（调 `addComposedVideo` 后未触发聚焦）
- `src/client/canvas/CanvasSurface.tsx`（已有 `focusNodeId` 居中 + `fitToContent`）

### 修复方案
1. **聚焦新节点**：`addComposedVideo` 已设 `selectedNodeId`，在 `handleComposeExport` 的 `persistAfter` 之后调用 `setFocusNodeId(node.id)`（node.id 需在 action 中返回或经 `lastNodeOf(store)` 读取）。`CanvasSurface` 的 `focusNodeId` 居中 effect（`lastFocusedRef` 守卫）会把它居中一次。
2. **兜底适配**：若选中节点仍可能超出，合成后 `requestAnimationFrame(() => surfaceRef.current?.fitToContent())` 适配一次（与「整理布局后适配」同机制）。
3. **落点优化（可选）**：成片节点不再按全局网格尾插，而是定位在「源 clip 节点的右下方簇」附近，使父子在视觉上相邻（与 F4 的列布局协同）。

风险：聚焦与「画布跳动」修复（handoff §4.4）的 `lastFocusedRef` 守卫需保持——只在 focusNodeId 变化且来源为「用户显式/合成成功」时居中，避免拖拽/重载误触发（沿用既有守卫即可）。

---

## F2 详情面板增加分辨率信息

### 现象
图片/视频节点详情面板（`LayerDetailPanel`）只显示「类型/工具/时长/创建时间/透明度/镜像/锁定/可见」，没有媒体原始分辨率（如 1280×720）。

### 根因
画布节点 `StudioCanvasNode` 当前没有「媒体原始宽高」字段；`width/height` 是**画布显示尺寸**而非产物真实分辨率。`GenerateResult`（Host `generate.ts`）其实返回了 `width/height`，但落盘时未写入节点；`compose.ts` 合成的成片分辨率已知（首 clip 分辨率）也未落节点。

### 验收标准
- 图片节点详情显示「分辨率 1280×720」；
- 视频节点详情显示「分辨率 1280×720 · 时长 12.3s」；
- 旧节点/缺失信息时显示「分辨率 未知」而非报错。

### 关联文件
- `src/contracts/canvas.ts` `StudioCanvasNode`（需加 `mediaWidth?`/`mediaHeight?`）
- `src/generate.ts` `appendCanvasNode` 落盘路径（写 `mediaWidth/mediaHeight`）
- `src/compose.ts`（成片写 `mediaWidth/mediaHeight`，取首 clip 探针分辨率）
- `src/client/canvas/LayerDetailPanel.tsx`（展示行）

### 修复方案
1. **契约扩展**：`StudioCanvasNode` 增加 `mediaWidth?: number`、`mediaHeight?: number`（可选、`exactOptionalPropertyTypes` 友好，旧文档默认 undefined）。
2. **Host 回填**：`generate.ts` 在生成成功后，把 `GenerateResult.width/height` 写入节点（agent 节点走 `appendCanvasNode`；retry 走 `updateNode`）。`compose.ts` 把统一转码分辨率写入成片节点。
3. **前端展示**：`LayerDetailPanel` 在「类型」下方加「分辨率」行：`mediaWidth && mediaHeight ? \`${mediaWidth}×${mediaHeight}\` : '未知'`；视频节点与「时长」并列。
4. **迁移**：`normalizeCanvasDocument` 已对未知字段宽容，旧节点无此字段时显示「未知」。

风险：需保证 Host 落盘与客户端渲染都处理 undefined；已有 62/72 单测不受影响（纯展示字段）。

---

## F3 提示词按 MiniMax H3 规范优化（支持 BGM/对白 + 多语言）

### 背景（外部调研，2026-08-26）
MiniMax H3（= Hailuo 3.0）是原生带立体声的视频模型，官方提示词规范要点（蒸馏自公开 H3 Prompt Guide，非第三方材料入库）：
- **六段规划法**：Context（开场/参考）→ Timeline（有序动作+结束态）→ Camera（运动/幅度/速度）→ Sound（对白/物理声/环境/音乐分层）→ Constraints（必须稳定项）→ QA（验收项）。
- **镜头时间戳语法**：`MM:SS.mmm–MM:SS.mmm [Shot 描述]`，单 shot 2–5s；4–15s 为故事约束。
- **三层声音字段分离**：`integrated_multimodal_description`（视觉+对白+可见声）、`overall_soundscape`（环境/脚步/风/雨/呼吸）、`non_diegetic_music`（仅观众听到的配乐/BGM）。
- **对白标签**：给每个说话人稳定 ID `(S1)`，对白用 `<d>[Language] … </d>` 包裹；短句后补动作填满时间线。
- **参考角色分工**：人脸/运动/音频/风格各司其职（对应现有 `referenceRole`：image/character/style/frame）。
- **多语言**：对白块 `[Language]` 即语言标记，提示词主体可中/英等。

> 注：Drama Backend 当前端点（`image2videofl2va`/`ref2va`）是否完全透传 H3 音频字段，需在 P8 联调窗口验证（phase2 §8 待确认清单）。但**提示词文本结构本身可以先按 H3 规范生成**，后端越权接受越好；本轮先优化「我们产出什么提示词」，不阻塞。

### 验收标准
- 生成（尤其视频）时，提示词默认按 H3 六段结构组织，显式包含镜头运动、声音三层（含 BGM 与对白占位）；
- 支持多语言：用户用中文/英文描述，提示词主体与对白语言随之；
- skill（或「提示词生成器」）内嵌 H3 规范，且不与现有 creation-spec 五要素澄清冲突。

### 关联文件
- `src/client/.../creation-spec.ts`（skill 提示词规范，已含 H3 蒸馏骨架）
- `src/client/api.ts` `prompt_enhance`（image2promptenhance 入口）
- `src/host-tools.ts` / `src/generate.ts`（实际把 prompt 发给 Drama）

### 修复方案
1. **扩展 skill 规范（creation-spec.ts）**：在现有「五要素澄清」之后，追加 H3 六段 planning pass 与 shot-timestamp 语法模板；明确声音三层与对白 `<d>[Language]` 标签；给出「参考角色一句话分工」模板。保留「一次一问、禁文本列表」纪律。
2. **多语言**：skill 指示「对白块语言跟随用户输入语言；无显式语言时默认中文」；生成器不强行翻译用户素材。
3. **提示词生成器（前端，可选增强）**：在详情面板「修改提示词/Steer」输入旁加「按 H3 规范润色」按钮，调用 `prompt_enhance` 并把返回结构化为六段（视觉/镜头/声音/BGM/对白/约束）回填到输入框，用户可微调再发。
4. **BGM/对白落点**：生成视频时，若用户在对话里点选了「需要配乐/对白」，skill 自动在 prompt 注入 `non_diegetic_music` 与 `<d>` 对白块；后端若暂不支持，行为退化为「文本描述音轨」，不报错。

风险：H3 音频字段后端支持度未知（phase2 §8）；须保留「文本即提示词」的兜底，避免强依赖未验证字段。第三方 H3 原文材料不得入库（handoff 纪律），只蒸馏为自有规范描述。

---

## F4 整理布局按血缘左源右目标分列

### 现象
「整理布局」后节点仍是普通网格（按 `bloodline depth + createdAt` 行优先排），源图层（导入图/视频）与生成目标层左右关系不明显，看不出父子/工作流推进。

### 根因
`src/canvas-view.ts` `computeArrangeLayout` 当前用「行列网格 + 按 depth 升序排序」，depth 0（源）虽排在前但仍混在同一行优先的网格里，父→子不是直观的「左→右」。

### 验收标准
- 源图层（源图/源视频/手动导入，bloodline depth = 0）落在最左列；
- 生成目标层（depth = 1,2,…）依次向右分列；
- 同列内按 createdAt 纵向堆叠；
- 配合已有 `CanvasEdges` 血缘边，能直观看出「左父 → 右子」的工作流推进。

### 关联文件
- `src/canvas-view.ts` `computeArrangeLayout`（纯函数，单测 `canvas-view.test.mjs` 已覆盖「无重叠网格/组随行」）
- `src/client/canvas/CanvasSurface.tsx`（调用自动整理后适配视野）

### 修复方案
1. **改列布局**：`computeArrangeLayout` 重写——以 `bloodline depth`（源 depth 0）作为**列号**：`x = ORIGIN + depth * (cellWidth + 列间距)`，`y = ORIGIN + indexInColumn * (cellHeight + 行间距)`。同列内按 `createdAt` 排序。深度越深越靠右。
2. **组随行**：组节点与其子节点同列（组取自身 depth；子节点随组 y 偏移），保持「组盒子包住成员」的不重叠约束。
3. **无血缘的孤立节点**：depth 0 → 最左列；手动导入素材天然在左。
4. **单测补强**：在 `canvas-view.test.mjs` 增加断言「源节点 x < 目标节点 x」「同 depth 节点同列、按 createdAt 纵向排」。

风险：列宽需足够大以容纳最大单元（沿用现有 `cellWidth = max(width)+gap`），避免跨列重叠；与 F1 的「成片落点」协同——成片 depth = 源 clip depth + 1，自然落在最右列。

---

## F5 参考图交互重构（独立托盘 + 右键引用 + 光标插入）

### 现象
- 参考图列表（`ReferenceTray`）目前嵌在左侧「项目列表」区域（`<aside className="csProjects">` 内），项目变多后被挤出看不到；
- 引用流程需用户复制 `@ref[...]` 再手动粘贴到对话框，不直观。

### 根因
`ReferenceTray` 在 `StudioFrame.tsx` 里渲染于左栏项目列表之下；`handleReferenceToChat` 仅 `navigator.clipboard.writeText` + `window.alert`。

### 验收标准
- 参考图有**独立、不与项目列表争空间**的展示区（画布内的浮层/独立面板，可开关）；
- 画布节点（尤其参考图/素材）**右键菜单**有「引用到对话」；
- 点击后引用标记**直接插入对话输入框光标处**（而非仅复制），失败才回退复制+提示。

### 关联文件
- `src/client/canvas/ReferenceTray.tsx`（结构 + 渲染位置）
- `src/client/StudioFrame.tsx`（`<aside className="csProjects">` 内嵌 ReferenceTray；`handleReferenceToChat`）
- `src/client/canvas/CanvasContextMenu.tsx`（右键菜单项）
- `src/reference-token.ts` `formatRefToken(title)`
- 上游对话 `conversation` slot 的输入框 DOM（光标插入目标，需实现期定位 selector）

### 修复方案
1. **独立托盘**：把 `ReferenceTray` 从左侧栏移出，改为**画布区域内的浮层**（如左上角可折叠面板，与「图层列表在画布右上角浮窗」同源模式），由 `StudioFrame` 渲染于 `<main className="csCanvas">` 内、`<CanvasToolbar>` 旁或固定角；开关状态本地记忆。不再与项目列表抢空间。
2. **右键「引用到对话」**：在 `CanvasContextMenu` 增加菜单项（对任何有 `filename` 或 `isReference` 的节点可见），调用新的 `insertReferenceToChat(node)`。
3. **光标处插入（核心）**：实现 `insertReferenceToChat`：
   - 尝试定位对话输入框：在 `conversation` slot 容器内 `querySelector('textarea, [contenteditable="true"], input[type="text"]')`（实现期据上游 InputBar 实际结构校正 selector）；
   - 若找到：在 `selectionStart` 处 `setRangeText(formatRefToken(title))`，派发 `input` 事件，聚焦并恢复光标到插入末尾；
   - 若未找到（上游结构变更/无焦点）：回退 `clipboard.writeText` + `alert('已复制引用标记，请粘贴到对话框')`，保持现有可用路径。
4. **ReferenceTray 内按钮同步**：其「引用到对话」也改用同一 `insertReferenceToChat`，统一行为。

风险：上游 InputBar 是外部结构，光标插入依赖 DOM selector 的健壮性（handoff §4.1③ 已记录此为限制）。务必保留 clipboard+alert 回退，确保功能不回归。实现期先打印/核对上游输入框真实 selector。

---

## F6 图层连线加粗

### 现象
画布血缘边（`CanvasEdges`）线条偏细，不易辨认操作类型与走向。

### 根因
`src/client/canvas/CanvasEdges.tsx` 线宽固定：`strokeWidth={highlighted ? 3 : 2}`，箭头 `markerWidth="6"`。

### 验收标准
连线明显加粗且仍可读；选中/高亮态区分清晰；不遮挡节点。

### 关联文件
- `src/client/canvas/CanvasEdges.tsx`（第 107/120/149/161 行附近）

### 修复方案
1. 基础线宽 `2 → 3.5`，高亮 `3 → 5`；箭头 `markerWidth 6 → 9`（保持箭头/线宽比例，避免箭头显得过小）。
2. 可选：线宽随 `view.scale` 轻微缩放（zoom out 时略增），提升小图可读性；首版先做固定加粗，后续按需。
3. 颜色沿用按操作类型着色的既有逻辑（S2），只调宽度/箭头尺寸，不改配色语义。

风险：极低，纯展示；注意高 DPI 下 3.5px 仍清晰即可。

---

## 1. 实施建议顺序（与现有阶段衔接）
1. **F6**（最小风险，先落地，即时可见改善）→ **F1**（修复导出可见性，闭环验收关键缺陷）→ **F2**（详情分辨率，纯展示增强）→ **F4**（整理布局血缘分列）→ **F5**（参考交互重构，涉及上游 DOM 风险，需实现期核对 selector）→ **F3**（提示词 H3 规范，依赖后端联调窗口，可并行 skill 侧改造）。

## 2. 文档纪律
每项修复合并提交时，回写本表状态（⬜→✅）并同步 `handoff.md` §9 已提交记录与 `phase2.md` §11/§12；只 `git add canvas-studio docs`。
