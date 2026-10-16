/**
 * CV-334 · B3.3：**渲染前只读预览**面板。
 *
 * 只读（不提供任何编辑）、不落库（manifest 仍是一次性入参）、不改动 manifest 本身 ——
 * 它只是把「马上要被渲染的那份画面」提前放给用户看一眼。闸门状态机在
 * `./render-preview.js`，本文件只负责画。
 *
 * ⚠️ 本模块顶层 import 了 `@remotion/player`（重依赖）。挂载侧必须**惰性加载**它 ——
 * 与 `remotion-render.js` 同一条纪律：不能让这些库在插件 boot 时就初始化。
 */
import type { AnyZodObject } from 'remotion'
import { Player } from '@remotion/player'
import { StudioComposition } from '../remotion/components/Root.js'
import type { CompositionManifest } from '../remotion/manifest.js'
import { getRenderPreviewSnapshot, resolveRenderPreview, subscribeRenderPreview } from './render-preview.js'
import { useSyncExternalStore } from 'react'

export function RenderPreviewOverlay() {
  const request = useSyncExternalStore(
    (onChange) => subscribeRenderPreview(() => { onChange() }),
    getRenderPreviewSnapshot,
  )
  if (request === null) return null
  const { meta } = request.manifest
  const durationInFrames = Math.max(1, Math.round(meta.durationInFrames))
  const fps = meta.fps > 0 ? meta.fps : 30
  const seconds = (durationInFrames / fps).toFixed(1)
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
              <span>{meta.width} × {meta.height}</span>
              <span className="csModalHeaderMetaSep">·</span>
              <span>{fps}fps · {seconds}s</span>
              <span className="csModalHeaderMetaSep">·</span>
              <span>{request.manifest.tracks.length} 条轨道</span>
            </p>
          </div>
        </header>
        <div className="csModalBody csRenderPreviewStage">
          <Player<AnyZodObject, { manifest: CompositionManifest }>
            component={StudioComposition}
            inputProps={{ manifest: request.manifest }}
            durationInFrames={durationInFrames}
            fps={fps}
            compositionWidth={meta.width}
            compositionHeight={meta.height}
            controls
            loop
            acknowledgeRemotionLicense
            style={{ width: '100%' }}
          />
        </div>
        <div className="csModalFooter csRenderPreviewFooter">
          <p className="csRenderPreviewHint">
            这里是成片的真实画面（同一份 manifest、同一套组件）。
            渲染是一道十分钟量级的工单 —— 确认无误再开始，取消则不会占用它。
          </p>
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
