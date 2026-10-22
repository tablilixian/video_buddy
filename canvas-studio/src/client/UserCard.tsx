/**
 * CV-069：左栏底部用户卡 + 个人信息 popover（三态常驻，竞品对标 MiniMax Design）。
 *
 * 诚实边界（拍板四项之一）：主题与设置接**真实功能**（ctx.theme / 现有
 * SettingsModal —— 用户卡恰是 CV-059「设置入口 = 左下角」的插件内落点）；
 * 积分、订阅、记忆管理、教程、更新日志为 **reserved 入口**（挂「待接入」
 * 角标，不伪造已生效）；「接入飞书/微信」照抄竞品「未接入」badge 语义。
 * 假数据**已全部删除**（P1 登录闭环 2026-10-15）：本组件的三态各有明确来源 ——
 * `signed-in` 取真用户（昵称 / 邮箱 / UID 全来自会话）；`signed-out` 用户条整体换成
 * 「登录 / 注册」按钮（onOpenLogin，不渲染面板）；`auth === undefined`（未配置 Supabase）
 * 走「本地模式」中性文案。**任何一态都不显示"别人的名字"** —— 那会读成账号串了。
 *
 * 关闭语义复用 CV-037 教训：window mousedown 命中卡片/面板内部时放行
 * （否则 mousedown 抢先卸载导致点击无效）；Escape 关闭。
 */
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import type { ThemeRuntime } from '@deepseek-ai/dsh-client-ui-theme/client'
import { ACCOUNT_COPY, CREDITS_PLACEHOLDER } from '../brand-copy.js'
import { signOutAuth, type AuthState } from './auth/auth-store.js'

export interface UserCardProps {
  /** 打开 Canvas Studio 设置弹窗（真实功能）。 */
  onOpenSettings(): void
  /** 桌面主题运行时（真实功能；连接未就绪时主题组整体隐藏）。 */
  theme?: ThemeRuntime
  /** 登录态快照（undefined = Supabase 未配置 ⇒ 走「本地模式」中性文案）。 */
  auth?: AuthState | undefined
  /** 打开登录弹窗（未登录态点「登录」按钮）。 */
  onOpenLogin?(): void
}

/** 主题 id → 中文标签（与 SettingsModal 同规则）。 */
function themeLabel(id: string): string {
  if (id === 'light') return '浅色'
  if (id === 'dark') return '深色'
  if (id === 'system') return '跟随系统'
  return id
}

/**
 * 首字母 + 品牌色渐变 SVG 头像（不用图片资源）。
 *
 * DD-08 / R8 起导出：左栏收起态的缩略条要复用**同一个**头像（圆形裁剪靠
 * `.csUserAvatar`，渐变 id 靠 useId）—— 复制一份出来，两处头像迟早分叉
 * （圆角/渐变方向/描边）而没有任何报错提示。
 */
export function LetterAvatar(props: { name: string; size?: number }): ReactElement {
  const initial = props.name.trim().charAt(0).toUpperCase() || 'U'
  const size = props.size ?? 28
  // CR-047：useId 生成唯一渐变 id——bar 头像与面板头像同页各渲染一个实例，
  // 硬编码 id 会违反 HTML 唯一性约束（两处不同颜色时互串）。
  const gradientId = useId()
  return (
    <svg className="csUserAvatar" width={size} height={size} viewBox="0 0 36 36" aria-hidden="true">
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="var(--cs-accent, #6c5ce7)" />
          <stop offset="100%" stopColor="color-mix(in srgb, var(--cs-accent, #6c5ce7) 60%, #000)" />
        </linearGradient>
      </defs>
      <circle cx="18" cy="18" r="18" fill={`url(#${gradientId})`} />
      <text x="18" y="24" textAnchor="middle" fontSize="16" fontWeight="600" fill="#fff">{initial}</text>
    </svg>
  )
}

/**
 * 无身份头像：中性人形剪影（未登录 / 未配置账号体系）。
 *
 * 与 `LetterAvatar` 的关系和它存在的理由一样：**只有一个实现**，用户卡与收起态
 * 缩略条共用。此前这两种状态会借用一个**真人名字的首字**（假数据的遗毒）——
 * 未登录却顶着别人的首字，是同一类误导。底色走 `--cs-shell-2`（与用户条 hover
 * 同源），剪影走宿主次级标签色，两轨主题下都成立。
 */
export function GuestAvatar(props: { size?: number }): ReactElement {
  const size = props.size ?? 28
  return (
    <svg className="csUserAvatar" width={size} height={size} viewBox="0 0 36 36" aria-hidden="true">
      <circle cx="18" cy="18" r="18" fill="var(--cs-shell-2, var(--dsw-alias-bg-layer-1))" />
      <circle cx="18" cy="14.4" r="5.2" fill="var(--dsw-alias-label-tertiary)" />
      <path
        d="M8.6 31c1.5-5.2 5.1-7.8 9.4-7.8s7.9 2.6 9.4 7.8z"
        fill="var(--dsw-alias-label-tertiary)"
      />
    </svg>
  )
}

export function UserCard(props: UserCardProps): ReactElement {
  const { onOpenSettings, theme, auth, onOpenLogin } = props
  const signedIn = auth?.status === 'signed-in' && auth.user !== null
  const signedOut = auth !== undefined && !signedIn
  // 三态，各自有明确的身份来源（**没有第四种"假身份态"**）：
  //   signedIn  → 真用户：昵称 / 邮箱 / UID 全部来自会话；
  //   signedOut → 用户条整体换成「登录 / 注册」按钮，不渲染面板；
  //   其余（auth === undefined，自托管未配置账号体系）→ 只说事实，不冒充某个人。
  const displayName = signedIn ? auth!.user!.name : ACCOUNT_COPY.local
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

  // CR-048：面板打开期间窗口 resize / 侧栏滚动会改变用户条位置——监听并重算，
  // 否则 fixed 面板会对不上触发按钮。
  useEffect(() => {
    if (!open) return
    const recompute = (): void => {
      if (barRef.current === null) return
      const rect = barRef.current.getBoundingClientRect()
      setPanelPos({ left: rect.left, bottom: window.innerHeight - rect.top + 8 })
    }
    window.addEventListener('resize', recompute)
    // scroll 不冒泡——用捕获阶段监听所有容器的滚动（含 .csProjects 侧栏）。
    window.addEventListener('scroll', recompute, true)
    return () => {
      window.removeEventListener('resize', recompute)
      window.removeEventListener('scroll', recompute, true)
    }
  }, [open])

  // 关闭语义：window pointerdown 命中卡片内部时放行（CV-037 教训）；Escape 关闭。
  // 用 pointerdown 而不是 mousedown：画布表面在 pointerdown 上 preventDefault，
  // 按规范会抑制兼容性 mousedown —— 挂 mousedown 的关闭监听永远等不到事件
  // （CV-167 教训：右键菜单点空白关不掉的根因）。
  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent): void => {
      if (rootRef.current !== null && event.target instanceof Node && rootRef.current.contains(event.target)) return
      setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
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
      {/* P1 登录闭环：未登录态 → 用户条切换为「登录」入口（面板不渲染）。
          signing-in 也走这里（弹窗自己显示进度，用户条保持登录入口可再点）。 */}
      {signedOut && (
        <div className="csUserSigninRow">
          <button
            type="button"
            className="csUserBar csUserBarSignin"
            onClick={() => { onOpenLogin?.() }}
          >
            <span className="csUserBarSigninLabel">登录 / 注册</span>
          </button>
          {/* 未登录态不渲染用户面板（面板是身份/账号信息，未登录没有可显示的内容），
              但设置入口不能随面板一起消失 —— 用独立齿轮按钮承接。 */}
          <button
            type="button"
            className="csUserSettingsBtn"
            aria-label="设置"
            title="设置"
            onClick={onOpenSettings}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="3.2" />
              <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1.11-1.55 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.64 8.9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34H9a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.55 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87V9c.2.62.76 1.05 1.42 1.09H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.55 1Z" />
            </svg>
          </button>
        </div>
      )}
      {/* 未登录态**不渲染面板**：用户条本身就是「登录 / 注册」入口，再补一个只写着
          「去登录」的面板等于两套入口。此前这里有一条面板分支，头部填的是假身份
          （未登录却顶着别人的名字 + 假 UID）—— 随假数据一并删除，不留空壳。 */}
      {!signedOut && open && (
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
            {signedIn ? <LetterAvatar name={displayName} size={40} /> : <GuestAvatar size={40} />}
            <div className="csUserHeadMeta">
              <span className="csUserName">{displayName}</span>
              <span className="csUserUid">
                {signedIn ? `UID：${auth!.user!.userId}` : ACCOUNT_COPY.localHint}
              </span>
            </div>
          </div>
          <div className="csUserRow">
            <span className="csUserRowLabel">{signedIn ? '登录邮箱' : '账号体系'}</span>
            <span className="csUserValue">
              {signedIn ? (auth!.user!.email ?? '—') : <span className="csUserBadge">未配置</span>}
            </span>
          </div>
          <div className="csUserRow">
            <span className="csUserRowLabel">积分余额</span>
            <span className="csUserValue">
              ✦ {CREDITS_PLACEHOLDER}
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
          {/* P1 登录闭环：已登录才出现；signOut 经 store 收尾（清本地会话 + 推 Host）。 */}
          {signedIn && (
            <button
              type="button"
              className="csUserEntry csUserSignout"
              onClick={() => { setOpen(false); void signOutAuth() }}
            >
              <span className="csUserRowLabel">退出登录</span>
              <span className="csUserChevron">›</span>
            </button>
          )}
          <button type="button" className="csUserEntry csUserSettings" onClick={() => { setOpen(false); onOpenSettings() }}>
            <span className="csUserRowLabel">设置</span>
            <span className="csUserChevron">›</span>
          </button>
        </div>
      )}
      {/* CV-069：单个用户条按钮（点开面板；设置入口在面板内部 .csUserSettings）。
          P1 登录闭环：已登录 / 未配置账号体系（本地模式）显示用户条；未登录态见上方登录按钮。 */}
      {!signedOut && (
        <button
          type="button"
          className="csUserBar"
          aria-expanded={open}
          onClick={toggle}
        >
          {signedIn ? <LetterAvatar name={displayName} size={30} /> : <GuestAvatar size={30} />}
          <span className="csUserBarMeta">
            <span className="csUserBarName">{displayName}</span>
            {/* DD-08 / R6：副行取**真实存在**的账号信息（已登录 = 邮箱；本地模式 = 未配置说明）。
                积分 / 订阅 / 记忆仍是 reserved，按 CV-069 的诚实边界留在面板内部。 */}
            <span className="csUserBarSub">{signedIn ? (auth!.user!.email ?? displayName) : ACCOUNT_COPY.localHint}</span>
          </span>
        </button>
      )}
    </div>
  )
}
