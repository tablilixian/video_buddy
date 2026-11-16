/**
 * B5（O-8）· **内容密度体检** —— 纯函数，不阻断渲染，只说话。
 *
 * ## 为什么需要
 *
 * 真机会话 6f8ba13c（20s / 3 屏 / 1080p）全片约 40 字 = **2 字/秒**，3 屏 × 6.7s
 * 每屏 1–2 个信息点；而卡容量其实很宽（A4 `bullets` 支持 6 条、B1 `dataCard` 支持
 * 4 行 k:v），实际各只用了 1 条。归因不是「创意太简单」，是三件事叠在一起：
 *
 * 1. 用户给的是**定稿文案**而不是素材清单，agent 按「事实不许编」逐字执行 ⇒ 必然稀；
 * 2. `autoStages` 只按时间定屏（6.5s/屏），与信息量无关 ⇒ 20s 只切 3 屏；
 * 3. **没有任何密度判据** —— 质检 5 条（静态占比 / 运动密度 / 转场 / 镜头数 / 节奏）
 *    里没有「文字密度」，所以「一屏一句话」永远不会被指出。
 *
 * 本模块补第 3 条：把「稀」变成一条可读的数字 + 一条可执行的手段。判据只报事实与
 * 手段，**不改 spec、不阻断渲染** —— 密度是创作判断，不是合法性。
 *
 * ## 口径（写清才不会各说各话）
 *
 * - **字**：去掉空白后的 Unicode 码点数。中文 1 字 = 1，英文一个单词算它的字母数
 *   （偏严但同口径可比；跨语言比较不是本模块的用途，「同一片改前改后」才是）。
 * - **信息点**：把一屏的文案按 `；;、·|` 与换行切分后的非空条目数，**每个单元至少算 1**
 *   （单元本身就是一处分区信息）。这与观众「一眼看到几个不同东西」的直觉接近。
 * - **屏均**：分母是屏数，不是秒数 —— 一屏给观众的时间由 `planStages` 定，密度问题
 *   是「一屏塞了几个点」，不是「每秒几个点」。
 */
import type { ContentSpec } from './content-spec.js'

/** 字数下限（字/秒）。低于它，观众来不及在屏上读到新东西（真机 2.0 即触发）。 */
export const DENSITY_CHARS_PER_SEC_FLOOR = 2.5

/** 屏均信息点下限。1.x 点/屏 = 幻灯片，不是视频。 */
export const DENSITY_POINTS_PER_SCREEN_FLOOR = 2

/** 单屏明细（回执里逐屏点名用）。 */
export interface ScreenDensity {
  readonly id: string
  /** 该屏上屏字符数（含各单元）。 */
  readonly chars: number
  /** 该屏信息点数（分隔符切分 + 每单元保底 1）。 */
  readonly points: number
  /** 单元数（1 = 单单元屏）。 */
  readonly units: number
}

export interface DensityAudit {
  readonly screens: number
  readonly seconds: number
  readonly chars: number
  readonly charsPerSec: number
  readonly pointsPerScreen: number
  readonly perScreen: readonly ScreenDensity[]
  /** 可读的告警行（空数组 = 密度没问题）。 */
  readonly warnings: readonly string[]
}

const POINT_SPLIT = /[；;、·|｜\n]+/

/** 去空白后的码点数。 */
function countChars(text: string): number {
  return Array.from(text.replace(/\s+/g, '')).length
}

/** 文案 → 信息点条目（去空白、去空条）。 */
export function splitPoints(text: string): string[] {
  return text.split(POINT_SPLIT).map((part) => part.trim()).filter((part) => part !== '')
}

/**
 * 体检一份 spec。
 *
 * `totalFrames`/`fps` 只用于算秒数（与 scaffold 同一份换算，避免「spec 说 20s、体检说
 * 18.4s」两套时长）。
 */
export function auditSpecDensity(spec: ContentSpec, totalFrames: number, fps: number): DensityAudit {
  const seconds = fps > 0 ? totalFrames / fps : 0
  const perScreen: ScreenDensity[] = spec.sections.map((section) => {
    const units = Array.isArray(section.units) && section.units.length > 0 ? section.units : []
    const texts = units.length > 0
      ? units.map((unit) => unit.copy ?? '')
      : [section.copy ?? '']
    const chars = texts.reduce((sum, text) => sum + countChars(text), 0)
    const splitPointsCount = texts.reduce((sum, text) => sum + splitPoints(text).length, 0)
    // 每单元保底 1 点：单元分区本身就是一处独立信息（哪怕它只有一个词）。
    const points = Math.max(splitPointsCount, units.length > 0 ? units.length : 1)
    return { id: section.id, chars, points, units: units.length > 0 ? units.length : 1 }
  })

  const chars = perScreen.reduce((sum, screen) => sum + screen.chars, 0)
  const screens = perScreen.length
  const charsPerSec = seconds > 0 ? Math.round((chars / seconds) * 100) / 100 : 0
  const pointsPerScreen = screens > 0
    ? Math.round((perScreen.reduce((sum, screen) => sum + screen.points, 0) / screens) * 100) / 100
    : 0

  const warnings: string[] = []
  if (screens === 0) return { screens, seconds, chars, charsPerSec, pointsPerScreen, perScreen, warnings }

  if (charsPerSec < DENSITY_CHARS_PER_SEC_FLOOR) {
    const thinnest = [...perScreen].sort((a, b) => a.points - b.points)[0] as ScreenDensity
    warnings.push(
      `内容密度：${String(charsPerSec)} 字/秒（全片 ${String(chars)} 字 / ${String(Math.round(seconds * 10) / 10)}s）—— `
        + `低于 ${String(DENSITY_CHARS_PER_SEC_FLOOR)} 时观众在屏上读不到新信息。`
        + `手段（都不需要编事实）：把用户原话里的「数值 / 对比 / 因果 / 反常识」拆成条目 `
        + `（A4 支持 6 条、B1 支持 4 行 k:v，当前最稀的一屏 ${thinnest.id} 只有 ${String(thinnest.points)} 条）；`
        + `或给 meta.targetStageSec: 4 让屏数变多（20s ⇒ 5 屏）。`,
    )
  }
  if (pointsPerScreen < DENSITY_POINTS_PER_SCREEN_FLOOR) {
    warnings.push(
      `信息点：屏均 ${String(pointsPerScreen)} 个（${String(screens)} 屏）—— 一屏一个点在 5s 以上就等于幻灯片。`
        + '一屏 2–3 个点通常最稳：主结论 + 一个支撑数字 / 一个反例。',
    )
  }
  const multiUnitScreens = perScreen.filter((screen) => screen.units > 1).length
  if (multiUnitScreens === 0 && screens >= 3) {
    warnings.push(
      '版面：全片没有一屏用到多单元（units）—— 一屏单元素是「一屏一句话」的版面成因，'
        + '密度不足时优先考虑「主视觉 + 一个数据卡」并置，而不是把同一句话反复强调。',
    )
  }

  return { screens, seconds, chars, charsPerSec, pointsPerScreen, perScreen, warnings }
}
