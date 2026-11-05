/**
 * P1-1 · 里程碑状态行 —— **内部验收件，默认不渲染**（2026-11-05 拍板）。
 *
 * ## 为什么不给用户看
 * 用户只在乎能不能拿到结果。「距硬线剩 6:36」对他是噪音，超线变红更糟 ——
 * 那等于在替他数我们没做到。产品形态是画布上的产物卡本身：有卡可点就是有结果。
 * ⇒ 只有 `localStorage['canvas-studio.milestone'] = '1'`（或已开的
 * `canvas-studio.dev`）时才挂载。默认页面上**一个字都不多**。
 *
 * ## 为什么挂在工作条里，而不是浮层
 * 工作条（`StudioFrame` 的 `csWorkflowBar`）已经在报「已产出 12 个节点 · 阶段 分镜」，
 * 加「距 M1 剩 6:36」是同一件事的时间维度，用户/我们自己一眼能对上。做成浮层的话，
 * 画布上会同时挂三个固定条（工作条 + 本条 + `RenderProgressBadge` 的 z-25 角标）。
 *
 * ## 数据全部来自既有 `workflow`
 * `landedAt` / `firstDraftAt` 本来就是客户端 `api.ts` 投影里的字段，所以**不新增
 * HTTP 路由**、不读磁盘、不碰 `build/`。锚点版本号（v3 · 45.0s · 78 轨）留在
 * `build/PROGRESS.md` 里给 agent 读，这里拿不到，也不该为了显示它去加路由。
 */
import { useEffect, useState, type CSSProperties, type ReactElement } from 'react'
import { milestoneState, type MilestoneState } from '../milestone-clock.js'

/** 独立开关；`canvas-studio.dev` 也认，省得自测时开两个键。 */
const ENABLE_KEY = 'canvas-studio.milestone'
const DEV_KEY = 'canvas-studio.dev'

function switchOn(): boolean {
  try {
    return localStorage.getItem(ENABLE_KEY) === '1' || localStorage.getItem(DEV_KEY) === '1'
  } catch {
    // 隐私模式 / 存储被禁用：按关处理，宁可少一个内部件也不要抛。
    return false
  }
}

/** 四档配色：只有「紧 / 超线」两档上色，富余与已达成走中性，避免画布顶部一直有颜色抢注意力。 */
const TONE: Record<MilestoneState['phase'], string> = {
  pending: 'inherit',
  running: 'inherit',
  tight: 'var(--cs-gold, #e8b45a)',
  overdue: '#e24b4a',
  done: '#35c2a6',
}

const STYLE: CSSProperties = {
  // 等宽数字：秒数跳变时行宽不动，否则右邻元素每秒抖一次。
  fontVariantNumeric: 'tabular-nums',
  whiteSpace: 'nowrap',
  fontSize: 12,
  opacity: 1,
}

export interface MilestoneBarProps {
  /** `workflow` 只要这两个时间戳；不引整个契约类型，保持本组件与 store 解耦。 */
  workflow?: { landedAt?: number | undefined; firstDraftAt?: number | undefined } | undefined
}

export function MilestoneBar({ workflow }: MilestoneBarProps): ReactElement | null {
  const [on] = useState(switchOn)
  const [now, setNow] = useState(() => Date.now())

  // 关闭态**不装定时器**：这是内部件，不该在所有人的会话里每秒唤醒一次渲染。
  useEffect(() => {
    if (!on) return undefined
    const timer = setInterval(() => { setNow(Date.now()) }, 1000)
    return () => { clearInterval(timer) }
  }, [on])

  if (!on) return null

  const state = milestoneState({
    now,
    landedAt: workflow?.landedAt,
    firstDraftAt: workflow?.firstDraftAt,
  })
  if (!state.visible) return null

  const suffix = state.phase === 'overdue'
    ? ' · 停美化，先出片'
    : state.hasDraft ? '' : ' · 尚无成片'

  return (
    <span
      style={{ ...STYLE, color: TONE[state.phase] }}
      title={'里程碑时钟（内部验收件）· 起算 = 故事板落画布 landedAt，M1 硬线 20min\n'
        + '关闭：localStorage.removeItem(\'canvas-studio.milestone\') 后刷新'}
    >
      {state.headline} · {state.detail}{suffix}
    </span>
  )
}
