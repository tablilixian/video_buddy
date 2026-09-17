/**
 * 单一决策的确认弹窗（CV-196）。
 *
 * 复用已有的弹窗词汇（`.csModalBackdrop` / `.csModal` / `.csModalFooter`），
 * 只把宽度与正文行距收窄 —— 一条决策不该占 440px 宽。
 *
 * ## 三个刻意的决定
 *
 * 1. **取消键自动聚焦**（不是确认键）：这类弹窗挡着的是一个「点了就回不了头」的
 *    动作，回车误触的代价不对称 —— 让默认焦点落在安全的一侧。
 * 2. **Esc = 取消**（不是关闭后什么都不做）：`useEffect` 挂 window 级 keydown，
 *    而不是只挂在浮层上 —— 焦点未必在浮层内（React 没有强制焦点陷阱），挂浮层
 *    会漏按键。
 * 3. **确认按钮不涂红**：本组件服务的场景（切放手跑）不是破坏性动作，红色会把它
 *    误导成「删除」。真需要警示语义时由调用方在 `body` 里说清代价。
 */
import { useEffect, type ReactElement, type ReactNode } from 'react'

export interface ConfirmDialogProps {
  /** 标题（同时作为 `aria-label`，所以它得能独立说清这是什么弹窗）。 */
  readonly title: string
  /** 正文：说清「确认之后会发生什么」。 */
  readonly body: ReactNode
  readonly confirmLabel: string
  readonly cancelLabel?: string
  onConfirm(): void
  onCancel(): void
}

export function ConfirmDialog(props: ConfirmDialogProps): ReactElement {
  const { title, body, confirmLabel, cancelLabel = '取消', onConfirm, onCancel } = props

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onCancel()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => { window.removeEventListener('keydown', onKeyDown) }
  }, [onCancel])

  return (
    <div
      className="csModalBackdrop"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel() }}
    >
      <div className="csModal csConfirmModal">
        <header className="csModalHeader">
          <div className="csModalHeaderText">
            <h2>{title}</h2>
          </div>
        </header>
        <div className="csModalBody csConfirmBody">{body}</div>
        <footer className="csModalFooter">
          {/* 取消键放在前、并自动聚焦：见文件头第 1 条。 */}
          <button type="button" className="csModalBtnSecondary" autoFocus onClick={onCancel}>{cancelLabel}</button>
          <button type="button" className="csModalBtnPrimary" onClick={onConfirm}>{confirmLabel}</button>
        </footer>
      </div>
    </div>
  )
}
