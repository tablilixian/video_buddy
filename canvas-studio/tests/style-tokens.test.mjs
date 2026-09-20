/**
 * Look tokens（5 项风格 tokens）契约测试。
 *
 * 1. `LOOK_TOKEN_KEYS` / `LOOK_TOKENS_PROMPT`：字段集合与提示词格式固化。
 * 2. `INDUCIBLE_LOOK_TOKEN_KEYS` / `INDUCIBLE_LOOK_TOKENS_PROMPT`（CV-214）：
 *    VL 诱导子集（4 项，跳过「节奏」），提示词明文只用这 4 项。
 * 3. `parseLookTokens`：标准 5 行 / 序号与加粗前缀 / 同字段多行合并 / 非标签文本容错。
 * 4. `mergeLookTokens`：跨帧归并（同子句去重、异子句并列）/ 无有效字段返回 `''`/
 *    CV-214 「节奏」空 → 仅当至少一项 VL 字段有产出时才按 `DEFAULT_RHYTHM_TOKEN` 回填。
 * 5. **防漂移**：`references/look.md` 里内嵌的 image2vl 提示词原文与 `src/style-tokens.ts`
 *    逐字节一致（CV-214：实际内嵌的是 `INDUCIBLE_LOOK_TOKENS_PROMPT`，因为诱导用 4 行）。
 *
 * 运行：corepack yarn workspace canvas-studio run test:smoke
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  LOOK_TOKEN_KEYS,
  INDUCIBLE_LOOK_TOKEN_KEYS,
  INDUCIBLE_LOOK_TOKENS_PROMPT,
  DEFAULT_RHYTHM_TOKEN,
  LOOK_TOKENS_PROMPT,
  LOOK_ANALYST_SYSTEM_PROMPT,
  parseLookTokens,
  mergeLookTokens,
} from '../lib/style-tokens.js'

const LOOK_MD = new URL('../skills/canvas-studio-creation/references/look.md', import.meta.url)

test('LOOK_TOKEN_KEYS：固定 5 项、顺序不变', () => {
  assert.deepEqual(LOOK_TOKEN_KEYS, ['色彩', '光线', '材质', '镜头语汇', '节奏'])
})

test('INDUCIBLE_LOOK_TOKEN_KEYS：CV-214 VL 诱导子集 = 4 项（去除「节奏」）', () => {
  assert.deepEqual(
    [...INDUCIBLE_LOOK_TOKEN_KEYS],
    ['色彩', '光线', '材质', '镜头语汇'],
  )
  // 是 LOOK_TOKEN_KEYS 的真子集（顺序与母集一致）
  for (const key of INDUCIBLE_LOOK_TOKEN_KEYS) {
    assert.ok(LOOK_TOKEN_KEYS.includes(key), `${key} 应在 LOOK_TOKEN_KEYS 中`)
  }
  const inducibleAsStrings = Array.from(INDUCIBLE_LOOK_TOKEN_KEYS)
  assert.ok(!inducibleAsStrings.includes('节奏'), 'VL 诱导子集不含「节奏」')
})

test('LOOK_TOKENS_PROMPT：要求 5 行带标签输出（顺序与字段一致）', () => {
  const lines = LOOK_TOKENS_PROMPT.split('\n')
  assert.equal(lines.length, LOOK_TOKEN_KEYS.length + 1, '提示词应为「说明行 + 5 行字段」')
  LOOK_TOKEN_KEYS.forEach((key, i) => {
    assert.equal(lines[i + 1], `${key}：`, `第 ${i + 2} 行应是「${key}：」`)
  })
})

test('INDUCIBLE_LOOK_TOKENS_PROMPT：CV-214 VL 实际用 4 行（不含节奏）', () => {
  const lines = INDUCIBLE_LOOK_TOKENS_PROMPT.split('\n')
  // 说明行 + 4 行字段（节奏跳过）
  assert.equal(lines.length, INDUCIBLE_LOOK_TOKEN_KEYS.length + 1, '提示词应为「说明行 + 4 行字段」')
  // 必须明文标注「4 行」（防 CV-116 漂移）
  assert.match(INDUCIBLE_LOOK_TOKENS_PROMPT, /严格按下面 4 行/u)
  assert.doesNotMatch(INDUCIBLE_LOOK_TOKENS_PROMPT, /^节奏：$/mu, '诱导 prompt 不应含节奏行')
  INDUCIBLE_LOOK_TOKEN_KEYS.forEach((key, i) => {
    assert.equal(lines[i + 1], `${key}：`, `第 ${i + 2} 行应是「${key}：」`)
  })
  // 节奏默认值兜底常量的形状
  assert.match(DEFAULT_RHYTHM_TOKEN, /^节奏：/, 'DEFAULT_RHYTHM_TOKEN 应以「节奏：」开头')
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

test('mergeLookTokens（CV-214）：VL 给 4 项、缺节奏时自动回填默认节奏', () => {
  const merged = mergeLookTokens([
    '色彩：低饱和青灰 + 钨丝灯暖黄\n光线：单一实用光源\n材质：湿青砖\n镜头语汇：中长焦、浅景深',
  ])
  // 输出应含全部 5 行（最后一行是回填的默认节奏）
  assert.equal(merged, [
    '色彩：低饱和青灰 + 钨丝灯暖黄',
    '光线：单一实用光源',
    '材质：湿青砖',
    '镜头语汇：中长焦、浅景深',
    `节奏：${DEFAULT_RHYTHM_TOKEN.replace(/^节奏：/u, '')}`,
  ].join('\n'))
})

test('mergeLookTokens（CV-214）：VL 给了节奏时不覆盖（用户输入优先）', () => {
  const merged = mergeLookTokens([
    '色彩：暖黄\n节奏：慢、留白',
  ])
  assert.match(merged, /^节奏：慢、留白$/m, '用户给出的节奏应原样保留')
  assert.doesNotMatch(merged, /依题材习惯/, '不应回退到默认值')
})

test('mergeLookTokens（CV-214）：空输入时不回填节奏（仍走原降级）', () => {
  // 没有任何 VL 字段产出 → 即使节奏缺失也不回填（避免在没有归纳结果时硬塞默认值）
  assert.equal(mergeLookTokens([]), '')
})

test('防漂移：look.md 内嵌的 image2vl 提示词与 style-tokens.ts 逐字节一致', async () => {
  const md = await readFile(LOOK_MD, 'utf8')
  // CV-214：实际诱导 VL 用的是 INDUCIBLE 版，校验这版而非 5 行版
  assert.ok(
    md.includes(INDUCIBLE_LOOK_TOKENS_PROMPT),
    'look.md 必须内嵌 INDUCIBLE_LOOK_TOKENS_PROMPT 原文（CV-214 VL 用 4 行诱导）',
  )
  // 系统提示词仍逐字节一致
  assert.ok(md.includes(LOOK_ANALYST_SYSTEM_PROMPT), 'look.md 必须内嵌归纳系统提示词原文')
})
