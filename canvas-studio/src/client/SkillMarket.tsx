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
 */
import { useEffect, useState } from 'react'
import type { ReactElement } from 'react'
import {
  SKILL_CATALOG, SKILL_CATEGORY_IDS, SKILL_CATEGORY_LABELS,
  skillCountByCategory, skillsByCategory,
} from '../skill-catalog.js'
import type { SkillCatalogEntry, SkillCategoryId } from '../skill-catalog.js'
import { SkillCard } from './SkillCard.js'

/** 侧栏「全部」的伪分类 id。 */
const ALL = 'all'

export interface SkillMarketProps {
  onClose: () => void
  onActivate: (entry: SkillCatalogEntry) => void
}

/** 全屏技能广场：左分类侧栏 + 右卡片网格。 */
export function SkillMarket(props: SkillMarketProps): ReactElement {
  const { onClose, onActivate } = props
  const [active, setActive] = useState<SkillCategoryId | typeof ALL>(ALL)
  const counts = skillCountByCategory()
  const entries = active === ALL ? SKILL_CATALOG : skillsByCategory(active)

  // Escape 关闭：覆盖层的标准可用性（与画布右键菜单一致）。
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => { window.removeEventListener('keydown', onKeyDown) }
  }, [onClose])

  return (
    <div className="csSkillMarket" role="dialog" aria-modal="true" aria-label="技能广场">
      <header className="csSkillMarketBar">
        <button type="button" className="csSkillMarketBack" onClick={onClose}>← 返回</button>
        <h2 className="csSkillMarketTitle">技能广场</h2>
        <span className="csSkillMarketCount">{SKILL_CATALOG.length} 个技能</span>
        <span className="csSkillMarketSpacer" />
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
          <button
            type="button"
            className={active === ALL ? 'csSkillRailItem csSkillRailActive' : 'csSkillRailItem'}
            onClick={() => { setActive(ALL) }}
          >
            <span>全部</span>
            <span className="csSkillRailCount">{SKILL_CATALOG.length}</span>
          </button>
          {SKILL_CATEGORY_IDS.filter(id => counts[id] > 0).map(id => (
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
        <div className="csSkillGrid">
          {entries.map(entry => (
            <SkillCard key={entry.name} entry={entry} onActivate={onActivate} />
          ))}
        </div>
      </div>
    </div>
  )
}
