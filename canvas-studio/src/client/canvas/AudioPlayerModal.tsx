import { useEffect, useMemo, useRef, useState } from 'react'
import { INSTRUMENTAL_LYRICS } from '../../contracts/canvas.js'

/**
 * CV-130：音频固定尺寸播放器浮层（双击音频节点打开）。
 *
 * 与 `VideoPlayerModal` 同构（同一套自绘控制条语义：不挂原生 controls、
 * pointer capture 拖进度、Escape 关闭），差别在「舞台」部分——音频没有画面，
 * 于是把舞台让给**歌词**：有歌词时逐行铺开（可滚动），纯器乐时显示波形动画。
 *
 * 为什么要有这个窗口：画布卡片只有一行歌词位置，而「唱的到底是什么」是用户
 * 事后复核 BGM/歌曲的核心信息（CV-130 的诉求之一）。卡片负责「一眼看出有词」，
 * 窗口负责「完整读一遍」。
 */
export interface AudioPlayerModalProps {
  title: string
  url: string
  /** 节点上的歌词原文（含结构标记；[Instrumental] = 纯器乐）。 */
  lyrics?: string
  /** 节点记录的时长（秒）——metadata 就绪前先用它占位，避免出现「加载中…」空窗。 */
  duration?: number
  onClose(): void
}

/** 秒 → mm:ss（超一小时兜底 h:mm:ss）。与 VideoPlayerModal 保持同一格式。 */
function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const total = Math.floor(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m)
  const ss = String(s).padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

/** 波形动画条数（纯器乐时的视觉主体）。 */
const WAVE_BARS = 48

export function AudioPlayerModal(props: AudioPlayerModalProps) {
  const { title, url, lyrics, duration: nodeDuration, onClose } = props
  const [paused, setPaused] = useState(false)
  const [duration, setDuration] = useState(nodeDuration ?? 0)
  const [current, setCurrent] = useState(0)
  const [volume, setVolume] = useState(1)
  const [muted, setMuted] = useState(false)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const progressRef = useRef<HTMLDivElement | null>(null)
  // 拖动进度期间不让 timeupdate 覆盖手势位置（seek 语义）。
  const seekingRef = useRef(false)

  // Escape 关闭（capture + stopPropagation：先于画布的 Escape 清选中执行）。
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => { window.removeEventListener('keydown', onKeyDown, true) }
  }, [onClose])

  const trimmed = lyrics?.trim() ?? ''
  const instrumental = trimmed.length === 0 || trimmed === INSTRUMENTAL_LYRICS
  // 逐行拆开只为渲染；结构标记（[Verse] 之类）单独给弱化样式，不当歌词正文读。
  const lyricLines = useMemo(
    () => (instrumental ? [] : trimmed.split('\n').map(line => line.trim())),
    [instrumental, trimmed],
  )
  // 波形高度按 url 派生（与画布卡片同思路，保证同一曲子每次打开一致）。
  const waveBars = useMemo(() => {
    let seed = 11
    for (let index = 0; index < url.length; index += 1) seed = (seed * 33 + url.charCodeAt(index)) % 9973
    return Array.from({ length: WAVE_BARS }, (_, index) => 18 + ((seed * (index + 7)) % 83))
  }, [url])

  const handleTogglePlay = (): void => {
    const el = audioRef.current
    if (el === null) return
    if (el.paused) {
      void el.play()
      setPaused(false)
    } else {
      el.pause()
      setPaused(true)
    }
  }

  // 按指针横坐标 seek（pointer capture，拖出条外仍跟踪）。
  const seekToClientX = (clientX: number): void => {
    const el = audioRef.current
    const bar = progressRef.current
    if (el === null || bar === null || duration <= 0) return
    const rect = bar.getBoundingClientRect()
    if (rect.width <= 0) return
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
    el.currentTime = ratio * duration
    setCurrent(el.currentTime)
  }

  const handleVolumeChange = (next: number): void => {
    const el = audioRef.current
    if (el === null) return
    el.volume = next
    setVolume(next)
    if (next > 0 && el.muted) {
      el.muted = false
      setMuted(false)
    }
  }

  const handleToggleMute = (): void => {
    const el = audioRef.current
    if (el === null) return
    el.muted = !el.muted
    setMuted(el.muted)
  }

  const progressRatio = duration > 0 ? Math.min(1, Math.max(0, current / duration)) : 0

  return (
    <div className="csModalBackdrop csMediaPreviewBackdrop" role="presentation" onClick={onClose}>
      <div
        className="csModal csAudioModalCard"
        role="dialog"
        aria-modal="true"
        aria-label={`播放 ${title}`}
        onClick={event => { event.stopPropagation() }}
      >
        <header className="csModalHeader">
          <div className="csModalHeaderText">
            <h2>{title}</h2>
            {/* 元信息条始终渲染（时长未就绪用节点记录值兜底，再没有才显示「加载中…」），
                避免用户疑惑「是不是少了一行」。 */}
            <p className="csModalHeaderMeta">
              <span>{instrumental ? '纯器乐' : `歌词 ${lyricLines.filter(line => line.length > 0 && !line.startsWith('[')).length} 行`}</span>
              <span className="csModalHeaderMetaSep">·</span>
              <span>{duration > 0 ? `时长 ${formatTime(duration)}` : '加载中…'}</span>
            </p>
          </div>
          <button type="button" className="csModalClose" aria-label="关闭" onClick={onClose}>×</button>
        </header>
        <div className="csAudioStage" onClick={handleTogglePlay}>
          {instrumental
            ? (
              <div className="csAudioStageWave" aria-hidden="true">
                {waveBars.map((height, index) => (
                  <span
                    key={index}
                    className="csAudioStageBar"
                    style={{
                      height: `${height}%`,
                      opacity: paused ? 0.4 : ((index + 1) / waveBars.length) <= progressRatio ? 0.95 : 0.3,
                    }}
                  />
                ))}
              </div>
            )
            : (
              // 歌词区域不参与「点舞台切播放/暂停」——否则想划选/复制歌词就会
              // 误触暂停。暂停请用控制条按钮（与视频浮层一致）。
              <div className="csAudioStageLyrics" onClick={event => { event.stopPropagation() }}>
                {lyricLines.map((line, index) => (
                  line.length === 0
                    ? <span key={index} className="csAudioLyricGap" aria-hidden="true" />
                    : (
                      <p
                        key={index}
                        className={line.startsWith('[') ? 'csAudioLyricLine csAudioLyricMarker' : 'csAudioLyricLine'}
                      >
                        {line}
                      </p>
                    )
                ))}
              </div>
            )}
        </div>
        {/* 自绘控制条（与视频播放器同一套语义与尺寸）。 */}
        <div className="csVideoControls">
          <button
            type="button"
            className="csVideoControlButton"
            aria-label={paused ? '播放' : '暂停'}
            title={paused ? '播放' : '暂停'}
            onClick={handleTogglePlay}
          >
            {paused
              ? (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden="true">
                    <polygon points="6 3 21 12 6 21 6 3" />
                  </svg>
                )
              : (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden="true">
                    <rect x="5" y="3" width="5" height="18" rx="1" />
                    <rect x="14" y="3" width="5" height="18" rx="1" />
                  </svg>
                )}
          </button>
          <span className="csVideoTime">{formatTime(current)}</span>
          <div
            ref={progressRef}
            className="csVideoProgress"
            role="slider"
            aria-label="播放进度"
            aria-valuemin={0}
            aria-valuemax={Math.round(duration)}
            aria-valuenow={Math.round(current)}
            onPointerDown={event => {
              seekingRef.current = true
              event.currentTarget.setPointerCapture(event.pointerId)
              seekToClientX(event.clientX)
            }}
            onPointerMove={event => {
              if (seekingRef.current) seekToClientX(event.clientX)
            }}
            onPointerUp={event => {
              seekingRef.current = false
              event.currentTarget.releasePointerCapture(event.pointerId)
            }}
          >
            <div className="csVideoProgressFill" style={{ width: `${progressRatio * 100}%` }} />
          </div>
          <span className="csVideoTime">{formatTime(duration)}</span>
          <button
            type="button"
            className="csVideoControlButton"
            aria-label={muted ? '取消静音' : '静音'}
            title={muted ? '取消静音' : '静音'}
            onClick={handleToggleMute}
          >
            {muted || volume === 0
              ? (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" stroke="none" />
                    <line x1="23" y1="9" x2="17" y2="15" />
                    <line x1="17" y1="9" x2="23" y2="15" />
                  </svg>
                )
              : (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" stroke="none" />
                    <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                    <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
                  </svg>
                )}
          </button>
          <input
            className="csVideoVolume"
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={muted ? 0 : volume}
            aria-label="音量"
            onChange={event => { handleVolumeChange(Number(event.target.value)) }}
          />
        </div>
        <audio
          ref={audioRef}
          src={url}
          autoPlay
          onPlay={() => { setPaused(false) }}
          onPause={() => { setPaused(true) }}
          onLoadedMetadata={() => {
            const el = audioRef.current
            if (el !== null && Number.isFinite(el.duration)) setDuration(el.duration)
          }}
          onTimeUpdate={() => {
            const el = audioRef.current
            if (el !== null && !seekingRef.current) setCurrent(el.currentTime)
          }}
          onEnded={() => { setPaused(true); setCurrent(0) }}
        />
      </div>
    </div>
  )
}
