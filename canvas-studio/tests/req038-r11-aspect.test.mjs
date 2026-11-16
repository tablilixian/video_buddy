/**
 * R11 · **输出画幅**（`scaffold_manifest({ specPath, aspect })`）。
 *
 * 病史（2026-11-16 真机需求）：spec 通道把 `width: 1920, height: 1080` 写死在
 * `scaffoldFromSpec` 里，而 `scaffold_manifest` 的 `aspect` 参数**只在非 spec 分支
 * 生效** —— 传 `9:16` 出去还是横屏，且**不报错**。竖屏片（小红书 / 抖音 / 快手）
 * 整条通道出不来，模型只会看到「画幅不对」的结果却查不到原因。
 *
 * 这组用例钉四件事：
 * ① `9:16` 真的出 1080×1920；② `1:1` 真的出 1080×1080；
 * ③ 缺省仍是 1920×1080（回归纪律：老调用逐字段不变）；
 * ④ 非法值**拒收** —— 不静默回退（静默回退正是这个 bug 的成因）。
 *
 * 定向跑：node --test tests/req038-r11-aspect.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { OUTPUT_ASPECT_SIZES, resolveOutputAspect, scaffoldFromSpec } from '../lib/host-tools-spec.js'
import { createStudioTools } from '../lib/host-tools.js'
import { ProjectRegistry } from '../lib/projects.js'

function writeSpec(body) {
  const dir = mkdtempSync(join(tmpdir(), 'r11-aspect-'))
  const file = join(dir, 'spec.json')
  writeFileSync(file, JSON.stringify(body, null, 2), 'utf8')
  return file
}

function threeScreenSpec() {
  return {
    meta: { title: '画幅验证', durationSec: 20, fps: 30, autoStages: true },
    sections: [
      { id: 's1', card: 'A1', copy: '量化基金 / 散户' },
      { id: 's2', card: 'B1', label: '量化基金', copy: '近1月:-0.26%; 近1年:+0.85%' },
      { id: 's3', card: 'A5', copy: '先问三件事' },
    ],
  }
}

/** 从回执里取出 manifest JSON 的画幅（模型也是从这段 JSON 抄的）。 */
function sizeOf(result) {
  const json = result.text.split('```json')[1].split('```')[0]
  const manifest = JSON.parse(json)
  return { width: manifest.meta.width, height: manifest.meta.height }
}

test('R11-aspect：9:16 出竖屏 1080×1920（竖屏片的前提）', () => {
  const file = writeSpec(threeScreenSpec())
  assert.deepEqual(sizeOf(scaffoldFromSpec({ specPath: file, aspect: '9:16' })), { width: 1080, height: 1920 })
})

test('R11-aspect：1:1 出方幅 1080×1080', () => {
  const file = writeSpec(threeScreenSpec())
  assert.deepEqual(sizeOf(scaffoldFromSpec({ specPath: file, aspect: '1:1' })), { width: 1080, height: 1080 })
})

test('R11-aspect：缺省仍是 1920×1080（老调用逐字段不变）', () => {
  const file = writeSpec(threeScreenSpec())
  assert.deepEqual(sizeOf(scaffoldFromSpec({ specPath: file })), { width: 1920, height: 1080 })
})

test('R11-aspect：非法画幅拒收，不静默回退', () => {
  const file = writeSpec(threeScreenSpec())
  assert.throws(
    () => scaffoldFromSpec({ specPath: file, aspect: '4:3' }),
    /aspect 只能是 16:9 \/ 9:16 \/ 1:1/,
    '非法值若回退成横屏，用户只会看到「画幅不对」却查不到原因',
  )
})

test('R11-aspect：画幅值域只有三档，且是宽高唯一出处', () => {
  assert.deepEqual(Object.keys(OUTPUT_ASPECT_SIZES).sort(), ['16:9', '1:1', '9:16'])
  assert.equal(resolveOutputAspect(undefined), '16:9')
  assert.equal(resolveOutputAspect('9:16'), '9:16')
  // 竖版与横版同面积（1080 档）—— 换画幅不该换来「一半的像素」
  const area = (size) => size.width * size.height
  assert.equal(area(OUTPUT_ASPECT_SIZES['9:16']), area(OUTPUT_ASPECT_SIZES['16:9']))
})

test('R11-aspect：scaffold_manifest 的 aspect 参数写明 specPath 分支也生效', () => {
  const tool = createStudioTools({}, 3000).find((entry) => entry.name === 'scaffold_manifest')
  assert.ok(tool, 'scaffold_manifest 必须注册')
  const described = String(tool.parameters?.properties?.aspect?.description ?? '')
  assert.match(described, /9:16/, '参数表要写明竖屏怎么传')
  assert.match(described, /specPath/, 'spec 分支此前静默忽略画幅，说明必须写清它同样生效')
})

test('R11-aspect：走工具入口传 9:16，回执的 manifest 就是竖屏（接线行为断言）', async () => {
  // 纯函数层通过不等于工具层通过 —— 这个 bug 的成因正是「工具层没把参数往下传」，
  // 所以必须从 execute 入口跑一遍，断言回执里的真实画幅。
  const root = mkdtempSync(join(tmpdir(), 'r11-aspect-reg-'))
  const registry = new ProjectRegistry(root)
  const project = await registry.create('竖屏项目')
  const file = writeSpec(threeScreenSpec())
  const tool = createStudioTools(registry, 3000).find((entry) => entry.name === 'scaffold_manifest')
  assert.ok(tool, 'scaffold_manifest 必须注册')
  const result = await tool.execute(
    { specPath: file, aspect: '9:16' },
    { agent: { session: { header: { cwd: project.dir } } } },
  )
  const text = typeof result === 'string' ? result : String(result.text ?? '')
  const manifest = JSON.parse(/```json([\s\S]*?)```/.exec(text)[1])
  assert.equal(manifest.meta.width, 1080, 'specPath 分支必须吃 aspect —— 静默忽略就是老 bug')
  assert.equal(manifest.meta.height, 1920)
})
