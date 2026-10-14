# Remotion 集成开发文档（实现规格 v1）

> **文档定位**：本文件是 Remotion 集成（REQ-034）的**唯一实现事实源**——契约、决策、口径均以本文为准。`remotion-integration-roadmap-2026-10-13.md` 是早期路线图，已被本文取代（其顶部有口径声明）。精确到文件、函数、类型定义、测试门禁与代码骨架。
>
> **配套可视化参考**：`remotion-integration-demo.html`（已交付，可离线打开）。本文中凡标注「见 demo §X」之处，都对应 HTML 里可点击的那一屏。建议边读文档边对照 HTML 看流程。
>
> **阅读顺序**：§1 定调 → §2 架构（对照 demo §1）→ §4 数据契约（对照 demo §2）→ §6 核心工具（对照 demo §3）→ §11 插入点表（对照 demo §3）→ §13 阶段计划 → §14 缺口（对照 demo §4）→ §17 结论（对照 demo §5）。

---

## 0. 阅读前的三个既定事实（已核实，不再讨论）

1. **许可零成本**：Remotion Free License 覆盖「个人 + 3 人及以下公司」，仅 4 人及以上触发 Company License（$100/月起）。本项目是**两人公司**，商业使用、全功能、无限量均免费。用 LLM 生成 Remotion 代码并自行渲染被官方明确允许。
2. **集成策略：并联旁路，不替换主干**。Remotion 不会动现有的 `compose_video`（ffmpeg concat 合成）链路，而是在 `createStudioTools()` 里**新增一个 `render_composition` 工具**，返回一个**与 `compose_video` 同形状**的结果。客户端 / agent / 画布节点零改动。
3. **80% 地基已具备**。agentic skill 体系、Drama 模型层、ffmpeg 后期、storyboard 契约、审批门、统一错误系统、资产路由全部现成，Remotion 只补最薄的"逐帧渲染 + 卡片组件"一层。

---

## 1. 目标、范围与许可结论

### 1.1 目标（REQ-034 最小闭环）
为 Canvas Studio 增加"代码驱动合成"能力，先覆盖**低成本科普 / 教育视频**的刚需：
- 字幕卡（subtitle / lower-third）
- 数据卡（data card：图表、数字、要点列表）
- 图文幻灯片（Ken-Burns 图片 + 解说）
- 简单转场（淡入淡出 / 滑入 / 缩放）
- 旁白 / BGM 混音（复用现有 ffmpeg 混音）

### 1.2 范围外（明确不做，避免 scope creep）
- ❌ 复刻 Remotion 全功能引擎（完整 React reconciler + WebGL + 分布式云渲染）。这层直接用免费 Remotion，不自研。
- ❌ LLM 动态生成 Remotion 组件 JSX 并沙箱化 `eval` 执行（agentic 但风险高，留作二期）。
- ❌ 云端批量渲染集群（单机 / Electron 内渲染即可，集群留待商业规模再议）。
- ❌ **词级字幕同步**（KTV 式逐词高亮）。MVP 为**句级字幕**，时序按 §10.3「探真值总时长 + 字数比例分配」派生；词级依赖 TTS 时间戳 / forced alignment（现状 Drama TTS 不返回任何时间戳，已核实），列二期。

### 1.3 许可结论（见 §0 事实 1）
- 免费档内，无 License 代码改动需求。
- 唯一禁区（与本项目模式无关）：不允许让用户上传自有 Remotion 工程到你的服务去渲染。本项目是"AI 生成 + 自己渲染"，不涉及。
- **留证动作（阶段 0）**：把当时官网 License 原文快照存档进 `docs/`——License 条款可变，产品需保留"当时版本被 Free 覆盖"的证据。

### 1.4 验收成功标准（MVP）
> 一个 skill（`code-driven-explainer`）能在 HITL 确认后，把一段"剧本 + 一组模型生成的 clip / 图片"变成一个**带字幕卡、数据卡、转场、混音的成片节点**落画布，全程复用现有审批门与质量校验，且不破坏任何现有 `compose_video` 相关测试。

---

## 2. 架构总览（见 demo §1 流程总览）

### 2.1 现状流水线（A 路，不动）
```
Agent / Skill
  → 模型工具(video_generate / video_composite / image_generate / music_generation / tts_voiceover)
  → Drama 后端（config.ts 解析的 dramaApiBase）或 fal
  → clip / 图片 / 音频 素材节点落画布
  → compose_video（Host 侧 ffmpeg concat + 混音，compose.ts）
  → 成片 video-composite 节点（appendComposedVideoNode）
```

### 2.2 集成后流水线（B 路，新增，绿色描边）
```
Agent / Skill（code-driven-explainer）
  → 产出 CompositionManifest（结构化 JSON，见 §4）
  → render_composition（Host 侧新工具）
       ├─ Remotion bundle（webpack 单独打包 React 组件）
       ├─ Headless Chromium 逐帧渲染（设 --remotion-frame，React 重渲染，截图）
       └─ 复用 resolveFfmpegPath() 的随包 ffmpeg 编码 H.264 + 复用混音
  → 同形状 ComposeResult → 同 appendComposedVideoNode 落画布
```

### 2.3 关键设计原则（落代码时逐条遵守）
| 原则 | 落地做法 | 现有锚点 |
|---|---|---|
| 新工具返回同形状结果 | `render_composition` 复用 `ComposeResult` + `renderComposeResult` | `compose.ts:63` / `host-tools.ts:67`（`resultSchema`）、`:250`（`renderComposeResult`） |
| 复用随包 ffmpeg 编码 | 把 `resolveFfmpegPath()` 结果传给 `renderMedia({ ffmpegExecutable })` | `ffmpeg-run.ts:128` |
| 复用资产路由 | 素材经 `urlToAssetPath` 反查本地路径 → 方式 B 暂存 publicDir（§8）；webServer 资产路由是 URL 的来源 | webServer `/canvas-studio/assets/<projectId>/<file>`（routes.ts:946） |
| 复用 storyboard 契约 | Manifest 由 skill 在 storyboard 落地后派生，不另起 YAML | `contracts/storyboard.ts` |
| 复用 HITL 审批门 | `render_composition` 调 `assertApprovalAllowed` 同 compose_video | `host-tools.ts:718`（定义，文件私有）/ `:2303`（compose_video 调用点） |
| 复用质量校验 | 产物经 `runShotQc` 同路径 | `quality-check.ts:217` |

### 2.4 模块依赖（文字图）
```
createStudioTools (host-tools.ts:1270)
  ├─ compose_video         [现有，不动]
  └─ render_composition    [新增] ──┬─> manifest.ts        (校验 CompositionManifest)
                                     ├─> remotion/           (TSX 组件库 + Root.tsx + index.ts)
                                     ├─> remotion-render.ts  (renderMedia 封装)
                                     ├─> fonts.ts           (字体解析/缓存/fallback，§8)
                                     ├─> resolveFfmpegPath   [复用 ffmpeg-run.ts]
                                     ├─> appendComposedVideoNode [复用 compose.ts]
                                     └─> runShotQc           [复用 quality-check.ts]
```

---

## 3. 现有地基盘点（不重造，直接复用）

| 能力 | 文件:行 | 复用方式 |
|---|---|---|
| 工具注册框架 `createStudioTools` / `defineTool` | `host-tools.ts:1270` / `:1284` | 新工具镜像 `compose_video` 加进返回数组 |
| 成片结果形状 `ComposeResult` | `compose.ts:63` | 直接作为 `render_composition` 的输出形状 |
| 成片落节点 `appendComposedVideoNode` | `compose.ts:628` | 渲染产物复用此函数落 video-composite 节点 |
| ffmpeg 解析 / 执行 / 超时强杀 | `ffmpeg-run.ts`（全文件） | 编码与混音复用，零新依赖 |
| 随包 ffmpeg 路径 `resolveFfmpegPath` | `ffmpeg-run.ts:128` | 传给 `renderMedia` 的 `ffmpegExecutable` |
| 资产 URL→本地路径 `urlToAssetPath` | `compose.ts:118` | 反查 clip / 图片本地绝对路径，喂 Remotion `publicDir` |
| Drama 模型驱动层（fl2va / ref2va / txt2speech） | `config.ts:62-84` | 素材生成继续走现有工具，Remotion 只管合成 |
| storyboard 契约 | `contracts/storyboard.ts` | Manifest 的"素材清单"由此派生 |
| 审批门 `assertApprovalAllowed` | `host-tools.ts:718`（定义，未导出；compose_video 调用点 `:2303`） | `render_composition` 在 `host-tools.ts` 同文件内直接调，无需改导出 |
| 统一错误系统 `throwError` / `error-system.ts` | 全局 | 渲染失败走中文错误码，不裸 throw |
| 质量校验 `runShotQc` | `quality-check.ts:217` | 成片复用镜头质检 |
| 音频时长探测 `probeMediaDuration` | `ffmpeg-run.ts:299` | 句级字幕时序派生：探旁白真值总长（§10.3） |
| 资产路由（webServer） | `routes.ts:946`（`/canvas-studio/assets` 前缀注册） | 产出同源资产 URL；渲染前经 `urlToAssetPath` 反查本地路径喂 publicDir（方式 B，§8） |

---

## 4. 数据契约：CompositionManifest（见 demo §2 数据处理）

### 4.1 设计原则
- **成片结构显式化**：把"哪些素材、在什么时间、以什么形态出现"写成结构化 JSON。这是 OpenMontage 模式的核心，也是当前 `compose_video`（只收 clipIds 数组）缺失的能力。
- **不复刻 OpenMontage 的 YAML manifest**：现有 storyboard 契约已成熟，Manifest 是 storyboard 的"渲染层派生"，不是第二套事实源。
- **纯数据、可校验、可序列化**：skill（LLM）产出 JSON 字符串 → 宿主 `manifest.ts` 校验 → 通过才渲染。

### 4.2 TypeScript 类型定义（落地文件：`src/remotion/manifest.ts`）
```ts
// src/remotion/manifest.ts

/** 成片顶层 Manifest（render_composition 的唯一入参结构）。 */
export interface CompositionManifest {
  /** 唯一 id（用 newAssetId() 生成，便于血缘与重试）。 */
  id: string
  meta: ManifestMeta
  /** 时间轴轨道（按 startFrame 排序后渲染；多轨同帧按数组顺序叠放）。 */
  tracks: CompositionTrack[]
  /** 音频层（可选；复用现有 ffmpeg 混音语义）。 */
  audio?: ManifestAudio
  /** 全局样式（字体 / 主题 / 品牌色）。 */
  global?: ManifestGlobal
}

export interface ManifestMeta {
  title: string
  /** 输出像素（与 sizeForAspectRatio 对齐，16:9 默认 1280×720 或 1920×1088）。 */
  width: number
  height: number
  fps: number
  /** 总时长（帧）；= max(track.endFrame)。 */
  durationInFrames: number
  backgroundColor?: string
}

/** 轨道联合类型：视频 / 图片 / 文本卡 / 形状 / 转场。 */
export type CompositionTrack =
  | VideoClipTrack
  | ImageClipTrack
  | TextCardTrack
  | ShapeTrack
  | TransitionTrack

export interface BaseTrack {
  id: string
  startFrame: number
  durationInFrames: number
}

/** 静态变换（百分比坐标系，相对画布；组件用 interpolate 对其做帧级动画）。 */
export interface Transform {
  /** 水平中心位置（0–100，默认 50 居中）。 */
  x?: number
  /** 垂直中心位置（0–100，默认 50 居中）。 */
  y?: number
  /** 缩放倍数，默认 1。 */
  scale?: number
  /** 旋转角度（度），默认 0。 */
  rotation?: number
}

export interface VideoClipTrack extends BaseTrack {
  type: 'video'
  /** 同源资产 URL（/canvas-studio/assets/...）或本地绝对路径。 */
  src: string
  transform?: Transform
  /** 是否启用 Ken-Burns 缓慢推拉（默认 false）。 */
  kenBurns?: boolean
}

export interface ImageClipTrack extends BaseTrack {
  type: 'image'
  src: string
  /** 图片展示形态：cover（默认，填满）/ contain（留边）/ kenburns。 */
  fit?: 'cover' | 'contain' | 'kenburns'
  caption?: string
}

export interface TextCardTrack extends BaseTrack {
  type: 'textCard'
  /** 卡片样式：字幕条 / 数据卡 / 标题卡 / 要点列表。 */
  variant: 'subtitle' | 'dataCard' | 'title' | 'bullets'
  /** 主文本（subtitle / title / bullets 每行一条）。 */
  text: string | string[]
  /** dataCard 专用：键值对（如 [{k:'全球老龄化',v:'16%'}]）。 */
  data?: { k: string; v: string }[]
  accentColor?: string
}

export interface ShapeTrack extends BaseTrack {
  type: 'shape'
  shape: 'rect' | 'circle' | 'line' | 'gradient'
  color: string
  /** 相对画布的百分比坐标（0–100）。 */
  box?: { x: number; y: number; w: number; h: number }
}

export interface TransitionTrack extends BaseTrack {
  type: 'transition'
  /** 作用于相邻两轨的转场类型。 */
  effect: 'fade' | 'slide' | 'zoom' | 'dissolve'
  /** 作用的源轨道 id（前一轨）。 */
  fromTrackId: string
  /** 作用的目标轨道 id（后一轨）。 */
  toTrackId: string
}

export interface ManifestAudio {
  /** BGM 资产 URL（复用 compose_video 的 bgmNodeId 语义）。 */
  bgmUrl?: string
  /** 旁白资产 URL（tts_voiceover 产物）。 */
  voiceOverUrl?: string
  /** 混音音量（0–1），缺省走 BGM_MIX_VOLUME / 1.0。 */
  mix?: { bgmVolume?: number; voiceVolume?: number }
}

export interface ManifestGlobal {
  /** 缺省字体族名；未随包且未缓存时走 §8 解析/下载链。 */
  fontFamily?: string
  /** 可选：动态字体描述（多语言扩展；随包子集未命中时按需下载并缓存，§8）。 */
  fonts?: ManifestFont[]
  theme?: 'light' | 'dark'
  brandColor?: string
}

export interface ManifestFont {
  /** 字体族名（与 CSS font-family / global.fontFamily 对应）。 */
  family: string
  /** 字重，默认 400。 */
  weight?: number
  /** 字体文件同源 URL（同 tracks[].src 约束）；缺省由宿主字体解析表解析（随包子集 → 自托管下载 → fallback）。 */
  src?: string
}
```

> 注：`audioComposition`（`StudioAudioComposition`，`contracts/canvas.ts:102`）**不属于 Manifest 输入**，它是宿主在校验通过后、落节点前**派生**出来的（§4.3 `deriveAudioComposition`）。skill / LLM 不产出该字段，`validateManifest` 也不接受它——避免"模型编一个音轨构成骗过校验"。

### 4.3 校验函数（纯函数，单测可断言）
```ts
// src/remotion/manifest.ts
import type { StudioAudioComposition } from './contracts/canvas.js'

export interface ManifestValidation {
  ok: boolean
  errors: string[]
  warnings: string[]
}
export function validateManifest(input: unknown): ManifestValidation {
  // 1) 结构断言（meta 必填、width/height/fps/durationInFrames 为有限正数）
  // 2) 轨道遍历：startFrame>=0、durationInFrames>0、type 合法
  // 3) transition 引用的 fromTrackId / toTrackId 必须存在且不相同
  // 4) transition 窗口内 from/to 两轨必须重叠；首尾相接（无重叠）→ warning（渲染层退化为硬切）；
  //    完全不相交 → error（转场无意义，拒绝渲染）
  // 5) 总时长 = max(startFrame + durationInFrames)；与 meta.durationInFrames 偏差 >1 帧则 warning
  // 6) 任一轨道 endFrame > meta.durationInFrames → warning（渲染层按 meta 裁切，不静默吞）
  // 7) src 与 global.fonts[].src 必须以 /canvas-studio/assets/ 开头或本地绝对路径（防外链泄露）
  // 返回 { ok, errors, warnings }
}

/**
 * 宿主侧派生音轨构成（纯函数，落节点前调用；skill/LLM 不产出此值）。
 * MVP 规则（与 compose.ts 的角标语义对齐）：
 *   - 存在 video 轨（默认带原声）→ 有 bgm 或 voiceOver ? 'native+bgm' : 'native'
 *   - 无 video 轨 → 有 bgm 或 voiceOver ? 'bgm' : 'none'
 * 注：现有角标枚举无"旁白"独立位，voiceOver 并入 'bgm' 位；若未来要区分，
 * 扩展 StudioAudioComposition 枚举（二期，需客户端角标同步）。
 */
export function deriveAudioComposition(manifest: CompositionManifest): StudioAudioComposition { /* ... */ }

/** 收集 Manifest 引用的全部素材节点 id（用于 appendComposedVideoNode 的血缘 sourceIds）。 */
export function collectManifestSourceIds(manifest: CompositionManifest): string[] { /* ... */ }
```

### 4.4 假数据示例（30s 科普视频，见 demo §2 数据卡）
```json
{
  "id": "comp-9f3a2b",
  "meta": {
    "title": "为什么我们需要睡眠",
    "width": 1280, "height": 720, "fps": 30, "durationInFrames": 900,
    "backgroundColor": "#0b1020"
  },
  "tracks": [
    { "id": "t0", "type": "image", "src": "/canvas-studio/assets/p1/brain.png",
      "startFrame": 0, "durationInFrames": 180, "fit": "kenburns",
      "caption": "大脑在睡眠中清理代谢废物" },
    { "id": "t1", "type": "textCard", "variant": "title", "text": "睡眠的科学",
      "startFrame": 180, "durationInFrames": 90 },
    { "id": "t2", "type": "video", "src": "/canvas-studio/assets/p1/sleep-clip.mp4",
      "startFrame": 270, "durationInFrames": 264, "kenBurns": true },
    { "id": "t3", "type": "textCard", "variant": "dataCard",
      "text": "成年人每日建议睡眠", "data": [
        { "k": "18-64 岁", "v": "7-9 小时" },
        { "k": "65+ 岁", "v": "7-8 小时" }
      ], "startFrame": 510, "durationInFrames": 180, "accentColor": "#4f9dff" },
    { "id": "t4", "type": "textCard", "variant": "bullets",
      "text": ["记忆巩固", "免疫修复", "情绪调节"],
      "startFrame": 690, "durationInFrames": 210 },
    { "id": "t5", "type": "transition", "effect": "fade",
      "fromTrackId": "t2", "toTrackId": "t3",
      "startFrame": 510, "durationInFrames": 24 }
  ],
  "audio": {
    "bgmUrl": "/canvas-studio/assets/p1/bgm.mp3",
    "voiceOverUrl": "/canvas-studio/assets/p1/voice.mp3",
    "mix": { "bgmVolume": 0.35, "voiceVolume": 1.0 }
  },
  "global": { "theme": "dark", "brandColor": "#4f9dff", "fontFamily": "SourceHanSansSC-Subset" }
}
```

### 4.5 字段逐项说明（落地时照此写 SKILL.md 字段口径）
- `meta.durationInFrames` 是硬约束，Remotion `<Composition durationInFrames>` 直接吃它；轨道超出会被裁切（校验层报 warning，不静默）。
- `tracks[].src`：只接受 `urlToAssetPath` 能反查的同源 URL 或本地路径（§8），拒绝外链。
- `transition` 是"声明式"的：渲染层在 `fromTrackId` 与 `toTrackId` 的**重叠窗口**内做过渡，**不消耗额外时长**。语义精确定义：
  - 转场窗口 = `[startFrame, startFrame + durationInFrames)`；
  - 窗口内 from 轨淡出 / to 轨淡入（fade），或按 effect 做位移/缩放插值；
  - **要求 from/to 两轨在窗口内均存活且重叠**——skill 组装 Manifest 时应把相邻两轨首尾重叠 N 帧（N = 转场时长），校验层对"首尾相接无重叠"给 warning（渲染退化为硬切），对"完全不相交"给 error。
- `audio.bgmUrl` 语义 = `compose_video` 的 `bgmNodeId`；时长守卫逻辑（BGM ≥ 成片真值）**复用 `bgmShortfallMessage`**（compose.ts:253）。
- 音轨构成（`audioComposition`）由宿主 `deriveAudioComposition` 派生（§4.3），不是 Manifest 输入。

### 4.6 与 storyboard 的关系
`code-driven-explainer` skill 在 `write_storyboard` 落地后，把 storyboard 的 `narration.lines` + `storyboard.scenes[].shots` + 已落画布的 clip / 图片节点，组装成 `CompositionManifest` 的 `tracks` 与 `audio`。**storyboard 仍是事实源，Manifest 是渲染层派生**，不双向同步。

---

## 5. 新增模块清单（文件树）

在 `canvas-studio/` 内新增，不影响现有文件（除 §11 列的 3 处登记）：

```
canvas-studio/
├─ src/
│  ├─ host-tools.ts                 [改：createStudioTools 内加 render_composition]
│  ├─ compose.ts                    [不改，复用 ComposeResult / appendComposedVideoNode / urlToAssetPath]
│  ├─ ffmpeg-run.ts                 [不改，复用 resolveFfmpegPath]
│  ├─ quality-check.ts              [不改，复用 runShotQc（runShotQc 调用在 render_composition 内）]
│  └─ remotion/                     [全新目录]
│     ├─ manifest.ts                [§4.2 类型 + §4.3 校验]
│     ├─ remotion-render.ts         [renderMedia 封装：bundle→render→返回 ComposeResult]
│     ├─ fonts.ts                   [§8 字体解析：随包子集 → 下载缓存 → fallback]
│     ├─ slideshow-risk.ts          [§9.2 6 维评分]
│     └─ components/                [React 组件库（被 Remotion 单独 webpack 打包）]
│        ├─ Root.tsx                [<Composition> + AbsoluteFill + 遍历 tracks]
│        ├─ VideoClip.tsx
│        ├─ ImageClip.tsx           [含 kenburns]
│        ├─ TextCard.tsx            [subtitle / dataCard / title / bullets]
│        ├─ Shape.tsx
│        ├─ Transition.tsx          [fade / slide / zoom / dissolve]
│        └─ index.ts                [registerRoot + 导出 compositions]
├─ skills/
│  └─ code-driven-explainer/        [全新 skill，复用 HITL checkpoint]
│     └─ SKILL.md
└─ package.json                     [改：加 remotion / @remotion/renderer / @remotion/bundler 依赖；@remotion/cli / @remotion/test-renderer 为 devDeps]
```

**注意**：`src/remotion/components/*` 是 `.tsx`，由 Remotion 的 webpack 单独打包（不是 canvas-studio 主 bundle）。主 `tsconfig` 需放行 `tsx` + `jsx`，或给 `remotion/` 配独立 tsconfig（推荐后者，隔离 JSX 依赖）。

---

## 6. 核心：render_composition 工具规格（见 demo §3 集成插入点）

### 6.1 在哪里加
`src/host-tools.ts` 的 `createStudioTools()`（L1270）返回 `defineTool[]`。在 `compose_video`（L2289）之后追加一个 `defineTool({...})`。

### 6.2 完整 defineTool 草稿
```ts
defineTool({
  name: 'render_composition',
  description:
    '用代码驱动合成（Remotion）把 CompositionManifest 渲染成成片——用于「字幕卡 / 数据卡 / 图文幻灯片 / 转场」等模型生成做不到的精确动画与排版。' +
    '它与 compose_video 并列：compose_video 只拼已有视频片段，本工具额外支持文本卡 / 形状 / 转场并逐帧精确控制。' +
    '入参 `manifest` 是一段 JSON 字符串（结构见 SKILL 的 CompositionManifest 字段口径），先经宿主校验、再经审批门（同 compose_video）。' +
    '渲染复用随包 ffmpeg 编码与现有混音；成片作为 video-composite 节点落画布（血缘指向 manifest 引用的素材），返回与 compose_video 同形状的 url / 时长 / 分辨率 / 音轨构成 / nodeId。' +
    '⚠️ 仅当成品需要「非片段拼接」的卡片/动画/转场时才用本工具；纯片段拼接仍用 compose_video。',
  parameters: {
    manifest: { type: 'string' as const, description: 'CompositionManifest JSON 字符串（结构见 SKILL 字段口径）；解析/校验失败会显式报错且不渲染' },
    projectId: { type: 'string' as const, description: '可选：目标项目 id；缺省取当前会话项目' },
  },
  output: { schema: resultSchema, render: renderComposeResult }, // 复用 compose_video 的输出
  async execute(args, exec) {
    const a = args as { manifest: string; projectId?: string }
    const projectId = a.projectId ?? await resolveProjectId(registry, exec.agent?.session.header.cwd)
    await assertApprovalAllowed(registry, projectId, 'render_composition', false) // 复用审批门（host-tools.ts:718，同文件私有函数）
    // 1) 解析 + 校验
    let parsed: unknown
    try { parsed = JSON.parse(a.manifest) } catch { throwError('CS-USER-ERR', { message: 'manifest 不是合法 JSON' }) }
    const validation = validateManifest(parsed)
    if (!validation.ok) throwError('CS-USER-ERR', { message: `manifest 校验失败：${validation.errors.join('；')}` })
    const manifest = parsed as CompositionManifest
    const audioComposition = deriveAudioComposition(manifest) // 宿主派生，非 Manifest 输入（§4.3）
    // 2) 资产 URL → 本地路径 + src 重写为 staticFile 相对名，写入 Remotion publicDir（见 §8）
    const assetsDir = registry.assetsDir(projectId)
    const { publicDir, staged, warnings: fontWarnings } = await stageManifestAssets(manifest, assetsDir) // 字体解析 warning 一并带回（§8）
    // 3) 渲染（Remotion headless chromium + 随包 ffmpeg；固定 composition id，manifest 走 inputProps）
    const ffmpegPath = resolveFfmpegPath() // 复用 ffmpeg-run.ts:128
    const renderResult = await renderComposition({
      manifest: staged, publicDir, ffmpegPath,
      signal: exec.signal,               // 映射为 renderMedia cancelSignal，支持会话中断
      timeoutMs: 10 * 60_000,            // 渲染超时强杀（防长片挂死会话；帧数大时可按 fps*duration 再估）
    })
    // 4) 复用 compose.ts 的落节点逻辑
    const composedNode = await appendComposedVideoNode(registry, projectId, {
      url: renderResult.url,
      duration: renderResult.duration,
      audioComposition,
      ...(renderResult.width !== undefined ? { width: renderResult.width } : {}),
      ...(renderResult.height !== undefined ? { height: renderResult.height } : {}),
      sourceIds: collectManifestSourceIds(manifest),
    })
    // 5) 复用质量校验 + 新增风险评分（阶段 5 接入）
    //    runShotQc 对成片节点跑一次（结果回写节点 metadata，非阻断）；
    //    scoreSlideshowRisk(manifest)（§9.2）score≥60 → 并入 warnings。
    const risk = scoreSlideshowRisk(manifest) // 阶段 5 前可先注释，接口先留
    const payload: ComposeToolResult = {
      url: renderResult.url,
      width: renderResult.width ?? COMPOSED_FALLBACK.width,
      height: renderResult.height ?? COMPOSED_FALLBACK.height,
      duration: renderResult.duration,
      nodeId: composedNode.id,
      clipCount: manifest.tracks.length,
      skippedCount: 0,
      audioComposition,
      warnings: [
        ...validation.warnings,
        ...(risk.score >= 60 ? [risk.warning] : []),
        ...(fontWarnings ?? []),
      ],
    }
    if (payload.warnings.length === 0) delete payload.warnings
    return payload
  },
}),
```

> **超时与清理**：`renderComposition` 内部 finally 必须 `rm(publicDir, {recursive:true})`（同 compose.ts 的 finally 模式）；超时/中断走 `throwError('CS-RENDER-TIMEOUT' | 'CS-USER-ERR', …)` 中文错误码，不裸 throw。

### 6.3 内部流程（伪码，对应 §2.2）
```
renderComposition({ manifest, publicDir, assetsDir, ffmpegPath, signal, timeoutMs })
  // bundle 策略（已定，见 §15.1 决策 5）：
  //   发行版随包预构建 bundle（阶段 6 打包脚本产出，运行时零构建）；
  //   开发态回退运行时 bundle()，按组件源码 hash 缓存到临时目录，命中缓存则跳过。
  1. bundle = await getRemotionBundle()   // 预构建命中 / 开发态 bundle()（@remotion/bundler）
  2. renderMedia({          // @remotion/renderer
        composition: 'studio-composition',  // Root.tsx 静态注册的固定 id（§7.3），≠ manifest.id
        serveUrl: bundle,
        inputProps: { manifest },           // 组件通过 useCurrentFrame() 读帧
        ffmpegExecutable: ffmpegPath,       // 关键：复用随包二进制
        cancelSignal: signal,               // 会话中断 → 中止渲染
        outputLocation: join(assetsDir, `export-${manifest.id}.mp4`),
        concurrency: 1,                     // 单机渲染
      })
     // 外层套 timeoutMs 超时强杀（杀 Chromium 子进程，同 ffmpeg-run.ts 的超时纪律）
  3. probeMediaInfo(output)  // 复用 ffmpeg-run.ts:278 探真值时长/分辨率
  4. 若 manifest.audio 存在 → 复用 compose.ts 的 buildAmixArgs 混音
     （staged.audio 的相对名对 publicDir 解析为本地路径；bgmShortfallMessage 守卫）
  5. finally: rm(publicDir, {recursive:true})  // 预构建 bundle 不清理
  6. 返回 { url, duration, width, height }
```

### 6.4 复用点清单（务必复用，不重新发明）
- `resolveFfmpegPath()` — `ffmpeg-run.ts:128`（随包二进制，打包已含，零新依赖）
- `appendComposedVideoNode()` — `compose.ts:628`（落 video-composite 节点 + 版本链 + 血缘避让）
- `ComposeResult` / `ComposeToolResult` / `renderComposeResult` — `compose.ts:63` / `host-tools.ts:162` / `host-tools.ts:250`（`resultSchema` 在 `:67`）
- `urlToAssetPath()` — `compose.ts:118`（资产反查）
- `bgmShortfallMessage()` / `buildAmixArgs()` — `compose.ts:253 / 281`（混音守卫与参数）
- `assertApprovalAllowed()` — 审批门，与 compose_video 同口径
- `probeMediaInfo()` — `ffmpeg-run.ts:278`（成片真值）

### 6.5 返回结构
与 `compose_video` **完全相同**（`ComposeToolResult`），客户端零改动即可展示成片节点、时长、分辨率、音轨构成角标。

---

## 7. Remotion 渲染层实现

### 7.1 渲染管线（技术核心，见 demo §2 关键帧色块示意）
```
组件源码(.tsx)
  → Remotion webpack bundle（remotion bundle 命令 / @remotion/bundler）
  → @remotion/renderer renderMedia
       ├─ 起 Headless Chromium（复用随包或 Electron 的 Chromium）
       ├─ 逐帧：设 window.__remotion_frame = N → React 重渲染 → 截屏（shared-memory capture 跳过 JPEG）
       └─ 帧序列 → ffmpeg（resolveFfmpegPath）→ H.264 / VP9
```

### 7.2 两个必踩的坑（写组件时逐条防）
1. **每帧无状态**：`useState` 永远初始值、`useRef` 跨帧丢失、`useMemo([])` 每帧重算。所有"随时间变化"的状态必须用 `useCurrentFrame()` + 纯函数推导（OpenMontage / Remotion 文档明确）。
2. **shared-memory capture**：Remotion 4.0.534+ 默认走共享内存传位图给 ffmpeg，跳过 JPEG 压缩，速度快且无色差；无需手动配置，但要知道它存在（避免误加 `imageFormat: 'jpeg'` 降质）。

### 7.3 组件库清单（MVP 最小集）
| 组件 | 职责 | 对应 Manifest track |
|---|---|---|
| `Root.tsx` | 注册**固定 id** 的 `<Composition id="studio-composition">`（`durationInFrames/fps/width/height` 从 `inputProps.manifest.meta` 读取）+ `<AbsoluteFill>` 遍历 tracks，按帧激活 | 顶层 |
| `VideoClip.tsx` | `<Video>` + transform + 可选 Ken-Burns（用 `interpolate` 推拉） | `video` |
| `ImageClip.tsx` | `<Img>` + fit(cover/contain) + kenburns + 可选 caption 条 | `image` |
| `TextCard.tsx` | subtitle / dataCard / title / bullets 四态 | `textCard` |
| `Shape.tsx` | rect / circle / line / gradient（百分比坐标） | `shape` |
| `Transition.tsx` | fade / slide / zoom / dissolve（重叠区插值） | `transition` |

### 7.4 组件签名草图（节选）
```tsx
// src/remotion/components/TextCard.tsx
import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion'
import type { TextCardTrack } from '../manifest'

export const TextCard: React.FC<{ track: TextCardTrack; fps: number }> = ({ track, fps }) => {
  const frame = useCurrentFrame()
  const local = frame - track.startFrame
  // 进入淡入（前 6 帧）、退出淡出（后 6 帧）—— 纯函数派生，无状态
  const opacity = interpolate(local, [0, 6, track.durationInFrames - 6, track.durationInFrames], [0, 1, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  if (local < 0 || local > track.durationInFrames) return null
  return (
    <AbsoluteFill style={{ opacity, justifyContent: 'center', alignItems: 'center', background: track.variant === 'title' ? 'rgba(0,0,0,0.55)' : 'transparent' }}>
      {/* subtitle / dataCard / title / bullets 四种布局按 variant 分支渲染 */}
    </AbsoluteFill>
  )
}
```

### 7.5 Chromium 来源决策（最关键，决定打包复杂度，见 §15）
| 来源 | 优点 | 缺点 | 适用 |
|---|---|---|---|
| **Remotion 自带**（npm 捆绑的 Chromium） | 简单，随 `@remotion/renderer` 自动下载 | 打包 +150MB；国内打包须走 `ELECTRON_MIRROR` 类镜像；agent shell 搬运受限（见 §15.3） | 快速起步 |
| **复用 Electron 打包的 Chromium** | 零额外体积 | 版本耦合（Remotion 要求范围）；须探 `process.resourcesPath` 下的 Chromium 二进制并传给 `chromiumExecutable` | 量产推荐 |

**阶段 0 Spike 必须两种都实测**（见 §13 阶段 0），再定。本文件默认**先走 Remotion 自带**做 MVP，验证通过后再评估复用 Electron Chromium 的减重路径。

---

## 8. 资产喂入方案（见 demo §2 资产段）

Remotion 组件读素材有两条路，本项目推荐**方式 B**（隔离 / 离线 / 不依赖 webServer 运行态）：

- **方式 A（直连 webServer URL）**：组件里 `<Video src="http://localhost:PORT/canvas-studio/assets/p1/x.mp4">`。省事，但要求渲染时刻 webServer 仍在跑、且同源。
- **方式 B（落地 publicDir + `staticFile()`）**：渲染前把 Manifest 引用的素材用 `urlToAssetPath`（compose.ts:118）反查本地绝对路径，拷贝 / 软链到 Remotion 的 `publicDir`；组件里用 `staticFile('x.mp4')` 引用。**推荐**：渲染脱离 webServer 运行态、可离线、可复现。

**落地函数**：
```ts
// src/remotion/remotion-render.ts
export interface StagedManifest {
  /** 拷贝后的 publicDir（渲染结束 finally 清理）。 */
  publicDir: string
  /** src 重写后的 manifest 副本：所有 src 已替换为 publicDir 内相对名，供组件 staticFile() 直读。 */
  staged: CompositionManifest
  /** 字体解析过程的降级告警（下载失败 fallback 等，§8），由调用方并入 ComposeToolResult.warnings。 */
  warnings: string[]
}
async function stageManifestAssets(manifest: CompositionManifest, assetsDir: string): Promise<StagedManifest> {
  const publicDir = await mkdtemp(join(tmpdir(), 'cs-remotion-public-'))
  const staged = structuredClone(manifest)
  const warnings: string[] = []
  const used = new Set<string>()
  const stageOne = async (src: string, trackId: string): Promise<string> => {
    const local = urlToAssetPath(assetsDir, src) // 复用 compose.ts:118
    // basename 冲突防御：同名文件（不同子目录/不同轨）加 trackId 前缀消歧
    let name = basename(local)
    if (used.has(name)) name = `${trackId}-${name}`
    used.add(name)
    await copyFile(local, join(publicDir, name))
    return name // 组件侧用 staticFile(name) 直读
  }
  for (const track of staged.tracks) {
    if ('src' in track && track.src.startsWith('/canvas-studio/assets/')) {
      track.src = await stageOne(track.src, track.id)
    }
  }
  if (staged.audio?.bgmUrl) staged.audio.bgmUrl = await stageOne(staged.audio.bgmUrl, 'bgm')
  if (staged.audio?.voiceOverUrl) staged.audio.voiceOverUrl = await stageOne(staged.audio.voiceOverUrl, 'voice')
  // 字体：resolveFonts(manifest.global)（§8 方案 C）把随包/缓存/新下载的字体文件
  // 注入同一 publicDir + 返回 @font-face 声明；下载失败项进 warnings（fallback 随包字体，不阻断）
  warnings.push(...(await resolveFonts(staged, publicDir)))
  return { publicDir, staged, warnings }
}
```
> **关键**：组件永远只见重写后的 `staged`（src = publicDir 相对名），**不要**让组件自己拼 `staticFile(basename(src))`——重写集中在宿主一处，组件保持纯展示。本地绝对路径 src（校验层放行的）同样走 `stageOne`（跳过 URL 反查直接拷贝）。渲染结束后 `rm(publicDir, {recursive:true})` 清理（同 compose.ts 的 finally 模式）。

**字体方案（已定：方案 C 混合，含多语言扩展；落地模块 `src/remotion/fonts.ts`）**

问题背景：headless Chromium 里 `fontFamily: 'PingFang SC'` 在非 macOS / 未装该字体的用户机上会静默 fallback（观感事故）；且产品规划要支持多语言，单一随包字体不够。三方案对比后取 C：

| 方案 | 优点 | 缺点 |
|---|---|---|
| A. 全随包 | 离线 100% 可用 | 10 种语言字体几十 MB，包体爆炸 |
| B. 纯动态下载 | 包体零增量、语种无限 | 渲染时无网翻车；Google Fonts 国内不稳 |
| **C. 混合（已定）** | 中文离线兜底 + 其他语种灵活可扩展 | 多一套缓存逻辑 |

**方案 C 落地要点**：
1. **随包兜底**：思源黑体（Source Han Sans，**OFL 许可**，允许嵌入与随产品分发）**子集**——按常用字表子集化为 woff2（1–3MB 级），构建脚本产出进 `public/fonts/`，`staticFile('fonts/…')` + `@font-face` 引用。缺省 `fontFamily` 指向随包子集，保证离线/无网必能出片。
2. **动态下载（多语言扩展）**：Manifest 通过 `global.fonts[]`（§4.2 `ManifestFont`）声明额外字体。宿主解析顺序：
   - 命中随包子集 → 直接用；
   - 未命中 → 从**自托管源**下载（建议 Drama 后端加 `/fonts/<family>-<weight>.woff2` 静态路由，托管 OFL 字体族，如 Noto Sans / Noto Serif 各语种子集）；
   - 下载落盘到应用数据目录字体缓存（Electron `app.getPath('userData')/fonts/`），**命中缓存不重复下载**，二次渲染离线可用；
   - 下载失败 → 随包字体 fallback + warning 进 `ComposeToolResult.warnings`，**不阻断渲染**。
   - 不直接依赖 `@remotion/google-fonts`（其机制可参考——`@font-face` + `delayRender` 等字体就绪再截图——但其打 Google 域名，国内不稳，故自托管等价实现）。
3. **加载闸门**：所有 `@font-face` 声明配 Remotion `delayRender()` / `continueRender()`——字体（含下载中的）未就绪不截图，防空白帧 / 半截字（§7.2 无状态坑的配套纪律）。
4. **注入点**：`resolveFonts(staged, publicDir)` 在本节 `stageManifestAssets` 内被调用——解析完成的字体文件（随包复制 / 缓存复制 / 新下载）统一放进**本次渲染 publicDir**，与素材同生命周期、同 finally 清理；下载失败项返回 `warnings`（§6.2 并入结果）。
5. **体积纪律**：优先子集化（中文常用字表、拉丁基本区）；全量字体只在用户显式选择时下载，不做全量随包。
6. **许可**：思源黑体 / Noto 系均为 SIL OFL 1.1，允许嵌入、缓存与再分发，无商业限制（与 Remotion License 问题无关，勿混淆）。

---

## 9. 质量门禁扩展（见 demo §4 功能缺口）

### 9.1 复用现有
`quality-check.ts` 的 `runShotQc`（L217）对成片节点跑一次镜头质检，结果非阻断（回写节点 metadata）。`render_composition` 落节点后调一次即可，无需新逻辑。

### 9.2 新增：幻灯片风险评分（确认缺失项，OpenMontage 6 维）
现状 `quality-check.ts` **没有**"一堆图假装视频"的防呆评分（grep 证实无 `slideshow` / `riskScore`）。新增 `src/remotion/slideshow-risk.ts`：

```ts
// src/remotion/slideshow-risk.ts
export interface SlideshowRisk {
  score: number        // 0–100，越高越像"假视频"
  /** score ≥ 60 时给出的用户可见告警文案（并入 ComposeToolResult.warnings）。 */
  warning?: string
  dims: { name: string; weight: number; hit: boolean; note: string }[]
}
/**
 * OpenMontage 6 维防"幻灯片伪装视频"：
 * 1) 静态占比：图片/文本卡总时长 ÷ 成片时长 > 70% → 高风险
 * 2) 运动密度：video 轨道数 < 1 或总视频时长占比 < 20% → 风险
 * 3) 转场多样性：全部是 fade / 无转场 → 风险
 * 4) 镜头数：shots < 3 → 风险（时长越长阈值越高）
 * 5) 字幕/解说覆盖：无 voiceOver 且无 textCard → 风险
 * 6) 节奏单调：各轨道时长标准差 < 阈值（全是等长卡）→ 风险
 */
export function scoreSlideshowRisk(manifest: CompositionManifest): SlideshowRisk { /* ... */ }
```
阈值建议：score ≥ 60 → warning（"成片偏向幻灯片，建议增加实拍/生成视频片段"）；不阻断，进 `ComposeToolResult.warnings`。

### 9.3 CLI 预合成验证（选做，阶段 5）
`remotion render` 支持 dry-run / 单帧 `still` 校验；可加一个 `scripts/verify-composition.mjs`，对假 manifest 跑 `--frames=1` 确认 bundle + 组件不崩。

---

## 10. 新增 skill：code-driven-explainer（见 demo §1 B 路）

### 10.1 SKILL.md 结构（复用现有 gate / trigger + HITL checkpoint）
- **trigger**：用户意图命中"科普 / 教育 / 数据可视化 / 带字幕卡的视频"。
- **gate**：沿用 `canvas-studio-creation` 的审批门协议（逐步确认 / 放手跑）。
- **流程**：
  1. 确认 storyboard 已落地（`write_storyboard` 已完成）。
  2. 收集素材：列出已有 clip / 图片 / 音频节点（复用 `list_shots` / `list_references`）；有旁白时探真值总长（§10.3）。
  3. **组装 CompositionManifest JSON**（§4.6）：字幕卡时序按 §10.3 派生，字体按 §8 声明（`global.fontFamily` / `global.fonts`）；在 HITL checkpoint 展示"成片结构预览"（轨道时序表）。
  4. 用户批准 → 调 `render_composition({ manifest })`。
  5. 成片节点落画布 → 跑 `runShotQc` → 展示。

### 10.2 与现有 skills 的关系
- 不替换 `canvas-studio-creation`，是它的**一个下游分支**（当用户要"代码合成"而非"纯模型拼接"时启用）。
- 复用全部素材生成工具（video_generate / image_generate / music_generation / tts_voiceover），只新增"合成"这一步。
- **定位补充**：现有 skill 纪律是"默认不把字幕烧进画面"（CV-213，字幕降级为文案节点；`subtitle_burn` 仍是占位工具）。`code-driven-explainer` 是项目**第一个真正把字幕烧进画面**的路径——字幕卡是本 skill 的核心卖点，句级质量必须做扎实。

### 10.3 句级字幕时序口径（MVP 定稿）

**现状约束（已实地核实）**：Drama `txt2speech` 响应只有 `{prompt_id, filename, full_url, duration}`（`docs/api.md:1377`），**无任何字级/句级时间戳**；且其中 `duration` 是服务端**生成耗时**而非音频时长（探针实测差 2.8 倍，`docs/api-probe/txt2speech-20260930/report.md:15`）。仓库亦无 forced-alignment / whisper / SRT 相关代码。因此词级同步无数据源，MVP 句级定稿如下：

**派生流程（skill 组装 Manifest 时执行，纯口径、零新依赖）**：
1. `tts_voiceover` 产出旁白后，用 `probeMediaDuration`（`ffmpeg-run.ts:299`，宿主已有）探**真实音频总时长 T**（秒）——总长是实测值，不靠估算。
2. 按**字数占比**把 T 分配给每句：`句i时长 = (字数i / 总字数) × T`；句间可加固定呼吸间隔（默认 0.15s，**从相邻句时长内扣**，不额外拉长总长）。
3. 折算帧：`startFrame = 累计秒 × fps`（向下取整），`durationInFrames = 句时长 × fps`（向上取整）；**末句吸收舍入误差**，保证末句 endFrame 与旁白总帧对齐。
4. 无旁白（纯 BGM / 无音频轨）时回退**字数 × 0.25s（4 字/秒）**估算——沿用 `voiceover-writing` skill 现行惯例（`skills/voiceover-writing/SKILL.md:12`）。
5. **兜底校验**：末句 endFrame 与旁白总帧偏差 > 0.5s → 进 `ComposeToolResult.warnings`（不阻断渲染）。

**误差预期**：总长精确（实测），误差只在句边界（受语速不均影响，典型 ±0.3s/句），显著优于裸 4 字/秒。

**词级字幕（二期，有前置条件）**：需 Drama TTS 响应增加 word/sentence timestamps，**或**引入 forced alignment（如本地 whisper 转写对齐）。排期前置：先向 Drama 后端提"txt2speech 返回时间戳"需求并拿到接口承诺，再立项（§14 P1）。

---

## 11. 集成插入点明细表（见 demo §3）

| 模块 | 文件:行 | 改动 | 工作量 |
|---|---|---|---|
| 新增渲染工具 | `host-tools.ts:1270`（`createStudioTools` 返回数组） | 在 `compose_video` 后加 `render_composition` defineTool（§6.2） | 中（1–2d） |
| 成片落节点 | `compose.ts:628` `appendComposedVideoNode` | **不改**，直接复用 | 0 |
| 复用 ffmpeg | `ffmpeg-run.ts:128` `resolveFfmpegPath` | **不改**，传给 renderMedia | 0 |
| 资产反查 | `compose.ts:118` `urlToAssetPath` | **不改**，喂 publicDir（§8） | 0 |
| Manifest 类型 + 校验 | `src/remotion/manifest.ts`（新） | 新建（§4.2 / §4.3） | 中（1d） |
| 渲染封装 | `src/remotion/remotion-render.ts`（新） | 新建（§6.3 / §7） | 高（2–3d，含 Chromium 联调） |
| 组件库 | `src/remotion/components/*`（新） | 新建 6 个组件（§7.3） | 中（2–3d） |
| 风险评分 | `src/remotion/slideshow-risk.ts`（新） | 新建（§9.2） | 低（0.5d） |
| 字体解析/缓存 | `src/remotion/fonts.ts`（新） | 新建（§8 方案 C：随包子集 → 下载缓存 → fallback + delayRender 闸门） | 中（1d，含子集构建脚本） |
| 质检扩展 | `quality-check.ts:217` | **不改**，render_composition 调 `runShotQc` | 0 |
| 新 skill | `skills/code-driven-explainer/SKILL.md`（新） | 新建（§10，含字幕/字体口径） | 中（1–1.5d） |
| **登记门禁 1** | `skills/canvas-studio-creation/references/toolchain.md:55` | 在工具表加一行 `\| render_composition \| … \|` | 必做（5min） |
| **登记门禁 2** | `docs/canvas-studio-tools.md` | 在工具表加一行 `render_composition` | 必做（5min） |
| **登记门禁 3** | `tests/skill.test.mjs:102` | 新工具自动被正则扫到，漏登记则测试红（§12.1） | 必做 |
| 依赖 | `canvas-studio/package.json` | 加 `remotion` / `@remotion/renderer` / `@remotion/bundler` | 低（含镜像配置） |

> ⚠️ **三处登记是硬门禁**：`tests/skill.test.mjs` 用正则扫 `host-tools.ts` 的所有 `name: 'xxx'`，再比对本 `toolchain.md` 与 `docs/canvas-studio-tools.md` 的表格行（§12.1）。漏任一处 → 测试红。改完必须跑该测试。

---

## 12. 测试与验收（直接落地的门禁）

### 12.1 必做：注册完整性门禁（最高频踩坑）
`tests/skill.test.mjs:102` 的逻辑：
```js
const hostTools = readFileSync(join(ROOT, 'src', 'host-tools.ts'), 'utf8')
const names = [...hostTools.matchAll(/^ {6}name: '([a-z_0-9]+)'/gmu)].map(m => m[1])
// 每个 name 必须在 toolchain.md 与 docs/canvas-studio-tools.md 各有一行 `| name |`
```
**落地动作**：
1. `host-tools.ts` 的 `render_composition` defineTool 缩进必须是 6 空格（与 compose_video 一致，否则正则扫不到）。
2. `toolchain.md` 工具表加：`| render_composition | 代码驱动合成（Remotion）：字幕卡/数据卡/转场/图文幻灯片，返回同 compose_video 形状 | manifest、projectId? |`（注意 `manifest` 是**必填**，不带 `?`）。
3. `docs/canvas-studio-tools.md` 工具表加对应行（注意反引号习惯与另一份不同，正则两种都认）。

### 12.2 工具计数同步
`tests/tool-registry.test.mjs` 的 `EXPECTED_TOOL_COUNT`（L36，当前 24 = 23 真实 + 1 占位）与工具名单（L39–64）直接调 `createStudioTools` 取真实注册面——新增后 **24 → 25**，同步改计数常量与名单，并确认 `STATUS.md §3.4` / `docs/README.md` 的"24 个工具"文案一并更新（按项目文档纪律，新工具入册时同步这些计数）。

### 12.3 纯函数单测（直接加文件）
> **测试纪律（项目现状）**：现有测试从 `../lib/*.js` 导入 → **必须先 build 再跑**；跑法走 `test:smoke` 门禁（`node scripts/run-smoke.mjs`，内部 `node --test`，失败集需 ⊆ `tests/baseline-red.json`），**新测试严禁塞进 baseline-red**。`manifest.ts` / `slideshow-risk.ts` 是纯 `.ts`，落在 Host `tsconfig` 的 `src/**/*.ts` include 内，build 后即可被 `.mjs` 测试导入。

- `tests/manifest.test.mjs`：`validateManifest` 的正/反例（缺 meta、坏 src、悬空 transition、转场无重叠/完全不相交、时长漂移、轨道超出总时长）+ `deriveAudioComposition` 四分支 + `collectManifestSourceIds`。
- `tests/slideshow-risk.test.mjs`：`scoreSlideshowRisk` 的 6 维命中。
- 组件 props 纯函数（如 `TextCard` 的 opacity 插值）可用 `@remotion/test-renderer` 渲染第 N 帧断言像素/文本存在（组件 `.tsx` 不进 Host tsc，走 remotion 独立 tsconfig，见 §5）。

### 12.4 端到端冒烟（gate 在浏览器可用）
- `renderMedia` **始终需要 Chromium**（无"无浏览器完整链"）——冒烟照跑，但 **gate 在"浏览器可用"**：CI / agent shell 无 Chromium 时跳过（仿项目 ffmpeg 真跑冒烟的判定纪律）。
- 用假 manifest（仅 textCard / shape，无 video）跑 `renderComposition`，断言产物 MP4 存在、时长 = `durationInFrames/fps`。video / image 轨道的冒烟放阶段 6 联调。
- 混音段可复用项目「假 ffmpeg 替身」模式，避免 CI 里再真跑编码。

### 12.5 T3 分层（按项目验证纪律）
- 渲染 / 守卫 / 错误系统属 T3：跑全量 `node --test` + 反向变异（真改坏 `render_composition` 产品码 → 断言变红 → 还原）。
- 视觉/UX 不在自动覆盖内（项目铁律），最终判据是人（你桌面观感）。

---

## 13. 分阶段实现计划（7 阶段，带 checklist + 验收）

### 阶段 0 · Spike（0.5 周，单人）
**目标**：验证 Remotion 在本机 / 打包环境能跑；**实测定** Chromium 来源（唯一待拍板项）；验证字体链路与 cancelSignal 的实现细节（bundle 时机与字体方案已定，此处只验证可行，见 §15.1）。
- [ ] 新建最小 Remotion 工程（`Root.tsx` + 一个 `<Hello>` 组件），`renderStill` 出一张图。
- [ ] 两种 Chromium 来源各跑一次 `renderMedia`：① Remotion 自带；② 复用 Electron `resourcesPath` 下 Chromium（传 `chromiumExecutable`）。
- [ ] 验证 `cancelSignal` 中断与超时杀进程行为（Chromium 子进程无残留）。
- [ ] 字体链路最小验证（§8 方案 C）：随包子集 `@font-face` + `delayRender` 出图不空白；模拟未命中 → 下载 → 缓存 → 二次命中离线可用；下载失败 fallback + warning。
- [ ] **License 快照存档**（§1.3）：把当时官网 License 原文存进 `docs/`。
- [ ] 记录两种的体积 / 启动耗时 / 失败点。
- [ ] **产出**：决策记录（§7.5 Chromium 选哪种），写入本文件 §15.1。
- **验收**：一张本地 MP4 由 Remotion 产出，ffmpeg 走 `resolveFfmpegPath` 的随包二进制。

### 阶段 1 · 契约 + 校验（0.5 周）
- [ ] 写 `src/remotion/manifest.ts`（§4.2 类型 + §4.3 `validateManifest` + `deriveAudioComposition` / `collectManifestSourceIds`）。
- [ ] 写 `tests/manifest.test.mjs` 正/反例。
- **验收**：`node --test` 绿；坏 JSON / 悬空 transition 被拒；派生函数对 `native+bgm` / `bgm-only` / 无音频三态断言正确。

### 阶段 2 · 组件库最小集（1~1.5 周）
- [ ] 6 个组件（§7.3）+ `Root.tsx` + `index.ts`（`registerRoot`）。
- [ ] `fonts.ts`（§8）：随包解析 / 下载缓存 / fallback + `@font-face` 注入 + `delayRender` 闸门。
- [ ] 中文子集构建脚本（常用字表 → woff2，产物进 `public/fonts/`）。
- [ ] `remotion/` 独立 tsconfig（隔离 JSX）。
- [ ] `@remotion/test-renderer` 渲染各组件第 N 帧，断言文本/形状存在。
- **验收**：每个组件单测绿；`renderStill` 出图无报错；中文字幕卡出图字体正确不 fallback。

### 阶段 3 · render_composition 工具（1 周）
- [ ] `host-tools.ts` 加 defineTool（§6.2），缩进 6 空格。
- [ ] `remotion-render.ts` 封装（§6.3），含 `stageManifestAssets`（§8）。
- [ ] 复用 `resolveFfmpegPath` / `appendComposedVideoNode` / `ComposeResult`。
- [ ] 三处登记（§11 门禁 1/2/3）。
- **验收**：`tests/skill.test.mjs` 绿；假 manifest（纯 textCard）冒烟出 MP4（**gate 在 Chromium 可用**，§12.4）。

### 阶段 4 · code-driven-explainer skill（0.5~1 周）
- [ ] 写 `SKILL.md`（§10），复用 HITL checkpoint。
- [ ] 句级字幕时序派生口径写入 SKILL（§10.3：`probeMediaDuration` + 字数比例分配 + 无旁白回退 4 字/秒）。
- [ ] 字体声明口径写入 SKILL（`global.fontFamily` / `global.fonts`，§8）。
- [ ] 在 skill.test.mjs 的覆盖工具列表（L49-65）确认无硬依赖遗漏。
- **验收**：skill 加载后能在 checkpoint 展示 Manifest 时序预览（含字幕卡每句起止帧）。

### 阶段 5 · 质量门禁扩展（0.5 周）
- [ ] `slideshow-risk.ts`（§9.2）+ 测试。
- [ ] `render_composition` 落节点后调 `runShotQc` + 风险评分进 warnings。
- **验收**：纯幻灯片 manifest 触发 warning，不阻断。

### 阶段 6 · 打包分发 + Chromium（1 周，含联调）
- [ ] `package.json` 加 remotion 依赖 + 打包脚本（镜像环境变量，见 §15.3）。
- [ ] **预构建 Remotion bundle 进包**（阶段 2 定稿的组件库 → `scripts/build-remotion.mjs` 调 `@remotion/bundler` 预构建，运行时零构建；开发态走运行时 bundle 回退，§6.3）。
- [ ] 随包中文字体进 asar/unpacked（§8 字体方案）。
- [ ] 真 video / image 轨道端到端（真实 Chromium）。
- [ ] 体积审计（Remotion 自带 Chromium +150MB + 字体增量是否可接受）。
- **验收**：打包产物在干净机跑通 `render_composition`。

### 阶段 7 · T3 测试 + 文档登记（0.5 周）
- [ ] 全量 `node --test` + 反向变异。
- [ ] 同步 `STATUS.md §3.4` / `docs/README.md` 工具计数；登记 CV 编号（按项目文档纪律）。
- **验收**：proof table 全绿（build / typecheck / test）。

**MVP 合计 ≈ 3–4 周单人**（不含阶段 6 打包联调的长尾，约 +1 周）。

---

## 14. 功能缺口清单（P0 / P1 / P2，见 demo §4）

| 优先级 | 缺口 | 影响 | 解决方案 | 阶段 |
|---|---|---|---|---|
| **P0** | 无代码驱动合成引擎 | 字幕卡/数据卡/转场做不了，REQ-034 无法满足 | 本文件 §5–§7 全套新增 | 0–3 |
| **P0** | 无 CompositionManifest 契约 | 成片结构无法显式描述 | §4 manifest.ts + 校验 | 1 |
| **P1** | Chromium 打包来源未定 | 决定打包体积与国内打包可行性 | §7.5 / §13 阶段 0 Spike | 0 / 6 |
| **P1** | 字体方案（已定：混合 C） | headless 环境字体 fallback → 观感事故；多语言扩展需求 | §8：随包子集 + 自托管 OFL 下载缓存 + fallback warning；阶段 0 Spike 验证实现细节 | 0 / 2 / 6 |
| **P1** | 字幕时序（句级已定） | 旁白型科普视频的字幕对齐质量 | §10.3 字数比例分配（探真值总时长）；词级二期，前置 Drama TTS 时间戳 or forced alignment | 4 / 二期 |
| **P1** | 长片渲染阻塞 | 30s+ 渲染卡住会话 | MVP 先同步（镜像 compose_video）+ 超时强杀/cancelSignal（§6.2）；二期接 Drama 任务恢复轮询 | 3 / 二期 |
| **P1** | 幻灯片风险评分缺失 | "假视频"防呆无 | §9.2 slideshow-risk.ts | 5 |
| **P2** | 资产喂法（已定：方式 B） | 离线/隔离能力 | publicDir + src 重写 + staticFile（§8）；阶段 3 落地 `stageManifestAssets` | 3 |
| **P2** | bundle 时机（已定：预构建进包） | 运行时构建慢 vs 打包复杂度 | 发行版预构建 + 开发态回退（§6.3 / §15.1 决策 5） | 6 |
| **P2** | LLM 动态生成组件 JSX | agentic 但高风险 | 二期，沙箱化 eval（不在 MVP） | 二期 |
| **P2** | 云端批量渲染 | 规模扩展 | 商业规模再议 | 二期 |

---

## 15. 风险评估与决策点（见 demo §5）

### 15.1 决策点 + 我的建议（已定 7 项，待拍板 2 项）
1. **Chromium 来源**（§7.5，待阶段 0 实测后定）：建议 **MVP 先走 Remotion 自带**（简单），量产评估复用 Electron Chromium 减重。
2. **资产喂法（已定）**：**方式 B（publicDir + src 重写 + staticFile）**，隔离/离线/可复现（§8）。
3. **渲染时机（已定）**：MVP 同步（镜像 compose_video）+ 超时强杀 / cancelSignal（§6.2）；长片异步留二期。
4. **范围（已定）**：只做 MVP 卡片/字幕/转场（§1.2）；词级字幕与 LLM 动态 JSX 均留二期。
5. **bundle 时机（已定）**：发行版预构建 bundle 进包（运行时零构建）+ 开发态运行时构建回退（§6.3）。
6. **字体方案（已定）**：混合 C——随包子集中文（离线兜底）+ 自托管 OFL 字体按需下载缓存（多语言扩展）+ fallback warning（§8）。
7. **字幕时序（已定）**：MVP 句级，按 §10.3「probeMediaDuration 探真值 + 字数比例分配」派生；无旁白回退 4 字/秒。

**待拍板（阶段 0 Spike 后）**：
- **Chromium 来源**（决策 1，Spike 实测定）。
- **词级字幕二期投入**：前置是 Drama TTS 支持时间戳或引入 forced alignment（§10.3 / §14 P1）。

### 15.2 风险登记册
| 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|
| 打包期 Chromium 下载挂住（国内无 VPN） | 高 | 构建失败 | 导出 `ELECTRON_MIRROR` / `ELECTRON_BUILDER_BINARIES_MIRROR`（§15.3）；或改用复用 Electron Chromium |
| agent shell 搬运带 provenance 的 Electron 二进制失败 | 中 | 本地打包需用户终端跑 | 让用户在自己终端跑 `electron-builder --universal`（项目已踩实） |
| 逐帧渲染竞态（jank / 错位帧） | 中 | 成片糊 | 组件纯函数化（§7.2）；`concurrency:1`；shared-memory capture |
| Remotion 版本要求 Chromium 范围与 Electron 不匹配 | 中 | 复用 Electron Chromium 失败 | 阶段 0 实测版本区间；不匹配则回退自带 |
| 自托管字体源（Drama `/fonts/` 路由）未建 | 中 | 多语言字体下载链路不可用 | MVP 只依赖随包子集（离线闭环）；下载链路后置，缺失时 fallback + warning 不阻断（§8） |
| 成片体积/时长超 storyboard 目标 | 低 | 偏离立项 | 复用 `auditTimeline`（compose.ts:356）做时长漂移告警 |

### 15.3 打包期 Chromium 进 Electron 的具体坑（已核实项目环境）
- **国内无 VPN**：`electron-builder` 从 GitHub 下载 Electron 本体/工具，单个 request 挂满 600s 才超时。复跑前必须导出：
  ```bash
  export ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
  export ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/
  ```
- **agent shell 搬运限制**：受管 shell 拒绝搬带 `com.apple.provenance` 的文件（如 `app.asar`），`electron-builder --universal` 必失败 → **让用户在自己的终端跑**打包。
- **ELECTRON_RUN_AS_NODE 泄漏**：从 agent shell 启动 GUI/Electron 须 `env -u ELECTRON_RUN_AS_NODE`；渲染验证在用户终端做。

---

## 16. 工作量估算

| 阶段 | 人天（单人） | 关键产出 |
|---|---|---|
| 0 Spike | 2.5d | Chromium 决策记录 + 字体链路验证 + License 快照 |
| 1 契约 | 2.5d | manifest.ts + 测试 |
| 2 组件库 | 6d | 6 组件 + 字体加载 fonts.ts + test-renderer |
| 3 工具 | 5d | render_composition + remotion-render |
| 4 skill | 3d | code-driven-explainer + 字幕时序派生口径 |
| 5 质检 | 2.5d | slideshow-risk |
| 6 打包 | 5d | 依赖 + 联调 + 体积审计 |
| 7 T3+文档 | 2.5d | proof table + 计数同步 |
| **MVP 合计** | **≈ 16–22d（3~4 周）** | 不含阶段 6 长尾约 +5d |

---

## 17. 结论与我的评估（见 demo §5）

### 优势（为什么这件事值得做）
1. **边际成本极低**：80% 地基（agentic skill、Drama 模型层、ffmpeg 后期、storyboard 契约、HITL、错误系统）已具备，Remotion 只补最薄一层。
2. **补齐能力断层**：现有"纯模型驱动"缺"精确动画 / 字幕 / 数据卡 / 批量模板"，这正是 OpenMontage 模式的核心价值，REQ-034 直接受益。
3. **License 零成本**（两人公司），且免费档允许"LLM 生成代码 + 自行渲染"。
4. **不破坏主干**：并联旁路工具，返回同形状结果，客户端/agent 零改动，回归风险可控。

### 风险（需要正视）
1. **打包期 Chromium** 是国内环境最大不确定性（§15.3），但已有"复用 Electron Chromium"的减重/规避路径。
2. **逐帧渲染**的工程坑（无状态、竞态）需要组件严格纯函数化，但这是 Remotion 成熟范式，不是新难题。
3. 视觉/UX 不在自动覆盖内（项目铁律），最终靠你桌面验收。

### 我的建议
- **按本文件 §13 的 7 阶段推进**，阶段 0 Spike 先把 Chromium 来源钉死，后面全是增量、可单测、可回滚。
- **不要照搬 OpenMontage 的 YAML manifest**，复用现有 storyboard 契约派生 Manifest（§4.6），避免第二套事实源。
- **MVP 范围守住 §1.2**，LLM 动态 JSX / 云渲染留二期，别在第一步就铺太大。

---

## 附录 A：关键文件速查表
| 用途 | 路径 | 行 |
|---|---|---|
| 工具注册入口 | `canvas-studio/src/host-tools.ts` | 1270 |
| compose_video 范本 | `canvas-studio/src/host-tools.ts` | 2289 |
| resultSchema（同形状返回） | `canvas-studio/src/host-tools.ts` | 67 |
| renderComposeResult（落盘命名） | `canvas-studio/src/host-tools.ts` | 250 |
| 审批门 `assertApprovalAllowed` | `canvas-studio/src/host-tools.ts` | 718 |
| `COMPOSED_FALLBACK` | `canvas-studio/src/host-tools.ts` | 838 |
| `newAssetId` / `sizeForAspectRatio` | `canvas-studio/src/config.ts` | — |
| `StudioAudioComposition` 契约 | `canvas-studio/src/contracts/canvas.ts` | 102 |
| 成片结果形状 | `canvas-studio/src/compose.ts` | 63 |
| 落成片节点 | `canvas-studio/src/compose.ts` | 628 |
| 资产反查 | `canvas-studio/src/compose.ts` | 118 |
| `BGM_MIX_VOLUME` | `canvas-studio/src/compose.ts` | 44 |
| ffmpeg 路径 | `canvas-studio/src/ffmpeg-run.ts` | 128 |
| 媒体探测 `probeMediaInfo` | `canvas-studio/src/ffmpeg-run.ts` | 278 |
| `probeMediaDuration` | `canvas-studio/src/ffmpeg-run.ts` | 299 |
| 时长漂移校验 | `canvas-studio/src/compose.ts` | 356 |
| BGM 守卫 | `canvas-studio/src/compose.ts` | 253 |
| 镜头质检 | `canvas-studio/src/quality-check.ts` | 217 |
| Drama 端点 | `canvas-studio/src/config.ts` | 62–84 |
| 工具计数常量 `EXPECTED_TOOL_COUNT` | `canvas-studio/tests/tool-registry.test.mjs` | 36 |
| 工具名单 | `canvas-studio/tests/tool-registry.test.mjs` | 39–64 |
| 注册门禁测试 | `canvas-studio/tests/skill.test.mjs` | 102 |
| 工具表（skill 分册） | `canvas-studio/skills/canvas-studio-creation/references/toolchain.md` | 55 |
| 工具文档 | `canvas-studio/docs/canvas-studio-tools.md` | — |

## 附录 B：假数据全流程走通示例（剧本 → 成片，见 demo §2）
1. **剧本**：「做一条 30 秒科普视频，讲睡眠的科学，要有字幕卡、数据卡、一张大脑图做 Ken-Burns、一段实拍睡眠片段、旁白 + BGM。」
2. **素材生成**（复用现有工具）：`image_generate` 出 `brain.png` → `upload_image` → `video_generate` 出 `sleep-clip.mp4` → `tts_voiceover` 出 `voice.mp3` → `music_generation` 出 `bgm.mp3`。各落画布节点。
3. **skill 组装 Manifest**（§4.4 假数据）：有旁白先 `probeMediaDuration` 探真值总长 → 按 §10.3 字数比例分配生成字幕卡时序 → 在 HITL checkpoint 展示时序表（5 轨道 + 1 转场）。
4. **用户批准** → `render_composition({ manifest })`：
   - `validateManifest` 通过 → `stageManifestAssets` 拷 4 个素材进 publicDir → `renderMedia`（Chromium 逐帧 + 随包 ffmpeg）→ `probeMediaInfo` 探真值 30.0s / 1280×720 → `buildAmixArgs` 混 BGM+旁白（守卫 BGM ≥ 30s）→ `appendComposedVideoNode` 落 video-composite 节点。
5. **质检**：`runShotQc` + `scoreSlideshowRisk`（本例 video 占比 29% + 有转场重叠 + 有旁白 → score 低，无 warning）。
6. **成片节点**出现在画布，角标显示「16:9 · 30s · 1280×720 · native+bgm」，血缘指向 4 个素材节点。

> 整个流程除第 4 步的 `render_composition` 是新工具外，其余全部复用现有链路——这正是「并联旁路、80% 复用」策略的体现。
