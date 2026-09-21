/**
 * 血缘补全三条（CV-204 / CV-205 / CV-206）的守卫测试。
 *
 * 背景：三条改动此前已在代码里（compose_video 并 BGM/文案 血缘、分镜卡优先
 * 挂剧本、music_generation 收 sourceNodeIds + 空血缘兜底挂文案），但零测试
 * 零登记（STATUS 记「已分配·未登记」）—— 本文件补测试这一块。
 *
 * 取证画布：罗大佑风格测试（2026-09-21，69 节点）—— 成片 v1 血缘 5 条
 * （3 分镜视频 + BGM + 文案）、18 张分镜卡全挂剧本、后 2 条 BGM 挂文案，
 * 三条改动在真实画布上均已生效；本文件把它们钉住防回归。
 *
 * 直连 Host 侧编译产物 lib/*.js。运行：corepack yarn workspace canvas-studio test:smoke
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFile } from 'node:fs/promises'
import { composedSourceIds } from '../lib/compose-selection.js'
import { createStudioTools } from '../lib/host-tools.js'
import { generateMusic } from '../lib/generate.js'

// ---------------------------------------------------------------------------
// CV-204：成片血缘 = 片段 + BGM + 文案（composedSourceIds）
// ---------------------------------------------------------------------------

test('CV-204 composedSourceIds：片段 + BGM + 文案并集去重，保序', () => {
  assert.deepEqual(
    composedSourceIds(['c1', 'c2'], 'bgm1', 'script1'),
    ['c1', 'c2', 'bgm1', 'script1'],
  )
  // 去重：BGM id 与片段重复时只留一份
  assert.deepEqual(composedSourceIds(['c1', 'c2'], 'c1'), ['c1', 'c2'])
  // 缺省两个来源时退化为纯片段（与旧行为一致）
  assert.deepEqual(composedSourceIds(['c1']), ['c1'])
  assert.deepEqual(composedSourceIds([], undefined, undefined), [])
})

test('CV-204 接线守卫：两条成片路径都消费 composedSourceIds，不允许再各自手写展开', async () => {
  const srcRoot = join(dirname(fileURLToPath(import.meta.url)), '..', 'src')
  const hostTools = await readFile(join(srcRoot, 'host-tools.ts'), 'utf8')
  const studioFrame = await readFile(join(srcRoot, 'client', 'StudioFrame.tsx'), 'utf8')
  assert.match(hostTools, /composedSourceIds\(clipIds/, 'compose_video 工具路径必须走唯一实现')
  assert.match(studioFrame, /composedSourceIds\(clipIds/, '时间轴导出路径必须走唯一实现')
  // 旧的内联展开不得复活
  assert.doesNotMatch(hostTools, /\.\.\.\(a\.bgmNodeId != null/)
  assert.doesNotMatch(studioFrame, /\.\.\.\(composeSelection\.bgmNode != null/)
})

// ---------------------------------------------------------------------------
// CV-205：分镜卡血缘优先剧本，无剧本回退创意
// ---------------------------------------------------------------------------

/** 与 shot-cards.test.mjs 同款的执行环境。 */
function stubHealthFetch() {
  globalThis.fetch = async (url) => {
    if (String(url).includes('/api/v1/health')) {
      return { ok: true, status: 200, json: async () => ({ status: 'ok' }), text: async () => '' }
    }
    return { ok: false, status: 404, text: async () => '' }
  }
}

function makeRegistry(assetsDir, initialNodes = []) {
  const project = { id: 'p1', name: 'P1', dir: assetsDir, createdAt: '1', updatedAt: '1', workflow: { mode: 'confirm', state: 'drafting' } }
  const store = { nodes: [...initialNodes] }
  return {
    list: async () => [project],
    getProject: async () => project,
    updateWorkflow: async (id, patch) => { project.workflow = { ...project.workflow, ...patch }; return project },
    readCanvas: async () => ({ version: 4, nodes: store.nodes }),
    writeCanvas: async (id, nodes) => { store.nodes = [...nodes] },
    appendCanvasNode: async (id, node) => { store.nodes.push(node) },
    assetsDir: () => assetsDir,
    _store: store,
  }
}

function textNode(id, toolName) {
  return {
    id,
    kind: 'text',
    title: toolName === 'user_brief' ? '创意' : '剧本',
    text: '内容',
    x: 40, y: 40, width: 360, height: 220,
    createdAt: 1,
    toolName,
    origin: 'agent',
    sourceIds: [],
  }
}

const EXEC = (cwd) => ({
  agent: { session: { header: { cwd } } },
  signal: new AbortController().signal,
  concludeTurn: () => {},
})

const cfg = {
  dramaApiBase: () => 'http://localhost:9999',
  maxVideoSeconds: () => 15,
  resolveDramaApiKey: async () => 'fake',
  resolveFalApiKey: async () => '',
  defaultVideoProvider: () => 'drama',
  workflowMode: () => 'confirm',
  hitlStoryboard: () => true,
  hitlKeyframe: () => false,
  autoRetry: () => true,
  maxParallel: () => 2,
  assetDir: () => '',
  autoSave: () => true,
  autoSaveInterval: () => 30,
}

function row(no) {
  return [String(no), '特写', '推', '5s', '画面', '环境音']
}

function storyboardMd(rows) {
  return [
    '| 镜号 | 景别 | 镜头运动 | 时长 | 画面描述 | 声音 |',
    '| --- | --- | --- | --- | --- | --- |',
    ...rows.map((cells) => `| ${cells.join(' | ')} |`),
  ].join('\n')
}

async function submitStoryboard(reg, dir) {
  stubHealthFetch()
  const tools = createStudioTools(reg, 0, cfg)
  const submit = tools.find((tool) => tool.name === 'submit_storyboard_for_approval')
  await submit.execute({ storyboard: storyboardMd([row(1), row(2)]), summary: '分镜' }, EXEC(dir))
  return reg._store.nodes.filter((node) => node.toolName === 'submit_storyboard_for_approval')
}

test('CV-205 端到端：剧本在场上时分镜卡挂剧本（不再跳过剧本直挂创意）', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cs-lineage-'))
  try {
    const brief = textNode('brief-1', 'user_brief')
    const screenplay = textNode('script-1', 'write_screenplay')
    const reg = makeRegistry(dir, [brief, screenplay])
    const cards = await submitStoryboard(reg, dir)
    assert.equal(cards.length, 2)
    for (const card of cards) {
      assert.deepEqual(card.sourceIds, ['script-1'],
        '有剧本时分镜卡必须挂剧本 —— 星形直连创意会稀释「谁直接推导出谁」')
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('CV-205 端到端：只有创意时回退挂创意；两者皆无时空血缘', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cs-lineage-'))
  try {
    const reg = makeRegistry(dir, [textNode('brief-1', 'user_brief')])
    const cards = await submitStoryboard(reg, dir)
    for (const card of cards) assert.deepEqual(card.sourceIds, ['brief-1'], '无剧本回退创意')

    const reg2 = makeRegistry(dir, [])
    const cards2 = await submitStoryboard(reg2, dir)
    for (const card of cards2) assert.deepEqual(card.sourceIds, [], '无父节点时不许猜')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------------------
// CV-206：music_generation 收 sourceNodeIds（并集过滤幽灵 id）+ 空血缘兜底挂文案
// ---------------------------------------------------------------------------

const AUDIO_URL = 'https://media.example/audio_00001_.mp3'

function stubMusicFetch() {
  globalThis.fetch = async (url, init = {}) => {
    const text = String(url)
    if (text.includes('/api/v1/health')) {
      return { ok: true, status: 200, json: async () => ({ status: 'ok' }), text: async () => '' }
    }
    if (init.method === 'POST' && text.includes('txt2audio')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ prompt_id: 'p1', filename: 'audio_00001_.mp3', full_url: AUDIO_URL, duration: 15.3 }),
      }
    }
    if (text === AUDIO_URL) {
      return { ok: true, status: 200, arrayBuffer: async () => new Uint8Array([1, 2, 3]) }
    }
    return { ok: false, status: 404, text: async () => '' }
  }
}

function musicRegistry(assetsDir, initialNodes = []) {
  const nodes = []
  return {
    assetsDir: () => assetsDir,
    readCanvas: async () => ({ version: 4, nodes: [...initialNodes] }),
    appendCanvasNode: async (_projectId, node) => { nodes.push(node) },
    getNodes: () => nodes,
  }
}

function mediaNode(id, url) {
  return {
    id, kind: 'video', url: url ?? `https://media.example/${id}.mp4`,
    x: 0, y: 0, width: 320, height: 180, createdAt: 1,
    origin: 'agent', sourceIds: [],
  }
}

test('CV-206 sourceNodeIds：与 sourceUrls 反查取并集，幽灵 id 被过滤', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cs-music-'))
  try {
    stubMusicFetch()
    const shot = mediaNode('shot-1', 'https://media.example/clip.mp4')
    const reg = musicRegistry(dir, [shot])
    await generateMusic(reg, 'p1', {
      captionPrompt: 'epic orchestral',
      sourceUrls: ['https://media.example/clip.mp4'],
      sourceNodeIds: ['shot-1', 'ghost-id'],
    })
    const node = reg.getNodes()[0]
    assert.deepEqual(node.sourceIds, ['shot-1'],
      'URL 反查与显式 id 归并去重；指向已删节点的 id 不许进血缘')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('CV-206 兜底：无任何来源时挂场上文案节点（策略出处）；无文案则空', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cs-music-'))
  try {
    stubMusicFetch()
    const script = textNode('script-1', 'write_script')
    const reg = musicRegistry(dir, [script])
    await generateMusic(reg, 'p1', { captionPrompt: 'soft piano' })
    assert.deepEqual(reg.getNodes()[0].sourceIds, ['script-1'],
      '罗大佑画布取证：BGM 空血缘兜底挂文案在文案先落盘时生效')

    const reg2 = musicRegistry(dir, [])
    await generateMusic(reg2, 'p1', { captionPrompt: 'soft piano' })
    assert.deepEqual(reg2.getNodes()[0].sourceIds, [],
      '场上没有任何可挂节点时保持空（不许编造血缘）—— BGM 早于文案落盘的时序缺口另立新条目')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('CV-221 兜底链：无文案时逐级落到 剧本 → 分镜卡', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cs-music-'))
  try {
    stubMusicFetch()
    // 只有剧本（配乐类项目文案还没写）→ 挂剧本
    const reg1 = musicRegistry(dir, [textNode('sp-1', 'write_screenplay')])
    await generateMusic(reg1, 'p1', { captionPrompt: 'soft piano' })
    assert.deepEqual(reg1.getNodes()[0].sourceIds, ['sp-1'], '无文案时兜底挂剧本')

    // 只有分镜卡 → 挂分镜卡
    const reg2 = musicRegistry(dir, [textNode('sb-1', 'submit_storyboard_for_approval')])
    await generateMusic(reg2, 'p1', { captionPrompt: 'soft piano' })
    assert.deepEqual(reg2.getNodes()[0].sourceIds, ['sb-1'], '无文案无剧本时兜底挂分镜卡')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('CV-221 兜底链：多条文案时挂最新一条（max createdAt）', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cs-music-'))
  try {
    stubMusicFetch()
    const oldScript = { ...textNode('script-old', 'write_script'), createdAt: 1 }
    const newScript = { ...textNode('script-new', 'write_script'), createdAt: 2 }
    const reg = musicRegistry(dir, [oldScript, newScript])
    await generateMusic(reg, 'p1', { captionPrompt: 'soft piano' })
    assert.deepEqual(reg.getNodes()[0].sourceIds, ['script-new'],
      '配乐类项目有多版文案（放手跑2 的 6 条）时，最新策略才是 BGM 的出处')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
