/**
 * CV-125：music_generation 转正（Drama txt2audio / ACE Step）回归。
 *
 * 占位工具时代 music_generation 只返回降级文案；本文件验证真实实现：
 * 参数映射（prompt→caption_prompt 等）、mp3 下载落盘、画布节点落盘
 * （kind=audio 独立节点，operationType=text-to-audio）、
 * 返回 nodeId 可直接作 compose_video 的 bgmNodeId；API 失败原样透传。
 *
 * 直连 Host 侧编译产物 lib/generate.js；fetch 打桩避开真实 Drama Backend。
 * 运行：corepack yarn workspace canvas-studio test:smoke
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { generateMusic } from '../lib/generate.js'

const AUDIO_URL = 'https://media.example/audio_00001_.mp3'

function stubMusicFetch() {
  const calls = []
  globalThis.fetch = async (url, init = {}) => {
    const text = String(url)
    if (text.includes('/api/v1/health')) {
      return { ok: true, status: 200, json: async () => ({ status: 'ok' }), text: async () => '' }
    }
    calls.push({ url: text, body: init.body })
    if (init.method === 'POST' && text.includes('txt2audio')) {
      if (JSON.parse(init.body).caption_prompt === 'boom') {
        return { ok: false, status: 500, text: async () => 'Internal Server Error' }
      }
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
  return calls
}

function stubRegistry(assetsDir) {
  const nodes = []
  return {
    assetsDir: () => assetsDir,
    readCanvas: async () => ({ version: 3, nodes: [], assets: [] }),
    appendCanvasNode: async (_projectId, node) => { nodes.push(node) },
    getNodes: () => nodes,
  }
}

test('CV-125 music_generation：参数映射 + mp3 落盘 + 画布节点（kind=audio / text-to-audio）', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cs-music-'))
  try {
    const calls = stubMusicFetch()
    const registry = stubRegistry(dir)
    const result = await generateMusic(registry, 'p1', {
      captionPrompt: 'soft ambient piano, warm pads',
      duration: 15,
    })
    // 请求体映射：prompt→caption_prompt；lyrics 缺省为 [Instrumental]（CV-127）。
    // 0.7.0 对拍：Yue2 工作流不消费 bpm/keyscale/language/timesignature —— 请求体
    // 只发三个真实生效的参数，多余键一个都不许出现。
    const body = JSON.parse(calls.find((c) => c.url.includes('txt2audio')).body)
    assert.equal(body.caption_prompt, 'soft ambient piano, warm pads')
    assert.equal(body.lyrics_prompt, '[Instrumental]')
    assert.equal(body.duration, 15)
    assert.equal('bpm' in body, false)
    assert.equal('keyscale' in body, false)
    assert.equal('language' in body, false)
    assert.equal('timesignature' in body, false)
    // 产物：下载落盘 mp3 + 画布节点（CV-128：独立 kind=audio，不复用 video）。
    assert.ok(result.url.startsWith('/canvas-studio/assets/p1/') && result.url.endsWith('.mp3'))
    assert.equal(result.filename, 'audio_00001_.mp3')
    // CV-127：结果回显请求规格（duration），供成片对齐。
    assert.equal(result.duration, 15)
    const node = registry.getNodes()[0]
    assert.equal(node.kind, 'audio')
    assert.equal(node.operationType, 'text-to-audio')
    assert.equal(node.toolName, 'music_generation')
    assert.equal(node.id, result.nodeId)
    assert.equal(node.url, result.url)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('CV-127 music_generation：duration/bpm 缺省回填 30 / 128，显式 lyrics 原样透传', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cs-music-'))
  try {
    const calls = stubMusicFetch()
    const registry = stubRegistry(dir)
    const result = await generateMusic(registry, 'p1', {
      captionPrompt: 'epic orchestral, building',
      lyricsPrompt: '[Verse]\nhello world',
    })
    const body = JSON.parse(calls.find((c) => c.url.includes('txt2audio')).body)
    assert.equal(body.duration, 30)
    assert.equal(body.lyrics_prompt, '[Verse]\nhello world')
    assert.equal(result.duration, 30)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

// ---- CV-127b：集成——后端偶发 500 的同参数重试自愈 ----

test('CV-127b music_generation：偶发 500 自动重试成功，回显 attempts>1', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cs-music-'))
  try {
    let calls = 0
    globalThis.fetch = async (url, init = {}) => {
      const text = String(url)
      if (text.includes('/api/v1/health')) {
        return { ok: true, status: 200, json: async () => ({ status: 'ok' }), text: async () => '' }
      }
      if (init.method === 'POST' && text.includes('txt2audio')) {
        calls += 1
        // 首次 500：故意耗时 >2s，模拟「生成过程中崩溃」的慢失败（后端偶发 500 的真实形态）
        if (calls === 1) {
          await new Promise((resolve) => { setTimeout(resolve, 2100) })
          return { ok: false, status: 500, text: async () => 'Internal Server Error' }
        }
        return { ok: true, status: 200, json: async () => ({ filename: 'a.mp3', full_url: AUDIO_URL }) }
      }
      if (text === AUDIO_URL) return { ok: true, status: 200, arrayBuffer: async () => new Uint8Array([1]) }
      return { ok: false, status: 404, text: async () => '' }
    }
    const registry = stubRegistry(dir)
    const result = await generateMusic(registry, 'p1', { captionPrompt: 'soft piano' })
    assert.equal(calls, 2, '应重试一次（同参数）')
    assert.equal(result.attempts, 2)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('CV-127b music_generation：显式传空 lyrics 也按纯器乐处理（此前只有 undefined 才兜住）', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cs-music-'))
  try {
    const calls = stubMusicFetch()
    const registry = stubRegistry(dir)
    await generateMusic(registry, 'p1', { captionPrompt: 'ambient', lyricsPrompt: '' })
    const body = JSON.parse(calls.find((c) => c.url.includes('txt2audio')).body)
    assert.equal(body.lyrics_prompt, '[Instrumental]')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('CV-125 / CV-127b：持续失败时重试耗尽后透传错误，不建节点', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cs-music-'))
  try {
    const calls = stubMusicFetch()
    const registry = stubRegistry(dir)
    await assert.rejects(
      generateMusic(registry, 'p1', { captionPrompt: 'boom' }),
      /Internal Server Error/,
    )
    // CV-127b：同参数重试到上限（共 3 次），耗尽后透传错误
    assert.equal(calls.filter((c) => c.url.includes('txt2audio')).length, 3)
    assert.equal(registry.getNodes().length, 0)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('CV-128：历史音频节点迁移（kind=video + text-to-audio → audio）', async () => {
  const { migrateAudioNode } = await import('../lib/projects.js')
  const { AUDIO_NODE_HEIGHT, AUDIO_NODE_WIDTH } = await import('../lib/contracts/canvas.js')
  const legacy = {
    id: 'n1', kind: 'video', operationType: 'text-to-audio', url: '/a.mp3',
    x: 0, y: 0, width: 260, height: 84, createdAt: 1, origin: 'agent', sourceIds: [],
  }
  const migrated = migrateAudioNode(legacy)
  assert.equal(migrated.kind, 'audio')
  // CV-130：顺手抬到新卡片尺寸（84 高装不下歌词行；音频没有 resize 手柄，
  // 「偏小」不可能是用户意图）。
  assert.equal(migrated.height, AUDIO_NODE_HEIGHT)
  assert.equal(migrated.width, AUDIO_NODE_WIDTH)
  // 其它节点原样返回
  assert.equal(migrateAudioNode({ ...legacy, kind: 'video', operationType: 'text-to-video' }).kind, 'video')
  assert.equal(migrateAudioNode({ ...legacy, kind: 'video', operationType: 'text-to-video' }).height, 84)
  // CV-128 批次已落盘的 audio 节点（84 高）同样抬齐
  const oldAudio = { ...legacy, kind: 'audio' }
  assert.equal(migrateAudioNode(oldAudio).kind, 'audio')
  assert.equal(migrateAudioNode(oldAudio).height, AUDIO_NODE_HEIGHT)
})

// ---- CV-130：歌词随节点落盘 + 卡片尺寸同源 ----

test('CV-130：有歌词时原样落进节点 lyrics（画布要显示的就是这份词）', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cs-music-'))
  try {
    const calls = stubMusicFetch()
    const registry = stubRegistry(dir)
    const LYRICS = '[Verse]\n路灯把影子拉长\n\n[Chorus]\n我还在原地等你'
    const result = await generateMusic(registry, 'p1', {
      captionPrompt: 'city pop, warm bass, melancholic',
      lyricsPrompt: LYRICS,
      language: 'zh',
      duration: 60,
    })
    const body = JSON.parse(calls.find((c) => c.url.includes('txt2audio')).body)
    assert.equal(body.lyrics_prompt, LYRICS)
    // 结果回显（模型据此确认「唱的就是这份词」，不要另编一份）
    assert.equal(result.lyrics, LYRICS)
    // 节点落盘：歌词是作品的一部分，不能只活在请求体里
    assert.equal(registry.getNodes()[0].lyrics, LYRICS)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('CV-130：纯器乐落 [Instrumental] 占位（UI 翻译成「纯器乐」而不是露方括号）', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cs-music-'))
  try {
    stubMusicFetch()
    const registry = stubRegistry(dir)
    const result = await generateMusic(registry, 'p1', { captionPrompt: 'ambient pads' })
    assert.equal(result.lyrics, '[Instrumental]')
    assert.equal(registry.getNodes()[0].lyrics, '[Instrumental]')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('CV-130：音频节点尺寸取契约常量（Host 落盘与 client 渲染同源，防漂移）', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cs-music-'))
  try {
    stubMusicFetch()
    const registry = stubRegistry(dir)
    const { AUDIO_NODE_HEIGHT, AUDIO_NODE_WIDTH } = await import('../lib/contracts/canvas.js')
    await generateMusic(registry, 'p1', { captionPrompt: 'ambient' })
    const node = registry.getNodes()[0]
    assert.equal(node.width, AUDIO_NODE_WIDTH)
    assert.equal(node.height, AUDIO_NODE_HEIGHT)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
