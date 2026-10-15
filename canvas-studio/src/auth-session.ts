/**
 * P1/P2 登录态中转：client（supabase-js 唯一持有者）推来的最新会话在 Host 侧的
 * **内存缓存**。设计约束（方案讨论拍板，2026-10-15）：
 *
 * - client 是唯一 session 持有者（PKCE verifier / 刷新都归它，supabase-js 的
 *   refresh token 轮换机制不容许两个持有者竞态），Host 只做被动缓存；
 * - 不落盘：重启后由 client boot 推送补上，refresh token 永远只活在 client 的
 *   localStorage；缓存值也绝不进日志（access token 等同凭据）。
 *
 * P1 只落骨架（登录闭环展示用）；P2 的 generate.ts Bearer 注入从这里取值。
 */
export interface StudioAuthSession {
  /** Supabase access token（JWT，未过期；过期由 client 刷新后重推）。 */
  accessToken: string
  /** token 过期时间（epoch 秒，来自 JWT exp；仅作诊断展示，不做本地判活）。 */
  expiresAt: number | null
  /** Supabase user id（计费账号标识）。 */
  userId: string
  /** 展示用邮箱。 */
  email: string | null
}

let current: StudioAuthSession | null = null

/** 覆盖当前会话缓存（client 在 boot / SIGNED_IN / TOKEN_REFRESHED 时机推送）。 */
export function setAuthSession(session: StudioAuthSession): void {
  current = session
}

/** 读当前会话缓存；未登录 / 未推送过 = null。P2 的 Drama Bearer 注入从这里取。 */
export function getAuthSession(): StudioAuthSession | null {
  return current
}

/** 清空（client SIGNED_OUT / signOut 时推送）。 */
export function clearAuthSession(): void {
  current = null
}

// ── P2：Drama Backend 的 Bearer 注入（2026-10-15）─────────────────────────────

/**
 * 鉴权强制开关：开启后 Drama 的**消耗型**请求（dramaPost 生成 / uploadBytesToDrama
 * 上传）在 Host 缓存里没有会话时直接抛 `CS-AUTH-001`（auth-required），不再发出请求。
 *
 * 由 Host 装配按 `supabaseUrl` 是否非空驱动（index.ts，live 读取设置）——未配置
 * Supabase 的环境（含测试直连 lib）保持关闭，行为与 P2 之前完全一致（fail-open），
 * 避免「装了插件但没配登录」的部署被整体锁死生成。
 */
let dramaAuthRequired = false

/** Host 装配时设置（supabaseUrl 非空 = 开启）；测试可显式开关后复位。 */
export function setDramaAuthRequired(enabled: boolean): void {
  dramaAuthRequired = enabled
}

/** 当前是否要求 Drama 鉴权（generate.ts 的 fail-fast 判据）。 */
export function isDramaAuthRequired(): boolean {
  return dramaAuthRequired
}

/**
 * Drama 请求的鉴权头（**单点实现** —— 4 处 fetch（submit/poll/health/upload）都从
 * 这里取，禁止各处手拼）。有会话返回 `Authorization: Bearer <token>`，无会话返回
 * 空对象（不打无鉴权的请求塞假头；后端未启用校验时零影响）。
 *
 * token 只进请求头，绝不写日志（auth-session.ts 头注同款纪律）。
 */
export function dramaAuthHeaders(): Record<string, string> {
  const session = getAuthSession()
  if (session === null) return {}
  return { authorization: `Bearer ${session.accessToken}` }
}
