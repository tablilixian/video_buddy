/**
 * P0-1 守卫：组件契约速查必须与源码同步。
 *
 * 与 manifest-fields-drift.test.mjs 同一套理由：手写文档会漂，模型就回去读源码。
 * 会话 18 的 56 次 bash 读 src/remotion/** 就是证据，而 SKILL.md 里那条
 * 「禁止读源码」的文本禁令并没有拦住它。
 *
 * 三条断言：① 生成物 === 现跑脚本输出；② 关键白名单真的被抽到（防脚本空转）；
 * ③ 反向变异：临时源多一个 Set 值，输出必须跟着变（证明是从源码抽的，不是硬编码）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { OUTPUT, SOURCES, renderComponentContract } from '../scripts/gen-component-contract.mjs'

test('组件契约速查与源码一致（改了白名单必须重跑 gen-component-contract.mjs）', () => {
  const generated = renderComponentContract()
  const onDisk = readFileSync(OUTPUT, 'utf8')
  assert.equal(
    onDisk,
    generated,
    '生成物与源码不一致 —— 跑 node scripts/gen-component-contract.mjs 后一起提交。'
    + '（文档一旦与源码脱钩，模型就回去 bash 读 src/remotion/**，会话 18 的 189.5KB 回灌就白省了。）',
  )
})

test('速查覆盖模型反复查源码的关键契约', () => {
  const text = readFileSync(OUTPUT, 'utf8')
  for (const anchor of [
    'TRACK_TYPES', 'SHAPES', 'EFFECTS', 'TRACK_FX', 'ORBIT_DIRECTIONS',
    'KNOWN_BASE_TRACK_KEYS', 'KNOWN_TRACK_KEYS.caption', 'KNOWN_TRACK_KEYS.chart',
    'REVEAL_DIRECTIONS', 'REVEAL_DEFAULT_DURATION_FRAMES', 'MAX_VOICE_OVER_CLIPS',
  ]) {
    assert.ok(text.includes(anchor), `缺白名单小节：${anchor}`)
  }
  // 会话 18 里模型反复读 Caption.tsx 确认的 words 透传、Chart.tsx 的 dataSource。
  assert.match(text, /KNOWN_TRACK_KEYS\.caption`:[^\n]*'words'/u)
  assert.match(text, /KNOWN_TRACK_KEYS\.chart`:[^\n]*'dataSource'/u)
  assert.match(text, /SHAPES`:[^\n]*'orbit'|SHAPES`:[^\n]*'path'/u)
  assert.ok(text.length > 4000, `生成物过小（${text.length} 字节），脚本可能没抽到东西`)
  assert.ok(SOURCES.length >= 6, '真源文件清单过窄')
})

test('反向变异：临时源多一个白名单值，生成结果必须跟着出现', () => {
  const fake = [
    "const DEMO_KINDS = new Set(['alpha', 'beta'])",
    'const DEMO_DEFAULT_FRAMES = 7',
    '',
  ].join('\n')
  const out = renderComponentContract({ [SOURCES[0]]: fake })
  assert.match(out, /DEMO_KINDS`: 'alpha' \| 'beta'/u)
  assert.match(out, /DEMO_DEFAULT_FRAMES` = 7/u)
  // 覆盖的是 manifest.ts，那份的真实白名单不应再出现在这一节里。
  assert.ok(!out.includes("`TRACK_TYPES`:"), '被替换的源不应仍产出真实白名单')
})
