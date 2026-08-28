/**
 * Canvas Studio「模型」设置面板（provider 感知，完整功能）。
 *
 * 设计：不直接复用桌面 dsh 的 `ModelsSettingsStore` / `ModelsSection`（包内私有、
 * 不导出，且没有打开桌面设置页的命令），而是调用与 dsh **完全相同**的 Host wire
 * 接口（经 canvas-studio 已有的 `connection` 服务）：
 * - `llm.providers({})`            拉可配置 provider 目录（自部署 / OpenAI / DeepSeek / 自定义…）
 * - `settings.describe({})`        拉全量命名空间视图（含已解析值 + revision）
 * - `settings.mutate({...})`       写 provider profile（base URL / 模型清单 / apiKeyEnv）
 * - `credentials.set/describe`     密钥走凭据域，不落明文
 *
 * 因此本面板与桌面原生「模型」设置共享同一份存储：在桌面设置里看到的配置，这里也能
 * 改；反之亦然。写入格式严格对齐 dsh（path ops + 派生凭据引用），不会损坏其它字段。
 */
import {
  useCallback, useEffect, useMemo, useState, useSyncExternalStore, type ChangeEvent, type ReactElement,
} from 'react'
import type { SettingsScope } from '@deepseek-ai/dsh-client-runtime/client'
import type {
  CanvasStudioModelApi, CanvasStudioSettingsScope, ConfigurableProviderView,
  DiscoveredModelView, SettingsNamespaceView, SettingsPathOpView,
} from './contracts.js'

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

export interface ModelSettingsPanelProps {
  /** 惰性取模型设置所需的 Host wire 接口。 */
  getModelApi: () => CanvasStudioModelApi | undefined
  /** 绑定 settings 命名空间的作用域（默认模型写 'agent-default-model'）。 */
  settingsScope: CanvasStudioSettingsScope
}

// ---- 通用的安全取值 / 派生工具 ----

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

/** 把 profile.models（可能是字符串数组或 {id} 对象数组）规范成 id 字符串数组。 */
function asModelIds(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((m) => {
      if (typeof m === 'string') return m
      if (m !== null && typeof m === 'object' && 'id' in m) return String((m as { id: unknown }).id)
      return ''
    })
    .filter((s) => s.length > 0)
}

/** 派生 provider 的凭据引用（与 dsh deriveKeyRef 完全一致）。 */
function deriveKeyRef(provider: string): string {
  return `${provider.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_API_KEY`
}

interface ProviderDraft {
  displayName: string
  baseURL: string
  models: string[]
  keyDraft: string
}

/** 订阅 settingsScope 的响应式快照（与 DesktopSettingsSection.useScope 同构）。 */
function useScope<T>(scope: SettingsScope<T>) {
  const subscribe = useMemo(() => (listener: () => void) => scope.subscribe(listener), [scope])
  const snapshot = useMemo(() => () => scope.getSnapshot(), [scope])
  return useSyncExternalStore(subscribe, snapshot)
}

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

  // 自定义 provider 表单态。
  const [customOpen, setCustomOpen] = useState(false)
  const [customBusy, setCustomBusy] = useState(false)
  const [customError, setCustomError] = useState<string | null>(null)
  const [cRoute, setCRoute] = useState('')
  const [cName, setCName] = useState('')
  const [cBase, setCBase] = useState('')
  const [cProtocol, setCProtocol] = useState('openai')
  const [cKey, setCKey] = useState('')
  const [cModels, setCModels] = useState<string[]>([])

  // 默认模型作用域（agent-default-model）。
  const agentScope = useMemo(
    () => settingsScope.bind<AgentModelConfig>({ namespace: 'agent-default-model' }),
    [settingsScope],
  )
  const agentSnap = useScope(agentScope)
  const agentValue = agentSnap.value

  /** 拉取 provider 目录 + 命名空间视图 + 密钥态。 */
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
      const [provRes, setRes] = await Promise.all([
        api.llm.providers({}),
        api.settings.describe({}),
      ])
      if (!provRes.result.ok) throw new Error(provRes.result.error.message)
      if (!setRes.result.ok) throw new Error(setRes.result.error.message)
      const provList = provRes.result.value.providers
      const nsList = setRes.result.value.namespaces
      const draftMap: Record<string, ProviderDraft> = {}
      const refs: string[] = []
      for (const p of provList) {
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
      if (refs.length > 0) {
        try {
          const cRes = await api.credentials.describe({ refs })
          cm = cRes.credentials ?? {}
        } catch {
          // 密钥态查询失败不阻塞面板，仅密钥已配置标记缺失。
        }
      }
      setProviders(provList)
      setNamespaces(nsList)
      setWritable(setRes.result.value.writable)
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
      const value: Record<string, unknown> = {}
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
    }
    setBusy((b) => ({ ...b, [p.provider]: true }))
    setSaveError((m) => ({ ...m, [p.provider]: null }))
    try {
      if (ops.length > 0) {
        const res = await api.settings.mutate({ ns: p.settingsNs, ops, expectedRevision: ns.revision })
        if (!res.result.ok) {
          throw new Error(res.result.error.code === 'settings-conflict' ? '配置已被其它改动覆盖，请刷新后重试' : res.result.error.message)
        }
      }
      if (draft.keyDraft) {
        await api.credentials.set({ ref: keyRef, value: draft.keyDraft })
      }
      await refresh()
    } catch (cause) {
      setSaveError((m) => ({ ...m, [p.provider]: cause instanceof Error ? cause.message : '保存失败' }))
    } finally {
      setBusy((b) => ({ ...b, [p.provider]: false }))
    }
  }, [getModelApi, profileOf, drafts, refresh])

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
        try { await api.credentials.unset({ ref: keyRef }) } catch { /* 密钥已不存在则忽略 */ }
      }
      const res = await api.settings.mutate({ ns: p.settingsNs, ops: [{ op: 'unset', path: [...p.settingsPath] }], expectedRevision: ns.revision })
      if (!res.result.ok) throw new Error(res.result.error.message)
      await refresh()
    } catch (cause) {
      setSaveError((m) => ({ ...m, [p.provider]: cause instanceof Error ? cause.message : '移除失败' }))
    } finally {
      setBusy((b) => ({ ...b, [p.provider]: false }))
    }
  }, [getModelApi, profileOf, refresh])

  /** 从端点拉取该 provider 当前广告的模型清单。 */
  const discoverModels = useCallback(async (p: ConfigurableProviderView) => {
    const api = getModelApi()
    if (api === undefined) return
    const draft = drafts[p.provider]
    if (draft === undefined) return
    try {
      const res = await api.llm.discoverModels({
        settingsNs: p.settingsNs,
        provider: p.provider,
        ...(draft.baseURL ? { baseURL: draft.baseURL } : {}),
        ...(draft.keyDraft ? { apiKey: draft.keyDraft } : {}),
      })
      if (!res.result.ok) throw new Error(res.result.error.message)
      const models = res.result.value.models
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
    const profile: Record<string, unknown> = { api: cProtocol, baseURL: cBase, models: cModels.map((id) => ({ id })) }
    if (cName) profile.displayName = cName
    if (cKey) profile.apiKeyEnv = keyRef
    setCustomBusy(true)
    setCustomError(null)
    try {
      const res = await api.settings.mutate({ ns: CUSTOM_NS, ops: [{ op: 'set', path: ['providers', cRoute], value: profile }], expectedRevision: ns.revision })
      if (!res.result.ok) throw new Error(res.result.error.message)
      if (cKey) await api.credentials.set({ ref: keyRef, value: cKey })
      setCRoute(''); setCName(''); setCBase(''); setCProtocol('openai'); setCKey(''); setCModels([]); setCustomOpen(false)
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

      {/* Provider 卡片列表 */}
      <div className="csModelProviders">
        {providers.length === 0 && <p className="csFieldHint">未检测到可配置的模型 provider。</p>}
        {providers.map((p) => {
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
          return (
            <div className="csModelCard" key={p.provider}>
              <div className="csModelCardHead">
                <span className="csModelCardTitle">{draft.displayName || p.displayName}</span>
                {p.active
                  ? <span className="csModelBadge csModelBadgeOn">已激活</span>
                  : <span className="csModelBadge">未激活</span>}
                {p.declared === true && <span className="csModelBadge">自定义</span>}
              </div>

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
                  API Key（凭据引用 {keyRef}{cred?.configured ? '，已配置' : '，未配置'}）
                </span>
                <input
                  className="csFieldInput"
                  type="password"
                  placeholder={cred?.configured ? '已保存，留空不改；输入新值覆盖' : '输入密钥后点保存'}
                  value={draft.keyDraft}
                  disabled={isBusy || !writable}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => patchDraft(p.provider, { keyDraft: e.target.value })}
                />
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
                <button
                  type="button"
                  className="csFieldButton csModelPrimary"
                  disabled={isBusy}
                  onClick={() => setDefault(p.provider, draft.models[0] ?? agentValue.model)}
                >设为默认</button>
                {removable && (
                  <button
                    type="button"
                    className="csFieldButton csModelDanger"
                    disabled={isBusy || !writable}
                    onClick={() => { void removeProvider(p) }}
                  >移除</button>
                )}
              </div>
            </div>
          )
        })}
      </div>

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
              <span className="csFieldLabel">协议（api，默认 openai = OpenAI 兼容）</span>
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
        该配置与桌面「设置 → 模型」共享同一份存储；自部署或其它服务商的 provider 填 Base URL + Key 即可，
        密钥只存凭据域不落明文。
      </p>
    </div>
  )
}
