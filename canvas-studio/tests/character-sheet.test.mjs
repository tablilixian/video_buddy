/**
 * CV-111：character_sheet 参考图失效自愈回归；CV-122：锚点=四视图拼图整图（不再切分）。
 *
 * 输入 filename 是 Drama temp/ 临时名，后端重启清存储后「名字还在、文件没了」
 * （实测报笼统 500 Internal Server Error）。character_sheet 是 runGeneration
 * （有 callWithFallback 自愈）之外唯一带图输入的生成入口，本文件验证补齐的
 * 同款自愈：按文件名反查画布节点 → 本地资产重传换新名 → 回写节点 → 重试；
 * 反查不中时保留原始错误。CV-122 起资产卡锚点 = 拼图整图单节点，不再切分
 * （`image2splitegrid` 端点与 storyboard_split 工具已于 2026-09-11 一并删除）。
 *
 * 直连 Host 侧编译产物 lib/generate.js；fetch 打桩避开真实 Drama Backend，
 * 本地资产读盘走临时目录。运行：corepack yarn workspace canvas-studio test:smoke
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { generateCharacterSheet } from '../lib/generate.js'
import { assetUploadBranch, resetAssetUploadStub, ASSET_HANDLE } from './helpers/asset-upload-stub.mjs'
import { generationDownloadBranch, minimalPng } from './helpers/generation-stub.mjs'

const SHEET_URL = 'https://media.example/sheet.png'

/** 业务 API 快照（迁移 B3-2）：image2character pending 帧 + succeeded 终帧（content = SHEET_URL 字节）。 */
const SHEET_PENDING = {
  id: 'cccccccc-cccc-4ccc-8ccc-000000000001', operation: 'image2character', status: 'queued', version: 1,
  progress: 0, billing_status: 'held', terminal: false, outputs: [], error: null,
}
const SHEET_DONE = {
  ...SHEET_PENDING, status: 'succeeded', version: 2, progress: 100, billing_status: 'held', terminal: true,
  result_status: 'ready',
  outputs: [{ ordinal: 0, type: 'image', mime_type: 'image/png', content_url: SHEET_URL, download_url: '/v1/generations/x/download/0' }],
}

/** character_sheet 专用打桩：image2character 首拍 500（temp 丢失）→ 重传后二拍成功。 */
function stubCharacterSheetFetch(sheetBytes = minimalPng(1376, 768)) {
  const calls = []
  globalThis.fetch = async (url, init = {}) => {
    const text = String(url)
    if (text.includes('/api/v1/health')) {
      return { ok: true, status: 200, json: async () => ({ status: 'ok' }), text: async () => '' }
    }
    calls.push({ url: text, body: init.body instanceof FormData ? '<form>' : init.body })
    const assetHandled = assetUploadBranch(text, init)
    if (assetHandled !== null) return assetHandled
    if (init.method === 'POST' && /\/v1\/generations(\?|$)/.test(text)) {
      // 迁移 B3-2：业务 API image2character（首拍 legacy 句柄失效 500；换句柄后二拍 202）。
      const body = JSON.parse(init.body)
      if (body.inputs?.[0]?.asset_id === 'dead.png') {
        return { ok: false, status: 500, text: async () => 'Internal Server Error' }
      }
      return { ok: true, status: 202, json: async () => SHEET_PENDING }
    }
    if (text.includes('/poll')) {
      return { ok: true, status: 200, json: async () => SHEET_DONE }
    }
    const handled = generationDownloadBranch(text, { contentBytes: sheetBytes })
    if (handled !== null) return handled
    if (text.includes('/content/')) {
      return { ok: true, status: 200, arrayBuffer: async () => sheetBytes }
    }
    return { ok: false, status: 404, text: async () => '' }
  }
  return calls
}

/** 项目注册表打桩：带 filename 的既有节点 + 记录写盘与资产卡。 */
function stubSheetRegistry(initialNodes, assetsDir) {
  const writes = []
  const assets = []
  return {
    list: async () => [{ id: 'p1', name: 'P1', dir: assetsDir, createdAt: 1 }],
    assetsDir: () => assetsDir,
    readCanvas: async () => ({ version: 3, nodes: initialNodes, assets: [] }),
    writeCanvas: async (projectId, nodes) => {
      writes.push(['writeCanvas', nodes.map((n) => n.id + ':' + (n.filename ?? '-'))])
    },
    appendCanvasNode: async (projectId, node) => { writes.push(['appendCanvasNode', node]) },
    releaseAssetNodes: async () => {},
    upsertAsset: async (projectId, asset) => { assets.push(asset) },
    getWrites: () => writes,
    getAssets: () => assets,
  }
}

function stubNode() {
  return {
    id: 'n1',
    kind: 'image',
    url: '/canvas-studio/assets/p1/local.png',
    filename: 'dead.png',
    x: 0, y: 0, width: 100, height: 100,
    createdAt: 1,
    origin: 'agent',
    sourceIds: [],
    operationType: 'text-to-image',
    generationPrompt: '{}',
  }
}

test('CV-111 character_sheet：输入 filename 后端失效（笼统 500）→ 本地资产重传换新名重试成功', async () => {
  resetAssetUploadStub()
  const dir = await mkdtemp(join(tmpdir(), 'cs-sheet-'))
  try {
    await writeFile(join(dir, 'local.png'), Buffer.from([1, 2, 3]))
    const calls = stubCharacterSheetFetch()
    const registry = stubSheetRegistry([stubNode()], dir)
    const result = await generateCharacterSheet(registry, 'p1', {
      filename: 'dead.png',
      assetName: '女主',
      lockedPrompt: 'SAME: 红裙短发',
    })
    // 二拍成功：拼图落画布 + 锚点 = 拼图整图单节点 + 返回 Drama filename。
    assert.ok(result.url.startsWith('/canvas-studio/assets/p1/'))
    assert.equal(result.filename, SHEET_PENDING.id, '迁移 B3-2：产物句柄 = generation id（新 API 无服务端文件名）')
    // CV-122：不再调 splitegrid 切分；资产卡锚点只有拼图节点。
    assert.ok(!calls.some((c) => c.url.includes('image2splitegrid')))
    assert.equal(registry.getAssets()[0].anchorNodeIds.length, 1)
    // 自愈链路发生：image2character 打了两拍，第二拍带重传新句柄（迁移 B2：asset_id）。
    const charCalls = calls.filter((c) => /\/v1\/generations(\?|$)/.test(c.url))
    assert.equal(charCalls.length, 2)
    assert.equal(JSON.parse(charCalls[0].body).inputs[0].asset_id, 'dead.png')
    assert.equal(JSON.parse(charCalls[1].body).inputs[0].asset_id, ASSET_HANDLE(1))
    assert.ok(calls.some((c) => c.url.includes('/v1/assets/presign')))
    // 节点 filename 回写为新名（不变式：节点 filename = 后端当前可用句柄）。
    const patched = registry.getWrites().find((w) => w[0] === 'writeCanvas')
    assert.ok(patched && patched[1].some((s) => s.startsWith(`n1:${ASSET_HANDLE(1)}`)))
    // 资产卡建立。
    assert.equal(registry.getAssets()[0].name, '女主')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('CV-229 character_sheet：拼图尺寸落盘即正确（实测 IHDR → 自然像素 + 分辨率）', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cs-sheet-'))
  try {
    // 造一段带 PNG magic + IHDR 的**结构合法**字节：后端四视图拼图实测 1808×1024。
    // （迁移 B3-3 后 runBusinessImage 校验 PNG 完整性，桩必须回真结构。）
    const sheet = minimalPng(1808, 1024)
    // 自愈链需要一个本地资产做重传源（与上面那条用例同一前提）。
    await writeFile(join(dir, 'local.png'), Buffer.from([1, 2, 3]))
    stubCharacterSheetFetch(new Uint8Array(sheet))
    const registry = stubSheetRegistry([stubNode()], dir)
    await generateCharacterSheet(registry, 'p1', {
      filename: 'dead.png',
      assetName: '女主',
      lockedPrompt: 'SAME: 红裙短发',
    })
    const appended = registry.getWrites().find((w) => w[0] === 'appendCanvasNode')?.[1]
    assert.ok(appended !== undefined, '拼图节点必须落盘')
    // 自然像素 + 镜头条 chrome；分辨率同时落盘（详情面板与角标不必再等媒体加载）。
    assert.equal(appended.width, 1808, 'CV-284：定妆照卡 = 真实像素（100% 视图 1:1）')
    assert.equal(appended.height, 1024 + 48, '1808×1024 → 画面 1024 + 48 chrome')
    assert.equal(appended.mediaWidth, 1808)
    assert.equal(appended.mediaHeight, 1024)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('CV-229→B3-3：非 PNG 产物在下载校验即拦截（CS-NET-012），不再落盘后回退占位尺寸', async () => {
  // 迁移 B3-3：runBusinessImage 下载后先走 PNG 结构校验——非 PNG 字节三次重试后
  // CS-NET-012 拦截，坏图根本不会落到画布（旧口径是落盘后 pngSizeOf 回退占位尺寸）。
  const dir = await mkdtemp(join(tmpdir(), 'cs-sheet-'))
  try {
    stubCharacterSheetFetch(new Uint8Array([7, 7, 7])) // 非 PNG 字节（模拟后台截断/坏流）
    const registry = stubSheetRegistry([stubNode()], dir)
    await assert.rejects(
      generateCharacterSheet(registry, 'p1', { filename: 'ok.png', assetName: '女主', lockedPrompt: 'SAME: 红裙短发' }),
      (err) => err.code === 'CS-NET-012',
    )
    assert.equal(registry.getWrites().find((w) => w[0] === 'appendCanvasNode'), undefined,
      '坏图不落画布（旧口径是回退占位尺寸落盘）')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('CV-111 character_sheet：画布上找不到对应本地资产 → 保留原始 500 错误', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cs-sheet-'))
  try {
    stubCharacterSheetFetch()
    const registry = stubSheetRegistry([], dir)
    await assert.rejects(
      generateCharacterSheet(registry, 'p1', { filename: 'dead.png', assetName: '女主', lockedPrompt: 'X' }),
      /HTTP 500/,
    )
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('CV-111 character_sheet：非参考图类错误（如 4xx 参数错）不触发重传，直接抛出', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cs-sheet-'))
  try {
    await writeFile(join(dir, 'local.png'), Buffer.from([1, 2, 3]))
    globalThis.fetch = async (url, init = {}) => {
      const text = String(url)
      if (text.includes('/api/v1/health')) {
        return { ok: true, status: 200, json: async () => ({ status: 'ok' }), text: async () => '' }
      }
      if (init.method === 'POST' && /\/v1\/generations(\?|$)/.test(text)) {
        return { ok: false, status: 400, text: async () => 'bad request' }
      }
      return { ok: false, status: 404, text: async () => '' }
    }
    const registry = stubSheetRegistry([stubNode()], dir)
    await assert.rejects(
      generateCharacterSheet(registry, 'p1', { filename: 'dead.png', assetName: '女主', lockedPrompt: 'X' }),
      /HTTP 400/,   // 新通道 parseApiError 回退文案（原 body 文本 'bad request' 不再进消息）
    )
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
