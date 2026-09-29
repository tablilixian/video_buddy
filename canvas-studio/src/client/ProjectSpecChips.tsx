/**
 * REQ-005 / D3：规格 chips（画幅 / 目标时长 / 执行模式）—— 新建项目弹窗（CV-182）
 * 那套受控控件的**唯一实现**，随弹窗删除整体搬到首页 LobbyComposer（CV-256）。
 *
 * ## 为什么整块搬而不是在首页另写一套
 *
 * 这三组是「封闭小集合」（画幅 4 枚 / 时长 5 枚 / 模式 2 枚），选项可以一眼看全、
 * 一点即选；两套实现 = 两份 `disabled` 判据、两份选中语义（`aria-pressed`）、两份
 * buildPlan 取数 —— 迟早分叉成「首页能选 1:1、弹窗不能」这类只有真机跑才发现的
 * 差异。抽成受控组件后，首页与（将来若要恢复的）任何表单共用同一份判定与文案。
 *
 * ## 受控而不是自持状态
 *
 * 草稿值由调用方持有（LobbyComposer 的 `spec` state）。理由：规格要和创意文本
 * 一起活到提交那一刻，而「提交失败保留草稿」要求值不随组件重挂丢失；也让
 * `buildPlan` 可以在提交前同步取到当前值，不必先 setState 再读。
 */
import type { ReactElement } from 'react'
import type { StudioPlanAspectRatio, StudioProjectPlan, StudioWorkflowMode } from '../contracts/project.js'
import { MAX_TARGET_DURATION } from '../contracts/project.js'
import { ModeSwitch } from './ModeSwitch.js'

/** CV-099：目标时长预设档位（秒）；另可自定义。 */
export const DURATION_PRESETS = [15, 30, 60] as const

/** CV-099：时长的「自定义」哨兵值（选中后展示数字输入框）。 */
export const DURATION_CUSTOM = 'custom'

/**
 * CV-099 / CV-182：画幅候选项（value 为空串 = 不锁定，沿用旧行为）。
 *
 * 选项是封闭小集合，摊开成四个 chip 比藏进下拉更好选。`1:1` 的代价（仅图片工具
 * 支持）走字段下方的提示条，不占 chip 的位置。
 */
export const ASPECT_OPTIONS: ReadonlyArray<{ value: string; short: string; hint: string }> = [
  { value: '', short: '不锁定', hint: 'AI 确认' },
  { value: '16:9', short: '16:9', hint: '横屏' },
  { value: '9:16', short: '9:16', hint: '竖屏' },
  { value: '1:1', short: '1:1', hint: '方形' },
]

/**
 * 规格草稿：画幅 / 时长（含自定义秒数）/ 执行模式。
 *
 * 空串语义与弹窗一致 —— 画幅与时长的空串 = 「不锁定」（不落 plan 字段）；模式
 * **没有**不锁定档（`workflow.mode` 必须有确定值），「跟随设置」由初值等于设置页
 * 默认值来表达，不引入第三种状态（CV-196 的口径原样沿用）。
 */
export interface ProjectSpecDraft {
  /** 画幅：`''` = 不锁定，否则 `16:9` / `9:16` / `1:1`。 */
  readonly aspect: string
  /** 目标时长：`''` = 不锁定、数字串 = 秒、`'custom'` = 读 durationCustom。 */
  readonly duration: string
  /** duration === 'custom' 时的秒数草稿（未填 / 非法则该项被丢弃）。 */
  readonly durationCustom: string
  readonly mode: StudioWorkflowMode
}

/**
 * CV-099：把草稿组装成预置规格。
 *
 * 两项都未选时返回 undefined（未锁定，走旧行为）；自定义秒数非法（非数字 / 负数 /
 * 超上限）时**该项被丢弃**而不是让创建失败 —— 规格是伴随参数，不该拦住开工。
 */
export function buildPlan(spec: ProjectSpecDraft): StudioProjectPlan | undefined {
  const plan: StudioProjectPlan = {}
  if (spec.aspect !== '') plan.aspectRatio = spec.aspect as StudioPlanAspectRatio
  const seconds = Number.parseInt(spec.duration === DURATION_CUSTOM ? spec.durationCustom : spec.duration, 10)
  if (Number.isFinite(seconds) && seconds > 0) plan.targetDuration = Math.min(MAX_TARGET_DURATION, seconds)
  return plan.aspectRatio === undefined && plan.targetDuration === undefined ? undefined : plan
}

export interface ProjectSpecChipsProps {
  readonly value: ProjectSpecDraft
  /** 创建中：全部控件禁用（与输入框同一把锁）。 */
  readonly disabled?: boolean
  onChange(next: ProjectSpecDraft): void
}

/** 三组规格的受控控件（画幅 / 目标时长 / 执行模式），分组下拉由调用方自行拼接。 */
export function ProjectSpecChips(props: ProjectSpecChipsProps): ReactElement {
  const { value, disabled = false, onChange } = props
  const patch = (part: Partial<ProjectSpecDraft>): void => onChange({ ...value, ...part })
  return (
    // 根节点不产生盒子（styles.ts `.csSpecChips { display: contents }`）：三个
    // .csSpecGroup 直接成为调用方 flex 容器的子项，规格行才是一整行。
    <div className="csSpecChips">
      <div className="csSpecGroup">
        <span className="csSpecLabel" id="cs-spec-aspect-label">画幅</span>
        <div className="csChoiceRow" role="group" aria-labelledby="cs-spec-aspect-label">
          {ASPECT_OPTIONS.map(option => (
            <button
              key={option.value === '' ? 'auto' : option.value}
              type="button"
              className="csChoice"
              // 选中态走 aria-pressed：语义照进 DOM，样式只读这一个来源。
              aria-pressed={value.aspect === option.value}
              disabled={disabled}
              onClick={() => patch({ aspect: option.value })}
            >
              <span className="csChoiceMain">{option.short}</span>
              <span className="csChoiceSub">{option.hint}</span>
            </button>
          ))}
        </div>
        {value.aspect === '1:1' && (
          <p className="csCreateNote">1:1 仅图片工具支持，生成视频时会自动降级为 16:9。</p>
        )}
      </div>
      <div className="csSpecGroup">
        <span className="csSpecLabel" id="cs-spec-duration-label">目标时长</span>
        <div className="csChoiceRow" role="group" aria-labelledby="cs-spec-duration-label">
          <button
            type="button"
            className="csChoice"
            aria-pressed={value.duration === ''}
            disabled={disabled}
            onClick={() => patch({ duration: '' })}
          >
            <span className="csChoiceMain">不锁定</span>
            <span className="csChoiceSub">AI 确认</span>
          </button>
          {DURATION_PRESETS.map(seconds => (
            <button
              key={seconds}
              type="button"
              className="csChoice"
              aria-pressed={value.duration === String(seconds)}
              disabled={disabled}
              onClick={() => patch({ duration: String(seconds) })}
            >
              <span className="csChoiceMain">{seconds}</span>
              <span className="csChoiceSub">秒</span>
            </button>
          ))}
          <button
            type="button"
            className="csChoice"
            aria-pressed={value.duration === DURATION_CUSTOM}
            disabled={disabled}
            onClick={() => patch({ duration: DURATION_CUSTOM })}
          >
            <span className="csChoiceMain">自定义</span>
            <span className="csChoiceSub">手填</span>
          </button>
        </div>
        {value.duration === DURATION_CUSTOM && (
          <input
            className="csFieldInput csSpecInlineInput"
            type="number"
            min={1}
            max={MAX_TARGET_DURATION}
            placeholder="秒"
            value={value.durationCustom}
            disabled={disabled}
            onChange={(event) => patch({ durationCustom: event.target.value })}
          />
        )}
      </div>
      <div className="csSpecGroup">
        <span className="csSpecLabel" id="cs-spec-mode-label">执行模式</span>
        <ModeSwitch
          variant="choice"
          mode={value.mode}
          disabled={disabled}
          labelledBy="cs-spec-mode-label"
          onChange={(mode) => patch({ mode })}
        />
      </div>
    </div>
  )
}
