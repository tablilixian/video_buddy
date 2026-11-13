/**
 * SSR 消化批 · effects 类目卡(来源:video-shotcraft-dsh demos/effects,Apache-2.0,
 * 手法参考、表达重写;逐卡翻译对照见 shotcraft-catalog.md)。
 */
import { registerCard } from './recipe-cards.js'

// ── FX1 · scanline-annotate-focus(扫描标注)──
// 上游:扫描线扫过 → 目标框依次点亮 → 聚光余区压暗。
registerCard({
  id: 'FX1',
  title: '扫描标注',
  assets: [{ slot: 'shotImage', kind: 'image', source: 'user', required: false, fallback: '缺图降级为深底 + 框选动效' }],
  generate: (ctx) => {
    const src = ctx.assetSrc('shotImage')
    const targets = [
      { x: 30, y: 36, w: 18, h: 14, start: 24 },
      { x: 62, y: 52, w: 20, h: 16, start: 40 },
    ]
    const tracks: Record<string, unknown>[] = [
      { id: `${ctx.segmentId}-bg`, type: 'shape', shape: 'rect', color: '#0b1018', box: { x: 50, y: 50, w: 100, h: 100 }, startFrame: ctx.startFrame, durationInFrames: ctx.durationInFrames, fadeFrames: 0 },
    ]
    if (src !== undefined) tracks.push({ id: `${ctx.segmentId}-shot`, type: 'image', src, fit: 'cover', box: { x: 50, y: 48, w: 88, h: 72 }, startFrame: ctx.startFrame, durationInFrames: ctx.durationInFrames, fadeFrames: 0 })
    // 扫描线(细亮横条,自上而下)
    tracks.push({ id: `${ctx.segmentId}-scan`, type: 'shape', shape: 'rect', color: 'rgba(120,220,255,0.55)',
      box: { x: 50, y: 20, w: 88, h: 0.4 },
      animate: [{ from: { y: 12 }, to: { y: 88 }, startFrame: 6, durationInFrames: 30, easing: 'easeInOutCubic' }],
      startFrame: ctx.startFrame, durationInFrames: ctx.durationInFrames, fadeFrames: 0 })
    // 目标框依次点亮(批 2 stroke 原语)
    for (const [i, tg] of targets.entries()) {
      tracks.push({ id: `${ctx.segmentId}-box-${i + 1}`, type: 'shape', shape: 'rect', color: 'transparent',
        stroke: ctx.accentColor, strokeWidthPx: 2, radius: 4,
        box: { x: tg.x, y: tg.y, w: tg.w, h: tg.h },
        animate: [{ from: { opacity: 0, scale: 1.12 }, to: { opacity: 1, scale: 1 }, startFrame: tg.start, durationInFrames: 14, easing: 'backOut' }],
        startFrame: ctx.startFrame, durationInFrames: ctx.durationInFrames, fadeFrames: 0 })
      tracks.push({ id: `${ctx.segmentId}-tag-${i + 1}`, type: 'textCard', variant: 'subtitle',
        text: ctx.copy.split(/\n/).filter(Boolean)[i] ?? ctx.label,
        box: { x: tg.x, y: tg.y - 7, w: 18, h: 5 }, background: 'rgba(8,12,20,0.78)', color: '#dfe7f5',
        anim: 'fadeUp', startFrame: ctx.startFrame + tg.start + 10, durationInFrames: Math.max(8, ctx.durationInFrames - tg.start - 14), fadeFrames: 0 })
    }
    return tracks
  },
})

// ── FX2 · impact-feedback(冲击反馈)──
// 上游节拍:24f 起缩放推向 2.4(30f 撞停)→ 3f 集中线冲击 → 33f 恢复 → 轻回弹。
registerCard({
  id: 'FX2',
  title: '冲击反馈',
  assets: [{ slot: 'shotImage', kind: 'image', source: 'user', required: false, fallback: '缺图降级为色块冲击' }],
  generate: (ctx) => {
    const src = ctx.assetSrc('shotImage')
    return [
      { id: `${ctx.segmentId}-bg`, type: 'shape', shape: 'rect', color: '#05070c', box: { x: 50, y: 50, w: 100, h: 100 }, startFrame: ctx.startFrame, durationInFrames: ctx.durationInFrames, fadeFrames: 0 },
      { id: `${ctx.segmentId}-hit`, type: src === undefined ? 'shape' : 'image',
        ...(src === undefined ? { shape: 'rect', color: ctx.accentColor } : { src, fit: 'cover' as const }),
        box: { x: 50, y: 48, w: 46, h: 46 },
        camera: { keys: [
          { frame: 0, x: 0, y: 0, zoom: 1.0, rotX: 0, rotY: 0, rotZ: 0, persp: 900 },
          { frame: 30, x: 0, y: 0, zoom: 2.2, rotX: 0, rotY: 0, rotZ: 0, persp: 900 },
          { frame: 33, x: 0, y: 0, zoom: 2.1, rotX: 0, rotY: 0, rotZ: 0, persp: 900 },
          { frame: 50, x: 0, y: 0, zoom: 2.14, rotX: 0, rotY: 0, rotZ: 0, persp: 900 },
        ], easing: 'easeOutCubic' },
        startFrame: ctx.startFrame, durationInFrames: ctx.durationInFrames, fadeFrames: 0 },
      // 撞停白闪 3f
      { id: `${ctx.segmentId}-flash`, type: 'shape', shape: 'rect', color: '#ffffff',
        animate: [{ from: { opacity: 0.75 }, to: { opacity: 0 }, startFrame: 0, durationInFrames: 3, easing: "linear" }],
        box: { x: 50, y: 50, w: 100, h: 100 }, startFrame: ctx.startFrame + 30, durationInFrames: 3, fadeFrames: 0 },
      { id: `${ctx.segmentId}-word`, type: 'textCard', variant: 'title', text: ctx.copy,
        box: { x: 50, y: 80, w: 50, h: 12 }, plate: 'none', color: '#ffffff',
        anim: 'fadeUp', animOptions: { offsetY: 10 },
        startFrame: ctx.startFrame + 33, durationInFrames: Math.max(10, ctx.durationInFrames - 38), fadeFrames: 0 },
    ]
  },
})

// ── FX3 · glow-flyline-moves(光点飞线)──
// 上游:光点沿弧线飞行 → 终点汇聚炸开。shape path 描线 + 光点 animate 弧线折线。
registerCard({
  id: 'FX3',
  title: '光点飞线',
  assets: [],
  generate: (ctx) => {
    // 预烘焙弧线(画布坐标,三次弯)
    const pts: string[] = []
    for (let i = 0; i <= 14; i += 1) { const t = i / 14; pts.push(`${(12 + t * 76).toFixed(1)},${(30 + Math.sin(t * Math.PI) * -18 + t * 22).toFixed(1)}`) }
    return [
      { id: `${ctx.segmentId}-bg`, type: 'shape', shape: 'rect', color: '#070b14', box: { x: 50, y: 50, w: 100, h: 100 }, startFrame: ctx.startFrame, durationInFrames: ctx.durationInFrames, fadeFrames: 0 },
      { id: `${ctx.segmentId}-line`, type: 'shape', shape: 'path', color: ctx.accentColor, d: `M${pts.join('L')}`,
        strokeWidth: 0.8, draw: { to: 1, startFrame: 4, durationInFrames: 40, easing: 'easeOutCubic' },
        startFrame: ctx.startFrame, durationInFrames: ctx.durationInFrames, fadeFrames: 0 },
      { id: `${ctx.segmentId}-dot`, type: 'shape', shape: 'circle', color: '#9edcff',
        box: { x: 12, y: 30, w: 2.4, h: 4.2 },
        animate: [
          { from: { x: 12, y: 30 }, to: { x: 50, y: 12 }, startFrame: 4, durationInFrames: 22, easing: 'easeOutCubic' },
          { from: { x: 50, y: 12 }, to: { x: 88, y: 52 }, startFrame: 26, durationInFrames: 18, easing: 'easeInCubic' },
        ],
        startFrame: ctx.startFrame, durationInFrames: ctx.durationInFrames, fadeFrames: 0 },
      { id: `${ctx.segmentId}-burst`, type: 'shape', shape: 'gradient', gradientType: 'radial',
        gradientRadius: { x: 22, y: 30 }, color: 'rgba(158,220,255,0.5)',
        animate: [{ from: { opacity: 0, scale: 0.4 }, to: { opacity: 1, scale: 1.15 }, startFrame: 44, durationInFrames: 14, easing: 'easeOut' }],
        box: { x: 88, y: 52, w: 40, h: 70 }, startFrame: ctx.startFrame, durationInFrames: ctx.durationInFrames, fadeFrames: 0,
        exit: { durationInFrames: 10, to: { opacity: 0 } } },
      { id: `${ctx.segmentId}-cap`, type: 'textCard', variant: 'subtitle', text: ctx.copy, box: { x: 50, y: 84, w: 56, h: 7 }, background: 'transparent', color: '#9fb0cc',
        startFrame: ctx.startFrame + 48, durationInFrames: Math.max(8, ctx.durationInFrames - 52), fadeFrames: 0 },
    ]
  },
})

// ── FX4 · dashboard-glow-highlight-pill(仪表高亮胶囊)──
// 上游:整屏截图推近 + 高亮胶囊框呼吸 + 压暗聚焦。
registerCard({
  id: 'FX4',
  title: '仪表高亮',
  assets: [{ slot: 'shotImage', kind: 'image', source: 'user', required: false, fallback: '缺图降级为深底胶囊' }],
  generate: (ctx) => {
    const src = ctx.assetSrc('shotImage')
    const tracks: Record<string, unknown>[] = [
      { id: `${ctx.segmentId}-bg`, type: 'shape', shape: 'rect', color: '#070b12', box: { x: 50, y: 50, w: 100, h: 100 }, startFrame: ctx.startFrame, durationInFrames: ctx.durationInFrames, fadeFrames: 0 },
    ]
    if (src !== undefined) tracks.push({ id: `${ctx.segmentId}-shot`, type: 'image', src, fit: 'cover',
      camera: { keys: [
        { frame: 0, x: 0, y: 0, zoom: 1.0, rotX: 0, rotY: 0, rotZ: 0, persp: 1000 },
        { frame: 36, x: 40, y: -40, zoom: 1.45, rotX: 0, rotY: 0, rotZ: 0, persp: 1000 },
      ], easing: 'easeInOutCubic' },
      box: { x: 50, y: 48, w: 100, h: 76 }, startFrame: ctx.startFrame, durationInFrames: ctx.durationInFrames, fadeFrames: 0 })
    tracks.push(
      { id: `${ctx.segmentId}-pill`, type: 'shape', shape: 'rect', color: 'transparent',
        stroke: ctx.accentColor, strokeWidthPx: 2.5, radius: 999,
        box: { x: 60, y: 40, w: 22, h: 16 },
        animate: [{ from: { opacity: 0, scale: 0.9 }, to: { opacity: 1, scale: 1 }, startFrame: 30, durationInFrames: 16, easing: 'backOut' }],
        startFrame: ctx.startFrame, durationInFrames: ctx.durationInFrames, fadeFrames: 0 },
      { id: `${ctx.segmentId}-pill-label`, type: 'textCard', variant: 'subtitle', text: ctx.copy,
        box: { x: 60, y: 52, w: 22, h: 6 }, background: ctx.accentColor, color: '#0b0f14',
        anim: 'fadeUp', startFrame: ctx.startFrame + 42, durationInFrames: Math.max(8, ctx.durationInFrames - 48), fadeFrames: 0 },
    )
    return tracks
  },
})

// ── FX5 · brand-frame-snap(品牌画框合拢)──
// 上游:四条边框各自滑入合拢成画框 + 内容显现,同帧硬切完成。
registerCard({
  id: 'FX5',
  title: '画框合拢',
  assets: [{ slot: 'shotImage', kind: 'image', source: 'user', required: false, fallback: '缺图降级为纯框 + 文案' }],
  generate: (ctx) => {
    const src = ctx.assetSrc('shotImage')
    const frames = [
      { id: 'f-top', box: { x: 50, y: 18, w: 60, h: 0.7 }, from: { x: 20 } },
      { id: 'f-bottom', box: { x: 50, y: 82, w: 60, h: 0.7 }, from: { x: 80 } },
      { id: 'f-left', box: { x: 20, y: 50, w: 0.7, h: 64 }, from: { y: 20 } },
      { id: 'f-right', box: { x: 80, y: 50, w: 0.7, h: 64 }, from: { y: 80 } },
    ]
    return [
      { id: `${ctx.segmentId}-bg`, type: 'shape', shape: 'rect', color: '#0d1220', box: { x: 50, y: 50, w: 100, h: 100 }, startFrame: ctx.startFrame, durationInFrames: ctx.durationInFrames, fadeFrames: 0 },
      ...(src !== undefined ? [{ id: `${ctx.segmentId}-shot`, type: 'image', src, fit: 'cover', box: { x: 50, y: 50, w: 58, h: 62 }, startFrame: ctx.startFrame + 16, durationInFrames: Math.max(12, ctx.durationInFrames - 20), fadeFrames: 6 }] : []),
      ...frames.map((frame) => ({ id: `${ctx.segmentId}-${frame.id}`, type: 'shape', shape: 'rect', color: ctx.accentColor,
        box: frame.box,
        animate: [{ from: { ...frame.from, opacity: 0 }, to: { opacity: 1 }, startFrame: 0, durationInFrames: 14, easing: 'easeOutCubic' }],
        startFrame: ctx.startFrame, durationInFrames: ctx.durationInFrames, fadeFrames: 0 })),
      { id: `${ctx.segmentId}-word`, type: 'textCard', variant: 'title', text: ctx.copy,
        box: { x: 50, y: src === undefined ? 50 : 88, w: 56, h: 14 }, plate: 'none', color: '#f2f4f8',
        anim: 'maskReveal', startFrame: ctx.startFrame + 22, durationInFrames: Math.max(12, ctx.durationInFrames - 26), fadeFrames: 0 },
    ]
  },
})
