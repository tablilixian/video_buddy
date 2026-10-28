import { useEffect, useMemo, useRef, useState } from 'react'
import type { StudioCanvasNode } from '../../contracts/canvas.js'
import type { AudioTimeline } from '../../audio-timeline.js'
import { isComposedFilm, isValidBgmNode } from '../../compose-selection.js'
import { WaveBars } from '../use-waveform.js'
import { AudioMixPanel } from '../AudioMixPanel.js'
import { AudioDrawer } from '../AudioDrawer.js'
import { installAudioStyles } from '../styles-audio.js'
import { composeAudioPrecheck } from '../../compose-selection.js'
import { isShotClip } from '../../shot-versions.js'
import {
  clipIdAt,
  clipTotalSeconds,
  layoutAudioLane,
  niceRulerMax,
  planClipLayout,
  playheadLeftPct,
  rulerTicks,
  type AudioLaneSegmentInput,
} from '../../timeline-layout.js'
import { KIND_LABEL, kindAccentOf } from './labels.js'

/** Props for the bottom review/timeline strip. */
export interface CanvasTimelineProps {
  /** 已按有效顺序排好的条目（调用方经 deriveTimelineOrder 派生）。 */
  ordered: readonly StudioCanvasNode[]
  selectedNodeId: string | null
  /** Select a node from the strip (also used to jump/center it on the surface). */
  onSelect(id: string): void
  /** P9.1：拖拽重排完成，回调整条的完整 id 顺序（由父级写入 view.timeline）。 */
  onReorder(ids: string[]): void
  /** P9.3：调合成路由导出成片（≥1 个有效片段即可：1 个 = 一镜整出，CV-141 解禁）。 */
  onCompose(): void
  /** P9.3：合成进行中（禁用按钮 + 文案）。 */
  composeBusy: boolean
  /** CV-006：实际将参与合成的有效片段数（排除勾选与作废片段已剔除）。 */
  composeClipCount: number
  /** CV-007：预计成片时长（Σ 有效纳入片段真值 duration，秒）。 */
  composeEstSeconds: number
  /** CV-006：BGM 短于预计成片的软提示（不拦，服务端守卫兜底）。 */
  composeWarnings: readonly string[]
  /** CV-006：用户显式排除的片段 id（view.composeExcluded）。 */
  composeExcluded: readonly string[]
  /** CV-006：解析后仍有效的 BGM 节点 id（失效引用已由父级回退 undefined）。 */
  composeBgmNodeId?: string | undefined
  /** CV-006：切换片段纳入/排除态。 */
  onToggleComposeExcluded(id: string): void
  /** CV-006：选定/取消 BGM（undefined = 不使用）。 */
  onComposeBgmChange(nodeId: string | undefined): void
  /** S3：写回节点字段（混音面板 → 节点 audioTimeline；StudioFrame 提供，含持久化）。 */
  onUpdateNode(id: string, patch: { audioTimeline?: AudioTimeline | undefined }): void
}

/** CV-007：真值时长标签；无探测值回落创建时间，不造假数据。 */
function durationOrTime(node: StudioCanvasNode): string {
  const time = new Date(node.createdAt)
  return typeof node.duration === 'number'
    ? `${node.duration.toFixed(1)}s`
    : (Number.isNaN(time.getTime()) ? '-' : time.toLocaleTimeString())
}

/**
 * The review timeline（DD-04a：从等宽 chip 列表升维为真时间轴）。
 *
 * 三轨：视频轨（片段宽度 = 真实 duration 比例，可拖拽重排 + 勾选纳入合成）、
 * BGM 轨（音频资产按时长比例排布，点选即选定）、参考·产物轨（图片素材 +
 * 成片产物 + 失效版本，固定宽 chip——它们不属于合成序列，不参与比例布局）。
 * 标尺 + 可拖播放头：在标尺或轨道空白处按下即擦洗，播放头下的片段高亮
 * （isHot），松手时联动画布选中该片段。
 *
 * CV-006/007 语义不变：成片产物与失效版本不计入片段数 / 预计时长 / 布局
 * （CV-160：产物 ≠ 素材）；工具栏能力（BGM 下拉、显示全部、导出）原样保留。
 */
export function CanvasTimeline(props: CanvasTimelineProps) {
  const {
    ordered, selectedNodeId, onSelect, onReorder, onCompose, composeBusy,
    composeClipCount, composeEstSeconds, composeWarnings,
    composeExcluded, composeBgmNodeId, onToggleComposeExcluded, onComposeBgmChange,
    onUpdateNode,
  } = props
  // HTML5 DnD 的拖起/悬停下标（视频轨内瞬态；落点即目标插入位）。
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [hoverIndex, setHoverIndex] = useState<number | null>(null)
  // CV-007：媒体过滤开关（默认关 = 只显媒体；打开回看 text/sticky 等非媒体）。
  const [showAll, setShowAll] = useState(false)
  // S3：混音面板 / 音频抽屉的开关（面板写节点 audioTimeline；抽屉全项目音频试听对比）。
  const [mixOpen, setMixOpen] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  // DD-04a：播放头时间（秒）。始终显示（初始 0），拖动标尺/轨道空白擦洗。
  const [playT, setPlayT] = useState(0)
  // N3（对齐清单 §8.3，拍板「做一半」）：播放/暂停自动推进播放头。当前片段
  // isHot 高亮由 playT 派生（clipIdAt），自动获得。**不强改画布选区** —— mock
  // 会把选中强切到当前片段，与产品「选中是用户资产」的语义冲突（拍板记录见
  // 收口清单 §8.3-N3）。
  const [playing, setPlaying] = useState(false)
  const lanesRef = useRef<HTMLDivElement | null>(null)
  const scrubbingRef = useRef(false)
  const excludedSet = new Set(composeExcluded)
  // S3：画布全部音频节点（ordered 含失效/被取代版本 —— 抽屉要并排比较多版）。CSS 首挂注入。
  const audioNodes = useMemo(() => ordered.filter(node => node.kind === 'audio'), [ordered])
  useMemo(() => { installAudioStyles() }, [])

  // CV-007：时间轴语义——默认只显媒体；显示全部时保持完整顺序不变。
  const displayed = showAll ? ordered : ordered.filter(node =>
    node.kind === 'image' || node.kind === 'video' || node.kind === 'audio')
  // CV-006：BGM 下拉候选 = 存活的音频节点（不列成片节点，少一个歧义源）。
  const bgmCandidates = ordered.filter(isValidBgmNode)
  // CV-160：成片节点（kind=video + toolName=compose）是产物不是素材——不计入
  // 片段数、预计时长与比例布局（否则成片被当片段重复计入并递归叠加）。
  const filmNodes = displayed.filter(isComposedFilm)
  // 参考轨：图片素材（关键帧/参考图）+ 成片产物 + 失效视频版本。
  // 它们都不属于合成序列，用固定宽 chip 流式排布，不参与比例布局。
  const refNodes = displayed.filter(node =>
    node.kind === 'image'
    || (node.kind === 'video' && (isComposedFilm(node) || node.retired === true || node.supersededBy !== undefined)))
  // 视频轨：可参与合成的片段（排除勾选仍显示——只是不进合成；作废/成片已移出）。
  // C2：改用 `isShotClip`（全仓唯一权威口径），不再在这里手写第三份同样的规则。
  // 原写法 `kind==='video' && !isComposedFilm && !retired && !supersededBy` 与
  // isShotClip 逐字等价，但它是同一个判断的第二份副本 —— CV-160 正是「同一规则
  // 多处各写一份」导致成片被当成片段重复计入时长。画布上的镜号 chip 也吃这条
  // 口径，两处必须同源，否则卡上的 #N 会与轨道上的 N 对不上。
  const clips = displayed.filter(isShotClip)
  const spans = useMemo(() => planClipLayout(clips), [clips])
  const rulerMax = useMemo(() => niceRulerMax(clipTotalSeconds(clips)), [clips])
  const ticks = useMemo(() => rulerTicks(rulerMax), [rulerMax])
  const hotId = clipIdAt(playT, spans)

  // S3：只读音频轨（成片装配预览）。段来源 = 选中的 BGM（0s 起）+ 各音频节点
  // audioTimeline 里已写回的旁白段（混音面板/S2b 装配回读）。标尺 = 预计成片时长
  // —— BGM 比成片长/短几秒在轨道上直接可读（CV-007 残留问题的收口）。
  const selectedBgmNode = useMemo(
    () => bgmCandidates.find(node => node.id === composeBgmNodeId),
    [bgmCandidates, composeBgmNodeId],
  )
  const audioLaneSegments = useMemo<AudioLaneSegmentInput[]>(() => {
    const segments: AudioLaneSegmentInput[] = []
    if (selectedBgmNode !== undefined) {
      segments.push({
        id: selectedBgmNode.id,
        startSec: 0,
        ...(typeof selectedBgmNode.duration === 'number' && selectedBgmNode.duration > 0
          ? { durationSec: selectedBgmNode.duration }
          : {}),
      })
    }
    for (const node of audioNodes) {
      (node.audioTimeline?.segments ?? []).forEach((segment, index) => {
        if (segment.role !== 'voiceOver') return
        segments.push({
          id: `${node.id}:${index}`,
          startSec: segment.startSec,
          ...(segment.durationSec !== undefined && segment.durationSec > 0 ? { durationSec: segment.durationSec } : {}),
        })
      })
    }
    return segments
  }, [selectedBgmNode, audioNodes])
  const audioBlocks = useMemo(
    () => layoutAudioLane(audioLaneSegments, composeEstSeconds),
    [audioLaneSegments, composeEstSeconds],
  )

  // N3：播放推进循环。0.1s / 100ms 与设计稿同节奏；到 rulerMax 停（不循环 ——
  // 这是制作工具不是播放器，循环播放会让「最后一个片段的高亮」永远下不来）。
  useEffect(() => {
    if (!playing) return
    const timer = window.setInterval(() => {
      setPlayT(prev => Math.min(rulerMax, prev + 0.1))
    }, 100)
    return () => { window.clearInterval(timer) }
  }, [playing, rulerMax])
  useEffect(() => {
    if (playing && playT >= rulerMax) setPlaying(false)
  }, [playing, playT, rulerMax])
  const togglePlay = (): void => {
    setPlaying(prev => {
      const next = !prev
      // 在末尾再按播放 = 从头再来（擦洗到中段则续播）。
      if (next && playT >= rulerMax) setPlayT(0)
      return next
    })
  }

  // CR-069：缩略图加载失败时隐藏自身（URL 失效/产物损坏不显示破碎占位）。
  const hideBrokenMedia = (event: React.SyntheticEvent<HTMLMediaElement | HTMLImageElement>): void => {
    event.currentTarget.style.display = 'none'
  }

  // S3：导出前音频预检 —— 客户端可知的问题（短 BGM / 无任何音频节点）在合成前
  // 弹确认（不是硬拦）：确定 = 继续（短 BGM 由装配自动补静音并明确告知）；取消 = 重新生成。
  const handleComposeClick = (): void => {
    const precheck = composeAudioPrecheck({
      ...(selectedBgmNode !== undefined && typeof selectedBgmNode.duration === 'number' ? { bgmDurationSec: selectedBgmNode.duration } : {}),
      estSeconds: composeEstSeconds,
      hasAnyAudioNode: audioNodes.length > 0,
    })
    if (precheck.level === 'confirm' && precheck.message !== undefined && !window.confirm(precheck.message)) return
    void onCompose()
  }

  const handleDrop = (targetIndex: number): void => {
    if (dragIndex === null || dragIndex === targetIndex) {
      setDragIndex(null)
      setHoverIndex(null)
      return
    }
    const ids = clips.map(node => node.id)
    const [moved] = ids.splice(dragIndex, 1)
    if (moved !== undefined) ids.splice(targetIndex, 0, moved)
    onReorder(ids)
    setDragIndex(null)
    setHoverIndex(null)
  }

  /**
   * DD-04a：指针横向坐标 → 时间（秒）。可用宽度 = 轨道区宽 − 标签列宽
   * （64px = 标签列 56 + 轨道 gap 8，与播放头 left 公式同源）。返回 null = 无法换算（未挂载/无片段）。
   */
  const timeAt = (clientX: number): number | null => {
    const lanes = lanesRef.current
    if (lanes === null || rulerMax <= 0) return null
    const rect = lanes.getBoundingClientRect()
    const usable = rect.width - 64
    if (usable <= 0) return null
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left - 64) / usable))
    return ratio * rulerMax
  }

  const scrubTo = (clientX: number): void => {
    const time = timeAt(clientX)
    if (time !== null) setPlayT(time)
  }

  const handleScrubPointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    // 片段上的按下交给「点选 / 拖拽重排」，不从片段启动擦洗。
    if ((event.target as Element).closest('.csTlClipWrap') !== null) return
    scrubbingRef.current = true
    event.currentTarget.setPointerCapture(event.pointerId)
    scrubTo(event.clientX)
  }

  if (ordered.length === 0) {
    return <div className="csTimeline csTimelineEmpty">尚无产物 —— 在右侧对话让 agent 生成后，按时间线回看</div>
  }

  return (
    <div className="csTimeline csTimelineWrap">
      <div className="csTimelineToolbar">
        {/* N3：播放/暂停 —— 推进播放头 + 当前片段高亮；不改动画布选区（拍板见 §8.3-N3）。 */}
        <button
          type="button"
          className="csTimelinePlay"
          disabled={clips.length === 0}
          title={playing ? '暂停（播放头自动推进，不改动画布选区）' : '播放：播放头自动推进，当前片段高亮（不改动画布选区）'}
          onClick={togglePlay}
        >
          {playing ? '⏸ 暂停' : '▶ 播放'}
        </button>
        <span
          className="csTimelineCount"
          title="参与合成的逐镜片段数：成片产物与失效版本（已作废 / 被新版取代）都不计入"
        >
          视频片段 {composeClipCount}
        </span>
        {composeEstSeconds > 0
          ? (
            <span
              className="csTimelineEst"
              title="Σ 参与合成的逐镜片段真值时长：排除勾选、已作废/被取代版本与成片产物——与「合成导出成片」实际提交的 clipIds 完全一致"
            >
              预计成片 ≈ {composeEstSeconds.toFixed(2)}s
            </span>
          )
          : null}
        {filmNodes.length > 0
          ? (
            <span
              className="csTimelineHint"
              title={`时间轴上有 ${filmNodes.length} 个成片产物：成片由片段拼成，属于结果而非素材，因此不计入「视频片段」与「预计成片」（也不会被再次拼进新成片，避免递归叠加）`}
            >
              成片 {filmNodes.length} 个不计入
            </span>
          )
          : null}
        <label className="csTimelineBgm">
          BGM
          <select
            value={composeBgmNodeId ?? ''}
            onChange={event => { onComposeBgmChange(event.target.value === '' ? undefined : event.target.value) }}
            title="选用画布上的音频节点作为成片 BGM；多镜将只保留 BGM，单镜保留环境声并叠混"
          >
            <option value="">不使用</option>
            {bgmCandidates.map(node => (
              <option key={node.id} value={node.id}>
                {node.title ?? '音频'}{typeof node.duration === 'number' ? ` · ${node.duration.toFixed(2)}s` : ''}
              </option>
            ))}
          </select>
        </label>
        {composeWarnings.map(warning => (
          <span key={warning} className="csTimelineWarn" title="服务端守卫会在合成时给出精确差额">{warning}</span>
        ))}
        <label className="csTimelineToggleAll" title="非媒体节点（便签/文案/提示词等）默认不进时间轴">
          <input type="checkbox" checked={showAll} onChange={event => { setShowAll(event.target.checked) }} />
          显示全部
        </label>
        <button
          type="button"
          className={mixOpen ? 'csTlCheck csTlCheckOff' : ''}
          title="混音面板：BGM/旁白音量、淡入淡出、duck（写回音频节点，装配时生效）"
          onClick={() => { setMixOpen(prev => !prev); setDrawerOpen(false) }}
        >
          混音
        </button>
        <button
          type="button"
          className={drawerOpen ? 'csTlCheck csTlCheckOff' : ''}
          title="音频抽屉：全项目音频列表、试听、多版对比"
          onClick={() => { setDrawerOpen(prev => !prev); setMixOpen(false) }}
        >
          音频
        </button>
        <button
          type="button"
          className="csPrimary"
          disabled={composeClipCount < 1 || composeBusy}
          title={composeClipCount < 1
            ? '至少 1 个有效片段才能导出成片（排除勾选与作废片段不计入）'
            : '有效片段将按顺序拼接成片；单片段 = 一镜整出（保留环境声），多镜 = 只保留 BGM / 无声'}
          onClick={handleComposeClick}
        >
          {composeBusy ? '合成中…' : '合成导出成片'}
        </button>
      </div>
      <div className="csTlBody">
        <div
          className="csTlLanes"
          ref={lanesRef}
          onPointerDown={handleScrubPointerDown}
          onPointerMove={event => { if (scrubbingRef.current) scrubTo(event.clientX) }}
          onPointerUp={event => {
            if (!scrubbingRef.current) return
            scrubbingRef.current = false
            event.currentTarget.releasePointerCapture(event.pointerId)
            // 直接从坐标取时间（state 本轮还没更新，读 playT 会拿到旧值）。
            const time = timeAt(event.clientX)
            if (time !== null) {
              setPlayT(time)
              const id = clipIdAt(time, spans)
              if (id !== undefined) onSelect(id)
            }
          }}
        >
          <div className="csTlRuler">
            {ticks.map(tick => (
              <span key={tick.t} className="csTlTick" style={{ left: `${tick.pct}%` }}>{tick.t}s</span>
            ))}
          </div>
          <div className="csTlTrack">
            <span className="csTlTrkLabel">视频轨</span>
            <div className="csTlLane csTlLaneTall">
              {clips.length === 0
                ? <span className="csTlLaneEmpty">暂无视频片段 —— 生成视频后按真实时长排入轨道</span>
                : spans.map((span, index) => {
                  const node = clips[index]
                  if (node === undefined) return null
                  const excluded = excludedSet.has(node.id)
                  const className = [
                    'csTlClip',
                    node.id === selectedNodeId ? 'csTlClipSel' : '',
                    node.id === hotId ? 'csTlClipHot' : '',
                    excluded ? 'csTlClipExcluded' : '',
                    // P9.1：拖拽重排的插入落点提示（落点片段描虚线框）。
                    index === hoverIndex && dragIndex !== null && dragIndex !== index ? 'csTlClipTarget' : '',
                  ].filter(Boolean).join(' ')
                  return (
                    <div
                      key={node.id}
                      className="csTlClipWrap"
                      style={{ left: `${span.leftPct}%`, width: `calc(${span.widthPct}% - 3px)` }}
                    >
                      <div
                        className={className}
                        draggable
                        onDragStart={() => { setDragIndex(index) }}
                        onDragOver={event => {
                          if (dragIndex === null) return
                          event.preventDefault()
                          // CR-070：dragOver 高频触发——值未变时不重复 setState（避免高亮跳动/多余渲染）。
                          setHoverIndex(prev => (prev === index ? prev : index))
                        }}
                        onDrop={event => {
                          event.preventDefault()
                          handleDrop(index)
                        }}
                        onDragEnd={() => { setDragIndex(null); setHoverIndex(null) }}
                        onClick={() => {
                          onSelect(node.id)
                          // 点片段：播放头跳到片段起点（回看语义）。
                          setPlayT(span.start)
                        }}
                        title={`${node.title ?? KIND_LABEL[node.kind]} · ${durationOrTime(node)}（宽度 = 真实时长比例）· 拖拽排序${excluded ? ' · 已排除出合成' : ''}`}
                      >
                        <span className="csTlClipArt">
                          {node.url
                            ? (
                              node.kind === 'video'
                                ? <video src={node.url} muted preload="metadata" onError={hideBrokenMedia} />
                                : <img src={node.url} alt={node.title ?? 'image'} draggable={false} onError={hideBrokenMedia} />
                            )
                            : null}
                        </span>
                        <span className="csTlClipLbl">
                          {index + 1} · {durationOrTime(node)}
                        </span>
                        <span className="csTlClipCut" />
                      </div>
                      <button
                        type="button"
                        // 勾选区是片段的兄弟绝对定位元素（button 嵌 div 合法但兄弟
                        // 互不穿透——点勾选不会触发选中/拖拽）。
                        className={`csTlCheck${excluded ? ' csTlCheckOff' : ''}`}
                        title={excluded ? '已排除出合成 —— 点按重新纳入' : '将参与合成 —— 点按排除'}
                        onClick={() => { onToggleComposeExcluded(node.id) }}
                      >
                        {excluded ? '' : '✓'}
                      </button>
                    </div>
                  )
                })}
            </div>
          </div>
          <div className="csTlTrack">
            <span className="csTlTrkLabel">BGM</span>
            <div className="csTlLane">
              {bgmCandidates.length === 0
                ? <span className="csTlLaneEmpty">未选择 BGM —— 生成音频后在此点选</span>
                : (() => {
                  const bgmSpans = planClipLayout(bgmCandidates)
                  return bgmSpans.map((span, index) => {
                    const node = bgmCandidates[index]
                    if (node === undefined) return null
                    const active = node.id === composeBgmNodeId
                    return (
                      <div
                        key={node.id}
                        className={`csTlClip csTlClipBgm${active ? ' csTlClipSel' : ''}`}
                        style={{ left: `${span.leftPct}%`, width: `calc(${span.widthPct}% - 3px)` }}
                        onClick={() => { onComposeBgmChange(active ? undefined : node.id) }}
                        title={`${node.title ?? '音频'} · ${durationOrTime(node)}${active ? ' · 已选用，点按取消' : ' · 点按选用'}`}
                      >
                        {/* C3：BGM 轨真波形 —— 素材 chip 时代只有歌名，波形让
                            「这段 BGM 什么脾气」一眼可读（比设计稿的伪随机真）。 */}
                        <WaveBars url={node.url} bars={32} />
                        <span className="csTlClipLbl">♪ {node.title ?? '音频'}{typeof node.duration === 'number' ? ` · ${node.duration.toFixed(1)}s` : ''}</span>
                      </div>
                    )
                  })
                })()}
            </div>
          </div>
          <div className="csTlTrack">
            <span className="csTlTrkLabel">音频轨</span>
            <div className="csTlLane">
              {audioBlocks.length === 0
                ? <span className="csTlLaneEmpty">选中 BGM 或生成旁白后，这里按成片时间坐标显示装配预览（BGM 长短差一眼可读）</span>
                : audioBlocks.map((block) => {
                  const sourceNode = audioNodes.find(node => block.id.startsWith(node.id))
                  return (
                    <div
                      key={block.id}
                      className={`csTlLaneAudioBlock${block.overflow ? ' csTlAudioOverflow' : ''}`}
                      style={{ left: `${block.leftPct}%`, width: `calc(${Math.max(0.5, block.widthPct)}% - 2px)` }}
                      onClick={() => { if (sourceNode !== undefined) onSelect(sourceNode.id) }}
                      title={`${sourceNode?.title ?? '音频'} · ${block.measured ? `0s–${block.spanSec.toFixed(1)}s` : '时长未探测（占位显示）'}${block.overflow ? ' · 越过成片末尾（多余部分会被裁掉）' : ''} · 点按在画布定位`}
                    >
                      <WaveBars url={sourceNode?.url} bars={16} />
                      <span className="csTlLaneAudioLabel">{sourceNode?.title ?? '音频'}{block.measured ? ` · ${block.spanSec.toFixed(1)}s` : ''}</span>
                      {block.overflow ? <span className="csTlAudioOverflowMark">⇥ 越界</span> : null}
                    </div>
                  )
                })}
            </div>
          </div>
          <div className="csTlTrack">
            <span className="csTlTrkLabel">参考·产物</span>
            <div className="csTlLane">
              {refNodes.length === 0
                ? <span className="csTlLaneEmpty">参考图 / 成片产物会出现在这条轨道</span>
                : (
                  <div className="csTlRefRow">
                    {refNodes.map(node => {
                      const film = isComposedFilm(node)
                      const retired = !film && (node.retired === true || node.supersededBy !== undefined)
                      return (
                        <span
                          key={node.id}
                          // CV-197：金底是**轨道身份**（「参考·产物」轨），左缘 3px
                          // 色条是**类型身份** —— 两个正交信号，不互相顶替：把底色
                          // 换成类型色会丢掉「这条是参考轨」这个更上位的语义。
                          className={[
                            'csTlRefChip',
                            film ? 'csTlRefChipFilm' : '',
                            retired ? 'csTlRefChipRetired' : '',
                            kindAccentOf(node.kind),
                          ].filter(Boolean).join(' ')}
                          onClick={() => { onSelect(node.id) }}
                          title={`${node.title ?? KIND_LABEL[node.kind]}${film ? ' · 成片产物，不计入片段与预计时长' : ''}${retired ? ' · 已作废 / 被新版取代' : ''} · 点按在画布定位`}
                        >
                          {film ? '成片 · ' : ''}{node.title ?? KIND_LABEL[node.kind]}
                        </span>
                      )
                    })}
                  </div>
                )}
            </div>
          </div>
          {rulerMax > 0
            ? (
              <div
                className="csTlPlayhead"
                style={{ left: `calc(64px + (100% - 64px) * ${playheadLeftPct(playT, rulerMax) / 100})` }}
                title={`播放头 ${playT.toFixed(1)}s · 拖动标尺擦洗`}
              >
                <span className="csTlPhGrip" />
              </div>
            )
            : null}
        </div>
        {mixOpen
          ? (
            <AudioMixPanel
              bgmNode={selectedBgmNode}
              voiceOverNodes={audioNodes.filter(node => node.kind === 'audio' && (node.toolName === 'tts_voiceover' || /旁白|配音|口播|念白|narration|voice[\s-]?over/i.test(node.title ?? '')))}
              onUpdateNode={onUpdateNode}
            />
          )
          : null}
        {drawerOpen
          ? (
            <AudioDrawer
              nodes={audioNodes}
              onClose={() => { setDrawerOpen(false) }}
              onSelect={(id) => { onSelect(id); setDrawerOpen(false) }}
            />
          )
          : null}
      </div>
    </div>
  )
}
