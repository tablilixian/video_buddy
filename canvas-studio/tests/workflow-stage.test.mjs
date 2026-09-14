/**
 * C1 / DD-05 制作六阶段（workflow-stage.ts）契约测试。
 *
 * 这条规则决定「轨道说现在拍到第几步」+「点某一段会聚焦哪些卡片」，是**每次
 * 渲染都在跑**的判定，所以口径钉在纯函数上，不靠肉眼回归。
 *
 * 每个用例对应一条真实边界：
 *
 * 1. 「待批准」不抢跑 —— `script_review` 是站在剧本段等确认，不是已进分镜。
 *    把待批准误读成已完成会让轨道凭空前进一格，用户会以为 agent 抢跑了。
 * 2. **证据压过状态** —— state 是 agent 流程的副产物，会因重放/中断停在半路；
 *    「画布上已经有成片」是事实。只看 state 的轨道会在已经出片时说谎。
 * 3. **阶段只前进不后退** —— 删掉一张草稿不该让进度倒回，这是「进度」的语义。
 * 4. 剧本卡必须靠 `toolName` 判 —— 它的 `operationType` 是 `import`，与手动
 *    导入素材同值；靠 operationType 判会把每一张导入图都算成剧本。
 * 5. 视频一律算镜头 —— 不逐个列举视频 operationType（供应商换端点会漏）。
 * 6. 便签/文案/导入素材不属于任何阶段 —— 硬塞进某段会让轨道虚报进度。
 * 7. **审阅态不吃证据**（DD-09 修复）—— 用户在等一个决策时，「现在在哪」只能
 *    由正在审的那一项定义。实测矛盾：审批条写「剧本已提交，请批准」，同一屏的
 *    轨道却显示「关键帧」——因为 Look 样张（当时带 text-to-image）被算进关键帧，
 *    而样张 14:20 就出了、剧本 14:22 才写。
 * 8. **六段都可达**（DD-09 修复）—— 每一段都必须有真实生产者的产物能落进去。
 *    过去「分镜」「定妆」两段的键是死的：分镜卡是 text 节点被 `kind` 闸门拦下，
 *    定妆的两个键压根没有生产者 —— 格子永远是空的、永远点不动，用户读到的是
 *    「这一步没做过」。
 *
 * 运行：corepack yarn workspace canvas-studio run test:smoke
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  deriveWorkflowStage,
  stageOfNode,
  WORKFLOW_STAGE_LABELS,
  WORKFLOW_STAGE_COUNT,
  STAGE_SCRIPT,
  STAGE_STORYBOARD,
  STAGE_LOOK,
  STAGE_KEYFRAME,
  STAGE_SHOT,
  STAGE_FILM,
} from '../lib/workflow-stage.js'

function node(id, extra = {}) {
  return {
    id,
    kind: 'image',
    x: 0,
    y: 0,
    width: 260,
    height: 180,
    createdAt: 0,
    origin: 'agent',
    sourceIds: [],
    ...extra,
  }
}

const brief = () => node('brief', { kind: 'text', toolName: 'user_brief', operationType: 'import' })
/** 分镜卡：text 节点 + 提交分镜工具的 toolName（DD-09 起靠 toolName 判，不靠 operationType）。 */
const storyboardCard = () => node('sb', { kind: 'text', toolName: 'submit_storyboard_for_approval', operationType: 'storyboard' })
const look = () => node('look', { operationType: 'look' })
const keyframe = () => node('kf', { operationType: 'text-to-image' })
const shot = () => node('shot', { kind: 'video', toolName: 'video_generate', operationType: 'video-composite' })
const film = () => node('film', { kind: 'video', toolName: 'compose' })
const note = () => node('note', { kind: 'sticky' })
const imported = () => node('imp', { operationType: 'import' })

test('六段标签与设计稿一致', () => {
  assert.deepEqual([...WORKFLOW_STAGE_LABELS], ['剧本', '分镜', '定妆', '关键帧', '镜头', '成片'])
  assert.equal(WORKFLOW_STAGE_COUNT, 6)
})

test('空画布 + drafting = 第 0 段（剧本）', () => {
  const view = deriveWorkflowStage('drafting', [])
  assert.equal(view.stage, STAGE_SCRIPT)
  assert.equal(view.approvalPending, false)
})

test('「待批准」不抢跑：站在该段等确认，而不是已经进了下一段', () => {
  assert.equal(deriveWorkflowStage('script_review', []).stage, STAGE_SCRIPT)
  assert.equal(deriveWorkflowStage('awaiting_approval', []).stage, STAGE_STORYBOARD)
  assert.equal(deriveWorkflowStage('keyframe_review', []).stage, STAGE_KEYFRAME)
})

test('三个待批准态都算 approvalPending，其余不算', () => {
  for (const state of ['script_review', 'awaiting_approval', 'keyframe_review']) {
    assert.equal(deriveWorkflowStage(state, []).approvalPending, true, state)
  }
  for (const state of ['drafting', 'executing']) {
    assert.equal(deriveWorkflowStage(state, []).approvalPending, false, state)
  }
})

test('state 地板生效：executing 无产物也站在镜头段', () => {
  assert.equal(deriveWorkflowStage('executing', []).stage, STAGE_SHOT)
})

test('证据压过状态：drafting 但画布上已有成片 → 第 5 段', () => {
  assert.equal(deriveWorkflowStage('drafting', [brief(), film()]).stage, STAGE_FILM)
})

test('阶段只前进不后退：删掉关键帧，轨道仍停在成片', () => {
  // 用 executing（非审阅态）验单调性：审阅态按设计以「正在审的那一项」为准（见用例 7）。
  const full = deriveWorkflowStage('executing', [brief(), look(), keyframe(), shot(), film()])
  assert.equal(full.stage, STAGE_FILM)
  const withoutKeyframes = deriveWorkflowStage('executing', [brief(), look(), shot(), film()])
  assert.equal(withoutKeyframes.stage, STAGE_FILM, '删草稿不得让进度回退')
})

test('剧本卡靠 toolName 判，不靠 operationType（它的 operationType 是 import）', () => {
  assert.equal(stageOfNode(brief()), STAGE_SCRIPT)
  assert.equal(stageOfNode(imported()), null, '手动导入素材不得被算成剧本')
})

test('视频一律算镜头，不逐个列举端点（新供应商换端点不会漏）', () => {
  assert.equal(stageOfNode(node('v', { kind: 'video' })), STAGE_SHOT, '无 operationType 的视频也算镜头')
  assert.equal(stageOfNode(node('v2', { kind: 'video', operationType: '某个还没见过的新端点' })), STAGE_SHOT)
})

test('成片压在镜头之上（成片的 kind 也是 video）', () => {
  assert.equal(stageOfNode(film()), STAGE_FILM)
  assert.equal(stageOfNode(shot()), STAGE_SHOT)
})

test('便签 / 文案 / 导入素材不属于任何阶段', () => {
  assert.equal(stageOfNode(note()), null)
  assert.equal(stageOfNode(imported()), null)
  const view = deriveWorkflowStage('executing', [note(), imported()])
  assert.equal(view.stage, STAGE_SHOT, '地板仍在（executing），但不被这些节点推高')
})

test('未知 state 不炸，回落第 0 段', () => {
  assert.equal(deriveWorkflowStage(undefined, []).stage, STAGE_SCRIPT)
  assert.equal(deriveWorkflowStage('某个未来新增的状态', []).stage, STAGE_SCRIPT)
})

test('idsByStage 分桶：每段只装自己那段的产物', () => {
  const view = deriveWorkflowStage('executing', [
    brief(), look(), keyframe(), shot(), shot(), film(), note(),
  ])
  assert.deepEqual(view.idsByStage.map(bucket => bucket.length), [1, 0, 1, 1, 2, 1])
  assert.deepEqual([...view.idsByStage[STAGE_SHOT]], ['shot', 'shot'])
  assert.equal(view.idsByStage.length, WORKFLOW_STAGE_COUNT)
})

test('第二张剧本卡不会撑出第二段（分桶按阶段，不按节点数）', () => {
  const view = deriveWorkflowStage('drafting', [brief(), brief(), keyframe()])
  assert.equal(view.stage, STAGE_KEYFRAME)
  assert.equal(view.idsByStage[STAGE_SCRIPT].length, 2)
})

test('DD-09：六段都可达 —— 每段都要有真实生产者的产物能落进去（防死键）', () => {
  // 每条的形态都照抄真实生产者写节点的样子（host-tools.ts / generate.ts）：
  // 剧本卡 user_brief（text）、分镜卡 submit_storyboard_for_approval（text）、
  // Look 样张/定妆照 operationType='look'、逐镜关键帧 text-to-image、
  // 逐镜片段 kind=video 且非成片、成片 toolName='compose'。
  //
  // 这条守卫防的是**整段永远为空**这一类缺陷：键写在表里但没人写得出来，
  // 轨道上那一格就永远是灰的、点不动，而没有任何报错会提示。
  const samples = [
    [STAGE_SCRIPT, brief()],
    [STAGE_STORYBOARD, storyboardCard()],
    [STAGE_LOOK, look()],
    [STAGE_KEYFRAME, keyframe()],
    [STAGE_SHOT, shot()],
    [STAGE_FILM, film()],
  ]
  for (const [stage, sample] of samples) {
    assert.equal(stageOfNode(sample), stage, `「${WORKFLOW_STAGE_LABELS[stage]}」段不可达（键是死的）`)
    const view = deriveWorkflowStage('drafting', [sample])
    assert.ok(view.idsByStage[stage].includes(sample.id), `「${WORKFLOW_STAGE_LABELS[stage]}」段分桶丢了产物`)
  }
})

test('DD-09：分镜卡靠 toolName 判，不依赖 operationType（生产者写的是 text 节点）', () => {
  assert.equal(stageOfNode(storyboardCard()), STAGE_STORYBOARD)
  // 无 operationType 的分镜卡同样要落段 —— 过去正是靠 operationType 判，于是
  // text 节点被 kind 闸门拦下，16 张卡一张都没进「分镜」段。
  assert.equal(
    stageOfNode(node('sb2', { kind: 'text', toolName: 'submit_storyboard_for_approval' })),
    STAGE_STORYBOARD,
  )
  // 手工文本卡带同一个 operationType 不算制作产物（否则每张手写文本都成「分镜」）。
  assert.equal(stageOfNode(node('manual', { kind: 'text', operationType: 'storyboard' })), null)
})

test('DD-09：Look 阶段产物落「定妆」，不再冒充关键帧', () => {
  assert.equal(stageOfNode(node('lk', { operationType: 'look' })), STAGE_LOOK)
  assert.equal(stageOfNode(node('cs', { operationType: 'character-sheet' })), STAGE_LOOK)
  // 对照：真正的逐镜关键帧仍是 text-to-image → 关键帧段。
  assert.equal(stageOfNode(keyframe()), STAGE_KEYFRAME)
})

test('DD-09：审阅态不吃证据 —— 轨道必须与审批条说同一句话', () => {
  // 实测场景：样张/关键帧先落盘，剧本却还在等批准。审批条说「剧本待批准」，
  // 轨道若吃证据就会跳到「关键帧」，两个进度指示当着用户的面互相矛盾。
  const nodes = [brief(), storyboardCard(), look(), keyframe(), keyframe()]
  assert.equal(
    deriveWorkflowStage('awaiting_approval', nodes).stage,
    STAGE_STORYBOARD,
    '分镜待批准时轨道必须停在分镜段',
  )
  assert.equal(deriveWorkflowStage('script_review', nodes).stage, STAGE_SCRIPT, '剧本待批准时停在剧本段')
  // 证据不丢：点阶段照样能聚焦到已经产出的后续产物（不是把进度藏起来）。
  assert.equal(deriveWorkflowStage('awaiting_approval', nodes).idsByStage[STAGE_KEYFRAME].length, 2)
  // 非审阅态照常吃证据（审阅态例外不得泄漏到别的状态）。executing 的地板更高
  // （镜头段），所以取地板；drafting 地板最低，取证据。
  assert.equal(deriveWorkflowStage('executing', nodes).stage, STAGE_SHOT, 'executing 地板压过证据')
  assert.equal(deriveWorkflowStage('drafting', nodes).stage, STAGE_KEYFRAME, 'drafting 取证据')
})
