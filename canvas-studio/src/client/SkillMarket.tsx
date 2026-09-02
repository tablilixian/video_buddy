/**
 * 全屏技能广场（CV-065）。
 *
 * 布局参照 MiniMaxHub（需求 2 图 #2）：左侧分类侧栏 + 右侧卡片网格。以覆盖层
 * 形式盖在 `.csFrame` 上（避开左侧 280px 项目栏），而不是替换画布容器 ——
 * 这样 lobby 与 work 两种模式共用同一套进入/退出逻辑，也不用重排 grid。
 *
 * 「新建技能」按钮保留但禁用 + 「待接入」角标（reserved 字段原则：不伪造
 * 已生效——自建 skill 的目录规范见 docs/skill-expansion-spec.md，UI 编辑器
 * 尚未实现）。
 *
 * 竞品对标批次（2026-09-02）：
 * - CV-072：右上搜索框（title/summary 子串过滤，与分类筛选叠加）。
 * - CV-074：「官方精选」分区（featured 置顶）+「其他技能」两级呈现。
 * - CV-073：「我的 Skill」视图（activeSkills 已激活条目 + 卸载，复用 CV-066 链路）。
 * - CV-077：「仅显示未激活」过滤。
 * - CV-071：技能详情弹窗（标题/说明/分类/使用入口）。
 * - CV-078：网格末尾创作者社区 CTA 卡（reserved 纯展示）。
 */
import { useEffect, useMemo, useState } from 'react'
import type { ReactElement } from 'react'
import {
  SKILL_CATALOG, SKILL_CATEGORY_IDS, SKILL_CATEGORY_LABELS,
  skillCountByCategory, skillsByCategory, getSkillEntry,
} from '../skill-catalog.js'
import type { SkillCatalogEntry, SkillCategoryId } from '../skill-catalog.js'
import { SkillCard } from './SkillCard.js'
import { SkillIcon } from './SkillIcon.js'

/** 侧栏「全部」的伪分类 id。 */
const ALL = 'all'

export interface SkillMarketProps {
  onClose: () => void
  onActivate: (entry: SkillCatalogEntry) => void
  /** CV-073：当前项目已装载的 skill（缺省空 = lobby 态无项目，我的视图隐藏）。 */
  activeSkills?: readonly string[]
  /** CV-073：卸载一个已装载 skill。 */
  onDeactivate?: (name: string) => void
}

/** 过滤链：分类 → 搜索子串 → 仅显示未激活。 */
function filterEntries(
  active: SkillCategoryId | typeof ALL,
  query: string,
  onlyInactive: boolean,
  activeSkills: readonly string[],
): SkillCatalogEntry[] {
  const base = active === ALL ? SKILL_CATALOG : skillsByCategory(active)
  const q = query.trim().toLowerCase()
  return base.filter((entry) => {
    if (q.length > 0
      && !entry.title.toLowerCase().includes(q)
      && !entry.summary.toLowerCase().includes(q)
      && !entry.name.toLowerCase().includes(q)) return false
    if (onlyInactive && activeSkills.includes(entry.name)) return false
    return true
  })
}

/** 全屏技能广场：左分类侧栏 + 右卡片网格。 */
export function SkillMarket(props: SkillMarketProps): ReactElement {
  const { onClose, onActivate, activeSkills = [], onDeactivate } = props
  const [active, setActive] = useState<SkillCategoryId | typeof ALL>(ALL)
  // CV-073：discovery / mine 双视角（有项目才可进 mine——lobby 态没有装载宿主）。
  const [view, setView] = useState<'discover' | 'mine'>('discover')
  // CV-072：搜索词；CV-077：仅显示未激活。
  const [query, setQuery] = useState('')
  const [onlyInactive, setOnlyInactive] = useState(false)
  // CV-071：详情弹窗条目。
  const [detail, setDetail] = useState<SkillCatalogEntry | null>(null)
  const counts = skillCountByCategory()
  const mineActive = view === 'mine'
  const entries = useMemo(
    () => filterEntries(active, query, onlyInactive && !mineActive, activeSkills),
    [active, query, onlyInactive, mineActive, activeSkills],
  )
  // CV-074：仅「全部 + 无搜索 + 未勾过滤」时分级呈现精选区，其余场景平铺。
  const splitFeatured = active === ALL && query.trim().length === 0 && !(onlyInactive && !mineActive) && !mineActive
  const featured = splitFeatured ? entries.filter(entry => entry.featured) : []
  const rest = splitFeatured ? entries.filter(entry => !entry.featured) : entries

  // Escape 关闭：覆盖层的标准可用性（与画布右键菜单一致）。
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        if (detail !== null) { setDetail(null); return }
        onClose()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => { window.removeEventListener('keydown', onKeyDown) }
  }, [onClose, detail])

  const renderGrid = (items: readonly SkillCatalogEntry[]): ReactElement => (
    <div className="csSkillGrid">
      {items.map(entry => (
        <SkillCard key={entry.name} entry={entry} onActivate={onActivate} onDetail={setDetail} />
      ))}
      {/* CV-078：创作者社区收尾卡（reserved 纯展示）。 */}
      {items.length > 0 && (
        <div className="csSkillCommunity">
          <span className="csSkillCommunityIcon">✦</span>
          <h3>加入创作者社区</h3>
          <p>按目录规范投放你的技能（规划中）</p>
          <span className="csReserved">待接入</span>
        </div>
      )}
    </div>
  )

  return (
    <div className="csSkillMarket" role="dialog" aria-modal="true" aria-label="技能广场">
      <header className="csSkillMarketBar">
        <button type="button" className="csSkillMarketBack" onClick={onClose}>← 返回</button>
        <h2 className="csSkillMarketTitle">技能广场</h2>
        <span className="csSkillMarketCount">{SKILL_CATALOG.length} 个技能</span>
        <span className="csSkillMarketSpacer" />
        {/* CV-072：搜索（发现视角下生效，与分类/过滤叠加）。 */}
        {view === 'discover' && (
          <input
            type="search"
            className="csSkillSearch"
            placeholder="搜索 Skill..."
            value={query}
            onChange={event => { setQuery(event.target.value) }}
          />
        )}
        <button
          type="button"
          className="csSkillMarketCreate"
          disabled
          title="自建技能需按 docs/skill-expansion-spec.md 放目录，UI 编辑器尚未实现"
        >
          + 新建技能
          <span className="csReserved">待接入</span>
        </button>
      </header>
      <div className="csSkillMarketBody">
        <nav className="csSkillRail" aria-label="技能分类">
          {/* CV-073：发现 / 我的 Skill 双视角切换（无项目时隐藏「我的」）。 */}
          {onDeactivate !== undefined && (
            <button
              type="button"
              className={mineActive ? 'csSkillRailItem csSkillRailActive' : 'csSkillRailItem'}
              onClick={() => { setView('mine') }}
            >
              <span>我的 Skill</span>
              <span className="csSkillRailCount">{activeSkills.length}</span>
            </button>
          )}
          {!mineActive && (
            <button
              type="button"
              className={active === ALL ? 'csSkillRailItem csSkillRailActive' : 'csSkillRailItem'}
              onClick={() => { setActive(ALL) }}
            >
              <span>全部</span>
              <span className="csSkillRailCount">{SKILL_CATALOG.length}</span>
            </button>
          )}
          {!mineActive && SKILL_CATEGORY_IDS.filter(id => counts[id] > 0).map(id => (
            <button
              key={id}
              type="button"
              className={active === id ? 'csSkillRailItem csSkillRailActive' : 'csSkillRailItem'}
              onClick={() => { setActive(id) }}
            >
              <span>{SKILL_CATEGORY_LABELS[id]}</span>
              <span className="csSkillRailCount">{counts[id]}</span>
            </button>
          ))}
        </nav>
        <div className="csSkillContent">
          {mineActive ? (
            /* CV-073：我的 Skill —— 已装载清单 + 卸载。 */
            activeSkills.length === 0
              ? <div className="csSkillEmpty">还没有装载任何技能。在「发现」里点「使用」，work 态会同步装载。</div>
              : (
                <div className="csSkillMine">
                  {activeSkills.map((name) => {
                    const entry = getSkillEntry(name)
                    return (
                      <div className="csSkillMineRow" key={name}>
                        <SkillIcon id={entry?.icon ?? 'puzzle'} size={18} />
                        <span className="csSkillMineTitle">{entry?.title ?? name}</span>
                        <span className="csSkillMineName">{name}</span>
                        <button
                          type="button"
                          className="csSkillMineRemove"
                          title="卸载该技能"
                          onClick={() => { onDeactivate?.(name) }}
                        >
                          ×
                        </button>
                      </div>
                    )
                  })}
                </div>
              )
          ) : (
            <>
              {/* CV-077：仅显示未激活过滤。 */}
              <label className="csSkillOnlyInactive">
                <input
                  type="checkbox"
                  checked={onlyInactive}
                  onChange={event => { setOnlyInactive(event.target.checked) }}
                />
                仅显示未装载
              </label>
              {entries.length === 0 ? (
                <div className="csSkillEmpty">没有匹配的技能，换个关键词试试。</div>
              ) : splitFeatured ? (
                <>
                  {featured.length > 0 && (
                    <>
                      <h3 className="csSkillSectionTitle">官方精选</h3>
                      {renderGrid(featured)}
                    </>
                  )}
                  {rest.length > 0 && (
                    <>
                      <h3 className="csSkillSectionTitle">其他技能 · {rest.length}</h3>
                      {renderGrid(rest)}
                    </>
                  )}
                </>
              ) : (
                renderGrid(entries)
              )}
            </>
          )}
        </div>
      </div>
      {/* CV-071：技能详情弹窗（Escape 先关弹窗再关广场）。 */}
      {detail !== null && (
        <div className="csSkillDetailBackdrop" onClick={() => { setDetail(null) }}>
          <div
            className="csSkillDetail"
            role="dialog"
            aria-modal="true"
            aria-label={detail.title}
            onClick={event => { event.stopPropagation() }}
          >
            <div className="csSkillDetailThumb" style={{ background: `linear-gradient(135deg, hsl(${detail.hue} 70% 56%), hsl(${(detail.hue + 42) % 360} 62% 42%))` }}>
              <SkillIcon id={detail.icon} size={30} />
            </div>
            <div className="csSkillDetailBody">
              <h3 className="csSkillDetailTitle">
                {detail.title}
                {detail.h3 === true && <span className="csSkillH3">H3</span>}
              </h3>
              <span className="csSkillDetailCategory">{SKILL_CATEGORY_LABELS[detail.category]}</span>
              <p className="csSkillDetailSummary">{detail.summary}</p>
              <code className="csSkillDetailName">{detail.name}</code>
              <div className="csSkillDetailActions">
                <button type="button" className="csSkillDetailUse" onClick={() => { onActivate(detail) }}>
                  使用该技能
                </button>
                <button type="button" className="csSkillDetailClose" onClick={() => { setDetail(null) }}>关闭</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
