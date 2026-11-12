/**
 * REQ-038 批次 10 守卫：RQ-01 渲染回执协议（元数据从 URL query 迁到 body 帧格式）。
 *
 * 验收口径（需求正本 §3 RQ-01）：
 * 1. 回执体积不再受 Node header 上限约束 —— 200KB+ 元数据用例可组帧/拆帧往返
 *   （真实 431 复现需真机，此处验证协议层无损）；
 * 2. 老格式 body（裸 mp4）仍被正确接收（parseRenderCommitFrame 返回 null ⇒ 老判定）；
 * 3. 新帧往返逐字节无损（payload 与 metaJson 完整还原）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  buildRenderCommitFrame,
  isRenderCommitFrame,
  parseRenderCommitFrame,
  RENDER_COMMIT_MAGIC,
  RENDER_COMMIT_HEADER_BYTES,
  RENDER_COMMIT_META_MAX_BYTES,
} from '../lib/render-protocol.js'

const here = dirname(fileURLToPath(import.meta.url))

test('RQ-01：新帧组帧/拆帧往返逐字节无损（小元数据 + 小成片）', () => {
  const meta = JSON.stringify({ warnings: JSON.stringify(['a', 'b']), metrics: JSON.stringify({ frames: 1800 }) })
  const payload = Uint8Array.from([0, 1, 2, 250, 251, 255])
  const frame = buildRenderCommitFrame(meta, payload)
  assert.equal(frame.length, RENDER_COMMIT_HEADER_BYTES + meta.length + payload.length)
  const parsed = parseRenderCommitFrame(frame)
  assert.ok(parsed !== null)
  assert.equal(parsed.metaJson, meta)
  assert.deepEqual([...parsed.payload], [...payload])
})

test('RQ-01 验收1：200KB+ 元数据仍可无损往返（旧 query 通道在该体积必 431）', () => {
  // 构造 200KB 报告（textFit 60 条就 10KB+；这里是验收判据 3 的压力上界）。
  const bigReport = JSON.stringify({
    frames: 1800,
    textFit: Array.from({ length: 2000 }, (_, i) => ({
      id: `track-${i}`, variant: 'subtitle', fontPx: 42, baseFontPx: 42, maxLines: 3,
      lines: ['示例字幕行内容，用于撑起体积'], overflow: false, atMinFont: false, maxWidthPx: 1500,
    })),
  })
  assert.ok(bigReport.length > 200 * 1024, `构造的报告 ${bigReport.length}B 需 > 200KB`)
  const payload = Uint8Array.from([1, 2, 3])
  const frame = buildRenderCommitFrame(bigReport, payload)
  const parsed = parseRenderCommitFrame(frame)
  assert.ok(parsed !== null, '200KB+ 元数据必须成帧成功')
  assert.equal(parsed.metaJson, bigReport)
  assert.deepEqual([...parsed.payload], [...payload])
})

test('RQ-01 验收2：老格式（裸 mp4）不被误判成帧 —— 返回 null 走老判定', () => {
  // 真 mp4 头：ftyp box。
  const mp4 = Uint8Array.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 1, 2, 3])
  assert.equal(isRenderCommitFrame(mp4), false)
  assert.equal(parseRenderCommitFrame(mp4), null)
  // 短 body / 空 body 也走老格式。
  assert.equal(isRenderCommitFrame(new Uint8Array(0)), false)
  assert.equal(isRenderCommitFrame(new Uint8Array(11)), false, '不足 12B header = 老格式')
})

test('RQ-01：坏帧拒判（metaLen 超上限 / body 截断）→ null（回落老格式）', () => {
  const bad = new Uint8Array(RENDER_COMMIT_HEADER_BYTES + 4)
  // 写 magic 后把 metaLen 设为上限 + 1。
  const frame = buildRenderCommitFrame('{}', new Uint8Array(4))
  bad.set(frame.subarray(0, RENDER_COMMIT_HEADER_BYTES))
  bad[8] = (RENDER_COMMIT_META_MAX_BYTES + 1) & 0xff
  bad[9] = ((RENDER_COMMIT_META_MAX_BYTES + 1) >> 8) & 0xff
  bad[10] = ((RENDER_COMMIT_META_MAX_BYTES + 1) >> 16) & 0xff
  bad[11] = ((RENDER_COMMIT_META_MAX_BYTES + 1) >> 24) & 0xff
  assert.equal(parseRenderCommitFrame(bad), null, 'metaLen 越界 = 坏帧')
  const truncated = frame.subarray(0, RENDER_COMMIT_HEADER_BYTES + 1)
  assert.equal(parseRenderCommitFrame(truncated), null, '截断 body = 坏帧')
})

test('RQ-01 ★接线：客户端不再把元数据塞 query；服务端按帧拆包并保留 query 兼容', () => {
  const api = readFileSync(join(here, '../src/client/api.ts'), 'utf8')
  const routes = readFileSync(join(here, '../src/routes.ts'), 'utf8')
  // 客户端：commitStudioRenderJob 里不许再有 query.set('warnings'/'metrics')。
  const commitFn = api.slice(api.indexOf('export async function commitStudioRenderJob'), api.indexOf('uploadStudioRenderSample'))
  assert.ok(!commitFn.includes("query.set('warnings'"), '元数据不许再进 URL（431 根因）')
  assert.ok(!commitFn.includes("query.set('metrics'"), '元数据不许再进 URL（431 根因）')
  assert.ok(commitFn.includes('buildRenderCommitFrame'), '有元数据必须组帧')
  // 服务端：帧解析 + 老格式回落 + query 兼容三路都在。
  assert.ok(routes.includes('parseRenderCommitFrame(bodyBytes)'), '服务端必须按帧拆包')
  assert.ok(routes.includes("requestUrl.searchParams.get('warnings')"), 'query 兼容必须保留（旧客户端）')
})

test('RQ-01：组帧超上限抛错（防御上界生效）', () => {
  const huge = 'x'.repeat(RENDER_COMMIT_META_MAX_BYTES + 1)
  let caught = null
  try {
    buildRenderCommitFrame(huge, new Uint8Array(1))
  } catch (error) {
    caught = error
  }
  assert.ok(caught !== null, '超上限必须抛')
  assert.equal(caught.code, 'CS-DEV-ERR')
  assert.match(String(caught.devMessage), /超过/)
})
