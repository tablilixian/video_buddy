/**
 * 「设置 → 模型」面板的目录纯函数（无 React / 无 Cordis，node --test 直测）。
 *
 * 0.2.1 起 provider 目录由两路远端读取组成：`remote.llm.listProviders()`
 * （已注册路由 = active 面）与 `remote.llm.listConfigurableProviders()`
 * （可配置目录，含休眠路由）；两路在客户端并成目录行，语义对齐官方
 * ui-settings-models 的 joinProviderDirectory。DramaServer 官方网关行
 * （管理面方案 P4 落地后由 Host 写入）走同一目录，此处提供识别与行头摘要。
 */

/** `listProviders()` 行的结构子集（上游 LlmProviderInfo，本地收窄）。 */
export interface ProviderInfoLike {
  id: string
  name: string
}

/** `listConfigurableProviders()` 行的结构子集（上游 LlmConfigurableProvider，本地收窄）。 */
export interface ConfigurableEntryLike {
  provider: string
  displayName: string
  settingsNs: string
  settingsPath: readonly string[]
  declared?: boolean
}

/** 目录行：两路 list 的客户端并集视图（面板渲染的最小面）。 */
export interface ConfigurableProviderView {
  /** 路由 id（deepseek-official / openai / 自声明 route 等）。 */
  provider: string
  /** 配置界面展示名。 */
  displayName: string
  /** 承载该 provider profile 的 settings 命名空间（如 llm-deepseek / llm-pi-ai）；空串 = 仅注册、无配置面。 */
  settingsNs: string
  /** 从命名空间根到 profile 对象的路径（空数组 = 整个 section 即 profile）。 */
  settingsPath: string[]
  /** 路由当前是否已注册（模型是否可请求）。 */
  active: boolean
  /** 仅因配置声明才被 adapter 认识（用于自定义 provider 判定）。 */
  declared?: boolean
}

/**
 * 并集两路 list：目录行携带配置面与激活态；仅注册而未入目录的路由
 * （adapter 内建、无配置页）追加在目录行之后。deepseek 系行稳定排前，
 * 对齐官方排序，避免面板行序随远端返回顺序抖动。
 */
export function joinProviderDirectory(
  registered: readonly ProviderInfoLike[],
  directory: readonly ConfigurableEntryLike[],
): ConfigurableProviderView[] {
  const active = new Set(registered.map(p => p.id))
  const declared = new Set(directory.map(e => e.provider))
  const rows: ConfigurableProviderView[] = directory.map(e => ({
    provider: e.provider,
    displayName: e.displayName,
    settingsNs: e.settingsNs,
    settingsPath: [...e.settingsPath],
    active: active.has(e.provider),
    ...(e.declared === undefined ? {} : { declared: e.declared }),
  }))
  for (const p of registered) {
    if (declared.has(p.id)) continue
    rows.push({ provider: p.id, displayName: p.name, settingsNs: '', settingsPath: [], active: true })
  }
  return rows.toSorted((l, r) =>
    (l.provider === 'deepseek-account' ? 0 : l.provider === 'deepseek-official' ? 1 : 2)
      - (r.provider === 'deepseek-account' ? 0 : r.provider === 'deepseek-official' ? 1 : 2))
}

/** 派生 provider 的凭据引用名（与 dsh 官方 deriveKeyRef 一致）。 */
export function deriveKeyRef(provider: string): string {
  return `${provider.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_API_KEY`
}

/** 把 profile.models（字符串数组或 {id} 对象数组）规范成 id 字符串数组。 */
export function asModelIds(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((m) => {
      if (typeof m === 'string') return m
      if (m !== null && typeof m === 'object' && 'id' in m) return String((m as { id: unknown }).id)
      return ''
    })
    .filter(s => s.length > 0)
}

/**
 * 精简模式的「核心行」判定：deepseek 系 + adapter 显式声明的 + 已激活的 +
 * 已配置（有 profile）的。其余（未使用的官方预置第三方）折叠进「显示全部」。
 */
export function isCoreProvider(p: ConfigurableProviderView, configured: boolean): boolean {
  return p.provider === 'deepseek-account'
    || p.provider === 'deepseek-official'
    || p.declared === true
    || p.active === true
    || configured
}

/** 按 {@link isCoreProvider} 把目录行分成「展示」与「折叠」两组（保持原序）。 */
export function partitionProviders<T extends ConfigurableProviderView>(
  rows: readonly T[],
  isConfigured: (p: T) => boolean,
): { core: T[]; folded: T[] } {
  const core: T[] = []
  const folded: T[] = []
  for (const row of rows) (isCoreProvider(row, isConfigured(row)) ? core : folded).push(row)
  return { core, folded }
}

/** 行头模型摘要：前 max 个非空 id + 余数计数；空清单给占位文案。 */
export function summarizeModels(models: readonly string[], max = 2): string {
  const list = models.filter(s => s.length > 0)
  if (list.length === 0) return '未配置模型清单'
  const head = list.slice(0, max)
  const rest = list.length - head.length
  return rest > 0 ? `${head.join(' · ')} +${rest}` : head.join(' · ')
}

/** DramaServer 官方网关的路由 id（管理面方案 P4：目录驱动的 llm-pi-ai 行）。 */
export const GATEWAY_PROVIDER_ID = 'canvas-studio-gateway'

/** 目录行里的 DramaServer 官方网关行；P4 未落地（目录无此行）时为 undefined。 */
export function gatewayRowOf(rows: readonly ConfigurableProviderView[]): ConfigurableProviderView | undefined {
  return rows.find(r => r.provider === GATEWAY_PROVIDER_ID)
}
