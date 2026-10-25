/**
 * DD-09 审批门禁（approval-gate.ts）判定表 + 接线守卫。
 *
 * 这套断言来自一次**真实事故**，不是假想：
 *
 * 会话转录（2026-09-14）显示 `submit_storyboard_for_approval` 在 14:25:46 提交、
 * 用户 14:29:44 才点批准 —— 这 3 分 58 秒里 agent 加载了 h3-prompt-writing、读了
 * 分册、跑了 2 次 `image_generate` 定妆照、建了 `character_sheet` 资产卡。原因是
 * 老门禁 `GATED_TOOLS` 只列了 video_generate / video_composite，而最贵的「逐镜
 * 出图」和「建资产卡」压根不在表内。
 *
 * 所以本文件守两件事：
 *
 * 1. **判定表逐格**（纯函数，`approval-gate.ts` 是唯一实现）；
 * 2. **接线真的在**（`host-tools.ts` 里每个产出类工具入口都调了它）——
 *    这是最容易静默失效的一环：判定对了但忘了接，行为与「没做」完全一样。
 *
 * 运行：corepack yarn workspace canvas-studio run test:smoke
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { approvalGateMessage } from '../lib/approval-gate.js'

/** 测试里的审阅态（REQ-022 后只剩关键帧一个；与 workflow-stage 的 APPROVAL_STATES 同一集合）。 */
const REVIEW = ['keyframe_review']

/**
 * 需要「分镜已获批」才能动的正式产线动作。
 *
 * 刻意在测试里**重抄一遍**而不是从源码导出：这张表是产品约束（「哪些动作算
 * 产线」），测试要能独立地说出「我认为该拦的是这些」。若实现漏掉一个，这里会红。
 */
const FORMAL = [
  'video_generate',
  'video_composite',
  'compose_video',
  'extract_last_frame',
  'qc_shot',
  'music_generation',
  'render_composition',
]

/**
 * Look 阶段的产出（storyboarding 下合法，审阅态下同样要拦）。
 *
 * `character_sheet` 于 2026-10-22 从 FORMAL 移到此处：定妆照 / 样张由模型按片型
 * **自主决定**做不做，落地前不拦（它出的是角色四视图，属澄清期的视觉确认，不是
 * 分镜产物）；但关键帧审阅期仍属「产出新东西」，照旧拦。
 */
const LOOK_PRODUCING = ['image_generate', 'image_generate_withtxt', 'character_generate', 'character_sheet']

/**
 * FORMAL 里**不走 `runGeneration`** 的那六个：它们各自的 `execute()` 直接干活，
 * 所以门禁必须逐个显式调用（事故里 `character_sheet` 正是这样漏掉的）。
 */
const DIRECT = ['character_sheet', 'extract_last_frame', 'qc_shot', 'music_generation', 'compose_video', 'render_composition']

/** 只管产出 —— 写作 / 提交 / 只读类在任何状态下都必须放行。 */
const NEVER_GATED = [
  'write_storyboard',
  'write_script',
  'submit_keyframes_for_approval',
  'look_card',
  'list_shots',
  'list_references',
  'ask_user_choice',
  'upload_image',
  'image2vl',
]

const gate = (tool, state, { mode = 'confirm', shotBound = false } = {}) =>
  approvalGateMessage({ tool, mode, state, shotBound })

test('放手跑模式（auto）一律放行 —— 用户已授权一路跑完', () => {
  for (const state of [...REVIEW, 'storyboarding', 'executing']) {
    for (const tool of [...FORMAL, ...LOOK_PRODUCING]) {
      assert.equal(gate(tool, state, { mode: 'auto' }), null, `${tool} @ ${state} 在 auto 下应放行`)
    }
  }
})

test('executing 一律放行 —— 分镜已获批，产线开着', () => {
  for (const tool of [...FORMAL, ...LOOK_PRODUCING]) {
    assert.equal(gate(tool, 'executing'), null, `${tool} @ executing 应放行`)
  }
})

test('审阅态拦住全部产出类动作（含 Look 样张 —— 等待期不该出任何新东西）', () => {
  for (const state of REVIEW) {
    for (const tool of [...FORMAL, ...LOOK_PRODUCING]) {
      assert.ok(gate(tool, state) !== null, `${tool} @ ${state} 必须被拦`)
    }
  }
})

test('审阅态放行写作 / 提交 / 只读类 —— 否则驳回后流程会卡死', () => {
  // 驳回后用户可能直接在对话里给意见而**不点**驳回按钮，state 仍停在审阅态。
  // 这时 agent 必须能改写剧本/分镜并重新提交，否则永远出不去。
  for (const state of REVIEW) {
    for (const tool of NEVER_GATED) {
      assert.equal(gate(tool, state), null, `${tool} @ ${state} 必须放行`)
    }
  }
})

test('storyboarding：产线工具已迁到 storyboard-gate（本模块不再拦，防两套判据并存）', () => {
  // 故事板强约束 L1（2026-10-25）：`mode !== 'confirm' → 放行` 这条旧判据让 auto 模式
  // 全放行，是本批要根治的病灶。产线工具的拦截整体迁到 `storyboard-gate.ts`（只认 landed），
  // 覆盖见 tests/storyboard-gate.test.mjs 的 ②③（9 工具 × confirm/auto）。
  // 本用例留在原处的价值：一旦有人把这行判定加回来，就会变红 —— 两处判据并存必然分叉。
  for (const tool of FORMAL) {
    assert.equal(gate(tool, 'storyboarding'), null,
      `${tool} 的「未落地」拦截已迁到 storyboard-gate.ts；本模块不许再拦一份`)
  }
})

test('storyboarding：绑了分镜的出图拦，没绑的放行（Look 阶段就得能出样张 / 定妆照）', () => {
  for (const tool of LOOK_PRODUCING) {
    if (tool === 'character_sheet') continue // 不走 shotRefs，另有专门用例
    assert.ok(gate(tool, 'storyboarding', { shotBound: true }) !== null, `${tool} 带 shotRefs 时必须被拦`)
    assert.equal(gate(tool, 'storyboarding', { shotBound: false }), null, `${tool} 不带 shotRefs（Look 图）应放行`)
  }
})

test('拒因必须可操作：说清在等什么 + 明令不要重试', () => {
  for (const state of REVIEW) {
    const message = gate('image_generate', state)
    assert.ok(message !== undefined && message !== null)
    assert.ok(message.includes('等待'), `${state} 的拒因要说清在等什么`)
    assert.ok(message.includes('不要重试'), `${state} 的拒因必须明令不要重试`)
    assert.ok(!message.includes('image_generate 出概念图不受限'), '旧文案「image_generate 不受限」必须已删除')
  }
  // 产线工具的未落地拦截已迁到 storyboard-gate（CS-STORY-001 文案在那边），本模块只剩
  // 「绑镜出图」这一条旁路 —— 所以出路断言打在这条上。
  assert.ok(String(gate('image_generate', 'storyboarding', { shotBound: true })).includes('write_storyboard'),
    '未落地的拒因要给出路（write_storyboard）')
  // 2026-10-22 拍板：定妆照在落地前不拦（模型按片型自主决定），只在审阅态拦。
  assert.equal(gate('character_sheet', 'storyboarding'), null, '定妆照 / 角色卡落地前放行')
  assert.ok(gate('character_sheet', 'keyframe_review') !== null, '关键帧审阅期仍拦——等待期不该产出新东西')
})

test('六个直接 execute 的工具必须真的接了门禁（判定对了但没接 = 等于没做）', () => {
  for (const tool of DIRECT) {
    assert.ok([...FORMAL, ...LOOK_PRODUCING].includes(tool), `${tool} 不在任何一张表里——测试常量已经漂移`)
  }
  // 这六个工具不走 runGeneration，门禁要各自显式调用。事故里 character_sheet
  // 就是「既不在 GATED_TOOLS、又不走 runGeneration」的双重漏网。
  for (const tool of DIRECT) {
    assert.ok(
      readSource('../src/host-tools.ts').includes(`assertApprovalAllowed(registry, projectId, '${tool}'`),
      `${tool} 没有接门禁（assertApprovalAllowed）——审批期它就是一条后门`,
    )
  }
})

test('走 runGeneration 的生成工具：门禁在 runGeneration 里且用的是传入的 tool 名', () => {
  // video_generate / video_composite / image_generate / character_generate 都经
  // runGeneration，判定必须在**生成之前**（写在后面等于图已经出完了才拦）。
  // 2026-10-22：判据由调用方传入（`shotBound`），因为绑镜有两条通道 —— `shotRefs`
  // 与 shot id 形态的 `storyboardRef`，后者只能在调用点算（`isShotIdStoryboardRef`）。
  const src = readSource('../src/host-tools.ts')
  assert.match(
    src,
    /await assertApprovalAllowed\(registry, projectId, tool, shotBound\)/,
    'runGeneration 必须用传入的 tool 名 + shotBound 判据调门禁',
  )
  assert.match(
    src,
    /isShotIdStoryboardRef\(a\.storyboardRef\)/,
    'image_generate 必须把 shot id 形态的 storyboardRef 并入 shotBound——这条旁路就是 2026-10-22 事故',
  )
  const gateAt = src.indexOf('await assertApprovalAllowed(registry, projectId, tool,')
  const generateAt = src.indexOf('return generateAsset(registry, tool, projectId, params, signal)')
  assert.ok(gateAt >= 0 && generateAt > gateAt, '门禁必须在 generateAsset 之前——写在后面等于没拦')
})

test('门禁判定与出图分类同源：shotBound 是「逐镜关键帧 vs Look 图」的唯一判据', () => {
  // approval-gate 与 generate.operationTypeOf 若各写一份，迟早一个放行一个拦。
  // 这里钉住两边用的是同一个表达式。
  assert.match(
    readSource('../src/generate.ts'),
    /const shotBound = \(params\.shotNodeIds\?\.length \?\? 0\) > 0/,
    'generate.ts 的 shotBound 表达式被改动了——请同步 approval-gate 的调用点',
  )
})

test('老的单表门禁 GATED_TOOLS 已退休（两张表并存必然分叉）', () => {
  const src = readSource('../src/host-tools.ts')
  assert.ok(!/GATED_TOOLS/.test(src), 'GATED_TOOLS 应已删除，判定统一收口到 approval-gate.ts')
  assert.match(src, /import \{ approvalGateMessage \} from '\.\/approval-gate\.js'/, '必须从 approval-gate.ts 取判定')
})

/**
 * 只剥块注释与整行注释（与 visual-tokens 的 codeOnly 同一理由）：本文件里
 * 「不要接成 assertApprovalAllowed(...'character_sheet'...)」这类叮嘱会长在注释里，
 * 不剥注释的守卫会被一句正确的注释骗过 —— 然后被人删掉。
 */
function readSource(rel) {
  return readFileSync(new URL(rel, import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n')
}
