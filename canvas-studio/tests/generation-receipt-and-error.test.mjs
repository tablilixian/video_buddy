/**
 * 2026-11-23 真机 session-d2711915 复盘修复的回归守卫：
 *
 * ① L239 video_composite 把 CS-GEN-210（result_status=failed，产物归档失败）套成
 *    CS-GEN-206 + 过时「笼统 500 多半由音频/参考字段导致」——错误码失真且误导重试。
 *    修法：generate.ts 视频 catch 对 CanvasStudioError 原样透传。
 * ② L72 read_image not found：回执只给 /canvas-studio/assets/<projectId>/<file> 相对 URL，
 *    模型拼到 cwd 下多一层 projectId 目录。修法：主链路落盘处带 diskPath，回执透出绝对路径。
 *
 * 反向变异：把 `if (error instanceof CanvasStudioError) throw error` 注掉 ⇒ ①红；
 * 把 renderResult 的 disk 行删掉 ⇒ ②红。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createStudioTools } from '../lib/host-tools.js'
import { generateAsset } from '../lib/generate.js'
import { generationStub, minimalPng } from './helpers/generation-stub.mjs'
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const stubRegistry = { list: async () => [] }

function toolByName(name) {
  return createStudioTools(stubRegistry, 0).find((definition) => definition.name === name)
}

// ── ① 回执给绝对路径 ──────────────────────────────────────────────────────────

test('产物回执：diskPath 有值时给出绝对路径，且提示勿拼 url（A4/P1-6 复发）', () => {
  const render = toolByName('image_generate').output.render
  const abs = '/tmp/proj/assets/aaaaaaaa-bbbb-4ccc-8ddd-000000000001.png'
  const [block] = render({}, {
    url: '/canvas-studio/assets/p1/aaaaaaaa-bbbb-4ccc-8ddd-000000000001.png',
    diskPath: abs,
    width: 1376,
    height: 768,
  })
  assert.equal(block.type, 'text')
  assert.match(block.text, /本地路径: \/tmp\/proj\/assets\//)
  assert.match(block.text, /read_image \/ media_probe 用这个，勿拼 url/)
  assert.ok(block.text.includes(abs), `回执应逐字含绝对路径：${block.text}`)

  // 无 diskPath 的产物（旁路/老数据）退回旧文案，不能凭空造路径。
  const [fallback] = render({}, {
    url: '/canvas-studio/assets/p1/x.png', width: 32, height: 32,
  })
  assert.doesNotMatch(fallback.text, /本地路径/)
})

test('产物回执 schema：diskPath 是合法字段（不被 additionalProperties:false 拒收）', () => {
  const schema = toolByName('image_generate').output.schema
  assert.equal(schema.properties.diskPath.type, 'string')
})

// ── ② 主链路落盘带 diskPath ──────────────────────────────────────────────────

test('generateAsset 主链路：落盘后结果含 diskPath，指向真实存在的文件', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cs-diskpath-'))
  const projectId = 'p1'
  let canvas = { version: 1, nodes: [], assets: [] }
  const registry = {
    list: async () => [{ id: projectId, name: 'p', dir, createdAt: 1 }],
    assetsDir: () => join(dir, 'assets'),
    readCanvas: async () => canvas,
    writeCanvas: async (_id, next) => { canvas = next },
    appendCanvasNode: async (_id, node) => { canvas = { ...canvas, nodes: [...canvas.nodes, node] } },
    resolveFalApiKey: async () => '',
  }
  const PNG = minimalPng(8, 8)
  const gen = generationStub({ contentBytes: PNG })
  const prevFetch = globalThis.fetch
  globalThis.fetch = async (url, init = {}) => {
    if (String(url).includes('/api/v1/health')) {
      return { ok: true, status: 200, json: async () => ({ status: 'ok' }), text: async () => '' }
    }
    const handled = gen.branch(String(url), init)
    return handled ?? { ok: false, status: 404, json: async () => ({}), text: async () => '' }
  }
  try {
    const result = await generateAsset(registry, 'image_generate', projectId, { prompt: 'p', aspectRatio: '16:9' })
    assert.ok(result.diskPath, '主链路产物必须带 diskPath')
    assert.ok(result.diskPath.startsWith(join(dir, 'assets')), `diskPath 应在项目 assets 下：${result.diskPath}`)
    const { readFile } = await import('node:fs/promises')
    const bytes = await readFile(result.diskPath)
    assert.deepEqual([...bytes], [...PNG], 'diskPath 必须指向刚落盘的字节')
  } finally {
    globalThis.fetch = prevFetch
    await rm(dir, { recursive: true, force: true })
  }
})
