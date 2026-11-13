/**
 * SSR 消化批 · rhythm 类目卡(来源:video-shotcraft-dsh demos/rhythm,Apache-2.0,
 * 手法参考、表达重写;逐卡翻译对照见 shotcraft-catalog.md)。
 */
import { registerCard } from './recipe-cards.js'

// ── RHY1 · beat-cut-moves(狗仔闪切)──
// 上游节拍:F1=30 / F2=52 / F3=70 三闪(间隔 22/18f),每闪白层衰减 4f、切入回落 6f。
registerCard({
  id: 'RHY1',
  title: '节拍闪切',
  assets: [
    { slot: 'shotA', kind: 'image', source: 'user', required: false, fallback: '缺图 A 降级为色块 A' },
    { slot: 'shotB', kind: 'image', source: 'user', required: false, fallback: '缺图 B 降级为色块 B' },
    { slot: 'shotC', kind: 'image', source: 'user', required: false, fallback: '缺图 C 降级为色块 C' },
  ],
  generate: (ctx) => {
    const shots = ['shotA', 'shotB', 'shotC'].map((slot) => ctx.assetSrc(slot))
    const frames = [30, 52, 70]
    const tracks: Record<string, unknown>[] = [
      { id: `${ctx.segmentId}-bg`, type: 'shape', shape: 'rect', color: '#08090f', box: { x: 50, y: 50, w: 100, h: 100 }, startFrame: ctx.startFrame, durationInFrames: ctx.durationInFrames, fadeFrames: 0 },
    ]
    shots.forEach((src, i) => {
      tracks.push({ id: `${ctx.segmentId}-shot-${i + 1}`, type: src === undefined ? 'shape' : 'image',
        ...(src === undefined ? { shape: 'rect', color: ['#1b2233', '#232c40', '#2b3550'][i] ?? '#1b2233' } : { src, fit: 'cover' as const }),
        box: { x: 50, y: 48, w: 100, h: 76 },
        startFrame: ctx.startFrame + (i === 0 ? 0 : (frames[i - 1] ?? 0)), durationInFrames: Math.max(8, ctx.durationInFrames - (i === 0 ? 0 : (frames[i - 1] ?? 0))), fadeFrames: 0 })
    })
    for (const [i, f] of frames.entries()) {
      tracks.push({ id: `${ctx.segmentId}-flash-${i + 1}`, type: 'shape', shape: 'rect', color: '#ffffff',
        animate: [{ from: { opacity: 0.9 }, to: { opacity: 0 }, startFrame: 0, durationInFrames: 4, easing: 'linear' }],
        box: { x: 50, y: 50, w: 100, h: 100 }, startFrame: ctx.startFrame + f, durationInFrames: 4, fadeFrames: 0 })
    }
    return tracks
  },
})

// ── RHY2 · speed-ramp-freeze(变速定格)──
// 上游:快段(糊/拖影)→ 急停定格(ink 硬)→ hold。多段 animate 折线 + 预烘焙拖影(降级省略)。
registerCard({
  id: 'RHY2',
  title: '变速定格',
  assets: [{ slot: 'shotImage', kind: 'image', source: 'user', required: false, fallback: '缺图降级为色块变速' }],
  generate: (ctx) => {
    const src = ctx.assetSrc('shotImage')
    return [
      { id: `${ctx.segmentId}-bg`, type: 'shape', shape: 'rect', color: '#0a0c12', box: { x: 50, y: 50, w: 100, h: 100 }, startFrame: ctx.startFrame, durationInFrames: ctx.durationInFrames, fadeFrames: 0 },
      { id: `${ctx.segmentId}-hero`, type: src === undefined ? 'shape' : 'image',
        ...(src === undefined ? { shape: 'rect', color: ctx.accentColor } : { src, fit: 'cover' as const }),
        box: { x: 50, y: 48, w: 44, h: 52 },
        camera: { keys: [
          { frame: 0, x: -260, y: 0, zoom: 1.0, rotX: 0, rotY: 0, rotZ: 0, persp: 900 },
          { frame: 20, x: -40, y: 0, zoom: 1.1, rotX: 0, rotY: 0, rotZ: 0, persp: 900 },
          { frame: 26, x: 0, y: 0, zoom: 1.18, rotX: 0, rotY: 0, rotZ: 0, persp: 900 },
          { frame: 90, x: 0, y: 0, zoom: 1.18, rotX: 0, rotY: 0, rotZ: 0, persp: 900 },
        ], easing: 'easeInOutCubic' },
        startFrame: ctx.startFrame, durationInFrames: ctx.durationInFrames, fadeFrames: 0 },
      { id: `${ctx.segmentId}-freeze-frame`, type: 'shape', shape: 'rect', color: 'transparent',
        stroke: ctx.accentColor, strokeWidthPx: 3, radius: 8,
        box: { x: 50, y: 48, w: 46, h: 55 },
        animate: [{ from: { opacity: 0 }, to: { opacity: 1 }, startFrame: 26, durationInFrames: 6, easing: 'easeOut' }],
        startFrame: ctx.startFrame, durationInFrames: ctx.durationInFrames, fadeFrames: 0 },
      { id: `${ctx.segmentId}-word`, type: 'textCard', variant: 'subtitle', text: ctx.copy,
        box: { x: 50, y: 84, w: 52, h: 7 }, background: 'rgba(0,0,0,0.65)', color: '#f0f2f6',
        anim: 'fadeUp', startFrame: ctx.startFrame + 28, durationInFrames: Math.max(10, ctx.durationInFrames - 32), fadeFrames: 0 },
    ]
  },
})

// ── RHY3 · montage-rhythm-moves(蒙太奇甩切)──
// 上游:三条镜头甩入甩出(错帧糊 → 硬切)。translate 折线 + 白闪点缀。
registerCard({
  id: 'RHY3',
  title: '蒙太奇甩切',
  assets: [
    { slot: 'shotA', kind: 'image', source: 'user', required: false, fallback: '缺图降级为色块' },
    { slot: 'shotB', kind: 'image', source: 'user', required: false, fallback: '缺图降级为色块' },
  ],
  generate: (ctx) => {
    const shots = [ctx.assetSrc('shotA'), ctx.assetSrc('shotB')]
    const tracks: Record<string, unknown>[] = [
      { id: `${ctx.segmentId}-bg`, type: 'shape', shape: 'rect', color: '#08090f', box: { x: 50, y: 50, w: 100, h: 100 }, startFrame: ctx.startFrame, durationInFrames: ctx.durationInFrames, fadeFrames: 0 },
    ]
    shots.forEach((src, i) => {
      tracks.push({ id: `${ctx.segmentId}-shot-${i + 1}`, type: src === undefined ? 'shape' : 'image',
        ...(src === undefined ? { shape: 'rect', color: i === 0 ? '#1c2436' : '#242e46' } : { src, fit: 'cover' as const }),
        box: { x: 50, y: 48, w: 100, h: 76 },
        animate: [
          { from: { opacity: 0, scale: 1.08 }, to: { opacity: 1, scale: 1 }, startFrame: i * 26, durationInFrames: 10, easing: 'easeOutCubic' },
          { from: { opacity: 1, scale: 1 }, to: { opacity: 0, scale: 0.94 }, startFrame: 52 + i * 24, durationInFrames: 10, easing: 'easeInCubic' },
        ],
        startFrame: ctx.startFrame, durationInFrames: ctx.durationInFrames, fadeFrames: 0 })
    })
    tracks.push({ id: `${ctx.segmentId}-word`, type: 'textCard', variant: 'subtitle', text: ctx.copy,
      box: { x: 50, y: 88, w: 46, h: 7 }, background: 'rgba(0,0,0,0.6)', color: '#f0f2f6',
      startFrame: ctx.startFrame + 56, durationInFrames: Math.max(8, ctx.durationInFrames - 60), fadeFrames: 0 })
    return tracks
  },
})

// ── RHY4 · quad-split-parallel-scenes(四分屏并行)──
// 上游:四格同时并行推进(各自 zoom 缓推 + 白线分隔)。
registerCard({
  id: 'RHY4',
  title: '四分屏并行',
  assets: [
    { slot: 'shotA', kind: 'image', source: 'user', required: false, fallback: '缺图降级为色块 A' },
    { slot: 'shotB', kind: 'image', source: 'user', required: false, fallback: '缺图降级为色块 B' },
    { slot: 'shotC', kind: 'image', source: 'user', required: false, fallback: '缺图降级为色块 C' },
    { slot: 'shotD', kind: 'image', source: 'user', required: false, fallback: '缺图降级为色块 D' },
  ],
  generate: (ctx) => {
    const shots = ['shotA', 'shotB', 'shotC', 'shotD'].map((slot) => ctx.assetSrc(slot))
    const pos = [{ x: 26, y: 26 }, { x: 74, y: 26 }, { x: 26, y: 74 }, { x: 74, y: 74 }]
    return [
      { id: `${ctx.segmentId}-bg`, type: 'shape', shape: 'rect', color: '#05060a', box: { x: 50, y: 50, w: 100, h: 100 }, startFrame: ctx.startFrame, durationInFrames: ctx.durationInFrames, fadeFrames: 0 },
      ...shots.map((src, i) => ({
        id: `${ctx.segmentId}-quad-${i + 1}`, type: src === undefined ? 'shape' : 'image',
        ...(src === undefined ? { shape: 'rect', color: ['#161d2e', '#1c2539', '#222c45', '#28334f'][i] ?? '#161d2e' } : { src, fit: 'cover' as const }),
        box: { x: (pos[i] ?? { x: 50, y: 50 }).x, y: (pos[i] ?? { x: 50, y: 50 }).y, w: 48.6, h: 48.6 },
        camera: { keys: [
          { frame: 0, x: 0, y: 0, zoom: 1.0, rotX: 0, rotY: 0, rotZ: 0, persp: 900 },
          { frame: ctx.durationInFrames, x: 0, y: 0, zoom: 1.12, rotX: 0, rotY: 0, rotZ: 0, persp: 900 },
        ], easing: 'linear' },
        startFrame: ctx.startFrame, durationInFrames: ctx.durationInFrames, fadeFrames: 0,
      })),
      { id: `${ctx.segmentId}-line-h`, type: 'shape', shape: 'rect', color: '#05060a', box: { x: 50, y: 50, w: 100, h: 0.5 }, startFrame: ctx.startFrame, durationInFrames: ctx.durationInFrames, fadeFrames: 0 },
      { id: `${ctx.segmentId}-line-v`, type: 'shape', shape: 'rect', color: '#05060a', box: { x: 50, y: 50, w: 0.5, h: 100 }, startFrame: ctx.startFrame, durationInFrames: ctx.durationInFrames, fadeFrames: 0 },
    ]
  },
})
