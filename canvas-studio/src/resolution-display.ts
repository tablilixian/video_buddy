/**
 * 分辨率展示口径 ↔ 真值档位的**派生视图**。
 *
 * 2026-10-27 起与 `resolution-tiers.ts` 同表（事实源在那里）：显示名 = `label`、
 * 菜单 meta = `costMeta`、真值 = `megapixels` / `frames`。本模块只负责
 * 「给 UI 用的三个字段」这一层视图，不参与任何取值决策。
 *
 * 为什么还留这一层而不是让 UI 直接读 `RESOLUTION_TIERS`：菜单只要 `value/label/meta`
 * 三样，直接把整条 tier（含 deprecatedAliases）递给组件会让 UI 有机会读到不该读的字段
 * （历史键一旦被 UI 引用，「写路径只写规范键」这条就会漏）。
 */
import {
  DEFAULT_RESOLUTION_ID,
  DEFAULT_VIDEO_RESOLUTION_ID,
  frameOf,
  normalizeResolutionId,
  resolutionIdsFor,
  resolutionRank,
  resolutionTierOf,
  type ResolutionFrame,
  type ResolutionId,
  type ResolutionScope,
} from './resolution-tiers.js'

/** 分辨率的演示展示口径（label/meta 逐字取自档位表）。 */
export interface ResolutionDisplay {
  /** 内部真值档位（`video_generate` 等工具的 resolution 枚举）。 */
  readonly value: ResolutionId
  /** chip / 菜单里展示的通用称呼（480P / 720P / 1080P）。 */
  readonly label: string
  /** 菜单右侧 meta（耗时倍数，以 720P 为 1× 基准；推荐档写「推荐」）。 */
  readonly meta: string
}

/**
 * 某个适用范围可用的展示口径列表（顺序 = 菜单顺序）。
 *
 * 2026-10-27 拍板「图片下限 720P」后，**同一份档位表要按用途出不同菜单**：
 * 视频三档、图片两档、项目预置两档（见 `ResolutionScope`）。UI 一律走这里，
 * 不要自己 `RESOLUTION_TIERS.filter` —— 过滤规则只该有一处。
 */
export function resolutionDisplaysFor(scope: ResolutionScope): readonly ResolutionDisplay[] {
  return resolutionIdsFor(scope).map(id => {
    const tier = resolutionTierOf(id)
    return { value: tier.id, label: tier.label, meta: tier.costMeta }
  })
}

/**
 * 展示口径列表（全三档 = **视频侧**菜单）。
 *
 * 保留这个常量是为了既有视频调用点不用改签名；图片侧请用
 * `resolutionDisplaysFor('image')`（2026-10-27 二次拍板后已无 `project` 范围：
 * 项目预置只管视频，图片不读 plan）。
 */
export const RESOLUTION_DISPLAY: readonly ResolutionDisplay[] = resolutionDisplaysFor('video')

/**
 * 首页默认档位 = **视频**出厂默认（480P）。
 *
 * 2026-10-27 拍板：首页那个下拉只作用于视频（图片档位在图片节点里调），所以它的
 * 默认值必须跟视频出厂值一致 —— 用图片的 720P 会让「没选就用 480P」不成立。
 */
export const DEFAULT_LOBBY_RESOLUTION: ResolutionId = DEFAULT_VIDEO_RESOLUTION_ID

/** 设置页下拉的一项（`value` 写入设置，`text` 是给人看的那一行）。 */
export interface ResolutionOption {
  readonly value: ResolutionId
  /** `480P · 864×480` —— **必须带真实像素**：光写「720P」会让人以为产物是 1280×720。 */
  readonly text: string
}

/**
 * 设置页 / 首次向导的下拉选项（唯一来源）。
 *
 * 改造前这两个 `<select>` 各自手写三行 `<option>`，而且写的是内部键裸名
 * （`736p · 1280×736`、`2k · 1920×1088`）—— 用户在设置里看到的是开发者术语。
 * 现在统一为「通用称呼 · 真实像素」，且像素由档位表派生，改表即改 UI。
 */
export function resolutionOptionsFor(scope: ResolutionScope): readonly ResolutionOption[] {
  return resolutionIdsFor(scope).map(id => {
    const tier = resolutionTierOf(id)
    return { value: tier.id, text: `${tier.label} · ${tier.frames['16:9'].width}×${tier.frames['16:9'].height}` }
  })
}

/** 全三档下拉选项（= 视频侧设置项）。图片侧走 `resolutionOptionsFor('image')`。 */
export const RESOLUTION_OPTIONS: readonly ResolutionOption[] = resolutionOptionsFor('video')

/** 一个可升的目标档（升档重出用）。 */
export interface ResolutionUpgradeTarget {
  readonly value: ResolutionId
  /** `720P` */
  readonly label: string
  /** 该节点**当前画幅**下的目标像素（`1376×768` / 竖屏 `768×1376`）。 */
  readonly frame: ResolutionFrame
  /** 菜单行文案（`升 720P 重出 · 1376×768`）—— 像素必须带上，见档位表文件头。 */
  readonly action: string
}

/**
 * 某节点当前档位可升的目标（**严格更高档**，只用于视频节点）。
 *
 * 为什么只给「向上」：升档是花钱动作，而且换档 = 重跑一次推理（`megapixels` 是推理
 * 规格、不是后处理放大）⇒ 画面会重新演绎。降档没有用户价值（省的那点钱不值得再看
 * 一遍），要降到是改档 + 重试两步，不该混进这个「变清晰」的入口里。
 *
 * 像素按节点**当前画幅**算 —— 9:16 的节点点「升 720P」要看到 768×1376，
 * 显示 16:9 的 1376×768 就是在骗人。
 */
export function resolutionUpgradeTargets(
  current: unknown,
  aspectRatio: string | undefined,
): readonly ResolutionUpgradeTarget[] {
  const currentId = normalizeResolutionId(current)
  const currentRank = currentId === undefined ? -1 : resolutionRank(currentId)
  return resolutionIdsFor('video')
    .filter(id => resolutionRank(id) > currentRank)
    .map(id => {
      const tier = resolutionTierOf(id)
      const frame = frameOf(id, aspectRatio)
      return { value: id, label: tier.label, frame, action: `升 ${tier.label} 重出 · ${frame.width}×${frame.height}` }
    })
}

/**
 * 下拉选项，且**保证当前值一定在返回列表里**（`<select value>` 找不到对应
 * `<option>` 会渲染成空白或跳到首项，等于对用户说谎）。
 *
 * 什么时候会缺：存量设置项 / 存量节点上躺着已经停用的档位 —— 典型是
 * 「图片下限 720P」之前的 `defaultImageResolution: '480p'`。这类值按铁律
 * **不动**（存量不迁移），显示上标一句「该用途已停用」，但菜单不再提供新选。
 */
export function resolutionOptionsWith(scope: ResolutionScope, current: unknown): readonly ResolutionOption[] {
  const base = resolutionOptionsFor(scope)
  const id = normalizeResolutionId(current)
  if (id === undefined || base.some(option => option.value === id)) return base
  const tier = resolutionTierOf(id)
  return [...base, {
    value: tier.id,
    text: `${tier.label} · ${tier.frames['16:9'].width}×${tier.frames['16:9'].height}（该用途已停用）`,
  }]
}

/**
 * 真值档位 → 展示口径。
 *
 * 历史键（`736p` / `2k`）先归一，未知值回落默认档 —— 防脏数据把 chip 渲染成
 * `undefined`（老项目 `plan` / 老节点参数里都可能带着旧键）。
 */
export function resolutionDisplay(value: unknown): ResolutionDisplay {
  const id = normalizeResolutionId(value) ?? DEFAULT_RESOLUTION_ID
  const tier = resolutionTierOf(id)
  return { value: tier.id, label: tier.label, meta: tier.costMeta }
}
