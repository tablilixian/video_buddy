/**
 * 通用几何程序化运动关键帧助手（CV-336 之后，多段同维度关键帧已正确插值）。
 *
 * 这些函数只产出 CompositionManifest 里 `animate` 的「段数组 / 坐标」，不绑定任何主题。
 * 任何场景（太阳系、原子结构、齿轮组、信号流、进度条接力……）都能复用同一套数学。
 * 也是「agent 应如何对任意内容设计运动」的参考实现：主题无关，只认坐标系与节奏。
 */

/**
 * 透明度不在 `transform` 里（契约未支持），必须写进颜色。
 * 例：`color: rgba([90,169,255], 0.32)`。
 */
export function rgba(rgb, alpha) {
  return `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${alpha})`
}

/** 确定性伪随机（不引 Math.random ⇒ 同一 manifest 每次渲染逐像素一致）。 */
export function rnd(seed) {
  const v = Math.sin(seed * 127.1 + 311.7) * 43758.5453
  return v - Math.floor(v)
}

/**
 * 像素空间真圆上的一个点 → 画布百分比坐标。
 * 关键：x 按画布宽、y 按画布高各自换算，否则 1280×720 下真圆会被拉成扁椭圆。
 * 任意「应是正圆 / 正多边形」的几何都必须走像素空间再换算。
 */
export function trueCirclePoint(cx, cy, radiusPx, angle, W, H) {
  return {
    x: cx + (radiusPx * Math.cos(angle)) / (W / 100),
    y: cy + (radiusPx * Math.sin(angle)) / (H / 100),
  }
}

/**
 * 绕任意中心做圆周运动的多段线性关键帧。
 * 段数按「每圈 segmentsPerRev 段」自动算 ⇒ 折线贴合圆弧，弦高可控（每圈 24 段 ≈ 每段 15°）。
 * 返回可直接塞进某 track 的 `animate` 数组。radius/period/phase 各异即自然形成「内外圈速率差」。
 */
export function orbitSegs({ cx, cy, radiusPx, periodFrames, totalFrames, phase = 0, W, H, segmentsPerRev = 24 }) {
  const revs = totalFrames / periodFrames
  const K = Math.max(8, Math.round(revs * segmentsPerRev))
  const segs = []
  for (let i = 0; i < K; i += 1) {
    const f0 = Math.round((i * totalFrames) / K)
    const f1 = Math.round(((i + 1) * totalFrames) / K)
    const a0 = (2 * Math.PI * f0) / periodFrames + phase
    const a1 = (2 * Math.PI * f1) / periodFrames + phase
    segs.push({
      from: trueCirclePoint(cx, cy, radiusPx, a0, W, H),
      to: trueCirclePoint(cx, cy, radiusPx, a1, W, H),
      startFrame: f0,
      durationInFrames: Math.max(1, f1 - f0),
      easing: 'linear',
    })
  }
  return segs
}

/** 多段 scale 呼吸（首尾相接，整数帧）：lo→hi→lo 循环 cycles 次。适用于强调 / 脉动 / 心跳。 */
export function pulseSegs(totalFrames, cycles, lo, hi) {
  const segs = []
  const cyc = Math.round(totalFrames / cycles)
  const half = Math.round(cyc / 2)
  for (let c = 0; c < cycles; c += 1) {
    const base = c * cyc
    segs.push({ from: { scale: lo }, to: { scale: hi }, startFrame: base, durationInFrames: half })
    segs.push({ from: { scale: hi }, to: { scale: lo }, startFrame: base + half, durationInFrames: cyc - half })
  }
  return segs
}

/** 单段线性位移动画（入场滑入 / 平移 / 出场）。 */
export function travelSegs({ from, to, startFrame, durationInFrames, easing = 'easeOut' }) {
  return [{ from, to, startFrame, durationInFrames, easing }]
}

/**
 * 原地旋转（rotation 关键帧，CV-336 后多段可叠加）。
 * `turns` 圈，从 startFrame 起铺到 totalFrames。适用于指针 / 齿轮 / 加载环 / 强调翻转。
 */
export function rotateSegs(totalFrames, turns, startFrame = 0) {
  const span = totalFrames - startFrame
  const K = Math.max(4, Math.round(Math.abs(turns) * 12))
  const segs = []
  for (let i = 0; i < K; i += 1) {
    const f0 = startFrame + Math.round((i * span) / K)
    const f1 = startFrame + Math.round(((i + 1) * span) / K)
    segs.push({
      from: { rotation: (360 * turns * i) / K },
      to: { rotation: (360 * turns * (i + 1)) / K },
      startFrame: f0,
      durationInFrames: Math.max(1, f1 - f0),
      easing: 'linear',
    })
  }
  return segs
}

/**
 * 拖尾相位偏移：运动体 A 落后 B 共 lagFrames，则 A 的圆周相位要减去这段时间的角位移，
 * 使拖尾残影精确落在 B 的运动轨迹后方。
 */
export function lagPhaseOffset(periodFrames, lagFrames) {
  return -((2 * Math.PI * lagFrames) / periodFrames)
}
