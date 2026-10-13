/**
 * CV-311：故事板 iframe 内「点开看原图」点击的命中判定（跨 realm 安全）。
 *
 * **为什么单独成模块**：事件的 `event.target` 属于 iframe **自己的 realm** ——
 * 每个 iframe 有独立的 `Element` / `HTMLAnchorElement` 构造器与原型链，父层写的
 * `target instanceof Element`（父窗口的构造器）**恒为 false** ⇒ 判定在第一行就
 * 提前 return，`preventDefault` 永远走不到，`target="_blank"` 照旧经 Electron
 * `setWindowOpenHandler` 跳出系统浏览器（2026-10-13 真机复现的根因）。
 * 跨 realm 只能**鸭子类型**：`closest` 是元素自身的方法，方法调用不经过构造器比对。
 *
 * 纯函数放 `src/` 根（而非 `src/client/`）：Host tsconfig 排除 client 目录，
 * 放进去 `lib/` 里就没有产物，测试 import 不到。
 */

/**
 * 命中 `a.zoom` 钩子则拦下默认导航（新窗口 / iframe 内导航）并返回其绝对 href；
 * 未命中返回 `null`（含 §01 来源链接等外部 URL —— 那些不该被拦）。
 */
export function storyboardZoomHref(event: Event): string | null {
  const target = event.target
  if (typeof target !== 'object' || target === null) return null
  // 鸭子类型：文档 / 文本节点等非 Element 没有 closest，直接视为未命中。
  const el = target as { closest?: unknown }
  if (typeof el.closest !== 'function') return null
  // 点在 <img> / 角标上也能沿祖先命中锚点；this 必须绑定回 target 本身。
  const anchor = (el.closest as (selector: string) => Element | null).call(el, 'a.zoom') as
    | HTMLAnchorElement
    | null
  if (anchor === null) return null
  const href = anchor.href
  if (typeof href !== 'string' || href.length === 0) return null
  event.preventDefault()
  event.stopPropagation()
  return href
}
