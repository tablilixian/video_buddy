/**
 * REQ-034 · 二期（A1 / A2 / A3 / A4 / B1）取证夹具：**一个 manifest 走完全部新原语**。
 *
 * 为什么单独一份而不是改 `entry.tsx` 里那份：S10 的老夹具（`entry.tsx` 的
 * `manifestVideoOnly` / `with-audio`）是**回归基线**，它逐像素不变本身就是证据；
 * 往它里面塞新字段等于把基线搅了。二期原语另起一份，两份互不影响。
 *
 * 覆盖清单（每条都对应一个二期交付项）：
 *   A1  `orbit`      —— 三颗绕转体（不同半径 / 周期 / 起始角 / 方向）
 *   A1  `path+draw`  —— 描边生长（曲线 + 折线箭头各一）
 *   A2  `fx`         —— glow / stroke / shadow / blur / maskFade 各用一次
 *   A3  形状族        —— arrow / triangle / star / polygon
 *   A4  新转场        —— wipeLeft（章节推进）+ clock（扇形揭晓）
 *   B1  `audioViz`   —— 波形可见（用 `/assets/bgm.mp4` 的音轨）
 *
 * 跑法（**须有 GUI 的终端**）：`NODE_OPTIONS= node scripts/remotion-verify/verify.mjs`
 * 它会连这份一起渲，产物落 `out/render-phase2.mp4` 与 `out/still-*.png`。
 * 确定性判定（同一 manifest 渲两次必须逐像素一致）用 `frame-diff.mjs`。
 *
 * 零外部素材（除 `assets/` 里已有的 bgm.mp4）、零视频模型调用。
 */

const W = 1280
const H = 720
const FPS = 30
const TOTAL = 420

/** 三段式：每段 150 帧、相邻重叠 15 帧（转场必须落在重叠区）。 */
const SEG = 150
const OVERLAP = 15

function segStart(index) {
  return index * (SEG - OVERLAP)
}

/** 三块背景渐变：给转场一个明显的"换场"观感。 */
function backdrops() {
  return [
    { id: 'bg-1', color: '#0a1020', start: segStart(0) },
    { id: 'bg-2', color: '#101a2c', start: segStart(1) },
    { id: 'bg-3', color: '#141026', start: segStart(2) },
  ].map(({ id, color, start }) => ({
    id,
    type: 'shape',
    shape: 'gradient',
    color,
    box: { x: 50, y: 50, w: 100, h: 100 },
    startFrame: start,
    durationInFrames: SEG,
    fadeFrames: 0,
  }))
}

/** A1：公转三体（内圈快、外圈慢；一顺一逆，肉眼能分辨方向）。 */
function orbitBodies() {
  const bodies = [
    { id: 'p-inner', radius: 14, period: 120, angle: 0, dir: 'cw', size: 3.2, color: '#5AA9FF' },
    { id: 'p-mid', radius: 24, period: 200, angle: 120, dir: 'cw', size: 2.8, color: '#3DDC97' },
    { id: 'p-outer', radius: 34, period: 300, angle: -60, dir: 'ccw', size: 2.4, color: '#F59E0B' },
  ]
  return bodies.map((body) => ({
    id: body.id,
    type: 'shape',
    shape: 'circle',
    color: body.color,
    box: { x: 0, y: 0, w: body.size, h: body.size },
    startFrame: segStart(0),
    durationInFrames: SEG,
    fadeFrames: 0,
    fx: 'glow',
    orbit: {
      center: { x: 50, y: 50 },
      radius: body.radius,
      startAngle: body.angle,
      periodInFrames: body.period,
      direction: body.dir,
    },
  }))
}

/** A1：路径生长（曲线 + 折线各一；坐标是 0–100 双轴百分比）。 */
function pathTracks() {
  return [
    {
      id: 'path-curve',
      type: 'shape',
      shape: 'path',
      color: '#7DD3FC',
      strokeWidth: 0.9,
      d: 'M 10 78 C 30 30, 55 92, 90 24',
      startFrame: segStart(1) + 10,
      durationInFrames: 120,
      fadeFrames: 0,
      draw: { to: 1, durationInFrames: 90, easing: 'easeInOut' },
    },
    {
      id: 'path-zigzag',
      type: 'shape',
      shape: 'path',
      color: '#F472B6',
      strokeWidth: 0.7,
      d: 'M 12 30 L 32 62 L 52 26 L 72 60 L 90 28',
      startFrame: segStart(1) + 30,
      durationInFrames: 110,
      fadeFrames: 0,
      draw: { to: 0.85, startFrame: 10, durationInFrames: 70, easing: 'easeOut' },
    },
  ]
}

/** A3：形状族（每种一种几何，摆成一行）。 */
function shapeFamily() {
  const items = [
    { id: 'sh-arrow', shape: 'arrow', x: 22, color: '#22D3EE' },
    { id: 'sh-tri', shape: 'triangle', x: 40, color: '#F59E0B' },
    { id: 'sh-star', shape: 'star', x: 58, color: '#FDE047' },
    { id: 'sh-poly', shape: 'polygon', x: 76, color: '#A78BFA' },
  ]
  return items.map((item, index) => ({
    id: item.id,
    type: 'shape',
    shape: item.shape,
    color: item.color,
    box: { x: item.x, y: 42, w: 9, h: 9 },
    startFrame: segStart(2) + 8 + index * 6,
    durationInFrames: SEG - 40,
    fadeFrames: 6,
    fx: 'shadow',
    animate: { from: { scale: 0.6 }, to: { scale: 1 }, durationInFrames: 18, easing: 'easeOut' },
  }))
}

/** A2：fx 展示（每种特效一张卡，排成竖列）。 */
function fxCards() {
  const items = [
    { id: 'fx-glow', text: 'glow · 外发光', fx: 'glow', y: 20 },
    { id: 'fx-stroke', text: 'stroke · 描边', fx: 'stroke', y: 34 },
    { id: 'fx-shadow', text: 'shadow · 投影', fx: 'shadow', y: 48 },
    { id: 'fx-blur', text: 'blur · 虚化', fx: 'blur', y: 62 },
    { id: 'fx-mask', text: 'maskFade · 渐隐', fx: 'maskFade', y: 76 },
  ]
  return items.map((item) => ({
    id: item.id,
    type: 'textCard',
    variant: 'bullets',
    text: [item.text],
    startFrame: segStart(2) + 4,
    durationInFrames: SEG - 10,
    fadeFrames: 0,
    fx: item.fx,
    transform: { x: 28, y: item.y, scale: 0.72 },
  }))
}

/** B1：音频可视化（用随包 bgm 的音轨；解码失败时组件画基线，不炸）。 */
function audioViz() {
  return {
    id: 'viz',
    type: 'audioViz',
    src: '/assets/bgm.mp4',
    bars: 40,
    mode: 'mirror',
    gain: 1.8,
    heightPercent: 20,
    position: 'bottom',
    color: '#38BDF8',
    fx: 'maskFade',
    startFrame: segStart(0),
    durationInFrames: TOTAL,
    fadeFrames: 0,
  }
}

/** A4：转场（wipeLeft 接第一段→第二段，clock 接第二段→第三段）。
 *  ⚠️ 窗口必须落在**两轨重叠区内部**（重叠区 = [后一段 startFrame, 前一段 end)），
 *  放在重叠区之前会被宿主判成「过渡可能不可见」。 */
function transitions() {
  return [
    {
      id: 'tr-wipe',
      type: 'transition',
      effect: 'wipeLeft',
      fromTrackId: 'bg-1',
      toTrackId: 'bg-2',
      startFrame: segStart(1),
      durationInFrames: OVERLAP,
    },
    {
      id: 'tr-clock',
      type: 'transition',
      effect: 'clock',
      fromTrackId: 'bg-2',
      toTrackId: 'bg-3',
      startFrame: segStart(2),
      durationInFrames: OVERLAP,
    },
  ]
}

/** 段落标题（subtitle 以外用 title，硬切靠 fadeFrames:0 保证句间不闪）。 */
function captions() {
  return [
    { id: 'cap-1', text: 'orbit · 一行声明换掉几十段关键帧', start: segStart(0) + 8 },
    { id: 'cap-2', text: 'path + draw · 描边按帧生长', start: segStart(1) + 8 },
    { id: 'cap-3', text: '形状族 · fx · audioViz', start: segStart(2) + 8 },
  ].map((item) => ({
    id: item.id,
    type: 'textCard',
    variant: 'subtitle',
    text: item.text,
    startFrame: item.start,
    durationInFrames: SEG - 16,
    fadeFrames: 0,
  }))
}

export function manifestPhase2() {
  return {
    id: 'phase2-primitives',
    meta: {
      title: '二期原语取证 · orbit / path / fx / 形状 / 转场 / audioViz',
      width: W,
      height: H,
      fps: FPS,
      durationInFrames: TOTAL,
      backgroundColor: '#05070d',
    },
    global: { fontFamily: 'Noto Sans SC', theme: 'dark' },
    tracks: [
      ...backdrops(),
      ...orbitBodies(),
      ...pathTracks(),
      ...shapeFamily(),
      ...fxCards(),
      audioViz(),
      ...transitions(),
      ...captions(),
    ],
    audio: { bgmUrl: '/assets/bgm.mp4' },
  }
}

/** 两帧像素差用到的取样帧（同一 manifest 必须每帧唯一 ⇒ 差 > 0 即证明动画生效）。 */
export const PHASE2_STILL_FRAMES = [20, 90, 165, 300, 400]

export default manifestPhase2
