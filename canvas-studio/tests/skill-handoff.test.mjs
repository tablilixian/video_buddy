/**
 * `handoff` 交回契约最小门禁（六大体裁路线阶段 1.0，2026-11-04 拍板）。
 *
 * ## 背景
 *
 * 编排壳 / 导演型「做完交回总纲」此前只是 SKILL.md 措辞（如 explainer-format-director
 * 不做清单第 1 条「审批语义原样归 canvas-studio-creation」），没有任何机器约束——
 * 新增 decision 型 skill 忘了想清楚交回点，下游只能靠人肉记住。
 * `skill-orchestration-upgrade-plan-2026-10-23.md` §4.3 判据 1/3 把它变成机器约束。
 *
 * ## 本门禁的两级校验（拍板：最小门禁先行）
 *
 * 1. `role: decision` 且 `slot != orchestration` ⇒ `handoff` 必填且可解析；
 * 2. 非 `self` 的 `handoff`，`@` 前的 skill 必须真实存在（幽灵绑定直接红）。
 *
 * 判据 2/4（knowledge 不得声明 handoff / 目标必须是编排者或 decision 型）不在
 * 最小门禁范围，留待后续批次收紧。
 *
 * ## 语法（§4.3）
 *
 *     handoff: "<skill>@<stage>"   # 做到 stage 就交回指定 skill
 *     handoff: "self"              # 闭环执行，不回交（如 effect-test-runner）
 *
 * stage 词表（本门禁只要求可解析，不校验取值）：`storyboard`（拍摄定稿回流总纲）、
 * `render`（manifest 产物回流总纲渲染段）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SKILLS = join(ROOT, 'skills')

/** `skills/` 下全部 skill 目录（交回目标的唯一合法空间）。 */
const ALL_SKILLS = readdirSync(SKILLS, { withFileTypes: true })
  .filter(e => e.isDirectory())
  .map(e => e.name)

/** `handoff` 值语法：`self` 或 `<skill>@<stage>`（skill/stage 都是小写连字符词）。 */
const HANDOFF_RE = /^(?:self|([a-z0-9-]+)@([a-z0-9-]+))$/

const roleOf = (yaml) => /^role:\s*"?([a-z]+)"?\s*$/mu.exec(yaml)?.[1] ?? null
const slotOf = (yaml) => /^slot:\s*"?([a-z0-9-]+)"?\s*$/mu.exec(yaml)?.[1] ?? null
const handoffOf = (yaml) => /^handoff:\s*"?([^"\n]+)"?\s*$/mu.exec(yaml)?.[1] ?? null

const yamlOf = (name) => readFileSync(join(SKILLS, name, 'platform.yaml'), 'utf8')

test('handoff L1：decision 型非编排者必须声明可解析的 handoff', () => {
  const offenders = []
  for (const name of ALL_SKILLS) {
    const yaml = yamlOf(name)
    const role = roleOf(yaml)
    if (role !== 'decision') continue
    if (slotOf(yaml) === 'orchestration') continue
    const handoff = handoffOf(yaml)
    if (handoff === null || !HANDOFF_RE.test(handoff)) {
      const detail = handoff === null ? '缺失' : `「${handoff}」不可解析`
      offenders.push(
        `${name}：role=decision 且 slot!=orchestration，但 handoff ${detail}（合法形态："self" 或 "<skill>@<stage>"）`,
      )
    }
  }
  assert.deepEqual(offenders, [], offenders.join('\n'))
})

test('handoff L2：handoff 指向的 skill 必须存在（幽灵绑定直接红）', () => {
  const offenders = []
  for (const name of ALL_SKILLS) {
    const handoff = handoffOf(yamlOf(name))
    if (handoff === null || handoff === 'self') continue
    const parsed = HANDOFF_RE.exec(handoff)
    if (parsed === null) continue // L1 已报，不重复计
    const target = parsed[1]
    if (!ALL_SKILLS.includes(target) || !existsSync(join(SKILLS, target, 'platform.yaml'))) {
      offenders.push(`${name}：handoff 指向 "${target}"，但 skills/ 下不存在该 skill（幽灵绑定）`)
    }
  }
  assert.deepEqual(offenders, [], offenders.join('\n'))
})
