/**
 * 技能广场卡片（CV-065）。
 *
 * 「使用」的语义是**把提示词插进对话输入框**，不是自动发送、也不是把
 * SKILL.md 塞进 system prompt。理由：
 * 1. 不伪造已生效 —— 用户不改、不回车，就什么都没发生（reserved 字段原则）；
 * 2. 不污染 agent 决策 —— 让模型自己决定要不要 `skill(name=X)` 加载正文；
 * 3. 复用画布已验证的 `insertReferenceToken` 通路（@ref 引用走同一条）。
 *
 * CV-070：卡片头图**默认显示**动态演示 GIF（assets/style-demos，路由
 * /canvas-studio/style-demos 托管）——不再依赖 hover 才注入；无 demo 的
 * skill 回退静态渐变。hover 只在缩略图上叠加操作菜单（不切换动图）。
 * CV-071：hover 浮层「查看详情/使用」按钮（详情弹窗由广场承载）。
 * CV-076：左上角 H3 badge（真实信息：该 skill 基于 H3 技术路线）。
 */
import type { ReactElement } from 'react'
import type { SkillCatalogEntry } from '../skill-catalog.js'
import { SKILL_CATEGORY_LABELS } from '../skill-catalog.js'
import type { SkillListItem, SkillOrigin } from '../contracts/skill.js'
import { SkillIcon } from './SkillIcon.js'
import { SkillStatusBadge } from './SkillStatusBadge.js'

export interface SkillCardProps {
  entry: SkillCatalogEntry
  /** 点「使用」：把技能提示词插入对话输入框。 */
  onActivate: (entry: SkillCatalogEntry) => void
  /** CV-071：点「查看详情」打开详情弹窗（广场承载；缺省不渲染入口）。 */
  onDetail?: (entry: SkillCatalogEntry) => void
  /**
   * CV-332：来源角标（缺省不渲染）。
   *
   * 只在**混排视图**里传：「我的技能」是独立分组，分组内再给每张卡打「我的」
   * 是纯噪声。角标解决的是「在一堆官方技能里一眼认出自己那份」。
   */
  origin?: SkillOrigin
  /** CV-332：用户条目的生效状态（紧凑徽标，放卡片尾部）。 */
  statusItem?: SkillListItem
  /** CV-332：删除该用户条目（hover 菜单里出现）。 */
  onDelete?: () => void
}

/** 缩略图渐变：由色相现算，明暗主题自适应（不用硬编码色值）。 */
function thumbStyle(hue: number): Record<string, string> {
  return {
    background: `linear-gradient(135deg, hsl(${hue} 70% 56%), hsl(${(hue + 42) % 360} 62% 42%))`,
  }
}

/** 单张技能卡：缩略图（默认动态演示）+ hover 操作菜单 + 标题 + 说明 + 分类 chip + 使用按钮。 */
export function SkillCard(props: SkillCardProps): ReactElement {
  const { entry, onActivate, onDetail, origin, statusItem, onDelete } = props
  // CV-070：有 demo 就**默认显示**动图（不依赖 hover）；hover 由 CSS 叠加菜单。
  const showDemo = entry.demo !== undefined
  return (
    <article className="csSkillCard">
      <div className="csSkillThumb" style={thumbStyle(entry.hue)}>
        <SkillIcon id={entry.icon} size={26} />
        {showDemo && (
          <img
            className="csSkillThumbGif"
            src={`/canvas-studio/style-demos/${entry.demo}`}
            alt=""
            draggable={false}
            loading="lazy"
          />
        )}
        {/* CV-076：H3 能力角标（真实信息，非装饰）。 */}
        {entry.h3 === true && <span className="csSkillH3" title="基于 H3 技术路线（音视频联合生成）">H3</span>}
        {/* CV-118 语义修订（2026-09-09）：试跑期技能上广场带「试跑」角标（右上角）。 */}
        {entry.stage === 'preview' && <span className="csSkillPreviewBadge" title="试跑期技能：功能可用，尚未转正">试跑</span>}
        {/* CV-332：来源角标放**左下** —— H3 在左上、试跑在右上，左下零碰撞
            （效果图里做过矩形相交断言 + 反向对照）。 */}
        {origin !== undefined && (
          <span className={origin === 'user' ? 'csSkillSource csSkillSourceMine' : 'csSkillSource'}>
            {origin === 'user' ? '我的' : '官方'}
          </span>
        )}
        {/* CV-071：hover 浮层操作菜单（默认动图之上叠加；不切换动图）。 */}
        <div className="csSkillHover">
          <button
            type="button"
            className="csSkillHoverBtn"
            onClick={() => { onActivate(entry) }}
          >
            使用
          </button>
          {onDetail !== undefined && (
            <button
              type="button"
              className="csSkillHoverBtn csSkillHoverGhost"
              onClick={() => { onDetail(entry) }}
            >
              查看详情
            </button>
          )}
          {onDelete !== undefined && (
            <button
              type="button"
              className="csSkillHoverBtn csSkillHoverDanger"
              onClick={() => { onDelete() }}
            >
              删除
            </button>
          )}
        </div>
      </div>
      <div className="csSkillBody">
        <h3 className="csSkillTitle">{entry.title}</h3>
        <p className="csSkillSummary">{entry.summary}</p>
        <div className="csSkillFoot">
          <span className="csSkillCategory">{SKILL_CATEGORY_LABELS[entry.category]}</span>
          {statusItem !== undefined && <SkillStatusBadge item={statusItem} compact />}
          <button type="button" className="csSkillUse" onClick={() => { onActivate(entry) }}>
            使用
          </button>
        </div>
      </div>
    </article>
  )
}
