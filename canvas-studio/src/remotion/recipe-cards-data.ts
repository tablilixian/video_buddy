/**
 * SSR 消化批 · data 类目卡(来源:video-shotcraft-dsh demos/data,Apache-2.0,
 * 手法参考、表达重写;逐卡翻译对照见 shotcraft-catalog.md)。
 */
import { registerCard } from './recipe-cards.js'
import { chartPlotFor, chartPointOnCanvas, chartValueY } from './chart-layout.js'

// ── DAT1 · gauge-readout(三联表盘扫针)──
// 上游节拍:点火 12/16/20f 错峰;去程 12f 甩满 270°(outCubic);回落 13f 过头 8°;
// 回摆 7f 落定;数值同帧弹出。卡参数从 copy 解析 "角度,数值;角度,数值;角度,数值"。
registerCard({
  id: 'DAT1',
  title: '仪表盘扫针',
  assets: [],
  generate: (ctx) => {
    const specs = ctx.copy.split(/[;;\n]/).map((pair) => pair.trim()).filter(Boolean).slice(0, 3)
      .map((pair) => {
        const [angle, value] = pair.split(/[,,]/).map((part) => part.trim())
        return { target: Math.max(0, Math.min(270, Number(angle) || 0)), value: value ?? '—' }
      })
    while (specs.length < 3) specs.push({ target: 180, value: '—' })
    const tracks: Record<string, unknown>[] = [
      { id: `${ctx.segmentId}-bg`, type: 'shape', shape: 'rect', color: '#faf7f2', box: { x: 50, y: 50, w: 100, h: 100 }, startFrame: ctx.startFrame, durationInFrames: ctx.durationInFrames, fadeFrames: 0 },
      { id: `${ctx.segmentId}-title`, type: 'textCard', variant: 'subtitle', text: ctx.label, box: { x: 50, y: 12, w: 40, h: 6 }, background: 'transparent', color: '#7c2d12', startFrame: ctx.startFrame, durationInFrames: ctx.durationInFrames, fadeFrames: 0 },
    ]
    specs.forEach((spec, i) => {
      const cx = 26 + i * 24
      const start = 12 + i * 4
      tracks.push(
        { id: `${ctx.segmentId}-g${i + 1}-arc`, type: 'shape', shape: 'path', color: '#e7ddd0',
          d: `M ${(cx - 7.5).toFixed(2)} ${(52 + 13 * Math.sin(135 * Math.PI / 180) / 1).toFixed(2)} A 7.5 13 0 1 1 ${(cx + 7.5).toFixed(2)} ${(52 + 13 * Math.sin(405 * Math.PI / 180)).toFixed(2)}`,
          strokeWidth: 0.9, startFrame: ctx.startFrame, durationInFrames: ctx.durationInFrames, fadeFrames: 0 },
        { id: `${ctx.segmentId}-g${i + 1}-needle`, type: 'shape', shape: 'rect', color: '#b45309',
          box: { x: cx, y: 52 - 5.5, w: 0.55, h: 11 }, pivot: { x: 50, y: 100 },
          animate: [
            { from: { rotation: 0 }, to: { rotation: 270 }, startFrame: start, durationInFrames: 12, easing: 'easeOutCubic' },
            { from: { rotation: 270 }, to: { rotation: spec.target - 8 }, startFrame: start + 12, durationInFrames: 13, easing: 'easeInOutCubic' },
            { from: { rotation: spec.target - 8 }, to: { rotation: spec.target }, startFrame: start + 25, durationInFrames: 7, easing: 'easeOutCubic' },
          ],
          startFrame: ctx.startFrame, durationInFrames: ctx.durationInFrames, fadeFrames: 0 },
        { id: `${ctx.segmentId}-g${i + 1}-value`, type: 'textCard', variant: 'subtitle', text: spec.value,
          box: { x: cx, y: 72, w: 14, h: 8 }, background: 'transparent', color: '#7c2d12',
          anim: 'fadeUp', startFrame: ctx.startFrame + start + 30, durationInFrames: Math.max(6, ctx.durationInFrames - start - 30), fadeFrames: 0 },
      )
    })
    return tracks
  },
})

// ── DAT2 · odometer-digit-roll(里程表数字)──
// 上游:全屏巨号 99.98%,四位 0-9 纵向 strip 逐位减速锁定。逐位 strip 无原语 →
// dataCard.countUp 降级(数值前 45 帧滚动),脉冲加深用 colorShift 近似。
registerCard({
  id: 'DAT2',
  title: '里程表大数字',
  assets: [],
  generate: (ctx) => {
    const [value] = ctx.copy.split(/[;;\n]/).map((line) => line.trim())
    return [
      { id: `${ctx.segmentId}-bg`, type: 'shape', shape: 'rect', color: '#0a0b10', box: { x: 50, y: 50, w: 100, h: 100 }, startFrame: ctx.startFrame, durationInFrames: ctx.durationInFrames, fadeFrames: 0 },
      { id: `${ctx.segmentId}-num`, type: 'textCard', variant: 'dataCard', text: ctx.label ?? '指标',
        data: [{ k: ctx.label ?? '指标', v: value ?? '99.98%' }],
        accentColor: ctx.accentColor, countUp: true,
        box: { x: 50, y: 46, w: 46, h: 42 }, startFrame: ctx.startFrame + 4, durationInFrames: Math.max(12, ctx.durationInFrames - 8), fadeFrames: 0 },
      { id: `${ctx.segmentId}-pulse`, type: 'shape', shape: 'rect', color: ctx.accentColor,
        box: { x: 50, y: 46, w: 46, h: 42 },
        animate: [{ from: { opacity: 0.35 }, to: { opacity: 0 }, startFrame: 63, durationInFrames: 12, easing: 'easeOut' }],
        startFrame: ctx.startFrame, durationInFrames: ctx.durationInFrames, fadeFrames: 0 },
    ]
  },
})

// ── DAT3 · chart-live-moves(图表生长)──
// 上游 A 式:柱状图生长 + 数值滚动。chart 轨原生;数值 countUp。
registerCard({
  id: 'DAT3',
  title: '图表生长',
  assets: [],
  generate: (ctx) => {
    const rows = ctx.copy.split(/[;;\n]/).map((line) => line.trim()).filter(Boolean).slice(0, 5)
      .map((pair) => { const sep = pair.lastIndexOf(':') >= 0 ? pair.lastIndexOf(':') : pair.lastIndexOf(':'); return { k: pair.slice(0, sep).trim(), v: pair.slice(sep + 1).trim() } })
    // P0-3（REQ-038 R11 二轮，2026-11-16）：浮卡不再压柱图。
    // 旧 box {x:22,y:30,w:34,h:26} 与 chart（y 30–82%）相交 39.7%（抽帧可见「数据卡压在柱顶」）。
    // 新 box 落在 title（y≤15）与 chart（y≥30）之间的空档 y 16.5–29.5，两头各留 0.5%。
    // `text` 只吃 label 第一段：旧实现与 -title 轨同写整段 `ctx.label` ⇒ 同屏打两遍。
    const summaryLabel = ((ctx.label ?? '').split('|')[0] ?? '').trim()
    return [
      { id: `${ctx.segmentId}-bg`, type: 'shape', shape: 'rect', color: '#101828', box: { x: 50, y: 50, w: 100, h: 100 }, startFrame: ctx.startFrame, durationInFrames: ctx.durationInFrames, fadeFrames: 0 },
      { id: `${ctx.segmentId}-title`, type: 'textCard', variant: 'subtitle', text: ctx.label, box: { x: 50, y: 12, w: 40, h: 6 }, background: 'transparent', color: '#8fa3c4', startFrame: ctx.startFrame, durationInFrames: ctx.durationInFrames, fadeFrames: 0 },
      { id: `${ctx.segmentId}-chart`, type: 'chart', variant: 'bars', labels: rows.map((row) => row.k), values: rows.map((row, i) => Number(row.v.replace(/[^\d.-]/g, '')) || i + 1),
        color: ctx.accentColor, box: { x: 50, y: 56, w: 76, h: 52 }, startFrame: ctx.startFrame + 6, durationInFrames: Math.max(12, ctx.durationInFrames - 12), fadeFrames: 0 },
      { id: `${ctx.segmentId}-summary`, type: 'textCard', variant: 'dataCard', text: summaryLabel.length > 0 ? summaryLabel : ctx.label,
        data: rows.slice(0, 2).map((row) => ({ k: row.k, v: row.v })), accentColor: ctx.accentColor, countUp: true,
        box: { x: 50, y: 23, w: 40, h: 13 }, startFrame: ctx.startFrame + 10, durationInFrames: Math.max(12, ctx.durationInFrames - 20), fadeFrames: 0 },
    ]
  },
})

// ── DAT4 · before-after-slider-scrub(前后对比拉杆)──
// 上游节拍:杆 14f 静置 → 12f 快甩 8→76%(outCubic)→ 回弹 70% → 停 18f → 48f 慢扫回 40%。
// 揭示 = after 图 reveal 帘式擦除近似(逐帧跟随裁切无原语);杆 shape 轨 animate x。
registerCard({
  id: 'DAT4',
  title: '前后对比拉杆',
  assets: [
    { slot: 'shotBefore', kind: 'image', source: 'user', required: false, fallback: '缺 before 图降级为单图 + 杆(仅 after)' },
    { slot: 'shotAfter', kind: 'image', source: 'user', required: false, fallback: '缺 after 图降级为单图 + 杆' },
  ],
  generate: (ctx) => {
    const before = ctx.assetSrc('shotBefore')
    const after = ctx.assetSrc('shotAfter')
    const tracks: Record<string, unknown>[] = [
      { id: `${ctx.segmentId}-bg`, type: 'shape', shape: 'rect', color: '#10131a', box: { x: 50, y: 50, w: 100, h: 100 }, startFrame: ctx.startFrame, durationInFrames: ctx.durationInFrames, fadeFrames: 0 },
    ]
    if (before !== undefined) tracks.push({ id: `${ctx.segmentId}-before`, type: 'image', src: before, fit: 'cover', box: { x: 50, y: 48, w: 84, h: 70 }, startFrame: ctx.startFrame, durationInFrames: ctx.durationInFrames, fadeFrames: 0 })
    if (after !== undefined) tracks.push({ id: `${ctx.segmentId}-after`, type: 'image', src: after, fit: 'cover', box: { x: 50, y: 48, w: 84, h: 70 }, startFrame: ctx.startFrame, durationInFrames: ctx.durationInFrames, fadeFrames: 0,
      reveal: { kind: 'wipe', direction: 'right', durationInFrames: 40, startFrame: 14 } })
    tracks.push(
      { id: `${ctx.segmentId}-bar`, type: 'shape', shape: 'rect', color: '#ffffff', stroke: '#e8843c', strokeWidthPx: 2, radius: 3,
        box: { x: 40, y: 48, w: 0.6, h: 70 },
        animate: [
          { from: { x: 16 }, to: { x: 68 }, startFrame: 14, durationInFrames: 12, easing: 'easeOutCubic' },
          { from: { x: 68 }, to: { x: 62 }, startFrame: 26, durationInFrames: 12, easing: 'easeInOutCubic' },
          { from: { x: 62 }, to: { x: 34 }, startFrame: 56, durationInFrames: 48, easing: 'easeInOutCubic' },
        ],
        startFrame: ctx.startFrame, durationInFrames: ctx.durationInFrames, fadeFrames: 0 },
      { id: `${ctx.segmentId}-label`, type: 'textCard', variant: 'subtitle', text: ctx.label, box: { x: 50, y: 90, w: 40, h: 6 }, background: 'rgba(0,0,0,0.6)', color: '#f2f2f2', startFrame: ctx.startFrame + 8, durationInFrames: Math.max(6, ctx.durationInFrames - 12), fadeFrames: 0 },
    )
    return tracks
  },
})

// ── DAT5 · timeline-travel(时间轴飞行)──
// 上游:宽幅长图上 image 相机多段平移。camera.keys x/y 设计 px。
registerCard({
  id: 'DAT5',
  title: '时间轴飞行',
  assets: [{ slot: 'wideShot', kind: 'image', source: 'user', required: false, fallback: '缺宽图降级为标题卡' }],
  generate: (ctx) => {
    const src = ctx.assetSrc('wideShot')
    if (src === undefined) {
      return [
        { id: `${ctx.segmentId}-bg`, type: 'shape', shape: 'rect', color: '#0d1322', box: { x: 50, y: 50, w: 100, h: 100 }, startFrame: ctx.startFrame, durationInFrames: ctx.durationInFrames, fadeFrames: 0 },
        { id: `${ctx.segmentId}-title`, type: 'textCard', variant: 'title', text: ctx.copy, box: { x: 50, y: 46, w: 76, h: 22 }, plate: 'none', startFrame: ctx.startFrame + 6, durationInFrames: Math.max(12, ctx.durationInFrames - 12), fadeFrames: 0, anim: 'maskReveal' },
      ]
    }
    return [
      { id: `${ctx.segmentId}-bg`, type: 'shape', shape: 'rect', color: '#0d1322', box: { x: 50, y: 50, w: 100, h: 100 }, startFrame: ctx.startFrame, durationInFrames: ctx.durationInFrames, fadeFrames: 0 },
      { id: `${ctx.segmentId}-wide`, type: 'image', src, fit: 'cover',
        camera: { keys: [
          { frame: 0, x: 300, y: 0, zoom: 1.3, rotX: 0, rotY: 0, rotZ: 0, persp: 1000 },
          { frame: 40, x: 0, y: 0, zoom: 1.3, rotX: 0, rotY: 0, rotZ: 0, persp: 1000 },
          { frame: 80, x: -300, y: 10, zoom: 1.3, rotX: 0, rotY: 0, rotZ: 0, persp: 1000 },
          { frame: 110, x: -300, y: 10, zoom: 1.55, rotX: 0, rotY: 0, rotZ: 0, persp: 1000 },
        ], easing: 'easeInOutCubic' },
        box: { x: 50, y: 48, w: 100, h: 74 }, startFrame: ctx.startFrame, durationInFrames: ctx.durationInFrames, fadeFrames: 0 },
      { id: `${ctx.segmentId}-cap`, type: 'textCard', variant: 'subtitle', text: ctx.copy, startFrame: ctx.startFrame + 10, durationInFrames: Math.max(10, ctx.durationInFrames - 16), fadeFrames: 0 },
    ]
  },
})

// ── DAT6 · trend-line-with-callouts(折线 + 峰谷标注 + 均值虚线)──
// R11（2026-11-16）：参考片（小红书财经科普）每屏主体都是「一条曲线 + 峰谷标注 +
// 长期均值虚线」。`chart variant:'line'` 与 `callout` 两个原语早就在，缺的是把它们
// 接起来的那一张卡 —— 于是 spec 通道只能出柱状（DAT3），这类画面整条通道做不出来。
//
// copy = `标签:数值; 标签:数值; …`（与 DAT3 同格式，复用已有的写法习惯，不引入第二套）
// label = `标题 | 高点文案 | 低点文案`（后两段可缺省，缺省「高点」「低点」）——
//   用 `|` 分隔而不是新开字段：`label` 本来就是「这一屏怎么称呼」的槽位，
//   峰谷文案属于同一件事（怎么称呼图上那两个点）。
registerCard({
  id: 'DAT6',
  title: '折线 + 峰谷标注',
  assets: [],
  generate: (ctx) => {
    const rows = ctx.copy.split(/[；;\n]/).map((line) => line.trim()).filter(Boolean).slice(0, 12)
      .map((pair) => {
        const sep = pair.lastIndexOf(':') >= 0 ? pair.lastIndexOf(':') : pair.lastIndexOf('：')
        return sep > 0
          ? { k: pair.slice(0, sep).trim(), v: Number(pair.slice(sep + 1).replace(/[^\d.-]/g, '')) }
          : { k: pair, v: Number.NaN }
      })
      .filter((row) => Number.isFinite(row.v))
    // 少于 3 点画不出趋势（两点只有一条直线，标不出峰谷）—— 退化成占位文案而不是硬画。
    const [rawTitle, rawHigh, rawLow] = ctx.label.split('|').map((part) => part.trim())
    const chartBox = { x: 50, y: 57, w: 82, h: 50 }
    const start = ctx.startFrame + 6
    const dur = Math.max(12, ctx.durationInFrames - 12)
    const base: Record<string, unknown>[] = [
      { id: `${ctx.segmentId}-bg`, type: 'shape', shape: 'rect', color: '#0B0D10',
        box: { x: 50, y: 50, w: 100, h: 100 }, startFrame: ctx.startFrame, durationInFrames: ctx.durationInFrames, fadeFrames: 0 },
      { id: `${ctx.segmentId}-title`, type: 'textCard', variant: 'subtitle', text: rawTitle ?? ctx.label,
        color: '#8fa3c4', box: { x: 50, y: 13, w: 60, h: 6 }, startFrame: ctx.startFrame, durationInFrames: ctx.durationInFrames, fadeFrames: 0 },
    ]
    if (rows.length < 3) {
      return [...base, {
        id: `${ctx.segmentId}-fallback`, type: 'textCard', variant: 'title', text: rawTitle ?? ctx.label,
        box: { x: 50, y: 52, w: 76, h: 26 }, startFrame: start, durationInFrames: dur, fadeFrames: 0,
      }]
    }
    const values = rows.map((row) => row.v)
    // 与 Chart.tsx 的 axisMax 同一口算（Math.max(...values,0) * 1.08）—— 差一点引线就指偏。
    const axisMax = Math.max(...values, 0) * 1.08
    const peak = Math.max(...values)
    const trough = Math.min(...values)
    const peakIndex = values.indexOf(peak)
    const troughIndex = values.indexOf(trough)
    const mean = values.reduce((acc, v) => acc + v, 0) / values.length

    const tracks: Record<string, unknown>[] = [
      ...base,
      {
        id: `${ctx.segmentId}-chart`, type: 'chart', variant: 'line',
        labels: rows.map((row) => row.k), values,
        color: ctx.accentColor, box: chartBox,
        startFrame: start, durationInFrames: dur, fadeFrames: 0,
        ...(ctx.dataSource === undefined ? {} : { dataSource: ctx.dataSource }),
      },
    ]

    // 长期均值虚线：从绘图区左沿拉到右沿，右侧留一个「均值」小字。
    // 只在峰谷确实分开时画（全平的序列，「均值线」和曲线重合，画了等于没画）。
    if (peak > trough) {
      const plot = chartPlotFor(false)
      const meanY = chartValueY(mean / axisMax, chartBox, false)
      const insetX = (chartBox.w * plot.left) / 100
      const insetRight = (chartBox.w * plot.right) / 100
      tracks.push(
        { id: `${ctx.segmentId}-mean-line`, type: 'shape', shape: 'line',
          color: 'rgba(214,245,227,0.42)', stroke: 'rgba(214,245,227,0.42)', strokeWidthPx: 2,
          dash: [8, 7],
          box: { x: chartBox.x - insetX / 2 + insetRight / 2, y: meanY, w: chartBox.w - insetX - insetRight, h: 0.3 },
          startFrame: start + 10, durationInFrames: Math.max(10, dur - 10), fadeFrames: 0 },
        { id: `${ctx.segmentId}-mean-label`, type: 'textCard', variant: 'subtitle', text: '均值',
          color: 'rgba(214,245,227,0.72)', box: { x: chartBox.x + chartBox.w / 2 - insetRight / 2, y: meanY - 2.6, w: 12, h: 4 },
          startFrame: start + 10, durationInFrames: Math.max(10, dur - 10), fadeFrames: 0 },
      )
    }

    // 峰谷标注：callout 的 anchor 是**画布百分比**，必须走 chartPointOnCanvas
    //（绘图区内百分比 → 盒子 → 画布，差一段就是引线指着空白处）。
    const peakPoint = chartPointOnCanvas(peakIndex, values.length, peak / axisMax, chartBox, false)
    const troughPoint = chartPointOnCanvas(troughIndex, values.length, trough / axisMax, chartBox, false)
    if (peak > trough) {
      // 标签盒必须给（callout 契约要求），且**夹在画布内**：峰谷点可能在最左/最右、
      // 或贴近上下沿，标签按点直放会半个飘出画。—— 高点上浮、低点下沉，避免压住曲线。
      const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value))
      tracks.push(
        { id: `${ctx.segmentId}-peak`, type: 'callout', anchor: peakPoint,
          text: `${rawHigh ?? '高点'} ${String(Math.round(peak * 100) / 100)}`,
          line: 'elbow', color: ctx.accentColor,
          box: { x: clamp(peakPoint.x, 16, 84), y: clamp(peakPoint.y - 7, 12, 84), w: 26, h: 7 },
          startFrame: start + 14, durationInFrames: Math.max(10, dur - 14), fadeFrames: 0 },
        { id: `${ctx.segmentId}-trough`, type: 'callout', anchor: troughPoint,
          text: `${rawLow ?? '低点'} ${String(Math.round(trough * 100) / 100)}`,
          line: 'elbow', color: ctx.accentColor,
          box: { x: clamp(troughPoint.x, 16, 84), y: clamp(troughPoint.y + 7, 16, 88), w: 26, h: 7 },
          startFrame: start + 18, durationInFrames: Math.max(10, dur - 18), fadeFrames: 0 },
      )
    }
    return tracks
  },
})
