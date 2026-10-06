/**
 * REQ-001：全局资产库全屏页（角色 / 场景 / 物件 / 群像 + @引用）。
 *
 * 形态照 `.csSkillMarket`（fixed overlay + 左分类侧栏 + 右卡片网格，CV-065 同款），
 * 详情抽屉照 `HistoryDrawer` 的右侧浮层语义（方案 §4.3 / §8-M）。数据源 =
 * store 的 `libraryAssets` 缓存（`refreshLibrary()` 拉取；由父组件在打开时刷新），
 * 本组件不直接 fetch —— 写操作全部走注入回调（Host 单一入口，方案 §3.2）。
 *
 * 首期范围（用户 2026-09-28 拍板）：
 *  - 不做「纯手工新建」；入口只有两条：画布节点右键「加入资产库」（F1，
 *    `LibImportDialog` 的 anchors 模式）与本页「上传图片」（同对话框的 upload
 *    模式：建条目 + octet-stream 传字节，上传失败回滚刚建的空条目）；
 *  - 「编辑」仅元数据（名称/分类/别名/描述/标签/锁定提示词），媒体不可改；
 *  - 删除二次确认：usage 非空时提示被引用处数量（方案 F4）。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import type { LibCategory, LibraryAsset, LibraryCreateRequest, LibraryUpdateRequest } from '../contracts/asset-library.js'
import { LIB_CATEGORIES, LIB_CATEGORY_LABELS, libraryMediaUrl } from '../contracts/asset-library.js'

/** 四分类色点（方案 §5.2：低饱和辅助识别色，取自 styles.ts 现有强调色系）。 */
const CATEGORY_COLORS: Readonly<Record<LibCategory, string>> = {
  character: '#35C2A6',
  scene: '#4D9FFF',
  prop: '#F5A742',
  group: '#9C6CFF',
}

/** 侧栏「全部」的伪分类 id。 */
const ALL = 'all'

type LibSort = 'recent' | 'usage'

/** 封面媒体：coverFile 优先，缺省 media[0]（Host 契约同语义）。 */
function coverOf(asset: LibraryAsset): { file: string; kind: string } | null {
  const file = asset.coverFile ?? asset.media[0]?.file
  if (file === undefined) return null
  const kind = asset.media.find(entry => entry.file === file)?.kind ?? 'image'
  return { file, kind }
}

/** 名称前两字（无媒体条目的占位封面用）。 */
function nameGlyph(name: string): string {
  return [...name.replace(/[\s·]/g, '')].slice(0, 2).join('')
}

function formatDate(ms: number): string {
  const date = new Date(ms)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export interface AssetLibraryPageProps {
  /** 库清单（父组件从 store 订阅后传入；本组件不重复建订阅）。 */
  assets: readonly LibraryAsset[]
  onClose(): void
  /** 新建条目（upload 模式：先建元数据条目再传媒体）。 */
  createLibraryAsset(request: LibraryCreateRequest): Promise<LibraryAsset>
  updateLibraryAsset(id: string, request: LibraryUpdateRequest): Promise<LibraryAsset>
  deleteLibraryAsset(id: string): Promise<void>
  uploadLibraryMedia(id: string, file: File, label?: string): Promise<LibraryAsset>
  /** 插真引用 chip（false = 无会话 / 管线不可用，调用方给出提示）。 */
  insertLibChip(assetId: string): boolean
  /**
   * REQ-028：把条目暂存为首页「参考内容」（取回媒体文件 → File → 既有暂存链路）。
   *
   * 只在 lobby（无项目）由调用方传入 —— work 态的复用出口是「引用到对话」真 chip。
   * 未传时详情抽屉不渲染该按钮（与 LobbyHero 旧入口「未接回调不渲染」同一纪律）。
   */
  onStashAsset?(asset: LibraryAsset): void
}

/** 全局资产库全屏页：左分类侧栏 + 卡片网格 + 右详情抽屉。 */
export function AssetLibraryPage(props: AssetLibraryPageProps): ReactElement {
  const { assets, onClose, createLibraryAsset, updateLibraryAsset, deleteLibraryAsset, uploadLibraryMedia, insertLibChip, onStashAsset } = props
  const [category, setCategory] = useState<LibCategory | typeof ALL>(ALL)
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<LibSort>('recent')
  const [detailId, setDetailId] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [uploadOpen, setUploadOpen] = useState(false)

  // Escape 分层退出：编辑 → 确认 → 抽屉 → 整页（与 SkillMarket detail 同款）。
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      if (uploadOpen) { setUploadOpen(false); return }
      if (editing) { setEditing(false); return }
      if (confirmDelete) { setConfirmDelete(false); return }
      if (detailId !== null) { setDetailId(null); return }
      onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => { window.removeEventListener('keydown', onKeyDown) }
  }, [onClose, uploadOpen, editing, confirmDelete, detailId])

  const counts = useMemo(() => {
    const map = new Map<LibCategory, number>()
    for (const asset of assets) map.set(asset.category, (map.get(asset.category) ?? 0) + 1)
    return map
  }, [assets])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = assets.filter((asset) => {
      if (category !== ALL && asset.category !== category) return false
      if (q.length === 0) return true
      const haystack = `${asset.name}${asset.aliases.join('')}${asset.tags.join('')}${asset.description}`.toLowerCase()
      return haystack.includes(q)
    })
    if (sort === 'usage') return [...list].sort((left, right) => right.usage.length - left.usage.length)
    // recent：Host list 已按 updatedAt 倒序，这里只保序（重排会破坏跨字段稳定性）。
    return list
  }, [assets, category, query, sort])

  const detail = useMemo(
    () => (detailId === null ? null : assets.find(asset => asset.id === detailId) ?? null),
    [assets, detailId],
  )

  const handleDelete = async (asset: LibraryAsset): Promise<void> => {
    setError(null)
    try {
      await deleteLibraryAsset(asset.id)
      setDetailId(null)
      setConfirmDelete(false)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '删除失败')
    }
  }

  const handleReference = (asset: LibraryAsset): void => {
    setNotice(null)
    if (insertLibChip(asset.id)) {
      setNotice(`已把「${asset.name}」作为引用 chip 插入对话输入框。`)
    } else {
      setNotice('当前没有可写入的对话输入框（先打开一个项目会话再引用）。')
    }
  }

  const handleUpload = async (request: LibraryCreateRequest, file: File): Promise<void> => {
    setError(null)
    // 两段式：建元数据条目 → octet-stream 传字节；上传失败回滚刚建的空条目，
    // 不留「媒体悬空」的半成品（与 Host create 的目录回滚同纪律）。
    const asset = await createLibraryAsset(request)
    try {
      await uploadLibraryMedia(asset.id, file)
      setUploadOpen(false)
    } catch (cause) {
      await deleteLibraryAsset(asset.id).catch(() => {})
      throw cause
    }
  }

  return (
    <div className="csLibOverlay" role="dialog" aria-modal="true" aria-label="资产库">
      <header className="csLibBar">
        <button type="button" className="csSkillMarketBack" onClick={onClose}>← 返回</button>
        <h2 className="csSkillMarketTitle">资产库</h2>
        <span className="csSkillMarketCount">{assets.length} 个资产 · 跨项目共用</span>
        <span className="csSkillMarketSpacer" />
        <input
          type="search"
          className="csSkillSearch"
          placeholder="搜索名称 / 别名 / 标签…"
          value={query}
          onChange={event => { setQuery(event.target.value) }}
        />
        <button type="button" className="csLibPrimary" onClick={() => { setError(null); setUploadOpen(true) }}>
          + 上传图片
        </button>
      </header>
      <div className="csSkillMarketBody">
        <nav className="csSkillRail" aria-label="资产分类">
          <button
            type="button"
            className={category === ALL ? 'csSkillRailItem csSkillRailActive' : 'csSkillRailItem'}
            onClick={() => { setCategory(ALL) }}
          >
            <span>全部资产</span>
            <span className="csSkillRailCount">{assets.length}</span>
          </button>
          {LIB_CATEGORIES.map(id => (
            <button
              key={id}
              type="button"
              className={category === id ? 'csSkillRailItem csSkillRailActive' : 'csSkillRailItem'}
              onClick={() => { setCategory(id) }}
            >
              <span className="csLibCatDot" style={{ background: CATEGORY_COLORS[id] }} />
              <span>{LIB_CATEGORY_LABELS[id]}</span>
              <span className="csSkillRailCount">{counts.get(id) ?? 0}</span>
            </button>
          ))}
          <p className="csLibRailHint">在画布节点右键「加入资产库」，或点右上角上传图片。</p>
        </nav>
        <div className="csLibContent">
          <div className="csLibFilterRow">
            <button
              type="button"
              className={sort === 'recent' ? 'csLibSortChip csLibSortActive' : 'csLibSortChip'}
              onClick={() => { setSort('recent') }}
            >
              最近更新
            </button>
            <button
              type="button"
              className={sort === 'usage' ? 'csLibSortChip csLibSortActive' : 'csLibSortChip'}
              onClick={() => { setSort('usage') }}
            >
              被引用最多
            </button>
            <span className="csSkillMarketCount">{shown.length} 条结果</span>
          </div>
          {shown.length === 0 ? (
            <div className="csLibEmpty">
              <span className="csLibEmptyIcon">🗂</span>
              <p>{query.trim().length > 0 ? '无匹配资产，试试别名或标签' : category === ALL ? '还没有资产' : '该分类暂无资产'}</p>
              <span className="csLibEmptySub">在画布节点右键「加入资产库」，或点右上角「+ 上传图片」</span>
            </div>
          ) : (
            <div className="csLibGrid">
              {shown.map(asset => (
                <AssetCard key={asset.id} asset={asset} onOpen={() => { setDetailId(asset.id); setEditing(false); setConfirmDelete(false); setError(null); setNotice(null) }} />
              ))}
            </div>
          )}
        </div>
        {detail !== null && (
          <DetailDrawer
            asset={detail}
            editing={editing}
            confirmDelete={confirmDelete}
            error={error}
            notice={notice}
            onStartEdit={() => { setEditing(true); setError(null) }}
            onCancelEdit={() => { setEditing(false) }}
            onSaveEdit={async (request) => {
              setError(null)
              try {
                await updateLibraryAsset(detail.id, request)
                setEditing(false)
              } catch (cause) {
                setError(cause instanceof Error ? cause.message : '保存失败')
              }
            }}
            onAskDelete={() => { setConfirmDelete(true) }}
            onCancelDelete={() => { setConfirmDelete(false) }}
            onConfirmDelete={() => { void handleDelete(detail) }}
            onReference={() => { handleReference(detail) }}
            {...(onStashAsset !== undefined ? { onStashAsset } : {})}
            onClose={() => { setDetailId(null); setEditing(false); setConfirmDelete(false); setError(null); setNotice(null) }}
          />
        )}
      </div>
      {uploadOpen && (
        <LibImportDialog
          title="上传图片到资产库"
          requireFile
          onCancel={() => { setUploadOpen(false) }}
          onSubmit={async (request, file) => {
            // 两段式在 handleUpload 内完成（失败回滚空条目）；throw 冒回对话框显示。
            if (file === null) return
            await handleUpload(request, file)
            setUploadOpen(false)
          }}
        />
      )}
    </div>
  )
}

/** 卡片：封面 + 名称 + 分类 pill + 引用数。 */
function AssetCard(props: { asset: LibraryAsset; onOpen(): void }): ReactElement {
  const { asset, onOpen } = props
  const cover = coverOf(asset)
  const url = cover !== null ? libraryMediaUrl(asset.id, cover.file) : ''
  return (
    <button type="button" className="csLibCard" onClick={onOpen} title={`${LIB_CATEGORY_LABELS[asset.category]} · ${asset.name}`}>
      <span className="csLibCover">
        {cover === null ? (
          <span className="csLibCoverGlyph" style={{ background: `color-mix(in srgb, ${CATEGORY_COLORS[asset.category]} 26%, transparent)` }}>{nameGlyph(asset.name)}</span>
        ) : cover.kind === 'video' ? (
          <video src={url} preload="metadata" muted />
        ) : cover.kind === 'audio' ? (
          <span className="csLibCoverGlyph" style={{ background: `color-mix(in srgb, ${CATEGORY_COLORS[asset.category]} 26%, transparent)` }}>♪</span>
        ) : (
          <img src={url} alt={asset.name} loading="lazy" />
        )}
        <span className="csLibCoverBadge">{asset.media.length} 图{asset.anchors.length > 0 ? ` · ${asset.anchors.length} 锚点` : ''}</span>
      </span>
      <span className="csLibCardMeta">
        <span className="csLibCardName">
          <span className="csLibCatDot" style={{ background: CATEGORY_COLORS[asset.category] }} />
          {asset.name}
        </span>
        <span className="csLibCardSub">{LIB_CATEGORY_LABELS[asset.category]} · 被引用 {asset.usage.length} 次{asset.description.length > 0 ? ` · ${asset.description}` : ''}</span>
      </span>
    </button>
  )
}

/** 详情抽屉（右侧浮层，照 HistoryDrawer 的浮层语义）。 */
interface DetailDrawerProps {
  asset: LibraryAsset
  editing: boolean
  confirmDelete: boolean
  error: string | null
  notice: string | null
  onStartEdit(): void
  onCancelEdit(): void
  onSaveEdit(request: LibraryUpdateRequest): Promise<void>
  onAskDelete(): void
  onCancelDelete(): void
  onConfirmDelete(): void
  onReference(): void
  /** REQ-028：lobby 态才有（见 AssetLibraryPageProps.onStashAsset）；未传不渲染按钮。 */
  onStashAsset?(asset: LibraryAsset): void
  onClose(): void
}

function DetailDrawer(props: DetailDrawerProps): ReactElement {
  const { asset, editing, confirmDelete, error, notice, onStartEdit, onCancelEdit, onSaveEdit, onAskDelete, onCancelDelete, onConfirmDelete, onReference, onStashAsset, onClose } = props
  const [viewIndex, setViewIndex] = useState(0)
  // 切换详情对象时回到第一张图（受控索引不能跨资产残留）。
  useEffect(() => { setViewIndex(0) }, [asset.id])
  // 编辑表单字段（首帧从资产派生；编辑中不随外部刷新重置——保存成功即退出编辑）。
  const [form, setForm] = useState(() => formOf(asset))
  const startEditRef = useRef(asset.id)
  useEffect(() => {
    if (startEditRef.current !== asset.id) {
      startEditRef.current = asset.id
      setForm(formOf(asset))
    }
  }, [asset])
  const startEdit = (): void => { setForm(formOf(asset)); onStartEdit() }

  if (editing) {
    return (
      <aside className="csLibDrawer">
        <div className="csLibDrawerHead">
          <span>编辑资产</span>
          <button type="button" className="csHistClose" onClick={onClose} aria-label="关闭详情">✕</button>
        </div>
        <div className="csLibDrawerBody">
          <label className="csLibField">
            <span className="csLibFieldLabel">分类</span>
            <span className="csLibCategoryRow">
              {LIB_CATEGORIES.map(id => (
                <button
                  key={id}
                  type="button"
                  className={form.category === id ? 'csLibSortChip csLibSortActive' : 'csLibSortChip'}
                  onClick={() => { setForm({ ...form, category: id }) }}
                >
                  {LIB_CATEGORY_LABELS[id]}
                </button>
              ))}
            </span>
          </label>
          <label className="csLibField">
            <span className="csLibFieldLabel">名称</span>
            <input className="csLibInput" value={form.name} maxLength={80} onChange={event => { setForm({ ...form, name: event.target.value }) }} />
          </label>
          <label className="csLibField">
            <span className="csLibFieldLabel">别名（逗号分隔）</span>
            <input className="csLibInput" value={form.aliases} onChange={event => { setForm({ ...form, aliases: event.target.value }) }} />
          </label>
          <label className="csLibField">
            <span className="csLibFieldLabel">描述</span>
            <textarea className="csLibInput csLibTextarea" rows={3} value={form.description} onChange={event => { setForm({ ...form, description: event.target.value }) }} />
          </label>
          <label className="csLibField">
            <span className="csLibFieldLabel">标签（逗号分隔）</span>
            <input className="csLibInput" value={form.tags} onChange={event => { setForm({ ...form, tags: event.target.value }) }} />
          </label>
          <label className="csLibField">
            <span className="csLibFieldLabel">锁定提示词（SAME 块，可空）</span>
            <textarea className="csLibInput csLibTextarea" rows={3} value={form.lockedPrompt} onChange={event => { setForm({ ...form, lockedPrompt: event.target.value }) }} />
          </label>
          {error !== null && <p className="csHistError">{error}</p>}
        </div>
        <div className="csLibDrawerActs">
          <button type="button" className="csLibPrimary" onClick={() => { void onSaveEdit(requestOf(form)) }}>保存</button>
          <button type="button" className="csSkillMarketBack" onClick={onCancelEdit}>取消</button>
        </div>
      </aside>
    )
  }

  const media = asset.media[viewIndex]
  const url = media !== undefined ? libraryMediaUrl(asset.id, media.file) : ''
  const cover = coverOf(asset)
  return (
    <aside className="csLibDrawer">
      <div className="csLibDrawerHead">
        <span>资产详情</span>
        <button type="button" className="csHistClose" onClick={onClose} aria-label="关闭详情">✕</button>
      </div>
      <div className="csLibDrawerBody">
        {media === undefined ? (
          <div className="csLibPreview csLibCoverGlyph" style={{ background: `color-mix(in srgb, ${CATEGORY_COLORS[asset.category]} 26%, transparent)` }}>{nameGlyph(asset.name)}</div>
        ) : media.kind === 'video' ? (
          <video className="csLibPreview" src={url} controls preload="metadata" muted />
        ) : media.kind === 'audio' ? (
          <div className="csLibPreview csLibCoverGlyph" style={{ background: `color-mix(in srgb, ${CATEGORY_COLORS[asset.category]} 26%, transparent)` }}>♪<audio src={url} controls /></div>
        ) : (
          <img className="csLibPreview" src={url} alt={asset.name} />
        )}
        {asset.media.length > 1 && cover !== null && (
          <div className="csLibThumbs">
            {asset.media.map((entry, index) => (
              <button
                key={entry.file}
                type="button"
                className={index === viewIndex ? 'csLibThumb csLibThumbOn' : 'csLibThumb'}
                onClick={() => { setViewIndex(index) }}
              >
                {index + 1}
              </button>
            ))}
          </div>
        )}
        <h3 className="csLibDrawerTitle">
          <span className="csLibCatDot" style={{ background: CATEGORY_COLORS[asset.category] }} />
          {asset.name}
          <span className="csLibPill" style={{ color: CATEGORY_COLORS[asset.category], borderColor: CATEGORY_COLORS[asset.category] }}>{LIB_CATEGORY_LABELS[asset.category]}</span>
        </h3>
        <div className="csLibRow"><b>别名</b><span>{asset.aliases.length > 0 ? asset.aliases.join('、') : '—'}</span></div>
        <div className="csLibRow"><b>描述</b><span>{asset.description.length > 0 ? asset.description : '—'}</span></div>
        <div className="csLibRow"><b>标签</b><span>{asset.tags.length > 0 ? asset.tags.map(tag => `#${tag}`).join(' ') : '—'}</span></div>
        <div className="csLibRow"><b>来源</b><span>{asset.anchors.length > 0 ? `${asset.anchors.length} 个画布锚点` : '上传导入'} · {formatDate(asset.createdAt)}</span></div>
        <div className="csLibRow"><b>引用</b><span>{asset.usage.length > 0 ? `被 ${asset.usage.length} 处使用` : '暂无引用'}</span></div>
        <div className="csLibRow"><b>句柄</b><code className="csLibHandle">@ref[lib:{asset.id}]</code></div>
        {asset.lockedPrompt.length > 0 && <p className="csLibLocked">{asset.lockedPrompt}</p>}
        {notice !== null && <p className="csLibNotice">{notice}</p>}
        {error !== null && <p className="csHistError">{error}</p>}
      </div>
      <div className="csLibDrawerActs">
        {confirmDelete ? (
          <>
            <span className="csLibConfirmText">删除后{asset.usage.length > 0 ? ` ${asset.usage.length} 处引用` : ''}将失效，确认？</span>
            <button type="button" className="csLibDanger" onClick={onConfirmDelete}>确认删除</button>
            <button type="button" className="csSkillMarketBack" onClick={onCancelDelete}>取消</button>
          </>
        ) : (
          <>
            {/* REQ-028：两个出口**按态二选一**，不并存（验收反馈：首页从资产库
                引入的资源曾以「引用 chip」落在输入框正文里，读作一条蓝色名字
                链接，与本地文件导入的缩略图通道不一致）。首页（onStashAsset
                在场）只给「暂存为参考内容」—— 发送第一句话时落画布，与本地
                文件同一通道；「引用到对话」退回项目态专属（真引用 chip 的
                正路）。 */}
            {onStashAsset !== undefined ? (
              <button type="button" className="csLibPrimary" onClick={() => { onStashAsset(asset) }}>暂存为参考内容</button>
            ) : (
              <button type="button" className="csLibPrimary" onClick={onReference}>引用到对话</button>
            )}
            <button type="button" className="csSkillMarketBack" onClick={startEdit}>编辑</button>
            <button type="button" className="csLibDangerGhost" onClick={onAskDelete}>删除</button>
          </>
        )}
      </div>
    </aside>
  )
}

/** 编辑表单的本地形状（数组转逗号串，提交时再拆回）。 */
interface LibFormState {
  category: LibCategory
  name: string
  aliases: string
  description: string
  tags: string
  lockedPrompt: string
}

function formOf(asset: LibraryAsset): LibFormState {
  return {
    category: asset.category,
    name: asset.name,
    aliases: asset.aliases.join('、'),
    description: asset.description,
    tags: asset.tags.join('、'),
    lockedPrompt: asset.lockedPrompt,
  }
}

/** 逗号/顿号分隔串 → 数组（trim + 去空 + 去重，与 Host cleanEntries 同语义）。 */
function splitEntries(value: string): string[] {
  return [...new Set(value.split(/[,，、]/).map(entry => entry.trim()).filter(entry => entry.length > 0))]
}

function requestOf(form: LibFormState): LibraryUpdateRequest {
  return {
    category: form.category,
    name: form.name,
    aliases: splitEntries(form.aliases),
    description: form.description,
    tags: splitEntries(form.tags),
    lockedPrompt: form.lockedPrompt,
  }
}

export interface LibImportDialogProps {
  title: string
  /** true = 必须选文件（上传模式）；false = 画布入库（媒体由 Host 按锚点拷入）。 */
  requireFile: boolean
  onCancel(): void
  /**
   * 提交（异步）：失败 throw 回对话框本地显示（不打全局错误面）；成功返回后
   * 对话框自动关闭。file 在 requireFile 模式下必有（submit 前已校验）。
   */
  onSubmit(request: LibraryCreateRequest, file: File | null): Promise<void>
}

/**
 * 入库表单（画布入库 / 上传图片两模式共用）：分类四选一 + 名称/别名/描述。
 * 校验在前端做齐（名称非空、上传模式必选文件），Host 侧仍全量复核。
 */
export function LibImportDialog(props: LibImportDialogProps): ReactElement {
  const { title, requireFile, onCancel, onSubmit } = props
  const [category, setCategory] = useState<LibCategory>('character')
  const [name, setName] = useState('')
  const [aliases, setAliases] = useState('')
  const [description, setDescription] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  // 上传预览（用户 2026-09-28）：选图后本地预览缩略图，上传前即可确认比例。
  // objectURL 生命周期跟 file 走 —— 换图/卸载时 revoke，防内存泄漏。
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  useEffect(() => {
    if (file === null || !file.type.startsWith('image/')) { setPreviewUrl(null); return }
    const url = URL.createObjectURL(file)
    setPreviewUrl(url)
    return () => { URL.revokeObjectURL(url) }
  }, [file])

  const submit = (): void => {
    if (busy) return
    const trimmed = name.trim()
    if (trimmed.length === 0) { setError('请填写资产名称'); return }
    if (requireFile && file === null) { setError('请选择要上传的图片'); return }
    setBusy(true)
    setError(null)
    onSubmit({
      category,
      name: trimmed,
      aliases: splitEntries(aliases),
      description: description.trim(),
    }, file)
      .then(() => { onCancel() })
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : '入库失败')
      })
      .finally(() => { setBusy(false) })
  }

  return (
    <div className="csLibDialogBackdrop" onClick={busy ? undefined : onCancel}>
      <div className="csLibDialog" role="dialog" aria-modal="true" aria-label={title} onClick={event => { event.stopPropagation() }}>
        <h3 className="csLibDialogTitle">{title}</h3>
        <label className="csLibField">
          <span className="csLibFieldLabel">分类</span>
          <span className="csLibCategoryRow">
            {LIB_CATEGORIES.map(id => (
              <button
                key={id}
                type="button"
                className={category === id ? 'csLibSortChip csLibSortActive' : 'csLibSortChip'}
                onClick={() => { setCategory(id) }}
              >
                <span className="csLibCatDot" style={{ background: CATEGORY_COLORS[id] }} />
                {LIB_CATEGORY_LABELS[id]}
              </button>
            ))}
          </span>
        </label>
        <label className="csLibField">
          <span className="csLibFieldLabel">名称</span>
          <input className="csLibInput" value={name} maxLength={80} placeholder="如：女主 Luna" onChange={event => { setName(event.target.value) }} />
        </label>
        <label className="csLibField">
          <span className="csLibFieldLabel">别名（逗号分隔，可空）</span>
          <input className="csLibInput" value={aliases} placeholder="女主、Luna" onChange={event => { setAliases(event.target.value) }} />
        </label>
        <label className="csLibField">
          <span className="csLibFieldLabel">描述（自然语言引用靠它匹配，可空）</span>
          <textarea className="csLibInput csLibTextarea" rows={2} value={description} onChange={event => { setDescription(event.target.value) }} />
        </label>
        {requireFile && (
          <div className="csLibField">
            <span className="csLibFieldLabel">图片</span>
            {previewUrl !== null && <img className="csLibUploadPreview" src={previewUrl} alt="待上传预览" />}
            <button type="button" className="csSkillMarketBack" onClick={() => { fileInputRef.current?.click() }}>
              {file === null ? '选择图片…' : file.name}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              style={{ display: 'none' }}
              onChange={(event) => {
                const picked = event.target.files?.[0]
                if (picked !== undefined) { setFile(picked); setError(null) }
                event.target.value = ''
              }}
            />
          </div>
        )}
        {error !== null && <p className="csHistError">{error}</p>}
        <div className="csLibDrawerActs">
          <button type="button" className="csLibPrimary" disabled={busy} onClick={submit}>{busy ? '提交中…' : '入库'}</button>
          <button type="button" className="csSkillMarketBack" disabled={busy} onClick={onCancel}>取消</button>
        </div>
      </div>
    </div>
  )
}
