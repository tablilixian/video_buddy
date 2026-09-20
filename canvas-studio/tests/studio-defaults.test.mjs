/**
 * CV-196 放手跑自动取值表（studio-defaults.ts）判定表 + 接线守卫。
 *
 * 这套断言来自一个**真实的空转事故**：审批门禁那半边早已落地（`approval-gate.ts`
 * 在 auto 下一律放行），但 `ask_user_choice` 完全不读 `workflow.mode` —— 放手跑下
 * 照样落一张点选卡片、然后阻塞到 `QUESTION_WAIT_MS`（10 分钟）才返回「请采用推荐项
 * 继续」。一轮流程里澄清提问 3~5 次 ⇒ 半小时到一小时空转，而画布上看起来一切正常
 * （用户在等 AI，AI 在等用户）。
 *
 * 所以本文件守三件事：
 *
 * 1. **优先级表逐格**（纯函数：项目预置 > 设置页 > 兜底，脏值不传播）；
 * 2. **判定与文案**（`autoAnswerFor` 在 confirm 下必须不管事，在 auto 下必须把规格
 *    与「不要再提问」一起交给模型）；
 * 3. **接线真的在**（`ask_user_choice` 里判定必须在**落挂起问题之前**、模式必须从
 *    路由一路透传到 registry）—— 「判定对了但没接 = 等于没做」是这个仓的成文教训。
 *
 * 运行：corepack yarn workspace canvas-studio run test:smoke
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  FALLBACK_ASPECT_RATIO,
  FALLBACK_RESOLUTION,
  FALLBACK_TARGET_DURATION,
  autoAnswerFor,
  describeStudioDefaults,
  recommendedOptionOf,
  resolveStudioDefaults,
} from '../lib/studio-defaults.js'
import { MAX_TARGET_DURATION, normalizeWorkflowMode, resolveSetModePatch } from '../lib/contracts/project.js'

/** 只剥块注释与整行注释（与 approval-gate.test 同一理由：叮嘱会长在注释里）。 */
function readSource(rel) {
  return readFileSync(new URL(rel, import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n')
}

// ── 一、优先级表 ────────────────────────────────────────────────────────────

test('优先级：项目预置 > 设置页 > 兜底（逐项独立生效）', () => {
  const defaults = resolveStudioDefaults({
    plan: { aspectRatio: '9:16', targetDuration: 60 },
    settings: { defaultAspectRatio: '1:1', defaultResolution: '2k' },
  })
  // 画幅：预置压过设置页
  assert.equal(defaults.aspectRatio, '9:16')
  assert.equal(defaults.aspectRatioSource, 'plan')
  // 时长：只有预置与兜底两层
  assert.equal(defaults.targetDuration, 60)
  assert.equal(defaults.targetDurationSource, 'plan')
  // 分辨率：plan 里没有这个字段，走设置页（不是「预置压过一切」的粗暴版）
  assert.equal(defaults.resolution, '2k')
  assert.equal(defaults.resolutionSource, 'settings')
  // 60s ÷ 10s/镜 = 6 镜
  assert.equal(defaults.shotCount, 6)
})

test('项目没预置画幅时落到设置页（两层能各自生效，不是全有或全无）', () => {
  const defaults = resolveStudioDefaults({
    plan: { targetDuration: 15 },
    settings: { defaultAspectRatio: '9:16' },
  })
  assert.equal(defaults.aspectRatio, '9:16')
  assert.equal(defaults.aspectRatioSource, 'settings')
  assert.equal(defaults.targetDuration, 15)
  assert.equal(defaults.targetDurationSource, 'plan')
})

test('什么都不知道时用兜底常量（16:9 / 30s / 768p，导出常量即真值）', () => {
  const defaults = resolveStudioDefaults()
  assert.equal(defaults.aspectRatio, FALLBACK_ASPECT_RATIO)
  assert.equal(defaults.targetDuration, FALLBACK_TARGET_DURATION)
  assert.equal(defaults.resolution, FALLBACK_RESOLUTION)
  assert.equal(defaults.aspectRatioSource, 'fallback')
  assert.equal(defaults.targetDurationSource, 'fallback')
  assert.equal(defaults.resolutionSource, 'fallback')
  assert.equal(defaults.shotCount, 3, '30s ÷ 10s/镜 = 3 镜')
})

test('脏值不传播：非法画幅 / 非法时长 / 非法档位一律回落，不写进规格', () => {
  const defaults = resolveStudioDefaults({
    plan: { aspectRatio: '4:3', targetDuration: -5 },
    settings: { defaultAspectRatio: 'junk', defaultResolution: '1080p' },
  })
  assert.equal(defaults.aspectRatio, FALLBACK_ASPECT_RATIO, '4:3 不是合法画幅（enum 只有三档）')
  assert.equal(defaults.targetDuration, FALLBACK_TARGET_DURATION, '负数时长必须丢弃')
  assert.equal(defaults.resolution, FALLBACK_RESOLUTION, '1080p 是 CV-187 已删除的旧档位，不许复活')
  assert.equal(defaults.aspectRatioSource, 'fallback')
  assert.equal(defaults.targetDurationSource, 'fallback')
  assert.equal(defaults.resolutionSource, 'fallback')
})

test('历史脏时长按上限夹取，不因脏输入撑爆分镜预算', () => {
  const defaults = resolveStudioDefaults({ plan: { targetDuration: 9999 } })
  assert.equal(defaults.targetDuration, MAX_TARGET_DURATION)
})

// ── 二、判定与文案 ──────────────────────────────────────────────────────────

test('规格文案必须带来源标记 —— 优先级表要真的送达模型，不能只是内部约定', () => {
  const text = describeStudioDefaults(resolveStudioDefaults({
    plan: { aspectRatio: '9:16' },
    settings: { defaultResolution: '2k' },
  }))
  assert.match(text, /画幅 9:16（项目预置）/u)
  assert.match(text, /目标时长 30s（兜底）/u)
  assert.match(text, /建议 3 镜/u)
  assert.match(text, /分辨率 2k（设置页）/u)
})

test('推荐项挑选：带「推荐」的优先，否则首项（超时兜底与放手跑共用这一份）', () => {
  assert.equal(recommendedOptionOf(['15s', '30s（推荐）']), '30s（推荐）')
  assert.equal(recommendedOptionOf(['15s', '30s']), '15s')
  assert.equal(recommendedOptionOf([]), undefined)
})

test('逐步确认不被接管：autoAnswerFor 必须返回 null（否则提问也会被静默吞掉）', () => {
  assert.equal(
    autoAnswerFor({
      mode: 'confirm',
      question: '时长？',
      options: ['15s', '30s（推荐）'],
      defaults: resolveStudioDefaults(),
    }),
    null,
  )
})

test('放手跑的自动应答：选项 + 锁定规格 + 「不要再提问」的明令，缺一样都会退化成瞎猜', () => {
  const text = autoAnswerFor({
    mode: 'auto',
    question: '总时长？',
    options: ['15s', '30s（推荐）'],
    defaults: resolveStudioDefaults({ plan: { targetDuration: 60 } }),
  })
  assert.ok(text !== null, 'auto 下必须给出答案，而不是回 null 去走提问路径')
  assert.match(text, /放手跑/u)
  assert.match(text, /「总时长？」/u, '要回显问题，模型才知道这个答案是替哪一问给的')
  assert.match(text, /「30s（推荐）」/u, '没有项目规格时，选项里的推荐项就是默认值')
  assert.match(text, /目标时长 60s（项目预置）/u, '项目预置必须一起回给模型 —— 它是硬约束')
  assert.match(text, /不要再向用户提出任何问题/u, '不写这句，模型下一轮还会再问一次')
})

test('选项里没有推荐项时不崩，也不返回空答案', () => {
  const text = autoAnswerFor({
    mode: 'auto',
    question: '主角性别？',
    options: ['女', '男'],
    defaults: resolveStudioDefaults(),
  })
  assert.ok(text !== null)
  assert.match(text, /「女」/u, '退回首项，而不是给一个空答案')
})

// ── 三、切换模式时的挂起问题 ────────────────────────────────────────────────

test('切到放手跑顺手清掉挂起问题 —— 不清就要白等 10 分钟', () => {
  const pending = { id: 'q1', question: '时长？', options: ['15s', '30s'] }
  assert.deepEqual(
    resolveSetModePatch({ mode: 'confirm', state: 'drafting', pendingQuestion: pending }, 'auto'),
    { mode: 'auto', pendingQuestion: null },
    '放手跑的定义是「不再需要用户参与」，挂着的卡片必须一起清掉',
  )
})

test('没有挂起问题时不许凭空写这个键（老记录的请求体形态保持不变）', () => {
  assert.deepEqual(
    resolveSetModePatch({ mode: 'confirm', state: 'drafting' }, 'auto'),
    { mode: 'auto' },
  )
  assert.deepEqual(
    resolveSetModePatch({ mode: 'confirm', state: 'awaiting_approval' }, 'auto'),
    { mode: 'auto', state: 'executing' },
  )
})

test('切回逐步确认不动 pendingQuestion —— 那是「回答问题」，不是「清空问题」', () => {
  const pending = { id: 'q1', question: '时长？', options: ['15s', '30s'] }
  assert.deepEqual(
    resolveSetModePatch({ mode: 'auto', state: 'executing', pendingQuestion: pending }, 'confirm'),
    { mode: 'confirm', state: 'drafting' },
  )
})

test('normalizeWorkflowMode：「没传」≠「传了 confirm」（否则设置页默认被架空）', () => {
  assert.equal(normalizeWorkflowMode(undefined), undefined)
  assert.equal(normalizeWorkflowMode(null), undefined)
  assert.equal(normalizeWorkflowMode('nope'), undefined)
  assert.equal(normalizeWorkflowMode('auto'), 'auto')
  assert.equal(normalizeWorkflowMode('confirm'), 'confirm')
})

// ── 四、接线守卫（判定对了但没接 = 等于没做）─────────────────────────────────

test('ask_user_choice：放手跑判定必须发生在「落挂起问题」之前', () => {
  const src = readSource('../src/host-tools.ts')
  const guardAt = src.indexOf('const autoAnswer = autoAnswerFor({')
  const returnAt = src.indexOf('if (autoAnswer !== null) return { text: autoAnswer }')
  const pendingAt = src.indexOf('await registry.setPendingQuestion(projectId, pending)')
  assert.ok(guardAt >= 0, 'ask_user_choice 必须调 autoAnswerFor（判定唯一源在 studio-defaults）')
  assert.ok(returnAt > guardAt, 'autoAnswerFor 的结果必须短路返回')
  assert.ok(
    pendingAt > returnAt,
    '短路必须写在落挂起问题之前 —— 写在后面，卡片已经弹出来了，用户还是会看到它',
  )
})

test('ask_user_choice：规格必须同时喂项目预置与设置页（只喂设置页 = 项目锁定规格被无视）', () => {
  const src = readSource('../src/host-tools.ts')
  assert.match(src, /plan: project\.plan/, '项目预置（plan）必须进 resolveStudioDefaults')
  assert.match(src, /defaultImageResolution: cfg\.defaultImageResolution\(\)/, '设置页图片档位必须进 resolveStudioDefaults')
  assert.match(src, /defaultVideoResolution: cfg\.defaultVideoResolution\(\)/, '设置页视频档位必须进 resolveStudioDefaults')
})

test('模式必须一路透传：弹窗 → api → 路由 → registry.create', () => {
  assert.match(
    readSource('../src/client/ProjectList.tsx'),
    /await onCreate\(name, createModalGroupId, buildPlan\(\), createMode\)/,
    '弹窗必须把选中的模式传给 onCreate —— 漏了就是「选了没用」',
  )
  assert.match(
    readSource('../src/client/api.ts'),
    /if \(mode !== undefined\) body\.mode = mode/,
    'api 必须把模式放进请求体',
  )
  assert.match(
    readSource('../src/routes.ts'),
    /const mode = normalizeWorkflowMode\(body\.mode\)/,
    '路由必须归一化 mode（脏值降级为「没传」，而不是兜成 confirm）',
  )
  assert.match(
    readSource('../src/routes.ts'),
    /registry\.create\(name, groupId, plan, mode\)/,
    '路由必须把 mode 交给 registry.create',
  )
  assert.match(
    readSource('../src/projects.ts'),
    /workflow: \{ mode: mode \?\? this\.defaultWorkflowMode\(\), state: 'drafting' \}/,
    'registry 必须让「创建时显式指定」压过设置页默认',
  )
})

test('设置页「默认执行模式」不再标「待接入」—— 它能改新项目的模式，文案不许说反', () => {
  // 这条是 CV-196 顺手捞到的真漂移：索引 R1 早已把它接进 registry.create，
  // 而设置页直到今天还写着「当前不影响运行」。文案骗人是次要的，要命的是
  // 它会让下一个人按「反正没接」去改这段代码。
  const src = readSource('../src/client/SettingsModal.tsx')
  assert.ok(!/默认执行模式[^\n]*csReserved/u.test(src), '该开关已接入，不能再挂「待接入」角标')
  assert.ok(!src.includes('当前不影响运行'), '「当前不影响运行」已不成立，必须删掉')
})
