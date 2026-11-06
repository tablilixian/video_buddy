/**
 * Studio 三态组件（brand-identity-proposal.md §6）。
 *
 * - CanvasEmptyHint：有项目但画布无节点 —— 画布中心引导卡；
 * - StudioLoadingState：通用品牌加载卡（列表 / 画布载入）;
 * - StudioErrorState：错误三级处置（可重试 / 配置缺失 → 打开设置 / 服务不可达），
 *   分级走 src/error-kind.ts（纯函数，可单测）：有 `CS-*` 码时读注册表的 `uiKind`，
 *   无码才退回消息启发式。
 *
 * 2026-11-06（会话 18 §13）补第四级 `terminal` 与关闭出口：落地后的版本写操作是单向
 * 冻结，重试必然复发，而旧卡片只有「重试」一个按钮 ⇒ 用户被一张关不掉的卡挡住。
 * 「怎么渲染」不再写在这段 JSX 里，交给 `src/error-card-plan.ts` 的纯函数 —— 那条
 * 「终态永不渲染重试」的规则才能被断言守住，而不是靠断言源码里有没有某个三元。
 */
import type { ReactElement } from 'react'
import { Fragment } from 'react'
import { EMPTY_COPY, ERROR_COPY, LOADING_COPY } from '../../brand-copy.js'
import { errorCardPlan, type ErrorCardAction } from '../../error-card-plan.js'
import { classifyStudioFailure } from '../../error-kind.js'
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
  /** 原始错误消息（无错误码时用于兜底分级）。 */
  message: string
  /**
   * 结构化错误码（`CS-*`）。**有码时分级唯一依据就是它** —— 读注册表里该码声明的
   * `uiKind`；`message` 只在无码时可作启发式兜底（见 `classifyStudioFailure`）。
   */
  code?: string | undefined
  /** 重试回调。终态错误（`uiKind: 'terminal'`）不会渲染它 —— 重试必然复发。 */
  onRetry: () => void
  /** 打开设置回调（配置缺失时显示；不传则隐藏该按钮）。 */
  onOpenSettings?: () => void
  /**
   * 关闭回调：右上角 × 始终可用，终态错误另有一个「知道了」主按钮。
   * 不传 = 卡片没有关闭出口，只在「必须挡住用户」的极少数场景这么用。
   */
  onDismiss?: () => void
}

/** 计划里的 action → 按钮文案。`none` 不参与渲染，故不在此表。 */
const ACTION_LABEL: Record<'settings' | 'retry' | 'dismiss', string> = {
  settings: ERROR_COPY.openSettings,
  retry: ERROR_COPY.retry,
  dismiss: ERROR_COPY.dismiss,
}

/** 错误分级处置卡。C8：kind 映射到视觉分级（左缘色条 + 标题色 + 主按钮切换）。 */
export function StudioErrorState(props: StudioErrorStateProps): ReactElement {
  const { message, code, onRetry, onOpenSettings, onDismiss } = props
  const plan = errorCardPlan({
    kind: classifyStudioFailure(code, message),
    hasSettings: onOpenSettings !== undefined,
    hasDismiss: onDismiss !== undefined,
  })
  // 计划里的 action 一定对应一个可调用的处理器：缺回调的 action 根本不会进计划
  // （`errorCardPlan` 已按 hasSettings / hasDismiss 收口），这里的 `?? onRetry`
  // 只是让类型闭合，不承担语义。
  const handlers: Record<'settings' | 'retry' | 'dismiss', () => void> = {
    settings: onOpenSettings ?? onRetry,
    retry: onRetry,
    dismiss: onDismiss ?? onRetry,
  }
  const button = (action: ErrorCardAction, isPrimary: boolean): ReactElement | null => {
    if (action === 'none') return null
    return (
      <button
        key={action}
        type="button"
        className={isPrimary ? 'csErrorAction csErrorActionPrimary' : 'csErrorAction'}
        onClick={handlers[action]}
      >
        {ACTION_LABEL[action]}
      </button>
    )
  }
  return (
    <div className={`csErrorCard ${plan.className}`} role="alert">
      {plan.closable && (
        <button
          type="button"
          className="csErrorDismiss"
          aria-label={ERROR_COPY.closeLabel}
          title={ERROR_COPY.closeLabel}
          onClick={onDismiss}
        >
          ×
        </button>
      )}
      <p className="csErrorTitle">{plan.title}</p>
      <p className="csErrorMessage">{message}</p>
      {plan.hint === '' ? null : <p className="csErrorHint">{plan.hint}</p>}
      <div className="csErrorActions">
        {/* C8：主按钮随级切换 —— 缺配置的主行动是「去设置」（重试在没配置前必然复发），
            可重试 / 不可达的主行动是「重试」，终态是「知道了」（重试必然复发）。
            主按钮 = accent 实底，次按钮 = 描边。 */}
        {button(plan.primary, true)}
        {plan.secondary.map((action) => button(action, false))}
      </div>
    </div>
  )
}
