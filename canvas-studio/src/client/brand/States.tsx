/**
 * Studio 三态组件 + 首启欢迎屏（brand-identity-proposal.md §6）。
 *
 * - StudioEmptyState：首启欢迎屏（无任何项目时画布区）—— 品牌 logo + 定位句 +
 *   双 CTA（新建项目 / 创建示例项目）；
 * - CanvasEmptyHint：有项目但画布无节点 —— 画布中心引导卡；
 * - StudioLoadingState：通用品牌加载卡（列表 / 画布载入）;
 * - StudioErrorState：错误三级处置（可重试 / 配置缺失 → 打开设置 / 服务不可达），
 *   分类逻辑在 src/error-kind.ts（纯函数，可单测）。
 */
import type { ReactElement } from 'react'
import { BRAND, EMPTY_COPY, ERROR_COPY, LOADING_COPY } from '../../brand-copy.js'
import { classifyStudioError } from '../../error-kind.js'
import { LogoMark } from './LogoMark.js'

export interface StudioEmptyStateProps {
  /** 新建项目（打开左侧新建表单的上级回调）。 */
  onCreate: () => void
  /** 创建示例项目（apply 世界：建项目 + 预置画布节点）。 */
  onCreateSample: () => void
  /** 示例项目创建中。 */
  creating: boolean
}

/** 首启欢迎屏（画布区）。 */
export function StudioEmptyState(props: StudioEmptyStateProps): ReactElement {
  const { onCreate, onCreateSample, creating } = props
  return (
    <div className="csWelcome">
      <div className="csWelcomeCard">
        <LogoMark size={44} />
        <h1 className="csWelcomeTitle">{BRAND.name}<span className="csWelcomeNameZh">{BRAND.nameZh}</span></h1>
        <p className="csWelcomeTagline">{BRAND.tagline}</p>
        <p className="csWelcomePositioning">{BRAND.positioningFull}</p>
        <div className="csWelcomeActions">
          <button type="button" className="csPrimary" onClick={onCreate}>+ {EMPTY_COPY.createProject}</button>
          <button type="button" className="csWelcomeSample" disabled={creating} onClick={onCreateSample}>
            {creating ? '创建中…' : EMPTY_COPY.createSample}
          </button>
        </div>
        <p className="csWelcomeSampleHint">{EMPTY_COPY.sampleHint}</p>
      </div>
    </div>
  )
}

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
