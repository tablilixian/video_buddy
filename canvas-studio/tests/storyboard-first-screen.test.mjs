/**
 * CV-302 首屏守卫：新建 / 打开项目时，「拍摄定稿」覆盖层必须与画布**同帧**出现。
 *
 * 原症状（用户实测）：从首页点「开始创作」→ 直接落到画布页面，过十几秒故事板
 * 才弹出来。根因是两层叠加，缺任一半症状都会以较弱的形式复发：
 *
 *   ① **状态没同拍落 store** —— claim（首页发首句）与 openProject（点项目行）时
 *      Host 早把 `workflow` 连项目记录一起给了客户端，客户端却只把它塞进
 *      projects 列表、没写 `store.workflows` ⇒ 覆盖层的自动可见性判不出来，
 *      只能干等 agent 首笔工具结算触发的 `refreshWorkflow`（十几秒）。
 *   ② **可见性是 effect 而不是派生** —— 即使状态就位，effect 也在 commit 之后跑，
 *      会漏出一帧裸画布；用户从首页切过来的那一帧正是最刺眼的。
 *
 * 本文件把这两件事钉死（源码字符串断言，照 `lobby-claim.test.mjs` 的范式）：
 * 判定对了但没接 = 等于没做。
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

const INDEX = readSource('../src/client/index.ts')
const FRAME = readSource('../src/client/StudioFrame.tsx')

test('CV-302 ①：claim（首页发首句）必须把 Host 给的 workflow 同拍写进 store', () => {
  // 唯一实现一份：claim 与 openProject 是两个互不相邻的 effect，只有提到共同
  // 外层作用域才共用（此前在 claim 的 effect 内定义，openProject 根本看不见）。
  assert.match(
    INDEX,
    /const adoptWorkflow = \(project: StudioProject\): void => \{[\s\S]*?setWorkflow\(project\.id, project\.workflow \?\? WORKFLOW_DEFAULT\)/,
    'adoptWorkflow 必须用项目记录里已有的 workflow（零请求、零猜想），缺失才回落 WORKFLOW_DEFAULT',
  )
  const claimAt = INDEX.indexOf('const claimAndSend')
  const wrapperAt = INDEX.indexOf('conversation.sendSession = (')
  assert.ok(claimAt !== -1 && wrapperAt > claimAt, 'claimAndSend 与其外层 wrapper 必须都还在')
  const claimBody = INDEX.slice(claimAt, wrapperAt)
  const selectAt = claimBody.indexOf('storeInstance.actions.select(project.id)')
  const adoptAt = claimBody.indexOf('adoptWorkflow(project)')
  assert.ok(selectAt !== -1, '认领成功必须先 select 新项目')
  assert.ok(adoptAt > selectAt, 'adoptWorkflow 必须在 select 之后立刻调用（同拍，不许排到后面）')
  // 「同拍」的可判定形式：两行之间不得出现 await —— 插一个 await 就让覆盖层
  // 又退回「晚一拍」，而这一拍正是用户看到空画布的那一拍。
  const between = claimBody.slice(selectAt, adoptAt)
  assert.ok(!/await/.test(between), 'select 与 adoptWorkflow 之间不得插 await（否则又是「先看到画布」）')
})

test('CV-302 ②：openProject（点项目行）同拍写入，refreshWorkflow 只作对账', () => {
  const openAt = INDEX.indexOf('const openProject = async (project: StudioProject)')
  assert.ok(openAt !== -1, 'openProject 必须存在')
  // 两处调用文本相同（都是 adoptWorkflow(project)），openProject 里那处是最后一个。
  const adoptAt = INDEX.lastIndexOf('adoptWorkflow(project)')
  assert.ok(adoptAt > openAt, 'openProject 也必须同拍 adopt —— 否则点项目行仍先看到空画布')
  // 对账请求必须排在同拍写入之后：顺序反了的话，慢返回的旧状态会盖掉刚写进去的值。
  const refreshAt = INDEX.indexOf('void refreshWorkflow(project.id)', openAt)
  assert.ok(refreshAt > adoptAt, 'refreshWorkflow 必须在 adoptWorkflow 之后（它现在只负责对账）')
})

test('CV-302 ③：覆盖层可见性必须**派生**，不许 effect 里 setState 打开', () => {
  assert.match(
    FRAME,
    /const storyboardAuto = projectId !== null\s*\n\s*&& workflow\?\.state === 'storyboarding'\s*\n\s*&& !storyboardDismissed\.has\(projectId\)/,
    '阶段一自动可见性必须是 (选中项目 × workflow.state × 是否被关过) 直接算出的值',
  )
  assert.match(FRAME, /const storyboardVisible = storyboardOpen \|\| storyboardAuto/,
    '最终可见性 = 手动打开的 ∪ 阶段一自动的')
  // 关过的记账必须是 state：ref 的写入不触发重渲染，派生式永远不会生效
  //（改完不报错、只是「关了还能自动弹回来」——静默失效最贵）。
  assert.ok(!/storyboardDismissedRef/.test(FRAME), 'storyboardDismissed 必须是 useState，不能再用 useRef')
  // 原来的自动打开 effect 以这个依赖数组为唯一特征；它必须消失。
  assert.ok(!/\[projectId, workflow\?\.state\]/.test(FRAME),
    '自动打开不许再用 effect —— commit 之后才跑，等于先漏一帧裸画布给用户')
  assert.match(FRAME, /\{projectId !== null && storyboardVisible && \(/, '渲染条件必须接上派生值')
})

test('CV-302 ④：落地（state → executing）后覆盖层必须自动让位给画布', () => {
  // 「等故事板彻底完成后才进画布」不额外写关闭逻辑：派生式里 state 一离开
  // storyboarding 就自动为假。这条守卫的意义是防止有人把它改成
  // 「只在 storyboarding 时打开、之后显式关闭」的两段式（会漏掉自动落地那条路）。
  const autoAt = FRAME.indexOf('const storyboardAuto =')
  assert.ok(autoAt !== -1)
  const autoBody = FRAME.slice(autoAt, autoAt + 400)
  assert.ok(!/executing/.test(autoBody),
    '派生式只认 storyboarding 一个正向条件（写成「不等于 executing」会把 keyframe_review 也放进来）')
})
