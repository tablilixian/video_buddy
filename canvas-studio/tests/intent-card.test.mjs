/**
 * 一次性意图卡（confirm_intent_card）的 Host 侧行为闸。
 *
 * 守的是三件会被「顺手改坏」的事：
 * 1. confirm 模式必须真的弹卡 —— auto 判定若放宽，用户会被静默跳过核对；
 * 2. auto 模式必须把默认值 JSON 与「落便签」指令一起回给模型 —— 少了任一半，
 *    模型下一轮会再问一次（这正是 35 步的来源之一）；
 * 3. 生成侧措辞必须命中客户端窄条的摘取正则（与 question-result.test.mjs 成对）。
 *
 * 全部是行为断言：把实现里的任一半删掉都会变红，不检查「源码里有没有这行字」。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  AUTO_ANSWER_MARKER,
  AUTO_ANSWER_OPTION_PATTERN,
  autoIntentCardAnswerFor,
} from '../lib/studio-defaults.js'
import { normalizeWorkflow } from '../lib/contracts/project.js'

const FIELDS = [
  { key: 'duration', value: '45s', source: 'explicit' },
  { key: 'voice', value: '缺省女声', source: 'needsUser' },
  { key: 'audience', value: '泛科普观众', source: 'inferred' },
]

test('confirm 模式返回 null —— 必须真的弹卡，不许自动放行', () => {
  assert.equal(autoIntentCardAnswerFor({ mode: 'confirm', fields: FIELDS }), null)
})

test('auto 模式不等待用户：带标记、默认答案 JSON、并明确要求落便签后继续', () => {
  const text = autoIntentCardAnswerFor({ mode: 'auto', fields: FIELDS })
  assert.ok(text !== null)
  assert.ok(text.startsWith(AUTO_ANSWER_MARKER), '缺标记 ⇒ 客户端不会把卡片降级为窄条')
  assert.ok(text.includes('"duration":"45s"'), '默认值没回给模型 ⇒ 它下一轮只能再问一次')
  assert.ok(text.includes('"voice":"缺省女声"'))
  assert.ok(text.includes('write_note'), '没让模型落假设便签 ⇒ 意图不可追溯')
  assert.ok(text.includes('不要再向用户提出任何问题'), '没封堵再提问 ⇒ 轮次预算失效')
})

test('auto 文本命中客户端窄条的摘取正则（生成侧 / 消费侧成对）', () => {
  const text = autoIntentCardAnswerFor({ mode: 'auto', fields: FIELDS })
  const matched = AUTO_ANSWER_OPTION_PATTERN.exec(text ?? '')
  assert.ok(matched !== null, '改了措辞就摘不出默认值 —— 客户端窄条会显示空')
  assert.equal(matched[1], '全部采用默认假设')
})

test('字段为空时 auto 仍给出合法 JSON，不把 turn 带崩', () => {
  const text = autoIntentCardAnswerFor({ mode: 'auto', fields: [] })
  assert.ok(text !== null && text.includes('{}'))
})

test('normalizeWorkflow 透传意图卡字段（落盘后客户端才拿得到）', () => {
  const workflow = normalizeWorkflow({
    mode: 'confirm',
    pendingQuestion: {
      id: 'q1',
      question: '请核对',
      options: ['按卡片继续'],
      fields: [{ key: 'duration', label: '时长', value: '45s', source: 'explicit', reason: '用户原话' }],
    },
  })
  assert.equal(workflow.pendingQuestion.fields.length, 1)
  assert.deepEqual(workflow.pendingQuestion.fields[0], {
    key: 'duration', label: '时长', value: '45s', source: 'explicit', reason: '用户原话',
  })
})

test('脏字段宽松降级，不带崩工作流状态（历史/异常数据只影响新项目）', () => {
  const workflow = normalizeWorkflow({
    mode: 'confirm',
    pendingQuestion: { id: 'q2', question: 'x', options: [], fields: [null, 42, { key: 'k' }] },
  })
  assert.equal(workflow.pendingQuestion.fields.length, 3)
  assert.equal(workflow.pendingQuestion.fields[0].key, '')
  assert.equal(workflow.pendingQuestion.fields[2].source, 'inferred')
  assert.equal(workflow.pendingQuestion.fields[2].value, '')
})

test('普通单题点选不因意图卡改动多出 fields 字段', () => {
  const workflow = normalizeWorkflow({
    mode: 'confirm',
    pendingQuestion: { id: 'q3', question: 'x', options: ['A', 'B'], answer: 'A' },
  })
  assert.equal(workflow.pendingQuestion.fields, undefined)
  assert.equal(workflow.pendingQuestion.answer, 'A')
})
