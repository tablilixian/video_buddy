/**
 * UI-10：全局模态焦点陷阱 —— **唯一实现点**。
 *
 * 为什么是全局一处、而不是给每个弹窗各挂一个 hook：全 client 有 **13 个文件**声明
 * `aria-modal="true"`（原审查清单只数了 5 个），逐个改 JSX 既漏又容易漂移。这里用
 * MutationObserver 盯 `[aria-modal="true"]` 的出现/消失，取 DOM 顺序最后一个当最上层：
 *
 * 1. 出现时快照 `document.activeElement`，把焦点移进弹窗内第一个可聚焦元素；
 * 2. Tab / Shift+Tab 在弹窗内循环，走不出去（`aria-modal="true"` 才名实相符）；
 * 3. 消失时把焦点归还快照元素。
 *
 * 新增弹窗只要继续声明 `aria-modal`，自动被覆盖，不需要记得挂 hook。
 * `ConfirmDialog` 自带的取消键 autoFocus 与本逻辑选中的是同一个元素，不冲突。
 */
import { useEffect } from 'react'

const FOCUSABLE = [
  'button:not([disabled])',
  '[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ')

export function useModalFocusTrap(): void {
  useEffect(() => {
    let active: HTMLElement | null = null
    let restore: HTMLElement | null = null

    const sync = (): void => {
      const all = document.querySelectorAll<HTMLElement>('[aria-modal="true"]')
      const top: HTMLElement | null = all.length > 0 ? (all[all.length - 1] ?? null) : null
      if (top === active) return
      if (top === null) {
        active = null
        restore?.focus()
        restore = null
        return
      }
      if (active === null) {
        restore = document.activeElement instanceof HTMLElement ? document.activeElement : null
      }
      active = top
      top.querySelector<HTMLElement>(FOCUSABLE)?.focus()
    }

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Tab' || active === null || !active.isConnected) return
      const items = Array.from(active.querySelectorAll<HTMLElement>(FOCUSABLE))
        .filter((element) => element.getClientRects().length > 0)
      if (items.length === 0) return
      const first = items[0]
      const last = items[items.length - 1]
      if (first === undefined || last === undefined) return
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    const observer = new MutationObserver(sync)
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['aria-modal'],
    })
    window.addEventListener('keydown', onKeyDown)
    sync()
    return () => {
      observer.disconnect()
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [])
}
