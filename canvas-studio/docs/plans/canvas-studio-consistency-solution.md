# Canvas Studio 一致性解决方案 v1

> 2026-09-07 · 基于《canvas-studio-continuity-research.md》调研产出。
> 目标：把跨镜头一致性从「prompt 软纪律」升级为「**数据锚点 → 流程强制 → 生成后校验**」的闭环，同时保持最小改动、最大化复用现有接口。

---

## 1. 问题定义

多片段拼接成片时的四类割裂中，本方案聚焦**主体漂移**（同一角色/场景在不同镜头样子漂移）与**镜头衔接**（镜头间接不上），并覆盖**风格统一**的合成端兜底。BGM 连续性属于独立工作流（audio-first 卡点），仅在 §6 给出挂接点。

现状核心缺口：
- 角色资产只是 `isReference` 节点标签（`contracts/canvas.ts:122-127`），无结构化资产卡；
- 「三视图」有真接口（drama-api `image2character`，api.md:214-247）但未接线，skill 用 image_generate prompt hack 模拟（`creation-spec.ts:124`）；
- 无尾帧链：视频片段间没有像素级衔接机制；
- 无生成后校验：漂移只能靠人眼逐镜看。

---

## 2. 设计原则

1. **最小改动**：不动生成后端（drama-api）、不动视频模型选型，全部在 canvas-studio 接线层与 skill 流程层解决。
2. **复用现有机制**：资产卡复用 canvas.json 持久化（`StudioCanvasDocument`，canvas.ts:131）；尾帧链复用 P8.4 视频抽帧模式（`StudioVideoFramePayload`，canvas.ts:190-197）；质检复用 `image2vl` 视觉理解工具（host-tools.ts:336）。
3. **软硬结合**：数据层保证锚点存在（硬），prompt 纪律保证注入正确（软），质检兜底（闭环）。
4. **HITL 不回退**：资产卡构建仍走 stop-and-confirm，符合既有交互约定。

---

## 3. 总体架构：三层防漂移 + 两层保连贯

```
【生成前·锚定】  定妆照 → character_sheet(四视图) → splitegrid 切分 → 资产卡 StudioAsset
                 （角色卡 = 独立分图锚点 + 锁定 SAME 块文本）        ↓ 确认门禁
【生成中·锁定】  逐镜生成强制注入：锚点分图 filenames + SAME 块逐字节复用
                 （image_generate ≤3 图 / ref2va ≤6 图，机制已有 generate.ts:432-514）
【生成后·校验】  image2vl 一致性自检：镜头图 vs 角色卡 lockedPrompt → PASS/FAIL
                 FAIL → 只重跑该镜（surgical re-run，sourceIds 血缘保上游）
─────────────────────────────────────────────────────────────
【衔接·保连贯】  shotTransition 语义：chain → 自动提取上镜真实末帧作下镜首帧
                 cut → 只挂角色/风格锚点 + 硬切；bridge → 复用 FL2VA 书挡
【合成·保统一】  compose 统一调色 pass + BGM 单轨贯穿（P1 已立项项）
```

---

## 4. 详细设计

### 4.1 资产卡 `StudioAsset`（数据层）

`contracts/canvas.ts` 扩展（v3 → v4，带迁移）：

```ts
/** 项目级一致性资产卡：角色 / 场景 / 风格的锚点注册表。 */
export interface StudioAsset {
  id: string
  name: string
  role: 'character' | 'scene' | 'style'
  /** 视觉锚点：character_sheet 切分后的独立分图节点 id（正/侧/背/全身）。 */
  anchorNodeIds: string[]
  /**
   * 锁定 SAME 块：外貌/服装/光感的固定描述文本，
   * 组装镜头 prompt 时逐字节复用（Veo 3.1 实践：byte-for-byte identical）。
   */
  lockedPrompt: string
  /** 负面约束（如「不更换服装」「不摘眼镜」），注入 prompt 约束段。 */
  negativePrompt?: string
  createdAt: number
}

// StudioCanvasDocument 增加：
assets?: StudioAsset[]   // 缺省视为空（旧文档兼容，无需强制迁移数据）
```

节点增两个可选字段（缺省即旧行为）：

```ts
/** 归属资产卡 id（character_sheet 产物节点、采纳该锚点的镜头节点携带）。 */
assetId?: string
/** 镜头衔接语义（kind=video 的节点）：chain=与上一镜同场景连续；cut=跨时空硬切。 */
shotTransition?: 'chain' | 'cut'
```

**为什么不用重实体库**：现有参考托盘 + `filename` 句柄 + `list_references`（canvas.ts:117-121 注释）已经是完整的「参考图发现→注入」链路；资产卡只是在这条链路上加一层「聚合 + 锁定文本 + 归属」，不另起炉灶。

### 4.2 `character_sheet` 工具（生成层·锚点产出）

即 phase2 P11 待办（phase2.md:177,296）的落地形态：

1. `config.ts` 增加 `image2character: '/api/v1/generate/image2character'`；
2. `host-tools.ts` 注册 `character_sheet` 工具：
   - 入参：`filename`（定妆照/角色设计图的 Drama 文件名）；
   - 步骤：调 image2character → 得单张白底四视图 → 自动调 `image2splitegrid`（config.ts:29，接口已有）切分为独立分图 → 逐张落画布节点（`operationType: 'character-sheet'`，标签/边颜色已备好，CanvasNode.tsx:29）→ 返回分图节点列表；
   - 产物节点带 `filename` + `referenceRole: 'character'`，自动进入参考托盘。
3. 工具输出中附分图清单，agent 据此建/更新资产卡（写入 `assets`）。

> ⚠️ 前置验证项：image2character 与 image2splitegrid 均未在本机联调过，C1 第一周先打真接口验证四视图布局与切分网格参数是否匹配。

### 4.3 SAME 块锁定与注入纪律（生成层·流程强制）

- 资产卡建立时，agent 依据定妆图+用户确认生成 `lockedPrompt`（格式：`[SAME CHARACTER: …外貌/发型/服装/配色…] [SAME LIGHT: …]`），**用户确认后冻结**；
- skill 流程（`creation-spec.ts`）第 6/9 步改为：**凡镜头涉及某资产卡，prompt 必须以其 `lockedPrompt` 开头逐字节复用，只改 NEW ACTION / CAMERA 段**；参考图优先取 `anchorNodeIds` 的分图（≤3 图走 image_generate / ref2va 机制不变）；
- `list_references` 输出增加资产卡信息（卡名/角色/锚点分图），让 agent 无需记忆画布历史即可拿到锚点。

> **C2 落地决策（2026-09-07，CV-104，用户拍板）**：注入纪律走**纯 skill 层**，不在 Host 生成链路强制前置 lockedPrompt。理由：视频侧 H3 六段式要求 `subject_definitions:` 居首，Host 无条件前置会破坏 prompt 结构；且强制造成本期收益不明。逐字节一致改由两条硬约束保证 —— ① 总纲写明「每镜 prompt 以 lockedPrompt 原样开头 / 视频侧 subject_definitions 逐字复用」；② `list_references.assets` 是锚点与冻结描述的**唯一权威来源**，agent 每回合先查再写。资产卡纠错路径 = `character_sheet` 传同名整体覆盖（`resolveAssetSlot` 复用 id + `releaseAssetNodes` 摘除失效锚点）。

### 4.4 镜头衔接：尾帧链 + 衔接语义（衔接层）

- **`extract_last_frame` host 工具**：入参视频节点 id，ffmpeg 提取真实末帧（**必须是生成产物的末帧，不是分镜图**——deepwiki 案例的核心工程结论），按 P8.4 `StudioVideoFramePayload` 模式落画布（url + filename 直接可作下镜输入）；
- **衔接语义**：agent 在分镜规划时为每镜标注 `shotTransition`：
  - `chain`（同场景连续动作）：上镜末帧 → 下镜首帧（fl2va），或作为 ref2va 首参考；像素级无缝；
  - `cut`（跨时空剪辑）：不链帧，只挂角色/风格锚点 + 硬切（可叠音效遮切点，P1 音效层）；
  - `bridge`（同场景大跨度）：复用现有 FL2VA 首尾帧书挡（generate.ts 已支持）；
- compose.ts 无需改动——衔接发生在生成阶段，concat 只负责拼。

### 4.5 生成后校验：`image2vl` 一致性 gate（质检层）

- 复用 `image2vl`（host-tools.ts:336，入参 filename + prompt，返回文本）：
  - 对每张逐镜关键帧调用，prompt = 资产卡 `lockedPrompt` + 判定标准（「画面主体是否符合以下角色描述：…。逐项回答发型/服装/配色/体型是否符合，最后输出 PASS 或 FAIL」）；
  - 视频 shot 抽首末帧各验一次（抽帧能力 P8.4 已有）；
- FAIL → agent 定位漂移元素（改锚点分图/重生成该镜），**只重跑该镜**——画布 `sourceIds` 血缘（canvas.ts:70）保证上游连接不丢，node 级 retry 机制（runId，canvas.ts:66）天然支持；
- 每镜重跑预算默认 2 次，超限上报用户仲裁（HITL）。

### 4.6 合成端兜底（合成层，P1 挂接）

- **统一调色 pass**：`compose.ts` 的 `buildTranscodeArgs`（compose.ts:107）增加可选统一 `eq` 滤镜（项目级常量，v1 提供中性默认或关闭），治「各镜色调漂移」；
- **BGM 单轨贯穿**：现有 amix（compose.ts:262-291）增强淡入淡出；audio-first 卡点工作流另行立项（见调研稿 §2.3）。

---

## 5. Skill 流程改造（creation-spec 10 步的插入点）

| 步骤 | 现状 | 改造后 |
|---|---|---|
| 4 参考图预处理 | prompt hack 模拟三视图（:124） | **替换**：定妆照 → `character_sheet` → 切分分图 → **stop-and-confirm 资产卡（lockedPrompt 确认后冻结）** |
| 5 定妆锚点 | image_generate 生成（:125） | 采纳资产卡锚点分图为全片锚点 |
| 6 逐镜出图 | 手动挂参考（:126） | 强制：lockedPrompt 开头逐字节复用 + anchorNodeIds 分图注入 + 出图后过 image2vl gate |
| 9 逐镜视频 | 手选生成方式（:129） | 增加分镜规划时确定的 `shotTransition`：chain 镜先调 extract_last_frame |
| 10 合成 | compose_video（:130） | 不变；调色 pass 默认开启 |

---

## 6. 分阶段实施计划

### C1 资产锚点（约 2-3 天）
- 改动：`config.ts`（+1 端点）、`host-tools.ts`（character_sheet 工具）、`contracts/canvas.ts`（StudioAsset + v4 迁移）、Host 持久化读写 assets。
- 前置：真接口联调 image2character + splitegrid。
- **验收**：上传定妆照 → 对话触发 character_sheet → 画布出现四视图 + 分图节点（referenceRole=character，进参考托盘）→ 重启画布 assets 仍在；`corepack yarn check` 全绿。

### C2 注入纪律（约 1-2 天）— **已落地（CV-104，2026-09-07，待桌面验收）**
- 改动：`creation-spec.ts` 流程改造、`list_references` 增强。
  - 落地形态（本仓库总纲 skill = `skills-local/canvas-studio-creation/SKILL.md`，非 `creation-spec.ts`）：新增「一致性资产卡与注入纪律」节 + 第 4/5/6/9 步改造；`list_references` 增 `assets` 段；`character_sheet` 同名覆盖。
- **验收**：让 agent 生成同一角色两个镜头，对比两镜 `generationPrompt`：SAME 块逐字节一致、参考图句柄同源；跨会话新对话 agent 仍能经 list_references 拿到锚点。
  - 此项与 C1 同受 drama-api 可用性阻塞，待恢复后一并真机验收。

### C3 尾帧链衔接（约 2 天）
- 改动：host 新增 `extract_last_frame`（复用 ffmpeg 依赖与 P8.4 落库模式）、节点 `shotTransition` 字段、skill 第 9 步改造。
- **验收**：规划两段 chain 镜头 → 第二段首帧与第一段末帧像素一致（抽帧比对）；cut 镜头不链帧；`shotTransition` 落盘。

### C4 质检闭环（约 1-2 天）
- 改动：skill 增加逐镜 image2vl 自检步骤与重跑预算逻辑（**零产品代码**，纯 skill 层）。
- **验收**：故意用弱参考生成一个漂移镜头 → agent QC 报 FAIL 并只重跑该镜；PASS 镜头不被重生成。

### C5 合成统一（挂 P1，另行排期）
- compose 调色 pass、BGM 淡入淡出、音效层遮切点。

依赖关系：C1 → C2 → C3/C4（可并行）→ C5。

---

## 7. 风险与开放问题

1. **接口联调未知数**：image2character 的四视图布局与 splitegrid 网格参数是否匹配，C1 首日必须先验证；若切分不稳，退化为「整张四视图直接作单锚点」（业界 api.md:317 的 prompt 示例即此用法，可用但次优）。
2. **VLM 判定边界**：image2vl 单图 + 文本描述的 PASS/FAIL 判定依赖 prompt 工程，初期误判率高时降级为「提示用户人工确认」而非自动重跑。
3. **资产卡 UI**：本期资产卡只存在于数据层 + 参考托盘 + 对话流，不做画布资产面板（避免过度工程）；若用户反馈需要可视化管理，二期加。
4. **多角色同镜**：ref2va ≤6 图上限支持 2-3 角色卡同镜注入，但多参考加剧漂移（Astorie 经验），策略：主角强参考、配角轻参考，效果待实测。
5. **衔接语义谁定**：v1 由 agent 在分镜规划时标注、分镜审批时用户可见可改；是否升级为节点 UI 字段（边上的类型标记）待 C3 后评估。

---

## 8. 方案 ↔ 调研映射

| 方案组件 | 借鉴来源 | 复用的现有设施 |
|---|---|---|
| StudioAsset 资产卡 | Runway one-reference-everywhere；domer character bible | canvas.json 持久化、参考托盘、list_references |
| character_sheet 工具 | Vidu Q3 多角度参考组 | image2character + image2splitegrid（均已有接口） |
| SAME 块逐字节复用 | Veo 3.1 extension prompt scaffold | creation-spec H3 规范 |
| 尾帧链 | Veo 3.1 Scene Extension + deepwiki extract-last-frame | P8.4 视频抽帧落库模式、FL2VA |
| 一致性 gate | Astorie surgical re-run；shot 级 review | image2vl、runId 节点重试、sourceIds 血缘 |
| 统一调色 | CapCut 统一 grade；复现元素法则 | compose.ts buildTranscodeArgs |
