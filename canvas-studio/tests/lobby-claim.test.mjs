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
  assert.match(claimBody, /mkdir\(join\(claimedDir, 'assets'\), \{ recursive: true/,
    '认领路径必须在改名后的目录里幂等补建 assets/ 子目录')
  // CV-294（方案 A）：认领时就地改名 —— draft 铸名不可见、无语义，认领成功即
  // rename 成项目名；改名失败回退原路径登记（认领不因改名失败而失败）。
  assert.match(claimBody, /await rename\(resolved, target\)/,
    '认领必须把 draft 目录就地 rename 成项目名（CV-294 方案 A）')
  assert.match(claimBody, /dir: claimedDir/, 'registry 必须按改名后的路径登记')
  assert.match(claimBody, /claimedDirTarget\(trimmed, projects\)/,
    '目标名必须经 sanitize + 磁盘占用去重（不吞掉已存在的目录）')
  // 登记失败（双查撞名 / commitRegistry 失败）必须回滚改名 —— 否则会话 cwd 指着
  // 一条不存在的路径，首页落点直接断（半改名目录还永远进不了清扫）。
  assert.match(claimBody, /rollbackRename/,
    '登记失败必须回滚改名（会话 cwd 还在原 draft 路径上）')
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

test('E-2（R-P2-02 履约）：启动即置位首页，画布只在显式 openProject 时载入', () => {
  const boot = INDEX.match(/storeInstance\.actions\.setHomePinned\(true\)\s*\n\s*maybeDraftLanding\(\)/)
  assert.ok(boot !== undefined, '启动 bootstrap 必须置位 homePinned 并立即建首页落点（draft 落点让首页宿主卡可输入）')
  const syncEffectAt = INDEX.indexOf("'canvas-studio: sync canvas to active workspace'")
  assert.ok(syncEffectAt !== -1 && boot.index < syncEffectAt,
    '置位必须先于「sync canvas to active workspace」effect 注册——晚于它就拦不住启动期 workspace/会话恢复的自动 select')
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

test('CV-294（方案 A）：认领改名后必须重建会话绑定，首句改发到新会话', () => {
  const claimAt = INDEX.indexOf('const claimAndSend')
  const wrapperAt = INDEX.indexOf('conversation.sendSession = (')
  assert.ok(claimAt !== -1 && wrapperAt > claimAt)
  const claimBody = INDEX.slice(claimAt, wrapperAt)
  // 判据 = project.dir 是否变化：Host 改名回退时保持原会话（cwd 还有效），不空转重建。
  assert.match(claimBody, /if \(project\.dir !== dir\)/,
    '只有 Host 改名成功（project.dir ≠ 原 cwd）才重建绑定 —— 回退路径会话不变')
  // 重建链（openProject 同款三步）：按新目录建 workspace → connect 取新会话 → open。
  assert.match(claimBody, /ctx\.workspaces\.create\(\{ path: project\.dir \}\)/,
    '必须按改名后的目录建 workspace（cwd 不 resolve 的旧绑定救不回来）')
  assert.match(claimBody, /await ctx\.workspaces\.connectWorkspace\(workspace\.workspaceId\)/,
    '必须 connectWorkspace 拿新会话 id（旧落点会话 cwd 失效，复用扫描必然落空）')
  assert.match(claimBody, /sessionSvc\.open\(newId\)/, '新会话必须 open 成为当前（宿主卡显示它）')
  // 首句必须发到新会话：args[0] 换成 binding.session —— 旧 session 的 cwd 已断。
  assert.match(claimBody, /args = \[binding\.session, args\[1\], args\[2\], args\[3\], args\[4\]\]/,
    '放行前必须把首句的 session 换成新会话（旧 session cwd 指着已 rename 的路径）')
  // 顺序闸：先 select 再重建 —— 重建触发的 workspaces/sessions 订阅里，
  // selectedProjectId 已落位才拦得住 maybeDraftLanding 把首页落点又建回去。
  const selectAt = claimBody.indexOf('storeInstance.actions.select(project.id)')
  const rebindAt = claimBody.indexOf('if (project.dir !== dir)')
  assert.ok(selectAt !== -1 && rebindAt > selectAt,
    '必须先 select 再重建（homePinned 已随 select 清除，两道闸都得关上）')
  // 旧落点 workspace（path 已失效）与其 blank 会话必须摘除 —— 侧栏不留死条目。
  assert.match(claimBody, /oldWorkspace/, '旧 draft workspace 必须被找到并摘除（含 blank 会话归档）')
  // 重建失败必须可见（项目已建成但没绑上会话）：error 保草稿 + 统一错误面。
  assert.match(claimBody, /failWith\(cause, '项目已创建，但会话绑定失败'\)/,
    '重建失败必须写进统一错误面（不许静默吞掉）')
})

test('store：lobbySpec 草稿必须进 store（拦截分支在组件树之外读）', () => {
  // REQ-028：类型随草稿域搬进 src/lobby-spec.ts（LobbySpecDraft），store 侧只换名。
  assert.match(STORE, /lobbySpec: LobbySpecDraft/, 'state 必须有 lobbySpec')
  assert.match(STORE, /setLobbySpec: \(draft, spec\) => \{ draft\.lobbySpec = spec \}/, 'action 必须落 store')
  // 规格 → 认领链路的另一端（模式透传的 store 侧）。
  assert.match(INDEX, /storeInstance\.getSnapshot\(\)\.lobbySpec/, '拦截分支必须从 store 读规格草稿')
})

test('规格选择器 v2：必须挂宿主卡工具行双槽且 lobby 态条件渲染（work 态返回 null）', () => {
  // REQ-028：v1.3 的 dock 行退役，规格选择器长进卡片工具行 —— 左组三枚进
  // input.left、执行模式 chip 进 input.right（演示位置）。draft 语义不变。
  const specRow = readSource('../src/client/LobbySpecRow.tsx')
  assert.match(specRow, /projectId !== null\) return null/, 'work 态必须返回 null（槽是 session 作用域，work 态也渲染）')
  assert.match(specRow, /from '\.\.\/lobby-spec\.js'/, '规格读数必须取自 lobby-spec 纯模块（映射真值只有一份，tests/lobby-spec.test.mjs 直连）')
  assert.match(specRow, /spec\.modeDirty === true\) return/, '默认模式对齐必须尊重用户已选（modeDirty）')
  assert.match(INDEX, /'conversation\.input\.left'[\s\S]{0,200}id: 'canvas-studio-lobby-spec'/, '左组槽必须带 id（缺了运行时抛）')
  assert.match(INDEX, /'conversation\.input\.right'[\s\S]{0,200}id: 'canvas-studio-lobby-mode'/, '右组槽必须带 id（缺了运行时抛）')
  assert.match(INDEX, /\}, LobbySpecChips\)/, '左组三 chip 必须注册到 input.left')
  assert.match(INDEX, /\}, LobbyModeChip\)/, '执行模式 chip 必须注册到 input.right')
  // 「开始创作」药丸：lobby 态给宿主发送钮打锚（找不到/核验不中就不打，样式退回原状）。
  assert.match(specRow, /tagSendButton/, '发送钮锚函数必须存在')
  assert.match(specRow, /data-cs-send/, '锚属性名必须落源码（styles.ts 的重塑规则以它为选择器）')
})

/* ---------------------------------------------------------------------------
 * CV-260：启动清扫把「当月首页落点」当垃圾删掉，首页掉回 inert 冷启动态。
 *
 * 真机日志（2026-09-29 21:17，用户截图前 2 分钟）：
 *   [canvas-studio] draft 清扫：回收 1 个未认领目录
 *   [workspace-registry] workspace '4457…' filtered session '…' from membership:
 *       cwd '…/projects/.draft-202609-2' does not resolve
 * → chipTitle 变 undefined → composer 退回宿主「选择一个工作区开始」虚线卡
 *   （全控件禁用；点它弹工作区选择器，糊在左栏上）。
 *
 * 要害是**当月 draft 目录天生满足清扫的两条判据**（registry 未认领 + 目录全空：
 * 认领发生在用户第一句话，assets/ 是认领后才补建），所以它不是「偶尔被误删」，
 * 而是每次启动必删。下面两条各守一半：清扫别删它；万一已经删了也能自愈。
 *
 * 2026-10 收窄（REQ-021 R001 后续拍板）：豁免机制从「当月基名」改为「目录龄
 * < 清扫窗口（REQ-021 定 7 天，CV-291 收紧为 1 天；铸名解析，退 mtime）+
 * 本运行 activeDraft 恒豁免」。行为级用例在
 * tests/projects-dir.test.mjs；本文件守源码形态 —— 实例态豁免（事故的直接因）
 * 与时间窗豁免都必须在 rm 之前。
 * ------------------------------------------------------------------------- */

test('CV-260：启动清扫必须豁免本运行绑定的落点，时间窗收窄为「目录龄 < 清扫窗口」', () => {
  const sweepAt = PROJECTS.indexOf('async sweepUnclaimedDraftDirs')
  assert.ok(sweepAt >= 0, 'sweepUnclaimedDraftDirs 必须存在')
  const sweepBody = PROJECTS.slice(sweepAt, sweepAt + 3000)
  // 实例态豁免（CV-260 事故的直接因）：本运行 activeDraft 绑定的落点，先于一切时间判定。
  assert.match(sweepBody, /resolve\(this\.activeDraft\.dir\) === resolve\(dir\)/,
    '本运行 activeDraft 绑定的落点必须恒豁免 —— 它天生「未认领 + 全空」，否则每次启动都被当垃圾删掉')
  // 时间窗豁免（2026-10 收窄，CV-291 现为 1 天）：目录龄 < 窗口保留（铸名解析创建时刻，退 mtime）。
  assert.match(sweepBody, /draftDirAgeMs\(dir, entry\.name, now\) < DRAFT_SWEEP_GRACE_MS/,
    '目录龄 < 清扫窗口的空未认领 draft 必须豁免（CV-291 口径：启动清掉一天前的空目录）')
  // CV-291：窗口 = 1 天（7 天 → 1 天，配套 ensureDraftDir 复用优先）。
  assert.match(PROJECTS, /const DRAFT_SWEEP_GRACE_MS = 24 \* 60 \* 60_000/,
    '清扫窗口必须是 1 天 —— 用户拍板「启动时把一天前的空目录清掉」')
  // 两处豁免必须发生在 rm 之前，否则写了也没用。
  const activeDraftAt = sweepBody.indexOf('resolve(this.activeDraft.dir)')
  const ageAt = sweepBody.indexOf('draftDirAgeMs(dir, entry.name, now)')
  const rmAt = sweepBody.indexOf('await rm(')
  assert.ok(activeDraftAt >= 0 && ageAt >= 0 && rmAt > activeDraftAt && rmAt > ageAt,
    '豁免分支必须在 rm 之前（顺序反了等于没豁免）')
  // 反向自证：清扫的原有两条判据仍在（别把整条规则改坏）。
  assert.match(sweepBody, /claimed\.has\(resolve\(dir\)\)/, '已认领目录仍须跳过')
  assert.match(sweepBody, /inner\.length > 0/, '非空目录仍须跳过')
})

test('CV-260：首个落点必须强制重绑（会话被踢出 membership 后短路救不回来）', () => {
  assert.match(INDEX, /let landedThisRun = false/,
    '必须有「本次运行已绑过落点」标记 —— 会话被宿主剔除后 cwd 只剩空串，'
    + '而落点会因 current.cwd === dir 短路不再重绑，必须让首个落点重跑一次')
  assert.match(INDEX, /if \(!force && landedThisRun\) \{/,
    '幂等短路必须带上 landedThisRun：首个落点不看短路，之后的订阅触发才走短路')
  assert.match(INDEX, /landedThisRun = true/, '绑定成功后必须置位（否则每次订阅都重绑）')
})

test('存储根变更：Host 落点缓存必须按 root 键控（E-3 漏绑定 → 落点永远旧根）', () => {
  // 病根（2026-10-04）：缓存只记目录不记 root，而 root 是 live provider
  //（设置页「资产库位置」可热切换）⇒ 切根后 ensureDraftDir 仍返回旧根路径 ⇒
  // 落点每次"重建"都重建回旧根 ⇒ 认领被归属校验 400 拒 ⇒ 用户「点发送没反应」。
  const HOST_INDEX = readSource('../src/index.ts')
  assert.match(PROJECTS, /private activeDraft: \{ root: string; dir: string \} \| undefined/,
    '落点缓存必须连铸造时的 root 一起记（只记目录 = 切根后失效不了）')
  assert.match(PROJECTS, /this\.activeDraft\.root === root/,
    '命中缓存前必须比对 root —— 否则「资产库位置」改了还返回旧根目录')
  assert.match(PROJECTS, /this\.activeDraft = \{ root, dir: candidate \}/, '铸造时必须把当时的 root 一起存下')
  assert.match(PROJECTS, /invalidateRootScoped\(\): void/, '必须提供按 root 失效入口（设置变更时调用）')
  // 认领成功后该目录已进 registry、不再是落点 —— 不清缓存会把首页又绑回它。
  const claimAt = PROJECTS.indexOf('async createClaimingDir')
  const ensureAt = PROJECTS.indexOf('async ensureDraftDir')
  assert.ok(claimAt !== -1 && ensureAt > claimAt)
  const claimBody = PROJECTS.slice(claimAt, ensureAt)
  assert.match(claimBody, /this\.activeDraft = undefined/, '认领成功后必须清掉落点缓存')
  // Host 接线顺序：必须在 registry 构造之后（attach 期就会回调，早接撞 TDZ）。
  const registryAt = HOST_INDEX.indexOf('new ProjectRegistry(')
  const watchAt = HOST_INDEX.indexOf('onStorageRootMaybeChanged')
  assert.ok(registryAt !== -1 && watchAt > registryAt,
    '资产库位置 watcher 必须在 registry 构造之后接线（否则 attach 期回调撞 TDZ）')
  assert.match(HOST_INDEX, /registry\.invalidateRootScoped\(\)/, 'Host 收到设置变更必须失效 root 缓存')
})

test('存储根变更：客户端必须重置列表 / 画布态并强制重建落点', () => {
  assert.match(STORE, /resetStorageScoped: \(draft: ProjectStoreState\) => void/, '必须提供换库清态 action')
  const resetAt = STORE.indexOf('resetStorageScoped: (draft) => {')
  assert.ok(resetAt !== -1, '换库清态 action 必须有实现')
  const resetBody = STORE.slice(resetAt, resetAt + 2000)
  for (const field of ['draft.nodes = {}', 'draft.views = {}', 'draft.workflows = {}', 'draft.hasConversation = {}']) {
    assert.ok(resetBody.includes(field), `换库必须清 ${field}（按旧根 projectId 索引的内存态）`)
  }
  assert.match(resetBody, /draft\.selectedProjectId = null/, '换库必须清选中（新根是另一套 projectId）')
  assert.match(resetBody, /draft\.homePinned = true/, '换库后应回首页（旧项目在新库不存在）')
  // 客户端订阅：客户端作用域只提供 subscribe（Host 侧才是 watch）。
  assert.match(INDEX, /brandScope\.subscribe\(onStorageSettingChanged\)/, '客户端必须订阅设置变更')
  assert.match(INDEX, /if \(snapshot\.status !== 'ready'\) return/,
    '首个就绪快照只记录不触发（loading → ready 的跳变不是用户改设置）')
  const resetFnAt = INDEX.indexOf('const resetForStorageRootChange')
  assert.ok(resetFnAt !== -1, '换库重置函数必须存在')
  const resetFnBody = INDEX.slice(resetFnAt, resetFnAt + 1600)
  assert.match(resetFnBody, /storeInstance\.actions\.resetStorageScoped\(\)/, '换库必须先清旧根内存态')
  assert.match(resetFnBody, /await refreshProjects\(\)/, '换库必须重拉新根项目列表')
  assert.match(resetFnBody, /await ensureDraftLanding\(true\)/,
    '换库必须强制重建落点 —— 否则会话仍指旧根，认领继续 400')
})

test('认领失败：按新根自愈重试一次 + 写进统一错误面（不许静默）', () => {
  const claimAt = INDEX.indexOf('const claimAndSend')
  const wrapperAt = INDEX.indexOf('conversation.sendSession = (')
  assert.ok(claimAt !== -1 && wrapperAt > claimAt)
  const claimBody = INDEX.slice(claimAt, wrapperAt)
  assert.match(claimBody, /if \(allowStorageRebuild\)/, '认领失败必须先尝试按新根重建落点（自愈路径）')
  assert.match(claimBody, /return once\(false\)/, '重建落点后必须用新 cwd 原地重试一次（且只许一次）')
  // 可见性：失败必须落进统一错误面（ProjectList 的 StudioErrorState），不能只写日志。
  const reportAt = INDEX.indexOf('const reportClaimFailure')
  assert.ok(reportAt !== -1 && reportAt < wrapperAt, '失败上报函数必须存在')
  assert.match(INDEX.slice(reportAt, wrapperAt), /storeInstance\.actions\.setFailed\(/,
    '认领失败必须写进统一错误面 —— 否则用户只看到「点了发送没反应」')
})
