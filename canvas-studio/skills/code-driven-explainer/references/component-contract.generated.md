<!-- 机器生成：node scripts/gen-component-contract.mjs；请勿手改（改源码后重跑，tests/component-contract-drift.test.mjs 会红） -->

# 组件契约速查：合法值 / 合法键 / 默认常量（从源码生成）

> **写 manifest-spec 前读这一份就够，不要用 bash 去读 `src/remotion/**`。**
> 字段名、可选性、类型看同目录 `manifest-fields.generated.md`；怎么组合出好画面看 `manifest-contract.md`；
> 本表只回答三件事：**哪些枚举值合法、哪些键会被「契约外字段」告警、默认常量是多少**。
> 下面每个值都由源码 AST 直接抽出，与源码逐字同步（有漂移门禁守着）；手写契约会漂，源码不会。

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
- `KNOWN_META_KEYS`: 'title' | 'width' | 'height' | 'fps' | 'durationInFrames' | 'backgroundColor' | 'look' | 'quality' | 'lint'
- `KNOWN_BASE_TRACK_KEYS`: 'id' | 'type' | 'startFrame' | 'durationInFrames' | 'transform' | 'animate' | 'fadeFrames' | 'box' | 'orbit' | 'fx' | 'exit' | 'startAfter' | 'colorShift' | 'blend' | 'reveal'
- `KNOWN_TRACK_KEYS.video`: 'src' | 'kenBurns' | 'trimBeforeFrames' | 'playbackRate' | 'muted' | 'volume' | 'loop'
- `KNOWN_TRACK_KEYS.image`: 'src' | 'fit' | 'caption' | 'sourceRect' | 'hasAlpha'
- `KNOWN_TRACK_KEYS.textCard`: 'variant' | 'text' | 'data' | 'accentColor' | 'anim' | 'animOptions' | 'countUp' | 'dataSource'
- `KNOWN_TRACK_KEYS.shape`: 'shape' | 'color' | 'd' | 'strokeWidth' | 'draw' | 'pivot'
- `KNOWN_TRACK_KEYS.transition`: 'effect' | 'fromTrackId' | 'toTrackId' | 'easing' | 'softness' | 'direction'
- `KNOWN_TRACK_KEYS.audioViz`: 'src' | 'bars' | 'color' | 'mode' | 'gain' | 'heightPercent' | 'position' | 'smoothing' | 'gradient' | 'bandSplit' | 'bandColors'
- `KNOWN_TRACK_KEYS.chart`: 'source' | 'variant' | 'labels' | 'values' | 'lineValues' | 'lineLabel' | 'unit' | 'lineUnit' | 'color' | 'lineColor' | 'dataSource' | 'baseline' | 'title' | 'labelEvery' | 'maxLabels' | 'gaugeMax' | 'palette'
- `KNOWN_TRACK_KEYS.caption`: 'src' | 'text' | 'words' | 'fontSize' | 'widthPercent' | 'color' | 'activeColor' | 'dimColor'
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
