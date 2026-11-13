/**
 * RQ-22（REQ-038）· **聚合型原语**渲染组件：`logoWall` / `assetGrid` / `chipRow` /
 * `codePanel` / `ticker` —— 每种把 N 个同构元素压成 1 条轨。
 *
 * 分层：布局与入场在 `aggregate-layout.ts` 纯函数（可单测、确定性）；本文件只把
 * 参数贴到样式上（与 TextCard「组件只贴计划」同一纪律）。
 *
 * 口径（契约见 `manifest-aggregates.ts`）：
 * - 所有 px 参数 = 1080 高设计 px，经 `scaleDesignPx` 按画布高缩放；
 * - `box` 中心语义，内容在盒内居中；整轨动画（animate/fx/exit/fadeFrames）走
 *   `resolveAnimatedStyle` 通用折算 —— 与其他轨型同一接线点；
 * - 单元入场错峰是**纯帧函数**（`unitEnterAt`），零随机源。
 */
import type React from 'react'
import { AbsoluteFill, Img, useCurrentFrame, useVideoConfig } from 'remotion'
import { flowLayout, gridLayout, unitEnterAt, estimateTextWidthPx } from '../aggregate-layout.js'
import { resolveAnimatedStyle } from '../animated-style.js'
import type { AssetGridTrack, ChipRowTrack, CodePanelTrack, LogoWallTrack, TickerTrack } from '../manifest-aggregates.js'
import { boxStyle } from '../shape-geometry.js'
import { scaleDesignPx } from '../type-scale.js'

/** 整轨壳：通用动画折算 + box 定位（与 Shape/TextCard 同构；子元素盒内 absolute）。 */
const AggShell: React.FC<{
  track: Parameters<typeof resolveAnimatedStyle>[0]
  children: React.ReactNode
}> = ({ track, children }) => {
  const anim = resolveAnimatedStyle(track, useCurrentFrame())
  const box = track.box ?? { x: 50, y: 50, w: 80, h: 50 }
  const left = anim.xDeclared ? anim.x : box.x
  const top = anim.yDeclared ? anim.y : box.y
  return (
    <AbsoluteFill style={{ opacity: anim.opacity }}>
      <div
        style={{
          position: 'absolute',
          ...boxStyle({ x: left, y: top, w: box.w, h: box.h }, anim.shapeTransform),
          overflow: 'hidden',
        }}
      >
        {children}
      </div>
    </AbsoluteFill>
  )
}

/** 盒尺寸 → 容器像素（px 换算的唯一入口，两种网格轨共用）。 */
function containerPx(box: { w: number; h: number }, width: number, height: number): { w: number; h: number } {
  return { w: (box.w / 100) * width, h: (box.h / 100) * height }
}

/** 网格轨（logoWall / assetGrid）共用体 —— 两者只差内容字段与缺省 fit。 */
const GridWall: React.FC<{
  entries: readonly string[]
  columns?: number | undefined
  cellW?: number | undefined
  cellH?: number | undefined
  gapX?: number | undefined
  gapY?: number | undefined
  radius?: number | undefined
  grayscale?: boolean | undefined
  fit: 'contain' | 'cover'
  unitStagger?: number | undefined
  unitFadeFrames?: number | undefined
  cellBackground?: string | undefined
  track: Parameters<typeof resolveAnimatedStyle>[0]
  localStartFrame: number
}> = ({ entries, columns, cellW, cellH, gapX, gapY, radius, grayscale, fit, unitStagger, unitFadeFrames, cellBackground, track }) => {
  const frame = useCurrentFrame()
  const { width, height } = useVideoConfig()
  // 帧号口径：本组件由 Root 的 `<Sequence from={track.startFrame}>` 包住，
  // `useCurrentFrame()` 已经是**轨内局部帧**（轨首帧 = 0）。再减一次 startFrame 会让
  // 单元入场延迟整整一个 startFrame（真机：startFrame=360 的 chipRow 第 720 帧才出现，
  // 晚出来的篇幅直接整段不可见）。局部帧直接用，不要再做二次换算。
  const local = frame
  const s = (designPx: number): number => scaleDesignPx(designPx, height)
  const cw = s(cellW ?? 120)
  const ch = s(cellH ?? cw)
  const container = containerPx(track.box ?? { x: 50, y: 50, w: 80, h: 50 }, width, height)
  const cells = gridLayout({
    count: entries.length,
    ...(columns === undefined ? {} : { columns }),
    cellW: cw,
    cellH: ch,
    ...(gapX === undefined ? {} : { gapX: s(gapX) }),
    ...(gapY === undefined ? {} : { gapY: s(gapY) }),
    containerW: container.w,
    containerH: container.h,
  })
  return (
    <AggShell track={track}>
      {entries.map((src, index) => {
        const cell = cells[index]
        if (cell === undefined) return null
        const enter = unitEnterAt(local, index, { ...(unitStagger === undefined ? {} : { stagger: unitStagger }), ...(unitFadeFrames === undefined ? {} : { fadeFrames: unitFadeFrames }) })
        return (
          <div
            key={`${index}-${src}`}
            style={{
              position: 'absolute',
              left: cell.x,
              top: cell.y,
              width: cw,
              height: ch,
              borderRadius: s(radius ?? 12),
              ...(cellBackground === undefined ? {} : { background: cellBackground }),
              overflow: 'hidden',
              opacity: enter.opacity,
              transform: `translateY(${enter.offsetY.toFixed(2)}px)`,
            }}
          >
            <Img
              src={src}
              style={{
                width: '100%',
                height: '100%',
                objectFit: fit,
                display: 'block',
                ...(grayscale === true ? { filter: 'grayscale(1)' } : {}),
              }}
            />
          </div>
        )
      })}
    </AggShell>
  )
}

export const LogoWall: React.FC<{ track: LogoWallTrack }> = ({ track }) => (
  <GridWall
    entries={track.logos}
    track={track}
    localStartFrame={track.startFrame}
    fit={track.fit ?? 'contain'}
    {...(track.columns !== undefined ? { columns: track.columns } : {})}
    {...(track.cellW !== undefined ? { cellW: track.cellW } : {})}
    {...(track.cellH !== undefined ? { cellH: track.cellH } : {})}
    {...(track.gapX !== undefined ? { gapX: track.gapX } : {})}
    {...(track.gapY !== undefined ? { gapY: track.gapY } : {})}
    {...(track.radius !== undefined ? { radius: track.radius } : {})}
    {...(track.grayscale !== undefined ? { grayscale: track.grayscale } : {})}
    {...(track.unitStagger !== undefined ? { unitStagger: track.unitStagger } : {})}
    {...(track.unitFadeFrames !== undefined ? { unitFadeFrames: track.unitFadeFrames } : {})}
    {...(track.cellBackground !== undefined ? { cellBackground: track.cellBackground } : {})}
  />
)

export const AssetGrid: React.FC<{ track: AssetGridTrack }> = ({ track }) => (
  <GridWall
    entries={track.assets}
    track={track}
    localStartFrame={track.startFrame}
    fit={track.fit ?? 'cover'}
    {...(track.columns !== undefined ? { columns: track.columns } : {})}
    {...(track.cellW !== undefined ? { cellW: track.cellW } : {})}
    {...(track.cellH !== undefined ? { cellH: track.cellH } : {})}
    {...(track.gapX !== undefined ? { gapX: track.gapX } : {})}
    {...(track.gapY !== undefined ? { gapY: track.gapY } : {})}
    {...(track.radius !== undefined ? { radius: track.radius } : {})}
    {...(track.unitStagger !== undefined ? { unitStagger: track.unitStagger } : {})}
    {...(track.unitFadeFrames !== undefined ? { unitFadeFrames: track.unitFadeFrames } : {})}
    {...(track.cellBackground !== undefined ? { cellBackground: track.cellBackground } : {})}
  />
)

export const ChipRow: React.FC<{ track: ChipRowTrack }> = ({ track }) => {
  const frame = useCurrentFrame()
  const { width, height } = useVideoConfig()
  // 局部帧口径：Sequence 已把 `startFrame` 偏移掉，这里不再二次相减（否则芯片要等
  // 到第 2×startFrame 帧才淡入，晚段芯片整段不可见）。
  const local = frame
  const s = (designPx: number): number => scaleDesignPx(designPx, height)
  const fontPx = s(track.fontPx ?? 22)
  const gap = s(track.gap ?? 12)
  const padX = s(track.padX ?? 16)
  const padY = s(track.padY ?? 8)
  const isColumn = track.direction === 'column'
  const box = track.box ?? { x: 50, y: 50, w: 70, h: 10 }
  const container = containerPx(box, width, height)
  const background = track.background ?? 'rgba(255,255,255,0.08)'
  // 主轴尺寸：文本估宽 + 水平内距（column 方向主轴是高，按行高 1 + padY 算）。
  const sizes = track.chips.map((chip) => (isColumn
    ? fontPx * 1.4 + padY * 2
    : estimateTextWidthPx(chip, fontPx) + padX * 2))
  const mainSize = isColumn ? container.h : container.w
  const offsets = flowLayout(sizes, gap, mainSize)
    // 装不下：左对齐继续排（溢出被盒裁掉 —— 「截断要看得到」，不静默挤压）。
    ?? (() => {
      const out: number[] = []
      let cursor = 0
      for (const size of sizes) {
        out.push(cursor)
        cursor += size + gap
      }
      return out
    })()
  return (
    <AggShell track={track}>
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: isColumn ? 'column' : 'row',
          alignItems: 'center',
          // 起点 = flowLayout 的居中起点（row 用 paddingLeft / column 用 paddingTop），
          // 主轴一律 flex-start —— column 用 justifyContent:'center' 会与 paddingTop
          // 双重居中（自查 review 修）。
          justifyContent: 'flex-start',
          ...(isColumn ? { paddingTop: offsets[0] ?? 0 } : { paddingLeft: offsets[0] ?? 0 }),
        }}
      >
        {track.chips.map((chip, index) => {
          const enter = unitEnterAt(local, index, { ...(track.unitStagger === undefined ? {} : { stagger: track.unitStagger }), ...(track.unitFadeFrames === undefined ? {} : { fadeFrames: track.unitFadeFrames }) })
          const marginMain = index === 0 ? 0 : gap
          return (
            <div
              key={`${index}-${chip}`}
              style={{
                opacity: enter.opacity,
                transform: `translateY(${enter.offsetY.toFixed(2)}px)`,
                padding: `${padY}px ${padX}px`,
                borderRadius: Math.min(s(track.radius ?? 999), (fontPx * 1.4 + padY * 2) / 2),
                ...(background === 'transparent' ? {} : { background }),
                ...(track.border === undefined ? {} : { border: `1px solid ${track.border}` }),
                color: track.color ?? '#ECECF2',
                fontSize: fontPx,
                fontWeight: 600,
                whiteSpace: 'nowrap',
                display: 'flex',
                alignItems: 'center',
                ...(isColumn
                  ? { marginTop: marginMain }
                  : { marginLeft: marginMain, height: fontPx * 1.4 + padY * 2 }),
              }}
            >
              {chip}
            </div>
          )
        })}
      </div>
    </AggShell>
  )
}

const CODE_FONT_STACK = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'

export const CodePanel: React.FC<{ track: CodePanelTrack }> = ({ track }) => {
  const frame = useCurrentFrame()
  const { height } = useVideoConfig()
  // 局部帧口径同上：Sequence 已偏移，`frame` 即轨内帧。
  const local = frame
  const s = (designPx: number): number => scaleDesignPx(designPx, height)
  const fontPx = s(track.fontPx ?? 18)
  const lineHeight = track.lineHeight ?? 1.5
  const padding = s(track.padding ?? 24)
  const speed = track.scrollSpeed ?? 0
  const lines = track.code.split('\n')
  return (
    <AggShell track={track}>
      <div
        style={{
          width: '100%',
          height: '100%',
          background: track.background ?? '#0D1117',
          borderRadius: s(track.radius ?? 16),
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {track.title !== undefined ? (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: s(10),
              padding: `${s(10)}px ${padding}px`,
              borderBottom: '1px solid rgba(255,255,255,0.08)',
              flexShrink: 0,
            }}
          >
            {['#ff5f57', '#febc2e', '#28c840'].map((dot, index) => (
              <div key={dot} style={{ width: s(10), height: s(10), borderRadius: '50%', background: index === 1 ? (track.accentColor ?? '#98A3FF') : dot, opacity: index === 1 ? 1 : 0.5 }} />
            ))}
            <div style={{ color: track.color ?? '#D4D4D8', fontSize: s(13), fontFamily: CODE_FONT_STACK, marginLeft: s(6) }}>{track.title}</div>
          </div>
        ) : null}
        <div style={{ flex: 1, overflow: 'hidden', padding, boxSizing: 'border-box' }}>
          <pre
            style={{
              margin: 0,
              fontFamily: CODE_FONT_STACK,
              fontSize: fontPx,
              lineHeight,
              color: track.color ?? '#D4D4D8',
              whiteSpace: 'pre',
              // 滚动：纯帧函数位移（0 = 静态）；内容超面板高时向上滚出（不循环）。
              ...(speed > 0 ? { transform: `translateY(${(-local * s(speed)).toFixed(2)}px)` } : {}),
            }}
          >
            {lines.join('\n')}
          </pre>
        </div>
      </div>
    </AggShell>
  )
}

export const Ticker: React.FC<{ track: TickerTrack }> = ({ track }) => {
  const frame = useCurrentFrame()
  const { width: canvasW, height } = useVideoConfig()
  // 局部帧口径同上：Sequence 已偏移，`frame` 即轨内帧。
  const local = frame
  const s = (designPx: number): number => scaleDesignPx(designPx, height)
  const fontPx = s(track.fontPx ?? 28)
  const gap = s(track.gap ?? 48)
  const speed = s(track.speed ?? 2)
  const separator = track.separator ?? ' · '
  const color = track.color ?? '#6E6E86'
  const fadeWidth = s(track.fadeWidth ?? 120)
  // 一轮内容 = items 用 separator 连接；循环平移一轮宽度 = 内容宽 + gap。
  const loopText = track.items.join(separator)
  const loopW = estimateTextWidthPx(loopText, fontPx) + gap
  // 循环取模（速度 × 帧号，纯帧函数；right 方向反向）。
  const offset = loopW > 0 ? (local * speed) % loopW : 0
  // shift ∈ [-loopW, 0)：可见区从 -shift 起最长「容器宽 + loopW」
  // ⇒ 轮数按容器宽动态 = ceil(viewport / loopW) + 2（自查 review 修：固定三轮
  // 在「短内容 × 宽容器」时会露底）。
  const boxW = ((track.box?.w ?? 80) / 100) * canvasW
  const roundCount = loopW > 0 ? Math.max(3, Math.ceil(boxW / loopW) + 2) : 1
  const shift = track.direction === 'right' ? offset - loopW : -offset
  const rounds = Array.from({ length: roundCount }, () => loopText)
  return (
    <AggShell track={track}>
      <div
        style={{
          width: '100%',
          height: '100%',
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          overflow: 'hidden',
          ...(fadeWidth > 0
            ? { maskImage: `linear-gradient(90deg, transparent 0, #000 ${fadeWidth}px, #000 calc(100% - ${fadeWidth}px), transparent 100%)`, WebkitMaskImage: `linear-gradient(90deg, transparent 0, #000 ${fadeWidth}px, #000 calc(100% - ${fadeWidth}px), transparent 100%)` }
            : {}),
        }}
      >
        <div
          style={{
            position: 'absolute',
            left: 0,
            whiteSpace: 'nowrap',
            display: 'flex',
            alignItems: 'center',
            gap,
            transform: `translateX(${shift.toFixed(2)}px)`,
          }}
        >
          {rounds.map((text, round) => (
            <div key={round} style={{ color, fontSize: fontPx, fontWeight: 600, whiteSpace: 'nowrap' }}>
              {text}
            </div>
          ))}
        </div>
      </div>
    </AggShell>
  )
}
