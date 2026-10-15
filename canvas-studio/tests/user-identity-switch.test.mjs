/**
 * 用户身份切换守卫（2026-10-15，P1 登录闭环收尾）。
 *
 * 症状：登录系统做好后，产品里仍残留写死的假身份（`USER_MOCK`：林小满 /
 * 假 UID / 个人账号 / 2600），而且是**只切了一半**——用户卡已登录走真值，
 * 「未登录」与「未配置 Supabase」两条真实状态**照样回落假名**；首屏问候**恒用**
 * 假名（该组件根本没有 auth 入参）；收起态左栏头像顶着别人的首字。
 * 用户看到的是「账号串了」，不是「占位」。
 *
 * 本守卫钉四件事（**源码接线**，不是行为）：
 * 1. 假身份在源码里**绝迹**（`USER_MOCK` / 真人假名 / 假 UID / 假账号身份），
 *    预览台也在扫描面内 —— 预览台是「产品长这样」的凭据，它自己必须先干净；
 * 2. 三态各有来源：已登录 → 会话；未登录 → 登录入口；未配置 → 中性「本地模式」，
 *    且**任何一态都不显示别人的名字**；
 * 3. 「已登录才传名字」只有**一份判据**（StudioFrame 的 `signedInName`），两个
 *    消费点（LobbyHero / RailStrip）共用 —— 各算一遍迟早一处漏切；
 * 4. 预览台跟着产品走：用户卡三态各有变体 + 未知 state 反向对照。
 *
 * ⚠️ 断言方式是「读源码 + 剥注释」（与 auth-entry-gate / media-upload-wiring 同一
 *    手法）：历史留痕的注释里出现旧常量名是**允许的**（我们要禁止的是活代码里
 *    再出现假身份），所以扫描前必须剥注释。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const readSource = (relativePath) => readFileSync(join(here, relativePath), 'utf8')
/** 只剥块注释与整行注释，不做行内剥除（注释里出现代码片段是常态）。 */
const codeOnly = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n')

/** 递归收集文件（跳过点目录与 node_modules）。 */
function walk(dir, accept) {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(full, accept))
    else if (accept(entry.name)) out.push(full)
  }
  return out
}

const SRC_FILES = walk(join(root, 'src'), (name) => /\.tsx?$/.test(name))
const SCRIPTS_DIR = join(root, 'scripts')
const PREVIEW_FILES = readdirSync(SCRIPTS_DIR)
  .filter((name) => /^preview-.+\.mjs$/.test(name))
  .map((name) => join(SCRIPTS_DIR, name))

/** 被禁的假身份痕迹：假常量名 + 真人假名 + 固定假 UID + 假账号身份。 */
const FORBIDDEN = ['USER_MOCK', '林小满', '467368332739416065', '个人账号']

test('假身份在活代码里绝迹（src + 预览台，剥注释后扫描）', () => {
  // 扫描面自检：目录遍历写坏时下面会「零命中通过」—— 那是最坏的一种空绿。
  assert.ok(SRC_FILES.length > 50, `src 扫描面可疑地小（${SRC_FILES.length} 个文件）`)
  assert.ok(PREVIEW_FILES.length > 8, `预览台扫描面可疑地小（${PREVIEW_FILES.length} 个文件）`)

  const hits = []
  for (const file of [...SRC_FILES, ...PREVIEW_FILES]) {
    const code = codeOnly(readFileSync(file, 'utf8'))
    for (const token of FORBIDDEN) {
      if (code.includes(token)) hits.push(`${relative(root, file)} → ${token}`)
    }
  }
  assert.deepEqual(hits, [],
    '未登录 / 未配置账号体系一律走 ACCOUNT_COPY 中性文案，活代码里不得再出现假身份：\n' + hits.join('\n'))
})

test('假身份常量已删除、中性文案常量到位（brand-copy）', () => {
  const BRAND_COPY = codeOnly(readSource('../src/brand-copy.ts'))
  assert.doesNotMatch(BRAND_COPY, /export const USER_MOCK/,
    'USER_MOCK 必须已删除（它是本次要切的假身份源）')
  assert.match(BRAND_COPY, /export const ACCOUNT_COPY = \{/,
    'ACCOUNT_COPY 必须存在（中性身份文案的唯一来源）')
  // 四个键各管一件事：注入新键没问题，但删掉任何一个都会让某个状态失去措辞来源。
  for (const [key, value] of [['signedOut', '未登录'], ['local', '本地模式'], ['localHint', '未配置账号体系'], ['greet', '创作者']]) {
    assert.match(BRAND_COPY, new RegExp(`${key}: '${value}'`), `ACCOUNT_COPY.${key} 必须是「${value}」`)
  }
  // 2026-10-15 拍板：计费后端未接入前，积分占位**保留**但必须是具名常量（一处处换）。
  assert.match(BRAND_COPY, /export const CREDITS_PLACEHOLDER = 2600/,
    '积分占位必须收敛成 CREDITS_PLACEHOLDER（接通计费后端后一处替换）')
})

test('用户卡：三态各有来源，未登录不渲染面板、未配置态不显示任何 UID', () => {
  const USER_CARD = codeOnly(readSource('../src/client/UserCard.tsx'))
  assert.match(USER_CARD, /export function GuestAvatar\(/,
    'GuestAvatar 必须存在（无身份头像的唯一实现，用户卡与收起态共用）')
  assert.match(USER_CARD, /signedIn \? <LetterAvatar name=\{displayName\} size=\{30\} \/> : <GuestAvatar size=\{30\} \/>/,
    '用户条头像必须按登录态二选一：未登录不得顶着别人的首字')
  assert.match(USER_CARD, /\{!signedOut && open && \(/,
    '面板只在「非未登录」态渲染（已登录 / 未配置账号体系）')
  assert.doesNotMatch(USER_CARD, /\{signedOut && open/,
    '未登录态不得渲染面板 —— 用户条本身就是「登录 / 注册」入口，再开一个面板等于第二套入口，'
    + '而且那条面板此前正是拿假身份填头部的')
  assert.match(USER_CARD, /signedIn \? `UID：\$\{auth!\.user!\.userId\}` : ACCOUNT_COPY\.localHint/,
    'UID 行只准两个来源：会话 UID（已登录）/ 未配置说明 —— 不得有第三个（假 UID）')
  assert.match(USER_CARD, /✦ \{CREDITS_PLACEHOLDER\}/,
    '积分行必须走占位常量（别把 2600 又写回 JSX）')
})

test('首屏问候：称呼只有两个来源（会话真名 / 中性称呼）', () => {
  const HERO = codeOnly(readSource('../src/client/LobbyHero.tsx'))
  assert.match(HERO, /userName\?: string \| undefined/,
    '必须收 userName 入参（此前该组件根本没有 auth 入参 ⇒ 问候无从切换）')
  assert.match(HERO, /const greet = userName !== undefined && userName !== '' \? userName : ACCOUNT_COPY\.greet/,
    '缺省必须退到 ACCOUNT_COPY.greet（不许用任何名字兜底）')
  assert.match(HERO, /<p className="csLobbyGreet">你好，\{greet\}，\{EMPTY_COPY\.welcomeTitle\}。<\/p>/,
    '问候行必须用 greet 变量（不写第二处称呼来源）')
})

test('收起态左栏：无身份时用人形剪影，不借名字', () => {
  const RAIL = codeOnly(readSource('../src/client/RailStrip.tsx'))
  assert.match(RAIL, /const hasUser = userName !== undefined && userName !== ''/,
    '必须先判「有没有真名」——直接拼进头像会拿到空名字')
  assert.match(RAIL, /hasUser \? <LetterAvatar name=\{displayName\} size=\{26\} \/> : <GuestAvatar size=\{26\} \/>/,
    '无身份时必须走 GuestAvatar（此前是 `userName ?? USER_MOCK.name`，未登录顶着别人的首字）')
})

test('「已登录才传名字」只有一份判据，两个消费点共用', () => {
  const FRAME = codeOnly(readSource('../src/client/StudioFrame.tsx'))
  assert.match(FRAME, /const signedInName = auth\.status === 'signed-in' \? auth\.user\?\.name : undefined/,
    '判据必须提出来算一次（两个消费点各写一遍同样的三元 = 迟早一处漏切）')
  const hits = FRAME.match(/signed-in' \? auth\.user\?\.name/g) ?? []
  assert.equal(hits.length, 1, `判据只准 1 处（实测 ${hits.length}）`)
  assert.match(FRAME, /<LobbyHero[\s\S]{0,400}?userName=\{signedInName\}/,
    'LobbyHero 必须收这一份判据')
  assert.match(FRAME, /<RailStrip[\s\S]{0,500}?userName=\{signedInName\}/,
    'RailStrip 必须收这一份判据')
})

test('预览台跟着产品走：用户卡三态各有变体 + 未知 state 反向对照', () => {
  const PREVIEW = readSource('../scripts/preview-user.mjs')
  // 三态由 `stateBlock(id, …)` 生成 —— 断言**调用点**（模板里只有 `${id}` 插值，
  // 写死 `data-state="local"` 反而说明这段没有走同一个生成器）。
  assert.ok(PREVIEW.includes('data-state="${id}"'),
    '状态块必须由唯一生成器打 data-state（手写三份标记必然漂移）')
  for (const state of ['local', 'signed-out', 'signed-in']) {
    assert.ok(PREVIEW.includes(`stateBlock('${state}'`), `预览台必须渲染 ${state} 态`)
  }
  assert.ok(PREVIEW.includes("params.get('state')"),
    '必须支持 ?state= 切换（三态各自成一个变体；否则三态只验得到一种）')

  const TARGETS = readSource('../scripts/verify-previews.mjs')
  for (const state of ['?state=local', '?state=signed-out', '?state=signed-in']) {
    assert.ok(TARGETS.includes(`query: '${state}'`), `变体矩阵必须含 ${state}`)
  }
  assert.match(TARGETS, /query: '\?state=__unknown__'[\s\S]{0,80}expectFail: true/,
    '未知 state 必须有 expectFail 对照 —— 状态名打错时三个变体都安静地显示空页，最难查')
})
