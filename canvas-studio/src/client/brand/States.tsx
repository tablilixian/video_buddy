/**
 * Studio 三态组件（brand-identity-proposal.md §6）。
 *
 * - CanvasEmptyHint：有项目但画布无节点 —— 画布中心引导卡；
 * - StudioLoadingState：通用品牌加载卡（列表 / 画布载入）;
 * - StudioErrorState：错误三级处置（可重试 / 配置缺失 → 打开设置 / 服务不可达），
 *   分类逻辑在 src/error-kind.ts（纯函数，可单测）。
 */
import type { ReactElement } from 'react'
import { EMPTY_COPY, ERROR_COPY, LOADING_COPY } from '../../brand-copy.js'
import { classifyStudioError } from '../../error-kind.js'
import { LogoMark } from './LogoMark.js'

/** 有项目但画布无节点：画布中心引导卡（pointer-events none，不挡画布交互）。 */
export function CanvasEmptyHint(): ReactElement {
  return (
    <div className="csCanvasEmptyHint">
      <p className="csCanvasEmptyHintTitle">{EMPTY_COPY.canvasEmptyTitle}</p>
      <p className="csCanvasEmptyHintText">{EMPTY_COPY.canvasEmptyHint}</p>
    </div>
  )
}

export interface StudioLoadingStateProps {
  /** 加载文案（默认「正在加载项目…」）。 */
  label?: string
}

/** 通用品牌加载卡（骨架感：logo 微光 + 文案）。 */
export function StudioLoadingState(props: StudioLoadingStateProps): ReactElement {
  const { label = LOADING_COPY.projects } = props
  return (
    <div className="csLoadingCard" role="status" aria-live="polite">
      <LogoMark size={26} className="csLogoMark csLogoMarkPulse" />
      <span className="csLoadingText">{label}</span>
    </div>
  )
}

export interface StudioErrorStateProps {
  /** 原始错误消息（用于启发式分级）。 */
  message: string
  /** 重试回调。 */
  onRetry: () => void
  /** 打开设置回调（配置缺失时显示；不传则隐藏该按钮）。 */
  onOpenSettings?: () => void
}

/** 错误三级处置卡。 */
export function StudioErrorState(props: StudioErrorStateProps): ReactElement {
  const { message, onRetry, onOpenSettings } = props
  const kind = classifyStudioError(message)
  const isConfig = kind === 'config'
  const isUnreachable = kind === 'unreachable'
  return (
    <div className="csErrorCard" role="alert">
      <p className="csErrorTitle">
        {isConfig ? ERROR_COPY.configTitle : isUnreachable ? ERROR_COPY.unreachableTitle : ERROR_COPY.retryable}
      </p>
      <p className="csErrorMessage">{message}</p>
      <p className="csErrorHint">{isConfig ? ERROR_COPY.configHint : isUnreachable ? ERROR_COPY.unreachableHint : ''}</p>
      <div className="csErrorActions">
        {isConfig && onOpenSettings !== undefined && (
          <button type="button" className="csErrorAction" onClick={onOpenSettings}>{ERROR_COPY.openSettings}</button>
        )}
        <button type="button" className="csErrorAction csErrorActionPrimary" onClick={onRetry}>{ERROR_COPY.retry}</button>
      </div>
    </div>
  )
}
