/**
 * CV-125：music_generation 转正（Drama txt2audio / ACE Step）回归。
 *
 * 占位工具时代 music_generation 只返回降级文案；本文件验证真实实现：
 * 参数映射（prompt→caption_prompt 等）、mp3 下载落盘、画布节点落盘
 * （kind=video 复用 BGM 消费路径，operationType=text-to-audio）、
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

test('CV-125 music_generation：参数映射 + mp3 落盘 + 画布节点（kind=video / text-to-audio）', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cs-music-'))
  try {
    const calls = stubMusicFetch()
    const registry = stubRegistry(dir)
    const result = await generateMusic(registry, 'p1', {
      captionPrompt: 'soft ambient piano, warm pads',
      duration: 15,
      bpm: 96,
      keyscale: 'A minor',
      language: 'unknown',
      timesignature: '4',
    })
    // 请求体映射：prompt→caption_prompt；lyrics 缺省为 [Instrumental]（CV-127）；
    // language=unknown 纯器乐。
    const body = JSON.parse(calls.find((c) => c.url.includes('txt2audio')).body)
    assert.equal(body.caption_prompt, 'soft ambient piano, warm pads')
    assert.equal(body.lyrics_prompt, '[Instrumental]')
    assert.equal(body.duration, 15)
    assert.equal(body.bpm, 96)
    assert.equal(body.keyscale, 'A minor')
    assert.equal(body.language, 'unknown')
    assert.equal(body.timesignature, '4')
    // 产物：下载落盘 mp3 + 画布节点（kind=video 复用 BGM 消费路径）。
    assert.ok(result.url.startsWith('/canvas-studio/assets/p1/') && result.url.endsWith('.mp3'))
    assert.equal(result.filename, 'audio_00001_.mp3')
    // CV-127：结果回显请求规格（duration/bpm），供分镜按拍拆镜与成片对齐。
    assert.equal(result.duration, 15)
    assert.equal(result.bpm, 96)
    const node = registry.getNodes()[0]
    assert.equal(node.kind, 'video')
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
    assert.equal(body.bpm, 128)
    assert.equal(body.lyrics_prompt, '[Verse]\nhello world')
    assert.equal(result.duration, 30)
    assert.equal(result.bpm, 128)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('CV-125 music_generation：API 失败（500）原样透传，不建节点', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cs-music-'))
  try {
    stubMusicFetch()
    const registry = stubRegistry(dir)
    await assert.rejects(
      generateMusic(registry, 'p1', { captionPrompt: 'boom' }),
      /Internal Server Error/,
    )
    assert.equal(registry.getNodes().length, 0)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
