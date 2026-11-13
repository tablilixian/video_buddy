/**
 * SSR 消化批 · outro 类目卡(来源:video-shotcraft-dsh demos/outro,Apache-2.0,
 * 手法参考、表达重写;逐卡翻译对照见 shotcraft-catalog.md)。
 */
import { registerCard } from './recipe-cards.js'

// ── OUT1 · ui-strip-away-outro(UI 蒸发落版)──
// 已有同款模板(outro/strip-away);本卡为参数化版(段落内使用)。
registerCard({
  id: 'OUT1',
  title: 'UI 蒸发落版',
  assets: [],
  generate: (ctx) => {
    const CLICK = Math.max(10, Math.round(ctx.durationInFrames * 0.4))
    const layers = [
      { id: 'sidebar', box: { x: 12, y: 50, w: 14, h: 84 }, color: '#262a33', to: { x: -20 }, delay: 4 },
      { id: 'canvas', box: { x: 52, y: 52, w: 42, h: 60 }, color: '#363c48', to: { y: 30 }, delay: 12 },
      { id: 'toolbar', box: { x: 52, y: 88, w: 42, h: 8 }, color: '#262a33', to: { y: 130 }, delay: 20 },
    ]
    return [
      { id: `${ctx.segmentId}-bg`, type: 'shape', shape: 'rect', color: '#050505',
        colorShift: { from: '#2b2f38', to: '#050505', startFrame: CLICK + 16, durationInFrames: 20, easing: 'easeInOut' },
        box: { x: 50, y: 50, w: 100, h: 100 }, startFrame: ctx.startFrame, durationInFrames: ctx.durationInFrames, fadeFrames: 0 },
      ...layers.map((layer) => ({ id: `${ctx.segmentId}-${layer.id}`, type: 'shape', shape: 'rect', color: layer.color,
        box: layer.box,
        animate: [{ from: { opacity: 1, x: 0, y: 0 }, to: { opacity: 0, ...layer.to }, startFrame: CLICK + layer.delay, durationInFrames: 14, easing: 'easeIn' }],
        startFrame: ctx.startFrame, durationInFrames: ctx.durationInFrames, fadeFrames: 0 })),
      { id: `${ctx.segmentId}-mark`, type: 'textCard', variant: 'title', text: ctx.copy,
        box: { x: 50, y: 46, w: 56, h: 20 }, plate: 'none', color: '#f2f2f2', letterSpacingEm: 0.06,
        anim: 'fadeUp', animOptions: { offsetY: 22, blur: 6 },
        startFrame: ctx.startFrame + CLICK + 44, durationInFrames: Math.max(12, ctx.durationInFrames - CLICK - 48), fadeFrames: 0 },
    ]
  },
})

// ── OUT2 · neon-triple-marquee(三行霓虹跑马)──
// 上游:三条 ticker 中行反向略快 + 轮唱余弦包络(ticker 原生)。
registerCard({
  id: 'OUT2',
  title: '霓虹跑马落版',
  assets: [],
  generate: (ctx) => {
    const words = ctx.copy.split(/[;;\n]/).map((line) => line.trim()).filter(Boolean)
    const rows = [words[0] ?? 'NOVA', words[1] ?? 'STUDIO', words[2] ?? 'NOVA']
    return [
      { id: `${ctx.segmentId}-bg`, type: 'shape', shape: 'rect', color: '#0b0a12', box: { x: 50, y: 50, w: 100, h: 100 }, startFrame: ctx.startFrame, durationInFrames: ctx.durationInFrames, fadeFrames: 0 },
      ...rows.map((word, i) => ({
        id: `${ctx.segmentId}-ticker-${i + 1}`, type: 'ticker',
        items: [word], speed: i === 1 ? 3.2 : 2.2, direction: i === 1 ? ('right' as const) : ('left' as const),
        fontPx: 64, gap: 60, color: i === 1 ? ctx.accentColor : '#f2f2f2', fadeWidth: 140, separator: ' · ',
        box: { x: 50, y: 26 + i * 24, w: 100, h: 18 },
        startFrame: ctx.startFrame, durationInFrames: ctx.durationInFrames, fadeFrames: 0,
      })),
    ]
  },
})

// ── OUT3 · outro-group-photo-launch(合影起飞)──
// 上游:四方飞入合影成一行 → 字标压轴 hold。image 错峰飞入 + 字标 spring 落定。
registerCard({
  id: 'OUT3',
  title: '合影起飞',
  assets: [
    { slot: 'shotA', kind: 'image', source: 'user', required: false, fallback: '缺图降级为色块位' },
    { slot: 'shotB', kind: 'image', source: 'user', required: false, fallback: '缺图降级为色块位' },
    { slot: 'shotC', kind: 'image', source: 'user', required: false, fallback: '缺图降级为色块位' },
  ],
  generate: (ctx) => {
    const shots = ['shotA', 'shotB', 'shotC'].map((slot) => ctx.assetSrc(slot))
    return [
      { id: `${ctx.segmentId}-bg`, type: 'shape', shape: 'rect', color: '#0a0b12', box: { x: 50, y: 50, w: 100, h: 100 }, startFrame: ctx.startFrame, durationInFrames: ctx.durationInFrames, fadeFrames: 0 },
      ...shots.map((src, i) => ({
        id: `${ctx.segmentId}-photo-${i + 1}`, type: src === undefined ? 'shape' : 'image',
        ...(src === undefined ? { shape: 'rect', color: ['#1c2436', '#232c40', '#2b3550'][i] ?? '#1c2436' } : { src, fit: 'cover' as const }),
        box: { x: 32 + i * 18, y: 40, w: 16, h: 24 }, radius: 8,
        animate: [{ from: { opacity: 0, scale: 0.7, rotation: i === 1 ? 0 : (i === 0 ? -10 : 10) }, to: { opacity: 1, scale: 1, rotation: i === 1 ? 0 : (i === 0 ? -6 : 6) }, startFrame: 6 + i * 8, durationInFrames: 22, easing: 'spring', spring: { stiffness: 110, damping: 12, mass: 1 } }],
        startFrame: ctx.startFrame, durationInFrames: ctx.durationInFrames, fadeFrames: 0,
      })),
      { id: `${ctx.segmentId}-mark`, type: 'textCard', variant: 'title', text: ctx.label,
        box: { x: 50, y: 74, w: 50, h: 16 }, plate: 'none', color: '#f2f2f2',
        animate: [{ from: { opacity: 0, scale: 1.12 }, to: { opacity: 1, scale: 1 }, startFrame: 44, durationInFrames: 16, easing: 'easeOutExpo' }],
        startFrame: ctx.startFrame, durationInFrames: ctx.durationInFrames, fadeFrames: 0 },
      { id: `${ctx.segmentId}-cta`, type: 'textCard', variant: 'subtitle', text: ctx.copy,
        box: { x: 50, y: 88, w: 36, h: 6 }, background: 'transparent', color: '#9aa4b8',
        anim: 'fadeUp', startFrame: ctx.startFrame + 56, durationInFrames: Math.max(8, ctx.durationInFrames - 60), fadeFrames: 0 },
    ]
  },
})
