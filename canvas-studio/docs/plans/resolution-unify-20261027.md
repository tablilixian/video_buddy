# 分辨率设置统一方案（清晰度档位 · 单一事实源 · 项目级配置）

> 立项日期：2026-10-27　状态：**S1–S5 已实施**（D1 / D2 已拍板，见 §9；真机 probe 与 UI 验收待跑，见 §11）
> ⚠️ **§0–§11 是首轮方案的原貌，其中「项目预置统一档位」「图片读 plan」等口径已在同日二次拍板被推翻** —— 现行口径只看 **§12**（尤其 §12.2 推翻清单）。
> 编号：**待取号**（开工前 `git log` + STATUS §4.1 复核后再领，不预领；本方案**验收通过后**才登记）
> 关联：CV-187（三档分级）/ CV-188（视频实测）/ CV-190a（按档发 megapixels）/ REQ-028（首页规格行）

## 0. 要解决的问题

同一件事（"这次出多清晰"）现在有 7 个入口、3 套命名、2 张真值表、3 处不同的缺省值，其中 1 个入口完全不生效。

| 症状 | 证据 |
| --- | --- |
| 首页选了 1080P 不影响任何生成 | `lobby-spec.ts:155-161` 不写 plan；`tests/lobby-spec.test.mjs:96` 锁死 |
| 同一视频节点三处读数不同（720P / 480P / 实际 480p） | `NodeInputCard.tsx:830` vs `CanvasNode.tsx:391` |
| 一档有两个 megapixels 值 | `api.md:64`=1.0 vs `api.md:297`=0.9 vs `output-size.ts:36`=0.9 |
| 显示名与真值不同名，且三者互不对应 | 内部 `736p` / 显示 `720P` / 像素 `1280×736` |
| 设置页下拉直接暴露内部键 | `SettingsModal.tsx:468-470`：`480p` / `736p` / `2k` |

## 1. 目标与不变量

1. **一个档位只有一个名字、一组真值**：显示名（480P/720P/1080P）、内部键、后台参数三者由同一张表派生，任何一处改不出去第二份。
2. **后台真值优先**：视频只发 `megapixels`（后台唯一旋钮），图片发 `width/height`；两者必须都是后台**已约定/已实测**的值，不允许再出现"我们自己插的 0.9"。
3. **优先级只有一条链，四层**：节点显式 > 项目预置 > 设置页默认 > 出厂。
4. **项目走同一套数据**：`plan.resolution` 存的就是这张表的 `id`，首页、项目卡、提示词、生成链同源读取。
5. **任何界面读数 = 当前真实生效值**，并且能看出它来自哪一层（显式 / 跟随）。
6. **不动历史数据**：旧键只在读路径归一，不批量回填、不改历史节点。

## 2. 唯一数据模型

新建 `src/resolution-tiers.ts`（纯数据 + 纯函数，无 IO、无 React，可被 Host / client / node:test 三方直连）：

```ts
export const RESOLUTION_IDS = ['480p', '720p', '1080p'] as const
export type ResolutionId = (typeof RESOLUTION_IDS)[number]

export interface ResolutionTier {
  readonly id: ResolutionId
  readonly label: string          // 用户可见通用称呼：480P / 720P / 1080P
  readonly megapixels: number     // 视频端点唯一旋钮（后台约定值）
  readonly frames: {              // 图片端点直接发像素；视频由此表反推后校验
    readonly '16:9': { readonly width: number; readonly height: number }
    readonly '9:16': { readonly width: number; readonly height: number }
    readonly '1:1': { readonly width: number; readonly height: number }
  }
  readonly costMeta: string       // 菜单右侧：耗时倍数（0.4× / 推荐 / 2.0×）
  readonly deprecatedAliases: readonly string[]  // 读路径归一：'736p' / '2k'
}
```

真值表（**待 D1 拍板**，下表为推荐口径 = H3 官方三行）：

| label | id | megapixels | 16:9 | 9:16 | 1:1 | 说明 |
| --- | --- | --- | --- | --- | --- | --- |
| 480P | `480p` | 0.4 | 864×480 | 480×864 | 1024² | 草稿/试拍（实测 5.3s） |
| 720P | `720p` | 1.0 | 1376×768 | 768×1376 | 1024² | 原生档（实测图片 14.5s） |
| 1080P | `1080p` | 2.0 | 1920×1088 | 1088×1920 | 1024² | 交付档（视频侧为上采样） |

三条硬约束（写进测试）：
- 所有像素宽高 **% 32 === 0**（后端按 8 对齐、静默取整，非 32 倍数会得到另一个尺寸 —— 2026-09-15 实测 `1400×780 → 1400×776`）。
- `megapixels` 与 `frames['16:9']` 必须自洽（`w*h/1e6` 与表值误差 < 5%），防再出现 0.9 那种手填值。
- `label` 唯一、`id` 唯一、`deprecatedAliases` 不得与任何现存 `id` 冲突（守卫 `tests/resolution-tier.test.mjs`）。

**取代关系**（不留第二张表）：

| 现有文件 | 处置 |
| --- | --- |
| `src/output-size.ts` | 删除；`OUTPUT_SIZE` / `MEGAPIXELS_BY_RESOLUTION` 改由表派生并保持同名再出口，调用点零改动 |
| `src/resolution-display.ts` | 删除；`RESOLUTION_DISPLAY` / `resolutionDisplay()` 改为表视图 |
| `src/config.ts` 的 `sizeForAspectRatio` | 改为查表；`DEFAULT_RESOLUTION` 改为 `'720p'` |
| `src/providers/fal.ts` 的 `LEGACY_RESOLUTION` | 合并进 `deprecatedAliases` |

## 3. 统一优先级：一个 resolver

新建 `src/resolution-resolve.ts`（纯函数）：

```ts
export type ResolutionSource = 'node' | 'plan' | 'settings' | 'default'

export function resolveResolution(input: {
  readonly nodeValue?: unknown            // generationPrompt.resolution
  readonly planValue?: unknown            // project.plan.resolution
  readonly settingValue?: unknown         // defaultVideoResolution / defaultImageResolution
  readonly kind: 'image' | 'video'        // 只影响读哪个设置项
}): { readonly id: ResolutionId; readonly source: ResolutionSource }
```

- `generate.ts` 的 `resolutionOf()` 删除，改调本函数（请求侧唯一消费点）。
- `studio-defaults.ts` 的 `resolveStudioDefaults` 改调本函数，`imageResolution` / `videoResolution` 同时带上 `source`，`describeStudioDefaults` 已有来源标记，文案自动升级为 `分辨率 1080P（项目预置）`。
- 客户端读数（节点 chip / 画布角标 / 项目卡）也调本函数 —— **UI 与生成链共用同一次判定**，这是"读数不再说谎"的结构保证。

`normalizeResolution`（旧键归一）放进本模块，读路径唯一入口；写路径只写新 `id`。

## 4. 项目级配置（让首页真正生效）

### 4.1 契约

`contracts/project.ts`：

```ts
export interface StudioProjectPlan {
  aspectRatio?: StudioPlanAspectRatio
  targetDuration?: number
  resolution?: ResolutionId      // 新增：项目锁定的清晰度档位
}
```

`normalizePlan()` 增加一项校验（非法丢弃该项，不牵连其它项，与既有纪律一致）。

### 4.2 写入

`lobby-spec.ts` 的 `buildLobbyPlan()` 增写 `plan.resolution = spec.resolution`。
`LobbySpecDraft.resolution` 类型从 `VideoResolution` 改为 `ResolutionId`。

### 4.3 读取（四处同源）

| 消费点 | 改动 |
| --- | --- |
| `plan-prompt.ts` | 新增一行 `- 清晰度：1080P（1920×1088）——生成工具未显式指定 resolution 时按此兜底；不要为此提问。` |
| `project-row.ts` 的 `planSummaryOf` | 摘要从 `16:9 · 30s` 变为 `16:9 · 30s · 1080P`（项目卡与输入区上下文条自动同源） |
| `generate.ts` | 走 §3 resolver |
| `studio-defaults.ts` | 走 §3 resolver（放手跑自动应答的规格文案随之带来源） |

### 4.4 首页初值与"跟随设置"

`LobbySpecRow` 挂载时，若 `spec.resolution` 仍是默认值（未动过），按设置页 `defaultVideoResolution` 对齐一次 —— 完全照抄 CV-196 对 `mode` 的做法（`modeDirty` → 新增 `resolutionDirty`）。这样首页开局显示的就是"真正会生效的值"，而不是硬编码的 720P。

## 5. 界面消歧规则（这次的重点）

核心原则：**读数必须是生效值，且能看出它是不是继承来的**。

### 5.1 节点输入框卡 chip（`NodeInputCard.tsx:1575-1613 / 1831-1881`）

现在：`promptValueOf(node,'resolution') || '736p'` —— 节点没写时假装是 736p，与实际生效值无关。

改为：

| 节点状态 | chip 文案 | 样式 |
| --- | --- | --- |
| `generationPrompt.resolution` 有值 | `1080P` | 常规实心 |
| 无值，继承项目 | `跟随项目 1080P` | 次级色 |
| 无值，跟随设置 | `跟随默认 720P` | 次级色 |

菜单末项新增 **「跟随项目（1080P）」**（选中 = `commitRaw('resolution', undefined)` 删键，恢复继承）。现在只能改不能清，用户没有"回到继承"的路。

积分估算（`:872`、`:888`）改用同一解析结果 —— 当前会按 720P 多算 6 分。

### 5.2 画布节点角标（`CanvasNode.tsx:385-393`）

`params.resolution ?? '480p'` 改为调 resolver（含 plan / 设置），不再硬编码缺省。角标只显示值，不显示来源（空间不够）。

### 5.3 设置页 / 首次向导（`SettingsModal.tsx:461-494`、`FirstRunSettings.tsx:142-172`）

- 下拉项由表生成：`480P · 864×480` / `720P · 1376×768（推荐）` / `1080P · 1920×1088`，不再出现 `736p` / `2k` 裸键。
- 保留"图片默认 / 视频默认"两个字段（出厂值不同：图片 720P、视频 480P，这个差异是有意为之，不合并）。
- hint 补一句生效顺序：`工具未指定时，先看项目预置，再看这里` —— 现在只说"未指定时按此兜底"，用户不知道项目预置会盖过它。

### 5.4 节点详情抽屉（`NodeDetailDrawer.tsx:33 / 186 / 278`）

把两个概念分栏并改名，避免"档位"与"分辨率"看着像一回事：

| 现在 | 改为 |
| --- | --- |
| 档位（声明值，来自 params） | **声明档位**：`1080P`（来源：项目预置 / 节点指定） |
| 分辨率（`mediaWidth×mediaHeight`） | **真实产物**：`1920×1088`，与声明不一致时追加一行 `档位为上采样，实际细节止于 1376×768` |

### 5.5 术语表（全仓唯一）

| 概念 | 用词 | 禁用 |
| --- | --- | --- |
| 用户在 UI 看到的三档 | 480P / 720P / 1080P | 480p / 736p / 2k / 768p |
| 代码内部键 | `ResolutionId`（同上表的 `id`） | 散落字符串字面量 |
| 后台参数 | `megapixels`（视频）/ `width`+`height`（图片） | 在 UI 出现 |
| 产物真实像素 | `mediaWidth×mediaHeight` | 声明值当真实值 |

## 6. agent 侧

- `host-tools.ts` 的 `RESOLUTION_ENUM` 从 `RESOLUTION_IDS` 派生（当前派生自 `OUTPUT_SIZE` 键，改后自动跟随）。
- `RESOLUTION_PARAM_DESC` / `IMAGE_RESOLUTION_PARAM_DESC` 重写为：
  - 三档真值（像素 + 视频为 megapixels）；
  - **缺省顺序 = 项目预置 > 设置页 > 出厂**（现在是"走设置页"，漏了项目层，agent 因此不知道 plan 的存在）；
  - 显式传参仍是显式覆盖，要求"仅用户明确要求时传"（保留 CV-187/C-8 的既有纪律）。
- skill 侧（`skills/**` 提到清晰度的地方）同步为 480P/720P/1080P 口径；`skills-single-source.test.mjs` 的禁用名表不用改（未涉及档名）。

## 7. 迁移与兼容

| 场景 | 处理 |
| --- | --- |
| 历史节点 `resolution: '736p'` / `'2k'` | 读路径归一为 `720p` / `1080p`，写路径只写新键；节点重试自动升级 |
| 历史节点 `resolution: '720p'`（fal 时代） | 归一到新 `720p`。⚠️ 语义漂移：旧 `720p`≈1280×736，新 `720p`=1376×768，仅影响老节点重试，**记录在案不回填** |
| 老项目 `plan` 无 `resolution` | 视为未锁定 → 落到设置页。零迁移 |
| 历史 `mediaWidth/Height` | 不动（客户端"已有值永不纠正"的既有行为不碰） |
| 已写入 setting 的 `736p` / `2k` | schema 读时归一（`z.union` 收旧键 + 值转换），下次保存写新键 |

## 8. 验收

### 8.1 单测（`tests/resolution-tier.test.mjs` 重写 + 新增）

1. 表自洽：32 倍数、megapixels 与像素一致、label/id/alias 无冲突。
2. resolver 四层：节点 > 计划 > 设置 > 出厂，逐层缺省（每层一条）。
3. 归一：`736p→720p`、`2k→1080p`、`720p(legacy)→720p`、脏值 → 出厂。
4. **一致性守卫（本次的核心）**：同一节点在 `NodeInputCard` / `CanvasNode` / `DetailDrawer` 三处读数派生的值必须相等 —— 直接断言它们调的是同一个 resolver，而不是各写一份 fallback。
5. **反向变异**：删掉 plan 层 → 必须红；把某档 megapixels 改回 0.9 → 必须红；把某处 fallback 写回 `'736p'` → 必须红。

### 8.2 真机 probe（前置条件，不是可选）

`scripts/probe-resolution-tiers.mjs --only video --mp 0.4,1,0.4` 复测 P0-d：
- 1.0 / 2.0 MP 是否被后端接受 → 决定 D1 是否成立；
- 产物真实像素以 **ffprobe** 量为准，不采信响应声明；与表逐档比对。
- 图片侧三档已实测通过（`docs/api-probe/resolution-tier-*`），只需补 `1376×768` 一次确认。

### 8.3 UI 验收路径（桌面）

1. 设置页选「视频默认 720P」→ 回首页，chip 显示 `16:9 · 720P`（不是硬编码值）。
2. 首页改 1080P → 发一句话 → 项目卡副行出现 `… · 1080P`；agent 首轮回复不再问清晰度。
3. 打开该项目的视频节点：chip 显示 `跟随项目 1080P`；画布角标同为 1080P。
4. 节点 chip 改成 480P → 角标即时 480P；菜单选「跟随项目（1080P）」→ 回到 1080P。
5. 出片后详情抽屉：声明档位 1080P / 真实产物 1920×1088（若上采样则给出提示）。
6. 设置页改成 480P 后新建第二个项目 → 首页初值变 480P，第一个项目（plan 已锁 1080P）不受影响。

## 9. 待拍板（**已于 2026-10-27 拍板：D1=A、D2=A**，见 §11.1）

**D1 · 720P 档的真值取哪个？**
- **A（推荐）**：对齐 H3 官方表 → `megapixels 1.0` / `1376×768`。理由：0.9 是我们自己插的值，不在任何官方表内，且 `api.md` 两处已经互相矛盾；后台唯一旋钮就是 megapixels，填非表值等于赌后端行为。
- **B**：保持现状 `0.9` / `1280×736`。代价：`api.md` 必须统一改成 0.9 并注明"非 H3 表值，由本仓自定义"，且仍需 probe 证实。
- A 需要先跑 §8.2 的 probe；若后端拒收 1.0，则退回 B 并把三档降为"仅 480p 真实生效"（那时更该在 UI 上标明白）。

**D2 · 内部键是否改名？**
- **A（推荐）**：`480p / 720p / 1080p`（与显示名同形），旧键归一。代价：12 个测试文件 + 5 个源文件更新，且老 `720p` 节点重试会变档（记录在案）。
- **B**：保留 `480p / 736p / 2k`，只统一显示与真值。代价：`736p` 这个键在真值是 1376×768 之后彻底名不副实，成为新的歧义源。
- 与 D1 联动：若 D1 选 A，D2 必须选 A（否则 `736p` = 1376×768 无法自洽）。

## 10. 实施顺序（每步独立可验，不合批）

| 步 | 内容 | 验证 |
| --- | --- | --- |
| S0 | probe 三档 megapixels（前置） | ffprobe 产物 vs 表 |
| S1 | 建 `resolution-tiers.ts` + `resolution-resolve.ts`，旧两模块改为派生（行为不变） | 全量 `test:smoke` 绿 |
| S2 | 生成链切到 resolver；`plan.resolution` 契约 + `lobby-spec` 写入 + `plan-prompt` / `planSummaryOf` | 单测 §8.1-2/3 |
| S3 | 三处 UI 读数切到 resolver + "跟随"语义 + 菜单"跟随项目"项 | 单测 §8.1-4 + UI 验收 1-4 |
| S4 | 设置页/详情抽屉文案与命名收口；agent 描述重写 | UI 验收 5-6 + `tool-presentation` |
| S5 | 删旧表、清理字面量、STATUS 登记 | 反向变异 3 条各自红 |

**回滚**：S1-S2 是纯内部重构，S3 起才改用户可见行为 —— 出问题按步回退，不需要数据回滚（历史数据未被改动）。

## 11. 实施记录（2026-10-27）

### 11.1 拍板结果

- **D1 → A**：720P 档对齐 H3 官方表 `megapixels 1.0` / `1376×768`。原 `0.9` / `1280×736` 作废（只在 `deprecatedAliases` 里承认 `736p`）。
- **D2 → A**：内部键改为 `480p / 720p / 1080p`，与显示名同形；`736p` → `720p`、`2k` → `1080p` 读路径归一。

### 11.2 落地清单

| 层 | 文件 | 结果 |
| --- | --- | --- |
| 唯一事实源 | `src/resolution-tiers.ts`（新） | 三档 = id / label / megapixels / frames / costMeta / deprecatedAliases |
| 唯一决策 | `src/resolution-resolve.ts`（新） | `resolveResolution()` 四层 + `source`；四层脏值逐层丢弃不阻断 |
| 派生视图 | `src/output-size.ts` / `src/resolution-display.ts` | 从表派生 `OUTPUT_SIZE` / `MEGAPIXELS_BY_RESOLUTION` / `RESOLUTION_DISPLAY` / `RESOLUTION_OPTIONS` |
| 生成链 | `src/generate.ts` | `resolutionOf()` 委托 resolver，三处调用点传 `plan.resolution`（含恢复结算路径） |
| 项目级配置 | `src/contracts/project.ts` / `src/lobby-spec.ts` / `src/plan-prompt.ts` / `src/project-row.ts` | `plan.resolution` 恒写；提示词写明「已锁定，不要再传 resolution」；项目卡摘要带档位 |
| 设置页 | `src/host-config.ts` / `src/client/SettingsModal.tsx` / `src/client/FirstRunSettings.tsx` | schema 收规范键 + 历史别名；两个下拉由 `RESOLUTION_OPTIONS` 派生（`720P · 1376×768`） |
| 三处读数 | `NodeInputCard.tsx` / `CanvasNode.tsx` / `NodeDetailDrawer.tsx` | 全走 resolver；chip 显示「跟随项目 1080P / 跟随默认 720P」，菜单含「跟随项目 / 默认」= 删键 |
| 供应商映射 | `src/providers/fal.ts` | `720p → 768P`（fal 没有 736P 枚举，旧写法会被 422）；`1080p → 2K` |
| agent 文案 | `src/host-tools.ts` / `src/remotion/resolution-check.ts` / `skills/**` | 三档 + 真实像素 + 缺省顺序「项目预置 → 设置页 → 出厂」；不再把任一档标成「默认」 |

### 11.3 验证证据

- **类型 / 构建**：`tsc -p tsconfig.json`、`tsc -p tsconfig.client.json --emitDeclarationOnly`、`tsdown`、`verify:loader` 全绿。
- **单测**：`tests/resolution-tier.test.mjs` 重写为 20 条（H/D/E/F/B/R/A/K/M/L 十组），除 2 条需删临时目录的用例在本机受限环境报 `EPERM` 外全绿。
- **反向变异（3/3 生效）**：
  1. `720p.megapixels` 改回 `0.9` → H 组红；
  2. 删掉 resolver 的 plan 层 → R 组（两条）红；
  3. `CanvasNode.tsx` 把 resolver 换回 `'480p'` 字面量 → M 组红。
- **后端契约（openapi 实拉 2026-10-27）**：`image2videofl2va` / `image2videoref2va` 的 `megapixels` 均为 `{"type":"number","default":0.4}` —— **无 enum、无范围约束** ⇒ `1.0` 不会 422；且后端自身缺省 0.4 与本仓「视频出厂 480P」一致。

### 11.4 仍未做（验收前置）

1. **真机 probe**（§8.2）：引擎是否真按 `1.0 MP` 出 `1376×768`。openapi 只证明「不会被拒」，不证明「真按此出图」。若静默回退 0.4，`720P` 这个称呼就仍是假的 —— 这是本方案唯一还剩的实质风险。
2. **桌面 UI 验收**（§8.3 六步）。
3. STATUS 登记 / CV 取号：按项目铁律「验收通过后才登记」，本批未登记。

---

## 12. 二次拍板（2026-10-27 下午）：首页只管视频 + 图片下限 720P + 升档通道

### 12.1 用户拍板原话与结论

| 问题 | 拍板 |
|---|---|
| 视频默认流程 | **不做两遍制主干**：按用户选的档位直出，没选就用 480P。升档是**事后显式动作**，UI 给入口即可 |
| 升档后的产物 | **原地覆盖**（复用 `retryOf` → `overwriteNodeAsset`），不保留旧版 |
| 谁触发升档 | 画布 UI + agent 工具**两者都提供** |
| 图片档位 | **下限 720P**（480P 只给视频）；设置页「图片默认分辨率」保留 |
| 首页清晰度 | **写明白是给视频用的**；图片不需要在首页选分辨率，只在图片编辑处保留 |

### 12.2 由此推翻 §4/§5 的三处旧口径

1. **`plan.resolution` → `plan.videoResolution`**。语义从「项目统一档位」收窄为「项目**视频**档位」。
   改名成本近乎为零：该字段是当日上午才加的，存量项目 plan 里根本没有这个键。
   `normalizePlan` 仍兼容读旧键（新键优先），写路径只写新名。
2. **图片不再读项目预置**。图片缺省链从四层变三层：`节点 > 设置页图片默认 > 出厂 720P`。
   生成链用 `resolutionOf(params, kind, planVideo)` 硬切（图片分支结构上传不进 plan），
   客户端用 `resolutionInheritFor(kind)` 硬切，`resolveStudioDefaults` 的 image 分支不传 `planValue`。
3. **`ResolutionScope` 去掉 `project`**。既然 plan 只管视频，项目预置视图就等于视频视图，
   多一个 scope 只是多一个概念。

### 12.3 首页「跟随默认」

用户拍板「没选就用 480P」，但首页原本恒写 plan ⇒「永远都有选择」，480P 走不到。
改法：`buildLobbyPlan` **只在 `resolutionDirty === true` 时**写 `plan.videoResolution`；
首页菜单首项「跟随默认 · 480P（设置页）」把它拨回 `false` 并重新对齐设置页值；
chip 读数显示 `16:9 · 默认 480P`（vs 显式选择 `16:9 · 720P`）。
`DEFAULT_LOBBY_RESOLUTION` 也从 720P 改成 `DEFAULT_VIDEO_RESOLUTION_ID`（480P）。

### 12.4 升档通道（实现）

| 层 | 落点 |
|---|---|
| 纯函数 | `resolutionUpgradeTargets(current, aspect)` —— 只列**严格更高**的档，像素按节点**当前画幅**算（9:16 显示 768×1376） |
| UI（节点卡） | 视频节点清晰度菜单底部「升档重出」分组：`升 720P 重出 · 1376×768`。点击 = `withGenerationParam(raw,'resolution',target)` → `updateNode`（进撤销栈、落盘）→ `onRetry`（`retryOf` 原地覆盖）→ 关面板 |
| UI（详情抽屉） | 沿用既有「用当前保存的参数重新生成一版」按钮；改档入口在节点卡上，避免为多一个按钮加三层 props |
| agent | 新工具 `video_rerender({ nodeId, resolution })`：读节点 `generationPrompt` 快照 → 覆盖 `resolution` → `retryOf` 重放。**不让 agent 复述 prompt**（IR 简报一复述就漂） |

**为什么是「先写参数再重放」而不是「重放时覆盖」**：`retryStudioNode` 刻意不收 overrides
（`api.ts:966` 注释：那会造出第二条改参数的路，且改完不留痕）。保留该纪律。

**顺序是硬约束**：`retryNode` 从 store 快照取节点，`updateNode` 必须在前（immer draft 同步生效）。

### 12.5 顺手修的一个真 bug

`generate.ts` 的落位分辨率预对账原本不传 baseline，走写死的 `DELIVERY_BASELINE = 1280×720`。
480P 成为正式默认后，**纯 480P 项目的每一镜都会误报**「素材 864×480 低于 1280×720 基线，上采样 1.5×」——
而成片本来就是 864×480。改为按 `plan.videoResolution` 判，**项目没声明就不判**（宁可漏报不误报：
一条永远为真的提示会让 agent 学会无视整条体检，与 ML-10 同类代价）。

### 12.6 验证

- `tests/resolution-tier.test.mjs` 新增 N1~N5 五条：适用范围 / 升档候选（含竖屏像素）/ 下拉存量兜底 / `videoResolution` 改名与旧键兼容 / 图片不读预置。
- **反向变异 3/3 生效**：`480p.scopes` 改回 `['image','video']` → N1+N3 红；`resolutionUpgradeTargets` 的 `>` 改成 `>=` → N1+N2+N3 红；`studio-defaults` 的 image 加回 `planValue` → N5 红。
- 同步改：`lobby-spec`（默认 480P / 条件写 plan / chip 加「默认」前缀）、`tool-registry`（工具数 32→33、名单加 `video_rerender`）、`tool-presentation`（展示行）、`canvas-input-card-req029`（派生断言按 scope 改）、`generate.test.mjs`（图片默认 720P ⇒ 1376×768）。

### 12.7 仍未做

1. 真机跑一次「480P → `video_rerender` 720P」，确认像素与画面漂移程度（这是「升档不是放大」这条告知文案的唯一实证）。
   **2026-10-27 晚尝试过、被后端挡住**：`megapixels=1` 与对照组 `megapixels=0.4`（现状对所有视频请求发的值）
   同报 502「上游 ComfyUI `/prompt` 400」，耗时 84 / 95ms，前后 health 均 200 —— 是**后端 H3 工作流故障**，
   不是档位被拒。详见 `docs/api-probe/video-megapixels-regression-20261027/report.md`。后端恢复后成对复跑。
2. STATUS / CV 取号（同 §11.4）。

> 2026-10-27 收尾补记：~~详情抽屉的停用档提示~~ 已补 —— `NodeDetailDrawer` 的「声明档位」对
> 存量图片节点（存着 `480p`）追加「（该用途已停用）」，判据 `isResolutionIdFor(value, scope)`，
> 与节点卡同一个纯函数，不另写一套判断。同批补了 `toolchain.md` 的 `video_rerender` 表格行
> （`skill.test.mjs` 要求**表格行**而非「文中提过」，与 `docs/canvas-studio-tools.md` §A9.1 配对），
> 以及 `docs/canvas-studio-tools.md:149`、`docs/api.md:297` 两处仍写着「图片缺省走项目预置」的旧口径。

