# 草稿 → 正式版分辨率工作流（开发文档）

> **编号**：**CV-190**（功能主体）＋ **CV-190a**（前置修复，已完成）
> **状态**：`仅设计`（CV-190）/ `已修复·待验收`（CV-190a）
> **日期**：2026-09-16
> **一句话目标**：先用低分辨率出图/出片看效果，满意后**用同一份提示词与同一份参考**一键重新生成为高分辨率正式版。
> **行号说明**：文中行号为 2026-09-16 快照，随文件演进会漂移；**符号名不会**。改代码前先按符号名定位。

---

## 0. 先明确一件事：这个功能「大半已经存在」

现有代码只差三步：① 视频侧写死 megapixels（**已修，CV-190a**）；② 节点缺一个「草稿/正式」标记；③ 缺一个把「草稿节点 → 高分辨率重跑」串起来的按钮。

| 能力 | 现状 | 位置 |
| --- | --- | --- |
| 三档分辨率表（480p/768p/2k） | ✅ 已就绪 | `src/config.ts` `OUTPUT_SIZE` / `MEGAPIXELS_BY_RESOLUTION` |
| 档位决策（工具参数 > 设置 > 默认） | ✅ 已就绪 | `src/generate.ts:205` `resolutionOf()` |
| 生成参数随节点落盘（可回放） | ✅ 已就绪 | `src/generate.ts:828` `generationPromptOf()` → 节点 `generationPrompt` |
| 节点级重跑（原地更新，保 id/位置/血缘/编组） | ✅ 已就绪 | `src/generate.ts:1434` `params.retryOf` 分支 |
| **带覆盖参数**的重跑 API | ✅ **已就绪** | `src/client/api.ts:378` `retryStudioNode(projectId, node, overrides)` |
| 「能否重跑」纯判定（可单测） | ✅ 已就绪 | `src/canvas-actions.ts:16` `canRetryNode()` |
| 右键菜单落点 | ✅ 已就绪 | `src/client/canvas/CanvasContextMenu.tsx:101` 重试项 |
| 详情面板落点 | ✅ 已就绪 | `src/client/canvas/LayerDetailPanel.tsx:389-408` 操作区 |
| 版本链（作废 / 取代 / 镜位版本号） | ✅ 已就绪（CV-108） | 节点字段 `retired` / `supersededBy` / `supersedes` / `shotVersion` |
| **视频侧按档发 megapixels** | ✅ **本次已修（CV-190a）** | `src/providers/drama.ts` |

> ⚠️ **一条影响功能成立性的未验证前提**：本次修复只保证**请求体**按档发送 `megapixels`（0.4 / 1.0 / 2.0）。**后端是否真的按 1.0 / 2.0 MP 输出高分辨率，尚未证实** —— 历史 P0-d 探针的 `fetch failed` 是探针自身缺陷（没带 `image1`、同步超时、无 `health` 夹心），既没证实也没证伪。若后端只静默回退 0.4，则视频侧「正式版」仍是 864×480。**详见 §9 风险。**

---

## 1. 概念定界（先划清，避免三套「版本」概念打架）

仓内已有一个"版本/失效"体系（CV-108），新引入的 `draft/final` **必须与它正交**，否则会出现两套判据互相覆盖（本项目已有先例：同一规则只准一份实现）。

| 概念 | 字段 | 语义 | 谁写 | 与草稿/正式的关系 |
| --- | --- | --- | --- | --- |
| **成熟度**（本次新增） | `status?: 'draft' \| 'final'` | 这一版是「看图用草稿」还是「可用正式版」 | 落盘时（由 `params.status`） | —— 本次主角 |
| 手动作废 | `retired?: boolean` | 用户/agent 判定「不要了」 | 右键「作废」 | **正交**：正式版也可以被作废 |
| 被取代 | `supersededBy?: string` | 同镜位出了新版，旧版让位 | `planSupersede`（CV-108） | **正交**：草稿被正式版取代是**一种**升级形态，见 §4 |
| 镜位版本号 | `shotVersion?: number` | 同一镜位第几版 | 落盘 | 正式版升级可 +1 |

**结论（推荐口径）**：`status` 只表达"成熟度"，**不复用** `retired`（作废 ≠ 草稿）、**不替代** `supersededBy`（取代是关系，成熟度是属性）。老节点无 `status` ⇒ **视为 `final`**（零迁移，历史产物本来就是"正式"）。

---

## 2. 数据模型改动

### 2.1 节点字段（`src/contracts/canvas.ts`，`StudioCanvasNode` 内）

```ts
/**
 * CV-190：成熟度。draft = 低分辨率预览稿（看构图/动作，不用于成片）；
 * final = 可用正式版。缺省（老节点）一律视为 final —— 历史产物零迁移。
 * 与 retired / supersededBy 正交：作废是「不要了」，取代是「谁接替谁」，
 * 本字段只答「这版够不够正式」。
 */
status?: 'draft' | 'final'
```

- **不加** `NODE_DEFAULTS` 条目：缺省语义由读取方用 `node.status ?? 'final'` 表达，避免"写默认值 = 修改老节点"。
- **不 bump** `CANVAS_DOCUMENT_VERSION`（4 → 5）：新增可选字段，老文档天然兼容（与 `assets` 的 v4 做法一致，但连版本号都不必动）。**此点待确认**，见 §9 待拍板。

### 2.2 档位来源：草稿档 / 正式档

两个档位各自的来源，**各自一个设置项**（推荐），或复用现有单一设置（备选）。

| 方案 | 草稿档 | 正式档 | 代价 |
| --- | --- | --- | --- |
| **A（推荐）** | 新增设置 `draftResolution`（默认 `480p`） | 复用现有 `defaultResolution`（默认 `768p`） | 设置项 +1；语义最清晰 |
| B | 固定 `480p`（不可配） | 复用 `defaultResolution` | 零设置项；但用户想用 768p 预览时无能无力 |
| C | 复用 `defaultResolution` | 新增 `finalResolution` | 反向：默认档变"草稿"，与既有语义冲突（现有默认 768p 是正式档） |

**推荐 A**：`defaultResolution` 保持"正式档"身份不变（不破坏既有语义），新增 `draftResolution` 只管预览。

设置项落点（四处联动，与 `defaultResolution` 完全同构）：

| 层 | 文件:符号 | 动作 |
| --- | --- | --- |
| schema | `src/host-config.ts` `CanvasStudioConfig` / zod | 加 `draftResolution: z.union([...]).default('480p')` |
| 读取 | `src/index.ts` 配置快照 + `() => source().draftResolution` | 加一行 |
| 运行时 | `src/host-tools.ts` 的 runtime 契约（`defaultResolution: () => VideoResolution` 旁） | 加 `draftResolution: () => VideoResolution` |
| 设置 UI | `src/client/SettingsModal.tsx:453`（`defaultResolution` 下拉旁） | 复制一个下拉 |

---

## 3. 交互流程（时序）

```
① 出草稿
   用户/agent：image_generate / video_generate 传 resolution='480p'
                （或工具不传 → 若开启「默认出草稿」则取 draftResolution）
   → 节点落盘：status='draft'，generationPrompt 记下完整参数（含 resolution:'480p'）

② 看效果（画布上）
   草稿节点显示「草稿」角标；不参与成片合成（可选，见 §5.4）

③ 满意 → 一键出正式版
   用户在右键菜单 / 详情面板点「生成正式版（768p 或 2k）」
   → 取 node.generationPrompt 解析出 base 参数
   → overrides = { resolution: <正式档> }   // prompt / 参考图 / 时长 / provider 全部沿用
   → 调 retryStudioNode(...)（复用现成 API）
   → 节点 isLoading（沿用现有加载态）

④ 完成
   节点 status → 'final'，资产替换为新分辨率产物，角标消失/变「正式」
```

**核心不变量**：升级**只改 `resolution` 一项**，其余参数逐字节沿用 `generationPrompt` ⇒ 「同样的提示词」由机制保证，不靠用户手抄。

---

## 4. 升级的两种落地形态（**待拍板**）

| 形态 | 机制 | 草稿去向 | 优点 | 缺点 |
| --- | --- | --- | --- | --- |
| **A. 原地升级**（推荐） | `retryOf = node.id`（现成） | 资产被覆盖，节点 `status` draft→final | 复用 `retryOf` 零改造；画布不增卡 | 草稿资产丢失，无法回退对比 |
| B. 派新节点 | 普通生成 + 显式 `replaces`（走 `planSupersede`） | 原草稿保留，被标记 `supersededBy` | 草稿可对比/可恢复，契合 CV-108 版本链 | 画布多一张卡；需处理落点与版本号 |

**推荐 A + 一点补强**：原地升级时**旧资产文件不删**（`assets/<project>/<uuid>.png` 天然保留，只是不再被节点引用），需要对比时从磁盘取回即可 —— 既不增卡，也不真丢草稿。若后续要"两版并排"，再升级到 B。

> 决策点见 §9「待拍板 1」。

---

## 5. UI 设计

### 5.1 节点角标（`src/client/canvas/CanvasNode.tsx`）

节点已有一套角标体系（右下角分辨率角标 `mediaDims`，见 `CanvasNode.tsx` 约 `:438`）。**复用同一位置与样式语言**，新增一枚「草稿」chip：

| 状态 | 角标 | 文案 | 样式 |
| --- | --- | --- | --- |
| `draft` | 显示 | `草稿` | 中性色 chip（与分辨率角标同形）；与分辨率角标并排时草稿在左 |
| `final` | 不显示 | —— | 正式是默认态，不需要角标（避免每张卡都挂"正式"，噪声） |

补充：草稿节点建议**整卡轻微去饱和或降不透明度**（如 `--cs-node-state: 0.9`，走既有状态层变量链，**不要**新写 inline opacity —— 项目已有"inline opacity 压死状态类"的历史坑）。**此点待确认**，见 §9。

### 5.2 右键菜单（`src/client/canvas/CanvasContextMenu.tsx`）

在现有「重试（同参数重新生成）」项旁，新增一项（**仅草稿节点显示**）：

```tsx
{item('生成正式版（' + FINAL_TIER_LABEL + '）', () => { onPromoteToFinal(node.id) })}
```

- 可见性判据 = `status === 'draft'` 且 `canRetryNode(node)`（复用现成判定，见 §6）。
- 位置：放在「重试」**之前**（主路径优先，与 CV-177「破坏性操作靠后」同一排序语言）。
- 已 `final` 的节点不显示该项。

### 5.3 详情面板（`src/client/canvas/LayerDetailPanel.tsx`）

两处改动：

1. **「版本」行**（新增展示行，放在「参数」行附近 `:362-373`）：

   | 行 | 内容 |
   | --- | --- |
   | 版本状态 | `草稿` / `正式版` |

2. **操作区新增按钮**（`:389-408` 操作区，`重试` 旁）：

   - `草稿` 节点：显示 **「生成正式版（768p）」** 与 **「生成正式版（2k）」** 两个按钮（直接给出两档，避免再弹一层选择）。
   - `正式版` 节点：不显示。
   - 面板顶部已有「分辨率」展示（`resolutionText()`，`:123-128`，读 `mediaWidth×mediaHeight` 实测值）—— **升级后这里自动变成新像素**，是本次功能的天然验收点（详见 §8）。

### 5.4 设置页（`src/client/SettingsModal.tsx`）

在「默认分辨率」下拉（`:453`）**上方**新增：

| 项 | 说明 |
| --- | --- |
| 默认出图档（`draftResolution`） | 「低清预览用哪一档」，默认 `480p`。说明文案需写明"草稿只用于预览构图/动作，不要用于成片" |

> 若不做 §5.4 的设置项（选 §2.2 方案 B/C），此节作废。

### 5.5 是否把草稿排除出成片合成？（**待拍板**）

草稿不该进成片，否则 480p 片段会被拼进 2k 成片。两个口径：

| 口径 | 做法 | 影响面 |
| --- | --- | --- |
| **A（推荐）** | 合成取片段时**跳过 `status === 'draft'`** 的 video 节点，并在时间轴上标注"草稿不可纳入" | 需改 `collectClips` / `defaultComposeClips` / 时间轴 disabled 逻辑（与 `retired` 同构：`retired` 已在此处被排除，照抄即可） |
| B | 不排除，靠用户自觉 | 零改动，但可能误拼 |

> 决策点见 §9「待拍板 2」。

---

## 6. 实现细节：一键升级怎么接

### 6.1 判定（纯函数，可单测 —— 放 `src/canvas-actions.ts`）

```ts
/** CV-190：该节点能否「升级为正式版」。与 canRetryNode 同源（toolName+generationPrompt 齐备），
 *  且当前必须是草稿。生成中不可点。 */
export function canPromoteToFinal(node: StudioCanvasNode): boolean {
  return canRetryNode(node) && (node.status ?? 'final') === 'draft'
}
```

**为什么必须与 `canRetryNode` 同源**：`canRetryNode` 的注释明说"徽章一旦可点，点击必然真的重放"——若新判定另写一套条件，会出现"按钮可点但点了报错"的老毛病（CV-018 已踩过）。

### 6.2 动作（复用 `retryStudioNode` 的 `overrides`）

```ts
// client 侧（StudioFrame 接线层）
const promoteToFinal = async (nodeId: string, target: VideoResolution) => {
  const node = findNode(nodeId)
  await retryStudioNode(projectId, node, { resolution: target, status: 'final' })
  //                ^^^^^^^^^^^^^^^ 现成 API：内部 { ...base, ...overrides, retryOf: node.id }
}
```

- `overrides` **只带两个字段**：`resolution`（目标档）与 `status:'final'` — 其余全部来自 `generationPrompt`。
- `GenerateParams` 需新增可选 `status`，并让 `generationPromptOf()` 把它**排除出序列化**（与 `retryOf` 同处理，见 `src/generate.ts:828-829` 的解构写法）—— 否则历史回放会把 `status` 当生成参数重发。
- Host 落盘处（`src/generate.ts:1441-1454` 的 `retryOf` 分支）需把 `status` 写进 `updated`；普通生成分支（`else`）按 `params.status ?? 'final'` 落 `draft` 或 `final`。

### 6.3 工具参数（agent 侧，可选）

若希望 agent 也能主动出草稿，给三个生成工具（`image_generate` / `video_generate` / `video_composite`）的 `resolution` 描述补一句"**先用 480p 出草稿确认效果，满意后由用户一键升级**"。**工具不需要新增参数** —— `resolution` 已可传 `480p`。

---

## 7. 实施步骤（分批，每批自带验证）

| 批 | 内容 | 复杂度 | 验证 |
| --- | --- | --- | --- |
| **a（已完成）** | 视频侧 `drama.ts` 按档发 megapixels（删写死 0.4） | 低 | `typecheck` + `build` + `node --test` **680/680** ✅ |
| **b** | 数据模型：`status` 字段 + `GenerateParams.status` + 落盘写入 + `generationPromptOf` 排除 | 低 | 新单测：落盘 `draft`/缺省 `final`；`generationPrompt` 不含 `status` |
| **c** | 判定：`canPromoteToFinal` + `upgradeTargetsOf`（给出可升级档位） | 低 | 单测：草稿可升级、正式不可、加载中不可、缺 prompt 不可 |
| **d** | 设置项 `draftResolution`（若采纳方案 A）四处联动 | 中 | 设置读写往返 + 默认值断言 |
| **e** | UI：角标 + 右键项 + 详情按钮 + 接线 | 中 | 预览台/守卫：草稿显示角标、菜单项可见性双向断言 |
| **f** | 合成排除草稿（若采纳 §5.5 A） | 中 | 单测：草稿不进 `collectClips`；与 `retired` 行为对齐 |
| **g** | 文档收口 + STATUS.md 登记 CV-190 | 低 | `docs/` 自检 |

**每批只认 `# fail 0`**，验证链按仓规：`tsc` 双端 → `tsdown`（client bundle）→ `node --test "tests/*.test.mjs"` → 涉及视觉的加 `verify-previews.mjs`。

---

## 8. 验收方法（UI 层，用户可自测）

| # | 操作 | 期望 |
| --- | --- | --- |
| 1 | 生成一张图，`resolution='480p'` | 节点右下角显示「草稿」角标；详情面板「分辨率」= 432×240 或 864×480（按画幅） |
| 2 | 右键该节点 | 出现「生成正式版（768p）」「生成正式版（2k）」；**没有**「草稿」角标的正式节点不出现这两项 |
| 3 | 点「生成正式版（2k）」 | 节点进入加载态；完成后角标消失，详情面板「分辨率」变为 **1920×1088**（图片侧声明=真实，可直接比对） |
| 4 | 对比升级前后 | 详情面板「提示词」**逐字未变**；参考图缩略图**同一批** |
| 5 | 视频侧（若后端已支持） | 升级后详情面板分辨率 = 1376×768 / 1920×1088；节点右下角角标（ffmpeg 实测值）与详情面板一致 |

> **第 3 / 5 条正是 CV-188 留下的"验收对拍法"**：节点右下角分辨率角标 = **实测值**，详情面板 = **落盘值** ⇒ 两处不一致即"声明 ≠ 真实"一眼可见，不必跑 ffprobe。

---

## 9. 风险与待拍板

### 风险

| # | 风险 | 影响 | 缓解 |
| --- | --- | --- | --- |
| R1 | **后端不按 1.0/2.0 MP 出高分辨率**（未证实） | 视频侧"正式版"仍 480p，功能名不副实 | 先跑 `scripts/probe-resolution-tiers.mjs`（**必须带首帧 `image1` + 前后各一次 `health` 夹心 + 足超时**）坐实；未坐实前 UI 明示"视频正式版分辨率取决于后端" |
| R2 | `status` 与 `retired`/`supersededBy` 语义重叠 | 两套判据互相覆盖（仓内已踩过同类坑） | §1 已定界；守卫断言"不得用 `retired` 表达草稿" |
| R3 | 草稿资产占存储 | 长期项目体积增大 | 原地升级不删旧文件但不再引用；可加"清理未被引用的草稿资产"后续项 |
| R4 | 老节点无 `status` 被判成草稿 | 历史产物误显示角标 | 缺省一律 `final`（§2.1） |
| R5 | 升级时 `provider` 未沿用 | 原 fal 片升级后被 drama 接手 | `overrides` **不带** `provider`；`generationPrompt` 里存着就自动沿用（`host-tools.ts:1158` 描述已承诺"重试节点时会自动沿用该片原来的供应商"） |

### 待拍板

1. **升级形态**：原地升级（§4-A，推荐）还是派新节点保留草稿（§4-B）？
2. **草稿是否排除出合成**：排除（§5.5-A，推荐）/ 不排除？
3. **档位来源**：新增 `draftResolution`（§2.2-A，推荐）/ 固定 480p（B）/ 新增 `finalResolution`（C）？
4. **`CANVAS_DOCUMENT_VERSION` 是否 bump**：建议**不动**（新增可选字段，老文档兼容）。
5. **草稿视觉是否整卡弱化**（§5.1 补强）——若做，走既有状态层变量链，**禁写 inline opacity**。

---

## 10. 附录：涉及文件与符号索引

| 文件 | 关键符号 / 行 | 本次角色 |
| --- | --- | --- |
| `src/providers/drama.ts` | `MEGAPIXELS_BY_RESOLUTION[req.resolution ?? DEFAULT_RESOLUTION]` | **CV-190a 已改**：按档发 megapixels |
| `src/config.ts` | `OUTPUT_SIZE` / `MEGAPIXELS_BY_RESOLUTION` / `DEFAULT_RESOLUTION` | 档位唯一事实来源 |
| `src/generate.ts` | `resolutionOf():205` / `generationPromptOf():828` / `retryOf` 分支 `:1434` | 决策·落盘·原地更新 |
| `src/client/api.ts` | `retryStudioNode():378`（含 `overrides`） | **升级动作的现成入口** |
| `src/canvas-actions.ts` | `canRetryNode():16` | 判定同源基底 |
| `src/contracts/canvas.ts` | `StudioCanvasNode`（`mediaWidth:185` / `supersededBy:253`） | 新增 `status` 的落点 |
| `src/client/canvas/CanvasContextMenu.tsx` | `:101` 重试项 | 新增「生成正式版」 |
| `src/client/canvas/LayerDetailPanel.tsx` | `resolutionText():123` / 操作区 `:389-408` | 新增「版本状态」行与升级按钮 |
| `src/client/canvas/CanvasNode.tsx` | 分辨率角标（约 `:438`） | 新增「草稿」chip |
| `src/client/SettingsModal.tsx` | `:453` 默认分辨率下拉 | 新增「默认出图档」 |
| `src/host-config.ts` | `:49` / `:99` | 新增设置项 schema |
| `src/providers/types.ts` | `VideoRequest.resolution:74` | 档位已透传（无需改） |

---

## 11. 附：CV-190a（前置修复）改动清单

已完成并验证（`typecheck` + `build` + `node --test` **680/680**）：

| 文件 | 改动 |
| --- | --- |
| `src/config.ts` | 新增 `MEGAPIXELS_BY_RESOLUTION`（480p→0.4 / 768p→1.0 / 2k→2.0） |
| `src/providers/drama.ts` | 删除 `const MEGAPIXELS = 0.4`；4 处请求体改用 `req.resolution` 反推 |
| `src/generate.ts` | 删除 Drama「resolution 已忽略」warning；更新两处过时注释 |
| `src/host-tools.ts` | `RESOLUTION_PARAM_DESC` 去掉「仅 fal 生效 / Drama 固定 0.4MP」错误描述 |
| `tests/*` | 3 处 megapixels 断言 `0.4 → 1.0` |

**根因回顾**：`generate.ts:238` 早已通过 `videoRequestOf` 把 `resolutionOf(params)` 透传进 `VideoRequest.resolution`（`types.ts:74`），但 `drama.ts` 弃之不用、自写常量 —— 档位决策链路是通的，唯独 Drama 适配器"接住了又扔掉"。
