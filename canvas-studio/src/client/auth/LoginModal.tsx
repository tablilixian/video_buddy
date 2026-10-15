/**
 * P1 登录闭环：登录弹窗（左渠道 / 右循环视频，对齐产品参考稿）。
 *
 * - 左栏：品牌 logo + 产品名 + 登录/注册切换（注册先同渠道占位，只 Google）+
 *   协议勾选（链接占位 `#`，法务文案待定）+ Google 登录按钮；错误/过程提示在此。
 * - 右栏：`<video muted autoplay loop playsinline>`（不静音会被 Chromium 自动播放
 *   策略拦）；资产走 Host 静态路由 `/canvas-studio/auth/video`（包内 assets/login/）。
 * - 流程状态全部来自 auth-store（useSyncExternalStore），本组件不持有登录逻辑。
 *
 * 协议勾选未勾时禁用登录按钮（与参考稿交互一致：勾选是登录前置）。
 */
import { useEffect, useState } from 'react'
import type { ReactElement } from 'react'
import { LogoMark } from '../brand/LogoMark.js'
import { AUTH_INTRO_VIDEO_URL } from '../api.js'
import { beginGoogleSignIn, getAuthState, subscribeAuth, type AuthState } from './auth-store.js'

export interface LoginModalProps {
  /** 关闭弹窗（点背景 / 关闭按钮 / Esc）。signing-in 期间仍可关：流程继续，不因此中断。 */
  onClose(): void
}

/** Google「G」四色标（inline SVG，公开通用形状）。 */
function GoogleIcon(): ReactElement {
  return (
    <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.1H42V20H24v8h11.3C33.7 32.7 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3l5.7-5.7C34.3 6.1 29.4 4 24 4 13 4 4 13 4 24s9 20 20 20 20-9 20-20c0-1.3-.1-2.7-.4-3.9z"/>
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3l5.7-5.7C34.3 6.1 29.4 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/>
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.3 0-9.7-3.3-11.3-8l-6.5 5C9.6 39.6 16.2 44 24 44z"/>
      <path fill="#1976D2" d="M43.6 20.1H42V20H24v8h11.3c-.8 2.2-2.2 4.1-4.1 5.5l6.2 5.2C36.9 40.2 44 35 44 24c0-1.3-.1-2.7-.4-3.9z"/>
    </svg>
  )
}

export function LoginModal(props: LoginModalProps): ReactElement {
  const { onClose } = props
  // 登录流程是异步状态机：订阅 store（signing-in / error / notice 都从这里来）。
  const [auth, setAuth] = useState<AuthState>(getAuthState)
  useEffect(() => subscribeAuth(() => { setAuth(getAuthState()) }), [])
  // 协议勾选：未勾选禁用登录按钮（勾选是登录前置，与参考稿一致）。
  const [agreed, setAgreed] = useState(false)
  // 登录/注册切换：注册暂同渠道（后端计费侧未区分，先占位）。
  const [tab, setTab] = useState<'signin' | 'signup'>('signin')

  // Esc 关闭（与 SettingsModal 同款）。
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey) }
  }, [onClose])

  // 登录成功即自动收起：signed-in 到达时弹窗使命完成（2026-10-15 实测漏了这层
  // 联动，登录成功后弹窗残留）。onClose 幂等（setLoginOpen(false)），重复触发无害。
  const signedIn = auth.status === 'signed-in'
  useEffect(() => {
    if (signedIn) onClose()
  }, [signedIn, onClose])

  const busy = auth.status === 'signing-in'

  return (
    <div className="csLoginBackdrop" role="presentation" onClick={onClose}>
      <div
        className="csLoginModal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cs-login-title"
        onClick={(event) => { event.stopPropagation() }}
      >
        {/* 左栏：渠道与协议 */}
        <div className="csLoginLeft">
          <button type="button" className="csClose csLoginClose" aria-label="关闭" onClick={onClose}>
            <span className="csCloseIcon">×</span>
          </button>
          <div className="csLoginBrand">
            <LogoMark size={44} />
            <span className="csLoginBrandName" id="cs-login-title">Canvas Studio</span>
            <span className="csLoginBrandSub">创意工厂 —— 从一句创意到成片</span>
          </div>
          <div className="csLoginTabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'signin'}
              className={tab === 'signin' ? 'csLoginTab csLoginTabActive' : 'csLoginTab'}
              onClick={() => { setTab('signin') }}
            >登录</button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'signup'}
              className={tab === 'signup' ? 'csLoginTab csLoginTabActive' : 'csLoginTab'}
              onClick={() => { setTab('signup') }}
            >注册</button>
          </div>
          <button
            type="button"
            className="csLoginGoogle"
            disabled={!agreed || busy || auth.status === 'unconfigured'}
            onClick={() => { void beginGoogleSignIn() }}
          >
            <GoogleIcon />
            {tab === 'signin' ? '使用 Google 登录' : '使用 Google 注册'}
          </button>
          {busy && auth.notice !== null && <p className="csLoginNotice" role="status">{auth.notice}</p>}
          {auth.error !== null && <p className="csLoginError" role="alert">{auth.error}</p>}
          <label className="csLoginAgreement">
            <input type="checkbox" checked={agreed} onChange={(event) => { setAgreed(event.target.checked) }} />
            <span>
              我已阅读并同意
              <a href="#" onClick={(event) => { event.preventDefault() }}>《用户协议》</a>
              和
              <a href="#" onClick={(event) => { event.preventDefault() }}>《隐私政策》</a>
              ，并了解登录后将按生成用量计费。
            </span>
          </label>
        </div>
        {/* 右栏：循环视频（静音自动播放；无声设计，不设控制条） */}
        <div className="csLoginRight">
          <video
            className="csLoginVideo"
            src={AUTH_INTRO_VIDEO_URL}
            autoPlay
            loop
            muted
            playsInline
            aria-hidden="true"
          />
        </div>
      </div>
    </div>
  )
}
