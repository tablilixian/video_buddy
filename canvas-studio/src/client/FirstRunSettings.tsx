/**
 * Canvas Studio 首启设置页（首次进入时的轻量 onboarding）。
 *
 * 桌面 Setup Wizard 已瘦身为 welcome→success（只写桌面默认值），Canvas Studio
 * 自己的「项目保存路径 + 默认分辨率」由本页承接。复用 SettingsModal 同一套
 * settings 作用域 / 原生目录选择器，零跨层、零新 IPC。后续新增配置只需在此加
 * 字段 + 在 StudioFrame 的判定里照样渲染即可。
 *
 * 触发：localStorage['canvas-studio.onboarded'] 未置 '1' 时由 StudioFrame 挂载。
 * 两个出口：
 * - 开始使用：当前三项已随输入即时回写作用域，这里只置 flag 收尾。
 * - 稍后再说：仅置 flag，不改任何值（等同 schema 默认）。
 */
import { useMemo, useState, useSyncExternalStore, type ChangeEvent, type ReactElement } from 'react'
import type { SettingsScope } from '@deepseek-ai/dsh-client-runtime/client'
import type { CanvasStudioConfig } from '../host-config.js'
import type { CanvasStudioSettingsScope } from './contracts.js'

/** 首启标记：存 localStorage（设备级，清缓存会重新弹）。后续若要按 Profile 持久化，
 *  可改为写进 CanvasStudioConfig 的 onboarded 字段，判定处一并切换即可。 */
const ONBOARDED_KEY = 'canvas-studio.onboarded'

export function isCanvasStudioOnboarded(): boolean {
  try { return localStorage.getItem(ONBOARDED_KEY) === '1' } catch { return false }
}

export function markCanvasStudioOnboarded(): void {
  try { localStorage.setItem(ONBOARDED_KEY, '1') } catch { /* 忽略写入失败 */ }
}

export interface FirstRunSettingsProps {
  /** 绑定 'canvas-studio' 命名空间的 settings 作用域。 */
  settingsScope: CanvasStudioSettingsScope
  /** 惰性取桌面原生目录选择器（项目保存路径用）；未就绪时返回 undefined。 */
  getDirectoryPicker: () => { pick: () => Promise<string | null> } | undefined
  /** 用户做出选择（开始使用 / 稍后再说）后收尾，关闭弹窗。 */
  onComplete: () => void
}

/** 订阅 settingsScope 的响应式快照（与 SettingsModal.useScope 同构）。 */
function useScope<T>(scope: SettingsScope<T>) {
  const subscribe = useMemo(() => (listener: () => void) => scope.subscribe(listener), [scope])
  const snapshot = useMemo(() => () => scope.getSnapshot(), [scope])
  return useSyncExternalStore(subscribe, snapshot)
}

export function FirstRunSettings(props: FirstRunSettingsProps): ReactElement {
  const { settingsScope, getDirectoryPicker, onComplete } = props
  const scope = useMemo(() => settingsScope.bind<CanvasStudioConfig>({ namespace: 'canvas-studio' }), [settingsScope])
  const snapshot = useScope(scope)
  const value = snapshot.value
  const [picking, setPicking] = useState(false)
  const [pickError, setPickError] = useState<string | null>(null)

  if (value === undefined) {
    return (
      <div className="csModalBackdrop" role="presentation">
        <div className="csModal" role="dialog" aria-modal="true" aria-labelledby="cs-firstrun-title">
          <div className="csModalBody">加载中…</div>
        </div>
      </div>
    )
  }

  // dsh 官方 pickDirectory() 全平台走宿主原生 chooser，返回的路径 Host 端已校验可写；
  // 用户取消返回 null。与 SettingsModal 的 StorageSection.onPickDirectory 同范式。
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
      if (path === null) return // 用户取消：保持现状，不报错。
      void scope.set('assetDir', path)
    } catch (cause) {
      setPickError(cause instanceof Error ? cause.message : '选择目录失败')
    } finally {
      setPicking(false)
    }
  }

  // 三项已随输入即时回写作用域（scope.set 即落盘），这里只置 flag 收尾。
  const finish = (): void => {
    markCanvasStudioOnboarded()
    onComplete()
  }

  // 稍后再说：不改任何值（等同 schema 默认），仅置 flag。
  const skip = (): void => {
    markCanvasStudioOnboarded()
    onComplete()
  }

  return (
    <div className="csModalBackdrop" role="presentation">
      <div
        className="csModal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cs-firstrun-title"
        onClick={(event) => { event.stopPropagation() }}
      >
        <header className="csModalHeader">
          <div className="csModalHeaderText">
            <h2 id="cs-firstrun-title">欢迎使用 Canvas Studio</h2>
            <p className="csModalHeaderMeta">首次进入，先设置几项默认偏好（之后可在「设置 → 存储 / 输出」里修改）。</p>
          </div>
        </header>
        <div className="csModalBody">
          <label className="csField">
            <span className="csFieldLabel">项目保存路径（资产库位置）</span>
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
          <label className="csField">
            <span className="csFieldLabel">图片默认分辨率</span>
            <select
              className="csFieldSelect"
              value={value.defaultImageResolution}
              onChange={(event: ChangeEvent<HTMLSelectElement>) => void scope.set('defaultImageResolution', event.target.value as CanvasStudioConfig['defaultImageResolution'])}
            >
              <option value="480p">480p · 864×480（草稿/试拍）</option>
              <option value="768p">768p · 1376×768（默认）</option>
              <option value="2k">2k · 1920×1088（交付）</option>
            </select>
            <p className="csFieldHint">
              agent 未指定分辨率档位时，图片生成按此兜底（宽高均为 32 的倍数）。
              竖屏取反宽高，1:1 画幅三档共用 1024×1024。
            </p>
          </label>
          <label className="csField">
            <span className="csFieldLabel">视频默认分辨率</span>
            <select
              className="csFieldSelect"
              value={value.defaultVideoResolution}
              onChange={(event: ChangeEvent<HTMLSelectElement>) => void scope.set('defaultVideoResolution', event.target.value as CanvasStudioConfig['defaultVideoResolution'])}
            >
              <option value="480p">480p · 864×480（草稿/试拍）</option>
              <option value="768p">768p · 1376×768（默认）</option>
              <option value="2k">2k · 1920×1088（交付）</option>
            </select>
            <p className="csFieldHint">
              agent 未指定分辨率档位时，视频生成按此兜底（宽高均为 32 的倍数）。
              竖屏取反宽高，1:1 画幅三档共用 1024×1024。
            </p>
          </label>
        </div>
        <footer className="csModalFooter">
          <button type="button" className="csModalBtnSecondary" onClick={skip}>稍后再说</button>
          <button type="button" className="csModalBtnPrimary" onClick={finish}>开始使用</button>
        </footer>
      </div>
    </div>
  )
}
