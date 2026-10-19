# 官方 Remotion 能力面 vs canvas-studio 已实现能力（量化对照）

> 日期：2026-10-19 · 性质：只读测绘，未改任何代码
> 口径：本仓自定义度量，**不是官方指标**；每项判定都附代码证据，可复核、可改权重重算。
> 结论先行：**主包导出用了 9/59（15.3%），已装扩展包用了 3/21（14.3%），能力域覆盖 18/53（34.0%），观感加权覆盖 40.2%。**

---

## 1. 三个可直接复核的硬数字

| 指标 | 数值 | 复核方式 |
|---|---|---|
| `remotion` 主包导出使用率 | **9 / 59 = 15.3%** | 见 §2.1 清单 |
| 已装 `@remotion/*` 包使用率 | **3 / 21 = 14.3%** | 见 §2.2 清单 |
| 能力域项覆盖（剔除不适用） | **18 ✅ / 11 🟡 / 24 ⬜ / 3 ➖** ⇒ 34.0%（含部分 44.3%） | 见 §3 矩阵 |
| 观感加权覆盖（本仓权重） | **18.5 / 46 = 40.2%** | 见 §4 算式 |

---

## 2. API 面实测

### 2.1 主包 59 个导出，只 import 了 9 个

```
AbsoluteFill  Composition  Img  Sequence  continueRender
delayRender   registerRoot  useCurrentFrame  useVideoConfig
```

未使用的高价值导出（节选）：`interpolate`、`spring`、`Easing`、`interpolateColors`、
`random`、`measureSpring`、`Series`、`Track`、`Freeze`、`Loop`、`Audio`、`OffthreadVideo`、
`AnimatedImage`、`CanvasImage`、`HtmlInCanvas`、`IFrame`、`Interactive`、`Artifact`、
`staticFile`、`prefetch`、`useCurrentScale`、`usePixelDensity`。

> 注：`interpolate` / `spring` 不用是对的 —— 我们有纯函数 `animateStateAt` / `orbitStateAt`，
> 这是确定性渲染的刻意选择（§0 铁律），不算缺口。真正的缺口是**替身能力本身不如原版**。

### 2.2 已装 21 个扩展包，只有 3 个被 import

| 类别 | 包 | 说明 |
|---|---|---|
| 实际使用 | `media`、`player`、`web-renderer` | 视频/音频组件、预览、CSR 出片 |
| 渲染链间接依赖（6） | `bundler`、`renderer`、`compositor-darwin-arm64/x64`、`sdk`、`licensing` | 被 web-renderer 拉起，不算闲置 |
| **装了但零 import（12）** | `captions`、`media-utils`、`paths`、`timeline-utils`、`zod-types`、`studio`、`streaming`、`elevenlabs`、`openai-whisper`、`codemods`、`studio-protocol`、`studio-shared` | 现成能力一直没用 |

> `captions` 和 `media-utils` 尤其可惜：前者是词级字幕能力，后者是音频振幅 —— 我们分别在用
> 手写 `fitTextPolicy` 和 `AudioViz` 里的原生 `decodeAudioData` 重造轮子。

---

## 3. 能力域矩阵（56 项）

状态：✅ 已实现 / 🟡 部分实现 / ⬜ 缺失 / ➖ 本架构不适用

### A. 时间轴与结构（8）

| # | 官方能力 | 我们 | 证据 |
|---|---|---|---|
| 1 | `Sequence` 相对时间轴 | ✅ | `Root.tsx` 每条轨包一层 `Sequence` |
| 2 | `Series` 顺序编排 | 🟡 | 用平铺 `startFrame` 等价，但无自动首尾相接，易错 |
| 3 | `Track` / 场景分组（4.x） | ⬜ | manifest 无 scene 概念 |
| 4 | `Freeze` 定格 | ⬜ | — |
| 5 | `Loop` 循环 | ⬜ | — |
| 6 | `trimBefore/After` 素材裁剪 | ⬜ | `video` 轨只能整段播 |
| 7 | `TransitionSeries` 交叠 | 🟡 | 自研 8 种 + 重叠窗口，无 presentation/timing 组合 |
| 8 | 多轨层叠顺序 | ✅ | 数组顺序 + DOM 顺序（不用 z-index） |

### B. 动画原语（10）

| # | 官方能力 | 我们 | 证据 |
|---|---|---|---|
| 9 | 两关键帧插值 | ✅ | `animateStateAt` |
| 10 | 多段关键帧 | ✅ | `animate: Animate[]` 顺序叠加 |
| 11 | `spring` 物理 | ⬜ | 全仓零命中 |
| 12 | `Easing` 曲线族 | 🟡 | 4 档且全二次：`timing.ts:355-360` |
| 13 | 自定义 cubic-bezier | ⬜ | 白名单刻意不开放 |
| 14 | `interpolateColors` 颜色过渡 | ⬜ | `color` 不能动 |
| 15 | `random` 确定性伪随机 | ⬜ | — |
| 16 | `measureSpring` 预知时长 | ⬜ | — |
| 17 | clamp / 端点收敛 | ✅ | 区间前后取端点 |
| 18 | 同轨多维度**并行**独立动画 | 🟡 | 多段是顺序覆盖，不是并行 |

### C. 媒体（10）

| # | 官方能力 | 我们 | 证据 |
|---|---|---|---|
| 19 | `Img` | ✅ | `ImageClip.tsx` |
| 20 | `Video`（含原声） | ✅ | `@remotion/media` |
| 21 | `Audio` | ✅ | `AudioTrack.tsx` |
| 22 | `OffthreadVideo` | ➖ | CSR 无此概念 |
| 23 | `AnimatedImage`（GIF/动图） | ⬜ | — |
| 24 | Lottie | ⬜ | 未装 |
| 25 | Three / 3D | ⬜ | 未装 |
| 26 | `HtmlInCanvas` / `IFrame` | ⬜ | — |
| 27 | 字体（google/local） | 🟡 | `global.fonts[]` 按需下载，无 google 族 |
| 28 | `prefetch` 素材预取 | ⬜ | — |

### D. 文本与字幕（6）

| # | 官方能力 | 我们 | 证据 |
|---|---|---|---|
| 29 | 文本卡形态 | ✅ | 4 variant：subtitle/dataCard/title/bullets |
| 30 | 字号自适应 / 真实文本测量 | 🟡 | 手写 `fitTextPolicy`（字数阈值法，非 DOM 测量） |
| 31 | 句级字幕时序 | ✅ | `subtitle-timing.md` + 卡片首尾相接 |
| 32 | 词级 / 卡拉OK 高亮 | ⬜ | `@remotion/captions` 装了未用 |
| 33 | SRT 导入 | ⬜ | — |
| 34 | 字幕安全区强制 | 🟡 | skill 有约定，引擎不校验 |

### E. 视觉特效与图形（10）

| # | 官方能力 | 我们 | 证据 |
|---|---|---|---|
| 35 | 形状原语 | ✅ | 9 种手写（含 polygon/star/arrow/path） |
| 36 | 路径生长 | ✅ | `draw` + stroke-dashoffset |
| 37 | 发光/描边/投影/模糊/遮罩 | ✅ | `fx` 5 值枚举 |
| 38 | 调色（亮度/对比/饱和/色相） | ⬜ | — |
| 39 | 颗粒 / 噪点 | ⬜ | — |
| 40 | 光晕 / 光泄漏 / 暗角 | 🟡 | 仅 `glow` |
| 41 | 运动模糊 | ⬜ | — |
| 42 | 混合模式 / 多层合成 | ⬜ | DOM 叠放，无 blend mode |
| 43 | 转场类型与参数化 | 🟡 | 8 种硬编码，无 easing/direction 参数 |
| 44 | 色板 / 设计令牌 | 🟡 | `theme` 两值 + `brandColor`，无 palette |

### F. 音频（5）

| # | 官方能力 | 我们 | 证据 |
|---|---|---|---|
| 45 | BGM + 旁白 + 混音 | ✅ | `audio.mix` 双音量 |
| 46 | 音量包络 / 淡入淡出 | ⬜ | 只能整段定音量 |
| 47 | 频谱 / 波形可视化 | ✅ | `audioViz` |
| 48 | 静音检测 | ⬜ | — |
| 49 | 节拍检测 / 踩点 | ⬜ | — |

### G. 工程与渲染（7）

| # | 官方能力 | 我们 | 证据 |
|---|---|---|---|
| 50 | `calculateMetadata` 动态元数据 | ✅ | `Root.tsx` |
| 51 | `delayRender` 异步资源 | ✅ | `AudioViz` 解码 |
| 52 | CSR 出片（web-renderer） | ✅ | `client/remotion-render.ts` |
| 53 | Lambda / CloudRun | ➖ | 单机产品，不适用 |
| 54 | Studio 可编辑（Interactive） | ➖ | 无 Studio |
| 55 | 渲后抽帧自查 | ⬜ | 无 |
| 56 | 多格式输出（webm/透明） | 🟡 | 待确认，当前主路径 h264 |

**汇总**：✅ 18 · 🟡 11 · ⬜ 24 · ➖ 3 = 56。剔除 ➖ 后分母 53 ⇒ **34.0%**（部分按 0.5 计 ⇒ 44.3%）。

---

## 4. 观感加权覆盖：40.2%

权重来源不是拍脑袋，是**反向从专业动效规则推**（`remotion-motion-quality-skill-survey-2026-10-19.md` §2.2 的 10 条规则 + iart 方法论）。3 分 = 直接决定「贵感」，2 分 = 明显影响，1 分 = 锦上添花。

状态系数：✅ 1.0 / 🟡 0.5 / ⬜ 0。

| 能力 | 权重 | 我们 | 得分 |
|---|---|---|---|
| 多段关键帧编排 | 3 | ✅ | 3.0 |
| 多轨叠加与层序 | 3 | ✅ | 3.0 |
| 缓动曲线族 | 3 | 🟡 | 1.5 |
| spring 物理 | 3 | ⬜ | 0 |
| 颜色过渡 | 3 | ⬜ | 0 |
| 调色 | 3 | ⬜ | 0 |
| 颗粒 / 暗角 | 3 | ⬜ | 0 |
| 转场质量与参数化 | 3 | 🟡 | 1.5 |
| 字号/排版自适应 | 3 | 🟡 | 1.5 |
| 图层混合模式 | 3 | ⬜ | 0 |
| 形状与路径 | 2 | ✅ | 2.0 |
| 视觉特效（5 类） | 2 | ✅ | 2.0 |
| 音频可视化 | 2 | ✅ | 2.0 |
| 静帧动感（KenBurns） | 2 | ✅ | 2.0 |
| 运动模糊 | 2 | ⬜ | 0 |
| 词级字幕 | 2 | ⬜ | 0 |
| 音量包络 | 2 | ⬜ | 0 |
| 素材裁剪 | 2 | ⬜ | 0 |
| **合计** | **46** | — | **18.5** |

**⇒ 40.2%**。也就是说：**与「好看」直接相关的表现力，我们只覆盖了约四成，且缺的都是高分项。**

---

## 5. 三类差距，处置完全不同

### 5.1 等价替代（不必补）

`Sequence` 平铺替代 `Series`、手写 `shape-geometry` 替代 `@remotion/shapes`、纯函数替代 `interpolate`。这些是为确定性渲染做的刻意取舍，**能力没丢**，只是实现路径不同。

### 5.2 真缺失且高影响（该补）

| 项 | 为什么高影响 | 成本 |
|---|---|---|
| 缓动曲线族（cubic/quart/expo + bezier） | 所有动画的「贵感」来源；二次曲线收尾软塌 | 低（纯函数 + 白名单扩充） |
| 调色 / 颗粒 / 暗角 | 直接决定「像成片」还是「像 PPT」 | 中（叠层 + 固定 seed 噪点） |
| spring | 有生命感的运动 | 中（纯函数 + 新枚举值） |
| 颜色过渡 | 主题色渐入、氛围变化 | 低（`color` 支持 `from/to`） |
| 转场参数化 | 8 种硬编码无法调方向/缓动 | 低（加 `easing`/`direction`） |
| 字号自适应（真实测量） | 长文案压字/溢出，UI 已踩过 | 中（`layout-utils fitText` 或 DOM 测量） |
| 词级字幕 | 讲解类短视频的标配 | 中（`@remotion/captions` 已在依赖里） |
| 素材裁剪 | 一条素材只用其中 3 秒，现在做不到 | 中（`trimBefore/After`） |
| 音量包络 | 转场处的音量突变很廉价 | 低（audio 轨加 fade） |

### 5.3 不适用（永久划掉）

`OffthreadVideo`、Lambda/CloudRun、Studio `Interactive`/`Track` 可编辑 —— 单机 CSR 产品没有这些场景，不要为了「追平官方」去补。

---

## 6. 编排层缺口（不在上表分母里，但更致命）

上面全是 **API 能力**。用户的「逻辑不严谨」还有一层**官方 API 也不管**的东西 —— 编排纪律：

| 能力 | 官方 | 我们 | 影响 |
|---|---|---|---|
| 退场（exit，比进场快） | 需自己写 | ⬜ 无字段 | 元素只进不出，画面永远在堆 |
| 错峰（stagger 3–6 帧） | 需自己写 | ⬜ 无原语 | 所有东西同时入场，观感假 |
| 运动 brief（beat / 主次 / 预算） | 无 | ⬜ 无 | 逐条拼动画，没有整体节奏 |
| 渲后自查 | 无 | ⬜ 无 | 没人看画面，错误直接交付 |

> 这四项**不消耗官方的任何 API 能力**，纯靠 skill + DSL 就能补，是**性价比最高的一块**。

---

## 7. 建议的补齐顺序（影响 ÷ 成本）

| 批次 | 内容 | 预期覆盖提升 |
|---|---|---|
| P0 | 缓动扩档 + 退场 + 编排三篇分册 | 40.2% → ~52% |
| P1 | 调色/颗粒/暗角 + 颜色过渡 + 转场参数化 | → ~65% |
| P2 | 真实文本测量 + 词级字幕 + 素材裁剪 + 音量包络 | → ~75% |
| 不做 | Lambda / Offthread / Studio 可编辑 | 分母永久剔除 |

> 上表百分比按同一权重重算；P0 三项里「退场」和「编排分册」在 §4 表外，故提升幅度含表外项。

---

## 8. 复现方法

```bash
# 主包导出总数
node -e "import('remotion').then(m=>console.log(Object.keys(m).length))"
# 实际 import 的具名导出
grep -rhE "import \{[^}]*\} from 'remotion'" src/remotion/ | tr ',' '\n' | sort -u
# 已装扩展包
ls node_modules/@remotion
# 动画原语实现
sed -n '350,365p' src/remotion/timing.ts
```
