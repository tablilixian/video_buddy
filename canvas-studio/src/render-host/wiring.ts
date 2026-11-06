/**
 * RenderHost 派单侧的接线（CV-447 P0-A 抽出的注册/回收对）。
 *
 * 为什么独立成文件：`routes.ts` 在「单文件行数 ≤1,200 白名单棘轮」里已顶格（3654），
 * 新增接线必须等量置换而不是加行；`render-job.ts` 不依赖 cordis 只喊话，注入实现留在
 * window.ts，这里只是把「谁记日志」与「谁开情节流」两件事绑在一起。
 */
import {
  setRenderHostLauncher,
  setRenderHostLogger,
  setRenderHostResetter,
  setRenderHostThrottleToggle,
} from './dispatch.js'
import { setMainWindowRenderThrottling } from './window.js'

/** 注册派单侧出口：日志 + 渲染在飞时放开主窗口后台节流。 */
export function installRenderHostWiring(log: (message: string) => void): void {
  setRenderHostLogger(log)
  setRenderHostThrottleToggle((enabled) => setMainWindowRenderThrottling(enabled, log))
}

/** 插件卸载时收回全部注入（幂等：重复调用不会报错）。 */
export function uninstallRenderHostWiring(): void {
  setRenderHostLauncher(undefined)
  setRenderHostResetter(undefined)
  setRenderHostLogger(undefined)
  setRenderHostThrottleToggle(undefined)
}
