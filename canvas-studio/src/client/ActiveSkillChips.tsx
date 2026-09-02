/**
 * work 态「已装载技能」chip 行（CV-066 Phase D）。
 *
 * 展示当前项目 activeSkills 里装载的 skill（标题取 catalog 元数据，未收录
 * 时显示注册名 —— 新增 skill 忘补表不空白）。每个 chip 带 × 可卸载，空态
 * 隐藏整行（调用方条件渲染，本组件不做空态占位）。
 */
import type { ReactElement } from 'react'
import { getSkillEntry } from '../skill-catalog.js'

export interface ActiveSkillChipsProps {
  /** 已装载的 skill 注册名（顺序即装载顺序）。 */
  skills: readonly string[]
  /** 卸载一个 skill。 */
  onRemove: (name: string) => void
}

/** work 态工作流条下方一行：已装载技能 chips。 */
export function ActiveSkillChips(props: ActiveSkillChipsProps): ReactElement {
  const { skills, onRemove } = props
  return (
    <div className="csSkillChips" role="group" aria-label="已装载技能">
      <span className="csSkillChipsLabel">已装载</span>
      {skills.map(name => {
        const entry = getSkillEntry(name)
        return (
          <span className="csSkillChip" key={name}>
            <span className="csSkillChipName">{entry?.title ?? name}</span>
            <button
              type="button"
              className="csSkillChipRemove"
              title={`卸载「${entry?.title ?? name}」`}
              aria-label={`卸载 ${entry?.title ?? name}`}
              onClick={() => { onRemove(name) }}
            >
              ×
            </button>
          </span>
        )
      })}
    </div>
  )
}
