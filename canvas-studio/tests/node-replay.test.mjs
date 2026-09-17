/**
 * CV-195：三类「旁路产物」节点的重放链路 —— 音频（music_generation）/
 * 四视图（character_sheet）/ 抽帧（extract_last_frame）。
 *
 * 这三类各有独立的生产函数，不走 `generateAsset` 的画幅 / 档位 / 血缘装配链，
 * 且节点上存的 `generationPrompt` 是各自的后端契约形态（蛇形键、或只有定位用的
 * 最小信息）。CV-194 收紧判据时它们被排除在 `REPLAYABLE_TOOLS` 之外（按钮消失、
 * 链路是死的）；CV-195 补齐了 `generateAsset` 的分派 + `retryOf` 原地下传。
 *
 * 本文件锁住四件事：
 * 1. 判定层 `isReplayable` 对这三类**恢复为真**（参数可解析时）；
 * 2. 重放是**原地重写**（保留 id / 位置 / 血缘 / 资产卡），不是追加新节点；
 * 3. 参数翻译正确（蛇形键 → 生产函数入参；`retryOf` 不进后端请求体）；
 * 4. `REPLAYABLE_TOOLS` 与 `generateAsset` 的 tool 字面量分发**双向一致**
 *    （谁改了一边忘了另一边，这个守卫就红）。
 *
 * 直连 Host 侧编译产物 lib/generate.js；fetch 打桩避开真实 Drama Backend。
 * 运行：corepack yarn workspace canvas-studio test:smoke
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { generateAsset } from '../lib/generate.js'
import { isReplayable } from '../lib/node-params.js'
import { ProjectRegistry } from '../lib/projects.js'

const SRC_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'src')

/** health 探针的统一放行桩（所有 Drama 请求前都会探一次）。 */
function healthOk() {
  return { ok: true, status: 200, json: async () => ({ status: 'ok' }), text: async () => '' }
}

/**
 * 可变更的项目注册表打桩：`readCanvas` 返回**当前状态**（重放会读两次 ——
 * 生产函数读一次拿资产卡、`overwriteNodeAsset` 再读一次拿节点），
 * 并记录每一次写盘动作的类型，用于断言「没有追加新节点」。
 */
function mutableRegistry(nodes, assets, assetsDir) {
  const state = { nodes: [...nodes], assets: [...assets] }
  const log = []
  return {
    list: async () => [{ id: 'p1', name: 'P1', dir: assetsDir, createdAt: 1 }],
    assetsDir: () => assetsDir,
    readCanvas: async () => ({
      version: 4,
      nodes: state.nodes.map((node) => ({ ...node })),
      assets: state.assets.map((asset) => ({ ...asset })),
    }),
    writeCanvas: async (_projectId, next) => { log.push('writeCanvas'); state.nodes = [...next] },
    appendCanvasNode: async (_projectId, node) => { log.push('appendCanvasNode'); state.nodes = [...state.nodes, node] },
    releaseAssetNodes: async () => { log.push('releaseAssetNodes') },
    upsertAsset: async (_projectId, asset) => {
      log.push('upsertAsset')
      const index = state.assets.findIndex((entry) => entry.id === asset.id)
      if (index >= 0) state.assets[index] = asset
      else state.assets.push(asset)
    },
    nodes: () => state.nodes,
    assets: () => state.assets,
    log: () => log,
  }
}

// ---------------------------------------------------------------------------
// 1. 判定层：这三类恢复为可重放
// ---------------------------------------------------------------------------

test('isReplayable：音频 / 四视图 / 抽帧恢复为可重放；参数坏掉仍不可', () => {
  const node = (toolName, generationPrompt) => ({
    id: 'n1', kind: 'image', url: '/u.png', x: 0, y: 0, width: 1, height: 1, createdAt: 1, toolName,
    ...(generationPrompt === undefined ? {} : { generationPrompt }),
  })

  assert.equal(isReplayable(node('music_generation', '{"caption_prompt":"a"}')), true)
  assert.equal(isReplayable(node('character_sheet', '{"image":"ref.png","step":"four-view"}')), true)
  assert.equal(isReplayable(node('extract_last_frame', '{"videoUrl":"/u.mp4","seek":4.95}')), true)

  // 参数坏掉（非 JSON / 是数组 / 是标量）仍然不可重放 —— 判据的第二条不许松。
  assert.equal(isReplayable(node('music_generation', 'not json')), false)
  assert.equal(isReplayable(node('character_sheet', '[1,2]')), false)
  assert.equal(isReplayable(node('extract_last_frame', undefined)), false)
  // 未登记的工具照旧不可重放（判据是白名单，不是「有没有 toolName」）。
  assert.equal(isReplayable(node('submit_storyboard_for_approval', '{}')), false)
})

// ---------------------------------------------------------------------------
// 2. music_generation 重放
// ---------------------------------------------------------------------------

const AUDIO_URL = 'https://media.example/audio_00002_.mp3'

function stubMusicFetch() {
  const calls = []
  globalThis.fetch = async (url, init = {}) => {
    const text = String(url)
    if (text.includes('/api/v1/health')) return healthOk()
    if (init.method === 'POST' && text.includes('txt2audio')) {
      calls.push({ kind: 'audio', body: JSON.parse(init.body) })
      return { ok: true, status: 200, json: async () => ({ filename: 'audio_00002_.mp3', full_url: AUDIO_URL }) }
    }
    if (text === AUDIO_URL) {
      calls.push({ kind: 'download' })
      return { ok: true, status: 200, arrayBuffer: async () => new Uint8Array([1, 2, 3]) }
    }
    return { ok: false, status: 404, text: async () => '' }
  }
  return calls
}

test('music_generation 重放：原地重写 + 蛇形参数进请求体 + retryOf 不外泄', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cs-replay-music-'))
  try {
    const registry = mutableRegistry([{
      id: 'a1',
      kind: 'audio',
      url: '/canvas-studio/assets/p1/old.mp3',
      title: 'BGM',
      x: 320, y: 40, width: 260, height: 120,
      createdAt: 1000,
      duration: 20,
      declaredDuration: 20,
      lyrics: '[Instrumental]',
      toolName: 'music_generation',
      runId: 'a1',
      origin: 'agent',
      sourceIds: ['seed-audio'],
      operationType: 'text-to-audio',
      generationPrompt: '{"caption_prompt":"lofi hip hop","lyrics_prompt":"[Instrumental]","duration":20,"bpm":90}',
      error: '生成失败: HTTP 500',
    }], [], dir)
    const calls = stubMusicFetch()

    const result = await generateAsset(registry, 'music_generation', 'p1', {
      caption_prompt: 'lofi hip hop',
      lyrics_prompt: '[Instrumental]',
      duration: 20,
      bpm: 90,
      retryOf: 'a1',
    })

    const body = calls.find((call) => call.kind === 'audio').body
    assert.equal(body.caption_prompt, 'lofi hip hop')
    assert.equal(body.duration, 20, 'duration 应原样回放，不是默认 30')
    assert.equal(body.bpm, 90, 'bpm 应原样回放，不是默认 128')
    assert.ok(!('retryOf' in body), 'retryOf 是本地锚点，不许进后端请求体')

    assert.equal(result.nodeId, 'a1', '重放复用原节点 id')

    const saved = registry.nodes()
    assert.equal(saved.length, 1, '重放不追加新节点')
    assert.equal(registry.log().includes('appendCanvasNode'), false)
    const node = saved[0]
    assert.equal(node.id, 'a1')
    assert.equal(node.x, 320, '位置保留')
    assert.equal(node.y, 40)
    assert.deepEqual(node.sourceIds, ['seed-audio'], '血缘保留')
    assert.equal(node.error, undefined, '重试成功要清掉上一次的失败态')
    assert.notEqual(node.url, '/canvas-studio/assets/p1/old.mp3', '产物 URL 应换成新的一版')
    assert.equal(node.lyrics, '[Instrumental]')
    assert.equal(node.duration, 20)
    assert.equal(JSON.parse(node.generationPrompt).retryOf, undefined, '锚点不落进节点参数')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('music_generation：缺 retryOf 明确报错，不悄悄追加节点', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cs-replay-music-bare-'))
  try {
    const registry = mutableRegistry([], [], dir)
    stubMusicFetch()
    await assert.rejects(
      generateAsset(registry, 'music_generation', 'p1', { caption_prompt: 'x' }),
      /只支持原地重试/,
    )
    assert.deepEqual(registry.log(), [], '报错路径不写画布')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('music_generation：caption_prompt 缺失时报可操作错误', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cs-replay-music-nocap-'))
  try {
    const registry = mutableRegistry([{
      id: 'a1', kind: 'audio', url: '/u.mp3', x: 0, y: 0, width: 260, height: 120, createdAt: 1,
      toolName: 'music_generation',
    }], [], dir)
    stubMusicFetch()
    await assert.rejects(
      generateAsset(registry, 'music_generation', 'p1', { retryOf: 'a1' }),
      /缺少音乐描述/,
    )
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------------------
// 3. character_sheet 重放
// ---------------------------------------------------------------------------

const SHEET_URL = 'https://media.example/sheet-2.png'

function stubSheetFetch() {
  const calls = []
  globalThis.fetch = async (url, init = {}) => {
    const text = String(url)
    if (text.includes('/api/v1/health')) return healthOk()
    if (init.method === 'POST' && text.includes('image2character')) {
      calls.push({ kind: 'sheet', image: JSON.parse(init.body).image })
      return { ok: true, status: 200, json: async () => ({ full_url: SHEET_URL, filename: 'sheet-2.png' }) }
    }
    if (text === SHEET_URL) {
      calls.push({ kind: 'download' })
      return { ok: true, status: 200, arrayBuffer: async () => new Uint8Array([5, 5, 5]) }
    }
    return { ok: false, status: 404, text: async () => '' }
  }
  return calls
}

function sheetNode() {
  return {
    id: 'cs1',
    kind: 'image',
    url: '/canvas-studio/assets/p1/cs1.png',
    isReference: true,
    referenceRole: 'character',
    x: 600, y: 40, width: 260, height: 180,
    createdAt: 1000,
    toolName: 'character_sheet',
    runId: 'cs1',
    origin: 'agent',
    sourceIds: ['design-node'],
    operationType: 'character-sheet',
    generationPrompt: '{"image":"design-ref.png","step":"four-view"}',
    assetId: 'as1',
  }
}

function sheetAsset() {
  return {
    id: 'as1',
    name: '女主',
    role: 'character',
    anchorNodeIds: ['cs1'],
    lockedPrompt: 'SAME 块：黑长发 / 米色风衣',
    negativePrompt: '不换装',
    createdAt: 1000,
  }
}

test('character_sheet 重放：复用锚点节点 id，资产卡原地保留（不多出第二张卡）', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cs-replay-sheet-'))
  try {
    const registry = mutableRegistry([sheetNode()], [sheetAsset()], dir)
    const calls = stubSheetFetch()

    const result = await generateAsset(registry, 'character_sheet', 'p1', {
      image: 'design-ref.png',
      step: 'four-view',
      retryOf: 'cs1',
    })

    assert.deepEqual(calls.filter((call) => call.kind === 'sheet').map((call) => call.image), ['design-ref.png'],
      '应把节点上存的参考图原样回放')

    const saved = registry.nodes()
    assert.equal(saved.length, 1, '重放不追加新节点')
    assert.equal(registry.log().includes('appendCanvasNode'), false)
    const node = saved[0]
    assert.equal(node.id, 'cs1', '节点 id 复用 = 资产卡锚点不搬迁')
    assert.equal(node.x, 600)
    assert.equal(node.y, 40)
    assert.deepEqual(node.sourceIds, ['design-node'])
    assert.equal(node.assetId, 'as1')
    assert.equal(result.nodeId, 'cs1')

    // 拼图**真的重写到了同一路径**（资源路由是 no-store，故同名文件不会被缓存）。
    const bytes = await readFile(join(dir, 'cs1.png'))
    assert.deepEqual([...bytes], [5, 5, 5])

    const assets = registry.assets()
    assert.equal(assets.length, 1, '同名即覆盖：不许新增第二张卡')
    assert.deepEqual(assets[0].anchorNodeIds, ['cs1'])
    assert.equal(assets[0].lockedPrompt, 'SAME 块：黑长发 / 米色风衣', '冻结描述不该被重试冲掉')
    assert.equal(assets[0].negativePrompt, '不换装')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('character_sheet 重放：锚点资产卡已丢失时报错，而不是新建一张卡', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cs-replay-sheet-orphan-'))
  try {
    const registry = mutableRegistry([sheetNode()], [], dir)
    stubSheetFetch()
    await assert.rejects(
      generateAsset(registry, 'character_sheet', 'p1', { image: 'design-ref.png', step: 'four-view', retryOf: 'cs1' }),
      /资产卡已不存在/,
    )
    assert.deepEqual(registry.log(), [], '报错路径不写画布')
    assert.equal(registry.assets().length, 0)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------------------
// 4. extract_last_frame 重放
// ---------------------------------------------------------------------------

// 假 ffmpeg：无 -y 视为探针（打印时长/分辨率后退出 1），有 -y 视为产出（写文件）。
// 与 tests/video-frames.test.mjs 同一套替身 —— 重放走的也是真实 ffmpeg 调用路径。
const FAKE_FFMPEG = [
  '#!/bin/sh',
  'HAS_Y=0',
  'for arg in "$@"; do',
  '  case "$arg" in',
  '    -y) HAS_Y=1 ;;',
  '  esac',
  'done',
  'if [ "$HAS_Y" = "1" ]; then',
  '  OUT=""',
  '  for arg in "$@"; do OUT="$arg"; done',
  "  printf 'FAKEFRAME' > \"$OUT\"",
  '  exit 0',
  'fi',
  "echo \"Input #0, mov,mp4 from 'a.mp4':\" >&2",
  'echo "  Duration: 00:00:05.00, start: 0.000000, bitrate: 1024 kb/s" >&2',
  'echo "    Stream #0:0: Video: h264, yuv420p, 1280x720, 25 fps" >&2',
  'exit 1',
].join('\n')

test('extract_last_frame 重放：原地换末帧（新文件），血缘与位置保留', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cs-replay-frame-'))
  const fakeFfmpeg = join(dir, 'fake-ffmpeg.sh')
  const priorFfmpegPath = process.env.FFMPEG_PATH
  try {
    await writeFile(fakeFfmpeg, FAKE_FFMPEG)
    await chmod(fakeFfmpeg, 0o755)
    // 重放路径不接受 `ffmpegPath` 注入（那是内部调用），故按仓库惯例走 FFMPEG_PATH。
    process.env.FFMPEG_PATH = fakeFfmpeg

    const registry = new ProjectRegistry(dir)
    const project = await registry.create('重放测试')
    const assetsDir = registry.assetsDir(project.id)
    await writeFile(join(assetsDir, 'a.mp4'), 'FAKEVIDEO')
    await writeFile(join(assetsDir, 'old-frame.png'), 'OLDFRAME')

    const clipUrl = `/canvas-studio/assets/${project.id}/a.mp4`
    await registry.writeCanvas(project.id, [
      {
        id: 'v1', kind: 'video', url: clipUrl, title: '分镜 1 · 视频', x: 0, y: 0, width: 480, height: 270,
        createdAt: 1, toolName: 'video_generate', runId: 'v1', origin: 'agent', sourceIds: [], duration: 5,
      },
      {
        id: 'f1', kind: 'image', url: `/canvas-studio/assets/${project.id}/old-frame.png`, title: '末帧 · 分镜 1',
        isReference: true, referenceRole: 'frame', x: 520, y: 60, width: 480, height: 294, createdAt: 2,
        toolName: 'extract_last_frame', runId: 'f1', origin: 'agent', sourceIds: ['v1'], operationType: 'import',
        generationPrompt: JSON.stringify({ videoUrl: clipUrl, seek: 4.95 }),
      },
    ])

    const uploaded = []
    globalThis.fetch = async (url, init = {}) => {
      const text = String(url)
      if (text.includes('/api/v1/health')) return healthOk()
      if (init.method === 'POST' && text.includes('/generate/upload')) {
        uploaded.push(text)
        return { ok: true, status: 200, json: async () => ({ name: 'ref-framereplay.png' }) }
      }
      return { ok: false, status: 404, text: async () => '' }
    }

    const frameBase = (await registry.readCanvas(project.id)).nodes.find((node) => node.id === 'f1')
    const result = await generateAsset(registry, 'extract_last_frame', project.id, {
      ...JSON.parse(frameBase.generationPrompt),
      retryOf: 'f1',
    })

    assert.equal(result.nodeId, 'f1', '重放复用原节点 id')
    assert.equal(result.filename, 'ref-framereplay.png')
    assert.equal(uploaded.length, 1)

    const nodes = (await registry.readCanvas(project.id)).nodes
    assert.equal(nodes.length, 2, '重放不追加新节点（源视频 + 末帧）')
    const frame = nodes.find((node) => node.id === 'f1')
    assert.equal(frame.x, 520, '位置保留')
    assert.equal(frame.y, 60)
    assert.deepEqual(frame.sourceIds, ['v1'], '血缘保留')
    assert.equal(frame.referenceRole, 'frame')
    assert.notEqual(frame.url, `/canvas-studio/assets/${project.id}/old-frame.png`, '末帧应是新文件')

    // 新帧图真的落盘，旧帧仍留在盘上可回溯。
    const freshFile = frame.url.split('/').at(-1)
    assert.equal((await readFile(join(assetsDir, freshFile))).toString(), 'FAKEFRAME')
    assert.equal((await readFile(join(assetsDir, 'old-frame.png'))).toString(), 'OLDFRAME')
  } finally {
    if (priorFfmpegPath === undefined) delete process.env.FFMPEG_PATH
    else process.env.FFMPEG_PATH = priorFfmpegPath
    await rm(dir, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------------------
// 5. 守卫：判定表与分发字面量必须双向一致
// ---------------------------------------------------------------------------

/** 剥掉块注释与行注释 —— 守卫读源码必须先剥注释，否则注释里的示例会喂饱断言。 */
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ')
}

test('守卫：REPLAYABLE_TOOLS 与 generateAsset 的 tool 字面量必须逐项一致（双向）', () => {
  const paramsSource = stripComments(readFileSync(join(SRC_DIR, 'node-params.ts'), 'utf8'))
  const declMatch = /const REPLAYABLE_TOOLS[^=]*=\s*\[([\s\S]*?)\]/.exec(paramsSource)
  assert.ok(declMatch !== null, '找不到 REPLAYABLE_TOOLS 声明')
  const declared = [...declMatch[1].matchAll(/'([a-z_]+)'/g)].map((match) => match[1])
  const replayable = [...new Set(declared)].sort()

  const generateSource = stripComments(readFileSync(join(SRC_DIR, 'generate.ts'), 'utf8'))
  const dispatched = [...new Set(
    [...generateSource.matchAll(/tool === '([a-z_]+)'/g)].map((match) => match[1]),
  )].sort()

  assert.ok(replayable.length >= 7, `判定表太小（${replayable.length} 项），守卫可能已失效`)
  // 双向：少一项 = 「有分支但这工具的重试按钮不会出现」；
  //       多一项 = 「按钮出现了但 generateAsset 打不通」——两种都是缺陷。
  assert.deepEqual(replayable, dispatched,
    'REPLAYABLE_TOOLS（node-params.ts）与 generateAsset 的 tool 分发（generate.ts）必须逐项一致')
})
