# 画布节点的「选中 / 拖动 / 压暗 / 恢复 / 取消选中」代码地图

> 行号为 **CV-186（2026-09-15）** 时刻的快照，随文件演进会漂移；符号名不会。
> 目的：把这五个行为涉及的**每一处代码**摊开，并说明它们如何互相覆盖。
> 结论先行：节点外观由**三层**决定，三层按 CSS 层叠互相覆盖 —— 之前「状态乱」的根因
> 全部落在这三层的**优先级**上，不在任何单条逻辑里。
> **CV-186 变化**：血缘层（第三层）从「选中派生、恒亮」改为「拖动派生、三档」
> —— 详见 ③。

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
- `--cs-node-dim` 默认 1（brand.ts:152）— 血缘层。**CV-186 起有两个档位**：
  `.csNodeNear` 写 `var(--cs-dim-near, 0.75)`（中间档）、`.csNodeDimmed` 写
  `var(--cs-dim, 0.42)`（压暗档）；亮档**不挂类**、乘数恒为默认 1。
  **⚠️ 只在「真正开始拖动」时生效**（详见 ③）—— 单击选中不压暗。
- `--cs-dim: 0.42` / `--cs-dim-near: 0.75`（brand.ts:143/144）**明暗同值**，非配色令牌

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

## ③ 压暗（dim / 血缘聚光）—— **CV-186 恢复，语义已改**

> **现状：只在「真正开始拖动」时压暗，按血缘距离分三档；松手即恢复。**
> 单击选中**不压暗**（选区只影响外观，不再派生压暗）。

### 3.1 三档规则（唯一判定 = `src/canvas-lineage.ts` `canvasSpotlight()`）

以**被拖的簇**为起点（多选 = 整队；拖托盘/成员 = 托盘及其全部成员，
`containmentCluster`），沿 `sourceIds` **双向**走 BFS 数最近跳数：

| 跳数 | 档位 | 类名 | 乘数 | 谁落这里 |
|---|---|---|---|---|
| 0 | 亮 | （不挂类） | 1 | 被拖的簇本身 |
| 1 | 亮 | （不挂类） | 1 | 直接血缘（上游「我引用的」/ 下游「引用我的」） |
| 2 | **中间档** | `.csNodeNear` | `--cs-dim-near` = **0.75** | 隔一层的血缘 |
| ≥3 / 无血缘 | **压暗档** | `.csNodeDimmed` | `--cs-dim` = **0.42** | 更远与完全无关 |

**为什么「1 跳亮、其余压暗」不够用**（DD-03 原版的口径）：真机实测平均压暗
**68%**、53 个拖动目标里 **39 个超过 70%** —— 用户读到的是「一点就整屏变灰」。
留出中间档之后实测平均压暗降到 **28%**，**没有一个目标超过 70%**。
三种口径的实测对照（真实三张画布）：

| 口径 | 平均压暗 | 最差目标 | 超过 70% 的目标数 |
|---|---|---|---|
| A0（旧：1 跳亮 / 其余压暗） | 68% | 91% | **39 / 53** |
| **A1（现：三档）** | **28%** | **65%** | **0 / 53** |
| A2（只压无关） | 12% | 20% | 0 / 53 |

**托盘与成员同档**：托盘本身没有血缘（它不是被生成的），若按自己的距离判档，
一个装着「本次拖动的直接来源」的托盘会整体压暗、把最要紧的那张图一起压掉。
取「簇内最亮档」同时保证不出现「亮托盘里套着灰成员」的断裂
（不加这条时，真画布上「托盘与成员落进不同档」出现 **22 次**）。

### 3.2 两道安全阀（缺一条都会退化成「整屏变灰」）

1. **必须有直接血缘留在亮档** —— 被拖簇之外若**一个 1 跳邻居都没有**，
   整张画布除自己以外全是压暗档，压暗揭示不了任何关系。这条挡住了两个最刺眼的
   场景：拖一张刚导入、还没连线的素材；拖一个自成一体、对外没有血缘的托盘。
2. **中间档覆盖率上限 `NEAR_COVERAGE_LIMIT = 0.7`** —— 星形项目的形状是
   「一个枢纽 + 一圈叶子」，叶子之间互为 2 跳；实测 `测试音乐` 里 22 张卡有
   **19 张**会落进中间档（83%）。梯度在那个形状下没有区分度（哪里都降一档 =
   整屏一起变闷），此时诚实的做法是不假装有梯度 → 整体退到亮档
   （等价于「只压无关」，即上表 A2 口径）。

### 3.3 为什么绑「手势」而不是绑「选区」（CV-171 退场的真因）

CV-171 退场时的诊断是「设计尺度问题 + 松手不恢复」，**两条现在都成立地解掉了**：

- **尺度** = 上面 3.1 / 3.2 的改语义（中间档 + 覆盖率上限），实测平均压暗
  68% → 28%。
- **生命周期** = 压暗**挂在手势状态上**（`spotDragIds`，只在 `onPointerMove`
  的**首次真实位移**写入；`onPointerUp` / `onPointerCancel` / `onPointerLeave`
  三条出口置 `null`）。旧实现挂在**选区**上，而选区全仓有十几处写入点
  （生成完成、附件旁路、轨道点击、切项目…）—— 只要有一处漏了「顺便清压暗」，
  就永远恢复不了。绑手势之后出口**只有两条**，结构上不可能「松手不恢复」。
- **单击不压暗** 也是同一个决定的副产品：写入点在「首次位移」而不是
  `pointerdown`，所以按住不动再松开不会闪一下灰。

> ⚠️ **一条给后人的教训（仍然有效）**：压暗的旧断言（「无血缘的 C 被压暗 =
> PASS」）把「实现符合设计」锁成了绿色，于是自动化全绿而真机验收持续失败。
> **断言必须写用户期望，不能写实现现状。** CV-186 恢复时反过来用了这条：
> 验收台页内自带一份**独立期望表**（`ORACLE`），不与被测实现共用判定函数，
> 否则「两边一起错」= 空绿。
>
> ⚠️ **第二条教训（CV-186 当场抓到）**：档位数值**越小越亮**，托盘取最亮档的
> 初值必须写**最暗档**（`let brightest: 1 | 2 | 3 = 3`）再取小 —— 初值写成 `1`
> 时 `value < brightest` 永远不成立、整簇被无条件抬亮，**而当时所有断言照样
> 全绿**。反向验证（探针必须能红）才把它逮出来。

以下是数据流，判定只有一份实现：

```
spotDragIds（手势态）─┐
                      ├→ canvasSpotlight(visibleNodes, spotDragIds)  [canvas-lineage.ts:161]
visibleNodes ─────────┘        ↓ { active, lit, near, dim }
                     CanvasSurface.tsx  useMemo
                              ↓ tier = tierOf(spotlight, node.id)   // 只投影、不判定
                     CanvasNode.tsx    tier !== undefined && !selected
                                       → 'near' → 'csNodeNear' / 'dim' → 'csNodeDimmed'
                              ↓
                     styles.ts  .csNodeNear   { --cs-node-dim: var(--cs-dim-near, 0.75) }
                                .csNodeDimmed { --cs-node-dim: var(--cs-dim, 0.42) }
                              ↓
                     styles.ts:1361  opacity = 数据层 × 状态层 × 血缘层
```

旧版（DD-03 起、CV-171 止）的判定口径被淘汰，保留在此仅作对照：

```ts
// ❌ 已淘汰：判据 `lit.size > selected.size` 在真实数据上几乎恒为真
if (selected.size === 0) return { active: false, lit }
for (const node of nodes) {
  if (selected.has(node.id)) { for (const s of node.sourceIds) lit.add(s); continue }
  if (node.sourceIds.some(s => selected.has(s))) lit.add(node.id)
}
return { active: lit.size > selected.size, lit }
```

**三条已失效的推论（留档，防被当现状引用）：**

1. ~~压暗由「选中了谁」决定，与拖动无关~~ → **现在恰好相反**：压暗只在拖动
   时出现，选中不再派生任何压暗。
2. ~~选中孤立节点（无血缘）不压暗~~ → 判据换成「**被拖簇**之外有没有 1 跳
   邻居」（安全阀 ①），比旧判据严：旧判据算的是「亮档节点数 > 被选节点数」，
   一个孤立节点只要下游够多就会成立。
3. ~~压暗不会因松手而恢复~~ → **现在松手即恢复**（三条手势出口复位）。

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

**CV-171（2026-09-13，产品决策 —— 不是缺陷修复）**：**取消节点压暗**。

接手对话按 §5 顺序取证后的结论：真机「一选就暗一片 / 松手不恢复 / 点空白像没反应」
里的**主体是 DD-03 聚光的设计行为**，不是渲染 bug。取证链：

1. 构建时效性复核：产物（21:27 / 21:28）新于最后提交（21:25），无未构建源码
   ⇒ 排除陈旧构建；产物内确认含 CV-170 的三条 `:not(.csNodeSelected)` 规则。
2. 探针实跑：浅色 / 深色各 32/32 全绿 ⇒ 排除画布手势与选中态的代码回归。
   （同时发现：`yarn probe:surface` **默认只跑 light**，深色须显式
   `--theme=dark` —— 上一轮「深浅各 32/32」的说法需要跑两次才对。）
3. 用**用户真实项目数据**跑纯函数 `canvasSpotlight`：18 节点项目里
   **选中任意节点都压暗 9~16 个**；零血缘的「创意」也压暗 11 个。
4. 用户「文字节点正常 / 图片节点有问题」实为**变量混淆**：那个对照是在
   **只有 1 个节点**的项目里做的（单节点 `lit.size === selected.size` ⇒ 不压暗）。
5. 因而拍板取消压暗；改 `CanvasSurface` 停止消费 spotlight（判定模块与 CSS 保留），
   探针断言由「C 被压暗 = PASS」反转为「C 不得变暗」，并**新增真实拖动后点空白的断言**
   （旧版用 `setSelected` 程序化设选区，跳过了用户真实的手势序列）。

验证链：`tsc` 双端 0 错 + `lib/client.js` 重建 + **535/535** 单测 + 探针
**浅 33/33 / 深 33/33**（33 = 32 + 新增的 7pre）。

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
   ⚠️ 探针**默认只跑 light**；深色必须显式 `node scripts/probe/drive.mjs --theme=dark`。
   前置：本机无 `playwright-core`（有意不引进主依赖），装到隔离目录后
   `NODE_PATH=/tmp/cs-probe-runner/node_modules yarn probe:surface`。
7. **压暗只在拖动时出现**（CV-186 恢复，语义见 ③）。守卫双向：
   ① `CanvasSurface` 必须**真的**调 `canvasSpotlight(` 并把档位传下去
   （判定写好但没接线 = 没做）；② 不得再出现旧的 `dimmed=` prop 形态
   （属性名换了，旧写法意味着有人照老文档改回来）。压暗的生命周期只能挂
   `spotDragIds`（手势态），**不得改回选区派生** —— 那是 CV-171 的病根。
8. 断言写**用户期望**，不写**实现现状** —— 旧版把「C 被压暗」断言成 PASS，
   导致 32/32 全绿而真机持续失败。恢复压暗时同理：验收台的期望值**不得**由
   被测函数自己算出来（页内要有独立的 `ORACLE` 期望表）。
