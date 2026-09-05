/**
 * Canvas Studio 设置弹窗（浏览器半侧，自包含 UI）。
 *
 * 不依赖桌面全局 Plugins 面板（ui-settings-plugins 未装入当前桌面），由 canvas-studio
 * 自带弹窗承载配置；主页画布上的「设置」按钮 → 弹出本弹窗 → 分区编辑 → 经
 * 不同作用域回写：
 * - 通用：绑定 'canvas-studio' 命名空间（Drama 连接；Host 侧 source() 实时读到）。
 * - 输出 / 工作流 / 存储：同样绑定 'canvas-studio' 命名空间，分字段回写（画幅比例已接入
 *   生成兜底，其余字段待 P2-P4 管线消费，见 plan.md §1.7 消费状态表）。
 * - 主题：复用桌面 dsh-client-ui-theme 的 ctx.theme 运行时（全局浅色/深色/跟随系统）。
 * - 模型：自实现的 provider 感知面板（见 ModelSettingsPanel）。直接复用桌面 dsh 的
 *   `ModelsSettingsStore` / `ModelsSection` 不可行——它们包内私有、不导出，且没有打开
 *   桌面设置页的命令。本面板改为调用与 dsh 完全相同的 Host wire 接口（llm.providers /
 *   settings.describe + settings.mutate / credentials.set），因此与桌面「设置 → 模型」
 *   共享同一份存储、功能对等：支持 DeepSeek / Anthropic / 自部署 OpenAI 兼容 / 自定义
 *   provider，填 Base URL + API Key、拉模型清单、设为默认。该配置为桌面全局默认模型，
 *   驱动 Canvas Studio 创作流水线。
 *
 * 密钥走凭据域（credentials.set），不落明文。订阅方式照搬 dsh-plugin-desktop 的
 * DesktopSettingsSection.useScope（useSyncExternalStore）。
 */
import {
  useEffect, useMemo, useState, useSyncExternalStore, type ChangeEvent, type ReactElement,
} from 'react'
import type { SettingsScope } from '@deepseek-ai/dsh-client-runtime/client'
import type { ThemeRuntime } from '@deepseek-ai/dsh-client-ui-theme/client'
import { BRAND_PRESETS, BRAND_PRESET_IDS, type BrandPresetId } from '../brand.js'
import { BRAND } from '../brand-copy.js'
import type { CanvasStudioConfig } from '../host-config.js'
import type { CanvasStudioCredentials, CanvasStudioModelApi, CanvasStudioSettingsScope } from './contracts.js'
import { applyBrandPreset } from './brand-inject.js'
import { ModelSettingsPanel } from './ModelSettingsPanel.js'

export interface SettingsModalProps {
  /** 绑定 'canvas-studio' 命名空间的 settings 作用域（通用分区用）。 */
  settingsScope: CanvasStudioSettingsScope
  /** 惰性取凭据客户端（密钥写凭据域，不落明文）。 */
  getCredentials: () => CanvasStudioCredentials | undefined
  /** 惰性取模型设置所需的 Host wire 接口（llm/settings/credentials 三域）。 */
  getModelApi: () => CanvasStudioModelApi | undefined
  /** 惰性取桌面原生目录选择器（资产库位置用）；dsh workspaces 服务未就绪时返回 undefined。 */
  getDirectoryPicker: () => { pick: () => Promise<string | null> } | undefined
  /** 桌面主题运行时（主题分区复用，切换全局浅色/深色/跟随系统）。 */
  theme: ThemeRuntime
  /** 关闭弹窗（点背景 / 关闭按钮 / Esc）。 */
  onClose: () => void
}

/** 复用桌面 agent-default-model 命名空间的编排 LLM 配置形状（见 ModelSettingsPanel）。 */
type SettingsTab = 'general' | 'theme' | 'model' | 'output' | 'workflow' | 'storage'

/** 订阅 settingsScope 的响应式快照（与 DesktopSettingsSection.useScope 同构）。 */
function useScope<T>(scope: SettingsScope<T>) {
  const subscribe = useMemo(() => (listener: () => void) => scope.subscribe(listener), [scope])
  const snapshot = useMemo(() => () => scope.getSnapshot(), [scope])
  return useSyncExternalStore(subscribe, snapshot)
}

/** 主题 id → 中文标签。 */
function themeLabel(id: string): string {
  if (id === 'light') return '浅色'
  if (id === 'dark') return '深色'
  if (id === 'system') return '跟随系统'
  return id
}

/** 通用分区：Drama API 基址 / 视频时长上限 / API Key（凭据域）。 */
function GeneralSection(props: {
  settingsScope: CanvasStudioSettingsScope
  getCredentials: () => CanvasStudioCredentials | undefined
}): ReactElement {
  const { settingsScope, getCredentials } = props
  const scope = useMemo(
    () => settingsScope.bind<CanvasStudioConfig>({ namespace: 'canvas-studio' }),
    [settingsScope],
  )
  const snapshot = useScope(scope)
  const value = snapshot.value
  const base = snapshot.base as Partial<CanvasStudioConfig> | undefined

  const [keyInput, setKeyInput] = useState('')
  const [credState, setCredState] = useState<{ configured: boolean; writable: boolean } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // TinyFish 联网搜索 key（凭据域 ref，与 dsh-web-search-tinyfish 插件的 apiKeyEnv 对齐）。
  const TINYFISH_REF = 'TINYFISH_API_KEY'
  const [tinyfishInput, setTinyfishInput] = useState('')
  const [tinyfishCred, setTinyfishCred] = useState<{ configured: boolean; writable: boolean } | null>(null)
  const [tinyfishBusy, setTinyfishBusy] = useState(false)
  const [tinyfishError, setTinyfishError] = useState<string | null>(null)
  // 保存成功的瞬时反馈（几秒后自动消失，避免「输入框清空 = 没生效」的歧义）。
  const [dramaSaved, setDramaSaved] = useState(false)
  const [tinyfishSaved, setTinyfishSaved] = useState(false)
  // fal API key（阶段 4：视频供应商 fal H3 的凭据域，与 Drama key 同一形态）。
  const [falKeyInput, setFalKeyInput] = useState('')
  const [falCred, setFalCred] = useState<{ configured: boolean; writable: boolean } | null>(null)
  const [falBusy, setFalBusy] = useState(false)
  const [falError, setFalError] = useState<string | null>(null)
  const [falSaved, setFalSaved] = useState(false)

  useEffect(() => {
    if (value === undefined) return
    const credentials = getCredentials()
    if (credentials === undefined) { setTinyfishCred(null); return }
    let cancelled = false
    credentials.describe({ refs: [TINYFISH_REF] })
      .then((res) => {
        if (cancelled) return
        const view = res.result.ok ? res.result.value.credentials[TINYFISH_REF] : null
        setTinyfishCred(view?.configured === true ? view : null)
      })
      .catch(() => { if (!cancelled) setTinyfishCred(null) })
    return () => { cancelled = true }
  }, [getCredentials, value])

  useEffect(() => {
    if (value === undefined) return
    const ref = value.dramaApiKey
    let cancelled = false
    const credentials = getCredentials()
    if (credentials === undefined) { setCredState(null); return }
    credentials.describe({ refs: [ref] })
      .then((res) => {
        if (cancelled) return
        const view = res.result.ok ? res.result.value.credentials[ref] : null
        setCredState(view?.configured === true ? view : null)
      })
      .catch(() => { if (!cancelled) setCredState(null) })
    return () => { cancelled = true }
  }, [getCredentials, value?.dramaApiKey])

  useEffect(() => {
    if (value === undefined) return
    const ref = value.falApiKey
    let cancelled = false
    const credentials = getCredentials()
    if (credentials === undefined) { setFalCred(null); return }
    credentials.describe({ refs: [ref] })
      .then((res) => {
        if (cancelled) return
        const view = res.result.ok ? res.result.value.credentials[ref] : null
        setFalCred(view?.configured === true ? view : null)
      })
      .catch(() => { if (!cancelled) setFalCred(null) })
    return () => { cancelled = true }
  }, [getCredentials, value?.falApiKey])

  if (value === undefined) {
    return <div className="csField">加载中…</div>
  }

  const onBase = (v: string): void => { void scope.set('dramaApiBase', v) }
  const onSeconds = (v: string): void => {
    // CR-050：清空输入（'' → Number 为 0）跳过，不把 maxVideoSeconds 写成 0。
    if (v.trim().length === 0) return
    const n = Number(v)
    if (Number.isFinite(n)) void scope.set('maxVideoSeconds', n)
  }
  const onSaveKey = async (): Promise<void> => {
    if (keyInput.length === 0) return
    const credentials = getCredentials()
    if (credentials === undefined) { setError('凭据服务不可用：当前环境未提供 credentials'); return }
    setBusy(true)
    setError(null)
    try {
      await credentials.set({ ref: value.dramaApiKey, value: keyInput })
      setKeyInput('')
      setCredState({ configured: true, writable: true })
      setDramaSaved(true)
      window.setTimeout(() => setDramaSaved(false), 2500)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '密钥保存失败')
    } finally {
      setBusy(false)
    }
  }
  /** 保存 TinyFish 联网搜索 key 到凭据域（ref 与 tinyfish 插件一致）。 */
  const saveTinyfishKey = async (): Promise<void> => {
    if (tinyfishInput.length === 0) return
    const credentials = getCredentials()
    if (credentials === undefined) { setTinyfishError('凭据服务不可用：当前环境未提供 credentials'); return }
    setTinyfishBusy(true)
    setTinyfishError(null)
    try {
      await credentials.set({ ref: TINYFISH_REF, value: tinyfishInput })
      setTinyfishInput('')
      setTinyfishCred({ configured: true, writable: true })
      setTinyfishSaved(true)
      window.setTimeout(() => setTinyfishSaved(false), 2500)
    } catch (cause) {
      setTinyfishError(cause instanceof Error ? cause.message : 'TinyFish key 保存失败')
    } finally {
      setTinyfishBusy(false)
    }
  }

  /** 保存 fal key 到凭据域（阶段 4；ref 来自设置项 falApiKey，形态与 Drama key 一致）。 */
  const saveFalKey = async (): Promise<void> => {
    if (falKeyInput.length === 0) return
    const credentials = getCredentials()
    if (credentials === undefined) { setFalError('凭据服务不可用：当前环境未提供 credentials'); return }
    setFalBusy(true)
    setFalError(null)
    try {
      await credentials.set({ ref: value.falApiKey, value: falKeyInput })
      setFalKeyInput('')
      setFalCred({ configured: true, writable: true })
      setFalSaved(true)
      window.setTimeout(() => setFalSaved(false), 2500)
    } catch (cause) {
      setFalError(cause instanceof Error ? cause.message : 'fal key 保存失败')
    } finally {
      setFalBusy(false)
    }
  }

  return (
    <>
      <label className="csField">
        <span className="csFieldLabel">Drama API 基址</span>
        <input
          className="csFieldInput"
          value={value.dramaApiBase}
          placeholder={base?.dramaApiBase}
          spellCheck={false}
          onChange={(event: ChangeEvent<HTMLInputElement>) => onBase(event.target.value)}
        />
      </label>
      <label className="csField">
        <span className="csFieldLabel">视频时长上限（秒，1–15）</span>
        <input
          className="csFieldInput"
          type="number"
          min={1}
          max={15}
          value={value.maxVideoSeconds}
          onChange={(event: ChangeEvent<HTMLInputElement>) => onSeconds(event.target.value)}
        />
      </label>
      <div className="csField">
        <span className="csFieldLabel">
          Drama API Key（凭据引用 {value.dramaApiKey}{credState?.configured ? '，已配置' : '，未配置'}）
        </span>
        <div className="csFieldRow">
          <input
            className="csFieldInput"
            type="password"
            placeholder={credState?.configured ? '已保存，留空保持不变；输入新值覆盖' : '输入密钥后点保存'}
            value={keyInput}
            onChange={(event: ChangeEvent<HTMLInputElement>) => setKeyInput(event.target.value)}
          />
          <button
            type="button"
            className="csFieldButton"
            disabled={busy || keyInput.length === 0}
            onClick={() => { void onSaveKey() }}
          >
            {busy ? '保存中…' : '保存密钥'}
          </button>
          {dramaSaved && <span className="csFieldHint">已保存</span>}
        </div>
        {error !== null && <p className="csFieldError" role="alert">{error}</p>}
      </div>
      <div className="csField">
        <span className="csFieldLabel">
          fal API Key（凭据引用 {value.falApiKey}{falCred?.configured ? '，已配置' : '，未配置'}）
        </span>
        <div className="csFieldRow">
          <input
            className="csFieldInput"
            type="password"
            placeholder={falCred?.configured ? '已保存，留空保持不变；输入新值覆盖' : '输入 fal 密钥（Key xxx）后点保存'}
            spellCheck={false}
            value={falKeyInput}
            onChange={(event: ChangeEvent<HTMLInputElement>) => setFalKeyInput(event.target.value)}
          />
          <button
            type="button"
            className="csFieldButton"
            disabled={falBusy || falKeyInput.length === 0}
            onClick={() => { void saveFalKey() }}
          >
            {falBusy ? '保存中…' : '保存密钥'}
          </button>
          {falSaved && <span className="csFieldHint">已保存</span>}
        </div>
        <p className="csFieldHint">视频供应商切换为「fal H3」时必需；留空则 fal 生成会报「未配置 fal API Key」。</p>
        {falError !== null && <p className="csFieldError" role="alert">{falError}</p>}
      </div>
      <div className="csField">
        <span className="csFieldLabel">
          TinyFish 联网搜索 Key（{TINYFISH_REF}{tinyfishCred?.configured ? '，已配置' : '，未配置'}）
        </span>
        <div className="csFieldRow">
          <input
            className="csFieldInput"
            type="password"
            placeholder={tinyfishCred?.configured ? '已保存，留空保持不变；输入新值覆盖' : '输入 TinyFish 免费 key 后点保存'}
            spellCheck={false}
            value={tinyfishInput}
            onChange={(event: ChangeEvent<HTMLInputElement>) => setTinyfishInput(event.target.value)}
          />
          <button
            type="button"
            className="csFieldButton"
            disabled={tinyfishBusy || tinyfishInput.length === 0}
            onClick={() => { void saveTinyfishKey() }}
          >
            {tinyfishBusy ? '保存中…' : '保存密钥'}
          </button>
          {tinyfishSaved && <span className="csFieldHint">已保存</span>}
        </div>
        {tinyfishError !== null && <p className="csFieldError" role="alert">{tinyfishError}</p>}
      </div>
    </>
  )
}

/** 主题分区：复用桌面 ctx.theme，切换全局浅色/深色/跟随系统。 */
function ThemeSection(props: { theme: ThemeRuntime }): ReactElement {
  const { theme } = props
  // 用 useSyncExternalStore 让 React 每次渲染都拿最新 snapshot。
  // dsh 的 ThemeRuntime 不暴露 subscribe，但 setTheme 是同步的：
  //   内部 this.preference = id → this.publish() → this.snapshot 重建 → ctx.emit('theme/change')。
  // getSnapshot 每次返回最新 this.snapshot，配合 onClick 后 setSnap 强制触发重渲染。
  // 另在 rAF 兜底再读一次，兼容 dsh layout 在 theme/change 之后异步刷 body[data-ds-dark-theme] 的 race。
  const subscribe = useMemo(() => (listener: () => void) => {
    void listener
    return () => { /* ThemeRuntime 不暴露订阅；状态由 onClick 同步 setSnap 驱动 */ }
  }, [])
  const getSnapshot = useMemo(() => () => theme.getTheme(), [theme])
  const snap = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  const [, forceTick] = useState(0)

  const select = (id: string): void => {
    theme.setTheme(id)
    // 同步读一次立即刷新弹窗文字（setTheme 内部同步重建 snapshot）。
    forceTick((n) => n + 1)
    // rAF 兜底：等 dsh layout 在下一帧把 body[data-ds-dark-theme] / token 应用到 DOM 后，
    // 再读一次确保弹窗的「当前：xxx（深/浅）」显示跟实际渲染一致。
    requestAnimationFrame(() => { forceTick((n) => n + 1) })
  }
  const options = [
    ...snap.themes.map((definition) => ({ id: definition.id, label: themeLabel(definition.id) })),
    { id: 'system', label: '跟随系统' },
  ]
  const activeId = snap.preference === 'system' ? 'system' : snap.active.id

  return (
    <div className="csField">
      <span className="csFieldLabel">外观主题（全局生效，影响整个桌面）</span>
      <div className="csThemeOptions">
        {options.map((opt) => (
          <button
            key={opt.id}
            type="button"
            className={activeId === opt.id ? 'csThemeOption csThemeOptionActive' : 'csThemeOption'}
            onClick={() => select(opt.id)}
          >
            {opt.label}
          </button>
        ))}
      </div>
      <p className="csFieldHint">
        当前：{themeLabel(activeId)}（{snap.active.colorScheme === 'dark' ? '深色' : '浅色'}）
      </p>
    </div>
  )
}

/** 模型分区：provider 感知的完整设置面板（写 host wire 三域，状态与桌面设置共享）。 */
function ModelSection(props: { settingsScope: CanvasStudioSettingsScope; getModelApi: () => CanvasStudioModelApi | undefined }): ReactElement {
  const { settingsScope, getModelApi } = props
  return <ModelSettingsPanel settingsScope={settingsScope} getModelApi={getModelApi} />
}

/** 品牌配色分区：4 套 --cs-* 预设 swatch，选择即切换并持久化到 'canvas-studio' 命名空间。 */
function BrandSection(props: { settingsScope: CanvasStudioSettingsScope }): ReactElement {
  const { settingsScope } = props
  const scope = useMemo(() => settingsScope.bind<CanvasStudioConfig>({ namespace: 'canvas-studio' }), [settingsScope])
  const snapshot = useScope(scope)
  const value = snapshot.value
  if (value === undefined) return <div className="csField">加载中…</div>
  const onSelect = (id: BrandPresetId): void => {
    // 立即应用（更新 --cs-* 令牌与 data-cs-brand 属性）+ 持久化，重启保持。
    applyBrandPreset(id)
    void scope.set('brandPreset', id)
  }
  return (
    <div className="csField">
      <span className="csFieldLabel">品牌配色（{BRAND.name} 专属，不影响宿主主题）</span>
      <div className="csBrandSwatches">
        {BRAND_PRESET_IDS.map((id) => {
          const preset = BRAND_PRESETS[id]
          return (
            <button
              key={id}
              type="button"
              title={preset.description}
              aria-pressed={value.brandPreset === id}
              className={value.brandPreset === id ? 'csBrandSwatch csBrandSwatchActive' : 'csBrandSwatch'}
              onClick={() => onSelect(id)}
            >
              <span className="csBrandSwatchChip" style={{ background: preset.accent }} aria-hidden="true" />
              <span className="csBrandSwatchName">{preset.label}</span>
            </button>
          )
        })}
      </div>
      <p className="csFieldHint">切换即时生效并记住选择；默认「电影紫」。</p>
    </div>
  )
}

/** 输出与导出分区：默认画幅比例（已接入生成兜底）+ 导出格式/目录/质量（待 P3 导出管线）。 */
function OutputSection(props: { settingsScope: CanvasStudioSettingsScope }): ReactElement {
  const { settingsScope } = props
  const scope = useMemo(() => settingsScope.bind<CanvasStudioConfig>({ namespace: 'canvas-studio' }), [settingsScope])
  const snapshot = useScope(scope)
  const value = snapshot.value
  if (value === undefined) return <div className="csField">加载中…</div>
  return (
    <>
      <label className="csField">
        <span className="csFieldLabel">默认画幅比例</span>
        <select
          className="csFieldSelect"
          value={value.defaultAspectRatio}
          onChange={(event: ChangeEvent<HTMLSelectElement>) => void scope.set('defaultAspectRatio', event.target.value as CanvasStudioConfig['defaultAspectRatio'])}
        >
          <option value="16:9">16:9（横屏）</option>
          <option value="9:16">9:16（竖屏）</option>
          <option value="1:1">1:1（方形）</option>
        </select>
        <p className="csFieldHint">agent 未指定画幅时，生成按此兜底（已生效）。</p>
      </label>
      <label className="csField">
        <span className="csFieldLabel">默认视频供应商</span>
        <select
          className="csFieldSelect"
          value={value.defaultVideoProvider}
          onChange={(event: ChangeEvent<HTMLSelectElement>) => void scope.set('defaultVideoProvider', event.target.value as CanvasStudioConfig['defaultVideoProvider'])}
        >
          <option value="drama">Drama（默认）</option>
          <option value="fal">fal H3</option>
        </select>
        <p className="csFieldHint">生成视频时未显式指定供应商则走此项；升级后默认 Drama，既有项目行为不变。</p>
      </label>
      <label className="csField">
        <span className="csFieldLabel">导出格式 <span className="csReserved">待接入</span></span>
        <select
          className="csFieldSelect"
          value={value.exportFormat}
          onChange={(event: ChangeEvent<HTMLSelectElement>) => void scope.set('exportFormat', event.target.value)}
        >
          <option value="mp4">mp4</option>
        </select>
      </label>
      <label className="csField">
        <span className="csFieldLabel">导出目录 <span className="csReserved">待接入</span></span>
        <input
          className="csFieldInput"
          value={value.exportDir}
          placeholder="留空=项目默认目录"
          spellCheck={false}
          onChange={(event: ChangeEvent<HTMLInputElement>) => void scope.set('exportDir', event.target.value)}
        />
      </label>
      <label className="csField">
        <span className="csFieldLabel">视频质量 <span className="csReserved">待接入</span></span>
        <select
          className="csFieldSelect"
          value={value.videoQuality}
          onChange={(event: ChangeEvent<HTMLSelectElement>) => void scope.set('videoQuality', event.target.value as CanvasStudioConfig['videoQuality'])}
        >
          <option value="standard">标准</option>
          <option value="high">高</option>
        </select>
      </label>
    </>
  )
}

/** 工作流偏好分区：执行模式 / HITL 门禁 / 自动重试 / 并行数（待 P2-P4 agent 编排接入消费）。 */
function WorkflowSection(props: { settingsScope: CanvasStudioSettingsScope }): ReactElement {
  const { settingsScope } = props
  const scope = useMemo(() => settingsScope.bind<CanvasStudioConfig>({ namespace: 'canvas-studio' }), [settingsScope])
  const snapshot = useScope(scope)
  const value = snapshot.value
  if (value === undefined) return <div className="csField">加载中…</div>
  const onParallel = (raw: string): void => {
    // CR-050：清空输入跳过，不把 maxParallel 写成 0。
    if (raw.trim().length === 0) return
    const n = Number(raw)
    if (Number.isFinite(n)) void scope.set('maxParallel', n)
  }
  return (
    <>
      <label className="csField">
        <span className="csFieldLabel">默认执行模式 <span className="csReserved">待接入</span></span>
        <select
          className="csFieldSelect"
          value={value.workflowMode}
          onChange={(event: ChangeEvent<HTMLSelectElement>) => void scope.set('workflowMode', event.target.value as CanvasStudioConfig['workflowMode'])}
        >
          <option value="confirm">每步人工确认</option>
          <option value="auto">全自动</option>
        </select>
        <p className="csFieldHint">
          待 P2-P4 agent 编排接入消费，<strong>当前不影响运行</strong>。今天真正生效的模式开关在
          画布顶部（「逐步确认」/「放手跑」），按<strong>项目</strong>持久化。
        </p>
      </label>
      <label className="csToggle">
        <input type="checkbox" checked={value.hitlStoryboard} onChange={(event: ChangeEvent<HTMLInputElement>) => void scope.set('hitlStoryboard', event.target.checked)} />
        <span>分镜阶段需人工批准（HITL 门禁） <span className="csReserved">待接入</span></span>
      </label>
      <p className="csFieldHint">
        该开关尚未接入：分镜审批门禁<strong>当前始终开启</strong>（无条件要求先提交分镜表获批），
        取消勾选也不会关闭它。
      </p>
      <label className="csToggle">
        <input type="checkbox" checked={value.hitlKeyframe} onChange={(event: ChangeEvent<HTMLInputElement>) => void scope.set('hitlKeyframe', event.target.checked)} />
        <span>关键帧阶段需人工批准 <span className="csReserved">待接入</span></span>
      </label>
      <label className="csToggle">
        <input type="checkbox" checked={value.autoRetry} onChange={(event: ChangeEvent<HTMLInputElement>) => void scope.set('autoRetry', event.target.checked)} />
        <span>生成失败自动重试 <span className="csReserved">待接入</span></span>
      </label>
      <label className="csField">
        <span className="csFieldLabel">最大并行生成数（1–8） <span className="csReserved">待接入</span></span>
        <input
          className="csFieldInput"
          type="number"
          min={1}
          max={8}
          value={value.maxParallel}
          onChange={(event: ChangeEvent<HTMLInputElement>) => onParallel(event.target.value)}
        />
      </label>
    </>
  )
}

/** 存储与缓存分区：资产库位置（已接通）+ 画布自动保存开关/间隔（待客户端画布自动保存接入）。 */
function StorageSection(props: {
  settingsScope: CanvasStudioSettingsScope
  getDirectoryPicker: () => { pick: () => Promise<string | null> } | undefined
}): ReactElement {
  const { settingsScope, getDirectoryPicker } = props
  const scope = useMemo(() => settingsScope.bind<CanvasStudioConfig>({ namespace: 'canvas-studio' }), [settingsScope])
  const snapshot = useScope(scope)
  const value = snapshot.value
  const [picking, setPicking] = useState(false)
  const [pickError, setPickError] = useState<string | null>(null)
  const onInterval = (raw: string): void => {
    // CR-050：清空输入跳过，不把 autoSaveInterval 写成 0。
    if (raw.trim().length === 0) return
    const n = Number(raw)
    if (Number.isFinite(n)) void scope.set('autoSaveInterval', n)
  }
  // dsh 官方 pickDirectory() 全平台走宿主原生 chooser（macOS→osascript /
  // Linux→Zenity、KDialog / Windows→IFileOpenDialog），返回的路径 Host 端已
  // 校验可写；用户取消返回 null。
  const onPickDirectory = async (): Promise<void> => {
    const picker = getDirectoryPicker()
    if (picker === undefined) {
      setPickError('当前桌面环境未提供目录选择器，请手动输入路径')
      return
    }
    setPickError(null)
    setPicking(true)
    try {
      const path = await picker.pick()
      if (path === null) return // 用户取消：保持现状，弹窗不报错。
      void scope.set('assetDir', path)
    } catch (cause) {
      setPickError(cause instanceof Error ? cause.message : '选择目录失败')
    } finally {
      setPicking(false)
    }
  }
  if (value === undefined) return <div className="csField">加载中…</div>
  return (
    <>
      <label className="csField">
        <span className="csFieldLabel">资产库位置 <span className="csReserved">已接入</span></span>
        <div className="csFieldRow">
          <input
            className="csFieldInput"
            value={value.assetDir}
            placeholder="留空=默认 ($DSH_HOME/canvas-studio)"
            spellCheck={false}
            onChange={(event: ChangeEvent<HTMLInputElement>) => void scope.set('assetDir', event.target.value)}
          />
          <button
            type="button"
            className="csFieldButton"
            disabled={picking}
            onClick={() => { void onPickDirectory() }}
            title="弹系统文件夹选择器"
          >
            {picking ? '选择中…' : '浏览…'}
          </button>
        </div>
        {pickError !== null && <p className="csFieldError" role="alert">{pickError}</p>}
        <p className="csFieldHint">
          仅对<strong>新建项目</strong>生效；旧项目保留在原位不迁移。留空 = 使用桌面默认 `$DSH_HOME/canvas-studio`。
        </p>
      </label>
      <label className="csToggle">
        <input type="checkbox" checked={value.autoSave} onChange={(event: ChangeEvent<HTMLInputElement>) => void scope.set('autoSave', event.target.checked)} />
        <span>画布自动保存 <span className="csReserved">待接入</span></span>
      </label>
      <label className="csField">
        <span className="csFieldLabel">自动保存间隔（秒，5–600） <span className="csReserved">待接入</span></span>
        <input
          className="csFieldInput"
          type="number"
          min={5}
          max={600}
          value={value.autoSaveInterval}
          onChange={(event: ChangeEvent<HTMLInputElement>) => onInterval(event.target.value)}
        />
      </label>
    </>
  )
}

/** 导航项配置。 */
interface NavItem {
  id: SettingsTab
  label: string
}

/** 导航项列表。 */
const NAV_ITEMS: readonly NavItem[] = [
  { id: 'general', label: '通用' },
  { id: 'theme', label: '外观' },
  { id: 'model', label: '模型' },
  { id: 'output', label: '输出' },
  { id: 'workflow', label: '工作流' },
  { id: 'storage', label: '存储' },
]

/**
 * Render the Canvas Studio settings popup with six sections: 通用 / 外观 / 模型 / 输出 / 工作流 / 存储.
 * 通用/输出/工作流/存储经 canvas-studio 命名空间回写；外观 = 全局主题（ctx.theme）+ 品牌配色
 * （--cs-* 预设，见 BrandSection）；模型经 host wire 三域。
 *
 * 布局采用 DeepSeek Harness 风格：左侧 188px 垂直导航栏 + 右侧内容区。
 */
export function SettingsModal(props: SettingsModalProps): ReactElement {
  const { settingsScope, getCredentials, getModelApi, getDirectoryPicker, theme, onClose } = props
  const [activeTab, setActiveTab] = useState<SettingsTab>('general')

  // Esc 关闭弹窗。
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey) }
  }, [onClose])

  return (
    <div className="csSettingsBackdrop" role="presentation" onClick={onClose}>
      <div
        className="csSettingsModal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cs-settings-title"
        onClick={(event) => { event.stopPropagation() }}
      >
        {/* 左侧导航栏 */}
        <nav className="csNav">
          <div className="csNavTitle" id="cs-settings-title">设置</div>
          <div className="csNavList">
            {NAV_ITEMS.map((item) => (
              <button
                key={item.id}
                type="button"
                className={activeTab === item.id ? 'csNavCell csNavCellActive' : 'csNavCell'}
                aria-current={activeTab === item.id ? 'true' : undefined}
                onClick={() => { setActiveTab(item.id) }}
              >
                <span className="csNavLabel">{item.label}</span>
              </button>
            ))}
          </div>
        </nav>

        {/* 右侧内容区 */}
        <div className="csContent">
          <div className="csContentHeader">
            <div className="csContentActions" />
            <button type="button" className="csClose" aria-label="关闭" onClick={onClose}>
              <span className="csCloseIcon">×</span>
            </button>
          </div>
          <div className="csContentOptions">
            {activeTab === 'general' && <GeneralSection settingsScope={settingsScope} getCredentials={getCredentials} />}
            {activeTab === 'theme' && (
              <>
                <ThemeSection theme={theme} />
                <BrandSection settingsScope={settingsScope} />
              </>
            )}
            {activeTab === 'model' && <ModelSection settingsScope={settingsScope} getModelApi={getModelApi} />}
            {activeTab === 'output' && <OutputSection settingsScope={settingsScope} />}
            {activeTab === 'workflow' && <WorkflowSection settingsScope={settingsScope} />}
            {activeTab === 'storage' && <StorageSection settingsScope={settingsScope} getDirectoryPicker={getDirectoryPicker} />}
          </div>
        </div>
      </div>
    </div>
  )
}
