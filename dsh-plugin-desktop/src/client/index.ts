import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only service and SlotMap convergence for the Desktop settings section.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-theme/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// 类型增强：SlotMap 聚合（sidebar.workspaces / workspace.toast 等 0.2.1 新键）。
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
// 类型增强：Context 上获得 `uiWorkspace`（0.2.1 起会话/工作区导航归它，`workspaces` 只留纯数据层）。
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import { applyAdvancedShell } from './advanced-shell.ts'
import { startRendererBootReporter } from './boot-health.ts'
import { applyDesktopSettings } from './desktop-settings.ts'
import { installDesktopDirectoryPickerBridge, requestDesktopDirectoryValidation } from './directory-picker.ts'
import { parseDesktopClientEnvironment } from './environment.ts'
import { applyExtendedShell, applyFramedShell } from './extended-shell.ts'
import { installWorkspaceFolderDrop } from './workspace-folder-drop.ts'
import { desktopWindowService, provideDesktopWindow } from './window-service.ts'

export { applyAdvancedShell } from './advanced-shell.ts'
export { applyDesktopSettings } from './desktop-settings.ts'
export { applyExtendedShell, applyFramedShell } from './extended-shell.ts'
export {
  createDesktopSettingsApi,
  desktopSettingsPaths,
  parseDesktopActionAcceptance,
  parseDesktopRestartAcceptance,
  parseDesktopSettingsView,
} from './desktop-settings-api.ts'
export type {
  DesktopMarketProvider,
  DesktopMarketView,
  DesktopProfileView,
  DesktopRestartAcceptance,
  DesktopSettingsApi,
  DesktopSettingsView,
} from './desktop-settings-api.ts'
export { DesktopSettingsSection } from './DesktopSettingsSection.tsx'
export { DesktopTerminalSettingsAction } from './DesktopTerminalSettingsAction.tsx'
export type {
  DesktopTerminalSettingsActionInjected,
  DesktopTerminalSettingsActionProps,
} from './DesktopTerminalSettingsAction.tsx'
export type {
  DesktopNotificationSettings,
  DesktopSettingsSectionInjected,
  DesktopSettingsSectionProps,
  DesktopShellSettings,
} from './DesktopSettingsSection.tsx'
export {
  RENDERER_BOOT_REPORT_PATH,
  rendererBootReport,
  sendRendererBootReport,
  startRendererBootReporter,
} from './boot-health.ts'
export type { RendererBootLoader, RendererBootReport } from './boot-health.ts'
export { parseDesktopClientEnvironment } from './environment.ts'
export type {
  DesktopClientEnvironment,
  DesktopClientMaterial,
  DesktopClientMode,
  DesktopClientPlatform,
} from './environment.ts'
export { desktopWindowService, provideDesktopWindow } from './window-service.ts'
export type {
  DesktopWindowDragRegion,
  DesktopWindowInsets,
  DesktopWindowService,
} from './contracts.ts'

/**
 * Services required by Desktop settings and Desktop-owned presentations.
 *
 * 0.2.1 迁移注记（2026-10-21）：`settingsScope` **必须移除**。它是 0.1.x 的
 * 旧服务名，0.2.1 里没有任何客户端包提供它（全量扫描 `provide("settingsScope")`
 * / `super(ctx, "settingsScope")` 零命中，profile 侧同样没有）——而 Cordis 的
 * fiber 只在 inject **全部就绪**时才执行 apply。留着它会让本插件的 apply 永不
 * 运行，连带 `startRendererBootReporter` 也不启动，主进程收到的就是
 * 「30s 内零上报」⇒ 恢复模式窗口，且报错里插件名为空
 * （`renderer boot failed (plugins: Unknown client plugin)`）。
 * 本文件内也没有任何代码读取那个旧服务名，删除无副作用。
 *
 * 同批迁移：**`configForms` 必须补进 inject**。`applyDesktopSettings` 一进来就
 * `ctx.configForms.get(...)`（`desktop-settings.ts:62`），而 0.1.x 的 inject 里
 * 从来没有它 —— 当年能吃是因为旧 cordis 不做隔离校验；0.2.1 的 proxy get 陷阱
 * 对未声明的服务直接抛 `cannot get property "configForms" without inject`，
 * 于是 apply 第 2 步就炸、条目 FAILED、上报器不启动、宿主 30s 超时进恢复模式。
 */
export const inject = [
  'slots',
  'locale',
  'connection',
  'remote',
  'sessions',
  'theme',
  'workspaces',
  'uiRenderer',
  'configForms',
]

/**
 * 分段埋点：客户端 Loader 只记录 fiber 状态（FAILED / pending），
 * **不保留 apply 抛出的原因**（`dsh-web-frontend` 的 boot 汇总里
 * `failed` 分支只打插件名）。2026-10-21 升级后本插件整条目 FAILED，
 * 终端只看到 `dsh-plugin-desktop: failed`，定位全靠猜 —— 所以每一步都
 * 自己记一条，异常照原样抛回（行为不变，只是变得可诊断）。
 */
function step<T>(label: string, run: () => T): T {
  try {
    return run()
  } catch (cause) {
    const detail = cause instanceof Error ? `${cause.name}: ${cause.message}\n${cause.stack ?? ''}` : String(cause)
    console.error(`[dsh-plugin-desktop] apply step failed: ${label}\n${detail}`)
    throw cause
  }
}

/** Register desktop-owned client surfaces for the current BrowserWindow mode. @param ctx - browser Cordis context. */
export function apply(ctx: ClientContext): void {
  const environment = parseDesktopClientEnvironment(window.location.search)
  if (!environment) return
  step('provide desktopWindow', () => ctx.effect(
    () => provideDesktopWindow(ctx, desktopWindowService(environment)),
    'dsh-plugin-desktop: native window geometry service',
  ))
  const desktopSettings = step('applyDesktopSettings', () => applyDesktopSettings(ctx, environment))
  // 0.2.1 迁移注记（2026-10-21）：**不要写 `ctx.loader`**。`loader` 是根上下文
  // 的内建属性，不在本插件的 inject 清单里，0.2.1 的 proxy get 陷阱在隔离上下文
  // 里会直接抛 `cannot get property "loader" without inject` —— 整个 apply 挂掉，
  // 条目变成 FAILED，上报器随之不启动，宿主只能按 30s 超时进恢复模式。
  // 0.2.1 官方包的写法一律是 `ctx.get("loader")` 判空（见 dsh-api-gateway）。
  step('start renderer boot reporter', () => ctx.effect(() => {
    const loader = ctx.get('loader') as ClientContext['loader'] | undefined
    if (loader === undefined) {
      console.warn('[dsh-plugin-desktop] loader service is unavailable; renderer boot health report disabled')
      return () => {}
    }
    return startRendererBootReporter(loader)
  }, 'dsh-plugin-desktop: renderer boot health report'))
  step('install workspace folder drop', () => ctx.effect(
    () => installWorkspaceFolderDrop({
      create: input => ctx.workspaces.create(input),
      // 同上：`uiWorkspace` 没在本插件的 inject 里，直接 `ctx.uiWorkspace` 会在
      // 拖放时抛；用 `ctx.get` 惰性取，未就绪就安静跳过。
      startSession: workspaceId => { ctx.get('uiWorkspace')?.startSession(workspaceId) },
      ...(environment.platform === 'win32'
        ? { validateDirectory: (path: string) => requestDesktopDirectoryValidation(path) }
        : {}),
    }),
    'dsh-plugin-desktop: workspace folder drop',
  ))
  if (environment.platform === 'win32') {
    step('install directory picker bridge', () => ctx.effect(
      () => installDesktopDirectoryPickerBridge(),
      'dsh-plugin-desktop: native directory picker bridge',
    ))
  }
  if (environment.mode === 'advanced') step('applyAdvancedShell', () => applyAdvancedShell(ctx, environment))
  if (environment.mode === 'extended') step('applyExtendedShell', () => applyExtendedShell(ctx, environment, desktopSettings))
  if (environment.platform !== 'linux' && environment.mode === 'compatibility') {
    step('applyFramedShell', () => applyFramedShell(ctx, environment, desktopSettings))
  }
}
