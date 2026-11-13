/**
 * SSR 消化批 · interaction 类目卡(来源:video-shotcraft-dsh demos/interaction,
 * Apache-2.0,手法参考、表达重写;逐卡翻译对照见 shotcraft-catalog.md)。
 */
import { registerCard } from './recipe-cards.js'

// ── INT1 · collab-cursor-moves(协作光标)──
// 上游:多光标带名牌在界面里游走、点击涟漪。光标 = shape 三角/点 + animate 折线;底图 user 通道。
registerCard({
  id: 'INT1',
  title: '协作光标',
  assets: [{ slot: 'shotImage', kind: 'image', source: 'user', required: false, fallback: '缺图降级为深底画布' }],
  generate: (ctx) => {
    const src = ctx.assetSrc('shotImage')
    const cursors = [
      { id: 'a', color: '#7ce38b', waypoints: [[20, 30], [52, 40], [40, 66]] },
      { id: 'b', color: '#8fb8ff', waypoints: [[78, 26], [46, 58], [64, 74]] },
    ]
    const tracks: Record<string, unknown>[] = [
      { id: `${ctx.segmentId}-bg`, type: 'shape', shape: 'rect', color: '#0c1119', box: { x: 50, y: 50, w: 100, h: 100 }, startFrame: ctx.startFrame, durationInFrames: ctx.durationInFrames, fadeFrames: 0 },
    ]
    if (src !== undefined) tracks.push({ id: `${ctx.segmentId}-shot`, type: 'image', src, fit: 'cover', box: { x: 50, y: 48, w: 88, h: 74 }, startFrame: ctx.startFrame, durationInFrames: ctx.durationInFrames, fadeFrames: 0 })
    for (const [i, cursor] of cursors.entries()) {
      const [p0, p1, p2] = cursor.waypoints as [[number, number], [number, number], [number, number]]
      tracks.push({ id: `${ctx.segmentId}-cursor-${i + 1}`, type: 'shape', shape: 'circle', color: cursor.color,
        box: { x: p0[0], y: p0[1], w: 1.8, h: 3.2 },
        animate: [
          { from: { x: p0[0], y: p0[1], opacity: 0 }, to: { x: p0[0], y: p0[1], opacity: 1 }, startFrame: 4, durationInFrames: 8, easing: 'easeOut' },
          { from: { x: p0[0], y: p0[1] }, to: { x: p1[0], y: p1[1] }, startFrame: 14, durationInFrames: 26, easing: 'easeInOutCubic' },
          { from: { x: p1[0], y: p1[1] }, to: { x: p2[0], y: p2[1] }, startFrame: 40, durationInFrames: 26, easing: 'easeInOutCubic' },
        ],
        startFrame: ctx.startFrame, durationInFrames: ctx.durationInFrames, fadeFrames: 0 })
      tracks.push({ id: `${ctx.segmentId}-ripple-${i + 1}`, type: 'shape', shape: 'circle', color: 'transparent',
        stroke: cursor.color, strokeWidthPx: 2,
        box: { x: p2[0], y: p2[1], w: 4, h: 7 },
        animate: [{ from: { opacity: 0, scale: 0.4 }, to: { opacity: 0.9, scale: 1.6 }, startFrame: 66 + i * 6, durationInFrames: 14, easing: 'easeOut' }],
        startFrame: ctx.startFrame, durationInFrames: ctx.durationInFrames, fadeFrames: 0 })
    }
    tracks.push({ id: `${ctx.segmentId}-cap`, type: 'textCard', variant: 'subtitle', text: ctx.copy, box: { x: 50, y: 90, w: 56, h: 7 }, background: 'rgba(0,0,0,0.6)', color: '#dfe7f5', startFrame: ctx.startFrame, durationInFrames: ctx.durationInFrames, fadeFrames: 0 })
    return tracks
  },
})

// ── INT2 · command-palette-summon(命令面板召唤)──
// 上游:按快捷键 → 面板从上方 spring 落下 → 条目高亮轮换。
registerCard({
  id: 'INT2',
  title: '命令面板',
  assets: [{ slot: 'shotImage', kind: 'image', source: 'user', required: false, fallback: '缺图降级为深底面板' }],
  generate: (ctx) => {
    const src = ctx.assetSrc('shotImage')
    const rows = ctx.copy.split(/\n/).filter(Boolean).slice(0, 5)
    return [
      { id: `${ctx.segmentId}-bg`, type: 'shape', shape: 'rect', color: '#0a0d14', box: { x: 50, y: 50, w: 100, h: 100 }, startFrame: ctx.startFrame, durationInFrames: ctx.durationInFrames, fadeFrames: 0 },
      ...(src !== undefined ? [{ id: `${ctx.segmentId}-shot`, type: 'image', src, fit: 'cover', box: { x: 50, y: 48, w: 88, h: 74 }, startFrame: ctx.startFrame, durationInFrames: ctx.durationInFrames, fadeFrames: 0 }] : []),
      { id: `${ctx.segmentId}-panel`, type: 'shape', shape: 'rect', color: '#161c28', radius: 10,
        box: { x: 50, y: 40, w: 52, h: 40 },
        animate: [{ from: { opacity: 0, y: -6, scale: 0.97 }, to: { opacity: 1, y: 0, scale: 1 }, startFrame: 10, durationInFrames: 18, easing: 'spring', spring: { stiffness: 130, damping: 14, mass: 1 } }],
        startFrame: ctx.startFrame, durationInFrames: ctx.durationInFrames, fadeFrames: 0 },
      { id: `${ctx.segmentId}-panel-rows`, type: 'chipRow', chips: rows, direction: 'column', gap: 8,
        radius: 6, fontPx: 22, color: '#dfe7f5', background: 'rgba(255,255,255,0.06)',
        box: { x: 50, y: 42, w: 48, h: 34 }, startFrame: ctx.startFrame + 18, durationInFrames: Math.max(10, ctx.durationInFrames - 22), fadeFrames: 0 },
      { id: `${ctx.segmentId}-hint`, type: 'textCard', variant: 'subtitle', text: ctx.label, box: { x: 50, y: 66, w: 30, h: 5 }, background: 'transparent', color: '#8fa3c4', startFrame: ctx.startFrame + 14, durationInFrames: Math.max(8, ctx.durationInFrames - 18), fadeFrames: 0 },
    ]
  },
})

// ── INT3 · type-and-filter(输入与筛选)──
// 上游:搜索框打字 → 结果列表筛选。typing = typewriter;结果 = chipRow 错峰。
registerCard({
  id: 'INT3',
  title: '搜索筛选',
  assets: [],
  generate: (ctx) => {
    const [query, ...results] = ctx.copy.split(/\n/).map((line) => line.trim()).filter(Boolean)
    return [
      { id: `${ctx.segmentId}-bg`, type: 'shape', shape: 'rect', color: '#0e1320', box: { x: 50, y: 50, w: 100, h: 100 }, startFrame: ctx.startFrame, durationInFrames: ctx.durationInFrames, fadeFrames: 0 },
      { id: `${ctx.segmentId}-box`, type: 'shape', shape: 'rect', color: '#1a2232', radius: 8,
        box: { x: 50, y: 24, w: 56, h: 10 }, startFrame: ctx.startFrame, durationInFrames: ctx.durationInFrames, fadeFrames: 0 },
      { id: `${ctx.segmentId}-typing`, type: 'textCard', variant: 'subtitle', text: query ?? ctx.label,
        box: { x: 44, y: 24, w: 48, h: 7 }, background: 'transparent', color: '#e8eef8',
        anim: 'typewriter', startFrame: ctx.startFrame + 8, durationInFrames: 40, fadeFrames: 0 },
      { id: `${ctx.segmentId}-results`, type: 'chipRow', chips: results.length > 0 ? results : [ctx.label],
        direction: 'column', gap: 8, radius: 6, fontPx: 22, color: '#dfe7f5', background: 'rgba(255,255,255,0.05)',
        unitStagger: 5, box: { x: 50, y: 58, w: 56, h: 40 },
        startFrame: ctx.startFrame + 52, durationInFrames: Math.max(10, ctx.durationInFrames - 56), fadeFrames: 0 },
    ]
  },
})

// ── INT4 · voice-waveform-live(声纹实时)──
// 上游:说话时波形实时跳动。audioViz 轨原生(判定「能」)。
registerCard({
  id: 'INT4',
  title: '实时声纹',
  assets: [{ slot: 'voiceClip', kind: 'audio', source: 'user', required: false, fallback: '缺音频降级为静态波形占位(viz 无声)' }],
  generate: (ctx) => {
    const src = ctx.assetSrc('voiceClip')
    return [
      { id: `${ctx.segmentId}-bg`, type: 'shape', shape: 'rect', color: '#0a0e16', box: { x: 50, y: 50, w: 100, h: 100 }, startFrame: ctx.startFrame, durationInFrames: ctx.durationInFrames, fadeFrames: 0 },
      { id: `${ctx.segmentId}-wave`, type: 'audioViz', src: src ?? '/canvas-studio/assets/demo/voice.mp3',
        bars: 32, mode: 'mirror', color: ctx.accentColor, gain: 1.6, heightPercent: 30,
        startFrame: ctx.startFrame, durationInFrames: ctx.durationInFrames, fadeFrames: 0 },
      { id: `${ctx.segmentId}-cap`, type: 'textCard', variant: 'subtitle', text: ctx.copy,
        box: { x: 50, y: 78, w: 60, h: 7 }, background: 'transparent', color: '#9fb0cc',
        startFrame: ctx.startFrame, durationInFrames: ctx.durationInFrames, fadeFrames: 0 },
    ]
  },
})
