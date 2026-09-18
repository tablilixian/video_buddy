# 画布血缘补全方案：让 sourceIds 反映真实的制作推导链

> **文档定位**：设计方案 + 施工步骤。**状态不写在本文件**，一律回填 `docs/STATUS.md`。
> 撰写日期：2026-09-18 ｜ 立项编号：**CV-204 ~ CV-208（拟）**——编号由本文件预留，动工前按 `STATUS.md` 编号规则复核（写号前先 grep 整个 `docs/`）
> 前置阅读：`STATUS.md`（编号规则）、`src/contracts/canvas.ts` §Bloodline（"no edge table" 契约）、`src/canvas-lineage.ts`、`src/canvas-placement.ts`
> 取证画布：`测试放手跑2`（35 节点：创意 1 / 剧本 1 / 分镜卡 3 / 文案 6 / 参考图 6 / 分镜视频 3 / BGM 6 / 成片 6 / 组 3）
>
> 一句话：**血缘只补「直接推导」边，创意只当根不当枢纽；三条断边各有单一修法，不引入第二张边表。**

---

## 0. 结论摘要

| # | 断边 / 问题 | 现状 | 目标 | 立项 |
| --- | --- | --- | --- | --- |
| 1 | 成片 → BGM / 文案 | `compose_video` 落盘只写 `sourceIds: clipIds`，`bgmNodeId`/`scriptId` 只被消费不进血缘 | 成片 sourceIds 并入 BGM 与文案节点 id | **CV-204** |
| 2 | 分镜卡 → 剧本 | 硬编码 `sourceIds=[创意]`，血缘跳过剧本 | `[剧本, 创意]` | **CV-205** |
| 3 | BGM / 场景图 → 文案 / 分镜卡 | `sourceUrls` 靠 agent 自觉，且机制上**连不到文本节点** | 产出类工具统一加 `sourceNodeIds` 参数 + skill 纪律 | **CV-206** |
| 4 | 文案 / BGM 旧版无失效标记 | 6 版全「有效」平铺，终版只能靠时间戳推断 | 旧版打 retired 或返回文本提示（方案待拍板） | **CV-207** |
| 5 | 用户上传参考图空血缘 | `addImportNode` 恒 `sourceIds: []`，一律网格落位 | 按用途挂创意 / 分镜卡（方案待拍板） | **CV-208** |

---

## 1. 取证：三条断边与一处误连（真实画布证据）

### 1.1 断边一：成片不知道自己用了哪条 BGM、哪篇文案

- 本画布 6 个成片节点的 `sourceIds` 全部只含三个分镜视频 id。
- 代码点：`host-tools.ts` `compose_video` execute 调 `appendComposedVideoNode` 时只传 `sourceIds: clipIds`；`bgmNodeId` / `scriptId` 只被读用（BGM 进 ffmpeg 混音、script 取 `text` 内嵌成快照），**不进血缘**。
- 后果：图上读不出「v6 成片 ↔ BGM `8788ed9d`（40s 版）↔ 文案 `aa5abbcb`」这组关系，只能靠 createdAt 相邻 + 成片内嵌 `script` 快照逐字一致推断。时间轴「合成导出」路径（`POST /compose`）同样只落 clipIds，两条路径都断。

### 1.2 断边二：分镜卡血缘跳过剧本

- `submit_storyboard_for_approval` 硬编码 `const brief = …find(user_brief); const sourceIds = brief ? [brief.id] : []`（auto / confirm 两条路径共用此变量）。
- 分镜卡的内容实质出自剧本的节拍链（每镜 10s、三幕结构），血缘却直接指向创意——**直接推导边缺失**。
- 连带落位代价：所有分镜/文案卡都往「创意右侧」挤（`deriveNodePlacement` 有血缘分支按来源右缘排布），加剧列拥挤。

### 1.3 断边三：BGM 与场景图的空血缘，一半是纪律、一半是机制

- 现象：BGM v1/v2 有血缘（agent 传了三个分镜视频的 `sourceUrls`），v3–v6 为空；台阶场景图 `sourceIds: []`，被无血缘分支网格扫描命中原点上方空格（y≈-241）孤悬。
- **机制缺口**：`sourceUrls` 经 `resolveSourceIds`（`generate.ts`）反查，**只匹配 `node.url`**——文案、分镜卡等文本节点没有 `url` 字段，**BGM→文案这条边在现有参数下根本连不出来**，不是 agent 不自觉。
- **纪律缺口**：场景概念图→分镜卡的「供给边」无任何机制；而反向「分镜视频→场景图」的「消费边」已由生成参数反查建立（分镜 3 视频的 sourceIds 含台阶图）——供需只有一半。

### 1.4 误连：星形拓扑稀释血缘语义

- 剧本 / 分镜 / 文案三个工具全部硬编码「父 = 创意」（CV-025/026/027 时代的约定）。创意作为**项目锚点**是对的（`addBriefNode` 幂等唯一、固定画布原点、`workflow-stage.ts` 以 `toolName==='user_brief'` 判阶段），但作为**所有节点的直接父**让「谁直接推导出谁」失真。
- 聚光机制不依赖星形：`canvas-lineage.ts` 的血缘距离是**双向 BFS**，多跳照样点亮（1 跳亮 / 2 跳中间档 / ≥3 跳压暗）——去掉冗余直连不损失任何交互。

---

## 2. 五个问题的结论（讨论纪要）

### 2.1 音乐节点的「生成参考」是什么？

- **纯文生音频**：`generateMusic` → `callDrama(DRAMA_ENDPOINTS.txt2audio, body)`，请求体只有 `caption_prompt / lyrics_prompt / duration / bpm / keyscale / language / timesignature`。**没有参考图、参考视频、参考音频输入**——BGM v3 的「参考」就是文案里写的策略文本（「参考曲 DNA：Gonna Fly Now……」被转写为 caption tags）。
- `music_generation` 的 `sourceUrls` 参数是**血缘标注、不参与生成**（工具描述原文「画血缘箭头」）。
- **合理父节点**：`[文案节点, 分镜视频×3]`——文案是策略出处（调式/曲长/燃点都在文案 `## BGM` 小节），分镜视频是约束来源（BGM 时长 ≥ 成片时长是 compose 的硬守卫；情绪锚点来自画面）。

### 2.2 创意节点当「所有节点的根」合理吗？

**当根（锚点）合理且必须保留；当所有人的直接父不合理。** 保留理由：幂等唯一、固定原点、阶段判定依赖；去除直连的理由见 §1.4。目标形态是「根可达」而非「星形枢纽」。

### 2.3 为什么 6 条文案？哪条是终版？

- `write_script` 每次调用 append 新节点，**文案没有任何版本/取代机制**（`supersedes` 链只覆盖视频）；而本项目的文案兼任「BGM 策略说明书」，BGM 换一版配方就重写一篇 → 6 文案 ↔ 6 BGM ↔ 6 成片一一对应。
- **终版判定法**：找无 `supersededBy` 的成片 → 读它内嵌 `script` 快照逐字比对。本画布终版 = 文案 `aa5abbcb`（v6）；终版 BGM 推断为 `8788ed9d`（40.03s，满足 v6 成片 30.36s 守卫，createdAt 紧邻）。
- 机制层面的解法见 CV-204（把边补上）与 CV-207（把旧版标掉）。

### 2.4 分镜节点的父节点应该是谁？

**`[剧本节点, 创意节点]`**。内容来源是剧本；创意保「根可达」与阶段判定。实现成本一处（`sourceIds` 变量构造处），剧本卡用 `existing.find(node => node.toolName === 'write_screenplay')` 与 brief 同款写法。副作用仅是落位锚点移到剧本右侧（剧本本就在创意右边，布局不冲突）。

### 2.5 台阶图挂谁？用户上传的参考图挂谁？

- **生成的场景概念图** → 挂**它服务的分镜卡**。证据：分镜 3 视频的 sourceIds 已含台阶图（消费关系成立），补上「台阶图→分镜 3」供给边后落位自动归位创作区。
- **用户上传图** → 按**用途**定：全局风格 / 角色锚挂**创意**（与 assets 锚点同层）；镜级场景 / 道具挂对应**分镜卡**。
- 已有的确定性机制要讲清楚：agent 后续生成时把上传图 `filename` 传进 refs，`resolveSourceIdsByFilename` 会自动建立「产物→上传图」边；反向「上传图→分镜卡」目前只能手动连线（画布连线手势写 `sourceIds`，立即被 `CanvasEdges` 渲染、被落位与聚光识别）。

---

## 3. 施工步骤

### CV-204 成片血缘补全（P1，代码）

- `compose_video` 工具 execute 与时间轴 `/compose` 路由**两条路径**都要收口：`sourceIds` 由 `clipIds` 改为 `[...clipIds, bgmNodeId?, scriptId?]` 去重、过滤未命中节点。
- 建议把拼接收进 `appendComposedVideoNode` 的入参约定处（或两处调用点各自补齐），避免第三条路径再漏。
- 口径确认：成片「是产物不是素材」的判定（`shot-versions.isShotClip`，CV-160）按 `kind`+`toolName`，**不读 sourceIds**——血缘补全不会把成片误当片段，需留一条测试钉住。
- 测试：compose 落盘节点 sourceIds 含 BGM / 文案 id；入参缺省时不产生幽灵 id。

### CV-205 分镜卡血缘加剧本（P2，代码，一处为主）

- `submit_storyboard_for_approval`：在 brief 旁 `find(write_screenplay)`，`sourceIds = [剧本, 创意].filter(Boolean)`；auto / confirm / 整表回退三条路径共用变量，一处生效。
- **存量卡刷新**：`mergeShotCards` 复用旧卡分支目前只更新文案（CV-050），需顺带把复用卡的 `sourceIds` 归一为新值，否则旧画布重提分镜也补不上边。
- 测试：新建卡 sourceIds 含剧本 id；复用卡血缘被刷新；无剧本卡时回退 `[创意]`。

### CV-206 产出类工具统一 `sourceNodeIds` + 纪律（P1，代码 + 约定）

- **机制**：`music_generation`、`image_generate` 新增可选参数 `sourceNodeIds: string[]`（只加参数不加工具，守工具数纪律）；`generateAsset` / `generateMusic` 落盘处与 `resolveSourceIds` 结果**取并集**，并过滤画布中不存在的 id。
  - 为什么不用 `sourceUrls` 扩语义：文本节点无 `url`，`resolveSourceIds` 按 URL 匹配的结构改不动也不该改（URL 语义是「媒体产物」）。
  - `video_composite` 已有 `shotNodeIds` 机制（产物血缘含分镜卡），不需动。
- **纪律**（skill / 工具描述同步）：
  - `music-prompt-writing` + `music_generation` 描述：配乐时必须回填 `sourceNodeIds=[策略出处文案 id, 分镜视频 ids]`；
  - `look.md` / `consistency.md`：场景概念图落卡时回填 `sourceNodeIds=[对应分镜卡 id]`。
- 测试：sourceNodeIds 与 sourceUrls/filename 反查三者并集；幽灵 id 过滤；不传时行为不变。

### CV-207 文案 / BGM 旧版失效标记（P2，**待拍板**）

- 现状：`supersedes` 链只覆盖视频（CV-108）与样张（CV-159 图片显式 `replaces`）。
- 方案 A（最小）：`write_script` 落新卡时把旧 `write_script` 卡标 `retired`（可右键恢复，机制已有）；BGM 同理。风险：用户可能有意保留多版备选 →「自动作废是否越权」需要拍板（与「完成状态需手动确认」同一顾虑）。
- 方案 B（更轻）：不动节点，`write_script` 返回文本补「上一版文案 id=X」提示，作废由用户右键手动。
- 本画布判定结论存档：终版文案 `aa5abbcb`、终版 BGM `8788ed9d`（推断依据见 §2.3）。

### CV-208 用户上传参考图挂靠（P2，**待拍板**）

- 方案 A：`addImportNode` 上传时若画布**恰有单选节点**则 `sourceIds=[该节点]`（「传给它用」的自然语义）；无选中 / 多选维持 `[]`。风险：「先传着再说」的场景会被误挂。
- 方案 B：不动代码，靠 CV-206 的 filename 反查（产物→上传图）+ 手动连线（上传图→分镜卡）。
- 拍板点：A 的「单选即挂靠」是否符合直觉。

---

## 4. 存量画布处置

- **不做自动迁移脚本**（不动用户数据；与「完成状态需手动确认」同款纪律）。
- 旧画布补救 = 手动连线补 `sourceIds`（立即被渲染 / 聚光 / 落位识别）+ CV-205 的复用刷新兜底。
- 落位影响只发生在**新生成节点**：补边不会重排已有节点（placement 只在落位时计算）。

## 5. 边界与非目标

- 不引入第二张边表（契约 §Bloodline：edges 永远从 `sourceIds` 派生，`CanvasEdges` / `canvas-lineage` / `canvas-placement` 继续消费同一字段）。
- 不改 `canvas.json` version（`sourceIds` 语义不变，只是填得更满）。
- 不做「创意→万物」强制直连的维持逻辑。
- `compose_video` 的 `scriptId` 仍只读 `text` 内嵌快照，血缘补全不改变该机制。

## 6. 验证与验收口径

- 每项配 `tests/*.test.mjs` 用例 + 反向验证（改回旧行为必须变红）。
- 端到端验收：重跑一次「放手跑」类项目，画布上应**新增**的边清单——
  成片→BGM、成片→文案、分镜卡→剧本、BGM→文案、BGM→分镜视频、场景概念图→分镜卡；
  BGM / 文案不再出现在参考区网格位，终版外旧卡有失效标记（若 CV-207 方案 A 过）。
