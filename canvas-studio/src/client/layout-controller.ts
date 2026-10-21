import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type { ILayout, MainPanelId, PanelInfo } from '@deepseek-ai/dsh-client-ui-layout/client'
import { throwError } from '../error-system.js'

/**
 * Studio-owned implementation of the standard panel-action face.
 *
 * dsh 0.2.1 起 `ctx.layout` 是跨插件面板动作的唯一入口（`ILayout`）：选主面板、
 * 作废在途导航、上报右栏呈现。画布自持 `root`，因此必须自己提供这套面；
 * 画布不渲染 sidebar / rightbar 两列，对应的呈现方法保持空实现（与 0.1.x 的
 * 行为一致：那两列本来就没有），但 **`panelInfo` / `selectPanel` /
 * `beginNavigation` 必须真实现** —— 上游把「当前主面板」读作
 * `panelInfo.activePanelId`，恒空会让调用方把画布当成「永远停在对话」。
 */
export class StudioLayoutController implements ILayout {
  /** 当前主面板选择；画布只承载对话，注册表为空时选择恒为 null。 */
  readonly panelInfo: HostObservable<PanelInfo>

  private panelSnapshot: PanelInfo = Object.freeze({ activePanelId: null })
  private navigation = new AbortController()

  /**
   * @param hasMainPanel - 主面板注册表查询（keyed `main` 槽里是否存在该 entryKey）。
   */
  constructor(private readonly hasMainPanel: (id: MainPanelId) => boolean = () => false) {
    this.panelInfo = {
      getSnapshot: () => this.panelSnapshot,
      subscribe: listener => {
        this.listeners.add(listener)
        return () => { this.listeners.delete(listener) }
      },
    }
  }

  private readonly listeners = new Set<() => void>()

  /** Select a registered global panel, or return to the Conversation. */
  selectPanel(panelId: MainPanelId | null): void {
    if (panelId !== null && !this.hasMainPanel(panelId)) {
      throwError('CS-LAYOUT-001', { panelId })
    }
    this.navigation.abort()
    if (this.panelSnapshot.activePanelId === panelId) return
    this.panelSnapshot = Object.freeze({ activePanelId: panelId })
    for (const listener of this.listeners) listener()
  }

  /** Supersede pending asynchronous navigation. */
  beginNavigation(): AbortSignal {
    this.navigation.abort()
    this.navigation = new AbortController()
    return this.navigation.signal
  }

  /** Toggle the sidebar panel (no-op: the studio frame owns its own left rail). */
  toggleSidebar(): void {}

  /** Report the right panel presentation (no-op: the studio frame renders no rightbar). */
  openRightbar(_track: boolean, _fullscreen: boolean): void {}

  /** Report the right panel as hidden (no-op: the studio frame renders no rightbar). */
  closeRightbar(): void {}

  /** Invalidate pending navigation when the layout owner unloads. */
  dispose(): void { this.navigation.abort() }
}
