/**
 * 首页首句路由（`src/lobby-route.ts`）的**行为**断言。
 *
 * 为什么单独抽一个纯函数来测：2026-10-22 真机上「打完招呼还停在首页」复发两次，
 * 前两次修的都是 `sendSession` 里的 if，而守卫全是**源码字符串断言** —— 结构在、
 * 语义错，测试依然全绿。判据搬进纯函数后，这里直接跑真值表。
 *
 * 关键不变量（任何一条破了就等于「首句永远成不了项目」）：
 *   1. 会话 cwd 还没就位 → `undetermined`（调用方必须显式处置，不得静默放行）；
 *   2. cwd 属于某个项目 → `native`（项目内发送不能被误认领）；
 *   3. cwd 是首页落点 `.draft-*` 且不属于任何项目 → `claim`；
 *   4. 用户明确停在首页（homePinned）→ `claim`，即便 cwd 还指着老项目。
 */
import assert from 'node:assert/strict'
import test from 'node:test'

import { DRAFT_LANDING_PREFIX, cwdBelongsToProject, isDraftLandingDir, routeStudioSend } from '../lib/lobby-route.js'

const PROJECTS = ['/home/u/projects/星空', '/home/u/projects/城市夜景']
const DRAFT = '/home/u/projects/.draft-202610-22113327'

test('isDraftLandingDir：只认落点前缀，末尾分隔符与 Windows 分隔符等价', () => {
  assert.equal(DRAFT_LANDING_PREFIX, '.draft-')
  assert.equal(isDraftLandingDir(DRAFT), true)
  assert.equal(isDraftLandingDir(`${DRAFT}/assets`), false, '子目录不是落点本身')
  assert.equal(isDraftLandingDir('/home/u/projects/星空'), false)
  assert.equal(isDraftLandingDir('/home/u/projects/my.draft-x'), false, '前缀必须在目录名开头')
  assert.equal(isDraftLandingDir('C:\\u\\projects\\.draft-1'), true, 'Windows 路径同样识别')
  assert.equal(isDraftLandingDir(`${DRAFT}/`), true, '末尾分隔符不影响判定')
  assert.equal(isDraftLandingDir(undefined), false)
  assert.equal(isDraftLandingDir(''), false)
})

test('cwdBelongsToProject：精确相等或项目目录的**子路径**，不能按字符串前缀误命中', () => {
  assert.equal(cwdBelongsToProject('/home/u/projects/星空', PROJECTS), true)
  assert.equal(cwdBelongsToProject('/home/u/projects/星空/assets/img', PROJECTS), true)
  assert.equal(cwdBelongsToProject('/home/u/projects/星空/assets', PROJECTS), true)
  // 「星空2」不能因为以「星空」开头就被判成同一项目（真机上会放行到错误的项目）。
  assert.equal(cwdBelongsToProject('/home/u/projects/星空2', PROJECTS), false)
  assert.equal(cwdBelongsToProject(DRAFT, PROJECTS), false)
  assert.equal(cwdBelongsToProject('/home/u/projects', PROJECTS), false)
  assert.equal(cwdBelongsToProject('/home/u/projects/星空/', PROJECTS), true, '末尾分隔符不影响判定')
})

test('routeStudioSend：cwd 未就位 → undetermined（调用方不得静默放行）', () => {
  assert.equal(routeStudioSend({ homePinned: false, cwd: undefined, projectDirs: PROJECTS }), 'undetermined')
  assert.equal(routeStudioSend({ homePinned: true, cwd: undefined, projectDirs: PROJECTS }), 'undetermined')
  assert.equal(routeStudioSend({ homePinned: false, cwd: '', projectDirs: PROJECTS }), 'undetermined')
})

test('routeStudioSend：项目内发送 → native（含子目录）', () => {
  assert.equal(routeStudioSend({ homePinned: false, cwd: '/home/u/projects/星空', projectDirs: PROJECTS }), 'native')
  assert.equal(routeStudioSend({
    homePinned: false,
    cwd: '/home/u/projects/星空/assets',
    projectDirs: PROJECTS,
  }), 'native')
})

test('routeStudioSend：首页落点且不属于任何项目 → claim', () => {
  assert.equal(routeStudioSend({ homePinned: false, cwd: DRAFT, projectDirs: PROJECTS }), 'claim')
  // 项目列表快照为空（启动后第一次拉取还没回来）也必须认领 —— 这正是真机现场。
  assert.equal(routeStudioSend({ homePinned: false, cwd: DRAFT, projectDirs: [] }), 'claim')
})

test('routeStudioSend：首页意图优先（homePinned）—— 即便 cwd 还指着老项目也认领', () => {
  assert.equal(routeStudioSend({ homePinned: true, cwd: '/home/u/projects/星空', projectDirs: PROJECTS }), 'claim')
  assert.equal(routeStudioSend({ homePinned: true, cwd: DRAFT, projectDirs: PROJECTS }), 'claim')
})

test('routeStudioSend：既不属于项目也不是落点 → native（外部工作区不硬认领）', () => {
  assert.equal(routeStudioSend({ homePinned: false, cwd: '/home/u/Downloads', projectDirs: PROJECTS }), 'native')
})

test('routeStudioSend：落点目录一旦被登记成项目 → native（改名失败回退路径）', () => {
  // Host 改名失败时会**保留原 draft 路径**登记（projects.ts 的 rollbackRename），
  // 此时 cwd 与项目目录相等 ⇒ 属于项目，不能再认领一次（否则撞「目录已被占用」）。
  assert.equal(routeStudioSend({ homePinned: false, cwd: DRAFT, projectDirs: [...PROJECTS, DRAFT] }), 'native')
})
