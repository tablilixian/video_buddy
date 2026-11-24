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
import { generationDownloadBranch } from './helpers/generation-stub.mjs'

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
  const project = { id: 'p1', name: 'P1', dir: assetsDir, createdAt: '1', updatedAt: '1', workflow: { mode: 'confirm', state: 'storyboarding' } }
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
    // 迁移 B3-2：业务 API txt2audio（创建/轮询/content 下载）。
    if (init.method === 'POST' && /\/v1\/generations(\?|$)/.test(text)) {
      return {
        ok: true,
        status: 202,
        json: async () => ({
          id: 'cccccccc-cccc-4ccc-8ccc-000000000001', operation: 'txt2audio', status: 'queued', version: 1,
          progress: 0, billing_status: 'held', terminal: false, outputs: [], error: null,
        }),
      }
    }
    if (text.includes('/poll')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          id: 'cccccccc-cccc-4ccc-8ccc-000000000001', operation: 'txt2audio', status: 'succeeded', version: 2,
          progress: 100, billing_status: 'held', terminal: true, result_status: 'ready',
          outputs: [{ ordinal: 0, type: 'audio', mime_type: 'audio/mpeg', content_url: '/v1/generations/x/content/0', download_url: '/v1/generations/x/download/0' }],
          error: null,
        }),
      }
    }
    const handled = generationDownloadBranch(text, { contentBytes: new Uint8Array([1, 2, 3]) })
    if (handled !== null) return handled
    if (text.includes('/content/')) {
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

// ---------------------------------------------------------------------------
// 2026-11-24：BGM 兜底链补「声音设计便签」档（真实画布取证）
//
// 「《赤发》」项目（VideoOut/new4 …内 4）里 BGM 节点的 sourceIds 指向「分镜 5」，
// 而它的 generationPrompt 开头就是 `92 BPM` —— 那正是 seed 写进「旁白与声音」
// 便签的 §06 参数。兜底链当时只有 文案 → 剧本 → 分镜文档 → 分镜卡，没有便签这
// 一档，于是箭头说了一个假出处：BGM 看起来是从某一镜派生的。
// ---------------------------------------------------------------------------

/** seed 的「旁白与声音」便签：text + sbRef='03' + 无 toolName（`isSoundSpecNode` 的形态）。 */
function soundSpecNode(id, createdAt = 1) {
  return {
    id, kind: 'text', title: '旁白与声音',
    text: '【旁白】本片无旁白\n【BGM】BPM 92 · 响度 -16 LUFS · 侧链避让 1.5–3kHz\n【音效】山风与夜虫床',
    x: 0, y: 0, width: 380, height: 180,
    createdAt, origin: 'agent', sourceIds: [], sbRef: '03',
  }
}

test('BGM 兜底：有「旁白与声音」便签时挂便签，不挂分镜卡', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cs-music-'))
  try {
    stubMusicFetch()
    // 便签比最新一镜早（seed 时 createdAt = anchor+1，分镜卡按镜号递增），
    // 证明命中的是「便签优先」这条档，不是在比 createdAt 谁新。
    const note = soundSpecNode('note-1', 2)
    const shot = { ...textNode('shot-5', 'seedStoryboardShot'), createdAt: 9 }
    const reg = musicRegistry(dir, [note, shot])
    await generateMusic(reg, 'p1', { captionPrompt: 'cinematic 92 BPM' })
    assert.deepEqual(reg.getNodes()[0].sourceIds, ['note-1'],
      '《赤发》取证：BGM 的 92 BPM 抄自便签，血缘就该指向便签而不是「分镜 5」')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('BGM 兜底：便签排在分镜文档之前（同样比某一镜更配当出处）', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cs-music-'))
  try {
    stubMusicFetch()
    const note = soundSpecNode('note-1', 2)
    const storyboard = { ...textNode('sb-1', 'submit_storyboard_for_approval'), createdAt: 5 }
    const reg = musicRegistry(dir, [note, storyboard])
    await generateMusic(reg, 'p1', { captionPrompt: 'soft piano' })
    assert.deepEqual(reg.getNodes()[0].sourceIds, ['note-1'], '便签档在分镜文档之前')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('BGM 兜底：文案/剧本优先于便签（文案类项目语义不变）', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cs-music-'))
  try {
    stubMusicFetch()
    const note = soundSpecNode('note-1', 9)
    const script = { ...textNode('script-1', 'write_script'), createdAt: 1 }
    const reg = musicRegistry(dir, [note, script])
    await generateMusic(reg, 'p1', { captionPrompt: 'soft piano' })
    assert.deepEqual(reg.getNodes()[0].sourceIds, ['script-1'],
      'CV-206/221 的老口径不动：文案在场上时 BGM 仍挂文案')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('便签判据：同 sbRef 但非 text 节点不算声音便签（落回分镜卡）', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cs-music-'))
  try {
    stubMusicFetch()
    const fakeNote = { ...soundSpecNode('img-1', 2), kind: 'image', url: 'https://media.example/a.png' }
    const shot = { ...textNode('shot-5', 'seedStoryboardShot'), createdAt: 9 }
    const reg = musicRegistry(dir, [fakeNote, shot])
    await generateMusic(reg, 'p1', { captionPrompt: 'soft piano' })
    assert.deepEqual(reg.getNodes()[0].sourceIds, ['shot-5'],
      '`isSoundSpecNode` 校验 kind：sbRef="03" 的图节点不许冒充声音便签')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
