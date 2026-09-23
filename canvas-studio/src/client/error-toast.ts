/**
 * D4 toast 桥（错误系统 §5.2 最后一公里）。
 *
 * 客户端的错误展示出口统一是 StudioFrame 的 `pushToast`。本模块把捕获到的
 * unknown 先经 `routeError` 判定再给文案：
 * - `CanvasStudioError` 且需展示（surface）→ 返回 userMessage（devMode 附 [dev] 细节）。
 * - `CanvasStudioError` 仅日志（developer 受众 / 自动恢复）→ 细节落 console.warn，
 *   生产环境用户只看到中性 fallback（内部细节不外泄）。
 * - 普通错误（未接入错误系统的路径）→ 保持既有「前缀：原始 message」行为不变。
 */

import { CanvasStudioError, isDevMode, routeError } from '../error-system.js'
import '../errors/catalog.js'

export function errorToastText(err: unknown, prefix: string): string {
  if (!(err instanceof CanvasStudioError)) {
    const raw = err instanceof Error ? err.message : String(err)
    return `${prefix}：${raw}`
  }
  const action = routeError(err, { devMode: isDevMode() })
  if (action.kind === 'surface') return action.message
  console.warn(`[canvas-studio][${err.code}] ${action.dev}`)
  return isDevMode()
    ? `${prefix}（dev: ${err.devMessage ?? err.message}）`
    : `${prefix}（内部错误，详情见日志）`
}
