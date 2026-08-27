/**
 * Canvas Studio 设置卡片（浏览器半侧，块 3）。
 *
 * 以命名空间 'canvas-studio' 为键注册进 `settings.plugin.item`；普通字段
 *（dramaApiBase / maxVideoSeconds）经 ctx.settingsScope 回写用户层；密钥
 *（dramaApiKey）经 api.credentials.set 写入凭据域，不落明文。
 *
 * 卡片注册遵循 DSH 标准模式（见 ui-settings-plugins 的 AgentLoopCard）：
 *   - 组件 props 由 `PropsRuntime<'settings.plugin.item'>` +
 *     `InjectFace<Face>` 组成；本包未链接 ui-settings 词典型，故不挂 `t` 本地化座。
 *   - 经 `ctx.slots.inject('settings.plugin.item', () => ctx.slots.register(...))`
 *     注册，确保等 ui-settings-plugins 声明该槽后再落卡。
 *
 * bundle 纯净度：跨插件只做 `import type {}`，值导入会触发客户端打包门禁失败。
 */
import { createElement as h, useEffect, useState } from 'react'
import type { ChangeEvent, ReactElement } from 'react'
import type { ClientContext, SettingsScope } from '@deepseek-ai/dsh-client-runtime/client'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { CanvasStudioConfig } from '../host-config.js'

/**
 * 类型收窄：本包 `src/` 对 `SlotMap` 的增强（`settings.plugin.item`）能被
 * `@deepseek-ai/dsh-client-ui-slots` 内的类型（PropsRuntime 等）看到，但
 * `@deepseek-ai/dsh-client-runtime` 的 `SlotRegistry`（声明于 .d.ts）解析到的
 * `SlotMap` 仅含其自有声明的 `'root'`，因此 `ctx.slots.inject/register` 的
 * 签名把 key 收窄为 `"root"`，拒绝本卡片的 `settings.plugin.item`。运行时该
 * 槽位确实由 ui-settings-plugins 声明，故在此以与全局 SlotMap 一致的签名对
 * `slots` 服务做最小收窄，完成注册调用（组件 props 仍走完整类型检查）。
 */
type PluginSlots = {
  inject(key: 'settings.plugin.item', cb: () => (() => void) | Iterable<() => void>): () => void
  register(
    options: { name: 'settings.plugin.item'; key: string; inject?: () => Record<string, unknown> },
    component: (props: CanvasStudioCardProps) => ReactElement,
  ): () => void
}

/** api.credentials 的最小结构类型（仅取本卡片实际调用的两个方法）。 */
interface CredentialsClient {
  set(req: { ref: string; value: string }): Promise<void>
  describe(req: { refs: string[] }): Promise<{ credentials: Record<string, { configured: boolean; writable: boolean }> }>
}

/** 卡片经 inject face 注入的业务面：一个命名空间作用域 + 凭据客户端。 */
interface CanvasStudioCardFace {
  scope: SettingsScope<CanvasStudioConfig>
  credentials: CredentialsClient
}

/** 渲染卡片：两个普通字段输入框 + 一个密钥输入（写凭据域）。 */
export type CanvasStudioCardProps =
  PropsRuntime<'settings.plugin.item'>
  & InjectFace<CanvasStudioCardFace>

/**
 * 浏览器半侧入口：把 canvas-studio 的配置卡注册进 Plugins 分区。
 * 返回 slots 注销函数，由调用方经 `ctx.effect` 托管生命周期（与
 * registerStudioRoutes / registerCreationSkill 同构：回调须回吐 disposer）。
 */
export function apply(ctx: ClientContext): () => void {
  const api = ctx.get('connection').api
  const scope = ctx.settingsScope.bind<CanvasStudioConfig>({ namespace: 'canvas-studio' })
  const slots = ctx.slots as unknown as PluginSlots
  // 等 ui-settings-plugins 声明 `settings.plugin.item` 槽后再落卡；声明消失时
  // 经返回的 disposer 级联注销。
  return slots.inject('settings.plugin.item', () => slots.register({
    name: 'settings.plugin.item',
    key: 'canvas-studio',
    inject: () => ({ scope, credentials: api.credentials }),
  }, CanvasStudioCard))
}

/** 渲染卡片：两个普通字段输入框 + 一个密钥输入（写凭据域）。 */
export function CanvasStudioCard(props: CanvasStudioCardProps): ReactElement {
  const { scope, credentials } = props
  const [, force] = useState(0)
  useEffect(() => {
    const off = scope.subscribe(() => force(x => x + 1))
    return off
  }, [scope])

  const snapshot = scope.getSnapshot()
  const value = snapshot.value
  const [keyInput, setKeyInput] = useState('')
  const [credState, setCredState] = useState<{ configured: boolean; writable: boolean } | null>(null)

  // 反映 dramaApiKey 凭据引用是否已配置（不回显值）。
  useEffect(() => {
    if (value === undefined) return
    void credentials.describe({ refs: [value.dramaApiKey] })
      .then(res => setCredState(res.credentials[value.dramaApiKey] ?? null))
      .catch(() => setCredState(null))
  }, [credentials, value?.dramaApiKey])

  if (value === undefined) {
    return h('div', { className: 'csSettingsCard' }, '加载中…')
  }

  const base = snapshot.base as Partial<CanvasStudioConfig> | undefined

  const onBase = (v: string): void => { void scope.set('dramaApiBase', v) }
  const onSeconds = (v: string): void => {
    const n = Number(v)
    if (Number.isFinite(n)) void scope.set('maxVideoSeconds', n)
  }
  const onSaveKey = (): void => {
    if (keyInput.length > 0) void credentials.set({ ref: value.dramaApiKey, value: keyInput })
  }

  return h('div', { className: 'csSettingsCard' },
    h('label', null, 'Drama API 基址'),
    h('input', {
      value: value.dramaApiBase,
      placeholder: base?.dramaApiBase,
      onChange: (e: ChangeEvent<HTMLInputElement>) => onBase(e.target.value),
    }),
    h('label', null, '视频时长上限（秒，1–15）'),
    h('input', {
      type: 'number',
      min: 1,
      max: 15,
      value: value.maxVideoSeconds,
      onChange: (e: ChangeEvent<HTMLInputElement>) => onSeconds(e.target.value),
    }),
    h('label', null,
      `Drama API Key（凭据引用 ${value.dramaApiKey}${credState?.configured ? '，已配置' : '，未配置'}）`),
    h('input', {
      type: 'password',
      placeholder: '输入密钥后点保存',
      value: keyInput,
      onChange: (e: ChangeEvent<HTMLInputElement>) => setKeyInput(e.target.value),
    }),
    h('button', { type: 'button', onClick: onSaveKey }, '保存密钥'),
  )
}
