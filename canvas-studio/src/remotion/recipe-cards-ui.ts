/**
 * SSR 消化批 · ui-entrance 类目卡(来源:video-shotcraft-dsh demos/ui-entrance,
 * Apache-2.0,手法参考、表达重写;逐卡翻译对照见 shotcraft-catalog.md)。
 */
import { registerCard } from './recipe-cards.js'

// ── UI1 · list-reveal(菜单逐项找位)──
// 上游:容器全程 linear 上漂(16→−16px),六项 outBack/spring 逐项找位,错峰 0.09。
// 翻译:group.animate(linear y)+ 子轨 spring;菜单项从 copy 按行拆(≤6)。
registerCard({
  id: 'UI1',
  title: '菜单逐项找位',
  assets: [],
  generate: (ctx) => {
    const items = ctx.copy.split(/\n/).map((line) => line.trim()).filter(Boolean).slice(0, 6)
    const children = items.map((item, i) => ({
      id: `${ctx.segmentId}-item-${i + 1}`, type: 'textCard', variant: 'subtitle', text: item,
      box: { x: 50, y: 22 + i * 11, w: 34, h: 8 },
      background: 'rgba(255,255,255,0.06)', color: '#e8eaf2',
      startFrame: 0, durationInFrames: ctx.durationInFrames, fadeFrames: 0,
      animate: [{ from: { opacity: 0, scale: 0.88 }, to: { opacity: 1, scale: 1 }, startFrame: 6 + i * 10, durationInFrames: 26, easing: 'spring', spring: { stiffness: 120, damping: 12, mass: 1 } }],
    }))
    return [
      { id: `${ctx.segmentId}-bg`, type: 'shape', shape: 'rect', color: '#0a0b10', box: { x: 50, y: 50, w: 100, h: 100 }, startFrame: ctx.startFrame, durationInFrames: ctx.durationInFrames, fadeFrames: 0 },
      { id: `${ctx.segmentId}-group`, type: 'group',
        animate: [{ from: { y: 16 }, to: { y: -16 }, startFrame: 0, durationInFrames: ctx.durationInFrames, easing: 'linear' }],
        startFrame: ctx.startFrame, durationInFrames: ctx.durationInFrames, fadeFrames: 0,
        children },
    ]
  },
})

// ── UI2 · card-stack(卡堆展开)──
// 上游:真 3D 扇面 → 伪 3D 近似:同素材多轨缩放偏移堆叠,顶部卡 spring 甩开。
registerCard({
  id: 'UI2',
  title: '卡堆展开',
  assets: [{ slot: 'cardShot', kind: 'image', source: 'user', required: false, fallback: '缺图降级为强调色块堆叠' }],
  generate: (ctx) => {
    const src = ctx.assetSrc('cardShot')
    const layers = [0, 1, 2].map((i) => ({
      id: `${ctx.segmentId}-stack-${i + 1}`, type: src === undefined ? 'shape' : 'image',
      ...(src === undefined ? { shape: 'rect', color: i === 2 ? ctx.accentColor : '#2a3348' } : { src, fit: 'cover' as const }),
      ...(i === 2 ? {} : { rotateY: i === 0 ? -14 : 10 }),
      box: { x: 50 + (i - 1) * 4, y: 52 - i * 2, w: 34, h: 44 },
      startFrame: ctx.startFrame, durationInFrames: ctx.durationInFrames, fadeFrames: 0,
      ...(i === 2 ? { animate: [{ from: { opacity: 0, scale: 0.9 }, to: { opacity: 1, scale: 1.04 }, startFrame: 12, durationInFrames: 24, easing: 'spring', spring: { stiffness: 110, damping: 11, mass: 1 } }] } : {}),
    }))
    return [
      { id: `${ctx.segmentId}-bg`, type: 'shape', shape: 'rect', color: '#0d1118', box: { x: 50, y: 50, w: 100, h: 100 }, startFrame: ctx.startFrame, durationInFrames: ctx.durationInFrames, fadeFrames: 0 },
      ...layers,
      { id: `${ctx.segmentId}-cap`, type: 'textCard', variant: 'subtitle', text: ctx.copy, box: { x: 50, y: 86, w: 60, h: 7 }, background: 'transparent', color: '#9fb0cc', startFrame: ctx.startFrame + 20, durationInFrames: Math.max(8, ctx.durationInFrames - 26), fadeFrames: 0 },
    ]
  },
})

// ── UI3 · skeleton-reveal(骨架屏揭示)──
// 上游:灰条骨架 → 真内容替换。宽度生长无原语 → 条 opacity 脉冲(colorShift)+ 内容 fadeUp。
registerCard({
  id: 'UI3',
  title: '骨架屏揭示',
  assets: [],
  generate: (ctx) => {
    const bars = [72, 56, 64, 40]
    const tracks: Record<string, unknown>[] = [
      { id: `${ctx.segmentId}-bg`, type: 'shape', shape: 'rect', color: '#0e1420', box: { x: 50, y: 50, w: 100, h: 100 }, startFrame: ctx.startFrame, durationInFrames: ctx.durationInFrames, fadeFrames: 0 },
    ]
    bars.forEach((w, i) => {
      tracks.push({ id: `${ctx.segmentId}-skel-${i + 1}`, type: 'shape', shape: 'rect', color: '#232d3f', radius: 5,
        colorShift: { from: '#232d3f', to: '#33405a', startFrame: i * 8, durationInFrames: 30, easing: 'easeInOut' },
        box: { x: 40, y: 26 + i * 12, w, h: 5 }, startFrame: ctx.startFrame, durationInFrames: ctx.durationInFrames, fadeFrames: 0 })
    })
    tracks.push({ id: `${ctx.segmentId}-content`, type: 'textCard', variant: 'bullets', text: ctx.copy.split(/\n/).filter(Boolean).slice(0, 4),
      box: { x: 42, y: 40, w: 66, h: 40 }, anim: 'wordStagger',
      startFrame: ctx.startFrame + 44, durationInFrames: Math.max(12, ctx.durationInFrames - 50), fadeFrames: 0 })
    return tracks
  },
})

// ── UI4 · row-embed(行嵌入)──
// 上游:数据行逐条从右嵌入列表。chipRow column + unitStagger 原生错峰。
registerCard({
  id: 'UI4',
  title: '数据行嵌入',
  assets: [],
  generate: (ctx) => {
    const rows = ctx.copy.split(/\n/).map((line) => line.trim()).filter(Boolean).slice(0, 5)
    return [
      { id: `${ctx.segmentId}-bg`, type: 'shape', shape: 'rect', color: '#101826', box: { x: 50, y: 50, w: 100, h: 100 }, startFrame: ctx.startFrame, durationInFrames: ctx.durationInFrames, fadeFrames: 0 },
      { id: `${ctx.segmentId}-rows`, type: 'chipRow', chips: rows, direction: 'column', gap: 10,
        radius: 8, fontPx: 24, color: '#dfe7f5', background: 'rgba(255,255,255,0.07)', unitStagger: 6,
        box: { x: 50, y: 52, w: 62, h: 56 }, startFrame: ctx.startFrame, durationInFrames: ctx.durationInFrames, fadeFrames: 0 },
      { id: `${ctx.segmentId}-head`, type: 'textCard', variant: 'subtitle', text: ctx.label, box: { x: 50, y: 14, w: 40, h: 6 }, background: 'transparent', color: '#8fa3c4', startFrame: ctx.startFrame, durationInFrames: ctx.durationInFrames, fadeFrames: 0 },
    ]
  },
})

// ── UI5 · value-stagger-gradient(数值错峰)──
// 上游:三数值依次放大落定 + 渐变色。dataCard.countUp 错峰 ×3。
registerCard({
  id: 'UI5',
  title: '数值错峰落定',
  assets: [],
  generate: (ctx) => {
    const rows = ctx.copy.split(/[;;\n]/).map((line) => line.trim()).filter(Boolean).slice(0, 3)
      .map((pair) => { const sep = pair.lastIndexOf(':') >= 0 ? pair.lastIndexOf(':') : pair.lastIndexOf(':'); return { k: pair.slice(0, sep).trim(), v: pair.slice(sep + 1).trim() } })
    return [
      { id: `${ctx.segmentId}-bg`, type: 'shape', shape: 'rect', color: '#0b0f1a', box: { x: 50, y: 50, w: 100, h: 100 }, startFrame: ctx.startFrame, durationInFrames: ctx.durationInFrames, fadeFrames: 0 },
      ...rows.map((row, i) => ({
        id: `${ctx.segmentId}-val-${i + 1}`, type: 'textCard', variant: 'dataCard', text: row.k,
        data: [{ k: row.k, v: row.v }], accentColor: ctx.accentColor, countUp: true,
        box: { x: 26 + i * 24, y: 50, w: 22, h: 30 },
        startFrame: ctx.startFrame + 6 + i * 10, durationInFrames: Math.max(12, ctx.durationInFrames - 12 - i * 10), fadeFrames: 0,
      })),
    ]
  },
})

// ── UI6 · draw-svg-trace(SVG 描画)──
// 上游:路径描画原生(shape:'path'+draw 判定「能」)。d 用预烘焙签名线。
registerCard({
  id: 'UI6',
  title: '路径描画',
  assets: [],
  generate: (ctx) => {
    // 预烘焙:正弦签名线(制作期算好,确定性)
    const pts: string[] = []
    for (let i = 0; i <= 16; i += 1) { const t = i / 16; pts.push(`${(10 + t * 80).toFixed(1)},${(50 + Math.sin(t * 6.8) * 14).toFixed(1)}`) }
    return [
      { id: `${ctx.segmentId}-bg`, type: 'shape', shape: 'rect', color: '#0a0e16', box: { x: 50, y: 50, w: 100, h: 100 }, startFrame: ctx.startFrame, durationInFrames: ctx.durationInFrames, fadeFrames: 0 },
      { id: `${ctx.segmentId}-trace`, type: 'shape', shape: 'path', color: ctx.accentColor,
        d: `M${pts.join('L')}`, strokeWidth: 1.4,
        draw: { to: 1, startFrame: 4, durationInFrames: Math.max(12, Math.round(ctx.durationInFrames * 0.4)), easing: 'easeInOutCubic' },
        startFrame: ctx.startFrame, durationInFrames: ctx.durationInFrames, fadeFrames: 0 },
      { id: `${ctx.segmentId}-cap`, type: 'textCard', variant: 'subtitle', text: ctx.copy, box: { x: 50, y: 84, w: 60, h: 7 }, background: 'transparent', color: '#9fb0cc',
        startFrame: ctx.startFrame + Math.round(ctx.durationInFrames * 0.4), durationInFrames: Math.max(8, Math.round(ctx.durationInFrames * 0.5)), fadeFrames: 0 },
    ]
  },
})
