/**
 * REQ-034 · 二期 1b：渲染进度角标（画布上的常驻小条）。
 *
 * 为什么需要它：`render_composition` 是一条**分钟级**工单。此前客户端取单后只有
 * 「渲染前预览」这一瞬可见，点了开始就完全静默 —— 用户不知道是卡住了还是在跑。
 *
 * 口径：只显示**当前这一单**的百分比（并发被宿主限制为 1，不会有多条并排）。
 * 层叠：`z-index: 25` —— 在抽屉（30）与右键菜单（50）/ 弹窗（70）之下，
 * 不遮挡任何交互层（项目层叠表见 `PROJECT-NOTES`）。
 */
import { useSyncExternalStore } from 'react'
import { getRenderProgressSnapshot, subscribeRenderProgress } from './render-progress.js'

export function RenderProgressBadge() {
  const state = useSyncExternalStore(subscribeRenderProgress, getRenderProgressSnapshot, getRenderProgressSnapshot)
  if (state === null) return null
  const percent = Math.round(state.progress * 100)
  return (
    <div
      aria-live="polite"
      style={{
        position: 'fixed',
        left: '50%',
        bottom: 18,
        transform: 'translateX(-50%)',
        zIndex: 25,
        minWidth: 220,
        padding: '10px 14px',
        borderRadius: 10,
        background: 'var(--cs-shell-2, #1b2330)',
        border: '1px solid var(--cs-line, rgba(255,255,255,0.12))',
        color: 'var(--cs-text, #e6edf3)',
        boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
        fontSize: 12,
        pointerEvents: 'none',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
        <span>成片渲染中</span>
        <span>{percent}%</span>
      </div>
      <div style={{ height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.16)', overflow: 'hidden' }}>
        <div
          style={{
            width: `${percent}%`,
            height: '100%',
            background: 'var(--cs-accent, #4f9cf9)',
            transition: 'none',
          }}
        />
      </div>
    </div>
  )
}
