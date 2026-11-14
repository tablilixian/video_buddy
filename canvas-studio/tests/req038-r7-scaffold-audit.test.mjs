/**
 * REQ-038 R7-R8（A2+A3）· **scaffold 回执前置体检**单测。
 *
 * 三条纪律必须同时成立：
 * ① **渲染前可见** —— scaffold 回执带编译期编排体检（lintMotion）与文字容量预估
 *    （auditTextFit 估算口径）；模型不再等到渲染报告才发现溢出/遮挡告警；
 * ② **口径诚实** —— 两段都标注「预估 / 估算口径，渲染时以成片为准」；
 * ③ **干净 spec 零噪音** —— 39s 六屏样例（有 carry、双单元、文案合规）回执不得出现
 *    两段（防「预估」变成常驻噪音）；反向变异：摘掉接线，溢出/告警 spec 回执转哑。
 *
 * 直连 Host tsc 编译产物。定向跑：node --test tests/req038-r7-scaffold-audit.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { scaffoldFromSpec } from '../lib/host-tools-spec.js'

function writeSpec(body) {
  const dir = mkdtempSync(join(tmpdir(), 'r8-audit-'))
  const file = join(dir, 'spec.json')
  writeFileSync(file, JSON.stringify(body, null, 2), 'utf8')
  return file
}

test('溢出 spec：回执带「文字容量预估」段（估算口径标注 + 格位旋钮指引）', () => {
  const file = writeSpec({
    meta: { title: 'A3 溢出', durationSec: 12, fps: 30 },
    sections: [
      // 窄格位 + 长标题：A2 标题轨在 ~10% 宽的盒子里装 22 个字，估算口径必然溢出
      { id: 's1', copy: '超窄标题二十字的完整句子到底装不装得下呢', card: 'A2', cell: { x: 50, y: 50, w: 16, h: 24 } },
    ],
  })
  const result = scaffoldFromSpec({ specPath: file })
  assert.match(result.text, /文字容量预估/, '溢出 spec 必须在回执里看到容量预估')
  assert.match(result.text, /估算口径/)
  assert.match(result.text, /格位宽度就是字号旋钮/)
})

test('长片无常驻层：回执带「编排体检」段（ML-17 前置可见）', () => {
  const file = writeSpec({
    meta: { title: 'A2 体检', durationSec: 20, fps: 30 },
    sections: [
      // 4 段各 5s：段底板各占 25% < 30%，凑不出「常驻层」⇒ ML-17 如实触发
      { id: 's1', copy: '开场', card: 'A2' },
      { id: 's2', copy: '要点', card: 'A4' },
      { id: 's3', copy: '数据', card: 'B1' },
      { id: 's4', copy: '收尾', card: 'A5' },
    ],
  })
  const result = scaffoldFromSpec({ specPath: file })
  assert.match(result.text, /编排体检/, '渲染前必须看到 lint 预估段')
  assert.match(result.text, /ML-17/, '20s 无 carry 必触发 ML-17 且前置可见')
})

test('干净样例（39s 六屏带 carry 双单元）：两段都不出现（零噪音）', () => {
  // 直接用真渲过的样例资产（autoStages 6 屏、段数对齐、copy 语法合规）
  const spec = JSON.parse(readFileSync(new URL('../skills/code-driven-explainer/assets/screen-plan-example.json', import.meta.url), 'utf8'))
  const file = writeSpec(spec)
  const result = scaffoldFromSpec({ specPath: file })
  assert.doesNotMatch(result.text, /编排体检/, '干净 spec 不该有体检段（有告警才出现）')
  assert.doesNotMatch(result.text, /文字容量预估/, '干净 spec 不该有容量段')
  assert.match(result.text, /屏表/, '基础屏表仍在')
})

test('A1 e2e：重叠格位 spec 走 scaffold 被拒（编译期拦截，含出路文案）', () => {
  const file = writeSpec({
    meta: { title: '重叠', durationSec: 12, fps: 30 },
    sections: [{ id: 's1', copy: '一屏', units: [
      { card: 'A2', copy: '甲' },
      { card: 'B1', copy: '乙' },
    ] }],
  })
  assert.throws(() => scaffoldFromSpec({ specPath: file }), /相交 100%/, '共享全屏 = 100% 相交必须拒收')
})

test('A1 e2e：overlap: true 豁免的叠层 spec 正常出片', () => {
  const file = writeSpec({
    meta: { title: '刻意叠层', durationSec: 12, fps: 30 },
    sections: [{ id: 's1', copy: '一屏', units: [
      { card: 'A2', copy: '甲' },
      { card: 'B1', copy: '乙', overlap: true },
    ] }],
  })
  const result = scaffoldFromSpec({ specPath: file })
  assert.match(result.text, /屏表/, '豁免后正常出片')
})
