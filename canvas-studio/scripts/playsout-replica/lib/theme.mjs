/**
 * playsout 复刻 · 主题与时间轴（对齐源工程 `src/po/theme.ts` / `src/po/Main.tsx`）。
 *
 * 取值全部照抄源工程的 tokens（视觉事实源），**不复刻实现**：这里只有常量，
 * 没有组件、没有 CSS、没有 TSX —— 复刻由 manifest 声明式表达。
 */

/** 主题色（源工程 `theme.ts` 的 `C`）。 */
export const C = {
  bg: '#07070F',
  navy: '#111129',
  navy2: '#0C0C1F',
  blue: '#3D3EFD',
  blueDeep: '#2822DE',
  accent: '#495CF5',
  peri: '#98A3FF',
  slate: '#404053',
  slate2: '#2C2C3D',
  text: '#ECECF2',
  dim: '#9A9AB5',
  mute: '#6E6E86',
  pink: '#FF4D9D',
  lime: '#B6FF3C',
  cyan: '#38E1FF',
  gold: '#FFC24B',
}

/** 画布与时间轴（源工程 `theme.ts` 的 `TOTAL` / `FPS`）。 */
export const CANVAS = { width: 1920, height: 1080, fps: 30, total: 1800 }

/**
 * 12 镜头时间轴（源工程 `Main.tsx` 的 `SHOTS`）。
 * 帧号是全片坐标系；`duration` 是该镜头的帧长（下一镜起点 − 本镜起点）。
 */
export const SHOTS = [
  { id: 'open', from: 0, duration: 150 },
  { id: 't1', from: 150, duration: 54 },
  { id: 'hero', from: 204, duration: 240 },
  { id: 'metrics', from: 444, duration: 168 },
  { id: 't2', from: 612, duration: 54 },
  { id: 'sdk', from: 666, duration: 168 },
  { id: 'prism', from: 834, duration: 168 },
  { id: 'compute', from: 1002, duration: 168 },
  { id: 'catalogue', from: 1170, duration: 168 },
  { id: 'audience', from: 1338, duration: 168 },
  { id: 't3', from: 1506, duration: 54 },
  { id: 'outro', from: 1560, duration: 240 },
]

/** 镜头 id → 起始帧 / 结束帧（便于 spec 里用镜内相对帧换算绝对帧）。 */
export const SHOT_START = Object.fromEntries(SHOTS.map((s) => [s.id, s.from]))
export const SHOT_END = Object.fromEntries(SHOTS.map((s) => [s.id, s.from + s.duration]))

/** 画布百分比换算：像素 → 画布百分比。 */
export const px = (value, axis = 'x') => (value / (axis === 'x' ? CANVAS.width : CANVAS.height)) * 100

/** 像素点 → 画布百分比中心点（shape / textCard 的 box 语义是**中心**）。 */
export const centerOf = (x, y) => ({ x: round2(px(x, 'x')), y: round2(px(y, 'y')) })

export function round2(value) {
  return Math.round(value * 100) / 100
}

/**
 * 21 张合作方 logo 的排布（源工程 `scenes/Open.tsx` 的 `LOGOS` / `COLS` / `CELL_W` / `CELL_H`）。
 *
 * 网格在源工程里是「像素网格 + 整体 scale(1.18)」；我们的 manifest 用画布百分比，
 * 由 `group` 容器统一施加 1.18 的缩放与 3D 姿态 ⇒ 这里只算**未缩放**的中心点。
 */
export const PARTNER_LOGOS = [
  'grab', 'wechat', 'douyin', 'snapchat', 'line', 'careem', 'viu',
  'tencent', 'binance', 'okx', 'erosnow', 'tvazteca', 'dogeos',
  'kbw', 'kenetic', 'longling', 'baseapp', 'whampoa',
  'pacific-century', 'venturesouq', 'okx-ventures',
]

export const WALL = {
  cols: 7,
  /**
   * 格子尺寸：源工程是 292×286（网格总宽 2044 > 画布 1920 ⇒ 左右两列**故意**出画）。
   * 我们的校验层拒收出画的 box ⇒ 格子收窄到 268×260（网格 1876×780，落在画布内），
   * 再由 `group` 容器的 1.18 倍缩放把两侧推出画布 —— 观感与源工程一致。
   */
  cellW: 268,
  cellH: 260,
  scale: 1.18,
  /** 网格左上角（居中布局）。 */
  originX: (1920 - 7 * 268) / 2,
  originY: (1080 - 3 * 260) / 2,
}

/**
 * logo 墙里第 i 个 logo 的格子几何（像素坐标，未乘 WALL_SCALE）。
 * @returns {{ row: number, col: number, cx: number, cy: number, cellW: number, cellH: number }}
 */
export function wallCell(i) {
  const row = Math.floor(i / WALL.cols)
  const col = i % WALL.cols
  return {
    row,
    col,
    cx: WALL.originX + col * WALL.cellW + WALL.cellW / 2,
    cy: WALL.originY + row * WALL.cellH + WALL.cellH / 2,
    cellW: WALL.cellW - 40,
    cellH: WALL.cellH - 48,
  }
}
