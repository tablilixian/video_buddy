/**
 * SSR 消化批 · opening 类目卡(来源:video-shotcraft-dsh demos/opening,Apache-2.0,
 * 手法参考、表达重写;逐卡翻译对照见 shotcraft-catalog.md)。
 */
import { registerCard } from './recipe-cards.js'

// ── OPN1 · stroke-segment-build(描线搭建)──
// 上游:分段描线依次生长,搭出主视觉轮廓(判定「能」:path+draw 原生)。
registerCard({
  id: 'OPN1',
  title: '描线搭建',
  assets: [],
  generate: (ctx) => {
    // 预烘焙三段线(画布坐标,确定性)
    const seg = (x0: number, y0: number, x1: number, y1: number) => `M${x0},${y0}L${x1},${y1}`
    const lines = [
      { d: seg(20, 30, 80, 30), start: 4 },
      { d: seg(80, 30, 80, 66), start: 18 },
      { d: seg(80, 66, 20, 66), start: 32 },
      { d: seg(20, 66, 20, 30), start: 46 },
    ]
    return [
      { id: `${ctx.segmentId}-bg`, type: 'shape', shape: 'rect', color: '#0a0d14', box: { x: 50, y: 50, w: 100, h: 100 }, startFrame: ctx.startFrame, durationInFrames: ctx.durationInFrames, fadeFrames: 0 },
      ...lines.map((line, i) => ({ id: `${ctx.segmentId}-line-${i + 1}`, type: 'shape', shape: 'path', color: ctx.accentColor,
        d: line.d, strokeWidth: 0.8, draw: { to: 1, startFrame: line.start, durationInFrames: 12, easing: 'easeInOutCubic' },
        startFrame: ctx.startFrame, durationInFrames: ctx.durationInFrames, fadeFrames: 0 })),
      { id: `${ctx.segmentId}-word`, type: 'textCard', variant: 'title', text: ctx.copy,
        box: { x: 50, y: 48, w: 56, h: 16 }, plate: 'none', color: '#eef1f6',
        anim: 'fadeUp', animOptions: { offsetY: 14 },
        startFrame: ctx.startFrame + 56, durationInFrames: Math.max(12, ctx.durationInFrames - 60), fadeFrames: 0 },
    ]
  },
})

// ── OPN2 · crane-rise-reveal(摇臂升起)──
// 上游:特写局部 → 相机拉升 revealing 全景(判定「能(2D 轻量)」,camera keys)。
registerCard({
  id: 'OPN2',
  title: '摇臂升起',
  assets: [{ slot: 'shotImage', kind: 'image', source: 'user', required: false, fallback: '缺图降级为深底字卡' }],
  generate: (ctx) => {
    const src = ctx.assetSrc('shotImage')
    return [
      { id: `${ctx.segmentId}-bg`, type: 'shape', shape: 'rect', color: '#0a0e16', box: { x: 50, y: 50, w: 100, h: 100 }, startFrame: ctx.startFrame, durationInFrames: ctx.durationInFrames, fadeFrames: 0 },
      { id: `${ctx.segmentId}-shot`, type: src === undefined ? 'shape' : 'image',
        ...(src === undefined ? { shape: 'rect', color: '#1a2233' } : { src, fit: 'cover' as const }),
        box: { x: 50, y: 50, w: 100, h: 100 },
        camera: { keys: [
          { frame: 0, x: 0, y: 220, zoom: 1.9, rotX: 0, rotY: 0, rotZ: 0, persp: 1000 },
          { frame: 70, x: 0, y: 0, zoom: 1.0, rotX: 0, rotY: 0, rotZ: 0, persp: 1000 },
          { frame: 100, x: 0, y: 0, zoom: 1.0, rotX: 0, rotY: 0, rotZ: 0, persp: 1000 },
        ], easing: 'easeInOutCubic' },
        startFrame: ctx.startFrame, durationInFrames: ctx.durationInFrames, fadeFrames: 0 },
      { id: `${ctx.segmentId}-word`, type: 'textCard', variant: 'title', text: ctx.copy,
        box: { x: 50, y: 46, w: 66, h: 20 }, plate: 'none', color: '#f2f4f8', letterSpacingEm: -0.015,
        anim: 'maskReveal', startFrame: ctx.startFrame + 66, durationInFrames: Math.max(12, ctx.durationInFrames - 70), fadeFrames: 0 },
    ]
  },
})

// ── OPN3 · letterspace-materialize(字距显形)──
// 上游:宽字距字符逐个描画成形(START 16,DUR 52,无错峰齐收)→ path draw 逐字符近似。
registerCard({
  id: 'OPN3',
  title: '字距显形',
  assets: [],
  generate: (ctx) => {
    const word = (ctx.label ?? ctx.copy).trim().slice(0, 6)
    const chars = [...word]
    const tracks: Record<string, unknown>[] = [
      { id: `${ctx.segmentId}-bg`, type: 'shape', shape: 'rect', color: '#0c1018', box: { x: 50, y: 50, w: 100, h: 100 }, startFrame: ctx.startFrame, durationInFrames: ctx.durationInFrames, fadeFrames: 0 },
      { id: `${ctx.segmentId}-word`, type: 'textCard', variant: 'title', text: chars.join(' '),
        box: { x: 50, y: 46, w: 70, h: 20 }, plate: 'none', color: '#eef1f6',
        letterSpacingEm: 0.3, anim: 'fadeUp', animOptions: { offsetY: 12, blur: 6 },
        startFrame: ctx.startFrame + 16, durationInFrames: Math.max(12, ctx.durationInFrames - 20), fadeFrames: 0 },
    ]
    // 每字符下的小刻度线(错峰淡入,呼应「描画成形」)
    chars.forEach((_, i) => {
      tracks.push({ id: `${ctx.segmentId}-tick-${i + 1}`, type: 'shape', shape: 'rect', color: ctx.accentColor,
        box: { x: 26 + i * (48 / Math.max(1, chars.length - 1)), y: 62, w: 0.5, h: 2.4 },
        animate: [{ from: { opacity: 0 }, to: { opacity: 1 }, startFrame: 16 + i * 3, durationInFrames: 8, easing: 'easeOut' }],
        startFrame: ctx.startFrame, durationInFrames: ctx.durationInFrames, fadeFrames: 0 })
    })
    return tracks
  },
})

// ── OPN4 · spotlight-hero-card(聚光主角卡)──
// 上游:全屏压暗 → 聚光池照亮主角卡(径向光晕 + 相机微推)。
registerCard({
  id: 'OPN4',
  title: '聚光主角卡',
  assets: [{ slot: 'shotImage', kind: 'image', source: 'user', required: false, fallback: '缺图降级为色块主角卡' }],
  generate: (ctx) => {
    const src = ctx.assetSrc('shotImage')
    return [
      { id: `${ctx.segmentId}-bg`, type: 'shape', shape: 'rect', color: '#0a0e16', box: { x: 50, y: 50, w: 100, h: 100 }, startFrame: ctx.startFrame, durationInFrames: ctx.durationInFrames, fadeFrames: 0 },
      { id: `${ctx.segmentId}-card`, type: src === undefined ? 'shape' : 'image',
        ...(src === undefined ? { shape: 'rect', color: '#1c2436' } : { src, fit: 'cover' as const }),
        box: { x: 50, y: 48, w: 34, h: 46 }, radius: 10,
        startFrame: ctx.startFrame, durationInFrames: ctx.durationInFrames, fadeFrames: 0,
        camera: { keys: [
          { frame: 0, x: 0, y: 0, zoom: 1.0, rotX: 0, rotY: 0, rotZ: 0, persp: 1000 },
          { frame: 80, x: 0, y: 0, zoom: 1.1, rotX: 0, rotY: 0, rotZ: 0, persp: 1000 },
        ], easing: 'easeInOutCubic' } },
      { id: `${ctx.segmentId}-pool`, type: 'shape', shape: 'gradient', gradientType: 'radial',
        gradientCenter: { x: 50, y: 48 }, gradientRadius: { x: 40, y: 42 }, color: 'rgba(255,214,150,0.34)', gradientTo: 'rgba(255,214,150,0)',
        animate: [{ from: { opacity: 0 }, to: { opacity: 1 }, startFrame: 10, durationInFrames: 24, easing: 'easeOutCubic' }],
        box: { x: 50, y: 48, w: 100, h: 100 }, startFrame: ctx.startFrame, durationInFrames: ctx.durationInFrames, fadeFrames: 0 },
      { id: `${ctx.segmentId}-vig`, type: 'shape', shape: 'vignette', color: '#000000', strength: 0.6,
        box: { x: 50, y: 50, w: 100, h: 100 }, startFrame: ctx.startFrame, durationInFrames: ctx.durationInFrames, fadeFrames: 0 },
      { id: `${ctx.segmentId}-cap`, type: 'textCard', variant: 'subtitle', text: ctx.copy,
        box: { x: 50, y: 84, w: 56, h: 7 }, background: 'transparent', color: '#e8dcc8',
        startFrame: ctx.startFrame + 50, durationInFrames: Math.max(8, ctx.durationInFrames - 54), fadeFrames: 0 },
    ]
  },
})
