/**
 * CV-334 · B3.3 + 三期 W6-3：**渲染前只读预览**面板。
 *
 * 只读（不提供任何编辑）、不落库（manifest 仍是一次性入参）、不改动 manifest 本身 ——
 * 它只是把「马上要被渲染的那份画面」提前放给用户看一眼。闸门状态机在
 * `./render-preview.js`，本文件只负责画。
 *
 * 三期 W6-3 加三件（全部是「看一眼」工具的补强，不改渲染路径）：
 * 1. **帧号步进**：←/→ 单帧、Shift+←/→ 十帧，并显示当前帧号 —— 卡在半帧上的排版
 *    问题只有逐帧看才看得见（Player 自带的播放条拖不准 1 帧）；
 * 2. **安全区参考线**：左右 8% / 下 12%（字幕安全区）+ 中心十字，可开关；
 * 3. **草稿快渲**：`quality: 'draft'` 就地渲一版（**不走宿主工单、不落画布**），
 *    半分辨率 + 低码率，几秒出结果 —— 这是「敢不敢多迭代几版」的关键。
 *
 * ⚠️ 本模块顶层 import 了 `@remotion/player`（重依赖）。挂载侧必须**惰性加载**它 ——
 * 与 `remotion-render.js` 同一条纪律：不能让这些库在插件 boot 时就初始化。
 */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { AnyZodObject } from 'remotion'
import type { PlayerRef } from '@remotion/player'
import { Player } from '@remotion/player'
import { StudioComposition } from '../remotion/components/Root.js'
import type { CompositionManifest } from '../remotion/manifest.js'
import { getRenderPreviewSnapshot, resolveRenderPreview, subscribeRenderPreview } from './render-preview.js'

/** 长按方向键时的步长（Shift 按下）。 */
const COARSE_STEP = 10

export function RenderPreviewOverlay() {
  const request = useSyncExternalStore(
    (onChange) => subscribeRenderPreview(() => { onChange() }),
    getRenderPreviewSnapshot,
  )
  const playerRef = useRef<PlayerRef>(null)
  const jobId = request?.jobId ?? null
  const meta = request?.manifest.meta
  const durationInFrames = meta === undefined ? 1 : Math.max(1, Math.round(meta.durationInFrames))
  const lastFrame = Math.max(0, durationInFrames - 1)
  const fps = meta === undefined || !(meta.fps > 0) ? 30 : meta.fps
  const [frame, setFrame] = useState(0)
  const [guides, setGuides] = useState(false)
  // 三期 W6-3：草稿快渲的三态（进度 / 产物 URL / 失败原因）。三者互斥地驱动 UI：
  // 有进度 = 正在渲；有 URL = 渲完了可看；有 error = 渲挂了（不拦主流程，用户仍可确认渲染）。
  const [draftProgress, setDraftProgress] = useState<number | null>(null)
  const [draftUrl, setDraftUrl] = useState<string | null>(null)
  const [draftError, setDraftError] = useState<string | null>(null)
  // ⚠️ blob URL 必须用 ref 持有：只在 state 里的话，**卸载时**的 cleanup 里调
  // `setDraftUrl(updater)` 是空操作（React 不会对已卸载组件跑 updater）⇒ 几 MB 的
  // 草稿 mp4 一直挂在内存里。ref 是同步的，卸载也能读到。
  const draftUrlRef = useRef<string | null>(null)

  /** 换掉草稿产物并释放上一份（唯一释放点）。 */
  const swapDraftUrl = (next: string | null): void => {
    const previous = draftUrlRef.current
    if (previous !== null) URL.revokeObjectURL(previous)
    draftUrlRef.current = next
    setDraftUrl(next)
  }

  // 当前帧号：Player 的 `frameupdate` 每帧一发（30Hz 量级），只驱动一个小 chip 的重渲染。
  // 为什么不用 `useState` + 定时器轮询：轮询会漂，且暂停时还在跑；事件跟真实播放位置同源。
  useEffect(() => {
    const player = playerRef.current
    if (player === null) return
    const onFrameUpdate = (event: { detail: { frame: number } }): void => {
      setFrame(event.detail.frame)
    }
    player.addEventListener('frameupdate', onFrameUpdate)
    return () => { player.removeEventListener('frameupdate', onFrameUpdate) }
    // 工单换了 → Player 重新挂载 → 必须重订阅（ref 指向新的实例）。
  }, [jobId])

  // 键盘步进。只在面板开着时挂，且**吃掉**方向键默认行为（否则会滚动背后的画布）。
  useEffect(() => {
    if (jobId === null) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
      const player = playerRef.current
      if (player === null) return
      event.preventDefault()
      const step = (event.shiftKey ? COARSE_STEP : 1) * (event.key === 'ArrowRight' ? 1 : -1)
      const next = Math.min(lastFrame, Math.max(0, Math.round(player.getCurrentFrame()) + step))
      player.seekTo(next)
      setFrame(next)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => { window.removeEventListener('keydown', onKeyDown) }
  }, [jobId, lastFrame])

  // 草稿产物的 blob URL 必须显式释放：面板关掉 / 换单后不释放会一直占住一份 mp4 内存
  // （草稿档半分辨率也有几 MB，反复快渲几次就很可观）。
  useEffect(() => () => {
    const previous = draftUrlRef.current
    if (previous !== null) URL.revokeObjectURL(previous)
    draftUrlRef.current = null
    setDraftUrl(null)
    setDraftProgress(null)
    setDraftError(null)
  }, [jobId])

  if (request === null) return null
  const seconds = (durationInFrames / fps).toFixed(1)

  const seek = (delta: number): void => {
    const player = playerRef.current
    if (player === null) return
    const next = Math.min(lastFrame, Math.max(0, Math.round(player.getCurrentFrame()) + delta))
    player.seekTo(next)
    setFrame(next)
  }

  /**
   * 三期 W6-3：草稿快渲。
   *
   * **不走宿主工单**：`renderManifestOnWeb` 直接在渲染进程里出片，产物变成一个本地
   * blob URL 就地播放，不落画布、不结算任何工具调用 —— 所以点它不会被误当成「已经
   * 交付了一版」。这也意味着它可以随便点：坏了只是面板里报一行错。
   */
  const runDraft = async (): Promise<void> => {
    if (draftProgress !== null) return
    setDraftError(null)
    setDraftProgress(0)
    try {
      const { renderManifestOnWeb } = await import('./remotion-render.js')
      const { bytes } = await renderManifestOnWeb(request.manifest, {
        quality: 'draft',
        onProgress: (progress) => {
          if (!Number.isFinite(progress)) return
          setDraftProgress(Math.min(1, Math.max(0, progress)))
        },
      })
      const blob = new Blob([bytes as unknown as BlobPart], { type: 'video/mp4' })
      swapDraftUrl(URL.createObjectURL(blob))
    } catch (cause) {
      setDraftError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setDraftProgress(null)
    }
  }

  return (
    <div className="csModalBackdrop csRenderPreviewBackdrop" role="presentation">
      <div
        className="csModal csRenderPreviewCard"
        role="dialog"
        aria-modal="true"
        aria-label="渲染前预览"
      >
        <header className="csModalHeader">
          <div className="csModalHeaderText">
            <h2>渲染前先看一眼</h2>
            <p className="csModalHeaderMeta">
              <span>{meta?.width} × {meta?.height}</span>
              <span className="csModalHeaderMetaSep">·</span>
              <span>{fps}fps · {seconds}s</span>
              <span className="csModalHeaderMetaSep">·</span>
              <span>{request.manifest.tracks.length} 条轨道</span>
            </p>
          </div>
        </header>
        <div className="csModalBody csRenderPreviewStage">
          {/* 步进工具条：帧号 + 单帧/十帧 + 安全区开关。 */}
          <div className="csPreviewToolbar">
            <button type="button" className="csPreviewStepBtn" onClick={() => { seek(-COARSE_STEP) }} title="后退 10 帧（Shift+←）">«10</button>
            <button type="button" className="csPreviewStepBtn" onClick={() => { seek(-1) }} title="后退 1 帧（←）">‹1</button>
            <span className="csPreviewFrameChip" title="当前帧 / 末帧（←/→ 单帧，Shift 加速到 10 帧）">
              帧 {frame} <span className="csPreviewFrameTotal">/ {lastFrame}</span>
            </span>
            <button type="button" className="csPreviewStepBtn" onClick={() => { seek(1) }} title="前进 1 帧（→）">1›</button>
            <button type="button" className="csPreviewStepBtn" onClick={() => { seek(COARSE_STEP) }} title="前进 10 帧（Shift+→）">10»</button>
            <button
              type="button"
              className={guides ? 'csPreviewToggleBtn csPreviewToggleBtnOn' : 'csPreviewToggleBtn'}
              onClick={() => { setGuides((value) => !value) }}
              aria-pressed={guides}
              title="字幕安全区（左右 8% / 下 12%）与中心十字"
            >
              安全区
            </button>
          </div>
          <div className="csPreviewVideoArea">
            {draftUrl === null
              ? (
                <Player<AnyZodObject, { manifest: CompositionManifest }>
                  ref={playerRef}
                  component={StudioComposition}
                  inputProps={{ manifest: request.manifest }}
                  durationInFrames={durationInFrames}
                  fps={fps}
                  compositionWidth={meta?.width ?? 1920}
                  compositionHeight={meta?.height ?? 1080}
                  controls
                  loop
                  acknowledgeRemotionLicense
                  style={{ width: '100%' }}
                />
              )
              : (
                // 草稿成片：真实编码结果（含编码器对细节/渐变的实际处理），比 Player
                // 的实时渲染更接近交付观感，所以渲完就切成它。
                <video className="csPreviewDraftVideo" src={draftUrl} controls loop playsInline />
              )}
            {guides && draftUrl === null && (
              <div className="csPreviewGuides" aria-hidden="true">
                <div className="csPreviewGuideSafe" />
                <div className="csPreviewGuideCenterV" />
                <div className="csPreviewGuideCenterH" />
              </div>
            )}
          </div>
        </div>
        <div className="csModalFooter csRenderPreviewFooter">
          <div className="csRenderPreviewHintBlock">
            <p className="csRenderPreviewHint">
              这里是成片的真实画面（同一份 manifest、同一套组件）。
              渲染是一道十分钟量级的工单 —— 确认无误再开始，取消则不会占用它。
            </p>
            <div className="csRenderPreviewDraftRow">
              <button
                type="button"
                className="csPreviewStepBtn csPreviewDraftBtn"
                onClick={() => { void runDraft() }}
                disabled={draftProgress !== null}
                title="用草稿档（半分辨率 / 低码率）就地渲一版：不占工单、不落画布"
              >
                {draftProgress === null ? '草稿快渲一版' : `草稿渲中 ${Math.round(draftProgress * 100)}%`}
              </button>
              {draftUrl !== null && (
                <button
                  type="button"
                  className="csPreviewStepBtn"
                  onClick={() => { swapDraftUrl(null) }}
                >
                  回到实时预览
                </button>
              )}
              {draftError !== null && (
                <span className="csRenderPreviewDraftError" title={draftError}>草稿渲染失败：{draftError}</span>
              )}
            </div>
          </div>
          <div className="csRenderPreviewActions">
            <button
              type="button"
              className="csModalBtnSecondary"
              onClick={() => { resolveRenderPreview(request.jobId, false) }}
            >
              取消渲染
            </button>
            <button
              type="button"
              className="csModalBtnPrimary"
              onClick={() => { resolveRenderPreview(request.jobId, true) }}
            >
              开始渲染
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
