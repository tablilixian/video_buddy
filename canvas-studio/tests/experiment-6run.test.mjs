/**
 * 借鉴+翻拍 3v3 首句数据的接线/一致性闸。
 *
 * 这类改动最怕两件事：① 有人手改了 `src/experiment-6run.ts` 的常量，让它与操作包
 * 的判尺脱节；② G1 的锚包漏进 G0（或反之），实验的唯一变量当场失效。
 * 所以断言直接**回读操作包 §2/§3 的 text 块逐字比对**，不是「源码里有这行字」。
 *
 * 反向变异有效性：改常量里任一字符 / 调一个 GROUPS 顺序 / 删一句题目，本文件必红。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { experiment6Cases, EXPERIMENT_6RUN_ORDER, EXPERIMENT_6RUN_LABEL } from '../lib/experiment-6run.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const PACK = resolve(HERE, '../docs/demos/2026-11-08-真机实验操作包-可直接复制.md')

function firstSentences() {
  const md = readFileSync(PACK, 'utf8')
  const blocks = [...md.matchAll(/```text\n([\s\S]*?)\n```/g)].map(m => m[1])
  assert.ok(blocks.length >= 3, '操作包里至少要有 3 段 text 块（自检 / G1 / G0）')
  return { g1: blocks[1], g0: blocks[2] }
}

test('experiment-6run: 6 跑严格交替，X1 是阶段 A（G1）', () => {
  assert.equal(EXPERIMENT_6RUN_ORDER.length, 6)
  assert.deepEqual([...EXPERIMENT_6RUN_ORDER], ['G1', 'G0', 'G1', 'G0', 'G1', 'G0'])
  assert.match(EXPERIMENT_6RUN_LABEL, /3v3/)
  const cases = experiment6Cases()
  assert.equal(cases.length, 6)
  assert.deepEqual(cases.map(c => c.id), ['X1', 'X2', 'X3', 'X4', 'X5', 'X6'])
  assert.deepEqual(cases.map(c => c.group), [...EXPERIMENT_6RUN_ORDER])
})

test('experiment-6run: 首句与操作包 §2/§3 逐字一致（防手改常量脱节）', () => {
  const { g1, g0 } = firstSentences()
  const cases = experiment6Cases()
  for (const c of cases) {
    const expected = c.group === 'G1' ? g1 : g0
    assert.equal(c.prompt, expected, `${c.id}（${c.group}）首句与操作包不一致`)
  }
})

test('experiment-6run: 唯一变量成立 —— 锚包只在 G1，题目文本两组逐字相同', () => {
  const cases = experiment6Cases()
  const topic = '内容讲清楚三件事：光是电磁波'
  for (const c of cases) {
    assert.ok(c.prompt.includes(topic), `${c.id} 缺题目文本`)
    if (c.group === 'G1') assert.ok(c.prompt.includes('制作锚包'), `${c.id} 缺锚包`)
    else assert.ok(!c.prompt.includes('制作锚包'), `${c.id} 泄漏了锚包 ⇒ 唯一变量失效`)
    assert.ok(!c.prompt.includes('跑效果测试 '), `${c.id} 被包装成短句了，必须是首句原文`)
  }
  const g1Set = new Set(cases.filter(c => c.group === 'G1').map(c => c.prompt))
  const g0Set = new Set(cases.filter(c => c.group === 'G0').map(c => c.prompt))
  assert.equal(g1Set.size, 1, 'G1 三次必须用逐字相同的一份锚包')
  assert.equal(g0Set.size, 1, 'G0 三次必须用逐字相同的一份题目')
})

test('experiment-6run: 流程设置两组一致，且不含风格泄漏', () => {
  const cases = experiment6Cases()
  const settings = '【流程设置 · 与内容无关】'
  for (const c of cases) assert.ok(c.prompt.includes(settings), `${c.id} 缺流程设置`)
  const g0 = cases.find(c => c.group === 'G0')
  assert.ok(!g0.prompt.includes('满屏纯色'), 'G0 出现了风格描述，会污染对照组')
  assert.ok(!g0.prompt.includes('N1 不要'), 'G0 出现了判尺，会污染对照组')
})
