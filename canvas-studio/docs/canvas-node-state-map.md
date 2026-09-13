# 画布节点的「选中 / 拖动 / 压暗 / 恢复 / 取消选中」代码地图

> 行号为 **CV-169（2026-09-13）** 时刻的快照，随文件演进会漂移；符号名不会。
> 目的：把这五个行为涉及的**每一处代码**摊开，并说明它们如何互相覆盖。
> 结论先行：节点外观由**三层**决定，三层按 CSS 层叠互相覆盖 —— 之前「状态乱」的根因
> 全部落在这三层的**优先级**上，不在任何单条逻辑里。

---

## 0. 三层模型（读下面任何一段之前先记住这张表）

| 层 | 来源 | 载体 | 谁写 |
|---|---|---|---|
| **数据层** | `node.opacity` | inline `--cs-node-opacity` | `CanvasNode.tsx:477` |
| **状态层** | 类名（选中 / 锁定 / 失效 / 加载 / 错误 / 成片 / 主拖） | `className` 数组 | `CanvasNode.tsx:443-463` || **交互层** | `:hover` / `:active` 伪类 | styles.ts 规则 | 浏览器 |

合成出口**只有一条**：

```css
/* styles.ts:1361（.csNode 内） */
opacity: calc(var(--cs-node-opacity, 1) * var(--cs-node-state, 1) * var(--cs-node-dim, 1));
```

- `--cs-node-opacity` 默认 1（brand.ts:150）— 数据层
- `--cs-node-state` 默认 1，`.csNodeLocked` 写 0.75（styles.ts:2325）、`.csNodeRetired` 写 0.45（styles.ts:2780）— 状态层
- `--cs-node-dim` 默认 1（brand.ts:152），`.csNodeDimmed` 写 `var(--cs-dim, 0.42)`（styles.ts:1510）— 血缘层
- `--cs-dim: 0.42`（brand.ts:143）**明暗同值**，非配色令牌

**边框 / 光晕的层叠优先级（这才是 bug 的产地）：**

| 规则 | 位置 | 特异度 | 声明 |
|---|---|---|---|
| `.csNode` | 1325 | (0,1,0) | `border-color: var(--cs-line)`、`box-shadow: var(--cs-shadow-1)` |
| `.csNodeFilm` | 1423 | (0,1,0) | `border-color: teal38%` |
| `.csNodeSelected` | 1499 | (0,1,0) | `border-color: var(--cs-accent)`、`box-shadow: var(--cs-glow-accent)` |
| `.csNodePrimary.csNodeSelected` | 1446 | (0,2,0) | `z-index: 3`、2px 实色环 + 光晕 |
| `.csNode:hover` | 1398/1402 | (0,2,0) | 面 + 描边（现加 `:not(.csNodeSelected)`） |
| `.csNodeFilm:hover` | 1429 | (0,2,0) | 描边（现加 `:not(.csNodeSelected)`） |
| `.csNode:active` | 1412/1416 | (0,2,0) | 光标 + 投影（现加 `:not(.csNodeSelected)`） |

> ⚠️ **铁律**：选中态是 (0,1,0)，任何伪类规则都是 (0,2,0)。也就是说
> **伪类天然打赢选中态** —— 只要伪类规则里写了 `border-color` / `box-shadow`，
> 就会在悬停/按住时把选中外观顶掉。守卫见
> `tests/visual-tokens.test.mjs` 的「选中态不可被交互态覆盖」。

---

## ① 选中（selection）

### 1.1 写入点全集（唯一数据源：`project-store.ts`）

| 位置 | 动作 | 选区结果 | 触发者 |
|---|---|---|---|
| `project-store.ts:473-484` | `selectNode(id, multi)` | `multi=true` → 切换 roster；否则 `[id]` / `[]` | 画布点击、面板点击（**主路径**） |
| `project-store.ts:498-504` | `selectNodes(ids)` | 过滤存活节点后**整体替换** | 图层面板类型选择 / 反选 / 清除、阶段轨道 |
| `project-store.ts:485-490` | `selectAllNodes()` | 全部节点 | Ctrl/Cmd+A |
| `project-store.ts:397-398` | `select(projectId)` | `[]` | 切项目 |
| `project-store.ts:383-384` | `setLoaded()` | `[]`（项目消失时） | 项目列表刷新 |
| `project-store.ts:553-556` | `removeNodes()` | 剔除被删 id | Delete / 右键删除 |
| `project-store.ts:611` | `pasteSelected()` | `= pasted` | Ctrl/Cmd+V |
| `project-store.ts:749` | `groupSelected()` | `[group.id]` | 打组 |
| `project-store.ts:768` | `ungroup()` | 剔除组 id | 解组 |
| `project-store.ts:819` | `addNode()` | `[node.id]` | 右键新建 |
| `project-store.ts:884` | `addImportNode(..., select)` | `[node.id]` **仅当 `select !== false`** | 工具条导入 / 聊天旁路（CV-168 传 false） |
| `project-store.ts:947` | `addVideoStyleNodes()` | `[stickyNode.id]` | 上传参考视频 |
| `project-store.ts:979` | `addComposedVideo()` | `[node.id]` | 手动合成 |
| `project-store.ts:1008` | `clearProject()` | `[]` | 清空项目 |

**读出口（两个，口径不同，别混用）：**
- `selectedNodeOf()`（291）→ **仅当恰好 1 个**选中时返回该节点（详情面板用）
- `selectedNodesOf()`（297）→ roster 过滤存活节点后按渲染序返回（批量操作用）

### 1.2 画布侧的选中决策（全部在这一段里）

```ts
// CanvasSurface.tsx:447
const onNodePointerDown = (event, node) => {
  // (A) 带修饰键 = 纯选区修饰（toggle），不起拖拽手势
  if (event.ctrlKey || event.metaKey) { onSelectNode(node.id, true); return }

  const inRoster = selectedNodeIds.includes(node.id)
  const roster   = inRoster ? selectedNodeIds : [node.id]   // 拖拽成员集合
  const memberClick = inRoster && selectedNodeIds.length > 1

  // (B) 点中多选区成员 → 先不塌缩（Figma 语义），塌缩交给 pointerup
  if (!memberClick) onSelectNode(node.id)

  if (node.locked) { if (memberClick) onSelectNode(node.id); return }  // (C) 锁定节点就地塌缩

  gesture.current = { mode: 'node', nodeId: node.id, origins, collapseOnClick: memberClick }
  setPrimaryDragId(node.id)   // (D) → csNodePrimary（2px 环 + z-index 3）
}

// CanvasSurface.tsx:432
const onSurfacePointerDown = (event) => {
  if (event.button === 1 || event.button === 0) {
    if (event.button === 0 && !(event.ctrlKey || event.metaKey)) onSelectNode(null)  // (E) 按下即清选（439）
    gesture.current = { mode: 'pan', ... }
  }
}

// CanvasSurface.tsx:631  onPointerUp
if (current.mode === 'node' && current.collapseOnClick === true
  && current.editBegun !== true && current.nodeId !== undefined) {
  onSelectNode(current.nodeId)   // (F) 原地点击成员 → 塌缩为单选
}
```

### 1.3 UI 侧的转发（StudioFrame 是唯一接线板）

| 行 | 接线 | 说明 |
|---|---|---|
| `StudioFrame.tsx:695` | `onSelectNode={(id, multi) => actions.selectNode(id, multi)}` | → 画布 |
| `StudioFrame.tsx:697` | `onSelectAllNodes` | Ctrl+A |
| `StudioFrame.tsx:707` | `onSelectIds={ids => actions.selectNodes(ids)}` | → 图层面板按类型选择 |
| `StudioFrame.tsx:862` | `onSelect={(id, multi) => actions.selectNode(id, multi)}` | → 图层面板行点击 |
| `StudioFrame.tsx:729/733/737` | 菜单项 | 选中后再执行 |
| `StudioFrame.tsx:542` | 打开详情 | `actions.selectNode(id)` |

图层面板自己**不做选中判定**，只把选区当集合用：`LayerPanel.tsx:42-45`

```ts
const selected = new Set(selectedNodeIds)
```
→ 面板与画布**同源**（都吃 `selectedNodeIds`），不存在「一边亮一边不亮」的口径分歧。

---

## ② 拖动（drag）

### 2.1 手势状态机（`Gesture`，CanvasSurface.tsx:28-54）

```
none ──pointerdown(空白)──→ pan ──move──→ 平移 view
     ──pointerdown(节点)──→ node ──>3px──→ 改 node.x/y（+ snap 辅助线）
     ──pointerdown(把手)──→ resize ─>3px──→ 改 x/y/w/h
     ──pointerdown(连接点)─→ link ──move──→ 起草线 → 落点连线
                             ↓ pointerup / pointercancel / pointerleave
                            none（收口，见 ④）
```

守护常量与工具（逐一说明为什么存在）：

| 符号 | 位置 | 作用 |
|---|---|---|
| `DRAG_THRESHOLD = 3` | 17 | 屏幕像素阈值。未越过 = 点击：不移动、**不 setPointerCapture**、不入 undo |
| `armPointer` | 210 | 只记 pointerId，**不捕获** |
| `ensureCaptured` | 214 | 首次真正移动才 `setPointerCapture` |
| `releasePointer` | 220 | try/catch 释放（无效 id 会抛） |
| `exceededThreshold` | 228 | 唯一阈值判定 |
| `beginEditOnce` | 233 | 首帧 move 才 `onBeginEdit()`（undo 快照，防空快照） |
| `origins` | 41 | 多选拖拽各节点起始坐标（已剔除组内成员防双重位移） |
| `collapseOnClick` | 46 | 见 ①(F) |

> 为什么阈值 + 延迟捕获必须一起：Pointer Events 规范里，捕获生效期间派发的
> mousedown/mouseup 会被 retarget 到捕获元素，而 `click`/`dblclick` 的 target 由这两者决定 ——
> 一旦在 pointerdown 就捕获，**节点上的双击永远收不到**（CV-071 的「双击视频不弹浮层」）。

### 2.2 移动分支（`onPointerMove`，539-629）```
544  pointerType==='mouse' && buttons===0 → onPointerUp（按钮在画布外松开，收口）
550  pan:      ensureCaptured → panBy(增量) → 刷新 startX/startY
557  node:     561 未过阈值 return → ensureCaptured → beginEditOnce
              ├─ origins.length > 1 → 以主节点算 snap，校正量均摊给全队
              └─ 单节点 → calculateSnap → onMoveNode
596  resize:   600 未过阈值 return → beginEditOnce → 按 corner 改 x/y/w/h（MIN_NODE_SIZE=50）
624  link:     screenToWorld → setLinkLine
```

### 2.3 store 侧位移（`project-store.ts:505`）

```ts
moveNode(draft, projectId, id, x, y) {
  const node = existing.find(c => c.id === id)
  const deltaX = x - node.x, deltaY = y - node.y
  // 自己位移 + **按 parentId 带动子节点同量位移**（组内成员不再单独算，避免双重位移）
  existing.map(c => c.id === id ? {...c, x, y}
    : c.parentId === id ? {...c, x: c.x + deltaX, y: c.y + deltaY} : c)
}
```

### 2.4 渲染层（`CanvasNode.tsx`）

```tsx
// 474  位移只走 transform（合成层），不用 left/top 逐帧改布局
transform: `translate3d(${node.x}px, ${node.y}px, 0)`
'--cs-node-opacity': opacity     // 477  数据层唯一出口
```

**⚠️ 渲染层级坑（CV-165 已修，务必保持）**：节点定位是 inline `transform`，
而 CSS 动画（含 `fill: both` 的 `to` 帧）层叠优先级**高于** inline style。
`csDevelopIn` 因此只准动独立的 `scale` 属性（styles.ts:1378），
写 `transform` 会把所有节点永久锁死在画布原点。

---

## ③ 压暗（dim / 血缘聚光）

数据流只有一条，判定只有一份实现：

```
selectedNodeIds ──┐
                  ├→ canvasSpotlight(visibleNodes, selected)   [canvas-lineage.ts:39]
visibleNodes ─────┘        ↓ { active, lit }
                  CanvasSurface.tsx:670-672  useMemo
                           ↓ dimmed = spotlight.active && !spotlight.lit.has(node.id)
                  CanvasNode.tsx:458  dimmed && !selected → 'csNodeDimmed'
                           ↓
                  styles.ts:1510  .csNodeDimmed { --cs-node-dim: var(--cs-dim, 0.42) }
                           ↓
                  styles.ts:1361  opacity = 数据层 × 状态层 × 血缘层
```

判定口径（`canvas-lineage.ts:39-62`，纯函数、可单测）：

```ts
if (selected.size === 0) return { active: false, lit }       // 没选中 → 不压暗
for (const node of nodes) {
  if (selected.has(node.id)) { for (const s of node.sourceIds) lit.add(s); continue }  // 上游
  if (node.sourceIds.some(s => selected.has(s))) lit.add(node.id)                      // 下游
}
return { active: lit.size > selected.size, lit }   // 一跳血缘为空 → 不压暗
```

**三条必须记住的推论：**

1. **压暗由「选中了谁」决定，与拖动无关** —— 拖动过程中不额外压暗任何节点
   （styles.ts:1485 明确记录：曾挂在 `[data-dragging]` 上，会把整屏压暗，已删除）。
2. **选中孤立节点（无血缘）不压暗**。所以「有时候蒙一层灰、有时候不蒙」不是随机，
   而是取决于**该节点在 `sourceIds` 图上是否有一跳邻居**。
3. **压暗不会因松手而恢复** —— 它是选中态的派生量。要恢复只有三条路：清选
   （点空白 / Esc）、改选到别的节点、把该节点接上血缘。

> 视觉表现：浅色主题画布 `#EFEFF4`，压暗的深色画面朝它退色 → **蓝灰**。
> 这就是「蒙上一层蓝」的真实来源，不是半透明蒙层（`--cs-dim` 是 opacity 乘数）。

---

## ④ 恢复（收口）— 每条路径都必须复位同一批状态

**需要复位的状态**：`gesture.current`、`primaryDragId`（→ `csNodePrimary` 2px 环）、
`guides`（辅助线）、`linkLine`（起草线）、pointer capture，以及位移手势的落盘。

| 收口路径 | 位置 | 做了什么 |
|---|---|---|
| 正常松开 | `onPointerUp` 631-658 | 塌缩判定 → link 落点 → `onPersist` → 清 guides → **清 primaryDragId** → releasePointer → gesture 归零 |
| 指针移出画布 | `onPointerLeave` 709-721 | link 直接取消（伪造坐标会误连）；其余模式走 `onPointerUp` |
| 按钮在画布外松开 | `onPointerMove` 532-535 | 检测 `buttons === 0` → 走 `onPointerUp` |
| **系统夺走指针** | `onPointerCancel` 700-708 | **CV-169 新增**：见下 |

```ts
// CanvasSurface.tsx:700（CV-169 补的缺口）
onPointerCancel={() => {
  const current = gesture.current
  if (current.mode === 'link') setLinkLine(null)
  if ((current.mode === 'node' || current.mode === 'resize') && current.editBegun === true) onPersist()
  setGuides({ vertical: [], horizontal: [] })
  setPrimaryDragId(null)
  releasePointer()
  gesture.current = { mode: 'none', startX: 0, startY: 0 }
}}
```

**为什么必须补**：指针被系统夺走时（触控手势接管、拖拽中又按右键、起手元素被移除）
浏览器**只发 `pointercancel`，不会再补 `pointerup`**。改前没有这条分支，手势永远停在
`'node'`/`'resize'`：`primaryDragId` 不清（那张卡一直挂着加粗"主选中"环）、光标停在
grabbing、后续 `pointermove` 继续按上个手势改坐标 —— 用户视角即
**「鼠标松开了，画面没有恢复」**。探针断言 11a–11e 覆盖（合成事件补测，真实输入造不出 pointercancel）。

**交互层也要能恢复（CV-169 修的第三类）**：`:hover` / `:active` 在指针移开/松开时
由浏览器自动摘除 —— 但改前它们**在按住期间会覆盖选中态**，于是"恢复"看起来是
「松手后选中态才回来」，而那一下的丢失本身就是 bug。见 ⑥ 的 D1/D2。

---

## ⑤ 取消选中（deselect）

| 路径 | 位置 | 语义 |
|---|---|---|
| 点画布空白 | `CanvasSurface.tsx:439` | **按下即清**（`button===0` 且无 Ctrl/Cmd） |
| Esc | `CanvasSurface.tsx:345` | `onSelectNode(null)` |
| Delete / Backspace | `CanvasSurface.tsx:341` | 先删除，store 再从 roster 剔除（553-556） |
| 点中多选区成员并原地松开 | `CanvasSurface.tsx:472 + 635` | 塌缩为单选该节点 |
| 锁定节点被点 | `CanvasSurface.tsx:473` | 就地塌缩（没有 pointerup 可依赖） |
| 切项目 / 清空项目 | `project-store.ts:397 / 1008` | 归零 |
| 面板「清除」 | `LayerPanel` → `selectNodes([])` | 归零 |
| Ctrl/Cmd+点已选节点 | `CanvasSurface.tsx:458` → `selectNode(id, true)` | 从 roster 摘除 |

> 为什么「按下即清」而不是「抬起且未拖动才清」：CV-166 曾用后者，
> 结果**带拖动的点击清不掉选区**，多选残留态退不出去，用户怎么点都"显示不对"。

---

## ⑥ CV-169 定位并修复的 5 个缺陷（全部有实测数据）

探针：`scripts/probe/`（真组件 + 真样式 + **真实鼠标/键盘**），
`canvas-studio: yarn probe:surface`；浅色/深色各 **32/32**。

| # | 缺陷 | 证据（实测） | 修法 |
|---|---|---|---|
| **D1** | Ctrl/Cmd 多选丢失（CV-166 回归）：`onSelectNode(node.id)` 丢了 `multi` | Ctrl+点已选节点从「减选」变「单选它」；roster 与选区不一致 → 动 3 张亮 1 张 | `CanvasSurface.tsx:458` 带修饰键 → `onSelectNode(node.id, true)` 且不起手势 |
| **D2** | `:hover` 打赢选中态：悬停把紫边换成灰线 | border `rgb(91,75,214)` → `rgba(15,17,23,.16)` | `.csNode:hover:not(.csNodeSelected)`（styles.ts:1402） |
| **D3** | `:active` 打赢选中态：按住把光晕换成普通投影 | Ctrl 加选按住时 box-shadow `--cs-glow-accent` → `rgba(0,0,0,.45) 0 4px 12px` = **看起来没选中** | `.csNode:active:not(.csNodeSelected)`（styles.ts:1416） |
| **D4** | 缩放/连接把手挂在框外，被 `overflow:hidden` + 圆角裁掉 | `.csNodeResizeSE` 盒中心 `elementFromPoint` 命中 `.csCanvasSurface` → 按右下角 = **空白按下 → 清空选区 + 平移** | 8 个把手负偏移改贴内边；连接把手 `right:-9px → 2px` |
| **D5** | 缺 `pointercancel` 收口 | 合成 pointercancel 前 `csNodePrimary` 不摘、后续 move 仍改坐标 | 新增 `onPointerCancel`（CanvasSurface.tsx:700） |

**反引号坑（写 styles.ts 时必须避开）**：`styles.ts` 是模板字面量，
文件内**只允许 2 个反引号**（定界符）。注释里写 `` `:hover` `` 会撕裂模板字符串 ——
守卫 `视觉守卫：styles.ts 不得含反引号` 会拦住。注释里直接写 `:hover` 不加反引号。

---

## ⑦ 下次改这里时的检查清单

1. 新加任何 `.csNode:<伪类>` 规则：**只改 `border-color`/`box-shadow` 就必须带 `:not(.csNodeSelected)`**
   （守卫会自动拦住；背景/光标/filter 不受限）。
2. 新加的选择状态**只能走 `selectedNodeIds`**，不要新增第二个"当前选中"字段
   （`selectedNodeId` 只在"恰好 1 个"时有值，它是派生的详情面板指针）。
3. 任何**后台**动作（生成完成、附件旁路、轮询回调）不得写选区 —— 用 `select: false`
   这类显式旁路（CV-168 的口径）。
4. 改手势时**五个收口路径**（up / cancel / leave / buttons===0 / link 取消）要一起过一遍。
5. 改节点几何时注意 `.csNode` 是 `overflow: hidden`：**任何挂到框外的东西都会被裁**。
6. 改完跑：`node scripts/verify-previews.mjs`（几何/令牌矩阵）+ `yarn probe:surface`（手势与状态矩阵）。
