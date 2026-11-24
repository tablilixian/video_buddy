/**
 * REQ-040 A 期：历程视图状态条（画布顶部悬浮的进度层）。
 *
 * Demo（canvas-waterfall-demo-2026-10-26）顶栏的落地版：
 *   第一行 = 全局进度条（done/total）+ 活动行（「镜 3 · 仓库特写」）+ 开关组；
 *   第二行 = 阶段 chips（n/m + done/running/fail 三态着色，点击滚动定位到节）。
 *
 * 数据全部来自 `computeWaterfallLayout` 的只读产出（stats / activity / sections），
 * 本组件零状态、零派生 —— 「谁在生成」的唯一事实源仍是布局函数（节点瞬态字段）。
 * 显隐由 CanvasSurface 控制：仅历程模式且画布非空时挂载。
 *
 * 开关组三枚（都是 aria-pressed 的 pill toggle）：
 *   - 文本类 → view.waterfallShowText（REQ-036 拍板的缺省隐藏，此前无 UI 入口）；
 *   - 辅助卡 → 宿主 showAuxiliary 状态（与自由画布共用同一份，A 期工具栏图标
 *     已隐藏，这里是该开关在历程模式下的唯一入口）；
 *   - 跟随新产出 → 会话内状态（默认开），新节点进入生成态时自动带进视野。
 */
import type { ReactElement } from 'react'
import type { WaterfallSection, WaterfallStage, WaterfallStats } from '../../canvas-waterfall.js'

/** Props for the waterfall status bar (REQ-040 A). */
export interface WaterfallStatusBarProps {
  /** 全局生成状态统计（布局产出）。 */
  stats: WaterfallStats
  /** 非空节（chips 数据源，布局产出顺序）。 */
  sections: readonly WaterfallSection[]
  /** 镜数（= 布局产出的托盘数，渲染层派生）。REQ-036 一行一镜（2026-11-24）：
   *  分镜 chip 不再显示 `done/total`（节点数会被读成「N 个分镜」），改显示镜数。 */
  shotCount: number
  /** 活动行文案（布局产出；null = 空闲）。 */
  activity: string | null
  /** 「文本类」开关现值（view.waterfallShowText）。 */
  showText: boolean
  /** 「辅助卡」开关现值（宿主 showAuxiliary）。 */
  showAuxiliary: boolean
  /** 「跟随新产出」开关现值（会话内状态）。 */
  followNew: boolean
  onToggleShowText(): void
  onToggleShowAuxiliary(): void
  onToggleFollow(): void
  /** 点击阶段 chip：把对应节带进视野（CanvasSurface 复用 revealNodesOrFit）。 */
  onRevealSection(stage: WaterfallStage): void
}

/** chip 三态类名：失败 > 生成中 > 已完成 > 中性。 */
function chipStateClass(section: WaterfallSection): string {
  if (section.stats.failed > 0) return ' csWfBarChipFail'
  if (section.stats.running > 0) return ' csWfBarChipRunning'
  if (section.stats.total > 0 && section.stats.done === section.stats.total) return ' csWfBarChipDone'
  return ''
}

export function WaterfallStatusBar(props: WaterfallStatusBarProps): ReactElement {
  const { stats, sections, shotCount, activity, showText, showAuxiliary, followNew, onToggleShowText, onToggleShowAuxiliary, onToggleFollow, onRevealSection } = props
  const pct = stats.total > 0 ? Math.round((stats.done / stats.total) * 100) : 0
  return (
    <div className="csWfBar">
      <div className="csWfBarRow">
        <div className="csWfBarTrack" aria-hidden="true">
          <i style={{ width: `${pct}%` }} />
        </div>
        <span className="csWfBarNum">
          {stats.done}/{stats.total}
          {stats.failed > 0 ? ` · ${stats.failed} 失败` : ''}
        </span>
        {activity !== null && <span className="csWfBarActivity">{activity}</span>}
        <div className="csWfBarSwitches">
          <button
            type="button"
            className="csWfBarSwitch"
            aria-pressed={showText}
            title="显示/隐藏纯文本类节点（创意需求 / 剧本 / 口播文案 / 便签）"
            onClick={onToggleShowText}
          >
            文本类
          </button>
          <button
            type="button"
            className="csWfBarSwitch"
            aria-pressed={showAuxiliary}
            title="显示/隐藏辅助卡（末帧等机器衔接用卡）"
            onClick={onToggleShowAuxiliary}
          >
            辅助卡
          </button>
          <button
            type="button"
            className="csWfBarSwitch"
            aria-pressed={followNew}
            title="新节点开始生成时自动滚动定位（当前会话内生效）"
            onClick={onToggleFollow}
          >
            跟随新产出
          </button>
        </div>
      </div>
      {sections.length > 0 && (
        <div className="csWfBarRow csWfBarChips">
          {sections.map(section => (
            <button
              key={section.stage}
              type="button"
              className={`csWfBarChip${chipStateClass(section)}`}
              title={`跳到「${section.title}」节`}
              onClick={() => { onRevealSection(section.stage) }}
            >
              <span className="csWfBarDot" aria-hidden="true" />
              {/* 分镜 chip 说「镜」，其余节仍说 done/total（REQ-036 §4.8：同一个词
                  「分镜」在故事板里指场数，这里若继续打节点数会被读成镜数）。 */}
              {section.stage === 'shots' ? `${section.title} ${shotCount} 镜` : `${section.title} ${section.stats.done}/${section.stats.total}`}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
