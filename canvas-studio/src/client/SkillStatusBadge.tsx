/**
 * CV-332：用户 skill 的「生效状态」呈现。
 *
 * ## 为什么单独一个组件
 *
 * 用户上传后最常问的是「**我传了为什么没用**」。这句问话背后有三种完全不同的成因，
 * 处置也完全不同：
 *
 * | 现象 | 真因 | 用户该做什么 |
 * |---|---|---|
 * | 已生效 | — | 没事 |
 * | 未装载 | 模型能看到，但不一定会用 | 点「装载」 |
 * | 有冲突 | 同名条目赢了它 | 改 `frontmatter.name` 重传 |
 * | 扫描中 | 上游发现还没跑完（≤300ms） | **等**（不是失败） |
 * | 未进列表 | frontmatter 被上游丢弃 | 查导入时的提示 |
 *
 * 前四种里任何一种被含糊成一句「未生效」，用户就只能在三种错的方向里瞎试。
 * 所以这里的判据**全部来自 Host**（`SkillListItem.status` / `catalogState`），
 * 组件只负责翻译成人话 —— 前端不重算规则，否则两处判定必然漂移。
 *
 * ## ⚠️「扫描中」不是失败
 *
 * 落盘完成 ≠ 立即可见：上游 Chokidar 需要 ≤ ~300ms 才更新 catalog。此时
 * `snapshot()` 返回 `complete: false`（**发现未完成**，上游注释原文：incomplete
 * observations are never cached）。把这一态显示成红字 = 每次导入都先闪一次假失败。
 */
import type { ReactElement } from 'react'
import type { SkillListItem } from '../contracts/skill.js'
import { RichText, plainText } from './rich-text.js'

export interface SkillStatusBadgeProps {
  readonly item: SkillListItem
  /** 紧凑模式（卡片上用，只出一个小标）；缺省是详情卡里的完整条。 */
  readonly compact?: boolean
}

/** 状态 → 展示三要素（标记 / 短标签 / 解释）。 */
function describe(item: SkillListItem): { mark: string; label: string; detail: string } {
  // ① 上游扫描未完成：**优先于一切**，此时 status 不可信（catalog 还没跑完）。
  if (item.catalogState === 'unknown') {
    return {
      mark: '…',
      label: '扫描中',
      detail: '已写入磁盘，正在等模型侧刷新技能目录（通常不到一秒）。稍等片刻即可。',
    }
  }
  // ② complete 却是 missing：上游确实没接它 —— 多半 frontmatter 不合法被整条丢弃。
  if (item.catalogState === 'missing') {
    return {
      mark: '⛔',
      label: '未进入模型列表',
      detail: '条目已落盘，但模型侧目录里没有它 —— 通常是 frontmatter 不合法（缺 name / description，'
        + '或用了已废弃的驼峰键）被整条丢弃。请按导入时的提示修正后重新导入。',
    }
  }
  // ③ 同名但赢家不是它。
  if (item.status === 'conflict') {
    return {
      mark: '⛔',
      label: '有冲突',
      detail: `与 \`${item.conflictWith ?? '同名条目'}\` 同名，对方优先（内置与项目级都高于用户级）`
        + '—— 你的这条不会生效。改 frontmatter 的 `name` 后重传即可。',
    }
  }
  if (item.status === 'active') {
    return {
      mark: '✓',
      label: '已生效',
      detail: '模型可用，且本项目已装载 —— 本项目的任务提示词会带上它。',
    }
  }
  return {
    mark: '⚠️',
    label: '未装载',
    detail: '模型能看到它，但**不一定会用**。点「装载」（画布顶条的技能 chip）后，本项目的任务会按它写。',
  }
}

/** 状态标记的样式类（与短标签同一套判定，不重复计算规则）。 */
export function statusClassName(item: SkillListItem): string {
  if (item.catalogState === 'unknown') return 'isPending'
  if (item.catalogState === 'missing' || item.status === 'conflict') return 'isBad'
  return item.status === 'active' ? 'isGood' : 'isWarn'
}

/** 生效状态条（详情卡 + 卡片角标共用同一份判据）。 */
export function SkillStatusBadge(props: SkillStatusBadgeProps): ReactElement {
  const { item, compact } = props
  const view = describe(item)
  const className = `csSkillStatus ${statusClassName(item)}`
  if (compact === true) {
    // 紧凑模式放不下正文，`detail` 只能进 `title` —— 属性值是纯字符串，
    // 标记在那里不会被渲染，所以要先还原成纯文本（否则提示里是一串反引号）。
    return (
      <span className={className} title={plainText(view.detail)}>
        {view.mark} {view.label}
      </span>
    )
  }
  return (
    <div className={`${className} csSkillStatusFull`}>
      <span className="csSkillStatusLabel">{view.mark} {view.label}</span>
      <span className="csSkillStatusDetail"><RichText text={view.detail} /></span>
    </div>
  )
}
