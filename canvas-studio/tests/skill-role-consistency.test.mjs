/**
 * `role` 字段与正文立场声明的**同口径门禁**（CV-324 收尾修正）。
 *
 * ## 背景：一条真实的自相矛盾
 *
 * CV-321b 把 11 个风格 skill 的工作流全部交出，改写后正文里都有一句让位声明：
 *
 * > 本 skill 只提供风格知识与该风格的特殊约束；流程、审批门禁与工具契约一律以
 * > `canvas-studio-creation` 为准。
 *
 * 但 CV-324 建 `platform.yaml` 时按**改造前**的形态把它们标成了 `role: decision`。
 * 于是同一个 skill 的两份文件对同一件事给出相反答案：
 * - 正文说「我只提供知识」，
 * - 元数据说「我是决策型」。
 *
 * 这正是 CV-317 建立的那一类失效（声明与现实漂移），只不过漂移到了展示元数据层。
 * 它没有任何既有测试看得见 —— 那些门禁只查字段**合法性**，不查字段说的**对不对**。
 *
 * ## 本门禁怎么工作
 *
 * `role` 不是自由标签，它**可以从正文反推**：
 * - 正文写了让位声明（「流程、审批门禁与工具契约一律以 … 为准」）→ 它已经不规定
 *   「怎么做」了 → 必须是 `knowledge`；
 * - 承担编排 / 产物落盘职责的（总纲、导演型、回归跑批）→ 必须是 `decision`。
 *
 * 两者对不上即红。这样新增 skill 时忘记想清楚自己在轴上的位置，会立刻被抓住，
 * 而不是等到两个下游（用户上传白名单、槽位互斥）按错误的元数据行动。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SKILLS = join(ROOT, 'skills')

/** `skills/` 下全部 skill 目录。 */
const ALL_SKILLS = readdirSync(SKILLS, { withFileTypes: true })
  .filter(e => e.isDirectory())
  .map(e => e.name)

/** 让位声明：出现即说明本 skill 已交出工作流，只能是知识型。 */
const YIELDS_WORKFLOW = '流程、审批门禁与工具契约一律以'

/** 承担编排 / 产物落盘职责的决策型。 */
const DECISION_TYPES = [
  'canvas-studio-creation', 'bible-story-director', 'action-scene-director', 'effect-test-runner',
]

const read = (name) => ({
  yaml: readFileSync(join(SKILLS, name, 'platform.yaml'), 'utf8'),
  body: readFileSync(join(SKILLS, name, 'SKILL.md'), 'utf8'),
})

const roleOf = (yaml) => /^role:\s*"?([a-z]+)"?\s*$/mu.exec(yaml)?.[1] ?? null
// 槽位名含数字（image-t2i），字符类必须带 0-9 —— 漏了会静默解析失败
const slotOf = (yaml) => /^slot:\s*"?([a-z0-9-]+)"?\s*$/mu.exec(yaml)?.[1] ?? null

test('CV-324：每个 skill 的 role / slot 字段可解析且取值合法', () => {
  const offenders = []
  for (const name of ALL_SKILLS) {
    const role = roleOf(read(name).yaml)
    const slot = slotOf(read(name).yaml)
    if (role === null || !['knowledge', 'decision'].includes(role)) {
      offenders.push(`${name}：role=${role ?? '缺失'} 不是合法取值（只能是 knowledge / decision）`)
    }
    if (slot === null) offenders.push(`${name}：slot 字段缺失或不可解析`)
  }
  assert.deepEqual(offenders, [], offenders.join('\n'))
})

test('CV-324：正文写了让位声明的 skill 必须是 knowledge（决策型自相矛盾直接红）', () => {
  const offenders = []
  for (const name of ALL_SKILLS) {
    const { yaml, body } = read(name)
    if (!body.includes(YIELDS_WORKFLOW)) continue
    const role = roleOf(yaml)
    if (role !== 'knowledge') {
      offenders.push(`${name}：正文声明「流程 / 审批门禁 / 工具契约一律以总纲为准」（已交出工作流），`
        + `但 platform.yaml 写 role: ${role}`)
    }
  }
  assert.deepEqual(
    offenders, [],
    '以下 skill 的正文与元数据对「自己在轴上的位置」说法相反 —— '
    + '正文说只提供知识、元数据说自己是决策型：\n' + offenders.join('\n'),
  )
})

test('CV-324：承担编排 / 产物落盘职责的 skill 必须标 decision', () => {
  const offenders = []
  for (const name of DECISION_TYPES) {
    const role = roleOf(read(name).yaml)
    if (role !== 'decision') offenders.push(`${name} 应为 decision，实为 ${role}`)
  }
  assert.deepEqual(offenders, [], offenders.join('\n'))
})

test('CV-324：orchestration 槽位只有总纲一个（决策型唯一的编排者）', () => {
  const orchestrators = ALL_SKILLS.filter(name => slotOf(read(name).yaml) === 'orchestration')
  assert.deepEqual(orchestrators, ['canvas-studio-creation'],
    `orchestration 槽位应只有总纲一个，实际：${orchestrators.join(', ')}`)
})
