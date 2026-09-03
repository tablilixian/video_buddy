# 04 · 画布渲染模块审查

> 覆盖：`canvas/CanvasSurface.tsx` / `CanvasNode.tsx` / `CanvasEdges.tsx` / `CanvasTimeline.tsx` / `Minimap.tsx` / `CanvasToolbar.tsx` / `CanvasContextMenu.tsx` / `CanvasBlankMenu.tsx` / `LayerDetailPanel.tsx` / `LayerPanel.tsx` / `ReferenceTray.tsx` / `ImagePreviewModal.tsx` / `VideoPlayerModal.tsx` / `canvas-math.ts` / `labels.ts` / `styles.ts`
> 条目：CR-059 ~ CR-081。状态总表见 [README.md](./README.md#3-状态总表修复台账)。

---

## 高危

### CR-059｜[高] `CanvasEdges` 的 SVG marker `cs-arrow-import` 定义两次（id 冲突）
- **位置**：[CanvasEdges.tsx#L136-L160](../src/client/canvas/CanvasEdges.tsx#L136-L160)
- **问题（是什么）**：`operationTypes` 集合里 `import` 是合法 `operationType`（`addBriefNode`/`addVideoStyleNodes` 均写 `operationType:'import'`），会进入 `[...operationTypes]` 循环生成 `id="cs-arrow-import"`（`#L136-149`）；随后 `#L150-160` 又显式硬编码一个同名 marker。
- **影响**：同一 `<svg>` 内两个相同 `id` 的非法 DOM；当前因两处填充色同为 `#6b7280` 才未显形，一旦某天颜色漂移即箭头错位。
- **解决方案**：删除 `#L150-160` 的显式重复 marker（`import` 由循环统一覆盖），或循环时过滤 `operation === 'import'` 保留显式版。
- **验收方式**：检查渲染后的 `<svg><defs>` 内 `id="cs-arrow-import"` 只出现一次。
- **状态**：✅ **已修复·待验收**（2026-09-02）——`import` 改为**常驻 marker 集合**（[CanvasEdges.tsx#L65-L71](../src/client/canvas/CanvasEdges.tsx#L65-L71)，兼容无 operationType 节点回落 import 的引用），删除显式重复 `<marker>`（[#L148-L154](../src/client/canvas/CanvasEdges.tsx#L148-L154)）。`id="cs-arrow-import"` 恒只生成一次。

### CR-060｜[高] `CanvasSurface` 注释宣称 pointer capture，实际从未 `setPointerCapture`
- **位置**：[CanvasSurface.tsx#L363-L364](../src/client/canvas/CanvasSurface.tsx#L363-L364)、`onPointerMove`#L448-L457、`onPointerUp`#L539-L578
- **问题（是什么）**：注释写「指针捕获保证拖出容器也能收到 pointerup」，但全文件检索不到任何 `setPointerCapture`/`releasePointerCapture`。`onPointerDown` 只写 `gesture.current`，未对 `containerRef` 捕获。
- **影响**：拖拽/框选移出 `.csCanvasSurface` 边界后浏览器不再派发 `pointermove/pointerup`；`onPointerLeave`（#L602-613）以伪造 `MouseEvent('pointerup')` 提前结束手势 →「拖到一半松手卡住 / 提前落定」；框选到隔壁面板直接取消。
- **解决方案**：落地手势后对 `containerRef.current.setPointerCapture(event.pointerId)`，`onPointerUp` 里 `releasePointerCapture`。
- **验收方式**：拖节点拖到画布边界外再松手，节点应落定到逻辑位置而非提前归位；框选跨出到面板再拖回应连续。
- **状态**：✅ **已修复·待验收**（2026-09-02）——新增 `capturePointer/releasePointer` 助手（[CanvasSurface.tsx#L179-L191](../src/client/canvas/CanvasSurface.tsx#L179-L191)，`try/catch` 兜底 DOMException、`delete` 兼容 `exactOptionalPropertyTypes`），在 **pan / node / resize / link** 四个手势起点 `setPointerCapture`、`onPointerUp` 统一释放；`Gesture` 增 `pointerId` 字段。**marquee 刻意不加 capture**——CV-008 约定「拖出容器即取消框选（避免误选）」，与节点拖拽「跟手出界」语义不同，保持原行为。

---

## 中危

### CR-061｜[中] 单击选中也 push 历史 + 触发持久化（undo 快照膨胀）
- **位置**：[CanvasSurface.tsx#L394](../src/client/canvas/CanvasSurface.tsx#L394)（`onNodePointerDown` 无条件 `onBeginEdit`）、`#L574`（`onPointerUp` 对 node/resize 无条件 `onPersist`）
- **问题（是什么）**：单击选中（无位移）既 push 历史又写盘，每次点击产生一条无变化 undo 条目并触发持久化。
- **影响**：`pushHistory` 有 20 条上限，很快挤掉真实编辑历史；高频点击伴随高频写盘。
- **解决方案**：在 `onPointerUp` 判断是否产生位移（对比 `startX/Y` 与最终坐标）再决定 `onBeginEdit`/`onPersist`。
- **验收方式**：连续单击多个节点，undo 栈内不应堆积纯选中快照。
- **状态**：✅ **已修复·待验收**（2026-09-03）——[CanvasSurface.tsx](../src/client/canvas/CanvasSurface.tsx)：Gesture 增 `editBegun` 标志 + `beginEditOnce` 助手（首帧实际 move/resize 时才 `onBeginEdit`，[#L195-L201](../src/client/canvas/CanvasSurface.tsx#L195-L201)），`onPointerDown` 不再无条件推历史；`onPointerUp` 仅 `editBegun === true` 才 `onPersist`（[#L610-L612](../src/client/canvas/CanvasSurface.tsx#L610-L612)）。

### CR-062｜[中] 方向键连发每次 `onPersist()` 写盘，无节流
- **位置**：[CanvasSurface.tsx#L286-L296](../src/client/canvas/CanvasSurface.tsx#L286-L296)
- **问题（是什么）**：快速连按方向键时仅 `onBeginEdit` 受 800ms 保护，但**每次按键都无条件 `onPersist`**（全量序列化写盘）。
- **影响**：1px 微调连发可达每秒多次全量写盘，属无收益高频 IO。
- **解决方案**：按 `lastNudgeAtRef` 窗口对中间帧只持久化一次。
- **验收方式**：长按方向键，观察持久化调用次数明显下降且最终状态正确。
- **状态**：✅ **已修复·待验收**（2026-09-03）——[CanvasSurface.tsx#L312-L341](../src/client/canvas/CanvasSurface.tsx#L312-L341)：nudge 走 300ms 去抖（`nudgePersistTimerRef`），一次连发只写一次盘；keydown effect 卸载时清 timer。

### CR-063｜[中] 拖拽逐帧整棵 surface（所有节点+边）全量重渲染
- **位置**：[CanvasSurface.tsx#L580-L656](../src/client/canvas/CanvasSurface.tsx#L580-L656)、`#L623`（CanvasEdges）
- **问题（是什么）**：`onMoveNode` 逐帧更新 store → 整 surface 重渲染；`CanvasNode`/`CanvasEdges` 均未 `memo`，`CanvasEdges` 每帧重建 `byId Map` 与全部路径，`ordered` 每帧 `filter+sort`。
- **影响**：节点数量多时拖拽帧率显著下降（大画布主要卡顿源）。
- **解决方案**：对 `CanvasNode`/`CanvasEdges` 用 `React.memo`（配合 stable 回调用 useCallback）；`ordered`/边重算用 `useMemo`。
- **验收方式**：大画布多选拖拽，性能面板确认非位移节点/边不重渲染，帧率改善。
- **状态**：✅ **已修复·待验收**（2026-09-03）——`CanvasNode`/`CanvasEdges` 均 `React.memo`（store `moveNode` 用 `existing.map` 只给被移动节点及其子节点新引用，未变节点引用稳定 → memo 生效）；`visibleNodes`/`ordered` useMemo（[CanvasSurface.tsx#L633-L636](../src/client/canvas/CanvasSurface.tsx#L633-L636)）；配合 CR-041 的 StudioFrame 回调 useCallback 稳定化，拖拽时未移动节点不再重渲染。

### CR-066｜[中] 每个 loading 节点独立 1s `setInterval`，批量生成 N 个定时器
- **位置**：[CanvasNode.tsx#L91-L97](../src/client/canvas/CanvasNode.tsx#L91-L97)
- **问题（是什么）**：`now` 状态每个 loading 节点单独 `setInterval`，每秒触发该节点重渲染。
- **影响**：多个生成中节点 = N 个定时器 + N 次每秒渲染。
- **解决方案**：单一全局 ticker（放 store 或共享 hook），或仅跨度变化时更新。
- **验收方式**：同时多个 loading 节点，检查定时器数量 / 渲染次数收敛为少而稳。
- **状态**：✅ **已修复·待验收**（2026-09-03）——[CanvasNode.tsx#L25-L46](../src/client/canvas/CanvasNode.tsx#L25-L46) 新增模块级**共享 `loadingTicker`**（订阅集合 + 监听器归零自动停表）；loading 节点 effect 改 `loadingTicker.subscribe(() => setNow(Date.now()))`（[#L113-L120](../src/client/canvas/CanvasNode.tsx#L113-L120)），不再每节点一个 setInterval。

### CR-071｜[中] Minimap 命中/跳转 fallback 用 `window` 尺寸，与实测尺寸首帧不一致
- **位置**：[Minimap.tsx#L72-L73](../src/client/canvas/Minimap.tsx#L72-L73)、`#L100-L105`、`#L82-L85`
- **问题（是什么）**：视口未测量（`surfaceSize.width===0`）时回退 `window.innerWidth/Height`（`vw/vh`）；`jumpTo` 与视口框在同一渲染使用这组回退，一旦实测尺寸就绪结论不一致。
- **影响**：极小概率首帧点击跳转偏移。
- **解决方案**：`jumpTo` 统一取 `containerRef` 实测值，不依赖已捕获的 `vw/vh`。
- **验收方式**：首帧立即点击小地图跳转，位置与后续稳定态一致。
- **状态**：✅ **已修复·待验收**（2026-09-03）——[Minimap.tsx#L71-L91](../src/client/canvas/Minimap.tsx#L71-L91) 新增 `sizeRef` 恒持最新实测尺寸，`jumpTo` 从 `sizeRef.current` 读取（不再闭包渲染期捕获的 `vw/vh`，且移除 `vw/vh` 依赖使回调稳定）。

### CR-081｜[中] 节点用 `left/top` 布局不走合成层，拖拽重绘开销大
- **位置**：[styles.ts#L857-L858](../src/client/styles.ts#L857-L858)
- **问题（是什么）**：节点用 `left/top` 定位；`will-change:transform` 已加（#L812-839）但节点位移走布局/重绘而非合成 transform。
- **影响**：与 CR-063 叠加，是拖拽不流畅的最大来源之一——即便节点 memo 化，仍每帧走布局/重绘。
- **解决方案**：每节点上加 `will-change: transform` + 用 `translate3d(px,px,0)` 位移（配合绝对 left/top 锚定 + transform 偏移）。
- **验收方式**：大画布拖拽时 DevTools 确认节点位移走合成层（无 layout 闪动），帧率改善。
- **状态**：✅ **已修复·待验收**（2026-09-03）——[CanvasNode.tsx#L278-L288](../src/client/canvas/CanvasNode.tsx#L278-L288) 节点 `style` 改 `left:0/top:0 + translate3d(x,y,0)`（位移走合成层）；[styles.ts#L857-L861](../src/client/styles.ts#L857-L861) `.csNode` 加 `will-change: transform`。

---

## 低危清单

| ID | 位置 | 问题 | 解决方案 |
| --- | --- | --- | --- |
| CR-064 | [CanvasSurface.tsx#L611](../src/client/canvas/CanvasSurface.tsx#L611) | `onPointerLeave` 伪造 `MouseEvent('pointerup')`（screen 恒 0,0），link 模式语义上把「离开」当「在 (0,0) 松手」 | link 模式在离开时直接取消连接线而非伪造 pointerup |
| CR-065 | [CanvasSurface.tsx#L204-L206](../src/client/canvas/CanvasSurface.tsx#L204-L206)、#L459-464 | 视口平移每 pan 帧调 `onViewChangeRef`，若 frame 侧每次持久化则高频写盘 | 与 nudge 相同接 store 侧去抖 |
| CR-067 | [CanvasNode.tsx#L103-L104](../src/client/canvas/CanvasNode.tsx#L103-L104) | `prefersReducedMotion` 每次渲染查一次 `matchMedia` | `useMemo` 或模块级常量缓存 |
| CR-068 | [CanvasNode.tsx#L119-L136](../src/client/canvas/CanvasNode.tsx#L119-L136) | `canHoverPreview` 翻假时已排的 hover `setTimeout` 未清理，可能意外播放 | 渲染 effect 里对 `!canHoverPreview` 调 `stopHoverPreview()` |
| CR-069 | [CanvasTimeline.tsx#L101-L111](../src/client/canvas/CanvasTimeline.tsx#L101-L111) | 时间轴缩略图 img/video 无 `onError` 兜底，URL 失效显示破碎 | 加媒体加载失败兜底 |
| CR-070 | [CanvasTimeline.tsx#L88-L92](../src/client/canvas/CanvasTimeline.tsx#L88-L92) | `onDragOver` 高频 `setHoverIndex`，悬停高亮跳动 | `index !== hoverIndex` 才 set |
| CR-072 | [CanvasContextMenu.tsx#L56](../src/client/canvas/CanvasContextMenu.tsx#L56)、[CanvasBlankMenu.tsx#L44](../src/client/canvas/CanvasBlankMenu.tsx#L44) | 菜单定位无边缘钳制，靠近视口右/下会溢出被裁剪 | 加 viewport 反向适配 |
| CR-073 | [LayerDetailPanel.tsx#L98-L104](../src/client/canvas/LayerDetailPanel.tsx#L98-L104) | `copyPrompt` 的 `setTimeout(1500)` 未清理，卸载后仍 setState | 用 ref 挂 timer 并在卸载清理 |
| CR-074 | [LayerDetailPanel.tsx#L316-L323](../src/client/canvas/LayerDetailPanel.tsx#L316-L323) | 参考缩略 `src={ref.url ?? ''}` 无兜底，url 缺失渲染破图 | `ref.url !== undefined` 才渲染 |
| CR-075 | [LayerDetailPanel.tsx#L279](../src/client/canvas/LayerDetailPanel.tsx#L279) | 参考角色用 `as 'image'\|'character'\|…` 收窄 select 值 | 维护 `REFERENCE_ROLES` 数组 + 类型守卫 |
| CR-076 | [canvas-math.ts](../src/client/canvas/canvas-math.ts) | `calculateSnap` 多节点命中同轴时重复 push 相同 position → 渲染层用 position 作 key 冲突 | 在计算内按 position 去重 |
| CR-077 | labels.ts / [ReferenceTray.tsx](../src/client/canvas/ReferenceTray.tsx) / LayerDetailPanel | 「参考角色中文名」在 labels.ts、ReferenceTray、LayerDetailPanel 各写一份，已轻微漂移 | 统一到 labels.ts 单一来源 |
| CR-078 | [CanvasEdges.tsx#L65](../src/client/canvas/CanvasEdges.tsx#L65) | `filter(Boolean)` 后用 `as` 硬收窄类型 | 改用类型谓词 `filter((t): t is …)` |
| CR-079 | [styles.ts](../src/client/styles.ts) | 单文件 3505 行 / 单个大模板字符串内联注入，无法按功能懒加载、一改动整段重注入 | 按功能拆成 `styles/` 多注入块 + tagged 共享 |
| CR-080 | [styles.ts#L3442](../src/client/styles.ts#L3442)、#L3423 | `color-mix()`/`rgb(... / n)` 等较新语法对旧引擎无 fallback | 关键处加 solid fallback；确认宿主引擎支持范围 |

---

## 其它核实结论（有意设计，勿重复排查）
- `CanvasTimeline`/`LayerPanel` 各自再渲染媒体元素，属展示层取舍，非缺陷。
- `VideoPlayerModal`/`ImagePreviewModal`/`LayerPanel` 的无 `onError` 兜底与 CR-069 同类，可批量顺带。
- `CanvasToolbar` 大量按钮被 `TOOLBAR_VISIBILITY=false` 关闭但仍保留 props/接线，属**有意的功能降级**（注释已声明「保留接线」）；无恢复计划可减负，不单独立项。