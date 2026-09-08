/**
 * CV-111：character_sheet 参考图失效自愈回归。
 *
 * 输入 filename 是 Drama temp/ 临时名，后端重启清存储后「名字还在、文件没了」
 * （实测报笼统 500 Internal Server Error）。character_sheet 是 runGeneration
 * （有 callWithFallback 自愈）之外唯一带图输入的生成入口，本文件验证补齐的
 * 同款自愈：按文件名反查画布节点 → 本地资产重传换新名 → 回写节点 → 重试；
 * 反查不中时保留原始错误。
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

const SHEET_URL = 'https://media.example/sheet.png'
const PIECE_URL = 'https://media.example/piece.png'

/** character_sheet 专用打桩：image2character 首拍 500（temp 丢失）→ 重传后二拍成功。 */
function stubCharacterSheetFetch() {
  const calls = []
  globalThis.fetch = async (url, init = {}) => {
    const text = String(url)
    if (text.includes('/api/v1/health')) {
      return { ok: true, status: 200, json: async () => ({ status: 'ok' }), text: async () => '' }
    }
    calls.push({ url: text, body: init.body instanceof FormData ? '<form>' : init.body })
    if (init.method === 'POST' && text.includes('image2character')) {
      const body = JSON.parse(init.body)
      if (body.image === 'dead.png') {
        return { ok: false, status: 500, text: async () => 'Internal Server Error' }
      }
      return { ok: true, status: 200, json: async () => ({ full_url: SHEET_URL, filename: 'sheet-fresh.png' }) }
    }
    if (init.method === 'POST' && text.includes('uploadimage')) {
      return { ok: true, status: 200, json: async () => ({ filename: 'fresh.png' }) }
    }
    if (init.method === 'POST' && text.includes('image2splitegrid')) {
      return { ok: true, status: 200, json: async () => ({ images: [{ filename: 'piece-fresh.png', url: PIECE_URL }] }) }
    }
    if (text === SHEET_URL || text === PIECE_URL) {
      return { ok: true, status: 200, arrayBuffer: async () => new Uint8Array([7, 7, 7]) }
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
    appendCanvasNode: async () => { writes.push(['appendCanvasNode']) },
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
    // 二拍成功：拼图落画布 + 分图切出且 filename 是重传后的新名。
    assert.ok(result.url.startsWith('/canvas-studio/assets/p1/'))
    assert.equal(result.pieces.length, 1)
    assert.equal(result.pieces[0].filename, 'fresh.png')
    // 自愈链路发生：image2character 打了两拍，第二拍带重传新名。
    const charCalls = calls.filter((c) => c.url.includes('image2character'))
    assert.equal(charCalls.length, 2)
    assert.equal(JSON.parse(charCalls[0].body).image, 'dead.png')
    assert.equal(JSON.parse(charCalls[1].body).image, 'fresh.png')
    assert.ok(calls.some((c) => c.url.includes('uploadimage')))
    // 节点 filename 回写为新名（不变式：节点 filename = 后端当前可用名）。
    const patched = registry.getWrites().find((w) => w[0] === 'writeCanvas')
    assert.ok(patched && patched[1].some((s) => s.startsWith('n1:fresh.png')))
    // 资产卡建立。
    assert.equal(registry.getAssets()[0].name, '女主')
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
      /Internal Server Error/,
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
      if (init.method === 'POST' && text.includes('image2character')) {
        return { ok: false, status: 400, text: async () => 'bad request' }
      }
      return { ok: false, status: 404, text: async () => '' }
    }
    const registry = stubSheetRegistry([stubNode()], dir)
    await assert.rejects(
      generateCharacterSheet(registry, 'p1', { filename: 'dead.png', assetName: '女主', lockedPrompt: 'X' }),
      /bad request/,
    )
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
