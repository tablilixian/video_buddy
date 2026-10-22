/**
 * Canvas Studio「模型」设置面板（provider 感知，完整功能）。
 *
 * 设计：不直接复用桌面 dsh 的 `ModelsSettingsStore` / `ModelsSection`（包内私有、
 * 不导出，且没有打开桌面设置页的命令），而是调用与桌面**完全相同**的 wire 接口
 * （0.2.1 起 `remote.llm` / `remote.settings` / `remote.credentials` 命名空间服务，
 * 经 canvas-studio 已有的注入面取得）：
 * - `llm.listProviders()` + `llm.listConfigurableProviders()`   目录两路并集（joinProviderDirectory）
 * - `settings.describe()` / `settings.mutate(ns, ops, rev)`     全量命名空间视图 / 路径编辑写回
 * - `credentials.set/unset/describe`                            密钥走凭据域，不落明文
 * - `llm.discoverModels(settingsNs, request)`                   端点模型发现
 *
 * 因此本面板与桌面原生「模型」设置共享同一份存储：在桌面设置里看到的配置，这里也能
 * 改；反之亦然。写入格式严格对齐 dsh（path ops + 派生凭据引用），不会损坏其它字段。
 *
 * 版面（2026-10 重设计，交互稿 docs/plans/model-settings-redesign-mockup.html）：
 * 默认模型 → DramaServer 官方模型（只读区块，P4 落地前「待接入」暗态）→
 * 我的 Provider（已配置行默认折叠、点「编辑」展开、同时只展开一张，对齐官方
 * 模型设置页的行卡模式）→ 折叠未用官方 provider → 添加自定义 provider。
 */
import {
  useCallback, useEffect, useMemo, useState, useSyncExternalStore, type ChangeEvent, type ReactElement,
} from 'react'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type {
  CanvasStudioModelApi, CanvasStudioSettingsScope, ConfigurableProviderView,
  DiscoveredModelView, SettingsNamespaceView, SettingsPathOpView,
} from './contracts.js'
import {
  asModelIds, deriveKeyRef, gatewayRowOf, joinProviderDirectory, partitionProviders,
  summarizeModels, GATEWAY_PROVIDER_ID,
} from '../model-directory.js'
import { throwError } from '../error-system.js'
import '../errors/catalog.js'

/** agent-default-model 命名空间形状（桌面全局默认编排模型）。 */
interface AgentModelConfig {
  provider: string
  model: string
  reasoningEffort?: string
}

/** 自定义 provider 路由 id 规则（与 dsh 一致：小写字母数字加连字符，字母开头）。 */
const ROUTE_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/
/** 自定义 provider 写入的命名空间（与 dsh CustomProviderCard 一致）。 */
const CUSTOM_NS = 'llm-pi-ai'
/** credentials.describe 单次批量上限（对齐官方 ModelsSettingsStore 的 64 分批）。 */
const CRED_DESCRIBE_BATCH = 64

export interface ModelSettingsPanelProps {
  /** 惰性取模型设置所需的 Host wire 接口。 */
  getModelApi: () => CanvasStudioModelApi | undefined
  /** 绑定 settings 命名空间的作用域（默认模型写 'agent-default-model'）。 */
  settingsScope: CanvasStudioSettingsScope
}

// ---- 通用的安全取值工具 ----

/** 沿路径安全读取嵌套值。 */
function getAt(value: unknown, path: string[]): unknown {
  let cur: unknown = value
  for (const key of path) {
    if (cur === null || typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[key]
  }
  return cur
}

/** 是否存在该路径（用于 removable 判定）。 */
function hasAt(value: unknown, path: string[]): boolean {
  return getAt(value, path) !== undefined
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

interface ProviderDraft {
  displayName: string
  baseURL: string
  models: string[]
  keyDraft: string
}

/** 订阅 settingsScope 的响应式快照（与 DesktopSettingsSection.useScope 同构）。 */
function useScope<T>(scope: ConfigForm<T>) {
  const subscribe = useMemo(() => (listener: () => void) => scope.subscribe(listener), [scope])
  const snapshot = useMemo(() => () => scope.getSnapshot(), [scope])
  return useSyncExternalStore(subscribe, snapshot)
}

/** 行头凭据状态点：有引用且已配置 → ok；有引用未配置 → miss；无引用不展示。 */
type KeyDotState = 'ok' | 'miss' | 'none'

/** 模型设置面板主体。 */
export function ModelSettingsPanel(props: ModelSettingsPanelProps): ReactElement {
  const { getModelApi, settingsScope } = props

  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState<string | null>(null)
  const [writable, setWritable] = useState(false)
  const [providers, setProviders] = useState<ConfigurableProviderView[]>([])
  const [namespaces, setNamespaces] = useState<SettingsNamespaceView[]>([])
  const [credMap, setCredMap] = useState<Record<string, { configured: boolean; writable: boolean }>>({})
  const [drafts, setDrafts] = useState<Record<string, ProviderDraft>>({})
  const [discovered, setDiscovered] = useState<Record<string, DiscoveredModelView[]>>({})
  const [busy, setBusy] = useState<Record<string, boolean>>({})
  const [saveError, setSaveError] = useState<Record<string, string | null>>({})
  // 我的 Provider 折叠行：当前展开编辑的 provider（同时只展开一张，对齐官方行卡模式）。
  const [expanded, setExpanded] = useState<string | null>(null)

  // 自定义 provider 表单态。
  const [customOpen, setCustomOpen] = useState(false)
  const [customBusy, setCustomBusy] = useState(false)
  const [customError, setCustomError] = useState<string | null>(null)
  const [cRoute, setCRoute] = useState('')
  const [cName, setCName] = useState('')
  const [cBase, setCBase] = useState('')
  const [cProtocol, setCProtocol] = useState('openai-completions')
  const [cKey, setCKey] = useState('')
  const [cModels, setCModels] = useState<string[]>([])
  // 精简模式：是否展开被折叠的未使用官方 provider。
  const [showFolded, setShowFolded] = useState(false)

  // 默认模型作用域（agent-default-model）。
  const agentScope = useMemo(
    () => settingsScope.get<AgentModelConfig>('agent-default-model'),
    [settingsScope],
  )
  const agentSnap = useScope(agentScope)
  const agentValue = agentSnap.value

  /** 拉取目录两路 + 命名空间视图 + 密钥态（0.2.1 信封：`{ok, value | error}`）。 */
  const refresh = useCallback(async () => {
    const api = getModelApi()
    if (api === undefined) {
      setError('连接服务不可用：当前环境未提供模型设置所需的 Host 接口')
      setStatus('error')
      return
    }
    setStatus('loading')
    setError(null)
    try {
      const [regRes, decRes, setRes] = await Promise.all([
        api.llm.listProviders(),
        api.llm.listConfigurableProviders(),
        api.settings.describe(),
      ])
      if (!regRes.ok) throwError('CS-CLIENT-ERR', { message: regRes.error.message })
      if (!decRes.ok) throwError('CS-CLIENT-ERR', { message: decRes.error.message })
      if (!setRes.ok) throwError('CS-CLIENT-ERR', { message: setRes.error.message })
      const rows = joinProviderDirectory(regRes.value, decRes.value)
      const nsList = setRes.value.namespaces
      const draftMap: Record<string, ProviderDraft> = {}
      const refs: string[] = []
      for (const p of rows) {
        if (!p.settingsNs) continue
        const ns = nsList.find((n) => n.ns === p.settingsNs)
        const profile = ns ? getAt(ns.value, p.settingsPath) : undefined
        const profObj = (profile !== null && typeof profile === 'object' ? profile : undefined) as Record<string, unknown> | undefined
        const keyRef = profObj && typeof profObj.apiKeyEnv === 'string' && profObj.apiKeyEnv.length > 0
          ? profObj.apiKeyEnv
          : deriveKeyRef(p.provider)
        draftMap[p.provider] = {
          displayName: asString(profObj?.displayName) || p.displayName || '',
          baseURL: asString(profObj?.baseURL),
          models: asModelIds(profObj?.models),
          keyDraft: '',
        }
        if (keyRef) refs.push(keyRef)
      }
      let cm: Record<string, { configured: boolean; writable: boolean }> = {}
      const uniqueRefs = [...new Set(refs)]
      for (let i = 0; i < uniqueRefs.length; i += CRED_DESCRIBE_BATCH) {
        try {
          const cRes = await api.credentials.describe(uniqueRefs.slice(i, i + CRED_DESCRIBE_BATCH))
          if (cRes.ok) cm = { ...cm, ...cRes.value }
        } catch {
          // 密钥态查询失败不阻塞面板，仅密钥已配置标记缺失。
          break
        }
      }
      setProviders(rows)
      setNamespaces(nsList)
      setWritable(setRes.value.writable)
      setDrafts(draftMap)
      setCredMap(cm)
      setStatus('ready')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '模型设置加载失败')
      setStatus('error')
    }
  }, [getModelApi])

  useEffect(() => { void refresh() }, [refresh])

  /** 取某 provider 的命名空间视图与已解析 profile。 */
  const profileOf = useCallback((p: ConfigurableProviderView): { ns: SettingsNamespaceView | undefined; profile: Record<string, unknown> | undefined } => {
    const ns = namespaces.find((n) => n.ns === p.settingsNs)
    const profile = ns ? getAt(ns.value, p.settingsPath) : undefined
    return { ns, profile: (profile !== null && typeof profile === 'object' ? profile : undefined) as Record<string, unknown> | undefined }
  }, [namespaces])

  /** 行头凭据点状态（profile 里引用了凭据才算，自部署无鉴权行不展示）。 */
  const keyDotOf = useCallback((p: ConfigurableProviderView): KeyDotState => {
    const { profile } = profileOf(p)
    if (!(profile !== undefined && typeof profile.apiKeyEnv === 'string' && profile.apiKeyEnv.length > 0)) return 'none'
    const keyRef = profile.apiKeyEnv
    return credMap[keyRef]?.configured === true ? 'ok' : 'miss'
  }, [profileOf, credMap])

  /** 以补丁方式更新某 provider 的草稿（避免在 updater 内对可能为 undefined 的索引做展开）。 */
  const patchDraft = useCallback((provider: string, patch: Partial<ProviderDraft>) => {
    setDrafts((dm) => {
      const cur = dm[provider]
      if (cur === undefined) return dm
      return { ...dm, [provider]: { ...cur, ...patch } }
    })
  }, [])

  /** 保存一个 provider 的配置（base URL / 模型清单 / displayName / API Key）。 */
  const saveProvider = useCallback(async (p: ConfigurableProviderView) => {
    const api = getModelApi()
    if (api === undefined) return
    const { ns, profile } = profileOf(p)
    if (ns === undefined) {
      setSaveError((m) => ({ ...m, [p.provider]: '未找到该 provider 的 settings 命名空间' }))
      return
    }
    const draft = drafts[p.provider]
    if (draft === undefined) return
    const keyRef = profile && typeof profile.apiKeyEnv === 'string' && profile.apiKeyEnv.length > 0
      ? profile.apiKeyEnv
      : deriveKeyRef(p.provider)
    const ops: SettingsPathOpView[] = []
    if (profile === undefined) {
      // 首次创建整个 profile（某个需首次配置的休眠自部署 route）。
      const value: Record<string, JsonValue> = {}
      if (draft.displayName) value.displayName = draft.displayName
      if (draft.baseURL) value.baseURL = draft.baseURL
      value.models = draft.models.map((id) => ({ id }))
      if (draft.keyDraft) value.apiKeyEnv = keyRef
      ops.push({ op: 'set', path: [...p.settingsPath], value })
    } else {
      const curBase = asString(profile.baseURL)
      if (draft.baseURL !== curBase) {
        ops.push(draft.baseURL
          ? { op: 'set', path: [...p.settingsPath, 'baseURL'], value: draft.baseURL }
          : { op: 'unset', path: [...p.settingsPath, 'baseURL'] })
      }
      const curName = asString(profile.displayName)
      if (draft.displayName !== curName) {
        ops.push(draft.displayName
          ? { op: 'set', path: [...p.settingsPath, 'displayName'], value: draft.displayName }
          : { op: 'unset', path: [...p.settingsPath, 'displayName'] })
      }
      const curModels = asModelIds(profile.models).join('\n')
      const newModels = draft.models.join('\n')
      if (curModels !== newModels) {
        ops.push({ op: 'set', path: [...p.settingsPath, 'models'], value: draft.models.map((id) => ({ id })) })
      }
      // profile 已存在但未引用凭据时，输入新 key 需同时写入引用，否则密钥不生效。
      const hasKeyRef = typeof profile.apiKeyEnv === 'string' && profile.apiKeyEnv.length > 0
      if (draft.keyDraft && !hasKeyRef) {
        ops.push({ op: 'set', path: [...p.settingsPath, 'apiKeyEnv'], value: keyRef })
      }
    }
    setBusy((b) => ({ ...b, [p.provider]: true }))
    setSaveError((m) => ({ ...m, [p.provider]: null }))
    try {
      if (ops.length > 0) {
        const res = await api.settings.mutate(p.settingsNs, ops, ns.revision)
        if (!res.ok) {
          throwError(res.error.code === 'settings/conflict' ? 'CS-CLIENT-002' : 'CS-CLIENT-ERR', { message: res.error.code === 'settings/conflict' ? '配置已被其它改动覆盖，请刷新后重试' : res.error.message })
        }
      }
      if (draft.keyDraft) {
        const credRes = await api.credentials.set(keyRef, draft.keyDraft)
        if (!credRes.ok) throwError('CS-CLIENT-ERR', { message: credRes.error.message })
      }
      await refresh()
    } catch (cause) {
      setSaveError((m) => ({ ...m, [p.provider]: cause instanceof Error ? cause.message : '保存失败' }))
    } finally {
      setBusy((b) => ({ ...b, [p.provider]: false }))
    }
  }, [getModelApi, profileOf, drafts, refresh])

  /** 清除一个 provider 的密钥引用（自部署无鉴权端点无需 API Key）。 */
  const clearKeyRef = useCallback(async (p: ConfigurableProviderView) => {
    const api = getModelApi()
    if (api === undefined) return
    const { ns, profile } = profileOf(p)
    if (ns === undefined || profile === undefined) return
    if (!(typeof profile.apiKeyEnv === 'string' && profile.apiKeyEnv.length > 0)) return
    setBusy((b) => ({ ...b, [p.provider]: true }))
    setSaveError((m) => ({ ...m, [p.provider]: null }))
    try {
      const res = await api.settings.mutate(p.settingsNs, [{ op: 'unset', path: [...p.settingsPath, 'apiKeyEnv'] }], ns.revision)
      if (!res.ok) throwError('CS-CLIENT-ERR', { message: res.error.message })
      await refresh()
    } catch (cause) {
      setSaveError((m) => ({ ...m, [p.provider]: cause instanceof Error ? cause.message : '清除失败' }))
    } finally {
      setBusy((b) => ({ ...b, [p.provider]: false }))
    }
  }, [getModelApi, profileOf, refresh])

  /** 移除一个用户添加的 provider 及其托管密钥。 */
  const removeProvider = useCallback(async (p: ConfigurableProviderView) => {
    const api = getModelApi()
    if (api === undefined) return
    const { ns, profile } = profileOf(p)
    if (ns === undefined) return
    const keyRef = profile && typeof profile.apiKeyEnv === 'string' && profile.apiKeyEnv.length > 0
      ? profile.apiKeyEnv
      : undefined
    setBusy((b) => ({ ...b, [p.provider]: true }))
    setSaveError((m) => ({ ...m, [p.provider]: null }))
    try {
      if (keyRef) {
        try {
          const credRes = await api.credentials.unset(keyRef)
          // 清理失败不阻塞 provider 移除（密钥可能已不存在）。
          if (!credRes.ok) console.warn(`canvas-studio: 清除密钥引用 ${keyRef} 失败（继续移除 provider）：${credRes.error.message}`)
        } catch { /* 密钥已不存在则忽略 */ }
      }
      const res = await api.settings.mutate(p.settingsNs, [{ op: 'unset', path: [...p.settingsPath] }], ns.revision)
      if (!res.ok) throwError('CS-CLIENT-ERR', { message: res.error.message })
      if (expanded === p.provider) setExpanded(null)
      await refresh()
    } catch (cause) {
      setSaveError((m) => ({ ...m, [p.provider]: cause instanceof Error ? cause.message : '移除失败' }))
    } finally {
      setBusy((b) => ({ ...b, [p.provider]: false }))
    }
  }, [getModelApi, profileOf, refresh, expanded])

  /** 从端点拉取该 provider 当前广告的模型清单。 */
  const discoverModels = useCallback(async (p: ConfigurableProviderView) => {
    const api = getModelApi()
    if (api === undefined) return
    const draft = drafts[p.provider]
    if (draft === undefined) return
    try {
      const res = await api.llm.discoverModels(p.settingsNs, {
        ...(p.provider ? { provider: p.provider } : {}),
        ...(draft.baseURL ? { baseURL: draft.baseURL } : {}),
        ...(draft.keyDraft ? { apiKey: draft.keyDraft } : {}),
      })
      if (!res.ok) throwError('CS-CLIENT-ERR', { message: res.error.message })
      const models = res.value
      setDiscovered((d) => ({ ...d, [p.provider]: models }))
    } catch (cause) {
      setSaveError((m) => ({ ...m, [p.provider]: `拉取模型失败：${cause instanceof Error ? cause.message : '未知错误'}` }))
    }
  }, [getModelApi, drafts])

  /** 采用拉取到的模型清单覆盖当前草稿。 */
  const adoptDiscovered = useCallback((p: ConfigurableProviderView) => {
    const list = discovered[p.provider] ?? []
    patchDraft(p.provider, { models: list.map((m) => m.id) })
  }, [discovered, patchDraft])

  /** 写默认模型（agent-default-model 命名空间）。 */
  const setDefault = useCallback((provider: string, model: string) => {
    if (agentValue === undefined) return
    if (provider !== agentValue.provider) void agentScope.set('provider', provider)
    if (model !== agentValue.model) void agentScope.set('model', model)
  }, [agentScope, agentValue])

  /** 添加自定义 provider（自部署 / 第三方 OpenAI 兼容网关）。 */
  const addCustom = useCallback(async () => {
    const api = getModelApi()
    if (api === undefined) return
    const ns = namespaces.find((n) => n.ns === CUSTOM_NS)
    if (ns === undefined) { setCustomError('未找到 llm-pi-ai 命名空间'); return }
    if (!ROUTE_PATTERN.test(cRoute)) { setCustomError('路由 id 需为小写字母数字加连字符，且字母开头（如 my-local-llm）'); return }
    if (cBase.length === 0) { setCustomError('需填写 API 地址（Base URL）'); return }
    if (cModels.length === 0) { setCustomError('至少填写一个模型 id'); return }
    const keyRef = deriveKeyRef(cRoute)
    const profile: Record<string, JsonValue> = { api: cProtocol, baseURL: cBase, models: cModels.map((id) => ({ id })) }
    if (cName) profile.displayName = cName
    if (cKey) profile.apiKeyEnv = keyRef
    setCustomBusy(true)
    setCustomError(null)
    try {
      const res = await api.settings.mutate(CUSTOM_NS, [{ op: 'set', path: ['providers', cRoute], value: profile }], ns.revision)
      if (!res.ok) throwError('CS-CLIENT-ERR', { message: res.error.message })
      if (cKey) {
        const credRes = await api.credentials.set(keyRef, cKey)
        if (!credRes.ok) throwError('CS-CLIENT-ERR', { message: credRes.error.message })
      }
      setCRoute(''); setCName(''); setCBase(''); setCProtocol('openai-completions'); setCKey(''); setCModels([]); setCustomOpen(false)
      await refresh()
    } catch (cause) {
      setCustomError(cause instanceof Error ? cause.message : '添加失败')
    } finally {
      setCustomBusy(false)
    }
  }, [getModelApi, namespaces, cRoute, cName, cBase, cProtocol, cKey, cModels, refresh])

  // ---- 渲染 ----

  if (status === 'error') {
    return (
      <div className="csField">
        <p className="csFieldError" role="alert">{error}</p>
        <button type="button" className="csFieldButton" onClick={() => { void refresh() }}>重试</button>
      </div>
    )
  }
  if (status === 'loading' || agentValue === undefined) {
    return <div className="csField">加载中…</div>
  }

  // 已配置（有 profile）且可设为默认的 provider 列表。
  const defaultable = providers.filter((p) => {
    const { profile } = profileOf(p)
    return profile !== undefined
  })

  // 精简模式：deepseek 系 + 已配置/自建/自定义为核心行，其余折叠进「显示全部」。
  // 注意不能拿 settingsPath 判定——目录给每个 provider 都派发 ['providers', <route>] 路径。
  const { core: coreProviders, folded: foldedProviders } = partitionProviders(
    providers.filter((p) => p.settingsNs !== ''),
    (p) => profileOf(p).profile !== undefined,
  )
  const visibleProviders = showFolded ? providers.filter((p) => p.settingsNs !== '') : coreProviders

  // DramaServer 官方网关行（P4 落地后由 Host 写入 llm-pi-ai；未落地 → 暗态占位）。
  const gatewayRow = gatewayRowOf(providers)
  const gatewayProfile = gatewayRow !== undefined ? profileOf(gatewayRow).profile : undefined
  const gatewayModels = gatewayProfile !== undefined ? asModelIds(gatewayProfile.models) : []

  return (
    <div className="csModelPanel">
      {/* 默认模型（桌面全局编排 LLM 大脑） */}
      <div className="csModelDefault">
        <span className="csFieldLabel">默认模型（全局生效，驱动创作流水线）</span>
        <div className="csFieldRow">
          <select
            className="csFieldInput"
            value={agentValue.provider}
            onChange={(e: ChangeEvent<HTMLSelectElement>) => setDefault(e.target.value, drafts[e.target.value]?.models[0] ?? agentValue.model)}
          >
            <option value="">— 选择 provider —</option>
            {defaultable.map((p) => (
              <option key={p.provider} value={p.provider}>{drafts[p.provider]?.displayName || p.displayName}</option>
            ))}
          </select>
          <input
            className="csFieldInput"
            value={agentValue.model}
            placeholder="模型 id"
            spellCheck={false}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setDefault(agentValue.provider, e.target.value)}
          />
        </div>
        <label className="csField" style={{ marginTop: 8 }}>
          <span className="csFieldLabel">推理强度（reasoningEffort，可选）</span>
          <input
            className="csFieldInput"
            value={agentValue.reasoningEffort ?? ''}
            placeholder="留空使用默认"
            spellCheck={false}
            onChange={(e: ChangeEvent<HTMLInputElement>) => void agentScope.set('reasoningEffort', e.target.value)}
          />
        </label>
      </div>

      {!writable && (
        <p className="csFieldHint">当前设置只读（宿主以只读方式挂载），保存按钮已禁用。</p>
      )}

      {/* DramaServer 官方模型（只读区块：目录与凭据由 Host 网关维护，用户不可编辑） */}
      <div className="csModelOfficial">
        <div className="csModelOfficialHead">
          <span className="csModelCardTitle">DramaServer 官方模型</span>
          {gatewayRow !== undefined
            ? <span className="csModelBadge csModelBadgeBrand">内置 · 只读</span>
            : <span className="csModelBadge csModelBadgePending">待接入</span>}
          {gatewayRow !== undefined && (
            <button
              type="button"
              className="csFieldButton csModelOfficialRefresh"
              onClick={() => { void refresh() }}
            >刷新目录</button>
          )}
        </div>
        {gatewayRow === undefined ? (
          <p className="csFieldHint">
            登录 VideoBuddy 账号后，此处将自动提供 DramaServer 官方模型目录（模型管理面接入中，无需手动配置）。
          </p>
        ) : gatewayModels.length === 0 ? (
          <p className="csFieldHint">目录为空：尚未从 DramaServer 拉取到 text 模型，可点「刷新目录」重试。</p>
        ) : (
          <>
            <p className="csFieldHint">
              模型目录来自 DramaServer 管理面（/v1/models），凭据随登录自动轮换，不可手动编辑；可直接设为全局默认。
            </p>
            <div className="csModelList">
              {gatewayModels.map((mid) => {
                const isCur = agentValue.provider === GATEWAY_PROVIDER_ID && agentValue.model === mid
                return (
                  <div className={`csModelItem${isCur ? ' csModelItemCurrent' : ''}`} key={mid}>
                    <span className="csModelItemMain">
                      <span className="csModelItemId">{mid}{isCur && <span className="csModelBadge csModelBadgeBrand">当前默认</span>}</span>
                    </span>
                    <button
                      type="button"
                      className={`csFieldButton${isCur ? '' : ' csModelPrimary'}`}
                      disabled={isCur}
                      onClick={() => setDefault(GATEWAY_PROVIDER_ID, mid)}
                    >{isCur ? '默认中' : '设为默认'}</button>
                  </div>
                )
              })}
            </div>
          </>
        )}
      </div>

      {/* Provider 折叠行列表（精简模式：deepseek + 已配置/自建；未用官方折叠） */}
      <div className="csModelProviders">
        {visibleProviders.length === 0 && <p className="csFieldHint">未检测到可配置的模型 provider。</p>}
        {visibleProviders.map((p) => {
          const draft = drafts[p.provider]
          if (draft === undefined || !p.settingsNs) return null
          const { ns, profile } = profileOf(p)
          const keyRef = profile && typeof profile.apiKeyEnv === 'string' && profile.apiKeyEnv.length > 0
            ? profile.apiKeyEnv
            : deriveKeyRef(p.provider)
          const cred = credMap[keyRef]
          const removable = ns !== undefined && p.settingsPath.length > 0
            && hasAt(ns.user, p.settingsPath) && !hasAt(ns.base, p.settingsPath)
          const isBusy = busy[p.provider] === true
          const isCur = agentValue.provider === p.provider
          const open = expanded === p.provider
          const keyDot = keyDotOf(p)
          return (
            <div className={`csModelRow${open ? ' csModelRowOpen' : ''}`} key={p.provider}>
              <div className="csModelRowHead" onClick={() => setExpanded(open ? null : p.provider)}>
                <span className={`csModelChev${open ? ' csModelChevOpen' : ''}`} aria-hidden>▶</span>
                <span className="csModelRowName">{draft.displayName || p.displayName}</span>
                {p.active
                  ? <span className="csModelBadge csModelBadgeOn">已激活</span>
                  : <span className="csModelBadge">未激活</span>}
                {p.declared === true && <span className="csModelBadge">自定义</span>}
                {keyDot !== 'none' && (
                  <span
                    className={`csModelKeyDot${keyDot === 'ok' ? ' csModelKeyDotOk' : ' csModelKeyDotMiss'}`}
                    title={keyDot === 'ok' ? `凭据引用 ${keyRef}，已配置` : `凭据引用 ${keyRef}，未配置`}
                  />
                )}
                <span className="csModelRowSub">{summarizeModels(draft.models)}</span>
                <button
                  type="button"
                  className="csFieldButton csModelPrimary"
                  disabled={isBusy}
                  onClick={(e) => { e.stopPropagation(); setDefault(p.provider, draft.models[0] ?? agentValue.model) }}
                >{isCur ? '默认中' : '设为默认'}</button>
                {removable && (
                  <button
                    type="button"
                    className="csFieldButton csModelDanger"
                    disabled={isBusy || !writable}
                    onClick={(e) => { e.stopPropagation(); void removeProvider(p) }}
                  >移除</button>
                )}
                <button
                  type="button"
                  className="csFieldButton"
                  onClick={(e) => { e.stopPropagation(); setExpanded(open ? null : p.provider) }}
                >{open ? '收起' : '编辑'}</button>
              </div>

              {open && (
                <div className="csModelRowBody">
                  <label className="csField">
                    <span className="csFieldLabel">展示名</span>
                    <input
                      className="csFieldInput"
                      value={draft.displayName}
                      placeholder={p.displayName}
                      disabled={isBusy || !writable}
                      onChange={(e: ChangeEvent<HTMLInputElement>) => patchDraft(p.provider, { displayName: e.target.value })}
                    />
                  </label>

                  <label className="csField">
                    <span className="csFieldLabel">API 地址（Base URL）</span>
                    <input
                      className="csFieldInput"
                      value={draft.baseURL}
                      placeholder="留空使用 provider 默认"
                      spellCheck={false}
                      disabled={isBusy || !writable}
                      onChange={(e: ChangeEvent<HTMLInputElement>) => patchDraft(p.provider, { baseURL: e.target.value })}
                    />
                  </label>

                  <label className="csField">
                    <span className="csFieldLabel">
                      {profile !== undefined && typeof profile.apiKeyEnv === 'string' && profile.apiKeyEnv.length > 0
                        ? `API Key（凭据引用 ${keyRef}${cred?.configured ? '，已配置' : '，未配置'}）`
                        : 'API Key（未引用凭据：自部署无鉴权端点可留空直接使用）'}
                    </span>
                    <div className="csFieldRow">
                      <input
                        className="csFieldInput"
                        type="password"
                        placeholder={cred?.configured ? '已保存，留空不改；输入新值覆盖' : '需要鉴权时输入密钥后点保存'}
                        value={draft.keyDraft}
                        disabled={isBusy || !writable}
                        onChange={(e: ChangeEvent<HTMLInputElement>) => patchDraft(p.provider, { keyDraft: e.target.value })}
                      />
                      {profile !== undefined && typeof profile.apiKeyEnv === 'string' && profile.apiKeyEnv.length > 0 && cred?.configured !== true && (
                        <button
                          type="button"
                          className="csFieldButton"
                          disabled={isBusy || !writable}
                          onClick={() => { void clearKeyRef(p) }}
                        >清除引用</button>
                      )}
                    </div>
                  </label>

                  {/* 模型清单编辑 */}
                  <div className="csField">
                    <span className="csFieldLabel">模型清单（留空 = 使用 provider 目录自带）</span>
                    {draft.models.map((mid, idx) => (
                      <div className="csFieldRow" key={`${p.provider}-${idx}`}>
                        <input
                          className="csFieldInput"
                          value={mid}
                          spellCheck={false}
                          disabled={isBusy || !writable}
                          onChange={(e: ChangeEvent<HTMLInputElement>) => patchDraft(p.provider, { models: draft.models.map((m, i) => (i === idx ? e.target.value : m)) })}
                        />
                        <button
                          type="button"
                          className="csFieldButton"
                          disabled={isBusy || !writable}
                          onClick={() => patchDraft(p.provider, { models: draft.models.filter((_, i) => i !== idx) })}
                        >删除</button>
                      </div>
                    ))}
                    <div className="csFieldRow">
                      <button
                        type="button"
                        className="csFieldButton"
                        disabled={isBusy || !writable}
                        onClick={() => patchDraft(p.provider, { models: [...draft.models, ''] })}
                      >+ 添加模型</button>
                      <button
                        type="button"
                        className="csFieldButton"
                        disabled={isBusy || !writable}
                        onClick={() => { void discoverModels(p) }}
                      >从端点拉取</button>
                    </div>
                    {(discovered[p.provider]?.length ?? 0) > 0 && (
                      <div className="csModelDiscovered">
                        <span className="csFieldLabel">拉取到 {(discovered[p.provider] ?? []).length} 个模型：</span>
                        <ul className="csModelDiscoveredList">
                          {(discovered[p.provider] ?? []).map((m) => (
                            <li key={m.id}>{m.id}{m.name ? `（${m.name}）` : ''}</li>
                          ))}
                        </ul>
                        <button type="button" className="csFieldButton" disabled={isBusy} onClick={() => adoptDiscovered(p)}>采用清单</button>
                      </div>
                    )}
                  </div>

                  {saveError[p.provider] !== null && saveError[p.provider] !== undefined && (
                    <p className="csFieldError" role="alert">{saveError[p.provider]}</p>
                  )}

                  <div className="csModelCardActions">
                    <button
                      type="button"
                      className="csFieldButton"
                      disabled={isBusy || !writable}
                      onClick={() => { void saveProvider(p) }}
                    >{isBusy ? '保存中…' : '保存'}</button>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* 精简模式 toggle：展开/收起被折叠的未使用官方 provider */}
      {foldedProviders.length > 0 && (
        <div className="csModelFold">
          <button
            type="button"
            className="csFieldButton csModelFoldToggle"
            onClick={() => setShowFolded((v) => !v)}
          >
            {showFolded
              ? `收起未使用的 provider（隐藏 ${foldedProviders.length} 个）`
              : `显示全部 provider（共 ${providers.filter((p) => p.settingsNs !== '').length} 个）`}
          </button>
        </div>
      )}

      {/* 添加自定义 provider */}
      <div className="csModelCustom">
        <button
          type="button"
          className="csFieldButton"
          onClick={() => { setCustomOpen((v) => !v); setCustomError(null) }}
        >{customOpen ? '收起自定义 provider' : '+ 添加自定义 provider（自部署 / 第三方 OpenAI 兼容）'}</button>
        {customOpen && (
          <div className="csModelCustomForm">
            <label className="csField">
              <span className="csFieldLabel">路由 id（小写字母数字加连字符，字母开头）</span>
              <input className="csFieldInput" value={cRoute} placeholder="如 my-local-llm" spellCheck={false}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setCRoute(e.target.value)} />
            </label>
            <label className="csField">
              <span className="csFieldLabel">展示名（可选）</span>
              <input className="csFieldInput" value={cName} onChange={(e: ChangeEvent<HTMLInputElement>) => setCName(e.target.value)} />
            </label>
            <label className="csField">
              <span className="csFieldLabel">API 地址（Base URL）</span>
              <input className="csFieldInput" value={cBase} placeholder="https://your-endpoint/v1" spellCheck={false}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setCBase(e.target.value)} />
            </label>
            <label className="csField">
              <span className="csFieldLabel">协议（api，默认 openai-completions = OpenAI 兼容）</span>
              <input className="csFieldInput" value={cProtocol} spellCheck={false}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setCProtocol(e.target.value)} />
            </label>
            <label className="csField">
              <span className="csFieldLabel">API Key（可选，写凭据域）</span>
              <input className="csFieldInput" type="password" value={cKey}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setCKey(e.target.value)} />
            </label>
            <label className="csField">
              <span className="csFieldLabel">模型 id（至少一个，逗号或逐行添加）</span>
              <input className="csFieldInput" value={cModels.join(', ')} placeholder="gpt-4o, gpt-4o-mini"
                spellCheck={false}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setCModels(
                  e.target.value.split(/[,\n]/).map((s) => s.trim()).filter((s) => s.length > 0),
                )} />
            </label>
            {customError !== null && <p className="csFieldError" role="alert">{customError}</p>}
            <div className="csModelCardActions">
              <button type="button" className="csFieldButton csModelPrimary" disabled={customBusy} onClick={() => { void addCustom() }}>
                {customBusy ? '添加中…' : '添加 provider'}
              </button>
            </div>
          </div>
        )}
      </div>

      <p className="csFieldHint">
        该配置与桌面「设置 → 模型」共享同一份存储；需要鉴权的服务商填 Base URL + Key，密钥只存凭据域不落明文。
        底层对任何端点都要求非空密钥：无鉴权自部署端点请在 API Key 填任意占位符（如 -），或在 settings.yaml
        的该 provider 下加 headers: {'{'} authorization: unused {'}'}。DramaServer 官方区块为只读展示：
        目录与凭据由登录态自动维护，无需手动填写。
      </p>
    </div>
  )
}
