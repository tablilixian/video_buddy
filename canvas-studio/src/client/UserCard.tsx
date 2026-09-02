/**
 * CV-069：左栏底部用户卡 + 个人信息 popover（三态常驻，竞品对标 MiniMax Design）。
 *
 * 诚实边界（拍板四项之一）：主题与设置接**真实功能**（ctx.theme / 现有
 * SettingsModal —— 用户卡恰是 CV-059「设置入口 = 左下角」的插件内落点）；
 * 积分、订阅、记忆管理、教程、更新日志为 **reserved 入口**（挂「待接入」
 * 角标，不伪造已生效）；「接入飞书/微信」照抄竞品「未接入」badge 语义。
 * 假数据收敛在 brand-copy.ts 的 USER_MOCK，接真用户体系只改一处。
 *
 * 关闭语义复用 CV-037 教训：window mousedown 命中卡片/面板内部时放行
 * （否则 mousedown 抢先卸载导致点击无效）；Escape 关闭。
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import type { ThemeRuntime } from '@deepseek-ai/dsh-client-ui-theme/client'
import { USER_MOCK } from '../brand-copy.js'

export interface UserCardProps {
  /** 打开 Canvas Studio 设置弹窗（真实功能）。 */
  onOpenSettings(): void
  /** 桌面主题运行时（真实功能；连接未就绪时主题组整体隐藏）。 */
  theme?: ThemeRuntime
}

/** 主题 id → 中文标签（与 SettingsModal 同规则）。 */
function themeLabel(id: string): string {
  if (id === 'light') return '浅色'
  if (id === 'dark') return '深色'
  if (id === 'system') return '跟随系统'
  return id
}

/** 首字母 + 品牌色渐变 SVG 头像（不用图片资源）。 */
function LetterAvatar(props: { name: string; size?: number }): ReactElement {
  const initial = props.name.trim().charAt(0).toUpperCase() || 'U'
  const size = props.size ?? 28
  return (
    <svg className="csUserAvatar" width={size} height={size} viewBox="0 0 36 36" aria-hidden="true">
      <defs>
        <linearGradient id="csUserAvatarGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="var(--cs-accent, #6c5ce7)" />
          <stop offset="100%" stopColor="color-mix(in srgb, var(--cs-accent, #6c5ce7) 60%, #000)" />
        </linearGradient>
      </defs>
      <circle cx="18" cy="18" r="18" fill="url(#csUserAvatarGrad)" />
      <text x="18" y="24" textAnchor="middle" fontSize="16" fontWeight="600" fill="#fff">{initial}</text>
    </svg>
  )
}

export function UserCard(props: UserCardProps): ReactElement {
  const { onOpenSettings, theme } = props
  const [open, setOpen] = useState(false)
  // CV-069 修复：面板 position:fixed（.csProjects overflow-y:auto 会裁剪
  // absolute 子元素——此前面板被裁 + 点击失效），坐标按用户条实测位置计算。
  const rootRef = useRef<HTMLDivElement>(null)
  const barRef = useRef<HTMLButtonElement>(null)
  const [panelPos, setPanelPos] = useState<{ left: number; bottom: number } | null>(null)

  const toggle = (): void => setOpen(current => !current)

  // 打开后在 paint 前量用户条位置，用 fixed 精确对齐。位置是可选的兜底：
  // 面板渲染**不依赖** panelPos（门控已去掉），只要 onClick 触发就会弹出，
  // 位置先 fallback 再被本次排版期修正，杜绝「state 时序导致打不开」。
  useLayoutEffect(() => {
    if (!open || barRef.current === null) return
    const rect = barRef.current.getBoundingClientRect()
    setPanelPos({ left: rect.left, bottom: window.innerHeight - rect.top + 8 })
  }, [open])

  // 关闭语义：window mousedown 命中卡片内部时放行（CV-037 教训）；Escape 关闭。
  useEffect(() => {
    if (!open) return
    const onMouseDown = (event: MouseEvent): void => {
      if (rootRef.current !== null && event.target instanceof Node && rootRef.current.contains(event.target)) return
      setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('mousedown', onMouseDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('mousedown', onMouseDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  // 主题三态（真实功能）：setTheme 同步生效（与 SettingsModal ThemeSection 同款）。
  const themeSnap = theme !== undefined ? theme.getTheme() : null
  const activeThemeId = themeSnap === null ? null : (themeSnap.preference === 'system' ? 'system' : themeSnap.active.id)
  const themeOptions = themeSnap === null
    ? []
    : [...themeSnap.themes.map((definition) => definition.id), 'system']

  return (
    <div className="csUser" ref={rootRef}>
      {open && (
        <div
          className="csUserPanel"
          role="dialog"
          aria-label="用户信息"
          style={{
            left: panelPos?.left ?? 12,
            bottom: panelPos?.bottom ?? 24,
          }}
        >
          <div className="csUserHead">
            <LetterAvatar name={USER_MOCK.name} size={40} />
            <div className="csUserHeadMeta">
              <span className="csUserName">{USER_MOCK.name}</span>
              <span className="csUserUid">UID：{USER_MOCK.uid}</span>
            </div>
          </div>
          <div className="csUserRow">
            <span className="csUserRowLabel">{USER_MOCK.plan}</span>
            <span className="csUserBadge">默认</span>
          </div>
          <div className="csUserRow">
            <span className="csUserRowLabel">积分余额</span>
            <span className="csUserValue">
              ✦ {USER_MOCK.credits}
              <span className="csReserved">待接入</span>
            </span>
          </div>
          <button type="button" className="csUserRow csUserEntry" disabled title="订阅体系尚未接入">
            <span className="csUserRowLabel">订阅</span>
            <span className="csUserValue">
              <span className="csReserved">待接入</span>
              <span className="csUserChevron">›</span>
            </span>
          </button>
          {theme !== undefined && themeSnap !== null && (
            <div className="csUserGroup">
              <span className="csUserGroupLabel">主题</span>
              <div className="csUserThemeRow">
                {themeOptions.map((id) => (
                  <button
                    key={id}
                    type="button"
                    className={activeThemeId === id ? 'csUserThemeBtn csUserThemeActive' : 'csUserThemeBtn'}
                    onClick={() => { theme.setTheme(id) }}
                  >
                    {themeLabel(id)}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="csUserGroup">
            <span className="csUserGroupLabel">帮助</span>
            <button type="button" className="csUserEntry" disabled title="记忆管理尚未接入">
              <span className="csUserRowLabel">记忆管理</span>
              <span className="csUserValue"><span className="csReserved">待接入</span><span className="csUserChevron">›</span></span>
            </button>
            <button type="button" className="csUserEntry" disabled title="外部接入尚未开通">
              <span className="csUserRowLabel">接入飞书 / 微信</span>
              <span className="csUserValue"><span className="csUserBadge">未接入</span><span className="csUserChevron">›</span></span>
            </button>
            <button type="button" className="csUserEntry" disabled title="教程中心尚未接入">
              <span className="csUserRowLabel">教程</span>
              <span className="csUserValue"><span className="csReserved">待接入</span><span className="csUserChevron">›</span></span>
            </button>
            <button type="button" className="csUserEntry" disabled title="更新日志尚未接入">
              <span className="csUserRowLabel">更新日志</span>
              <span className="csUserValue"><span className="csReserved">待接入</span><span className="csUserChevron">›</span></span>
            </button>
          </div>
          <button type="button" className="csUserEntry csUserSettings" onClick={() => { setOpen(false); onOpenSettings() }}>
            <span className="csUserRowLabel">设置</span>
            <span className="csUserChevron">›</span>
          </button>
        </div>
      )}
      {/* CV-069：单个用户条按钮（点开面板；设置入口在面板内部 .csUserSettings）。 */}
      <button
        type="button"
        className="csUserBar"
        aria-expanded={open}
        onClick={toggle}
      >
        <LetterAvatar name={USER_MOCK.name} />
        <span className="csUserBarName">{USER_MOCK.name}</span>
      </button>
    </div>
  )
}
