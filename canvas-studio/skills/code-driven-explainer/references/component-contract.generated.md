<!-- 机器生成：node scripts/gen-component-contract.mjs；请勿手改（改源码后重跑，tests/component-contract-drift.test.mjs 会红） -->

# 组件契约速查：合法值 / 合法键 / 默认常量（从源码生成）

> **写 manifest-spec 前读这一份就够，不要用 bash 去读 `src/remotion/**`。**
> 字段名、可选性、类型看同目录 `manifest-fields.generated.md`；怎么组合出好画面看 `manifest-contract.md`；
> 本表回答四件事：**哪些枚举值合法、哪些键会被「契约外字段」告警、默认常量是多少、机制的行为口径是什么**。
> 枚举 / 默认值由源码 AST 直接抽出，与源码逐字同步（有漂移门禁守着）；下方「行为语义速查」是手写口径段，
> 只写机制语义不写数值——数值一律以生成段为准（会话 19 实证：只给合法值不够，模型会为行为口径回去读源码）。

## 行为语义速查（机制口径；真机实证坑位标注出处）

- **reveal 两口径**：`reveal.direction` 是**进场**方向（可见区自该侧展开，`left` = 从左展开）；
  退场擦除用 `reveal.out.direction`（内容朝该侧**退去** ⇒ 隐藏侧在反方向）；`exit` 不支持 clip，
  不要拿 exit 做擦除。两段揭示窗口不得同帧「屏上全空」（四季片 D-08）。
- **入场首帧不空**（ML-15）：`fadeUp` 等 animate 的 `from.opacity` 要么 0（正常淡入）、
  要么 ≥0.35（完整可见）——**半截起步（如 0.25）= 首帧近全黑**，lint 会报（四季片 D-01）。
- **countUp**（dataCard 专用）：数值前 **45 帧缓出滚动**到目标值，前后缀原样保留；滚动期间卡片标签
  **不得与图表末点标签同值**（「2025 年」配滚动中间值 = 事实错误组合，ML-14）——标签用区间或「滚动中」。
- **gauge**：`values` 恰 1 项 = 进度值，分母 `gaugeMax`（缺省 100），中心数位滚动；
  指针类 = `shape` + `pivot:{x:50,y:100}` + `animate.rotation` 甩弧。
- **caption 字幕**：`fontSize` 缺省 = **canvasHeight×0.11**（720p 即 79px——四季片实测压住图形，
  显式给 40px 级）；折行宽 `widthPercent` 缺省 66；矮盒子给足 `box` 宽高防裁切。词级时间戳三级来源：
  显式 `words`（0-based）> **`audioFrames` 音频真值等分**（强烈建议填，填法见 `manifest-builder.md`）> 能量包络兜底。
- **shape `draw`（路径生长）**：非等比画布（`viewBox 0 0 100 100` + `PA=none` + 等宽描边）下
  Chrome 的 dash 语义整体坏 ⇒ **生长结束也是断续胶囊**（取证台 QR2 实证）。不需要绘制动画的线
  **不传 draw**（首帧即成）；确需 draw 接受退化或等根治批（pitfalls §9）。
- **音频人声**：`voiceOver[].volume` / `mix.voiceVolume` 范围 **0–2**（>1 为增益，补偿过轻 TTS，
  四季片 §6.4）；BGM / duck / 音轨 volume 仍 0–1。禁止重编码源音频凑响度（A 版提示词 A9）。
- **chart**：`title`（1–40 字）画在绘图区上方标题带；`labelEvery` / `maxLabels` 只抽**标签**
  不改数据点，首末点强制保留（末点是 countUp 锚点）；类目标签画在绘图区底边 88% 带内（§18.4）。

## src/remotion/manifest.ts

### 合法值与合法键

- `TRACK_TYPES`: 'video' | 'image' | 'textCard' | 'shape' | 'transition' | 'audioViz' | 'chart' | 'caption' | 'callout'
- `TEXT_VARIANTS`: 'subtitle' | 'dataCard' | 'title' | 'bullets'
- `SHAPES`: 'rect' | 'circle' | 'line' | 'gradient' | 'path' | 'arrow' | 'triangle' | 'star' | 'polygon'
- `EFFECTS`: 'fade' | 'slide' | 'zoom' | 'dissolve' | 'wipeLeft' | 'wipeRight' | 'clock' | 'flipX' | 'zoomBlur' | 'linearBlur' | 'crossWarp'
- `IMAGE_FITS`: 'cover' | 'contain' | 'kenburns'
- `TRACK_FX`: 'glow' | 'stroke' | 'shadow' | 'blur' | 'maskFade' | 'outline'
- `ORBIT_DIRECTIONS`: 'cw' | 'ccw'
- `AUDIO_VIZ_MODES`: 'bars' | 'mirror' | 'line'
- `TRACK_BLENDS`: 'normal' | 'screen' | 'multiply' | 'overlay' | 'soft-light'
- `TRANSITION_DIRECTIONS`: 'left' | 'right' | 'up' | 'down'
- `TEXT_ANIM_PRESETS`: 'fadeUp' | 'maskReveal' | 'typewriter' | 'wordStagger'
- `RENDER_QUALITIES`: 'draft' | 'standard' | 'high'
- `KNOWN_MANIFEST_KEYS`: 'id' | 'meta' | 'tracks' | 'audio' | 'global'
- `KNOWN_META_KEYS`: 'title' | 'width' | 'height' | 'fps' | 'durationInFrames' | 'backgroundColor' | 'look' | 'quality' | 'lint' | 'generatedBy'
- `KNOWN_BASE_TRACK_KEYS`: 'id' | 'type' | 'startFrame' | 'durationInFrames' | 'transform' | 'animate' | 'fadeFrames' | 'box' | 'orbit' | 'fx' | 'exit' | 'startAfter' | 'colorShift' | 'blend' | 'reveal'
- `KNOWN_TRACK_KEYS.video`: 'src' | 'kenBurns' | 'trimBeforeFrames' | 'playbackRate' | 'muted' | 'volume' | 'loop'
- `KNOWN_TRACK_KEYS.image`: 'src' | 'fit' | 'caption' | 'sourceRect' | 'hasAlpha'
- `KNOWN_TRACK_KEYS.textCard`: 'variant' | 'text' | 'data' | 'accentColor' | 'anim' | 'animOptions' | 'countUp' | 'dataSource'
- `KNOWN_TRACK_KEYS.shape`: 'shape' | 'color' | 'd' | 'strokeWidth' | 'draw' | 'pivot'
- `KNOWN_TRACK_KEYS.transition`: 'effect' | 'fromTrackId' | 'toTrackId' | 'easing' | 'softness' | 'direction'
- `KNOWN_TRACK_KEYS.audioViz`: 'src' | 'bars' | 'color' | 'mode' | 'gain' | 'heightPercent' | 'position' | 'smoothing' | 'gradient' | 'bandSplit' | 'bandColors'
- `KNOWN_TRACK_KEYS.chart`: 'source' | 'variant' | 'labels' | 'values' | 'lineValues' | 'lineLabel' | 'unit' | 'lineUnit' | 'color' | 'lineColor' | 'dataSource' | 'baseline' | 'title' | 'labelEvery' | 'maxLabels' | 'gaugeMax' | 'palette'
- `KNOWN_TRACK_KEYS.caption`: 'src' | 'text' | 'words' | 'fontSize' | 'widthPercent' | 'color' | 'activeColor' | 'dimColor' | 'audioFrames'
- `KNOWN_TRACK_KEYS.callout`: 'anchor' | 'text' | 'line' | 'color' | 'labelBackground'
- `KNOWN_TRANSFORM_KEYS`: 'x' | 'y' | 'scale' | 'rotation'
- `KNOWN_VISUAL_STATE_KEYS`: 'x' | 'y' | 'scale' | 'rotation' | 'opacity'
- `KNOWN_ANIMATE_KEYS`: 'from' | 'to' | 'startFrame' | 'durationInFrames' | 'easing' | 'spring' | 'anchor'
- `KNOWN_ORBIT_KEYS`: 'center' | 'radius' | 'startAngle' | 'periodInFrames' | 'direction'
- `KNOWN_ORBIT_CENTER_KEYS`: 'x' | 'y'
- `KNOWN_DRAW_KEYS`: 'to' | 'startFrame' | 'durationInFrames' | 'easing' | 'anchor'
- `KNOWN_EXIT_KEYS`: 'to' | 'durationInFrames' | 'easing' | 'gapFrames'
- `KNOWN_START_AFTER_KEYS`: 'trackId' | 'gapFrames'
- `KNOWN_COLOR_SHIFT_KEYS`: 'from' | 'to' | 'startFrame' | 'durationInFrames' | 'easing' | 'anchor'
- `KNOWN_LOOK_KEYS`: 'contrast' | 'saturation' | 'brightness' | 'temperature' | 'vignette' | 'grain'
- `KNOWN_TEXT_ANIM_OPTIONS_KEYS`: 'wordDelayFrames' | 'offsetY' | 'blur'
- `KNOWN_SPRING_KEYS`: 'stiffness' | 'damping' | 'mass'
- `KNOWN_REVEAL_KEYS`: 'kind' | 'direction' | 'durationInFrames' | 'startFrame' | 'center' | 'out'
- `KNOWN_REVEAL_OUT_KEYS`: 'direction' | 'durationInFrames' | 'gapFrames'
- `KNOWN_PERCENT_POINT_KEYS`: 'x' | 'y'
- `KNOWN_AUDIO_KEYS`: 'bgmUrl' | 'voiceOverUrl' | 'voiceOver' | 'mix' | 'fadeInSeconds' | 'fadeOutSeconds' | 'duck'
- `KNOWN_MIX_KEYS`: 'bgmVolume' | 'voiceVolume'
- `KNOWN_DUCK_KEYS`: 'amount'
- `KNOWN_GLOBAL_KEYS`: 'fontFamily' | 'fonts' | 'theme' | 'brandColor' | 'logo'
- `KNOWN_FONT_KEYS`: 'family' | 'weight' | 'src'

### 默认 / 边界常量

- `ASSET_URL_PREFIX` = '/canvas-studio/assets/'
- `MAX_VOICE_OVER_CLIPS` = 64
- `MAX_UNKNOWN_FIELD_WARNINGS` = 12

## src/remotion/reveal.ts

### 合法值与合法键

- `REVEAL_DIRECTIONS`: 'left' | 'right' | 'up' | 'down'

### 默认 / 边界常量

- `REVEAL_DEFAULT_DURATION_FRAMES` = 18
- `REVEAL_OUT_DEFAULT_DURATION_FRAMES` = 18
- `REVEAL_SPOTLIGHT_FINAL_RADIUS_PERCENT` = 85

## src/remotion/components/Chart.tsx

### 默认 / 边界常量

- `DEFAULT_BAR_COLOR` = '#4f9cf9'
- `DEFAULT_LINE_COLOR` = '#ffb454'

## src/remotion/components/Caption.tsx

### 默认 / 边界常量

- `DEFAULT_COLOR` = '#ffffff'
- `DEFAULT_ACTIVE_COLOR` = '#5ad2ff'
- `DEFAULT_DIM_COLOR` = 'rgba(232,238,252,0.28)'

## src/remotion/components/Callout.tsx

### 默认 / 边界常量

- `LINE_DRAW_FRAMES` = 20
- `LABEL_IN_FRAMES` = 14
- `LABEL_SETTLE_FRAMES` = 26
- `DOT_POP_FRAMES` = 18
- `DOT_POP_DURATION_FRAMES` = 8
- `DEFAULT_COLOR` = '#ffb454'
- `DEFAULT_LABEL_BACKGROUND` = 'rgba(10, 16, 28, 0.78)'

## skills/code-driven-explainer/assets/manifest-builder.mjs

### 默认 / 边界常量

- `SIZES` = { '16:9': { width: 1280, height: 720 }, '9:16': { width: 720, height: 1280 }, '1:1': { width: 720, height: 720 }, }
- `DEFAULT_THEME` = { background: '#0b1220', layer: '#111827', accent: '#38bdf8' }
