/**
 * CV-246 / BUG-006：生成历史抽屉（画布右侧滑出浮层）。
 *
 * 展示本项目全部生成产物（Host 在每个落盘点记账，见 asset-history.ts），含已从
 * 画布移除的——这正是本面板的存在意义：产物在画布上的线索断了之后，这里仍可
 * 回溯。首期只展示图 / 视频（音频与文件已记账，tab 过滤即可放开）。
 *
 * 状态徽章由**客户端对照画布节点派生**（Host 不落库这个易变事实）：
 *   - 已挂画布：存在引用节点且非失效；
 *   - 已被取代：唯一引用节点 retired / supersededBy；
 *   - 未挂画布：画布无引用（文件可能仍在根目录，也可能已被节点删除流程移入 .trash——
 *     资产路由的 .trash fallback（CV-243）保证缩略仍可加载）。
 *
 * 删除 = 两段式（与 CV-243 同语义）：仍被画布引用 → 409 拒绝；否则移入 .trash +
 * 标记 deletedAt，物理清交给打开项目 GC。未删条目受 GC 保护（不会被自动清掉）。
 *
 * CV-246a（真机反馈三连）：
 *   1. 预览不再 `window.open`（资产路由的 loopback authority 会 403，且跳出 app）——
 *      已挂画布 → 「定位」：选中节点 + 打开详情抽屉（与双击素材完全同一条入口）
 *      + 画布居中；未挂画布 → app 内 lightbox 弹层预览；
 *   2. 点击卡片主体 = 定位 / 预览（同上分流）；
 *   3. 自动刷新：监听画布 url 集合签名（拖动不改 url ⇒ 不重拉；生成完成 / 上传 /
 *      删除节点都改变 url 集合 ⇒ 立即重拉），打开时也拉一次。
 */
import { useEffect, useMemo, useState } from 'react'
import type { StudioCanvasNode } from '../../contracts/canvas.js'
import { deleteStudioAssetHistory, getStudioAssetHistory } from '../api.js'
import type { AssetHistoryEntry } from '../api.js'

export interface HistoryDrawerProps {
  projectId: string
  /** 当前画布节点表（状态徽章派生 + 自动刷新签名；画布变化时由父组件传入最新引用）。 */
  nodes: readonly StudioCanvasNode[]
  onClose(): void
  /**
   * CV-246a：定位到引用节点（选中 + 打开详情抽屉 + 画布居中）。
   * 由 StudioFrame 实现——详情面板的打开判据（detailNodeId）住在那里。
   */
  onLocate(nodeId: string): void
}

type HistFilter = 'all' | 'image' | 'video'

type HistState = 'canvas' | 'retired' | 'orphan'

const STATE_TEXT: Record<HistState, string> = {
  canvas: '已挂画布',
  retired: '已被取代',
  orphan: '未挂画布',
}

function formatWhen(ms: number): string {
  const date = new Date(ms)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function formatSize(bytes: number | undefined): string {
  if (bytes === undefined || !(bytes > 0)) return ''
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}

export function HistoryDrawer({ projectId, nodes, onClose, onLocate }: HistoryDrawerProps) {
  const [entries, setEntries] = useState<AssetHistoryEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<HistFilter>('all')
  const [confirmFile, setConfirmFile] = useState<string | null>(null)
  const [previewFile, setPreviewFile] = useState<AssetHistoryEntry | null>(null)

  // CV-246a：画布 url 集合签名——生成完成 / 上传 / 删除节点都会改变它，抽屉自动
  // 重拉；拖动节点不改 url，不会造成无谓刷新。
  const urlSignature = useMemo(
    () => nodes.map((node) => node.url ?? '').join('|'),
    [nodes],
  )

  useEffect(() => {
    const controller = new AbortController()
    getStudioAssetHistory(projectId, controller.signal)
      .then((result) => { setEntries(result.entries); setError(null) })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return
        setError(cause instanceof Error ? cause.message : '历史读取失败')
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [projectId, urlSignature])

  /** url basename → 节点表（状态派生：同一文件可能被粘贴复制出多个节点）。 */
  const refNodesByFile = useMemo(() => {
    const map = new Map<string, StudioCanvasNode[]>()
    for (const node of nodes) {
      if (node.url === undefined) continue
      const file = node.url.split('/').pop() ?? ''
      if (file.length === 0) continue
      const list = map.get(file)
      if (list !== undefined) list.push(node)
      else map.set(file, [node])
    }
    return map
  }, [nodes])

  const stateOf = (entry: AssetHistoryEntry): HistState => {
    const refs = refNodesByFile.get(entry.file)
    if (refs === undefined || refs.length === 0) return 'orphan'
    const active = refs.some((node) => node.retired !== true && node.supersededBy === undefined)
    return active ? 'canvas' : 'retired'
  }

  /**
   * 卡片主体 / 「定位」动作：优先挑**活跃**引用节点中最新创建的（粘贴副本与
   * 重试旧版都在场时，用户要看的是最新的那个）；全是失效节点则取最新失效节点。
   */
  const locateOf = (entry: AssetHistoryEntry): string | null => {
    const refs = refNodesByFile.get(entry.file)
    if (refs === undefined || refs.length === 0) return null
    const sorted = [...refs].sort((left, right) => left.createdAt - right.createdAt)
    const active = sorted.find((node) => node.retired !== true && node.supersededBy === undefined)
    const chosen = active ?? sorted[sorted.length - 1]
    return chosen?.id ?? null
  }

  const shown = entries.filter((entry) => entry.deletedAt === undefined)
    .filter((entry) => filter === 'all' || entry.kind === filter)
    .sort((left, right) => right.createdAt - left.createdAt)

  const handleDelete = async (file: string) => {
    setError(null)
    try {
      await deleteStudioAssetHistory(projectId, file)
      setEntries((previous) => previous.map((entry) => (
        entry.file === file ? { ...entry, deletedAt: Date.now() } : entry
      )))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '删除失败')
    } finally {
      setConfirmFile(null)
    }
  }

  const previewUrl = previewFile !== null ? `/canvas-studio/assets/${projectId}/${previewFile.file}` : ''

  return (
    <>
      <div className="csHistoryDrawer">
        <div className="csHistHead">
          <span className="csHistTitle">生成历史</span>
          <span className="csHistCount">{shown.length} 项</span>
          <button type="button" className="csHistClose" onClick={onClose} aria-label="关闭生成历史">✕</button>
        </div>
        <p className="csHistHint">本项目全部生成产物 · 含已从画布移除的</p>
        <div className="csHistTabs">
          {(['all', 'image', 'video'] as const).map((value) => (
            <button
              key={value}
              type="button"
              className={filter === value ? 'csHistTabActive' : 'csHistTab'}
              onClick={() => { setFilter(value); setConfirmFile(null) }}
            >
              {value === 'all' ? '全部' : value === 'image' ? '图片' : '视频'}
            </button>
          ))}
        </div>
        {error !== null && <p className="csHistError">{error}</p>}
        <div className="csHistGrid">
          {loading && <p className="csHistEmpty">加载中…</p>}
          {!loading && shown.length === 0 && <p className="csHistEmpty">该分类暂无产物</p>}
          {shown.map((entry) => {
            const state = stateOf(entry)
            const nodeId = locateOf(entry)
            const url = `/canvas-studio/assets/${projectId}/${entry.file}`
            const confirming = confirmFile === entry.file
            const mainAction = nodeId !== null ? '定位' : '预览'
            return (
              <div key={entry.file} className="csHistCard">
                <button
                  type="button"
                  className="csHistThumb"
                  title={nodeId !== null ? '定位到画布节点并打开详情' : '预览（app 内弹层）'}
                  onClick={() => {
                    if (nodeId !== null) onLocate(nodeId)
                    else setPreviewFile(entry)
                  }}
                >
                  {entry.kind === 'video'
                    ? <video src={url} preload="metadata" muted />
                    : <img src={url} alt={entry.label} loading="lazy" />}
                  <span className="csHistExt">{entry.kind === 'video' ? 'MP4' : 'PNG'}</span>
                </button>
                <div className="csHistMeta">
                  <span className={`csHistBadge csHistBadge-${state}`}>{STATE_TEXT[state]}</span>
                  <p className="csHistLabel">{entry.label}</p>
                  <p className="csHistWhen">{formatWhen(entry.createdAt)}{formatSize(entry.size) !== '' ? ` · ${formatSize(entry.size)}` : ''}</p>
                </div>
                {confirming ? (
                  <div className="csHistConfirm">
                    <button type="button" className="csHistDelete" onClick={() => { void handleDelete(entry.file) }}>彻底删除</button>
                    <button type="button" className="csHistCancel" onClick={() => { setConfirmFile(null) }}>取消</button>
                  </div>
                ) : (
                  <div className="csHistActions">
                    <button
                      type="button"
                      className="csHistCancel"
                      title={nodeId !== null ? '定位到画布节点并打开详情（与双击素材一致）' : '预览（app 内弹层）'}
                      onClick={() => {
                        if (nodeId !== null) onLocate(nodeId)
                        else setPreviewFile(entry)
                      }}
                    >
                      {mainAction}
                    </button>
                    <button type="button" className="csHistAsk" onClick={() => { setConfirmFile(entry.file) }}>删除</button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
        <div className="csHistFoot">删除 = 移入资产回收站，可彻底清除</div>
      </div>
      {/* CV-246a：app 内 lightbox——挂在 .csCanvasBody（与抽屉同级），遮罩盖画布；
          不开新窗口（资产路由 loopback authority 会 403）。 */}
      {previewFile !== null && (
        <div className="csHistLightbox" onClick={() => { setPreviewFile(null) }}>
          <div className="csHistLightboxBar">
            <span>{previewFile.label} · {formatWhen(previewFile.createdAt)}</span>
            <button type="button" className="csHistClose" onClick={() => { setPreviewFile(null) }} aria-label="关闭预览">✕</button>
          </div>
          {previewFile.kind === 'video'
            ? <video src={previewUrl} controls autoPlay muted onClick={(event) => { event.stopPropagation() }} />
            : <img src={previewUrl} alt={previewFile.label} onClick={(event) => { event.stopPropagation() }} />}
        </div>
      )}
    </>
  )
}
