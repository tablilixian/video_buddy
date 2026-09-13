/**
 * Studio 三态组件（brand-identity-proposal.md §6）。
 *
 * - CanvasEmptyHint：有项目但画布无节点 —— 画布中心引导卡；
 * - StudioLoadingState：通用品牌加载卡（列表 / 画布载入）;
 * - StudioErrorState：错误三级处置（可重试 / 配置缺失 → 打开设置 / 服务不可达），
 *   分类逻辑在 src/error-kind.ts（纯函数，可单测）。
 */
import type { ReactElement } from 'react'
import { Fragment } from 'react'
import { EMPTY_COPY, ERROR_COPY, LOADING_COPY } from '../../brand-copy.js'
import { classifyStudioError } from '../../error-kind.js'
import { LogoMark } from './LogoMark.js'

/** 幽灵流水线站点（DD-06：分镜 → 定妆 → 镜头 → 成片，静态极淡预演）。 */
const GHOST_PIPELINE_STAGES = ['分镜', '定妆', '镜头', '成片'] as const

/** 有项目但画布无节点：画布中心引导卡（pointer-events none，不挡画布交互）。 */
export function CanvasEmptyHint(): ReactElement {
  return (
    <div className="csCanvasEmptyHint">
      <p className="csCanvasEmptyHintTitle">{EMPTY_COPY.canvasEmptyTitle}</p>
      <p className="csCanvasEmptyHintText">{EMPTY_COPY.canvasEmptyHint}</p>
      {/* C8（DD-06）：空态「预演」—— 一条极淡的幽灵流水线，一眼看懂工具干什么。 */}
      <div className="csGhostPipeline" aria-hidden="true">
        {GHOST_PIPELINE_STAGES.map((stage, i) => (
          <Fragment key={stage}>
            {i > 0 && <span className="csGhostLink" />}
            <span className={i === GHOST_PIPELINE_STAGES.length - 1 ? 'csGhostNode csGhostNodeFinal' : 'csGhostNode'}>
              {stage}
            </span>
          </Fragment>
        ))}
      </div>
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

/** 错误三级处置卡。C8：kind 映射到视觉分级（左缘色条 + 标题色 + 主按钮切换）。 */
export function StudioErrorState(props: StudioErrorStateProps): ReactElement {
  const { message, onRetry, onOpenSettings } = props
  const kind = classifyStudioError(message)
  const isConfig = kind === 'config'
  const isUnreachable = kind === 'unreachable'
  const kindClass = isConfig ? 'csErrorKindConfig' : isUnreachable ? 'csErrorKindUnreachable' : 'csErrorKindRetryable'
  return (
    <div className={`csErrorCard ${kindClass}`} role="alert">
      <p className="csErrorTitle">
        {isConfig ? ERROR_COPY.configTitle : isUnreachable ? ERROR_COPY.unreachableTitle : ERROR_COPY.retryable}
      </p>
      <p className="csErrorMessage">{message}</p>
      <p className="csErrorHint">{isConfig ? ERROR_COPY.configHint : isUnreachable ? ERROR_COPY.unreachableHint : ''}</p>
      <div className="csErrorActions">
        {/* C8：主按钮随级切换 —— 缺配置的主行动是「去设置」（重试在没配置前必然复发），
            其余两级主行动是「重试」。主按钮 = accent 实底，次按钮 = 描边。 */}
        {isConfig && onOpenSettings !== undefined && (
          <button type="button" className="csErrorAction csErrorActionPrimary" onClick={onOpenSettings}>
            {ERROR_COPY.openSettings}
          </button>
        )}
        <button
          type="button"
          className={isConfig && onOpenSettings !== undefined ? 'csErrorAction' : 'csErrorAction csErrorActionPrimary'}
          onClick={onRetry}
        >
          {ERROR_COPY.retry}
        </button>
      </div>
    </div>
  )
}
