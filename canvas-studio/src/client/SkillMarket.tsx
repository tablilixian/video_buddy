/**
 * 全屏技能广场（CV-065 → CV-332）。
 *
 * 布局参照 MiniMaxHub（需求 2 图 #2）：左侧分类侧栏 + 右侧卡片网格。以覆盖层
 * 形式盖在 `.csFrame` 上（避开左侧 280px 项目栏），而不是替换画布容器 ——
 * 这样 lobby 与 work 两种模式共用同一套进入/退出逻辑，也不用重排 grid。
 *
 * ## CV-332：数据源从「编译期常量」变成「常量 + 运行时」
 *
 * 原来只有 `VISIBLE_CATALOG`（内嵌快照，随 bundle 进浏览器；渲染器没有文件系统）。
 * 用户上传的 skill 只存在于磁盘 ⇒ **不可能出现在广场**，除非加一条 Host→Client
 * 的数据通路。本批加的就是它（`GET /canvas-studio/skills`）。
 *
 * ## 三个视图的语义（别复用同一个 key）
 *
 * - **发现**：内置 + 我的，混排。用户条目带来源角标（混排里才需要角标）。
 * - **已装载**：本项目的 `skills.json`（CV-073 的旧「我的 Skill」，语义就是「已装载」）。
 * - **我的技能**：我导入到本机的那批（与「已装载」是两件事 —— 导入不等于装载）。
 *
 * ## 轮询纪律
 *
 * 列表在广场打开期间按固定间隔拉取（**关闭即停**，与生成队列 / 渲染工单同一
 * 「空闲即停」纪律）。拉失败静默保持上一拍 —— 列表是装饰性信息，不该为它弹错。
 * 轮询放在本组件内而不是 `client/index.ts`：那是个共享大文件，而这里能拿到
 * 最精确的生命周期（`useEffect` 的 mount/unmount 就是「广场开着」的定义）。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactElement } from 'react'
import {
  VISIBLE_CATALOG, SKILL_CATEGORY_IDS, SKILL_CATEGORY_LABELS, getSkillEntry,
} from '../skill-catalog.js'
import type { SkillCatalogEntry, SkillCategoryId } from '../skill-catalog.js'
import type { UserSkillsPayload } from '../contracts/skill.js'
import { deleteUserSkill, fetchUserSkills } from './api.js'
import { copyTextQuietly } from './copy-text.js'
import { SkillCard } from './SkillCard.js'
import { SkillIcon } from './SkillIcon.js'
import { SkillImportWizard } from './SkillImportWizard.js'
import { SkillStatusBadge } from './SkillStatusBadge.js'

/** 侧栏「全部」的伪分类 id。 */
const ALL = 'all'

/** 侧栏视图：发现 / 已装载（项目 skills.json）/ 我的技能（导入到本机的）。 */
type MarketView = 'discover' | 'loaded' | 'uploaded'

/** 用户技能列表的轮询间隔（关闭广场即停）。 */
const SKILL_POLL_MS = 3000

/**
 * 从注册名派生一个稳定色相。
 *
 * 用户条目没有 `platform.yaml`，也就没有 `hue` 字段。现算而不是留空：卡片缩略图
 * 需要一点区分度，而同一个名字每次渲染必须得到同一个色相（否则列表一刷新就变色）。
 */
function hueOf(name: string): number {
  let hash = 0
  for (let index = 0; index < name.length; index += 1) {
    hash = (hash * 31 + name.charCodeAt(index)) % 360
  }
  return hash
}

/** 一条用户条目 → 广场卡片形状（`icon` 缺省落 `puzzle`，与未分类条目一致）。 */
function toCatalogEntry(item: UserSkillsPayload['items'][number]): SkillCatalogEntry {
  return {
    name: item.name,
    title: item.title,
    summary: item.summary,
    category: item.category,
    icon: item.icon ?? 'puzzle',
    hue: hueOf(item.name),
    featured: false,
  }
}

export interface SkillMarketProps {
  onClose: () => void
  onActivate: (entry: SkillCatalogEntry) => void
  /** CV-073：当前项目已装载的 skill（缺省空 = lobby 态无项目，我的视图隐藏）。 */
  activeSkills?: readonly string[]
  /** CV-073：卸载一个已装载 skill。 */
  onDeactivate?: (name: string) => void
  /**
   * CV-332：当前项目 id（`null` = lobby 态）。
   *
   * 用于拉用户技能的**生效状态**：「本项目的任务是否会按它写」依赖项目装载清单，
   * 而装载清单是项目级事实。
   */
  projectId?: string | null
}

/** 技能广场。 */
export function SkillMarket(props: SkillMarketProps): ReactElement {
  const { onClose, onActivate, activeSkills = [], onDeactivate, projectId = null } = props
  const [active, setActive] = useState<SkillCategoryId | typeof ALL>(ALL)
  const [view, setView] = useState<MarketView>('discover')
  const [query, setQuery] = useState('')
  const [onlyInactive, setOnlyInactive] = useState(false)
  // CV-071：详情弹窗条目（用户条目带 `userItem` 才能显示生效状态）。
  const [detail, setDetail] = useState<{ entry: SkillCatalogEntry; name: string } | null>(null)
  // CV-332：Host 侧的用户技能列表。
  const [userState, setUserState] = useState<UserSkillsPayload | null>(null)
  const [wizardOpen, setWizardOpen] = useState(false)
  const [dirNotice, setDirNotice] = useState<string | null>(null)
  /** 一次性的动作回执（删除后的「有几个项目还装着它」）。 */
  const [notice, setNotice] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  // CV-332：广场打开期间轮询（关闭即停）。失败静默保持上一拍状态。
  useEffect(() => {
    const controller = new AbortController()
    const pull = async (): Promise<void> => {
      try {
        const payload = await fetchUserSkills(projectId, controller.signal)
        setUserState(payload)
      } catch {
        // 装饰性信息：拉不到就沿用上一拍，不弹错、不标红。
      }
    }
    void pull()
    const timer = setInterval(() => { void pull() }, SKILL_POLL_MS)
    return () => { controller.abort(); clearInterval(timer) }
  }, [projectId, refreshKey])

  const userItems = userState?.items ?? []
  const uploaded = useMemo(() => userItems.map(item => ({ entry: toCatalogEntry(item), item })), [userItems])
  const builtin = useMemo(() => VISIBLE_CATALOG.map(entry => ({ entry, item: null as null })), [])
  /** 发现视图 = 内置 + 我的（混排；用户条目带来源角标）。 */
  const merged = useMemo(() => [...builtin, ...uploaded], [builtin, uploaded])

  const mineLoaded = view === 'loaded'
  const mineUploaded = view === 'uploaded'

  /** 当前视图的基础集合（分类过滤之前）。 */
  const base = useMemo(() => {
    if (mineUploaded) return uploaded
    if (active === ALL) return merged
    return merged.filter(pair => pair.entry.category === active)
  }, [mineUploaded, uploaded, merged, active])

  const entries = useMemo(() => {
    const q = query.trim().toLowerCase()
    return base.filter(({ entry }) => {
      if (entry.hidden === true) return false
      if (q.length > 0
        && !entry.title.toLowerCase().includes(q)
        && !entry.summary.toLowerCase().includes(q)
        && !entry.name.toLowerCase().includes(q)) return false
      if (onlyInactive && !mineLoaded && activeSkills.includes(entry.name)) return false
      return true
    })
  }, [base, query, onlyInactive, mineLoaded, activeSkills])

  /** 分类角标：内置可见条目 + 用户条目一起数（否则用户条目会让计数对不上）。 */
  const counts = useMemo(() => {
    const result = {} as Record<SkillCategoryId, number>
    for (const id of SKILL_CATEGORY_IDS) result[id] = 0
    for (const { entry } of merged) result[entry.category] += 1
    return result
  }, [merged])

  // CV-074：仅「全部 + 无搜索 + 未勾过滤 + 发现视图」时分级呈现精选区，其余场景平铺。
  const splitFeatured = view === 'discover' && active === ALL && query.trim().length === 0 && !onlyInactive
  const featured = splitFeatured ? entries.filter(pair => pair.entry.featured) : []
  const rest = splitFeatured ? entries.filter(pair => !pair.entry.featured) : entries

  // Escape 关闭（覆盖层标准可用性；详情 → 向导 → 广场，逐层退）。
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      if (detail !== null) { setDetail(null); return }
      if (wizardOpen) { setWizardOpen(false); return }
      onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => { window.removeEventListener('keydown', onKeyDown) }
  }, [onClose, detail, wizardOpen])

  /** 删除一条用户技能（移入回收站；如实告知有多少项目装载过它）。 */
  const removeUserSkill = useCallback(async (slug: string, name: string): Promise<void> => {
    const confirmed = window.confirm(
      `把「${name}」移入技能回收站？\n\n`
      + '它不会再出现在模型可用列表里。装载过它的项目不会被自动清理，'
      + 'skill 清单里可能留下一条已失效的项。回收站里的内容可以手工恢复。',
    )
    if (!confirmed) return
    try {
      const result = await deleteUserSkill(slug)
      setRefreshKey(key => key + 1)
      // `loadedByProjects` 由 Host 现算（扫描各项目的 skills.json）。**不自动清理**
      // 那些清单是刻意的：项目清单是项目自己的事实，删除全局技能不等于用户想让某个
      // 项目忘掉它。所以这里必须**如实告知**，让用户自己决定要不要去项目里卸载。
      const count = result.loadedByProjects
      setNotice(
        count === undefined || count === 0
          ? `已把「${name}」移入技能回收站。`
          : `已把「${name}」移入技能回收站。有 ${String(count)} 个项目仍装载着它 ——`
            + '那些项目的技能清单里会留下一条已失效的项，可在各自项目里手动卸载。',
      )
    } catch (cause) {
      setNotice(null)
      window.alert(cause instanceof Error ? cause.message : '删除失败，请稍后重试。')
    }
  }, [])

  const renderGrid = (items: readonly { entry: SkillCatalogEntry; item: UserSkillsPayload['items'][number] | null }[], withSource: boolean): ReactElement => (
    <div className="csSkillGrid">
      {items.map(({ entry, item }) => (
        <SkillCard
          key={entry.name}
          entry={entry}
          onActivate={onActivate}
          onDetail={(target) => { setDetail({ entry: target, name: target.name }) }}
          {...(withSource ? { origin: item === null ? 'builtin' as const : 'user' as const } : {})}
          {...(item === null ? {} : { statusItem: item })}
          {...(item === null || item.slug === null ? {} : { onDelete: () => { void removeUserSkill(item.slug ?? '', item.name) } })}
        />
      ))}
    </div>
  )

  /** 详情弹窗里的生效状态（只有用户条目有）。 */
  const detailItem = detail === null ? null : (userItems.find(item => item.name === detail.name) ?? null)
  const detailEntry = detail?.entry ?? null

  return (
    <div className="csSkillMarket" role="dialog" aria-modal="true" aria-label="技能广场">
      <header className="csSkillMarketBar">
        <button type="button" className="csSkillMarketBack" onClick={onClose}>← 返回</button>
        <h2 className="csSkillMarketTitle">技能广场</h2>
        <span className="csSkillMarketCount">
          {VISIBLE_CATALOG.length} 个官方技能
          {userItems.length > 0 && ` · 我的 ${String(userItems.length)}`}
        </span>
        <span className="csSkillMarketSpacer" />
        {view === 'discover' && (
          <input
            type="search"
            className="csSkillSearch"
            placeholder="搜索 Skill..."
            value={query}
            onChange={event => { setQuery(event.target.value) }}
          />
        )}
        {/* CV-332：原「+ 新建技能（禁用·待接入）」换成真正可用的导入入口。 */}
        <button
          type="button"
          className="csSkillMarketCreate"
          onClick={() => { setWizardOpen(true) }}
        >
          + 导入技能…
        </button>
        <button
          type="button"
          className="csSkillMarketOpenDir"
          onClick={() => { setDirNotice(userState?.skillsRoot ?? '') }}
        >
          打开技能目录
        </button>
      </header>
      {dirNotice !== null && dirNotice !== '' && (
        <div className="csSkillImportDirNotice csSkillMarketDirNotice">
          <span>把文件夹拖进这里也行（改完会被自动发现）：</span>
          <code>{dirNotice}</code>
          <button
            type="button"
            className="csSkillImportCopy"
            onClick={() => { copyTextQuietly(dirNotice) }}
          >
            复制路径
          </button>
          <button type="button" className="csSkillImportCopy" onClick={() => { setDirNotice(null) }}>收起</button>
        </div>
      )}
      {notice !== null && (
        <div className="csSkillImportDirNotice csSkillMarketDirNotice">
          <span>{notice}</span>
          <button type="button" className="csSkillImportCopy" onClick={() => { setNotice(null) }}>知道了</button>
        </div>
      )}
      <div className="csSkillMarketBody">
        <nav className="csSkillRail" aria-label="技能分类">
          {/* CV-073 / CV-332：已装载（项目事实）与我的技能（本机导入）是两个语义。 */}
          {onDeactivate !== undefined && (
            <button
              type="button"
              className={mineLoaded ? 'csSkillRailItem csSkillRailActive' : 'csSkillRailItem'}
              onClick={() => { setView('loaded') }}
            >
              <span>已装载</span>
              <span className="csSkillRailCount">{activeSkills.length}</span>
            </button>
          )}
          <button
            type="button"
            className={mineUploaded ? 'csSkillRailItem csSkillRailActive' : 'csSkillRailItem'}
            onClick={() => { setView('uploaded') }}
          >
            <span>我的技能</span>
            <span className="csSkillRailCount">{userItems.length}</span>
          </button>
          {view === 'discover' && (
            <button
              type="button"
              className={active === ALL ? 'csSkillRailItem csSkillRailActive' : 'csSkillRailItem'}
              onClick={() => { setActive(ALL) }}
            >
              <span>全部</span>
              <span className="csSkillRailCount">{merged.length}</span>
            </button>
          )}
          {view === 'discover' && SKILL_CATEGORY_IDS.filter(id => counts[id] > 0).map(id => (
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
          {mineLoaded ? (
            /* CV-073：已装载 —— 项目 skills.json 清单 + 卸载。 */
            activeSkills.length === 0
              ? <div className="csSkillEmpty">本项目还没有装载任何技能。在「发现」或「我的技能」里点「使用」，work 态会同步装载。</div>
              : (
                <div className="csSkillMine">
                  {activeSkills.map((name) => {
                    // 内置查编译期 catalog；用户 skill 不在那里，回落到运行时列表 ——
                    // 否则用户装载自己的技能时，这一行只显示一个裸注册名（看起来像坏数据）。
                    const entry = getSkillEntry(name)
                    const mine = userItems.find(item => item.name === name)
                    return (
                      <div className="csSkillMineRow" key={name}>
                        <SkillIcon id={entry?.icon ?? mine?.icon ?? 'puzzle'} size={18} />
                        <span className="csSkillMineTitle">{entry?.title ?? mine?.title ?? name}</span>
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
              {mineUploaded && userState?.complete === false && (
                <p className="csSkillImportNote">技能目录正在刷新（通常不到一秒）…</p>
              )}
              {view === 'discover' && (
                <label className="csSkillOnlyInactive">
                  <input
                    type="checkbox"
                    checked={onlyInactive}
                    onChange={event => { setOnlyInactive(event.target.checked) }}
                  />
                  仅显示未装载
                </label>
              )}
              {entries.length === 0 ? (
                mineUploaded
                  ? (
                    <div className="csSkillEmpty">
                      还没有导入任何技能。点右上角「导入技能…」选一个含 <code>SKILL.md</code> 的文件夹，
                      或选一个 .md 文件即可。
                    </div>
                  )
                  : <div className="csSkillEmpty">没有匹配的技能，换个关键词试试。</div>
              ) : splitFeatured ? (
                <>
                  {featured.length > 0 && (
                    <>
                      <h3 className="csSkillSectionTitle">官方精选</h3>
                      {renderGrid(featured, true)}
                    </>
                  )}
                  {rest.length > 0 && (
                    <>
                      <h3 className="csSkillSectionTitle">其他技能 · {rest.length}</h3>
                      {renderGrid(rest, true)}
                    </>
                  )}
                  {renderCommunityCta(() => { setWizardOpen(true) })}
                </>
              ) : (
                <>
                  {/* 混排视图才打来源角标；「我的技能」分组内不打（分组已表明来源）。 */}
                  {renderGrid(entries, view === 'discover')}
                  {renderCommunityCta(() => { setWizardOpen(true) })}
                </>
              )}
            </>
          )}
        </div>
      </div>

      {/* CV-332：导入向导（覆盖在广场之上；Escape 先关它）。 */}
      {wizardOpen && (
        <SkillImportWizard
          onClose={() => { setWizardOpen(false) }}
          onImported={() => { setRefreshKey(key => key + 1) }}
          skillsRoot={userState?.skillsRoot ?? ''}
        />
      )}

      {/* CV-071：技能详情弹窗（Escape 先关弹窗再关广场）。 */}
      {detailEntry !== null && (
        <div className="csSkillDetailBackdrop" onClick={() => { setDetail(null) }}>
          <div
            className="csSkillDetail"
            role="dialog"
            aria-modal="true"
            aria-label={detailEntry.title}
            onClick={event => { event.stopPropagation() }}
          >
            <div className="csSkillDetailThumb" style={{ background: `linear-gradient(135deg, hsl(${detailEntry.hue} 70% 56%), hsl(${(detailEntry.hue + 42) % 360} 62% 42%))` }}>
              {detailEntry.demo !== undefined ? (
                <img
                  className="csSkillDetailThumbGif"
                  src={`/canvas-studio/style-demos/${detailEntry.demo}`}
                  alt=""
                  draggable={false}
                />
              ) : (
                <SkillIcon id={detailEntry.icon} size={30} />
              )}
            </div>
            <div className="csSkillDetailBody">
              <h3 className="csSkillDetailTitle">
                {detailEntry.title}
                {detailEntry.h3 === true && <span className="csSkillH3">H3</span>}
                {detailEntry.stage === 'preview' && <span className="csSkillPreviewBadge" title="试跑期技能：功能可用，尚未转正">试跑</span>}
                {detailItem !== null && <span className="csSkillSource csSkillSourceMine">我的</span>}
              </h3>
              <span className="csSkillDetailCategory">{SKILL_CATEGORY_LABELS[detailEntry.category]}</span>
              <p className="csSkillDetailSummary">{detailEntry.summary}</p>
              <code className="csSkillDetailName">{detailEntry.name}</code>
              {/* CV-332：「我传了为什么没用」的答案就在这里。 */}
              {detailItem !== null && <SkillStatusBadge item={detailItem} />}
              <div className="csSkillDetailActions">
                <button type="button" className="csSkillDetailUse" onClick={() => { onActivate(detailEntry) }}>
                  使用该技能
                </button>
                {detailItem !== null && detailItem.slug !== null && (
                  <button
                    type="button"
                    className="csSkillDetailDelete"
                    onClick={() => { void removeUserSkill(detailItem.slug ?? '', detailItem.name) }}
                  >
                    删除
                  </button>
                )}
                <button type="button" className="csSkillDetailClose" onClick={() => { setDetail(null) }}>关闭</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * 创作者社区收尾卡（CR-043：整区只渲染一次）。
 *
 * CV-332：文案从「按目录规范投放你的技能（规划中）· 待接入」改成**真入口** ——
 * 原来那个「待接入」角标已经不成立了（导入功能已落地）。
 */
function renderCommunityCta(onImport: () => void): ReactElement {
  return (
    <div className="csSkillCommunity">
      <span className="csSkillCommunityIcon">✦</span>
      <h3>把你自己的规范带进来</h3>
      <p>写一份 <code>SKILL.md</code>，导入后它会进入模型可用列表；装载进项目即可参与创作。</p>
      <button type="button" className="csSkillCommunityAction" onClick={onImport}>导入技能…</button>
    </div>
  )
}
