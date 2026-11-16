/**
 * P1-2 守卫：**spec 全字段表必须与 content-spec.ts 同步**（REQ-038 R11 二轮）。
 *
 * 抓的是什么：真机二轮 34 次源码探查里 4 次在问 `SpecUnit` 的完整合法键
 * （`highlights` / `overlap` / `assetSlots`），因为 `content-spec.md` 是散文没有字段表，
 * 而 `SpecUnit` 的合法键只存在于 TS 类型里（编译后无运行时读取面）⇒ 手写必漂移。
 *
 * 四条断言：
 * 1. 磁盘上的生成物 === 现跑脚本的输出（漂移即红）。
 * 2. 关键字段在表里：SpecUnit 的 `cell` / `copy` / `highlights` / `overlap` / `assetSlots`、
 *    SpecCarry 的五个文字层字段（S-5）—— 这些正是真机上被反复 grep 的键。
 * 3. **反向变异**：注入一个临时源文件（interface 带标记字段）⇒ 生成物必须出现它
 *    （证明是 AST 抽取，不是硬编码清单）。
 * 4. 体积闸。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { renderSpecFields, OUTPUT } from '../scripts/gen-spec-fields.mjs'

test('spec 字段表与 content-spec.ts 一致（改了类型必须重跑 gen-spec-fields.mjs）', () => {
  assert.equal(
    readFileSync(OUTPUT, 'utf8'),
    renderSpecFields(),
    '生成物与源码不一致 —— 跑 `node scripts/gen-spec-fields.mjs` 后一起提交。',
  )
})

test('关键字段在表里：SpecUnit 的 cell/highlights/overlap/assetSlots + SpecCarry 的文字层五字段', () => {
  const text = readFileSync(OUTPUT, 'utf8')
  for (const key of ['cell', 'copy', 'highlights', 'overlap', 'assetSlots']) {
    assert.ok(text.includes(`\`${key}\``), `SpecUnit 关键字段 ${key} 不在字段表里（它是真机被 grep 的键）`)
  }
  for (const key of ['text', 'variant', 'textColor', 'background', 'letterSpacingEm']) {
    assert.ok(text.includes(`\`${key}\``), `SpecCarry 文字层字段 ${key} 不在字段表里（S-5 加的字段，漏了就是新假信息）`)
  }
})

test('反向变异：注入临时源文件（带标记字段的 interface）⇒ 生成物必须出现它', () => {
  const dir = mkdtempSync(join(tmpdir(), 'spec-fields-'))
  try {
    const source = join(dir, 'fake-content-spec.ts')
    writeFileSync(
      source,
      ['/** 探针接口（漂移闸反向变异用）。 */', 'export interface ProbeSpecUnit {', '  /** 标记字段：漂移闸探针。 */', '  driftProbeMarker?: string', '}', ''].join('\n'),
      'utf8',
    )
    const generated = renderSpecFields(source)
    assert.match(
      generated,
      /driftProbeMarker/,
      '临时源文件的字段没出现在生成物里 —— 抽取器坏了或被换成硬编码清单',
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('体积闸：字段表不得超过 14KB（spec 类型膨胀要有闸看着）', () => {
  const size = readFileSync(OUTPUT, 'utf8').length
  assert.ok(size < 14_000, `生成物 ${size} 字符 —— 超闸说明 content-spec.ts 的类型面失控`)
})
