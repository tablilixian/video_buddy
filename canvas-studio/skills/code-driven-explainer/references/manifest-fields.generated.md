<!-- 机器生成：node scripts/gen-manifest-fields.mjs；请勿手改（改源码后重跑，门禁 tests/manifest-fields-drift.test.mjs 会红） -->

# Composition Manifest 字段表（从 src/remotion/manifest.ts 生成）

> **这是字段契约的权威清单**：字段名、可选性、枚举取值都以此为准，与源码逐字同步（有门禁守着）。
> 写 manifest 时**不要再去读 `src/remotion/manifest.ts` 确认字段名** —— 那份信息就在下面，读源码是最后一手且很贵。
> 本文件只讲「有哪些字段」，**怎么组合出好画面**看同目录的 `manifest-contract.md`。

## CompositionManifest
> 成片顶层 Manifest（`render_composition` 的唯一入参结构）。

- `id`: string — 唯一 id（用 `newAssetId()` 生成，便于血缘与重试）。
- `meta`: ManifestMeta
- `tracks`: CompositionTrack[] — 时间轴轨道（按 `startFrame` 排序后渲染；多轨同帧按数组顺序叠放）。
- `audio`?: ManifestAudio — 音频层（可选；复用现有 ffmpeg 混音语义）。
- `global`?: ManifestGlobal — 全局样式（字体 / 主题 / 品牌色）。

## ManifestMeta

- `title`: string
- `width`: number — 输出像素（与 `sizeForAspectRatio` 对齐，16:9 默认 1280×720 或 1920×1088）。
- `height`: number
- `fps`: number
- `durationInFrames`: number — 总时长（帧）；= max(track.endFrame)。
- `backgroundColor`?: string
- `look`?: ManifestLook — 三期 W2-4：**全片调色**（对比 / 饱和 / 亮度 / 色温 / 暗角 / 颗粒）。
- `quality`?: RenderQuality — 三期 W5-3：渲染质量档（也可由工具参数覆盖）。缺省 `standard`。
- `generatedBy`?: string
- `templateId`?: string — 1（CV-463）：产出这份 manifest 的模板 id（`family/id`）。手写 / 自由编排没有这一项。
- `lint`?: 'off' — 三期 W1-3：`off` = 跳过编排体检（lint 只告警，模型可显式关）。

## RenderQuality
> 三期 W5-3：三档质量预设（`draft` 半分辨率 + 低码率；`standard` 与今天完全一致）。

取值：'draft' | 'standard' | 'high'

## ManifestLook
> 三期 W2-4：全片调色参数。全部可选、全部有缺省中性值（缺省 = 不产生任何样式）。

- `contrast`?: number
- `saturation`?: number
- `brightness`?: number
- `temperature`?: number
- `vignette`?: number
- `grain`?: number

## CompositionTrack
> 轨道联合类型：视频 / 图片 / 文本卡 / 形状 / 转场 / 音频可视化 / 数据图表 / 词级字幕。

定义：| VideoClipTrack | ImageClipTrack | TextCardTrack | ShapeTrack | TransitionTrack | AudioVizTrack | ChartTrack | CaptionTrack | CalloutTrack

## BaseTrack

- `id`: string — 轨道 id（组件层的局部标识）。
- `startFrame`: number
- `durationInFrames`: number
- `box`?: ManifestBox — 会话效率优化（2026-10-26）· **区域声明 `box`**：把内容约束到画布的一个子区域，
- `transform`?: Transform — 静态变换（百分比坐标系，相对画布）。**5 种轨通用**（CV-334 从 `VideoClipTrack` 上提）。
- `animate`?: Animate | Animate[] — 帧级动画（CV-334 新增）：一条或**多条**，多条按数组顺序叠加（后者覆盖前者声明过的维度）。
- `fadeFrames`?: number — 首尾淡入淡出帧数（CV-334 新增）：`0` = **硬切**；缺省 `DEFAULT_FADE_FRAMES`（6），
- `orbit`?: OrbitMotion — 二期 A1：公转（帧级，纯函数求值）。
- `fx`?: TrackFx — 二期 A2：视觉效果（`glow` / `stroke` / `shadow` / `blur` / `maskFade`）。
- `exit`?: ExitMotion — 三期 W1-1：**退场动画**。缺省无退场（与三期之前完全一致）。
- `startAfter`?: StartAfter — 三期 W1-2：**顺序衔接**。与 `startFrame` 互斥。
- `blend`?: TrackBlend — 三期 W2-5：混合模式（CSS `mix-blend-mode`）。缺省 `normal` ⇒ 不写样式，
- `colorShift`?: ColorShift — 三期 W2-3：**颜色过渡**。作用于 `shape.color` / `textCard.accentColor` /
- `reveal`?: TrackReveal — P3（2026-11-03）：**分区揭示**（卡片级）。缺省无 = 整卡随轨道出现（与之前一致）。

## ExitMotion
> 三期 W1-1：退场动画。

- `to`: VisualState — 退场终点（只写想变的维度）。
- `durationInFrames`?: number — 退场耗时（帧）；缺省按入场时长的 0.6 倍推导。
- `easing`?: AnimateEasing — 缓动（缺省 `easeIn`：退场加速离开，与入场的减速落位互补）。
- `gapFrames`?: number — 距轨道末尾提前结束的帧数（缺省 0 = 贴着轨道末尾退场）。

## StartAfter
> 三期 W1-2：顺序衔接 —— 本轨从「另一条轨结束之后」开始。

- `trackId`: string
- `gapFrames`?: number — 两轨之间的空档帧（缺省 0 = 紧接）；**负数 = 与引用轨重叠的帧数**。

## TrackBlend
> 三期 W2-5：混合模式白名单（CSS `mix-blend-mode` 的子集）。

取值：'normal' | 'screen' | 'multiply' | 'overlay' | 'soft-light'

## ColorShift
> 三期 W2-3：颜色过渡（sRGB 线性插值）。

- `from`: string — 起始色（`#rgb` / `#rrggbb`）。
- `to`: string — 结束色（`#rgb` / `#rrggbb`）。
- `startFrame`?: number — 轨内相对起始帧（缺省 0）。
- `durationInFrames`?: number — 过渡时长（帧，缺省 = 整轨）。
- `easing`?: AnimateEasing — 缓动（缺省 `easeInOut`）。

## ManifestBox
> 区域声明（会话效率优化 2026-10-26）：0–100 画布百分比，**`x` / `y` 是区域中心**

- `x`: number — 区域中心的水平位置（0–100 画布百分比）。
- `y`: number — 区域中心的垂直位置（0–100 画布百分比）。
- `w`: number — 区域宽度（0–100 画布百分比）。
- `h`: number — 区域高度（0–100 画布百分比）。

## Transform
> 静态变换（百分比坐标系，相对画布）。

- `x`?: number — 水平中心位置（0–100，默认 50 居中）。
- `y`?: number — 垂直中心位置（0–100，默认 50 居中）。
- `scale`?: number — 缩放倍数，默认 1（必须 > 0）。
- `rotation`?: number — 旋转角度（度），默认 0。

## VisualState
> 帧级视觉状态（CV-334）：`Transform` 的超集，多一个 `opacity`。

- `x`?: number — 水平中心位置（0–100）。
- `y`?: number — 垂直中心位置（0–100）。
- `scale`?: number — 缩放倍数（> 0）。
- `rotation`?: number — 旋转角度（度）。
- `opacity`?: number — 不透明度（0–1）；与轨道淡入淡出**相乘**（不是覆盖）。

## AnimateEasing
> 缓动白名单（CV-334；三期 W2-1 扩档）。

取值：'linear' | 'easeIn' | 'easeOut' | 'easeInOut' | 'easeInCubic' | 'easeOutCubic' | 'easeInOutCubic' | 'easeOutQuart' | 'easeOutExpo' | 'easeOutCirc' | 'easeInOutExpo' | 'backOut' | 'spring'

## SpringConfig
> 三期 W2-2：spring 物理参数（缺省 170 / 18 / 1 ⇒ ζ≈0.69、过冲约 5%）。

- `stiffness`?: number — 刚度（越大越快）。
- `damping`?: number — 阻尼（越大越不过冲）。
- `mass`?: number — 质量（越大越慢）。

## Animate
> 一条帧级动画（CV-334）：轨内**相对帧**区间 `[startFrame, startFrame + durationInFrames)`

- `from`: VisualState — 起点（必填）。
- `to`: VisualState — 终点（必填）。
- `startFrame`?: number — 轨内相对起始帧（缺省 0 —— 即轨道开始）。
- `durationInFrames`?: number — 动画时长（帧，缺省 = 整轨长）。
- `easing`?: AnimateEasing — 缓动（缺省 `easeInOut`；`linear` 需显式指定）。
- `spring`?: SpringConfig — 三期 W2-2：`easing: 'spring'` 时的物理参数（其它缓动下无效）。

## OrbitMotion
> 二期 A1：**公转**（关系类动画的一等声明）。

- `center`: { x: number; y: number } — 圆心（百分比坐标）。
- `radius`: number — 半径（与 x/y 同单位，必须 > 0 且 ≤ 100）。
- `startAngle`?: number — 起始角度（度）。0° = 正右（+x），角度增大 = 顺时针（屏幕 y 向下）。缺省 0。
- `periodInFrames`?: number — 转一圈所需帧数（> 0）。缺省 = 本轨 `durationInFrames`。
- `direction`?: 'cw' | 'ccw' — 方向；缺省 `cw`（顺时针）。

## DrawMotion
> 二期 A1：**路径生长**（只用于 `shape:'path'` 轨）。

- `to`?: number — 生长到多少比例（0–1），缺省 1 = 全画出。
- `startFrame`?: number — 轨内相对起始帧（缺省 0）。
- `durationInFrames`?: number — 生长耗时（帧，缺省 = 整轨）。
- `easing`?: AnimateEasing — 缓动，沿用 `AnimateEasing` 白名单（缺省 `easeInOut`）。

## TrackFx
> 二期 A2：**视觉效果**（单值枚举，不做组合数组 —— 组合会让模型乱搭）。

取值：'glow' | 'stroke' | 'shadow' | 'blur' | 'maskFade' | 'outline'

## VideoClipTrack (extends BaseTrack)

- `type`: 'video'
- `src`: string — 同源资产 URL（`/canvas-studio/assets/...`）或本地绝对路径。
- `kenBurns`?: boolean — 是否启用 Ken-Burns 缓慢推拉（默认 false）。
- `trimBeforeFrames`?: number — 三期 W3-1：从源素材第几帧开始用（**输出合成帧**口径；源 fps 不同由宿主换算）。
- `playbackRate`?: number — 三期 W3-1：播放速率（0.1–4；0.5 = 慢动作，2 = 快放）。缺省 1。
- `muted`?: boolean — 三期 W3-1：静音（关掉片段原声）。缺省 false。
- `volume`?: number — 三期 W3-1：音量（0–1）。缺省 1。
- `loop`?: boolean — 三期 W3-1：轨道时长超过素材时循环播放。缺省 false。

## ImageClipTrack (extends BaseTrack)

- `type`: 'image'
- `src`: string
- `fit`?: 'cover' | 'contain' | 'kenburns' — 图片展示形态：`cover`（默认，填满）/ `contain`（留边）/ `kenburns`。
- `sourceRect`?: SpriteRect — CV-392（REQ-036 R-2）：精灵图子区域裁切 —— 百分比 `{x,y,w,h}`（0–100，与 box
- `hasAlpha`?: boolean — 素材含 alpha 通道（宿主在渲染前探测 PNG colorType 4/6 / WebP alpha 位后写入，
- `caption`?: string

## TextAnimPreset
> 三期 W4-2：文本动效预设。

取值：'fadeUp' | 'maskReveal' | 'typewriter' | 'wordStagger'

## TextAnimOptions
> 三期 W4-2：文本动效参数（全部有缺省值）。

- `wordDelayFrames`?: number — 相邻词/字之间错开多少帧（缺省 3）。
- `offsetY`?: number — 上浮距离（像素，缺省 14）。
- `blur`?: number — 模糊强度（像素，缺省 4；0 = 不模糊）。

## TextCardTrack (extends BaseTrack)

- `type`: 'textCard'
- `variant`: 'subtitle' | 'dataCard' | 'title' | 'bullets' — 卡片样式：字幕条 / 数据卡 / 标题卡 / 要点列表。
- `text`: string | string[] — 主文本（`subtitle` / `title` / `bullets` 每行一条）。
- `data`?: { k: string; v: string }[] — `dataCard` 专用：键值对（如 `[{k:'全球老龄化',v:'16%'}]`）。
- `accentColor`?: string
- `anim`?: TextAnimPreset — 三期 W4-2：入场文本动效预设（缺省无 —— 与三期之前一致）。
- `animOptions`?: TextAnimOptions — 三期 W4-2：文本动效参数。
- `countUp`?: boolean — P2'（2026-11-03）：`dataCard` 专用 —— 数位滚动。`data[].v` 是「纯数字 ± 前后缀」
- `dataSource`?: string — B-4（CV-440，P-01/P-17）：数值型事实的溯源声明 —— 触发口径收窄（见

## ShapeTrack (extends BaseTrack)

- `type`: 'shape'
- `shape`: 'rect' | 'circle' | 'line' | 'gradient' | 'path' | 'arrow' | 'triangle' | 'star' | 'polygon' — 形状种类：
- `color`: string
- `d`?: string — `shape:'path'` 必填：SVG path 的 `d`。
- `strokeWidth`?: number — `shape:'path'` 的描边宽度（百分比单位，缺省 0.5；相对 100 单位盒）。
- `draw`?: DrawMotion — `shape:'path'` 的生长控制；缺省 = 全画出。
- `pivot`?: { x?: number; y?: number } — 旋转 / 缩放轴心（P1，2026-11-03）：相对形状自身盒的百分比，CSS

## TransitionTrack (extends BaseTrack)

- `type`: 'transition'
- `effect`: 'fade' | 'slide' | 'zoom' | 'dissolve' | 'wipeLeft' | 'wipeRight' | 'clock' | 'flipX' | 'zoomBlur' | 'linearBlur' | 'crossWarp' — 作用于相邻两轨的转场类型。
- `fromTrackId`: string — 作用的源轨道 id（前一轨）。
- `toTrackId`: string — 作用的目标轨道 id（后一轨）。
- `easing`?: AnimateEasing — 三期 W2-6：转场缓动（缺省沿用各效果的线性推进 —— 老 manifest 不变）。
- `softness`?: number — 三期 W2-6：软化边缘（0–1；0 = 硬边，与今天一致）。只对 wipe 生效。
- `direction`?: 'left' | 'right' | 'up' | 'down' — 三期 W2-6：方向（只对 slide / wipe 生效；缺省按效果自身语义）。

## AudioVizTrack (extends BaseTrack)
> 二期 B1：**音频可视化**轨（波形 / 频谱柱随音频跳动）。

- `type`: 'audioViz'
- `src`: string — 音频资产 URL（与 `audio.bgmUrl` 同一套同源约束）。
- `bars`?: number — 柱数（缺省 24，范围 1–128）。
- `color`?: string — 柱色（缺省主题蓝）。
- `mode`?: 'bars' | 'mirror' | 'line' — 形态：`bars`（单向）/ `mirror`（上下对称）/ `line`（连续波形线）。缺省 `bars`。
- `gain`?: number — 振幅增益（0–4，缺省 1.6；人声/配乐响度差异大，靠它调视觉幅度）。
- `heightPercent`?: number — 波形区高度（占画布高度百分比，缺省 30）。
- `position`?: 'bottom' | 'top' — 贴底还是贴顶（缺省 `bottom`）。
- `smoothing`?: number — 三期 W3-3：帧间指数平滑（0–0.9；0 = 不平滑，与今天一致）。
- `gradient`?: { from?: string; to?: string } — 三期 W3-3：柱体渐变（缺省纯色）。
- `bandSplit`?: boolean — 能力基准 #06 收口（2026-10-31）：**分频段**模式 —— 六级 box 低通级联（窗口随
- `bandColors`?: string[] — 分频段柱色（低→高，2–6 项非空颜色；缺省 bench #06 实测六色族）。

## ChartTrack (extends BaseTrack)
> 能力基准 #04 收口（2026-10-31）：**数据图表**轨 —— 柱状图 / 柱状+折线双轴图。

- `type`: 'chart'
- `source`?: 'timeline' — 数据来源（A2，2026-10-31）：
- `dataSource`?: string — B-4（CV-440，P-01/P-17）：数据出处 —— 数据集名 + 可复核入口（如
- `baseline`?: string — B-4（CV-440，P-01/P-17）：口径 / 基准说明（如 `'1951–1980 基线距平'`）。
- `title`?: string — 图表标题（1–40 字，D-06）；仅在场时启用绘图区上方标题带（老 manifest 几何不变）。
- `labelEvery`?: number — x 轴标签抽稀步进（≥1 整数，优先于 maxLabels）；只抽标签不改数据点，首末点强制保留（D-09）。
- `maxLabels`?: number — 标签数上限（≥1 整数；未给 labelEvery 时等距取；首末点强制保留 ⇒ 1 等价 2）。
- `variant`: 'bars' | 'dual' | 'line' | 'pie' | 'donut' | 'gauge' — 图表形态（P2' 扩型，2026-11-03；4.1 扩型 2026-11-04）：`bars` = 柱状图；
- `labels`: string[] — 类目标签（与 `values` 一一对应；上限 32 项）。
- `values`: number[] — 主序列（柱，左轴；非负、有限，至少一个 > 0）。
- `lineValues`?: number[] — `variant:'dual'` 专用：副序列（折线，右轴），长度必须与 `labels` 一致。
- `lineLabel`?: string — 折线图例文案（`dual` 时显示在右轴旁）。
- `unit`?: string — 主序列单位后缀（轴标签与数值标签用，如 `s` / `%`；缺省无）。
- `lineUnit`?: string — 副序列单位后缀（缺省无）。
- `color`?: string — 柱色（缺省主题蓝 #4f9cf9）。
- `lineColor`?: string — 折线色（缺省琥珀 #ffb454）。
- `gaugeMax`?: number — `variant:'gauge'` 专用：进度分母（缺省 100；`values[0]` 不得大于它）。
- `palette`?: string[] — 扇形配色（pie / donut 逐片取用，超出长度循环；缺省内置 8 色板）。

## CaptionTrack (extends BaseTrack)
> 能力基准 #05 收口（2026-10-31）：**词级字幕（karaoke）**轨 —— 单句一条轨。

- `type`: 'caption'
- `src`: string — 该句旁白音频 URL（本轨自播；同源约束同 `tracks[].src`）。
- `text`: string — 同步文本（单句；标点不参与切分，骑在前后字间隙上）。
- `words`?: { text: string; from: number; to: number }[] — 显式词级时间戳（帧，**可选**）—— 与文本的口播字符（非标点）按顺序一一对应；
- `fontSize`?: number — 字号（px，缺省 = 画布高 × 0.11，bench 实测 120px@1080）。
- `widthPercent`?: number — 折行最大宽度（占画布宽百分比，缺省 66 —— bench 的 1280px@1920）。
- `color`?: string — 已读字颜色（缺省白）。
- `activeColor`?: string — 当前字颜色（缺省青 #5ad2ff + 辉光）。
- `dimColor`?: string — 未读字颜色（缺省 28% 白）。
- `audioFrames`?: number — 音频实际时长（帧，tts 真值）：词级等分基数（D-03），高亮随语音收束；缺省退回 durationInFrames。

## TrackReveal
> P3（2026-11-03）：**分区揭示**配置（`BaseTrack.reveal`，卡片级）。

- `kind`: 'wipe' | 'spotlight' — 揭示形态：`wipe` 帘式擦除 / `spotlight` 聚光圆从中心扩出。
- `direction`?: 'left' | 'right' | 'up' | 'down' — wipe 揭示行进方向（缺省 `right` = 从左往右揭开）。
- `durationInFrames`?: number — 揭示动画时长（帧，轨内相对；缺省 18）。
- `startFrame`?: number — 揭示起点（轨内相对帧，缺省 0 = 轨道一出现就开始揭示）。
- `center`?: { x?: number; y?: number } — spotlight 圆心（画布百分比，缺省 50/50）。
- `out`?: TrackRevealOut — 退场擦除（2026-11-04）：内容朝某侧擦出去。缺省 = 无退场擦除（轨尾硬切）。

## TrackRevealOut
> P2（2026-11-04）：**退场擦除**配置（`BaseTrack.reveal.out`，卡片级）。

- `direction`: 'left' | 'right' | 'up' | 'down' — 退场擦除方向：内容朝该侧退去（缺省 `right`）。
- `durationInFrames`?: number — 退场擦除时长（帧，轨内相对；缺省 18）。
- `gapFrames`?: number — 距轨道末尾的提前量（帧，缺省 0 = 贴着轨道末尾擦出去）。

## CalloutTrack (extends BaseTrack)
> P3（2026-11-03）：**callout 引线标注**轨 —— 「指着一个东西讲」的原语。

- `type`: 'callout'
- `anchor`: { x: number; y: number } — 锚点（画布百分比 0–100）：引线指着的那个点。
- `text`: string — 标签文案（单行，非空；上限 80 字符，建议 ≤24 字）。
- `line`?: 'elbow' | 'straight' — 引线形态：`elbow` 肘线（先直后折，缺省）/ `straight` 直线。
- `color`?: string — 线与标签文字颜色（缺省琥珀 #ffb454，与 chart 折线同族）。
- `labelBackground`?: string — 标签底色（缺省 rgba(10,16,28,0.78) 深色玻璃）。

## ManifestVoiceOver
> O-10：**单条旁白**（多句旁白各占一段时间轴）。

- `src`: string — 旁白资产 URL（`tts_voiceover` 产物，同源约束同 `tracks[].src`）。
- `startFrame`?: number — 该句在成片里的起始帧（缺省 0）。
- `volume`?: number — 单句人声音量（0–2，>1 为增益补偿过轻的 TTS）；缺省走 `mix.voiceVolume`（再缺省 1）。

## ManifestSfxAnchor
> sfx 的锚定定位：跟随某条轨的起点/终点。模板必用 —— 换例子、卡片位移时音效跟着走。

- `trackId`: string — 被锚定的轨 id。必须在 tracks[] 中存在，否则 error。
- `at`: 'start' | 'end' — 锚到该轨的起点还是终点（end = startFrame + durationInFrames）。
- `offsetSec`?: number — 相对锚点的偏移（秒，可负）。缺省 0。

## ManifestSfx
> `KNOWN_SFX_KEYS` / 校验规则见 `validateSfxList`。

- `src`: string — 音效素材 URL。与 tracks[].src 同一套同源约束（`validateAssetRefField`）。
- `anchor`?: ManifestSfxAnchor — 三定位之一（三者必须**恰好给一个**）。模板写法：跟随轨道。
- `startFrame`?: number — 三定位之二：成片绝对帧。GT 复刻验收用它（绕开秒→帧舍入）。
- `startSec`?: number — 三定位之三：成片绝对秒，渲染时 `Math.round(startSec * fps)`。跨 fps 复用靠它。
- `gain`?: number — 线性增益 0–2（缺省 1）。1 = 原音量。
- `pan`?: number — 声明用声像 −1..1（0 = 居中）。**仅在素材由本仓合成库产出时生效**（pan 在合成期
- `fadeInSec`?: number — 淡入（秒，缺省 0）。
- `fadeOutSec`?: number — 淡出（秒，缺省 0）。⚠️ 渲染器 MVP 只接**淡入**（`sfxVolumeAt`，startFrame 相对、
- `type`?: string — 可选溯源元数据：这份素材由哪个合成配方产出（渲染器不解释）。

## ManifestAudio

- `bgmUrl`?: string — BGM 资产 URL（复用 `compose_video` 的 `bgmNodeId` 语义）。
- `voiceOverUrl`?: string — 旁白资产 URL（`tts_voiceover` 产物）。**单轨兼容入口** —— 只有一句旁白时用这个；
- `voiceOver`?: ManifestVoiceOver[] — O-10：**多轨旁白**。`[{src, startFrame?, volume?}]`，宿主/渲染器按 `startFrame` 排到
- `mix`?: { bgmVolume?: number; voiceVolume?: number } — 混音音量：`bgmVolume` 0–1；`voiceVolume` 0–2（>1 为增益），缺省走 `BGM_MIX_VOLUME` / 1.0。
- `fadeInSeconds`?: number — 三期 W3-2：BGM 淡入（秒，缺省 0）。
- `fadeOutSeconds`?: number — 三期 W3-2：BGM 淡出（秒，缺省 0）。
- `duck`?: { amount?: number } — 三期 W3-2：BGM 自动闪避（D-09 选 A：以字幕窗口为依据，零音频分析）。
- `sfx`?: ManifestSfx[] — 音效事件轨。定位三选一（`anchor` / `startFrame` / `startSec`，互斥）。

## ManifestGlobal

- `fontFamily`?: string — 缺省字体族名；未随包且未缓存时走 §8 解析/下载链。
- `fonts`?: ManifestFont[] — 可选：动态字体描述（多语言扩展；随包子集未命中时按需下载并缓存）。
- `theme`?: 'light' | 'dark'
- `brandColor`?: string
- `logo`?: string — 品牌 logo 图同源 URL（同 `tracks[].src` 约束；品牌宣传 / 产品讲解体裁的固定 logo 位，六大体裁路线阶段 1.1）。

## ManifestFont

- `family`: string — 字体族名（与 CSS `font-family` / `global.fontFamily` 对应）。
- `weight`?: number — 字重，默认 400。
- `src`?: string — 字体文件同源 URL（同 `tracks[].src` 约束）；缺省由宿主字体解析表解析。

## ManifestValidation
> 校验结论：`ok=false` 时 `errors` 非空（拒绝渲染）；`warnings` 一律随渲染结果回传。

- `ok`: boolean
- `errors`: string[]
- `warnings`: string[]

## TrackAnimationWindow
> OPT-15（2026-10-26）：收集**带动画轨的动画窗口表**（纯函数，进渲染报告）。

- `id`: string — 轨 id。
- `start`: number — 窗口起点（绝对帧）。
- `end`: number — 窗口终点（绝对帧）。
- `kinds`: string[] — 动画种类（animate / exit / orbit，按轨实际声明）。

## ManifestAudioSummary
> OPT-11（2026-10-26）：成片音频构成摘要（**纯函数，由 manifest 确定性推导**）。

- `mutedVideoTracks`: number — 声明了 `muted: true` 的 video 轨数。
- `audibleSources`: number — 成片可能出声的源数量；`0` ⇒ 成片必然无声（平台保证）。
