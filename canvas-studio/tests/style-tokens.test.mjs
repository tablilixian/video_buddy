/**
 * Look tokens（5 项风格 tokens）契约测试。
 *
 * 1. `LOOK_TOKEN_KEYS` / `LOOK_TOKENS_PROMPT`：字段集合与提示词格式固化。
 * 2. `parseLookTokens`：标准 5 行 / 序号与加粗前缀 / 同字段多行合并 / 非标签文本容错。
 * 3. `mergeLookTokens`：跨帧归并（同子句去重、异子句并列）/ 无有效字段返回 `''`。
 * 4. **防漂移**：`references/look.md` 里的 `image2vl` 提示词原文与 `src/style-tokens.ts`
 *    逐字节一致 —— CV-116 的教训（同一份内容写在多处，改一处漏一处）。
 *
 * 运行：corepack yarn workspace canvas-studio run test:smoke
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  LOOK_TOKEN_KEYS,
  LOOK_TOKENS_PROMPT,
  LOOK_ANALYST_SYSTEM_PROMPT,
  parseLookTokens,
  mergeLookTokens,
} from '../lib/style-tokens.js'

const LOOK_MD = new URL('../skills-local/canvas-studio-creation/references/look.md', import.meta.url)

test('LOOK_TOKEN_KEYS：固定 5 项、顺序不变', () => {
  assert.deepEqual(LOOK_TOKEN_KEYS, ['色彩', '光线', '材质', '镜头语汇', '节奏'])
})

test('LOOK_TOKENS_PROMPT：要求 5 行带标签输出（顺序与字段一致）', () => {
  const lines = LOOK_TOKENS_PROMPT.split('\n')
  assert.equal(lines.length, LOOK_TOKEN_KEYS.length + 1, '提示词应为「说明行 + 5 行字段」')
  LOOK_TOKEN_KEYS.forEach((key, i) => {
    assert.equal(lines[i + 1], `${key}：`, `第 ${i + 2} 行应是「${key}：」`)
  })
})

test('parseLookTokens：解析标准 5 行', () => {
  const parsed = parseLookTokens([
    '色彩：低饱和青灰 + 钨丝灯暖黄',
    '光线：单一实用光源，大光比',
    '材质：湿青砖、木质窗框',
    '镜头语汇：中长焦、浅景深、固定机位',
    '节奏：慢、留白、长镜头',
  ].join('\n'))
  assert.deepEqual(Object.keys(parsed).sort(), [...LOOK_TOKEN_KEYS].sort())
  assert.equal(parsed['色彩'], '低饱和青灰 + 钨丝灯暖黄')
  assert.equal(parsed['镜头语汇'], '中长焦、浅景深、固定机位')
  assert.equal(parsed['节奏'], '慢、留白、长镜头')
})

test('parseLookTokens：容忍序号/加粗/半角冒号，忽略非字段行与空值', () => {
  const parsed = parseLookTokens([
    '# 画面分析',
    '1. **色彩**：暖黄',
    '- 光线: 柔和',
    '补充说明：这不是字段，应被忽略',
    '节奏：',
  ].join('\n'))
  assert.deepEqual(parsed, { 色彩: '暖黄', 光线: '柔和' })
})

test('parseLookTokens：同一字段写多行时合并而不是覆盖（后者会静默丢信息）', () => {
  const parsed = parseLookTokens('色彩：暖黄\n色彩：低饱和')
  assert.equal(parsed['色彩'], '暖黄；低饱和')
})

test('parseLookTokens：自由要点文本（无标签）返回空对象，不猜', () => {
  assert.deepEqual(parseLookTokens('色调温暖；光线柔和\n画面很有电影感'), {})
  assert.deepEqual(parseLookTokens(''), {})
})

test('mergeLookTokens：跨帧归并 —— 同子句去重、异子句按帧序并列', () => {
  const merged = mergeLookTokens([
    '色彩：暖黄；低饱和\n光线：柔和\n材质：湿青砖',
    '色彩：暖黄；偏冷\n光线：柔和\n节奏：慢',
  ])
  assert.equal(merged, [
    '色彩：暖黄；低饱和；偏冷',
    '光线：柔和',
    '材质：湿青砖',
    '节奏：慢',
  ].join('\n'), '字段顺序必须遵循 LOOK_TOKEN_KEYS')
})

test('mergeLookTokens：单帧输入 = 原样输出（不引入额外加工）', () => {
  const one = LOOK_TOKEN_KEYS.map((key, i) => `${key}：值${i}`).join('\n')
  assert.equal(mergeLookTokens([one]), one)
})

test('mergeLookTokens：一份有效字段都没有 → 空串（调用方据此走降级）', () => {
  assert.equal(mergeLookTokens([]), '')
  assert.equal(mergeLookTokens(['画面很好', '一堆没有标签的话']), '')
})

test('防漂移：look.md 内嵌的 image2vl 提示词与 style-tokens.ts 逐字节一致', async () => {
  const md = await readFile(LOOK_MD, 'utf8')
  assert.ok(md.includes(LOOK_TOKENS_PROMPT), 'look.md 必须内嵌 LOOK_TOKENS_PROMPT 原文')
  assert.ok(md.includes(LOOK_ANALYST_SYSTEM_PROMPT), 'look.md 必须内嵌归纳系统提示词原文')
})
