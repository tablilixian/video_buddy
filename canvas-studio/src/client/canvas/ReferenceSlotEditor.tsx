import { useMemo, useState } from 'react'
import type { StudioCanvasNode } from '../../contracts/canvas.js'
import { libraryMediaUrl } from '../../contracts/asset-library.js'
import type { LibraryAsset } from '../../contracts/asset-library.js'
import type { ResolveRefItem } from '../../contracts/reference.js'
import { referenceModeLabel, referenceNamesOf, referenceSlotOf, resolveReferenceSummaries, withReferenceNames } from '../../node-params.js'

/**
 * 「生成时用的参考图」编辑区（REQ-003 / A 组）。
 *
 * ## 此前是什么样，为什么必须改
 *
 * 旧实现是**只读缩略图**（`NodeDetailDrawer` 右侧那一行 `<img>`）：删不掉断链那张、
 * 换不了图、也不知道哪张是首帧哪张是尾帧。而参考位是**工具契约**的一部分 ——
 * `video_composite` 的数组顺序就是提示词里 `<Picture N>` 的编号（1 张=首帧 I2VA、
 * 2 张=首尾帧 FL2VA、≥3 张=多参考 Ref2VA），所以"看不见位次"本身就是一个缺陷。
 *
 * ## 三条不可越过的线（方案 §4.6）
 *
 * 1. **编辑不触发生成**：这里只写 `generationPrompt`（与 `withPromptField` 同契约），
 *    要重跑由「重试」负责；
 * 2. **只存可下发的句柄**：新增参考**必须**经 Host 的 `resolve-refs` 换句柄 ——
 *    生成产物节点上的 `filename` 是后端产物名（`img_*`），直接当参考会 500（CV-155）；
 * 3. **断链不静默**：未命中的句柄照旧渲染占位卡（CV-242），编辑动作不许把它抹掉。
 *
 * ## 两个实现细节值得记一笔
 *
 * - **必填单槽"只换不空"**：`image_fix` / `character_generate` / `character_sheet`
 *   的参考图是必填的，删成空一定在重试时报参数错 —— 那时用户已经点了「重试」，只会
 *   看到一条说不清原因的失败。所以必填单槽**不提供删除**（禁用 + title 说明为什么）。
 * - **解析后会"反查不到缩略图"**：`resolveRefFilenames` 会把源节点的 `filename`
 *   回写成新句柄，而**本组件的 `allNodes` 还是旧的**。于是刚加的那张会被
 *   `resolveReferenceSummaries` 判成断链。这里用 `localThumbs`（本次解析拿到的
 *   句柄 → 候选来源）兜住，等下一次画布载入自然收敛。
 */
export interface ReferenceSlotEditorProps {
  node: StudioCanvasNode
  /** 当前项目全部节点：反查缩略图 + 作为「添加参考」的第一来源。 */
  allNodes: readonly StudioCanvasNode[]
  /** 「添加参考」的第二来源（全局资产库）；缺省 = 只给画布节点。 */
  libraryAssets?: readonly LibraryAsset[]
  /** 更新节点字段（只写 `generationPrompt`）。 */
  onUpdateNode(id: string, updates: Partial<StudioCanvasNode>): void
  /** 解析句柄（Host 侧惰性提升 + 回写源节点）；缺省 = 只能读，不能增删。 */
  onResolveRefs?(refs: readonly string[]): Promise<readonly ResolveRefItem[]>
}

/** 「添加参考」的候选：画布节点或资产库条目。 */
interface Candidate {
  ref: string
  label: string
  url: string
  source: 'canvas' | 'library'
}

export function ReferenceSlotEditor(props: ReferenceSlotEditorProps) {
  const { node, allNodes, libraryAssets, onUpdateNode, onResolveRefs } = props
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  /** 打开选择器：-1 = 新增，≥0 = 替换该位次。null = 关着。 */
  const [picking, setPicking] = useState<number | null>(null)
  /** 本次解析拿到的句柄 → 来源缩略图（见文件头「两个实现细节」）。 */
  const [localThumbs, setLocalThumbs] = useState<Readonly<Record<string, { url: string; label: string }>>>({})

  const slot = referenceSlotOf(node)
  const names = useMemo(() => referenceNamesOf(node.generationPrompt), [node.generationPrompt])
  const summaries = useMemo(() => resolveReferenceSummaries(names, allNodes), [names, allNodes])

  const candidates = useMemo<readonly Candidate[]>(() => {
    const taken = new Set(names)
    const fromCanvas: Candidate[] = allNodes
      .filter(candidate => candidate.id !== node.id
        && candidate.url !== undefined
        && (candidate.kind === 'image' || candidate.kind === 'video')
        && !(candidate.filename !== undefined && taken.has(candidate.filename)))
      .map(candidate => ({
        ref: candidate.id,
        label: candidate.title ?? candidate.filename ?? '未命名',
        url: candidate.url as string,
        source: 'canvas' as const,
      }))
    const fromLibrary: Candidate[] = (libraryAssets ?? []).flatMap(asset => {
      const media = asset.media.find(entry => entry.kind === 'image') ?? asset.media[0]
      if (media === undefined) return []
      const handle = `lib:${asset.id}`
      if (taken.has(handle)) return []
      return [{ ref: handle, label: asset.name, url: libraryMediaUrl(asset.id, media.file), source: 'library' as const }]
    })
    return [...fromCanvas, ...fromLibrary]
  }, [allNodes, libraryAssets, node.id, names])

  if (slot === null) return null

  const canEdit = onResolveRefs !== undefined
  const canDelete = !(slot.required && names.length <= 1)
  const atMax = names.length >= slot.max
  const withIndex = slot.ordered || slot.max > 1
  const mode = referenceModeLabel(slot.ordered, names.length)

  const thumbOf = (name: string): { url: string; label: string } | null => {
    const hit = summaries.find(summary => summary.name === name)
    if (hit !== undefined && hit.node !== null && hit.node.url !== undefined) {
      return { url: hit.node.url, label: hit.node.title ?? hit.node.filename ?? name }
    }
    return localThumbs[name] ?? null
  }

  /** 唯一的写入口：归一化失败一律**不写**，并把理由说出来。 */
  const commit = (next: readonly string[]): boolean => {
    const raw = withReferenceNames(node.generationPrompt, slot, next)
    if (raw === null) {
      setError(names.length >= slot.max && next.length > slot.max
        ? `最多 ${slot.max} 张参考，这次没有改动。`
        : slot.required && next.length === 0
          ? '这个工具的参考图是必填的（删成空会重试失败），所以只能替换。'
          : '这个节点的生成参数无法解析（老数据或被手改过），为避免写坏，本次改动已放弃。')
      return false
    }
    setError(null)
    onUpdateNode(node.id, { generationPrompt: raw })
    return true
  }

  const resolveAndCommit = async (refs: readonly string[], replaceIndex: number): Promise<void> => {
    if (onResolveRefs === undefined) return
    if (refs.length === 0) return
    setBusy(true)
    try {
      const items = await onResolveRefs(refs)
      const handles: string[] = []
      const failures: string[] = []
      const learned: Record<string, { url: string; label: string }> = {}
      for (const item of items) {
        if (item.handle !== undefined) {
          handles.push(item.handle)
          const source = candidates.find(candidate => candidate.ref === item.ref)
          if (source !== undefined) learned[item.handle] = { url: source.url, label: source.label }
        } else {
          failures.push(`${candidates.find(candidate => candidate.ref === item.ref)?.label ?? item.ref}：${item.error?.message ?? '解析失败'}`)
        }
      }
      if (Object.keys(learned).length > 0) setLocalThumbs(previous => ({ ...previous, ...learned }))
      if (handles.length > 0) {
        const next = replaceIndex >= 0
          ? names.map((name, index) => (index === replaceIndex ? handles[0] as string : name))
          : [...names, ...handles]
        commit(next)
      }
      setError(failures.length > 0 ? failures.join('；') : null)
      setPicking(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '取参考图句柄失败，请重试。')
    } finally {
      setBusy(false)
    }
  }

  const removeAt = (index: number): void => {
    commit(names.filter((_, current) => current !== index))
  }

  const move = (index: number, direction: -1 | 1): void => {
    const target = index + direction
    if (target < 0 || target >= names.length) return
    const next = [...names]
    const moved = next[index] as string
    next[index] = next[target] as string
    next[target] = moved
    commit(next)
  }

  return (
    <div className="csDetailBlock">
      <div className="csRefHead">
        <h3 className="csDetailDrawerColTitle">生成时用的参考图</h3>
        <span className="csRefMeta">
          {mode !== null && <span className="csRefPill csRefPillMode">{mode}</span>}
          <span className="csRefPill">{names.length} / {slot.max}</span>
        </span>
      </div>

      <div className="csRefList">
        {names.map((name, index) => {
          const thumb = thumbOf(name)
          return (
            <div className="csRefCard" key={`${name}-${index}`}>
              {/* 位次徽标就是提示词里的 `<Picture N>` —— 重排参考＝改提示词语义（F2）。 */}
              <div className="csRefBox" title={name}>
                {thumb === null
                  ? <span className="csDetailRefBroken">参考<br />已断链</span>
                  : <img className="csRefThumb" src={thumb.url} alt={thumb.label} />}
                {withIndex && <span className="csRefIdx">Picture {index + 1}</span>}
                <div className="csRefTools">
                  <button
                    type="button"
                    className="csRefTool"
                    title="替换这张（从画布 / 资产库选）"
                    disabled={!canEdit || busy}
                    onClick={() => { setPicking(index) }}
                  >⇄</button>
                  <button
                    type="button"
                    className="csRefTool csRefToolDanger"
                    title={canDelete ? '删除这张' : '必填单槽：不能删成空，只能替换'}
                    disabled={!canDelete || busy}
                    onClick={() => { removeAt(index) }}
                  >✕</button>
                </div>
              </div>
              {names.length > 1 && (
                <div className="csRefMove">
                  <button type="button" aria-label="前移" disabled={index === 0} onClick={() => { move(index, -1) }}>‹</button>
                  <button type="button" aria-label="后移" disabled={index === names.length - 1} onClick={() => { move(index, 1) }}>›</button>
                </div>
              )}
              <span className="csRefName">{thumb?.label ?? '已断链'}</span>
            </div>
          )
        })}
        {/* 参考区**不撑高**：张数多时靠换行（由 CSS 控制），面板高度不随参考数量增长。 */}
        <button
          type="button"
          className="csRefAdd"
          disabled={!canEdit || busy || atMax}
          title={!canEdit ? '当前环境不支持解析句柄（只能查看）' : atMax ? `已达上限 ${slot.max} 张` : '添加参考图'}
          onClick={() => { setPicking(-1) }}
        >
          <span className="csRefAddPlus">+</span>
          <span>{atMax ? `已达上限 ${slot.max}` : '添加参考'}</span>
        </button>
      </div>

      {busy && <div className="csRefNote">解析句柄…（生成产物需要先换成可用句柄才能作参考）</div>}
      {error !== null && <div className="csRefError">{error}</div>}

      {picking !== null && (
        <div className="csRefPicker">
          <div className="csRefPickerHead">
            <b>{picking >= 0 ? `替换第 ${picking + 1} 张` : '添加参考图'}</b>
            <button type="button" className="csDetailButton csRefPickerCancel" onClick={() => { setPicking(null) }}>取消</button>
          </div>
          {candidates.length === 0
            ? <div className="csRefNote">画布上没有别的可用素材（需要带画面的图片/视频节点，或先在资产库入库）。</div>
            : (
              <div className="csRefPickerList">
                {candidates.map(candidate => (
                  <button
                    type="button"
                    className="csRefCandidate"
                    key={candidate.ref}
                    disabled={busy}
                    onClick={() => { void resolveAndCommit([candidate.ref], picking) }}
                  >
                    <img className="csRefCandidateThumb" src={candidate.url} alt="" />
                    <span className="csRefCandidateName">{candidate.label}</span>
                    <span className="csRefCandidateSrc">{candidate.source === 'library' ? '资产库' : '画布'}</span>
                  </button>
                ))}
              </div>
            )}
        </div>
      )}
    </div>
  )
}
