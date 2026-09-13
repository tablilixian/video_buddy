# 交接提示词：canvas-studio 画布节点「选中 / 拖动 / 压暗 / 恢复 / 取消选中」验收问题

> **✅ 已结案（2026-09-13 晚）**：接手对话按本提示词 §5 顺序取证后，把症状主体定性为
> **DD-03 血缘聚光的设计行为**（非渲染 bug）——依据是用**用户真实项目数据**跑纯函数
> `canvasSpotlight`：18 节点项目里选中任意节点都会压暗 9~16 个，「选孤立节点不压暗」
> 的保护在真实数据上从不生效。产品随即拍板**取消节点压暗**（CV-171）。
> 实施、证据与后人教训见 `docs/canvas-node-state-map.md` 的 ③ 与 ⑥（CV-171）。
>
> **CV-171 已提交入库**（压暗全部退场：`CanvasSurface` 不再消费 `canvasSpotlight`；
> 纯函数与单测保留）。**真机复验尚未做**，且取证过程中另挖出**一个独立未修缺陷**
> （幽灵 `parentId` 导致图层面板丢行）与**一条已排除的假线索**（Chromium 磁盘缓存）。
> 两条都在 **§9**，明天从这里开工，别再从 §5 重走。
>
> 用法：把下面横线之间的全文整段复制到新对话里。

---

## 你的角色

你是接手人。上一个对话在这个问题上已经做了 7 个提交、写了完整代码地图、写了自动化探针（32/32 通过），
**但用户真机验收仍然说「还是不行」**。不要从零重读整个仓库，不要凭猜测改代码。
先读完本提示词，然后**严格按 §5 的顺序取证**：先问清症状 → 再判断是否属于设计行为 → 才动代码。

## 0. 项目事实

- 仓库根：`/Users/lilixian/jobs/AI/video_buddy`
- 插件包：`canvas-studio/`（DSH Desktop 插件的画布工作台；Electron 壳 + Cordis harness + React 客户端）
- 分支：`dev`，当前 HEAD = `8c38d38468`（CV-170）
- 启动：`cd /Users/lilixian/jobs/AI/video_buddy && bash start-canvas-studio.sh`
  ⚠️ 不要加 `--fast`——该脚本已有防呆：canvas 源码比桌面产物新时会拒绝 `--fast` 启动
- 相关源码：
  | 文件 | 职责 |
  |---|---|
  | `src/client/canvas/CanvasSurface.tsx` | 手势状态机、聚光计算、选中写入、pointer 收口 |
  | `src/client/canvas/CanvasNode.tsx` | 单卡渲染、class 拼装、节点级 pointerdown |
  | `src/client/styles.ts` | **所有节点视觉规则**（模板字面量，见 §6 禁令） |
  | `src/client/project-store.ts` | `selectedNodeIds` 的唯一数据源 |
  | `src/canvas-lineage.ts` | `canvasSpotlight()` —— 血缘聚光的纯函数 |
  | `src/brand.ts` | `--cs-dim` 等视觉旋钮 |
  | `docs/canvas-node-state-map.md` | **代码地图，先读它**：三层视觉模型 / 五条收口路径 / 选中写入点表 |

## 1. 用户症状（原话）

- 「图层的选中，拖动，压暗，恢复，取消选中等等相关代码，全都给我列出来，我需要你从代码级别，给我把问题分析清楚」
- 随后：「还是不行」
- 更早：「图层节点的选中状态乱了」，并附三张截图（初始态 / 按下态 / 拖动中）

⚠️ **「还是不行」是不可证伪的。你的第一个动作不是改代码，而是拿到一份可复现清单（见 §5.1）。不要跳过这一步。**

## 2. 最重要的一条事实 —— 别再让用户重新构建

上一轮已核对过构建时效性，结论如下：

| 对象 | 时间 |
|---|---|
| canvas-studio 最后提交 `8c38d38468` | 09-13 21:25 |
| `canvas-studio/lib/client.js`（客户端产物） | 09-13 21:27 |
| `dsh-plugin-desktop/lib/main.js`（**桌面真正加载的产物**） | 09-13 21:28 |
| 比该提交更晚修改的 canvas 源码文件 | **无** |

→ **产物比提交新，且没有未构建的源码改动**。用户当时跑的构建**已经包含** CV-166 ~ CV-170 的全部修复。

所以：**「还是不行」不是陈旧构建造成的**。不要浪费一轮让用户 rebuild，也不要怀疑 `--fast`。
（若用户期间又改过源码，开工前按上表复查一次即可。）

这条事实也意味着：问题出在**探针覆盖不到的地方**，或者**用户描述的现象就是设计中的预期行为**（见 §5.2）。

## 3. 已做的 7 个提交（本地已 commit，**均未 push**）

| 提交 | 内容 |
|---|---|
| `c4b80e2ed7` CV-166 | 框选退场 + 图层面板按类型选择 |
| `af6ebc6603` CV-167 | 修复多选拖拽「隐形连带」与空白点击清选失效 |
| `051aebbfe4` CV-167b | 右键菜单点空白关不掉 —— 关闭监听从 mousedown 换 pointerdown |
| `dab1b78d59` CV-167c | CanvasSurface 手势探针（真实 DOM 回归验证工具） |
| `d3f2443f3d` CV-168 | 聊天发图旁路导入不再抢画布选中（用户拍板） |
| `8615bb1255` CV-169 | 修复 Ctrl/Cmd 多选失效、Shift+点节点清空选区（验收回归） |
| `8c38d38468` CV-170 | 节点状态层不可被交互层覆盖（hover/active 抢选中）+ pointercancel 收口 |

**状态更新**：CV-166 ~ CV-170 已由用户全部 push，`origin/dev` = `8c38d38468`（CV-170）。
CV-171 紧随其后落库。**不要再照抄下面的「未 push」描述。**

## 4. 已经修好、且有证据的部分

**CV-170 定位到并修掉的 5 个真缺陷**（症状与你听到的「全都乱了」高度吻合）：

1. **`:hover` 抢走选中描边** —— CSS 层叠里 `:hover` 是 `(0,2,0)`，`.csNodeSelected` 只有 `(0,1,0)`，
   伪类天然打赢状态类。选中后鼠标一进卡片，紫边立刻变灰线。
2. **`:active` 抢走选中光晕** —— 按住（Ctrl 加选 / 抓缩放把手）时光晕变普通黑投影。
3. **缩放/连接把手被 `overflow:hidden` + 圆角裁掉** —— 四个角的把手盒中心落到卡片外，
   点卡片角变成「点空白」→ 清空选区 + 起平移。
4. **`pointercancel` 未处理** —— 系统夺走指针时（触控接管 / 拖动中按右键 / 起始元素被移除）
   浏览器只发 `pointercancel`、**永远不发 `pointerup`**，手势永久卡死。
5. 一并修正：连接把手的负偏移改为内联定位。

**验证证据**：
- `docs/canvas-node-state-map.md`（17.8 KB）：三层视觉模型、**14+ 个选中写入点**行号表、
  手势状态机、`canvasSpotlight` 数据流、5 条收口路径、CV-169/CV-170 缺陷表。
- 自动化探针 `yarn probe:surface`（在 `canvas-studio/` 下）：用 `playwright-core` 的**真实
  `page.mouse`/`page.keyboard`**（合成 `PointerEvent` 的 `isTrusted=false`，浏览器不会置 `:active`、
  不会发起 pointer capture → 按下/拖动状态根本测不出来，所以必须用真实输入），
  逐节点抓取 computed style。**浅色 + 深色各 32/32 全绿**，含「选中态稳定性矩阵」与
  「pointercancel 收口」两组断言。

关键锚点（改前先看这几行）：

| 位置 | 内容 |
|---|---|
| `styles.ts:1361` | 单一透明度出口：`calc(var(--cs-node-opacity,1) * var(--cs-node-state,1) * var(--cs-node-dim,1))` |
| `styles.ts:1393-1429` | 层叠博弈的注释与 `:not(.csNodeSelected)` 规则 |
| `styles.ts:1446` | `.csNodePrimary.csNodeSelected`（z-index 3 + 2px 环） |
| `styles.ts:1499` / `:1510` | `.csNodeSelected` / `.csNodeDimmed` |
| `styles.ts:2326` / `:2781` | `--cs-node-state` locked 0.75 / retired 0.45 |
| `brand.ts:143` | `--cs-dim: 0.42` |
| `CanvasSurface.tsx:432/447/671/700` | `onSurfacePointerDown` / `onNodePointerDown` / `spotlight` / `onPointerCancel` |

## 5. 排查顺序（严格按此顺序，每步都要有结论才进下一步）

### 5.1 先问清「不行」到底指哪一个动作

必须让用户给出下面这份清单，**缺一条都不要往下走**：

1. 具体哪一步？（点节点选中 / 拖动移动 / 多选加选 / 点空白取消 / 选后其它节点变暗 / 按住时外观）
2. 期望看到什么？实际看到什么？
3. 是**每次都复现**还是偶发？
4. 单节点场景（画布只有 1 个节点）是否也错？——**这一问最关键**，能直接切开「聚光压暗」与「选中态渲染」两类问题
5. 能否给一段录屏（比截图有效得多，截图看不出时序）

### 5.2 然后判断：这是 bug，还是 DD-03 的**设计行为**

**这是最可疑的方向。** 选中一个**带血缘邻居**的节点时，DD-03 会做「聚光」：
血缘一跳内（上 + 下）的节点保持亮度，**其余全部压暗到 `--cs-dim`（0.42，即 42% 不透明）**。

- 实现：`canvas-lineage.ts` 的 `canvasSpotlight()` → 写 `.csNodeDimmed` → `--cs-node-dim: var(--cs-dim, 0.42)`
- 触发条件：`active = lit.size > selected.size`（**只有「选了等于全选」时才不压暗**；选单个孤立节点不压暗）
- 也就是说：**选中任何有血缘关系的节点，画布上大片节点会明显变暗**——用户完全可能把这个
  **预期行为**描述成「选中状态乱了 / 压暗不对 / 恢复不回来」。

**先向用户确认这一点，不要急着改。** 若确认是它，剩下的只是旋钮问题：

- 待决问题（上一对话问了 3 次，用户未回答）：**浅色主题下 `--cs-dim: 0.42` 是否太狠，是否调亮到约 0.6**。
- 也可能用户要的是「不压暗」或「只压暗无关节点而非全体」——先问，再动。

### 5.3 复跑探针，确认不是回归

```bash
cd /Users/lilixian/jobs/AI/video_buddy/canvas-studio
yarn probe:surface          # 期望：浅色 32/32 + 深色 32/32
```
若探针挂了 → 说明是代码回归，按断言名定位即可，别再猜。

⚠️ 探针有个历史坑：容器**必须是 `display:flex`**。`.csCanvasSurface` 的尺寸契约是
`flex:1; min-height:0`（`styles.ts:1271`），放进普通 block 容器会塌成 0 高度 + `overflow:hidden`，
真实鼠标永远点不到任何节点（曾表现为「只有 7/20 通过」）。

### 5.4 若探针全绿但真机仍错 → 找「探针测不到的东西」

按可疑度排序：

1. **Electron 专属渲染差异**：探针跑的是 headless Chrome，Electron 的 Chromium 版本、
   合成层、`backdrop-filter`、`filter` 组合可能不同。用 Electron 内的 devtools 直接量
   节点的 `getComputedStyle().opacity / border-color / box-shadow`，与探针快照逐字段对照。
2. **真实 store 与 UI 不同步**：探针用的是 mini-store（3 个节点 A/B/C，B→A 血缘）。
   真机是 `project-store.ts` 的**全量**写入路径 —— 14+ 个选中写入点里，图层面板、
   快捷键（Esc / 全选 / Delete）、自动选中（`addImportNode` 等 5 处）、重开画布恢复
   都可能造成 `selectedNodeIds` 与视觉不一致。**查 `selectedNodeIds` 的实际值**，
   别只看外观。
3. **多节点 / 大画布的聚光规模效应**：节点一多，收口路径的触发频率完全不同。
4. **图层树面板（LayerPanel）的选中样式**：`styles.ts` 里除了画布节点，面板行也有选中态，
   用户说的「图层节点的选中」可能指**面板行**而不是画布卡片 —— 先跟用户对齐术语。

### 5.5 术语对齐（低成本、高收益）

用户说「图层节点」。请确认指的是：画布上的**卡片**、还是左侧**图层面板的行**。
上一轮的全部工作都默认是画布卡片；如果用户指的是面板行，那前面的修复根本没碰对地方。

## 6. 工程约定（硬性）

- **未经用户明确确认，不要 `git commit`**。用户习惯「我先本地 commit → 用户自己确认后手动 push」，
  且当前有 6 个未推送提交挂着，push 必须等授权。
- `styles.ts` 是**模板字面量**：全文件**只允许出现 2 个反引号**（首尾定界符）。
  在注释里写反引号包裹的 `:hover` 会撕开字符串。有守卫测试盯着这件事（`styles.ts 不得含反引号`）。
- 改完源码必须**全量重建**（不能 `--fast`）。`dsh-plugin-desktop/lib/main.js` 才是桌面加载的产物。
- 验证链：`yarn test`（`tests/visual-tokens.test.mjs` 等）+ `yarn probe:surface` + 真机。
- 本机若 PATH 未注入：用 `./node_modules/.bin/tsc`（`build` 中 server 产物由 `tsc -p tsconfig.json`
  emit 到 `lib/`，tsdown 只管 client；单独跑 tsdown 不会生成 `lib/index.js`，别误判成构建失败）。

## 7. 待决问题（需要用户拍板）

- ~~`--cs-dim` 0.42 → 浅色主题是否调亮（约 0.6）？还是取消/收窄压暗范围？~~
  → **已结案**：压暗整体退场（CV-171），旋钮问题不复存在。
- ~~7 个提交是否 push~~ → 已 push。
- **当前待决**：幽灵 `parentId` 导致的**图层面板丢行**要不要修（用户 09-13 晚说「先别动」）。见 §9.2。

## 8. 交付要求

按这个顺序产出，不要跳：

1. **复现清单**（用户确认过的可执行步骤 + 期望/实际 + 是否每次都复现）
2. **结论**：是 bug 还是设计行为（若设计行为，只说旋钮怎么调）
3. **定位**：文件 + 行号 + 为什么
4. **最小修复**
5. **证据**：探针断言结果 / 真机 computed style 对照 / 截图

每次改完都要能回答这句话：**「哪条证据能证明用户看到的现象消失了？」** 答不上来就别提交。

---

## 9. 后续接手起点（2026-09-13 晚取证产出，明天从这里开工）

### 9.1 CV-171：压暗已退场，但真机尚未复验

- 改动：`src/client/canvas/CanvasSurface.tsx` 删掉 `canvasSpotlight` 的 `useMemo` 与
  `<CanvasNode dimmed={...}>` 传参；`src/canvas-lineage.ts` **纯函数保留**（单测仍在）；
  `.csNodeDimmed` / `--cs-dim` 视觉定义**有意保留**。
- 反向守卫：`tests/visual-tokens.test.mjs` 新增「CanvasSurface 不得再传递 `dimmed`」。
- 探针：`scripts/probe/drive.mjs` 三处压暗断言反转（`'0.42'` → `'1'`），并新增 `7pre`：
  用**真实鼠标**拖 B 再点空白 → 断言选区清空（此前用程序化 `setSelected` 跳过了手势）。
- 已核对产物：`canvas-studio/lib/client.js` 里 `canvasSpotlight` **0 次**、传 `dimmed` **0 处**。

**真机复验的前提事实（已查实，别再怀疑构建）**：

| 对象 | 时间 |
|---|---|
| `canvas-studio/lib/client.js` | 09-13 **21:59:53** |
| `dsh-plugin-desktop/lib/main.js` | 09-13 **22:00:17** |
| 运行中的 VideoBuddy Electron 启动（`~/Library/Application Support/VideoBuddy/lifecycle-events/startup.jsonl`） | 09-13 **22:00:31** |

→ **应用启动晚于构建**，user 报告的压暗来自 22:00:31 之前的那个进程。
让用户用**当前已开着的应用**直接复测「拖带 `parentId` 的节点是否还压暗」；
若还压暗 → 存在第二条压暗路径，按 9.3 的哈希法先排缓存，再查 `--cs-node-state` / `--cs-node-opacity` 两个旋钮。

### 9.2 独立缺陷：幽灵 `parentId` → 图层面板丢行（已证，未修）

- 真实数据 `~/.videobuddy/canvas-studio/projects/凌晨三点的门外人/canvas.json`：**18 节点**，
  其中 **7 个**的 `parentId` 指向 `grp-<uuid>`，但整份数据里**没有任何 `kind:'group'` 节点**。
- `src/client/canvas/LayerPanel.tsx:67` 只把 `parentId === undefined` 的当顶层行，子行靠
  `membersByGroup`（仅由**存在**的 parentId 建）递归 →
  **parentId 指向不存在的组 = 既不在顶层也不在任何子行 → 面板里彻底消失**。
- 已用复刻脚本证明：**18 节点 → 面板只渲染 11 行，7 个节点丢失**。
- 对照组：`src/canvas-view.ts:140` 的 `computeArrangeLayout` **有**这个兜底
  （`node.parentId === undefined || !byId.has(node.parentId)` 视为顶层单元），LayerPanel 缺。
- 组节点为何丢：嫌疑在 `src/generate.ts:1494`（`writeCanvas` 前后各一次读写，
  1499-1502 可能用陈旧 `canvasNodes` 快照覆盖）。**未证实，动手前先证。**
- ⚠️ 用户 09-13 晚明确说 **「先别动」**（针对自动分组机制）→ 修之前先确认
  「只修面板显示兜底」能否与分组机制解耦单独做。

### 9.3 已排除的假线索（别再浪费时间）

**Chromium 渲染层磁盘缓存不是原因。** 缓存里确有 pre-CV-171 的 `client.js`
（含 `canvasSpotlight` + `dimmed:`，URL `/plugins/canvas-studio/client.js?rev=9ef0facbb4a4`，
落盘 09-12 22:46），**但 `rev` 是 bundle 内容的 sha1 前 12 位**
（`deepseek-harness/packages/client/modules/src/index.ts:161 shortHash`）：
当前 bundle rev = `c3a6cc6a888a` ≠ `9ef0facbb4a4`，大小也不同（687698 vs 668172）
→ **URL 变了，缓存根本不命中**，只是孤儿条目。
（以后遇到「改了不生效」先算这个哈希，别直接怀疑缓存。）

---

**使用者注意**：本文件是交接用的提示词全文。§1-§8 是 09-13 上半夜的历史过程记录，
**§9 才是当前有效状态**；两者冲突时以 §9 为准。
