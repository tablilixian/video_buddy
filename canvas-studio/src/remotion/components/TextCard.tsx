/** REQ-034 · B2 + 二期 A2/A5 + 三期 W2-3 / W2-5 / W4-1 / W4-2：四态文本卡。 */
import type React from 'react'
import { useMemo } from 'react'
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion'
import { resolveAnimatedStyle } from '../animated-style.js'
import { DATA_CARD_PADDING_X, dataCardDesignHeight, dataCardMetrics } from '../data-card-metrics.js'
import { SUBTITLE_LINE_HEIGHT, subtitleFitBudget } from '../subtitle-fit.js'
import { countUpTextAt } from '../count-up.js'
import type { TextAnimOptions, TextCardTrack } from '../manifest.js'
import { colorShiftAt, splitTextUnits, textUnitProgress } from '../timing.js'
import { timecodeStringAt } from '../timecode.js'
import { planTextFit, textFitSizingText, type TextFitPlan } from '../text-fit-plan.js'
import { createCanvasMeasurer } from '../text-measure.js'
import { useFontFamilyStack } from './font-context.js'

/** `text` 归一化为行数组（subtitle / title / bullets 都按行渲染）。 */
function linesOf(text: string | string[]): string[] {
  return Array.isArray(text) ? text : [text]
}

/**
 * 0B（CV-461）：真实字形测量器已迁到 `text-measure.ts`（渲染前体检要用**同一份**度量，
 * 各写一份必然漂移）；「按 variant 决定字号 / 行数」已迁到 `text-fit-plan.ts` 的 `planTextFit`
 * —— 组件只负责把计划贴到样式上，不再自己算预算。
 */

/**
 * 三期 W4-2：逐词/逐字渲染（`anim` 缺省时**不走这里** —— 老 manifest 的 DOM 与像素不变）。
 */
const AnimatedText: React.FC<{
  text: string
  preset: NonNullable<TextCardTrack['anim']>
  options: TextAnimOptions | undefined
}> = ({ text, preset, options }) => {
  const frame = useCurrentFrame()
  const units = useMemo(() => splitTextUnits(text, preset), [text, preset])
  const duration = preset === 'typewriter' ? 6 : 12
  return (
    <>
      {units.map((unit, index) => {
        if (unit.length === 0) return null
        if (/^\s+$/u.test(unit)) return <span key={`space-${index}`}>{unit}</span>
        const progress = textUnitProgress(index, frame, {
          preset,
          ...(options?.wordDelayFrames !== undefined ? { wordDelayFrames: options.wordDelayFrames } : {}),
          unitDurationInFrames: duration,
        })
        const offsetY = (1 - progress) * (options?.offsetY ?? 14)
        const blur = (1 - progress) * (options?.blur ?? 4)
        const style: React.CSSProperties = preset === 'maskReveal'
          ? {
            display: 'inline-block',
            // 遮罩揭示：从下往上「长」出来，字本身完全不透明。
            clipPath: `inset(${((1 - progress) * 100).toFixed(2)}% 0 0 0)`,
          }
          : {
            display: 'inline-block',
            opacity: progress,
            transform: `translateY(${offsetY.toFixed(2)}px)`,
            ...(blur > 0.01 ? { filter: `blur(${blur.toFixed(2)}px)` } : {}),
          }
        return <span key={`unit-${index}`} style={style}>{unit}</span>
      })}
    </>
  )
}

export const TextCard: React.FC<{ track: TextCardTrack }> = ({ track }) => {
  const frame = useCurrentFrame()
  const { width: canvasWidth, height: canvasHeight, fps } = useVideoConfig()
  // R1：字体族来自 `StudioComposition` 的 context（缺省＝随包中文字体），不再硬编码 sans-serif。
  const fontFamily = useFontFamilyStack()
  // 三期 W4-1：真实测量器（浏览器里才建；建不出来就回落估算）。
  const measurer = useMemo(() => createCanvasMeasurer(), [])
  // ⚠️ 逐句字幕卡**不做**首尾淡入淡出（2026-10-16 修）：字幕卡按句首尾相接排布，
  //    两卡各带 6 帧淡入淡出时，接缝处前后两卡的不透明度会同时落到 0（实测 0.00）
  //    ⇒ 每句交界闪一次背景。字幕按硬切切换是常规观感；要渐变过渡请用 `transition` 轨，
  //    或改用 `title` / `dataCard` 形态（它们保留淡入淡出）。
  //    CV-334：这条特例从"组件内写死"收敛为契约能力 —— 等价于 `fadeFrames: 0`，
  //    而模型现在可以显式写 `fadeFrames` 覆盖它（例如让某句带入场淡入）。
  const anim = resolveAnimatedStyle(track, frame, {
    defaultFadeFrames: track.variant === 'subtitle' ? 0 : undefined,
  })
  // 三期 W2-3：`colorShift` 覆盖静态强调色（缺省 null ⇒ 原色）。
  const accent = colorShiftAt(track, frame) ?? track.accentColor ?? '#4f9cf9'
  // RQ-03（REQ-038）：主文本色 —— 各变体的旧硬编码色即缺省值 ⇒ 老 manifest 逐像素不变。
  // 强调元素（timecode 标签 / dataCard 边框与数值 / bullets 圆点）仍走 `accent`。
  const mainColor = track.color ?? '#e6edf3'
  const lines = linesOf(track.text)
  // 二期 A2：效果统一由 `resolveAnimatedStyle` 折算，这里只展开 —— 不各自解读枚举。
  const textFx: React.CSSProperties = {
    ...(anim.fx.textShadow !== undefined ? { textShadow: anim.fx.textShadow } : {}),
    ...(anim.fx.textStroke !== undefined ? { WebkitTextStroke: anim.fx.textStroke } : {}),
    // CV-393：`outline` 镂空字 —— 填充覆写为透明，只剩描边（必须在 color 解析之后展开）。
    ...(anim.fx.textFill !== undefined ? { color: anim.fx.textFill } : {}),
    // `fx:'metal'`：渐变铺在文字上（#16 探针实证 background-clip:text 可行）。
    ...(anim.fx.textBackground !== undefined ? ({
      background: anim.fx.textBackground,
      WebkitBackgroundClip: 'text',
      backgroundClip: 'text',
      WebkitTextFillColor: 'transparent',
    } as React.CSSProperties) : {}),
  }
  // CV-334：整卡的位置 / 缩放 / 旋转走 `layerTransform`（铺满层上的位移＝把内容移出画布中心）。
  // 缺省参数下它是恒等串 ⇒ 老写法渲染结果不变。
  // 会话效率优化（2026-10-26）：`track.box` 在场 ⇒ 本层从「铺满画布」改为「盒子尺寸的
  // 定位层」（left/top/width/height 覆盖 AbsoluteFill 的 inset:0，绝对定位过约束时
  // right/bottom 被忽略）+ `translate(-50%,-50%)` 中心对齐 + `overflow: hidden`；
  // scale/rotation 走 `shapeTransform` 绕盒子中心生效。四个 variant 的内部排版
  // （justifyContent / 贴底字幕等）自然落到盒子内部，无需各自分支。
  const box = track.box
  const layer: React.CSSProperties = {
    opacity: anim.opacity,
    ...(box === undefined
      ? { transform: anim.layerTransform, transformOrigin: 'center' }
      : {
          left: `${box.x}%`,
          top: `${box.y}%`,
          width: `${box.w}%`,
          height: `${box.h}%`,
          transform: `translate(-50%, -50%) ${anim.shapeTransform}`,
          overflow: 'hidden',
        }),
    ...(anim.blend === 'normal' ? {} : { mixBlendMode: anim.blend }),
    ...(anim.fx.filter !== undefined ? { filter: anim.fx.filter } : {}),
    ...(anim.fx.maskImage !== undefined ? { maskImage: anim.fx.maskImage } : {}),
  }
  // 0B（CV-461）：**唯一一份**排版决策（字号 / 行数 / 要渲染的文本）。渲染期不再自己算预算，
  // 渲染前体检（`text-fit-audit.ts`）调的是同一个函数 ⇒ 「体检说没溢出、成片却裁了」不可能发生。
  // 依赖项都是整片恒定的量（manifest 轨 / 画布 / 字体 / 测量器），逐帧重算纯属浪费。
  const plan: TextFitPlan = useMemo(() => planTextFit({
    variant: track.variant,
    // S3：timecode 的排版口径 = 标签 + 时间码样串（组件与体检共用 textFitSizingText，
    // 只按标签算字号会把帧级时间码裁到只剩一两位 —— 真机实测 "REC 0"）。
    text: textFitSizingText(track.variant, track.text),
    ...(box === undefined ? {} : { box }),
    canvasWidth,
    canvasHeight,
    dataRows: (track.data ?? []).length,
    // RQ-02（REQ-038）：字距进折行预算 —— 与下方 CSS 的同一份值（度量与渲染同源）。
    ...(track.letterSpacing === undefined ? {} : { letterSpacingPx: track.letterSpacing }),
    ...(track.letterSpacingEm === undefined ? {} : { letterSpacingEm: track.letterSpacingEm }),
    ...(measurer === undefined ? {} : { measure: measurer }),
    family: fontFamily,
    weight: 700,
  }), [track, box, canvasWidth, canvasHeight, fontFamily, measurer])

  // RQ-02（REQ-038）：渲染层的字距 —— em 优先（CSS `em` 串相对最终字号，与折行预算
  // 的逐轮折算同口径）；px 原值。缺省 undefined ⇒ 不落属性（老 manifest 样式串不变）。
  const letterSpacingCss: string | number | undefined = track.letterSpacingEm !== undefined
    ? `${track.letterSpacingEm}em`
    : track.letterSpacing

  /** 三期 W4-2：有 `anim` 时逐词渲染，否则原样返回纯文本（老路径）。 */
  const animated = (value: string): React.ReactNode => {
    if (track.anim === undefined) return value
    return <AnimatedText text={value} preset={track.anim} options={track.animOptions} />
  }

  // S1-B：`timecode` 变体 —— HUD 帧级时间码 `HH:MM:SS:FF`。
  // 取值是**纯帧函数**（timecode.ts，禁真实时钟 ⇒ 同一 manifest 渲两次逐字节相同）；
  // `text` 是可选的静态标签（原片 HUD 的 `REC` / 相机名），`accentColor` 染标签。
  // `fontVariantNumeric: tabular-nums` 让数字逐帧等宽 —— 没它，时间码每秒抖一次宽度。
  if (track.variant === 'timecode') {
    const label = Array.isArray(track.text) ? track.text.join(' ') : track.text
    return (
      <AbsoluteFill style={{ ...layer, justifyContent: 'center', alignItems: 'center' }}>
        <div
          style={{
            fontFamily,
            fontVariantNumeric: 'tabular-nums',
            fontSize: plan.fontPx,
            fontWeight: 700,
            color: mainColor,
            letterSpacing: 2,
            display: 'flex',
            alignItems: 'baseline',
            gap: 12,
            ...textFx,
          }}
        >
          {label.length > 0 ? <span style={{ color: accent, fontSize: Math.max(10, Math.round(plan.fontPx * 0.62)) }}>{animated(label)}</span> : null}
          <span>{timecodeStringAt(frame, fps)}</span>
        </div>
      </AbsoluteFill>
    )
  }

  if (track.variant === 'subtitle') {
    // A5：字幕条可用宽度 = 86%（maxWidth）− 左右内边距 32×2；最多 3 行。
    //
    // 2026-11-04（科普 0.1 验收 P10b）**按盒子算预算**：
    // 旧实现一律按**画布**宽算字号/行数，而带 `box` 的字幕卡实际容器是**盒子**
    // （常常只有画布的 1/6 宽）⇒ 字号算得偏大、行数算得偏多 ⇒ 文字溢出，
    // 被层的 `overflow:hidden` 一刀裁掉（实测："0° Equator" 只剩 "Equator"，
    // "+23.5°N · Solstice" 只剩 "Solstice"，两行字幕只剩最后一行且首行被削成一条线）。
    //
    // 修法：带 box 时按**盒子的宽高**同时定「可用宽 / 可用高 / 基准字号 / 行数上限」，
    // 排不下就**缩字号**（`fitTextPolicy` 的老规矩：不静默截断，截断要看得见）。
    // 不带 box 的铺满卡走老参数 ⇒ 老 manifest 逐像素不变。
    // 预算口径在 `subtitle-fit.ts`（纯函数，可单测）。
    // 内距 / 外层留白仍由 `subtitleFitBudget` 给（与 plan 的预算同一个函数的同一份输入，
    // 不存在两套口径）；字号与文本换成 plan 的。
    const budget = subtitleFitBudget({
      box: box === undefined ? undefined : { w: box.w, h: box.h },
      canvasWidth,
      canvasHeight,
    })
    return (
      <AbsoluteFill style={{ ...layer, justifyContent: 'flex-end', alignItems: 'center', padding: budget.layerPad }}>
        <div
          style={{
            maxWidth: box === undefined ? '86%' : '100%',
            padding: `${budget.padY}px ${budget.padX}px`,
            borderRadius: 14,
            background: 'rgba(0,0,0,0.62)',
            color: track.color ?? '#f4f7fb',
            fontFamily,
            fontSize: plan.fontPx,
            lineHeight: SUBTITLE_LINE_HEIGHT,
            textAlign: 'center',
            whiteSpace: 'pre-line',
            ...(letterSpacingCss === undefined ? {} : { letterSpacing: letterSpacingCss }),
            ...textFx,
          }}
        >
          {animated(plan.renderText)}
        </div>
      </AbsoluteFill>
    )
  }

  if (track.variant === 'title') {
    // A5：标题最多 2 行、字号从 84 起缩。可用宽由 `planTextFit` 给：
    // 带 `box` 时按**盒宽**（0B-4 修的既有缺陷 —— 旧实现一律按画布 90%，窄盒里的标题
    // 字号算得偏大 ⇒ 折行后被盒子的 `overflow:hidden` 两侧裁掉），不带 box 走画布 90%。
    // RQ-07（REQ-038）：旧硬编码暗底降级为 `plate` 缺省值 `'auto'`；显式 `'none'`
    // = 无底板（标题直接叠画面）。不写 plate 的老 manifest 样式串逐字符一致。
    const plate = track.plate === 'none' ? undefined : 'rgba(0,0,0,0.35)'
    return (
      <AbsoluteFill style={{ ...layer, justifyContent: 'center', alignItems: 'center', ...(plate === undefined ? {} : { background: plate }) }}>
        <div
          style={{
            fontFamily,
            fontSize: plan.fontPx,
            fontWeight: 700,
            color: mainColor,
            textAlign: 'center',
            lineHeight: 1.15,
            whiteSpace: 'pre-line',
            ...(letterSpacingCss === undefined ? {} : { letterSpacing: letterSpacingCss }),
            ...textFx,
          }}
        >
          {animated(plan.renderText)}
        </div>
      </AbsoluteFill>
    )
  }

  if (track.variant === 'dataCard') {
    // 2026-11-06 修（真机事故）：设计宽 940 曾是**写死**的，而带 `box` 时外层容器宽是
    // `box.w%`、层上还有 `overflow:hidden` ⇒ 窄盒子把卡片从两侧裁掉，宽盒子仍是 940
    // 居中压住旁边的图表；模型侧改 box 不生效。现在外宽/缩放由纯函数求解
    //（`data-card-metrics.ts`，可单测）：窄容器等比缩小，1080p 无 box 的老 manifest
    // 逐像素不变。
    // 2026-11-06 修（真机）：同时约束**高**。矮盒子原来照样按宽度铺满内容，
    // 多余部分被 box 层的 `overflow:hidden` 上下削掉（标题被削顶、末行被削底）。
    const designHeight = dataCardDesignHeight({
      titleLines: lines.length,
      dataRows: (track.data ?? []).length,
    })
    const metric = dataCardMetrics(box, canvasWidth, { canvasHeight, designHeight })
    const px = (value: number): number => Math.round(value * metric.scale)
    return (
      <AbsoluteFill style={{ ...layer, justifyContent: 'center', alignItems: 'center' }}>
        <div
          style={{
            width: '100%',
            maxWidth: metric.outerWidth,
            boxSizing: 'border-box',
            padding: `${px(52)}px ${px(DATA_CARD_PADDING_X)}px`,
            borderRadius: px(26),
            background: 'linear-gradient(160deg, #161f38, #111726)',
            border: `1px solid ${accent}`,
            fontFamily,
            ...(anim.fx.boxShadow !== undefined ? { boxShadow: anim.fx.boxShadow } : {}),
          }}
        >
          <div style={{ fontSize: plan.fontPx, fontWeight: 700, color: mainColor, ...(letterSpacingCss === undefined ? {} : { letterSpacing: letterSpacingCss }), ...textFx }}>
            {animated(plan.renderText)}
          </div>
          <div style={{ height: 2, background: accent, margin: `${px(26)}px 0 ${px(10)}px` }} />
          {(track.data ?? []).map((row) => (
            <div
              key={`${row.k}-${row.v}`}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'baseline',
                padding: `${px(18)}px ${px(4)}px`,
                borderBottom: '1px solid rgba(255,255,255,0.08)',
              }}
            >
              <span style={{ fontSize: px(34), color: '#9aa7b4' }}>{row.k}</span>
              <span style={{ fontSize: px(42), fontWeight: 700, color: accent }}>
                {/* P2'：countUp 时数值前 45 帧滚动；不可解析的 v 由纯函数原样返回（静态）。 */}
                {track.countUp === true ? countUpTextAt(row.v, frame) : row.v}
              </span>
            </div>
          ))}
        </div>
      </AbsoluteFill>
    )
  }

  // bullets：每条一行，最多 6 行，字号从 48 起缩。容器宽 / 文字可用宽由 plan 给：
  // 0B-4 修了两处既有缺陷 —— ① 容器宽写死 900（480p 画布 864 时直接溢出画面）；
  // ② 折行按 900 算却**没扣 42px 圆点**（18px 点 + 24px 右距）⇒ 估算比实际宽 5%。
  const bulletLines = plan.renderText.split('\n')
  return (
    <AbsoluteFill style={{ ...layer, justifyContent: 'center', alignItems: 'center' }}>
      <div style={{ fontFamily, width: plan.containerWidthPx }}>
        {bulletLines.map((line, index) => (
          <div key={`${index}-${line}`} style={{ display: 'flex', alignItems: 'center', margin: '18px 0' }}>
            <div style={{ width: 18, height: 18, borderRadius: 9, background: accent, marginRight: 24 }} />
            <div style={{ fontSize: plan.fontPx, color: mainColor, ...(letterSpacingCss === undefined ? {} : { letterSpacing: letterSpacingCss }), ...textFx }}>
              {animated(line)}
            </div>
          </div>
        ))}
      </div>
    </AbsoluteFill>
  )
}
