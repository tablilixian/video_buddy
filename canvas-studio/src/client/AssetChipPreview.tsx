/**
 * CV-114：聊天输入框里素材 chip 的 hover 缩略图浮层。
 *
 * 为什么不是监听 chip 的 mouseover：chip 画在上游 composer 的**镜像层**
 * （`.backdrop`，`pointer-events: none`）里，鼠标事件全部穿透到下面的 textarea，
 * chip 元素本身永远收不到事件。所以这里做**几何命中**——按指针坐标匹配
 * chip 的 `getBoundingClientRect()`，命中即出卡。
 *
 * 卡片本身是我们自己的元素（可点）：点一下打开已有的大图/播放器浮层，
 * 等于把 chip 变成「素材入口」，与 WorkBuddy 的引用预览一致。
 */
import { useEffect, useRef, useState } from 'react'
import type { AssetHandle } from '../reference-handle.js'
import { findAssetByChipText, truncateLabel } from '../reference-handle.js'

/** 素材 chip 的选择器（上游 InputBar 渲染，含 occurrence 属性）。 */
const CHIP_SELECTOR = '[data-decoration="chip"]'

/** 卡片宽高上限（CSS 里同为固定盒，保证定位计算一致）。 */
const CARD_WIDTH = 220
const CARD_MARGIN = 8

/** 时长徽标：秒 → `m:ss`。 */
function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

/** 命中的 chip 及其屏幕位置。 */
interface HoverState {
  readonly asset: AssetHandle
  readonly top: number
  readonly left: number
}

export interface AssetChipPreviewProps {
  /** 当前项目的可引用素材（句柄 → 素材）。 */
  assets: readonly AssetHandle[]
  /** 点击卡片：打开对应的预览/播放浮层。 */
  onOpen(nodeId: string): void
}

/**
 * 渲染（或不渲染）hover 缩略图卡片。常驻挂载、只在命中时出卡，
 * 不做条件渲染换容器（避免 composer 重挂载）。
 */
export function AssetChipPreview({ assets, onOpen }: AssetChipPreviewProps) {
  const [hover, setHover] = useState<HoverState | null>(null)
  // 回调里读最新素材表，避免因依赖变化反复重建监听。
  const assetsRef = useRef(assets)
  assetsRef.current = assets
  const hoverRef = useRef<HoverState | null>(null)
  hoverRef.current = hover

  useEffect(() => {
    /** 按指针坐标找命中的素材 chip（backdrop 不可交互，只能几何匹配）。 */
    const hitTest = (x: number, y: number): HoverState | null => {
      const chips = document.querySelectorAll(CHIP_SELECTOR)
      for (const chip of chips) {
        const rect = chip.getBoundingClientRect()
        if (rect.width === 0 && rect.height === 0) continue
        if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) continue
        // 认三种 chip：自家短句柄、node id、上游文件源的文件名/标题。
        const asset = findAssetByChipText(assetsRef.current, chip.textContent ?? '')
        if (asset === undefined) continue
        return { asset, top: rect.top, left: rect.left }
      }
      return null
    }
    const onMove = (event: PointerEvent): void => {
      const next = hitTest(event.clientX, event.clientY)
      const current = hoverRef.current
      if (next === null && current === null) return
      // 同一 chip 内移动不触发重渲染（避免每帧 setState）。
      if (next !== null && current !== null && next.asset.nodeId === current.asset.nodeId) return
      setHover(next)
    }
    // 滚动 / 失焦一律收起（chip 位置已变，浮层会错位）；点在卡片自身上不收，
    // 否则 pointerdown 先把卡收了，click 就永远打不到「打开」。
    const dismiss = (event?: Event): void => {
      const target = event?.target
      if (target instanceof Element && target.closest('.csChipPreview') !== null) return
      if (hoverRef.current !== null) setHover(null)
    }
    document.addEventListener('pointermove', onMove, true)
    document.addEventListener('pointerdown', dismiss, true)
    window.addEventListener('blur', dismiss)
    document.addEventListener('scroll', dismiss, true)
    return () => {
      document.removeEventListener('pointermove', onMove, true)
      document.removeEventListener('pointerdown', dismiss, true)
      window.removeEventListener('blur', dismiss)
      document.removeEventListener('scroll', dismiss, true)
    }
  }, [])

  if (hover === null) return null
  const { asset, top, left } = hover
  const clampedLeft = Math.min(Math.max(left, CARD_MARGIN), window.innerWidth - CARD_WIDTH - CARD_MARGIN)
  const isVideo = asset.kind === 'video'
  return (
    <div
      className="csChipPreview"
      style={{ left: `${clampedLeft}px`, top: `${top - CARD_MARGIN}px`, width: `${CARD_WIDTH}px` }}
      onPointerDown={(event) => { event.preventDefault() }}
      onClick={() => { onOpen(asset.nodeId) }}
      title="点击打开大图 / 播放"
    >
      {asset.url === null ? (
        <div className="csChipPreviewEmpty">无预览</div>
      ) : isVideo ? (
        <div className="csChipPreviewMedia">
          {/* 取首帧做封面：#t=0.1 让浏览器直接 seek 到第一帧，无需服务端抽帧。 */}
          <video
            className="csChipPreviewVideo"
            src={`${asset.url}#t=0.1`}
            muted
            playsInline
            preload="metadata"
          />
          <span className="csChipPreviewBadge" aria-hidden>▶</span>
          {asset.duration !== undefined && (
            <span className="csChipPreviewDuration">{formatDuration(asset.duration)}</span>
          )}
        </div>
      ) : (
        <img className="csChipPreviewImage" src={asset.url} alt="" />
      )}
      <div className="csChipPreviewFoot">
        <span className="csChipPreviewHandle">{asset.handle}</span>
        <span className="csChipPreviewTitle">{truncateLabel(asset.title === '' ? '未命名素材' : asset.title, 18)}</span>
      </div>
    </div>
  )
}
