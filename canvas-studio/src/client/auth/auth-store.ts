/**
 * P1 登录闭环：客户端登录态 store（supabase-js 唯一持有者）。
 *
 * 设计约束（方案拍板 2026-10-15）：
 * - PKCE verifier 依赖本页面 storage ⇒ supabase-js 必须留在 renderer（参考文档
 *   §0②）；`flowType:'pkce'`、`detectSessionInUrl:false` 两个配置绝不能动
 *   （回调 URL 由 Host loopback 捕获，不在本页地址栏）。
 * - 授权页必须走系统浏览器：`skipBrowserRedirect:true` + `window.open`（Electron
 *   的 setWindowOpenHandler 白名单放行 http/https → shell.openExternal）。
 * - client 是唯一 session 持有者并负责刷新（autoRefreshToken）；Host 只收推送
 *   （boot / SIGNED_IN / TOKEN_REFRESHED / SIGNED_OUT 四时机 + visibilitychange 补推）。
 * - 等待回调：轮询 `GET /canvas-studio/auth/pending`（1s，5min 上限）——PKCE code
 *   本身 5 分钟过期，超时自动复位，不再卡「等待回调」。
 *
 * 框架无关（不用 React state 存登录态）：subscribe/getSnapshot 形态直配
 * useSyncExternalStore；模块级单例，`initAuthStore` 幂等。
 */
import { createClient, type SupabaseClient, type Session } from '@supabase/supabase-js'
import { fetchPendingAuthCallback, pushAuthSession, startAuthLoopback } from '../api.js'

/** 登录态。`unconfigured` = 设置里 Supabase 未配置（入口降级隐藏）。 */
export type AuthStatus = 'unconfigured' | 'signed-out' | 'signing-in' | 'signed-in'

export interface AuthUser {
  userId: string
  email: string | null
  /** 展示名：Google profile 的 full_name / name，缺省取邮箱前缀。 */
  name: string
}

export interface AuthState {
  status: AuthStatus
  user: AuthUser | null
  /** 登录流程的可读错误（弹窗内展示；切回 signed-out 后仍保留供面板提示）。 */
  error: string | null
  /** 流程中的过程提示（如「已在系统浏览器打开…」）。 */
  notice: string | null
}

/** PKCE code 的有效期（Supabase 侧 5 分钟）；到点自动复位 UI。 */
const SIGNIN_TIMEOUT_MS = 5 * 60 * 1000
/** 回调轮询间隔：本机 loopback，1s 足够灵敏且无压力。 */
const POLL_INTERVAL_MS = 1000

let client: SupabaseClient | null = null
let pollTimer: ReturnType<typeof setInterval> | null = null
let pollDeadline = 0
let state: AuthState = { status: 'unconfigured', user: null, error: null, notice: null }
const listeners = new Set<() => void>()

function setState(next: AuthState): void {
  state = next
  for (const listener of listeners) listener()
}

/** useSyncExternalStore 三件套之一：读快照。 */
export function getAuthState(): AuthState {
  return state
}

/** useSyncExternalStore 三件套之二：订阅。 */
export function subscribeAuth(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** Supabase 会话 → 展示用户（Google profile 元数据）。 */
function userOf(session: Session): AuthUser {
  const meta = (session.user.user_metadata ?? {}) as {
    full_name?: unknown
    name?: unknown
    email?: unknown
  }
  const email = typeof meta.email === 'string' && meta.email !== '' ? meta.email : session.user.email ?? null
  const rawName = typeof meta.full_name === 'string' && meta.full_name !== ''
    ? meta.full_name
    : typeof meta.name === 'string' && meta.name !== '' ? meta.name : ''
  const name = rawName !== '' ? rawName : (email !== null ? email.split('@', 1)[0] ?? '用户' : '用户')
  return { userId: session.user.id, email, name }
}

/** 四时机推送：把最新会话覆盖进 Host 内存缓存（SIGNED_OUT 清空）。 */
function pushSession(event: string, session: Session | null): void {
  if (session === null) {
    void pushAuthSession(event, null).catch(() => undefined)
    return
  }
  void pushAuthSession(event, {
    accessToken: session.access_token,
    expiresAt: typeof session.expires_at === 'number' ? session.expires_at : null,
    userId: session.user.id,
    email: userOf(session).email,
  }).catch(() => undefined) // 推送失败不阻塞登录态（Host 重启后由下一次时机补上）
}

/** 初始化（幂等）：建 supabase client + 订阅 auth 事件 + 恢复既有会话。 */
export function initAuthStore(config: { supabaseUrl: string; supabasePublishableKey: string }): void {
  if (client !== null) return
  const url = config.supabaseUrl.trim()
  const key = config.supabasePublishableKey.trim()
  if (url === '' || key === '') {
    setState({ status: 'unconfigured', user: null, error: null, notice: null })
    return
  }
  client = createClient(url, key, {
    auth: {
      flowType: 'pkce',
      detectSessionInUrl: false, // 回调由 Host loopback 捕获，不在本页地址栏
      persistSession: true,
      autoRefreshToken: true, // 刷新归 client；Host 只收推送
    },
  })
  client.auth.onAuthStateChange((event, session) => {
    pushSession(event, session)
    if (event === 'SIGNED_OUT') {
      stopPolling()
      setState({ status: 'signed-out', user: null, error: null, notice: null })
      return
    }
    if (session !== null) {
      stopPolling()
      setState({ status: 'signed-in', user: userOf(session), error: null, notice: null })
    }
  })
  // 冷启动恢复：有既有会话 → signed-in（onAuthStateChange 的 INITIAL_SESSION 也会
  // 触发同一 setState，这里显式再走一次是无害幂等）。
  void client.auth.getSession().then(({ data }) => {
    if (data.session !== null) {
      pushSession('INITIAL_SESSION', data.session)
      setState({ status: 'signed-in', user: userOf(data.session), error: null, notice: null })
    } else {
      setState({ status: 'signed-out', user: null, error: null, notice: null })
    }
  }).catch(() => {
    setState({ status: 'signed-out', user: null, error: null, notice: null })
  })
}

function stopPolling(): void {
  if (pollTimer !== null) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

/** 回调 URL 校验 + code 换会话（对应参考文档 handleCallback）。 */
async function handleCallback(raw: string): Promise<void> {
  if (client === null) return
  const callback = new URL(raw)
  const denied = callback.searchParams.get('error_description')
    ?? callback.searchParams.get('error_code')
    ?? callback.searchParams.get('error')
  if (denied !== null) {
    stopPolling()
    setState({ status: 'signed-out', user: null, error: `授权失败：${denied}`, notice: null })
    return
  }
  const code = callback.searchParams.get('code')
  if (code === null) {
    stopPolling()
    setState({ status: 'signed-out', user: null, error: '回调里没有授权码，请重试。', notice: null })
    return
  }
  const { error } = await client.auth.exchangeCodeForSession(code)
  if (error !== null) {
    stopPolling()
    setState({ status: 'signed-out', user: null, error: `换取会话失败：${error.message}`, notice: null })
  }
  // 成功路径由 onAuthStateChange(SIGNED_IN) 收尾（停轮询 + 切态）。
}

/**
 * Google 登录全流程：起 loopback → 申请授权地址 → 系统浏览器打开 → 轮询回调 →
 * 换会话。状态经 store 推给 UI；任何失败落回 signed-out 并带可读 error。
 */
export async function beginGoogleSignIn(): Promise<void> {
  if (client === null || state.status === 'signing-in' || state.status === 'signed-in') return
  setState({ ...state, status: 'signing-in', error: null, notice: '正在向 Supabase 申请授权地址…' })
  // 全流程不裸抛（error-system-guards 守卫）：任何失败直接落 signed-out + 可读 error。
  const fail = (message: string): void => {
    stopPolling()
    setState({ status: 'signed-out', user: null, error: message, notice: null })
  }
  try {
    const redirectTo = await startAuthLoopback()
    const { data, error } = await client.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo, skipBrowserRedirect: true }, // 两个都不能动（参考文档 §4 坑 1）
    })
    if (error !== null) { fail(error.message); return }
    if (data.url === null) { fail('Supabase 没有返回授权地址'); return }
    window.open(data.url, '_blank', 'noopener')
    setState({
      ...state,
      notice: '已在系统浏览器打开 Google 登录页，登录后会自动回来。',
    })
    // 轮询回调（1s），5min 超时复位（PKCE code 过期 + 用户关浏览器的退路）。
    pollDeadline = Date.now() + SIGNIN_TIMEOUT_MS
    stopPolling()
    pollTimer = setInterval(() => {
      void (async () => {
        if (client === null) { stopPolling(); return }
        if (Date.now() > pollDeadline) {
          fail('等待登录超时，请重试。')
          return
        }
        try {
          const { active, callbackUrl } = await fetchPendingAuthCallback()
          if (active && callbackUrl !== null) await handleCallback(callbackUrl)
        } catch {
          // 单次轮询失败（webserver 抖动）：忽略，下一轮重试；超时兜底在上方。
        }
      })()
    }, POLL_INTERVAL_MS)
  } catch (cause) {
    fail(cause instanceof Error ? cause.message : String(cause))
  }
}

/** 退出登录：supabase 清会话，SIGNED_OUT 事件统一收尾（含清 Host 缓存）。 */
export async function signOutAuth(): Promise<void> {
  if (client === null) return
  await client.auth.signOut()
}

/** visibilitychange 补推：休眠唤醒后 token 可能已被 autoRefreshToken 换新，覆盖一次。 */
export function installAuthVisibilityPush(): void {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || client === null) return
    void client.auth.getSession().then(({ data }) => {
      if (data.session !== null) pushSession('TOKEN_REFRESHED', data.session)
    }).catch(() => undefined)
  })
}
