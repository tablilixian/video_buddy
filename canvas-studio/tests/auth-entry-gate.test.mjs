/**
 * P2.1 登录前置闸接线守卫（2026-10-15）。
 *
 * 症状：退出登录后点画布节点的「发送/重试」**完全没有反应**（预期弹登录窗），
 * 而经 agent 调后台工具时登录窗照弹。根因不是闸失效（Host 侧 fail-fast 好着呢），
 * 是**同一个 `CS-AUTH-001` 两条通道收口不同**：工具通道经 `asset-capture` 认码 →
 * `onAuthError` → `handleAuthError` → `requestLoginPrompt()`；而画布节点卡的
 * `retryNode` 是 UI 直连路由，catch 里只写 `node.error`。
 *
 * 本守卫钉四件事（**接线**，不是行为）：
 * 1. 「需要登录吗」的判据**只此一份**（`auth-store.ts` 的 `needsSignIn` /
 *    `requireSignIn`），且码字面量在 client 侧只有一处来源（`api.ts` 的
 *    `AUTH_REQUIRED_CODE` 常量）；
 * 2. 已知的**消耗型直连入口**都挂了闸，且都遵守「拒收先于副作用」；
 * 3. 闸不得出现在只读入口（后台预热 / 轮询）—— 那会让登录窗自己弹出来；
 * 4. **聊天发送只有一个实现**（`index.ts` 的 `sendChatText`，用户输入那条在宿主
 *    facade 包装里）—— 见「聊天发送」那条 test。
 *
 * ⚠️ 本文件用「读源码 + 剥注释」的方式断言（与 `media-upload-wiring.test.mjs`
 *    同一手法，见其头注关于块注释起始序列的坑）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const readSource = (relative) => readFileSync(join(here, relative), 'utf8')
/** 只剥块注释与整行注释，不做行内剥除（注释里出现代码片段是常态）。 */
const codeOnly = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n')

const AUTH_STORE = codeOnly(readSource('../src/client/auth/auth-store.ts'))
const API = codeOnly(readSource('../src/client/api.ts'))
const INDEX = codeOnly(readSource('../src/client/index.ts'))
const FRAME = codeOnly(readSource('../src/client/StudioFrame.tsx'))

test('登录判据只有一份：needsSignIn / requireSignIn 定义在 auth-store', () => {
  assert.match(AUTH_STORE, /export function needsSignIn\(\): boolean \{/,
    'needsSignIn 必须存在（纯判据，无副作用 —— 后台任务据此静默跳过）')
  assert.match(AUTH_STORE, /export function requireSignIn\(\): boolean \{/,
    'requireSignIn 必须存在（判据 + 弹窗）')
  // unconfigured 必须放行：没配 Supabase 的部署（测试 / 自托管）行为与 P2 之前一致。
  assert.match(AUTH_STORE, /status !== 'unconfigured' && status !== 'signed-in'/,
    "unconfigured 与 signed-in 是唯二放行态（漏掉 unconfigured ⇒ 免登录环境被整体锁死）")
  // 弹窗只在 requireSignIn 里发生；needsSignIn 不得有副作用。
  const needs = AUTH_STORE.slice(
    AUTH_STORE.indexOf('export function needsSignIn'),
    AUTH_STORE.indexOf('export function requireSignIn'),
  )
  assert.doesNotMatch(needs, /requestLoginPrompt/, '纯判据不得弹窗（后台任务会措手不及）')
  assert.match(AUTH_STORE, /export function requireSignIn[\s\S]{0,400}?requestLoginPrompt\(\)/,
    'requireSignIn 必须经由 requestLoginPrompt 走唯一弹窗桥')
})

test('CS-AUTH-001 码字面量在 client 只有一处来源（api.ts 的常量）', () => {
  assert.match(API, /export const AUTH_REQUIRED_CODE = 'CS-AUTH-001' as const/,
    '码必须以常量导出 —— 判断与抛码都从这里取，散落字面量迟早漂移')
  assert.match(API, /export function isAuthRequiredError\(cause: unknown\): boolean \{/,
    'isAuthRequiredError 必须存在（UI 侧认码的唯一入口）')
  assert.match(API, /cause instanceof StudioApiError && cause\.code === AUTH_REQUIRED_CODE/,
    '判据必须认 StudioApiError.code（不要解析 message 文案）')
  const hits = API.match(/CS-AUTH-001/g) ?? []
  assert.equal(hits.length, 1, `api.ts 里码字面量只准 1 处（实测 ${hits.length}）`)
  for (const [name, src] of [['index.ts', INDEX], ['StudioFrame.tsx', FRAME]]) {
    assert.equal((src.match(/CS-AUTH-001/g) ?? []).length, 0,
      `${name} 不得再抄一份码字面量 —— 必须经 AUTH_REQUIRED_CODE 常量 / isAuthRequiredError 判`)
  }
})

test('画布节点重试：闸在 isReplayable 之后、写 isLoading 之前', () => {
  const start = INDEX.indexOf('const retryNode =')
  assert.ok(start > 0, '找不到 retryNode（结构变了就更新本守卫）')
  const end = INDEX.indexOf('ctx.effect(() => {', start)
  assert.ok(end > start, '找不到 retryNode 的收口位置')
  const body = INDEX.slice(start, end)

  const replayAt = body.indexOf('isReplayable(node)')
  const gateAt = body.indexOf('if (!requireSignIn()) return')
  const loadingAt = body.indexOf('isLoading: true')
  assert.ok(replayAt > 0 && gateAt > 0 && loadingAt > 0, '三处缺一：判据 / 闸 / 进加载态')
  assert.ok(replayAt < gateAt, '闸必须在 isReplayable 之后 —— 本地参数结论与登录态无关，别把准确信息换成「请登录」')
  assert.ok(gateAt < loadingAt, '闸必须在写 isLoading 之前 —— 否则未登录也会进加载态（= 点了没反应 + 画布转圈）')

  // catch 兜底：认码 → 弹窗 + **不写 node.error**（与 asset-capture 同语义：可恢复态不标红）。
  const catchAt = body.indexOf('isAuthRequiredError(cause)')
  assert.ok(catchAt > 0, 'retryNode 的 catch 必须认 CS-AUTH-001（闸被绕过时的兜底：请求在飞期间登录态失效）')
  const branch = body.slice(catchAt, body.indexOf('return', catchAt))
  assert.match(branch, /requestLoginPrompt\(\)/, '认码后必须弹登录窗')
  assert.match(branch, /isLoading: false/, '认码后必须收起加载态')
  assert.doesNotMatch(branch, /error:/,
    '认码后不得写 node.error —— 把「需要登录」标成「生成失败」会让用户去点重试而不是登录')
})

test('参考句柄解析：唯一实现 + 前置闸（两个调用点共用）', () => {
  const call = FRAME.match(/resolveStudioRefs\(/g) ?? []
  assert.equal(call.length, 1,
    `resolveStudioRefs 在 StudioFrame 只准 1 个调用点（实测 ${call.length}）—— 闸必须挂在唯一实现里，两处各写一份必然分叉`)
  const start = FRAME.indexOf('const resolveRefsForProject = useCallback(')
  assert.ok(start > 0, '找不到 resolveRefsForProject（结构变了就更新本守卫）')
  const body = FRAME.slice(start, FRAME.indexOf('}, [projectId])', start))
  assert.match(body, /if \(!requireSignIn\(\)\) return \[\]/,
    '解析链会惰性提升（上传 Drama 换句柄）⇒ 是消耗型入口，必须挂闸')
  const gateAt = body.indexOf('requireSignIn()')
  const callAt = body.indexOf('resolveStudioRefs(projectId, refs)')
  assert.ok(gateAt < callAt, '闸必须在真正发请求之前（拒收先于副作用）')
  const props = FRAME.match(/onResolveRefs: resolveRefsForProject/g) ?? []
  assert.equal(props.length, 2,
    `两个调用点（画布浮层 / 详情抽屉）都必须接到同一个实现（实测 ${props.length}）`)
  assert.doesNotMatch(FRAME, /onResolveRefs: \(refs: readonly string\[\]\) =>/,
    '不得再出现逐点内联的解析箭头函数（那是第二份入口规则）')
})

test('闸的调用点白名单：只读入口不得挂闸（否则登录窗会自己弹出来）', () => {
  const clientDir = join(here, '../src/client')
  const files = readdirSync(clientDir, { recursive: true })
    .map((entry) => String(entry))
    .filter((entry) => /\.tsx?$/u.test(entry))
  const allowed = new Set(['auth/auth-store.ts', 'index.ts', 'StudioFrame.tsx'])
  const offenders = []
  for (const relative of files) {
    const src = codeOnly(readSource(join('../src/client', relative)))
    if (!/requireSignIn\(/.test(src)) continue
    // auth-store 是定义处（`export function requireSignIn()`），不算调用点。
    if (allowed.has(relative)) continue
    offenders.push(relative)
  }
  assert.deepEqual(offenders, [],
    `这些文件挂了登录闸但不在白名单里：${offenders.join(', ')} —— 只读/轮询入口挂闸会让登录窗无故弹出，真要挂请先更新白名单与本测试`)

  // 后台预热：失败已静默 catch + Host fail-fast 零网络 ⇒ 加闸纯冗余（且会在后台弹窗）。
  const warmupAt = INDEX.indexOf('const promoteDeferredAssets')
  assert.ok(warmupAt > 0, '找不到 promoteDeferredAssets')
  const warmup = INDEX.slice(warmupAt, INDEX.indexOf('const sha256Hex', warmupAt))
  assert.doesNotMatch(warmup, /requireSignIn|needsSignIn/,
    '后台预热不得挂登录闸：它是静默失败的后台任务，弹窗会莫名其妙（惰性兜底在某次生成时自然覆盖）')
})

test('退出登录：SIGNED_OUT 推送必须等落地（收「退出后立刻操作」的竞态窗）', () => {
  const start = AUTH_STORE.indexOf('export async function signOutAuth')
  assert.ok(start > 0, '找不到 signOutAuth')
  const body = AUTH_STORE.slice(start, AUTH_STORE.indexOf('// ── L1 前置闸', start))
  assert.match(body, /await client\.auth\.signOut\(\)/, 'signOut 本身照旧')
  assert.match(body, /await pushAuthSession\('SIGNED_OUT', null\)/,
    'signOutAuth 必须**等待**一次 null 推送落地 —— onAuthStateChange 里的推送是 fire-and-forget，'
    + '不等就会留下「退出登录 → 立刻重试」时 Host 还挂着旧 token 的窗口')
})

/**
 * 聊天发送闸（2026-10-15 需求：未登录不得给 LLM 发消息）。
 *
 * 关键教训：用户输入走 `conversation.sendSession`（宿主 facade），而**程序代发**
 *（`wakeAgent` 自动唤醒 / 效果测试编排）走的是 `conversation.send` —— **两个方法**。
 * 只在 facade 上挂闸，程序代发那几条照样发得出去（= 代码里留了口子）。
 * 所以收敛成唯一实现 `sendChatText`，并用本条 test 钉住「不得有第二个发送点」。
 */
test('聊天发送：唯一实现 + 全仓不得直调 conversation.send', () => {
  // ① 唯一实现在，且闸在 send 之前、未登录是「抛码」而不是静默 return
  const start = INDEX.indexOf('const sendChatText = ')
  assert.ok(start > 0, '找不到 sendChatText —— 聊天发送的唯一实现（结构变了就更新本守卫）')
  const body = INDEX.slice(start, INDEX.indexOf('const wakeAgent =', start))
  const gateAt = body.indexOf('requireSignIn()')
  const sendAt = body.indexOf('conversation.send(')
  assert.ok(gateAt > 0 && sendAt > 0, '唯一实现必须同时含闸与真正的 send')
  assert.ok(gateAt < sendAt, '闸必须在 send 之前 —— 未登录时零发送')
  assert.match(body, /throwError\(AUTH_REQUIRED_CODE/,
    '未登录必须抛码（不是静默 return）—— 编排跑批要靠它走显式失败分支')

  // ② 全仓 conversation.send( 只准出现在唯一实现里 —— 防「新加发送点忘了挂闸」
  const clientDir = join(here, '../src/client')
  const files = readdirSync(clientDir, { recursive: true })
    .map((entry) => String(entry))
    .filter((entry) => /\.tsx?$/u.test(entry))
  const offenders = []
  for (const relative of files) {
    const src = codeOnly(readSource(join('../src/client', relative)))
    const calls = src.match(/conversation\.send\(/g) ?? []
    if (calls.length === 0) continue
    if (relative === 'index.ts' && calls.length === 1) continue
    offenders.push(`${relative}(${calls.length})`)
  }
  assert.deepEqual(offenders, [],
    `conversation.send 只准出现在 sendChatText 里（实测越界：${offenders.join(', ')}）—— `
    + '别的路径自己取句柄发消息就等于绕过聊天登录闸')

  // ③ 宿主 facade 包装：闸必须在 claimAndSend 之前（否则未登录先把项目建出来）
  const wrapAt = INDEX.indexOf('conversation.sendSession = ')
  assert.ok(wrapAt > 0, '找不到 sendSession 包装（结构变了就更新本守卫）')
  const wrap = INDEX.slice(wrapAt, INDEX.indexOf('installed = { conversation, original }', wrapAt))
  const wrapGateAt = wrap.indexOf('requireSignIn()')
  const claimAt = wrap.indexOf('claimAndSend(args)')
  assert.ok(wrapGateAt > 0 && claimAt > wrapGateAt,
    '聊天闸必须在 claimAndSend 之前 —— 未登录时先建项目再被拒是错的（草稿与空项目双输）')
  // 包装是 async（0.2.1 后首句要先等基线就绪），未登录直接返回结果对象即可 ——
  // 只要返回的是 `{ kind: 'error' }`，宿主就保留草稿（SubmitOutcome 契约）。
  assert.match(wrap, /return (\{ kind: 'error' \}|Promise\.resolve\(\{ kind: 'error' \}\))/,
    "未登录必须返回 { kind: 'error' } —— 宿主据此保留草稿（SubmitOutcome 契约）")

  // ④ 程序代发两条路径都必须经唯一实现
  const wakeAt = INDEX.indexOf('const wakeAgent =')
  const wake = INDEX.slice(wakeAt, INDEX.indexOf('const confirmKeyframes', wakeAt))
  assert.match(wake, /sendChatText\(sessionId, text\)/, 'wakeAgent 必须经唯一实现')
  assert.doesNotMatch(wake, /conversation\.send\(/, 'wakeAgent 不得自己取句柄发消息')
  const direct = INDEX.match(/await sendChatText\(/g) ?? []
  assert.equal(direct.length, 2,
    `效果测试编排的两处（跑批 / 自动场景）都必须走 sendChatText（实测 ${direct.length}）`)
})
