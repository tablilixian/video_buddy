/**
 * 阶段 2.1：视频 1:1 画幅放行（客户端三件套收口）。
 *
 * 范围：`VideoAspectRatio` union 加 `'1:1'`（providers/types.ts）+ generate 写路径
 * 钳制改 `normalizeVideoAspect`（历史脏值仍回落 16:9）+ drama 供应商放行直传并带
 * **联调前降级警告**（后台 1:1 联调就绪前可能静默降级——显式回流，不装生效）+
 * 两个视频工具 schema 与 NodeInputCard 视频 chips 同步。
 *
 * 图片端 1:1 早已放行（frames 表 `SQUARE_FRAME` / 图片工具 schema / 项目 plan /
 * 默认设置），本文件不重复锁。后台联调通过后：摘 drama 警告条 + 本文件对应断言。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const srcOf = (p) => readFileSync(join(ROOT, p), 'utf8')

test('2.1：normalizeVideoAspect 三档归一（脏值/缺省回落 16:9）', async () => {
  const { normalizeVideoAspect, isVideoAspectRatio, VIDEO_ASPECT_RATIOS } = await import('../lib/providers/types.js')
  assert.deepEqual([...VIDEO_ASPECT_RATIOS], ['16:9', '9:16', '1:1'])
  assert.equal(normalizeVideoAspect('16:9'), '16:9')
  assert.equal(normalizeVideoAspect('9:16'), '9:16')
  assert.equal(normalizeVideoAspect('1:1'), '1:1')
  assert.equal(normalizeVideoAspect(undefined), '16:9')
  assert.equal(normalizeVideoAspect('4:5'), '16:9')
  assert.equal(normalizeVideoAspect('garbage'), '16:9')
  assert.equal(isVideoAspectRatio('1:1'), true)
  assert.equal(isVideoAspectRatio('4:5'), false)
})

test('2.1：generate 写路径走 normalizeVideoAspect（不再写字面量两档钳制）', () => {
  const t = srcOf('src/generate.ts')
  assert.ok(t.includes('normalizeVideoAspect(params.aspectRatio)'), 'generate 写路径必须走唯一归一实现点')
  assert.ok(!t.includes("params.aspectRatio === '9:16' ? '9:16' : '16:9'"), '旧两档字面量钳制必须已退役')
})

test('2.1：drama 放行 1:1 直传并带联调前降级警告', () => {
  const t = srcOf('src/providers/drama.ts')
  assert.ok(t.includes("return normalizeVideoAspect(typeof ratio === 'string' ? ratio : undefined)"), 'dramaAspect 必须走唯一归一实现点')
  assert.ok(t.includes("if (aspect === '1:1')"), '1:1 警告分支缺失')
  assert.ok(t.includes('后台 1:1 联调就绪前可能被静默降级'), '降级警告文案缺失')
})

test('2.1：两个视频工具 schema 与 UI chips 同步三档', () => {
  const tools = srcOf('src/host-tools.ts')
  // 图片工具本就三档（3 处），故只锁：两档旧 enum 清零 + 视频联调降级描述恰 2 处。
  assert.ok(!tools.includes("enum: ['16:9', '9:16'],"), '视频两档旧 enum 必须清零（图片工具本就三档，不受影响）')
  const warnCount = (tools.match(/后台联调就绪前可能被静默降级/g) ?? []).length
  assert.equal(warnCount, 2, `视频工具 1:1 降级描述应恰 2 处（video_generate / video_composite），实测 ${warnCount}`)
  assert.ok(!tools.includes('视频只有横屏 16:9 与竖屏 9:16 两档'), '旧两档描述文案必须清零')
  const card = srcOf('src/client/canvas/NodeInputCard.tsx')
  assert.match(card, /const VIDEO_RATIOS = \[\s*\{ value: '16:9'[\s\S]*\{ value: '9:16'[\s\S]*\{ value: '1:1', label: '1:1 方幅' \}/, 'VIDEO_RATIOS 必须含 1:1 方幅')
})
