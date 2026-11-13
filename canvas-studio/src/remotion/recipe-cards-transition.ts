/**
 * SSR 消化批 · transition 类目卡(来源:video-shotcraft-dsh demos/transition,
 * Apache-2.0,手法参考、表达重写;逐卡翻译对照见 shotcraft-catalog.md)。
 */
import { registerCard } from './recipe-cards.js'

// ── TRN1 · shot-transitions(白闪切)──
// 上游 A 式:暖白闪盖住切点 → 新镜头已在闪下。白闪 rect + 新内容 fadeUp。
registerCard({
  id: 'TRN1',
  title: '白闪切换',
  assets: [{ slot: 'shotNext', kind: 'image', source: 'user', required: false, fallback: '缺图降级为深底字卡' }],
  generate: (ctx) => {
    const src = ctx.assetSrc('shotNext')
    return [
      { id: `${ctx.segmentId}-bg`, type: 'shape', shape: 'rect', color: '#0b0e14', box: { x: 50, y: 50, w: 100, h: 100 }, startFrame: ctx.startFrame, durationInFrames: ctx.durationInFrames, fadeFrames: 0 },
      ...(src !== undefined ? [{ id: `${ctx.segmentId}-next`, type: 'image', src, fit: 'cover', box: { x: 50, y: 50, w: 100, h: 100 }, startFrame: ctx.startFrame + 8, durationInFrames: Math.max(10, ctx.durationInFrames - 8), fadeFrames: 0 }] : []),
      { id: `${ctx.segmentId}-flash`, type: 'shape', shape: 'rect', color: '#fdf6e8',
        animate: [{ from: { opacity: 0.95 }, to: { opacity: 0 }, startFrame: 0, durationInFrames: 10, easing: 'easeOut' }],
        box: { x: 50, y: 50, w: 100, h: 100 }, startFrame: ctx.startFrame, durationInFrames: 10, fadeFrames: 0 },
      { id: `${ctx.segmentId}-word`, type: 'textCard', variant: 'title', text: ctx.copy,
        box: { x: 50, y: 48, w: 66, h: 20 }, plate: 'none', color: '#f5f2ea',
        anim: 'fadeUp', animOptions: { offsetY: 16 },
        startFrame: ctx.startFrame + 14, durationInFrames: Math.max(12, ctx.durationInFrames - 18), fadeFrames: 0 },
    ]
  },
})

// ── TRN2 · wipe-transitions(扇形扫描)──
// 上游:clock 扇形扫出新内容(transition.clock 效果原生)。
registerCard({
  id: 'TRN2',
  title: '扇形扫切',
  assets: [{ slot: 'shotNext', kind: 'image', source: 'user', required: false, fallback: '缺图降级为纯色扫切' }],
  generate: (ctx) => {
    const src = ctx.assetSrc('shotNext')
    return [
      { id: `${ctx.segmentId}-bg`, type: 'shape', shape: 'rect', color: '#10141c', box: { x: 50, y: 50, w: 100, h: 100 }, startFrame: ctx.startFrame, durationInFrames: ctx.durationInFrames, fadeFrames: 0 },
      ...(src !== undefined ? [{ id: `${ctx.segmentId}-next`, type: 'image', src, fit: 'cover', box: { x: 50, y: 50, w: 100, h: 100 }, startFrame: ctx.startFrame + 10, durationInFrames: Math.max(10, ctx.durationInFrames - 10), fadeFrames: 0 }] : [{ id: `${ctx.segmentId}-next`, type: 'shape', shape: 'rect', color: ctx.accentColor, box: { x: 50, y: 50, w: 100, h: 100 }, startFrame: ctx.startFrame + 10, durationInFrames: Math.max(10, ctx.durationInFrames - 10), fadeFrames: 0 }]),
      { id: `${ctx.segmentId}-clock`, type: 'transition', effect: 'clock', fromTrackId: `${ctx.segmentId}-bg`, toTrackId: `${ctx.segmentId}-next`,
        startFrame: ctx.startFrame, durationInFrames: 24 },
      { id: `${ctx.segmentId}-word`, type: 'textCard', variant: 'subtitle', text: ctx.copy,
        box: { x: 50, y: 88, w: 50, h: 7 }, background: 'rgba(0,0,0,0.6)', color: '#eef1f6',
        startFrame: ctx.startFrame + 26, durationInFrames: Math.max(8, ctx.durationInFrames - 30), fadeFrames: 0 },
    ]
  },
})

// ── TRN3 · circle-match-iris(圆环虹切)──
// 上游:反向 iris(radial 硬色标中心透明扩张)→ gradient radial + animate scale。
registerCard({
  id: 'TRN3',
  title: '圆环虹切',
  assets: [{ slot: 'shotNext', kind: 'image', source: 'user', required: false, fallback: '缺图降级为纯色虹切' }],
  generate: (ctx) => {
    const src = ctx.assetSrc('shotNext')
    return [
      { id: `${ctx.segmentId}-bg`, type: 'shape', shape: 'rect', color: '#0c1018', box: { x: 50, y: 50, w: 100, h: 100 }, startFrame: ctx.startFrame, durationInFrames: ctx.durationInFrames, fadeFrames: 0 },
      ...(src !== undefined ? [{ id: `${ctx.segmentId}-next`, type: 'image', src, fit: 'cover', box: { x: 50, y: 50, w: 100, h: 100 }, startFrame: ctx.startFrame + 6, durationInFrames: Math.max(10, ctx.durationInFrames - 6), fadeFrames: 0 }] : [{ id: `${ctx.segmentId}-next`, type: 'shape', shape: 'rect', color: ctx.accentColor, box: { x: 50, y: 50, w: 100, h: 100 }, startFrame: ctx.startFrame + 6, durationInFrames: Math.max(10, ctx.durationInFrames - 6), fadeFrames: 0 }]),
      { id: `${ctx.segmentId}-iris`, type: 'shape', shape: 'gradient', gradientType: 'radial',
        gradientCenter: { x: 50, y: 50 }, gradientRadius: { x: 52, y: 52 },
        color: 'rgba(0,0,0,1)', gradientTo: 'rgba(0,0,0,1)',
        animate: [{ from: { scale: 0.12 }, to: { scale: 2.6 }, startFrame: 4, durationInFrames: 26, easing: 'easeInOutCubic' }],
        box: { x: 50, y: 50, w: 100, h: 100 }, startFrame: ctx.startFrame, durationInFrames: 30, fadeFrames: 0,
        exit: { durationInFrames: 1, to: { opacity: 0 } } },
      { id: `${ctx.segmentId}-word`, type: 'textCard', variant: 'subtitle', text: ctx.copy,
        box: { x: 50, y: 86, w: 46, h: 7 }, background: 'rgba(0,0,0,0.6)', color: '#eef1f6',
        startFrame: ctx.startFrame + 30, durationInFrames: Math.max(8, ctx.durationInFrames - 34), fadeFrames: 0 },
    ]
  },
})

// ── TRN4 · white-flash-logo-simplify-cut(白闪落标)──
// 上游:连续白闪中 logo 逐次简化,最后一闪落定为纯字标。
registerCard({
  id: 'TRN4',
  title: '白闪落标',
  assets: [],
  generate: (ctx) => {
    const flashes = [16, 44, 72]
    const tracks: Record<string, unknown>[] = [
      { id: `${ctx.segmentId}-bg`, type: 'shape', shape: 'rect', color: '#0b0e14', box: { x: 50, y: 50, w: 100, h: 100 }, startFrame: ctx.startFrame, durationInFrames: ctx.durationInFrames, fadeFrames: 0 },
      { id: `${ctx.segmentId}-full`, type: 'textCard', variant: 'title', text: '{{full}}', plate: 'none', color: '#f2f2f2',
        box: { x: 50, y: 48, w: 70, h: 18 }, startFrame: ctx.startFrame, durationInFrames: 16, fadeFrames: 0 },
      { id: `${ctx.segmentId}-mid`, type: 'textCard', variant: 'title', text: '{{mid}}', plate: 'none', color: '#f2f2f2',
        box: { x: 50, y: 48, w: 50, h: 18 }, startFrame: ctx.startFrame + 44, durationInFrames: 28, fadeFrames: 0 },
      { id: `${ctx.segmentId}-mark`, type: 'textCard', variant: 'title', text: ctx.label, plate: 'none', color: ctx.accentColor,
        letterSpacingEm: 0.08, box: { x: 50, y: 48, w: 40, h: 18 },
        animate: [{ from: { opacity: 0, scale: 1.1 }, to: { opacity: 1, scale: 1 }, startFrame: 72, durationInFrames: 14, easing: 'easeOutExpo' }],
        startFrame: ctx.startFrame, durationInFrames: ctx.durationInFrames, fadeFrames: 0 },
    ]
    for (const [i, f] of flashes.entries()) {
      tracks.push({ id: `${ctx.segmentId}-flash-${i + 1}`, type: 'shape', shape: 'rect', color: '#ffffff',
        animate: [{ from: { opacity: 0.95 }, to: { opacity: 0 }, startFrame: 0, durationInFrames: 8, easing: 'easeOut' }],
        box: { x: 50, y: 50, w: 100, h: 100 }, startFrame: ctx.startFrame + f, durationInFrames: 8, fadeFrames: 0 })
    }
    return tracks
  },
})

// ── TRN5 · mosaic-reframe(马赛克重排)──
// 上游:满屏碎片 → 重排成新构图。assetGrid 网格近似(碎片素材 user 通道)。
registerCard({
  id: 'TRN5',
  title: '碎片重排',
  assets: [{ slot: 'tiles', kind: 'image', source: 'user', required: false, fallback: '缺碎片降级为色块网格(assetGrid 无图时的单元底色)' }],
  generate: (ctx) => {
    const tiles = (ctx.assetSrc('tiles') ?? '').split(/[,\n]/).map((line) => line.trim()).filter(Boolean).slice(0, 12)
    const tracks: Record<string, unknown>[] = [
      { id: `${ctx.segmentId}-bg`, type: 'shape', shape: 'rect', color: '#0b0e14', box: { x: 50, y: 50, w: 100, h: 100 }, startFrame: ctx.startFrame, durationInFrames: ctx.durationInFrames, fadeFrames: 0 },
    ]
    if (tiles.length > 0) {
      tracks.push({ id: `${ctx.segmentId}-grid`, type: 'assetGrid', assets: tiles, columns: 4,
        cellW: 220, cellH: 140, gapX: 10, gapY: 10, radius: 6, fit: 'cover',
        unitStagger: 3, box: { x: 50, y: 48, w: 84, h: 62 }, startFrame: ctx.startFrame, durationInFrames: ctx.durationInFrames, fadeFrames: 0 })
    } else {
      tracks.push({ id: `${ctx.segmentId}-grid`, type: 'logoWall', logos: Array.from({ length: 12 }, (_, i) => `/canvas-studio/assets/demo/tile-${i}.png`), columns: 4,
        cellW: 220, cellH: 140, gapX: 10, gapY: 10, radius: 6, grayscale: true, unitStagger: 3,
        box: { x: 50, y: 48, w: 84, h: 62 }, startFrame: ctx.startFrame, durationInFrames: ctx.durationInFrames, fadeFrames: 0 })
    }
    tracks.push({ id: `${ctx.segmentId}-word`, type: 'textCard', variant: 'subtitle', text: ctx.copy,
      box: { x: 50, y: 88, w: 52, h: 7 }, background: 'rgba(0,0,0,0.6)', color: '#eef1f6',
      startFrame: ctx.startFrame + 30, durationInFrames: Math.max(8, ctx.durationInFrames - 34), fadeFrames: 0 })
    return tracks
  },
})
