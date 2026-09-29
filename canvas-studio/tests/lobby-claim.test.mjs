/**
 * REQ-005 v1.3（变体 A）首页链路守卫：draft 落点 + sendSession 拦截认领。
 *
 * 变体 A 的语义是「首页发送的瞬间，先把 draft 目录认领成项目，再原样放行宿主
 * 发送」—— 中间任何一环脱落，表象都是「发了消息但没建项目」或「建了项目但消息
 * 丢了」，真机不点一遍根本看不出来。本文件守四件事：
 *
 * 1. **Host 侧认领变体**（createClaimingDir：目录校验 + 重名拒绝 + 不整目录 mkdir；
 *    draft 目录名/清扫/顺延）；
 * 2. **路由与 api 封装接线**（body.dir 分支 / draft-landing 路由 / api 两个函数）；
 * 3. **Client 落点**（ensureDraftLanding 幂等 + 强制重建 + goHome/订阅触发）；
 * 4. **拦截分支**（lobby 判定、cwd 认领、失败 error 保草稿、成功后放行）。
 *
 * 与 studio-defaults 的接线守卫同一立场：判定对了但没接 = 等于没做。
 * 运行：corepack yarn workspace canvas-studio run test:smoke
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/** 只剥块注释与整行注释（叮嘱会长在注释里，别让它们替实现挡枪）。 */
function readSource(rel) {
  return readFileSync(new URL(rel, import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n')
}

const PROJECTS = readSource('../src/projects.ts')
const ROUTES = readSource('../src/routes.ts')
const API = readSource('../src/client/api.ts')
const INDEX = readSource('../src/client/index.ts')
const STORE = readSource('../src/client/project-store.ts')

test('Host：createClaimingDir 必须校验目录归属、存在性与重名（认领不是免检登记）', () => {
  // 目录必须落在 projects 内（与 readDocument 的 CR-008 记录校验同一口径）——
  // 不校验的话，登记后的 registry 一读就抛「记录 dir 越界」，整个列表瘫痪。
  assert.match(PROJECTS, /async createClaimingDir\(name: string, dir: string, plan\?: StudioProjectPlan, mode\?: StudioWorkflowMode\)/,
    'createClaimingDir 必须存在（create 的认领变体）')
  assert.match(PROJECTS, /非法认领目录（必须在项目目录内）/,
    '认领目录越界必须拒绝（CS-DEV-ERR）—— 否则登记后整个 registry 读取会炸')
  assert.match(PROJECTS, /认领目录不存在，无法创建项目/,
    '目录不存在必须拒绝 —— 那是状态错乱，不是可恢复错误')
  assert.match(PROJECTS, /该目录已被其它项目占用/,
    '同目录二次认领必须拒绝（双窗口互斥的最后防线）')
  // 重名拒绝与 create 同源：写盘前双查（并发窗口防撞名）。
  assert.match(PROJECTS, /项目名已存在/g, '重名拒绝文案必须存在（create 与认领共用）')
  // 认领不整目录 mkdir，但 assets/ 子目录要幂等补齐（生成产物即刻可落盘）。
  const claimAt = PROJECTS.indexOf('async createClaimingDir')
  const nextMethodAt = PROJECTS.indexOf('async ensureDraftDir')
  const claimBody = PROJECTS.slice(claimAt, nextMethodAt)
  assert.match(claimBody, /mkdir\(join\(resolved, 'assets'\), \{ recursive: true/,
    '认领路径必须幂等补建 assets/ 子目录')
  assert.ok(!claimBody.includes('uniqueDirName'), '认领变体不得再 mint 新目录（会话 cwd 就在 draft 目录上）')
})

test('Host：draft 目录命名 / 顺延 / 启动清扫必须齐全', () => {
  assert.match(PROJECTS, /DRAFT_DIR_PREFIX = '\.draft-'/, 'draft 目录前缀必须存在')
  assert.match(PROJECTS, /export function draftDirName/, '当月 draft 目录名函数必须导出')
  assert.match(PROJECTS, /async ensureDraftDir/, 'ensureDraftDir 必须存在（首页落点）')
  assert.match(PROJECTS, /async sweepUnclaimedDraftDirs/, '启动清扫必须存在（回收未认领的空 draft 目录）')
  // 已认领目录顺延：否则用户当月再次回首页会绑到正式项目上（认领报「被占用」死循环）。
  assert.match(PROJECTS, /\$\{base\}-\$\{index\}/, '已认领的当月目录必须顺延 -2/-3…')
  // 清扫只删全空目录：非空（会话/附件残留）保守跳过。
  const sweepAt = PROJECTS.indexOf('async sweepUnclaimedDraftDirs')
  const sweepBody = PROJECTS.slice(sweepAt, sweepAt + 1800)
  assert.match(sweepBody, /inner\.length > 0/, '清扫必须跳过非空目录（保守不删）')
})

test('路由 / api：认领分支与 draft-landing 落点路由必须接线', () => {
  assert.match(ROUTES, /const ROUTE_PROJECT_DRAFT = '\/canvas-studio\/draft-landing'/, 'draft-landing 路由必须注册')
  assert.match(ROUTES, /await registry\.ensureDraftDir\(\)/, 'draft-landing 必须调 ensureDraftDir')
  assert.match(ROUTES, /await registry\.createClaimingDir\(name, body\.dir, plan, mode\)/,
    'body.dir 存在时必须走认领变体（否则首页发送会 mint 第二个目录，会话 cwd 对不上）')
  assert.match(API, /export async function ensureStudioDraftDir/, 'api 必须封装 draft 落点')
  assert.match(API, /export async function createStudioProjectClaimDir/, 'api 必须封装认领变体')
  assert.match(API, /const body: Record<string, unknown> = \{ name, dir \}/, '认领请求体必须带 dir')
})

test('Client：落点幂等 + 强制重建 + 两条触发路径必须都在', () => {
  assert.match(INDEX, /const ensureDraftLanding = \(force = false\)/, '落点函数必须带 force 参数（认领失败重建）')
  assert.match(INDEX, /if \(current !== undefined && current\.cwd === dir\) return/,
    '落点必须幂等短路（订阅反复触发零成本）')
  assert.match(INDEX, /ctx\.workspaces\.create\(\{ path: dir \}\)/, '落点必须绑 draft workspace')
  assert.match(INDEX, /ctx\.workspaces\.startSession\(workspace\.workspaceId\)/, '落点必须起会话（宿主卡活跃的前提）')
  assert.match(INDEX, /const maybeDraftLanding = /, '启动订阅路径的落点守卫必须存在')
  assert.match(INDEX, /void ensureDraftLanding\(\)\s*\n\s*\}/, 'goHome 必须触发落点')
  assert.match(INDEX, /baselinesReady\)? return/, '落点守卫必须等基线就绪（否则启动瞬间误建）')
})

test('Client：sendSession 拦截分支（判定 → cwd 认领 → 失败 error → 成功放行）', () => {
  // lobby 判定：基线就绪且当前会话不映射任何项目。基线未就绪时不得误判
  //（resolveActiveProjectId 那时恒 null，会把项目内发送误判成首页发送）。
  assert.match(INDEX, /baselinesReady && resolveActiveProjectId\(\) === null/,
    'lobby 判定必须带基线就绪前提 —— 否则启动瞬间会误认领')
  // 认领严格用当前会话 cwd：会话未就位不认领（error 保草稿，不空转）。
  assert.match(INDEX, /const dir = current\?\.cwd/, '认领必须用当前会话 cwd（dir 变量可能是旧落点）')
  assert.match(INDEX, /if \(dir === undefined\) return \{ kind: 'error' \}/,
    '会话未就位必须返回 error（宿主保草稿，不丢创意）')
  // 双击防抖：认领进行中的第二次发送不得并发建两个项目。
  assert.match(INDEX, /if \(claiming\) return Promise\.resolve\(\{ kind: 'error' \}\)/,
    '认领必须防抖（并发第二次发送直接 error 保草稿）')
  // E11：撞名 → refreshProjects 重算重试一次。
  assert.match(INDEX, /const duplicate = isDuplicateProjectName\(cause\)/, '认领失败必须先判撞名（E11 重试路径）')
  assert.match(INDEX, /void ensureDraftLanding\(true\)/,
    '非撞名失败（目录被别的窗口认领）必须强制重建落点 —— 否则用户重发永远撞同一目录')
  // 成功后放行走 divertSend（附件改道链路共用），不得直连 original 跳过附件。
  const claimAt = INDEX.indexOf('const claimAndSend')
  const wrapperAt = INDEX.indexOf('conversation.sendSession = (')
  const claimBody = INDEX.slice(claimAt, wrapperAt)
  assert.match(claimBody, /return divertSend\(args\)/, '认领成功后必须经 divertSend 放行（附件改道共用一份）')
  assert.match(claimBody, /storeInstance\.actions\.select\(project\.id\)/, '认领成功必须选中新项目（清 homePinned + 载画布）')
})

test('store：lobbySpec 草稿必须进 store（拦截分支在组件树之外读）', () => {
  assert.match(STORE, /lobbySpec: ProjectSpecDraft/, 'state 必须有 lobbySpec')
  assert.match(STORE, /setLobbySpec: \(draft, spec\) => \{ draft\.lobbySpec = spec \}/, 'action 必须落 store')
  // 规格 → 认领链路的另一端（模式透传的 store 侧）。
  assert.match(INDEX, /storeInstance\.getSnapshot\(\)\.lobbySpec/, '拦截分支必须从 store 读规格草稿')
})

test('规格行：必须挂宿主槽且 lobby 态条件渲染（work 态返回 null）', () => {
  const specRow = readSource('../src/client/LobbySpecRow.tsx')
  assert.match(specRow, /projectId !== null\) return null/, 'work 态必须返回 null（槽是 session 作用域，work 态也渲染）')
  assert.match(specRow, /<ProjectSpecChips/, '规格行必须复用 ProjectSpecChips（两套实现迟早分叉）')
  assert.match(specRow, /spec\.modeDirty === true\) return/, '默认模式对齐必须尊重用户已选（modeDirty）')
  assert.match(INDEX, /id: 'canvas-studio-lobby-spec'/, 'input.dock 上的规格行槽必须带 id（缺了运行时抛）')
  assert.match(INDEX, /\}, LobbySpecRow\)/, '规格行必须注册到宿主槽')
})
