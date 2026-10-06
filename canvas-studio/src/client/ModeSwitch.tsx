/**
 * 执行模式开关（CV-196）—— 「逐步确认 / 放手跑」的**唯一实现**（画布顶部分段
 * 与设置页选项共用一套文案）。
 *
 * REQ-028 备注：首页输入框 v2 的执行模式 chip（LobbyModeChip）**不在**本组件
 * 承接 —— 那里是演示命名的另一张脸（「自动执行 / 询问执行」，见 lobby-spec.ts
 * 的 LOBBY_MODE_COPY），字段值与本组件同一对模式；拆开是刻意的，两处外观差异
 * 不只是壳（分段 vs chip），文案口径也不同源。
 *
 * 组件本身**不做任何确认弹窗**：切到放手跑要不要二次确认由调用方决定（画布顶部
 * 要 —— 用户可能正在跑流程）。
 */
import type { ReactElement } from 'react'
import type { StudioWorkflowMode } from '../contracts/project.js'

/** 两种模式的展示文案（bar 外观与设置页共读，改文案只改这里）。 */
export const MODE_COPY: Readonly<Record<StudioWorkflowMode, {
  /** 主词（chip 主行 / 分段按钮文字）。 */
  readonly main: string
  /** 副词（仅 chip 用；分段没有第二行的空间）。 */
  readonly sub: string
  /** 当前已是该模式时的提示（禁用按钮的 title）。 */
  readonly current: string
  /** 切过去的后果（非当前态按钮的 title）—— 两种模式各说清自己会带来什么。 */
  readonly switchTo: string
}>> = {
  confirm: {
    main: '逐步确认',
    sub: '每步确认',
    current: '当前已是逐步确认模式',
    switchTo: '每完成一步（剧本 / 分镜 / 关键帧）停下来等你确认',
  },
  auto: {
    main: '放手跑',
    sub: '一路到成片',
    current: '当前已是放手跑模式',
    switchTo: '不再询问，按默认规格直接跑到成片；思考前请确认项目规格已锁定',
  },
}

export interface ModeSwitchProps {
  /** 当前生效的模式（项目 workflow.mode）。 */
  readonly mode: StudioWorkflowMode
  /** 用户点了另一枚按钮。组件自己不做确认，由调用方决定是否先弹窗。 */
  onChange(mode: StudioWorkflowMode): void
  /** 忙碌中（创建中 / 切换中）禁用两枚按钮。 */
  readonly disabled?: boolean
  /** 无障碍分组名。 */
  readonly ariaLabel?: string
}

/** 两枚按钮的顺序（先保守后激进 —— 从左上到右下读过去是「加码」的方向）。 */
const MODES: readonly StudioWorkflowMode[] = ['confirm', 'auto']

export function ModeSwitch(props: ModeSwitchProps): ReactElement {
  const { mode, onChange, disabled = false, ariaLabel } = props

  return (
    <div className="csWorkflowMode" role="group" aria-label={ariaLabel ?? '执行模式'}>
      {MODES.map(value => (
        <button
          key={value}
          type="button"
          className={mode === value ? 'csActive' : ''}
          // 当前项禁用：点它没有动作，禁用比「点了没反应」诚实。
          disabled={disabled || mode === value}
          title={mode === value ? MODE_COPY[value].current : MODE_COPY[value].switchTo}
          onClick={() => { if (value !== mode) onChange(value) }}
        >
          {MODE_COPY[value].main}
        </button>
      ))}
    </div>
  )
}
