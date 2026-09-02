/**
 * lobby 推荐技能横滚（CV-065）。
 *
 * 只做横向滚动 + 左右翻页按钮，不做自动轮播（自动滚动会抢焦点、干扰输入）。
 * 滚动条隐藏，滚动位置靠 scrollBy 分页。
 */
import { useRef } from 'react'
import type { ReactElement } from 'react'
import type { SkillCatalogEntry } from '../skill-catalog.js'
import { SkillCard } from './SkillCard.js'

export interface SkillCarouselProps {
  entries: readonly SkillCatalogEntry[]
  onActivate: (entry: SkillCatalogEntry) => void
  /** 打开全屏技能广场。 */
  onOpenAll: () => void
}

/** 每次翻页滚动的距离（px）：约两张卡 + 间距。 */
const PAGE_STEP = 420

/** 推荐技能横滚条。 */
export function SkillCarousel(props: SkillCarouselProps): ReactElement {
  const { entries, onActivate, onOpenAll } = props
  const trackRef = useRef<HTMLDivElement>(null)
  const scrollBy = (delta: number): void => {
    trackRef.current?.scrollBy({ left: delta, behavior: 'smooth' })
  }
  return (
    <div className="csSkillCarousel">
      <button
        type="button"
        className="csCarouselNav"
        title="向前滚动"
        aria-label="向前滚动"
        onClick={() => { scrollBy(-PAGE_STEP) }}
      >
        ‹
      </button>
      <div className="csCarouselTrack" ref={trackRef}>
        {entries.map(entry => (
          <div className="csCarouselItem" key={entry.name}>
            <SkillCard entry={entry} onActivate={onActivate} />
          </div>
        ))}
      </div>
      <button
        type="button"
        className="csCarouselNav"
        title="向后滚动"
        aria-label="向后滚动"
        onClick={() => { scrollBy(PAGE_STEP) }}
      >
        ›
      </button>
      <button type="button" className="csCarouselMore" onClick={onOpenAll}>
        浏览全部 ›
      </button>
    </div>
  )
}
