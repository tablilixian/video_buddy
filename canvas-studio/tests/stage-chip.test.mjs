/**
 * 制作阶段胶囊的判定契约（stage-chip.ts）。DD-09 / c 立项，CV-179 起胶囊从会话头
 * 撤到输入区读数带（`ProjectContextBar`）—— 判定层一行未改，只是显示位置变了，
 * 所以本文件的用例全部照旧。
 *
 * 这条判定决定**那个胶囊出不出现、显示第几段、是不是在等你拍板** ——
 * 每次渲染都在跑，而且出错的方式很刺眼（lobby 首屏凭空多一个「剧本 1/6」，
 * 或者在用户已经批准之后还挂着 gold 的「等你拍板」）。所以口径钉在纯函数上。
 *
 * 每个用例对应一条真实边界：
 *
 * 1. **未选项目 = 一个 DOM 都不出** —— 读数带靠空态折叠，但如果渲染出一个空壳，
 *    折叠不成立，整条带子会平白多出一道空白。所以「不显示」必须是 `null`。
 * 2. **阶段序号不重新推导** —— 复用 `deriveWorkflowStage`。本模块只把它翻译成
 *    胶囊的话，不许自己看 `workflow.state` 是不是某个 review 值（那是第二份判定）。
 * 3. **待批准 = 需要打断用户**，是胶囊变 gold 的唯一条件。
 * 4. 进度是**人读口径**（1 基），不是内部下标（0 基）—— 显示「剧本 0/6」会让人
 *    以为还没开始。
 * 5. `total` 与六段词表同源（`WORKFLOW_STAGE_COUNT`），词表加一段不该漏改这里。
 * 6. `produced` 是 tooltip 的读数：便签 / 手动导入素材不属于任何阶段，不计入。
 *
 * 运行：node --test tests/stage-chip.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { deriveStageChipView, modeShortLabel } from '../lib/stage-chip.js'
import { WORKFLOW_STAGE_COUNT, STAGE_FILM, STAGE_SCRIPT, STAGE_STORYBOARD } from '../lib/workflow-stage.js'

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
const look = () => node('look', { operationType: 'character-sheet' })
const keyframe = () => node('kf', { operationType: 'text-to-image' })
const shot = () => node('shot', { kind: 'video', toolName: 'video_generate', operationType: 'video-composite' })
const film = () => node('film', { kind: 'video', toolName: 'compose' })
const note = () => node('note', { kind: 'sticky' })
const imported = () => node('imp', { operationType: 'import' })

const wf = (state, mode = 'confirm') => ({ mode, state })

test('未选项目（workflow undefined）→ null：不占位，也不看画布', () => {
  assert.equal(deriveStageChipView(undefined, []), null)
  // 即使画布上已有成片（比如项目刚被删掉、store 还留着节点），只要没有选中项目就不出。
  assert.equal(deriveStageChipView(undefined, [brief(), film()]), null, '无项目时产物证据不得让它复活')
})

test('空画布 + drafting = 「剧本」第 1 段，且不在等批准', () => {
  const view = deriveStageChipView(wf('drafting'), [])
  assert.equal(view.stage, STAGE_SCRIPT)
  assert.equal(view.label, '剧本')
  assert.equal(view.index, 1)
  assert.equal(view.pending, false)
})

test('进度是人读口径（1 基，不是内部下标）', () => {
  const view = deriveStageChipView(wf('drafting'), [brief(), film()])
  assert.equal(view.stage, STAGE_FILM)
  assert.equal(view.index, 6, '第 5 段要显示成 6')
})

test('total 与六段词表同源（词表加一段不会漏改）', () => {
  const view = deriveStageChipView(wf('drafting'), [])
  assert.equal(view.total, WORKFLOW_STAGE_COUNT)
  assert.equal(view.total, 6)
})

test('待批准 → pending：三个 review 态都点亮，普通态不点', () => {
  for (const state of ['script_review', 'awaiting_approval', 'keyframe_review']) {
    assert.equal(deriveStageChipView(wf(state), []).pending, true, state)
  }
  for (const state of ['drafting', 'executing']) {
    assert.equal(deriveStageChipView(wf(state), []).pending, false, state)
  }
})

test('阶段判定是复用的，不是第二份：待批准不抢跑、证据压过状态', () => {
  // 与 workflow-stage 的既有语义逐条对齐 —— 若这里开始自算，先崩的就是这两条。
  assert.equal(deriveStageChipView(wf('script_review'), []).stage, STAGE_SCRIPT, '待批准 = 站在该段等')
  assert.equal(deriveStageChipView(wf('awaiting_approval'), []).stage, STAGE_STORYBOARD)
  assert.equal(deriveStageChipView(wf('drafting'), [brief(), film()]).stage, STAGE_FILM, '画布有片 = 事实')
})

test('produced 是各段产物之和，便签 / 手动导入不计入', () => {
  const full = deriveStageChipView(wf('executing'), [brief(), look(), keyframe(), shot(), film()])
  assert.equal(full.produced, 5)
  const noise = deriveStageChipView(wf('drafting'), [note(), imported()])
  assert.equal(noise.produced, 0, '便签与手动素材不属于任何阶段')
})

test('mode 短词与画布顶部按钮同一套词（放手跑 / 逐步确认）', () => {
  assert.equal(modeShortLabel('auto'), '放手跑')
  assert.equal(modeShortLabel('confirm'), '逐步确认')
  assert.equal(deriveStageChipView(wf('drafting', 'auto'), []).mode, 'auto')
})
